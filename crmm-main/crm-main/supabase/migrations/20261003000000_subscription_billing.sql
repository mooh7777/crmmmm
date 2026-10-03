create table public.billing_plans (
  code text primary key check (code in ('starter', 'growth', 'pro')),
  name text not null,
  included_seats integer not null check (included_seats > 0),
  leads_per_month integer not null check (leads_per_month > 0),
  monthly_price_egp numeric(12, 2) not null check (monthly_price_egp >= 0),
  monthly_price_sar numeric(12, 2) not null check (monthly_price_sar >= 0),
  extra_seat_price_egp numeric(12, 2) not null check (extra_seat_price_egp >= 0),
  extra_seat_price_sar numeric(12, 2) not null check (extra_seat_price_sar >= 0),
  features jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.billing_plans (
  code, name, included_seats, leads_per_month,
  monthly_price_egp, monthly_price_sar,
  extra_seat_price_egp, extra_seat_price_sar, features
) values
  ('starter', 'Starter', 5, 500, 990, 149, 120, 25,
    '{"workflow":true,"dashboard":true,"whatsapp_assistant":true}'::jsonb),
  ('growth', 'Growth', 15, 2500, 2490, 399, 120, 25,
    '{"workflow":true,"dashboard":true,"whatsapp_assistant":true,"impact_report":true,"facebook_lead_ads":true}'::jsonb),
  ('pro', 'Pro', 30, 10000, 4990, 799, 120, 25,
    '{"workflow":true,"dashboard":true,"whatsapp_assistant":true,"impact_report":true,"facebook_lead_ads":true,"whatsapp_api":true,"priority_support":true}'::jsonb);

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check;

update public.subscriptions
set plan = 'starter'
where plan = 'trial';

alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('starter', 'growth', 'pro', 'enterprise')),
  add column trial_started_at timestamptz,
  add column trial_ends_at timestamptz,
  add column current_period_start timestamptz,
  add column past_due_since timestamptz,
  add column currency text not null default 'EGP' check (currency in ('EGP', 'SAR')),
  add column billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual')),
  add column extra_seats integer not null default 0 check (extra_seats >= 0),
  add column founder_discount_percent numeric(5, 2) not null default 0 check (founder_discount_percent between 0 and 100);

alter table public.subscriptions alter column plan set default 'starter';
update public.subscriptions
set trial_started_at = coalesce(trial_started_at, now()),
    trial_ends_at = coalesce(trial_ends_at, now() + interval '14 days');
alter table public.subscriptions
  alter column trial_started_at set default now(),
  alter column trial_started_at set not null,
  alter column trial_ends_at set default (now() + interval '14 days'),
  alter column trial_ends_at set not null;
update public.subscriptions as subscription
set currency = organization.currency
from public.organizations as organization
where organization.id = subscription.organization_id;

create function public.set_new_subscription_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan = 'trial' then
    new.plan := 'starter';
    new.status := 'trialing';
    new.trial_started_at := coalesce(new.trial_started_at, now());
    new.trial_ends_at := coalesce(new.trial_ends_at, now() + interval '14 days');
  end if;
  select organization.currency into new.currency
  from public.organizations as organization
  where organization.id = new.organization_id;
  return new;
end;
$$;

revoke all on function public.set_new_subscription_currency() from public, anon, authenticated;
create trigger subscriptions_set_initial_currency
  before insert on public.subscriptions
  for each row execute function public.set_new_subscription_currency();

create table public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  provider text not null,
  order_id text not null unique,
  provider_transaction_id text,
  plan_code text not null references public.billing_plans(code),
  billing_interval text not null check (billing_interval in ('monthly', 'annual')),
  extra_seats integer not null default 0 check (extra_seats >= 0),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null check (currency in ('EGP', 'SAR')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'creating' check (status in ('creating', 'pending', 'paid', 'failed', 'refunded')),
  payment_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, provider_transaction_id)
);

create index billing_payments_org_created_idx
  on public.billing_payments (organization_id, created_at desc);
create index billing_payments_pending_idx
  on public.billing_payments (subscription_id, period_end desc)
  where status in ('creating', 'pending');

create table public.payments_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  order_id text not null,
  transaction_id text not null,
  payment_status text not null check (payment_status in ('approved', 'pending', 'rejected')),
  amount numeric(12, 2) not null check (amount >= 0),
  currency text check (currency in ('EGP', 'SAR')),
  raw_payload text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, event_id)
);

create table public.billing_reminders (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  renewal_at timestamptz not null,
  days_before smallint not null check (days_before in (5, 2, 0)),
  payment_url text,
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  last_error text,
  claimed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (subscription_id, renewal_at, days_before)
);

alter table public.billing_plans enable row level security;
alter table public.billing_payments enable row level security;
alter table public.payments_events enable row level security;
alter table public.billing_reminders enable row level security;

create policy "authenticated users read active billing plans"
  on public.billing_plans for select to authenticated
  using (active);
create policy "managers read organization billing payments"
  on public.billing_payments for select to authenticated
  using (public.get_org_role(organization_id) in ('owner', 'manager'));

grant select on public.billing_plans, public.billing_payments to authenticated;
grant all on public.billing_plans, public.billing_payments, public.payments_events, public.billing_reminders to service_role;

create function public.billing_is_read_only(target_organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  subscription public.subscriptions%rowtype;
begin
  select * into subscription
  from public.subscriptions as item
  where item.organization_id = target_organization_id;

  if not found then return false; end if;

  return case subscription.status
    when 'trialing' then coalesce(subscription.trial_ends_at, now()) + interval '7 days' <= now()
    when 'active' then coalesce(subscription.current_period_end, now()) + interval '7 days' <= now()
    when 'past_due' then coalesce(subscription.past_due_since, subscription.current_period_end, now()) + interval '7 days' <= now()
    when 'canceled' then coalesce(subscription.current_period_end, subscription.trial_ends_at, now()) <= now()
    else true
  end;
end;
$$;

revoke all on function public.billing_is_read_only(uuid) from public, anon, authenticated;

create function public.enforce_billing_access_and_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  subscription_plan text;
  allowed_seats integer;
  monthly_lead_limit integer;
  organization_timezone text;
  month_start timestamptz;
  existing_count bigint;
begin
  if coalesce((select auth.role()), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_table_name = 'organizations' then
    target_organization_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  end if;

  if target_organization_id is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if public.billing_is_read_only(target_organization_id) then
    raise exception 'Organization is read-only because its subscription is past due'
      using errcode = '55000';
  end if;

  select item.plan, item.extra_seats
  into subscription_plan, allowed_seats
  from public.subscriptions as item
  where item.organization_id = target_organization_id;

  if tg_table_name = 'memberships' and tg_op in ('INSERT', 'UPDATE') and subscription_plan is not null
    and ((tg_op = 'INSERT' and new.is_active) or (tg_op = 'UPDATE' and not old.is_active and new.is_active)) then
    select plan.included_seats + allowed_seats into allowed_seats
    from public.billing_plans as plan where plan.code = subscription_plan;
    if allowed_seats is not null then
      select count(*) into existing_count
      from public.memberships as membership
      where membership.organization_id = target_organization_id and membership.is_active
        and (tg_op = 'INSERT' or membership.user_id <> old.user_id);
      if existing_count >= allowed_seats then
        raise exception 'Seat limit reached for this plan' using errcode = '54000';
      end if;
    end if;
  end if;

  if tg_table_name = 'leads' and tg_op = 'INSERT' and subscription_plan is not null then
    select plan.leads_per_month into monthly_lead_limit
    from public.billing_plans as plan where plan.code = subscription_plan;
    select organization.timezone into organization_timezone
    from public.organizations as organization where organization.id = target_organization_id;
    month_start := date_trunc('month', now() at time zone coalesce(organization_timezone, 'UTC'))
      at time zone coalesce(organization_timezone, 'UTC');
    if monthly_lead_limit is not null then
      select count(*) into existing_count
      from public.leads as lead
      where lead.organization_id = target_organization_id and lead.created_at >= month_start;
      if existing_count >= monthly_lead_limit then
        raise exception 'Monthly lead limit reached for this plan' using errcode = '54000';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.enforce_billing_access_and_limits() from public, anon, authenticated;

create trigger organizations_billing_guard
  before update or delete on public.organizations
  for each row execute function public.enforce_billing_access_and_limits();
create trigger memberships_billing_guard
  before insert or update or delete on public.memberships
  for each row execute function public.enforce_billing_access_and_limits();
create trigger pipeline_stages_billing_guard
  before insert or update or delete on public.pipeline_stages
  for each row execute function public.enforce_billing_access_and_limits();
create trigger leads_billing_guard
  before insert or update or delete on public.leads
  for each row execute function public.enforce_billing_access_and_limits();
create trigger lead_events_billing_guard
  before insert or update or delete on public.lead_events
  for each row execute function public.enforce_billing_access_and_limits();
create trigger tasks_billing_guard
  before insert or update or delete on public.tasks
  for each row execute function public.enforce_billing_access_and_limits();
create trigger notifications_billing_guard
  before insert or update or delete on public.notifications
  for each row execute function public.enforce_billing_access_and_limits();
create trigger automation_rules_billing_guard
  before insert or update or delete on public.automation_rules
  for each row execute function public.enforce_billing_access_and_limits();
create trigger push_subscriptions_billing_guard
  before insert or update or delete on public.push_subscriptions
  for each row execute function public.enforce_billing_access_and_limits();
create trigger organization_invites_billing_guard
  before insert or update or delete on public.organization_invites
  for each row execute function public.enforce_billing_access_and_limits();
create trigger organization_webhook_secrets_billing_guard
  before insert or update or delete on public.organization_webhook_secrets
  for each row execute function public.enforce_billing_access_and_limits();
create trigger organization_impact_settings_billing_guard
  before insert or update or delete on public.organization_impact_settings
  for each row execute function public.enforce_billing_access_and_limits();

create function public.apply_truepay_payment_event(target_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  event public.payments_events%rowtype;
  payment public.billing_payments%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  select * into event from public.payments_events where id = target_event_id for update;
  if not found then raise exception 'Payment event not found' using errcode = 'P0002'; end if;
  if event.processed_at is not null then return 'duplicate'; end if;

  select * into payment from public.billing_payments where order_id = event.order_id for update;
  if not found then
    update public.payments_events set processing_error = 'Unknown order id' where id = target_event_id;
    return 'unknown-order';
  end if;

  if payment.amount <> event.amount or (event.currency is not null and payment.currency <> event.currency) then
    update public.payments_events set processing_error = 'Payment amount or currency mismatch' where id = target_event_id;
    return 'amount-mismatch';
  end if;

  if event.payment_status = 'approved' and payment.status <> 'paid' then
    update public.billing_payments
    set status = 'paid', provider_transaction_id = event.transaction_id, paid_at = now(), updated_at = now()
    where id = payment.id;

    update public.subscriptions
    set plan = payment.plan_code,
        status = 'active',
        currency = payment.currency,
        billing_interval = payment.billing_interval,
        extra_seats = payment.extra_seats,
        current_period_start = payment.period_start,
        current_period_end = payment.period_end,
        past_due_since = null,
        updated_at = now()
    where id = payment.subscription_id;
  elsif event.payment_status = 'rejected' and payment.status <> 'paid' then
    update public.billing_payments set status = 'failed', updated_at = now() where id = payment.id;
  end if;

  update public.payments_events set processed_at = now(), processing_error = null where id = target_event_id;
  return 'processed';
end;
$$;

revoke all on function public.apply_truepay_payment_event(uuid) from public, anon, authenticated;
grant execute on function public.apply_truepay_payment_event(uuid) to service_role;

create function public.process_billing_renewals(run_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription record;
  renewal_at timestamptz;
  reminder_day smallint;
  created_count integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  for subscription in
    select item.id, item.organization_id, item.status, item.trial_ends_at, item.current_period_end
    from public.subscriptions as item
    where item.status in ('trialing', 'active')
  loop
    renewal_at := case when subscription.status = 'trialing' then subscription.trial_ends_at else subscription.current_period_end end;
    if renewal_at is null then continue; end if;

    reminder_day := null;
    if (renewal_at at time zone 'UTC')::date = (run_at at time zone 'UTC')::date + 5 then reminder_day := 5;
    elsif (renewal_at at time zone 'UTC')::date = (run_at at time zone 'UTC')::date + 2 then reminder_day := 2;
    elsif (renewal_at at time zone 'UTC')::date = (run_at at time zone 'UTC')::date then reminder_day := 0;
    end if;

    if reminder_day is not null then
      insert into public.billing_reminders (subscription_id, renewal_at, days_before)
      values (subscription.id, renewal_at, reminder_day)
      on conflict (subscription_id, renewal_at, days_before) do nothing;
      if found then created_count := created_count + 1; end if;
    end if;

    if renewal_at <= run_at then
      update public.subscriptions
      set status = 'past_due', past_due_since = coalesce(past_due_since, renewal_at), updated_at = now()
      where id = subscription.id and status in ('trialing', 'active');
    end if;
  end loop;

  return created_count;
end;
$$;

revoke all on function public.process_billing_renewals(timestamptz) from public, anon, authenticated;
grant execute on function public.process_billing_renewals(timestamptz) to service_role;

create function public.claim_billing_reminders(batch_size integer default 25)
returns table(
  reminder_id uuid,
  subscription_id uuid,
  organization_id uuid,
  organization_name text,
  organization_language text,
  recipient_email text,
  payment_url text,
  renewal_at timestamptz,
  days_before smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select reminder.id
    from public.billing_reminders as reminder
    where reminder.state = 'pending'
      and reminder.payment_url is not null
      and reminder.next_attempt_at <= now()
      and (reminder.claimed_at is null or reminder.claimed_at < now() - interval '15 minutes')
      and exists (
        select 1 from public.subscriptions as subscription
        where subscription.id = reminder.subscription_id
          and subscription.status in ('trialing', 'active', 'past_due')
          and coalesce(subscription.current_period_end, subscription.trial_ends_at) = reminder.renewal_at
      )
    order by reminder.renewal_at, reminder.days_before desc
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  ), claimed as (
    update public.billing_reminders as reminder
    set claimed_at = now(), attempt_count = attempt_count + 1
    from candidates
    where reminder.id = candidates.id
    returning reminder.id, reminder.subscription_id, reminder.payment_url, reminder.renewal_at, reminder.days_before
  )
  select
    claimed.id,
    claimed.subscription_id,
    organization.id,
    organization.name,
    organization.language,
    coalesce(
      (select auth_user.email from auth.users as auth_user where auth_user.id = organization.created_by),
      (select auth_user.email
       from public.memberships as membership
       join auth.users as auth_user on auth_user.id = membership.user_id
       where membership.organization_id = organization.id and membership.role = 'owner'
       order by membership.created_at limit 1)
    ),
    claimed.payment_url,
    claimed.renewal_at,
    claimed.days_before
  from claimed
  join public.subscriptions as subscription on subscription.id = claimed.subscription_id
  join public.organizations as organization on organization.id = subscription.organization_id
  where coalesce(
    (select auth_user.email from auth.users as auth_user where auth_user.id = organization.created_by),
    (select auth_user.email
     from public.memberships as membership
     join auth.users as auth_user on auth_user.id = membership.user_id
     where membership.organization_id = organization.id and membership.role = 'owner'
     order by membership.created_at limit 1)
  ) is not null;
end;
$$;

create function public.finish_billing_reminder(target_reminder_id uuid, delivery_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.billing_reminders
    set state = case when delivery_error is null then 'sent' when attempt_count >= 5 then 'failed' else 'pending' end,
      last_error = left(delivery_error, 500),
      claimed_at = null,
      next_attempt_at = case when delivery_error is null then next_attempt_at else now() + interval '15 minutes' end,
      sent_at = case when delivery_error is null then now() else null end
  where id = target_reminder_id and state = 'pending';
end;
$$;

revoke all on function public.claim_billing_reminders(integer) from public, anon, authenticated;
revoke all on function public.finish_billing_reminder(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_billing_reminders(integer) to service_role;
grant execute on function public.finish_billing_reminder(uuid, text) to service_role;
