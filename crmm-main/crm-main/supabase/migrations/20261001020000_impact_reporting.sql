create table public.organization_impact_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  average_deal_value numeric(14, 2) not null check (average_deal_value > 0),
  close_rate_percent numeric(5, 2) not null check (close_rate_percent between 0 and 100),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.organization_impact_baselines (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  captured_at timestamptz not null,
  lead_count integer not null,
  first_response_count integer not null,
  average_first_response_minutes numeric(12, 1),
  eligible_over_24h_count integer not null,
  untouched_over_24h_count integer not null,
  untouched_over_24h_percent numeric(5, 2)
);

create table public.organization_impact_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  report_data jsonb not null,
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (organization_id, period_start)
);

create index organization_impact_reports_pending_idx
  on public.organization_impact_reports (status, last_attempt_at)
  where status in ('pending', 'failed', 'sending');

alter table public.organization_impact_settings enable row level security;
alter table public.organization_impact_baselines enable row level security;
alter table public.organization_impact_reports enable row level security;
grant all on public.organization_impact_settings, public.organization_impact_baselines,
  public.organization_impact_reports to service_role;

create function public.impact_period_stats(
  target_organization_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  evaluated_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cohort as (
    select lead.id, lead.created_at
    from public.leads as lead
    where lead.organization_id = target_organization_id
      and lead.created_at >= period_start
      and lead.created_at < period_end
  ), responses as (
    select
      lead.id,
      lead.created_at,
      (
        select min(event.created_at)
        from public.lead_events as event
        where event.organization_id = target_organization_id
          and event.lead_id = lead.id
          and event.created_at <= evaluated_at
          and (
            event.event_type = 'lead.first_response'
            or (event.event_type = 'lead.updated' and event.payload->>'status' in ('contacted', 'qualified', 'won'))
          )
      ) as first_response_at
    from cohort as lead
  ), eligible as (
    select * from responses where created_at + interval '24 hours' <= evaluated_at
  )
  select jsonb_build_object(
    'lead_count', (select count(*)::integer from responses),
    'first_response_count', (select count(*)::integer from responses where first_response_at is not null),
    'average_first_response_minutes', (
      select round(avg(extract(epoch from (first_response_at - created_at)) / 60.0)::numeric, 1)
      from responses where first_response_at is not null
    ),
    'eligible_over_24h_count', (select count(*)::integer from eligible),
    'untouched_over_24h_count', (
      select count(*)::integer from eligible
      where first_response_at is null or first_response_at > created_at + interval '24 hours'
    ),
    'untouched_over_24h_percent', (
      select round(
        100.0 * count(*) filter (where first_response_at is null or first_response_at > created_at + interval '24 hours')
        / nullif(count(*), 0), 1
      ) from eligible
    )
  )
$$;

create function public.impact_rescue_totals(
  target_organization_id uuid,
  period_start timestamptz,
  period_end timestamptz,
  evaluated_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with first_responses as (
    select
      lead.id,
      (
        select min(event.created_at)
        from public.lead_events as event
        where event.organization_id = target_organization_id
          and event.lead_id = lead.id
          and event.created_at <= evaluated_at
          and (
            event.event_type = 'lead.first_response'
            or (event.event_type = 'lead.updated' and event.payload->>'status' in ('contacted', 'qualified', 'won'))
          )
      ) as first_response_at
    from public.leads as lead
    where lead.organization_id = target_organization_id
  ), attributed as (
    select lead.id, cause.event_type
    from first_responses as lead
    join lateral (
      select event.event_type
      from public.lead_events as event
      where event.organization_id = target_organization_id
        and event.lead_id = lead.id
        and event.event_type in ('task.reminder_sent', 'task.escalated')
        and event.created_at < lead.first_response_at
      order by event.created_at desc, event.id desc
      limit 1
    ) as cause on true
    where lead.first_response_at >= period_start
      and lead.first_response_at < period_end
  )
  select jsonb_build_object(
    'reminder', (count(*) filter (where event_type = 'task.reminder_sent'))::integer,
    'escalation', (count(*) filter (where event_type = 'task.escalated'))::integer,
    'total', count(*)::integer
  )
  from attributed
$$;

revoke all on function public.impact_period_stats(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.impact_rescue_totals(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

create function public.capture_organization_impact_baselines(run_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization record;
  period_end timestamptz;
  stats jsonb;
  captured_count integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  for organization in
    select item.id, item.created_at
    from public.organizations as item
    where item.created_at + interval '8 days' <= run_at
      and not exists (
        select 1 from public.organization_impact_baselines as baseline
        where baseline.organization_id = item.id
      )
  loop
    period_end := organization.created_at + interval '7 days';
    stats := public.impact_period_stats(organization.id, organization.created_at, period_end, run_at);
    insert into public.organization_impact_baselines (
      organization_id, period_start, period_end, captured_at, lead_count,
      first_response_count, average_first_response_minutes,
      eligible_over_24h_count, untouched_over_24h_count, untouched_over_24h_percent
    ) values (
      organization.id, organization.created_at, period_end, run_at,
      (stats->>'lead_count')::integer,
      (stats->>'first_response_count')::integer,
      nullif(stats->>'average_first_response_minutes', '')::numeric,
      (stats->>'eligible_over_24h_count')::integer,
      (stats->>'untouched_over_24h_count')::integer,
      nullif(stats->>'untouched_over_24h_percent', '')::numeric
    ) on conflict (organization_id) do nothing;
    captured_count := captured_count + 1;
  end loop;
  return captured_count;
end;
$$;

revoke all on function public.capture_organization_impact_baselines(timestamptz) from public, anon, authenticated;
grant execute on function public.capture_organization_impact_baselines(timestamptz) to service_role;

create function public.get_impact_assumptions(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(public.get_org_role(target_organization_id) in ('owner', 'manager'), false) is not true then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'average_deal_value', settings.average_deal_value,
    'close_rate_percent', settings.close_rate_percent
  ) into result
  from public.organization_impact_settings as settings
  where settings.organization_id = target_organization_id;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create function public.save_impact_assumptions(
  target_organization_id uuid,
  assumed_average_deal_value numeric,
  assumed_close_rate_percent numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or public.get_org_role(target_organization_id) is distinct from 'owner' then
    raise exception 'Organization owner access required' using errcode = '42501';
  end if;
  if assumed_average_deal_value <= 0 or assumed_average_deal_value > 1000000000
    or assumed_close_rate_percent < 0 or assumed_close_rate_percent > 100
  then
    raise exception 'Impact assumptions are outside supported range' using errcode = '22023';
  end if;
  insert into public.organization_impact_settings (
    organization_id, average_deal_value, close_rate_percent, updated_by
  ) values (
    target_organization_id, assumed_average_deal_value, assumed_close_rate_percent, actor_id
  ) on conflict (organization_id) do update
    set average_deal_value = excluded.average_deal_value,
        close_rate_percent = excluded.close_rate_percent,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.get_impact_assumptions(uuid) from public, anon;
grant execute on function public.get_impact_assumptions(uuid) to authenticated;
revoke all on function public.save_impact_assumptions(uuid, numeric, numeric) from public, anon;
grant execute on function public.save_impact_assumptions(uuid, numeric, numeric) to authenticated;

create function public.get_impact_dashboard_summary(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  organization record;
  baseline public.organization_impact_baselines%rowtype;
  settings public.organization_impact_settings%rowtype;
  recent_stats jsonb;
  month_rescues jsonb;
  latest_report jsonb;
  local_today date;
  recent_start timestamptz;
  recent_end timestamptz;
  month_start timestamptz;
begin
  if coalesce(public.get_org_role(target_organization_id) in ('owner', 'manager'), false) is not true then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;
  select item.id, item.timezone into organization
  from public.organizations as item where item.id = target_organization_id;
  if not found then raise exception 'Organization not found' using errcode = '23503'; end if;

  select * into baseline from public.organization_impact_baselines as item where item.organization_id = target_organization_id;
  select * into settings from public.organization_impact_settings as item where item.organization_id = target_organization_id;
  local_today := (now() at time zone organization.timezone)::date;
  recent_end := local_today::timestamp at time zone organization.timezone;
  recent_start := (local_today - 7)::timestamp at time zone organization.timezone;
  month_start := date_trunc('month', now() at time zone organization.timezone) at time zone organization.timezone;
  recent_stats := public.impact_period_stats(target_organization_id, recent_start, recent_end, now());
  month_rescues := public.impact_rescue_totals(target_organization_id, month_start, now(), now());

  select report.report_data into latest_report
  from public.organization_impact_reports as report
  where report.organization_id = target_organization_id
  order by report.period_end desc limit 1;

  return jsonb_build_object(
    'baseline_ready', baseline.organization_id is not null,
    'baseline', case when baseline.organization_id is null then null else jsonb_build_object(
      'period_start', baseline.period_start,
      'period_end', baseline.period_end,
      'captured_at', baseline.captured_at,
      'lead_count', baseline.lead_count,
      'average_first_response_minutes', baseline.average_first_response_minutes,
      'untouched_over_24h_percent', baseline.untouched_over_24h_percent
    ) end,
    'recent', recent_stats,
    'monthly_saved_leads', (month_rescues->>'total')::integer,
    'monthly_saved_by_reminder', (month_rescues->>'reminder')::integer,
    'monthly_saved_by_escalation', (month_rescues->>'escalation')::integer,
    'average_deal_value', settings.average_deal_value,
    'close_rate_percent', settings.close_rate_percent,
    'estimated_revenue_protected', case when settings.organization_id is null then null
      else round((month_rescues->>'total')::numeric * settings.average_deal_value * settings.close_rate_percent / 100, 2) end,
    'latest_report', latest_report
  );
end;
$$;

revoke all on function public.get_impact_dashboard_summary(uuid) from public, anon;
grant execute on function public.get_impact_dashboard_summary(uuid) to authenticated;