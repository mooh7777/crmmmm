create table public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role public.organization_role not null default 'sales' check (role = 'sales'),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, created_by)
    references public.memberships(organization_id, user_id) on delete cascade
);

create index organization_invites_active_idx
  on public.organization_invites (organization_id, expires_at desc)
  where accepted_at is null;

alter table public.organization_invites enable row level security;
revoke all on public.organization_invites from public, anon, authenticated;
grant all on public.organization_invites to service_role;

create function public.create_sales_invite(target_organization_id uuid, target_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  invite_id uuid;
begin
  if actor_id is null or not exists (
    select 1
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor_id
      and membership.is_active
      and membership.role in ('owner', 'manager')
  ) then
    raise exception 'Active manager membership required' using errcode = '42501';
  end if;
  if target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invite token hash' using errcode = '22023';
  end if;

  insert into public.organization_invites (organization_id, created_by, token_hash)
  values (target_organization_id, actor_id, target_token_hash)
  returning id into invite_id;
  return invite_id;
end;
$$;

create function public.accept_organization_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  target_role public.organization_role;
begin
  if actor_id is null or char_length(coalesce(invite_token, '')) < 32 then
    raise exception 'A valid signed-in invite is required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users as auth_user where auth_user.id = actor_id and auth_user.email is not null) then
    raise exception 'An email account is required' using errcode = '42501';
  end if;

  select invite.organization_id, invite.role
  into target_organization_id, target_role
  from public.organization_invites as invite
  where invite.token_hash = encode(extensions.digest(convert_to(invite_token, 'UTF8'), 'sha256'), 'hex')
    and invite.accepted_at is null
    and invite.expires_at > now()
  for update;

  if target_organization_id is null then
    raise exception 'Invite is invalid, expired or already used' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor_id
      and membership.is_active
      and membership.role in ('owner', 'manager')
  ) then
    raise exception 'Managers cannot accept salesperson invitations' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.memberships as membership
    where membership.user_id = actor_id
      and membership.organization_id <> target_organization_id
  ) then
    raise exception 'This account already belongs to another organization' using errcode = '23505';
  end if;

  insert into public.memberships (organization_id, user_id, role)
  values (target_organization_id, actor_id, target_role)
  on conflict (organization_id, user_id) do nothing;

  update public.organization_invites
  set accepted_at = now()
  where token_hash = encode(extensions.digest(convert_to(invite_token, 'UTF8'), 'sha256'), 'hex');

  return target_organization_id;
end;
$$;

revoke all on function public.create_sales_invite(uuid, text) from public, anon;
revoke all on function public.accept_organization_invite(text) from public, anon;
grant execute on function public.create_sales_invite(uuid, text) to authenticated;
grant execute on function public.accept_organization_invite(text) to authenticated;

create function public.activate_default_lead_workflow(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  activated_rules integer;
begin
  if actor_id is null or not exists (
    select 1
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor_id
      and membership.is_active
      and membership.role in ('owner', 'manager')
  ) then
    raise exception 'Active manager membership required' using errcode = '42501';
  end if;

  update public.automation_rules
  set enabled = true, updated_at = now()
  where organization_id = target_organization_id
    and rule_key in ('lead.auto_assign', 'lead.required_follow_up', 'task.escalate_overdue');
  get diagnostics activated_rules = row_count;
  if activated_rules <> 3 then
    raise exception 'Default workflow rules are incomplete' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.activate_default_lead_workflow(uuid) from public, anon;
grant execute on function public.activate_default_lead_workflow(uuid) to authenticated;