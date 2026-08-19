-- Address-level discovery classification.
--
-- Organization/domain identity and mailbox kind are separate facts. For
-- example, evan@cintrifuse.com can be a person while info@cintrifuse.com is a
-- shared inbox. Manual classifications override conservative local-part
-- suggestions and never create, merge, or move CRM people.
--
-- Rollback: restore v_contact_candidates and
-- v_validate_audit_trigger_coverage from 0003/0001, then drop
-- classify_contact_address(text, text, text, text, uuid) and
-- contact_address_classifications. Classification rows are review metadata;
-- rollback does not affect people, aliases, observations, or organizations.

create table public.contact_address_classifications (
  id uuid default gen_random_uuid() not null primary key,
  email text not null unique,
  category text not null,
  source text default 'manual'::text not null,
  reason text,
  created_by_actor_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint contact_address_classifications_email_normalized check (
    email = lower(btrim(email))
    and length(email) <= 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint contact_address_classifications_category_check check (
    category = any (
      array[
        'person',
        'shared_inbox',
        'marketing',
        'notification',
        'automated',
        'unknown'
      ]::text[]
    )
  ),
  constraint contact_address_classifications_source_check check (
    source = any (array['manual', 'agent', 'rule', 'import']::text[])
  ),
  constraint contact_address_classifications_reason_length check (
    reason is null or length(reason) <= 1000
  ),
  constraint contact_address_classifications_actor_fkey foreign key (created_by_actor_id)
    references public.actors(id) on delete set null
);

create index idx_contact_address_classifications_category
  on public.contact_address_classifications using btree (category, updated_at desc);

create trigger trg_contact_address_classifications_updated
before update on public.contact_address_classifications
for each row execute function public.set_updated_at();

create trigger trg_audit_row_change
after insert or delete or update on public.contact_address_classifications
for each row execute function private.audit_row_change();

create function public.classify_contact_address(
  p_email text,
  p_category text,
  p_source text default 'manual',
  p_reason text default null,
  p_created_by_actor_id uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_email text := lower(btrim(p_email));
  v_before public.contact_address_classifications%rowtype;
  v_after public.contact_address_classifications%rowtype;
  v_status text;
begin
  if v_email is null
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(v_email) > 320 then
    raise exception 'classify_contact_address: a valid email is required'
      using errcode = '22023';
  end if;

  if p_category is null or p_category <> all (
    array['person', 'shared_inbox', 'marketing', 'notification', 'automated', 'unknown']::text[]
  ) then
    raise exception 'classify_contact_address: invalid category'
      using errcode = '22023';
  end if;

  if p_source is null or p_source <> all (
    array['manual', 'agent', 'rule', 'import']::text[]
  ) then
    raise exception 'classify_contact_address: invalid source'
      using errcode = '22023';
  end if;

  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'classify_contact_address: reason must not exceed 1000 characters'
      using errcode = '22023';
  end if;

  select *
  into v_before
  from public.contact_address_classifications classification
  where classification.email = v_email;

  v_status := case
    when v_before.id is null then 'created'
    when v_before.category = p_category
      and v_before.source = p_source
      and v_before.reason is not distinct from nullif(btrim(p_reason), '')
      then 'unchanged'
    else 'updated'
  end;

  perform public.set_audit_context(
    p_created_by_actor_id,
    p_source,
    gen_random_uuid()::text,
    coalesce(nullif(btrim(p_reason), ''), 'contact address classification'),
    null,
    jsonb_build_object(
      'operation', 'classify_contact_address',
      'email', v_email,
      'category', p_category
    )
  );

  insert into public.contact_address_classifications (
    email,
    category,
    source,
    reason,
    created_by_actor_id
  ) values (
    v_email,
    p_category,
    p_source,
    nullif(btrim(p_reason), ''),
    p_created_by_actor_id
  )
  on conflict (email) do update
  set
    category = excluded.category,
    source = excluded.source,
    reason = excluded.reason,
    created_by_actor_id = coalesce(
      excluded.created_by_actor_id,
      contact_address_classifications.created_by_actor_id
    )
  where (
    contact_address_classifications.category,
    contact_address_classifications.source,
    contact_address_classifications.reason
  ) is distinct from (
    excluded.category,
    excluded.source,
    excluded.reason
  );

  select *
  into strict v_after
  from public.contact_address_classifications classification
  where classification.email = v_email;

  return jsonb_build_object(
    'status', v_status,
    'classification_id', v_after.id,
    'email', v_after.email,
    'previous_category', v_before.category,
    'category', v_after.category,
    'source', v_after.source,
    'reason', v_after.reason,
    'updated_at', v_after.updated_at
  );
end;
$$;

create or replace view public.v_contact_candidates
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
    and coalesce(discovery_domain.decision, 'unknown') <> all (array['noise', 'internal']::text[])
    and split_part(observation.address, '@', 1) <> all (
      array['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster']::text[]
    )
    and split_part(observation.address, '@', 1) not like '%noreply%'
    and split_part(observation.address, '@', 1) not like '%no-reply%'
    and split_part(observation.address, '@', 1) not like '%donotreply%'
    and split_part(observation.address, '@', 1) not like '%do-not-reply%'
  group by observation.address, observation.domain
), suggested as (
  select
    grouped.*,
    case
      when split_part(grouped.email, '@', 1) = any (
        array['notify', 'notification', 'notifications', 'alerts', 'alert']::text[]
      ) then 'notification'
      when split_part(grouped.email, '@', 1) = any (
        array['newsletter', 'marketing', 'campaign', 'campaigns', 'promotions', 'promo']::text[]
      ) then 'marketing'
      when split_part(grouped.email, '@', 1) = any (
        array[
          'info', 'hello', 'contact', 'support', 'sales', 'team', 'admin',
          'billing', 'itbilling', 'account', 'events', 'event', 'leadandlearn',
          'buildready', 'travel.meetings'
        ]::text[]
      ) then 'shared_inbox'
      when split_part(grouped.email, '@', 1) = any (
        array['tgateway', 'apple_guest_registration', 'mailer-daemon', 'postmaster']::text[]
      )
        or grouped.domain like 'calendar-server.bounces.%'
        or grouped.domain like 'mailer.%'
        or grouped.domain like 'feedback.%'
        then 'automated'
      else 'unknown'
    end as suggested_address_category
  from grouped
), exact_match as (
  select
    suggested.email,
    coalesce(
      public.resolve_person_by_email(suggested.email),
      (
        select person.id
        from public.people person
        where lower(btrim(person.email)) = suggested.email
        limit 1
      )
    ) as person_id
  from suggested
)
select
  suggested.email,
  suggested.display_name,
  suggested.domain,
  suggested.observation_count,
  suggested.message_count,
  suggested.thread_count,
  suggested.first_seen,
  suggested.last_seen,
  suggested.roles,
  suggested.sources,
  discovery_domain.decision as domain_decision,
  discovery_domain.likely_category as domain_likely_category,
  discovery_domain.mapped_org_id as suggested_organization_id,
  organization.name as suggested_organization_name,
  exact_match.person_id as existing_person_id,
  existing_person.full_name as existing_person_name,
  coalesce(same_name.matches, '[]'::jsonb) as same_name_people,
  suggested.suggested_address_category,
  coalesce(classification.category, suggested.suggested_address_category) as address_category,
  case when classification.id is null then 'heuristic' else classification.source end as classification_source,
  classification.reason as classification_reason,
  classification.updated_at as classification_updated_at
from suggested
join public.discovery_domains discovery_domain
  on discovery_domain.domain = suggested.domain
left join public.contact_address_classifications classification
  on classification.email = suggested.email
left join exact_match
  on exact_match.email = suggested.email
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
  where suggested.display_name is not null
    and lower(btrim(person.full_name)) = lower(btrim(suggested.display_name))
    and person.id is distinct from exact_match.person_id
) same_name on true;

create or replace view public.v_validate_audit_trigger_coverage
with (security_invoker = true)
as
with expected(table_name) as (
  values
    ('organizations'::text),
    ('people'::text),
    ('person_emails'::text),
    ('users'::text),
    ('agents'::text),
    ('actors'::text),
    ('engagements'::text),
    ('threads'::text),
    ('interactions'::text),
    ('deliverables'::text),
    ('next_actions'::text),
    ('engagement_finance_events'::text),
    ('engagement_people'::text),
    ('interaction_participants'::text),
    ('deliverable_people'::text),
    ('discovery_domains'::text),
    ('ingest_batches'::text),
    ('contact_address_classifications'::text)
), actual as (
  select
    triggers.event_object_table as table_name,
    bool_or(triggers.event_manipulation = 'INSERT') as has_insert,
    bool_or(triggers.event_manipulation = 'UPDATE') as has_update,
    bool_or(triggers.event_manipulation = 'DELETE') as has_delete
  from information_schema.triggers
  where triggers.trigger_schema = 'public'
    and triggers.trigger_name = 'trg_audit_row_change'
  group by triggers.event_object_table
)
select
  expected.table_name,
  case
    when actual.table_name is null then 'missing audit trigger'
    when not actual.has_insert then 'missing insert audit trigger'
    when not actual.has_update then 'missing update audit trigger'
    when not actual.has_delete then 'missing delete audit trigger'
    else null
  end as issue
from expected
left join actual using (table_name)
where actual.table_name is null
  or not actual.has_insert
  or not actual.has_update
  or not actual.has_delete
union all
select
  actual.table_name,
  'unexpected audit trigger' as issue
from actual
left join expected using (table_name)
where expected.table_name is null;
