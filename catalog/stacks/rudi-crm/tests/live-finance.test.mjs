import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { createPoolConfig } from "../dist/contract.js";

const RUN_LIVE_TESTS = process.env.RUDI_CRM_LIVE_TESTS === "1";
const DATABASE_URL = process.env.RUDI_CRM_DATABASE_URL;
const liveSkipReason = !RUN_LIVE_TESTS
  ? "Set RUDI_CRM_LIVE_TESTS=1 to run live finance DB behavior tests"
  : !DATABASE_URL
    ? "RUDI_CRM_DATABASE_URL is required for live finance DB behavior tests"
    : false;

const { Pool } = pg;

function money(value) {
  return Number(value ?? 0);
}

async function financeSummary(client, engagementId) {
  const result = await client.query(
    `
    select invoiced_total, event_count
    from v_engagement_financial_summary
    where engagement_id = $1::uuid
      and currency = 'USD'
    `,
    [engagementId]
  );

  return {
    invoiced_total: money(result.rows[0]?.invoiced_total),
    event_count: Number(result.rows[0]?.event_count ?? 0),
  };
}

async function recordFinanceEvent(client, overrides = {}) {
  const payload = {
    engagement_id: overrides.engagement_id,
    event_type: overrides.event_type ?? "invoice",
    amount: overrides.amount ?? 4200,
    occurred_at: overrides.occurred_at ?? "2026-06-27T15:00:00Z",
    source: overrides.source ?? "import",
    direction: overrides.direction ?? "positive",
    currency: overrides.currency ?? "USD",
    source_id: overrides.source_id,
    source_url: overrides.source_url ?? null,
    source_interaction_id: overrides.source_interaction_id ?? null,
    source_deliverable_id: overrides.source_deliverable_id ?? null,
    created_by_actor_id: overrides.created_by_actor_id ?? null,
    notes: overrides.notes ?? null,
  };

  const result = await client.query(
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
      payload.engagement_id,
      payload.event_type,
      payload.amount,
      payload.occurred_at,
      payload.source,
      payload.direction,
      payload.currency,
      payload.source_id,
      payload.source_url,
      payload.source_interaction_id,
      payload.source_deliverable_id,
      payload.created_by_actor_id,
      payload.notes,
    ]
  );

  return result.rows[0]?.id;
}

async function expectRollbackError(client, savepoint, expectedPattern, operation) {
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
    assert.fail("expected operation to fail");
  } catch (error) {
    assert.match(error.message, expectedPattern);
    await client.query(`rollback to savepoint ${savepoint}`);
  }
}

test(
  "record_finance_event is idempotent, immutable, linked, summarized, and rollback-safe",
  { skip: liveSkipReason },
  async () => {
    const pool = new Pool(createPoolConfig(DATABASE_URL));
    const client = await pool.connect();
    const sourceId = `live-finance-test-${randomUUID()}`;

    try {
      const targetResult = await client.query(
        `
        select target.id as target_engagement_id,
               other.id as other_engagement_id,
               other_interaction.id as other_interaction_id
        from engagements target
        join engagements other on other.id <> target.id
        join interactions other_interaction on other_interaction.engagement_id = other.id
        order by target.updated_at desc nulls last,
                 target.created_at desc nulls last,
                 other_interaction.occurred_at desc nulls last
        limit 1
        `
      );
      assert.equal(targetResult.rowCount, 1, "live CRM needs two engagements and one interaction");

      const target = targetResult.rows[0];
      await client.query("begin");
      try {
        const before = await financeSummary(client, target.target_engagement_id);
        const id = await recordFinanceEvent(client, {
          engagement_id: target.target_engagement_id,
          source_id: sourceId,
        });
        assert.match(id, /^[0-9a-f-]{36}$/);

        const replayId = await recordFinanceEvent(client, {
          engagement_id: target.target_engagement_id,
          source_id: sourceId,
          source_url: "https://example.invalid/replay",
          notes: "exact replay can enrich non-core evidence fields",
        });
        assert.equal(replayId, id);

        const after = await financeSummary(client, target.target_engagement_id);
        assert.equal(after.invoiced_total - before.invoiced_total, 4200);
        assert.equal(after.event_count - before.event_count, 1);

        await expectRollbackError(client, "conflicting_replay", /finance history is immutable/, () =>
          recordFinanceEvent(client, {
            engagement_id: target.target_engagement_id,
            source_id: sourceId,
            amount: 4201,
          })
        );

        await expectRollbackError(client, "cross_engagement_link", /is on engagement .* not /, () =>
          recordFinanceEvent(client, {
            engagement_id: target.target_engagement_id,
            source_id: `${sourceId}-bad-link`,
            source_interaction_id: target.other_interaction_id,
          })
        );

        const validators = await client.query(
          "select count(*)::integer as violations from v_validate_finance_event_links"
        );
        assert.equal(validators.rows[0]?.violations, 0);
      } finally {
        await client.query("rollback");
      }

      const persisted = await client.query(
        `
        select count(*)::integer as count
        from engagement_finance_events
        where source = 'import'
          and source_id like $1::text
        `,
        [`${sourceId}%`]
      );
      assert.equal(persisted.rows[0]?.count, 0);
    } finally {
      client.release();
      await pool.end();
    }
  }
);
