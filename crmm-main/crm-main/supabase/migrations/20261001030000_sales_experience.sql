alter table public.lead_events
  add column interaction_id uuid;

create unique index lead_events_interaction_id_unique
  on public.lead_events (interaction_id)
  where interaction_id is not null;

create function public.log_sales_outcome(
  target_organization_id uuid,
  target_lead_id uuid,
  target_interaction_id uuid,
  target_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_role public.organization_role;
  lead_assignee_id uuid;
  current_status text;
begin
  if actor_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if target_interaction_id is null or target_outcome is null
    or target_outcome not in ('no_answer', 'interested', 'visit_booked', 'not_interested')
  then
    raise exception 'Invalid sales outcome' using errcode = '22023';
  end if;

  select membership.role, lead.assigned_to, lead.status
  into actor_role, lead_assignee_id, current_status
  from public.leads as lead
  join public.memberships as membership
    on membership.organization_id = lead.organization_id
    and membership.user_id = actor_user_id
    and membership.is_active
  where lead.organization_id = target_organization_id
    and lead.id = target_lead_id;

  if actor_role is null then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;
  if actor_role = 'sales' and lead_assignee_id <> actor_user_id then
    raise exception 'Assigned lead required' using errcode = '42501';
  end if;

  insert into public.lead_events (
    organization_id, lead_id, actor_id, event_type, payload, interaction_id
  ) values (
    target_organization_id,
    target_lead_id,
    actor_user_id,
    'sales.outcome_logged',
    jsonb_build_object('outcome', target_outcome),
    target_interaction_id
  ) on conflict (interaction_id) where interaction_id is not null do nothing;

  if not found then
    return;
  end if;

  update public.leads
  set status = case
    when current_status in ('won', 'lost') then current_status
    when target_outcome = 'no_answer' then 'contacted'
    when target_outcome in ('interested', 'visit_booked') then 'qualified'
    when target_outcome = 'not_interested' then 'lost'
    else current_status
  end
  where organization_id = target_organization_id and id = target_lead_id;
end;
$$;

revoke all on function public.log_sales_outcome(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.log_sales_outcome(uuid, uuid, uuid, text) to authenticated;

create table public.push_subscriptions (
  organization_id uuid not null,
  user_id uuid not null,
  endpoint text not null check (char_length(endpoint) between 1 and 2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, endpoint),
  foreign key (organization_id, user_id)
    references public.memberships(organization_id, user_id) on delete cascade
);

alter table public.push_subscriptions enable row level security;

create policy "members manage their own push subscriptions"
  on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()) and public.get_org_role(organization_id) is not null)
  with check (user_id = (select auth.uid()) and public.get_org_role(organization_id) is not null);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  recipient_id uuid not null,
  channel text not null check (channel in ('email', 'push')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, channel)
);

create index notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public, anon, authenticated;
grant all on public.notification_deliveries to service_role;

create function public.queue_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notification_deliveries (notification_id, recipient_id, channel)
  select new.id, new.recipient_id, delivery_channel
  from unnest(array['email', 'push']::text[]) as channels(delivery_channel)
  on conflict (notification_id, channel) do nothing;
  return new;
end;
$$;

create trigger notifications_queue_deliveries
  after insert on public.notifications
  for each row execute function public.queue_notification_deliveries();

create function public.claim_notification_deliveries(batch_size integer default 25)
returns table (
  delivery_id uuid,
  delivery_channel text,
  recipient_email text,
  locale text,
  notification_kind text,
  notification_title text,
  notification_title_ar text,
  lead_name text,
  task_id uuid,
  subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select delivery.id
    from public.notification_deliveries as delivery
    where (delivery.status = 'pending' and delivery.next_attempt_at <= now())
      or (delivery.status = 'processing' and delivery.claimed_at < now() - interval '5 minutes')
    order by delivery.created_at, delivery.id
    for update of delivery skip locked
    limit least(greatest(coalesce(batch_size, 25), 1), 100)
  ), claimed as (
    update public.notification_deliveries as delivery
    set status = 'processing',
      attempts = delivery.attempts + 1,
      claimed_at = now(),
      updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.id, delivery.notification_id, delivery.recipient_id, delivery.channel
  )
  select claimed.id,
    claimed.channel,
    auth_user.email::text,
    organization.language,
    notification.kind,
    notification.title,
    notification.title_ar,
    lead.full_name,
    notification.task_id,
    coalesce(push_endpoints.items, '[]'::jsonb)
  from claimed
  join public.notifications as notification on notification.id = claimed.notification_id
  join public.organizations as organization on organization.id = notification.organization_id
  left join auth.users as auth_user on auth_user.id = claimed.recipient_id
  left join public.tasks as task on task.id = notification.task_id
  left join public.leads as lead on lead.organization_id = task.organization_id and lead.id = task.lead_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'endpoint', subscription.endpoint,
      'p256dh', subscription.p256dh,
      'auth', subscription.auth
    )) as items
    from public.push_subscriptions as subscription
    where subscription.organization_id = notification.organization_id
      and subscription.user_id = claimed.recipient_id
  ) as push_endpoints on true;
end;
$$;

create function public.finish_notification_delivery(target_delivery_id uuid, delivery_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_deliveries as delivery
  set status = case
      when delivery_error is null then 'delivered'
      when delivery.attempts >= 5 then 'failed'
      else 'pending'
    end,
    next_attempt_at = case
      when delivery_error is null then delivery.next_attempt_at
      else now() + make_interval(secs => least(3600, (30 * power(2, greatest(delivery.attempts - 1, 0)))::integer))
    end,
    delivered_at = case when delivery_error is null then now() else null end,
    last_error = left(delivery_error, 500),
    claimed_at = null,
    updated_at = now()
  where delivery.id = target_delivery_id and delivery.status = 'processing';
end;
$$;

revoke all on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
revoke all on function public.finish_notification_delivery(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;
grant execute on function public.finish_notification_delivery(uuid, text) to service_role;