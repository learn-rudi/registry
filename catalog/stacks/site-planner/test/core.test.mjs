import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertRuntimeReady,
  createWriteAuthorization,
  executeSitePlannerOperation,
  loadConfiguration,
} from "../src/core.js";

const temporaryDirectories = [];

test.afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("configuration is fixed-root and rejects unknown or relative paths", () => {
  const fixture = createFixture();
  const configPath = join(fixture.root, "config.json");
  writePrivateJson(configPath, {
    schemaVersion: 1,
    artifactRoot: fixture.artifactRoot,
    expectedCommit: fixture.commit,
    nodePath: process.execPath,
    sitePlannerRoot: fixture.sitePlannerRoot,
    workspaceRoot: fixture.workspaceRoot,
    unexpected: true,
  });

  assert.throws(
    () => loadConfiguration({ configPath, homeDirectory: fixture.root }),
    /unsupported fields/,
  );

  writePrivateJson(configPath, {
    schemaVersion: 1,
    artifactRoot: fixture.artifactRoot,
    expectedCommit: fixture.commit,
    nodePath: process.execPath,
    sitePlannerRoot: "relative/site-planner",
    workspaceRoot: fixture.workspaceRoot,
  });

  assert.throws(
    () => loadConfiguration({ configPath, homeDirectory: fixture.root }),
    /sitePlannerRoot must be an absolute path/,
  );
});

test("runtime readiness requires the configured clean Site Planner commit", async () => {
  const fixture = createFixture();
  const config = loadFixtureConfiguration(fixture);
  const ready = await assertRuntimeReady(config);

  assert.equal(ready.ready, true);
  assert.equal(ready.commit, fixture.commit);

  writeFileSync(join(fixture.sitePlannerRoot, "dirty.txt"), "dirty\n");

  await assert.rejects(
    () => assertRuntimeReady(config),
    /checkout must be clean/,
  );
});

test("read operations use the fixed workspace and persist bounded provenance", async () => {
  const fixture = createFixture();
  const config = loadFixtureConfiguration(fixture);
  const request = {
    contractVersion: 1,
    messageType: "request",
    operation: "inspectConcept",
    concept: {
      workspaceId: "workspace-1",
      siteId: "site-1",
      conceptId: "concept-1",
    },
  };

  const execution = await executeSitePlannerOperation({
    configuration: config,
    request,
  });

  assert.equal(execution.result.messageType, "result");
  assert.equal(execution.result.operation, "inspectConcept");
  assert.equal(execution.runtime.commit, fixture.commit);
  assert.equal(execution.artifact.requestDigest.length, 64);
  assert.equal(execution.artifact.resultDigest.length, 64);
  assert.equal(existsSync(execution.artifact.resultPath), true);
  assert.equal(existsSync(execution.artifact.manifestPath), true);

  const persisted = JSON.parse(readFileSync(execution.artifact.resultPath, "utf8"));
  assert.equal(persisted.workspaceRoot, fixture.workspaceRoot);
  assert.equal(persisted.operation, "inspectConcept");
});

test("bounded Site Planner results may be larger than the request limit", async () => {
  const fixture = createFixture();
  const config = loadFixtureConfiguration(fixture);
  const request = {
    contractVersion: 1,
    messageType: "request",
    operation: "inspectConcept",
    concept: {
      workspaceId: "workspace-1",
      siteId: "site-1",
      conceptId: "concept-1",
    },
    fixtureResultBytes: 2 * 1024 * 1024,
  };

  const execution = await executeSitePlannerOperation({
    configuration: config,
    request,
  });

  assert.equal(execution.result.padding.length, 2 * 1024 * 1024);
  assert.equal(existsSync(execution.artifact.resultPath), true);
});

test("write operations require a valid request-bound Service Desk authorization", async () => {
  const fixture = createFixture();
  const config = loadFixtureConfiguration(fixture);
  const request = {
    contractVersion: 1,
    messageType: "request",
    operation: "forkConcept",
    source: {
      workspaceId: "workspace-1",
      siteId: "site-1",
      conceptId: "concept-1",
    },
    expectedRevision: 1,
    targetConceptId: "approved-option",
    clientRequestId: "request-1",
    commands: [],
  };
  const key = Buffer.alloc(32, 7);
  const now = new Date("2026-07-30T18:00:00.000Z");

  await assert.rejects(
    () => executeSitePlannerOperation({
      configuration: config,
      now: () => now,
      request,
      writeKey: key,
    }),
    /write authorization is required/,
  );

  const authorization = createWriteAuthorization({
    approvalDecisionId: "approval-decision-1",
    approvedOperationId: "service-operation-1",
    expiresAt: "2026-07-30T18:05:00.000Z",
    key,
    keyVersion: 1,
    request,
  });
  const execution = await executeSitePlannerOperation({
    configuration: config,
    now: () => now,
    request,
    writeAuthorization: authorization,
    writeKey: key,
  });

  assert.equal(execution.result.operation, "forkConcept");
  assert.deepEqual(execution.artifact.approval, {
    approvalDecisionId: "approval-decision-1",
    approvedOperationId: "service-operation-1",
    keyVersion: 1,
  });

  await assert.rejects(
    () => executeSitePlannerOperation({
      configuration: config,
      now: () => new Date("2026-07-30T18:06:00.000Z"),
      request,
      writeAuthorization: authorization,
      writeKey: key,
    }),
    /write authorization has expired/,
  );
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "site-planner-stack-"));
  temporaryDirectories.push(root);
  const sitePlannerRoot = join(root, "site-planner");
  const workspaceRoot = join(root, "workspace");
  const artifactRoot = join(root, "artifacts");
  const nodePath = join(root, "node-22-test-shim");
  const cliDirectory = join(sitePlannerRoot, "apps", "site-planner", "src");
  mkdirSync(cliDirectory, { recursive: true });
  mkdirSync(workspaceRoot, { mode: 0o700, recursive: true });
  mkdirSync(artifactRoot, { mode: 0o700, recursive: true });
  writeFileSync(
    nodePath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      "  echo v22.23.0",
      "  exit 0",
      "fi",
      'script="$1"',
      "shift",
      `exec "${process.execPath}" --input-type=module - "$@" < "$script"`,
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  chmodSync(nodePath, 0o700);
  writeFileSync(
    join(cliDirectory, "agent-operation-cli.ts"),
    [
      'import { readFileSync } from "node:fs";',
      'const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {',
      '  if (index % 2 === 0) pairs.push([value, all[index + 1]]);',
      '  return pairs;',
      '}, []));',
      'const request = JSON.parse(readFileSync(args["--request"], "utf8"));',
      'process.stdout.write(JSON.stringify({',
      '  contractVersion: request.contractVersion,',
      '  messageType: "result",',
      '  operation: request.operation,',
      '  padding: "x".repeat(request.fixtureResultBytes ?? 0),',
      '  workspaceRoot: args["--workspace-root"]',
      '}));',
      "",
    ].join("\n"),
  );
  writeFileSync(join(sitePlannerRoot, "package.json"), '{"type":"module"}\n');
  execFileSync("/usr/bin/git", ["init", "-q"], { cwd: sitePlannerRoot });
  execFileSync("/usr/bin/git", ["add", "."], { cwd: sitePlannerRoot });
  execFileSync(
    "/usr/bin/git",
    [
      "-c",
      "user.name=Site Planner Stack Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    ],
    { cwd: sitePlannerRoot },
  );
  const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: sitePlannerRoot,
    encoding: "utf8",
  }).trim();
  return {
    artifactRoot,
    commit,
    nodePath,
    root,
    sitePlannerRoot,
    workspaceRoot,
  };
}

function loadFixtureConfiguration(fixture) {
  const configPath = join(fixture.root, "config.json");
  writePrivateJson(configPath, {
    schemaVersion: 1,
    artifactRoot: fixture.artifactRoot,
    expectedCommit: fixture.commit,
    nodePath: fixture.nodePath,
    sitePlannerRoot: fixture.sitePlannerRoot,
    workspaceRoot: fixture.workspaceRoot,
  });
  return loadConfiguration({ configPath, homeDirectory: fixture.root });
}

function writePrivateJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
