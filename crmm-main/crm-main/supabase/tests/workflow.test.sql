create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(34);

insert into auth.users (id, email) values
  ('11000000-0000-4000-8000-000000000001', 'workflow-owner@example.test'),
  ('11000000-0000-4000-8000-000000000002', 'workflow-manager@example.test'),
  ('11000000-0000-4000-8000-000000000003', 'workflow-sales-1@example.test'),
  ('11000000-0000-4000-8000-000000000004', 'workflow-sales-2@example.test');

insert into public.organizations (id, name, slug, created_by) values
  ('31000000-0000-4000-8000-000000000001', 'Workflow Test', 'workflow-test', '11000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role) values
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'owner'),
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002', 'manager'),
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000003', 'sales'),
  ('31000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000004', 'sales');

insert into public.pipeline_stages (id, organization_id, name, name_ar, position, is_default) values
  ('41000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'New', 'جديد', 0, true);

insert into public.automation_rules (organization_id, rule_key, configuration) values
  ('31000000-0000-4000-8000-000000000001', 'lead.auto_assign', '{"strategy":"round_robin","respect_working_hours":true}'::jsonb),
  ('31000000-0000-4000-8000-000000000001', 'lead.required_follow_up', '{"due_in_minutes":45}'::jsonb),
  ('31000000-0000-4000-8000-000000000001', 'task.escalate_overdue', '{"after_minutes":15}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select public.save_workflow_settings(
  '31000000-0000-4000-8000-000000000001', 'Workflow Test', 'Africa/Cairo', 'EGP', 'en',
  array[5, 6]::smallint[], '{"start":"09:00","end":"18:00"}'::jsonb,
  45, 15, true,
  array['11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004']::uuid[]
);
select extensions.is(
  (select count(*)::integer from public.lead_events where organization_id = '31000000-0000-4000-8000-000000000001' and event_type = 'workflow.settings_updated' and lead_id is null),
  1, 'workflow settings are audited without requiring a lead'
);
select extensions.is(
  (select (configuration->>'due_in_minutes')::integer from public.automation_rules where organization_id = '31000000-0000-4000-8000-000000000001' and rule_key = 'lead.required_follow_up'),
  45, 'manager settings persist the follow-up interval'
);
select extensions.is(
  (select configuration->>'strategy' from public.automation_rules where organization_id = '31000000-0000-4000-8000-000000000001' and rule_key = 'lead.auto_assign'),
  'round_robin', 'assignment settings persist round-robin strategy'
);
select set_config(
  'test.manager_metrics',
  public.get_manager_dashboard_metrics('31000000-0000-4000-8000-000000000001', '2026-09-30', '2026-10-01')::text,
  true
);
select extensions.is(
  jsonb_array_length(current_setting('test.manager_metrics')::jsonb->'response_trend'),
  2, 'manager dashboard returns one response-trend point per filtered date'
);
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.get_manager_dashboard_metrics('31000000-0000-4000-8000-000000000001', '2026-09-30', '2026-10-01')$$,
  '42501', null, 'sales members cannot access manager dashboard metrics'
);
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);

select public.save_workflow_settings(
  '31000000-0000-4000-8000-000000000001', 'Workflow Test', 'Africa/Cairo', 'EGP', 'en',
  array[5, 6]::smallint[], '{"start":"09:00","end":"18:00"}'::jsonb,
  45, 15, true, array[]::uuid[]
);
reset role;

select set_config(
  'test.no_sales_lead_id',
  (public.create_lead_record(
    '31000000-0000-4000-8000-000000000001', 'No active sales', '+201012345601', null, null, null,
    null, '11000000-0000-4000-8000-000000000002', 'manual', '2026-09-30 12:00:00+03'
  )->>'id'), true
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.no_sales_lead_id')::uuid),
  'pending', 'lead waits when there are no active sales members'
);
select extensions.is(
  (select assigned_to from public.leads where id = current_setting('test.no_sales_lead_id')::uuid),
  '11000000-0000-4000-8000-000000000002'::uuid, 'unassigned lead remains visible to its manager'
);
select extensions.is(
  (select payload->>'reason' from public.lead_events where lead_id = current_setting('test.no_sales_lead_id')::uuid and event_type = 'lead.assignment_deferred'),
  'no_active_sales', 'no-sales deferral is logged with its reason'
);
update public.leads
set status = 'contacted'
where id = current_setting('test.no_sales_lead_id')::uuid;
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.no_sales_lead_id')::uuid and event_type = 'lead.first_response'),
  1, 'first transition out of New records a response event'
);
select set_config(
  'test.response_metrics',
  public.get_manager_dashboard_metrics('31000000-0000-4000-8000-000000000001', '2026-09-30', '2026-10-01')::text,
  true
);
select extensions.ok(
  (current_setting('test.response_metrics')::jsonb->>'average_first_response_minutes') is not null,
  'manager metrics include the average from first-response events'
);
select extensions.is(
  (select sum((point->>'responses')::integer)::integer from jsonb_array_elements(current_setting('test.response_metrics')::jsonb->'response_trend') as point),
  1, 'daily trend includes the first response in its date bucket'
);
select extensions.is(
  (public.process_workflow_tasks_at('2026-09-30 13:00:00+03'::timestamptz)->>'assigned')::integer,
  0, 'worker does not assign while the active sales roster is empty'
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.no_sales_lead_id')::uuid),
  'pending', 'lead remains pending after a no-sales worker run'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select public.save_workflow_settings(
  '31000000-0000-4000-8000-000000000001', 'Workflow Test', 'Africa/Cairo', 'EGP', 'en',
  array[5, 6]::smallint[], '{"start":"09:00","end":"18:00"}'::jsonb,
  45, 15, true,
  array['11000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000004']::uuid[]
);
reset role;
select extensions.is(
  (public.process_workflow_tasks_at('2026-09-30 14:00:00+03'::timestamptz)->>'assigned')::integer,
  1, 'worker assigns a deferred lead once sales become active'
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.no_sales_lead_id')::uuid),
  'assigned', 'deferred lead transitions to assigned'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.no_sales_lead_id')::uuid and event_type = 'lead.auto_assigned'),
  1, 'deferred assignment is audited once'
);

select set_config(
  'test.outside_hours_lead_id',
  (public.create_lead_record(
    '31000000-0000-4000-8000-000000000001', 'Outside hours', '+201012345602', null, null, null,
    null, '11000000-0000-4000-8000-000000000002', 'manual', '2026-09-30 20:00:00+03'
  )->>'id'), true
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.outside_hours_lead_id')::uuid),
  'pending', 'lead waits for working hours before assignment'
);
select extensions.is(
  (select due_at from public.tasks where lead_id = current_setting('test.outside_hours_lead_id')::uuid),
  public.add_working_minutes('31000000-0000-4000-8000-000000000001', '2026-09-30 20:00:00+03'::timestamptz, 45),
  'follow-up deadline is calculated within working time'
);
select extensions.is(
  (public.process_workflow_tasks_at('2026-09-30 20:30:00+03'::timestamptz)->>'assigned')::integer,
  0, 'worker does not assign outside working hours'
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.outside_hours_lead_id')::uuid),
  'pending', 'outside-hours lead stays pending until business opens'
);
select extensions.is(
  (public.process_workflow_tasks_at('2026-10-01 09:00:00+03'::timestamptz)->>'assigned')::integer,
  1, 'worker assigns the deferred lead during working hours'
);
select extensions.is(
  (select assignment_status from public.leads where id = current_setting('test.outside_hours_lead_id')::uuid),
  'assigned', 'outside-hours lead transitions to assigned'
);

select set_config(
  'test.reassigned_lead_id',
  (public.create_lead_record(
    '31000000-0000-4000-8000-000000000001', 'Reassigned lead', '+201012345603', null, null, null,
    null, '11000000-0000-4000-8000-000000000002', 'manual', '2026-10-01 09:00:00+03'
  )->>'id'), true
);
update public.tasks
set due_at = now() - interval '30 minutes',
    reminded_at = now() - interval '20 minutes',
    escalated_at = now() - interval '5 minutes',
    escalated_to = '11000000-0000-4000-8000-000000000002'
where lead_id = current_setting('test.reassigned_lead_id')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000002', true);
select public.reassign_lead(
  '31000000-0000-4000-8000-000000000001', current_setting('test.reassigned_lead_id')::uuid,
  case (select assigned_to from public.leads where id = current_setting('test.reassigned_lead_id')::uuid)
    when '11000000-0000-4000-8000-000000000003'::uuid then '11000000-0000-4000-8000-000000000004'::uuid
    else '11000000-0000-4000-8000-000000000003'::uuid
  end
);
reset role;
select extensions.is(
  (select task.assigned_to from public.tasks as task where task.lead_id = current_setting('test.reassigned_lead_id')::uuid),
  (select lead.assigned_to from public.leads as lead where lead.id = current_setting('test.reassigned_lead_id')::uuid),
  'reassignment transfers the follow-up to the new salesperson'
);
select extensions.is(
  (select task.due_at from public.tasks as task where task.lead_id = current_setting('test.reassigned_lead_id')::uuid),
  public.add_working_minutes('31000000-0000-4000-8000-000000000001', now(), 45),
  'reassignment starts a fresh follow-up interval'
);
select extensions.is(
  (select (task.reminded_at is null and task.escalated_at is null and task.escalated_to is null)::boolean from public.tasks as task where task.lead_id = current_setting('test.reassigned_lead_id')::uuid),
  true, 'reassignment clears previous reminder and escalation state'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.reassigned_lead_id')::uuid and event_type = 'lead.reassigned'),
  1, 'lead reassignment is audited once'
);

update public.tasks
set completed_at = now()
where completed_at is null;
select set_config(
  'test.duplicate_run_at', '2026-10-01 10:00:00+03', true
);
select set_config(
  'test.duplicate_lead_id',
  (public.create_lead_record(
    '31000000-0000-4000-8000-000000000001', 'Duplicate worker trigger', '+201012345604', null, null, null,
    null, '11000000-0000-4000-8000-000000000002', 'manual', '2026-10-01 09:00:00+03'
  )->>'id'), true
);
update public.tasks
set due_at = current_setting('test.duplicate_run_at')::timestamptz - interval '20 minutes',
    last_activity_at = current_setting('test.duplicate_run_at')::timestamptz - interval '20 minutes',
    reminded_at = null,
    escalated_at = null,
    escalated_to = null
where lead_id = current_setting('test.duplicate_lead_id')::uuid;
select set_config(
  'test.first_worker_result',
  public.process_workflow_tasks_at(current_setting('test.duplicate_run_at')::timestamptz)::text, true
);
select extensions.is(
  (current_setting('test.first_worker_result')::jsonb->>'reminded')::integer,
  1, 'first worker invocation sends one reminder'
);
select extensions.is(
  (current_setting('test.first_worker_result')::jsonb->>'escalated')::integer,
  1, 'first worker invocation escalates an untouched overdue task once'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.duplicate_lead_id')::uuid and event_type = 'task.reminder_sent'),
  1, 'reminder action is audited once'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.duplicate_lead_id')::uuid and event_type = 'task.escalated'),
  1, 'escalation action is audited once'
);
select set_config(
  'test.second_worker_result',
  public.process_workflow_tasks_at(current_setting('test.duplicate_run_at')::timestamptz)::text, true
);
select extensions.is(
  (current_setting('test.second_worker_result')::jsonb->>'reminded')::integer,
  0, 'duplicate worker invocation sends no second reminder'
);
select extensions.is(
  (current_setting('test.second_worker_result')::jsonb->>'escalated')::integer,
  0, 'duplicate worker invocation performs no second escalation'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.duplicate_lead_id')::uuid and event_type = 'task.reminder_sent'),
  1, 'duplicate trigger does not duplicate reminder audit events'
);
select extensions.is(
  (select count(*)::integer from public.lead_events where lead_id = current_setting('test.duplicate_lead_id')::uuid and event_type = 'task.escalated'),
  1, 'duplicate trigger does not duplicate escalation audit events'
);

select * from extensions.finish();
rollback;