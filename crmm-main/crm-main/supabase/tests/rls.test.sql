create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(46);

select extensions.is(public.normalize_lead_phone('٠١٠١٢٣٤٥٦٧٨', 'Africa/Cairo'), '+201012345678', 'normalizes Arabic-Indic Egyptian mobile numbers');
select extensions.is(public.normalize_lead_phone('٠٥٠١٢٣٤٥٦٧', 'Asia/Riyadh'), '+966501234567', 'normalizes Arabic-Indic Saudi mobile numbers');

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner-eg@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'manager-eg@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'sales-eg-1@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'sales-eg-2@example.test'),
  ('20000000-0000-4000-8000-000000000001', 'owner-sa@example.test');

insert into public.organizations (id, name, slug, created_by) values
  ('30000000-0000-4000-8000-000000000001', 'Egypt Test Org', 'egypt-test-org', '10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'Saudi Test Org', 'saudi-test-org', '20000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'manager'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'sales'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'sales'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'owner');

insert into public.pipeline_stages (id, organization_id, name, name_ar, position, is_default) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'New', 'جديد', 0, true),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'New', 'جديد', 0, true);

insert into public.leads (id, organization_id, full_name, phone, stage_id, assigned_to, created_by) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Assigned lead', '+201000000001', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Other salesperson lead', '+201000000002', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'Other organization lead', '+966500000001', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');

insert into public.lead_events (organization_id, lead_id, actor_id, event_type) values
  ('30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'lead.created'),
  ('30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'lead.created'),
  ('30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'lead.created');

insert into public.tasks (organization_id, lead_id, title, title_ar, assigned_to, created_by, due_at) values
  ('30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'Follow up', 'متابعة', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', now() + interval '1 hour'),
  ('30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 'Follow up', 'متابعة', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', now() + interval '1 hour'),
  ('30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', 'Follow up', 'متابعة', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', now() + interval '1 hour');

insert into public.notifications (organization_id, recipient_id, task_id, kind, title, title_ar) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', (select id from public.tasks where organization_id = '30000000-0000-4000-8000-000000000001' and assigned_to = '10000000-0000-4000-8000-000000000003'), 'task_due', 'Follow-up is due', 'حان موعد المتابعة'),
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', (select id from public.tasks where organization_id = '30000000-0000-4000-8000-000000000001' and assigned_to = '10000000-0000-4000-8000-000000000004'), 'task_due', 'Follow-up is due', 'حان موعد المتابعة'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', (select id from public.tasks where organization_id = '30000000-0000-4000-8000-000000000002'), 'task_due', 'Follow-up is due', 'حان موعد المتابعة');

insert into public.automation_rules (organization_id, rule_key) values
  ('30000000-0000-4000-8000-000000000001', 'test.rule'),
  ('30000000-0000-4000-8000-000000000002', 'test.rule');

insert into public.automation_rules (organization_id, rule_key, configuration) values
  ('30000000-0000-4000-8000-000000000001', 'lead.required_follow_up', '{"due_in_minutes":60}'::jsonb),
  ('30000000-0000-4000-8000-000000000001', 'task.escalate_overdue', '{"after_minutes":15}'::jsonb);

insert into public.subscriptions (organization_id, plan, status) values
  ('30000000-0000-4000-8000-000000000001', 'trial', 'trialing'),
  ('30000000-0000-4000-8000-000000000002', 'trial', 'trialing');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select extensions.is((select count(*)::integer from public.leads), 1, 'sales sees only assigned leads');
select extensions.is((select count(*)::integer from public.leads where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization leads');
select extensions.is((select count(*)::integer from public.organizations where id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization');
select extensions.is((select count(*)::integer from public.memberships where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization memberships');
select extensions.is((select count(*)::integer from public.pipeline_stages where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization pipeline');
select extensions.is((select count(*)::integer from public.lead_events where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization audit trail');
select extensions.is((select count(*)::integer from public.tasks where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization tasks');
select extensions.is((select count(*)::integer from public.automation_rules where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization automation');
select extensions.is((select count(*)::integer from public.subscriptions where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization subscription');
select extensions.is((select count(*)::integer from public.lead_events), 2, 'sales sees audit trail only for assigned leads');
select extensions.is((select count(*)::integer from public.tasks), 1, 'sales sees only assigned tasks');
select extensions.is((select count(*)::integer from public.notifications), 1, 'sales sees their own task reminder');
select extensions.is((select count(*)::integer from public.notifications where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'sales cannot read another organization notifications');
update public.leads
set full_name = 'Unauthorized change'
where id = '50000000-0000-4000-8000-000000000002';
select extensions.is((select count(*)::integer from public.leads where id = '50000000-0000-4000-8000-000000000002'), 0, 'sales cannot update another salesperson lead');
select extensions.throws_ok(
  $$insert into public.leads (organization_id, full_name, phone, stage_id, assigned_to, created_by) values ('30000000-0000-4000-8000-000000000002', 'Cross tenant', '+966500000099', '40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'authenticated clients cannot bypass the create-lead RPC'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select extensions.is((select count(*)::integer from public.leads), 2, 'manager sees every lead in their organization');
select extensions.is((select count(*)::integer from public.leads where organization_id = '30000000-0000-4000-8000-000000000002'), 0, 'manager cannot read another organization leads');
select extensions.is((select count(*)::integer from public.notifications), 2, 'manager sees organization reminders for escalation oversight');
select set_config(
  'test.created_lead_id',
  public.create_lead('30000000-0000-4000-8000-000000000001', 'RPC lead', '+201000000003')->>'id',
  true
);
select extensions.is((select assigned_to from public.leads where id = current_setting('test.created_lead_id')::uuid), '10000000-0000-4000-8000-000000000003'::uuid, 'manager auto-assigns to the least-loaded salesperson');
select extensions.is((select count(*)::integer from public.tasks where lead_id = current_setting('test.created_lead_id')::uuid and is_mandatory), 1, 'new lead receives one mandatory follow-up task');
select extensions.ok((select due_at between now() + interval '59 minutes' and now() + interval '61 minutes' from public.tasks where lead_id = current_setting('test.created_lead_id')::uuid), 'required follow-up is due in the configured hour');
select extensions.is((select count(*)::integer from public.lead_events where lead_id = current_setting('test.created_lead_id')::uuid and event_type = 'lead.created'), 1, 'lead creation writes its audit event');
select extensions.is((public.create_lead('30000000-0000-4000-8000-000000000001', 'Duplicate lead', '01000000003')->>'id'), current_setting('test.created_lead_id'), 'local and international phone formats resolve to the same lead');
select extensions.is((public.create_lead('30000000-0000-4000-8000-000000000001', 'Duplicate lead', '01000000003')->>'duplicate')::boolean, true, 'duplicate creation is reported without inserting a second lead');
select extensions.is((select count(*)::integer from public.lead_events where lead_id = current_setting('test.created_lead_id')::uuid and event_type = 'lead.duplicate_detected'), 2, 'each duplicate attempt is recorded in the audit trail');

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::integer from public.leads), 1, 'second organization owner sees their own organization leads');
select extensions.is((select count(*)::integer from public.leads where organization_id = '30000000-0000-4000-8000-000000000001'), 0, 'second organization owner cannot read first organization leads');
select extensions.is((select count(*)::integer from public.subscriptions), 1, 'second organization owner sees only their own subscription');
select extensions.is((select count(*)::integer from public.notifications), 1, 'second organization owner sees only their own notifications');
select extensions.is((select count(*)::integer from public.notifications where organization_id = '30000000-0000-4000-8000-000000000001'), 0, 'second organization owner cannot read first organization notifications');
select extensions.throws_ok(
  $$select public.rotate_organization_webhook_secret('30000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'member from another organization cannot rotate a webhook secret'
);
select extensions.throws_ok(
  $$select public.import_leads('30000000-0000-4000-8000-000000000001', '[]'::jsonb)$$,
  '42501', null, 'member from another organization cannot import leads'
);

reset role;
update public.tasks
set due_at = now() - interval '20 minutes'
where lead_id = current_setting('test.created_lead_id')::uuid;
select extensions.is(public.process_due_tasks(), 2, 'due-task worker sends a reminder and escalates after the configured delay');
select extensions.is((select count(*)::integer from public.tasks where lead_id = current_setting('test.created_lead_id')::uuid and escalated_at is not null), 1, 'overdue follow-up is marked escalated');
select extensions.is((select count(*)::integer from public.notifications where task_id = (select id from public.tasks where lead_id = current_setting('test.created_lead_id')::uuid)), 2, 'worker notifies the salesperson and manager');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config('test.webhook_secret', public.rotate_organization_webhook_secret('30000000-0000-4000-8000-000000000001'), true);

set local role anon;
select set_config(
  'test.webhook_result',
  public.ingest_webhook_lead(
    '30000000-0000-4000-8000-000000000001',
    current_setting('test.webhook_secret'),
    'Webhook lead',
    '+201012345678'
  )::text,
  true
);
reset role;
select extensions.is((current_setting('test.webhook_result')::jsonb->>'duplicate'), 'false', 'valid webhook secret creates a new lead');
select extensions.is((select count(*)::integer from public.lead_events where lead_id = (current_setting('test.webhook_result')::jsonb->>'id')::uuid and event_type = 'lead.created' and payload->>'intake_channel' = 'webhook'), 1, 'webhook-created leads record their intake channel');
set local role anon;
select extensions.is((public.ingest_webhook_lead('30000000-0000-4000-8000-000000000001', current_setting('test.webhook_secret'), 'Webhook duplicate', '01012345678')->>'duplicate'), 'true', 'webhook duplicate is detected across phone formats');
select extensions.throws_ok(
  $$select public.ingest_webhook_lead('30000000-0000-4000-8000-000000000001', 'invalid', 'Rejected', '+201099999999')$$,
  '28000', null, 'invalid webhook secret is rejected'
);
select extensions.is((select count(*)::integer from public.organization_webhook_secrets), 0, 'anonymous users cannot read webhook secret hashes');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select set_config(
  'test.import_summary',
  public.import_leads(
    '30000000-0000-4000-8000-000000000001',
    '[{"full_name":"CSV lead","phone":"+201000000004"},{"full_name":"CSV duplicate","phone":"01000000004"},{"full_name":"Invalid","phone":"not a phone"}]'::jsonb
  )::text,
  true
);
select extensions.is((current_setting('test.import_summary')::jsonb->>'created')::integer, 1, 'CSV import creates valid rows');
select extensions.is((current_setting('test.import_summary')::jsonb->>'duplicates')::integer, 1, 'CSV import reports normalized duplicate rows');
select extensions.is((current_setting('test.import_summary')::jsonb->>'failed')::integer, 1, 'CSV import reports invalid rows without aborting the batch');
select extensions.is((select count(*)::integer from public.lead_events where payload->>'intake_channel' = 'csv' and event_type = 'lead.created'), 1, 'CSV-created leads record their intake channel');

select * from extensions.finish();
rollback;