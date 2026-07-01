-- Versioned copy of the live RUDI CRM finance write contract.
-- Apply to the CRM Postgres project before exposing rudi_crm_record_finance_event.

CREATE OR REPLACE FUNCTION public.record_finance_event(
  p_engagement_id uuid,
  p_event_type text,
  p_amount numeric,
  p_occurred_at timestamp with time zone,
  p_source text,
  p_direction text DEFAULT 'positive'::text,
  p_currency text DEFAULT 'USD'::text,
  p_source_id text DEFAULT NULL::text,
  p_source_url text DEFAULT NULL::text,
  p_source_interaction_id uuid DEFAULT NULL::uuid,
  p_source_deliverable_id uuid DEFAULT NULL::uuid,
  p_created_by_actor_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
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

  -- Evidence links must belong to the same engagement.
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

  -- Idempotency + finance-history preservation on (source, source_id).
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
$function$;
