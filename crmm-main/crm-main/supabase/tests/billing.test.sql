create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(8);

insert into auth.users (id, email) values
  ('15000000-0000-4000-8000-000000000001', 'billing-owner@example.test'),
  ('15000000-0000-4000-8000-000000000002', 'billing-seat-2@example.test'),
  ('15000000-0000-4000-8000-000000000003', 'billing-seat-3@example.test'),
  ('15000000-0000-4000-8000-000000000004', 'billing-seat-4@example.test'),
  ('15000000-0000-4000-8000-000000000005', 'billing-seat-5@example.test'),
  ('15000000-0000-4000-8000-000000000006', 'billing-seat-6@example.test');

insert into public.organizations (id, name, slug, created_by)
values ('35000000-0000-4000-8000-000000000001', 'Billing Test', 'billing-test', '15000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role, is_active) values
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000001', 'owner', true),
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'sales', true),
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000003', 'sales', true),
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000004', 'sales', true),
  ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000005', 'sales', true);

insert into public.subscriptions (organization_id, plan, status)
values ('35000000-0000-4000-8000-000000000001', 'trial', 'trialing');

select extensions.is(
  (select subscription.plan from public.subscriptions as subscription where subscription.organization_id = '35000000-0000-4000-8000-000000000001'),
  'starter',
  'legacy organization creation starts on the Starter trial'
);

select extensions.is(
  (select plan.monthly_price_egp from public.billing_plans as plan where plan.code = 'starter'),
  990::numeric,
  'Starter EGP monthly price is seeded'
);
select extensions.is(
  (select plan.monthly_price_sar from public.billing_plans as plan where plan.code = 'pro'),
  799::numeric,
  'Pro SAR monthly price is seeded'
);
select extensions.ok(
  (select subscription.trial_ends_at - subscription.trial_started_at between interval '13 days 23 hours' and interval '14 days 1 hour'
   from public.subscriptions as subscription where subscription.organization_id = '35000000-0000-4000-8000-000000000001'),
  'new subscription receives a 14-day trial'
);
select extensions.is(
  public.billing_is_read_only('35000000-0000-4000-8000-000000000001'),
  false,
  'trial account remains writable before trial end'
);
select extensions.throws_ok(
  $$insert into public.memberships (organization_id, user_id, role, is_active)
    values ('35000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000006', 'sales', true)$$,
  '54000', null,
  'Starter blocks a sixth active seat'
);

update public.subscriptions
set status = 'past_due', past_due_since = now() - interval '8 days', trial_ends_at = now() - interval '8 days'
where organization_id = '35000000-0000-4000-8000-000000000001';
select extensions.is(
  public.billing_is_read_only('35000000-0000-4000-8000-000000000001'),
  true,
  'past-due account is read-only after the seven-day grace period'
);
select extensions.is(
  (select count(*) from public.organizations where id = '35000000-0000-4000-8000-000000000001'),
  1::bigint,
  'billing expiry preserves organization data'
);

select * from extensions.finish();
rollback;
