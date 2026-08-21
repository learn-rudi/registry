-- Least-privilege, privacy-minimized discovery run boundary.
--
-- Invariants:
--   * migrations 0001 through 0004 remain immutable;
--   * discovery pages contain only scoped opaque identity, observation time,
--     address role, normalized address, bounded display name, and optional
--     recurrence identity;
--   * discovery never creates, updates, lists, classifies, or promotes people;
--   * page replay is idempotent only when page key and canonical content match;
--   * finalization is count-only audited and leaves people/person_emails counts
--     identical to the counts captured when the run was first recorded;
--   * provider checkpoints remain adapter-owned and are not stored here.
--
-- Role provisioning is deliberately deployment-gated. This migration creates
-- no roles and grants no capability. Proposed group-role names are
-- rudi_crm_discovery (execute record/finalize only) and rudi_crm_promotion
-- (execute explicitly approved classify/promote only). A human-reviewed
-- deployment must grant schema USAGE and exact function EXECUTE as appropriate.
--
-- Rollback: revoke any deployment-time role grants first, drop the two
-- discovery functions and deterministic helper, then drop the four discovery
-- run tables. Restore classify/promote SECURITY INVOKER only if the deployment
-- also restores the direct table privileges those functions previously used.

create table public.discovery_runs (
  id uuid default gen_random_uuid() not null primary key,
  schema_version text not null,
  source text not null,
  account_scope text not null,
  calendar_scope text,
  scope_key text generated always as (coalesce(calendar_scope, '')) stored,
  run_key text not null,
  cutoff timestamp with time zone not null,
  status text default 'open' not null,
  expected_pages integer,
  expected_records integer,
  noise_record_count integer,
  people_count_before bigint not null,
  person_emails_count_before bigint not null,
  people_state_sha256_before text not null,
  person_emails_state_sha256_before text not null,
  people_count_after bigint,
  person_emails_count_after bigint,
  people_state_sha256_after text,
  person_emails_state_sha256_after text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  finalized_at timestamp with time zone,
  constraint discovery_runs_schema_version_check check (schema_version = '1'),
  constraint discovery_runs_source_check check (source = any (array['gmail', 'calendar']::text[])),
  constraint discovery_runs_account_check check (
    account_scope = lower(btrim(account_scope))
    and length(account_scope) <= 320
    and account_scope ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint discovery_runs_scope_check check (
    (source = 'gmail' and calendar_scope is null)
    or (
      source = 'calendar'
      and calendar_scope is not null
      and length(btrim(calendar_scope)) between 1 and 512
      and calendar_scope = btrim(calendar_scope)
    )
  ),
  constraint discovery_runs_key_check check (run_key ~ '^[0-9a-f]{64}$'),
  constraint discovery_runs_status_check check (status = any (array['open', 'finalized']::text[])),
  constraint discovery_runs_expected_pages_check check (expected_pages is null or expected_pages between 1 and 500),
  constraint discovery_runs_expected_records_check check (expected_records is null or expected_records between 0 and 250000),
  constraint discovery_runs_noise_count_check check (noise_record_count is null or noise_record_count >= 0),
  constraint discovery_runs_state_sha256_check check (
    people_state_sha256_before ~ '^[0-9a-f]{64}$'
    and person_emails_state_sha256_before ~ '^[0-9a-f]{64}$'
    and (people_state_sha256_after is null or people_state_sha256_after ~ '^[0-9a-f]{64}$')
    and (person_emails_state_sha256_after is null or person_emails_state_sha256_after ~ '^[0-9a-f]{64}$')
  ),
  constraint discovery_runs_finalize_state_check check (
    (status = 'open' and finalized_at is null)
    or (
      status = 'finalized'
      and finalized_at is not null
      and expected_pages is not null
      and expected_records is not null
      and people_count_after is not null
      and person_emails_count_after is not null
      and people_state_sha256_after is not null
      and person_emails_state_sha256_after is not null
    )
  ),
  constraint discovery_runs_scope_key_unique unique (source, account_scope, scope_key, run_key)
);

create table public.discovery_pages (
  run_id uuid not null references public.discovery_runs(id) on delete cascade,
  page_number integer not null,
  page_key text not null,
  content_sha256 text not null,
  record_count integer not null,
  recorded_by_session_user text not null,
  recorded_by_application text not null,
  created_at timestamp with time zone default now() not null,
  primary key (run_id, page_number),
  unique (run_id, page_key),
  constraint discovery_pages_number_check check (page_number between 1 and 500),
  constraint discovery_pages_key_check check (page_key ~ '^[0-9a-f]{64}$'),
  constraint discovery_pages_content_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint discovery_pages_record_count_check check (record_count between 0 and 500),
  constraint discovery_pages_session_user_check check (length(btrim(recorded_by_session_user)) between 1 and 200),
  constraint discovery_pages_application_check check (length(recorded_by_application) <= 200)
);

create table public.discovery_run_observations (
  run_id uuid not null,
  page_number integer not null,
  source text not null,
  account_scope text not null,
  calendar_scope text,
  resource_key text not null,
  observed_at timestamp with time zone not null,
  address_role text not null,
  address text not null,
  display_name text,
  recurrence_key text,
  created_at timestamp with time zone default now() not null,
  primary key (run_id, page_number, resource_key, address_role, address),
  foreign key (run_id, page_number)
    references public.discovery_pages(run_id, page_number) on delete cascade,
  constraint discovery_run_observations_source_check check (source = any (array['gmail', 'calendar']::text[])),
  constraint discovery_run_observations_account_check check (
    account_scope = lower(btrim(account_scope))
    and length(account_scope) <= 320
    and account_scope ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint discovery_run_observations_scope_check check (
    (source = 'gmail' and calendar_scope is null)
    or (source = 'calendar' and calendar_scope is not null and length(calendar_scope) between 1 and 512)
  ),
  constraint discovery_run_observations_resource_check check (resource_key ~ '^[0-9a-f]{64}$'),
  constraint discovery_run_observations_role_check check (
    (source = 'gmail' and address_role = any (array['from', 'to', 'cc']::text[]))
    or (source = 'calendar' and address_role = any (array['organizer', 'attendee']::text[]))
  ),
  constraint discovery_run_observations_address_check check (
    address = lower(btrim(address))
    and length(address) <= 320
    and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint discovery_run_observations_display_name_check check (
    display_name is null
    or (
      length(display_name) between 1 and 200
      and display_name = btrim(display_name)
      and display_name !~ '[\r\n]'
    )
  ),
  constraint discovery_run_observations_recurrence_check check (
    recurrence_key is null or recurrence_key ~ '^[0-9a-f]{64}$'
  )
);

create index idx_discovery_run_observations_address
  on public.discovery_run_observations (address, observed_at desc);

create table public.discovery_run_audit (
  id uuid default gen_random_uuid() not null primary key,
  run_id uuid not null references public.discovery_runs(id) on delete cascade,
  action text not null,
  page_number integer,
  page_count integer not null,
  record_count integer not null,
  noise_record_count integer not null,
  session_user_name text not null,
  application_name text not null,
  occurred_at timestamp with time zone default now() not null,
  constraint discovery_run_audit_action_check check (action = any (array['record_page', 'finalize']::text[])),
  constraint discovery_run_audit_page_check check (page_number is null or page_number between 1 and 500),
  constraint discovery_run_audit_counts_check check (
    page_count between 0 and 500
    and record_count between 0 and 250000
    and noise_record_count between 0 and 250000
  ),
  constraint discovery_run_audit_session_user_check check (length(btrim(session_user_name)) between 1 and 200),
  constraint discovery_run_audit_application_check check (length(application_name) <= 200)
);

alter table public.contact_address_classifications enable row level security;
alter table public.discovery_runs enable row level security;
alter table public.discovery_pages enable row level security;
alter table public.discovery_run_observations enable row level security;
alter table public.discovery_run_audit enable row level security;

create trigger trg_discovery_runs_updated
before update on public.discovery_runs
for each row execute function public.set_updated_at();

create function public.discovery_address_is_noise(p_address text)
returns boolean
language sql
immutable
strict
set search_path to 'pg_catalog', 'public'
as $$
  select split_part(lower(btrim(p_address)), '@', 1)
    ~ '^(no-?reply|do-?not-?reply|mailer-daemon|notifications?|automated|bounce|postmaster)([+._-].*)?$'
$$;

create function public.record_discovery_page(
  p_schema_version text,
  p_source text,
  p_account_scope text,
  p_calendar_scope text,
  p_run_key text,
  p_page_number integer,
  p_page_key text,
  p_cutoff timestamp with time zone,
  p_observations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set statement_timeout to '30s'
set lock_timeout to '5s'
as $$
declare
  v_account_scope text := lower(btrim(p_account_scope));
  v_calendar_scope text := nullif(btrim(p_calendar_scope), '');
  v_scope_key text;
  v_run public.discovery_runs%rowtype;
  v_existing_page public.discovery_pages%rowtype;
  v_content_sha256 text;
  v_record_count integer;
  v_application_name text := left(coalesce(current_setting('application_name', true), ''), 200);
begin
  if p_schema_version is distinct from '1' then
    raise exception 'record_discovery_page: unsupported schema_version' using errcode = '22023';
  end if;
  if p_source is null or p_source <> all (array['gmail', 'calendar']::text[]) then
    raise exception 'record_discovery_page: invalid source' using errcode = '22023';
  end if;
  if v_account_scope is null
     or length(v_account_scope) > 320
     or v_account_scope !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'record_discovery_page: invalid account_scope' using errcode = '22023';
  end if;
  if (p_source = 'gmail' and v_calendar_scope is not null)
     or (p_source = 'calendar' and (v_calendar_scope is null or length(v_calendar_scope) > 512)) then
    raise exception 'record_discovery_page: invalid calendar_scope' using errcode = '22023';
  end if;
  if p_run_key is null or p_run_key !~ '^[0-9a-f]{64}$'
     or p_page_key is null or p_page_key !~ '^[0-9a-f]{64}$' then
    raise exception 'record_discovery_page: run_key and page_key must be lowercase SHA-256 hex' using errcode = '22023';
  end if;
  if p_page_number is null or p_page_number not between 1 and 500 then
    raise exception 'record_discovery_page: page_number must be between 1 and 500' using errcode = '22023';
  end if;
  if p_cutoff is null then
    raise exception 'record_discovery_page: cutoff is required' using errcode = '22023';
  end if;
  if p_observations is null or jsonb_typeof(p_observations) <> 'array' then
    raise exception 'record_discovery_page: observations must be a JSON array' using errcode = '22023';
  end if;

  v_record_count := jsonb_array_length(p_observations);
  if v_record_count > 500 then
    raise exception 'record_discovery_page: observations must contain at most 500 records' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_observations) as observation(value)
    where jsonb_typeof(observation.value) <> 'object'
      or not (observation.value ?& array['resource_key', 'observed_at', 'address_role', 'address'])
      or exists (
        select 1
        from jsonb_object_keys(observation.value) as field(name)
        where field.name <> all (
          array['resource_key', 'observed_at', 'address_role', 'address', 'display_name', 'recurrence_key']::text[]
        )
      )
      or jsonb_typeof(observation.value->'resource_key') <> 'string'
      or jsonb_typeof(observation.value->'observed_at') <> 'string'
      or jsonb_typeof(observation.value->'address_role') <> 'string'
      or jsonb_typeof(observation.value->'address') <> 'string'
      or (
        observation.value ? 'display_name'
        and observation.value->'display_name' <> 'null'::jsonb
        and jsonb_typeof(observation.value->'display_name') <> 'string'
      )
      or (
        observation.value ? 'recurrence_key'
        and observation.value->'recurrence_key' <> 'null'::jsonb
        and jsonb_typeof(observation.value->'recurrence_key') <> 'string'
      )
  ) then
    raise exception 'record_discovery_page: observation schema is closed and content fields are forbidden' using errcode = '22023';
  end if;

  begin
    if exists (
      with payload as (
        select
          item.ordinality,
          item.value->>'resource_key' as resource_key,
          (item.value->>'observed_at')::timestamptz as observed_at,
          item.value->>'address_role' as address_role,
          lower(btrim(item.value->>'address')) as address,
          nullif(btrim(item.value->>'display_name'), '') as display_name,
          nullif(item.value->>'recurrence_key', '') as recurrence_key
        from jsonb_array_elements(p_observations) with ordinality as item(value, ordinality)
      ), ordered as (
        select
          payload.*,
          lag(row(payload.observed_at, payload.resource_key, payload.address_role, payload.address))
            over (order by payload.ordinality) as previous_key
        from payload
      )
      select 1
      from ordered
      where resource_key !~ '^[0-9a-f]{64}$'
        or observed_at > p_cutoff
        or (
          p_source = 'gmail'
          and address_role <> all (array['from', 'to', 'cc']::text[])
        )
        or (
          p_source = 'calendar'
          and address_role <> all (array['organizer', 'attendee']::text[])
        )
        or length(address) > 320
        or address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        or (display_name is not null and (length(display_name) > 200 or display_name ~ '[\r\n]'))
        or (recurrence_key is not null and recurrence_key !~ '^[0-9a-f]{64}$')
        or previous_key >= row(observed_at, resource_key, address_role, address)
    ) then
      raise exception 'record_discovery_page: observations are invalid or not deterministically ordered' using errcode = '22023';
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'record_discovery_page: observed_at must be a valid timestamp with offset' using errcode = '22023';
  end;

  v_scope_key := coalesce(v_calendar_scope, '');
  v_content_sha256 := encode(
    sha256(
      convert_to(
        jsonb_build_object(
          'schema_version', p_schema_version,
          'source', p_source,
          'account_scope', v_account_scope,
          'calendar_scope', v_calendar_scope,
          'run_key', p_run_key,
          'page_number', p_page_number,
          'page_key', p_page_key,
          'cutoff', p_cutoff,
          'observations', p_observations
        )::text,
        'utf8'
      )
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(chr(31), p_source, v_account_scope, v_scope_key, p_run_key), 0)
  );
  select * into v_run
  from public.discovery_runs
  where source = p_source
    and account_scope = v_account_scope
    and scope_key = v_scope_key
    and run_key = p_run_key
  for update;

  if v_run.id is null then
    insert into public.discovery_runs (
      schema_version,
      source,
      account_scope,
      calendar_scope,
      run_key,
      cutoff,
      people_count_before,
      person_emails_count_before,
      people_state_sha256_before,
      person_emails_state_sha256_before
    ) values (
      p_schema_version,
      p_source,
      v_account_scope,
      v_calendar_scope,
      p_run_key,
      p_cutoff,
      (select count(*) from public.people),
      (select count(*) from public.person_emails),
      encode(sha256(convert_to(coalesce(
        (select jsonb_agg(to_jsonb(person) order by person.id)::text from public.people person),
        '[]'
      ), 'utf8')), 'hex'),
      encode(sha256(convert_to(coalesce(
        (select jsonb_agg(to_jsonb(person_email) order by person_email.id)::text
         from public.person_emails person_email),
        '[]'
      ), 'utf8')), 'hex')
    ) returning * into strict v_run;
  elsif v_run.schema_version <> p_schema_version
     or v_run.cutoff <> p_cutoff then
    raise exception 'record_discovery_page: run scope or cutoff mismatch' using errcode = '22023';
  end if;

  select * into v_existing_page
  from public.discovery_pages
  where run_id = v_run.id
    and page_number = p_page_number;
  if v_existing_page.run_id is not null then
    if v_existing_page.page_key = p_page_key
       and v_existing_page.content_sha256 = v_content_sha256
       and v_existing_page.record_count = v_record_count then
      return jsonb_build_object('accepted', true, 'replayed', true);
    end if;
    raise exception 'record_discovery_page: page replay content mismatch' using errcode = '23505';
  end if;
  if v_run.status <> 'open' then
    raise exception 'record_discovery_page: finalized runs cannot accept new pages' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.discovery_pages
    where run_id = v_run.id and page_key = p_page_key
  ) then
    raise exception 'record_discovery_page: page_key already belongs to another page' using errcode = '23505';
  end if;

  insert into public.discovery_pages (
    run_id,
    page_number,
    page_key,
    content_sha256,
    record_count,
    recorded_by_session_user,
    recorded_by_application
  ) values (
    v_run.id,
    p_page_number,
    p_page_key,
    v_content_sha256,
    v_record_count,
    session_user,
    v_application_name
  );

  insert into public.discovery_run_observations (
    run_id,
    page_number,
    source,
    account_scope,
    calendar_scope,
    resource_key,
    observed_at,
    address_role,
    address,
    display_name,
    recurrence_key
  )
  select
    v_run.id,
    p_page_number,
    p_source,
    v_account_scope,
    v_calendar_scope,
    item.value->>'resource_key',
    (item.value->>'observed_at')::timestamptz,
    item.value->>'address_role',
    lower(btrim(item.value->>'address')),
    nullif(btrim(item.value->>'display_name'), ''),
    nullif(item.value->>'recurrence_key', '')
  from jsonb_array_elements(p_observations) as item(value);

  insert into public.discovery_run_audit (
    run_id,
    action,
    page_number,
    page_count,
    record_count,
    noise_record_count,
    session_user_name,
    application_name
  ) values (
    v_run.id,
    'record_page',
    p_page_number,
    1,
    v_record_count,
    0,
    session_user,
    v_application_name
  );

  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

create function public.finalize_discovery_run(
  p_schema_version text,
  p_source text,
  p_account_scope text,
  p_calendar_scope text,
  p_run_key text,
  p_cutoff timestamp with time zone,
  p_expected_pages integer,
  p_expected_records integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
set statement_timeout to '30s'
set lock_timeout to '5s'
as $$
declare
  v_account_scope text := lower(btrim(p_account_scope));
  v_calendar_scope text := nullif(btrim(p_calendar_scope), '');
  v_run public.discovery_runs%rowtype;
  v_page_count integer;
  v_page_record_count integer;
  v_observation_count integer;
  v_noise_count integer;
  v_people_count bigint;
  v_person_emails_count bigint;
  v_people_state_sha256 text;
  v_person_emails_state_sha256 text;
  v_application_name text := left(coalesce(current_setting('application_name', true), ''), 200);
  v_expected_observation_columns constant text[] := array[
    'account_scope', 'address', 'address_role', 'calendar_scope', 'created_at',
    'display_name', 'observed_at', 'page_number', 'recurrence_key', 'resource_key',
    'run_id', 'source'
  ]::text[];
begin
  if p_schema_version is distinct from '1'
     or p_source is null or p_source <> all (array['gmail', 'calendar']::text[])
     or v_account_scope is null
     or v_account_scope !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_run_key is null or p_run_key !~ '^[0-9a-f]{64}$'
     or p_cutoff is null
     or p_expected_pages is null or p_expected_pages not between 1 and 500
     or p_expected_records is null or p_expected_records not between 0 and 250000
     or (p_source = 'gmail' and v_calendar_scope is not null)
     or (p_source = 'calendar' and v_calendar_scope is null) then
    raise exception 'finalize_discovery_run: invalid run contract' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(concat_ws(chr(31), p_source, v_account_scope, coalesce(v_calendar_scope, ''), p_run_key), 0)
  );
  select * into v_run
  from public.discovery_runs
  where source = p_source
    and account_scope = v_account_scope
    and scope_key = coalesce(v_calendar_scope, '')
    and run_key = p_run_key
  for update;
  if v_run.id is null then
    raise exception 'finalize_discovery_run: run not found' using errcode = 'P0002';
  end if;
  if v_run.schema_version <> p_schema_version or v_run.cutoff <> p_cutoff then
    raise exception 'finalize_discovery_run: run scope or cutoff mismatch' using errcode = '22023';
  end if;
  if v_run.status = 'finalized' then
    if v_run.expected_pages = p_expected_pages
       and v_run.expected_records = p_expected_records
       and v_run.people_count_before = v_run.people_count_after
       and v_run.person_emails_count_before = v_run.person_emails_count_after
       and v_run.people_state_sha256_before = v_run.people_state_sha256_after
       and v_run.person_emails_state_sha256_before = v_run.person_emails_state_sha256_after then
      return jsonb_build_object('finalized', true, 'replayed', true);
    end if;
    raise exception 'finalize_discovery_run: finalized replay mismatch' using errcode = '23505';
  end if;

  select count(*)::integer, coalesce(sum(record_count), 0)::integer
  into v_page_count, v_page_record_count
  from public.discovery_pages
  where run_id = v_run.id;
  select count(*)::integer into v_observation_count
  from public.discovery_run_observations
  where run_id = v_run.id;
  if v_page_count <> p_expected_pages
     or v_page_record_count <> p_expected_records
     or v_observation_count <> p_expected_records
     or exists (
       select 1
       from generate_series(1, p_expected_pages) as expected(page_number)
       left join public.discovery_pages page
         on page.run_id = v_run.id and page.page_number = expected.page_number
       where page.run_id is null
     ) then
    raise exception 'finalize_discovery_run: expected page or record set is incomplete' using errcode = '55000';
  end if;

  if (
    select array_agg(column_name::text order by column_name)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'discovery_run_observations'
  ) is distinct from v_expected_observation_columns then
    raise exception 'finalize_discovery_run: discovery observation schema drift detected' using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.discovery_run_observations observation
    where observation.run_id = v_run.id
      and (
        observation.source <> v_run.source
        or observation.account_scope <> v_run.account_scope
        or observation.calendar_scope is distinct from v_run.calendar_scope
        or observation.observed_at > v_run.cutoff
      )
  ) then
    raise exception 'finalize_discovery_run: privacy or scope validator failed' using errcode = '55000';
  end if;

  select count(*) into v_people_count from public.people;
  select count(*) into v_person_emails_count from public.person_emails;
  select encode(sha256(convert_to(coalesce(
    jsonb_agg(to_jsonb(person) order by person.id)::text,
    '[]'
  ), 'utf8')), 'hex') into v_people_state_sha256
  from public.people person;
  select encode(sha256(convert_to(coalesce(
    jsonb_agg(to_jsonb(person_email) order by person_email.id)::text,
    '[]'
  ), 'utf8')), 'hex') into v_person_emails_state_sha256
  from public.person_emails person_email;
  if v_people_count <> v_run.people_count_before
     or v_person_emails_count <> v_run.person_emails_count_before
     or v_people_state_sha256 <> v_run.people_state_sha256_before
     or v_person_emails_state_sha256 <> v_run.person_emails_state_sha256_before then
    raise exception 'finalize_discovery_run: no-promotion invariant failed' using errcode = '55000';
  end if;

  select count(*)::integer into v_noise_count
  from public.discovery_run_observations observation
  where observation.run_id = v_run.id
    and public.discovery_address_is_noise(observation.address);

  update public.discovery_runs
  set
    status = 'finalized',
    expected_pages = p_expected_pages,
    expected_records = p_expected_records,
    noise_record_count = v_noise_count,
    people_count_after = v_people_count,
    person_emails_count_after = v_person_emails_count,
    people_state_sha256_after = v_people_state_sha256,
    person_emails_state_sha256_after = v_person_emails_state_sha256,
    finalized_at = now()
  where id = v_run.id;

  insert into public.discovery_run_audit (
    run_id,
    action,
    page_number,
    page_count,
    record_count,
    noise_record_count,
    session_user_name,
    application_name
  ) values (
    v_run.id,
    'finalize',
    null,
    p_expected_pages,
    p_expected_records,
    v_noise_count,
    session_user,
    v_application_name
  );

  return jsonb_build_object('finalized', true, 'replayed', false);
end;
$$;

-- Existing approval/classification mutators become safe function-only
-- capabilities for separately provisioned roles. Their existing validation and
-- audit context remain intact; fixed search paths prevent object shadowing.
alter function public.promote_contact(
  text, text, uuid, uuid, text, text, text, text, text, text, uuid
) security definer;
alter function public.promote_contact(
  text, text, uuid, uuid, text, text, text, text, text, text, uuid
) set search_path to 'pg_catalog', 'public';
alter function public.classify_contact_address(text, text, text, text, uuid)
  security definer;
alter function public.classify_contact_address(text, text, text, text, uuid)
  set search_path to 'pg_catalog', 'public';

-- PUBLIC has no schema, table, sequence, or function capability. PostgreSQL
-- group-role grants, if approved, must be exact and deployment-owned.
revoke all on schema public from public;
revoke all on schema private from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
revoke all on all tables in schema private from public;
revoke all on all functions in schema private from public;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema private revoke all on tables from public;
alter default privileges in schema private revoke all on sequences from public;
alter default privileges in schema private revoke execute on functions from public;
