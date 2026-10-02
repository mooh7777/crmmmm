create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(22);

insert into auth.users (id, email) values
  ('12000000-0000-4000-8000-000000000001', 'impact-owner@example.test'),
  ('12000000-0000-4000-8000-000000000002', 'impact-sales@example.test');

insert into public.organizations (id, name, slug, timezone, currency, language, created_by, created_at) values
  ('32000000-0000-4000-8000-000000000001', 'Impact Sample', 'impact-sample', 'Africa/Cairo', 'EGP', 'en', '12000000-0000-4000-8000-000000000001', '2026-09-14 09:00:00+03');

insert into public.memberships (organization_id, user_id, role) values
  ('32000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'owner'),
  ('32000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'sales');

insert into public.pipeline_stages (id, organization_id, name, name_ar, position, is_default) values
  ('42000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'New', 'جديد', 0, true);

insert into public.leads (id, organization_id, full_name, phone, status, stage_id, assigned_to, created_by, created_at) values
  ('52000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', 'Responded in baseline', '+201012345611', 'contacted', '42000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '2026-09-15 09:00:00+03'),
  ('52000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', 'Untouched in baseline', '+201012345612', 'new', '42000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '2026-09-16 09:00:00+03'),
  ('52000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000001', 'Reminder rescued', '+201012345613', 'contacted', '42000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '2026-09-29 10:00:00+03'),
  ('52000000-0000-4000-8000-000000000004', '32000000-0000-4000-8000-000000000001', 'Escalation rescued', '+201012345614', 'contacted', '42000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000001', '2026-09-29 11:00:00+03');

insert into public.lead_events (organization_id, lead_id, actor_id, event_type, created_at) values
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000002', 'lead.first_response', '2026-09-15 09:30:00+03'),
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000003', null, 'task.reminder_sent', '2026-09-30 10:00:00+03'),
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000002', 'lead.first_response', '2026-10-01 10:30:00+03'),
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000004', null, 'task.reminder_sent', '2026-09-30 11:00:00+03'),
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000004', null, 'task.escalated', '2026-10-01 09:00:00+03'),
  ('32000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000002', 'lead.first_response', '2026-10-01 09:30:00+03');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'test.baseline_capture_count',
  public.capture_organization_impact_baselines('2026-09-23 10:00:00+03')::text,
  true
);
reset role;

select extensions.is(current_setting('test.baseline_capture_count')::integer, 1, 'baseline captures automatically after the first-week cohort matures');
select extensions.is((select period_start::date from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), '2026-09-14'::date, 'baseline begins at organization creation');
select extensions.is((select period_end::date from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), '2026-09-21'::date, 'baseline covers the first seven days');
select extensions.is((select lead_count from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 2, 'baseline counts leads created during its first-week window');
select extensions.is((select first_response_count from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 1, 'baseline counts leads with a first response');
select extensions.is((select average_first_response_minutes from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 30.0::numeric, 'baseline reports a 30-minute average first response');
select extensions.is((select eligible_over_24h_count from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 2, 'baseline denominator includes leads with a full 24-hour window');
select extensions.is((select untouched_over_24h_count from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 1, 'baseline counts one untouched lead');
select extensions.is((select untouched_over_24h_percent from public.organization_impact_baselines where organization_id = '32000000-0000-4000-8000-000000000001'), 50.0::numeric, 'baseline calculates 50 percent untouched over 24 hours');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select public.save_impact_assumptions('32000000-0000-4000-8000-000000000001', 100000, 5);
select extensions.is(
  (public.get_impact_assumptions('32000000-0000-4000-8000-000000000001')->>'average_deal_value')::numeric,
  100000::numeric, 'owner assumptions persist the average deal value'
);
select extensions.is(
  (public.get_impact_assumptions('32000000-0000-4000-8000-000000000001')->>'close_rate_percent')::numeric,
  5::numeric, 'owner assumptions persist the close rate'
);
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'test.impact_snapshot',
  public.build_impact_report_snapshot(
    '32000000-0000-4000-8000-000000000001', '2026-09-28', '2026-10-05', '2026-10-06 10:00:00+03'
  )::text,
  true
);
reset role;
select extensions.is((current_setting('test.impact_snapshot')::jsonb->>'rescued_by_reminder')::integer, 1, 'report attributes a first response after a reminder');
select extensions.is((current_setting('test.impact_snapshot')::jsonb->>'rescued_by_escalation')::integer, 1, 'report attributes a first response after escalation');
select extensions.is((current_setting('test.impact_snapshot')::jsonb->>'leads_saved')::integer, 2, 'report counts each rescued lead once');
select extensions.is((current_setting('test.impact_snapshot')::jsonb->>'estimated_revenue_protected')::numeric, 10000::numeric, 'report estimates protected revenue from saved leads and owner assumptions');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config(
  'test.impact_summary',
  public.get_impact_dashboard_summary('32000000-0000-4000-8000-000000000001')::text,
  true
);
select extensions.ok((current_setting('test.impact_summary')::jsonb->>'baseline_ready')::boolean, 'dashboard summary exposes the captured baseline');
select extensions.is((current_setting('test.impact_summary')::jsonb->>'monthly_saved_leads')::integer, 2, 'dashboard headline reports two leads saved this month');
select extensions.is((current_setting('test.impact_summary')::jsonb->>'estimated_revenue_protected')::numeric, 10000::numeric, 'dashboard uses the same transparent revenue estimate as the report');
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config(
  'test.impact_claim',
  (select count(*)::text from public.claim_impact_reports('2026-10-06 10:00:00+03')),
  true
);
select extensions.is(current_setting('test.impact_claim')::integer, 1, 'weekly worker claims one forwardable report after the reporting week closes');
select extensions.is((select status from public.organization_impact_reports where organization_id = '32000000-0000-4000-8000-000000000001'), 'sending', 'claimed report is protected from concurrent duplicate delivery');
select extensions.is(
  (select count(*)::integer from public.claim_impact_reports('2026-10-06 10:00:00+03')),
  0, 'repeated worker invocation cannot claim the same weekly report twice'
);
select extensions.is(public.capture_organization_impact_baselines('2026-09-24 10:00:00+03'), 0, 'baseline capture is idempotent');
reset role;

select * from extensions.finish();
rollback;