insert into public.organizations (
  id, name, slug, timezone, currency, weekend_days, working_hours, language
)
values (
  '00000000-0000-4000-8000-000000000001',
  'Masar Demo Egypt',
  'masar-demo-egypt',
  'Africa/Cairo',
  'EGP',
  array[5, 6]::smallint[],
  '{"start":"09:00","end":"18:00"}'::jsonb,
  'ar'
);

insert into public.pipeline_stages (organization_id, name, name_ar, position, is_default)
values
  ('00000000-0000-4000-8000-000000000001', 'New', 'جديد', 0, true),
  ('00000000-0000-4000-8000-000000000001', 'Contacted', 'تم التواصل', 1, false),
  ('00000000-0000-4000-8000-000000000001', 'Qualified', 'مؤهل', 2, false),
  ('00000000-0000-4000-8000-000000000001', 'Won', 'تم البيع', 3, false),
  ('00000000-0000-4000-8000-000000000001', 'Lost', 'مفقود', 4, false);

insert into public.automation_rules (organization_id, rule_key, configuration)
values
  ('00000000-0000-4000-8000-000000000001', 'lead.auto_assign', '{"strategy":"least_open_leads"}'::jsonb),
  ('00000000-0000-4000-8000-000000000001', 'lead.required_follow_up', '{"due_in_minutes":60}'::jsonb),
  ('00000000-0000-4000-8000-000000000001', 'task.escalate_overdue', '{"after_minutes":15}'::jsonb);

insert into public.subscriptions (organization_id, plan, status)
values ('00000000-0000-4000-8000-000000000001', 'trial', 'trialing');