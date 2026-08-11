import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  repoRoot,
  "catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs",
);

let tmpDir: string;

function nodeRecord() {
  return {
    id: "implementation",
    title: "Implementation",
    objective: "Implement the bounded assignment.",
    dependencies: [],
    owner: "implementation-owner",
    allowedScope: ["src/**"],
    acceptanceCriteria: [
      { id: "accepted", statement: "The implementation is accepted." },
    ],
    verification: [{ id: "tests", method: "command", instruction: "npm test" }],
    deliverables: [
      {
        id: "implementation",
        description: "Scoped implementation",
        mediaTypes: ["text/x-diff"],
      },
    ],
    risk: "medium",
    blockingReason: null,
    status: "ready",
    executionSurface: "subagent",
    resourceLocks: ["files:implementation"],
    target: {
      project: { projectId: "demo-target" },
      workspaceMode: "isolated_worktree",
      startingState: { policy: "current_revision" },
    },
    review: null,
    reconciliations: [],
  };
}

function planRecord() {
  return {
    schemaVersion: 1,
    projectId: "demo-project",
    runId: "run-1",
    revision: 1,
    objective: "Coordinate the demo project.",
    requestedMaxParallel: 2,
    resourceEnvelope: {
      maxElapsedSeconds: null,
      maxTokens: null,
      softCheckpointElapsedSeconds: 1800,
      softCheckpointTokens: 100000,
    },
    reviewPolicy: {
      maxIndependentReviews: 1,
      maxFocusedConfirmations: 1,
      additionalReviewRule: "unresolved_blocker_or_explicit_authorization",
    },
    nodes: [nodeRecord()],
    handoffs: [],
  };
}

function exactModelSelection() {
  return {
    provider: "openai",
    model: "gpt-5.6-sol",
    reasoningProfile: "high",
    selectionSource: "plan",
    fallbackAuthorized: false,
    fallbackAuthorizationRef: null,
    fallbackUnresolvedBlockerRef: null,
  };
}

function discoveryRecord() {
  return {
    schemaVersion: 1,
    projectId: "demo-project",
    runId: "run-1",
    planRevision: 1,
    projects: [
      {
        projectBindingId: "project-local",
        hostBindingId: "host-local",
        locator: { projectId: "demo-target" },
        nativeSavedProjectId: null,
        repositoryIdentity: null,
        resolvedRoot: "/tmp/demo-target",
        startingState: { policy: "current_revision" },
        observedRevision: "abc123",
        defaultBranch: "main",
        discoveredAt: "2026-08-11T12:00:00.000Z",
      },
    ],
    hosts: [
      {
        hostBindingId: "host-local",
        selector: null,
        nativeHostId: "local",
        capabilities: ["git_worktrees", "subagents"],
        modelProfiles: [
          {
            provider: "openai",
            model: "gpt-5.6-sol",
            reasoningProfiles: ["high"],
          },
        ],
        maxConcurrency: 2,
        supportsReversibleArchive: true,
        discoveredAt: "2026-08-11T12:00:00.000Z",
      },
    ],
    lineage: [],
  };
}

async function writePlan(plan: unknown): Promise<string> {
  const root = path.join(tmpDir, ".rudi/orchestration");
  await fs.mkdir(root, { recursive: true });
  const planPath = path.join(root, "plan.json");
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
  return planPath;
}

async function initializePreparedRun() {
  const plan = planRecord();
  plan.nodes[0].target.modelSelection = exactModelSelection();
  const planPath = await writePlan(plan);
  const discoveryPath = path.join(tmpDir, "discovery.json");
  await fs.writeFile(
    discoveryPath,
    JSON.stringify(discoveryRecord(), null, 2) + "\n",
  );
  const runPath = path.join(tmpDir, ".rudi/orchestration/runs/run-1.json");
  await execFileAsync("node", [
    scriptPath,
    "run-init",
    "--plan",
    planPath,
    "--run",
    runPath,
    "--input",
    discoveryPath,
  ]);
  const preparePath = path.join(tmpDir, "prepare.json");
  await fs.writeFile(
    preparePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        projectId: "demo-project",
        runId: "run-1",
        planRevision: 1,
        nodeId: "implementation",
        attemptId: "attempt-implementation-1",
        projectBindingId: "project-local",
        hostBindingId: "host-local",
        actualCwd: "/tmp/worktrees/implementation",
        actualWorktree: "/tmp/worktrees/implementation",
        branch: "codex/implementation",
        authorizationRef: null,
        preparedAt: "2026-08-11T12:01:00.000Z",
      },
      null,
      2,
    ) + "\n",
  );
  await execFileAsync("node", [
    scriptPath,
    "prepare",
    "--plan",
    planPath,
    "--run",
    runPath,
    "--input",
    preparePath,
  ]);
  return { planPath, runPath };
}

export async function setupTmpDir() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-runtime-policy-"));
}

export async function cleanupTmpDir() {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

export {
  discoveryRecord,
  exactModelSelection,
  execFileAsync,
  fs,
  initializePreparedRun,
  nodeRecord,
  path,
  planRecord,
  scriptPath,
  tmpDir,
  writePlan,
};
