import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const stackRoot = path.join(process.cwd(), "catalog/stacks/rudi-crm");
const expectedTools = [
  "rudi_crm_config_status",
  "rudi_crm_setup_status",
  "rudi_crm_record_discovery_observations",
  "rudi_crm_log_ingest_batch",
  "rudi_crm_upsert_interaction",
  "rudi_crm_record_finance_event",
  "rudi_crm_run_validators",
  "rudi_crm_list_people",
  "rudi_crm_list_organizations",
  "rudi_crm_list_engagements",
  "rudi_crm_get_activity_feed",
  "rudi_crm_get_attention_brief",
  "rudi_crm_list_triage_queue",
  "rudi_crm_get_unknown_discovery_domains",
  "rudi_crm_get_engagement_context",
  "rudi_crm_get_latest_correspondence",
];

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

describe("rudi-crm stack package", () => {
  it("packages the controlled RUDI CRM MCP contract", async () => {
    const manifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.v2.json")
    );
    const legacyManifest = await readJson<Record<string, any>>(
      path.join(stackRoot, "manifest.json")
    );
    const packageJson = await readJson<Record<string, any>>(
      path.join(stackRoot, "package.json")
    );
    const index = await readJson<Record<string, any>>(path.join(process.cwd(), "index.json"));
    const serverSource = await fs.readFile(path.join(stackRoot, "src/index.ts"), "utf8");
    const contractSource = await fs.readFile(path.join(stackRoot, "src/contract.ts"), "utf8");
    const schemaSource = await fs.readFile(path.join(stackRoot, "src/schemas.ts"), "utf8");
    const financeSql = await fs.readFile(
      path.join(stackRoot, "sql/record_finance_event.sql"),
      "utf8"
    );
    const liveFinanceTest = await fs.readFile(
      path.join(stackRoot, "tests/live-finance.test.mjs"),
      "utf8"
    );

    expect(manifest).toMatchObject({
      id: "stack:rudi-crm",
      kind: "stack",
      runtime: "node",
      install: {
        source: "catalog",
        path: "catalog/stacks/rudi-crm",
      },
      requires: {
        binaries: [],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/index.ts"],
      },
    });
    expect(manifest.provides.tools).toEqual(expectedTools);
    expect(manifest.meta.boundary).toMatch(/controlled write\/read contract/i);

    expect(legacyManifest).toMatchObject({
      id: "rudi-crm",
      runtime: "node",
      command: ["npx", "tsx", "src/index.ts"],
    });
    expect(legacyManifest.provides.tools).toEqual(expectedTools);

    expect(packageJson.dependencies).toMatchObject({
      "@modelcontextprotocol/sdk": expect.any(String),
      pg: expect.any(String),
      zod: expect.any(String),
    });
    expect(packageJson.scripts).toMatchObject({
      test: expect.stringContaining("node --test"),
      "test:live": expect.stringContaining("RUDI_CRM_LIVE_TESTS=1"),
    });
    expect(serverSource).not.toContain("pg_execute");
    expect(serverSource).not.toContain("raw_sql");
    expect(contractSource).toContain("record_discovery_observations");
    expect(contractSource).toContain("log_ingest_batch");
    expect(contractSource).toContain("upsert_interaction");
    expect(contractSource).toContain("listPeople");
    expect(contractSource).toContain("getActivityFeed");
    expect(contractSource).toContain("getAttentionBrief");
    expect(contractSource).toContain("v_validate_thread_org");
    expect(serverSource).toContain("rudi_crm_upsert_interaction");
    expect(serverSource).toContain("rudi_crm_list_people");
    expect(serverSource).toContain("rudi_crm_get_attention_brief");
    expect(schemaSource).toContain("idempotency_key");
    expect(schemaSource).toContain("UpsertInteractionInput");
    expect(schemaSource).toContain("ListPeopleInput");
    expect(schemaSource).toContain("AttentionBriefInput");
    expect(schemaSource).toContain("RudiCrmObservation");
    expect(serverSource).toContain("rudi_crm_record_finance_event");
    expect(contractSource).toContain("recordFinanceEvent");
    expect(contractSource).toContain("record_finance_event");
    expect(schemaSource).toContain("RecordFinanceEventInput");
    expect(financeSql).toContain("CREATE OR REPLACE FUNCTION public.record_finance_event");
    expect(financeSql).toContain("finance history is immutable");
    expect(liveFinanceTest).toContain("RUDI_CRM_LIVE_TESTS=1");
    expect(liveFinanceTest).toContain("rollback");

    const officialStacks = index.packages.stacks.official as Array<Record<string, any>>;
    expect(officialStacks).toContainEqual(
      expect.objectContaining({
        id: "stack:rudi-crm",
        path: "catalog/stacks/rudi-crm",
        runtime: "runtime:node",
        requires: {
          secrets: ["RUDI_CRM_DATABASE_URL"],
        },
      })
    );
  });
});
