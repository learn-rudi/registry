#!/usr/bin/env node

import { fileURLToPath } from "node:url";

const TARGET_KEYS = ["task", "project", "section", "cwd"];
const CLAUDE_TASK_ID_PATTERN =
  /^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EVENT_CURSOR_PATTERN = /^c_[0-9a-f]{24}$/u;
const REVIEW_MODES = new Set(["status", "completion", "handoff", "risk"]);
const WORKFLOW_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const FIELD_LIMITS = {
  "before-uuid": 26,
  confirm: 32,
  criteria: 8000,
  group: 256,
  "include-archived": 5,
  limit: 3,
  mode: 32,
  prompt: 20000,
  reason: 200,
  task: 64,
  title: 200,
  workflow: 65,
};
const COMMANDS = {
  help: {
    targets: [],
    required: [],
    optional: [],
    executionClass: "read",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  list: {
    targets: [],
    required: [],
    optional: ["include-archived", "limit", "group"],
    executionClass: "read",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  inspect: {
    targets: ["task"],
    required: [],
    optional: ["limit", "before-uuid"],
    executionClass: "read",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  status: {
    targets: ["task"],
    required: [],
    optional: [],
    executionClass: "read",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  review: {
    targets: ["task"],
    required: [],
    optional: ["mode", "workflow", "criteria"],
    executionClass: "read",
    requiresReadBack: false,
    requiresConfirmation: false,
  },
  continue: {
    targets: ["task"],
    required: ["prompt"],
    optional: [],
    executionClass: "work-dispatch",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  rename: {
    targets: ["task"],
    required: ["title"],
    optional: [],
    executionClass: "metadata-mutation",
    requiresReadBack: true,
    requiresConfirmation: false,
  },
  archive: {
    targets: ["task"],
    required: [],
    optional: ["reason", "confirm"],
    executionClass: "lifecycle-mutation",
    requiresReadBack: true,
    requiresConfirmation: true,
  },
};

function parseFields(tokens) {
  const fields = Object.create(null);
  for (const token of tokens) {
    const separator = token.indexOf("=");
    if (separator <= 0) throw new Error("Expected key=value token");
    const key = token.slice(0, separator).trim();
    const value = token.slice(separator + 1);
    if (!value.trim()) throw new Error(`${key} must not be empty`);
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
  if (selector === "self") {
    return { kind: "task", selector, id: "self", isSelf: true };
  }
  if (!CLAUDE_TASK_ID_PATTERN.test(selector)) {
    throw new Error("task must be self or an exact local_<uuid> Claude session ID");
  }
  return { kind: "task", selector, id: selector, isSelf: false };
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
  return normalizeTask(fields.task);
}

function normalizeBoolean(value, key) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

function normalizeLimit(value) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error("limit must be an integer from 1 to 500");
  }
  const limit = Number(value);
  if (limit > 500) throw new Error("limit must be an integer from 1 to 500");
  return limit;
}

function nativeCapabilitiesFor(verb, target, options) {
  if (verb === "help") return [];
  if (verb === "list") return ["list_sessions"];
  if (verb === "inspect") {
    return target.isSelf ? ["get_session"] : ["get_session", "list_events"];
  }
  if (verb === "status") return ["get_session"];
  if (verb === "review") {
    return options.mode === "status"
      ? ["get_session"]
      : ["get_session", "list_events"];
  }
  if (verb === "continue") {
    return ["get_session", "send_message", "get_session"];
  }
  if (verb === "rename") {
    return ["get_session", "set_session_title", "get_session"];
  }
  if (verb === "archive") {
    return target.isSelf
      ? ["get_session", "archive_session"]
      : ["get_session", "archive_session", "list_sessions"];
  }
  throw new Error(`No native capability mapping for verb: ${verb}`);
}

export function validateTaskCommand(args) {
  if (args.length === 0) throw new Error("A verb is required; use help explicitly");
  const verb = args[0];
  if (!Object.hasOwn(COMMANDS, verb)) throw new Error(`Unsupported verb: ${verb}`);

  const definition = COMMANDS[verb];
  const fields = parseFields(args.slice(1));
  const target = definition.targets.length > 0
    ? normalizeTarget(fields, definition.targets)
    : null;
  if (definition.targets.length === 0) {
    const selected = TARGET_KEYS.filter((key) => Object.hasOwn(fields, key));
    if (selected.length > 0) throw new Error(`${verb} does not accept a primary target`);
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
  if (Object.hasOwn(options, "include-archived")) {
    options["include-archived"] = normalizeBoolean(
      options["include-archived"],
      "include-archived"
    );
  }
  if (Object.hasOwn(options, "limit")) options.limit = normalizeLimit(options.limit);
  if (verb === "list" && options.limit > 100) {
    throw new Error("list limit must be an integer from 1 to 100");
  }
  if (options["before-uuid"] && !EVENT_CURSOR_PATTERN.test(options["before-uuid"])) {
    throw new Error("before-uuid must be a cursor returned by list_events");
  }
  if (verb === "inspect" && target.isSelf && (options.limit || options["before-uuid"])) {
    throw new Error("inspect task=self does not accept transcript options");
  }
  if (verb === "continue" && target.isSelf) {
    throw new Error("continue does not accept task=self");
  }
  if (verb === "archive" && target.isSelf && options.confirm !== "archive-self") {
    throw new Error("archive task=self requires confirm=archive-self");
  }
  if (verb === "archive" && !target.isSelf && options.confirm) {
    throw new Error("archive confirm is only valid with task=self");
  }

  let reasoningClass = "none";
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
      const workflow = options.workflow.startsWith("$")
        ? options.workflow.slice(1)
        : options.workflow;
      if (!WORKFLOW_PATTERN.test(workflow)) {
        throw new Error("workflow must be a valid skill name");
      }
      options.workflow = workflow;
      reasoningClass = "named-workflow";
    }
    if (target.isSelf && options.mode !== "status") {
      throw new Error("review task=self supports only mode=status");
    }
  }

  return {
    schemaVersion: "1",
    verb,
    target,
    options,
    executionClass: definition.executionClass,
    reasoningClass,
    nativeCapabilities: nativeCapabilitiesFor(verb, target, options),
    requiresReadBack: verb === "archive" && target.isSelf
      ? false
      : definition.requiresReadBack,
    requiresConfirmation: definition.requiresConfirmation,
    terminal: verb === "archive" && target.isSelf,
  };
}

function main() {
  try {
    const command = validateTaskCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(command, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Invalid Claude task command: ${message}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
