import type { Pool } from "pg";

import {
  ClassifyContactAddressInput,
  ListContactCandidatesInput,
  LogIngestBatchInput,
  PromoteContactInput,
  RecordDiscoveryObservationsInput,
  parseToolArgs,
} from "./schemas.js";

type PoolProvider = () => Pool;

function pagedResult(rows: Array<Record<string, unknown>>) {
  const count = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
  return {
    count,
    returned: rows.length,
    rows: rows.map(({ total_count: _totalCount, ...row }) => row),
  };
}

export function createContactContract(getPool: PoolProvider) {
  return {
    async recordDiscoveryObservations(args: unknown) {
      const input = parseToolArgs(RecordDiscoveryObservationsInput, args);
      const result = await getPool().query(
        "select record_discovery_observations($1::jsonb) as result",
        [JSON.stringify(input.observations)]
      );
      return result.rows[0]?.result ?? null;
    },

    async applyDiscoveryHeuristics() {
      const result = await getPool().query(
        "select apply_discovery_domain_heuristics()::integer as updated"
      );
      return { updated: Number(result.rows[0]?.updated ?? 0) };
    },

    async listContactCandidates(args: unknown) {
      const input = parseToolArgs(ListContactCandidatesInput, args);
      const result = await getPool().query(
        `
        select c.*, count(*) over()::integer as total_count
        from v_contact_candidates c
        where c.observation_count >= $1::integer
          and ($2::timestamptz is null or c.last_seen >= $2::timestamptz)
          and ($3::boolean or c.existing_person_id is null)
          and ($4::text is null or c.address_category = $4::text)
        order by c.observation_count desc, c.last_seen desc, c.email
        limit $5::integer
        offset $6::integer
        `,
        [
          input.min_observations,
          input.since ?? null,
          input.include_existing,
          input.address_category ?? null,
          input.limit,
          input.offset,
        ]
      );
      return pagedResult(result.rows);
    },

    async classifyContactAddress(args: unknown) {
      const input = parseToolArgs(ClassifyContactAddressInput, args);
      const result = await getPool().query(
        `
        select classify_contact_address(
          p_email := $1::text,
          p_category := $2::text,
          p_source := $3::text,
          p_reason := $4::text,
          p_created_by_actor_id := $5::uuid
        ) as result
        `,
        [
          input.email,
          input.category,
          input.source,
          input.reason ?? null,
          input.created_by_actor_id ?? null,
        ]
      );
      return result.rows[0]?.result ?? null;
    },

    async promoteContact(args: unknown) {
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
    },

    async logIngestBatch(args: unknown) {
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
    },
  };
}
