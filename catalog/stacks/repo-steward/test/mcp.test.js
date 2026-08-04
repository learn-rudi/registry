import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "../src/index.js";

test("MCP exposes the complete Repo Steward surface and executes preflight", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "repo-steward-mcp-"));
  const repo = join(root, "repo");
  const configPath = join(root, "config.json");
  const stateRoot = join(root, "state");
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "config", "user.name", "Repo Steward Test"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "repo-steward@example.invalid"]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  execFileSync("git", ["-C", repo, "add", "README.md"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "test: initialize fixture"], {
    stdio: "ignore",
  });
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    repositories: [{ id: "fixture", path: repo, fetchAllowed: false }],
  }));

  const server = createServer({ configPath, stateRoot });
  const client = new Client({ name: "repo-steward-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), [
    "repo_steward_preflight",
    "repo_steward_scan_fleet",
    "repo_steward_get_status",
    "repo_steward_acquire_lease",
    "repo_steward_release_lease",
    "repo_steward_list_actions",
    "repo_steward_record_action",
    "repo_steward_record_verification",
  ]);

  const result = await client.callTool({
    name: "repo_steward_preflight",
    arguments: {},
  });
  assert.equal(result.isError, undefined);
  const content = result.content[0];
  assert.ok(content && content.type === "text");
  const body = JSON.parse(content.text);
  assert.equal(body.configuration_valid, true);
  assert.equal(body.repository_count, 1);
  assert.equal(body.fetch_enabled_count, 0);
  assert.equal(body.repository_mutation_tools_exposed, false);
  assert.equal(body.local_state_tools_exposed, true);
});
