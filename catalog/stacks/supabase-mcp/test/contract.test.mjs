import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedTools = [
  "list_tables",
  "list_extensions",
  "list_migrations",
  "apply_migration",
  "execute_sql",
  "get_logs",
  "get_advisors",
  "get_project_url",
  "get_publishable_keys",
  "generate_typescript_types",
  "list_edge_functions",
  "get_edge_function",
  "deploy_edge_function",
  "list_projects",
  "get_project",
  "create_project",
  "pause_project",
  "restore_project",
  "list_organizations",
  "get_organization",
  "get_cost",
  "confirm_cost",
  "search_docs",
  "create_branch",
  "list_branches",
  "delete_branch",
  "merge_branch",
  "reset_branch",
  "rebase_branch",
  "list_storage_buckets",
  "get_storage_config",
  "update_storage_config",
];

test("pins the offline Supabase hosted-MCP bridge contract", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  const wrapper = await fs.readFile(path.join(stackRoot, "src/index.js"), "utf8");

  assert.deepEqual(manifest.provides.tools, expectedTools);
  assert.deepEqual(manifest.meta.remoteMcp, {
    url: "https://mcp.supabase.com/mcp",
    auth: "oauth",
    bridgePackage: "mcp-remote@0.1.38",
    queryEnv: [
      "SUPABASE_MCP_PROJECT_REF",
      "SUPABASE_MCP_READ_ONLY",
      "SUPABASE_MCP_FEATURES",
    ],
  });
  assert.deepEqual(manifest.mcp, {
    transport: "stdio",
    command: "node",
    args: ["src/index.js"],
    cwd: ".",
  });
  assert.match(wrapper, /mcp-remote@0\.1\.38/);
  assert.match(wrapper, /https:\/\/mcp\.supabase\.com\/mcp/);
  assert.match(wrapper, /SUPABASE_MCP_PROJECT_REF/);
  assert.match(wrapper, /SUPABASE_MCP_READ_ONLY/);
  assert.match(wrapper, /SUPABASE_MCP_FEATURES/);
  assert.match(wrapper, /process\.execPath/);
});
