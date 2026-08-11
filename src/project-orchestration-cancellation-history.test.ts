import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
  setupTmpDir,
  cleanupTmpDir,
} from "./project-orchestration.test.helpers";

beforeEach(setupTmpDir);
afterEach(cleanupTmpDir);

describe("project orchestration", () => {
  it("records manager cancellation for a never-dispatched node", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const runPath = await writeRun(runRecord());
    const cancellationPath = await writeInput("cancellation.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: null,
      cancellationId: "cancel-task-a-1",
      reason: "The manager intentionally removed this scope.",
      evidence: [],
    });

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "reconcile",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      cancellationPath,
      "--to",
      "cancelled",
      "--manager-reason",
      "Cancelled by the manager.",
      "--accepted-at",
      "2026-08-11T12:06:00.000Z",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      nodeId: "task-a",
      status: "cancelled",
      revision: 2,
      idempotent: false,
    });
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    expect(plan.nodes[0].blockingReason).toBe("Cancelled by the manager.");
    expect(plan.nodes[0].reconciliations[0]).toMatchObject({
      resultId: null,
      cancellationId: "cancel-task-a-1",
      attemptId: null,
      outcome: "cancelled",
      fromStatus: "ready",
      toStatus: "cancelled",
    });
  });

  it("reconciles a dispatched cancellation only after confirmed native stop", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const attempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      terminationOutcome: "cancelled",
      nativeLifecycle: "cancelled",
      terminationHistory: [
        terminationRecord("task-a", "cancelled", "cancelled"),
      ],
      resultReference: {
        kind: "cancellation",
        id: "cancel-task-a-2",
        acceptedPlanRevision: 1,
      },
    };
    const runPath = await writeRun(runRecord([attempt]));
    const cancellationPath = await writeInput("dispatched-cancellation.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      cancellationId: "cancel-task-a-2",
      reason: "The manager stopped the native worker.",
      evidence: [],
    });

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "reconcile",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      cancellationPath,
      "--to",
      "cancelled",
      "--manager-reason",
      "Native stop confirmed and accepted.",
      "--accepted-at",
      "2026-08-11T12:07:00.000Z",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      nodeId: "task-a",
      status: "cancelled",
      revision: 2,
      idempotent: false,
    });
  });

  it("reconciles cancellation when an attempt proves no native work was accepted", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const attempt = {
      ...activeAttempt("task-a", ["files:task-a"]),
      dispatchState: "route_failed",
      nativeLifecycle: "route_failed",
      dispatchHistory: [
        {
          ...activeAttempt("task-a", ["files:task-a"]).dispatchHistory[0],
          dispatchState: "route_failed",
          nativeLifecycle: "route_failed",
        },
      ],
      resultReference: {
        kind: "cancellation",
        id: "cancel-task-a-route-failed",
        acceptedPlanRevision: 1,
      },
    };
    const runPath = await writeRun(runRecord([attempt]));
    const cancellationPath = await writeInput(
      "route-failed-cancellation.json",
      {
        schemaVersion: 1,
        projectId: "demo-project",
        runId: "run-1",
        nodeId: "task-a",
        attemptId: "attempt-task-a",
        cancellationId: "cancel-task-a-route-failed",
        reason: "The route failed before native acceptance.",
        evidence: [],
      },
    );

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "reconcile",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      cancellationPath,
      "--to",
      "cancelled",
      "--manager-reason",
      "Non-acceptance was established.",
      "--accepted-at",
      "2026-08-11T12:09:00.000Z",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      nodeId: "task-a",
      status: "cancelled",
      revision: 2,
    });
  });

  it("rejects undeclared nested run transport fields", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const run = runRecord([activeAttempt("task-a", ["files:task-a"])]);
    (run.attempts[0] as ReturnType<typeof activeAttempt>).binding = {
      ...(run.attempts[0] as ReturnType<typeof activeAttempt>).binding,
      fallbackCwd: "/tmp/other-project",
    } as ReturnType<typeof activeAttempt>["binding"];
    const runPath = await writeRun(run);

    await expect(
      execFileAsync("node", [
        scriptPath,
        "ready",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /unknown attempt binding field: fallbackCwd/i,
      ),
    });
  });

  it("rejects an attempt bound to a different project than its node target", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const attempt = activeAttempt("task-a", ["files:task-a"]);
    attempt.binding.projectBindingId = "project-other";
    const run = runRecord([attempt]);
    run.projects.push({
      ...run.projects[0],
      projectBindingId: "project-other",
      locator: { projectId: "other-target" },
      resolvedRoot: "/tmp/other-target",
    });
    const runPath = await writeRun(run);

    await expect(
      execFileAsync("node", [
        scriptPath,
        "ready",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/attempt project binding.*node target/i),
    });
  });

  it("rejects an attempt whose resolved starting state differs from its node target", async () => {
    const node = nodeRecord("task-a");
    node.target.startingState = { policy: "ref", ref: "refs/heads/main" };
    const planPath = await writePlan(planRecord([node]));
    const runPath = await writeRun(
      runRecord([activeAttempt("task-a", ["files:task-a"])]),
    );

    await expect(
      execFileAsync("node", [
        scriptPath,
        "ready",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /attempt starting-state binding.*node target/i,
      ),
    });
  });

  it("retains reconciled historical attempts when a retry contract is revised", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "ready",
      resourceLocks: ["files:revised"],
      reconciliations: [
        {
          resultId: "result-task-a-old",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:00:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Retry under a revised contract.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 3;
    const attempt = {
      ...activeAttempt("task-a", ["files:old"]),
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      terminationHistory: [terminationRecord("task-a", "failed", "failed")],
      resultReference: {
        kind: "result",
        id: "result-task-a-old",
        acceptedPlanRevision: 2,
      },
    };
    const run = runRecord([attempt]);
    run.planRevision = 3;
    const planPath = await writePlan(plan);
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout).ready[0]).toMatchObject({
      nodeId: "task-a",
      projectBindingId: "project-local",
    });
  });

  it("validates retained reconciliation evidence against its immutable snapshot", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "ready",
      acceptanceCriteria: [
        {
          id: "revised-criterion",
          statement: "The revised retry is accepted.",
        },
      ],
      reconciliations: [
        {
          resultId: "result-task-a-old",
          cancellationId: null,
          attemptId: "attempt-task-a-old",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:00:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The old contract failed.",
          evidenceContract: {
            ...evidenceContractRecord(),
            criteria: ["accepted"],
          },
          evidence: [
            {
              subjectType: "criterion",
              subjectId: "accepted",
              uri: "artifact://run-1/task-a/old-criterion.json",
              digest: `sha256:${"a".repeat(64)}`,
              mediaType: "application/json",
            },
          ],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 3;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).resolves.toMatchObject({ stderr: "" });
  });

  it("rejects a node reopened after a terminal cancellation reconciliation", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "ready",
      reconciliations: [
        {
          resultId: null,
          cancellationId: "cancel-task-a",
          attemptId: null,
          inputDigest: "a".repeat(64),
          outcome: "cancelled",
          fromStatus: "ready",
          toStatus: "cancelled",
          acceptedAt: "2026-08-11T12:00:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Cancelled by the manager.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 3;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /terminal cancellation.*status must remain cancelled/i,
      ),
    });
  });

  it("requires reconciliation revisions to be unique across the whole plan", async () => {
    const base = {
      resultId: "result-task-a-1",
      cancellationId: null,
      attemptId: "attempt-task-a-1",
      inputDigest: "a".repeat(64),
      outcome: "failed",
      fromStatus: "running",
      toStatus: "failed",
      acceptedAt: "2026-08-11T12:00:00.000Z",
      acceptedPlanRevision: 2,
      managerReason: "First attempt failed.",
      evidenceContract: evidenceContractRecord(),
      evidence: [],
    };
    const failedNode = (id: string) => ({
      ...nodeRecord(id),
      status: "failed",
      blockingReason: "The attempt failed.",
      reconciliations: [
        {
          ...base,
          resultId: `result-${id}`,
          attemptId: `attempt-${id}`,
          inputDigest: id === "task-a" ? "a".repeat(64) : "b".repeat(64),
        },
      ],
    });
    const plan = planRecord([
      failedNode("task-a"),
      failedNode("task-b"),
    ] as any);
    plan.revision = 3;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate accepted plan revision/i),
    });
  });
});
