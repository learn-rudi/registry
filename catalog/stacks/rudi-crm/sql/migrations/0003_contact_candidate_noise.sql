-- Candidate-level automated-address filtering and mixed-domain heuristic safety.
-- A single no-reply sender must never classify every human address at the same
-- domain as noise.

-- Correct only the deterministic classification written by the old heuristic:
-- automated/no-reply domains that also contain a human-like address return to
-- review. Explicit/manual noise decisions with other categories are untouched.
update public.discovery_domains discovery_domain
set
  decision = 'unknown',
  likely_category = 'possible client/prospect',
  confidence = 'medium',
  updated_at = now()
where discovery_domain.mapped_org_id is null
  and discovery_domain.decision = 'noise'
  and discovery_domain.likely_category = 'automated/no-reply'
  and exists (
    select 1
    from public.discovery_observations observation
    where observation.domain = discovery_domain.domain
      and not observation.is_self
      and split_part(observation.address, '@', 1) <> all (
        array['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster']::text[]
      )
      and split_part(observation.address, '@', 1) not like '%noreply%'
      and split_part(observation.address, '@', 1) not like '%no-reply%'
      and split_part(observation.address, '@', 1) not like '%donotreply%'
      and split_part(observation.address, '@', 1) not like '%do-not-reply%'
  );

create or replace function public.apply_discovery_domain_heuristics()
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_updated integer;
begin
  with signals as (
    select
      discovery_domain.domain,
      coalesce(
        bool_and(
          split_part(observation.address, '@', 1) = any (
            array['noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster']::text[]
          )
          or split_part(observation.address, '@', 1) like '%noreply%'
          or split_part(observation.address, '@', 1) like '%no-reply%'
          or split_part(observation.address, '@', 1) like '%donotreply%'
          or split_part(observation.address, '@', 1) like '%do-not-reply%'
        ) filter (where not observation.is_self),
        false
      ) as only_no_reply,
      coalesce(
        bool_and(
          split_part(observation.address, '@', 1) = any (
            array['news', 'newsletter', 'marketing', 'conference', 'events', 'hello', 'yourteam']::text[]
          )
        ) filter (where not observation.is_self),
        false
      ) as only_marketing_localpart,
      count(distinct observation.address) filter (where not observation.is_self) as address_count,
      count(distinct observation.source_id) filter (where not observation.is_self) as message_count
    from public.discovery_domains discovery_domain
    left join public.discovery_observations observation
      on observation.domain = discovery_domain.domain
    where discovery_domain.mapped_org_id is null
      and (discovery_domain.decision is null or discovery_domain.decision = 'unknown')
    group by discovery_domain.domain
  ), suggestions as (
    select
      domain,
      case
        when domain = any (array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[])
          then 'free-mail (match by address)'
        when domain in ('substack.com') then 'newsletter'
        when domain in ('linkedin.com') then 'social/newsletter'
        when domain in ('glassdoor.com') then 'job/community notification'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'job alert'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' or domain in ('creativemarket.com') then 'retail marketing'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'travel marketing'
        when domain in ('plans.eventbrite.com', 'scorevolunteer.org', 'mail.afrotech.com') then 'event/newsletter'
        when domain in ('mail.simplepractice.com') then 'software marketing'
        when only_no_reply and message_count >= 1 then 'automated/no-reply'
        when only_marketing_localpart and message_count = 1 then 'marketing/newsletter'
        when address_count >= 3 and message_count >= 1 then 'possible client/prospect'
        when address_count >= 1 and message_count >= 2 then 'possible client/prospect'
        else null
      end as likely_category,
      case
        when domain = any (array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]) then 'high'
        when domain in ('substack.com', 'linkedin.com', 'glassdoor.com', 'creativemarket.com', 'scorevolunteer.org', 'plans.eventbrite.com', 'mail.afrotech.com', 'mail.simplepractice.com') then 'medium'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'high'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' then 'high'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'high'
        when only_no_reply and message_count >= 1 then 'high'
        when only_marketing_localpart and message_count = 1 then 'medium'
        when address_count >= 3 and message_count >= 1 then 'medium'
        when address_count >= 1 and message_count >= 2 then 'medium'
        else null
      end as confidence,
      case
        when domain = any (array['gmail.com', 'outlook.com', 'aol.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'live.com', 'msn.com']::text[]) then 'unknown'
        when domain in ('substack.com', 'linkedin.com', 'glassdoor.com', 'creativemarket.com', 'scorevolunteer.org', 'plans.eventbrite.com', 'mail.afrotech.com', 'mail.simplepractice.com') then 'noise'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'noise'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' then 'noise'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'noise'
        when only_no_reply and message_count >= 1 then 'noise'
        when only_marketing_localpart and message_count = 1 then 'noise'
        else 'unknown'
      end as decision
    from signals
  ), updated as (
    update public.discovery_domains discovery_domain
    set
      likely_category = coalesce(discovery_domain.likely_category, suggestion.likely_category),
      confidence = coalesce(discovery_domain.confidence, suggestion.confidence),
      decision = case
        when discovery_domain.decision is null or discovery_domain.decision = 'unknown'
          then coalesce(suggestion.decision, discovery_domain.decision)
        else discovery_domain.decision
      end,
      updated_at = now()
    from suggestions suggestion
    where discovery_domain.domain = suggestion.domain
      and (suggestion.likely_category is not null or suggestion.decision is not null)
      and (
        discovery_domain.likely_category is null
        or discovery_domain.confidence is null
        or discovery_domain.decision is null
        or (discovery_domain.decision = 'unknown' and suggestion.decision = 'noise')
      )
    returning 1
  )
  select count(*)::integer into v_updated from updated;

  return v_updated;
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

