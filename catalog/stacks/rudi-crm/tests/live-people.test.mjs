import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  closePool,
  createPoolConfig,
  listPeople,
} from "../dist/contract.js";

const RUN_LIVE_TESTS = process.env.RUDI_CRM_LIVE_TESTS === "1";
const DATABASE_URL = process.env.RUDI_CRM_DATABASE_URL;
const liveSkipReason = !RUN_LIVE_TESTS
  ? "Set RUDI_CRM_LIVE_TESTS=1 to run live people read-contract tests"
  : !DATABASE_URL
    ? "RUDI_CRM_DATABASE_URL is required for live people read-contract tests"
    : false;

const { Pool } = pg;

test(
  "list_people exposes every stored email and its label",
  { skip: liveSkipReason },
  async () => {
    const result = await listPeople({ limit: 100, offset: 0 });
    assert.ok(result.returned > 0, "live CRM needs at least one person");

    const personIds = result.rows.map((person) => person.id);
    const verificationPool = new Pool(createPoolConfig(DATABASE_URL));

    try {
      const expected = await verificationPool.query(
        `
        select
          pe.person_id,
          jsonb_agg(
            jsonb_build_object(
              'id', pe.id,
              'email', pe.email,
              'email_normalized', pe.email_normalized,
              'label', pe.label,
              'is_primary', pe.is_primary,
              'verified_at', pe.verified_at,
              'source', pe.source
            )
            order by pe.is_primary desc, pe.email_normalized, pe.id
          ) as emails
        from person_emails pe
        where pe.person_id = any($1::uuid[])
        group by pe.person_id
        `,
        [personIds]
      );
      const expectedByPerson = new Map(
        expected.rows.map((row) => [row.person_id, row.emails])
      );

      for (const person of result.rows) {
        assert.deepEqual(
          person.emails,
          expectedByPerson.get(person.id) ?? [],
          `email labels differ for ${person.full_name ?? person.id}`
        );
      }
    } finally {
      await verificationPool.end();
      await closePool();
    }
  }
);
