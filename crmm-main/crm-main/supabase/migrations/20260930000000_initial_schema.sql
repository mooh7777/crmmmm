create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create type public.organization_role as enum ('owner', 'manager', 'sales');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique,
  timezone text not null default 'Africa/Cairo'
    check (timezone in ('Africa/Cairo', 'Asia/Riyadh')),
  currency text not null default 'EGP' check (currency in ('EGP', 'SAR')),
  weekend_days smallint[] not null default array[5, 6]::smallint[]
    check (weekend_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  working_hours jsonb not null default '{"start":"09:00","end":"18:00"}'::jsonb
    check (
      working_hours ? 'start'
      and working_hours ? 'end'
      and working_hours->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and working_hours->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and working_hours->>'start' < working_hours->>'end'
    ),
  language text not null default 'ar' check (language in ('ar', 'en')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'sales',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  name_ar text not null check (char_length(trim(name_ar)) between 1 and 60),
  position smallint not null check (position >= 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, position)
);

create unique index pipeline_stages_one_default_per_org
  on public.pipeline_stages (organization_id)
  where is_default;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  phone text not null check (char_length(trim(phone)) between 5 and 40),
  email text,
  source text,
  property_interest text,
  budget_min numeric(14, 2) check (budget_min is null or budget_min >= 0),
  budget_max numeric(14, 2) check (budget_max is null or budget_max >= budget_min),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'won', 'lost')),
  stage_id uuid not null,
  assigned_to uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, stage_id)
    references public.pipeline_stages(organization_id, id),
  foreign key (organization_id, assigned_to)
    references public.memberships(organization_id, user_id),
  foreign key (organization_id, created_by)
    references public.memberships(organization_id, user_id)
);

create index leads_org_assignee_created_idx
  on public.leads (organization_id, assigned_to, created_at desc);

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(trim(event_type)) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, lead_id)
    references public.leads(organization_id, id) on delete cascade
);

create index lead_events_org_lead_created_idx
  on public.lead_events (organization_id, lead_id, created_at desc);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 160),
  title_ar text not null check (char_length(trim(title_ar)) between 1 and 160),
  assigned_to uuid not null,
  created_by uuid not null,
  due_at timestamptz not null,
  is_mandatory boolean not null default true,
  completed_at timestamptz,
  reminded_at timestamptz,
  escalated_at timestamptz,
  escalated_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, lead_id)
    references public.leads(organization_id, id) on delete cascade,
  foreign key (organization_id, assigned_to)
    references public.memberships(organization_id, user_id),
  foreign key (organization_id, created_by)
    references public.memberships(organization_id, user_id),
  foreign key (organization_id, escalated_to)
    references public.memberships(organization_id, user_id)
);

create index tasks_org_assignee_due_idx
  on public.tasks (organization_id, assigned_to, due_at)
  where completed_at is null;
create index tasks_overdue_idx on public.tasks (due_at)
  where completed_at is null and escalated_at is null;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null,
  task_id uuid not null,
  kind text not null check (kind in ('task_due', 'task_escalated')),
  title text not null check (char_length(trim(title)) between 1 and 160),
  title_ar text not null check (char_length(trim(title_ar)) between 1 and 160),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, recipient_id, kind),
  foreign key (organization_id, recipient_id)
    references public.memberships(organization_id, user_id),
  foreign key (organization_id, task_id)
    references public.tasks(organization_id, id) on delete cascade
);

create index notifications_recipient_unread_idx
  on public.notifications (organization_id, recipient_id, created_at desc)
  where read_at is null;

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rule_key text not null check (char_length(trim(rule_key)) between 1 and 80),
  enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, rule_key),
  check (
    case rule_key
      when 'lead.required_follow_up' then
        case
          when coalesce(configuration->>'due_in_minutes', '') ~ '^[0-9]{1,5}$'
            then (configuration->>'due_in_minutes')::integer between 1 and 10080
          else false
        end
      when 'task.escalate_overdue' then
        case
          when configuration->>'after_minutes' is null then true
          when configuration->>'after_minutes' ~ '^[0-9]{1,4}$'
            then (configuration->>'after_minutes')::integer between 0 and 1440
          else false
        end
      else true
    end
  )
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'growth', 'enterprise')),
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger automation_rules_set_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create function public.get_org_role(target_organization_id uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select membership.role
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = (select auth.uid())
$$;

revoke all on function public.get_org_role(uuid) from public, anon;
grant execute on function public.get_org_role(uuid) to authenticated;

create function public.create_organization(
  organization_name text,
  organization_timezone text default 'Africa/Cairo',
  organization_currency text default 'EGP',
  organization_weekend_days smallint[] default array[5, 6]::smallint[],
  organization_working_hours jsonb default '{"start":"09:00","end":"18:00"}'::jsonb,
  organization_language text default 'ar'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  new_organization_id uuid;
  slug_base text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if char_length(trim(organization_name)) not between 2 and 120 then
    raise exception 'Organization name must be between 2 and 120 characters'
      using errcode = '22023';
  end if;

  slug_base := trim(both '-' from regexp_replace(lower(organization_name), '[^a-z0-9]+', '-', 'g'));
  if slug_base = '' then
    slug_base := 'org';
  end if;

  insert into public.organizations (
    name, slug, timezone, currency, weekend_days, working_hours, language, created_by
  ) values (
    trim(organization_name),
    slug_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8),
    organization_timezone,
    organization_currency,
    organization_weekend_days,
    organization_working_hours,
    organization_language,
    actor_id
  )
  returning id into new_organization_id;

  insert into public.memberships (organization_id, user_id, role)
  values (new_organization_id, actor_id, 'owner');

  insert into public.pipeline_stages (organization_id, name, name_ar, position, is_default)
  values
    (new_organization_id, 'New', 'جديد', 0, true),
    (new_organization_id, 'Contacted', 'تم التواصل', 1, false),
    (new_organization_id, 'Qualified', 'مؤهل', 2, false),
    (new_organization_id, 'Won', 'تم البيع', 3, false),
    (new_organization_id, 'Lost', 'مفقود', 4, false);

  insert into public.automation_rules (organization_id, rule_key, configuration)
  values
    (new_organization_id, 'lead.auto_assign', '{"strategy":"least_open_leads"}'::jsonb),
    (new_organization_id, 'lead.required_follow_up', '{"due_in_minutes":60}'::jsonb),
    (new_organization_id, 'task.escalate_overdue', '{"after_minutes":15}'::jsonb);

  insert into public.subscriptions (organization_id, plan, status)
  values (new_organization_id, 'trial', 'trialing');

  return new_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, smallint[], jsonb, text) from public, anon;
grant execute on function public.create_organization(text, text, text, smallint[], jsonb, text) to authenticated;

create function public.create_lead(
  target_organization_id uuid,
  lead_full_name text,
  lead_phone text,
  lead_email text default null,
  lead_source text default null,
  lead_property_interest text default null,
  requested_assignee_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.organization_role;
  assignee_id uuid;
  follow_up_minutes integer;
  default_stage_id uuid;
  new_lead_id uuid;
begin
  actor_role := public.get_org_role(target_organization_id);
  if actor_id is null or actor_role is null then
    raise exception 'Organization membership required' using errcode = '42501';
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
    ) then
      raise exception 'Assignee must be a salesperson in this organization' using errcode = '22023';
    end if;
    assignee_id := requested_assignee_id;
  elsif actor_role = 'sales' then
    assignee_id := actor_id;
  else
    perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text, 0));
    select membership.user_id
    into assignee_id
    from public.memberships as membership
    left join lateral (
      select count(*) as open_leads
      from public.leads as lead
      where lead.organization_id = membership.organization_id
        and lead.assigned_to = membership.user_id
        and lead.status not in ('won', 'lost')
    ) as workload on true
    where membership.organization_id = target_organization_id
      and membership.role = 'sales'
    order by workload.open_leads, membership.created_at, membership.user_id
    limit 1;

    if assignee_id is null then
      assignee_id := actor_id;
    end if;
  end if;

  select stage.id
  into default_stage_id
  from public.pipeline_stages as stage
  where stage.organization_id = target_organization_id and stage.is_default;

  if default_stage_id is null then
    raise exception 'Organization has no default pipeline stage' using errcode = '23514';
  end if;

  select coalesce((rule.configuration->>'due_in_minutes')::integer, 60)
  into follow_up_minutes
  from public.automation_rules as rule
  where rule.organization_id = target_organization_id
    and rule.rule_key = 'lead.required_follow_up'
    and rule.enabled;
  follow_up_minutes := coalesce(follow_up_minutes, 60);

  insert into public.leads (
    organization_id, full_name, phone, email, source, property_interest,
    stage_id, assigned_to, created_by
  ) values (
    target_organization_id, trim(lead_full_name), trim(lead_phone), lead_email,
    lead_source, lead_property_interest, default_stage_id, assignee_id, actor_id
  ) returning id into new_lead_id;

  insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
  values (
    target_organization_id, new_lead_id, actor_id, 'lead.created',
    jsonb_build_object('assigned_to', assignee_id)
  );

  insert into public.tasks (
    organization_id, lead_id, title, title_ar, assigned_to, created_by, due_at
  ) values (
    target_organization_id, new_lead_id, 'Follow up with new lead', 'متابعة العميل المحتمل الجديد',
    assignee_id, actor_id, now() + make_interval(mins => follow_up_minutes)
  );

  return new_lead_id;
end;
$$;

revoke all on function public.create_lead(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_lead(uuid, text, text, text, text, text, uuid) to authenticated;

create function public.process_due_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  overdue_task record;
  manager_id uuid;
  processed_count integer := 0;
begin
  for overdue_task in
    select task.id, task.organization_id, task.lead_id, task.assigned_to
    from public.tasks as task
    where task.completed_at is null
      and task.reminded_at is null
      and task.due_at <= now()
    for update of task skip locked
  loop
    insert into public.notifications (
      organization_id, recipient_id, task_id, kind, title, title_ar
    ) values (
      overdue_task.organization_id,
      overdue_task.assigned_to,
      overdue_task.id,
      'task_due',
      'Follow-up is due',
      'حان موعد متابعة العميل'
    ) on conflict (task_id, recipient_id, kind) do nothing;

    update public.tasks set reminded_at = now() where id = overdue_task.id;

    insert into public.lead_events (organization_id, lead_id, event_type, payload)
    values (
      overdue_task.organization_id, overdue_task.lead_id, 'task.reminder_sent',
      jsonb_build_object('task_id', overdue_task.id, 'recipient_id', overdue_task.assigned_to)
    );

    processed_count := processed_count + 1;
  end loop;

  for overdue_task in
    select task.id, task.organization_id, task.lead_id, task.assigned_to
    from public.tasks as task
    where task.completed_at is null
      and task.reminded_at is not null
      and task.escalated_at is null
      and task.due_at <= now()
      and exists (
        select 1
        from public.automation_rules as rule
        where rule.organization_id = task.organization_id
          and rule.rule_key = 'task.escalate_overdue'
          and rule.enabled
          and task.due_at + make_interval(mins => coalesce((rule.configuration->>'after_minutes')::integer, 15)) <= now()
      )
    for update of task skip locked
  loop
    select membership.user_id
    into manager_id
    from public.memberships as membership
    where membership.organization_id = overdue_task.organization_id
      and membership.role in ('owner', 'manager')
    order by case membership.role when 'manager' then 0 else 1 end, membership.created_at
    limit 1;

    update public.tasks
    set escalated_at = now(), escalated_to = manager_id
    where id = overdue_task.id;

    insert into public.lead_events (organization_id, lead_id, event_type, payload)
    values (
      overdue_task.organization_id, overdue_task.lead_id, 'task.escalated',
      jsonb_build_object('task_id', overdue_task.id, 'assigned_to', overdue_task.assigned_to, 'escalated_to', manager_id)
    );

    if manager_id is not null then
      insert into public.notifications (
        organization_id, recipient_id, task_id, kind, title, title_ar
      ) values (
        overdue_task.organization_id,
        manager_id,
        overdue_task.id,
        'task_escalated',
        'A follow-up was escalated',
        'تم تصعيد متابعة متأخرة'
      ) on conflict (task_id, recipient_id, kind) do nothing;
    end if;

    processed_count := processed_count + 1;
  end loop;

  return processed_count;
end;
$$;

revoke all on function public.process_due_tasks() from public, anon, authenticated;
grant execute on function public.process_due_tasks() to service_role;

select cron.schedule(
  'masar-process-due-tasks',
  '* * * * *',
  'select public.process_due_tasks()'
);

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.tasks enable row level security;
alter table public.notifications enable row level security;
alter table public.automation_rules enable row level security;
alter table public.subscriptions enable row level security;

create policy "members read their organizations"
  on public.organizations for select to authenticated
  using (public.get_org_role(id) is not null);
create policy "managers update organization settings"
  on public.organizations for update to authenticated
  using (public.get_org_role(id) in ('owner', 'manager'))
  with check (public.get_org_role(id) in ('owner', 'manager'));

create policy "members read organization memberships"
  on public.memberships for select to authenticated
  using (public.get_org_role(organization_id) is not null);

create policy "members read pipeline stages"
  on public.pipeline_stages for select to authenticated
  using (public.get_org_role(organization_id) is not null);
create policy "managers manage pipeline stages"
  on public.pipeline_stages for all to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'))
  with check (public.get_org_role(organization_id) in ('owner', 'manager'));

create policy "managers read all leads"
  on public.leads for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "sales read assigned leads"
  on public.leads for select to authenticated
  using (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()));
create policy "managers update organization leads"
  on public.leads for update to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'))
  with check (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "sales update assigned leads"
  on public.leads for update to authenticated
  using (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()))
  with check (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()));

create policy "managers read all lead events"
  on public.lead_events for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "sales read events for assigned leads"
  on public.lead_events for select to authenticated
  using (
    public.get_org_role(organization_id) = 'sales'
    and exists (
      select 1 from public.leads as lead
      where lead.organization_id = lead_events.organization_id
        and lead.id = lead_events.lead_id
        and lead.assigned_to = (select auth.uid())
    )
  );

create policy "managers read all tasks"
  on public.tasks for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "sales read assigned tasks"
  on public.tasks for select to authenticated
  using (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()));
create policy "managers update organization tasks"
  on public.tasks for update to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'))
  with check (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "sales complete assigned tasks"
  on public.tasks for update to authenticated
  using (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()))
  with check (public.get_org_role(organization_id) = 'sales' and assigned_to = (select auth.uid()));

create policy "members read own organization notifications"
  on public.notifications for select to authenticated
  using (
    public.get_org_role(organization_id) is not null
    and (
      recipient_id = (select auth.uid())
      or public.get_org_role(organization_id) in ('owner', 'manager')
    )
  );
create policy "members mark own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()) and public.get_org_role(organization_id) is not null)
  with check (recipient_id = (select auth.uid()) and public.get_org_role(organization_id) is not null);

create policy "managers read automation rules"
  on public.automation_rules for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));
create policy "managers manage automation rules"
  on public.automation_rules for all to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'))
  with check (public.get_org_role(organization_id) in ('owner', 'manager'));

create policy "managers read subscriptions"
  on public.subscriptions for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));

grant usage on schema public to authenticated, service_role;
grant select on public.organizations, public.memberships, public.pipeline_stages,
  public.leads, public.lead_events, public.tasks, public.automation_rules,
  public.subscriptions, public.notifications to authenticated;
grant update (name, timezone, currency, weekend_days, working_hours, language)
  on public.organizations to authenticated;
grant insert, update, delete on public.pipeline_stages to authenticated;
grant update (full_name, phone, email, source, property_interest, budget_min, budget_max, status, stage_id)
  on public.leads to authenticated;
grant update (completed_at) on public.tasks to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on all tables in schema public to service_role;

grant usage on type public.organization_role to authenticated, service_role;

alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.lead_events;
alter publication supabase_realtime add table public.notifications;