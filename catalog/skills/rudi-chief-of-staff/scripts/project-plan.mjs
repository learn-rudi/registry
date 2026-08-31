#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ID_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_OBJECTIVE_LENGTH = 4000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const NODE_FIELDS = new Set([
  "id",
  "title",
  "objective",
  "dependencies",
  "owner",
  "allowedScope",
  "acceptanceCriteria",
  "verification",
  "deliverables",
  "risk",
  "blockingReason",
  "status",
  "executionSurface",
  "resourceLocks",
  "target",
  "review",
  "reconciliations",
]);
const PLAN_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "revision",
  "objective",
  "requestedMaxParallel",
  "resourceEnvelope",
  "reviewPolicy",
  "decisionFrontier",
  "nodes",
  "handoffs",
]);
const DECISION_FRONTIER_FIELDS = new Set([
  "initiativeObjective",
  "revision",
  "areas",
  "decisions",
  "promotions",
]);
const FRONTIER_AREA_FIELDS = new Set([
  "id",
  "question",
  "status",
  "resolution",
  "decisionIds",
  "approvalRef",
  "decidedAt",
]);
const FRONTIER_DECISION_FIELDS = new Set([
  "id",
  "question",
  "recommendation",
  "resolution",
  "status",
  "approvalRef",
  "decidedAt",
]);
const FRONTIER_DECISION_BINDING_FIELDS = new Set(["decisionId", "digest"]);
const FRONTIER_AREA_BINDING_FIELDS = new Set(["areaId", "digest"]);
const FRONTIER_PROMOTION_FIELDS = new Set([
  "promotionId",
  "inputDigest",
  "sourcePlanRevision",
  "sourceFrontierRevision",
  "sourceFrontierDigest",
  "areaBindings",
  "decisionBindings",
  "approvalRef",
  "implementationAuthorizationRef",
  "promotedAt",
  "createdNodeIds",
  "acceptedPlanRevision",
]);
const FRONTIER_PROMOTION_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "promotionId",
  "expectedPlanRevision",
  "expectedFrontierRevision",
  "areaBindings",
  "decisionBindings",
  "approvalRef",
  "implementationAuthorizationRef",
  "promotedAt",
  "nodes",
]);
const RESOURCE_ENVELOPE_FIELDS = new Set([
  "maxElapsedSeconds",
  "maxTokens",
  "softCheckpointElapsedSeconds",
  "softCheckpointTokens",
]);
const REVIEW_POLICY_FIELDS = new Set([
  "maxIndependentReviews",
  "maxFocusedConfirmations",
  "additionalReviewRule",
]);
const REVIEW_FIELDS = new Set([
  "kind",
  "sequence",
  "authorizationRef",
  "unresolvedBlockerRef",
]);
const DEFAULT_SOFT_CHECKPOINT_ELAPSED_SECONDS = 1800;
const DEFAULT_SOFT_CHECKPOINT_TOKENS = 100000;
const STATUS_TRANSITIONS = new Map([
  ["proposed", new Set(["ready", "cancelled"])],
  ["ready", new Set(["running", "cancelled"])],
  ["running", new Set(["review", "rework", "waiting", "needs_input", "failed", "cancelled"])],
  ["waiting", new Set(["ready", "cancelled"])],
  ["needs_input", new Set(["ready", "cancelled"])],
  ["review", new Set(["done", "rework", "cancelled"])],
  ["rework", new Set(["ready", "cancelled"])],
  ["failed", new Set(["ready", "cancelled"])],
  ["done", new Set()],
  ["cancelled", new Set()],
]);
const BLOCKING_STATUSES = new Set([
  "proposed",
  "waiting",
  "needs_input",
  "rework",
  "failed",
  "cancelled",
]);
const RESULT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "nodeId",
  "attemptId",
  "resultId",
  "outcome",
  "summary",
  "evidence",
]);
const CANCELLATION_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "nodeId",
  "attemptId",
  "cancellationId",
  "reason",
  "evidence",
]);
const EVIDENCE_FIELDS = new Set([
  "subjectType",
  "subjectId",
  "uri",
  "digest",
  "mediaType",
]);
const LINEAGE_FIELDS = new Set(["lineageId", "handoffId", "source", "destination"]);
const LINEAGE_SOURCE_FIELDS = new Set([
  "nodeId",
  "attemptId",
  "resultId",
  "acceptedPlanRevision",
  "uri",
  "digest",
  "mediaType",
]);
const LINEAGE_DESTINATION_FIELDS = new Set([
  "nodeId",
  "attemptId",
  "projectBindingId",
]);
const TARGET_FIELDS = new Set([
  "project",
  "host",
  "workspaceMode",
  "startingState",
  "modelSelection",
]);
const PROJECT_LOCATOR_FIELDS = new Set(["projectId", "repository", "absolutePath"]);
const HOST_TARGET_FIELDS = new Set(["selector", "requiredCapabilities"]);
const STARTING_STATE_FIELDS = new Set(["policy", "ref"]);
const MODEL_SELECTION_FIELDS = new Set([
  "provider",
  "model",
  "reasoningProfile",
  "selectionSource",
  "fallbackAuthorized",
  "fallbackAuthorizationRef",
  "fallbackUnresolvedBlockerRef",
]);
const CRITERION_FIELDS = new Set(["id", "statement"]);
const VERIFICATION_FIELDS = new Set(["id", "method", "instruction"]);
const DELIVERABLE_FIELDS = new Set(["id", "description", "mediaTypes"]);
const VALID_SURFACES = new Set([
  "inline",
  "subagent",
  "desktop_task",
  "human_gate",
  "external_system",
]);
const MODEL_BACKED_SURFACES = new Set(["inline", "subagent", "desktop_task"]);
const SURFACE_CAPABILITIES = new Map([
  ["subagent", "subagents"],
  ["desktop_task", "desktop_tasks"],
  ["human_gate", "human_gates"],
  ["external_system", "external_systems"],
]);
const EVIDENCE_URI_SCHEMES = new Set([
  "artifact:",
  "git+https:",
  "gs:",
  "http:",
  "https:",
  "ipfs:",
  "oci:",
  "s3:",
]);
const HANDOFF_FIELDS = new Set([
  "id",
  "producerNodeId",
  "consumerNodeId",
  "deliverableId",
  "transport",
  "requiredEvidence",
]);
const HANDOFF_TRANSPORT_FIELDS = new Set(["medium", "mediaType"]);
const RUN_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "projects",
  "hosts",
  "attempts",
  "usageReports",
  "lineage",
]);
const RUN_INIT_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "projects",
  "hosts",
  "lineage",
]);
const PROJECT_BINDING_FIELDS = new Set([
  "projectBindingId",
  "hostBindingId",
  "locator",
  "nativeSavedProjectId",
  "repositoryIdentity",
  "resolvedRoot",
  "startingState",
  "observedRevision",
  "defaultBranch",
  "discoveredAt",
]);
const HOST_BINDING_FIELDS = new Set([
  "hostBindingId",
  "selector",
  "nativeHostId",
  "capabilities",
  "modelProfiles",
  "maxConcurrency",
  "supportsReversibleArchive",
  "discoveredAt",
]);
const MODEL_PROFILE_FIELDS = new Set([
  "provider",
  "model",
  "reasoningProfiles",
]);
const ATTEMPT_FIELDS = new Set([
  "attemptId",
  "nodeId",
  "preparedPlanRevision",
  "preparedAt",
  "binding",
  "nativeIds",
  "dispatchState",
  "terminationOutcome",
  "nativeLifecycle",
  "dispatchHistory",
  "terminationHistory",
  "pendingSteering",
  "dispatchTimestamp",
  "archive",
  "archiveHistory",
  "resultReference",
]);
const DISPATCH_RECORD_FIELDS = new Set([
  "dispatchId",
  "dispatchState",
  "nativeIds",
  "nativeLifecycle",
  "recordedAt",
]);
const DISPATCH_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "attemptId",
  ...DISPATCH_RECORD_FIELDS,
]);
const TERMINATION_RECORD_FIELDS = new Set([
  "terminationId",
  "outcome",
  "nativeLifecycle",
  "recordedAt",
]);
const TERMINATION_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "attemptId",
  ...TERMINATION_RECORD_FIELDS,
]);
const ATTEMPT_BINDING_FIELDS = new Set([
  "projectBindingId",
  "hostBindingId",
  "executionSurface",
  "workspaceMode",
  "actualCwd",
  "actualWorktree",
  "observedRevision",
  "branch",
  "resourceLocks",
  "authorizationRef",
  "idempotencyKey",
  "modelSelection",
]);
const PREPARE_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "nodeId",
  "attemptId",
  "projectBindingId",
  "hostBindingId",
  "actualCwd",
  "actualWorktree",
  "branch",
  "authorizationRef",
  "preparedAt",
]);
const USAGE_REPORT_FIELDS = new Set([
  "usageId",
  "attemptId",
  "elapsedSeconds",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reportedAt",
  "source",
  "decision",
  "authorizationRef",
]);
const USAGE_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  ...USAGE_REPORT_FIELDS,
]);
const NATIVE_ID_FIELDS = new Set([
  "savedProjectId",
  "hostId",
  "agentId",
  "taskId",
  "threadId",
]);
const STEERING_FIELDS = new Set([
  "steeringId",
  "payloadDigest",
  "createdAt",
  "updatedAt",
  "state",
]);
const STEERING_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "attemptId",
  "steeringId",
  "payloadDigest",
  "state",
  "recordedAt",
]);
const ARCHIVE_FIELDS = new Set(["state", "archivedAt", "lastAttemptedAt"]);
const ARCHIVE_RECORD_FIELDS = new Set(["archiveId", "state", "recordedAt"]);
const ARCHIVE_INPUT_FIELDS = new Set([
  "schemaVersion",
  "projectId",
  "runId",
  "planRevision",
  "attemptId",
  ...ARCHIVE_RECORD_FIELDS,
]);
const RESULT_REFERENCE_FIELDS = new Set(["kind", "id", "acceptedPlanRevision"]);
const RECONCILIATION_FIELDS = new Set([
  "resultId",
  "cancellationId",
  "attemptId",
  "inputDigest",
  "outcome",
  "fromStatus",
  "toStatus",
  "acceptedAt",
  "acceptedPlanRevision",
  "managerReason",
  "evidenceContract",
  "evidence",
]);
const EVIDENCE_CONTRACT_FIELDS = new Set([
  "criteria",
  "verifications",
  "deliverables",
  "handoffs",
]);
const EVIDENCE_CONTRACT_DELIVERABLE_FIELDS = new Set(["id", "mediaTypes"]);
const EVIDENCE_CONTRACT_HANDOFF_FIELDS = new Set([
  "id",
  "producerNodeId",
  "consumerNodeId",
  "deliverableId",
  "medium",
  "mediaType",
]);

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function usage() {
  return [
    "Usage:",
    "  project-plan.mjs init --root <project> --project-id <id> --run-id <id> --objective <text> [--max-parallel <count>] [--max-elapsed-seconds <count>] [--max-tokens <count>] [--soft-checkpoint-elapsed-seconds <count>] [--soft-checkpoint-tokens <count>]",
    "  project-plan.mjs validate --plan <path>",
    "  project-plan.mjs promote --plan <path> --input <path>",
    "  project-plan.mjs run-init --plan <path> --run <path> --input <path>",
    "  project-plan.mjs validate-run --plan <path> --run <path>",
    "  project-plan.mjs prepare --plan <path> --run <path> --input <path>",
    "  project-plan.mjs record-usage --plan <path> --run <path> --input <path>",
    "  project-plan.mjs record-dispatch --plan <path> --run <path> --input <path>",
    "  project-plan.mjs record-termination --plan <path> --run <path> --input <path>",
    "  project-plan.mjs record-steering --plan <path> --run <path> --input <path>",
    "  project-plan.mjs record-archive --plan <path> --run <path> --input <path>",
    "  project-plan.mjs ready --plan <path> [--run <path>]",
    "  project-plan.mjs render --plan <path>",
    "  project-plan.mjs transition --plan <path> [--run <path>] --node <id> --to <status> [--blocking-reason <text>]",
    "  project-plan.mjs reconcile --plan <path> --run <path> --input <path> --to <status> --manager-reason <text> --accepted-at <timestamp>",
    "  project-plan.mjs archive-eligible --plan <path> --run <path>",
  ].join("\n");
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(flag + " requires a value");
  }
  return value;
}

function parseInitArgs(args) {
  const options = {
    root: null,
    projectId: null,
    runId: null,
    objective: null,
    maxParallel: 1,
    maxElapsedSeconds: null,
    maxTokens: null,
    softCheckpointElapsedSeconds: DEFAULT_SOFT_CHECKPOINT_ELAPSED_SECONDS,
    softCheckpointTokens: DEFAULT_SOFT_CHECKPOINT_TOKENS,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (
      flag === "--root" ||
      flag === "--project-id" ||
      flag === "--run-id" ||
      flag === "--objective" ||
      flag === "--max-parallel" ||
      flag === "--max-elapsed-seconds" ||
      flag === "--max-tokens" ||
      flag === "--soft-checkpoint-elapsed-seconds" ||
      flag === "--soft-checkpoint-tokens"
    ) {
      const value = readValue(args, index, flag);
      if (flag === "--root") options.root = value;
      if (flag === "--project-id") options.projectId = value;
      if (flag === "--run-id") options.runId = value;
      if (flag === "--objective") options.objective = value;
      if (
        flag === "--max-parallel" ||
        flag === "--max-elapsed-seconds" ||
        flag === "--max-tokens" ||
        flag === "--soft-checkpoint-elapsed-seconds" ||
        flag === "--soft-checkpoint-tokens"
      ) {
        if (!/^[1-9][0-9]*$/u.test(value)) {
          throw new Error(flag + " must be a positive integer");
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
          throw new Error(flag + " must be a positive safe integer");
        }
        if (flag === "--max-parallel") options.maxParallel = parsed;
        if (flag === "--max-elapsed-seconds") options.maxElapsedSeconds = parsed;
        if (flag === "--max-tokens") options.maxTokens = parsed;
        if (flag === "--soft-checkpoint-elapsed-seconds") {
          options.softCheckpointElapsedSeconds = parsed;
        }
        if (flag === "--soft-checkpoint-tokens") options.softCheckpointTokens = parsed;
      }
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  for (const [name, value] of [
    ["--root", options.root],
    ["--project-id", options.projectId],
    ["--run-id", options.runId],
    ["--objective", options.objective],
  ]) {
    if (!value) throw new Error(name + " is required");
  }
  return options;
}

function parsePlanArgs(args) {
  let plan = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--plan") {
      plan = readValue(args, index, flag);
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  if (!plan) throw new Error("--plan is required");
  return { plan };
}

function parsePromotionArgs(args) {
  const options = { plan: null, input: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--plan" || flag === "--input") {
      const value = readValue(args, index, flag);
      if (flag === "--plan") options.plan = value;
      if (flag === "--input") options.input = value;
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  if (!options.plan) throw new Error("--plan is required");
  if (!options.input) throw new Error("--input is required");
  return options;
}

function parseReadyArgs(args) {
  let plan = null;
  let run = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--plan" || flag === "--run") {
      const value = readValue(args, index, flag);
      if (flag === "--plan") plan = value;
      if (flag === "--run") run = value;
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  if (!plan) throw new Error("--plan is required");
  return { plan, run };
}

function parseRunInputArgs(args) {
  const options = { plan: null, run: null, input: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--plan" || flag === "--run" || flag === "--input") {
      const value = readValue(args, index, flag);
      if (flag === "--plan") options.plan = value;
      if (flag === "--run") options.run = value;
      if (flag === "--input") options.input = value;
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  for (const field of ["plan", "run", "input"]) {
    if (!options[field]) throw new Error("--" + field + " is required");
  }
  return options;
}

function parseTransitionArgs(args) {
  const options = { plan: null, run: null, node: null, to: null, blockingReason: null };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (
      flag === "--plan" ||
      flag === "--run" ||
      flag === "--node" ||
      flag === "--to" ||
      flag === "--blocking-reason"
    ) {
      const value = readValue(args, index, flag);
      if (flag === "--plan") options.plan = value;
      if (flag === "--run") options.run = value;
      if (flag === "--node") options.node = value;
      if (flag === "--to") options.to = value;
      if (flag === "--blocking-reason") options.blockingReason = value;
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  for (const field of ["plan", "node", "to"]) {
    if (!options[field]) throw new Error("--" + field + " is required");
  }
  return options;
}

function parseReconcileArgs(args) {
  const options = {
    plan: null,
    run: null,
    input: null,
    to: null,
    managerReason: null,
    acceptedAt: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (
      flag === "--plan" ||
      flag === "--run" ||
      flag === "--input" ||
      flag === "--to" ||
      flag === "--manager-reason" ||
      flag === "--accepted-at"
    ) {
      const value = readValue(args, index, flag);
      if (flag === "--plan") options.plan = value;
      if (flag === "--run") options.run = value;
      if (flag === "--input") options.input = value;
      if (flag === "--to") options.to = value;
      if (flag === "--manager-reason") options.managerReason = value;
      if (flag === "--accepted-at") options.acceptedAt = value;
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + flag);
  }
  for (const field of ["plan", "run", "input", "to", "managerReason", "acceptedAt"]) {
    if (!options[field]) throw new Error("--" + field.replace(/[A-Z]/gu, (c) => "-" + c.toLowerCase()) + " is required");
  }
  return options;
}

function validateIdentifier(value, label) {
  if (!ID_PATTERN.test(value)) {
    throw new Error(label + " must match " + ID_PATTERN.source);
  }
  return value;
}

function validateText(value, label, maxLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(label + " must be a non-empty string");
  }
  if (value.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(label + " contains unsafe or oversized content");
  }
  return value.trim();
}

function validateCanonicalTimestamp(value, label) {
  const timestamp = validateText(value, label, 64);
  let canonical;
  try {
    canonical = new Date(timestamp).toISOString();
  } catch {
    throw new Error(label + " must be a canonical RFC 3339 UTC timestamp");
  }
  if (canonical !== timestamp) {
    throw new Error(label + " must be a canonical RFC 3339 UTC timestamp");
  }
  return timestamp;
}

function validatePortablePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/u.test(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Unsafe portable path in " + label + ": " + String(value));
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Unsafe portable path in " + label + ": " + value);
  }
  return value;
}

function validateResourceLock(value) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9._:/-]{0,127}$/u.test(value)) {
    throw new Error("Invalid resource lock: " + String(value));
  }
  return value;
}

function validateMediaType(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(value)) {
    throw new Error(label + " mediaType must be an IANA media type");
  }
  return value;
}

function validateTarget(value, nodeId) {
  if (!isPlainObject(value)) throw new Error("node " + nodeId + " target must be an object");
  assertKnownFields(value, TARGET_FIELDS, "target");
  if (!isPlainObject(value.project)) {
    throw new Error("node " + nodeId + " target.project must be an object");
  }
  assertKnownFields(value.project, PROJECT_LOCATOR_FIELDS, "project locator");
  const locatorFields = [...PROJECT_LOCATOR_FIELDS].filter(
    (field) => value.project[field] !== undefined
  );
  if (locatorFields.length === 0) throw new Error("project locator requires at least one field");
  if (value.project.projectId !== undefined) {
    validateIdentifier(value.project.projectId, "target project ID");
  }
  if (value.project.repository !== undefined) {
    const repository = validateText(value.project.repository, "repository identity", 1000);
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(repository)) {
      const parsed = new URL(repository);
      if (parsed.username || parsed.password) {
        throw new Error("repository identity must not contain credentials");
      }
    }
  }
  if (value.project.absolutePath !== undefined) {
    const absolutePath = validateText(value.project.absolutePath, "absolute project path", 2000);
    if (!path.isAbsolute(absolutePath) && !/^[a-zA-Z]:[\\/]/u.test(absolutePath)) {
      throw new Error("project locator absolutePath must be absolute");
    }
  }
  if (!new Set(["direct", "isolated_worktree"]).has(value.workspaceMode)) {
    throw new Error("workspaceMode must be direct or isolated_worktree");
  }
  if (value.host !== undefined) {
    if (!isPlainObject(value.host)) throw new Error("target.host must be an object");
    assertKnownFields(value.host, HOST_TARGET_FIELDS, "host target");
    if (value.host.selector !== undefined) {
      validateIdentifier(value.host.selector, "host selector");
    }
    if (
      value.host.requiredCapabilities !== undefined &&
      (!Array.isArray(value.host.requiredCapabilities) ||
        value.host.requiredCapabilities.some(
          (capability) => typeof capability !== "string" || !/^[a-z][a-z0-9._:/-]{0,127}$/u.test(capability)
        ))
    ) {
      throw new Error("requiredCapabilities must contain portable capability IDs");
    }
  }
  if (value.startingState !== undefined) {
    if (!isPlainObject(value.startingState)) {
      throw new Error("startingState must be an object");
    }
    assertKnownFields(value.startingState, STARTING_STATE_FIELDS, "starting state");
    if (!new Set(["current_revision", "default_branch", "ref"]).has(value.startingState.policy)) {
      throw new Error("Unknown starting-state policy");
    }
    if (value.startingState.policy === "ref") {
      validateText(value.startingState.ref, "starting-state ref", 500);
    } else if (value.startingState.ref !== undefined) {
      throw new Error("starting-state ref is allowed only for ref policy");
    }
  }
  if (value.modelSelection !== undefined) {
    validateModelSelection(value.modelSelection, "node " + nodeId + " model selection");
  }
}

function validateModelSelection(value, label) {
  if (!isPlainObject(value)) throw new Error(label + " must be an object");
  assertKnownFields(value, MODEL_SELECTION_FIELDS, label);
  validateIdentifier(value.provider, label + " provider");
  validateText(value.model, label + " model", 200);
  validateText(value.reasoningProfile, label + " reasoningProfile", 100);
  if (!new Set(["user", "plan", "manager", "host_default"]).has(value.selectionSource)) {
    throw new Error(label + " selectionSource is invalid");
  }
  if (typeof value.fallbackAuthorized !== "boolean") {
    throw new Error(label + " fallbackAuthorized must be boolean");
  }
  validateNullableText(
    value.fallbackAuthorizationRef,
    label + " fallbackAuthorizationRef",
    1000
  );
  validateNullableText(
    value.fallbackUnresolvedBlockerRef,
    label + " fallbackUnresolvedBlockerRef",
    1000
  );
  const hasFallbackBasis =
    value.fallbackAuthorizationRef !== null ||
    value.fallbackUnresolvedBlockerRef !== null;
  if (value.fallbackAuthorized !== hasFallbackBasis) {
    throw new Error(
      label +
        " requires an explicit authorization or unresolved blocker exactly when fallback is authorized"
    );
  }
  return value;
}

function normalizedStartingState(target) {
  return target.startingState ?? { policy: "current_revision" };
}

function startingStatesEqual(left, right) {
  return left.policy === right.policy && (left.ref ?? null) === (right.ref ?? null);
}

function validateStartingState(value, label) {
  if (!isPlainObject(value)) throw new Error(label + " must be an object");
  assertKnownFields(value, STARTING_STATE_FIELDS, label);
  if (!new Set(["current_revision", "default_branch", "ref"]).has(value.policy)) {
    throw new Error("Unknown " + label + " policy");
  }
  if (value.policy === "ref") validateText(value.ref, label + " ref", 500);
  else if (value.ref !== undefined) throw new Error(label + " ref is allowed only for ref policy");
}

function validateUniqueRecordArray(value, label, fields, validateRecord) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(label + " must be a non-empty array");
  }
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isPlainObject(item)) throw new Error(label + "[" + index + "] must be an object");
    assertKnownFields(item, fields, label + " record");
    validateIdentifier(item.id, label + " ID");
    if (ids.has(item.id)) throw new Error("Duplicate " + label + " ID: " + item.id);
    ids.add(item.id);
    validateRecord(item);
  }
}

function validateNodeContract(node, id) {
  validateText(node.title, "node " + id + " title", 160);
  validateText(node.objective, "node " + id + " objective", MAX_OBJECTIVE_LENGTH);
  validateText(node.owner, "node " + id + " owner", 200);
  if (!new Set(["low", "medium", "high"]).has(node.risk)) {
    throw new Error("node " + id + " risk must be low, medium, or high");
  }
  if (!STATUS_TRANSITIONS.has(node.status)) throw new Error("Unknown node status: " + node.status);
  if (!VALID_SURFACES.has(node.executionSurface)) {
    throw new Error("Unknown execution surface: " + node.executionSurface);
  }
  if (MODEL_BACKED_SURFACES.has(node.executionSurface)) {
    if (node.target.modelSelection === undefined) {
      throw new Error(
        "Exact model selection is required for model-backed work on node " + id
      );
    }
    validateModelSelection(node.target.modelSelection, "node " + id + " model selection");
  } else if (node.target.modelSelection !== undefined) {
    throw new Error(
      "modelSelection is allowed only for inline, subagent, or desktop_task nodes"
    );
  }
  if (!Object.hasOwn(node, "review")) {
    throw new Error("node " + id + " review declaration is required");
  }
  validateReviewDeclaration(node.review, id);
  if (BLOCKING_STATUSES.has(node.status)) {
    validateText(node.blockingReason, "node " + id + " blockingReason", 1000);
  } else if (node.blockingReason !== null) {
    throw new Error("node " + id + " blockingReason must be null for status " + node.status);
  }
  validateUniqueRecordArray(
    node.acceptanceCriteria,
    "acceptanceCriteria",
    CRITERION_FIELDS,
    (item) => validateText(item.statement, "criterion statement", 1000)
  );
  validateUniqueRecordArray(
    node.verification,
    "verification",
    VERIFICATION_FIELDS,
    (item) => {
      if (!new Set(["command", "inspection", "human_ack", "external_check"]).has(item.method)) {
        throw new Error("Unknown verification method: " + item.method);
      }
      validateText(item.instruction, "verification instruction", 2000);
    }
  );
  validateUniqueRecordArray(
    node.deliverables,
    "deliverables",
    DELIVERABLE_FIELDS,
    (item) => {
      validateText(item.description, "deliverable description", 1000);
      if (
        !Array.isArray(item.mediaTypes) ||
        item.mediaTypes.length === 0 ||
        item.mediaTypes.some(
          (mediaType) =>
            typeof mediaType !== "string" ||
            !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(mediaType)
        )
      ) {
        throw new Error("deliverable mediaTypes must contain IANA media types");
      }
      if (new Set(item.mediaTypes).size !== item.mediaTypes.length) {
        throw new Error("deliverable mediaTypes must be unique");
      }
    }
  );
  if (!Array.isArray(node.resourceLocks)) {
    throw new Error("node " + id + " resourceLocks must be an array");
  }
  const locks = new Set();
  for (const lock of node.resourceLocks) {
    validateResourceLock(lock);
    if (locks.has(lock)) throw new Error("Duplicate resource lock: " + lock);
    locks.add(lock);
  }
  if (
    node.allowedScope.length === 0 &&
    !new Set(["human_gate", "external_system"]).has(node.executionSurface)
  ) {
    throw new Error("node " + id + " allowedScope may be empty only for gates");
  }
}

async function assertDirectory(root) {
  const absolute = path.resolve(root);
  const stats = await fs.lstat(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("--root must be an existing non-symlink directory");
  }
  return absolute;
}

async function pathExists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertOwnedAncestorsAreNotSymlinks(file) {
  const absolute = path.resolve(file);
  const segments = absolute.split(path.sep);
  const orchestrationIndex = segments.lastIndexOf("orchestration");
  const ownedDepth =
    orchestrationIndex > 0 && segments[orchestrationIndex - 1] === ".rudi" ? 3 : 1;
  let current = path.dirname(absolute);
  for (let depth = 0; depth < ownedDepth; depth += 1) {
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error("Refusing path with symlinked orchestration ancestor: " + current);
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function writeNewFile(file, content) {
  await assertOwnedAncestorsAreNotSymlinks(file);
  if (await pathExists(file)) throw new Error("Refusing to overwrite existing file: " + file);
  const temporary = file + ".tmp-" + process.pid;
  const handle = await fs.open(temporary, "wx", 0o644);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}

async function replaceOwnedFile(file, content) {
  await assertOwnedAncestorsAreNotSymlinks(file);
  if (await pathExists(file)) {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Refusing to replace non-regular output: " + file);
    }
  }
  const temporary = file + ".tmp-" + process.pid;
  const handle = await fs.open(temporary, "wx", 0o644);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}

async function withExclusiveMutationLock(file, callback) {
  await assertOwnedAncestorsAreNotSymlinks(file);
  const lockPath = file + ".mutation.lock";
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the plan mutation lock: " + lockPath);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  try {
    await handle.writeFile(
      serializeJson({ pid: process.pid, acquiredAt: new Date().toISOString() }),
      "utf8"
    );
    await handle.sync();
    return await callback();
  } finally {
    await handle.close();
    await fs.unlink(lockPath).catch((error) => {
      if (!error || error.code !== "ENOENT") throw error;
    });
  }
}

function serializeJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error("Unknown " + label + " field: " + field);
  }
}

function assertNoDuplicateJsonKeys(raw) {
  let index = 0;
  const skipWhitespace = () => {
    while (index < raw.length && /[\u0020\t\r\n]/u.test(raw[index])) index += 1;
  };
  const readString = () => {
    const start = index;
    index += 1;
    while (index < raw.length) {
      if (raw[index] === "\\") {
        index += 2;
        continue;
      }
      if (raw[index] === '"') {
        index += 1;
        return JSON.parse(raw.slice(start, index));
      }
      index += 1;
    }
    throw new Error("Unterminated JSON string");
  };
  const expectCharacter = (character) => {
    skipWhitespace();
    if (raw[index] !== character) throw new Error("Expected JSON character " + character);
    index += 1;
  };
  const parseValue = () => {
    skipWhitespace();
    if (raw[index] === "{") {
      index += 1;
      const keys = new Set();
      skipWhitespace();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      while (index < raw.length) {
        skipWhitespace();
        if (raw[index] !== '"') throw new Error("JSON object key must be a string");
        const key = readString();
        if (keys.has(key)) throw new Error("Duplicate JSON key: " + key);
        keys.add(key);
        expectCharacter(":");
        parseValue();
        skipWhitespace();
        if (raw[index] === "}") {
          index += 1;
          return;
        }
        expectCharacter(",");
      }
      throw new Error("Unterminated JSON object");
    }
    if (raw[index] === "[") {
      index += 1;
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      while (index < raw.length) {
        parseValue();
        skipWhitespace();
        if (raw[index] === "]") {
          index += 1;
          return;
        }
        expectCharacter(",");
      }
      throw new Error("Unterminated JSON array");
    }
    if (raw[index] === '"') {
      readString();
      return;
    }
    const start = index;
    while (index < raw.length && !/[\s,}\]]/u.test(raw[index])) index += 1;
    if (index === start) throw new Error("Invalid JSON value");
  };
  parseValue();
  skipWhitespace();
  if (index !== raw.length) throw new Error("Trailing JSON content");
}

async function readJsonDocument(file) {
  const absolute = path.resolve(file);
  await assertOwnedAncestorsAreNotSymlinks(absolute);
  const stats = await fs.lstat(absolute);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("JSON input must be a non-symlink regular file: " + file);
  }
  if (stats.size > MAX_JSON_BYTES) {
    throw new Error("JSON input exceeds " + MAX_JSON_BYTES + " bytes");
  }
  const bytes = await fs.readFile(absolute);
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invalid UTF-8 in " + file);
  }
  try {
    assertNoDuplicateJsonKeys(raw);
    return { value: JSON.parse(raw), raw, bytes };
  } catch (error) {
    throw new Error(
      "Invalid JSON in " + file + ": " +
        (error instanceof Error ? error.message : String(error))
    );
  }
}


async function readJsonFile(file) {
  return (await readJsonDocument(file)).value;
}

function assertCanonicalPlanPath(file) {
  const absolute = path.resolve(file);
  const orchestrationRoot = path.dirname(absolute);
  if (
    path.basename(absolute) !== "plan.json" ||
    path.basename(orchestrationRoot) !== "orchestration" ||
    path.basename(path.dirname(orchestrationRoot)) !== ".rudi"
  ) {
    throw new Error(
      "--plan must use the canonical .rudi/orchestration/plan.json layout"
    );
  }
  return absolute;
}

function assertCanonicalRunPath(file) {
  const absolute = path.resolve(file);
  const runsRoot = path.dirname(absolute);
  const orchestrationRoot = path.dirname(runsRoot);
  if (
    path.extname(absolute) !== ".json" ||
    path.basename(runsRoot) !== "runs" ||
    path.basename(orchestrationRoot) !== "orchestration" ||
    path.basename(path.dirname(orchestrationRoot)) !== ".rudi"
  ) {
    throw new Error(
      "--run must use the canonical .rudi/orchestration/runs/<run-id>.json layout"
    );
  }
  return absolute;
}

function assertRunBelongsToPlan(file, planFile, runId = null) {
  const absolute = assertCanonicalRunPath(file);
  const expectedRunsRoot = path.join(
    path.dirname(assertCanonicalPlanPath(planFile)),
    "runs"
  );
  if (path.dirname(absolute) !== expectedRunsRoot) {
    throw new Error("--run must belong to the same manager project as --plan");
  }
  if (runId !== null && path.basename(absolute) !== runId + ".json") {
    throw new Error("--run filename must equal its portable runId");
  }
  return absolute;
}

async function readPlanFile(file) {
  return readJsonFile(assertCanonicalPlanPath(file));
}

async function readRunFile(file, planFile) {
  const absolute = assertRunBelongsToPlan(file, planFile);
  const run = await readJsonFile(absolute);
  if (!isPlainObject(run) || path.basename(absolute) !== run.runId + ".json") {
    throw new Error("--run filename must equal its portable runId");
  }
  return run;
}

async function initializeRun(planPath, runPath, rawInput) {
  if (!isPlainObject(rawInput)) throw new Error("run-init input must be an object");
  assertKnownFields(rawInput, RUN_INIT_INPUT_FIELDS, "run-init input");
  const plan = validatePlan(await readPlanFile(planPath));
  const absoluteRunPath = assertRunBelongsToPlan(runPath, planPath, plan.runId);
  const run = {
    schemaVersion: rawInput.schemaVersion,
    projectId: rawInput.projectId,
    runId: rawInput.runId,
    planRevision: rawInput.planRevision,
    projects: rawInput.projects,
    hosts: rawInput.hosts,
    attempts: [],
    usageReports: [],
    lineage: rawInput.lineage,
  };
  validateRun(plan, run);
  const runsRoot = path.dirname(absoluteRunPath);
  await assertOwnedAncestorsAreNotSymlinks(absoluteRunPath);
  if (await pathExists(runsRoot)) {
    const stats = await fs.lstat(runsRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Canonical runs path must be a non-symlink directory");
    }
  } else {
    await fs.mkdir(runsRoot);
  }
  await writeNewFile(absoluteRunPath, serializeJson(run));
  return run;
}

export function validatePlan(raw) {
  if (!isPlainObject(raw)) throw new Error("plan must be an object");
  assertKnownFields(raw, PLAN_FIELDS, "plan");
  if (!new Set([1, 2]).has(raw.schemaVersion)) {
    throw new Error("plan schemaVersion must be 1 or 2");
  }
  if (raw.schemaVersion === 1 && raw.decisionFrontier !== undefined) {
    throw new Error("schema-v1 plans cannot contain decisionFrontier");
  }
  if (raw.schemaVersion === 2) validateDecisionFrontier(raw.decisionFrontier);
  validateIdentifier(raw.projectId, "plan project ID");
  validateIdentifier(raw.runId, "plan run ID");
  validateText(raw.objective, "plan objective", MAX_OBJECTIVE_LENGTH);
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 1) {
    throw new Error("plan revision must be a positive safe integer");
  }
  if (!Number.isSafeInteger(raw.requestedMaxParallel) || raw.requestedMaxParallel < 1) {
    throw new Error("requestedMaxParallel must be a positive safe integer");
  }
  validateResourceEnvelope(raw.resourceEnvelope);
  validateReviewPolicy(raw.reviewPolicy);
  if (!Array.isArray(raw.nodes)) throw new Error("plan.nodes must be an array");
  if (!Array.isArray(raw.handoffs)) throw new Error("plan.handoffs must be an array");
  const seen = new Set();
  for (let index = 0; index < raw.nodes.length; index += 1) {
    const node = raw.nodes[index];
    if (!isPlainObject(node)) throw new Error("node at index " + index + " must be an object");
    assertKnownFields(node, NODE_FIELDS, "node");
    const id = validateIdentifier(node.id, "node ID");
    if (seen.has(id)) throw new Error("Duplicate node ID: " + id);
    seen.add(id);
    if (!Array.isArray(node.allowedScope)) {
      throw new Error("node " + id + " allowedScope must be an array");
    }
    const paths = new Set();
    for (const scopePath of node.allowedScope) {
      validatePortablePath(scopePath, "node " + id + " allowedScope");
      if (paths.has(scopePath)) throw new Error("Duplicate allowedScope path: " + scopePath);
      paths.add(scopePath);
    }
    validateTarget(node.target, id);
    validateNodeContract(node, id);
    if (!Array.isArray(node.reconciliations)) {
      throw new Error("node " + id + " reconciliations must be an array");
    }
  }
  for (const node of raw.nodes) {
    if (!Array.isArray(node.dependencies)) {
      throw new Error("node " + node.id + " dependencies must be an array");
    }
    const dependencies = new Set();
    for (const dependency of node.dependencies) {
      validateIdentifier(dependency, "dependency ID");
      if (dependencies.has(dependency)) {
        throw new Error("Duplicate dependency " + dependency + " for node " + node.id);
      }
      dependencies.add(dependency);
      if (!seen.has(dependency)) {
        throw new Error("Missing dependency " + dependency + " for node " + node.id);
      }
    }
  }
  const byId = new Map(raw.nodes.map((node) => [node.id, node]));
  if (raw.schemaVersion === 2) {
    for (const receipt of raw.decisionFrontier.promotions) {
      if (receipt.acceptedPlanRevision > raw.revision) {
        throw new Error("promotion receipt revision cannot exceed the plan revision");
      }
      for (const nodeId of receipt.createdNodeIds) {
        if (!byId.has(nodeId)) {
          throw new Error("promotion receipt references unknown node: " + nodeId);
        }
      }
    }
  }
  validateReviewSequences(raw.nodes, raw.reviewPolicy);
  const handoffIds = new Set();
  for (const handoff of raw.handoffs) {
    if (!isPlainObject(handoff)) throw new Error("handoff must be an object");
    assertKnownFields(handoff, HANDOFF_FIELDS, "handoff");
    validateIdentifier(handoff.id, "handoff ID");
    if (handoffIds.has(handoff.id)) throw new Error("Duplicate handoff ID: " + handoff.id);
    handoffIds.add(handoff.id);
    const producer = byId.get(handoff.producerNodeId);
    const consumer = byId.get(handoff.consumerNodeId);
    if (!producer || !consumer) throw new Error("Handoff references an unknown node");
    if (!consumer.dependencies.includes(producer.id)) {
      throw new Error(
        "Handoff consumer " + consumer.id + " must depend on producer " + producer.id
      );
    }
    const deliverable = producer.deliverables.find(
      (item) => item.id === handoff.deliverableId
    );
    if (!deliverable) throw new Error("Handoff references an unknown producer deliverable");
    if (!isPlainObject(handoff.transport)) throw new Error("handoff transport must be an object");
    assertKnownFields(handoff.transport, HANDOFF_TRANSPORT_FIELDS, "handoff transport");
    if (!new Set(["commit", "object", "artifact", "patch"]).has(handoff.transport.medium)) {
      throw new Error("Unknown handoff transport medium");
    }
    if (!deliverable.mediaTypes.includes(handoff.transport.mediaType)) {
      throw new Error("Handoff media type is not declared by the deliverable");
    }
    if (
      JSON.stringify(handoff.requiredEvidence) !==
      JSON.stringify(["uri", "digest", "mediaType"])
    ) {
      throw new Error("handoff requiredEvidence must use the canonical evidence fields");
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId, trail) {
    if (visiting.has(nodeId)) {
      throw new Error("Dependency cycle: " + [...trail, nodeId].join(" -> "));
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = byId.get(nodeId);
    for (const dependency of [...node.dependencies].sort()) {
      visit(dependency, [...trail, nodeId]);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of [...byId.keys()].sort()) visit(nodeId, []);
  const acceptedRevisions = new Set();
  if (raw.schemaVersion === 2) {
    for (const receipt of raw.decisionFrontier.promotions) {
      if (acceptedRevisions.has(receipt.acceptedPlanRevision)) {
        throw new Error(
          "Duplicate accepted plan revision: " + receipt.acceptedPlanRevision
        );
      }
      acceptedRevisions.add(receipt.acceptedPlanRevision);
    }
  }
  for (const node of raw.nodes) {
    validateReconciliations(raw, node);
    for (const record of node.reconciliations) {
      if (acceptedRevisions.has(record.acceptedPlanRevision)) {
        throw new Error(
          "Duplicate accepted plan revision: " + record.acceptedPlanRevision
        );
      }
      acceptedRevisions.add(record.acceptedPlanRevision);
    }
    if (node.status === "done" && !hasCompletionEvidence(raw, node)) {
      throw new Error(
        "Done node " + node.id +
          " requires its latest reconciliation to be complete with current completion evidence"
      );
    }
  }
  return raw;
}

function validateResourceEnvelope(value) {
  if (!isPlainObject(value)) throw new Error("resourceEnvelope is required");
  assertKnownFields(value, RESOURCE_ENVELOPE_FIELDS, "resource envelope");
  for (const field of ["maxElapsedSeconds", "maxTokens"]) {
    if (
      value[field] !== null &&
      (!Number.isSafeInteger(value[field]) || value[field] < 1)
    ) {
      throw new Error(field + " must be null or a positive safe integer");
    }
  }
  for (const field of [
    "softCheckpointElapsedSeconds",
    "softCheckpointTokens",
  ]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1) {
      throw new Error(field + " must be a positive safe integer");
    }
  }
  return value;
}

function validateReviewPolicy(value) {
  if (!isPlainObject(value)) throw new Error("reviewPolicy is required");
  assertKnownFields(value, REVIEW_POLICY_FIELDS, "review policy");
  for (const field of ["maxIndependentReviews", "maxFocusedConfirmations"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 1) {
      throw new Error(field + " must be a positive safe integer");
    }
  }
  if (value.additionalReviewRule !== "unresolved_blocker_or_explicit_authorization") {
    throw new Error("reviewPolicy additionalReviewRule is invalid");
  }
  return value;
}

function frontierDecisionDigest(decision) {
  return (
    "sha256:" +
    crypto.createHash("sha256").update(JSON.stringify(decision)).digest("hex")
  );
}

function frontierAreaDigest(area) {
  return (
    "sha256:" +
    crypto.createHash("sha256").update(JSON.stringify(area)).digest("hex")
  );
}

function validateFrontierAreaBinding(binding, areas, label) {
  if (!isPlainObject(binding)) throw new Error(label + " must be an object");
  assertKnownFields(binding, FRONTIER_AREA_BINDING_FIELDS, label);
  const areaId = validateIdentifier(binding.areaId, label + " areaId");
  if (typeof binding.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(binding.digest)) {
    throw new Error(label + " digest must be lowercase SHA-256");
  }
  const area = areas.get(areaId);
  if (!area || area.status === "open") {
    throw new Error(label + " must reference a terminal area outcome");
  }
  if (binding.digest !== frontierAreaDigest(area)) {
    throw new Error(label + " area digest does not match the plan");
  }
  return binding;
}

function validateFrontierDecisionBinding(binding, decisions, label) {
  if (!isPlainObject(binding)) throw new Error(label + " must be an object");
  assertKnownFields(binding, FRONTIER_DECISION_BINDING_FIELDS, label);
  const decisionId = validateIdentifier(binding.decisionId, label + " decisionId");
  if (typeof binding.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(binding.digest)) {
    throw new Error(label + " digest must be lowercase SHA-256");
  }
  const decision = decisions.get(decisionId);
  if (!decision || decision.status === "proposed") {
    throw new Error(label + " must reference a terminal decision");
  }
  if (binding.digest !== frontierDecisionDigest(decision)) {
    throw new Error(label + " decision digest does not match the plan");
  }
  return binding;
}

function frontierSnapshotDigest(frontier, sourceRevision, areaBindings, decisionBindings) {
  const areas = new Map(frontier.areas.map((area) => [area.id, area]));
  const decisions = new Map(frontier.decisions.map((decision) => [decision.id, decision]));
  const snapshot = {
    initiativeObjective: frontier.initiativeObjective,
    revision: sourceRevision,
    areas: [...areaBindings]
      .sort((left, right) => compareCodeUnits(left.areaId, right.areaId))
      .map((binding) => areas.get(binding.areaId)),
    decisions: [...decisionBindings]
      .sort((left, right) => compareCodeUnits(left.decisionId, right.decisionId))
      .map((binding) => decisions.get(binding.decisionId)),
  };
  return (
    "sha256:" +
    crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
  );
}

function validateDecisionFrontier(value) {
  if (!isPlainObject(value)) throw new Error("decisionFrontier must be an object");
  assertKnownFields(value, DECISION_FRONTIER_FIELDS, "decision frontier");
  validateText(
    value.initiativeObjective,
    "decision frontier initiativeObjective",
    MAX_OBJECTIVE_LENGTH
  );
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error("decision frontier revision must be a positive safe integer");
  }
  if (!Array.isArray(value.areas) || value.areas.length === 0) {
    throw new Error("decision frontier areas must be a non-empty array");
  }
  if (!Array.isArray(value.decisions) || value.decisions.length === 0) {
    throw new Error("decision frontier decisions must be a non-empty array");
  }
  if (!Array.isArray(value.promotions)) {
    throw new Error("decision frontier promotions must be an array");
  }

  const decisions = new Map();
  for (const decision of value.decisions) {
    if (!isPlainObject(decision)) throw new Error("decision record must be an object");
    assertKnownFields(decision, FRONTIER_DECISION_FIELDS, "decision record");
    const id = validateIdentifier(decision.id, "decision record ID");
    if (decisions.has(id)) throw new Error("Duplicate decision record ID: " + id);
    validateText(decision.question, "decision record question", 2000);
    validateNullableText(decision.recommendation, "decision recommendation", 4000);
    if (!new Set(["proposed", "accepted", "rejected", "superseded"]).has(decision.status)) {
      throw new Error("Unknown decision record status: " + decision.status);
    }
    if (decision.status === "proposed") {
      if (
        decision.resolution !== null ||
        decision.approvalRef !== null ||
        decision.decidedAt !== null
      ) {
        throw new Error("proposed decision records cannot claim approval or resolution");
      }
    } else {
      validateText(decision.resolution, "decision resolution", 4000);
      validateText(decision.approvalRef, "decision approval reference", 1000);
      validateCanonicalTimestamp(decision.decidedAt, "decision decidedAt");
    }
    decisions.set(id, decision);
  }

  const areas = new Set();
  for (const area of value.areas) {
    if (!isPlainObject(area)) throw new Error("unresolved area must be an object");
    assertKnownFields(area, FRONTIER_AREA_FIELDS, "unresolved area");
    const id = validateIdentifier(area.id, "unresolved area ID");
    if (areas.has(id)) throw new Error("Duplicate unresolved area ID: " + id);
    areas.add(id);
    validateText(area.question, "unresolved area question", 2000);
    if (!new Set(["open", "resolved", "accepted_deferral", "out_of_scope"]).has(area.status)) {
      throw new Error("Unknown unresolved area status: " + area.status);
    }
    if (!Array.isArray(area.decisionIds)) {
      throw new Error("unresolved area decisionIds must be an array");
    }
    const referencedDecisions = new Set();
    for (const decisionId of area.decisionIds) {
      validateIdentifier(decisionId, "unresolved area decision ID");
      if (referencedDecisions.has(decisionId)) {
        throw new Error("Duplicate unresolved area decision ID: " + decisionId);
      }
      referencedDecisions.add(decisionId);
      if (!decisions.has(decisionId)) {
        throw new Error("Unresolved area references unknown decision: " + decisionId);
      }
    }
    if (area.status === "open") {
      if (
        area.resolution !== null ||
        area.decisionIds.length !== 0 ||
        area.approvalRef !== null ||
        area.decidedAt !== null
      ) {
        throw new Error("open unresolved areas cannot claim a resolution");
      }
      continue;
    }
    validateText(area.resolution, "unresolved area resolution", 4000);
    validateCanonicalTimestamp(area.decidedAt, "unresolved area decidedAt");
    if (area.status === "resolved") {
      if (area.decisionIds.length === 0) {
        throw new Error("resolved areas require at least one accepted decision");
      }
      if (
        [...referencedDecisions].some(
          (decisionId) => decisions.get(decisionId).status !== "accepted"
        )
      ) {
        throw new Error("resolved areas may reference only accepted decisions");
      }
      if (area.approvalRef !== null) {
        throw new Error("resolved area approval belongs on its accepted decision records");
      }
    } else {
      validateText(area.approvalRef, "unresolved area approval reference", 1000);
    }
  }

  const promotionIds = new Set();
  let previousAcceptedPlanRevision = 0;
  let previousSourcePlanRevision = 0;
  let previousSourceFrontierRevision = 0;
  for (const receipt of value.promotions) {
    if (!isPlainObject(receipt)) throw new Error("promotion receipt must be an object");
    assertKnownFields(receipt, FRONTIER_PROMOTION_FIELDS, "promotion receipt");
    const promotionId = validateIdentifier(receipt.promotionId, "promotion ID");
    if (promotionIds.has(promotionId)) throw new Error("Duplicate promotion ID: " + promotionId);
    promotionIds.add(promotionId);
    if (
      typeof receipt.inputDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(receipt.inputDigest)
    ) {
      throw new Error("promotion inputDigest must be lowercase SHA-256");
    }
    for (const field of [
      "sourcePlanRevision",
      "sourceFrontierRevision",
      "acceptedPlanRevision",
    ]) {
      if (!Number.isSafeInteger(receipt[field]) || receipt[field] < 1) {
        throw new Error("promotion " + field + " must be a positive safe integer");
      }
    }
    if (receipt.acceptedPlanRevision !== receipt.sourcePlanRevision + 1) {
      throw new Error("promotion acceptedPlanRevision must immediately follow its source");
    }
    if (receipt.sourcePlanRevision < previousAcceptedPlanRevision) {
      throw new Error("promotion source plan revision must not predate earlier promotion history");
    }
    if (receipt.sourcePlanRevision <= previousSourcePlanRevision) {
      throw new Error("promotion source plan revisions must be strictly increasing");
    }
    previousSourcePlanRevision = receipt.sourcePlanRevision;
    if (receipt.sourceFrontierRevision >= value.revision) {
      throw new Error("promotion sourceFrontierRevision must precede the current frontier");
    }
    if (receipt.sourceFrontierRevision <= previousSourceFrontierRevision) {
      throw new Error("promotion source frontier revisions must be strictly increasing");
    }
    previousSourceFrontierRevision = receipt.sourceFrontierRevision;
    if (receipt.acceptedPlanRevision <= previousAcceptedPlanRevision) {
      throw new Error("promotion receipts must be ordered by accepted plan revision");
    }
    previousAcceptedPlanRevision = receipt.acceptedPlanRevision;
    if (
      typeof receipt.sourceFrontierDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(receipt.sourceFrontierDigest)
    ) {
      throw new Error("promotion sourceFrontierDigest must be lowercase SHA-256");
    }
    if (!Array.isArray(receipt.areaBindings) || receipt.areaBindings.length === 0) {
      throw new Error("promotion areaBindings must be a non-empty array");
    }
    const boundAreaIds = new Set();
    const areaMap = new Map(value.areas.map((area) => [area.id, area]));
    for (const binding of receipt.areaBindings) {
      validateFrontierAreaBinding(binding, areaMap, "promotion area binding");
      if (boundAreaIds.has(binding.areaId)) {
        throw new Error("Duplicate promotion area binding: " + binding.areaId);
      }
      boundAreaIds.add(binding.areaId);
    }
    if (!Array.isArray(receipt.decisionBindings) || receipt.decisionBindings.length === 0) {
      throw new Error("promotion decisionBindings must be a non-empty array");
    }
    const boundDecisionIds = new Set();
    for (const binding of receipt.decisionBindings) {
      validateFrontierDecisionBinding(binding, decisions, "promotion decision binding");
      if (boundDecisionIds.has(binding.decisionId)) {
        throw new Error("Duplicate promotion decision binding: " + binding.decisionId);
      }
      boundDecisionIds.add(binding.decisionId);
    }
    if (
      receipt.sourceFrontierDigest !==
      frontierSnapshotDigest(
        value,
        receipt.sourceFrontierRevision,
        receipt.areaBindings,
        receipt.decisionBindings
      )
    ) {
      throw new Error("promotion source frontier digest does not match bound outcomes");
    }
    validateText(receipt.approvalRef, "promotion approval reference", 1000);
    validateText(
      receipt.implementationAuthorizationRef,
      "promotion implementation authorization reference",
      1000
    );
    if (receipt.approvalRef === receipt.implementationAuthorizationRef) {
      throw new Error("promotion approval and implementation authorization must be distinct");
    }
    validateCanonicalTimestamp(receipt.promotedAt, "promotion promotedAt");
    const boundOutcomeTimestamps = [
      ...receipt.areaBindings.map((binding) => areaMap.get(binding.areaId).decidedAt),
      ...receipt.decisionBindings.map((binding) => decisions.get(binding.decisionId).decidedAt),
    ];
    if (boundOutcomeTimestamps.some((decidedAt) => receipt.promotedAt < decidedAt)) {
      throw new Error("promotion timestamp must not predate a bound approval");
    }
    if (!Array.isArray(receipt.createdNodeIds) || receipt.createdNodeIds.length === 0) {
      throw new Error("promotion createdNodeIds must be a non-empty array");
    }
    const createdNodeIds = new Set();
    for (const nodeId of receipt.createdNodeIds) {
      validateIdentifier(nodeId, "promoted node ID");
      if (createdNodeIds.has(nodeId)) throw new Error("Duplicate promoted node ID: " + nodeId);
      createdNodeIds.add(nodeId);
    }
  }
  return value;
}

function validateFrontierPromotionInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("promotion input must be an object");
  assertKnownFields(raw, FRONTIER_PROMOTION_INPUT_FIELDS, "promotion input");
  if (raw.schemaVersion !== 1) throw new Error("promotion input schemaVersion must be 1");
  if (raw.projectId !== plan.projectId || raw.runId !== plan.runId) {
    throw new Error("promotion project or run identity does not match the plan");
  }
  validateIdentifier(raw.promotionId, "promotion ID");
  for (const field of ["expectedPlanRevision", "expectedFrontierRevision"]) {
    if (!Number.isSafeInteger(raw[field]) || raw[field] < 1) {
      throw new Error(field + " must be a positive safe integer");
    }
  }
  if (!Array.isArray(raw.areaBindings) || raw.areaBindings.length === 0) {
    throw new Error("promotion areaBindings must be a non-empty array");
  }
  if (!Array.isArray(raw.decisionBindings) || raw.decisionBindings.length === 0) {
    throw new Error("promotion decisionBindings must be a non-empty array");
  }
  validateText(raw.approvalRef, "promotion approval reference", 1000);
  validateText(
    raw.implementationAuthorizationRef,
    "promotion implementation authorization reference",
    1000
  );
  if (raw.approvalRef === raw.implementationAuthorizationRef) {
    throw new Error("promotion approval and implementation authorization must be distinct");
  }
  validateCanonicalTimestamp(raw.promotedAt, "promotion promotedAt");
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    throw new Error("promotion nodes must be a non-empty array");
  }
  return raw;
}

export function promoteDecisionFrontier(plan, rawInput, rawBytes) {
  validatePlan(plan);
  if (!isPlainObject(rawInput)) throw new Error("promotion input must be an object");
  const inputDigest =
    "sha256:" + crypto.createHash("sha256").update(rawBytes).digest("hex");
  const proposedId = rawInput.promotionId;
  if (plan.schemaVersion === 2) {
    const existing = plan.decisionFrontier.promotions.find(
      (receipt) => receipt.promotionId === proposedId
    );
    if (existing) {
      if (existing.inputDigest === inputDigest) {
        return { receipt: existing, idempotent: true };
      }
      throw new Error("Conflicting duplicate promotion ID: " + proposedId);
    }
  }
  const input = validateFrontierPromotionInput(plan, rawInput);
  if (plan.schemaVersion !== 2) {
    throw new Error("promotion requires a schema-v2 plan with decisionFrontier");
  }
  const frontier = plan.decisionFrontier;
  if (
    input.expectedPlanRevision !== plan.revision ||
    input.expectedFrontierRevision !== frontier.revision
  ) {
    throw new Error("promotion expected revisions are stale");
  }
  if (frontier.areas.some((area) => area.status === "open")) {
    throw new Error("promotion requires every unresolved area to be closed");
  }
  if (frontier.decisions.some((decision) => decision.status === "proposed")) {
    throw new Error("promotion requires every decision record to be terminal");
  }

  const decisions = new Map(frontier.decisions.map((decision) => [decision.id, decision]));
  const areas = new Map(frontier.areas.map((area) => [area.id, area]));
  const areaBindingIds = new Set();
  for (const binding of input.areaBindings) {
    validateFrontierAreaBinding(binding, areas, "promotion area binding");
    if (areaBindingIds.has(binding.areaId)) {
      throw new Error("Duplicate promotion area binding: " + binding.areaId);
    }
    areaBindingIds.add(binding.areaId);
  }
  const bindingIds = new Set();
  for (const binding of input.decisionBindings) {
    validateFrontierDecisionBinding(binding, decisions, "promotion decision binding");
    if (bindingIds.has(binding.decisionId)) {
      throw new Error("Duplicate promotion decision binding: " + binding.decisionId);
    }
    bindingIds.add(binding.decisionId);
  }
  if (
    JSON.stringify([...bindingIds].sort(compareCodeUnits)) !==
    JSON.stringify(frontier.decisions.map((decision) => decision.id).sort(compareCodeUnits))
  ) {
    throw new Error("promotion decision bindings must exactly cover the frontier snapshot");
  }
  if (
    JSON.stringify([...areaBindingIds].sort(compareCodeUnits)) !==
    JSON.stringify(frontier.areas.map((area) => area.id).sort(compareCodeUnits))
  ) {
    throw new Error("promotion area bindings must exactly cover the frontier snapshot");
  }

  const existingNodeIds = new Set(plan.nodes.map((node) => node.id));
  const createdNodeIds = [];
  for (const node of input.nodes) {
    if (!isPlainObject(node)) throw new Error("promoted node must be an object");
    const nodeId = validateIdentifier(node.id, "promoted node ID");
    if (existingNodeIds.has(nodeId) || createdNodeIds.includes(nodeId)) {
      throw new Error("Promoted node ID already exists: " + nodeId);
    }
    if (node.status !== "proposed") {
      throw new Error("promoted nodes must begin in proposed status");
    }
    if (!Array.isArray(node.reconciliations) || node.reconciliations.length !== 0) {
      throw new Error("promoted nodes cannot contain reconciliation history");
    }
    createdNodeIds.push(nodeId);
  }

  const receipt = {
    promotionId: input.promotionId,
    inputDigest,
    sourcePlanRevision: plan.revision,
    sourceFrontierRevision: frontier.revision,
    sourceFrontierDigest: frontierSnapshotDigest(
      frontier,
      frontier.revision,
      input.areaBindings,
      input.decisionBindings
    ),
    areaBindings: structuredClone(input.areaBindings),
    decisionBindings: structuredClone(input.decisionBindings),
    approvalRef: input.approvalRef,
    implementationAuthorizationRef: input.implementationAuthorizationRef,
    promotedAt: input.promotedAt,
    createdNodeIds,
    acceptedPlanRevision: plan.revision + 1,
  };
  const candidate = structuredClone(plan);
  candidate.revision += 1;
  candidate.nodes.push(...structuredClone(input.nodes));
  candidate.decisionFrontier.revision += 1;
  candidate.decisionFrontier.promotions.push(receipt);
  validatePlan(candidate);
  for (const key of Object.keys(plan)) delete plan[key];
  Object.assign(plan, candidate);
  return { receipt, idempotent: false };
}

function validateReviewDeclaration(value, nodeId) {
  if (value === null) return null;
  if (!isPlainObject(value)) throw new Error("node " + nodeId + " review must be null or an object");
  assertKnownFields(value, REVIEW_FIELDS, "review declaration");
  if (!new Set(["independent", "focused_confirmation"]).has(value.kind)) {
    throw new Error("node " + nodeId + " review kind is invalid");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) {
    throw new Error("node " + nodeId + " review sequence must be a positive safe integer");
  }
  validateNullableText(value.authorizationRef, "review authorization reference", 1000);
  validateNullableText(value.unresolvedBlockerRef, "review unresolved blocker reference", 1000);
  return value;
}

function validateReviewSequences(nodes, policy) {
  for (const [kind, limitField] of [
    ["independent", "maxIndependentReviews"],
    ["focused_confirmation", "maxFocusedConfirmations"],
  ]) {
    const reviews = nodes
      .filter((node) => node.review?.kind === kind)
      .sort((left, right) => left.review.sequence - right.review.sequence);
    for (let index = 0; index < reviews.length; index += 1) {
      const review = reviews[index].review;
      if (review.sequence !== index + 1) {
        throw new Error(kind + " review sequences must be unique and contiguous from 1");
      }
      if (
        review.sequence > policy[limitField] &&
        review.authorizationRef === null &&
        review.unresolvedBlockerRef === null
      ) {
        throw new Error(
          "Additional " + kind +
            " review requires an unresolved blocker or explicit authorization"
        );
      }
    }
  }
}

export function calculateStaticReadiness(plan) {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const ready = [];
  const blocked = [];
  for (const node of [...plan.nodes].sort((left, right) => compareCodeUnits(left.id, right.id))) {
    const reasons = [];
    if (node.status !== "ready") reasons.push("status_not_ready");
    if (node.dependencies.some((dependency) => byId.get(dependency).status !== "done")) {
      reasons.push("dependency_not_done");
    }
    if (reasons.length > 0) {
      blocked.push({ nodeId: node.id, reasons });
    } else {
      ready.push({ nodeId: node.id, placement: "unverified" });
    }
  }
  return { mode: "static", planRevision: plan.revision, ready, blocked };
}

function isActiveAttempt(attempt) {
  return (
    new Set(["prepared", "accepted", "dispatch_indeterminate"]).has(
      attempt.dispatchState
    ) && attempt.terminationOutcome === null
  );
}

function matchesProjectLocator(locator, project) {
  const resolved = project.locator;
  return (
    (locator.projectId === undefined || locator.projectId === resolved.projectId) &&
    (locator.repository === undefined || locator.repository === project.repositoryIdentity) &&
    (locator.absolutePath === undefined || locator.absolutePath === project.resolvedRoot)
  );
}

function requiredCapabilitiesForNode(node) {
  const required = new Set(node.target.host?.requiredCapabilities ?? []);
  const surfaceCapability = SURFACE_CAPABILITIES.get(node.executionSurface);
  if (surfaceCapability) required.add(surfaceCapability);
  return [...required].sort();
}

function hostSupportsModelSelection(host, modelSelection) {
  return host.modelProfiles.some(
    (profile) =>
      profile.provider === modelSelection.provider &&
      profile.model === modelSelection.model &&
      profile.reasoningProfiles.includes(modelSelection.reasoningProfile)
  );
}

function resolveRoute(node, run) {
  const requestedStartingState = normalizedStartingState(node.target);
  const projects = run.projects.filter(
    (project) =>
      matchesProjectLocator(node.target.project, project) &&
      startingStatesEqual(requestedStartingState, project.startingState)
  );
  if (projects.length === 0) return { reasons: ["project_unresolved"] };
  let routes = projects.flatMap((project) =>
    run.hosts
      .filter(
        (host) =>
          project.hostBindingId === null ||
          host.hostBindingId === project.hostBindingId
      )
      .map((host) => ({ project, host }))
  );
  const requestedHost = node.target.host;
  routes = routes.filter(
    ({ host }) =>
      !requestedHost?.selector || requestedHost.selector === host.selector
  );
  if (routes.length === 0) return { reasons: ["host_unresolved"] };
  const required = requiredCapabilitiesForNode(node);
  routes = routes.filter(({ host }) =>
    required.every((capability) => host.capabilities.includes(capability))
  );
  if (routes.length === 0) return { reasons: ["capability_missing"] };
  if (node.target.modelSelection !== undefined) {
    routes = routes.filter(({ host }) =>
      hostSupportsModelSelection(host, node.target.modelSelection)
    );
    if (routes.length === 0) return { reasons: ["model_unavailable"] };
  }
  routes = routes.filter(
    ({ host }) =>
      node.target.workspaceMode !== "isolated_worktree" ||
      host.capabilities.includes("git_worktrees")
  );
  if (routes.length === 0) return { reasons: ["workspace_mismatch"] };
  if (requestedStartingState.policy === "default_branch") {
    routes = routes.filter(({ project }) => project.defaultBranch !== null);
    if (routes.length === 0) return { reasons: ["revision_mismatch"] };
  }
  const projectIds = new Set(
    routes.map(({ project }) => project.projectBindingId)
  );
  if (projectIds.size > 1) return { reasons: ["project_mismatch"] };
  const hostIds = new Set(routes.map(({ host }) => host.hostBindingId));
  if (hostIds.size > 1) return { reasons: ["host_ambiguous"] };
  return { ...routes[0], reasons: [] };
}

function validateNullableText(value, label, maxLength = 2000) {
  if (value === null) return null;
  return validateText(value, label, maxLength);
}

function validateAbsolutePath(value, label) {
  const checked = validateText(value, label, 2000);
  if (!path.isAbsolute(checked) && !/^[a-zA-Z]:[\\/]/u.test(checked)) {
    throw new Error(label + " must be absolute");
  }
  return checked;
}

function validateProjectLocatorRecord(locator, label) {
  if (!isPlainObject(locator)) throw new Error(label + " must be an object");
  assertKnownFields(locator, PROJECT_LOCATOR_FIELDS, label);
  if (![...PROJECT_LOCATOR_FIELDS].some((field) => locator[field] !== undefined)) {
    throw new Error(label + " requires at least one field");
  }
  if (locator.projectId !== undefined) validateIdentifier(locator.projectId, label + " project ID");
  if (locator.repository !== undefined) {
    const repository = validateText(locator.repository, label + " repository", 1000);
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(repository)) {
      const parsed = new URL(repository);
      if (parsed.username || parsed.password) throw new Error(label + " repository contains credentials");
    }
  }
  if (locator.absolutePath !== undefined) {
    validateAbsolutePath(locator.absolutePath, label + " absolutePath");
  }
}

function attemptHasAcceptedReconciliation(node, attempt) {
  return node.reconciliations.some((record) =>
    attemptMatchesAcceptedReconciliation(attempt, record)
  );
}

function attemptMatchesAcceptedReconciliation(attempt, record) {
  const reference = attempt.resultReference;
  if (!isPlainObject(reference)) return false;
  const expectedKind = record.resultId !== null ? "result" : "cancellation";
  const expectedId = record.resultId ?? record.cancellationId;
  return (
    record.attemptId === attempt.attemptId &&
    reference.kind === expectedKind &&
    reference.id === expectedId &&
    reference.acceptedPlanRevision === record.acceptedPlanRevision &&
    reconciliationMatchesAttemptLifecycle(record, attempt)
  );
}

function reconciliationMatchesAttemptLifecycle(record, attempt) {
  if (record.resultId !== null) {
    return (
      attempt.dispatchState === "accepted" &&
      attempt.terminationOutcome === record.outcome
    );
  }
  return (
    attempt.terminationOutcome === "cancelled" ||
    (new Set(["prepared", "route_failed"]).has(attempt.dispatchState) &&
      attempt.terminationOutcome === null)
  );
}

function validateRun(plan, run) {
  if (!isPlainObject(run)) throw new Error("run must be an object");
  assertKnownFields(run, RUN_FIELDS, "run");
  if (
    run.schemaVersion !== 1 ||
    run.projectId !== plan.projectId ||
    run.runId !== plan.runId ||
    run.planRevision !== plan.revision
  ) {
    throw new Error("Run identity or plan revision does not match the plan");
  }
  if (!Array.isArray(run.projects) || !Array.isArray(run.hosts) || !Array.isArray(run.attempts)) {
    throw new Error("run projects, hosts, and attempts must be arrays");
  }

  const hostIds = new Set();
  for (const host of run.hosts) {
    if (!isPlainObject(host)) throw new Error("run host must be an object");
    assertKnownFields(host, HOST_BINDING_FIELDS, "host binding");
    validateIdentifier(host.hostBindingId, "host binding ID");
    if (hostIds.has(host.hostBindingId)) throw new Error("Duplicate host binding ID: " + host.hostBindingId);
    hostIds.add(host.hostBindingId);
    if (host.selector !== null) validateIdentifier(host.selector, "host selector");
    validateNullableText(host.nativeHostId, "native host ID");
    if (!Array.isArray(host.capabilities)) throw new Error("host capabilities must be an array");
    const capabilities = new Set();
    for (const capability of host.capabilities) {
      if (typeof capability !== "string" || !/^[a-z][a-z0-9._:/-]{0,127}$/u.test(capability)) {
        throw new Error("Invalid host capability: " + String(capability));
      }
      if (capabilities.has(capability)) throw new Error("Duplicate host capability: " + capability);
      capabilities.add(capability);
    }
    if (JSON.stringify(host.capabilities) !== JSON.stringify([...host.capabilities].sort())) {
      throw new Error("host capabilities must be sorted");
    }
    if (!Array.isArray(host.modelProfiles)) {
      throw new Error("host modelProfiles must be an array");
    }
    const modelProfileKeys = new Set();
    for (const profile of host.modelProfiles) {
      if (!isPlainObject(profile)) throw new Error("host model profile must be an object");
      assertKnownFields(profile, MODEL_PROFILE_FIELDS, "host model profile");
      validateIdentifier(profile.provider, "host model provider");
      validateText(profile.model, "host model", 200);
      if (!Array.isArray(profile.reasoningProfiles) || profile.reasoningProfiles.length === 0) {
        throw new Error("host model reasoningProfiles must be a non-empty array");
      }
      const profiles = new Set();
      for (const reasoningProfile of profile.reasoningProfiles) {
        validateText(reasoningProfile, "host reasoning profile", 100);
        if (profiles.has(reasoningProfile)) {
          throw new Error("Duplicate host reasoning profile: " + reasoningProfile);
        }
        profiles.add(reasoningProfile);
      }
      if (
        JSON.stringify(profile.reasoningProfiles) !==
        JSON.stringify([...profile.reasoningProfiles].sort(compareCodeUnits))
      ) {
        throw new Error("host reasoningProfiles must be code-unit sorted");
      }
      const profileKey = profile.provider + "\u0000" + profile.model;
      if (modelProfileKeys.has(profileKey)) throw new Error("Duplicate host model profile");
      modelProfileKeys.add(profileKey);
    }
    const sortedProfileKeys = [...modelProfileKeys].sort(compareCodeUnits);
    if (JSON.stringify([...modelProfileKeys]) !== JSON.stringify(sortedProfileKeys)) {
      throw new Error("host modelProfiles must be code-unit sorted");
    }
    if (!Number.isSafeInteger(host.maxConcurrency) || host.maxConcurrency < 1) {
      throw new Error("host maxConcurrency must be a positive safe integer");
    }
    if (typeof host.supportsReversibleArchive !== "boolean") {
      throw new Error("supportsReversibleArchive must be boolean");
    }
    validateCanonicalTimestamp(host.discoveredAt, "host discoveredAt");
  }

  const projectIds = new Set();
  for (const project of run.projects) {
    if (!isPlainObject(project)) throw new Error("run project must be an object");
    assertKnownFields(project, PROJECT_BINDING_FIELDS, "project binding");
    validateIdentifier(project.projectBindingId, "project binding ID");
    if (projectIds.has(project.projectBindingId)) {
      throw new Error("Duplicate project binding ID: " + project.projectBindingId);
    }
    projectIds.add(project.projectBindingId);
    if (project.hostBindingId !== null && !hostIds.has(project.hostBindingId)) {
      throw new Error("project binding references unknown host: " + project.hostBindingId);
    }
    validateProjectLocatorRecord(project.locator, "project binding locator");
    validateNullableText(project.nativeSavedProjectId, "native saved-project ID");
    if (project.repositoryIdentity !== null) {
      const repository = validateText(project.repositoryIdentity, "repository identity", 1000);
      if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(repository)) {
        const parsed = new URL(repository);
        if (parsed.username || parsed.password) throw new Error("repository identity contains credentials");
      }
    }
    validateAbsolutePath(project.resolvedRoot, "resolved project root");
    validateStartingState(project.startingState, "project startingState");
    validateText(project.observedRevision, "observed revision", 500);
    validateNullableText(project.defaultBranch, "default branch", 500);
    validateCanonicalTimestamp(project.discoveredAt, "project discoveredAt");
  }

  const attemptIds = new Set();
  const idempotencyKeys = new Set();
  const activeNodeIds = new Set();
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  for (const attempt of run.attempts) {
    if (!isPlainObject(attempt)) throw new Error("run attempt must be an object");
    assertKnownFields(attempt, ATTEMPT_FIELDS, "attempt");
    validateIdentifier(attempt.attemptId, "attempt ID");
    if (attemptIds.has(attempt.attemptId)) throw new Error("Duplicate attempt ID: " + attempt.attemptId);
    attemptIds.add(attempt.attemptId);
    if (
      !Number.isSafeInteger(attempt.preparedPlanRevision) ||
      attempt.preparedPlanRevision < 1 ||
      attempt.preparedPlanRevision > plan.revision
    ) {
      throw new Error("attempt preparedPlanRevision is invalid");
    }
    validateCanonicalTimestamp(attempt.preparedAt, "attempt preparedAt");
    const node = nodes.get(attempt.nodeId);
    if (!node) throw new Error("attempt references unknown node: " + attempt.nodeId);
    if (!isPlainObject(attempt.binding)) throw new Error("attempt binding must be an object");
    assertKnownFields(attempt.binding, ATTEMPT_BINDING_FIELDS, "attempt binding");
    const binding = attempt.binding;
    if (!projectIds.has(binding.projectBindingId)) throw new Error("attempt references unknown project binding");
    if (!hostIds.has(binding.hostBindingId)) throw new Error("attempt references unknown host binding");
    const boundProject = run.projects.find(
      (project) => project.projectBindingId === binding.projectBindingId
    );
    const boundHost = run.hosts.find((host) => host.hostBindingId === binding.hostBindingId);
    const isHistorical =
      attemptHasAcceptedReconciliation(node, attempt) || !isActiveAttempt(attempt);
    if (
      boundProject.hostBindingId !== null &&
      boundProject.hostBindingId !== binding.hostBindingId
    ) {
      throw new Error("attempt host binding does not match project discovery");
    }
    if (!VALID_SURFACES.has(binding.executionSurface)) {
      throw new Error("Unknown attempt execution surface");
    }
    if (!new Set(["direct", "isolated_worktree"]).has(binding.workspaceMode)) {
      throw new Error("Unknown attempt workspace mode");
    }
    const boundSurfaceCapability = SURFACE_CAPABILITIES.get(binding.executionSurface);
    if (
      boundSurfaceCapability &&
      !boundHost.capabilities.includes(boundSurfaceCapability)
    ) {
      throw new Error("attempt host cannot provide its execution surface");
    }
    if (binding.workspaceMode === "isolated_worktree" && !boundHost.capabilities.includes("git_worktrees")) {
      throw new Error("attempt host cannot provide an isolated worktree");
    }
    if (!isHistorical) {
      if (!matchesProjectLocator(node.target.project, boundProject)) {
        throw new Error("attempt project binding does not match node target");
      }
      if (
        !startingStatesEqual(
          normalizedStartingState(node.target),
          boundProject.startingState
        )
      ) {
        throw new Error("attempt starting-state binding does not match node target");
      }
      if (node.target.host?.selector && node.target.host.selector !== boundHost.selector) {
        throw new Error("attempt host binding does not match node target");
      }
      if (
        requiredCapabilitiesForNode(node).some(
          (capability) => !boundHost.capabilities.includes(capability)
        )
      ) {
        throw new Error("attempt host binding lacks a required capability");
      }
      if (binding.executionSurface !== node.executionSurface) {
        throw new Error("attempt execution surface does not match node");
      }
      if (binding.workspaceMode !== node.target.workspaceMode) {
        throw new Error("attempt workspace mode does not match node");
      }
      if (JSON.stringify(binding.resourceLocks) !== JSON.stringify(node.resourceLocks)) {
        throw new Error("attempt resource locks do not match node");
      }
    }
    validateAbsolutePath(binding.actualCwd, "attempt actualCwd");
    if (binding.actualWorktree !== null) validateAbsolutePath(binding.actualWorktree, "attempt actualWorktree");
    if (binding.workspaceMode === "isolated_worktree" && binding.actualWorktree === null) {
      throw new Error("isolated worktree attempt requires actualWorktree");
    }
    if (
      binding.workspaceMode === "isolated_worktree" &&
      binding.actualWorktree !== binding.actualCwd
    ) {
      throw new Error("isolated worktree attempt cwd must equal actualWorktree");
    }
    if (
      binding.workspaceMode === "direct" &&
      (binding.actualWorktree !== null || binding.actualCwd !== boundProject.resolvedRoot)
    ) {
      throw new Error("direct attempt must use the resolved project root without a worktree");
    }
    validateText(binding.observedRevision, "attempt observedRevision", 500);
    if (binding.observedRevision !== boundProject.observedRevision) {
      throw new Error("attempt observed revision does not match project discovery");
    }
    validateNullableText(binding.branch, "attempt branch", 500);
    if (!Array.isArray(binding.resourceLocks)) {
      throw new Error("attempt resource locks must be an array");
    }
    const bindingLocks = new Set();
    for (const lock of binding.resourceLocks) {
      validateResourceLock(lock);
      if (bindingLocks.has(lock)) throw new Error("Duplicate attempt resource lock: " + lock);
      bindingLocks.add(lock);
    }
    validateNullableText(binding.authorizationRef, "attempt authorization reference", 1000);
    if (binding.executionSurface === "desktop_task" && binding.authorizationRef === null) {
      throw new Error("desktop task attempt requires explicit authorization reference");
    }
    validateIdentifier(binding.idempotencyKey, "attempt idempotency key");
    if (idempotencyKeys.has(binding.idempotencyKey)) throw new Error("Duplicate attempt idempotency key");
    idempotencyKeys.add(binding.idempotencyKey);
    validateModelSelection(binding.modelSelection, "attempt model selection");
    if (!hostSupportsModelSelection(boundHost, binding.modelSelection)) {
      throw new Error("attempt model selection is unavailable on its bound host");
    }
    if (
      !isHistorical &&
      JSON.stringify(binding.modelSelection) !==
        JSON.stringify(node.target.modelSelection)
    ) {
      throw new Error("attempt model selection does not match node target");
    }

    if (!isPlainObject(attempt.nativeIds)) throw new Error("attempt nativeIds must be an object");
    assertKnownFields(attempt.nativeIds, NATIVE_ID_FIELDS, "native IDs");
    for (const [name, value] of Object.entries(attempt.nativeIds)) {
      validateNullableText(value, "native " + name, 2000);
    }
    if (!new Set(["prepared", "route_failed", "accepted", "dispatch_indeterminate"]).has(attempt.dispatchState)) {
      throw new Error("Unknown attempt dispatchState");
    }
    if (attempt.terminationOutcome !== null && !new Set(["complete", "partial", "failed", "cancelled"]).has(attempt.terminationOutcome)) {
      throw new Error("Unknown attempt terminationOutcome");
    }
    if (
      new Set(["prepared", "route_failed", "dispatch_indeterminate"]).has(
        attempt.dispatchState
      ) &&
      attempt.terminationOutcome !== null
    ) {
      throw new Error(
        "attempt lifecycle requires accepted dispatch before a terminal outcome"
      );
    }
    validateNullableText(attempt.nativeLifecycle, "attempt nativeLifecycle", 500);
    if (!Array.isArray(attempt.dispatchHistory)) {
      throw new Error("attempt dispatchHistory must be an array");
    }
    if (attempt.dispatchState !== "prepared" && attempt.dispatchHistory.length === 0) {
      throw new Error(
        attempt.dispatchState + " dispatch requires recorded dispatch history"
      );
    }
    if (attempt.dispatchState === "prepared" && attempt.dispatchHistory.length > 0) {
      throw new Error("prepared dispatch cannot have recorded dispatch history");
    }
    let replayedDispatchState = "prepared";
    let previousDispatchRecordedAt = null;
    const dispatchIds = new Set();
    for (const record of attempt.dispatchHistory) {
      validateDispatchRecord(record);
      if (dispatchIds.has(record.dispatchId)) throw new Error("Duplicate dispatch ID");
      dispatchIds.add(record.dispatchId);
      if (
        previousDispatchRecordedAt !== null &&
        record.recordedAt <= previousDispatchRecordedAt
      ) {
        throw new Error("dispatch records must be chronologically ordered");
      }
      previousDispatchRecordedAt = record.recordedAt;
      if (
        replayedDispatchState === "prepared" ||
        (replayedDispatchState === "dispatch_indeterminate" &&
          new Set(["accepted", "route_failed"]).has(record.dispatchState))
      ) {
        replayedDispatchState = record.dispatchState;
      } else {
        throw new Error(
          "Invalid recorded dispatch transition from " + replayedDispatchState
        );
      }
    }
    if (attempt.dispatchHistory.length > 0) {
      const latestDispatch = attempt.dispatchHistory.at(-1);
      if (
        replayedDispatchState !== attempt.dispatchState ||
        JSON.stringify(latestDispatch.nativeIds) !== JSON.stringify(attempt.nativeIds) ||
        (attempt.terminationHistory.length === 0 &&
          latestDispatch.nativeLifecycle !== attempt.nativeLifecycle) ||
        attempt.dispatchTimestamp !== attempt.dispatchHistory[0].recordedAt
      ) {
        throw new Error("attempt dispatch state does not match its recorded history");
      }
    }
    if (!Array.isArray(attempt.terminationHistory)) {
      throw new Error("attempt terminationHistory must be an array");
    }
    if (attempt.terminationOutcome !== null && attempt.terminationHistory.length === 0) {
      throw new Error("terminal outcome requires recorded termination history");
    }
    if (attempt.terminationHistory.length > 1) {
      throw new Error("attempt may have only one native termination record");
    }
    if (attempt.terminationHistory.length === 1) {
      const termination = validateTerminationRecord(attempt.terminationHistory[0]);
      if (
        attempt.dispatchState !== "accepted" ||
        attempt.terminationOutcome !== termination.outcome ||
        attempt.nativeLifecycle !== termination.nativeLifecycle ||
        (attempt.dispatchTimestamp !== null &&
          termination.recordedAt <= attempt.dispatchTimestamp)
      ) {
        throw new Error("attempt termination state does not match its recorded history");
      }
    }
    if (!Array.isArray(attempt.pendingSteering)) throw new Error("pendingSteering must be an array");
    const steeringIds = new Set();
    for (const steering of attempt.pendingSteering) {
      if (!isPlainObject(steering)) throw new Error("steering record must be an object");
      assertKnownFields(steering, STEERING_FIELDS, "steering");
      validateIdentifier(steering.steeringId, "steering ID");
      if (steeringIds.has(steering.steeringId)) throw new Error("Duplicate steering ID");
      steeringIds.add(steering.steeringId);
      if (typeof steering.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(steering.payloadDigest)) {
        throw new Error("steering payloadDigest must be lowercase SHA-256");
      }
      validateCanonicalTimestamp(steering.createdAt, "steering createdAt");
      validateCanonicalTimestamp(steering.updatedAt, "steering updatedAt");
      if (steering.updatedAt < steering.createdAt) {
        throw new Error("steering updatedAt cannot precede createdAt");
      }
      if (!new Set(["pending", "delivered", "rejected", "indeterminate"]).has(steering.state)) {
        throw new Error("Unknown steering state");
      }
    }
    if (attempt.dispatchTimestamp !== null) validateCanonicalTimestamp(attempt.dispatchTimestamp, "dispatchTimestamp");
    if (!isPlainObject(attempt.archive)) throw new Error("attempt archive must be an object");
    assertKnownFields(attempt.archive, ARCHIVE_FIELDS, "archive");
    if (!new Set(["not_archived", "archived", "archive_failed"]).has(attempt.archive.state)) {
      throw new Error("Unknown archive state");
    }
    if (attempt.archive.state === "archived") {
      validateCanonicalTimestamp(attempt.archive.archivedAt, "archivedAt");
      validateCanonicalTimestamp(attempt.archive.lastAttemptedAt, "archive lastAttemptedAt");
      if (attempt.archive.archivedAt !== attempt.archive.lastAttemptedAt) {
        throw new Error("archivedAt must equal lastAttemptedAt for archived attempts");
      }
    } else if (attempt.archive.state === "archive_failed") {
      if (attempt.archive.archivedAt !== null) {
        throw new Error("archivedAt is valid only for archived attempts");
      }
      validateCanonicalTimestamp(attempt.archive.lastAttemptedAt, "archive lastAttemptedAt");
    } else if (
      attempt.archive.archivedAt !== null ||
      attempt.archive.lastAttemptedAt !== null
    ) {
      throw new Error("not_archived attempts cannot have archive timestamps");
    }
    if (!Array.isArray(attempt.archiveHistory)) {
      throw new Error("attempt archiveHistory must be an array");
    }
    let archiveTerminal = false;
    let previousArchiveRecordedAt = null;
    const archiveIds = new Set();
    for (const record of attempt.archiveHistory) {
      validateArchiveRecord(record);
      if (archiveIds.has(record.archiveId)) throw new Error("Duplicate archive ID");
      archiveIds.add(record.archiveId);
      if (
        previousArchiveRecordedAt !== null &&
        record.recordedAt <= previousArchiveRecordedAt
      ) {
        throw new Error("archive records must be chronologically ordered");
      }
      if (archiveTerminal) throw new Error("archived state is terminal");
      archiveTerminal = record.state === "archived";
      previousArchiveRecordedAt = record.recordedAt;
    }
    if (attempt.archiveHistory.length > 0) {
      const latestArchive = attempt.archiveHistory.at(-1);
      if (
        attempt.archive.state !== latestArchive.state ||
        attempt.archive.lastAttemptedAt !== latestArchive.recordedAt ||
        attempt.archive.archivedAt !==
          (latestArchive.state === "archived" ? latestArchive.recordedAt : null)
      ) {
        throw new Error("attempt archive state does not match its recorded history");
      }
    }
    if (attempt.resultReference !== null) {
      if (!isPlainObject(attempt.resultReference)) throw new Error("resultReference must be an object");
      assertKnownFields(attempt.resultReference, RESULT_REFERENCE_FIELDS, "result reference");
      if (!new Set(["result", "cancellation"]).has(attempt.resultReference.kind)) {
        throw new Error("Unknown result reference kind");
      }
      validateIdentifier(attempt.resultReference.id, "result reference ID");
      if (!Number.isSafeInteger(attempt.resultReference.acceptedPlanRevision) || attempt.resultReference.acceptedPlanRevision < 1) {
        throw new Error("result reference acceptedPlanRevision must be positive");
      }
      const acceptedRecord = node.reconciliations.find((record) => {
        const expectedId = record.resultId ?? record.cancellationId;
        const expectedKind = record.resultId !== null ? "result" : "cancellation";
        return (
          record.attemptId === attempt.attemptId &&
          attempt.resultReference.kind === expectedKind &&
          attempt.resultReference.id === expectedId &&
          attempt.resultReference.acceptedPlanRevision === record.acceptedPlanRevision
        );
      });
      if (acceptedRecord && !reconciliationMatchesAttemptLifecycle(acceptedRecord, attempt)) {
        throw new Error("attempt lifecycle does not match its accepted reconciliation");
      }
    }
    if (isActiveAttempt(attempt)) {
      if (activeNodeIds.has(attempt.nodeId)) {
        throw new Error("Multiple active attempts for node: " + attempt.nodeId);
      }
      activeNodeIds.add(attempt.nodeId);
    }
  }
  validateLineage(plan, run);
  validateAttemptLineage(plan, run);
  validateUsageReports(plan, run, attemptIds);
  return run;
}

function validateUsageReports(plan, run, attemptIds) {
  if (!Array.isArray(run.usageReports)) {
    throw new Error("run usageReports must be an array");
  }
  const usageIds = new Set();
  let previousElapsed = 0;
  let previousTokens = null;
  let previousReportedAt = null;
  let checkpointElapsedBaseline = 0;
  let checkpointTokenBaseline = 0;
  for (const report of run.usageReports) {
    if (!isPlainObject(report)) throw new Error("usage report must be an object");
    assertKnownFields(report, USAGE_REPORT_FIELDS, "usage report");
    validateIdentifier(report.usageId, "usage report ID");
    if (usageIds.has(report.usageId)) throw new Error("Duplicate usage report ID");
    usageIds.add(report.usageId);
    validateIdentifier(report.attemptId, "usage attempt ID");
    if (!attemptIds.has(report.attemptId)) {
      throw new Error("usage report references unknown attempt: " + report.attemptId);
    }
    if (!Number.isSafeInteger(report.elapsedSeconds) || report.elapsedSeconds < 0) {
      throw new Error("usage elapsedSeconds must be a non-negative safe integer");
    }
    if (report.elapsedSeconds < previousElapsed) {
      throw new Error("usage elapsedSeconds must be monotonic");
    }
    previousElapsed = report.elapsedSeconds;
    for (const field of ["inputTokens", "outputTokens", "totalTokens"]) {
      if (
        report[field] !== null &&
        (!Number.isSafeInteger(report[field]) || report[field] < 0)
      ) {
        throw new Error("usage " + field + " must be null or a non-negative safe integer");
      }
    }
    if (
      report.inputTokens !== null &&
      report.outputTokens !== null &&
      report.totalTokens !== report.inputTokens + report.outputTokens
    ) {
      throw new Error("usage totalTokens must equal inputTokens plus outputTokens");
    }
    if (
      previousTokens !== null &&
      report.totalTokens !== null &&
      report.totalTokens < previousTokens
    ) {
      throw new Error("usage totalTokens must be monotonic");
    }
    if (report.totalTokens !== null) previousTokens = report.totalTokens;
    validateCanonicalTimestamp(report.reportedAt, "usage reportedAt");
    if (previousReportedAt !== null && report.reportedAt <= previousReportedAt) {
      throw new Error("usage reportedAt must be strictly increasing");
    }
    previousReportedAt = report.reportedAt;
    if (!new Set(["host", "manager", "unavailable"]).has(report.source)) {
      throw new Error("usage source is invalid");
    }
    if (!new Set(["continue", "pause", "continue_authorized"]).has(report.decision)) {
      throw new Error("usage decision is invalid");
    }
    validateNullableText(report.authorizationRef, "usage authorization reference", 1000);
    if (
      (report.decision === "continue_authorized") !==
      (report.authorizationRef !== null)
    ) {
      throw new Error(
        "usage authorization reference is required exactly for authorized continuation"
      );
    }
    const hardExceeded =
      (plan.resourceEnvelope.maxElapsedSeconds !== null &&
        report.elapsedSeconds >= plan.resourceEnvelope.maxElapsedSeconds) ||
      (plan.resourceEnvelope.maxTokens !== null &&
        report.totalTokens !== null &&
        report.totalTokens >= plan.resourceEnvelope.maxTokens);
    const softExceeded =
      report.elapsedSeconds - checkpointElapsedBaseline >=
        plan.resourceEnvelope.softCheckpointElapsedSeconds ||
      (report.totalTokens !== null &&
        report.totalTokens - checkpointTokenBaseline >=
          plan.resourceEnvelope.softCheckpointTokens);
    if (hardExceeded && report.decision !== "pause") {
      throw new Error("Hard resource limit requires pause");
    }
    if (!hardExceeded && softExceeded && report.decision === "continue") {
      throw new Error(
        "Soft resource checkpoint requires pause or authorized continuation"
      );
    }
    if (report.decision === "continue_authorized") {
      checkpointElapsedBaseline = report.elapsedSeconds;
      if (report.totalTokens !== null) checkpointTokenBaseline = report.totalTokens;
    }
  }
}

function validateLineage(plan, run) {
  if (!Array.isArray(run.lineage)) throw new Error("run lineage must be an array");
  const attempts = new Map(run.attempts.map((attempt) => [attempt.attemptId, attempt]));
  const projects = new Map(
    run.projects.map((project) => [project.projectBindingId, project])
  );
  const seen = new Set();
  for (const record of run.lineage) {
    if (!isPlainObject(record)) throw new Error("lineage record must be an object");
    assertKnownFields(record, LINEAGE_FIELDS, "lineage");
    validateIdentifier(record.lineageId, "lineage ID");
    if (seen.has(record.lineageId)) throw new Error("Duplicate lineage ID: " + record.lineageId);
    seen.add(record.lineageId);
    validateIdentifier(record.handoffId, "lineage handoff ID");
    if (!isPlainObject(record.source) || !isPlainObject(record.destination)) {
      throw new Error("Lineage source and destination must be objects");
    }
    assertKnownFields(record.source, LINEAGE_SOURCE_FIELDS, "lineage source");
    assertKnownFields(record.destination, LINEAGE_DESTINATION_FIELDS, "lineage destination");
    validateIdentifier(record.source.nodeId, "lineage source node ID");
    validateIdentifier(record.source.attemptId, "lineage source attempt ID");
    validateIdentifier(record.source.resultId, "lineage source result ID");
    if (
      !Number.isSafeInteger(record.source.acceptedPlanRevision) ||
      record.source.acceptedPlanRevision < 1
    ) {
      throw new Error("lineage source acceptedPlanRevision must be positive");
    }
    const sourceAttempt = attempts.get(record.source.attemptId);
    if (!sourceAttempt || sourceAttempt.nodeId !== record.source.nodeId) {
      throw new Error("Lineage source attempt is unknown");
    }
    const producer = plan.nodes.find((node) => node.id === record.source.nodeId);
    const reconciliation = producer?.reconciliations.find(
      (candidate) =>
        candidate.outcome === "complete" &&
        candidate.toStatus === "review" &&
        candidate.resultId === record.source.resultId &&
        candidate.attemptId === record.source.attemptId &&
        candidate.acceptedPlanRevision === record.source.acceptedPlanRevision
    );
    if (
      !producer ||
      !reconciliation ||
      !attemptMatchesAcceptedReconciliation(sourceAttempt, reconciliation)
    ) {
      throw new Error("Lineage source does not match an accepted complete reconciliation");
    }
    const handoff = reconciliation.evidenceContract.handoffs.find(
      (candidate) => candidate.id === record.handoffId
    );
    if (
      !handoff ||
      record.source.nodeId !== handoff.producerNodeId ||
      record.destination.nodeId !== handoff.consumerNodeId
    ) {
      throw new Error("Lineage endpoints do not match the accepted handoff snapshot");
    }
    const destinationProject = projects.get(record.destination.projectBindingId);
    if (!destinationProject) {
      throw new Error("Lineage destination project binding is unknown");
    }
    const consumer = plan.nodes.find((node) => node.id === record.destination.nodeId);
    if (!consumer) throw new Error("Lineage destination consumer is unknown");
    let destinationAttempt = null;
    if (record.destination.attemptId !== null) {
      destinationAttempt = attempts.get(record.destination.attemptId);
      if (
        !destinationAttempt ||
        destinationAttempt.nodeId !== record.destination.nodeId ||
        destinationAttempt.binding.projectBindingId !== record.destination.projectBindingId
      ) {
        throw new Error(
          "Lineage destination attempt does not match consumer " +
            record.destination.nodeId
        );
      }
    }
    if (
      (!destinationAttempt ||
        !attemptHasAcceptedReconciliation(consumer, destinationAttempt)) &&
      (!matchesProjectLocator(consumer.target.project, destinationProject) ||
        !startingStatesEqual(
          normalizedStartingState(consumer.target),
          destinationProject.startingState
        ))
    ) {
      throw new Error("Lineage destination project binding does not match consumer target");
    }
    const acceptedEvidence = reconciliation?.evidence.find(
      (item) => item.subjectType === "handoff" && item.subjectId === record.handoffId
    );
    if (
      !acceptedEvidence ||
      acceptedEvidence.uri !== record.source.uri ||
      acceptedEvidence.digest !== record.source.digest ||
      acceptedEvidence.mediaType !== record.source.mediaType
    ) {
      throw new Error("Lineage evidence does not match accepted plan evidence");
    }
  }
}

function validateAttemptLineage(plan, run) {
  for (const attempt of run.attempts) {
    const node = plan.nodes.find((candidate) => candidate.id === attempt.nodeId);
    if (node && attemptHasAcceptedReconciliation(node, attempt)) continue;
    const incoming = plan.handoffs.filter(
      (handoff) => handoff.consumerNodeId === attempt.nodeId
    );
    for (const handoff of incoming) {
      const producer = plan.nodes.find(
        (candidate) => candidate.id === handoff.producerNodeId
      );
      const completion = producer
        ? completionReconciliation(plan, producer)
        : null;
      const record = run.lineage.find(
        (candidate) =>
          candidate.handoffId === handoff.id &&
          candidate.destination.nodeId === attempt.nodeId &&
          candidate.destination.attemptId === attempt.attemptId &&
          candidate.destination.projectBindingId === attempt.binding.projectBindingId &&
          candidate.source.resultId === completion?.resultId &&
          candidate.source.attemptId === completion?.attemptId &&
          candidate.source.acceptedPlanRevision === completion?.acceptedPlanRevision
      );
      if (!record) {
        throw new Error(
          "Attempt is missing required incoming lineage for handoff: " + handoff.id
        );
      }
    }
  }
}

export function calculateRunReadiness(plan, run) {
  validateRun(plan, run);
  const activeAttempts = run.attempts.filter(isActiveAttempt);
  const activeByNode = new Map(
    activeAttempts.map((attempt) => [attempt.nodeId, attempt.dispatchState])
  );
  const occupiedLocks = new Set(
    activeAttempts.flatMap((attempt) => attempt.binding.resourceLocks)
  );
  const activeByHost = new Map();
  for (const attempt of activeAttempts) {
    const hostId = attempt.binding.hostBindingId;
    activeByHost.set(hostId, (activeByHost.get(hostId) ?? 0) + 1);
  }
  const byId = new Map(plan.nodes.map((node) => [node.id, node]));
  const ready = [];
  const blocked = [];
  const selectedLocks = new Set();
  const selectedByHost = new Map();

  for (const node of [...plan.nodes].sort((left, right) => compareCodeUnits(left.id, right.id))) {
    const reasons = [];
    if (node.status !== "ready") reasons.push("status_not_ready");
    if (node.dependencies.some((dependency) => byId.get(dependency).status !== "done")) {
      reasons.push("dependency_not_done");
    }
    if (activeByNode.has(node.id)) {
      reasons.push(
        activeByNode.get(node.id) === "dispatch_indeterminate"
          ? "indeterminate_attempt"
          : "active_attempt"
      );
    }
    let route = null;
    if (reasons.length === 0) {
      route = resolveRoute(node, run);
      reasons.push(...route.reasons);
    }
    if (reasons.length === 0) {
      const globalInUse = activeAttempts.length + ready.length;
      if (globalInUse >= plan.requestedMaxParallel) reasons.push("global_capacity");
    }
    if (reasons.length === 0) {
      const hostInUse =
        (activeByHost.get(route.host.hostBindingId) ?? 0) +
        (selectedByHost.get(route.host.hostBindingId) ?? 0);
      if (hostInUse >= route.host.maxConcurrency) reasons.push("host_capacity");
    }
    if (
      reasons.length === 0 &&
      node.resourceLocks.some(
        (lock) => occupiedLocks.has(lock) || selectedLocks.has(lock)
      )
    ) {
      reasons.push("resource_lock_collision");
    }
    if (reasons.length > 0) {
      blocked.push({ nodeId: node.id, reasons });
      continue;
    }
    ready.push({
      nodeId: node.id,
      projectBindingId: route.project.projectBindingId,
      hostBindingId: route.host.hostBindingId,
      placement: "verified",
    });
    selectedByHost.set(
      route.host.hostBindingId,
      (selectedByHost.get(route.host.hostBindingId) ?? 0) + 1
    );
    for (const lock of node.resourceLocks) selectedLocks.add(lock);
  }
  return { mode: "run-aware", planRevision: plan.revision, ready, blocked };
}

function validatePrepareInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("prepare input must be an object");
  assertKnownFields(raw, PREPARE_INPUT_FIELDS, "prepare input");
  if (raw.schemaVersion !== 1) throw new Error("prepare schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("prepare identity or plan revision does not match the plan");
  }
  validateIdentifier(raw.nodeId, "prepare node ID");
  validateIdentifier(raw.attemptId, "prepare attempt ID");
  validateIdentifier(raw.projectBindingId, "prepare project binding ID");
  validateIdentifier(raw.hostBindingId, "prepare host binding ID");
  validateAbsolutePath(raw.actualCwd, "prepare actualCwd");
  if (raw.actualWorktree !== null) {
    validateAbsolutePath(raw.actualWorktree, "prepare actualWorktree");
  }
  validateNullableText(raw.branch, "prepare branch", 500);
  validateNullableText(raw.authorizationRef, "prepare authorization reference", 1000);
  validateCanonicalTimestamp(raw.preparedAt, "prepare preparedAt");
  return raw;
}

function prepareIdempotencyKey(plan, input) {
  const digest = crypto
    .createHash("sha256")
    .update(
      [
        plan.projectId,
        plan.runId,
        String(plan.revision),
        input.nodeId,
        input.attemptId,
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 48);
  return "prepare-" + digest;
}

export function prepareAttempt(plan, run, rawInput) {
  validateRun(plan, run);
  const input = validatePrepareInput(plan, rawInput);
  const node = plan.nodes.find((candidate) => candidate.id === input.nodeId);
  if (!node) throw new Error("Unknown prepare node ID: " + input.nodeId);
  const duplicate = run.attempts.find(
    (attempt) => attempt.attemptId === input.attemptId
  );
  if (duplicate) {
    const binding = duplicate.binding;
    const matches =
      duplicate.nodeId === node.id &&
      duplicate.preparedPlanRevision === input.planRevision &&
      duplicate.preparedAt === input.preparedAt &&
      binding.projectBindingId === input.projectBindingId &&
      binding.hostBindingId === input.hostBindingId &&
      binding.actualCwd === input.actualCwd &&
      binding.actualWorktree === input.actualWorktree &&
      binding.branch === input.branch &&
      binding.authorizationRef === input.authorizationRef &&
      binding.idempotencyKey === prepareIdempotencyKey(plan, input) &&
      JSON.stringify(binding.modelSelection) ===
        JSON.stringify(node.target.modelSelection) &&
      JSON.stringify(binding.resourceLocks) === JSON.stringify(node.resourceLocks);
    if (matches) return { attempt: duplicate, idempotent: true };
    throw new Error("Conflicting duplicate prepare attempt ID: " + input.attemptId);
  }
  if (run.usageReports.at(-1)?.decision === "pause") {
    throw new Error("Run is paused by resource policy");
  }
  if (node.review !== null) {
    const limitField =
      node.review.kind === "independent"
        ? "maxIndependentReviews"
        : "maxFocusedConfirmations";
    const reviewNodeIds = new Set(
      plan.nodes
        .filter((candidate) => candidate.review?.kind === node.review.kind)
        .map((candidate) => candidate.id)
    );
    const completedPasses = run.attempts.filter(
      (attempt) =>
        reviewNodeIds.has(attempt.nodeId) && attempt.dispatchState === "accepted"
    ).length;
    if (
      completedPasses >= plan.reviewPolicy[limitField] &&
      node.review.authorizationRef === null &&
      node.review.unresolvedBlockerRef === null
    ) {
      throw new Error(node.review.kind + " review pass limit requires an exception");
    }
  }
  const report = calculateRunReadiness(plan, run);
  const ready = report.ready.find((candidate) => candidate.nodeId === node.id);
  if (!ready) {
    const blocked = report.blocked.find((candidate) => candidate.nodeId === node.id);
    throw new Error(
      "Node is not dispatchable for prepare: " + (blocked?.reasons.join(",") ?? "unknown")
    );
  }
  if (
    ready.projectBindingId !== input.projectBindingId ||
    ready.hostBindingId !== input.hostBindingId
  ) {
    throw new Error("prepare binding does not match the unique verified route");
  }
  if (node.target.workspaceMode === "isolated_worktree") {
    if (
      input.actualWorktree === null ||
      input.actualCwd !== input.actualWorktree ||
      input.branch === null
    ) {
      throw new Error("isolated worktree prepare requires matching cwd, worktree, and branch");
    }
  } else if (input.actualWorktree !== null || input.branch !== null) {
    throw new Error("direct prepare cannot bind a worktree or branch");
  }
  if (node.executionSurface === "desktop_task" && input.authorizationRef === null) {
    throw new Error("desktop task prepare requires explicit authorization reference");
  }
  const previous = run.attempts.filter((attempt) => attempt.nodeId === node.id).at(-1);
  if (
    previous &&
    previous.binding.modelSelection.provider !== node.target.modelSelection.provider &&
    !node.target.modelSelection.fallbackAuthorized
  ) {
    throw new Error("Provider switching requires explicit fallback authorization");
  }
  const attempt = {
    attemptId: input.attemptId,
    nodeId: node.id,
    preparedPlanRevision: plan.revision,
    preparedAt: input.preparedAt,
    binding: {
      projectBindingId: input.projectBindingId,
      hostBindingId: input.hostBindingId,
      executionSurface: node.executionSurface,
      workspaceMode: node.target.workspaceMode,
      actualCwd: input.actualCwd,
      actualWorktree: input.actualWorktree,
      observedRevision: run.projects.find(
        (project) => project.projectBindingId === input.projectBindingId
      ).observedRevision,
      branch: input.branch,
      resourceLocks: [...node.resourceLocks],
      authorizationRef: input.authorizationRef,
      idempotencyKey: prepareIdempotencyKey(plan, input),
      modelSelection: { ...node.target.modelSelection },
    },
    nativeIds: {
      savedProjectId: null,
      hostId: null,
      agentId: null,
      taskId: null,
      threadId: null,
    },
    dispatchState: "prepared",
    terminationOutcome: null,
    nativeLifecycle: null,
    dispatchHistory: [],
    terminationHistory: [],
    pendingSteering: [],
    dispatchTimestamp: null,
    archive: { state: "not_archived", archivedAt: null, lastAttemptedAt: null },
    archiveHistory: [],
    resultReference: null,
  };
  run.attempts.push(attempt);
  for (const lineage of run.lineage) {
    if (
      lineage.destination.nodeId === node.id &&
      lineage.destination.projectBindingId === input.projectBindingId &&
      lineage.destination.attemptId === null
    ) {
      lineage.destination.attemptId = attempt.attemptId;
    }
  }
  validateRun(plan, run);
  return { attempt, idempotent: false };
}

function usageReportFromInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("usage input must be an object");
  assertKnownFields(raw, USAGE_INPUT_FIELDS, "usage input");
  if (raw.schemaVersion !== 1) throw new Error("usage schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("usage identity or plan revision does not match the plan");
  }
  return Object.fromEntries(
    [...USAGE_REPORT_FIELDS].map((field) => [field, raw[field]])
  );
}

export function recordUsage(plan, run, rawInput) {
  validateRun(plan, run);
  const report = usageReportFromInput(plan, rawInput);
  const existing = run.usageReports.find(
    (candidate) => candidate.usageId === report.usageId
  );
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(report)) {
      return { report: existing, idempotent: true };
    }
    throw new Error("Conflicting duplicate usage report ID: " + report.usageId);
  }
  run.usageReports.push(report);
  validateRun(plan, run);
  return { report, idempotent: false };
}

function validateNativeIds(value, label) {
  if (!isPlainObject(value)) throw new Error(label + " must be an object");
  assertKnownFields(value, NATIVE_ID_FIELDS, label);
  for (const [name, nativeValue] of Object.entries(value)) {
    validateNullableText(nativeValue, label + " " + name, 2000);
  }
  return value;
}

function validateDispatchRecord(record) {
  if (!isPlainObject(record)) throw new Error("dispatch record must be an object");
  assertKnownFields(record, DISPATCH_RECORD_FIELDS, "dispatch record");
  validateIdentifier(record.dispatchId, "dispatch ID");
  if (!new Set(["route_failed", "accepted", "dispatch_indeterminate"]).has(record.dispatchState)) {
    throw new Error("recorded dispatchState is invalid");
  }
  validateNativeIds(record.nativeIds, "dispatch native IDs");
  validateNullableText(record.nativeLifecycle, "dispatch nativeLifecycle", 500);
  validateCanonicalTimestamp(record.recordedAt, "dispatch recordedAt");
  return record;
}

function dispatchRecordFromInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("dispatch input must be an object");
  assertKnownFields(raw, DISPATCH_INPUT_FIELDS, "dispatch input");
  if (raw.schemaVersion !== 1) throw new Error("dispatch schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("dispatch identity or plan revision does not match the plan");
  }
  validateIdentifier(raw.attemptId, "dispatch attempt ID");
  return validateDispatchRecord(
    Object.fromEntries(
      [...DISPATCH_RECORD_FIELDS].map((field) => [field, raw[field]])
    )
  );
}

export function recordDispatch(plan, run, rawInput) {
  validateRun(plan, run);
  const record = dispatchRecordFromInput(plan, rawInput);
  const attempt = run.attempts.find(
    (candidate) => candidate.attemptId === rawInput.attemptId
  );
  if (!attempt) throw new Error("Unknown dispatch attempt ID: " + rawInput.attemptId);
  const existing = attempt.dispatchHistory.find(
    (candidate) => candidate.dispatchId === record.dispatchId
  );
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      return { attempt, idempotent: true };
    }
    throw new Error("Conflicting duplicate dispatch ID: " + record.dispatchId);
  }
  if (attempt.terminationOutcome !== null) {
    throw new Error("Cannot record dispatch after native termination");
  }
  if (attempt.dispatchState === "accepted") {
    throw new Error("Cannot change accepted dispatch");
  }
  if (attempt.dispatchState === "route_failed") {
    throw new Error("Cannot change confirmed route failure");
  }
  if (
    attempt.dispatchState === "dispatch_indeterminate" &&
    !new Set(["accepted", "route_failed"]).has(record.dispatchState)
  ) {
    throw new Error("Indeterminate dispatch may resolve only to accepted or route_failed");
  }
  attempt.dispatchHistory.push(record);
  attempt.dispatchState = record.dispatchState;
  attempt.nativeIds = { ...record.nativeIds };
  attempt.nativeLifecycle = record.nativeLifecycle;
  if (attempt.dispatchTimestamp === null) attempt.dispatchTimestamp = record.recordedAt;
  validateRun(plan, run);
  return { attempt, idempotent: false };
}

function validateTerminationRecord(record) {
  if (!isPlainObject(record)) throw new Error("termination record must be an object");
  assertKnownFields(record, TERMINATION_RECORD_FIELDS, "termination record");
  validateIdentifier(record.terminationId, "termination ID");
  if (!new Set(["complete", "partial", "failed", "cancelled"]).has(record.outcome)) {
    throw new Error("termination outcome is invalid");
  }
  validateNullableText(record.nativeLifecycle, "termination nativeLifecycle", 500);
  validateCanonicalTimestamp(record.recordedAt, "termination recordedAt");
  return record;
}

function terminationRecordFromInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("termination input must be an object");
  assertKnownFields(raw, TERMINATION_INPUT_FIELDS, "termination input");
  if (raw.schemaVersion !== 1) throw new Error("termination schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("termination identity or plan revision does not match the plan");
  }
  validateIdentifier(raw.attemptId, "termination attempt ID");
  return validateTerminationRecord(
    Object.fromEntries(
      [...TERMINATION_RECORD_FIELDS].map((field) => [field, raw[field]])
    )
  );
}

export function recordTermination(plan, run, rawInput) {
  validateRun(plan, run);
  const record = terminationRecordFromInput(plan, rawInput);
  const attempt = run.attempts.find(
    (candidate) => candidate.attemptId === rawInput.attemptId
  );
  if (!attempt) throw new Error("Unknown termination attempt ID: " + rawInput.attemptId);
  const existing = attempt.terminationHistory.find(
    (candidate) => candidate.terminationId === record.terminationId
  );
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      return { attempt, idempotent: true };
    }
    throw new Error("Conflicting duplicate termination ID: " + record.terminationId);
  }
  if (attempt.terminationOutcome !== null || attempt.terminationHistory.length > 0) {
    throw new Error("Native termination already recorded");
  }
  if (attempt.dispatchState !== "accepted") {
    throw new Error("Native termination requires an accepted dispatch");
  }
  attempt.terminationHistory.push(record);
  attempt.terminationOutcome = record.outcome;
  attempt.nativeLifecycle = record.nativeLifecycle;
  validateRun(plan, run);
  return { attempt, idempotent: false };
}

function steeringInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("steering input must be an object");
  assertKnownFields(raw, STEERING_INPUT_FIELDS, "steering input");
  if (raw.schemaVersion !== 1) throw new Error("steering schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("steering identity or plan revision does not match the plan");
  }
  validateIdentifier(raw.attemptId, "steering attempt ID");
  validateIdentifier(raw.steeringId, "steering ID");
  if (typeof raw.payloadDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(raw.payloadDigest)) {
    throw new Error("steering payloadDigest must be lowercase SHA-256");
  }
  if (!new Set(["pending", "delivered", "rejected", "indeterminate"]).has(raw.state)) {
    throw new Error("steering state is invalid");
  }
  validateCanonicalTimestamp(raw.recordedAt, "steering recordedAt");
  return raw;
}

export function recordSteering(plan, run, rawInput) {
  validateRun(plan, run);
  const input = steeringInput(plan, rawInput);
  const attempt = run.attempts.find(
    (candidate) => candidate.attemptId === input.attemptId
  );
  if (!attempt) throw new Error("Unknown steering attempt ID: " + input.attemptId);
  if (attempt.dispatchState !== "accepted" || attempt.terminationOutcome !== null) {
    throw new Error("Steering requires an active accepted dispatch");
  }
  const existing = attempt.pendingSteering.find(
    (candidate) => candidate.steeringId === input.steeringId
  );
  if (!existing) {
    const record = {
      steeringId: input.steeringId,
      payloadDigest: input.payloadDigest,
      createdAt: input.recordedAt,
      updatedAt: input.recordedAt,
      state: input.state,
    };
    attempt.pendingSteering.push(record);
    validateRun(plan, run);
    return { record, idempotent: false };
  }
  if (existing.payloadDigest !== input.payloadDigest) {
    throw new Error("Conflicting steering payload digest");
  }
  if (existing.state === input.state && existing.updatedAt === input.recordedAt) {
    return { record: existing, idempotent: true };
  }
  if (!new Set(["pending", "indeterminate"]).has(existing.state)) {
    throw new Error("Cannot rewrite a terminal steering state");
  }
  if (input.recordedAt <= existing.updatedAt) {
    throw new Error("Steering updates must be chronologically ordered");
  }
  const allowed =
    existing.state === "pending"
      ? new Set(["delivered", "rejected", "indeterminate"])
      : new Set(["delivered", "rejected"]);
  if (!allowed.has(input.state)) {
    throw new Error("Invalid steering state transition");
  }
  existing.state = input.state;
  existing.updatedAt = input.recordedAt;
  validateRun(plan, run);
  return { record: existing, idempotent: false };
}

function validateArchiveRecord(record) {
  if (!isPlainObject(record)) throw new Error("archive record must be an object");
  assertKnownFields(record, ARCHIVE_RECORD_FIELDS, "archive record");
  validateIdentifier(record.archiveId, "archive ID");
  if (!new Set(["archived", "archive_failed"]).has(record.state)) {
    throw new Error("archive record state is invalid");
  }
  validateCanonicalTimestamp(record.recordedAt, "archive recordedAt");
  return record;
}

function archiveRecordFromInput(plan, raw) {
  if (!isPlainObject(raw)) throw new Error("archive input must be an object");
  assertKnownFields(raw, ARCHIVE_INPUT_FIELDS, "archive input");
  if (raw.schemaVersion !== 1) throw new Error("archive schemaVersion must be 1");
  if (
    raw.projectId !== plan.projectId ||
    raw.runId !== plan.runId ||
    raw.planRevision !== plan.revision
  ) {
    throw new Error("archive identity or plan revision does not match the plan");
  }
  validateIdentifier(raw.attemptId, "archive attempt ID");
  return validateArchiveRecord(
    Object.fromEntries(
      [...ARCHIVE_RECORD_FIELDS].map((field) => [field, raw[field]])
    )
  );
}

export function recordArchive(plan, run, rawInput) {
  validateRun(plan, run);
  const record = archiveRecordFromInput(plan, rawInput);
  const attempt = run.attempts.find(
    (candidate) => candidate.attemptId === rawInput.attemptId
  );
  if (!attempt) throw new Error("Unknown archive attempt ID: " + rawInput.attemptId);
  const existing = attempt.archiveHistory.find(
    (candidate) => candidate.archiveId === record.archiveId
  );
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(record)) {
      return { attempt, idempotent: true };
    }
    throw new Error("Conflicting duplicate archive ID: " + record.archiveId);
  }
  if (attempt.archive.state === "archived") {
    throw new Error("Archived state is terminal");
  }
  const eligibility = calculateArchiveEligibility(plan, run);
  if (!eligibility.eligible.some((item) => item.attemptId === attempt.attemptId)) {
    throw new Error("Archive eligibility has not been proven for attempt " + attempt.attemptId);
  }
  attempt.archiveHistory.push(record);
  attempt.archive = {
    state: record.state,
    archivedAt: record.state === "archived" ? record.recordedAt : null,
    lastAttemptedAt: record.recordedAt,
  };
  validateRun(plan, run);
  return { attempt, idempotent: false };
}

function completionReconciliation(plan, node) {
  const complete = node.reconciliations.at(-1);
  if (
    complete?.outcome !== "complete" ||
    complete.toStatus !== "review" ||
    JSON.stringify(complete.evidenceContract) !==
      JSON.stringify(evidenceContractFor(plan, node))
  ) {
    return null;
  }
  if (!complete || !Array.isArray(complete.evidence)) return null;
  const subjects = new Set(
    complete.evidence.map((item) => item.subjectType + ":" + item.subjectId)
  );
  const required = requiredEvidenceSubjectsFromContract(
    complete.evidenceContract
  );
  return required.every((subject) => subjects.has(subject)) ? complete : null;
}

function hasCompletionEvidence(plan, node) {
  return completionReconciliation(plan, node) !== null;
}

function evidenceContractFor(plan, node) {
  return {
    criteria: node.acceptanceCriteria
      .map((item) => item.id)
      .sort(compareCodeUnits),
    verifications: node.verification
      .map((item) => item.id)
      .sort(compareCodeUnits),
    deliverables: node.deliverables
      .map((item) => ({
        id: item.id,
        mediaTypes: [...item.mediaTypes].sort(compareCodeUnits),
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
    handoffs: plan.handoffs
      .filter((handoff) => handoff.producerNodeId === node.id)
      .map((handoff) => ({
        id: handoff.id,
        producerNodeId: handoff.producerNodeId,
        consumerNodeId: handoff.consumerNodeId,
        deliverableId: handoff.deliverableId,
        medium: handoff.transport.medium,
        mediaType: handoff.transport.mediaType,
      }))
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  };
}

function validateEvidenceContract(value) {
  if (!isPlainObject(value)) throw new Error("evidenceContract must be an object");
  assertKnownFields(value, EVIDENCE_CONTRACT_FIELDS, "evidence contract");
  for (const [field, label] of [
    ["criteria", "criterion"],
    ["verifications", "verification"],
  ]) {
    if (!Array.isArray(value[field])) {
      throw new Error("evidenceContract " + field + " must be an array");
    }
    if (value[field].length === 0) {
      throw new Error("evidenceContract " + field + " must be non-empty");
    }
    const ids = new Set();
    for (const id of value[field]) {
      validateIdentifier(id, "evidence contract " + label + " ID");
      if (ids.has(id)) throw new Error("Duplicate evidence contract " + label + " ID: " + id);
      ids.add(id);
    }
    if (JSON.stringify(value[field]) !== JSON.stringify([...value[field]].sort(compareCodeUnits))) {
      throw new Error("evidenceContract " + field + " must be code-unit sorted");
    }
  }
  if (!Array.isArray(value.deliverables) || value.deliverables.length === 0 || !Array.isArray(value.handoffs)) {
    throw new Error("evidenceContract deliverables and handoffs must be arrays");
  }
  const deliverableIds = new Set();
  for (const deliverable of value.deliverables) {
    if (!isPlainObject(deliverable)) throw new Error("evidenceContract deliverable must be an object");
    assertKnownFields(deliverable, EVIDENCE_CONTRACT_DELIVERABLE_FIELDS, "evidence contract deliverable");
    validateIdentifier(deliverable.id, "evidence contract deliverable ID");
    if (deliverableIds.has(deliverable.id)) throw new Error("Duplicate evidence contract deliverable ID: " + deliverable.id);
    deliverableIds.add(deliverable.id);
    if (!Array.isArray(deliverable.mediaTypes) || deliverable.mediaTypes.length === 0) {
      throw new Error("evidenceContract deliverable mediaTypes must be non-empty");
    }
    const mediaTypes = new Set();
    for (const mediaType of deliverable.mediaTypes) {
      validateMediaType(mediaType, "evidence contract deliverable");
      if (mediaTypes.has(mediaType)) throw new Error("Duplicate evidence contract deliverable mediaType: " + mediaType);
      mediaTypes.add(mediaType);
    }
    if (JSON.stringify(deliverable.mediaTypes) !== JSON.stringify([...deliverable.mediaTypes].sort(compareCodeUnits))) {
      throw new Error("evidenceContract deliverable mediaTypes must be code-unit sorted");
    }
  }
  if (JSON.stringify(value.deliverables.map((item) => item.id)) !== JSON.stringify(value.deliverables.map((item) => item.id).sort(compareCodeUnits))) {
    throw new Error("evidenceContract deliverables must be code-unit sorted");
  }
  const handoffIds = new Set();
  for (const handoff of value.handoffs) {
    if (!isPlainObject(handoff)) throw new Error("evidenceContract handoff must be an object");
    assertKnownFields(handoff, EVIDENCE_CONTRACT_HANDOFF_FIELDS, "evidence contract handoff");
    for (const [field, label] of [
      ["id", "handoff ID"],
      ["producerNodeId", "producer node ID"],
      ["consumerNodeId", "consumer node ID"],
      ["deliverableId", "deliverable ID"],
    ]) validateIdentifier(handoff[field], "evidence contract " + label);
    if (handoffIds.has(handoff.id)) throw new Error("Duplicate evidence contract handoff ID: " + handoff.id);
    handoffIds.add(handoff.id);
    if (!new Set(["commit", "object", "artifact", "patch"]).has(handoff.medium)) {
      throw new Error("Unknown evidence contract handoff medium");
    }
    validateMediaType(handoff.mediaType, "evidence contract handoff");
    const deliverable = value.deliverables.find(
      (candidate) => candidate.id === handoff.deliverableId
    );
    if (!deliverable || !deliverable.mediaTypes.includes(handoff.mediaType)) {
      throw new Error("evidenceContract handoff does not match its deliverable");
    }
  }
  if (JSON.stringify(value.handoffs.map((item) => item.id)) !== JSON.stringify(value.handoffs.map((item) => item.id).sort(compareCodeUnits))) {
    throw new Error("evidenceContract handoffs must be code-unit sorted");
  }
  return value;
}

function requiredEvidenceSubjectsFromContract(contract) {
  return [
    ...contract.criteria.map((id) => "criterion:" + id),
    ...contract.verifications.map((id) => "verification:" + id),
    ...contract.deliverables.map((item) => "deliverable:" + item.id),
    ...contract.handoffs.map((item) => "handoff:" + item.id),
  ];
}

function validateEvidenceAgainstContract(value, rawContract) {
  if (!Array.isArray(value)) throw new Error("result evidence must be an array");
  const contract = validateEvidenceContract(rawContract);
  const declared = new Map([
    ["criterion", new Map(contract.criteria.map((id) => [id, null]))],
    ["verification", new Map(contract.verifications.map((id) => [id, null]))],
    ["deliverable", new Map(contract.deliverables.map((item) => [item.id, item.mediaTypes]))],
    ["handoff", new Map(contract.handoffs.map((item) => [item.id, [item.mediaType]]))],
  ]);
  const seen = new Set();
  return value.map((item, index) => {
    if (!isPlainObject(item)) throw new Error("evidence[" + index + "] must be an object");
    assertKnownFields(item, EVIDENCE_FIELDS, "evidence");
    if (!declared.has(item.subjectType) || !declared.get(item.subjectType).has(item.subjectId)) {
      throw new Error("Evidence references undeclared subject: " + item.subjectType + ":" + item.subjectId);
    }
    const subject = item.subjectType + ":" + item.subjectId;
    if (seen.has(subject)) throw new Error("Duplicate evidence subject: " + subject);
    seen.add(subject);
    const uri = validateText(item.uri, "evidence URI", 2000);
    let parsedUri;
    try {
      parsedUri = new URL(uri);
    } catch {
      throw new Error("Evidence URI must be an absolute retrievable URI");
    }
    if (!EVIDENCE_URI_SCHEMES.has(parsedUri.protocol)) {
      throw new Error("Evidence URI scheme is not allowed: " + parsedUri.protocol);
    }
    if (parsedUri.username || parsedUri.password) {
      throw new Error("Evidence URI must not contain credentials");
    }
    if (!parsedUri.hostname && !parsedUri.pathname) {
      throw new Error("Evidence URI must identify an artifact");
    }
    if (typeof item.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(item.digest)) {
      throw new Error("Evidence digest must be lowercase SHA-256");
    }
    validateMediaType(item.mediaType, "Evidence");
    const allowedMediaTypes = declared.get(item.subjectType).get(item.subjectId);
    if (allowedMediaTypes && !allowedMediaTypes.includes(item.mediaType)) {
      const label = item.subjectType === "handoff" ? "Handoff" : "Deliverable";
      throw new Error(label + " evidence media type does not match declared transport or deliverable");
    }
    return { ...item, uri };
  });
}

function validateEvidence(plan, node, value) {
  return validateEvidenceAgainstContract(value, evidenceContractFor(plan, node));
}

function validateReconciliations(plan, node) {
  const seen = new Set();
  const reconciledAttemptIds = new Set();
  let cancellationIndex = -1;
  let previousAcceptedRevision = 0;
  for (const [index, record] of node.reconciliations.entries()) {
    if (!isPlainObject(record)) throw new Error("reconciliation must be an object");
    assertKnownFields(record, RECONCILIATION_FIELDS, "reconciliation");
    const hasResult = record.resultId !== null;
    const hasCancellation = record.cancellationId !== null;
    if (hasResult === hasCancellation) {
      throw new Error("reconciliation requires exactly one result or cancellation ID");
    }
    const recordId = hasResult ? record.resultId : record.cancellationId;
    validateIdentifier(recordId, "reconciliation ID");
    if (seen.has(recordId)) throw new Error("Duplicate reconciliation ID: " + recordId);
    seen.add(recordId);
    if (record.attemptId !== null) {
      validateIdentifier(record.attemptId, "reconciliation attempt ID");
      if (reconciledAttemptIds.has(record.attemptId)) {
        throw new Error(
          "An attempt may have only one terminal reconciliation: " + record.attemptId
        );
      }
      reconciledAttemptIds.add(record.attemptId);
    }
    if (hasResult && record.attemptId === null) {
      throw new Error("result reconciliation requires an attempt ID");
    }
    if (typeof record.inputDigest !== "string" || !/^[a-f0-9]{64}$/u.test(record.inputDigest)) {
      throw new Error("reconciliation inputDigest must be lowercase SHA-256");
    }
    if (!STATUS_TRANSITIONS.has(record.fromStatus) || !STATUS_TRANSITIONS.has(record.toStatus)) {
      throw new Error("reconciliation contains an unknown status");
    }
    if (hasCancellation) {
      if (cancellationIndex !== -1) {
        throw new Error("node may have only one terminal cancellation reconciliation");
      }
      cancellationIndex = index;
      if (record.outcome !== "cancelled" || record.toStatus !== "cancelled") {
        throw new Error("cancellation reconciliation must transition to cancelled");
      }
      if (!STATUS_TRANSITIONS.get(record.fromStatus)?.has("cancelled")) {
        throw new Error("cancellation reconciliation has an invalid source status");
      }
    } else {
      if (!new Set(["complete", "partial", "failed"]).has(record.outcome)) {
        throw new Error("result reconciliation has an invalid outcome");
      }
      if (record.fromStatus !== "running") {
        throw new Error("result reconciliation must start from running");
      }
      const targets = record.outcome === "complete"
        ? new Set(["review"])
        : new Set(["rework", "waiting", "needs_input", "failed"]);
      if (!targets.has(record.toStatus)) {
        throw new Error("result reconciliation has an invalid target status");
      }
    }
    validateCanonicalTimestamp(record.acceptedAt, "reconciliation acceptedAt");
    if (
      !Number.isSafeInteger(record.acceptedPlanRevision) ||
      record.acceptedPlanRevision < 1 ||
      record.acceptedPlanRevision > plan.revision
    ) {
      throw new Error("reconciliation acceptedPlanRevision is invalid");
    }
    if (record.acceptedPlanRevision <= previousAcceptedRevision) {
      throw new Error("reconciliation revisions must be unique and strictly increasing");
    }
    previousAcceptedRevision = record.acceptedPlanRevision;
    validateText(record.managerReason, "reconciliation managerReason", 1000);
    const evidenceContract = validateEvidenceContract(record.evidenceContract);
    const evidence = validateEvidenceAgainstContract(record.evidence, evidenceContract);
    if (record.outcome === "complete") {
      const provided = new Set(evidence.map((item) => item.subjectType + ":" + item.subjectId));
      if (!requiredEvidenceSubjectsFromContract(evidenceContract).every((subject) => provided.has(subject))) {
        throw new Error("Complete reconciliation is missing required completion evidence");
      }
    }
  }
  if (
    cancellationIndex !== -1 &&
    (cancellationIndex !== node.reconciliations.length - 1 || node.status !== "cancelled")
  ) {
    throw new Error(
      "After terminal cancellation, node status must remain cancelled and reconciliation must remain final"
    );
  }
}

function validateResult(plan, run, raw) {
  if (!isPlainObject(raw)) throw new Error("result must be an object");
  assertKnownFields(raw, RESULT_FIELDS, "result");
  if (raw.schemaVersion !== 1) throw new Error("result schemaVersion must be 1");
  if (raw.projectId !== plan.projectId || raw.runId !== plan.runId) {
    throw new Error("result project or run identity does not match the plan");
  }
  const node = plan.nodes.find((candidate) => candidate.id === raw.nodeId);
  if (!node) throw new Error("Unknown result node ID: " + raw.nodeId);
  const attempt = run.attempts.find((candidate) => candidate.attemptId === raw.attemptId);
  if (!attempt || attempt.nodeId !== node.id) {
    throw new Error("Unknown or stale result attempt ID: " + raw.attemptId);
  }
  const currentAttempt = run.attempts.filter((candidate) => candidate.nodeId === node.id).at(-1);
  if (currentAttempt !== attempt) {
    throw new Error("Stale result attempt ID: " + raw.attemptId);
  }
  validateIdentifier(raw.resultId, "result ID");
  if (!new Set(["complete", "partial", "failed"]).has(raw.outcome)) {
    throw new Error("Unknown result outcome: " + raw.outcome);
  }
  if (attempt.dispatchState !== "accepted") {
    throw new Error("Result reconciliation requires an accepted dispatch");
  }
  if (attempt.terminationOutcome !== raw.outcome) {
    throw new Error("Result outcome does not match native termination outcome");
  }
  validateText(raw.summary, "result summary", 4000);
  const evidence = validateEvidence(plan, node, raw.evidence);
  return { node, attempt, evidence };
}

function validateCancellation(plan, run, raw) {
  if (!isPlainObject(raw)) throw new Error("cancellation must be an object");
  assertKnownFields(raw, CANCELLATION_FIELDS, "cancellation");
  if (raw.schemaVersion !== 1) throw new Error("cancellation schemaVersion must be 1");
  if (raw.projectId !== plan.projectId || raw.runId !== plan.runId) {
    throw new Error("cancellation project or run identity does not match the plan");
  }
  const node = plan.nodes.find((candidate) => candidate.id === raw.nodeId);
  if (!node) throw new Error("Unknown cancellation node ID: " + raw.nodeId);
  validateIdentifier(raw.cancellationId, "cancellation ID");
  validateText(raw.reason, "cancellation reason", 1000);
  const evidence = validateEvidence(plan, node, raw.evidence);
  let attempt = null;
  if (raw.attemptId === null) {
    if (run.attempts.some((candidate) => candidate.nodeId === node.id)) {
      throw new Error("A dispatched node cancellation must reference its attempt");
    }
  } else {
    validateIdentifier(raw.attemptId, "cancellation attempt ID");
    attempt = run.attempts.find((candidate) => candidate.attemptId === raw.attemptId);
    if (!attempt || attempt.nodeId !== node.id) {
      throw new Error("Unknown or stale cancellation attempt ID: " + raw.attemptId);
    }
    const currentAttempt = run.attempts.filter((candidate) => candidate.nodeId === node.id).at(-1);
    if (currentAttempt !== attempt) {
      throw new Error("Stale cancellation attempt ID: " + raw.attemptId);
    }
    const noNativeWorkAccepted =
      new Set(["prepared", "route_failed"]).has(attempt.dispatchState) &&
      attempt.terminationOutcome === null;
    if (!noNativeWorkAccepted && attempt.terminationOutcome !== "cancelled") {
      throw new Error("Cancellation attempt has not reached confirmed native termination");
    }
    if (
      attempt.resultReference?.kind !== "cancellation" ||
      attempt.resultReference?.id !== raw.cancellationId
    ) {
      throw new Error("Cancellation attempt reference does not match the accepted input");
    }
  }
  return { node, attempt, evidence };
}

function requiredEvidenceSubjects(plan, node) {
  return requiredEvidenceSubjectsFromContract(evidenceContractFor(plan, node));
}

export function reconcileResult(plan, run, result, rawBytes, options) {
  const inputDigest = crypto.createHash("sha256").update(rawBytes).digest("hex");
  const proposedId = isPlainObject(result) ? result.resultId : undefined;
  for (const existingNode of plan.nodes) {
    for (const record of existingNode.reconciliations) {
      if (record.resultId !== proposedId && record.cancellationId !== proposedId) continue;
      if (record.inputDigest === inputDigest) {
        return { node: existingNode, idempotent: true };
      }
      throw new Error("Conflicting duplicate result ID: " + proposedId);
    }
  }
  validateRun(plan, run);
  const { node, attempt, evidence } = validateResult(plan, run, result);
  if (node.status !== "running") {
    throw new Error("Invalid result transition from " + node.status);
  }
  const allowedTargets =
    result.outcome === "complete"
      ? new Set(["review"])
      : new Set(["rework", "waiting", "needs_input", "failed"]);
  if (!allowedTargets.has(options.to)) {
    throw new Error(
      "Invalid reconciliation target " + options.to + " for outcome " + result.outcome
    );
  }
  if (result.outcome === "complete") {
    const provided = new Set(evidence.map((item) => item.subjectType + ":" + item.subjectId));
    if (!requiredEvidenceSubjects(plan, node).every((subject) => provided.has(subject))) {
      throw new Error("Complete result is missing required completion evidence");
    }
  }
  if (attempt.terminationOutcome === null) {
    throw new Error("Result attempt has not reached confirmed native termination");
  }
  const acceptedAt = validateCanonicalTimestamp(options.acceptedAt, "--accepted-at");
  const managerReason = validateText(options.managerReason, "manager reason", 1000);
  const fromStatus = node.status;
  node.status = options.to;
  node.blockingReason = BLOCKING_STATUSES.has(options.to) ? managerReason : null;
  node.reconciliations.push({
    resultId: result.resultId,
    cancellationId: null,
    attemptId: result.attemptId,
    inputDigest,
    outcome: result.outcome,
    fromStatus,
    toStatus: options.to,
    acceptedAt,
    acceptedPlanRevision: plan.revision + 1,
    managerReason,
    evidenceContract: evidenceContractFor(plan, node),
    evidence,
  });
  plan.revision += 1;
  return { node, idempotent: false };
}

export function reconcileCancellation(plan, run, cancellation, rawBytes, options) {
  const inputDigest = crypto.createHash("sha256").update(rawBytes).digest("hex");
  const proposedId = isPlainObject(cancellation) ? cancellation.cancellationId : undefined;
  for (const existingNode of plan.nodes) {
    for (const record of existingNode.reconciliations) {
      if (
        record.resultId !== proposedId &&
        record.cancellationId !== proposedId
      ) {
        continue;
      }
      if (record.inputDigest === inputDigest) {
        return { node: existingNode, idempotent: true };
      }
      throw new Error("Conflicting duplicate cancellation ID: " + proposedId);
    }
  }
  validateRun(plan, run);
  const { node, evidence } = validateCancellation(plan, run, cancellation);
  if (options.to !== "cancelled" || !STATUS_TRANSITIONS.get(node.status)?.has("cancelled")) {
    throw new Error("Invalid cancellation transition from " + node.status);
  }
  const acceptedAt = validateCanonicalTimestamp(options.acceptedAt, "--accepted-at");
  const managerReason = validateText(options.managerReason, "manager reason", 1000);
  const fromStatus = node.status;
  node.status = "cancelled";
  node.blockingReason = managerReason;
  node.reconciliations.push({
    resultId: null,
    cancellationId: cancellation.cancellationId,
    attemptId: cancellation.attemptId,
    inputDigest,
    outcome: "cancelled",
    fromStatus,
    toStatus: "cancelled",
    acceptedAt,
    acceptedPlanRevision: plan.revision + 1,
    managerReason,
    evidenceContract: evidenceContractFor(plan, node),
    evidence,
  });
  plan.revision += 1;
  return { node, idempotent: false };
}

export function transitionNode(plan, nodeId, nextStatus, blockingReason = null, run = null) {
  const node = plan.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error("Unknown node ID: " + nodeId);
  if (!STATUS_TRANSITIONS.has(nextStatus)) throw new Error("Unknown status: " + nextStatus);
  if (!STATUS_TRANSITIONS.get(node.status)?.has(nextStatus)) {
    throw new Error("Invalid transition from " + node.status + " to " + nextStatus);
  }
  if (nextStatus === "cancelled" || node.status === "running") {
    throw new Error("Transition from " + node.status + " to " + nextStatus + " requires reconcile");
  }
  if (
    new Set(["ready", "running"]).has(nextStatus) &&
    node.dependencies.some(
      (dependency) =>
        plan.nodes.find((candidate) => candidate.id === dependency)?.status !== "done"
    )
  ) {
    throw new Error("Transition to " + nextStatus + " requires all dependencies done");
  }
  if (nextStatus === "running") {
    if (!run) throw new Error("Transition to running requires --run");
    validateRun(plan, run);
    const nodeAttempts = run.attempts.filter((attempt) => attempt.nodeId === node.id);
    const currentAttempt = nodeAttempts.at(-1);
    if (
      !currentAttempt ||
      currentAttempt.dispatchState !== "accepted" ||
      currentAttempt.terminationOutcome !== null
    ) {
      throw new Error("Transition to running requires the current accepted active attempt");
    }
  }
  if (nextStatus === "done" && !hasCompletionEvidence(plan, node)) {
    throw new Error("Completion evidence is incomplete for node " + node.id);
  }
  if (BLOCKING_STATUSES.has(nextStatus)) {
    node.blockingReason = validateText(
      blockingReason,
      "blocking reason",
      1000
    );
  } else {
    if (blockingReason !== null) {
      throw new Error("--blocking-reason is not valid for status " + nextStatus);
    }
    node.blockingReason = null;
  }
  node.status = nextStatus;
  plan.revision += 1;
  return node;
}

export function calculateArchiveEligibility(plan, run) {
  validateRun(plan, run);
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  const hosts = new Map(run.hosts.map((host) => [host.hostBindingId, host]));
  const eligible = [];
  const ineligible = [];
  const attempts = [...run.attempts].sort((left, right) =>
    compareCodeUnits(
      left.nodeId + ":" + left.attemptId,
      right.nodeId + ":" + right.attemptId
    )
  );
  for (const attempt of attempts) {
    const reasons = [];
    const node = nodes.get(attempt.nodeId);
    const host = hosts.get(attempt.binding.hostBindingId);
    if (attempt.binding.executionSurface !== "desktop_task") reasons.push("not_desktop_task");
    if (!attempt.nativeIds.taskId) reasons.push("native_task_missing");
    if (!new Set(["complete", "partial", "failed", "cancelled"]).has(attempt.terminationOutcome)) {
      reasons.push("native_not_terminal");
    }
    const reference = attempt.resultReference;
    const reconciliation = reference && node?.reconciliations.find(
      (record) =>
        record.attemptId === attempt.attemptId &&
        record.acceptedPlanRevision === reference.acceptedPlanRevision &&
        (reference.kind === "result"
          ? record.resultId === reference.id && record.cancellationId === null
          : record.cancellationId === reference.id && record.resultId === null)
    );
    if (!reference || !reconciliation) reasons.push("result_not_reconciled");
    if (
      attempt.pendingSteering.some((item) =>
        new Set(["pending", "indeterminate"]).has(item.state)
      )
    ) {
      reasons.push("steering_pending");
    }
    if (node?.status === "waiting") reasons.push("node_waiting");
    if (attempt.dispatchState === "dispatch_indeterminate") {
      reasons.push("dispatch_indeterminate");
    }
    if (!host?.supportsReversibleArchive) reasons.push("archive_unsupported");
    if (attempt.archive.state === "archived") reasons.push("already_archived");
    if (reasons.length > 0) {
      ineligible.push({ nodeId: attempt.nodeId, attemptId: attempt.attemptId, reasons });
    } else {
      eligible.push({
        nodeId: attempt.nodeId,
        attemptId: attempt.attemptId,
        nativeTaskId: attempt.nativeIds.taskId,
        hostBindingId: attempt.binding.hostBindingId,
      });
    }
  }
  return { eligible, ineligible };
}

function escapeMermaidLabel(value) {
  return String(value)
    .replace(/[\r\n\t]+/gu, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("%", "&#37;")
    .replaceAll("\\", "&#92;");
}

export function renderMermaid(plan) {
  const nodes = [...plan.nodes].sort((left, right) => compareCodeUnits(left.id, right.id));
  const aliases = new Map(nodes.map((node, index) => [node.id, "n" + index]));
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    const label = escapeMermaidLabel(
      node.id + ": " + node.title + " (" + node.status + " · " + node.executionSurface + ")"
    );
    lines.push("  " + aliases.get(node.id) + "[" + JSON.stringify(label) + "]");
  }
  const edges = [];
  for (const node of nodes) {
    for (const dependency of [...node.dependencies].sort()) {
      edges.push("  " + aliases.get(dependency) + " --> " + aliases.get(node.id));
    }
  }
  lines.push(...edges.sort());
  return lines.join("\n") + "\n";
}

export async function initializeProject(options) {
  const root = await assertDirectory(options.root);
  const projectId = validateIdentifier(options.projectId, "project ID");
  const runId = validateIdentifier(options.runId, "run ID");
  const objective = validateText(options.objective, "objective", MAX_OBJECTIVE_LENGTH);
  const orchestrationRoot = path.join(root, ".rudi", "orchestration");
  const plan = validatePlan({
    schemaVersion: 1,
    projectId,
    runId,
    revision: 1,
    objective,
    requestedMaxParallel: options.maxParallel,
    resourceEnvelope: {
      maxElapsedSeconds: options.maxElapsedSeconds,
      maxTokens: options.maxTokens,
      softCheckpointElapsedSeconds: options.softCheckpointElapsedSeconds,
      softCheckpointTokens: options.softCheckpointTokens,
    },
    reviewPolicy: {
      maxIndependentReviews: 1,
      maxFocusedConfirmations: 1,
      additionalReviewRule: "unresolved_blocker_or_explicit_authorization",
    },
    nodes: [],
    handoffs: [],
  });
  const decisions = { schemaVersion: 1, projectId, decisions: [] };
  const outputs = [
    ["plan.json", serializeJson(plan)],
    ["decisions.json", serializeJson(decisions)],
    ["graph.mmd", renderMermaid(plan)],
    [".gitignore", "runs/\n"],
  ];
  await assertOwnedAncestorsAreNotSymlinks(
    path.join(orchestrationRoot, "plan.json")
  );
  for (const name of [...outputs.map(([outputName]) => outputName), "runs"]) {
    if (await pathExists(path.join(orchestrationRoot, name))) {
      throw new Error("Refusing to initialize over existing orchestration state");
    }
  }
  await fs.mkdir(orchestrationRoot, { recursive: true });
  await fs.mkdir(path.join(orchestrationRoot, "runs"), { recursive: true });
  for (const [name, content] of outputs) {
    await writeNewFile(path.join(orchestrationRoot, name), content);
  }
  return plan;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "init") {
    const plan = await initializeProject(parseInitArgs(args));
    process.stdout.write(serializeJson({ ok: true, projectId: plan.projectId, runId: plan.runId }));
    return;
  }
  if (command === "validate") {
    const options = parsePlanArgs(args);
    const plan = validatePlan(await readPlanFile(options.plan));
    process.stdout.write(
      serializeJson({ valid: true, projectId: plan.projectId, runId: plan.runId })
    );
    return;
  }
  if (command === "promote") {
    const options = parsePromotionArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const input = await readJsonDocument(options.input);
    const { plan, result } = await withExclusiveMutationLock(planPath, async () => {
      const lockedPlan = validatePlan(await readPlanFile(planPath));
      const promotion = promoteDecisionFrontier(lockedPlan, input.value, input.bytes);
      if (!promotion.idempotent) {
        await replaceOwnedFile(planPath, serializeJson(lockedPlan));
      }
      return { plan: lockedPlan, result: promotion };
    });
    process.stdout.write(
      serializeJson({
        promoted: true,
        promotionId: result.receipt.promotionId,
        createdNodeIds: result.receipt.createdNodeIds,
        revision: plan.revision,
        frontierRevision: plan.decisionFrontier.revision,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "run-init") {
    const options = parseRunInputArgs(args);
    const input = await readJsonFile(options.input);
    const run = await initializeRun(options.plan, options.run, input);
    process.stdout.write(
      serializeJson({
        initialized: true,
        projectId: run.projectId,
        runId: run.runId,
        planRevision: run.planRevision,
      })
    );
    return;
  }
  if (command === "validate-run") {
    const options = parseReadyArgs(args);
    if (!options.run) throw new Error("--run is required");
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const run = validateRun(plan, await readRunFile(options.run, planPath));
    process.stdout.write(
      serializeJson({
        valid: true,
        projectId: run.projectId,
        runId: run.runId,
        planRevision: run.planRevision,
      })
    );
    return;
  }
  if (command === "prepare") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const runPath = assertRunBelongsToPlan(options.run, planPath);
    if (!(await pathExists(runPath))) {
      throw new Error("Durable run must be initialized before prepare");
    }
    const plan = validatePlan(await readPlanFile(planPath));
    const run = await readRunFile(runPath, planPath);
    const input = await readJsonFile(options.input);
    const result = prepareAttempt(plan, run, input);
    const attempt = result.attempt;
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        prepared: true,
        projectId: plan.projectId,
        runId: plan.runId,
        nodeId: attempt.nodeId,
        attemptId: attempt.attemptId,
        provider: attempt.binding.modelSelection.provider,
        model: attempt.binding.modelSelection.model,
        reasoningProfile: attempt.binding.modelSelection.reasoningProfile,
        idempotencyKey: attempt.binding.idempotencyKey,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "record-usage") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const runPath = assertRunBelongsToPlan(options.run, planPath, plan.runId);
    const run = await readRunFile(runPath, planPath);
    const result = recordUsage(plan, run, await readJsonFile(options.input));
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        usageId: result.report.usageId,
        attemptId: result.report.attemptId,
        decision: result.report.decision,
        pauseRequired: result.report.decision === "pause",
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "record-dispatch") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const runPath = assertRunBelongsToPlan(options.run, planPath, plan.runId);
    const run = await readRunFile(runPath, planPath);
    const result = recordDispatch(plan, run, await readJsonFile(options.input));
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        attemptId: result.attempt.attemptId,
        dispatchState: result.attempt.dispatchState,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "record-termination") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const runPath = assertRunBelongsToPlan(options.run, planPath, plan.runId);
    const run = await readRunFile(runPath, planPath);
    const result = recordTermination(
      plan,
      run,
      await readJsonFile(options.input)
    );
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        attemptId: result.attempt.attemptId,
        terminationOutcome: result.attempt.terminationOutcome,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "record-steering") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const runPath = assertRunBelongsToPlan(options.run, planPath, plan.runId);
    const run = await readRunFile(runPath, planPath);
    const input = await readJsonFile(options.input);
    const result = recordSteering(plan, run, input);
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        attemptId: input.attemptId,
        steeringId: result.record.steeringId,
        state: result.record.state,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "record-archive") {
    const options = parseRunInputArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const runPath = assertRunBelongsToPlan(options.run, planPath, plan.runId);
    const run = await readRunFile(runPath, planPath);
    const result = recordArchive(plan, run, await readJsonFile(options.input));
    if (!result.idempotent) {
      await replaceOwnedFile(runPath, serializeJson(run));
    }
    process.stdout.write(
      serializeJson({
        attemptId: result.attempt.attemptId,
        archiveState: result.attempt.archive.state,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "ready") {
    const options = parseReadyArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const report = options.run
      ? calculateRunReadiness(plan, await readRunFile(options.run, planPath))
      : calculateStaticReadiness(plan);
    process.stdout.write(serializeJson(report));
    return;
  }
  if (command === "render") {
    const options = parsePlanArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const graph = renderMermaid(plan);
    const graphPath = path.join(path.dirname(planPath), "graph.mmd");
    await replaceOwnedFile(graphPath, graph);
    process.stdout.write(serializeJson({ rendered: graphPath, bytes: Buffer.byteLength(graph) }));
    return;
  }
  if (command === "transition") {
    const options = parseTransitionArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const { plan, node } = await withExclusiveMutationLock(planPath, async () => {
      const lockedPlan = validatePlan(await readPlanFile(planPath));
      const run = options.run ? await readRunFile(options.run, planPath) : null;
      const transitionedNode = transitionNode(
        lockedPlan,
        options.node,
        options.to,
        options.blockingReason,
        run
      );
      validatePlan(lockedPlan);
      await replaceOwnedFile(planPath, serializeJson(lockedPlan));
      return { plan: lockedPlan, node: transitionedNode };
    });
    process.stdout.write(
      serializeJson({ nodeId: node.id, status: node.status, revision: plan.revision })
    );
    return;
  }
  if (command === "reconcile") {
    const options = parseReconcileArgs(args);
    const planPath = assertCanonicalPlanPath(options.plan);
    const input = await readJsonDocument(options.input);
    const hasResultId = Object.hasOwn(input.value, "resultId");
    const hasCancellationId = Object.hasOwn(input.value, "cancellationId");
    if (hasResultId === hasCancellationId) {
      throw new Error("reconcile input must be exactly one result or cancellation");
    }
    const { plan, result } = await withExclusiveMutationLock(planPath, async () => {
      const lockedPlan = validatePlan(await readPlanFile(planPath));
      const run = await readRunFile(options.run, planPath);
      const reconciliation = hasResultId
        ? reconcileResult(lockedPlan, run, input.value, input.bytes, options)
        : reconcileCancellation(lockedPlan, run, input.value, input.bytes, options);
      if (!reconciliation.idempotent) {
        validatePlan(lockedPlan);
        await replaceOwnedFile(planPath, serializeJson(lockedPlan));
      }
      return { plan: lockedPlan, result: reconciliation };
    });
    process.stdout.write(
      serializeJson({
        nodeId: result.node.id,
        status: result.node.status,
        revision: plan.revision,
        idempotent: result.idempotent,
      })
    );
    return;
  }
  if (command === "archive-eligible") {
    const options = parseReadyArgs(args);
    if (!options.run) throw new Error("--run is required");
    const planPath = assertCanonicalPlanPath(options.plan);
    const plan = validatePlan(await readPlanFile(planPath));
    const run = await readRunFile(options.run, planPath);
    process.stdout.write(serializeJson(calculateArchiveEligibility(plan, run)));
    return;
  }
  if (command === "--help" || command === "help") {
    process.stdout.write(usage() + "\n");
    return;
  }
  throw new Error(command ? "Unknown command: " + command : usage());
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    process.stderr.write("ERROR: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
