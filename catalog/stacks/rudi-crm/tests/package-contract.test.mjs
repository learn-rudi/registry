import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));

const EXPECTED_DATABASE_OBJECTS = [
  "organizations",
  "people",
  "person_emails",
  "users",
  "agents",
  "actors",
  "engagements",
  "threads",
  "interactions",
  "deliverables",
  "next_actions",
  "engagement_finance_events",
  "discovery_domains",
  "discovery_observations",
  "ingest_batches",
  "audit_events",
  "engagement_people",
  "interaction_participants",
  "deliverable_people",
  "record_discovery_observations",
  "log_ingest_batch",
  "record_audit_event",
  "set_audit_context",
  "upsert_interaction",
  "record_finance_event",
  "refresh_thread_rollups",
  "resolve_person_by_email",
  "apply_discovery_domain_heuristics",
  "get_unknown_discovery_domains",
  "v_validate_thread_org",
  "v_validate_interaction_engagement",
  "v_validate_thread_rollup",
  "v_validate_dupe_source",
  "v_validate_people_email_mirror",
  "v_validate_user_login_email",
  "v_validate_finance_event_links",
  "v_validate_audit_trigger_coverage",
  "v_triage_queue",
  "v_people_missing_email",
  "v_engagement_financial_summary",
];

test("package contract preserves the controlled CRM and finance boundary", async () => {
  const [manifest, packageJson, serverSource, contractSource, schemaSource, financeSql] =
    await Promise.all([
      fs.readFile(path.join(stackRoot, "manifest.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(stackRoot, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(stackRoot, "src/index.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "src/contract.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "src/schemas.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "sql/migrations/0001_engagement_crm.sql"), "utf8"),
    ]);

  assert.equal(manifest.id, "stack:rudi-crm");
  assert.match(manifest.meta.boundary, /controlled write\/read contract/i);
  assert.equal(manifest.version, "0.3.0");
  assert.equal(packageJson.version, "0.3.0");
  assert.equal(manifest.provides.tools.length, 19);
  assert.equal(packageJson.scripts["test:live"].includes("RUDI_CRM_LIVE_TESTS=1"), true);
  assert.equal(serverSource.includes("pg_execute"), false);
  assert.equal(serverSource.includes("raw_sql"), false);

  for (const symbol of [
    "record_discovery_observations",
    "log_ingest_batch",
    "upsert_interaction",
    "listPeople",
    "getActivityFeed",
    "getAttentionBrief",
    "recordFinanceEvent",
    "applyDiscoveryHeuristics",
    "listContactCandidates",
    "promoteContact",
  ]) {
    assert.equal(contractSource.includes(symbol), true, `missing contract symbol: ${symbol}`);
  }
  for (const symbol of [
    "UpsertInteractionInput",
    "ListPeopleInput",
    "AttentionBriefInput",
    "RecordFinanceEventInput",
    "ListContactCandidatesInput",
    "PromoteContactInput",
  ]) {
    assert.equal(schemaSource.includes(symbol), true, `missing schema symbol: ${symbol}`);
  }
  assert.equal(financeSql.includes("CREATE FUNCTION public.record_finance_event"), true);
  assert.equal(financeSql.includes("finance history is immutable"), true);
});

test("package ships a provider-neutral local PostgreSQL bootstrap", async () => {
  const [packageJson, registryPackageJson, manifest, readme, migrationSource, migrateSource] = await Promise.all([
    fs.readFile(path.join(stackRoot, "package.json"), "utf8").then(JSON.parse),
    fs.readFile(path.resolve(stackRoot, "../../../package.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(stackRoot, "manifest.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(stackRoot, "README.md"), "utf8"),
    fs.readFile(path.join(stackRoot, "sql/migrations/0001_engagement_crm.sql"), "utf8"),
    fs.readFile(path.join(stackRoot, "src/migrate.ts"), "utf8"),
  ]);

  assert.equal(packageJson.scripts["db:migrate"], "npm run build && node dist/migrate.js");
  assert.equal(registryPackageJson.files.includes("catalog/stacks/**/*.sql"), true);
  assert.match(manifest.meta.secretGuidance, /PostgreSQL/i);
  assert.doesNotMatch(manifest.meta.secretGuidance, /Supabase/i);
  assert.match(readme, /Local PostgreSQL \(recommended\)/i);
  assert.match(readme, /Optional: hosted PostgreSQL\/Supabase/i);
  assert.match(migrateSource, /RUDI_CRM_DATABASE_URL/);
  assert.match(migrateSource, /schema_migrations/);

  for (const objectName of EXPECTED_DATABASE_OBJECTS) {
    assert.equal(
      migrationSource.includes(objectName),
      true,
      `migration is missing required database object: ${objectName}`
    );
  }
});

test("package ships additive approval-gated contact discovery and promotion", async () => {
  const migrationSource = await fs.readFile(
    path.join(stackRoot, "sql/migrations/0002_contact_discovery_promotion.sql"),
    "utf8"
  );

  for (const symbol of [
    "display_name",
    "raw jsonb",
    "v_contact_candidates",
    "promote_contact",
    "existing_person_id",
  ]) {
    assert.equal(
      migrationSource.includes(symbol),
      true,
      `contact migration is missing required contract: ${symbol}`
    );
  }

  assert.match(migrationSource, /drop constraint discovery_observations_role_chk/i);
  assert.match(migrationSource, /on conflict \(source, source_id, address_role, address\)/i);
  assert.match(migrationSource, /collision/i);
});

test("package filters no-reply addresses without hiding mixed human domains", async () => {
  const migrationSource = await fs.readFile(
    path.join(stackRoot, "sql/migrations/0003_contact_candidate_noise.sql"),
    "utf8"
  );

  assert.match(migrationSource, /only_no_reply/i);
  assert.match(migrationSource, /v_contact_candidates/i);
  assert.match(migrationSource, /no-reply/i);
  assert.match(migrationSource, /automated\/no-reply/i);
});
