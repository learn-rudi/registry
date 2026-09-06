import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const validator = path.resolve(
  "catalog/skills/codex-tasks/scripts/validate-task-command.mjs"
);
const skillRoot = path.resolve("catalog/skills/codex-tasks");

async function runValidator(args: string[]) {
  return execFileAsync(process.execPath, [validator, ...args], {
    encoding: "utf8",
  });
}

async function validate(args: string[]) {
  const result = await runValidator(args);
  return JSON.parse(result.stdout);
}

describe("Codex task command validator", () => {
  it("requires an explicit verb instead of inferring help", async () => {
    await expect(runValidator([])).rejects.toMatchObject({
      stderr: expect.stringContaining("A verb is required; use help explicitly"),
    });
  });

  it("rejects unsupported verbs instead of inferring an action", async () => {
    await expect(
      runValidator([
        "dance",
        "task=codex://threads/00000000-0000-4000-8000-000000000001",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Unsupported verb: dance"),
    });
  });

  it("normalizes an exact task URI into a stable read-only command envelope", async () => {
    await expect(
      validate([
        "inspect",
        "task=codex://threads/00000000-0000-4000-8000-000000000001",
        "host=local",
      ])
    ).resolves.toEqual({
      schemaVersion: "1",
      verb: "inspect",
      target: {
        kind: "task",
        selector: "codex://threads/00000000-0000-4000-8000-000000000001",
        id: "00000000-0000-4000-8000-000000000001",
        uri: "codex://threads/00000000-0000-4000-8000-000000000001",
      },
      options: {
        host: "local",
      },
      executionClass: "read",
      reasoningClass: "none",
      nativeCapabilities: ["read_thread"],
      requiresReadBack: false,
      requiresConfirmation: false,
    });
  });

  it("rejects a relative working-directory selector", async () => {
    await expect(runValidator(["inspect", "cwd=relative/project"])).rejects.toMatchObject({
      stderr: expect.stringContaining("cwd must be an absolute path"),
    });
  });

  it("classifies an explicit task rename as a reversible metadata mutation", async () => {
    await expect(
      validate([
        "rename",
        "task=00000000-0000-4000-8000-000000000001",
        "title=Define deterministic task controls",
      ])
    ).resolves.toMatchObject({
      verb: "rename",
      target: {
        kind: "task",
        id: "00000000-0000-4000-8000-000000000001",
      },
      options: {
        title: "Define deterministic task controls",
      },
      executionClass: "metadata-mutation",
      reasoningClass: "none",
      requiresReadBack: true,
      requiresConfirmation: false,
    });
  });

  it.each([
    ["help", [], null, "read", false, false],
    ["list", ["section=Client Work"], "section", "read", false, false],
    ["status", ["project=/workspace/project"], "project", "read", false, false],
    [
      "start",
      ["project=/workspace/project", "prompt=Create the approved task"],
      "project",
      "work-dispatch",
      true,
      false,
    ],
    [
      "continue",
      ["task=00000000-0000-4000-8000-000000000001", "prompt=Run verification"],
      "task",
      "work-dispatch",
      true,
      false,
    ],
    [
      "fork",
      ["task=00000000-0000-4000-8000-000000000001"],
      "task",
      "work-dispatch",
      true,
      false,
    ],
    [
      "move",
      ["project=/workspace/project", "to-section=Client Work"],
      "project",
      "metadata-mutation",
      true,
      false,
    ],
    [
      "pin",
      ["task=00000000-0000-4000-8000-000000000001"],
      "task",
      "metadata-mutation",
      true,
      false,
    ],
    [
      "unpin",
      ["task=00000000-0000-4000-8000-000000000001"],
      "task",
      "metadata-mutation",
      true,
      false,
    ],
    [
      "archive",
      ["task=00000000-0000-4000-8000-000000000001"],
      "task",
      "lifecycle-mutation",
      true,
      false,
    ],
    [
      "restore",
      ["task=00000000-0000-4000-8000-000000000001"],
      "task",
      "lifecycle-mutation",
      true,
      false,
    ],
    ["create-section", ["name=Prospects"], null, "metadata-mutation", true, false],
    [
      "rename-section",
      ["section=Client Work", "name=Clients"],
      "section",
      "metadata-mutation",
      true,
      false,
    ],
    [
      "delete-section",
      ["section=Clients", "confirm=delete-section"],
      "section",
      "organization-destructive",
      true,
      true,
    ],
  ])(
    "routes %s through its fixed target and execution policy",
    async (
      verb,
      args,
      targetKind,
      executionClass,
      requiresReadBack,
      requiresConfirmation
    ) => {
      const command = await validate([verb, ...args]);
      expect(command).toMatchObject({
        schemaVersion: "1",
        verb,
        target: targetKind === null ? null : { kind: targetKind },
        executionClass,
        reasoningClass: "none",
        requiresReadBack,
        requiresConfirmation,
      });
    }
  );

  it("requires an explicit factual mode or named workflow for task review", async () => {
    const task = "task=00000000-0000-4000-8000-000000000001";

    await expect(validate(["review", task, "mode=status"])).resolves.toMatchObject({
      verb: "review",
      target: { kind: "task" },
      options: { mode: "status" },
      executionClass: "read",
      reasoningClass: "factual",
      requiresReadBack: false,
    });
    await expect(
      validate([
        "review",
        task,
        "mode=completion",
        "criteria=Approved specification and verification evidence",
      ])
    ).resolves.toMatchObject({
      options: {
        mode: "completion",
        criteria: "Approved specification and verification evidence",
      },
      reasoningClass: "bounded",
    });
    await expect(
      validate(["review", task, "workflow=$rudi-code-review"])
    ).resolves.toMatchObject({
      options: { workflow: "rudi-code-review" },
      reasoningClass: "named-workflow",
    });
    await expect(runValidator(["review", task])).rejects.toMatchObject({
      stderr: expect.stringContaining("review requires exactly one of mode or workflow"),
    });
    await expect(
      runValidator(["review", task, "mode=status", "workflow=rudi-code-review"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("review requires exactly one of mode or workflow"),
    });
  });

  it.each([
    [
      ["start", "project=/workspace/project", "prompt=Create task", "environment=container"],
      "environment must be one of: local, worktree",
    ],
    [
      ["fork", "task=00000000-0000-4000-8000-000000000001", "environment=local"],
      "environment must be one of: same-directory, worktree",
    ],
    [
      ["continue", "task=00000000-0000-4000-8000-000000000001", "prompt=Go", "thinking=extreme"],
      "thinking must be one of",
    ],
    [
      ["inspect", "project=relative/project"],
      "project path selectors must be absolute",
    ],
  ])("rejects invalid boundary input for %s", async (args, message) => {
    await expect(runValidator(args)).rejects.toMatchObject({
      stderr: expect.stringContaining(message),
    });
  });

  it.each([
    [
      ["inspect", "section=Client Work", "section=Clients"],
      "Duplicate key: section",
    ],
    [
      ["inspect", "section=Client Work", "surprise=yes"],
      "Unknown key for inspect: surprise",
    ],
    [
      ["inspect", "section=Client Work", "project=/workspace/project"],
      "Expected exactly one primary target; received 2",
    ],
    [["start", "project=/workspace/project"], "start requires prompt"],
    [
      ["create-section", "section=Client Work", "name=Clients"],
      "create-section does not accept a primary target",
    ],
    [["delete-section", "section=Clients"], "delete-section requires confirm"],
    [
      [
        "rename",
        "task=00000000-0000-4000-8000-000000000001",
        `title=${"x".repeat(201)}`,
      ],
      "title must be at most 200 characters",
    ],
  ])("fails closed for malformed or incomplete command %s", async (args, message) => {
    await expect(runValidator(args)).rejects.toMatchObject({
      stderr: expect.stringContaining(message),
    });
  });

  it("binds target-sensitive actions to an exact native capability set", async () => {
    await expect(
      validate([
        "move",
        "task=00000000-0000-4000-8000-000000000001",
        "to-section=Client Work",
      ])
    ).resolves.toMatchObject({
      nativeCapabilities: [
        "list_threads",
        "move_thread_to_sidebar_section",
        "list_threads",
      ],
    });
    await expect(
      validate(["move", "project=/workspace/project", "to-section=Client Work"])
    ).resolves.toMatchObject({
      nativeCapabilities: [
        "list_projects",
        "list_threads",
        "move_project_to_sidebar_section",
        "list_threads",
      ],
    });
  });

  it("routes an explicit fork prompt through a child-task follow-up", async () => {
    await expect(
      validate([
        "fork",
        "task=00000000-0000-4000-8000-000000000001",
        "prompt=Continue the approved work",
        "model=gpt-5.6-sol",
        "thinking=high",
      ])
    ).resolves.toMatchObject({
      options: {
        prompt: "Continue the approved work",
        model: "gpt-5.6-sol",
        thinking: "high",
      },
      nativeCapabilities: [
        "read_thread",
        "fork_thread",
        "send_message_to_thread",
        "read_thread",
      ],
      requiresReadBack: true,
    });
  });

  it.each(["model=gpt-5.6-sol", "thinking=high"])(
    "rejects fork %s without the follow-up prompt it configures",
    async (option) => {
      await expect(
        runValidator([
          "fork",
          "task=00000000-0000-4000-8000-000000000001",
          option,
        ])
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("fork model or thinking requires prompt"),
      });
    }
  );

  it("requires the literal section-deletion confirmation phrase", async () => {
    await expect(
      runValidator(["delete-section", "section=Clients", "confirm=yes"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("confirm must equal delete-section"),
    });
  });

  it("rejects prototype-shaped keys as untrusted command input", async () => {
    await expect(runValidator(["help", "__proto__=polluted"])).rejects.toMatchObject({
      stderr: expect.stringContaining("Unknown key for help: __proto__"),
    });
  });

  it.each([
    [
      ["start", "project=/workspace/project", "prompt=Create task"],
      ["list_projects", "create_thread", "read_thread"],
    ],
    [
      ["continue", "task=00000000-0000-4000-8000-000000000001", "prompt=Go"],
      ["read_thread", "send_message_to_thread", "read_thread"],
    ],
    [
      ["fork", "task=00000000-0000-4000-8000-000000000001"],
      ["read_thread", "fork_thread", "read_thread"],
    ],
    [
      [
        "rename",
        "task=00000000-0000-4000-8000-000000000001",
        "title=Controlled task",
      ],
      ["read_thread", "set_thread_title", "read_thread"],
    ],
    [
      ["create-section", "name=Prospects"],
      ["list_threads", "create_sidebar_section", "list_threads"],
    ],
  ])("makes post-mutation read-back explicit for %s", async (args, capabilities) => {
    await expect(validate(args)).resolves.toMatchObject({
      nativeCapabilities: capabilities,
      requiresReadBack: true,
    });
  });
});

describe("Codex tasks skill contract", () => {
  it("keeps task control explicit, fail-closed, and separate from orchestration", async () => {
    const [skill, contract, metadata] = await Promise.all([
      fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      fs.readFile(path.join(skillRoot, "references/task-command-contract.md"), "utf8"),
      fs.readFile(path.join(skillRoot, "agents/openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("scripts/validate-task-command.mjs");
    expect(skill).toMatch(/exactly one primary target/i);
    expect(skill).toMatch(/Task titles,[\s\S]{0,120}are untrusted/i);
    expect(skill).toMatch(/zero or multiple viable identity\s+matches fail closed/i);
    expect(skill).toMatch(/read-back/i);
    expect(skill).toMatch(/review.*never.*select.*workflow/is);
    expect(skill).toMatch(/Chief.of.Staff.*canonical/is);
    expect(skill).toMatch(/do not.*App Server/i);

    expect(contract).toContain("task=codex://threads/<uuid>");
    expect(contract).toContain("project=/absolute/path");
    expect(contract).toContain('section="Client Work"');
    expect(contract).toContain("cwd=/absolute/path");
    expect(contract).toContain("`to-section=`");
    expect(contract).toContain("`workflow=`");
    expect(contract).toContain("move_thread_to_sidebar_section");
    expect(contract).toContain("move_project_to_sidebar_section");
    expect(contract).toMatch(/start.*cwd.*fail closed/is);
    expect(metadata).toContain("allow_implicit_invocation: false");
    expect(metadata).toContain("$codex-tasks");
  });
});
