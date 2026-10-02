create function public.record_lead_first_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'new' and new.status in ('contacted', 'qualified', 'won') then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      new.organization_id, new.id, (select auth.uid()), 'lead.first_response',
      jsonb_build_object('status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger leads_record_first_response
  after update of status on public.leads
  for each row execute function public.record_lead_first_response();

create function public.get_manager_dashboard_metrics(
  target_organization_id uuid,
  start_date date,
  end_date date,
  target_stage_id uuid default null,
  target_salesperson_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_timezone text;
  metrics jsonb;
begin
  if coalesce(public.get_org_role(target_organization_id) in ('owner', 'manager'), false) is not true then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;
  if start_date is null or end_date is null or start_date > end_date or end_date - start_date > 90 then
    raise exception 'Dashboard date range is invalid' using errcode = '22023';
  end if;

  select organization.timezone into organization_timezone
  from public.organizations as organization
  where organization.id = target_organization_id;
  if organization_timezone is null then
    raise exception 'Organization not found' using errcode = '23503';
  end if;

  with base_leads as (
    select
      lead.id,
      lead.full_name,
      lead.status,
      lead.stage_id,
      lead.assigned_to,
      lead.created_at,
      (lead.created_at at time zone organization_timezone)::date as cohort_date
    from public.leads as lead
    where lead.organization_id = target_organization_id
      and (lead.created_at at time zone organization_timezone)::date between start_date and end_date
      and (target_salesperson_id is null or lead.assigned_to = target_salesperson_id)
  ), filtered_leads as (
    select * from base_leads
    where target_stage_id is null or stage_id = target_stage_id
  ), first_responses as (
    select
      lead.id,
      lead.cohort_date,
      greatest(0, extract(epoch from (response.first_response_at - lead.created_at)) / 60.0) as response_minutes
    from filtered_leads as lead
    join lateral (
      select min(event.created_at) as first_response_at
      from public.lead_events as event
      where event.organization_id = target_organization_id
        and event.lead_id = lead.id
        and (
          event.event_type = 'lead.first_response'
          or (event.event_type = 'lead.updated' and event.payload->>'status' in ('contacted', 'qualified', 'won'))
        )
    ) as response on response.first_response_at is not null
  ), untouched as (
    select
      lead.id,
      lead.full_name,
      lead.assigned_to,
      auth_user.email as salesperson_email,
      min(task.due_at) as due_at
    from filtered_leads as lead
    join public.tasks as task
      on task.organization_id = target_organization_id
      and task.lead_id = lead.id
    left join auth.users as auth_user on auth_user.id = lead.assigned_to
    where task.completed_at is null
      and task.due_at < now()
      and task.last_activity_at <= task.due_at
      and lead.status = 'new'
    group by lead.id, lead.full_name, lead.assigned_to, auth_user.email
  ), overdue_by_salesperson as (
    select
      membership.user_id,
      coalesce(auth_user.email, membership.user_id::text) as email,
      count(task.id)::integer as task_count
    from public.memberships as membership
    left join auth.users as auth_user on auth_user.id = membership.user_id
    left join public.tasks as task
      on task.organization_id = membership.organization_id
      and task.assigned_to = membership.user_id
      and task.completed_at is null
      and task.due_at < now()
    left join filtered_leads as lead on lead.id = task.lead_id
    where membership.organization_id = target_organization_id
      and membership.role = 'sales'
      and (target_salesperson_id is null or membership.user_id = target_salesperson_id)
      and (task.id is null or lead.id is not null)
    group by membership.user_id, auth_user.email
  ), funnel as (
    select
      stage.id,
      stage.name,
      stage.name_ar,
      stage.position,
      count(lead.id)::integer as lead_count
    from public.pipeline_stages as stage
    left join filtered_leads as lead on lead.stage_id = stage.id
    where stage.organization_id = target_organization_id
    group by stage.id, stage.name, stage.name_ar, stage.position
  )
  select jsonb_build_object(
    'average_first_response_minutes', (
      select round(avg(response_minutes)::numeric, 1) from first_responses
    ),
    'response_trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(daily.response_date, 'YYYY-MM-DD'),
        'average_minutes', daily.average_minutes,
        'responses', daily.responses
      ) order by daily.response_date)
      from (
        select
          day.bucket::date as response_date,
          round(avg(response.response_minutes)::numeric, 1) as average_minutes,
          count(response.id)::integer as responses
        from generate_series(start_date::timestamp, end_date::timestamp, interval '1 day') as day(bucket)
        left join first_responses as response on response.cohort_date = day.bucket::date
        group by day.bucket::date
      ) as daily
    ), '[]'::jsonb),
    'untouched_past_sla', jsonb_build_object(
      'count', (select count(*)::integer from untouched),
      'leads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id,
          'full_name', item.full_name,
          'salesperson_email', item.salesperson_email,
          'due_at', item.due_at
        ) order by item.due_at)
        from (select * from untouched order by due_at limit 20) as item
      ), '[]'::jsonb)
    ),
    'overdue_tasks_by_salesperson', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', person.user_id,
        'email', person.email,
        'task_count', person.task_count
      ) order by person.task_count desc, person.email)
      from overdue_by_salesperson as person
    ), '[]'::jsonb),
    'funnel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_id', stage.id,
        'name', stage.name,
        'name_ar', stage.name_ar,
        'lead_count', stage.lead_count
      ) order by stage.position)
      from funnel as stage
    ), '[]'::jsonb)
  ) into metrics;

  return metrics;
end;
$$;

revoke all on function public.get_manager_dashboard_metrics(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.get_manager_dashboard_metrics(uuid, date, date, uuid, uuid) to authenticated;