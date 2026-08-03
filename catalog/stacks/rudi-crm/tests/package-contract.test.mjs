import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));

test("package contract preserves the controlled CRM and finance boundary", async () => {
  const [manifest, packageJson, serverSource, contractSource, schemaSource, financeSql] =
    await Promise.all([
      fs.readFile(path.join(stackRoot, "manifest.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(stackRoot, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(stackRoot, "src/index.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "src/contract.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "src/schemas.ts"), "utf8"),
      fs.readFile(path.join(stackRoot, "sql/record_finance_event.sql"), "utf8"),
    ]);

  assert.equal(manifest.id, "stack:rudi-crm");
  assert.match(manifest.meta.boundary, /controlled write\/read contract/i);
  assert.equal(manifest.provides.tools.length, 16);
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
  ]) {
    assert.equal(contractSource.includes(symbol), true, `missing contract symbol: ${symbol}`);
  }
  for (const symbol of [
    "UpsertInteractionInput",
    "ListPeopleInput",
    "AttentionBriefInput",
    "RecordFinanceEventInput",
  ]) {
    assert.equal(schemaSource.includes(symbol), true, `missing schema symbol: ${symbol}`);
  }
  assert.equal(financeSql.includes("CREATE OR REPLACE FUNCTION public.record_finance_event"), true);
  assert.equal(financeSql.includes("finance history is immutable"), true);
});
