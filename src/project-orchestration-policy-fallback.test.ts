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
  it("prohibits provider switching until the fallback authorization is recorded", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = exactModelSelection();
    const planPath = await writePlan(plan);
    const discovery = discoveryRecord();
    discovery.hosts[0].modelProfiles = [
      {
        provider: "anthropic",
        model: "claude-opus-4.1",
        reasoningProfiles: ["high"],
      },
      ...discovery.hosts[0].modelProfiles,
    ];
    const discoveryPath = path.join(tmpDir, "discovery.json");
    await fs.writeFile(
      discoveryPath,
      JSON.stringify(discovery, null, 2) + "\n",
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
    const firstPrepare = {
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      planRevision: 1,
      nodeId: "implementation",
      attemptId: "attempt-openai-1",
      projectBindingId: "project-local",
      hostBindingId: "host-local",
      actualCwd: "/tmp/worktrees/openai-1",
      actualWorktree: "/tmp/worktrees/openai-1",
      branch: "codex/openai-1",
      authorizationRef: null,
      preparedAt: "2026-08-11T12:01:00.000Z",
    };
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
        dispatchId: "dispatch-openai-1",
        dispatchState: "accepted",
        nativeIds: run.attempts[0].nativeIds,
        nativeLifecycle: "running",
        recordedAt: "2026-08-11T12:02:00.000Z",
      },
    ];
    run.attempts[0].terminationHistory = [
      {
        terminationId: "termination-openai-1",
        outcome: "failed",
        nativeLifecycle: "failed",
        recordedAt: "2026-08-11T12:02:30.000Z",
      },
    ];
    run.planRevision = 2;
    await fs.writeFile(runPath, JSON.stringify(run, null, 2) + "\n");

    plan.revision = 2;
    plan.nodes[0].target.modelSelection = {
      provider: "anthropic",
      model: "claude-opus-4.1",
      reasoningProfile: "high",
      selectionSource: "manager",
      fallbackAuthorized: false,
      fallbackAuthorizationRef: null,
      fallbackUnresolvedBlockerRef: null,
    };
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
    const secondPrepare = {
      ...firstPrepare,
      planRevision: 2,
      attemptId: "attempt-anthropic-1",
      actualCwd: "/tmp/worktrees/anthropic-1",
      actualWorktree: "/tmp/worktrees/anthropic-1",
      branch: "codex/anthropic-1",
      preparedAt: "2026-08-11T12:03:00.000Z",
    };
    await fs.writeFile(
      preparePath,
      JSON.stringify(secondPrepare, null, 2) + "\n",
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
        /provider switching requires explicit fallback authorization/i,
      ),
    });

    plan.nodes[0].target.modelSelection.fallbackAuthorized = true;
    plan.nodes[0].target.modelSelection.fallbackAuthorizationRef =
      "authorization:provider-fallback-1";
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2) + "\n");
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
      provider: "anthropic",
      model: "claude-opus-4.1",
    });
  });

  it("rejects lifecycle state that was not produced by recorded lifecycle events", async () => {
    const { planPath, runPath } = await initializePreparedRun();
    const run = JSON.parse(await fs.readFile(runPath, "utf8"));
    run.attempts[0].dispatchState = "accepted";
    run.attempts[0].nativeLifecycle = "running";
    run.attempts[0].dispatchTimestamp = "2026-08-11T12:02:00.000Z";
    await fs.writeFile(runPath, JSON.stringify(run, null, 2) + "\n");

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
      stderr: expect.stringMatching(
        /accepted dispatch requires recorded dispatch history/i,
      ),
    });
  });

  it("allows provider fallback to be authorized by a documented unresolved blocker", async () => {
    const plan = planRecord();
    plan.nodes[0].target.modelSelection = {
      ...exactModelSelection(),
      fallbackAuthorized: true,
      fallbackAuthorizationRef: null,
      fallbackUnresolvedBlockerRef: "blocker:provider-outage-1",
    };
    const planPath = await writePlan(plan);

    const validated = await execFileAsync("node", [
      scriptPath,
      "validate",
      "--plan",
      planPath,
    ]);
    expect(JSON.parse(validated.stdout).valid).toBe(true);
  });
});
