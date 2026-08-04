import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  discoverRepositories,
  enrollRepositoryRoot,
  scanFleet,
} from "../src/core.js";

function git(repo, ...args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function createRepo(repo) {
  await mkdir(repo, { recursive: true });
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  git(repo, "config", "user.name", "Repo Steward Discovery Test");
  git(repo, "config", "user.email", "repo-steward@example.invalid");
  await writeFile(join(repo, "tracked.txt"), "fixture\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "test: initialize discovery fixture");
}

async function createDiscoveryFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "repo-steward-discovery-"));
  const workspace = join(root, "RUDI");
  const stateRoot = join(root, "state");
  const outside = join(root, "outside-repo");
  t.after(() => rm(root, { recursive: true, force: true }));

  await createRepo(workspace);
  await createRepo(join(workspace, "apps", "registry"));
  await createRepo(join(workspace, "business", "engagements", "client-one"));
  await createRepo(join(workspace, "node_modules", "ignored-repository"));
  await createRepo(join(workspace, ".venv", "ignored-repository"));
  await createRepo(outside);
  await symlink(outside, join(workspace, "linked-repository"), "dir");

  return { root, workspace, stateRoot };
}

test("one enrolled path persistently discovers the bounded nested Git fleet", async (t) => {
  const fixture = await createDiscoveryFixture(t);
  const options = { stateRoot: fixture.stateRoot };

  const enrolled = await enrollRepositoryRoot({
    root_path: fixture.workspace,
    owner: "agent-one",
  }, options);

  assert.equal(enrolled.enrollment_version, 1);
  assert.equal(enrolled.idempotent, false);
  assert.deepEqual(enrolled.root, {
    root_id: "rudi",
    path: await realpath(fixture.workspace),
    fetch_allowed: false,
    max_depth: 12,
  });
  assert.deepEqual(
    enrolled.discovery.repositories.map((repo) => repo.repo_id),
    [
      "rudi--apps--registry",
      "rudi--business--engagements--client-one",
      "rudi--root",
    ]
  );
  assert.equal(
    enrolled.discovery.repositories.some((repo) => repo.path.includes("node_modules")),
    false
  );
  assert.equal(
    enrolled.discovery.repositories.some((repo) => repo.path.includes(".venv")),
    false
  );
  assert.equal(
    enrolled.discovery.repositories.some((repo) => repo.path.includes("linked-repository")),
    false
  );

  const enrollment = JSON.parse(
    await readFile(join(fixture.stateRoot, "enrollment.json"), "utf8")
  );
  assert.equal(enrollment.version, 1);
  assert.equal(enrollment.roots[0].root_id, "rudi");
  assert.equal(enrollment.history[0].owner, "agent-one");

  const duplicate = await enrollRepositoryRoot({
    root_path: fixture.workspace,
    owner: "agent-one",
  }, options);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.enrollment_version, 1);

  await assert.rejects(
    () => enrollRepositoryRoot({
      root_id: "rudi",
      root_path: fixture.workspace,
      owner: "agent-one",
      fetch_allowed: true,
    }, options),
    /already enrolled with different policy/
  );
});

test("discovery and fleet scans pick up repositories created after enrollment", async (t) => {
  const fixture = await createDiscoveryFixture(t);
  const options = { stateRoot: fixture.stateRoot };
  await enrollRepositoryRoot({
    root_id: "rudi",
    root_path: fixture.workspace,
    owner: "agent-one",
  }, options);

  const before = await discoverRepositories({}, options);
  assert.equal(before.summary.repositories, 3);

  await createRepo(join(fixture.workspace, "programs", "new-learning-app"));

  const after = await discoverRepositories({}, options);
  assert.equal(after.summary.repositories, 4);
  assert.ok(
    after.repositories.some((repo) => repo.repo_id === "rudi--programs--new-learning-app")
  );

  const fleet = await scanFleet({}, options);
  assert.equal(fleet.summary.total, 4);
  assert.equal(fleet.summary.scanned, 4);
  assert.equal(fleet.discovery.repositories, 4);
});

test("enrollment rejects overlapping roots and discovery bounds root selection", async (t) => {
  const fixture = await createDiscoveryFixture(t);
  const options = { stateRoot: fixture.stateRoot };
  await enrollRepositoryRoot({
    root_id: "rudi",
    root_path: fixture.workspace,
    owner: "agent-one",
  }, options);

  await assert.rejects(
    () => enrollRepositoryRoot({
      root_id: "registry",
      root_path: join(fixture.workspace, "apps", "registry"),
      owner: "agent-one",
    }, options),
    /overlaps enrolled root/
  );

  await assert.rejects(
    () => discoverRepositories({ root_ids: ["missing"] }, options),
    /Root is not configured: missing/
  );
  await assert.rejects(
    () => enrollRepositoryRoot({
      root_id: "relative",
      root_path: "relative/path",
      owner: "agent-one",
    }, options),
    /root_path must be absolute/
  );
});
