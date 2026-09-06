#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";

const TARGET_KEYS = ["task", "project", "section", "cwd"];
const TASK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REVIEW_MODES = new Set(["status", "completion", "handoff", "risk"]);
const WORKFLOW_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const THINKING_VALUES = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const FIELD_LIMITS = {
  confirm: 512,
  criteria: 8000,
  cwd: 4096,
  environment: 32,
  host: 256,
  mode: 32,
  model: 256,
  name: 120,
  project: 4096,
  prompt: 20000,
  section: 256,
  task: 64,
  thinking: 32,
  title: 200,
  "to-section": 256,
  workflow: 65,
};
const COMMANDS = {
  help: {
    targets: [],
    required: [],
    optional: [],
    executionClass: "read",
    reasoningClass: "none",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  list: {
    targets: ["section", "project", "cwd"],
    required: [],
    optional: ["host"],
    executionClass: "read",
    reasoningClass: "none",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  inspect: {
    targets: TARGET_KEYS,
    required: [],
    optional: ["host"],
    executionClass: "read",
    reasoningClass: "none",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  status: {
    targets: TARGET_KEYS,
    required: [],
    optional: ["host"],
    executionClass: "read",
    reasoningClass: "none",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  review: {
    targets: ["task"],
    required: [],
    optional: ["mode", "workflow", "criteria", "host"],
    executionClass: "read",
    reasoningClass: "none",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  start: {
    targets: ["project", "cwd"],
    required: ["prompt"],
    optional: ["title", "environment", "model", "thinking", "host"],
    executionClass: "work-dispatch",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  continue: {
    targets: ["task"],
    required: ["prompt"],
    optional: ["model", "thinking", "host"],
    executionClass: "work-dispatch",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  fork: {
    targets: ["task"],
    required: [],
    optional: ["prompt", "environment", "model", "thinking", "host"],
    executionClass: "work-dispatch",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  rename: {
    targets: ["task"],
    required: ["title"],
    optional: ["host"],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  move: {
    targets: ["task", "project"],
    required: ["to-section"],
    optional: ["host"],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  pin: {
    targets: ["task", "project"],
    required: [],
    optional: ["host"],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  unpin: {
    targets: ["task", "project"],
    required: [],
    optional: ["to-section", "host"],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  archive: {
    targets: ["task"],
    required: [],
    optional: ["host"],
    executionClass: "lifecycle-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  restore: {
    targets: ["task"],
    required: [],
    optional: ["host"],
    executionClass: "lifecycle-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  "create-section": {
    targets: [],
    required: ["name"],
    optional: [],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  "rename-section": {
    targets: ["section"],
    required: ["name"],
    optional: [],
    executionClass: "metadata-mutation",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  "delete-section": {
    targets: ["section"],
    required: ["confirm"],
    optional: [],
    executionClass: "organization-destructive",
    reasoningClass: "none",
    requiresReadBack: true,
    requiresConfirmation: true,
  },
};

function parseFields(tokens) {
  const fields = Object.create(null);
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Expected key=value token: ${token}`);
    }
    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1).trim();
    if (!value) throw new Error(`${key} must not be empty`);
    if (Object.hasOwn(fields, key)) throw new Error(`Duplicate key: ${key}`);
    const limit = FIELD_LIMITS[key];
    if (limit && value.length > limit) {
      throw new Error(`${key} must be at most ${limit} characters`);
    }
    fields[key] = value;
  }
  return fields;
}

function normalizeTask(selector) {
  const prefix = "codex://threads/";
  const id = selector.startsWith(prefix) ? selector.slice(prefix.length) : selector;
  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error("task must be an exact task UUID or codex://threads/<uuid> URI");
  }
  return {
    kind: "task",
    selector,
    id,
    uri: `${prefix}${id}`,
  };
}

function normalizeTarget(fields, allowedKinds) {
  const selected = TARGET_KEYS.filter((key) => Object.hasOwn(fields, key));
  if (selected.length !== 1) {
    throw new Error(`Expected exactly one primary target; received ${selected.length}`);
  }
  const kind = selected[0];
  if (!allowedKinds.includes(kind)) {
    throw new Error(`Verb does not accept target kind: ${kind}`);
  }
  const isAbsolute = path.posix.isAbsolute(fields[kind]) ||
    path.win32.isAbsolute(fields[kind]);
  if (kind === "cwd" && !isAbsolute) {
    throw new Error("cwd must be an absolute path");
  }
  if (
    kind === "project" &&
    (fields[kind].includes("/") || fields[kind].includes("\\")) &&
    !isAbsolute
  ) {
    throw new Error("project path selectors must be absolute");
  }
  return kind === "task"
    ? normalizeTask(fields[kind])
    : { kind, selector: fields[kind] };
}

function nativeCapabilitiesFor(verb, target, options) {
  if (verb === "help") return [];
  if (verb === "list") return ["list_threads", "list_projects"];
  if (verb === "inspect") {
    return target.kind === "task"
      ? ["read_thread"]
      : ["list_threads", "list_projects"];
  }
  if (verb === "status") {
    return target.kind === "task"
      ? ["wait_threads", "read_thread"]
      : ["list_threads", "list_projects", "read_thread"];
  }
  if (verb === "review") return ["read_thread"];
  if (verb === "start") return ["list_projects", "create_thread", "read_thread"];
  if (verb === "continue") {
    return ["read_thread", "send_message_to_thread", "read_thread"];
  }
  if (verb === "fork") {
    return options.prompt
      ? ["read_thread", "fork_thread", "send_message_to_thread", "read_thread"]
      : ["read_thread", "fork_thread", "read_thread"];
  }
  if (verb === "rename") {
    return ["read_thread", "set_thread_title", "read_thread"];
  }
  if (verb === "move" || verb === "pin" || verb === "unpin") {
    return target.kind === "task"
      ? ["list_threads", "move_thread_to_sidebar_section", "list_threads"]
      : [
          "list_projects",
          "list_threads",
          "move_project_to_sidebar_section",
          "list_threads",
        ];
  }
  if (verb === "archive") {
    return ["read_thread", "set_thread_archived", "list_archived_threads"];
  }
  if (verb === "restore") {
    return [
      "read_thread",
      "set_thread_archived",
      "list_archived_threads",
      "read_thread",
    ];
  }
  if (verb === "create-section") {
    return ["list_threads", "create_sidebar_section", "list_threads"];
  }
  if (verb === "rename-section") {
    return ["list_threads", "rename_sidebar_section", "list_threads"];
  }
  if (verb === "delete-section") {
    return ["list_threads", "delete_sidebar_section", "list_threads"];
  }
  throw new Error(`No native capability mapping for verb: ${verb}`);
}

export function validateTaskCommand(args) {
  if (args.length === 0) {
    throw new Error("A verb is required; use help explicitly");
  }
  const verb = args[0];
  if (!Object.hasOwn(COMMANDS, verb)) {
    throw new Error(`Unsupported verb: ${verb}`);
  }
  const definition = COMMANDS[verb];
  const fields = parseFields(args.slice(1));
  const target =
    definition.targets.length === 0 ? null : normalizeTarget(fields, definition.targets);
  if (definition.targets.length === 0) {
    const selected = TARGET_KEYS.filter((key) => Object.hasOwn(fields, key));
    if (selected.length > 0) {
      throw new Error(`${verb} does not accept a primary target`);
    }
  }
  const allowedKeys = new Set([
    ...TARGET_KEYS,
    ...definition.required,
    ...definition.optional,
  ]);
  for (const key of Object.keys(fields)) {
    if (!allowedKeys.has(key)) throw new Error(`Unknown key for ${verb}: ${key}`);
  }
  for (const key of definition.required) {
    if (!Object.hasOwn(fields, key)) throw new Error(`${verb} requires ${key}`);
  }
  const options = Object.create(null);
  for (const key of [...definition.required, ...definition.optional]) {
    if (Object.hasOwn(fields, key)) options[key] = fields[key];
  }
  let reasoningClass = definition.reasoningClass;
  if (verb === "review") {
    const routeCount = Number(Object.hasOwn(options, "mode")) +
      Number(Object.hasOwn(options, "workflow"));
    if (routeCount !== 1) {
      throw new Error("review requires exactly one of mode or workflow");
    }
    if (options.mode) {
      if (!REVIEW_MODES.has(options.mode)) {
        throw new Error(`Unsupported review mode: ${options.mode}`);
      }
      if (options.mode !== "status" && !options.criteria) {
        throw new Error(`review mode ${options.mode} requires criteria`);
      }
      if (options.mode === "status" && options.criteria) {
        throw new Error("review mode status does not accept criteria");
      }
      reasoningClass = options.mode === "status" ? "factual" : "bounded";
    } else {
      const normalizedWorkflow = options.workflow.startsWith("$")
        ? options.workflow.slice(1)
        : options.workflow;
      if (!WORKFLOW_PATTERN.test(normalizedWorkflow)) {
        throw new Error("workflow must be a valid skill name");
      }
      options.workflow = normalizedWorkflow;
      reasoningClass = "named-workflow";
    }
  }
  if (options.environment) {
    const environmentValues = verb === "fork"
      ? new Set(["same-directory", "worktree"])
      : new Set(["local", "worktree"]);
    if (!environmentValues.has(options.environment)) {
      throw new Error(
        `environment must be one of: ${[...environmentValues].join(", ")}`
      );
    }
  }
  if (options.thinking && !THINKING_VALUES.has(options.thinking)) {
    throw new Error(`thinking must be one of: ${[...THINKING_VALUES].join(", ")}`);
  }
  if (verb === "fork" && (options.model || options.thinking) && !options.prompt) {
    throw new Error("fork model or thinking requires prompt");
  }
  if (verb === "delete-section" && options.confirm !== "delete-section") {
    throw new Error("confirm must equal delete-section");
  }
  return {
    schemaVersion: "1",
    verb,
    target,
    options,
    executionClass: definition.executionClass,
    reasoningClass,
    nativeCapabilities: nativeCapabilitiesFor(verb, target, options),
    requiresReadBack: definition.requiresReadBack,
    requiresConfirmation: definition.requiresConfirmation,
  };
}

function main() {
  try {
    const command = validateTaskCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(command, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Invalid Codex task command: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
