-- RUDI Engagement CRM schema baseline.
-- Recovered from the canonical PostgreSQL 17 database on 2026-08-04.
-- This migration is provider-neutral and contains no CRM row data, roles,
-- credentials, ownership statements, or provider-specific grants.


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: audit_row_change(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.audit_row_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_old_row jsonb;
  v_new_row jsonb;
  v_changed_fields text[];
  v_row_id_text text;
  v_actor_id uuid;
  v_actor_snapshot jsonb;
  v_source text;
  v_correlation_id text;
  v_batch_id uuid;
  v_reason text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_new_row := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old_row := to_jsonb(old);
    v_new_row := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old_row := to_jsonb(old);
  end if;

  select coalesce(array_agg(coalesce(n.key, o.key) order by coalesce(n.key, o.key)), array[]::text[])
  into v_changed_fields
  from jsonb_each(coalesce(v_new_row, '{}'::jsonb)) as n(key, value)
  full join jsonb_each(coalesce(v_old_row, '{}'::jsonb)) as o(key, value) using (key)
  where n.value is distinct from o.value;

  if tg_op = 'UPDATE' and coalesce(array_length(v_changed_fields, 1), 0) = 0 then
    return new;
  end if;

  v_row_id_text := nullif(coalesce(v_new_row->>'id', v_old_row->>'id'), '');

  v_actor_id := nullif(current_setting('rudi.audit.actor_id', true), '')::uuid;
  if v_actor_id is null then
    v_actor_id := nullif(coalesce(v_new_row->>'created_by_actor_id', v_old_row->>'created_by_actor_id'), '')::uuid;
  end if;

  if v_actor_id is not null then
    select jsonb_build_object(
      'id', a.id,
      'actor_type', a.actor_type,
      'display_name', a.display_name,
      'user_id', a.user_id,
      'agent_id', a.agent_id
    )
    into v_actor_snapshot
    from public.actors a
    where a.id = v_actor_id;
  end if;

  v_source := coalesce(nullif(current_setting('rudi.audit.source', true), ''), 'database');
  v_correlation_id := coalesce(nullif(current_setting('rudi.audit.correlation_id', true), ''), txid_current()::text);
  v_batch_id := nullif(current_setting('rudi.audit.batch_id', true), '')::uuid;
  v_reason := nullif(current_setting('rudi.audit.reason', true), '');
  v_metadata := coalesce(nullif(current_setting('rudi.audit.metadata', true), '')::jsonb, '{}'::jsonb);

  insert into public.audit_events (
    event_type,
    action,
    actor_id,
    actor_snapshot,
    source,
    correlation_id,
    batch_id,
    entity_schema,
    entity_table,
    entity_id,
    row_pk,
    changed_fields,
    old_row,
    new_row,
    reason,
    metadata,
    db_role,
    txid
  ) values (
    'row_change',
    tg_op,
    v_actor_id,
    v_actor_snapshot,
    v_source,
    v_correlation_id,
    v_batch_id,
    tg_table_schema,
    tg_table_name,
    v_row_id_text::uuid,
    jsonb_build_object('id', v_row_id_text),
    v_changed_fields,
    v_old_row,
    v_new_row,
    v_reason,
    v_metadata,
    current_user,
    txid_current()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


--
-- Name: prevent_audit_events_mutation(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.prevent_audit_events_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
begin
  raise exception 'audit_events is append-only; update/delete/truncate is not allowed' using errcode = '55000';
end;
$$;


--
-- Name: apply_discovery_domain_heuristics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_discovery_domain_heuristics() RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_updated integer;
begin
  with signals as (
    select
      dd.domain,
      bool_or(split_part(o.address, '@', 1) in ('noreply', 'no-reply', 'donotreply', 'do-not-reply')) as has_no_reply,
      bool_or(split_part(o.address, '@', 1) like '%noreply%') as has_noreply_like,
      bool_or(split_part(o.address, '@', 1) in ('news', 'newsletter', 'marketing', 'conference', 'events', 'hello', 'yourteam')) as has_marketing_localpart,
      count(distinct o.address) filter (where not o.is_self) as address_count,
      count(distinct o.source_id) filter (where not o.is_self) as message_count
    from public.discovery_domains dd
    left join public.discovery_observations o on o.domain = dd.domain
    where dd.mapped_org_id is null
      and (dd.decision is null or dd.decision = 'unknown')
    group by dd.domain
  ), suggestions as (
    select
      domain,
      case
        when domain = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com']) then 'free-mail (match by address)'
        when domain in ('substack.com') then 'newsletter'
        when domain in ('linkedin.com') then 'social/newsletter'
        when domain in ('glassdoor.com') then 'job/community notification'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'job alert'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' or domain in ('creativemarket.com') then 'retail marketing'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'travel marketing'
        when domain in ('plans.eventbrite.com', 'scorevolunteer.org', 'mail.afrotech.com') then 'event/newsletter'
        when domain in ('mail.simplepractice.com') then 'software marketing'
        when has_no_reply or has_noreply_like then 'automated/no-reply'
        when has_marketing_localpart and message_count = 1 then 'marketing/newsletter'
        when address_count >= 3 and message_count >= 1 then 'possible client/prospect'
        when address_count >= 1 and message_count >= 2 then 'possible client/prospect'
        else null
      end as likely_category,
      case
        when domain = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com']) then 'high'
        when domain in ('substack.com','linkedin.com','glassdoor.com','creativemarket.com','scorevolunteer.org','plans.eventbrite.com','mail.afrotech.com','mail.simplepractice.com') then 'medium'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'high'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' then 'high'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'high'
        when has_no_reply or has_noreply_like then 'high'
        when has_marketing_localpart and message_count = 1 then 'medium'
        when address_count >= 3 and message_count >= 1 then 'medium'
        when address_count >= 1 and message_count >= 2 then 'medium'
        else null
      end as confidence,
      case
        when domain = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com']) then 'unknown'
        when domain in ('substack.com','linkedin.com','glassdoor.com','creativemarket.com','scorevolunteer.org','plans.eventbrite.com','mail.afrotech.com','mail.simplepractice.com') then 'noise'
        when domain like '%.indeed.com' or domain in ('indeed.com', 'execthread.com', 'profellow.com') then 'noise'
        when domain like '%.krogermail.com' or domain like '%.michaels.com' or domain like '%.walgreens.com' then 'noise'
        when domain like '%.hilton.com' or domain like '%.hiltongrandvacations.com' then 'noise'
        when has_no_reply or has_noreply_like then 'noise'
        when has_marketing_localpart and message_count = 1 then 'noise'
        else 'unknown'
      end as decision
    from signals
  ), updated as (
    update public.discovery_domains dd
    set
      likely_category = coalesce(dd.likely_category, s.likely_category),
      confidence = coalesce(dd.confidence, s.confidence),
      decision = case
        when dd.decision is null or dd.decision = 'unknown' then coalesce(s.decision, dd.decision)
        else dd.decision
      end,
      updated_at = now()
    from suggestions s
    where dd.domain = s.domain
      and (s.likely_category is not null or s.decision is not null)
      and (
        dd.likely_category is null
        or dd.confidence is null
        or dd.decision is null
        or (dd.decision = 'unknown' and s.decision = 'noise')
      )
    returning 1
  )
  select count(*) into v_updated from updated;

  return v_updated;
end;
$$;


--
-- Name: get_unknown_discovery_domains(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_unknown_discovery_domains() RETURNS TABLE(domain text, message_count integer, last_seen timestamp with time zone, likely_category text, confidence text, example_people text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select dd.domain, dd.message_count, dd.last_seen, dd.likely_category, dd.confidence, dd.example_people
  from discovery_domains dd
  where dd.mapped_org_id is null
    and (dd.decision is null or dd.decision = 'unknown')
    and coalesce(dd.likely_category,'') not ilike '%free-mail%'
  order by dd.message_count desc nulls last, dd.domain;
$$;


--
-- Name: log_ingest_batch(text, date, date, text, integer, integer, integer, integer, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_ingest_batch(p_source text DEFAULT 'gmail'::text, p_window_start date DEFAULT NULL::date, p_window_end date DEFAULT NULL::date, p_domain_filter text DEFAULT NULL::text, p_messages_seen integer DEFAULT 0, p_messages_inserted integer DEFAULT 0, p_messages_updated integer DEFAULT 0, p_skipped_noise integer DEFAULT 0, p_triage_count integer DEFAULT 0, p_validator_result text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  insert into ingest_batches (source, window_start, window_end, domain_filter, messages_seen, messages_inserted,
    messages_updated, skipped_noise, triage_count, validator_result, notes)
  values (coalesce(p_source,'gmail'), p_window_start, p_window_end, p_domain_filter, p_messages_seen,
    p_messages_inserted, p_messages_updated, p_skipped_noise, p_triage_count, p_validator_result, p_notes)
  returning id;
$$;


--
-- Name: record_audit_event(text, text, uuid, text, text, text, text, uuid, text, jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_audit_event(p_event_type text, p_action text, p_actor_id uuid DEFAULT NULL::uuid, p_source text DEFAULT NULL::text, p_correlation_id text DEFAULT NULL::text, p_entity_schema text DEFAULT 'public'::text, p_entity_table text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_batch_id uuid DEFAULT NULL::uuid, p_source_id text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_id uuid;
  v_actor_id uuid;
  v_actor_snapshot jsonb;
  v_source text;
  v_correlation_id text;
  v_batch_id uuid;
  v_reason text;
  v_metadata jsonb;
begin
  if p_event_type is null or p_event_type not in ('workflow', 'tool_call', 'context_read', 'validation', 'classification', 'ingest_batch', 'manual_note') then
    raise exception 'invalid explicit audit event_type: %', p_event_type using errcode = '22023';
  end if;

  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'audit action is required' using errcode = '22023';
  end if;

  v_actor_id := coalesce(p_actor_id, nullif(current_setting('rudi.audit.actor_id', true), '')::uuid);
  if v_actor_id is not null and not exists (select 1 from public.actors where id = v_actor_id) then
    raise exception 'audit actor_id % does not exist', v_actor_id using errcode = '23503';
  end if;

  v_batch_id := coalesce(p_batch_id, nullif(current_setting('rudi.audit.batch_id', true), '')::uuid);
  if v_batch_id is not null and not exists (select 1 from public.ingest_batches where id = v_batch_id) then
    raise exception 'audit batch_id % does not exist', v_batch_id using errcode = '23503';
  end if;

  v_source := coalesce(nullif(btrim(p_source), ''), nullif(current_setting('rudi.audit.source', true), ''), 'manual');
  v_correlation_id := coalesce(nullif(btrim(p_correlation_id), ''), nullif(current_setting('rudi.audit.correlation_id', true), ''), gen_random_uuid()::text);
  v_reason := coalesce(p_reason, nullif(current_setting('rudi.audit.reason', true), ''));
  v_metadata := coalesce(p_metadata, nullif(current_setting('rudi.audit.metadata', true), '')::jsonb, '{}'::jsonb);

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object' using errcode = '22023';
  end if;

  if v_actor_id is not null then
    select jsonb_build_object(
      'id', a.id,
      'actor_type', a.actor_type,
      'display_name', a.display_name,
      'user_id', a.user_id,
      'agent_id', a.agent_id
    )
    into v_actor_snapshot
    from public.actors a
    where a.id = v_actor_id;
  end if;

  insert into public.audit_events (
    event_type,
    action,
    actor_id,
    actor_snapshot,
    source,
    source_id,
    correlation_id,
    batch_id,
    entity_schema,
    entity_table,
    entity_id,
    row_pk,
    reason,
    metadata,
    db_role,
    txid
  ) values (
    p_event_type,
    btrim(p_action),
    v_actor_id,
    v_actor_snapshot,
    v_source,
    p_source_id,
    v_correlation_id,
    v_batch_id,
    p_entity_schema,
    p_entity_table,
    p_entity_id,
    case when p_entity_id is null then null else jsonb_build_object('id', p_entity_id::text) end,
    v_reason,
    v_metadata,
    current_user,
    txid_current()
  ) returning id into v_id;

  return v_id;
end;
$$;


--
-- Name: record_discovery_observations(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_discovery_observations(p_batch jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare v_before bigint; v_after bigint; v_recv int; v_new_domains int;
begin
  v_recv := coalesce(jsonb_array_length(p_batch), 0);

  -- Ensure parent domain rows exist (satisfies discovery_observations.domain FK).
  -- New free-mail domains auto-classify; new org-domains land as null decision -> review queue.
  with src as (
    select distinct split_part(lower(trim(x->>'address')),'@',2) as dom
    from jsonb_array_elements(p_batch) as x
    where nullif(trim(x->>'address'),'') is not null
  ),
  ins as (
    insert into discovery_domains (domain, likely_category, confidence, decision)
    select dom,
      case when dom = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com'])
           then 'free-mail (match by address)' end,
      case when dom = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com'])
           then 'high' end,
      case when dom = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com'])
           then 'unknown' end
    from src where dom <> ''
    on conflict (domain) do nothing
    returning 1
  )
  select count(*) into v_new_domains from ins;

  select count(*) into v_before from discovery_observations;
  insert into discovery_observations
    (source, source_id, source_thread_id, observed_at, address_role, address, domain, is_self, is_free_mail)
  select
    coalesce(nullif(trim(x->>'source'),''),'gmail'),
    trim(x->>'source_id'),
    nullif(trim(x->>'source_thread_id'),''),
    nullif(x->>'observed_at','')::timestamptz,
    lower(trim(x->>'address_role')),
    lower(trim(x->>'address')),
    split_part(lower(trim(x->>'address')),'@',2),
    exists (select 1 from person_emails pe join users u on u.person_id = pe.person_id
            where pe.email_normalized = lower(trim(x->>'address'))),
    split_part(lower(trim(x->>'address')),'@',2) = any (array['gmail.com','outlook.com','aol.com','yahoo.com','icloud.com','hotmail.com','live.com','msn.com'])
  from jsonb_array_elements(p_batch) as x
  where nullif(trim(x->>'address'),'')      is not null
    and nullif(trim(x->>'source_id'),'')    is not null
    and nullif(trim(x->>'address_role'),'') is not null
  on conflict (source, source_id, address_role, address) do nothing;
  select count(*) into v_after from discovery_observations;

  return jsonb_build_object(
    'received', v_recv,
    'inserted', v_after - v_before,
    'duplicates', v_recv - (v_after - v_before),
    'new_domains', v_new_domains
  );
end $$;


--
-- Name: record_finance_event(uuid, text, numeric, timestamp with time zone, text, text, text, text, text, uuid, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_finance_event(p_engagement_id uuid, p_event_type text, p_amount numeric, p_occurred_at timestamp with time zone, p_source text, p_direction text DEFAULT 'positive'::text, p_currency text DEFAULT 'USD'::text, p_source_id text DEFAULT NULL::text, p_source_url text DEFAULT NULL::text, p_source_interaction_id uuid DEFAULT NULL::uuid, p_source_deliverable_id uuid DEFAULT NULL::uuid, p_created_by_actor_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  _id uuid;
  _existing engagement_finance_events%rowtype;
  _link_engagement uuid;
begin
  if p_engagement_id is null then raise exception 'record_finance_event: engagement_id is required'; end if;
  if p_event_type is null then raise exception 'record_finance_event: event_type is required'; end if;
  if p_amount is null then raise exception 'record_finance_event: amount is required'; end if;
  if p_occurred_at is null then raise exception 'record_finance_event: occurred_at is required'; end if;
  if p_source is null then raise exception 'record_finance_event: source is required'; end if;

  if not exists (select 1 from engagements e where e.id = p_engagement_id) then
    raise exception 'record_finance_event: engagement % not found', p_engagement_id;
  end if;

  -- evidence links must belong to the same engagement (keeps v_validate_finance_event_links empty)
  if p_source_interaction_id is not null then
    select i.engagement_id into _link_engagement from interactions i where i.id = p_source_interaction_id;
    if not found then
      raise exception 'record_finance_event: source_interaction_id % not found', p_source_interaction_id;
    end if;
    if _link_engagement is distinct from p_engagement_id then
      raise exception 'record_finance_event: source_interaction_id % is on engagement % not %', p_source_interaction_id, _link_engagement, p_engagement_id;
    end if;
  end if;

  if p_source_deliverable_id is not null then
    select d.engagement_id into _link_engagement from deliverables d where d.id = p_source_deliverable_id;
    if not found then
      raise exception 'record_finance_event: source_deliverable_id % not found', p_source_deliverable_id;
    end if;
    if _link_engagement is distinct from p_engagement_id then
      raise exception 'record_finance_event: source_deliverable_id % is on engagement % not %', p_source_deliverable_id, _link_engagement, p_engagement_id;
    end if;
  end if;

  -- idempotency + finance-history preservation on (source, source_id)
  if p_source_id is not null then
    select * into _existing
    from engagement_finance_events
    where source = p_source and source_id = p_source_id;

    if found then
      if _existing.amount is distinct from p_amount
         or _existing.event_type is distinct from p_event_type
         or _existing.currency is distinct from coalesce(p_currency, 'USD')
         or _existing.direction is distinct from coalesce(p_direction, 'positive') then
        raise exception
          'record_finance_event: conflicting replay for (source=%, source_id=%); finance history is immutable and core money fields cannot change',
          p_source, p_source_id;
      end if;

      update engagement_finance_events
      set source_url            = coalesce(p_source_url, source_url),
          notes                 = coalesce(p_notes, notes),
          source_interaction_id = coalesce(p_source_interaction_id, source_interaction_id),
          source_deliverable_id = coalesce(p_source_deliverable_id, source_deliverable_id),
          created_by_actor_id   = coalesce(p_created_by_actor_id, created_by_actor_id)
      where id = _existing.id
      returning id into _id;

      return _id;
    end if;
  end if;

  insert into engagement_finance_events (
    engagement_id, event_type, amount, direction, currency, occurred_at,
    source, source_id, source_url, source_interaction_id, source_deliverable_id,
    created_by_actor_id, notes
  ) values (
    p_engagement_id, p_event_type, p_amount, coalesce(p_direction, 'positive'),
    coalesce(p_currency, 'USD'), p_occurred_at,
    p_source, p_source_id, p_source_url, p_source_interaction_id, p_source_deliverable_id,
    p_created_by_actor_id, p_notes
  )
  returning id into _id;

  return _id;
end
$$;


--
-- Name: refresh_discovery_domain_rollups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_discovery_domain_rollups() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  update public.discovery_domains d
  set
    message_count = r.message_count,
    last_seen = r.last_seen,
    example_people = r.example_people,
    updated_at = now()
  from public.v_discovery_domain_rollup r
  where d.domain = r.domain;
end;
$$;


--
-- Name: refresh_thread_rollups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_thread_rollups() RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  with rollups as (
    select
      t.id as thread_id,
      (select max(i.occurred_at) from public.interactions i where i.thread_id = t.id) as max_occurred,
      latest.direction as last_dir,
      sender.full_name as last_sender
    from public.threads t
    left join lateral (
      select i.id, i.direction
      from public.interactions i
      where i.thread_id = t.id
      order by i.occurred_at desc nulls last, i.created_at desc, i.id desc
      limit 1
    ) latest on true
    left join lateral (
      select p.full_name
      from public.interaction_participants ip
      join public.people p on p.id = ip.person_id
      where ip.interaction_id = latest.id
        and ip.role = 'sender'
      order by ip.is_primary desc, ip.created_at asc, ip.id asc
      limit 1
    ) sender on true
  )
  update public.threads t
  set last_activity = r.max_occurred,
      last_direction = r.last_dir,
      last_from = r.last_sender,
      updated_at = now()
  from rollups r
  where r.thread_id = t.id
    and (
      t.last_activity is distinct from r.max_occurred
      or t.last_direction is distinct from r.last_dir
      or t.last_from is distinct from r.last_sender
    );
$$;


--
-- Name: resolve_person_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_person_by_email(p_email text) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select person_id from person_emails
  where email_normalized = lower(btrim(p_email))
  limit 1;
$$;


--
-- Name: set_audit_context(uuid, text, text, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_audit_context(p_actor_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'manual'::text, p_correlation_id text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_batch_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_correlation_id text;
  v_source text;
begin
  v_source := coalesce(nullif(btrim(p_source), ''), 'manual');
  v_correlation_id := coalesce(nullif(btrim(p_correlation_id), ''), gen_random_uuid()::text);

  if p_actor_id is not null and not exists (select 1 from public.actors where id = p_actor_id) then
    raise exception 'audit actor_id % does not exist', p_actor_id using errcode = '23503';
  end if;

  if p_batch_id is not null and not exists (select 1 from public.ingest_batches where id = p_batch_id) then
    raise exception 'audit batch_id % does not exist', p_batch_id using errcode = '23503';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object' using errcode = '22023';
  end if;

  perform set_config('rudi.audit.actor_id', coalesce(p_actor_id::text, ''), true);
  perform set_config('rudi.audit.source', v_source, true);
  perform set_config('rudi.audit.correlation_id', v_correlation_id, true);
  perform set_config('rudi.audit.reason', coalesce(p_reason, ''), true);
  perform set_config('rudi.audit.batch_id', coalesce(p_batch_id::text, ''), true);
  perform set_config('rudi.audit.metadata', p_metadata::text, true);

  return jsonb_build_object(
    'actor_id', p_actor_id,
    'source', v_source,
    'correlation_id', v_correlation_id,
    'reason', p_reason,
    'batch_id', p_batch_id,
    'metadata', p_metadata
  );
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: sync_people_primary_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_people_primary_email() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  v_person_id uuid;
  v_old_person_id uuid;
  v_email text;
begin
  if tg_op = 'UPDATE' and old.person_id is distinct from new.person_id then
    v_old_person_id := old.person_id;
    select pe.email into v_email
    from public.person_emails pe
    where pe.person_id = v_old_person_id
      and pe.is_primary
    order by pe.updated_at desc, pe.created_at desc, pe.id
    limit 1;

    update public.people p
    set email = v_email,
        updated_at = now()
    where p.id = v_old_person_id
      and p.email is distinct from v_email;
  end if;

  v_person_id := case when tg_op = 'DELETE' then old.person_id else new.person_id end;

  select pe.email into v_email
  from public.person_emails pe
  where pe.person_id = v_person_id
    and pe.is_primary
  order by pe.updated_at desc, pe.created_at desc, pe.id
  limit 1;

  update public.people p
  set email = v_email,
      updated_at = now()
  where p.id = v_person_id
    and p.email is distinct from v_email;

  return null;
end $$;


--
-- Name: upsert_interaction(text, text, text, text, timestamp with time zone, text, text, text, uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_interaction(p_source text, p_source_id text, p_channel text, p_direction text, p_occurred_at timestamp with time zone, p_subject text, p_summary text, p_source_url text DEFAULT NULL::text, p_engagement_id uuid DEFAULT NULL::uuid, p_thread_id uuid DEFAULT NULL::uuid, p_created_by_actor_id uuid DEFAULT NULL::uuid, p_related_interaction_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare _id uuid;
begin
  insert into interactions (
    source, source_id, channel, direction, occurred_at, subject, summary,
    source_url, engagement_id, thread_id, created_by_actor_id, related_interaction_id
  ) values (
    p_source, p_source_id, p_channel, p_direction, p_occurred_at, p_subject, p_summary,
    p_source_url, p_engagement_id, p_thread_id, p_created_by_actor_id, p_related_interaction_id
  )
  on conflict (source, source_id) where source_id is not null
  do update set
    channel     = excluded.channel,
    direction   = excluded.direction,
    occurred_at = excluded.occurred_at,
    subject     = excluded.subject,
    summary     = coalesce(excluded.summary, interactions.summary),
    source_url  = coalesce(excluded.source_url, interactions.source_url),
    -- never wipe an existing classification on re-ingest
    engagement_id          = coalesce(interactions.engagement_id, excluded.engagement_id),
    thread_id              = coalesce(interactions.thread_id, excluded.thread_id),
    created_by_actor_id    = coalesce(interactions.created_by_actor_id, excluded.created_by_actor_id),
    related_interaction_id = coalesce(interactions.related_interaction_id, excluded.related_interaction_id)
  returning id into _id;
  return _id;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_type text NOT NULL,
    user_id uuid,
    agent_id uuid,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT actor_exactly_one CHECK ((((actor_type = 'user'::text) AND (user_id IS NOT NULL) AND (agent_id IS NULL)) OR ((actor_type = 'agent'::text) AND (agent_id IS NOT NULL) AND (user_id IS NULL)))),
    CONSTRAINT actors_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'agent'::text])))
);


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    provider text,
    agent_type text,
    model text,
    surface text,
    status text DEFAULT 'active'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agents_agent_type_chk CHECK (((agent_type IS NULL) OR (agent_type = ANY (ARRAY['assistant'::text, 'coding_agent'::text, 'reconcile_agent'::text, 'triage_agent'::text, 'automation_agent'::text])))),
    CONSTRAINT agents_status_chk CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'inactive'::text, 'deprecated'::text]))))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    event_type text NOT NULL,
    action text NOT NULL,
    actor_id uuid,
    actor_snapshot jsonb,
    source text DEFAULT 'database'::text NOT NULL,
    source_id text,
    correlation_id text DEFAULT (txid_current())::text NOT NULL,
    batch_id uuid,
    entity_schema text,
    entity_table text,
    entity_id uuid,
    row_pk jsonb,
    changed_fields text[],
    old_row jsonb,
    new_row jsonb,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    db_role text DEFAULT CURRENT_USER NOT NULL,
    txid bigint DEFAULT txid_current() NOT NULL,
    CONSTRAINT audit_events_action_nonblank CHECK ((length(btrim(action)) > 0)),
    CONSTRAINT audit_events_event_type_check CHECK ((event_type = ANY (ARRAY['row_change'::text, 'workflow'::text, 'tool_call'::text, 'context_read'::text, 'validation'::text, 'classification'::text, 'ingest_batch'::text, 'manual_note'::text]))),
    CONSTRAINT audit_events_metadata_object CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT audit_events_row_change_payload CHECK (((event_type <> 'row_change'::text) OR ((entity_schema IS NOT NULL) AND (entity_table IS NOT NULL) AND (row_pk IS NOT NULL) AND (action = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text])) AND (((action = 'INSERT'::text) AND (old_row IS NULL) AND (new_row IS NOT NULL)) OR ((action = 'UPDATE'::text) AND (old_row IS NOT NULL) AND (new_row IS NOT NULL)) OR ((action = 'DELETE'::text) AND (old_row IS NOT NULL) AND (new_row IS NULL)))))),
    CONSTRAINT audit_events_source_nonblank CHECK ((length(btrim(source)) > 0))
);


--
-- Name: deliverable_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverable_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deliverable_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deliverables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliverables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid,
    title text NOT NULL,
    doc_type text,
    status text,
    local_path text,
    dropbox_url text,
    cloudinary_url text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sort_order integer,
    source_interaction_id uuid,
    created_by_actor_id uuid,
    CONSTRAINT deliverables_doc_type_chk CHECK (((doc_type IS NULL) OR (doc_type = ANY (ARRAY['pdf'::text, 'docx'::text, 'html'::text, 'md'::text, 'image'::text, 'video'::text, 'deck'::text])))),
    CONSTRAINT deliverables_status_chk CHECK (((status IS NULL) OR (status = ANY (ARRAY['Draft'::text, 'In Review'::text, 'Sent'::text, 'Signed'::text, 'Final'::text]))))
);


--
-- Name: discovery_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovery_domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    example_people text,
    message_count integer DEFAULT 0 NOT NULL,
    last_seen timestamp with time zone,
    likely_category text,
    confidence text,
    decision text,
    mapped_org_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discovery_decision_chk CHECK (((decision IS NULL) OR (decision = ANY (ARRAY['client'::text, 'prospect'::text, 'vendor'::text, 'partner'::text, 'internal'::text, 'noise'::text, 'unknown'::text]))))
);


--
-- Name: discovery_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovery_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_id text NOT NULL,
    source_thread_id text,
    observed_at timestamp with time zone NOT NULL,
    address_role text NOT NULL,
    address text NOT NULL,
    domain text NOT NULL,
    is_self boolean DEFAULT false NOT NULL,
    is_free_mail boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discovery_observations_address_chk CHECK (((address = lower(btrim(address))) AND (POSITION(('@'::text) IN (address)) > 1))),
    CONSTRAINT discovery_observations_domain_chk CHECK (((domain = lower(btrim(domain))) AND (POSITION(('.'::text) IN (domain)) > 1))),
    CONSTRAINT discovery_observations_role_chk CHECK ((address_role = ANY (ARRAY['from'::text, 'to'::text, 'cc'::text, 'bcc'::text]))),
    CONSTRAINT discovery_observations_source_chk CHECK ((source = ANY (ARRAY['gmail'::text, 'calendar'::text, 'otter'::text, 'slack'::text, 'manual'::text])))
);


--
-- Name: engagement_finance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_finance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid NOT NULL,
    event_type text NOT NULL,
    amount numeric(12,2) NOT NULL,
    direction text DEFAULT 'positive'::text NOT NULL,
    signed_amount numeric(12,2) GENERATED ALWAYS AS (
CASE
    WHEN (direction = 'negative'::text) THEN (- amount)
    ELSE amount
END) STORED,
    currency text DEFAULT 'USD'::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_id text,
    source_url text,
    source_interaction_id uuid,
    source_deliverable_id uuid,
    created_by_actor_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT engagement_finance_events_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT engagement_finance_events_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT engagement_finance_events_direction_check CHECK ((direction = ANY (ARRAY['positive'::text, 'negative'::text]))),
    CONSTRAINT engagement_finance_events_event_type_check CHECK ((event_type = ANY (ARRAY['budget'::text, 'estimate'::text, 'proposal'::text, 'contract'::text, 'invoice'::text, 'payment'::text, 'refund'::text, 'expense'::text, 'adjustment'::text]))),
    CONSTRAINT engagement_finance_events_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'gmail'::text, 'calendar'::text, 'otter'::text, 'slack'::text, 'contract'::text, 'invoice'::text, 'payment_processor'::text, 'import'::text]))),
    CONSTRAINT engagement_finance_events_source_id_chk CHECK (((source_id IS NULL) OR (btrim(source_id) <> ''::text)))
);


--
-- Name: TABLE engagement_finance_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.engagement_finance_events IS 'Finance signal/event ledger for engagement budget, proposal, contract, invoice, payment, refund, expense, and adjustment events. Not a general accounting ledger.';


--
-- Name: engagement_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagement_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: engagements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engagements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    pipeline_stage text,
    status text,
    service_type text,
    estimated_value numeric(12,2),
    probability numeric(5,2),
    expected_close date,
    billing_entity text,
    priority text,
    sensitivity text,
    drive_url text,
    dropbox_path text,
    notion_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    owner_actor_id uuid,
    currency text DEFAULT 'USD'::text NOT NULL,
    closed_at date,
    lost_reason text,
    description text,
    github_url text,
    provider_org_id uuid,
    CONSTRAINT engagements_pipeline_stage_chk CHECK (((pipeline_stage IS NULL) OR (pipeline_stage = ANY (ARRAY['Lead'::text, 'Discovery'::text, 'Proposal'::text, 'Contracting'::text, 'Active'::text, 'Won'::text, 'Lost'::text])))),
    CONSTRAINT engagements_priority_chk CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text])))),
    CONSTRAINT engagements_sensitivity_chk CHECK (((sensitivity IS NULL) OR (sensitivity = ANY (ARRAY['Normal'::text, 'Sensitive'::text, 'Restricted'::text])))),
    CONSTRAINT engagements_service_type_chk CHECK (((service_type IS NULL) OR (service_type = ANY (ARRAY['Training'::text, 'Advisory'::text, 'Training + Advisory'::text, 'Software Build'::text])))),
    CONSTRAINT engagements_status_chk CHECK (((status IS NULL) OR (status = ANY (ARRAY['New'::text, 'Needs Review'::text, 'Needs Reply'::text, 'Waiting'::text, 'In Progress'::text, 'Done'::text, 'Ignore'::text]))))
);


--
-- Name: ingest_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingest_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT 'gmail'::text NOT NULL,
    window_start date,
    window_end date,
    domain_filter text,
    messages_seen integer DEFAULT 0 NOT NULL,
    messages_inserted integer DEFAULT 0 NOT NULL,
    messages_updated integer DEFAULT 0 NOT NULL,
    skipped_noise integer DEFAULT 0 NOT NULL,
    triage_count integer DEFAULT 0 NOT NULL,
    validator_result text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: interaction_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    interaction_id uuid NOT NULL,
    person_id uuid NOT NULL,
    role text,
    is_primary boolean DEFAULT false NOT NULL,
    attendance_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid,
    thread_id uuid,
    channel text,
    direction text,
    occurred_at timestamp with time zone,
    subject text,
    summary text,
    source text,
    source_id text,
    source_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_actor_id uuid,
    related_interaction_id uuid,
    CONSTRAINT interactions_direction_chk CHECK (((direction IS NULL) OR (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))))
);


--
-- Name: next_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.next_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid,
    description text NOT NULL,
    due_date date,
    done boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    assignee_actor_id uuid,
    priority text,
    source_interaction_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT next_actions_priority_chk CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['High'::text, 'Medium'::text, 'Low'::text]))))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    domain text,
    category text,
    website text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    industry text,
    CONSTRAINT organizations_category_chk CHECK (((category IS NULL) OR (category = ANY (ARRAY['Internal'::text, 'Client'::text, 'Prospect'::text, 'Vendor'::text, 'Partner'::text, 'Other'::text]))))
);


--
-- Name: people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    full_name text NOT NULL,
    email text,
    title text,
    phone text,
    role text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    email text NOT NULL,
    email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
    label text,
    is_primary boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT person_emails_label_chk CHECK (((label IS NULL) OR (label = ANY (ARRAY['work'::text, 'personal'::text, 'alias'::text, 'former'::text, 'unknown'::text])))),
    CONSTRAINT person_emails_source_chk CHECK (((source IS NULL) OR (source = ANY (ARRAY['gmail'::text, 'calendar'::text, 'manual'::text, 'import'::text, 'slack'::text, 'otter'::text]))))
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engagement_id uuid,
    subject text,
    last_direction text,
    last_from text,
    last_activity timestamp with time zone,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    organization_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel text,
    source text,
    source_thread_id text,
    url text
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    login_email text,
    role text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_chk CHECK (((role IS NULL) OR (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))),
    CONSTRAINT users_status_chk CHECK (((status IS NULL) OR (status = ANY (ARRAY['active'::text, 'inactive'::text, 'invited'::text, 'suspended'::text]))))
);


--
-- Name: v_discovery_domain_rollup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_discovery_domain_rollup WITH (security_invoker='true') AS
 SELECT domain,
    (count(DISTINCT source_id))::integer AS message_count,
    max(observed_at) AS last_seen,
    "left"(string_agg(DISTINCT address, ', '::text ORDER BY address), 1000) AS example_people,
    (count(*) FILTER (WHERE (address_role = 'from'::text)))::integer AS from_mentions,
    (count(*) FILTER (WHERE (address_role = ANY (ARRAY['to'::text, 'cc'::text, 'bcc'::text]))))::integer AS recipient_mentions
   FROM public.discovery_observations
  WHERE (NOT is_self)
  GROUP BY domain;


--
-- Name: v_engagement_financial_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_engagement_financial_summary WITH (security_invoker='true') AS
 SELECT e.id AS engagement_id,
    fe.currency,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'budget'::text)), (0)::numeric))::numeric(12,2) AS budget_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'estimate'::text)), (0)::numeric))::numeric(12,2) AS estimated_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'proposal'::text)), (0)::numeric))::numeric(12,2) AS proposed_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'contract'::text)), (0)::numeric))::numeric(12,2) AS contracted_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'invoice'::text)), (0)::numeric))::numeric(12,2) AS invoiced_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'payment'::text)), (0)::numeric))::numeric(12,2) AS paid_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'refund'::text)), (0)::numeric))::numeric(12,2) AS refund_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'expense'::text)), (0)::numeric))::numeric(12,2) AS expense_total,
    (COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'adjustment'::text)), (0)::numeric))::numeric(12,2) AS adjustment_total,
    ((((COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'invoice'::text)), (0)::numeric) - COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'payment'::text)), (0)::numeric)) + COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'refund'::text)), (0)::numeric)) + COALESCE(sum(fe.signed_amount) FILTER (WHERE (fe.event_type = 'adjustment'::text)), (0)::numeric)))::numeric(12,2) AS outstanding_total,
    (count(fe.id))::integer AS event_count,
    max(fe.occurred_at) AS last_finance_event_at
   FROM (public.engagements e
     JOIN public.engagement_finance_events fe ON ((fe.engagement_id = e.id)))
  GROUP BY e.id, fe.currency;


--
-- Name: VIEW v_engagement_financial_summary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_engagement_financial_summary IS 'Derived finance totals by engagement and currency from engagement_finance_events.';


--
-- Name: v_people_missing_email; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_people_missing_email WITH (security_invoker='true') AS
 SELECT p.id AS person_id,
    o.name AS organization,
    o.category AS org_category,
    p.full_name,
    p.role,
    (EXISTS ( SELECT 1
           FROM public.engagement_people ep
          WHERE (ep.person_id = p.id))) AS on_a_committee,
    (EXISTS ( SELECT 1
           FROM public.interaction_participants ip
          WHERE (ip.person_id = p.id))) AS has_interactions
   FROM (public.people p
     LEFT JOIN public.organizations o ON ((o.id = p.organization_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.person_emails pe
          WHERE (pe.person_id = p.id))));


--
-- Name: v_recent_audit_events; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_recent_audit_events WITH (security_invoker='true') AS
 SELECT id,
    occurred_at,
    event_type,
    action,
    actor_id,
    (actor_snapshot ->> 'display_name'::text) AS actor_display_name,
    source,
    source_id,
    correlation_id,
    batch_id,
    entity_schema,
    entity_table,
    (row_pk ->> 'id'::text) AS row_id,
    changed_fields,
    reason,
    metadata,
    db_role,
    txid
   FROM public.audit_events ae;


--
-- Name: v_triage_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_triage_queue WITH (security_invoker='true') AS
 SELECT 'thread'::text AS item_type,
    t.id AS item_id,
    t.channel,
    t.source,
    t.subject,
    t.last_activity AS when_
   FROM public.threads t
  WHERE (t.engagement_id IS NULL)
UNION ALL
 SELECT 'interaction'::text AS item_type,
    i.id AS item_id,
    i.channel,
    i.source,
    i.subject,
    i.occurred_at AS when_
   FROM public.interactions i
  WHERE ((i.engagement_id IS NULL) AND (i.thread_id IS NULL));


--
-- Name: v_validate_audit_trigger_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_audit_trigger_coverage WITH (security_invoker='true') AS
 WITH expected(table_name) AS (
         VALUES ('organizations'::text), ('people'::text), ('person_emails'::text), ('users'::text), ('agents'::text), ('actors'::text), ('engagements'::text), ('threads'::text), ('interactions'::text), ('deliverables'::text), ('next_actions'::text), ('engagement_finance_events'::text), ('engagement_people'::text), ('interaction_participants'::text), ('deliverable_people'::text), ('discovery_domains'::text), ('ingest_batches'::text)
        ), actual AS (
         SELECT triggers.event_object_table AS table_name,
            bool_or(((triggers.event_manipulation)::text = 'INSERT'::text)) AS has_insert,
            bool_or(((triggers.event_manipulation)::text = 'UPDATE'::text)) AS has_update,
            bool_or(((triggers.event_manipulation)::text = 'DELETE'::text)) AS has_delete
           FROM information_schema.triggers
          WHERE (((triggers.trigger_schema)::name = 'public'::name) AND ((triggers.trigger_name)::name = 'trg_audit_row_change'::name))
          GROUP BY triggers.event_object_table
        )
 SELECT e.table_name,
        CASE
            WHEN (a.table_name IS NULL) THEN 'missing audit trigger'::text
            WHEN (NOT a.has_insert) THEN 'missing insert audit trigger'::text
            WHEN (NOT a.has_update) THEN 'missing update audit trigger'::text
            WHEN (NOT a.has_delete) THEN 'missing delete audit trigger'::text
            ELSE NULL::text
        END AS issue
   FROM (expected e
     LEFT JOIN actual a USING (table_name))
  WHERE ((a.table_name IS NULL) OR (NOT a.has_insert) OR (NOT a.has_update) OR (NOT a.has_delete))
UNION ALL
 SELECT a.table_name,
    'unexpected audit trigger'::text AS issue
   FROM (actual a
     LEFT JOIN expected e USING (table_name))
  WHERE (e.table_name IS NULL);


--
-- Name: v_validate_dupe_source; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_dupe_source WITH (security_invoker='true') AS
 SELECT source,
    source_id,
    count(*) AS n
   FROM public.interactions
  WHERE (source_id IS NOT NULL)
  GROUP BY source, source_id
 HAVING (count(*) > 1);


--
-- Name: v_validate_finance_event_links; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_finance_event_links WITH (security_invoker='true') AS
 SELECT fe.id AS finance_event_id,
    'source_interaction_id'::text AS field_name,
    fe.engagement_id AS finance_engagement_id,
    i.engagement_id AS linked_engagement_id
   FROM (public.engagement_finance_events fe
     JOIN public.interactions i ON ((i.id = fe.source_interaction_id)))
  WHERE (i.engagement_id IS DISTINCT FROM fe.engagement_id)
UNION ALL
 SELECT fe.id AS finance_event_id,
    'source_deliverable_id'::text AS field_name,
    fe.engagement_id AS finance_engagement_id,
    d.engagement_id AS linked_engagement_id
   FROM (public.engagement_finance_events fe
     JOIN public.deliverables d ON ((d.id = fe.source_deliverable_id)))
  WHERE (d.engagement_id IS DISTINCT FROM fe.engagement_id);


--
-- Name: VIEW v_validate_finance_event_links; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_validate_finance_event_links IS 'Validator: finance events linked to interactions/deliverables must belong to the same engagement.';


--
-- Name: v_validate_interaction_engagement; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_interaction_engagement WITH (security_invoker='true') AS
 SELECT i.id AS interaction_id,
    i.engagement_id AS interaction_eng,
    t.engagement_id AS thread_eng
   FROM (public.interactions i
     JOIN public.threads t ON ((t.id = i.thread_id)))
  WHERE ((t.engagement_id IS NOT NULL) AND (i.engagement_id IS DISTINCT FROM t.engagement_id));


--
-- Name: v_validate_people_email_mirror; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_people_email_mirror WITH (security_invoker='true') AS
 WITH primary_email AS (
         SELECT person_emails.person_id,
            person_emails.email,
            person_emails.email_normalized
           FROM public.person_emails
          WHERE person_emails.is_primary
        )
 SELECT p.id AS person_id,
    p.full_name,
    p.email AS people_email,
    pe.email AS primary_email,
    lower(btrim(p.email)) AS people_email_normalized,
    pe.email_normalized AS primary_email_normalized
   FROM (public.people p
     LEFT JOIN primary_email pe ON ((pe.person_id = p.id)))
  WHERE (COALESCE(lower(btrim(p.email)), ''::text) IS DISTINCT FROM COALESCE(pe.email_normalized, ''::text));


--
-- Name: v_validate_thread_org; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_thread_org WITH (security_invoker='true') AS
 SELECT t.id AS thread_id,
    t.organization_id AS thread_org,
    e.organization_id AS engagement_org
   FROM (public.threads t
     JOIN public.engagements e ON ((e.id = t.engagement_id)))
  WHERE ((t.engagement_id IS NOT NULL) AND (t.organization_id IS DISTINCT FROM e.organization_id));


--
-- Name: v_validate_thread_rollup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_thread_rollup WITH (security_invoker='true') AS
 WITH expected AS (
         SELECT t.id AS thread_id,
            t.last_activity,
            t.last_direction,
            t.last_from,
            ( SELECT max(i.occurred_at) AS max
                   FROM public.interactions i
                  WHERE (i.thread_id = t.id)) AS expected_last_activity,
            latest.direction AS expected_last_direction,
            sender.full_name AS expected_last_from
           FROM ((public.threads t
             LEFT JOIN LATERAL ( SELECT i.id,
                    i.direction
                   FROM public.interactions i
                  WHERE (i.thread_id = t.id)
                  ORDER BY i.occurred_at DESC NULLS LAST, i.created_at DESC, i.id DESC
                 LIMIT 1) latest ON (true))
             LEFT JOIN LATERAL ( SELECT p.full_name
                   FROM (public.interaction_participants ip
                     JOIN public.people p ON ((p.id = ip.person_id)))
                  WHERE ((ip.interaction_id = latest.id) AND (ip.role = 'sender'::text))
                  ORDER BY ip.is_primary DESC, ip.created_at, ip.id
                 LIMIT 1) sender ON (true))
        )
 SELECT expected.thread_id,
    'last_activity'::text AS field_name,
    (expected.last_activity)::text AS actual_value,
    (expected.expected_last_activity)::text AS expected_value
   FROM expected
  WHERE (expected.last_activity IS DISTINCT FROM expected.expected_last_activity)
UNION ALL
 SELECT expected.thread_id,
    'last_direction'::text AS field_name,
    expected.last_direction AS actual_value,
    expected.expected_last_direction AS expected_value
   FROM expected
  WHERE (expected.last_direction IS DISTINCT FROM expected.expected_last_direction)
UNION ALL
 SELECT expected.thread_id,
    'last_from'::text AS field_name,
    expected.last_from AS actual_value,
    expected.expected_last_from AS expected_value
   FROM expected
  WHERE (expected.last_from IS DISTINCT FROM expected.expected_last_from);


--
-- Name: v_validate_user_login_email; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_validate_user_login_email WITH (security_invoker='true') AS
 SELECT id AS user_id,
    person_id,
    login_email
   FROM public.users u
  WHERE ((login_email IS NOT NULL) AND (NOT (EXISTS ( SELECT 1
           FROM public.person_emails pe
          WHERE ((pe.person_id = u.person_id) AND (pe.email_normalized = lower(btrim(u.login_email))))))));


--
-- Name: actors actors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_pkey PRIMARY KEY (id);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: deliverable_people deliverable_people_deliverable_id_person_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_people
    ADD CONSTRAINT deliverable_people_deliverable_id_person_id_role_key UNIQUE (deliverable_id, person_id, role);


--
-- Name: deliverable_people deliverable_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_people
    ADD CONSTRAINT deliverable_people_pkey PRIMARY KEY (id);


--
-- Name: deliverables deliverables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_pkey PRIMARY KEY (id);


--
-- Name: discovery_domains discovery_domains_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_domains
    ADD CONSTRAINT discovery_domains_domain_key UNIQUE (domain);


--
-- Name: discovery_domains discovery_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_domains
    ADD CONSTRAINT discovery_domains_pkey PRIMARY KEY (id);


--
-- Name: discovery_observations discovery_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_observations
    ADD CONSTRAINT discovery_observations_pkey PRIMARY KEY (id);


--
-- Name: discovery_observations discovery_observations_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_observations
    ADD CONSTRAINT discovery_observations_unique UNIQUE (source, source_id, address_role, address);


--
-- Name: engagement_finance_events engagement_finance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_finance_events
    ADD CONSTRAINT engagement_finance_events_pkey PRIMARY KEY (id);


--
-- Name: engagement_people engagement_people_engagement_id_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_people
    ADD CONSTRAINT engagement_people_engagement_id_person_id_key UNIQUE (engagement_id, person_id);


--
-- Name: engagement_people engagement_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_people
    ADD CONSTRAINT engagement_people_pkey PRIMARY KEY (id);


--
-- Name: engagements engagements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagements
    ADD CONSTRAINT engagements_pkey PRIMARY KEY (id);


--
-- Name: ingest_batches ingest_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingest_batches
    ADD CONSTRAINT ingest_batches_pkey PRIMARY KEY (id);


--
-- Name: interaction_participants interaction_participants_interaction_id_person_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_participants
    ADD CONSTRAINT interaction_participants_interaction_id_person_id_key UNIQUE (interaction_id, person_id);


--
-- Name: interaction_participants interaction_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_participants
    ADD CONSTRAINT interaction_participants_pkey PRIMARY KEY (id);


--
-- Name: interactions interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_pkey PRIMARY KEY (id);


--
-- Name: next_actions next_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: people people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_pkey PRIMARY KEY (id);


--
-- Name: person_emails person_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_emails
    ADD CONSTRAINT person_emails_pkey PRIMARY KEY (id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_events_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_actor ON public.audit_events USING btree (actor_id, occurred_at DESC) WHERE (actor_id IS NOT NULL);


--
-- Name: idx_audit_events_batch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_batch ON public.audit_events USING btree (batch_id, occurred_at DESC) WHERE (batch_id IS NOT NULL);


--
-- Name: idx_audit_events_correlation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_correlation ON public.audit_events USING btree (correlation_id, occurred_at DESC);


--
-- Name: idx_audit_events_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_entity ON public.audit_events USING btree (entity_schema, entity_table, entity_id, occurred_at DESC);


--
-- Name: idx_audit_events_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_events_occurred_at ON public.audit_events USING btree (occurred_at DESC);


--
-- Name: idx_deliverable_people_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliverable_people_person ON public.deliverable_people USING btree (person_id);


--
-- Name: idx_deliverables_created_by_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliverables_created_by_actor ON public.deliverables USING btree (created_by_actor_id);


--
-- Name: idx_deliverables_engagement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliverables_engagement ON public.deliverables USING btree (engagement_id);


--
-- Name: idx_deliverables_source_interaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliverables_source_interaction ON public.deliverables USING btree (source_interaction_id);


--
-- Name: idx_discovery_domains_mapped_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovery_domains_mapped_org ON public.discovery_domains USING btree (mapped_org_id);


--
-- Name: idx_discovery_observations_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovery_observations_domain ON public.discovery_observations USING btree (domain);


--
-- Name: idx_discovery_observations_observed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovery_observations_observed_at ON public.discovery_observations USING btree (observed_at DESC);


--
-- Name: idx_discovery_observations_source_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovery_observations_source_thread ON public.discovery_observations USING btree (source, source_thread_id);


--
-- Name: idx_engagement_finance_events_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_finance_events_actor ON public.engagement_finance_events USING btree (created_by_actor_id);


--
-- Name: idx_engagement_finance_events_deliverable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_finance_events_deliverable ON public.engagement_finance_events USING btree (source_deliverable_id);


--
-- Name: idx_engagement_finance_events_engagement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_finance_events_engagement ON public.engagement_finance_events USING btree (engagement_id);


--
-- Name: idx_engagement_finance_events_interaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_finance_events_interaction ON public.engagement_finance_events USING btree (source_interaction_id);


--
-- Name: idx_engagement_finance_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_finance_events_occurred ON public.engagement_finance_events USING btree (occurred_at DESC);


--
-- Name: idx_engagement_people_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagement_people_person ON public.engagement_people USING btree (person_id);


--
-- Name: idx_engagements_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagements_organization ON public.engagements USING btree (organization_id);


--
-- Name: idx_engagements_owner_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagements_owner_actor ON public.engagements USING btree (owner_actor_id);


--
-- Name: idx_engagements_provider_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_engagements_provider_org ON public.engagements USING btree (provider_org_id);


--
-- Name: idx_interaction_participants_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_participants_person ON public.interaction_participants USING btree (person_id);


--
-- Name: idx_interactions_created_by_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_created_by_actor ON public.interactions USING btree (created_by_actor_id);


--
-- Name: idx_interactions_engagement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_engagement ON public.interactions USING btree (engagement_id);


--
-- Name: idx_interactions_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_occurred ON public.interactions USING btree (occurred_at DESC);


--
-- Name: idx_interactions_related_interaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_related_interaction ON public.interactions USING btree (related_interaction_id);


--
-- Name: idx_interactions_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_thread ON public.interactions USING btree (thread_id);


--
-- Name: idx_next_actions_assignee_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_assignee_actor ON public.next_actions USING btree (assignee_actor_id);


--
-- Name: idx_next_actions_engagement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_engagement ON public.next_actions USING btree (engagement_id);


--
-- Name: idx_next_actions_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_open ON public.next_actions USING btree (done) WHERE (done = false);


--
-- Name: idx_next_actions_source_interaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_source_interaction ON public.next_actions USING btree (source_interaction_id);


--
-- Name: idx_people_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_people_email ON public.people USING btree (email);


--
-- Name: idx_people_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_people_org ON public.people USING btree (organization_id);


--
-- Name: idx_person_emails_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_person_emails_person ON public.person_emails USING btree (person_id);


--
-- Name: idx_threads_engagement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_engagement ON public.threads USING btree (engagement_id);


--
-- Name: idx_threads_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_organization ON public.threads USING btree (organization_id);


--
-- Name: uq_actors_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_actors_agent ON public.actors USING btree (agent_id) WHERE (agent_id IS NOT NULL);


--
-- Name: uq_actors_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_actors_user ON public.actors USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: uq_deliverables_order; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_deliverables_order ON public.deliverables USING btree (engagement_id, sort_order) WHERE (sort_order IS NOT NULL);


--
-- Name: uq_eng_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_eng_primary ON public.engagement_people USING btree (engagement_id) WHERE is_primary;


--
-- Name: uq_engagement_finance_events_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_engagement_finance_events_source ON public.engagement_finance_events USING btree (source, source_id) WHERE (source_id IS NOT NULL);


--
-- Name: uq_interactions_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_interactions_source ON public.interactions USING btree (source, source_id) WHERE (source_id IS NOT NULL);


--
-- Name: uq_people_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_people_email ON public.people USING btree (lower(email)) WHERE (email IS NOT NULL);


--
-- Name: uq_person_emails_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_person_emails_norm ON public.person_emails USING btree (email_normalized);


--
-- Name: uq_person_emails_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_person_emails_primary ON public.person_emails USING btree (person_id) WHERE is_primary;


--
-- Name: uq_threads_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_threads_source ON public.threads USING btree (source, source_thread_id) WHERE (source_thread_id IS NOT NULL);


--
-- Name: uq_users_person; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_users_person ON public.users USING btree (person_id);


--
-- Name: actors trg_actors_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_actors_updated BEFORE UPDATE ON public.actors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: agents trg_agents_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_events trg_audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_events_append_only BEFORE DELETE OR UPDATE OR TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_audit_events_mutation();


--
-- Name: actors trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.actors FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: agents trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.agents FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: deliverable_people trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.deliverable_people FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: deliverables trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: discovery_domains trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.discovery_domains FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: engagement_finance_events trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.engagement_finance_events FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: engagement_people trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.engagement_people FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: engagements trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.engagements FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: ingest_batches trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.ingest_batches FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: interaction_participants trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.interaction_participants FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: interactions trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.interactions FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: next_actions trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.next_actions FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: organizations trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: people trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: person_emails trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.person_emails FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: threads trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.threads FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: users trg_audit_row_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_row_change AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION private.audit_row_change();


--
-- Name: engagements trg_clients_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.engagements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: deliverable_people trg_deliv_people_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deliv_people_updated BEFORE UPDATE ON public.deliverable_people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: deliverables trg_deliverables_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deliverables_updated BEFORE UPDATE ON public.deliverables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: discovery_domains trg_discovery_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_discovery_updated BEFORE UPDATE ON public.discovery_domains FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: engagement_people trg_eng_people_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_eng_people_updated BEFORE UPDATE ON public.engagement_people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: engagement_finance_events trg_engagement_finance_events_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_engagement_finance_events_updated BEFORE UPDATE ON public.engagement_finance_events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: next_actions trg_next_actions_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_next_actions_updated BEFORE UPDATE ON public.next_actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations trg_org_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_org_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: people trg_people_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_people_updated BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: person_emails trg_person_emails_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_person_emails_updated BEFORE UPDATE ON public.person_emails FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: person_emails trg_sync_people_primary_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_people_primary_email AFTER INSERT OR DELETE OR UPDATE ON public.person_emails FOR EACH ROW EXECUTE FUNCTION public.sync_people_primary_email();


--
-- Name: threads trg_threads_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_threads_updated BEFORE UPDATE ON public.threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: actors actors_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: actors actors_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: audit_events audit_events_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.ingest_batches(id) ON DELETE SET NULL;


--
-- Name: deliverable_people deliverable_people_deliverable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_people
    ADD CONSTRAINT deliverable_people_deliverable_id_fkey FOREIGN KEY (deliverable_id) REFERENCES public.deliverables(id) ON DELETE CASCADE;


--
-- Name: deliverable_people deliverable_people_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverable_people
    ADD CONSTRAINT deliverable_people_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: deliverables deliverables_created_by_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_created_by_actor_id_fkey FOREIGN KEY (created_by_actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: deliverables deliverables_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: deliverables deliverables_source_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliverables
    ADD CONSTRAINT deliverables_source_interaction_id_fkey FOREIGN KEY (source_interaction_id) REFERENCES public.interactions(id) ON DELETE SET NULL;


--
-- Name: discovery_domains discovery_domains_mapped_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_domains
    ADD CONSTRAINT discovery_domains_mapped_org_id_fkey FOREIGN KEY (mapped_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: discovery_observations discovery_observations_domain_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_observations
    ADD CONSTRAINT discovery_observations_domain_fkey FOREIGN KEY (domain) REFERENCES public.discovery_domains(domain) ON DELETE CASCADE;


--
-- Name: engagement_finance_events engagement_finance_events_created_by_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_finance_events
    ADD CONSTRAINT engagement_finance_events_created_by_actor_id_fkey FOREIGN KEY (created_by_actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: engagement_finance_events engagement_finance_events_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_finance_events
    ADD CONSTRAINT engagement_finance_events_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: engagement_finance_events engagement_finance_events_source_deliverable_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_finance_events
    ADD CONSTRAINT engagement_finance_events_source_deliverable_id_fkey FOREIGN KEY (source_deliverable_id) REFERENCES public.deliverables(id) ON DELETE SET NULL;


--
-- Name: engagement_finance_events engagement_finance_events_source_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_finance_events
    ADD CONSTRAINT engagement_finance_events_source_interaction_id_fkey FOREIGN KEY (source_interaction_id) REFERENCES public.interactions(id) ON DELETE SET NULL;


--
-- Name: engagement_people engagement_people_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_people
    ADD CONSTRAINT engagement_people_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: engagement_people engagement_people_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagement_people
    ADD CONSTRAINT engagement_people_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: engagements engagements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagements
    ADD CONSTRAINT engagements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: engagements engagements_owner_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagements
    ADD CONSTRAINT engagements_owner_actor_id_fkey FOREIGN KEY (owner_actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: engagements engagements_provider_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engagements
    ADD CONSTRAINT engagements_provider_org_id_fkey FOREIGN KEY (provider_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: interaction_participants interaction_participants_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_participants
    ADD CONSTRAINT interaction_participants_interaction_id_fkey FOREIGN KEY (interaction_id) REFERENCES public.interactions(id) ON DELETE CASCADE;


--
-- Name: interaction_participants interaction_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_participants
    ADD CONSTRAINT interaction_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: interactions interactions_created_by_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_created_by_actor_id_fkey FOREIGN KEY (created_by_actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: interactions interactions_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: interactions interactions_related_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_related_interaction_id_fkey FOREIGN KEY (related_interaction_id) REFERENCES public.interactions(id) ON DELETE SET NULL;


--
-- Name: interactions interactions_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interactions
    ADD CONSTRAINT interactions_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id) ON DELETE SET NULL;


--
-- Name: next_actions next_actions_assignee_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_assignee_actor_id_fkey FOREIGN KEY (assignee_actor_id) REFERENCES public.actors(id) ON DELETE SET NULL;


--
-- Name: next_actions next_actions_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: next_actions next_actions_source_interaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_source_interaction_id_fkey FOREIGN KEY (source_interaction_id) REFERENCES public.interactions(id) ON DELETE SET NULL;


--
-- Name: people people_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.people
    ADD CONSTRAINT people_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: person_emails person_emails_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_emails
    ADD CONSTRAINT person_emails_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: threads threads_engagement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES public.engagements(id) ON DELETE CASCADE;


--
-- Name: threads threads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: users users_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;


--
-- Name: actors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;

--
-- Name: agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: deliverable_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deliverable_people ENABLE ROW LEVEL SECURITY;

--
-- Name: deliverables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deliverables ENABLE ROW LEVEL SECURITY;

--
-- Name: discovery_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discovery_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: discovery_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discovery_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_finance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_finance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: engagement_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagement_people ENABLE ROW LEVEL SECURITY;

--
-- Name: engagements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.engagements ENABLE ROW LEVEL SECURITY;

--
-- Name: ingest_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingest_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: interaction_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interaction_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: next_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.next_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

--
-- Name: person_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- The CRM is service-connection-only by default. Database owners retain their
-- privileges; additional application roles must be granted access explicitly.
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;

--
-- PostgreSQL database dump complete
--
