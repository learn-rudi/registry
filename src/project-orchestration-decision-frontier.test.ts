import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cleanupTmpDir,
  crypto,
  execFileAsync,
  fs,
  nodeRecord,
  planRecord,
  scriptPath,
  setupTmpDir,
  writeInput,
  writePlan,
} from "./project-orchestration.test.helpers";

beforeEach(setupTmpDir);
afterEach(cleanupTmpDir);

function openFrontierPlan() {
  return {
    ...planRecord([nodeRecord("existing")]),
    schemaVersion: 2,
    decisionFrontier: {
      initiativeObjective: "Establish a coherent RUDI engineering lifecycle.",
      revision: 1,
      areas: [
        {
          id: "delivery-authority",
          question: "Which workflow owns durable execution state?",
          status: "open",
          resolution: null,
          decisionIds: [],
          approvalRef: null,
          decidedAt: null,
        },
      ],
      decisions: [
        {
          id: "single-orchestrator",
          question: "Should discovery create a second orchestrator?",
          recommendation: "Keep Chief of Staff authoritative.",
          resolution: null,
          status: "proposed",
          approvalRef: null,
          decidedAt: null,
        },
      ],
      promotions: [],
    },
  };
}

function closedFrontierPlan() {
  const plan = openFrontierPlan();
  const decision = {
    ...plan.decisionFrontier.decisions[0],
    resolution: "Chief of Staff remains the only durable orchestrator.",
    status: "accepted",
    approvalRef: "human:architecture-approval",
    decidedAt: "2026-08-31T20:00:00.000Z",
  };
  return {
    ...plan,
    decisionFrontier: {
      ...plan.decisionFrontier,
      areas: [
        {
          ...plan.decisionFrontier.areas[0],
          status: "resolved",
          resolution: "Use one authoritative plan and bounded projections.",
          decisionIds: [decision.id],
          decidedAt: "2026-08-31T20:00:00.000Z",
        },
      ],
      decisions: [decision],
    },
  };
}

function sha256(value: unknown) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function promotedNode(id: string) {
  return {
    ...nodeRecord(id),
    status: "proposed",
    blockingReason: "Waiting for ordinary readiness checks after promotion.",
  };
}

function promotionInput(
  plan: ReturnType<typeof closedFrontierPlan>,
  promotionId: string,
  nodeId: string,
  promotedAt = "2026-08-31T20:05:00.000Z"
) {
  return {
    schemaVersion: 1,
    projectId: plan.projectId,
    runId: plan.runId,
    promotionId,
    expectedPlanRevision: plan.revision,
    expectedFrontierRevision: plan.decisionFrontier.revision,
    areaBindings: plan.decisionFrontier.areas.map((area) => ({
      areaId: area.id,
      digest: sha256(area),
    })),
    decisionBindings: plan.decisionFrontier.decisions.map((decision) => ({
      decisionId: decision.id,
      digest: sha256(decision),
    })),
    approvalRef: `human:${promotionId}`,
    implementationAuthorizationRef: "user:set-goal-and-execute",
    promotedAt,
    nodes: [promotedNode(nodeId)],
  };
}

function sourceFrontierDigest(
  plan: ReturnType<typeof closedFrontierPlan>,
  sourceRevision = plan.decisionFrontier.revision
) {
  return sha256({
    initiativeObjective: plan.decisionFrontier.initiativeObjective,
    revision: sourceRevision,
    areas: [...plan.decisionFrontier.areas].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    ),
    decisions: [...plan.decisionFrontier.decisions].sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    ),
  });
}

describe("Decision Frontier plan contract", () => {
  it("validates explicit open discovery state without treating it as execution readiness", async () => {
    const planPath = await writePlan(openFrontierPlan());

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "validate",
      "--plan",
      planPath,
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      valid: true,
      projectId: "demo-project",
      runId: "run-1",
    });
  });

  it("promotes one accepted frontier snapshot exactly once", async () => {
    const plan = closedFrontierPlan();
    const planPath = await writePlan(plan);
    const promotedNode = {
      ...nodeRecord("build-lifecycle"),
      status: "proposed",
      blockingReason: "Waiting for ordinary readiness checks after promotion.",
    };
    const decision = plan.decisionFrontier.decisions[0];
    const inputPath = await writeInput("promotion.json", {
      schemaVersion: 1,
      projectId: plan.projectId,
      runId: plan.runId,
      promotionId: "promotion-lifecycle-v1",
      expectedPlanRevision: plan.revision,
      expectedFrontierRevision: plan.decisionFrontier.revision,
      areaBindings: plan.decisionFrontier.areas.map((area) => ({
        areaId: area.id,
        digest: sha256(area),
      })),
      decisionBindings: [
        {
          decisionId: decision.id,
          digest: `sha256:${crypto
            .createHash("sha256")
            .update(JSON.stringify(decision))
            .digest("hex")}`,
        },
      ],
      approvalRef: "human:promote-lifecycle",
      implementationAuthorizationRef: "user:set-goal-and-execute",
      promotedAt: "2026-08-31T20:05:00.000Z",
      nodes: [promotedNode],
    });

    const first = await execFileAsync("node", [
      scriptPath,
      "promote",
      "--plan",
      planPath,
      "--input",
      inputPath,
    ]);
    expect(JSON.parse(first.stdout)).toMatchObject({
      promoted: true,
      promotionId: "promotion-lifecycle-v1",
      createdNodeIds: ["build-lifecycle"],
      idempotent: false,
    });

    const afterFirst = await fs.readFile(planPath, "utf8");
    const updated = JSON.parse(afterFirst);
    expect(updated).toMatchObject({
      schemaVersion: 2,
      revision: 2,
      decisionFrontier: {
        revision: 2,
        promotions: [
          {
            promotionId: "promotion-lifecycle-v1",
            sourcePlanRevision: 1,
            sourceFrontierRevision: 1,
            sourceFrontierDigest: sourceFrontierDigest(plan),
            areaBindings: [
              {
                areaId: plan.decisionFrontier.areas[0].id,
                digest: sha256(plan.decisionFrontier.areas[0]),
              },
            ],
            createdNodeIds: ["build-lifecycle"],
            acceptedPlanRevision: 2,
          },
        ],
      },
    });
    expect(updated.nodes.map((node: { id: string }) => node.id)).toEqual([
      "existing",
      "build-lifecycle",
    ]);

    const replay = await execFileAsync("node", [
      scriptPath,
      "promote",
      "--plan",
      planPath,
      "--input",
      inputPath,
    ]);
    expect(JSON.parse(replay.stdout)).toMatchObject({
      promoted: true,
      promotionId: "promotion-lifecycle-v1",
      idempotent: true,
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(afterFirst);
  });

  it("rejects promotion while a required area remains open without mutating the plan", async () => {
    const plan = closedFrontierPlan();
    plan.decisionFrontier.areas = openFrontierPlan().decisionFrontier.areas;
    const planPath = await writePlan(plan);
    const before = await fs.readFile(planPath, "utf8");
    const decision = plan.decisionFrontier.decisions[0];
    const inputPath = await writeInput("open-promotion.json", {
      schemaVersion: 1,
      projectId: plan.projectId,
      runId: plan.runId,
      promotionId: "promotion-open-frontier",
      expectedPlanRevision: plan.revision,
      expectedFrontierRevision: plan.decisionFrontier.revision,
      areaBindings: plan.decisionFrontier.areas.map((area) => ({
        areaId: area.id,
        digest: sha256(area),
      })),
      decisionBindings: [
        {
          decisionId: decision.id,
          digest: `sha256:${crypto
            .createHash("sha256")
            .update(JSON.stringify(decision))
            .digest("hex")}`,
        },
      ],
      approvalRef: "human:promote-open-frontier",
      implementationAuthorizationRef: "user:set-goal-and-execute",
      promotedAt: "2026-08-31T20:05:00.000Z",
      nodes: [
        {
          ...nodeRecord("must-not-exist"),
          status: "proposed",
          blockingReason: "Must remain absent while discovery is open.",
        },
      ],
    });

    await expect(
      execFileAsync("node", [
        scriptPath,
        "promote",
        "--plan",
        planPath,
        "--input",
        inputPath,
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unresolved area.*closed/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("fails closed when a promotion ID is reused with different input", async () => {
    const plan = closedFrontierPlan();
    const planPath = await writePlan(plan);
    const decision = plan.decisionFrontier.decisions[0];
    const input = {
      schemaVersion: 1,
      projectId: plan.projectId,
      runId: plan.runId,
      promotionId: "promotion-conflict",
      expectedPlanRevision: plan.revision,
      expectedFrontierRevision: plan.decisionFrontier.revision,
      areaBindings: plan.decisionFrontier.areas.map((area) => ({
        areaId: area.id,
        digest: sha256(area),
      })),
      decisionBindings: [
        {
          decisionId: decision.id,
          digest: `sha256:${crypto
            .createHash("sha256")
            .update(JSON.stringify(decision))
            .digest("hex")}`,
        },
      ],
      approvalRef: "human:promote-conflict",
      implementationAuthorizationRef: "user:set-goal-and-execute",
      promotedAt: "2026-08-31T20:05:00.000Z",
      nodes: [
        {
          ...nodeRecord("conflict-node"),
          status: "proposed",
          blockingReason: "Waiting for readiness.",
        },
      ],
    };
    const inputPath = await writeInput("conflict-promotion.json", input);
    await execFileAsync("node", [
      scriptPath,
      "promote",
      "--plan",
      planPath,
      "--input",
      inputPath,
    ]);
    const beforeConflict = await fs.readFile(planPath, "utf8");
    await fs.writeFile(
      inputPath,
      JSON.stringify({ ...input, promotedAt: "2026-08-31T20:06:00.000Z" })
    );

    await expect(
      execFileAsync("node", [
        scriptPath,
        "promote",
        "--plan",
        planPath,
        "--input",
        inputPath,
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/conflicting duplicate promotion id/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(beforeConflict);
  });

  it("serializes concurrent promotions so exactly one current revision is accepted", async () => {
    const plan = closedFrontierPlan();
    const planPath = await writePlan(plan);
    const firstInput = await writeInput(
      "concurrent-first.json",
      promotionInput(plan, "promotion-concurrent-first", "concurrent-first")
    );
    const secondInput = await writeInput(
      "concurrent-second.json",
      promotionInput(plan, "promotion-concurrent-second", "concurrent-second")
    );

    const results = await Promise.allSettled(
      [firstInput, secondInput].map((inputPath) =>
        execFileAsync("node", [
          scriptPath,
          "promote",
          "--plan",
          planPath,
          "--input",
          inputPath,
        ])
      )
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      (results.find((result) => result.status === "rejected") as PromiseRejectedResult)
        .reason.stderr
    ).toMatch(/expected revisions are stale/i);

    const updated = JSON.parse(await fs.readFile(planPath, "utf8"));
    expect(updated.revision).toBe(plan.revision + 1);
    expect(updated.decisionFrontier.promotions).toHaveLength(1);
    expect(
      updated.nodes.filter((node: { id: string }) =>
        ["concurrent-first", "concurrent-second"].includes(node.id)
      )
    ).toHaveLength(1);
  });

  it("rejects a promotion timestamp that predates an accepted frontier outcome", async () => {
    const plan = closedFrontierPlan();
    const planPath = await writePlan(plan);
    const before = await fs.readFile(planPath, "utf8");
    const inputPath = await writeInput(
      "early-promotion.json",
      promotionInput(
        plan,
        "promotion-before-approval",
        "must-not-promote-early",
        "2026-08-31T19:59:59.000Z"
      )
    );

    await expect(
      execFileAsync("node", [
        scriptPath,
        "promote",
        "--plan",
        planPath,
        "--input",
        inputPath,
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/promotion timestamp.*approval/i),
    });
    expect(await fs.readFile(planPath, "utf8")).toBe(before);
  });

  it("rejects mutation of an accepted deferral after it has been promoted", async () => {
    const plan = closedFrontierPlan();
    plan.decisionFrontier.areas.push({
      id: "future-retention",
      question: "When will the retention policy be implemented?",
      status: "accepted_deferral",
      resolution: "Defer for thirty days.",
      decisionIds: [],
      approvalRef: "human:deferral-approval",
      decidedAt: "2026-08-31T20:01:00.000Z",
    });
    const planPath = await writePlan(plan);
    const inputPath = await writeInput(
      "deferral-promotion.json",
      promotionInput(plan, "promotion-with-deferral", "build-after-deferral")
    );
    await execFileAsync("node", [
      scriptPath,
      "promote",
      "--plan",
      planPath,
      "--input",
      inputPath,
    ]);

    const mutated = JSON.parse(await fs.readFile(planPath, "utf8"));
    mutated.decisionFrontier.areas.find(
      (area: { id: string }) => area.id === "future-retention"
    ).resolution = "Defer indefinitely.";
    await fs.writeFile(planPath, JSON.stringify(mutated, null, 2) + "\n");

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/area digest does not match/i),
    });
  });

  it("rejects a promotion revision already claimed by reconciliation history", async () => {
    const plan = closedFrontierPlan();
    plan.decisionFrontier.promotions = [
      {
        promotionId: "promotion-revision-collision",
        inputDigest: `sha256:${"a".repeat(64)}`,
        sourcePlanRevision: 1,
        sourceFrontierRevision: 1,
        sourceFrontierDigest: sourceFrontierDigest(plan),
        areaBindings: plan.decisionFrontier.areas.map((area) => ({
          areaId: area.id,
          digest: sha256(area),
        })),
        decisionBindings: [
          {
            decisionId: plan.decisionFrontier.decisions[0].id,
            digest: sha256(plan.decisionFrontier.decisions[0]),
          },
        ],
        approvalRef: "human:promotion-revision-collision",
        implementationAuthorizationRef: "user:set-goal-and-execute",
        promotedAt: "2026-08-31T20:05:00.000Z",
        createdNodeIds: ["existing"],
        acceptedPlanRevision: 2,
      },
    ];
    plan.decisionFrontier.revision = 2;
    plan.revision = 2;
    plan.nodes[0].reconciliations = [
      {
        resultId: "result-collision",
        cancellationId: null,
        attemptId: "attempt-collision",
        inputDigest: "b".repeat(64),
        outcome: "complete",
        fromStatus: "running",
        toStatus: "review",
        acceptedAt: "2026-08-31T20:06:00.000Z",
        acceptedPlanRevision: 2,
        managerReason: "This record deliberately collides with the promotion revision.",
        evidenceContract: {
          criteria: ["criterion"],
          verifications: ["verification"],
          deliverables: [
            { id: "implementation", mediaTypes: ["text/x-diff"] },
          ],
          handoffs: [],
        },
        evidence: [
          {
            subjectType: "criterion",
            subjectId: "criterion",
            uri: "artifact://collision/criterion",
            digest: `sha256:${"c".repeat(64)}`,
            mediaType: "text/plain",
          },
          {
            subjectType: "verification",
            subjectId: "verification",
            uri: "artifact://collision/verification",
            digest: `sha256:${"d".repeat(64)}`,
            mediaType: "text/plain",
          },
          {
            subjectType: "deliverable",
            subjectId: "implementation",
            uri: "artifact://collision/implementation",
            digest: `sha256:${"e".repeat(64)}`,
            mediaType: "text/x-diff",
          },
        ],
      },
    ];
    plan.nodes[0].status = "review";
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate accepted plan revision/i),
    });
  });
});
