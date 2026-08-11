import { execFile } from "node:child_process";
import crypto from "node:crypto";
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

function nodeRecord(id: string, dependencies: string[] = []) {
  return {
    id,
    title: `Task ${id}`,
    objective: `Complete ${id}.`,
    dependencies,
    owner: "demo-owner",
    allowedScope: ["src/**"],
    acceptanceCriteria: [
      { id: "accepted", statement: "The task is accepted." },
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
    resourceLocks: [`files:${id}`],
    target: {
      project: { projectId: "demo-target" },
      workspaceMode: "isolated_worktree",
      startingState: { policy: "current_revision" },
      modelSelection: {
        provider: "openai",
        model: "gpt-5.6-sol",
        reasoningProfile: "high",
        selectionSource: "plan",
        fallbackAuthorized: false,
        fallbackAuthorizationRef: null,
        fallbackUnresolvedBlockerRef: null,
      },
    },
    review: null,
    reconciliations: [],
  };
}

function planRecord(nodes: ReturnType<typeof nodeRecord>[]) {
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
    nodes,
    handoffs: [],
  };
}

function evidenceContractRecord(
  handoffs: Array<{
    id: string;
    producerNodeId: string;
    consumerNodeId: string;
    deliverableId: string;
    medium: string;
    mediaType: string;
  }> = [],
) {
  return {
    criteria: ["accepted"],
    verifications: ["tests"],
    deliverables: [{ id: "implementation", mediaTypes: ["text/x-diff"] }],
    handoffs,
  };
}

async function writePlan(plan: unknown): Promise<string> {
  const orchestrationRoot = path.join(tmpDir, ".rudi/orchestration");
  await fs.mkdir(orchestrationRoot, { recursive: true });
  const planPath = path.join(orchestrationRoot, "plan.json");
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
  return planPath;
}

async function writeRun(run: unknown): Promise<string> {
  const runsRoot = path.join(tmpDir, ".rudi/orchestration/runs");
  await fs.mkdir(runsRoot, { recursive: true });
  const runPath = path.join(runsRoot, "run-1.json");
  await fs.writeFile(runPath, JSON.stringify(run, null, 2) + "\n");
  return runPath;
}

async function writeInput(name: string, value: unknown): Promise<string> {
  const inputPath = path.join(tmpDir, name);
  await fs.writeFile(inputPath, JSON.stringify(value, null, 2) + "\n");
  return inputPath;
}

function runRecord(attempts: unknown[] = [], maxConcurrency = 3) {
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
        capabilities: ["desktop_tasks", "git_worktrees", "subagents"],
        modelProfiles: [
          {
            provider: "openai",
            model: "gpt-5.6-sol",
            reasoningProfiles: ["high"],
          },
        ],
        maxConcurrency,
        supportsReversibleArchive: true,
        discoveredAt: "2026-08-11T12:00:00.000Z",
      },
    ],
    attempts,
    usageReports: [],
    lineage: [],
  };
}

function activeAttempt(nodeId: string, resourceLocks: string[]) {
  const nativeIds = {
    savedProjectId: null,
    hostId: "local",
    agentId: null,
    taskId: null,
    threadId: null,
  };
  return {
    attemptId: `attempt-${nodeId}`,
    nodeId,
    preparedPlanRevision: 1,
    preparedAt: "2026-08-11T12:00:30.000Z",
    binding: {
      projectBindingId: "project-local",
      hostBindingId: "host-local",
      executionSurface: "subagent",
      workspaceMode: "isolated_worktree",
      actualCwd: `/tmp/worktrees/${nodeId}`,
      actualWorktree: `/tmp/worktrees/${nodeId}`,
      observedRevision: "abc123",
      branch: `codex/${nodeId}`,
      resourceLocks,
      authorizationRef: null,
      idempotencyKey: `idempotency-${nodeId}`,
      modelSelection: nodeRecord(nodeId).target.modelSelection,
    },
    nativeIds,
    dispatchState: "accepted",
    terminationOutcome: null,
    nativeLifecycle: "running",
    dispatchHistory: [
      {
        dispatchId: `dispatch-${nodeId}`,
        dispatchState: "accepted",
        nativeIds,
        nativeLifecycle: "running",
        recordedAt: "2026-08-11T12:01:00.000Z",
      },
    ],
    terminationHistory: [],
    pendingSteering: [],
    dispatchTimestamp: "2026-08-11T12:01:00.000Z",
    archive: { state: "not_archived", archivedAt: null, lastAttemptedAt: null },
    archiveHistory: [],
    resultReference: null,
  };
}

function terminationRecord(
  nodeId: string,
  outcome: "complete" | "partial" | "failed" | "cancelled",
  nativeLifecycle: string,
) {
  return {
    terminationId: `termination-${nodeId}`,
    outcome,
    nativeLifecycle,
    recordedAt: "2026-08-11T12:02:00.000Z",
  };
}

export async function setupTmpDir() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-project-dag-"));
}

export async function cleanupTmpDir() {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

export {
  activeAttempt,
  crypto,
  evidenceContractRecord,
  execFileAsync,
  fs,
  nodeRecord,
  path,
  planRecord,
  runRecord,
  scriptPath,
  terminationRecord,
  tmpDir,
  writeInput,
  writePlan,
  writeRun,
};
