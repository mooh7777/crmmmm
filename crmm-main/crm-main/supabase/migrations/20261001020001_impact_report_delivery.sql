create function public.build_impact_report_snapshot(
  target_organization_id uuid,
  period_start date,
  period_end date,
  evaluated_at timestamptz
)
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
  after_stats jsonb;
  rescued jsonb;
begin
  select item.id, item.timezone, item.currency into organization
  from public.organizations as item where item.id = target_organization_id;
  select * into baseline from public.organization_impact_baselines as item where item.organization_id = target_organization_id;
  select * into settings from public.organization_impact_settings as item where item.organization_id = target_organization_id;

  after_stats := public.impact_period_stats(
    target_organization_id,
    period_start::timestamp at time zone organization.timezone,
    period_end::timestamp at time zone organization.timezone,
    evaluated_at
  );
  rescued := public.impact_rescue_totals(
    target_organization_id,
    period_start::timestamp at time zone organization.timezone,
    period_end::timestamp at time zone organization.timezone,
    evaluated_at
  );

  return jsonb_build_object(
    'period_start', period_start,
    'period_end', period_end,
    'currency', organization.currency,
    'baseline', jsonb_build_object(
      'period_start', baseline.period_start,
      'period_end', baseline.period_end,
      'lead_count', baseline.lead_count,
      'average_first_response_minutes', baseline.average_first_response_minutes,
      'eligible_over_24h_count', baseline.eligible_over_24h_count,
      'untouched_over_24h_count', baseline.untouched_over_24h_count,
      'untouched_over_24h_percent', baseline.untouched_over_24h_percent
    ),
    'after', after_stats,
    'rescued_by_reminder', (rescued->>'reminder')::integer,
    'rescued_by_escalation', (rescued->>'escalation')::integer,
    'leads_saved', (rescued->>'total')::integer,
    'average_deal_value', settings.average_deal_value,
    'close_rate_percent', settings.close_rate_percent,
    'estimated_revenue_protected', round((rescued->>'total')::numeric * settings.average_deal_value * settings.close_rate_percent / 100, 2)
  );
end;
$$;

create function public.claim_impact_reports(run_at timestamptz default now())
returns table(
  report_id uuid,
  organization_id uuid,
  organization_name text,
  organization_language text,
  organization_currency text,
  period_start date,
  period_end date,
  report_data jsonb,
  recipient_email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization record;
  week_end date;
  week_start date;
  recipient text;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  perform public.capture_organization_impact_baselines(run_at);

  for organization in
    select item.id, item.name, item.language, item.timezone, item.currency
    from public.organizations as item
    join public.organization_impact_baselines as baseline on baseline.organization_id = item.id
    join public.organization_impact_settings as settings on settings.organization_id = item.id
  loop
    recipient := null;
    if (run_at at time zone organization.timezone)::date < date_trunc('week', run_at at time zone organization.timezone)::date + 1
      or (run_at at time zone organization.timezone)::time < time '09:00'
    then
      continue;
    end if;

    week_end := date_trunc('week', run_at at time zone organization.timezone)::date;
    week_start := week_end - 7;

    select auth_user.email into recipient
    from public.organizations as item
    join auth.users as auth_user on auth_user.id = item.created_by
    where item.id = organization.id and auth_user.email is not null;
    if recipient is null then
      select auth_user.email into recipient
      from public.memberships as membership
      join auth.users as auth_user on auth_user.id = membership.user_id
      where membership.organization_id = organization.id
        and membership.role = 'owner'
        and auth_user.email is not null
      order by membership.created_at
      limit 1;
    end if;
    if recipient is null then continue; end if;

    insert into public.organization_impact_reports (
      organization_id, period_start, period_end, report_data, recipient_email
    ) values (
      organization.id, week_start, week_end,
      public.build_impact_report_snapshot(organization.id, week_start, week_end, run_at), recipient
    ) on conflict (organization_id, period_start) do nothing;
  end loop;

  return query
  with candidates as (
    select report.id
    from public.organization_impact_reports as report
    where report.status = 'pending'
      or (report.status = 'failed' and report.last_attempt_at < run_at - interval '1 hour')
      or (report.status = 'sending' and report.last_attempt_at < run_at - interval '20 minutes')
    order by report.created_at
    limit 10
    for update skip locked
  ), claimed as (
    update public.organization_impact_reports as report
    set status = 'sending',
        attempts = report.attempts + 1,
        last_attempt_at = run_at,
        last_error = null
    from candidates
    where report.id = candidates.id
    returning report.*
  )
  select
    claimed.id,
    item.id,
    item.name,
    item.language,
    item.currency,
    claimed.period_start,
    claimed.period_end,
    claimed.report_data,
    claimed.recipient_email
  from claimed
  join public.organizations as item on item.id = claimed.organization_id;
end;
$$;

revoke all on function public.build_impact_report_snapshot(uuid, date, date, timestamptz) from public, anon, authenticated;
grant execute on function public.build_impact_report_snapshot(uuid, date, date, timestamptz) to service_role;

create function public.mark_impact_report_sent(target_report_id uuid, provider_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.organization_impact_reports
  set status = 'sent', sent_at = now(), provider_message_id = provider_id, last_error = null
  where id = target_report_id and status = 'sending';
end;
$$;

create function public.mark_impact_report_failed(target_report_id uuid, failure_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.organization_impact_reports
  set status = 'failed', last_error = left(failure_reason, 500)
  where id = target_report_id and status = 'sending';
end;
$$;

revoke all on function public.claim_impact_reports(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_impact_reports(timestamptz) to service_role;
revoke all on function public.mark_impact_report_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_impact_report_sent(uuid, text) to service_role;
revoke all on function public.mark_impact_report_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_impact_report_failed(uuid, text) to service_role;