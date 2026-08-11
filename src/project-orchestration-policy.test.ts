import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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
  setupTmpDir,
  cleanupTmpDir,
} from "./project-orchestration-policy.test.helpers";

beforeEach(setupTmpDir);
afterEach(cleanupTmpDir);

describe("project orchestration runtime policy", () => {
  it("requires an exact provider, model, reasoning profile, and selection source for model-backed work", async () => {
    const planPath = await writePlan(planRecord());

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/exact model selection.*required/i),
    });
  });

  it("initializes and validates canonical durable run transport before dispatch", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    const planPath = await writePlan(plan);
    const discoveryPath = path.join(tmpDir, "discovery.json");
    await fs.writeFile(
      discoveryPath,
      JSON.stringify(discoveryRecord(), null, 2) + "\n",
    );
    const runPath = path.join(tmpDir, ".rudi/orchestration/runs/run-1.json");

    const initialized = await execFileAsync("node", [
      scriptPath,
      "run-init",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      discoveryPath,
    ]);
    expect(JSON.parse(initialized.stdout)).toMatchObject({
      initialized: true,
      projectId: "demo-project",
      runId: "run-1",
    });

    const validated = await execFileAsync("node", [
      scriptPath,
      "validate-run",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);
    expect(JSON.parse(validated.stdout)).toEqual({
      valid: true,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
    });
  });

  it("prepares an exact immutable model binding only after durable run activation", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    const planPath = await writePlan(plan);
    const discoveryPath = path.join(tmpDir, "discovery.json");
    await fs.writeFile(
      discoveryPath,
      JSON.stringify(discoveryRecord(), null, 2) + "\n",
    );
    const runPath = path.join(tmpDir, ".rudi/orchestration/runs/run-1.json");
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

    await expect(
      execFileAsync("node", [
        scriptPath,
        "prepare",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        preparePath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /durable run.*initialized.*before prepare/i,
      ),
    });

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
    const prepared = await execFileAsync("node", [
      scriptPath,
      "prepare",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      preparePath,
    ]);
    expect(JSON.parse(prepared.stdout)).toMatchObject({
      prepared: true,
      nodeId: "implementation",
      attemptId: "attempt-implementation-1",
      provider: "openai",
      model: "gpt-5.6-sol",
      reasoningProfile: "high",
      idempotent: false,
    });
    const duplicate = await execFileAsync("node", [
      scriptPath,
      "prepare",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      preparePath,
    ]);
    expect(JSON.parse(duplicate.stdout).idempotent).toBe(true);

    const run = JSON.parse(await fs.readFile(runPath, "utf8"));
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0]).toMatchObject({
      dispatchState: "prepared",
      preparedAt: "2026-08-11T12:01:00.000Z",
      binding: {
        modelSelection: exactModelSelection(),
        resourceLocks: ["files:implementation"],
      },
    });
  });

  it("requires a first-class resource envelope with default soft checkpoints", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    delete plan.resourceEnvelope;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/resourceEnvelope is required/i),
    });
  });

  it("requires a bounded review policy with one independent review and one confirmation by default", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    plan.reviewPolicy = undefined;
    const planPath = await writePlan(plan);

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/reviewPolicy is required/i),
    });
  });

  it("stops a second independent review pass unless an exception is recorded", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    plan.nodes[0].review = {
      kind: "independent",
      sequence: 1,
      authorizationRef: null,
      unresolvedBlockerRef: null,
    };
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

    const firstPrepare = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      nodeId: "implementation",
      attemptId: "attempt-review-1",
      projectBindingId: "project-local",
      hostBindingId: "host-local",
      actualCwd: "/tmp/worktrees/review-1",
      actualWorktree: "/tmp/worktrees/review-1",
      branch: "codex/review-1",
      authorizationRef: null,
      preparedAt: "2026-08-11T12:01:00.000Z",
    };
    const preparePath = path.join(tmpDir, "prepare.json");
    await fs.writeFile(
      preparePath,
      JSON.stringify(firstPrepare, null, 2) + "\n",
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

    const run = JSON.parse(await fs.readFile(runPath, "utf8"));
    run.attempts[0].dispatchState = "accepted";
    run.attempts[0].terminationOutcome = "failed";
    run.attempts[0].nativeLifecycle = "failed";
    run.attempts[0].dispatchTimestamp = "2026-08-11T12:02:00.000Z";
    run.attempts[0].dispatchHistory = [
      {
        dispatchId: "dispatch-review-1",
        dispatchState: "accepted",
        nativeIds: run.attempts[0].nativeIds,
        nativeLifecycle: "running",
        recordedAt: "2026-08-11T12:02:00.000Z",
      },
    ];
    run.attempts[0].terminationHistory = [
      {
        terminationId: "termination-review-1",
        outcome: "failed",
        nativeLifecycle: "failed",
        recordedAt: "2026-08-11T12:02:30.000Z",
      },
    ];
    await fs.writeFile(runPath, JSON.stringify(run, null, 2) + "\n");

    await fs.writeFile(
      preparePath,
      JSON.stringify(
        {
          ...firstPrepare,
          attemptId: "attempt-review-2",
          actualCwd: "/tmp/worktrees/review-2",
          actualWorktree: "/tmp/worktrees/review-2",
          branch: "codex/review-2",
          preparedAt: "2026-08-11T12:03:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );
    await expect(
      execFileAsync("node", [
        scriptPath,
        "prepare",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        preparePath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/independent review pass limit/i),
    });
  });

  it("persists a soft-checkpoint pause and blocks further preparation", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    plan.resourceEnvelope = {
      maxElapsedSeconds: 3600,
      maxTokens: 200000,
      softCheckpointElapsedSeconds: 1800,
      softCheckpointTokens: 100,
    };
    plan.nodes.push({
      ...nodeRecord(),
      id: "follow-up",
      title: "Follow-up",
      objective: "Complete the bounded follow-up.",
      owner: "follow-up-owner",
      resourceLocks: ["files:follow-up"],
      target: {
        ...nodeRecord().target,
        modelSelection: exactModelSelection(),
      },
    });
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

    const usagePath = path.join(tmpDir, "usage.json");
    const usage = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      usageId: "usage-checkpoint-1",
      attemptId: "attempt-implementation-1",
      elapsedSeconds: 60,
      inputTokens: 70,
      outputTokens: 30,
      totalTokens: 100,
      reportedAt: "2026-08-11T12:02:00.000Z",
      source: "host",
      decision: "continue",
      authorizationRef: null,
    };
    await fs.writeFile(usagePath, JSON.stringify(usage, null, 2) + "\n");
    await expect(
      execFileAsync("node", [
        scriptPath,
        "record-usage",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        usagePath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /soft resource checkpoint.*pause.*authorized continuation/i,
      ),
    });

    usage.decision = "pause";
    await fs.writeFile(usagePath, JSON.stringify(usage, null, 2) + "\n");
    const paused = await execFileAsync("node", [
      scriptPath,
      "record-usage",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      usagePath,
    ]);
    expect(JSON.parse(paused.stdout)).toMatchObject({
      usageId: "usage-checkpoint-1",
      decision: "pause",
      pauseRequired: true,
    });

    await fs.writeFile(
      preparePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectId: "demo-project",
          runId: "run-1",
          planRevision: 1,
          nodeId: "follow-up",
          attemptId: "attempt-follow-up-1",
          projectBindingId: "project-local",
          hostBindingId: "host-local",
          actualCwd: "/tmp/worktrees/follow-up",
          actualWorktree: "/tmp/worktrees/follow-up",
          branch: "codex/follow-up",
          authorizationRef: null,
          preparedAt: "2026-08-11T12:03:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );
    await expect(
      execFileAsync("node", [
        scriptPath,
        "prepare",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        preparePath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/run is paused by resource policy/i),
    });
  });
});
