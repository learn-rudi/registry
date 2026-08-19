import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const expectedHostedTools = [
  "lookup_location",
  "search_locations",
  "get_zoning_rules",
  "find_candidate_sites",
  "run_legal_fit",
  "run_dimensional_fit",
  "run_community_fit",
  "run_financial_fit",
  "get_site_boundary",
  "build_frontage_workspace",
  "get_site_conditions",
  "refresh_site_conditions",
  "run_site_envelope",
  "run_building_fit",
  "generate_site_plan",
  "get_site_visual_context",
  "start_feasibility_study",
  "get_feasibility_status",
  "build_feasibility_package",
];

test("pins the offline Dwellow hosted-MCP bridge contract", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  const wrapper = await fs.readFile(path.join(stackRoot, "src/index.js"), "utf8");

  assert.deepEqual(manifest.provides.tools, expectedHostedTools);
  assert.deepEqual(manifest.mcp, {
    transport: "stdio",
    command: "node",
    args: ["src/index.js"],
    cwd: ".",
  });
  assert.match(wrapper, /mcp-remote@0\.1\.38/);
  assert.match(wrapper, /mcp-production-5c11\.up\.railway\.app\/mcp/);
  assert.match(wrapper, /process\.execPath/);
});
