import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireRepositoryLease,
  getRepositoryStatus,
  listRepositoryActions,
  recordRepositoryAction,
  recordRepositoryVerification,
  releaseRepositoryLease,
  scanFleet,
} from "../src/core.js";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "repo-steward-core-"));
  const repo = join(root, "repo");
  const configPath = join(root, "config.json");
  const stateRoot = join(root, "state");
  t.after(() => rm(root, { recursive: true, force: true }));

  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  git(repo, "config", "user.name", "Repo Steward Test");
  git(repo, "config", "user.email", "repo-steward@example.invalid");
  await writeFile(join(repo, "tracked.txt"), "committed\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "test: initialize fixture");

  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    repositories: [
      {
        id: "fixture",
        path: repo,
        fetchAllowed: false,
      },
    ],
  }));

  return { root, repo, configPath, stateRoot };
}

test("configured repository status classifies local Git state", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.repo, "tracked.txt"), "modified\n");
  await writeFile(join(fixture.repo, "untracked.txt"), "new\n");

  const result = await getRepositoryStatus(
    { repo_id: "fixture" },
    { configPath: fixture.configPath, stateRoot: fixture.stateRoot }
  );

  assert.equal(result.repo_id, "fixture");
  assert.equal(result.path, await realpath(fixture.repo));
  assert.equal(result.branch, "main");
  assert.match(result.head, /^[0-9a-f]{40}$/);
  assert.equal(result.upstream, null);
  assert.equal(result.ahead, null);
  assert.equal(result.behind, null);
  assert.deepEqual(result.dirty, {
    total: 2,
    staged: 0,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
  });
  assert.deepEqual(result.remote, {
    configured: false,
    identity: null,
  });
  assert.deepEqual(result.fetch, {
    requested: false,
    performed: false,
  });
});

test("repository allowlist and fetch policy fail closed while remotes are redacted", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  git(
    fixture.repo,
    "remote",
    "add",
    "origin",
    "https://credential-user:credential-secret@github.com/example/private.git"
  );

  const status = await getRepositoryStatus({ repo_id: "fixture" }, options);
  assert.deepEqual(status.remote, {
    configured: true,
    identity: "https://github.com/example/private.git",
  });
  assert.equal(JSON.stringify(status).includes("credential-secret"), false);
  assert.equal(JSON.stringify(status).includes("credential-user"), false);

  await assert.rejects(
    () => getRepositoryStatus({ repo_id: "missing" }, options),
    /not configured/
  );
  await assert.rejects(
    () => getRepositoryStatus({ repo_id: "fixture", fetch: true }, options),
    /Fetch is not allowed/
  );
});

test("configuration and direct tool arguments reject unknown or ambiguous input", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };

  await assert.rejects(
    () => getRepositoryStatus({ repo_id: "fixture", unexpected: true }, options),
    /unsupported field: unexpected/
  );

  await writeFile(fixture.configPath, JSON.stringify({
    schemaVersion: 1,
    repositories: [{
      id: "fixture",
      path: fixture.repo,
      fetchAllowed: false,
      unexpected: true,
    }],
  }));
  await assert.rejects(
    () => getRepositoryStatus({ repo_id: "fixture" }, options),
    /unsupported field: unexpected/
  );

  await writeFile(fixture.configPath, JSON.stringify({
    schemaVersion: 1,
    repositories: [
      { id: "fixture", path: fixture.repo, fetchAllowed: false },
      { id: "duplicate-path", path: fixture.repo, fetchAllowed: false },
    ],
  }));
  await assert.rejects(
    () => getRepositoryStatus({ repo_id: "fixture" }, options),
    /Duplicate repository path/
  );
});

test("fleet scan summarizes configured repositories without changing them", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(join(fixture.repo, "untracked.txt"), "new\n");

  const before = git(fixture.repo, "rev-parse", "HEAD");
  const result = await scanFleet(
    {},
    { configPath: fixture.configPath, stateRoot: fixture.stateRoot }
  );

  assert.deepEqual(result.summary, {
    total: 1,
    scanned: 1,
    failed: 0,
    dirty: 1,
    needs_push: 0,
    needs_pull: 0,
    diverged: 0,
  });
  assert.equal(result.repositories[0].repo_id, "fixture");
  assert.equal(result.repositories[0].dirty.total, 1);
  assert.equal(git(fixture.repo, "rev-parse", "HEAD"), before);
});

test("repository lease admits only one bounded owner", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };

  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);

  assert.equal(lease.repo_id, "fixture");
  assert.equal(lease.owner, "agent-one");
  assert.match(lease.lease_id, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    () => acquireRepositoryLease({
      repo_id: "fixture",
      owner: "agent-two",
      ttl_seconds: 60,
    }, options),
    /already leased/
  );
  await assert.rejects(
    () => releaseRepositoryLease({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: "00000000-0000-4000-8000-000000000000",
    }, options),
    /does not match/
  );

  const released = await releaseRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
  }, options);
  assert.deepEqual(released, {
    repo_id: "fixture",
    lease_id: lease.lease_id,
    released: true,
  });

  const next = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-two",
    ttl_seconds: 60,
  }, options);
  assert.equal(next.owner, "agent-two");
});

test("repository actions enforce lease, version, transition, and verification evidence", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const head = git(fixture.repo, "rev-parse", "HEAD");

  const proposed = await recordRepositoryAction({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    kind: "checkpoint",
    status: "proposed",
    summary: "Review and checkpoint the completed fixture change.",
    source_head: head,
    expected_version: 0,
  }, options);
  assert.equal(proposed.version, 1);
  assert.equal(proposed.status, "proposed");
  const duplicate = await recordRepositoryAction({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    kind: "checkpoint",
    status: "proposed",
    summary: "Review and checkpoint the completed fixture change.",
    source_head: head,
    expected_version: 0,
  }, options);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.version, 1);
  await assert.rejects(
    () => recordRepositoryAction({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      action_id: "checkpoint-001",
      status: "running",
      expected_version: 1,
    }, options),
    /Illegal action transition/
  );

  await writeFile(
    join(fixture.stateRoot, "actions", "fixture", ".checkpoint-001.lock"),
    JSON.stringify({
      lease_id: "00000000-0000-4000-8000-000000000000",
      owner: "expired-agent",
      expires_at: "2000-01-01T00:00:00.000Z",
    })
  );

  const approved = await recordRepositoryAction({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    status: "approved",
    expected_version: 1,
  }, options);
  const running = await recordRepositoryAction({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    status: "running",
    expected_version: approved.version,
  }, options);
  await assert.rejects(
    () => recordRepositoryAction({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      action_id: "checkpoint-001",
      status: "completed",
      expected_version: running.version,
    }, options),
    /passing verification/
  );

  const verified = await recordRepositoryVerification({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    expected_version: running.version,
    command: "node --test",
    outcome: "passed",
    exit_code: 0,
    summary: "Fixture behavior passed.",
  }, options);
  assert.equal(verified.version, 4);
  assert.equal(verified.verifications.length, 1);

  const completed = await recordRepositoryAction({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    action_id: "checkpoint-001",
    status: "completed",
    expected_version: verified.version,
  }, options);
  assert.equal(completed.status, "completed");
  assert.equal(completed.version, 5);
  await assert.rejects(
    () => recordRepositoryAction({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      action_id: "checkpoint-001",
      status: "running",
      expected_version: completed.version,
    }, options),
    /terminal/
  );

  const listed = await listRepositoryActions({ repo_id: "fixture" }, options);
  assert.equal(listed.actions.length, 1);
  assert.equal(listed.actions[0].action_id, "checkpoint-001");
  assert.equal(listed.actions[0].status, "completed");
});
