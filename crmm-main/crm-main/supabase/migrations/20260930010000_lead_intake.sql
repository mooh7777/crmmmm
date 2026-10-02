create function public.normalize_lead_phone(input_phone text, organization_timezone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  ascii_phone text;
  digits text;
  normalized text;
begin
  if input_phone is null then
    return null;
  end if;

  ascii_phone := translate(trim(input_phone), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');

  if left(ascii_phone, 1) = '+' then
    digits := regexp_replace(substr(ascii_phone, 2), '[^0-9]', '', 'g');
    normalized := '+' || digits;
  else
    digits := regexp_replace(ascii_phone, '[^0-9]', '', 'g');

    if left(digits, 2) = '00' then
      normalized := '+' || substr(digits, 3);
    elsif left(digits, 2) = '20' or left(digits, 3) = '966' then
      normalized := '+' || digits;
    elsif organization_timezone = 'Africa/Cairo' then
      if digits ~ '^0(10|11|12|15)[0-9]{8}$' then
        normalized := '+20' || substr(digits, 2);
      elsif digits ~ '^(10|11|12|15)[0-9]{8}$' then
        normalized := '+20' || digits;
      elsif digits ~ '^0(2|3|[4589])[0-9]{7,9}$' then
        normalized := '+20' || substr(digits, 2);
      elsif digits ~ '^(2|3|[4589])[0-9]{7,9}$' then
        normalized := '+20' || digits;
      end if;
    elsif organization_timezone = 'Asia/Riyadh' then
      if digits ~ '^05[0-9]{8}$' then
        normalized := '+966' || substr(digits, 2);
      elsif digits ~ '^5[0-9]{8}$' then
        normalized := '+966' || digits;
      elsif digits ~ '^0(1[1-7])[0-9]{7}$' then
        normalized := '+966' || substr(digits, 2);
      end if;
    end if;
  end if;

  if normalized ~ '^\+[1-9][0-9]{7,14}$' then
    return normalized;
  end if;

  return null;
end;
$$;

create table public.organization_webhook_secrets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  secret_hash bytea not null check (octet_length(secret_hash) = 32),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.organization_webhook_secrets enable row level security;

create function public.rotate_organization_webhook_secret(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.organization_role;
  new_secret text;
begin
  actor_role := public.get_org_role(target_organization_id);
  if actor_id is null or actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;

  new_secret := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.organization_webhook_secrets (organization_id, secret_hash)
  values (target_organization_id, extensions.digest(new_secret, 'sha256'))
  on conflict (organization_id) do update
    set secret_hash = excluded.secret_hash,
        is_active = true,
        rotated_at = now();

  return new_secret;
end;
$$;

revoke all on function public.rotate_organization_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_organization_webhook_secret(uuid) to authenticated;

create function public.create_lead_record(
  target_organization_id uuid,
  lead_full_name text,
  lead_phone text,
  lead_email text,
  lead_source text,
  lead_property_interest text,
  requested_assignee_id uuid,
  actor_user_id uuid,
  intake_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.organization_role;
  assignee_id uuid;
  default_stage_id uuid;
  normalized_phone text;
  existing_lead_id uuid;
  existing_assignee_id uuid;
  follow_up_minutes integer;
  new_lead_id uuid;
begin
  if intake_channel not in ('manual', 'csv', 'webhook') then
    raise exception 'Invalid intake channel' using errcode = '22023';
  end if;

  select membership.role
  into actor_role
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = actor_user_id;

  if actor_role is null then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(lead_full_name, ''))) not between 2 and 160 then
    raise exception 'Lead name must be between 2 and 160 characters' using errcode = '22023';
  end if;

  normalized_phone := public.normalize_lead_phone(
    lead_phone,
    (select organization.timezone from public.organizations as organization where organization.id = target_organization_id)
  );
  if normalized_phone is null then
    raise exception 'Phone number is not valid for this organization' using errcode = '22023';
  end if;

  if requested_assignee_id is not null then
    if actor_role not in ('owner', 'manager') then
      raise exception 'Only managers can assign leads' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.memberships as membership
      where membership.organization_id = target_organization_id
        and membership.user_id = requested_assignee_id
        and membership.role = 'sales'
    ) then
      raise exception 'Assignee must be a salesperson in this organization' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text, 0));

  select lead.id, lead.assigned_to
  into existing_lead_id, existing_assignee_id
  from public.leads as lead
  where lead.organization_id = target_organization_id
    and lead.phone = normalized_phone
  limit 1;

  if existing_lead_id is not null then
    insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
    values (
      target_organization_id,
      existing_lead_id,
      actor_user_id,
      'lead.duplicate_detected',
      jsonb_build_object('intake_channel', intake_channel)
    );

    return jsonb_build_object('id', existing_lead_id, 'duplicate', true, 'assigned_to', existing_assignee_id);
  end if;

  if requested_assignee_id is not null then
    assignee_id := requested_assignee_id;
  elsif actor_role = 'sales' then
    assignee_id := actor_user_id;
  else
    select membership.user_id
    into assignee_id
    from public.memberships as membership
    left join lateral (
      select count(*) as open_leads
      from public.leads as lead
      where lead.organization_id = membership.organization_id
        and lead.assigned_to = membership.user_id
        and lead.status not in ('won', 'lost')
    ) as workload on true
    where membership.organization_id = target_organization_id
      and membership.role = 'sales'
    order by workload.open_leads, membership.created_at, membership.user_id
    limit 1;

    if assignee_id is null then
      assignee_id := actor_user_id;
    end if;
  end if;

  select stage.id into default_stage_id
  from public.pipeline_stages as stage
  where stage.organization_id = target_organization_id and stage.is_default;
  if default_stage_id is null then
    raise exception 'Organization has no default pipeline stage' using errcode = '23514';
  end if;

  select coalesce((rule.configuration->>'due_in_minutes')::integer, 60)
  into follow_up_minutes
  from public.automation_rules as rule
  where rule.organization_id = target_organization_id
    and rule.rule_key = 'lead.required_follow_up'
    and rule.enabled;
  follow_up_minutes := coalesce(follow_up_minutes, 60);

  insert into public.leads (
    organization_id, full_name, phone, email, source, property_interest,
    stage_id, assigned_to, created_by
  ) values (
    target_organization_id, trim(lead_full_name), normalized_phone, lead_email,
    lead_source, lead_property_interest, default_stage_id, assignee_id, actor_user_id
  ) returning id into new_lead_id;

  insert into public.lead_events (organization_id, lead_id, actor_id, event_type, payload)
  values (
    target_organization_id, new_lead_id, actor_user_id, 'lead.created',
    jsonb_build_object('assigned_to', assignee_id, 'intake_channel', intake_channel)
  );

  insert into public.tasks (
    organization_id, lead_id, title, title_ar, assigned_to, created_by, due_at
  ) values (
    target_organization_id, new_lead_id, 'Follow up with new lead', 'متابعة العميل المحتمل الجديد',
    assignee_id, actor_user_id, now() + make_interval(mins => follow_up_minutes)
  );

  return jsonb_build_object('id', new_lead_id, 'duplicate', false, 'assigned_to', assignee_id);
end;
$$;

revoke all on function public.create_lead_record(uuid, text, text, text, text, text, uuid, uuid, text) from public, anon, authenticated;

drop function public.create_lead(uuid, text, text, text, text, text, uuid);

create function public.create_lead(
  target_organization_id uuid,
  lead_full_name text,
  lead_phone text,
  lead_email text default null,
  lead_source text default null,
  lead_property_interest text default null,
  requested_assignee_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.create_lead_record(
    target_organization_id, lead_full_name, lead_phone, lead_email,
    lead_source, lead_property_interest, requested_assignee_id,
    (select auth.uid()), 'manual'
  );
end;
$$;

revoke all on function public.create_lead(uuid, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_lead(uuid, text, text, text, text, text, uuid) to authenticated;

create function public.import_leads(target_organization_id uuid, rows_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role public.organization_role;
  row_payload jsonb;
  row_number integer := 0;
  created_count integer := 0;
  duplicate_count integer := 0;
  errors_payload jsonb := '[]'::jsonb;
  result_payload jsonb;
begin
  actor_role := public.get_org_role(target_organization_id);
  if actor_id is null or actor_role is null or actor_role not in ('owner', 'manager') then
    raise exception 'Organization manager access required' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(rows_payload), '') <> 'array' or jsonb_array_length(rows_payload) > 500 then
    raise exception 'Import must contain at most 500 rows' using errcode = '22023';
  end if;

  for row_payload in select value from jsonb_array_elements(rows_payload)
  loop
    row_number := row_number + 1;
    begin
      result_payload := public.create_lead_record(
        target_organization_id,
        row_payload->>'full_name', row_payload->>'phone',
        nullif(trim(row_payload->>'email'), ''),
        nullif(trim(row_payload->>'source'), ''),
        nullif(trim(row_payload->>'property_interest'), ''),
        null, actor_id, 'csv'
      );

      if (result_payload->>'duplicate')::boolean then
        duplicate_count := duplicate_count + 1;
      else
        created_count := created_count + 1;
      end if;
    exception when others then
      errors_payload := errors_payload || jsonb_build_array(
        jsonb_build_object('row', row_number, 'reason', 'invalid_or_unusable_row')
      );
    end;
  end loop;

  return jsonb_build_object(
    'created', created_count,
    'duplicates', duplicate_count,
    'failed', jsonb_array_length(errors_payload),
    'errors', errors_payload
  );
end;
$$;

revoke all on function public.import_leads(uuid, jsonb) from public, anon;
grant execute on function public.import_leads(uuid, jsonb) to authenticated;

create function public.ingest_webhook_lead(
  target_organization_id uuid,
  supplied_secret text,
  lead_full_name text,
  lead_phone text,
  lead_email text default null,
  lead_source text default 'webhook',
  lead_property_interest text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret_is_valid boolean;
  organization_owner_id uuid;
begin
  select secret.is_active and secret.secret_hash = extensions.digest(supplied_secret, 'sha256')
  into secret_is_valid
  from public.organization_webhook_secrets as secret
  where secret.organization_id = target_organization_id;

  if coalesce(secret_is_valid, false) is not true then
    raise exception 'Invalid webhook secret' using errcode = '28000';
  end if;

  update public.organization_webhook_secrets
  set last_used_at = now()
  where organization_id = target_organization_id;

  select membership.user_id into organization_owner_id
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.role = 'owner'
  limit 1;
  if organization_owner_id is null then
    raise exception 'Organization owner not found' using errcode = '23503';
  end if;

  return public.create_lead_record(
    target_organization_id, lead_full_name, lead_phone, lead_email,
    lead_source, lead_property_interest, null, organization_owner_id, 'webhook'
  );
end;
$$;

revoke all on function public.ingest_webhook_lead(uuid, text, text, text, text, text, text) from public;
grant execute on function public.ingest_webhook_lead(uuid, text, text, text, text, text, text) to anon, authenticated;

update public.leads as lead
set phone = public.normalize_lead_phone(lead.phone, organization.timezone)
from public.organizations as organization
where organization.id = lead.organization_id
  and public.normalize_lead_phone(lead.phone, organization.timezone) is not null;