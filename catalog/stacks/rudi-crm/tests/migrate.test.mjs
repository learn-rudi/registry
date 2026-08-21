import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import {
  applyMigrations,
  assertCompatibleMigrationChecksum,
  assertKnownMigrationLedgerEntries,
  loadMigrations,
  validateDatabaseUrl,
} from "../dist/migrate.js";
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
const execFileAsync = promisify(execFile);
const registryRoot = path.resolve(new URL("../../../../", import.meta.url).pathname);

test("migration URL validation accepts PostgreSQL and rejects ambiguous targets", () => {
  const localUrl = "postgresql://127.0.0.1:5432/rudi_crm";

  assert.equal(validateDatabaseUrl(localUrl), localUrl);
  assert.throws(() => validateDatabaseUrl(undefined), /environment variable not set/);
  assert.throws(() => validateDatabaseUrl("not-a-url"), /valid PostgreSQL URL/);
  assert.throws(() => validateDatabaseUrl("https://example.invalid/rudi_crm"), /protocol/);
  assert.throws(() => validateDatabaseUrl("postgresql://127.0.0.1"), /host and database/);
});

test("migration ledger accepts only canonical or exact historical checksums", async () => {
  const migrations = await loadMigrations();
  const byFilename = new Map(
    migrations.map((migration) => [migration.filename, migration.checksum])
  );

  assert.deepEqual(
    Object.fromEntries(
      [...byFilename].filter(([filename]) => filename <= "0004_contact_address_classification.sql")
    ),
    {
    "0001_engagement_crm.sql":
      "c14fbb3eff18f7bc1a02c65915cfe8dd593c7edb73080547bdbc5fff494edc7e",
    "0002_contact_discovery_promotion.sql":
      "c50c0ed11d2142f84f291b98eae40e95e03cae9f856adb3dd2605d7fa61446b3",
    "0003_contact_candidate_noise.sql":
      "fe04c8a031bb45b9cf46c6510db29692450e29b549889ec7136c70c5db3478de",
    "0004_contact_address_classification.sql":
      "1e41c3c291cb813cfdf08719521a2e5620496ca513d6747d213c4c5003c7dd38",
    }
  );

  assert.doesNotThrow(() =>
    assertCompatibleMigrationChecksum(
      "0001_engagement_crm.sql",
      byFilename.get("0001_engagement_crm.sql"),
      "b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d"
    )
  );
  assert.doesNotThrow(() =>
    assertCompatibleMigrationChecksum(
      "0002_contact_discovery_promotion.sql",
      byFilename.get("0002_contact_discovery_promotion.sql"),
      "a80fbe135f53da9ea79f48c3f0168ea005b5f38b71f339cd6d7702776f51c624"
    )
  );
  assert.throws(
    () =>
      assertCompatibleMigrationChecksum(
        "0003_contact_candidate_noise.sql",
        byFilename.get("0003_contact_candidate_noise.sql"),
        "b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d"
      ),
    /checksum drift detected: 0003_contact_candidate_noise\.sql/
  );
  assert.throws(
    () =>
      assertCompatibleMigrationChecksum(
        "9999_unknown.sql",
        "f".repeat(64),
        "b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d"
      ),
    /checksum drift detected: 9999_unknown\.sql/
  );
  assert.throws(
    () =>
      assertCompatibleMigrationChecksum(
        "0001_engagement_crm.sql",
        "e".repeat(64),
        "b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d"
      ),
    /checksum drift detected: 0001_engagement_crm\.sql/
  );
  assert.throws(
    () =>
      assertKnownMigrationLedgerEntries(migrations, [
        {
          filename: "9999_unknown.sql",
          checksum_sha256: "f".repeat(64),
        },
      ]),
    /ledger contains unknown path: 9999_unknown\.sql/
  );
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
        "0004_contact_address_classification.sql",
        "0005_discovery_security_boundary.sql",
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
          tables: 24,
          views: 14,
          functions: 20,
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
        "0004_contact_address_classification.sql",
        "0005_discovery_security_boundary.sql",
      ]);
    } finally {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
    }
  }
);

test(
  "historical repository migration variants rehearse without ledger rewrite and unknown paths fail closed",
  { skip: bootstrapSkipReason },
  async () => {
    const databaseName = `rudi_crm_historical_${randomUUID().replaceAll("-", "")}`;
    const historicalDirectory = await mkdtemp(
      path.join(tmpdir(), "rudi-crm-historical-migrations-")
    );
    const adminPool = new Pool(createPoolConfig(validateDatabaseUrl(ADMIN_DATABASE_URL)));
    const targetUrl = new URL(ADMIN_DATABASE_URL);
    targetUrl.pathname = `/${databaseName}`;
    const historicalRevision = "f7ada8214192ef048feae2bc84efe5c131713b13";
    const expectedHistorical = new Map([
      [
        "0001_engagement_crm.sql",
        "b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d",
      ],
      [
        "0002_contact_discovery_promotion.sql",
        "a80fbe135f53da9ea79f48c3f0168ea005b5f38b71f339cd6d7702776f51c624",
      ],
    ]);

    try {
      for (const [filename, expectedChecksum] of expectedHistorical) {
        const repositoryPath = `catalog/stacks/rudi-crm/sql/migrations/${filename}`;
        const { stdout } = await execFileAsync(
          "git",
          ["-C", registryRoot, "show", `${historicalRevision}:${repositoryPath}`],
          { encoding: "buffer", maxBuffer: 5_000_000 }
        );
        assert.equal(
          createHash("sha256").update(stdout).digest("hex"),
          expectedChecksum,
          `${filename} historical bytes must come from the evidenced Git revision`
        );
        await writeFile(path.join(historicalDirectory, filename), stdout);
      }

      await adminPool.query(`create database "${databaseName}"`);
      const historical = await applyMigrations({
        databaseUrl: targetUrl.toString(),
        directory: historicalDirectory,
      });
      assert.deepEqual(historical.applied, [...expectedHistorical.keys()]);

      const upgraded = await applyMigrations({ databaseUrl: targetUrl.toString() });
      assert.deepEqual(upgraded.skipped, [...expectedHistorical.keys()]);
      assert.deepEqual(upgraded.applied, [
        "0003_contact_candidate_noise.sql",
        "0004_contact_address_classification.sql",
        "0005_discovery_security_boundary.sql",
      ]);

      const targetPool = new Pool(createPoolConfig(targetUrl.toString()));
      try {
        const ledger = await targetPool.query(
          `
          select filename, checksum_sha256
          from public.rudi_crm_schema_migrations
          where filename in ('0001_engagement_crm.sql', '0002_contact_discovery_promotion.sql')
          order by filename
          `
        );
        assert.deepEqual(
          ledger.rows,
          [...expectedHistorical].map(([filename, checksum_sha256]) => ({
            filename,
            checksum_sha256,
          })),
          "compatibility must never rewrite historical ledger rows"
        );

        await targetPool.query(
          `
          insert into public.rudi_crm_schema_migrations (filename, checksum_sha256)
          values ('9999_unknown.sql', $1)
          `,
          ["f".repeat(64)]
        );
        await assert.rejects(
          applyMigrations({ databaseUrl: targetUrl.toString() }),
          /ledger contains unknown path: 9999_unknown\.sql/
        );
      } finally {
        await targetPool.end();
      }
    } finally {
      await adminPool.query(`drop database if exists "${databaseName}" with (force)`);
      await adminPool.end();
      await rm(historicalDirectory, { recursive: true, force: true });
    }
  }
);
