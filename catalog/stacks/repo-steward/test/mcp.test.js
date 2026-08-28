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
    "repo_steward_enroll_root",
    "repo_steward_discover_repositories",
    "repo_steward_scan_fleet",
    "repo_steward_get_status",
    "repo_steward_acquire_lease",
    "repo_steward_release_lease",
    "repo_steward_list_actions",
    "repo_steward_list_closeouts",
    "repo_steward_record_action",
    "repo_steward_record_closeout",
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

  const enrollmentResult = await client.callTool({
    name: "repo_steward_enroll_root",
    arguments: {
      root_id: "fixture-root",
      root_path: repo,
      owner: "mcp-test",
      fetch_allowed: false,
      max_depth: 4,
    },
  });
  assert.equal(enrollmentResult.isError, undefined);
  const enrollment = JSON.parse(enrollmentResult.content[0].text);
  assert.equal(enrollment.root.root_id, "fixture-root");
  assert.equal(enrollment.discovery.summary.repositories, 1);

  const discoveryResult = await client.callTool({
    name: "repo_steward_discover_repositories",
    arguments: { root_ids: ["fixture-root"] },
  });
  assert.equal(discoveryResult.isError, undefined);
  const discovery = JSON.parse(discoveryResult.content[0].text);
  assert.equal(discovery.summary.repositories, 1);

  const leaseResult = await client.callTool({
    name: "repo_steward_acquire_lease",
    arguments: {
      repo_id: "fixture",
      owner: "mcp-test",
      ttl_seconds: 60,
    },
  });
  assert.equal(leaseResult.isError, undefined);
  const lease = JSON.parse(leaseResult.content[0].text);

  const closeoutResult = await client.callTool({
    name: "repo_steward_record_closeout",
    arguments: {
      repo_id: "fixture",
      owner: "mcp-test",
      lease_id: lease.lease_id,
      receipt_id: "mcp-closeout-001",
      state: "observed",
      expected_version: 0,
      base_ref: "HEAD",
      task_lineage: { task_id: "mcp-task-001" },
      agent_lineage: { agent_id: "mcp-test", host: "test-client" },
      validation_evidence: [{
        command: "npm test",
        outcome: "passed",
        exit_code: 0,
        summary: "MCP fixture passed.",
        at: "2026-08-27T12:00:00.000Z",
      }],
      preservation_requirements: ["Retain until acceptance is recorded."],
      summary: "Record the MCP worktree closeout boundary.",
    },
  });
  assert.equal(closeoutResult.isError, undefined);
  const closeout = JSON.parse(closeoutResult.content[0].text);
  assert.equal(closeout.state, "observed");
  assert.equal(closeout.acceptance_reference, null);
  assert.equal(closeout.cleanup.eligible, false);
  assert.ok(closeout.cleanup.reasons.includes("acceptance_reference_is_missing"));
  assert.ok(closeout.cleanup.reasons.includes("preservation_requirements_exist"));

  const closeoutListResult = await client.callTool({
    name: "repo_steward_list_closeouts",
    arguments: { repo_id: "fixture" },
  });
  assert.equal(closeoutListResult.isError, undefined);
  const closeoutList = JSON.parse(closeoutListResult.content[0].text);
  assert.equal(closeoutList.receipts.length, 1);
  assert.equal(closeoutList.receipts[0].receipt_id, "mcp-closeout-001");
});
