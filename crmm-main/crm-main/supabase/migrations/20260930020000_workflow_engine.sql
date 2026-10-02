create extension if not exists pg_net;

alter table public.memberships
  add column is_active boolean not null default true;

alter table public.leads
  add column assignment_status text not null default 'assigned'
    check (assignment_status in ('assigned', 'pending'));

alter table public.tasks
  add column last_activity_at timestamptz not null default now();

create table public.organization_workflow_cursors (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_assigned_sales_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, last_assigned_sales_id)
    references public.memberships(organization_id, user_id)
);

alter table public.organization_workflow_cursors enable row level security;

update public.automation_rules
set configuration = '{"strategy":"round_robin","respect_working_hours":true}'::jsonb
where rule_key = 'lead.auto_assign';

insert into public.automation_rules (organization_id, rule_key, configuration)
select organization.id, 'lead.auto_assign', '{"strategy":"round_robin","respect_working_hours":true}'::jsonb
from public.organizations as organization
where not exists (
  select 1 from public.automation_rules as rule
  where rule.organization_id = organization.id and rule.rule_key = 'lead.auto_assign'
);

create function public.organization_is_working_time(
  target_organization_id uuid,
  instant timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    extract(dow from (instant at time zone organization.timezone))::smallint <> all(organization.weekend_days)
    and (instant at time zone organization.timezone)::time >= (organization.working_hours->>'start')::time
    and (instant at time zone organization.timezone)::time < (organization.working_hours->>'end')::time,
    false
  )
  from public.organizations as organization
  where organization.id = target_organization_id
$$;

create function public.next_working_time(
  target_organization_id uuid,
  starting_at timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  organization record;
  cursor_at timestamptz := starting_at;
  local_at timestamp;
  local_date date;
  day_number integer;
begin
  select timezone, weekend_days, working_hours
  into organization
  from public.organizations
  where id = target_organization_id;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  for day_number in 0..14 loop
    local_at := cursor_at at time zone organization.timezone;
    local_date := local_at::date;

    if extract(dow from local_at)::smallint <> all(organization.weekend_days) then
      if local_at::time < (organization.working_hours->>'start')::time then
        return (local_date + (organization.working_hours->>'start')::time) at time zone organization.timezone;
      end if;
      if local_at::time < (organization.working_hours->>'end')::time then
        return cursor_at;
      end if;
    end if;

    cursor_at := ((local_date + 1) + (organization.working_hours->>'start')::time)
      at time zone organization.timezone;
  end loop;

  raise exception 'Could not find the next working interval' using errcode = '22023';
end;
$$;

create function public.add_working_minutes(
  target_organization_id uuid,
  starting_at timestamptz,
  minutes_to_add integer
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  organization record;
  cursor_at timestamptz;
  local_date date;
  workday_end timestamptz;
  minutes_available integer;
  minutes_remaining integer := minutes_to_add;
  iteration integer;
begin
  if minutes_to_add < 0 or minutes_to_add > 10080 then
    raise exception 'Working minutes are outside supported range' using errcode = '22023';
  end if;

  select timezone, working_hours
  into organization
  from public.organizations
  where id = target_organization_id;
  if not found then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  cursor_at := public.next_working_time(target_organization_id, starting_at);
  if minutes_remaining = 0 then
    return cursor_at;
  end if;

  for iteration in 0..31 loop
    local_date := (cursor_at at time zone organization.timezone)::date;
    workday_end := (local_date + (organization.working_hours->>'end')::time)
      at time zone organization.timezone;
    minutes_available := floor(extract(epoch from (workday_end - cursor_at)) / 60)::integer;

    if minutes_remaining <= minutes_available then
      return cursor_at + make_interval(mins => minutes_remaining);
    end if;

    minutes_remaining := minutes_remaining - minutes_available;
    cursor_at := public.next_working_time(target_organization_id, workday_end + interval '1 second');
  end loop;

  raise exception 'Could not calculate the workflow deadline' using errcode = '22023';
end;
$$;

create function public.next_active_salesperson(target_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_sales_id uuid;
  previous_created_at timestamptz;
  next_sales_id uuid;
begin
  insert into public.organization_workflow_cursors (organization_id)
  values (target_organization_id)
  on conflict (organization_id) do nothing;

  select cursor.last_assigned_sales_id
  into previous_sales_id
  from public.organization_workflow_cursors as cursor
  where cursor.organization_id = target_organization_id
  for update;

  select membership.created_at
  into previous_created_at
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = previous_sales_id;

  select membership.user_id
  into next_sales_id
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.role = 'sales'
    and membership.is_active
    and (
      previous_sales_id is null
      or (membership.created_at, membership.user_id) > (previous_created_at, previous_sales_id)
    )
  order by membership.created_at, membership.user_id
  limit 1;

  if next_sales_id is null then
    select membership.user_id
    into next_sales_id
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.role = 'sales'
      and membership.is_active
    order by membership.created_at, membership.user_id
    limit 1;
  end if;

  if next_sales_id is not null then
    update public.organization_workflow_cursors
    set last_assigned_sales_id = next_sales_id, updated_at = now()
    where organization_id = target_organization_id;
  end if;

  return next_sales_id;
end;
$$;

revoke all on function public.next_active_salesperson(uuid) from public, anon, authenticated;

drop function public.create_lead_record(uuid, text, text, text, text, text, uuid, uuid, text);

create function public.create_lead_record(
  target_organization_id uuid,
  lead_full_name text,
  lead_phone text,
  lead_email text,
  lead_source text,
  lead_property_interest text,
  requested_assignee_id uuid,
  actor_user_id uuid,
  intake_channel text,
  received_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  assignee_id uuid;
  assignment_state text := 'assigned';
  auto_assign_enabled boolean;
  default_stage_id uuid;
  normalized_phone text;
  existing_lead_id uuid;
  existing_assignee_id uuid;
  follow_up_minutes integer;
  new_lead_id uuid;
begin
  if intake_channel not in ('manual', 'csv', 'webhook') then
    raise exception 'Invalid intake channel' using errcode = '22023';
  end if;

  select membership.role into actor_role
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = actor_user_id;
  if actor_role is null then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(lead_full_name, ''))) not between 2 and 160 then
    raise exception 'Lead name must be between 2 and 160 characters' using errcode = '22023';
  end if;

  normalized_phone := public.normalize_lead_phone(
    lead_phone,
    (select organization.timezone from public.organizations as organization where organization.id = target_organization_id)
  );
  if normalized_phone is null then
    raise exception 'Phone number is not valid for this organization' using errcode = '22023';
  end if;

  if requested_assignee_id is not null then
    if actor_role not in ('owner', 'manager') then
      raise exception 'Only managers can assign leads' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.memberships as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = requested_assignee_id
        and membership.role = 'sales'
        and membership.is_active
    ) then
      raise exception 'Assignee must be active sales in this organization' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text, 0));

  select lead.id, lead.assigned_to into existing_lead_id, existing_assignee_id
  from public.leads as lead
  where lead.organization_id = target_organization_id
    and lead.phone = normalized_phone
  limit 1;
  if existing_lead_id is not null then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      target_organization_id, existing_lead_id, actor_user_id, 'lead.duplicate_detected',
      jsonb_build_object('intake_channel', intake_channel)
    );
    return jsonb_build_object('id', existing_lead_id, 'duplicate', true, 'assigned_to', existing_assignee_id);
  end if;

  select rule.enabled into auto_assign_enabled
  from public.automation_rules as rule
  where rule.organization_id = target_organization_id and rule.rule_key = 'lead.auto_assign';
  auto_assign_enabled := coalesce(auto_assign_enabled, true);

  if requested_assignee_id is not null then
    assignee_id := requested_assignee_id;
  elsif auto_assign_enabled and public.organization_is_working_time(target_organization_id, received_at) then
    assignee_id := public.next_active_salesperson(target_organization_id);
  end if;

  if assignee_id is null then
    assignment_state := 'pending';
    if actor_role in ('owner', 'manager') then
      assignee_id := actor_user_id;
    else
      select membership.user_id into assignee_id
      from public.memberships as membership
      where membership.organization_id = target_organization_id
        and membership.role in ('owner', 'manager') and membership.is_active
      order by case membership.role when 'manager' then 0 else 1 end, membership.created_at
      limit 1;
    end if;
  end if;

  if assignee_id is null then
    raise exception 'Organization has no active assignee' using errcode = '23514';
  end if;

  select stage.id into default_stage_id
  from public.pipeline_stages as stage
  where stage.organization_id = target_organization_id and stage.is_default;
  if default_stage_id is null then
    raise exception 'Organization has no default pipeline stage' using errcode = '23514';
  end if;

  select coalesce((rule.configuration->>'due_in_minutes')::integer, 60)
  into follow_up_minutes
  from public.automation_rules as rule
  where rule.organization_id = target_organization_id
    and rule.rule_key = 'lead.required_follow_up' and rule.enabled;
  follow_up_minutes := coalesce(follow_up_minutes, 60);

  insert into public.leads (
    organization_id, full_name, phone, email, source, property_interest,
    stage_id, assigned_to, created_by, assignment_status
  ) values (
    target_organization_id, trim(lead_full_name), normalized_phone, lead_email,
    lead_source, lead_property_interest, default_stage_id, assignee_id, actor_user_id, assignment_state
  ) returning id into new_lead_id;

  insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
  values (
    target_organization_id, new_lead_id, actor_user_id, 'lead.created',
    jsonb_build_object('assigned_to', assignee_id, 'assignment_status', assignment_state, 'intake_channel', intake_channel)
  );

  if assignment_state = 'pending' then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      target_organization_id, new_lead_id, actor_user_id, 'lead.assignment_deferred',
      jsonb_build_object('reason', case when not public.organization_is_working_time(target_organization_id, received_at) then 'outside_working_hours' else 'no_active_sales' end)
    );
  end if;

  insert into public.tasks (
    organization_id, lead_id, title, title_ar, assigned_to, created_by, due_at, last_activity_at
  ) values (
    target_organization_id, new_lead_id, 'Follow up with new lead', 'متابعة العميل المحتمل الجديد',
    assignee_id, actor_user_id,
    public.add_working_minutes(target_organization_id, received_at, follow_up_minutes),
    received_at
  );

  return jsonb_build_object('id', new_lead_id, 'duplicate', false, 'assigned_to', assignee_id, 'assignment_status', assignment_state);
end;
$$;

revoke all on function public.create_lead_record(uuid, text, text, text, text, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;

create function public.record_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.full_name is distinct from new.full_name
    or old.phone is distinct from new.phone
    or old.email is distinct from new.email
    or old.source is distinct from new.source
    or old.property_interest is distinct from new.property_interest
    or old.status is distinct from new.status
    or old.stage_id is distinct from new.stage_id
  then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      new.organization_id, new.id, (select auth.uid()), 'lead.updated',
      jsonb_build_object('status', new.status, 'stage_id', new.stage_id)
    );
    update public.tasks
    set last_activity_at = now()
    where organization_id = new.organization_id and lead_id = new.id and completed_at is null;
  end if;
  return new;
end;
$$;

create trigger leads_record_activity
  after update on public.leads
  for each row execute function public.record_lead_activity();

create function public.touch_task_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.assigned_to is distinct from new.assigned_to
    or old.completed_at is distinct from new.completed_at
  then
    new.last_activity_at := now();
  end if;
  return new;
end;
$$;

create trigger tasks_touch_activity
  before update on public.tasks
  for each row execute function public.touch_task_activity();

create function public.record_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.assigned_to is distinct from new.assigned_to then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      new.organization_id, new.lead_id, (select auth.uid()), 'task.reassigned',
      jsonb_build_object('task_id', new.id, 'assigned_to', new.assigned_to)
    );
  end if;
  if old.completed_at is null and new.completed_at is not null then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      new.organization_id, new.lead_id, (select auth.uid()), 'task.completed',
      jsonb_build_object('task_id', new.id)
    );
  end if;
  return new;
end;
$$;

create trigger tasks_record_activity
  after update on public.tasks
  for each row execute function public.record_task_activity();

create function public.reassign_lead(
  target_organization_id uuid,
  target_lead_id uuid,
  new_assignee_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.organization_role;
  previous_assignee_id uuid;
begin
  actor_role := public.get_org_role(target_organization_id);
  if actor_id is null or actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = new_assignee_id
      and membership.role = 'sales'
      and membership.is_active
  ) then
    raise exception 'Assignee must be active sales in this organization' using errcode = '22023';
  end if;

  select lead.assigned_to into previous_assignee_id
  from public.leads as lead
  where lead.organization_id = target_organization_id and lead.id = target_lead_id
  for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if previous_assignee_id = new_assignee_id then
    return;
  end if;

  update public.leads
  set assigned_to = new_assignee_id, assignment_status = 'assigned'
  where organization_id = target_organization_id and id = target_lead_id;
  update public.tasks
  set assigned_to = new_assignee_id, reminded_at = null, escalated_at = null, escalated_to = null
  where organization_id = target_organization_id and lead_id = target_lead_id and completed_at is null;

  insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
  values (
    target_organization_id, target_lead_id, actor_id, 'lead.reassigned',
    jsonb_build_object('from', previous_assignee_id, 'to', new_assignee_id)
  );
end;
$$;

revoke all on function public.reassign_lead(uuid, uuid, uuid) from public, anon;
grant execute on function public.reassign_lead(uuid, uuid, uuid) to authenticated;

create function public.save_workflow_settings(
  target_organization_id uuid,
  organization_name text,
  organization_timezone text,
  organization_currency text,
  organization_language text,
  organization_weekend_days smallint[],
  organization_working_hours jsonb,
  follow_up_minutes integer,
  escalation_minutes integer,
  auto_assign_enabled boolean,
  active_sales_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.organization_role;
begin
  actor_role := public.get_org_role(target_organization_id);
  if actor_id is null or actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;
  if follow_up_minutes not between 1 and 10080 or escalation_minutes not between 0 and 1440 then
    raise exception 'Workflow minutes are outside supported range' using errcode = '22023';
  end if;
  if exists (
    select selected.user_id
    from unnest(coalesce(active_sales_ids, array[]::uuid[])) as selected(user_id)
    where not exists (
      select 1 from public.memberships as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = selected.user_id
        and membership.role = 'sales'
    )
  ) then
    raise exception 'Active sales must belong to this organization' using errcode = '22023';
  end if;

  update public.organizations
  set name = trim(organization_name),
      timezone = organization_timezone,
      currency = organization_currency,
      language = organization_language,
      weekend_days = organization_weekend_days,
      working_hours = organization_working_hours
  where id = target_organization_id;

  update public.memberships
  set is_active = user_id = any(coalesce(active_sales_ids, array[]::uuid[]))
  where organization_id = target_organization_id and role = 'sales';

  update public.automation_rules
  set enabled = auto_assign_enabled,
      configuration = '{"strategy":"round_robin","respect_working_hours":true}'::jsonb
  where organization_id = target_organization_id and rule_key = 'lead.auto_assign';

  insert into public.automation_rules (organization_id, rule_key, enabled, configuration)
  values (target_organization_id, 'lead.auto_assign', auto_assign_enabled, '{"strategy":"round_robin","respect_working_hours":true}'::jsonb)
  on conflict (organization_id, rule_key) do nothing;

  update public.automation_rules
  set enabled = true, configuration = jsonb_build_object('due_in_minutes', follow_up_minutes)
  where organization_id = target_organization_id and rule_key = 'lead.required_follow_up';
  insert into public.automation_rules (organization_id, rule_key, configuration)
  values (target_organization_id, 'lead.required_follow_up', jsonb_build_object('due_in_minutes', follow_up_minutes))
  on conflict (organization_id, rule_key) do nothing;

  update public.automation_rules
  set enabled = true, configuration = jsonb_build_object('after_minutes', escalation_minutes)
  where organization_id = target_organization_id and rule_key = 'task.escalate_overdue';
  insert into public.automation_rules (organization_id, rule_key, configuration)
  values (target_organization_id, 'task.escalate_overdue', jsonb_build_object('after_minutes', escalation_minutes))
  on conflict (organization_id, rule_key) do nothing;

  insert into public.lead_events (organization_id, actor_id, event_type, payload)
  values (
    target_organization_id, actor_id, 'workflow.settings_updated',
    jsonb_build_object(
      'follow_up_minutes', follow_up_minutes,
      'escalation_minutes', escalation_minutes,
      'auto_assign_enabled', auto_assign_enabled,
      'active_sales_count', coalesce(cardinality(active_sales_ids), 0)
    )
  );
end;
$$;

revoke all on function public.save_workflow_settings(uuid, text, text, text, text, smallint[], jsonb, integer, integer, boolean, uuid[]) from public, anon;
grant execute on function public.save_workflow_settings(uuid, text, text, text, text, smallint[], jsonb, integer, integer, boolean, uuid[]) to authenticated;

create function public.process_workflow_tasks_at(run_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_lead record;
  workflow_task record;
  salesperson_id uuid;
  manager_id uuid;
  assignment_count integer := 0;
  reminder_count integer := 0;
  escalation_count integer := 0;
begin
  for pending_lead in
    select lead.id, lead.organization_id
    from public.leads as lead
    where lead.assignment_status = 'pending'
      and public.organization_is_working_time(lead.organization_id, run_at)
      and exists (
        select 1 from public.automation_rules as rule
        where rule.organization_id = lead.organization_id
          and rule.rule_key = 'lead.auto_assign' and rule.enabled
      )
    order by lead.created_at, lead.id
    for update of lead skip locked
  loop
    salesperson_id := public.next_active_salesperson(pending_lead.organization_id);
    if salesperson_id is null then
      continue;
    end if;

    update public.leads
    set assigned_to = salesperson_id, assignment_status = 'assigned'
    where id = pending_lead.id;
    update public.tasks
    set assigned_to = salesperson_id, reminded_at = null, escalated_at = null, escalated_to = null
    where lead_id = pending_lead.id and completed_at is null;

    insert into public.lead_events (organization_id, lead_id, event_type, payload)
    values (
      pending_lead.organization_id, pending_lead.id, 'lead.auto_assigned',
      jsonb_build_object('assigned_to', salesperson_id, 'strategy', 'round_robin')
    );
    assignment_count := assignment_count + 1;
  end loop;

  for workflow_task in
    select task.id, task.organization_id, task.lead_id, task.assigned_to
    from public.tasks as task
    where task.completed_at is null
      and task.reminded_at is null
      and task.due_at <= run_at
      and public.organization_is_working_time(task.organization_id, run_at)
    order by task.due_at, task.id
    for update of task skip locked
  loop
    insert into public.notifications (organization_id, recipient_id, task_id, kind, title, title_ar)
    values (
      workflow_task.organization_id, workflow_task.assigned_to, workflow_task.id,
      'task_due', 'Follow-up is due', 'حان موعد متابعة العميل'
    ) on conflict (task_id, recipient_id, kind) do nothing;

    update public.tasks set reminded_at = run_at where id = workflow_task.id;
    insert into public.lead_events (organization_id, lead_id, event_type, payload)
    values (
      workflow_task.organization_id, workflow_task.lead_id, 'task.reminder_sent',
      jsonb_build_object('task_id', workflow_task.id, 'recipient_id', workflow_task.assigned_to)
    );
    reminder_count := reminder_count + 1;
  end loop;

  for workflow_task in
    select task.id, task.organization_id, task.lead_id, task.assigned_to
    from public.tasks as task
    where task.completed_at is null
      and task.reminded_at is not null
      and task.escalated_at is null
      and task.last_activity_at <= task.due_at
      and public.organization_is_working_time(task.organization_id, run_at)
      and exists (
        select 1 from public.automation_rules as rule
        where rule.organization_id = task.organization_id
          and rule.rule_key = 'task.escalate_overdue'
          and rule.enabled
          and public.add_working_minutes(
            task.organization_id,
            task.due_at,
            coalesce((rule.configuration->>'after_minutes')::integer, 15)
          ) <= run_at
      )
    order by task.due_at, task.id
    for update of task skip locked
  loop
    select membership.user_id into manager_id
    from public.memberships as membership
    where membership.organization_id = workflow_task.organization_id
      and membership.role in ('owner', 'manager')
      and membership.is_active
    order by case membership.role when 'manager' then 0 else 1 end, membership.created_at
    limit 1;

    if manager_id is null then
      continue;
    end if;

    update public.tasks set escalated_at = run_at, escalated_to = manager_id where id = workflow_task.id;
    insert into public.lead_events (organization_id, lead_id, event_type, payload)
    values (
      workflow_task.organization_id, workflow_task.lead_id, 'task.escalated',
      jsonb_build_object('task_id', workflow_task.id, 'assigned_to', workflow_task.assigned_to, 'escalated_to', manager_id)
    );
    insert into public.notifications (organization_id, recipient_id, task_id, kind, title, title_ar)
    values (
      workflow_task.organization_id, manager_id, workflow_task.id,
      'task_escalated', 'A follow-up was escalated', 'تم تصعيد متابعة متأخرة'
    ) on conflict (task_id, recipient_id, kind) do nothing;
    escalation_count := escalation_count + 1;
  end loop;

  return jsonb_build_object(
    'assigned', assignment_count,
    'reminded', reminder_count,
    'escalated', escalation_count
  );
end;
$$;

revoke all on function public.process_workflow_tasks_at(timestamptz) from public, anon, authenticated;

create function public.process_workflow_tasks()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.process_workflow_tasks_at(now())
$$;

revoke all on function public.process_workflow_tasks() from public, anon, authenticated;
grant execute on function public.process_workflow_tasks() to service_role;

create or replace function public.process_due_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := public.process_workflow_tasks_at(now());
  return (result->>'reminded')::integer + (result->>'escalated')::integer;
end;
$$;

create function public.configure_workflow_edge_runtime(edge_function_url text, cron_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if edge_function_url !~ '^https?://[^[:space:]]+/functions/v1/workflow-worker$'
    or char_length(cron_secret) < 32
  then
    raise exception 'Invalid Edge Function runtime configuration' using errcode = '22023';
  end if;

  select secret.id into existing_secret_id from vault.secrets as secret where secret.name = 'workflow_edge_url' limit 1;
  if existing_secret_id is null then
    perform vault.create_secret(edge_function_url, 'workflow_edge_url', 'Internal URL for the scheduled workflow Edge Function');
  else
    perform vault.update_secret(existing_secret_id, edge_function_url, 'workflow_edge_url', 'Internal URL for the scheduled workflow Edge Function');
  end if;

  select secret.id into existing_secret_id from vault.secrets as secret where secret.name = 'workflow_cron_secret' limit 1;
  if existing_secret_id is null then
    perform vault.create_secret(cron_secret, 'workflow_cron_secret', 'Shared secret authenticating pg_cron to the workflow Edge Function');
  else
    perform vault.update_secret(existing_secret_id, cron_secret, 'workflow_cron_secret', 'Shared secret authenticating pg_cron to the workflow Edge Function');
  end if;
end;
$$;

revoke all on function public.configure_workflow_edge_runtime(text, text) from public, anon, authenticated;
grant execute on function public.configure_workflow_edge_runtime(text, text) to service_role;

create function public.invoke_workflow_edge_function()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_function_url text;
  cron_secret text;
  request_id bigint;
begin
  select secret.decrypted_secret into edge_function_url
  from vault.decrypted_secrets as secret where secret.name = 'workflow_edge_url' limit 1;
  select secret.decrypted_secret into cron_secret
  from vault.decrypted_secrets as secret where secret.name = 'workflow_cron_secret' limit 1;
  if edge_function_url is null or cron_secret is null then
    return null;
  end if;

  select net.http_post(
    edge_function_url,
    '{}'::jsonb,
    '{}'::jsonb,
    jsonb_build_object('Content-Type', 'application/json', 'x-workflow-cron-secret', cron_secret),
    5000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.invoke_workflow_edge_function() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('masar-process-due-tasks', 'masar-workflow-edge-worker');
select cron.schedule('masar-workflow-edge-worker', '* * * * *', 'select public.invoke_workflow_edge_function()');