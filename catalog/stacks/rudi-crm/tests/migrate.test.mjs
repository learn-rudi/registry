import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { applyMigrations, validateDatabaseUrl } from "../dist/migrate.js";
import { createPoolConfig } from "../dist/contract.js";

const RUN_BOOTSTRAP_TESTS = process.env.RUDI_CRM_BOOTSTRAP_TESTS === "1";
const ADMIN_DATABASE_URL =
  process.env.RUDI_CRM_TEST_ADMIN_URL ??
  "postgresql://127.0.0.1:5432/postgres";
const bootstrapSkipReason = RUN_BOOTSTRAP_TESTS
  ? false
  : "Set RUDI_CRM_BOOTSTRAP_TESTS=1 to run the isolated PostgreSQL bootstrap test";

const VALIDATOR_VIEWS = [
  "v_validate_thread_org",
  "v_validate_interaction_engagement",
  "v_validate_thread_rollup",
  "v_validate_dupe_source",
  "v_validate_people_email_mirror",
  "v_validate_user_login_email",
  "v_validate_finance_event_links",
  "v_validate_audit_trigger_coverage",
];

const { Pool } = pg;

test("migration URL validation accepts PostgreSQL and rejects ambiguous targets", () => {
  const localUrl = "postgresql://127.0.0.1:5432/rudi_crm";

  assert.equal(validateDatabaseUrl(localUrl), localUrl);
  assert.throws(() => validateDatabaseUrl(undefined), /environment variable not set/);
  assert.throws(() => validateDatabaseUrl("not-a-url"), /valid PostgreSQL URL/);
  assert.throws(() => validateDatabaseUrl("https://example.invalid/rudi_crm"), /protocol/);
  assert.throws(() => validateDatabaseUrl("postgresql://127.0.0.1"), /host and database/);
});

test(
  "provider-neutral migrations bootstrap a clean PostgreSQL database idempotently",
  { skip: bootstrapSkipReason },
  async () => {
    const databaseName = `rudi_crm_bootstrap_${randomUUID().replaceAll("-", "")}`;
    assert.match(databaseName, /^[a-z0-9_]+$/);

    const adminPool = new Pool(createPoolConfig(validateDatabaseUrl(ADMIN_DATABASE_URL)));
    const targetUrl = new URL(ADMIN_DATABASE_URL);
    targetUrl.pathname = `/${databaseName}`;

    try {
      await adminPool.query(`create database "${databaseName}"`);

      const first = await applyMigrations({ databaseUrl: targetUrl.toString() });
      assert.deepEqual(first.applied, [
        "0001_engagement_crm.sql",
        "0002_contact_discovery_promotion.sql",
        "0003_contact_candidate_noise.sql",
      ]);
      assert.deepEqual(first.skipped, []);

      const targetPool = new Pool(createPoolConfig(targetUrl.toString()));
      try {
        const objects = await targetPool.query(`
          select
            (select count(*)::integer
             from information_schema.tables
             where table_schema = 'public'
               and table_type = 'BASE TABLE'
               and table_name <> 'rudi_crm_schema_migrations') as tables,
            (select count(*)::integer
             from information_schema.views
             where table_schema = 'public') as views,
            (select count(distinct p.proname)::integer
             from pg_proc p
             join pg_namespace n on n.oid = p.pronamespace
             where n.nspname in ('public', 'private')) as functions,
            (select count(*)::integer
             from information_schema.tables
             where table_schema = 'public'
               and table_name = 'rudi_crm_schema_migrations') as migration_ledgers
        `);

        assert.deepEqual(objects.rows[0], {
          tables: 19,
          views: 14,
          functions: 16,
          migration_ledgers: 1,
        });

        const discoveryColumns = await targetPool.query(`
          select column_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'discovery_observations'
            and column_name in ('display_name', 'idempotency_key', 'raw')
          order by column_name
        `);
        assert.deepEqual(
          discoveryColumns.rows.map((row) => row.column_name),
          ["display_name", "idempotency_key", "raw"]
        );

        for (const view of VALIDATOR_VIEWS) {
          const result = await targetPool.query(
            `select count(*)::integer as violations from ${view}`
          );
          assert.equal(result.rows[0]?.violations, 0, `${view} must start clean`);
        }
      } finally {
        await targetPool.end();
      }

      const second = await applyMigrations({ databaseUrl: targetUrl.toString() });
      assert.deepEqual(second.applied, []);
      assert.deepEqual(second.skipped, [
        "0001_engagement_crm.sql",
        "0002_contact_discovery_promotion.sql",
        "0003_contact_candidate_noise.sql",
      ]);
    } finally {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
    }
  }
);
