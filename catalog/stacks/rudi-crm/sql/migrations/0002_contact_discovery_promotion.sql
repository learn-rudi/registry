-- Additive contact discovery and explicit approval-gated promotion contract.
-- Invariants:
--   * discovery evidence never creates or attaches a CRM person;
--   * exact normalized email is the only automatic identity key;
--   * attaching an alias requires an explicit existing_person_id;
--   * a new person and primary email are created atomically.

alter table public.discovery_observations
  add column if not exists display_name text,
  add column if not exists idempotency_key text,
  add column if not exists raw jsonb not null default '{}'::jsonb;

alter table public.discovery_observations
  drop constraint discovery_observations_role_chk;

alter table public.discovery_observations
  add constraint discovery_observations_role_chk
  check (
    address_role = any (
      array['from', 'to', 'cc', 'bcc', 'attendee', 'host', 'sender', 'recipient']::text[]
    )
  ),
  add constraint discovery_observations_display_name_chk
  check (display_name is null or length(display_name) <= 200),
  add constraint discovery_observations_raw_object_chk
  check (jsonb_typeof(raw) = 'object');

create or replace function public.record_discovery_observations(p_batch jsonb)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_received integer;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_new_domains integer := 0;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' then
    raise exception 'record_discovery_observations: batch must be a JSON array'
      using errcode = '22023';
  end if;

  v_received := jsonb_array_length(p_batch);
  if v_received < 1 or v_received > 500 then
    raise exception 'record_discovery_observations: batch size must be between 1 and 500'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batch) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or nullif(btrim(item.value->>'source'), '') is null
      or lower(btrim(item.value->>'source')) <> all (
        array['gmail', 'calendar', 'otter', 'slack', 'manual']::text[]
      )
      or nullif(btrim(item.value->>'source_id'), '') is null
      or nullif(btrim(item.value->>'observed_at'), '') is null
      or nullif(btrim(item.value->>'address_role'), '') is null
      or lower(btrim(item.value->>'address_role')) <> all (
        array['from', 'to', 'cc', 'bcc', 'attendee', 'host', 'sender', 'recipient']::text[]
      )
      or nullif(btrim(item.value->>'address'), '') is null
      or lower(btrim(item.value->>'address')) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or length(coalesce(item.value->>'display_name', '')) > 200
      or (
        item.value ? 'raw'
        and item.value->'raw' is not null
        and jsonb_typeof(item.value->'raw') <> 'object'
      )
  ) then
    raise exception 'record_discovery_observations: one or more observations are invalid'
      using errcode = '22023';
  end if;

  -- Force timestamp parsing before writes so a malformed row fails the whole batch.
  perform (item.value->>'observed_at')::timestamptz
  from jsonb_array_elements(p_batch) as item(value);

  with source_domains as (
    select distinct split_part(lower(btrim(item.value->>'address')), '@', 2) as domain
    from jsonb_array_elements(p_batch) as item(value)
  ), inserted_domains as (
    insert into public.discovery_domains (domain, likely_category, confidence, decision)
    select
      domain,
      case when domain = any (
        array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]
      ) then 'free-mail (match by address)' end,
      case when domain = any (
        array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]
      ) then 'high' end,
      case when domain = any (
        array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]
      ) then 'unknown' end
    from source_domains
    where domain <> ''
    on conflict (domain) do nothing
    returning 1
  )
  select count(*)::integer into v_new_domains from inserted_domains;

  with payload as (
    select distinct on (
      lower(btrim(item.value->>'source')),
      btrim(item.value->>'source_id'),
      lower(btrim(item.value->>'address_role')),
      lower(btrim(item.value->>'address'))
    )
      lower(btrim(item.value->>'source')) as source,
      btrim(item.value->>'source_id') as source_id,
      nullif(btrim(item.value->>'source_thread_id'), '') as source_thread_id,
      lower(btrim(item.value->>'address_role')) as address_role,
      lower(btrim(item.value->>'address')) as address,
      nullif(btrim(item.value->>'display_name'), '') as display_name,
      nullif(btrim(item.value->>'idempotency_key'), '') as idempotency_key,
      coalesce(item.value->'raw', '{}'::jsonb) as raw
    from jsonb_array_elements(p_batch) as item(value)
  ), updated as (
    update public.discovery_observations observation
    set
      source_thread_id = coalesce(observation.source_thread_id, payload.source_thread_id),
      display_name = coalesce(observation.display_name, payload.display_name),
      idempotency_key = coalesce(observation.idempotency_key, payload.idempotency_key),
      raw = coalesce(observation.raw, '{}'::jsonb) || payload.raw
    from payload
    where observation.source = payload.source
      and observation.source_id = payload.source_id
      and observation.address_role = payload.address_role
      and observation.address = payload.address
      and (
        (observation.source_thread_id is null and payload.source_thread_id is not null)
        or (observation.display_name is null and payload.display_name is not null)
        or (observation.idempotency_key is null and payload.idempotency_key is not null)
        or not coalesce(observation.raw, '{}'::jsonb) @> payload.raw
      )
    returning 1
  )
  select count(*)::integer into v_updated from updated;

  with payload as (
    select
      lower(btrim(item.value->>'source')) as source,
      btrim(item.value->>'source_id') as source_id,
      nullif(btrim(item.value->>'source_thread_id'), '') as source_thread_id,
      (item.value->>'observed_at')::timestamptz as observed_at,
      lower(btrim(item.value->>'address_role')) as address_role,
      lower(btrim(item.value->>'address')) as address,
      split_part(lower(btrim(item.value->>'address')), '@', 2) as domain,
      nullif(btrim(item.value->>'display_name'), '') as display_name,
      nullif(btrim(item.value->>'idempotency_key'), '') as idempotency_key,
      coalesce(item.value->'raw', '{}'::jsonb) as raw
    from jsonb_array_elements(p_batch) as item(value)
  ), inserted as (
    insert into public.discovery_observations (
      source,
      source_id,
      source_thread_id,
      observed_at,
      address_role,
      address,
      domain,
      is_self,
      is_free_mail,
      display_name,
      idempotency_key,
      raw
    )
    select
      payload.source,
      payload.source_id,
      payload.source_thread_id,
      payload.observed_at,
      payload.address_role,
      payload.address,
      payload.domain,
      exists (
        select 1
        from public.person_emails person_email
        join public.users crm_user on crm_user.person_id = person_email.person_id
        where person_email.email_normalized = payload.address
      ),
      payload.domain = any (
        array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]
      ),
      payload.display_name,
      payload.idempotency_key,
      payload.raw
    from payload
    on conflict (source, source_id, address_role, address) do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  perform public.refresh_discovery_domain_rollups();

  return jsonb_build_object(
    'received', v_received,
    'inserted', v_inserted,
    'duplicates', greatest(v_received - v_inserted, 0),
    'updated', v_updated,
    'new_domains', v_new_domains
  );
end;
$$;

create view public.v_contact_candidates
with (security_invoker = true)
as
with grouped as (
  select
    observation.address as email,
    observation.domain,
    (
      array_agg(
        nullif(observation.display_name, '')
        order by observation.observed_at desc, observation.created_at desc
      ) filter (where nullif(observation.display_name, '') is not null)
    )[1] as display_name,
    count(*)::integer as observation_count,
    count(distinct (observation.source, observation.source_id))::integer as message_count,
    count(
      distinct coalesce(
        observation.source_thread_id,
        observation.source || ':' || observation.source_id
      )
    )::integer as thread_count,
    min(observation.observed_at) as first_seen,
    max(observation.observed_at) as last_seen,
    array_agg(distinct observation.address_role order by observation.address_role) as roles,
    array_agg(distinct observation.source order by observation.source) as sources
  from public.discovery_observations observation
  join public.discovery_domains discovery_domain
    on discovery_domain.domain = observation.domain
  where not observation.is_self
    and coalesce(discovery_domain.decision, 'unknown') <> 'noise'
  group by observation.address, observation.domain
), exact_match as (
  select
    grouped.email,
    coalesce(
      public.resolve_person_by_email(grouped.email),
      (
        select person.id
        from public.people person
        where lower(btrim(person.email)) = grouped.email
        limit 1
      )
    ) as person_id
  from grouped
)
select
  grouped.email,
  grouped.display_name,
  grouped.domain,
  grouped.observation_count,
  grouped.message_count,
  grouped.thread_count,
  grouped.first_seen,
  grouped.last_seen,
  grouped.roles,
  grouped.sources,
  discovery_domain.decision as domain_decision,
  discovery_domain.likely_category as domain_likely_category,
  discovery_domain.mapped_org_id as suggested_organization_id,
  organization.name as suggested_organization_name,
  exact_match.person_id as existing_person_id,
  existing_person.full_name as existing_person_name,
  coalesce(same_name.matches, '[]'::jsonb) as same_name_people
from grouped
join public.discovery_domains discovery_domain
  on discovery_domain.domain = grouped.domain
left join exact_match
  on exact_match.email = grouped.email
left join public.people existing_person
  on existing_person.id = exact_match.person_id
left join public.organizations organization
  on organization.id = discovery_domain.mapped_org_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'person_id', person.id,
      'full_name', person.full_name,
      'email', person.email,
      'organization_id', person.organization_id
    ) order by person.full_name, person.id
  ) as matches
  from public.people person
  where grouped.display_name is not null
    and lower(btrim(person.full_name)) = lower(btrim(grouped.display_name))
    and person.id is distinct from exact_match.person_id
) same_name on true;

create function public.promote_contact(
  p_email text,
  p_full_name text,
  p_existing_person_id uuid default null,
  p_organization_id uuid default null,
  p_title text default null,
  p_phone text default null,
  p_role text default null,
  p_notes text default null,
  p_email_label text default 'work',
  p_source text default 'gmail',
  p_created_by_actor_id uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_email text := lower(btrim(p_email));
  v_person_id uuid;
  v_exact_person_id uuid;
  v_is_primary boolean;
  v_status text;
begin
  if v_email is null
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(v_email) > 320 then
    raise exception 'promote_contact: a valid email is required' using errcode = '22023';
  end if;

  if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 200 then
    raise exception 'promote_contact: full_name must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if p_email_label is null or p_email_label <> all (
    array['work', 'personal', 'alias', 'former', 'unknown']::text[]
  ) then
    raise exception 'promote_contact: invalid email_label' using errcode = '22023';
  end if;

  if p_source is null or p_source <> all (
    array['gmail', 'calendar', 'manual', 'import', 'slack', 'otter']::text[]
  ) then
    raise exception 'promote_contact: invalid source' using errcode = '22023';
  end if;

  if p_existing_person_id is not null
     and not exists (select 1 from public.people where id = p_existing_person_id) then
    raise exception 'promote_contact: existing person % not found', p_existing_person_id
      using errcode = '23503';
  end if;

  if p_organization_id is not null
     and not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'promote_contact: organization % not found', p_organization_id
      using errcode = '23503';
  end if;

  perform public.set_audit_context(
    p_created_by_actor_id,
    p_source,
    gen_random_uuid()::text,
    'explicitly approved contact promotion',
    null,
    jsonb_build_object(
      'operation', 'promote_contact',
      'email', v_email,
      'existing_person_id', p_existing_person_id
    )
  );

  select coalesce(
    public.resolve_person_by_email(v_email),
    (
      select person.id
      from public.people person
      where lower(btrim(person.email)) = v_email
      limit 1
    )
  ) into v_exact_person_id;

  if v_exact_person_id is not null then
    if p_existing_person_id is not null and p_existing_person_id <> v_exact_person_id then
      raise exception
        'promote_contact: email collision; % already belongs to person %, not requested person %',
        v_email,
        v_exact_person_id,
        p_existing_person_id
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'status', 'existing',
      'person_id', v_exact_person_id,
      'email', v_email,
      'created_person', false,
      'attached_email', false
    );
  end if;

  if p_existing_person_id is not null then
    v_person_id := p_existing_person_id;
    v_is_primary := not exists (
      select 1
      from public.person_emails person_email
      where person_email.person_id = v_person_id
        and person_email.is_primary
    );

    begin
      insert into public.person_emails (
        person_id,
        email,
        label,
        is_primary,
        source
      ) values (
        v_person_id,
        v_email,
        p_email_label,
        v_is_primary,
        p_source
      );
    exception when unique_violation then
      select public.resolve_person_by_email(v_email) into v_exact_person_id;
      if v_exact_person_id is null then
        raise;
      end if;
      if v_exact_person_id <> v_person_id then
        raise exception
          'promote_contact: email collision; % already belongs to person %, not requested person %',
          v_email,
          v_exact_person_id,
          v_person_id
          using errcode = '23505';
      end if;
      return jsonb_build_object(
        'status', 'existing',
        'person_id', v_person_id,
        'email', v_email,
        'created_person', false,
        'attached_email', false
      );
    end;

    v_status := case when v_is_primary then 'attached_primary' else 'attached_alias' end;
    return jsonb_build_object(
      'status', v_status,
      'person_id', v_person_id,
      'email', v_email,
      'created_person', false,
      'attached_email', true,
      'is_primary', v_is_primary
    );
  end if;

  begin
    insert into public.people (
      organization_id,
      full_name,
      title,
      phone,
      role,
      notes
    ) values (
      p_organization_id,
      btrim(p_full_name),
      nullif(btrim(p_title), ''),
      nullif(btrim(p_phone), ''),
      nullif(btrim(p_role), ''),
      nullif(btrim(p_notes), '')
    )
    returning id into v_person_id;

    insert into public.person_emails (
      person_id,
      email,
      label,
      is_primary,
      source
    ) values (
      v_person_id,
      v_email,
      p_email_label,
      true,
      p_source
    );
  exception when unique_violation then
    select coalesce(
      public.resolve_person_by_email(v_email),
      (
        select person.id
        from public.people person
        where lower(btrim(person.email)) = v_email
        limit 1
      )
    ) into v_exact_person_id;
    if v_exact_person_id is null then
      raise;
    end if;
    return jsonb_build_object(
      'status', 'existing',
      'person_id', v_exact_person_id,
      'email', v_email,
      'created_person', false,
      'attached_email', false
    );
  end;

  return jsonb_build_object(
    'status', 'created',
    'person_id', v_person_id,
    'email', v_email,
    'created_person', true,
    'attached_email', true,
    'is_primary', true
  );
end;
$$;

revoke all on function public.promote_contact(
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public;
