import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOLS = [
  "rudi_crm_config_status",
  "rudi_crm_get_activity_feed",
  "rudi_crm_get_attention_brief",
  "rudi_crm_get_engagement_context",
  "rudi_crm_get_latest_correspondence",
  "rudi_crm_get_unknown_discovery_domains",
  "rudi_crm_list_engagements",
  "rudi_crm_list_organizations",
  "rudi_crm_list_people",
  "rudi_crm_list_triage_queue",
  "rudi_crm_log_ingest_batch",
  "rudi_crm_record_discovery_observations",
  "rudi_crm_record_finance_event",
  "rudi_crm_run_validators",
  "rudi_crm_setup_status",
  "rudi_crm_upsert_interaction",
];

test("MCP server exposes the controlled RUDI CRM contract", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      RUDI_CRM_DATABASE_URL: "",
    },
  });
  const client = new Client(
    { name: "rudi-crm-stack-test", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, EXPECTED_TOOLS);

    const upsertInteraction = tools.tools.find(
      (tool) => tool.name === "rudi_crm_upsert_interaction"
    );
    assert.deepEqual(upsertInteraction.inputSchema.required, [
      "source",
      "source_id",
      "channel",
      "direction",
      "occurred_at",
      "subject",
      "summary",
    ]);
    assert.equal(upsertInteraction.inputSchema.properties.occurred_at.format, "date-time");
    assert.equal(upsertInteraction.inputSchema.properties.engagement_id.format, "uuid");

    const listPeople = tools.tools.find((tool) => tool.name === "rudi_crm_list_people");
    assert.equal(listPeople.inputSchema.properties.limit.maximum, 100);
    assert.equal(listPeople.inputSchema.properties.offset.minimum, 0);
    assert.equal(listPeople.inputSchema.properties.has_email.type, "boolean");

    const activityFeed = tools.tools.find(
      (tool) => tool.name === "rudi_crm_get_activity_feed"
    );
    assert.deepEqual(activityFeed.inputSchema.properties.direction.enum, [
      "inbound",
      "outbound",
    ]);

    const attentionBrief = tools.tools.find(
      (tool) => tool.name === "rudi_crm_get_attention_brief"
    );
    assert.equal(attentionBrief.inputSchema.properties.as_of.description, "YYYY-MM-DD");

    const financeEvent = tools.tools.find(
      (tool) => tool.name === "rudi_crm_record_finance_event"
    );
    assert.deepEqual(financeEvent.inputSchema.required, [
      "engagement_id",
      "event_type",
      "amount",
      "occurred_at",
      "source",
    ]);
    assert.deepEqual(financeEvent.inputSchema.properties.event_type.enum, [
      "budget",
      "estimate",
      "proposal",
      "contract",
      "invoice",
      "payment",
      "refund",
      "expense",
      "adjustment",
    ]);
    assert.equal(financeEvent.inputSchema.properties.engagement_id.format, "uuid");

    const status = await client.callTool({
      name: "rudi_crm_config_status",
      arguments: {},
    });
    const data = JSON.parse(status.content[0].text);
    assert.equal(data.database_url_configured, false);
    assert.equal(data.raw_sql_enabled, false);
    assert.match(data.boundary, /controlled CRM/i);

    const setupStatus = await client.callTool({
      name: "rudi_crm_setup_status",
      arguments: {},
    });
    const setupData = JSON.parse(setupStatus.content[0].text);
    assert.equal(setupData.ok, false);
    assert.equal(setupData.database_url_configured, false);
    assert.equal(setupData.raw_sql_enabled, false);
    assert.deepEqual(setupData.missing, ["RUDI_CRM_DATABASE_URL"]);
  } finally {
    await client.close();
  }
});
