import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  acquireRepositoryLease,
  getRepositoryStatus,
  listRepositoryActions,
  listRepositoryCloseouts,
  recordRepositoryAction,
  recordRepositoryCloseout,
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

test("worktree closeout receipts capture repository state and immutable lineage", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const head = git(fixture.repo, "rev-parse", "HEAD");

  const receipt = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-001",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: {
      task_id: "task-001",
      source_thread_id: "thread-001",
      plan_id: "delivery-plan-001",
      node_id: "implementation",
    },
    agent_lineage: {
      agent_id: "agent-one",
      host: "codex",
      attempt_id: "attempt-001",
    },
    acceptance_reference: "acceptance:task-001",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "  Capture the completed fixture worktree for closeout review.  ",
  }, options);

  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.receipt_id, "closeout-001");
  assert.equal(receipt.state, "observed");
  assert.equal(receipt.version, 1);
  assert.deepEqual(receipt.repository, {
    repo_id: "fixture",
    path: await realpath(fixture.repo),
    source: "explicit",
    root_id: null,
    relative_path: null,
    remote: { configured: false, identity: null },
  });
  assert.equal(receipt.git.branch, "main");
  assert.equal(receipt.git.head, head);
  assert.deepEqual(receipt.git.base, {
    ref: "HEAD",
    head,
    ahead: 0,
    behind: 0,
  });
  assert.deepEqual(receipt.git.upstream, {
    ref: null,
    ahead: null,
    behind: null,
  });
  assert.deepEqual(receipt.git.dirty, {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  });
  assert.deepEqual(receipt.task_lineage, {
    task_id: "task-001",
    source_thread_id: "thread-001",
    plan_id: "delivery-plan-001",
    node_id: "implementation",
  });
  assert.deepEqual(receipt.agent_lineage, {
    agent_id: "agent-one",
    host: "codex",
    attempt_id: "attempt-001",
  });
  assert.equal(receipt.acceptance_reference, "acceptance:task-001");
  assert.equal(receipt.validation_evidence.length, 1);
  assert.deepEqual(receipt.preservation_requirements, []);
  assert.deepEqual(receipt.cleanup, {
    eligible: true,
    reasons: [],
    approval_reference: null,
  });
  assert.match(receipt.observed_at, /^\d{4}-\d{2}-\d{2}T/);

  const duplicate = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-001",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: {
      task_id: "task-001",
      source_thread_id: "thread-001",
      plan_id: "delivery-plan-001",
      node_id: "implementation",
    },
    agent_lineage: {
      agent_id: "agent-one",
      host: "codex",
      attempt_id: "attempt-001",
    },
    acceptance_reference: "acceptance:task-001",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "  Capture the completed fixture worktree for closeout review.  ",
  }, options);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.version, 1);

  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-001",
      state: "cleanup_approved",
      expected_version: 0,
      base_ref: "HEAD",
      task_lineage: {
        task_id: "task-001",
        source_thread_id: "thread-001",
        plan_id: "delivery-plan-001",
        node_id: "implementation",
      },
      agent_lineage: {
        agent_id: "agent-one",
        host: "codex",
        attempt_id: "attempt-001",
      },
      acceptance_reference: "acceptance:task-001",
      validation_evidence: [{
        command: "node --test",
        outcome: "passed",
        exit_code: 0,
        summary: "Focused behavior passed.",
        at: "2026-08-27T12:00:00.000Z",
      }],
      preservation_requirements: [],
      summary: "  Capture the completed fixture worktree for closeout review.  ",
      approval_reference: "approval:must-not-be-masked",
    }, options),
    /create replay.*observed|approval_reference is not allowed at closeout receipt creation/i
  );

  const listed = await listRepositoryCloseouts({ repo_id: "fixture" }, options);
  assert.equal(listed.receipts.length, 1);
  assert.equal(listed.receipts[0].receipt_id, "closeout-001");
});

test("worktree closeout transitions fail closed around preservation and cleanup approval", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const creation = {
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-002" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-002",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Classify the fixture worktree.",
  };

  await writeFile(join(fixture.repo, "untracked.txt"), "preserve me\n");
  const dirty = await recordRepositoryCloseout({
    ...creation,
    receipt_id: "closeout-dirty",
  }, options);
  assert.equal(dirty.cleanup.eligible, false);
  assert.ok(dirty.cleanup.reasons.includes("worktree_is_dirty"));

  const preserved = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-dirty",
    state: "preservation_required",
    expected_version: dirty.version,
    classification: "active",
    disposition_summary: "Untracked evidence must remain in place.",
    preservation_requirements: ["Retain untracked.txt until task acceptance."],
  }, options);
  assert.equal(preserved.state, "preservation_required");
  assert.equal(preserved.cleanup.eligible, false);
  assert.ok(preserved.cleanup.reasons.includes("preservation_requirements_exist"));

  await rm(join(fixture.repo, "untracked.txt"));
  const clean = await recordRepositoryCloseout({
    ...creation,
    receipt_id: "closeout-clean",
  }, options);
  const classified = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "classified",
    expected_version: clean.version,
    classification: "superseded",
    disposition_summary: "Accepted work is represented by the integration lineage.",
  }, options);
  const eligible = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "archive_eligible",
    expected_version: classified.version,
    disposition_summary: "The clean superseded worktree is archive eligible.",
  }, options);
  const pending = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "cleanup_pending_approval",
    expected_version: eligible.version,
    disposition_summary: "Await explicit destructive cleanup approval.",
  }, options);
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-clean",
      state: "cleanup_approved",
      expected_version: pending.version,
      disposition_summary: "Cleanup was approved.",
    }, options),
    /approval_reference/
  );
  const approved = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "cleanup_approved",
    expected_version: pending.version,
    disposition_summary: "Cleanup was approved, but this tool performs no cleanup.",
    approval_reference: "approval:cleanup-002",
  }, options);
  assert.equal(approved.state, "cleanup_approved");
  assert.equal(approved.cleanup.eligible, true);
  assert.equal(approved.cleanup.approval_reference, "approval:cleanup-002");

  const retainedAgain = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "retained",
    expected_version: approved.version,
    disposition_summary: "Retain the previously approved worktree.",
  }, options);
  assert.equal(retainedAgain.cleanup.approval_reference, null);
  const classifiedAgain = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "classified",
    expected_version: retainedAgain.version,
    classification: "superseded",
    disposition_summary: "Reclassify after the earlier approval lifecycle.",
  }, options);
  const eligibleAgain = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "archive_eligible",
    expected_version: classifiedAgain.version,
    disposition_summary: "Begin a new cleanup approval lifecycle.",
  }, options);
  const pendingAgain = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-clean",
    state: "cleanup_pending_approval",
    expected_version: eligibleAgain.version,
    disposition_summary: "Await a fresh approval for the new lifecycle.",
  }, options);
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-clean",
      state: "cleanup_approved",
      expected_version: pendingAgain.version,
      disposition_summary: "The prior approval must not be reused.",
    }, options),
    /approval_reference/
  );
  assert.equal(git(fixture.repo, "status", "--porcelain"), "");
});

test("worktree closeout rejects conflicting immutable versions", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-conflict",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-conflict" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-conflict",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Capture conflict protection evidence.",
  }, options);
  const versionOnePath = join(
    fixture.stateRoot,
    "closeouts",
    "fixture",
    "versions",
    "closeout-conflict",
    "v1.json"
  );
  const forged = JSON.parse(await readFile(versionOnePath, "utf8"));
  forged.version = 2;
  forged.state = "classified";
  forged.classification = "superseded";
  forged.disposition = { state: "classified", summary: "Forged competing version." };
  await writeFile(versionOnePath.replace("v1.json", "v2.json"), JSON.stringify(forged));

  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-conflict",
      state: "classified",
      expected_version: observed.version,
      classification: "superseded",
      disposition_summary: "Accepted work is represented elsewhere.",
    }, options),
    /immutable closeout version conflict/i
  );
});

test("worktree closeout rejects corrupted persisted receipt state", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-corrupt",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-corrupt" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-corrupt",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Capture persisted-state validation evidence.",
  }, options);
  const activePath = join(
    fixture.stateRoot,
    "closeouts",
    "fixture",
    "closeout-corrupt.json"
  );
  const versionOnePath = join(
    fixture.stateRoot,
    "closeouts",
    "fixture",
    "versions",
    "closeout-corrupt",
    "v1.json"
  );
  const corrupted = `${JSON.stringify({ ...observed, repository: null }, null, 2)}\n`;
  await writeFile(activePath, corrupted);
  await writeFile(versionOnePath, corrupted);

  await assert.rejects(
    () => listRepositoryCloseouts({ repo_id: "fixture" }, options),
    /worktree closeout receipt repository must be an object/i
  );
});

test("worktree closeout binds the active projection to its immutable version", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-projection-binding",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-projection-binding" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-projection-binding",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Bind the active projection to immutable evidence.",
  }, options);
  const closeoutRoot = join(fixture.stateRoot, "closeouts", "fixture");
  const activePath = join(closeoutRoot, "closeout-projection-binding.json");
  const tampered = JSON.parse(await readFile(activePath, "utf8"));
  tampered.task_lineage.task_id = "task-valid-looking-tamper";
  await writeFile(activePath, `${JSON.stringify(tampered, null, 2)}\n`);

  await assert.rejects(
    () => listRepositoryCloseouts({ repo_id: "fixture" }, options),
    /active closeout projection does not match immutable version/i
  );
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-projection-binding",
      state: "classified",
      expected_version: observed.version,
      classification: "superseded",
      disposition_summary: "Tampered active evidence must not advance.",
    }, options),
    /active closeout projection does not match immutable version/i
  );
  await assert.rejects(
    () => readFile(join(
      closeoutRoot,
      "versions",
      "closeout-projection-binding",
      "v2.json"
    ), "utf8"),
    (error) => error?.code === "ENOENT"
  );
});

test("worktree closeout recovers an immutable transition after projection interruption", async (t) => {
  const fixture = await createFixture(t);
  let now = Date.parse("2026-08-27T12:00:00.000Z");
  const options = {
    configPath: fixture.configPath,
    stateRoot: fixture.stateRoot,
    now: () => now,
  };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-interrupted-projection",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-interrupted-projection" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-interrupted-projection",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Recover a fully persisted immutable transition.",
  }, options);
  now += 1_000;
  const transition = {
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-interrupted-projection",
    state: "classified",
    expected_version: observed.version,
    classification: "superseded",
    disposition_summary: "The worktree is superseded.",
  };
  const classified = await recordRepositoryCloseout(transition, options);
  const closeoutRoot = join(fixture.stateRoot, "closeouts", "fixture");
  const activePath = join(closeoutRoot, "closeout-interrupted-projection.json");
  const versionRoot = join(closeoutRoot, "versions", "closeout-interrupted-projection");
  const versionOne = await readFile(join(versionRoot, "v1.json"), "utf8");
  const versionTwo = await readFile(join(versionRoot, "v2.json"), "utf8");
  await writeFile(activePath, versionOne);
  now += 1_000;

  const recovered = await recordRepositoryCloseout(transition, options);
  assert.deepEqual(recovered, classified);
  assert.equal(await readFile(join(versionRoot, "v2.json"), "utf8"), versionTwo);
  assert.equal(await readFile(activePath, "utf8"), versionTwo);
});

test("worktree closeout preserves missing acceptance and can add it once", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-awaiting-acceptance",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-awaiting-acceptance" },
    agent_lineage: { agent_id: "agent-one" },
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Capture work before acceptance is available.",
  }, options);
  assert.equal(observed.acceptance_reference, null);
  assert.ok(observed.cleanup.reasons.includes("acceptance_reference_is_missing"));

  const accepted = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-awaiting-acceptance",
    state: "classified",
    expected_version: observed.version,
    classification: "superseded",
    disposition_summary: "Acceptance now identifies the integrated result.",
    acceptance_reference: "acceptance:task-awaiting-acceptance",
  }, options);
  assert.equal(accepted.acceptance_reference, "acceptance:task-awaiting-acceptance");
  assert.equal(accepted.cleanup.eligible, true);

  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-awaiting-acceptance",
      state: "retained",
      expected_version: accepted.version,
      disposition_summary: "Retain the accepted worktree.",
      acceptance_reference: "acceptance:different-result",
    }, options),
    /acceptance_reference is immutable once recorded/i
  );
});

test("worktree closeout restricts archive classification and approval timing", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const creation = {
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-archive-guard" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-archive-guard",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Guard archive classification and approval timing.",
  };
  const observed = await recordRepositoryCloseout({
    ...creation,
    receipt_id: "closeout-archive-guard",
  }, options);
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-archive-guard",
      state: "classified",
      expected_version: observed.version,
      classification: "active",
      disposition_summary: "The worktree is still active.",
      approval_reference: "approval:premature",
    }, options),
    /approval_reference is allowed only for cleanup_approved/i
  );
  const active = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-archive-guard",
    state: "classified",
    expected_version: observed.version,
    classification: "active",
    disposition_summary: "The worktree is still active.",
  }, options);
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-archive-guard",
      state: "archive_eligible",
      expected_version: active.version,
      disposition_summary: "An active worktree cannot be archive eligible.",
    }, options),
    /archive_eligible requires a superseded or archive_candidate classification/i
  );
});

test("worktree closeout blocks commits ahead of the declared base without upstream", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const base = git(fixture.repo, "rev-parse", "HEAD");
  await writeFile(join(fixture.repo, "accepted-later.txt"), "local-only commit\n");
  git(fixture.repo, "add", "accepted-later.txt");
  git(fixture.repo, "commit", "-m", "test: local-only work");
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const receipt = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-ahead-of-base",
    state: "observed",
    expected_version: 0,
    base_ref: base,
    task_lineage: { task_id: "task-ahead-of-base" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-ahead-of-base",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Capture a clean worktree with a local-only commit.",
  }, options);
  assert.equal(receipt.git.upstream.ref, null);
  assert.equal(receipt.git.base.ahead, 1);
  assert.equal(receipt.cleanup.eligible, false);
  assert.ok(receipt.cleanup.reasons.includes("local_commits_are_ahead_of_base"));
});

test("worktree closeout pins a symbolic base to its creation commit", async (t) => {
  const fixture = await createFixture(t);
  const options = { configPath: fixture.configPath, stateRoot: fixture.stateRoot };
  const lease = await acquireRepositoryLease({
    repo_id: "fixture",
    owner: "agent-one",
    ttl_seconds: 60,
  }, options);
  const originalBase = git(fixture.repo, "rev-parse", "HEAD");
  const observed = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-pinned-symbolic-base",
    state: "observed",
    expected_version: 0,
    base_ref: "HEAD",
    task_lineage: { task_id: "task-pinned-symbolic-base" },
    agent_lineage: { agent_id: "agent-one" },
    acceptance_reference: "acceptance:task-pinned-symbolic-base",
    validation_evidence: [{
      command: "node --test",
      outcome: "passed",
      exit_code: 0,
      summary: "Focused behavior passed.",
      at: "2026-08-27T12:00:00.000Z",
    }],
    preservation_requirements: [],
    summary: "Pin HEAD at receipt creation.",
  }, options);
  await writeFile(join(fixture.repo, "later-commit.txt"), "later local commit\n");
  git(fixture.repo, "add", "later-commit.txt");
  git(fixture.repo, "commit", "-m", "test: advance symbolic head");

  const classified = await recordRepositoryCloseout({
    repo_id: "fixture",
    owner: "agent-one",
    lease_id: lease.lease_id,
    receipt_id: "closeout-pinned-symbolic-base",
    state: "classified",
    expected_version: observed.version,
    classification: "superseded",
    disposition_summary: "A later local commit must remain visible against the pinned base.",
  }, options);
  assert.equal(classified.git.base.ref, "HEAD");
  assert.equal(classified.git.base.head, originalBase);
  assert.equal(classified.git.base.ahead, 1);
  assert.ok(classified.cleanup.reasons.includes("local_commits_are_ahead_of_base"));
  await assert.rejects(
    () => recordRepositoryCloseout({
      repo_id: "fixture",
      owner: "agent-one",
      lease_id: lease.lease_id,
      receipt_id: "closeout-pinned-symbolic-base",
      state: "archive_eligible",
      expected_version: classified.version,
      disposition_summary: "A worktree ahead of its pinned base is not archive eligible.",
    }, options),
    /local_commits_are_ahead_of_base/i
  );
});
