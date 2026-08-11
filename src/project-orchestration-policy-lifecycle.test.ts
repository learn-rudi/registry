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
  it("records an accepted dispatch without allowing lifecycle overwrite", async () => {
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

    const dispatchPath = path.join(tmpDir, "dispatch.json");
    const dispatch = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      dispatchId: "dispatch-1",
      attemptId: "attempt-implementation-1",
      dispatchState: "accepted",
      nativeIds: {
        savedProjectId: "registry",
        hostId: "codex-desktop",
        agentId: "agent-1",
        taskId: null,
        threadId: null,
      },
      nativeLifecycle: "running",
      recordedAt: "2026-08-11T12:02:00.000Z",
    };
    await fs.writeFile(dispatchPath, JSON.stringify(dispatch, null, 2) + "\n");
    const recorded = await execFileAsync("node", [
      scriptPath,
      "record-dispatch",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      dispatchPath,
    ]);
    expect(JSON.parse(recorded.stdout)).toMatchObject({
      attemptId: "attempt-implementation-1",
      dispatchState: "accepted",
      idempotent: false,
    });
    const duplicate = await execFileAsync("node", [
      scriptPath,
      "record-dispatch",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      dispatchPath,
    ]);
    expect(JSON.parse(duplicate.stdout).idempotent).toBe(true);

    dispatch.dispatchState = "route_failed";
    dispatch.dispatchId = "dispatch-2";
    await fs.writeFile(dispatchPath, JSON.stringify(dispatch, null, 2) + "\n");
    await expect(
      execFileAsync("node", [
        scriptPath,
        "record-dispatch",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        dispatchPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/cannot change accepted dispatch/i),
    });
  });

  it("records native termination once and preserves the terminal outcome", async () => {
    const { planPath, runPath } = await initializePreparedRun();
    const dispatchPath = path.join(tmpDir, "dispatch.json");
    await fs.writeFile(
      dispatchPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectId: "demo-project",
          runId: "run-1",
          planRevision: 1,
          dispatchId: "dispatch-1",
          attemptId: "attempt-implementation-1",
          dispatchState: "accepted",
          nativeIds: {
            savedProjectId: "registry",
            hostId: "codex-desktop",
            agentId: "agent-1",
            taskId: null,
            threadId: null,
          },
          nativeLifecycle: "running",
          recordedAt: "2026-08-11T12:02:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );
    await execFileAsync("node", [
      scriptPath,
      "record-dispatch",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      dispatchPath,
    ]);

    const terminationPath = path.join(tmpDir, "termination.json");
    const termination = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      terminationId: "termination-1",
      attemptId: "attempt-implementation-1",
      outcome: "failed",
      nativeLifecycle: "failed",
      recordedAt: "2026-08-11T12:03:00.000Z",
    };
    await fs.writeFile(
      terminationPath,
      JSON.stringify(termination, null, 2) + "\n",
    );
    const recorded = await execFileAsync("node", [
      scriptPath,
      "record-termination",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      terminationPath,
    ]);
    expect(JSON.parse(recorded.stdout)).toMatchObject({
      attemptId: "attempt-implementation-1",
      terminationOutcome: "failed",
      idempotent: false,
    });
    const duplicate = await execFileAsync("node", [
      scriptPath,
      "record-termination",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      terminationPath,
    ]);
    expect(JSON.parse(duplicate.stdout).idempotent).toBe(true);

    termination.terminationId = "termination-2";
    termination.outcome = "complete";
    termination.recordedAt = "2026-08-11T12:04:00.000Z";
    await fs.writeFile(
      terminationPath,
      JSON.stringify(termination, null, 2) + "\n",
    );
    await expect(
      execFileAsync("node", [
        scriptPath,
        "record-termination",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        terminationPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/termination already recorded/i),
    });
  });

  it("records steering delivery state without rewriting a terminal steering decision", async () => {
    const { planPath, runPath } = await initializePreparedRun();
    const dispatchPath = path.join(tmpDir, "dispatch.json");
    await fs.writeFile(
      dispatchPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectId: "demo-project",
          runId: "run-1",
          planRevision: 1,
          dispatchId: "dispatch-1",
          attemptId: "attempt-implementation-1",
          dispatchState: "accepted",
          nativeIds: {
            savedProjectId: "registry",
            hostId: "codex-desktop",
            agentId: "agent-1",
            taskId: null,
            threadId: null,
          },
          nativeLifecycle: "running",
          recordedAt: "2026-08-11T12:02:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );
    await execFileAsync("node", [
      scriptPath,
      "record-dispatch",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      dispatchPath,
    ]);

    const steeringPath = path.join(tmpDir, "steering.json");
    const steering = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      attemptId: "attempt-implementation-1",
      steeringId: "steering-1",
      payloadDigest: `sha256:${"a".repeat(64)}`,
      state: "pending",
      recordedAt: "2026-08-11T12:03:00.000Z",
    };
    await fs.writeFile(steeringPath, JSON.stringify(steering, null, 2) + "\n");
    const pending = await execFileAsync("node", [
      scriptPath,
      "record-steering",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      steeringPath,
    ]);
    expect(JSON.parse(pending.stdout)).toMatchObject({
      steeringId: "steering-1",
      state: "pending",
    });

    steering.state = "delivered";
    steering.recordedAt = "2026-08-11T12:04:00.000Z";
    await fs.writeFile(steeringPath, JSON.stringify(steering, null, 2) + "\n");
    const delivered = await execFileAsync("node", [
      scriptPath,
      "record-steering",
      "--plan",
      planPath,
      "--run",
      runPath,
      "--input",
      steeringPath,
    ]);
    expect(JSON.parse(delivered.stdout)).toMatchObject({
      steeringId: "steering-1",
      state: "delivered",
    });

    steering.state = "rejected";
    steering.recordedAt = "2026-08-11T12:05:00.000Z";
    await fs.writeFile(steeringPath, JSON.stringify(steering, null, 2) + "\n");
    await expect(
      execFileAsync("node", [
        scriptPath,
        "record-steering",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        steeringPath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/terminal steering state/i),
    });
  });

  it("refuses to record archive state before archive eligibility is proven", async () => {
    const { planPath, runPath } = await initializePreparedRun();
    const archivePath = path.join(tmpDir, "archive.json");
    await fs.writeFile(
      archivePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          projectId: "demo-project",
          runId: "run-1",
          planRevision: 1,
          archiveId: "archive-1",
          attemptId: "attempt-implementation-1",
          state: "archived",
          recordedAt: "2026-08-11T12:02:00.000Z",
        },
        null,
        2,
      ) + "\n",
    );

    await expect(
      execFileAsync("node", [
        scriptPath,
        "record-archive",
        "--plan",
        planPath,
        "--run",
        runPath,
        "--input",
        archivePath,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/archive eligibility.*not.*proven/i),
    });
  });
});
