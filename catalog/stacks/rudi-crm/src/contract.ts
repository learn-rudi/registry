import {
  ActivityFeedInput,
  AttentionBriefInput,
  DEFAULT_RESULT_LIMIT,
  EngagementContextInput,
  LatestCorrespondenceInput,
  LimitInput,
  ListContactCandidatesInput,
  ListEngagementsInput,
  ListOrganizationsInput,
  ListPeopleInput,
  LogIngestBatchInput,
  PromoteContactInput,
  RecordDiscoveryObservationsInput,
  RecordFinanceEventInput,
  UpsertInteractionInput,
  parseToolArgs,
} from "./schemas.js";
import {
  VALIDATOR_VIEWS,
  getPool
} from "./database.js";
export { closePool, createPoolConfig, crmErrorMessage, getConfigStatus, getSetupStatus, runValidators } from "./database.js";

type ValidatorView = (typeof VALIDATOR_VIEWS)[number];

type QueryParts = {
  clauses: string[];
  params: unknown[];
};

function addParam(parts: QueryParts, value: unknown, cast?: string): string {
  parts.params.push(value);
  return `$${parts.params.length}${cast ? `::${cast}` : ""}`;
}

function addLowerEquals(parts: QueryParts, column: string, value: string | undefined): void {
  if (!value) {
    return;
  }

  parts.clauses.push(`lower(${column}) = lower(${addParam(parts, value, "text")})`);
}

function addSearch(parts: QueryParts, columns: string[], value: string | undefined): void {
  if (!value) {
    return;
  }

  const param = addParam(parts, `%${value}%`, "text");
  parts.clauses.push(`(${columns.map((column) => `${column} ilike ${param}`).join(" or ")})`);
}

function whereSql(parts: QueryParts): string {
  return parts.clauses.length > 0 ? parts.clauses.join("\n      and ") : "true";
}

function pagedResult(rows: Array<Record<string, unknown>>) {
  const count = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
  return {
    count,
    returned: rows.length,
    rows: rows.map(({ total_count: _totalCount, ...row }) => row),
  };
}

export async function recordDiscoveryObservations(args: unknown) {
  const input = parseToolArgs(RecordDiscoveryObservationsInput, args);
  const result = await getPool().query(
    "select record_discovery_observations($1::jsonb) as result",
    [JSON.stringify(input.observations)]
  );
  return result.rows[0]?.result ?? null;
}

export async function applyDiscoveryHeuristics() {
  const result = await getPool().query(
    "select apply_discovery_domain_heuristics()::integer as updated"
  );
  return { updated: Number(result.rows[0]?.updated ?? 0) };
}

export async function listContactCandidates(args: unknown) {
  const input = parseToolArgs(ListContactCandidatesInput, args);
  const result = await getPool().query(
    `
    select c.*, count(*) over()::integer as total_count
    from v_contact_candidates c
    where c.observation_count >= $1::integer
      and ($2::timestamptz is null or c.last_seen >= $2::timestamptz)
      and ($3::boolean or c.existing_person_id is null)
    order by c.observation_count desc, c.last_seen desc, c.email
    limit $4::integer
    offset $5::integer
    `,
    [
      input.min_observations,
      input.since ?? null,
      input.include_existing,
      input.limit,
      input.offset,
    ]
  );
  return pagedResult(result.rows);
}

export async function promoteContact(args: unknown) {
  const input = parseToolArgs(PromoteContactInput, args);
  const result = await getPool().query(
    `
    select promote_contact(
      p_email := $1::text,
      p_full_name := $2::text,
      p_existing_person_id := $3::uuid,
      p_organization_id := $4::uuid,
      p_title := $5::text,
      p_phone := $6::text,
      p_role := $7::text,
      p_notes := $8::text,
      p_email_label := $9::text,
      p_source := $10::text,
      p_created_by_actor_id := $11::uuid
    ) as result
    `,
    [
      input.email,
      input.full_name,
      input.existing_person_id ?? null,
      input.organization_id ?? null,
      input.title ?? null,
      input.phone ?? null,
      input.role ?? null,
      input.notes ?? null,
      input.email_label,
      input.source,
      input.created_by_actor_id ?? null,
    ]
  );
  return result.rows[0]?.result ?? null;
}

export async function logIngestBatch(args: unknown) {
  const input = parseToolArgs(LogIngestBatchInput, args);
  const result = await getPool().query(
    `
    select log_ingest_batch(
      $1::text,
      $2::date,
      $3::date,
      $4::text,
      $5::integer,
      $6::integer,
      $7::integer,
      $8::integer,
      $9::integer,
      $10::text,
      $11::text
    ) as id
    `,
    [
      input.source,
      input.window_start ?? null,
      input.window_end ?? null,
      input.domain_filter ?? null,
      input.messages_seen ?? 0,
      input.messages_inserted ?? 0,
      input.messages_updated ?? 0,
      input.skipped_noise ?? 0,
      input.triage_count ?? 0,
      input.validator_result ?? null,
      input.notes ?? null,
    ]
  );
  return { id: result.rows[0]?.id ?? null };
}

export async function upsertInteraction(args: unknown) {
  const input = parseToolArgs(UpsertInteractionInput, args);
  const result = await getPool().query(
    `
    select upsert_interaction(
      p_source := $1::text,
      p_source_id := $2::text,
      p_channel := $3::text,
      p_direction := $4::text,
      p_occurred_at := $5::timestamptz,
      p_subject := $6::text,
      p_summary := $7::text,
      p_source_url := $8::text,
      p_engagement_id := $9::uuid,
      p_thread_id := $10::uuid,
      p_created_by_actor_id := $11::uuid,
      p_related_interaction_id := $12::uuid
    ) as id
    `,
    [
      input.source,
      input.source_id,
      input.channel,
      input.direction,
      input.occurred_at,
      input.subject,
      input.summary,
      input.source_url ?? null,
      input.engagement_id ?? null,
      input.thread_id ?? null,
      input.created_by_actor_id ?? null,
      input.related_interaction_id ?? null,
    ]
  );

  return {
    id: result.rows[0]?.id ?? null,
    idempotency: {
      source: input.source,
      source_id: input.source_id,
    },
  };
}

export async function recordFinanceEvent(args: unknown) {
  const input = parseToolArgs(RecordFinanceEventInput, args);
  const result = await getPool().query(
    `
    select record_finance_event(
      p_engagement_id := $1::uuid,
      p_event_type := $2::text,
      p_amount := $3::numeric,
      p_occurred_at := $4::timestamptz,
      p_source := $5::text,
      p_direction := $6::text,
      p_currency := $7::text,
      p_source_id := $8::text,
      p_source_url := $9::text,
      p_source_interaction_id := $10::uuid,
      p_source_deliverable_id := $11::uuid,
      p_created_by_actor_id := $12::uuid,
      p_notes := $13::text
    ) as id
    `,
    [
      input.engagement_id,
      input.event_type,
      input.amount,
      input.occurred_at,
      input.source,
      input.direction,
      input.currency,
      input.source_id ?? null,
      input.source_url ?? null,
      input.source_interaction_id ?? null,
      input.source_deliverable_id ?? null,
      input.created_by_actor_id ?? null,
      input.notes ?? null,
    ]
  );

  return {
    id: result.rows[0]?.id ?? null,
    idempotency: {
      source: input.source,
      source_id: input.source_id ?? null,
    },
  };
}

export async function listTriageQueue(args: unknown) {
  const input = parseToolArgs(LimitInput, args);
  const result = await getPool().query("select * from v_triage_queue limit $1", [
    input.limit ?? DEFAULT_RESULT_LIMIT,
  ]);
  return {
    count: result.rowCount ?? 0,
    rows: result.rows,
  };
}

export async function getUnknownDiscoveryDomains(args: unknown) {
  const input = parseToolArgs(LimitInput, args);
  const result = await getPool().query(
    "select * from get_unknown_discovery_domains() limit $1",
    [input.limit ?? DEFAULT_RESULT_LIMIT]
  );
  return {
    count: result.rowCount ?? 0,
    rows: result.rows,
  };
}

export async function listPeople(args: unknown) {
  const input = parseToolArgs(ListPeopleInput, args);
  const filters: QueryParts = { clauses: [], params: [] };

  addLowerEquals(filters, "o.name", input.organization_name);
  addLowerEquals(filters, "o.category", input.organization_category);

  const engagementClauses = ["ep_filter.person_id = p.id"];
  if (input.engagement_id) {
    engagementClauses.push(`ep_filter.engagement_id = ${addParam(filters, input.engagement_id, "uuid")}`);
  }
  if (input.engagement_name) {
    engagementClauses.push(`lower(e_filter.name) = lower(${addParam(filters, input.engagement_name, "text")})`);
  }
  if (input.role) {
    engagementClauses.push(`lower(ep_filter.role) = lower(${addParam(filters, input.role, "text")})`);
  }
  if (engagementClauses.length > 1) {
    filters.clauses.push(`
      exists (
        select 1
        from engagement_people ep_filter
        join engagements e_filter on e_filter.id = ep_filter.engagement_id
        where ${engagementClauses.join("\n          and ")}
      )
    `);
  }

  addSearch(filters, [
    "p.full_name",
    "p.email",
    "primary_email.email",
    "p.title",
    "p.role",
    "o.name",
    "o.domain",
  ], input.search);

  if (input.has_email === true) {
    filters.clauses.push("nullif(coalesce(primary_email.email, p.email), '') is not null");
  }
  if (input.has_email === false) {
    filters.clauses.push("nullif(coalesce(primary_email.email, p.email), '') is null");
  }

  const where = whereSql(filters);
  const limitRef = addParam(filters, input.limit, "integer");
  const offsetRef = addParam(filters, input.offset, "integer");
  const result = await getPool().query(
    `
    select
      p.id,
      p.full_name,
      coalesce(primary_email.email, p.email) as email,
      p.title,
      p.phone,
      p.role,
      p.notes,
      p.created_at,
      p.updated_at,
      case
        when o.id is null then null
        else jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'domain', o.domain,
          'category', o.category,
          'industry', o.industry
        )
      end as organization,
      coalesce(engagement_links.engagements, '[]'::jsonb) as engagements,
      (count(*) over())::integer as total_count
    from people p
    left join organizations o on o.id = p.organization_id
    left join lateral (
      select pe.email
      from person_emails pe
      where pe.person_id = p.id
      order by pe.is_primary desc, pe.verified_at desc nulls last, pe.created_at desc nulls last
      limit 1
    ) primary_email on true
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'status', e.status,
          'pipeline_stage', e.pipeline_stage,
          'role', ep.role,
          'is_primary', ep.is_primary
        )
        order by ep.is_primary desc, e.updated_at desc nulls last, e.name
      ) as engagements
      from engagement_people ep
      join engagements e on e.id = ep.engagement_id
      where ep.person_id = p.id
    ) engagement_links on true
    where ${where}
    order by p.full_name asc nulls last, p.created_at desc nulls last
    limit ${limitRef}
    offset ${offsetRef}
    `,
    filters.params
  );

  return pagedResult(result.rows);
}

export async function listOrganizations(args: unknown) {
  const input = parseToolArgs(ListOrganizationsInput, args);
  const filters: QueryParts = { clauses: [], params: [] };

  addLowerEquals(filters, "o.category", input.category);
  addSearch(filters, ["o.name", "o.domain", "o.website", "o.industry", "o.notes"], input.search);

  if (input.has_engagements === true) {
    filters.clauses.push("exists (select 1 from engagements e_filter where e_filter.organization_id = o.id)");
  }
  if (input.has_engagements === false) {
    filters.clauses.push("not exists (select 1 from engagements e_filter where e_filter.organization_id = o.id)");
  }

  const where = whereSql(filters);
  const limitRef = addParam(filters, input.limit, "integer");
  const offsetRef = addParam(filters, input.offset, "integer");
  const result = await getPool().query(
    `
    select
      o.id,
      o.name,
      o.domain,
      o.category,
      o.website,
      o.industry,
      o.notes,
      o.created_at,
      o.updated_at,
      coalesce(people_counts.people_count, 0) as people_count,
      coalesce(engagement_counts.engagement_count, 0) as engagement_count,
      latest.latest_interaction_at,
      (count(*) over())::integer as total_count
    from organizations o
    left join lateral (
      select count(*)::integer as people_count
      from people p
      where p.organization_id = o.id
    ) people_counts on true
    left join lateral (
      select count(*)::integer as engagement_count
      from engagements e
      where e.organization_id = o.id
    ) engagement_counts on true
    left join lateral (
      select max(i.occurred_at) as latest_interaction_at
      from engagements e
      join interactions i on i.engagement_id = e.id
      where e.organization_id = o.id
    ) latest on true
    where ${where}
    order by latest.latest_interaction_at desc nulls last, o.updated_at desc nulls last, o.name
    limit ${limitRef}
    offset ${offsetRef}
    `,
    filters.params
  );

  return pagedResult(result.rows);
}

export async function listEngagements(args: unknown) {
  const input = parseToolArgs(ListEngagementsInput, args);
  const filters: QueryParts = { clauses: [], params: [] };

  addLowerEquals(filters, "o.name", input.organization_name);
  addLowerEquals(filters, "o.category", input.organization_category);
  addLowerEquals(filters, "e.pipeline_stage", input.pipeline_stage);
  addLowerEquals(filters, "e.status", input.status);
  addLowerEquals(filters, "e.priority", input.priority);
  addSearch(filters, ["e.name", "e.description", "o.name", "o.domain"], input.search);

  if (input.stale_days) {
    const staleDaysRef = addParam(filters, input.stale_days, "integer");
    filters.clauses.push(`
      (
        latest.latest_interaction_at is null
        or latest.latest_interaction_at < current_timestamp - (${staleDaysRef} * interval '1 day')
      )
    `);
  }

  const where = whereSql(filters);
  const limitRef = addParam(filters, input.limit, "integer");
  const offsetRef = addParam(filters, input.offset, "integer");
  const result = await getPool().query(
    `
    select
      e.id,
      e.name,
      e.pipeline_stage,
      e.status,
      e.service_type,
      e.estimated_value,
      e.probability,
      e.expected_close,
      e.billing_entity,
      e.priority,
      e.sensitivity,
      e.currency,
      e.closed_at,
      e.lost_reason,
      e.description,
      e.github_url,
      e.drive_url,
      e.dropbox_path,
      e.notion_url,
      e.created_at,
      e.updated_at,
      case
        when o.id is null then null
        else jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'domain', o.domain,
          'category', o.category,
          'industry', o.industry
        )
      end as organization,
      coalesce(people_counts.people_count, 0) as people_count,
      coalesce(open_actions.open_next_action_count, 0) as open_next_action_count,
      latest.latest_interaction_at,
      (count(*) over())::integer as total_count
    from engagements e
    left join organizations o on o.id = e.organization_id
    left join lateral (
      select count(*)::integer as people_count
      from engagement_people ep
      where ep.engagement_id = e.id
    ) people_counts on true
    left join lateral (
      select count(*)::integer as open_next_action_count
      from next_actions na
      where na.engagement_id = e.id
        and na.done = false
    ) open_actions on true
    left join lateral (
      select max(i.occurred_at) as latest_interaction_at
      from interactions i
      where i.engagement_id = e.id
    ) latest on true
    where ${where}
    order by latest.latest_interaction_at desc nulls last, e.updated_at desc nulls last, e.created_at desc nulls last
    limit ${limitRef}
    offset ${offsetRef}
    `,
    filters.params
  );

  return pagedResult(result.rows);
}

export async function getActivityFeed(args: unknown) {
  const input = parseToolArgs(ActivityFeedInput, args);
  const filters: QueryParts = { clauses: [], params: [] };

  if (input.engagement_id) {
    filters.clauses.push(`i.engagement_id = ${addParam(filters, input.engagement_id, "uuid")}`);
  }
  addLowerEquals(filters, "o.name", input.organization_name);
  addLowerEquals(filters, "o.category", input.organization_category);
  addLowerEquals(filters, "e.name", input.engagement_name);
  addLowerEquals(filters, "i.source", input.source);
  addLowerEquals(filters, "i.channel", input.channel);
  if (input.direction) {
    filters.clauses.push(`i.direction = ${addParam(filters, input.direction, "text")}`);
  }
  if (input.since) {
    filters.clauses.push(`i.occurred_at >= ${addParam(filters, input.since, "timestamptz")}`);
  }
  if (input.until) {
    filters.clauses.push(`i.occurred_at <= ${addParam(filters, input.until, "timestamptz")}`);
  }

  const where = whereSql(filters);
  const limitRef = addParam(filters, input.limit, "integer");
  const offsetRef = addParam(filters, input.offset, "integer");
  const result = await getPool().query(
    `
    select
      i.id,
      i.channel,
      i.direction,
      i.occurred_at,
      i.subject,
      i.summary,
      i.source,
      i.source_id,
      i.source_url,
      case
        when t.id is null then null
        else jsonb_build_object(
          'id', t.id,
          'subject', t.subject,
          'channel', t.channel,
          'source', t.source,
          'last_activity', t.last_activity
        )
      end as thread,
      jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'status', e.status,
        'pipeline_stage', e.pipeline_stage,
        'priority', e.priority
      ) as engagement,
      case
        when o.id is null then null
        else jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'domain', o.domain,
          'category', o.category
        )
      end as organization,
      (count(*) over())::integer as total_count
    from interactions i
    join engagements e on e.id = i.engagement_id
    left join organizations o on o.id = e.organization_id
    left join threads t on t.id = i.thread_id
    where ${where}
    order by i.occurred_at desc nulls last, i.created_at desc nulls last
    limit ${limitRef}
    offset ${offsetRef}
    `,
    filters.params
  );

  return pagedResult(result.rows);
}

export async function getAttentionBrief(args: unknown) {
  const input = parseToolArgs(AttentionBriefInput, args);
  const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
  const limit = input.limit ?? DEFAULT_RESULT_LIMIT;
  const pool = getPool();

  const [overdue, undated, unanswered, stale] = await Promise.all([
    pool.query(
      `
      select
        na.id,
        na.description,
        na.due_date,
        na.priority,
        na.created_at,
        na.updated_at,
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'status', e.status,
          'pipeline_stage', e.pipeline_stage,
          'priority', e.priority
        ) as engagement,
        case
          when o.id is null then null
          else jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'domain', o.domain,
            'category', o.category
          )
        end as organization
      from next_actions na
      join engagements e on e.id = na.engagement_id
      left join organizations o on o.id = e.organization_id
      where na.done = false
        and na.due_date is not null
        and na.due_date < $1::date
      order by na.due_date asc, na.created_at asc
      limit $2::integer
      `,
      [asOf, limit]
    ),
    pool.query(
      `
      select
        na.id,
        na.description,
        na.due_date,
        na.priority,
        na.created_at,
        na.updated_at,
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'status', e.status,
          'pipeline_stage', e.pipeline_stage,
          'priority', e.priority
        ) as engagement,
        case
          when o.id is null then null
          else jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'domain', o.domain,
            'category', o.category
          )
        end as organization
      from next_actions na
      join engagements e on e.id = na.engagement_id
      left join organizations o on o.id = e.organization_id
      where na.done = false
        and na.due_date is null
      order by na.created_at desc
      limit $1::integer
      `,
      [limit]
    ),
    pool.query(
      `
      with latest as (
        select distinct on (i.engagement_id)
          i.*
        from interactions i
        where i.engagement_id is not null
        order by i.engagement_id, i.occurred_at desc nulls last, i.created_at desc
      )
      select
        i.id,
        i.channel,
        i.occurred_at,
        i.subject,
        i.summary,
        i.source,
        i.source_id,
        i.source_url,
        greatest(($1::date - i.occurred_at::date), 0) as age_days,
        jsonb_build_object(
          'id', e.id,
          'name', e.name,
          'status', e.status,
          'pipeline_stage', e.pipeline_stage,
          'priority', e.priority
        ) as engagement,
        case
          when o.id is null then null
          else jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'domain', o.domain,
            'category', o.category
          )
        end as organization
      from latest i
      join engagements e on e.id = i.engagement_id
      left join organizations o on o.id = e.organization_id
      where i.direction = 'inbound'
        and lower(coalesce(e.status, '')) not in ('done', 'closed', 'lost')
      order by i.occurred_at asc nulls last, i.created_at asc
      limit $2::integer
      `,
      [asOf, limit]
    ),
    pool.query(
      `
      select
        e.id,
        e.name,
        e.status,
        e.pipeline_stage,
        e.priority,
        e.service_type,
        e.estimated_value,
        e.expected_close,
        e.updated_at,
        latest.latest_interaction_at,
        case
          when latest.latest_interaction_at is null then null
          else greatest(($1::date - latest.latest_interaction_at::date), 0)
        end as days_since_latest_interaction,
        coalesce(open_actions.open_next_action_count, 0) as open_next_action_count,
        case
          when o.id is null then null
          else jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'domain', o.domain,
            'category', o.category
          )
        end as organization
      from engagements e
      left join organizations o on o.id = e.organization_id
      left join lateral (
        select max(i.occurred_at) as latest_interaction_at
        from interactions i
        where i.engagement_id = e.id
      ) latest on true
      left join lateral (
        select count(*)::integer as open_next_action_count
        from next_actions na
        where na.engagement_id = e.id
          and na.done = false
      ) open_actions on true
      where lower(coalesce(e.status, '')) not in ('done', 'closed', 'lost')
        and (
          latest.latest_interaction_at is null
          or latest.latest_interaction_at < $1::date - ($2::integer * interval '1 day')
        )
      order by latest.latest_interaction_at asc nulls first, e.updated_at asc nulls last
      limit $3::integer
      `,
      [asOf, input.stale_days, limit]
    ),
  ]);

  return {
    as_of: asOf,
    stale_days: input.stale_days,
    limit,
    counts: {
      overdue_next_actions: overdue.rowCount ?? 0,
      undated_open_next_actions: undated.rowCount ?? 0,
      unanswered_inbound: unanswered.rowCount ?? 0,
      stale_engagements: stale.rowCount ?? 0,
    },
    overdue_next_actions: overdue.rows,
    undated_open_next_actions: undated.rows,
    unanswered_inbound: unanswered.rows,
    stale_engagements: stale.rows,
  };
}

function targetEngagementWhere(args: {
  engagement_id?: string;
  organization_name?: string;
  engagement_name?: string;
}): {
  clause: string;
  params: unknown[];
} {
  if (args.engagement_id) {
    return { clause: "e.id = $1::uuid", params: [args.engagement_id] };
  }
  if ("engagement_name" in args && args.engagement_name) {
    return { clause: "lower(e.name) = lower($1::text)", params: [args.engagement_name] };
  }
  if (args.organization_name) {
    return { clause: "lower(o.name) = lower($1::text)", params: [args.organization_name] };
  }
  throw new Error("A target engagement or organization is required");
}

export async function getEngagementContext(args: unknown) {
  const input = parseToolArgs(EngagementContextInput, args);
  const target = targetEngagementWhere(input);
  const interactionLimit = input.recent_interactions_limit ?? DEFAULT_RESULT_LIMIT;

  const result = await getPool().query(
    `
    with target_engagement as (
      select e.*
      from engagements e
      left join organizations o on o.id = e.organization_id
      where ${target.clause}
      order by e.updated_at desc nulls last, e.created_at desc nulls last
      limit 1
    )
    select jsonb_build_object(
      'engagement', to_jsonb(e),
      'organization', to_jsonb(o),
      'people', coalesce((
        select jsonb_agg(jsonb_build_object(
          'person', to_jsonb(p),
          'role', ep.role,
          'is_primary', ep.is_primary
        ) order by ep.is_primary desc, p.full_name)
        from engagement_people ep
        join people p on p.id = ep.person_id
        where ep.engagement_id = e.id
      ), '[]'::jsonb),
      'next_actions', coalesce((
        select jsonb_agg(to_jsonb(na) order by na.done asc, na.due_date asc nulls last, na.created_at desc)
        from next_actions na
        where na.engagement_id = e.id
      ), '[]'::jsonb),
      'finance_summary', (
        select to_jsonb(fs)
        from v_engagement_financial_summary fs
        where fs.engagement_id = e.id
        limit 1
      ),
      'recent_interactions', coalesce((
        select jsonb_agg(to_jsonb(i) order by i.occurred_at desc)
        from (
          select id, channel, direction, occurred_at, subject, summary, source, source_id, source_url
          from interactions
          where engagement_id = e.id
          order by occurred_at desc nulls last
          limit $${target.params.length + 1}
        ) i
      ), '[]'::jsonb)
    ) as context
    from target_engagement e
    left join organizations o on o.id = e.organization_id
    `,
    [...target.params, interactionLimit]
  );

  return result.rows[0]?.context ?? null;
}

export async function getLatestCorrespondence(args: unknown) {
  const input = parseToolArgs(LatestCorrespondenceInput, args);
  const target = targetEngagementWhere(input);
  const params = [...target.params];
  let sourceClause = "";

  if (input.source) {
    params.push(input.source);
    sourceClause = `and i.source = $${params.length}::text`;
  }

  params.push(input.limit ?? DEFAULT_RESULT_LIMIT);
  const limitRef = `$${params.length}`;

  const result = await getPool().query(
    `
    select
      i.id,
      i.channel,
      i.direction,
      i.occurred_at,
      i.subject,
      i.summary,
      i.source,
      i.source_id,
      i.source_url,
      t.subject as thread_subject,
      e.id as engagement_id,
      e.name as engagement_name,
      o.name as organization_name
    from interactions i
    join engagements e on e.id = i.engagement_id
    left join organizations o on o.id = e.organization_id
    left join threads t on t.id = i.thread_id
    where ${target.clause}
      ${sourceClause}
    order by i.occurred_at desc nulls last
    limit ${limitRef}
    `,
    params
  );

  return {
    count: result.rowCount ?? 0,
    rows: result.rows,
  };
}

export type { ValidatorView };
