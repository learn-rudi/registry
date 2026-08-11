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
  it("initializes the portable layout and ignores run transport by default", async () => {
    await execFileAsync("node", [
      scriptPath,
      "init",
      "--root",
      tmpDir,
      "--project-id",
      "demo-project",
      "--run-id",
      "run-1",
      "--objective",
      "Coordinate the demo project.",
    ]);

    const orchestrationRoot = path.join(tmpDir, ".rudi/orchestration");
    const [plan, decisions, graph, ignore] = await Promise.all([
      fs.readFile(path.join(orchestrationRoot, "plan.json"), "utf8"),
      fs.readFile(path.join(orchestrationRoot, "decisions.json"), "utf8"),
      fs.readFile(path.join(orchestrationRoot, "graph.mmd"), "utf8"),
      fs.readFile(path.join(orchestrationRoot, ".gitignore"), "utf8"),
    ]);

    expect(JSON.parse(plan)).toEqual({
      schemaVersion: 1,
      projectId: "demo-project",
      runId: "run-1",
      revision: 1,
      objective: "Coordinate the demo project.",
      requestedMaxParallel: 1,
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
      nodes: [],
      handoffs: [],
    });
    expect(JSON.parse(decisions)).toEqual({
      schemaVersion: 1,
      projectId: "demo-project",
      decisions: [],
    });
    expect(graph).toBe("flowchart TD\n");
    expect(ignore).toBe("runs/\n");
  });

  it("rejects a symlinked init ancestor before creating external state", async () => {
    const projectRoot = path.join(tmpDir, "project");
    const outsideRoot = path.join(tmpDir, "outside");
    await fs.mkdir(projectRoot);
    await fs.mkdir(outsideRoot);
    await fs.symlink(outsideRoot, path.join(projectRoot, ".rudi"));

    await expect(
      execFileAsync("node", [
        scriptPath,
        "init",
        "--root",
        projectRoot,
        "--project-id",
        "demo-project",
        "--run-id",
        "run-1",
        "--objective",
        "Coordinate the demo project.",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/symlinked orchestration ancestor/i),
    });
    await expect(
      fs.access(path.join(outsideRoot, "orchestration")),
    ).rejects.toThrow();
  });

  it("rejects an unsafe max-parallel value before creating project state", async () => {
    await expect(
      execFileAsync("node", [
        scriptPath,
        "init",
        "--root",
        tmpDir,
        "--project-id",
        "demo-project",
        "--run-id",
        "run-1",
        "--objective",
        "Coordinate the demo project.",
        "--max-parallel",
        "999999999999999999999999999999999999999999999999999999999999",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/positive safe integer/i),
    });
    await expect(fs.access(path.join(tmpDir, ".rudi"))).rejects.toThrow();
  });

  it("refuses init when retained run transport already exists", async () => {
    const runsRoot = path.join(tmpDir, ".rudi/orchestration/runs");
    await fs.mkdir(runsRoot, { recursive: true });
    await fs.writeFile(path.join(runsRoot, "retained.json"), "{}\n");

    await expect(
      execFileAsync("node", [
        scriptPath,
        "init",
        "--root",
        tmpDir,
        "--project-id",
        "demo-project",
        "--run-id",
        "run-1",
        "--objective",
        "Coordinate the demo project.",
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/existing orchestration state/i),
    });
    await expect(
      fs.access(path.join(tmpDir, ".rudi/orchestration/plan.json")),
    ).rejects.toThrow();
  });

  it("rejects plan files outside the canonical orchestration layout", async () => {
    const planPath = path.join(tmpDir, "plan.json");
    await fs.writeFile(
      planPath,
      JSON.stringify(planRecord([nodeRecord("task-a")]), null, 2) + "\n",
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /canonical.*\.rudi\/orchestration\/plan\.json/i,
      ),
    });
  });

  it("rejects run files outside the canonical runs layout", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const runPath = path.join(tmpDir, "run-1.json");
    await fs.writeFile(runPath, JSON.stringify(runRecord(), null, 2) + "\n");

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
      stderr: expect.stringMatching(/canonical.*\.rudi\/orchestration\/runs/i),
    });
  });

  it("rejects a canonical run path owned by a different manager project", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const otherRoot = path.join(
      tmpDir,
      "other-project",
      ".rudi/orchestration/runs",
    );
    await fs.mkdir(otherRoot, { recursive: true });
    const runPath = path.join(otherRoot, "run-1.json");
    await fs.writeFile(runPath, JSON.stringify(runRecord(), null, 2) + "\n");

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
      stderr: expect.stringMatching(/run.*same manager project.*plan/i),
    });
  });

  it("rejects duplicate node IDs", async () => {
    const planPath = await writePlan(
      planRecord([nodeRecord("duplicate"), nodeRecord("duplicate")]),
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate node id/i),
    });
  });

  it("rejects missing dependencies", async () => {
    const planPath = await writePlan(
      planRecord([nodeRecord("consumer", ["missing-producer"])]),
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/missing dependency/i),
    });
  });

  it("rejects duplicate dependencies in a node contract", async () => {
    const planPath = await writePlan(
      planRecord([
        nodeRecord("producer"),
        nodeRecord("consumer", ["producer", "producer"]),
      ]),
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate dependency producer.*consumer/i),
    });
  });

  it("rejects dependency cycles", async () => {
    const planPath = await writePlan(
      planRecord([
        nodeRecord("task-a", ["task-b"]),
        nodeRecord("task-b", ["task-a"]),
      ]),
    );

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/dependency cycle/i),
    });
  });

  it("rejects native transport fields in portable nodes", async () => {
    const node = { ...nodeRecord("task-a"), nativeTaskId: "thread-private" };
    const planPath = await writePlan(planRecord([node]));

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unknown node field: nativeTaskId/i),
    });
  });

  it("rejects portable scope paths that escape the target project", async () => {
    const node = { ...nodeRecord("task-a"), allowedScope: ["../outside/**"] };
    const planPath = await writePlan(planRecord([node]));

    await expect(
      execFileAsync("node", [scriptPath, "validate", "--plan", planPath]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/unsafe portable path/i),
    });
  });

  it("calculates static readiness from dependency state in lexical order", async () => {
    const waiting = {
      ...nodeRecord("waiting"),
      status: "waiting",
      blockingReason: "busy",
    };
    const planPath = await writePlan(
      planRecord([
        nodeRecord("producer"),
        nodeRecord("consumer", ["producer"]),
        nodeRecord("independent"),
        waiting,
      ]),
    );

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      mode: "static",
      planRevision: 1,
      ready: [
        { nodeId: "independent", placement: "unverified" },
        { nodeId: "producer", placement: "unverified" },
      ],
      blocked: [
        { nodeId: "consumer", reasons: ["dependency_not_done"] },
        { nodeId: "waiting", reasons: ["status_not_ready"] },
      ],
    });
  });

  it("orders portable IDs by code units rather than host locale", async () => {
    const planPath = await writePlan(
      planRecord([
        nodeRecord("task_a"),
        nodeRecord("task.a"),
        nodeRecord("task-a"),
      ]),
    );

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
    ]);

    expect(JSON.parse(stdout).ready.map((item: any) => item.nodeId)).toEqual([
      "task-a",
      "task.a",
      "task_a",
    ]);
  });

  it("blocks a run-aware candidate whose resource lock is active", async () => {
    const active = {
      ...nodeRecord("active"),
      status: "running",
      resourceLocks: ["files:shared"],
    };
    const candidate = {
      ...nodeRecord("candidate"),
      resourceLocks: ["files:shared"],
    };
    const planPath = await writePlan(planRecord([candidate, active]));
    const runPath = await writeRun(
      runRecord([activeAttempt("active", ["files:shared"])]),
    );

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      mode: "run-aware",
      planRevision: 1,
      ready: [],
      blocked: [
        { nodeId: "active", reasons: ["status_not_ready", "active_attempt"] },
        { nodeId: "candidate", reasons: ["resource_lock_collision"] },
      ],
    });
  });

  it("honors discovered host concurrency when selecting a ready cohort", async () => {
    const planPath = await writePlan(
      planRecord([nodeRecord("task-a"), nodeRecord("task-b")]),
    );
    const runPath = await writeRun(runRecord([], 1));

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout)).toEqual({
      mode: "run-aware",
      planRevision: 1,
      ready: [
        {
          nodeId: "task-a",
          projectBindingId: "project-local",
          hostBindingId: "host-local",
          placement: "verified",
        },
      ],
      blocked: [{ nodeId: "task-b", reasons: ["host_capacity"] }],
    });
  });

  it("keeps an indeterminate dispatch bound and out of retry cohorts", async () => {
    const planPath = await writePlan(planRecord([nodeRecord("task-a")]));
    const attempt = {
      ...activeAttempt("task-a", ["files:task-a"]),
      dispatchState: "dispatch_indeterminate",
      nativeLifecycle: "dispatch_indeterminate",
      dispatchHistory: [
        {
          ...activeAttempt("task-a", ["files:task-a"]).dispatchHistory[0],
          dispatchState: "dispatch_indeterminate",
          nativeLifecycle: "dispatch_indeterminate",
        },
      ],
    };
    const runPath = await writeRun(runRecord([attempt]));

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout).blocked).toEqual([
      { nodeId: "task-a", reasons: ["indeterminate_attempt"] },
    ]);
  });

  it("does not fall back when a conjunctive project locator fails", async () => {
    const node = {
      ...nodeRecord("task-a"),
      target: {
        ...nodeRecord("task-a").target,
        project: {
          projectId: "demo-target",
          absolutePath: "/expected/checkout",
        },
      },
    };
    const planPath = await writePlan(planRecord([node]));
    const runPath = await writeRun(runRecord());

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout).blocked).toEqual([
      { nodeId: "task-a", reasons: ["project_unresolved"] },
    ]);
  });

  it("routes a symbolic ref through an explicitly resolved starting-state binding", async () => {
    const node = nodeRecord("task-a");
    node.target.startingState = { policy: "ref", ref: "refs/heads/main" };
    const planPath = await writePlan(planRecord([node]));
    const run = runRecord();
    run.projects[0].startingState = { policy: "ref", ref: "refs/heads/main" };
    run.projects[0].observedRevision = "resolved-commit-abc123";
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
      placement: "verified",
    });
  });

  it("filters discovered hosts by capabilities before testing ambiguity", async () => {
    const node = nodeRecord("task-a");
    node.target.host = { requiredCapabilities: ["subagents"] };
    const planPath = await writePlan(planRecord([node]));
    const run = runRecord();
    run.projects[0].hostBindingId = null;
    run.hosts.push({
      ...run.hosts[0],
      hostBindingId: "host-incompatible",
      nativeHostId: "incompatible",
      capabilities: ["git_worktrees"],
    });
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout).ready[0].hostBindingId).toBe("host-local");
  });

  it("uses an exact host selector to disambiguate host-specific project bindings", async () => {
    const node = nodeRecord("task-a");
    node.target.host = {
      selector: "host-two",
      requiredCapabilities: ["subagents"],
    };
    const planPath = await writePlan(planRecord([node]));
    const run = runRecord();
    run.hosts[0].selector = "host-one";
    run.hosts.push({
      ...run.hosts[0],
      hostBindingId: "host-two-binding",
      selector: "host-two",
      nativeHostId: "native-host-two",
    });
    run.projects.push({
      ...run.projects[0],
      projectBindingId: "project-on-host-two",
      hostBindingId: "host-two-binding",
    });
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
        nodeId: "task-a",
        projectBindingId: "project-on-host-two",
        hostBindingId: "host-two-binding",
        placement: "verified",
      },
    ]);
  });

  it("blocks a surface when the discovered host lacks its implicit capability", async () => {
    const node = {
      ...nodeRecord("milestone"),
      executionSurface: "desktop_task",
    };
    const planPath = await writePlan(planRecord([node]));
    const run = runRecord();
    run.hosts[0].capabilities = ["git_worktrees", "subagents"];
    const runPath = await writeRun(run);

    const { stdout } = await execFileAsync("node", [
      scriptPath,
      "ready",
      "--plan",
      planPath,
      "--run",
      runPath,
    ]);

    expect(JSON.parse(stdout).blocked).toEqual([
      { nodeId: "milestone", reasons: ["capability_missing"] },
    ]);
  });

  it("renders Mermaid deterministically without exposing plan text as syntax", async () => {
    const malicious = {
      ...nodeRecord("task-a"),
      title: 'Break "] --> injected\n%%{init: {"theme":"evil"}}%%',
    };
    const planPath = await writePlan(planRecord([malicious]));

    await execFileAsync("node", [scriptPath, "render", "--plan", planPath]);
    const graphPath = path.join(path.dirname(planPath), "graph.mmd");
    const first = await fs.readFile(graphPath, "utf8");
    await execFileAsync("node", [scriptPath, "render", "--plan", planPath]);
    const second = await fs.readFile(graphPath, "utf8");

    expect(second).toBe(first);
    expect(first).toContain("flowchart TD\n");
    expect(first).toContain("n0[");
    expect(first).not.toContain('"] --> injected');
    expect(first).not.toContain("%%{");
    expect(first).toContain("&quot;&#93; --&gt; injected");
  });
});
