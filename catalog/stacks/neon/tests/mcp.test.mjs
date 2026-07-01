import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes Neon platform operation tools", async () => {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEON_API_KEY: "",
    },
  });
  const client = new Client(
    { name: "neon-stack-test", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();

    assert.deepEqual(toolNames, [
      "neon_config_status",
      "neon_create_branch",
      "neon_create_project",
      "neon_generate_cli_workflow",
      "neon_generate_mcp_config",
      "neon_get_connection_string",
      "neon_list_branches",
      "neon_list_orgs",
      "neon_list_projects",
    ]);

    const status = await client.callTool({
      name: "neon_config_status",
      arguments: {},
    });
    const data = JSON.parse(status.content[0].text);
    assert.equal(data.api_key_configured, false);
    assert.match(data.production_guardrail, /production databases/i);
  } finally {
    await client.close();
  }
});
