alter table public.lead_events
  alter column lead_id drop not null;

update public.automation_rules
set configuration = '{"strategy":"round_robin","respect_working_hours":true}'::jsonb
where rule_key = 'lead.auto_assign';

create function public.enforce_round_robin_assignment_rule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rule_key = 'lead.auto_assign' then
    new.configuration := coalesce(new.configuration, '{}'::jsonb)
      || '{"strategy":"round_robin","respect_working_hours":true}'::jsonb;
  end if;
  return new;
end;
$$;

create trigger automation_rules_enforce_round_robin
  before insert or update on public.automation_rules
  for each row execute function public.enforce_round_robin_assignment_rule();

create function public.get_workflow_sales_members(target_organization_id uuid)
returns table(sales_user_id uuid, sales_email text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select membership.user_id, auth_user.email, membership.is_active
  from public.memberships as membership
  join auth.users as auth_user on auth_user.id = membership.user_id
  where membership.organization_id = target_organization_id
    and membership.role = 'sales'
    and public.get_org_role(target_organization_id) in ('owner', 'manager')
  order by membership.created_at, membership.user_id
$$;

revoke all on function public.get_workflow_sales_members(uuid) from public, anon;
grant execute on function public.get_workflow_sales_members(uuid) to authenticated;

create function public.record_task_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
  values (
    new.organization_id, new.lead_id, new.created_by, 'task.created',
    jsonb_build_object('task_id', new.id, 'assigned_to', new.assigned_to, 'due_at', new.due_at)
  );
  return new;
end;
$$;

create trigger tasks_record_creation
  after insert on public.tasks
  for each row execute function public.record_task_creation();

create function public.rearm_workflow_task_after_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  follow_up_minutes integer;
begin
  if old.assigned_to is not distinct from new.assigned_to then
    return new;
  end if;

  select coalesce((rule.configuration->>'due_in_minutes')::integer, 60)
  into follow_up_minutes
  from public.automation_rules as rule
  where rule.organization_id = new.organization_id
    and rule.rule_key = 'lead.required_follow_up'
    and rule.enabled;
  follow_up_minutes := coalesce(follow_up_minutes, 60);

  update public.tasks
  set assigned_to = new.assigned_to,
      due_at = public.add_working_minutes(new.organization_id, now(), follow_up_minutes),
      last_activity_at = now(),
      reminded_at = null,
      escalated_at = null,
      escalated_to = null
  where organization_id = new.organization_id
    and lead_id = new.id
    and completed_at is null;

  return new;
end;
$$;

create trigger leads_rearm_workflow_task_after_assignment
  after update of assigned_to on public.leads
  for each row execute function public.rearm_workflow_task_after_assignment();