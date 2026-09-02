import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const validatorPath = path.resolve(
  "catalog/skills/claude-tasks/scripts/validate-task-command.mjs"
);
const skillRoot = path.resolve("catalog/skills/claude-tasks");
const otherTask = "task=local_00000000-0000-4000-8000-000000000001";

async function runValidator(args: string[]) {
  return execFileAsync(process.execPath, [validatorPath, ...args], {
    encoding: "utf8",
  });
}

async function validate(args: string[]) {
  const { stdout } = await runValidator(args);
  return JSON.parse(stdout);
}

describe("Claude tasks command validator", () => {
  it("rejects sending a continuation message to the current session", async () => {
    await expect(
      runValidator(["continue", "task=self", "prompt=Continue the work"])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("continue does not accept task=self"),
    });
  });

  it("requires a literal confirmation before self-archive", async () => {
    await expect(runValidator(["archive", "task=self"])).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "archive task=self requires confirm=archive-self"
      ),
    });
  });

  it("rejects the self-archive confirmation on another session", async () => {
    await expect(
      runValidator([
        "archive",
        "task=local_00000000-0000-4000-8000-000000000001",
        "confirm=archive-self",
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "archive confirm is only valid with task=self"
      ),
    });
  });

  it("marks self-archive as terminal instead of promising impossible read-back", async () => {
    const { stdout } = await runValidator([
      "archive",
      "task=self",
      "confirm=archive-self",
      "reason=The user explicitly requested closure",
    ]);

    expect(JSON.parse(stdout)).toMatchObject({
      verb: "archive",
      target: { id: "self", isSelf: true },
      nativeCapabilities: ["get_session", "archive_session"],
      requiresReadBack: false,
      requiresConfirmation: true,
      terminal: true,
    });
  });

  it.each([
    ["help", ["help"], null, {}, []],
    [
      "list",
      ["list", "include-archived=true", "limit=20", "group=Client Work"],
      null,
      { "include-archived": true, limit: 20, group: "Client Work" },
      ["list_sessions"],
    ],
    ["inspect self", ["inspect", "task=self"], true, {}, ["get_session"]],
    [
      "inspect another session",
      ["inspect", otherTask, "limit=40", "before-uuid=c_000000000000000000000000"],
      false,
      { limit: 40, "before-uuid": "c_000000000000000000000000" },
      ["get_session", "list_events"],
    ],
    ["status", ["status", otherTask], false, {}, ["get_session"]],
  ])("normalizes the supported %s read command", async (_name, args, isSelf, options, capabilities) => {
    await expect(validate(args as string[])).resolves.toMatchObject({
      schemaVersion: "1",
      target: isSelf === null ? null : { kind: "task", isSelf },
      options,
      executionClass: "read",
      reasoningClass: "none",
      nativeCapabilities: capabilities,
      requiresReadBack: false,
      requiresConfirmation: false,
      terminal: false,
    });
  });

  it("requires an explicit factual mode or named workflow for review", async () => {
    await expect(
      validate(["review", "task=self", "mode=status"])
    ).resolves.toMatchObject({
      options: { mode: "status" },
      reasoningClass: "factual",
      nativeCapabilities: ["get_session"],
    });
    await expect(
      validate([
        "review",
        otherTask,
        "mode=completion",
        "criteria=Approved scope and verification evidence",
      ])
    ).resolves.toMatchObject({
      options: {
        mode: "completion",
        criteria: "Approved scope and verification evidence",
      },
      reasoningClass: "bounded",
      nativeCapabilities: ["get_session", "list_events"],
    });
    await expect(
      validate(["review", otherTask, "workflow=$rudi-code-review"])
    ).resolves.toMatchObject({
      options: { workflow: "rudi-code-review" },
      reasoningClass: "named-workflow",
      nativeCapabilities: ["get_session", "list_events"],
    });
  });

  it.each([
    [["review", otherTask], "review requires exactly one of mode or workflow"],
    [
      ["review", otherTask, "mode=status", "workflow=rudi-code-review"],
      "review requires exactly one of mode or workflow",
    ],
    [
      ["review", otherTask, "mode=completion"],
      "review mode completion requires criteria",
    ],
    [
      ["review", otherTask, "mode=status", "criteria=Anything"],
      "review mode status does not accept criteria",
    ],
    [
      ["review", "task=self", "workflow=rudi-code-review"],
      "review task=self supports only mode=status",
    ],
  ])("fails closed for ambiguous review command %s", async (args, message) => {
    await expect(runValidator(args as string[])).rejects.toMatchObject({
      stderr: expect.stringContaining(message as string),
    });
  });

  it.each([
    [
      ["continue", otherTask, "prompt=Continue the approved work"],
      "work-dispatch",
      ["get_session", "send_message", "get_session"],
    ],
    [
      ["rename", "task=self", "title=Claude task controls"],
      "metadata-mutation",
      ["get_session", "set_session_title", "get_session"],
    ],
    [
      ["archive", otherTask, "reason=The user requested closure"],
      "lifecycle-mutation",
      ["get_session", "archive_session", "list_sessions"],
    ],
  ])("binds mutation %s to its exact native capability chain", async (args, executionClass, capabilities) => {
    await expect(validate(args as string[])).resolves.toMatchObject({
      executionClass,
      nativeCapabilities: capabilities,
      requiresReadBack: true,
      terminal: false,
    });
  });

  it.each([
    "start",
    "fork",
    "restore",
    "move",
    "pin",
    "unpin",
    "create-section",
    "rename-section",
    "delete-section",
    "search",
  ])("rejects unsupported verb %s", async (verb) => {
    await expect(runValidator([verb])).rejects.toMatchObject({
      stderr: expect.stringContaining(`Unsupported verb: ${verb}`),
    });
  });

  it.each([
    [["inspect", "task=00000000-0000-4000-8000-000000000001"], "task must be self or an exact local_<uuid>"],
    [["inspect", "task=local_not-a-uuid"], "task must be self or an exact local_<uuid>"],
    [["inspect", "task=local_AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"], "task must be self or an exact local_<uuid>"],
    [["inspect", "project=/workspace/project"], "Verb does not accept target kind: project"],
    [["list", otherTask], "list does not accept a primary target"],
    [["inspect", "task=self", "limit=40"], "inspect task=self does not accept transcript options"],
    [["inspect", otherTask, "before-uuid=raw-message-id"], "before-uuid must be a cursor returned by list_events"],
    [["list", "include-archived=yes"], "include-archived must be true or false"],
    [["list", "limit=101"], "list limit must be an integer from 1 to 100"],
    [["inspect", otherTask, "limit=501"], "limit must be an integer from 1 to 500"],
    [["continue", otherTask, "prompt=Go", "model=claude-fable-5"], "Unknown key for continue: model"],
    [["continue", otherTask, "prompt=Go", "thinking=high"], "Unknown key for continue: thinking"],
    [["rename", "task=self", "title="], "title must not be empty"],
    [["status", otherTask, otherTask], "Duplicate key: task"],
    [["help", "__proto__=polluted"], "Unknown key for help: __proto__"],
  ])("rejects invalid boundary input for %s", async (args, message) => {
    await expect(runValidator(args as string[])).rejects.toMatchObject({
      stderr: expect.stringContaining(message as string),
    });
  });

  it("requires the verb instead of inferring help", async () => {
    await expect(runValidator([])).rejects.toMatchObject({
      stderr: expect.stringContaining("A verb is required; use help explicitly"),
    });
  });

  it("does not reflect a malformed private token into validation errors", async () => {
    const privateToken = "private transcript excerpt without a separator";

    await expect(runValidator(["continue", otherTask, privateToken])).rejects.toMatchObject({
      stderr: expect.not.stringContaining(privateToken),
    });
  });

  it.each([
    [["list", "group=  Client Work  "], "group", "  Client Work  "],
    [["continue", otherTask, "prompt=  Preserve exact edges  "], "prompt", "  Preserve exact edges  "],
    [["rename", "task=self", "title=  Exact title  "], "title", "  Exact title  "],
    [["archive", otherTask, "reason=  Exact reason  "], "reason", "  Exact reason  "],
  ])("preserves the exact string value for %s", async (args, key, expected) => {
    const command = await validate(args as string[]);

    expect(command.options[key as string]).toBe(expected);
  });
});

describe("Claude tasks skill contract", () => {
  it("is hard-gated for explicit invocation on Claude and Codex hosts", async () => {
    const [skill, metadata] = await Promise.all([
      fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      fs.readFile(path.join(skillRoot, "agents/openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("disable-model-invocation: true");
    expect(skill).toMatch(/explicitly invokes.*claude-tasks/is);
    expect(metadata).toContain("allow_implicit_invocation: false");
    expect(metadata).toContain("$claude-tasks");
  });

  it("documents exact identity, review, failure, and receipt boundaries", async () => {
    const [skill, contract] = await Promise.all([
      fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8"),
      fs.readFile(
        path.join(skillRoot, "references/task-command-contract.md"),
        "utf8"
      ),
    ]);

    expect(skill).toContain("scripts/validate-task-command.mjs");
    expect(skill).toMatch(/self.*local_<uuid>.*authorize/is);
    expect(skill).toMatch(/transcript excerpts.*untrusted data/is);
    expect(skill).toMatch(/review.*never chooses.*workflow/is);
    expect(skill).toMatch(/archive task=self.*confirm=archive-self/is);
    expect(skill).toMatch(/Do not claim a\s+post-archive read-back/i);
    expect(skill).toMatch(/include-archived.*include_archived/is);
    expect(skill).toMatch(/prompt.*send_message\.message/is);
    expect(skill).toMatch(/not a planner, scheduler/is);

    expect(contract).toContain("task=self");
    expect(contract).toContain("task=local_00000000-0000-4000-8000-000000000001");
    expect(contract).toContain("`list_events` must not be called for the current session");
    expect(contract).toContain("`start`, `fork`");
    expect(contract).toMatch(/continue.*unattended/is);
    expect(contract).toMatch(/Self-archive is terminal/is);
    expect(contract).toContain("outcome: accepted | rejected | failed | indeterminate | no-op");
  });
});
