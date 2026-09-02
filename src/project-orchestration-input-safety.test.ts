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
  it("rejects multiple terminal reconciliations for one attempt", async () => {
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
    const node = {
      ...nodeRecord("task-a"),
      status: "failed",
      blockingReason: "The same attempt later claimed failure.",
      reconciliations: [
        {
          resultId: "result-task-a-complete",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "1".repeat(64),
          outcome: "complete",
          fromStatus: "running",
          toStatus: "review",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Accepted complete result.",
          evidenceContract: evidenceContractRecord(),
          evidence,
        },
        {
          resultId: "result-task-a-failed",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "2".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:10:00.000Z",
          acceptedPlanRevision: 3,
          managerReason: "Accepted failed result.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    };
    const plan = planRecord([node]);
    plan.revision = 3;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/one terminal reconciliation.*attempt/i),
    });
  });

  it("rejects duplicate JSON keys instead of accepting parser overwrite", async () => {
    const orchestrationRoot = path.join(tmpDir, ".rudi/orchestration");
    await fs.mkdir(orchestrationRoot, { recursive: true });
    const planPath = path.join(orchestrationRoot, "plan.json");
    const raw = JSON.stringify(planRecord([nodeRecord("task-a")])).replace(
      '"projectId":"demo-project"',
      '"projectId":"shadow-project","projectId":"demo-project"',
    );
    await fs.writeFile(planPath, raw + "\n");

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate json key.*projectId/i),
    });
  });

  it("rejects invalid UTF-8 instead of accepting replacement characters", async () => {
    const orchestrationRoot = path.join(tmpDir, ".rudi/orchestration");
    await fs.mkdir(orchestrationRoot, { recursive: true });
    const planPath = path.join(orchestrationRoot, "plan.json");
    await fs.writeFile(
      planPath,
      Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/invalid UTF-8/i),
    });
  });

  it("rejects evidence URI schemes that cannot name retrievable artifacts", async () => {
    const node = { ...nodeRecord("task-a"), status: "done" } as any;
    node.reconciliations = [
      {
        resultId: "result-task-a",
        cancellationId: null,
        attemptId: "attempt-task-a",
        inputDigest: "a".repeat(64),
        outcome: "complete",
        fromStatus: "running",
        toStatus: "review",
        acceptedAt: "2026-08-11T12:00:00.000Z",
        acceptedPlanRevision: 2,
        managerReason: "Accepted.",
        evidenceContract: evidenceContractRecord(),
        evidence: [
          ["criterion", "accepted"],
          ["verification", "tests"],
          ["deliverable", "implementation"],
        ].map(([subjectType, subjectId]) => ({
          subjectType,
          subjectId,
          uri: "javascript://not-an-artifact",
          digest: `sha256:${"a".repeat(64)}`,
          mediaType: "text/plain",
        })),
      },
    ];
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/evidence URI scheme.*not allowed/i),
    });
  });

  it("rejects a plan reached through a symlinked orchestration ancestor", async () => {
    const realRoot = path.join(tmpDir, "real-orchestration");
    const rudiRoot = path.join(tmpDir, ".rudi");
    await fs.mkdir(realRoot, { recursive: true });
    await fs.mkdir(rudiRoot, { recursive: true });
    await fs.writeFile(
      path.join(realRoot, "plan.json"),
      JSON.stringify(planRecord([nodeRecord("task-a")]), null, 2) + "\n",
    );
    await fs.symlink(realRoot, path.join(rudiRoot, "orchestration"));

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate",
        "--plan",
        path.join(rudiRoot, "orchestration", "plan.json"),
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/symlinked orchestration ancestor/i),
    });
  });

  it("rejects native IDs and non-absolute paths in project locators", async () => {
    const node = {
      ...nodeRecord("task-a"),
      target: {
        project: {
          projectId: "demo-target",
          absolutePath: "relative/project",
          nativeSavedProjectId: "native-project-123",
        },
        workspaceMode: "isolated_worktree",
      },
    };
    const planPath = await writePlan(planRecord([node]));

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /unknown project locator field: nativeSavedProjectId/i,
      ),
    });
  });

  it("rejects a persisted done node without complete accepted evidence", async () => {
    const done = { ...nodeRecord("task-a"), status: "done" };
    const planPath = await writePlan(planRecord([done]));

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/done node.*completion evidence/i),
    });
  });

  it("rejects done when a later reconciliation supersedes completion", async () => {
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
        uri: "artifact://run-1/task-a/change.patch",
        digest: `sha256:${"c".repeat(64)}`,
        mediaType: "text/x-diff",
      },
    ];
    const node = {
      ...nodeRecord("task-a"),
      status: "done",
      reconciliations: [
        {
          resultId: "result-complete",
          cancellationId: null,
          attemptId: "attempt-complete",
          inputDigest: "a".repeat(64),
          outcome: "complete",
          fromStatus: "running",
          toStatus: "review",
          acceptedAt: "2026-08-11T12:00:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Initially complete.",
          evidenceContract: evidenceContractRecord(),
          evidence,
        },
        {
          resultId: "result-failed",
          cancellationId: null,
          attemptId: "attempt-failed",
          inputDigest: "d".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:10:00.000Z",
          acceptedPlanRevision: 4,
          managerReason: "A later retry failed.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 4;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/latest reconciliation.*complete/i),
    });
  });

  it("rejects unknown top-level authority fields", async () => {
    const plan = { ...planRecord([nodeRecord("task-a")]), allowDeploy: true };
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unknown plan field: allowDeploy/i),
    });
  });

  it("rejects an incomplete node contract", async () => {
    const { owner: _owner, ...nodeWithoutOwner } = nodeRecord("task-a");
    const planPath = await writePlan(planRecord([nodeWithoutOwner as never]));

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /node task-a owner must be a non-empty string/i,
      ),
    });
  });

  it("rejects a handoff whose consumer does not depend on its producer", async () => {
    const plan = planRecord([nodeRecord("producer"), nodeRecord("consumer")]);
    plan.handoffs = [
      {
        id: "producer-to-consumer",
        producerNodeId: "producer",
        consumerNodeId: "consumer",
        deliverableId: "implementation",
        transport: { medium: "patch", mediaType: "text/x-diff" },
        requiredEvidence: ["uri", "digest", "mediaType"],
      },
    ];
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/handoff consumer.*depend.*producer/i),
    });
  });

  it("rejects run transport fields that request silent fallback", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const run = { ...runRecord(), fallbackHostId: "some-other-host" };
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
      stderr: expect.stringMatching(/unknown run field: fallbackHostId/i),
    });
  });

  it("rejects a run revision ahead of its authoritative plan without mutation", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const run = runRecord();
    run.planRevision = 2;
    const runPath = await writeRun(run);
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/run plan revision.*ahead/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });

  it("rejects an attempt prepared after the lagging run revision without mutation", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "failed",
      blockingReason: "The attempt failed.",
      reconciliations: [
        {
          resultId: "result-task-a-failed",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The failed outcome was accepted.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const attempt = {
      ...activeAttempt("task-a", node.resourceLocks),
      preparedPlanRevision: 2,
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      terminationHistory: [terminationRecord("task-a", "failed", "failed")],
    };
    const run = runRecord([attempt]);
    run.planRevision = 1;
    const runPath = await writeRun(run);
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/preparedPlanRevision.*run plan revision/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });

  it("rejects duplicate reconciliation IDs across nodes without mutation", async () => {
    const cancellation = (nodeId: string, acceptedPlanRevision: number) => ({
      resultId: null,
      cancellationId: "cancel-shared",
      attemptId: null,
      inputDigest: nodeId === "task-a" ? "a".repeat(64) : "b".repeat(64),
      outcome: "cancelled",
      fromStatus: "ready",
      toStatus: "cancelled",
      acceptedAt: acceptedPlanRevision === 2
        ? "2026-08-11T12:05:00.000Z"
        : "2026-08-11T12:06:00.000Z",
      acceptedPlanRevision,
      managerReason: "The cancellation was accepted.",
      evidenceContract: evidenceContractRecord(),
      evidence: [],
    });
    const plan = planRecord([
      {
        ...nodeRecord("task-a"),
        status: "cancelled",
        blockingReason: "Cancelled.",
        reconciliations: [cancellation("task-a", 2)],
      },
      {
        ...nodeRecord("task-b"),
        status: "cancelled",
        blockingReason: "Cancelled.",
        reconciliations: [cancellation("task-b", 3)],
      },
    ] as any);
    plan.revision = 3;
    const planPath = await writePlan(plan);
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate reconciliation ID/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("rejects one attempt reconciled by multiple nodes without mutation", async () => {
    const result = (resultId: string, acceptedPlanRevision: number) => ({
      resultId,
      cancellationId: null,
      attemptId: "attempt-task-a",
      inputDigest: resultId.endsWith("a") ? "a".repeat(64) : "b".repeat(64),
      outcome: "failed",
      fromStatus: "running",
      toStatus: "failed",
      acceptedAt: acceptedPlanRevision === 2
        ? "2026-08-11T12:05:00.000Z"
        : "2026-08-11T12:06:00.000Z",
      acceptedPlanRevision,
      managerReason: "The failed outcome was accepted.",
      evidenceContract: evidenceContractRecord(),
      evidence: [],
    });
    const plan = planRecord([
      {
        ...nodeRecord("task-a"),
        status: "failed",
        blockingReason: "Failed.",
        reconciliations: [result("result-task-a", 2)],
      },
      {
        ...nodeRecord("task-b"),
        status: "failed",
        blockingReason: "Failed.",
        reconciliations: [result("result-task-b", 3)],
      },
    ] as any);
    plan.revision = 3;
    const planPath = await writePlan(plan);
    const before = await fs.readFile(planPath, "utf8");

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/attempt.*only one terminal reconciliation/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("rejects a reconciliation bound to another node's attempt without mutation", async () => {
    const nodeA = nodeRecord("task-a");
    const nodeB = {
      ...nodeRecord("task-b"),
      status: "cancelled",
      blockingReason: "Cancelled.",
      reconciliations: [
        {
          resultId: null,
          cancellationId: "cancel-task-b",
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "cancelled",
          fromStatus: "ready",
          toStatus: "cancelled",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The cancellation was accepted.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([nodeA, nodeB]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const attempt = {
      ...activeAttempt("task-a", nodeA.resourceLocks),
      terminationOutcome: "cancelled",
      nativeLifecycle: "cancelled",
      terminationHistory: [terminationRecord("task-a", "cancelled", "cancelled")],
    };
    const runPath = await writeRun(runRecord([attempt]));
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/reconciliation.*node.*attempt/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });

  it("rejects reconciliation accepted at its preparation revision without mutation", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "failed",
      blockingReason: "The attempt failed.",
      reconciliations: [
        {
          resultId: "result-task-a-failed",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The failed outcome was accepted.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const attempt = {
      ...activeAttempt("task-a", node.resourceLocks),
      preparedPlanRevision: 2,
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      terminationHistory: [terminationRecord("task-a", "failed", "failed")],
      resultReference: {
        kind: "result",
        id: "result-task-a-failed",
        acceptedPlanRevision: 2,
      },
    };
    const run = runRecord([attempt]);
    run.planRevision = 2;
    const runPath = await writeRun(run);
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/acceptedPlanRevision.*preparation/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });

  it("rejects a non-lagging run that omits an accepted result reference", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "failed",
      blockingReason: "The attempt failed.",
      reconciliations: [
        {
          resultId: "result-task-a-failed",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The failed outcome was accepted.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const attempt = {
      ...activeAttempt("task-a", node.resourceLocks),
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      terminationHistory: [terminationRecord("task-a", "failed", "failed")],
    };
    const run = runRecord([attempt]);
    run.planRevision = 2;
    const runPath = await writeRun(run);
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/missing.*run result reference/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });

  it("rejects a lagging run that has lost an accepted reconciliation attempt", async () => {
    const node = {
      ...nodeRecord("task-a"),
      status: "failed",
      blockingReason: "The attempt failed.",
      reconciliations: [
        {
          resultId: "result-task-a-failed",
          cancellationId: null,
          attemptId: "attempt-task-a",
          inputDigest: "a".repeat(64),
          outcome: "failed",
          fromStatus: "running",
          toStatus: "failed",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "The failed outcome was accepted.",
          evidenceContract: evidenceContractRecord(),
          evidence: [],
        },
      ],
    } as any;
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const runPath = await writeRun(runRecord());
    const before = await fs.readFile(runPath, "utf8");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "validate-run",
        "--plan",
        planPath,
        "--run",
        runPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/accepted reconciliation.*unknown run attempt/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(before);
  });
});
