create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(8);

insert into auth.users (id, email) values
  ('14000000-0000-4000-8000-000000000001', 'onboarding-owner@example.test'),
  ('14000000-0000-4000-8000-000000000002', 'onboarding-manager@example.test'),
  ('14000000-0000-4000-8000-000000000003', 'onboarding-invitee@example.test'),
  ('14000000-0000-4000-8000-000000000004', 'onboarding-sales@example.test'),
  ('14000000-0000-4000-8000-000000000005', 'onboarding-inactive-manager@example.test');

insert into public.organizations (id, name, slug, created_by)
values ('34000000-0000-4000-8000-000000000001', 'Onboarding Invites Test', 'onboarding-invites-test', '14000000-0000-4000-8000-000000000001');

insert into public.memberships (organization_id, user_id, role, is_active) values
  ('34000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 'owner', true),
  ('34000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 'manager', true),
  ('34000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000004', 'sales', true),
  ('34000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000005', 'manager', false);

select set_config('test.invite_token', 'sales-invite-test-token-0123456789abcdef0123456789abcdef', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000002', true);
select extensions.ok(
  public.create_sales_invite(
    '34000000-0000-4000-8000-000000000001',
    encode(extensions.digest(convert_to(current_setting('test.invite_token'), 'UTF8'), 'sha256'), 'hex')
  ) is not null,
  'active manager can create an invite link'
);

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000004', true);
select extensions.throws_ok(
  $$select public.create_sales_invite('34000000-0000-4000-8000-000000000001', repeat('a', 64))$$,
  '42501', null, 'sales cannot create invitation links'
);

select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000003', true);
select extensions.is(
  public.accept_organization_invite(current_setting('test.invite_token'))::text,
  '34000000-0000-4000-8000-000000000001',
  'invitee joins the invited organization'
);

reset role;
select extensions.is(
  (select membership.role::text from public.memberships as membership where membership.organization_id = '34000000-0000-4000-8000-000000000001' and membership.user_id = '14000000-0000-4000-8000-000000000003'),
  'sales', 'accepted invite grants only the sales role'
);
select extensions.ok(
  (select invite.accepted_at is not null from public.organization_invites as invite where invite.token_hash = encode(extensions.digest(convert_to(current_setting('test.invite_token'), 'UTF8'), 'sha256'), 'hex')),
  'accepted invite is marked as consumed'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.accept_organization_invite(current_setting('test.invite_token'))$$,
  '22023', null, 'invite cannot be accepted twice'
);

reset role;
insert into public.organization_invites (organization_id, created_by, token_hash, expires_at)
values (
  '34000000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  encode(extensions.digest(convert_to('expired-sales-invite-test-token-0123456789abcdef', 'UTF8'), 'sha256'), 'hex'),
  now() - interval '1 minute'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000003', true);
select extensions.throws_ok(
  $$select public.accept_organization_invite('expired-sales-invite-test-token-0123456789abcdef')$$,
  '22023', null, 'expired invite is rejected'
);
select set_config('request.jwt.claim.sub', '14000000-0000-4000-8000-000000000005', true);
select extensions.throws_ok(
  $$select public.create_sales_invite('34000000-0000-4000-8000-000000000001', repeat('b', 64))$$,
  '42501', null, 'inactive manager cannot create invite links'
);

select * from extensions.finish();
rollback;