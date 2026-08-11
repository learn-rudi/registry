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
  it("rejects illegal status transitions without mutating the plan", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "transition",
        "--plan",
        planPath,
        "--node",
        "task-a",
        "--to",
        "done",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/invalid transition.*ready.*done/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("rejects completion without accepted criterion, verification, and deliverable evidence", async () => {
    const review = { ...nodeRecord("task-a"), status: "review" };
    const planPath = await writePlan(planRecord([review]));
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "transition",
        "--plan",
        planPath,
        "--node",
        "task-a",
        "--to",
        "done",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/completion evidence/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("prevents transition from bypassing manager cancellation reconciliation", async () => {
    const planPath = await writePlan(
      planRecord([{ ...nodeRecord("task-a"), status: "running" }]),
    );
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "transition",
        "--plan",
        planPath,
        "--node",
        "task-a",
        "--to",
        "cancelled",
        "--blocking-reason",
        "Stop this task.",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/requires reconcile/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("moves ready to running only with the current accepted attempt", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const runPath = await writeRun(
      runRecord([activeAttempt("task-a", ["files:task-a"])]),
    );

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "transition",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--node",
      "task-a",
      "--to",
      "running",
    ]);

    expect(JSON.parse(stdout)).toEqual({
      nodeId: "task-a",
      status: "running",
      revision: 2,
    });
  });

  it("refuses ready to running when a dependency is no longer done", async () => {
    const producer = nodeRecord("producer");
    const consumer = nodeRecord("consumer", ["producer"]);
    const planPath = await writePlan(planRecord([producer, consumer]));
    const runPath = await writeRun(
      runRecord([activeAttempt("consumer", ["files:consumer"])]),
    );
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "transition",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--node",
        "consumer",
        "--to",
        "running",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/running requires all dependencies done/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("reconciles a complete result into review with accepted evidence", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const attempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      terminationOutcome: "complete",
      nativeLifecycle: "completed",
      terminationHistory: [
        terminationRecord("task-a", "complete", "completed"),
      ],
    };
    const runPath = await writeRun(runRecord([attempt]));
    const evidence = [
      {
        subjectType: "criterion",
        subjectId: "accepted",
        uri: "artifact://run-1/task-a/criterion.json",
        digest: `sha256:${"a".repeat(64)}`,
        mediaType: "application/json",
      },
      {
        subjectType: "verification",
        subjectId: "tests",
        uri: "artifact://run-1/task-a/tests.txt",
        digest: `sha256:${"b".repeat(64)}`,
        mediaType: "text/plain",
      },
      {
        subjectType: "deliverable",
        subjectId: "implementation",
        uri: "artifact://run-1/task-a/implementation.patch",
        digest: `sha256:${"c".repeat(64)}`,
        mediaType: "text/x-diff",
      },
    ];
    const resultPath = await writeInput("result.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-task-a-1",
      outcome: "complete",
      summary: "Completed the scoped implementation.",
      evidence,
    });

    const reconcileArgs = [
      scriptPath,
      "reconcile",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      resultPath,
      "--to",
      "review",
      "--manager-reason",
      "Evidence is complete and ready for review.",
      "--accepted-at",
      "2026-08-11T12:05:00.000Z",
    ];
    const { stdout } = await execFileAsync("node", reconcileArgs);

    expect(JSON.parse(stdout)).toMatchObject({
      nodeId: "task-a",
      status: "review",
      revision: 2,
      idempotent: false,
    });
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    expect(plan.nodes[0].status).toBe("review");
    expect(plan.nodes[0].reconciliations).toEqual([
      {
        resultId: "result-task-a-1",
        cancellationId: null,
        attemptId: "attempt-task-a",
        inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        outcome: "complete",
        fromStatus: "running",
        toStatus: "review",
        acceptedAt: "2026-08-11T12:05:00.000Z",
        acceptedPlanRevision: 2,
        managerReason: "Evidence is complete and ready for review.",
        evidenceContract: evidenceContractRecord(),
        evidence,
      },
    ]);

    const duplicate = JSON.parse(
      (await execFileAsync("node", reconcileArgs)).stdout,
    );
    expect(duplicate).toMatchObject({ revision: 2, idempotent: true });

    await writeInput("result.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-task-a-1",
      outcome: "complete",
      summary: "Conflicting content under a reused ID.",
      evidence,
    });
    await expect(execFileAsync("node", reconcileArgs)).rejects.toMatchObject({
      stderr: expect.stringMatching(/conflicting duplicate result id/i),
    });
  });

  it("hashes the exact original result bytes for reconciliation identity", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const attempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      terminationHistory: [terminationRecord("task-a", "failed", "failed")],
    };
    const runPath = await writeRun(runRecord([attempt]));
    const result = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-task-a-bom",
      outcome: "failed",
      summary: "The bounded attempt failed.",
      evidence: [],
    };
    const bytes = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`${JSON.stringify(result)}\n`, "utf8"),
    ]);
    const resultPath = path.join(tmpDir, "result-with-bom.json");
    await fs.writeFile(resultPath, bytes);

    await execFileAsync("node", [
      scriptPath,
      "reconcile",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      resultPath,
      "--to",
      "failed",
      "--manager-reason",
      "Failure evidence accepted.",
      "--accepted-at",
      "2026-08-11T12:06:00.000Z",
    ]);

    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    expect(plan.nodes[0].reconciliations[0].inputDigest).toBe(
      crypto.createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("rejects results inconsistent with dispatch and native termination", async () => {
    const cases = [
      ["accepted", "failed"],
      ["prepared", "complete"],
      ["route_failed", "complete"],
      ["dispatch_indeterminate", "complete"],
      ["accepted", "cancelled"],
    ];
    for (const [dispatchState, terminationOutcome] of cases) {
      const running = { ...nodeRecord("task-a"), status: "running" };
      const planPath = await writePlan(planRecord([running]));
      const attempt = {
        ...activeAttempt("task-a", running.resourceLocks),
        dispatchState,
        terminationOutcome,
        nativeLifecycle: String(terminationOutcome),
        dispatchTimestamp:
          dispatchState === "prepared" ? null : "2026-08-11T12:01:00.000Z",
        dispatchHistory:
          dispatchState === "prepared"
            ? []
            : [
                {
                  ...activeAttempt("task-a", running.resourceLocks)
                    .dispatchHistory[0],
                  dispatchState,
                  nativeLifecycle: String(dispatchState),
                },
              ],
        terminationHistory: [
          terminationRecord(
            "task-a",
            terminationOutcome as "complete" | "failed" | "cancelled",
            String(terminationOutcome),
          ),
        ],
      };
      const runPath = await writeRun(runRecord([attempt]));
      const resultPath = await writeInput("lifecycle-result.json", {
        schemaVersion: 1,
        projectId: "demo-project",
        runId: "run-1",
        nodeId: "task-a",
        attemptId: "attempt-task-a",
        resultId: `result-${dispatchState}`,
        outcome: "complete",
        summary: "Claimed complete.",
        evidence: [
          {
            subjectType: "criterion",
            subjectId: "accepted",
            uri: "artifact://run-1/task-a/criterion.json",
            digest: `sha256:${"a".repeat(64)}`,
            mediaType: "application/json",
          },
          {
            subjectType: "verification",
            subjectId: "tests",
            uri: "artifact://run-1/task-a/tests.txt",
            digest: `sha256:${"b".repeat(64)}`,
            mediaType: "text/plain",
          },
          {
            subjectType: "deliverable",
            subjectId: "implementation",
            uri: "artifact://run-1/task-a/change.patch",
            digest: `sha256:${"c".repeat(64)}`,
            mediaType: "text/x-diff",
          },
        ],
      });

      await expect(
        execFileAsync("node", [
          scriptPath,
          "reconcile",
          "--plan",
          planPath,
          "--run",
          runPath,
          "--input",
          resultPath,
          "--to",
          "review",
          "--manager-reason",
          "Lifecycle must agree.",
          "--accepted-at",
          "2026-08-11T12:06:00.000Z",
        ]),
      ).rejects.toMatchObject({
        stderr: expect.stringMatching(
          /dispatch.*accepted|termination.*outcome|lifecycle/i,
        ),
      });
    }
  });

  it("rejects deliverable evidence with an undeclared media type", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const attempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      terminationOutcome: "complete",
      nativeLifecycle: "completed",
      terminationHistory: [
        terminationRecord("task-a", "complete", "completed"),
      ],
    };
    const runPath = await writeRun(runRecord([attempt]));
    const resultPath = await writeInput("wrong-media-result.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-wrong-media",
      outcome: "complete",
      summary: "Wrong media.",
      evidence: [
        {
          subjectType: "criterion",
          subjectId: "accepted",
          uri: "artifact://run-1/task-a/criterion.json",
          digest: `sha256:${"a".repeat(64)}`,
          mediaType: "application/json",
        },
        {
          subjectType: "verification",
          subjectId: "tests",
          uri: "artifact://run-1/task-a/tests.txt",
          digest: `sha256:${"b".repeat(64)}`,
          mediaType: "text/plain",
        },
        {
          subjectType: "deliverable",
          subjectId: "implementation",
          uri: "artifact://run-1/task-a/change.json",
          digest: `sha256:${"c".repeat(64)}`,
          mediaType: "application/json",
        },
      ],
    });

    await expect(
      execFileAsync("node", [
        scriptPath,
        "reconcile",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        resultPath,
        "--to",
        "review",
        "--manager-reason",
        "Media must agree.",
        "--accepted-at",
        "2026-08-11T12:06:00.000Z",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/deliverable evidence media type/i),
    });
  });

  it("rejects authority-expanding result fields without mutating the plan", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const runPath = await writeRun(
      runRecord([
        {
          ...activeAttempt("task-a", running.resourceLocks),
          terminationOutcome: "complete",
          nativeLifecycle: "completed",
          terminationHistory: [
            terminationRecord("task-a", "complete", "completed"),
          ],
        },
      ]),
    );
    const resultPath = await writeInput("result-with-authority.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-task-a-2",
      outcome: "complete",
      summary: "Attempted to broaden scope.",
      evidence: [],
      allowedScope: ["**"],
    });
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "reconcile",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        resultPath,
        "--to",
        "review",
        "--manager-reason",
        "This must be rejected.",
        "--accepted-at",
        "2026-08-11T12:05:00.000Z",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unknown result field: allowedScope/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("rejects a late result from an attempt superseded by a newer attempt", async () => {
    const running = { ...nodeRecord("task-a"), status: "running" };
    const planPath = await writePlan(planRecord([running]));
    const oldAttempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      terminationOutcome: "complete",
      nativeLifecycle: "completed",
      terminationHistory: [
        terminationRecord("task-a", "complete", "completed"),
      ],
    };
    const currentAttempt = {
      ...activeAttempt("task-a", running.resourceLocks),
      attemptId: "attempt-task-a-new",
      binding: {
        ...activeAttempt("task-a", running.resourceLocks).binding,
        idempotencyKey: "idempotency-task-a-new",
      },
    };
    const runPath = await writeRun(runRecord([oldAttempt, currentAttempt]));
    const resultPath = await writeInput("stale-result.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      nodeId: "task-a",
      attemptId: "attempt-task-a",
      resultId: "result-task-a-stale",
      outcome: "complete",
      summary: "Late result.",
      evidence: [],
    });

    await expect(
      execFileAsync("node", [
        scriptPath,
        "reconcile",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        resultPath,
        "--to",
        "review",
        "--manager-reason",
        "This must be stale.",
        "--accepted-at",
        "2026-08-11T12:08:00.000Z",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/stale result attempt id/i),
    });
  });
});
