create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(12);

insert into auth.users (id, email) values
  ('13000000-0000-4000-8000-000000000001', 'sales-experience-owner@example.test'),
  ('13000000-0000-4000-8000-000000000002', 'sales-experience-user@example.test');

insert into public.organizations (id, name, slug, created_by)
values ('33000000-0000-4000-8000-000000000001', 'Sales Experience Test', 'sales-experience-test', '13000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role) values
  ('33000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'owner'),
  ('33000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', 'sales');

insert into public.pipeline_stages (id, organization_id, name, name_ar, position, is_default)
values ('43000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'New', 'جديد', 0, true);

insert into public.leads (id, organization_id, full_name, phone, stage_id, assigned_to, created_by) values
  ('53000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', 'No answer lead', '+201012345601', '43000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001'),
  ('53000000-0000-4000-8000-000000000002', '33000000-0000-4000-8000-000000000001', 'Interested lead', '+201012345602', '43000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001'),
  ('53000000-0000-4000-8000-000000000003', '33000000-0000-4000-8000-000000000001', 'Visit lead', '+201012345603', '43000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001'),
  ('53000000-0000-4000-8000-000000000004', '33000000-0000-4000-8000-000000000001', 'Not interested lead', '+201012345604', '43000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-4000-8000-000000000002', true);

select extensions.lives_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'no_answer')$$,
  'sales can log no answer on an assigned lead'
);
select extensions.lives_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000002', 'interested')$$,
  'sales can log interest on an assigned lead'
);
select extensions.lives_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000003', 'visit_booked')$$,
  'sales can log a booked visit on an assigned lead'
);
select extensions.lives_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000004', '63000000-0000-4000-8000-000000000004', 'not_interested')$$,
  'sales can log disinterest on an assigned lead'
);
select extensions.lives_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000001', 'no_answer')$$,
  'replaying an interaction is idempotent'
);
select extensions.throws_ok(
  $$select public.log_sales_outcome('33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000005', 'unsupported')$$,
  '22023', null, 'unsupported sales outcomes are rejected'
);

reset role;

select extensions.is((select status from public.leads where id = '53000000-0000-4000-8000-000000000001'), 'contacted', 'no answer records an attempted contact');
select extensions.is((select status from public.leads where id = '53000000-0000-4000-8000-000000000002'), 'qualified', 'interested advances the lead to qualified');
select extensions.is((select status from public.leads where id = '53000000-0000-4000-8000-000000000003'), 'qualified', 'a booked visit advances the lead to qualified');
select extensions.is((select status from public.leads where id = '53000000-0000-4000-8000-000000000004'), 'lost', 'not interested closes the lead as lost');
select extensions.is((select count(*)::integer from public.lead_events where interaction_id = '63000000-0000-4000-8000-000000000001'), 1, 'an interaction retry does not duplicate its audit event');

insert into public.tasks (id, organization_id, lead_id, title, title_ar, assigned_to, created_by, due_at)
values ('73000000-0000-4000-8000-000000000001', '33000000-0000-4000-8000-000000000001', '53000000-0000-4000-8000-000000000001', 'Follow-up', 'متابعة', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000001', now());

insert into public.notifications (organization_id, recipient_id, task_id, kind, title, title_ar)
values ('33000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000001', 'task_due', 'Follow-up is due', 'حان موعد متابعة العميل');

select extensions.is((select count(*)::integer from public.notification_deliveries where notification_id = (select id from public.notifications where task_id = '73000000-0000-4000-8000-000000000001')), 2, 'each task reminder is queued for email and push');

select * from extensions.finish();
rollback;