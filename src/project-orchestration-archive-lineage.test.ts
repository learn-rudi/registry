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
  it("reports a reconciled terminal desktop attempt as archive eligible", async () => {
    const node = {
      ...nodeRecord("milestone"),
      status: "review",
      executionSurface: "desktop_task",
      reconciliations: [
        {
          resultId: "result-milestone-1",
          cancellationId: null,
          attemptId: "attempt-milestone",
          inputDigest: "d".repeat(64),
          outcome: "complete",
          fromStatus: "running",
          toStatus: "review",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Accepted for review.",
          evidenceContract: evidenceContractRecord(),
          evidence: [
            {
              subjectType: "criterion",
              subjectId: "accepted",
              uri: "artifact://run-1/milestone/criterion.json",
              digest: `sha256:${"a".repeat(64)}`,
              mediaType: "application/json",
            },
            {
              subjectType: "verification",
              subjectId: "tests",
              uri: "artifact://run-1/milestone/tests.txt",
              digest: `sha256:${"b".repeat(64)}`,
              mediaType: "text/plain",
            },
            {
              subjectType: "deliverable",
              subjectId: "implementation",
              uri: "artifact://run-1/milestone/implementation.patch",
              digest: `sha256:${"c".repeat(64)}`,
              mediaType: "text/x-diff",
            },
          ],
        },
      ],
    };
    const plan = planRecord([node]);
    plan.revision = 2;
    const planPath = await writePlan(plan);
    const attempt = {
      ...activeAttempt("milestone", node.resourceLocks),
      binding: {
        ...activeAttempt("milestone", node.resourceLocks).binding,
        executionSurface: "desktop_task",
        authorizationRef: "decision://run-1/desktop-task-milestone",
      },
      nativeIds: {
        savedProjectId: "saved-registry",
        hostId: "local",
        agentId: null,
        taskId: "native-task-123",
        threadId: "native-thread-123",
      },
      terminationOutcome: "complete",
      nativeLifecycle: "completed",
      dispatchHistory: [
        {
          ...activeAttempt("milestone", node.resourceLocks).dispatchHistory[0],
          nativeIds: {
            savedProjectId: "saved-registry",
            hostId: "local",
            agentId: null,
            taskId: "native-task-123",
            threadId: "native-thread-123",
          },
        },
      ],
      terminationHistory: [
        terminationRecord("milestone", "complete", "completed"),
      ],
      resultReference: {
        kind: "result",
        id: "result-milestone-1",
        acceptedPlanRevision: 2,
      },
    };
    const run = runRecord([attempt]);
    run.planRevision = 2;
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "archive-eligible",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      eligible: [
        {
          nodeId: "milestone",
          attemptId: "attempt-milestone",
          nativeTaskId: "native-task-123",
          hostBindingId: "host-local",
        },
      ],
      ineligible: [],
    });

    const archivePath = await writeInput("archive-milestone.json", {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 2,
      archiveId: "archive-milestone-1",
      attemptId: "attempt-milestone",
      state: "archived",
      recordedAt: "2026-08-11T12:08:00.000Z",
    });
    const archived = JSON.parse(
      (
        await execFileAsync("node", [
          scriptPath,
          "record-archive",
          "--plan",
          planPath,
          "--run",
          runPath,
          "--input",
          archivePath,
        ])
      ).stdout,
    );
    expect(archived).toMatchObject({
      attemptId: "attempt-milestone",
      archiveState: "archived",
      idempotent: false,
    });
    expect(
      JSON.parse(await fs.readFile(runPath, "utf8")).attempts[0].archive,
    ).toEqual({
      state: "archived",
      archivedAt: "2026-08-11T12:08:00.000Z",
      lastAttemptedAt: "2026-08-11T12:08:00.000Z",
    });

    (run.attempts[0] as typeof attempt).resultReference.acceptedPlanRevision =
      1;
    await writeRun(run);
    const invalidRunBytes = await fs.readFile(runPath, "utf8");
    await expect(
      execFileAsync("node", [
          scriptPath,
          "archive-eligible",
          "--plan",
          planPath,
          "--run",
          runPath,
        ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/result reference.*accepted reconciliation/i),
    });
    expect(await fs.readFile(runPath, "utf8")).toBe(invalidRunBytes);
  });

  it("rejects a visible desktop attempt without explicit authorization", async () => {
    const node = {
      ...nodeRecord("milestone"),
      status: "running",
      executionSurface: "desktop_task",
    };
    const planPath = await writePlan(planRecord([node]));
    const attempt = {
      ...activeAttempt("milestone", node.resourceLocks),
      binding: {
        ...activeAttempt("milestone", node.resourceLocks).binding,
        executionSurface: "desktop_task",
        authorizationRef: null,
      },
    };
    const runPath = await writeRun(runRecord([attempt]));

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
        /desktop task attempt requires explicit authorization/i,
      ),
    });
  });

  it("keeps an unreconciled visible worker out of the archive set", async () => {
    const node = {
      ...nodeRecord("milestone"),
      status: "running",
      executionSurface: "desktop_task",
    };
    const planPath = await writePlan(planRecord([node]));
    const attempt = {
      ...activeAttempt("milestone", node.resourceLocks),
      binding: {
        ...activeAttempt("milestone", node.resourceLocks).binding,
        executionSurface: "desktop_task",
        authorizationRef: "decision://run-1/desktop-task-milestone",
      },
      nativeIds: {
        savedProjectId: "saved-registry",
        hostId: "local",
        agentId: null,
        taskId: "native-task-456",
        threadId: "native-thread-456",
      },
      dispatchHistory: [
        {
          ...activeAttempt("milestone", node.resourceLocks).dispatchHistory[0],
          nativeIds: {
            savedProjectId: "saved-registry",
            hostId: "local",
            agentId: null,
            taskId: "native-task-456",
            threadId: "native-thread-456",
          },
        },
      ],
    };
    const run = runRecord([attempt]);
    run.hosts[0].supportsReversibleArchive = false;
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "archive-eligible",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      eligible: [],
      ineligible: [
        {
          nodeId: "milestone",
          attemptId: "attempt-milestone",
          reasons: [
            "native_not_terminal",
            "result_not_reconciled",
            "archive_unsupported",
          ],
        },
      ],
    });
  });

  it("routes a cross-project dependency to its exact host and verifies source-to-destination lineage", async () => {
    const acceptedDigest = `sha256:${"e".repeat(64)}`;
    const producer = {
      ...nodeRecord("producer"),
      status: "done",
      target: {
        project: { projectId: "source-project" },
        host: { selector: "source-host", requiredCapabilities: ["subagents"] },
        workspaceMode: "isolated_worktree",
        startingState: { policy: "current_revision" },
        modelSelection: nodeRecord("producer").target.modelSelection,
      },
      reconciliations: [
        {
          resultId: "result-producer-1",
          cancellationId: null,
          attemptId: "attempt-producer",
          inputDigest: "f".repeat(64),
          outcome: "complete",
          fromStatus: "running",
          toStatus: "review",
          acceptedAt: "2026-08-11T12:05:00.000Z",
          acceptedPlanRevision: 2,
          managerReason: "Accepted producer evidence.",
          evidenceContract: evidenceContractRecord([
            {
              id: "producer-to-consumer",
              producerNodeId: "producer",
              consumerNodeId: "consumer",
              deliverableId: "implementation",
              medium: "patch",
              mediaType: "text/x-diff",
            },
          ]),
          evidence: [
            {
              subjectType: "criterion",
              subjectId: "accepted",
              uri: "artifact://run-1/producer/criterion.json",
              digest: `sha256:${"a".repeat(64)}`,
              mediaType: "application/json",
            },
            {
              subjectType: "verification",
              subjectId: "tests",
              uri: "artifact://run-1/producer/tests.txt",
              digest: `sha256:${"b".repeat(64)}`,
              mediaType: "text/plain",
            },
            {
              subjectType: "deliverable",
              subjectId: "implementation",
              uri: "artifact://run-1/producer/implementation.patch",
              digest: `sha256:${"c".repeat(64)}`,
              mediaType: "text/x-diff",
            },
            {
              subjectType: "handoff",
              subjectId: "producer-to-consumer",
              uri: "artifact://run-1/producer/handoff.patch",
              digest: acceptedDigest,
              mediaType: "text/x-diff",
            },
          ],
        },
      ],
    };
    const consumer = {
      ...nodeRecord("consumer", ["producer"]),
      target: {
        project: { projectId: "destination-project" },
        host: {
          selector: "destination-host",
          requiredCapabilities: ["subagents"],
        },
        workspaceMode: "isolated_worktree",
        startingState: { policy: "current_revision" },
        modelSelection: nodeRecord("consumer").target.modelSelection,
      },
    };
    const plan = planRecord([producer, consumer]);
    plan.revision = 2;
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
    const producerAttempt = {
      ...activeAttempt("producer", producer.resourceLocks),
      binding: {
        ...activeAttempt("producer", producer.resourceLocks).binding,
        projectBindingId: "source-binding",
        hostBindingId: "source-host-binding",
      },
      terminationOutcome: "complete",
      nativeLifecycle: "completed",
      terminationHistory: [
        terminationRecord("producer", "complete", "completed"),
      ],
      resultReference: {
        kind: "result",
        id: "result-producer-1",
        acceptedPlanRevision: 2,
      },
    };
    const run = runRecord([producerAttempt]);
    run.planRevision = 2;
    run.projects = [
      {
        ...run.projects[0],
        projectBindingId: "source-binding",
        hostBindingId: "source-host-binding",
        locator: { projectId: "source-project" },
        resolvedRoot: "/tmp/source-project",
      },
      {
        ...run.projects[0],
        projectBindingId: "destination-binding",
        hostBindingId: "destination-host-binding",
        locator: { projectId: "destination-project" },
        resolvedRoot: "/tmp/destination-project",
      },
    ];
    run.hosts = [
      {
        ...run.hosts[0],
        hostBindingId: "source-host-binding",
        selector: "source-host",
        nativeHostId: "native-source",
      },
      {
        ...run.hosts[0],
        hostBindingId: "destination-host-binding",
        selector: "destination-host",
        nativeHostId: "native-destination",
      },
    ];
    run.lineage = [
      {
        lineageId: "lineage-1",
        handoffId: "producer-to-consumer",
        source: {
          nodeId: "producer",
          attemptId: "attempt-producer",
          resultId: "result-producer-1",
          acceptedPlanRevision: 2,
          uri: "artifact://run-1/producer/handoff.patch",
          digest: acceptedDigest,
          mediaType: "text/x-diff",
        },
        destination: {
          nodeId: "consumer",
          attemptId: null,
          projectBindingId: "destination-binding",
        },
      },
    ];
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);
    expect(JSON.parse(stdout).ready).toEqual([
      {
        nodeId: "consumer",
        projectBindingId: "destination-binding",
        hostBindingId: "destination-host-binding",
        placement: "verified",
      },
    ]);

    const consumerAttempt = {
      ...activeAttempt("consumer", consumer.resourceLocks),
      binding: {
        ...activeAttempt("consumer", consumer.resourceLocks).binding,
        projectBindingId: "destination-binding",
        hostBindingId: "destination-host-binding",
      },
    };
    run.attempts.push(consumerAttempt);
    run.lineage[0].destination.attemptId = "attempt-consumer";
    await writeRun(run);
    await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    const acceptedLineage = run.lineage[0];
    run.lineage = [];
    await writeRun(run);
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
        /missing required incoming lineage.*producer-to-consumer/i,
      ),
    });

    run.lineage = [acceptedLineage];
    run.lineage[0].destination.attemptId = "attempt-producer";
    await writeRun(run);
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
      stderr: expect.stringMatching(/lineage destination attempt.*consumer/i),
    });

    run.lineage[0].destination.attemptId = "attempt-consumer";
    run.lineage[0].source.digest = `sha256:${"0".repeat(64)}`;
    await writeRun(run);

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
      stderr: expect.stringMatching(/lineage evidence.*accepted plan/i),
    });

    const handoffEvidence = (
      plan.nodes[0] as any
    ).reconciliations[0].evidence.find(
      (item: any) => item.subjectType === "handoff",
    );
    handoffEvidence.mediaType = "application/json";
    await writePlan(plan);
    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /handoff evidence media type.*declared transport/i,
      ),
    });

    handoffEvidence.mediaType = "text/x-diff";
    (plan.nodes[0] as any).status = "failed";
    (plan.nodes[0] as any).blockingReason = "A later retry failed.";
    (plan.nodes[0] as any).reconciliations.push({
      resultId: "result-producer-2",
      cancellationId: null,
      attemptId: "attempt-producer-2",
      inputDigest: "9".repeat(64),
      outcome: "failed",
      fromStatus: "running",
      toStatus: "failed",
      acceptedAt: "2026-08-11T12:20:00.000Z",
      acceptedPlanRevision: 4,
      managerReason: "A later retry failed.",
      evidenceContract: evidenceContractRecord([
        {
          id: "producer-to-consumer",
          producerNodeId: "producer",
          consumerNodeId: "consumer",
          deliverableId: "implementation",
          medium: "patch",
          mediaType: "text/x-diff",
        },
      ]),
      evidence: [],
    });
    plan.revision = 4;
    run.planRevision = 4;
    const failedProducerAttempt = {
      ...activeAttempt("producer", producer.resourceLocks),
      attemptId: "attempt-producer-2",
      preparedPlanRevision: 3,
      preparedAt: "2026-08-11T12:15:00.000Z",
      binding: {
        ...activeAttempt("producer", producer.resourceLocks).binding,
        projectBindingId: "source-binding",
        hostBindingId: "source-host-binding",
        idempotencyKey: "idempotency-producer-2",
      },
      dispatchState: "accepted",
      terminationOutcome: "failed",
      nativeLifecycle: "failed",
      dispatchHistory: [
        {
          ...activeAttempt("producer", producer.resourceLocks)
            .dispatchHistory[0],
          dispatchId: "dispatch-producer-2",
          nativeLifecycle: "running",
          recordedAt: "2026-08-11T12:16:00.000Z",
        },
      ],
      dispatchTimestamp: "2026-08-11T12:16:00.000Z",
      terminationHistory: [
        {
          terminationId: "termination-producer-2",
          outcome: "failed",
          nativeLifecycle: "failed",
          recordedAt: "2026-08-11T12:18:00.000Z",
        },
      ],
      resultReference: {
        kind: "result",
        id: "result-producer-2",
        acceptedPlanRevision: 4,
      },
    };
    run.attempts = [producerAttempt, failedProducerAttempt];
    run.lineage[0].source.digest = acceptedDigest;
    run.lineage[0].destination.attemptId = null;
    await writePlan(plan);
    await writeRun(run);

    const retained = JSON.parse(
      (
        await execFileAsync("node", [
          scriptPath,
          "ready",
          "--plan",
          planPath,
          "--run",
          runPath,
        ])
      ).stdout,
    );
    expect(retained.blocked).toEqual([
      { nodeId: "consumer", reasons: ["dependency_not_done"] },
      { nodeId: "producer", reasons: ["status_not_ready"] },
    ]);
  });
});
