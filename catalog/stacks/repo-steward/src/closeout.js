import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createCloseoutStore } from "./closeout-store.js";

const CLOSEOUT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CLOSEOUT_STATES = new Set([
  "observed",
  "classified",
  "preservation_required",
  "retained",
  "archive_eligible",
  "cleanup_pending_approval",
  "cleanup_approved",
  "blocked",
]);
const CLOSEOUT_CLASSIFICATIONS = new Set([
  "active",
  "superseded",
  "retained",
  "archive_candidate",
  "unknown",
]);
const CLOSEOUT_TRANSITIONS = {
  observed: new Set(["classified", "preservation_required", "blocked"]),
  classified: new Set([
    "preservation_required",
    "retained",
    "archive_eligible",
    "blocked",
  ]),
  preservation_required: new Set(["classified", "retained", "blocked"]),
  retained: new Set(["classified", "blocked"]),
  archive_eligible: new Set(["cleanup_pending_approval", "retained", "blocked"]),
  cleanup_pending_approval: new Set(["cleanup_approved", "retained", "blocked"]),
  cleanup_approved: new Set(["retained", "blocked"]),
  blocked: new Set(["classified", "preservation_required", "retained"]),
};
const VALIDATION_OUTCOMES = new Set(["passed", "failed", "skipped"]);

export function createCloseoutOperations(dependencies) {
  const {
    assertActiveLease,
    assertAllowedKeys,
    atomicWriteJson,
    boundedInteger,
    boundedSafeText,
    ensureStateDirectory,
    getResolvedRepositoryStatus,
    nonEmptyString,
    redactText,
    requireEnum,
    requireLeaseId,
    requireOwner,
    requireRepositoryId,
    resolveConfiguredRepository,
    runGit,
    withRecordLock,
  } = dependencies;

  function optionalBoundedSafeText(value, label, maxLength) {
    if (value === undefined || value === null) return null;
    return boundedSafeText(value, label, maxLength);
  }

  function requireCloseoutId(value) {
    const parsed = nonEmptyString(value, "receipt_id", 128);
    if (!CLOSEOUT_ID_PATTERN.test(parsed)) {
      throw new Error(`receipt_id must match ${CLOSEOUT_ID_PATTERN.source}.`);
    }
    return parsed;
  }

  function requireIsoTimestamp(value, label) {
    const parsed = nonEmptyString(value, label, 64);
    if (!Number.isFinite(Date.parse(parsed))) {
      throw new Error(`${label} must be an ISO timestamp.`);
    }
    return new Date(parsed).toISOString();
  }

  function requireBaseRef(value) {
    const parsed = nonEmptyString(value, "base_ref", 256);
    if (
      !/^(?:HEAD|[A-Za-z0-9][A-Za-z0-9._/-]{0,255})$/.test(parsed) ||
      parsed.includes("..") ||
      parsed.includes("//") ||
      parsed.endsWith("/") ||
      parsed.endsWith(".lock")
    ) {
      throw new Error("base_ref must be HEAD or a simple Git ref name.");
    }
    return parsed;
  }

  function parseLineage(value, label, requiredKey, optionalKeys) {
    assertAllowedKeys(value, label, [requiredKey, ...optionalKeys]);
    const result = {
      [requiredKey]: boundedSafeText(value[requiredKey], `${label}.${requiredKey}`, 256),
    };
    for (const key of optionalKeys) {
      if (value[key] !== undefined) {
        result[key] = boundedSafeText(value[key], `${label}.${key}`, 256);
      }
    }
    return result;
  }

  function parseValidationEvidence(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
      throw new Error("validation_evidence must contain from 1 to 100 records.");
    }
    return value.map((evidence, index) => {
      const label = `validation_evidence[${index}]`;
      assertAllowedKeys(evidence, label, [
        "command",
        "outcome",
        "exit_code",
        "summary",
        "at",
      ]);
      const outcome = requireEnum(evidence.outcome, `${label}.outcome`, VALIDATION_OUTCOMES);
      const exitCode = evidence.exit_code ?? null;
      if (
        exitCode !== null &&
        (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255)
      ) {
        throw new Error(`${label}.exit_code must be null or an integer from 0 to 255.`);
      }
      if (outcome === "passed" && exitCode !== 0) {
        throw new Error(`${label} passed outcome requires exit_code 0.`);
      }
      if (outcome === "failed" && (exitCode === null || exitCode === 0)) {
        throw new Error(`${label} failed outcome requires a non-zero exit_code.`);
      }
      if (outcome === "skipped" && exitCode !== null) {
        throw new Error(`${label} skipped outcome requires a null exit_code.`);
      }
      return {
        command: boundedSafeText(evidence.command, `${label}.command`, 500),
        outcome,
        exit_code: exitCode,
        summary: boundedSafeText(evidence.summary, `${label}.summary`, 2000),
        at: requireIsoTimestamp(evidence.at, `${label}.at`),
      };
    });
  }

  function parsePreservationRequirements(value) {
    if (!Array.isArray(value) || value.length > 100) {
      throw new Error("preservation_requirements must be an array of at most 100 strings.");
    }
    return value.map((requirement, index) => (
      boundedSafeText(requirement, `preservation_requirements[${index}]`, 1000)
    ));
  }

  function normalizeCreation(args) {
    return {
      base_ref: requireBaseRef(args.base_ref),
      task_lineage: parseLineage(args.task_lineage, "task_lineage", "task_id", [
        "source_thread_id",
        "plan_id",
        "node_id",
      ]),
      agent_lineage: parseLineage(args.agent_lineage, "agent_lineage", "agent_id", [
        "host",
        "attempt_id",
      ]),
      acceptance_reference: optionalBoundedSafeText(
        args.acceptance_reference,
        "acceptance_reference",
        1000
      ),
      validation_evidence: parseValidationEvidence(args.validation_evidence),
      preservation_requirements: parsePreservationRequirements(
        args.preservation_requirements
      ),
      summary: boundedSafeText(args.summary, "summary", 2000),
    };
  }

  function assertCreationShape(args, state) {
    if (state !== "observed") {
      throw new Error("Closeout create replay must use observed state.");
    }
    for (const transitionOnly of [
      "classification",
      "disposition_summary",
      "approval_reference",
    ]) {
      if (args[transitionOnly] !== undefined) {
        throw new Error(`${transitionOnly} is not allowed at closeout receipt creation.`);
      }
    }
  }

  function creationFingerprint(normalizedCreation) {
    return createHash("sha256")
      .update(JSON.stringify(normalizedCreation))
      .digest("hex");
  }

  function closeoutPaths(stateRoot, repoId, receiptId) {
    const closeoutsRoot = path.join(stateRoot, "closeouts", repoId);
    return {
      actionsRoot: closeoutsRoot,
      active: path.join(closeoutsRoot, `${receiptId}.json`),
      lock: path.join(closeoutsRoot, `.${receiptId}.lock`),
      lockHistory: path.join(closeoutsRoot, "lock-history"),
      versionsRoot: path.join(closeoutsRoot, "versions", receiptId),
    };
  }

  function requireCount(value, label, nullable = false) {
    if (nullable && value === null) return;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be ${nullable ? "null or " : ""}a non-negative integer.`);
    }
  }

  async function readCloseout(file) {
    let receipt;
    try {
      receipt = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error(
        `Unable to read worktree closeout receipt: ${redactText(error?.message)}`
      );
    }
    assertAllowedKeys(receipt, "worktree closeout receipt", [
      "schema_version",
      "repo_id",
      "receipt_id",
      "state",
      "version",
      "repository",
      "git",
      "task_lineage",
      "agent_lineage",
      "acceptance_reference",
      "validation_evidence",
      "classification",
      "disposition",
      "preservation_requirements",
      "cleanup",
      "observed_at",
      "created_at",
      "updated_at",
      "creation_fingerprint",
      "history",
    ]);
    if (receipt.schema_version !== 1) {
      throw new Error("worktree closeout receipt schema_version must be 1.");
    }
    const repoId = requireRepositoryId(
      receipt.repo_id,
      "worktree closeout receipt repo_id"
    );
    requireCloseoutId(receipt.receipt_id);
    const state = requireEnum(
      receipt.state,
      "worktree closeout receipt state",
      CLOSEOUT_STATES
    );
    if (!Number.isSafeInteger(receipt.version) || receipt.version < 1) {
      throw new Error("worktree closeout receipt version must be a positive integer.");
    }

    assertAllowedKeys(receipt.repository, "worktree closeout receipt repository", [
      "repo_id",
      "path",
      "source",
      "root_id",
      "relative_path",
      "remote",
    ]);
    if (requireRepositoryId(receipt.repository.repo_id, "repository.repo_id") !== repoId) {
      throw new Error("worktree closeout receipt repository.repo_id must match repo_id.");
    }
    const repositoryPath = nonEmptyString(receipt.repository.path, "repository.path", 4096);
    if (!path.isAbsolute(repositoryPath)) {
      throw new Error("worktree closeout receipt repository.path must be absolute.");
    }
    nonEmptyString(receipt.repository.source, "repository.source", 64);
    if (receipt.repository.root_id !== null) {
      requireRepositoryId(receipt.repository.root_id, "repository.root_id");
    }
    if (receipt.repository.relative_path !== null) {
      nonEmptyString(receipt.repository.relative_path, "repository.relative_path", 4096);
    }
    assertAllowedKeys(receipt.repository.remote, "repository.remote", [
      "configured",
      "identity",
    ]);
    if (typeof receipt.repository.remote.configured !== "boolean") {
      throw new Error("repository.remote.configured must be a boolean.");
    }
    if (receipt.repository.remote.identity !== null) {
      nonEmptyString(receipt.repository.remote.identity, "repository.remote.identity", 4096);
    }

    assertAllowedKeys(receipt.git, "worktree closeout receipt git", [
      "branch",
      "head",
      "base",
      "upstream",
      "dirty",
    ]);
    if (receipt.git.branch !== null) nonEmptyString(receipt.git.branch, "git.branch", 256);
    if (!/^[0-9a-f]{40}$/.test(receipt.git.head)) {
      throw new Error("git.head must be a lowercase 40-character Git object ID.");
    }
    assertAllowedKeys(receipt.git.base, "git.base", ["ref", "head", "ahead", "behind"]);
    requireBaseRef(receipt.git.base.ref);
    if (!/^[0-9a-f]{40}$/.test(receipt.git.base.head)) {
      throw new Error("git.base.head must be a lowercase 40-character Git object ID.");
    }
    requireCount(receipt.git.base.ahead, "git.base.ahead");
    requireCount(receipt.git.base.behind, "git.base.behind");
    assertAllowedKeys(receipt.git.upstream, "git.upstream", ["ref", "ahead", "behind"]);
    if (receipt.git.upstream.ref !== null) {
      nonEmptyString(receipt.git.upstream.ref, "git.upstream.ref", 256);
    }
    requireCount(receipt.git.upstream.ahead, "git.upstream.ahead", true);
    requireCount(receipt.git.upstream.behind, "git.upstream.behind", true);
    assertAllowedKeys(receipt.git.dirty, "git.dirty", [
      "total",
      "staged",
      "unstaged",
      "untracked",
      "conflicted",
    ]);
    for (const key of ["total", "staged", "unstaged", "untracked", "conflicted"]) {
      requireCount(receipt.git.dirty[key], `git.dirty.${key}`);
    }

    parseLineage(receipt.task_lineage, "task_lineage", "task_id", [
      "source_thread_id",
      "plan_id",
      "node_id",
    ]);
    parseLineage(receipt.agent_lineage, "agent_lineage", "agent_id", [
      "host",
      "attempt_id",
    ]);
    optionalBoundedSafeText(receipt.acceptance_reference, "acceptance_reference", 1000);
    parseValidationEvidence(receipt.validation_evidence);
    if (receipt.classification !== null) {
      requireEnum(receipt.classification, "classification", CLOSEOUT_CLASSIFICATIONS);
    }
    assertAllowedKeys(receipt.disposition, "disposition", ["state", "summary"]);
    if (receipt.disposition.state !== state) {
      throw new Error("worktree closeout receipt disposition.state must match state.");
    }
    boundedSafeText(receipt.disposition.summary, "disposition.summary", 2000);
    parsePreservationRequirements(receipt.preservation_requirements);
    assertAllowedKeys(receipt.cleanup, "cleanup", [
      "eligible",
      "reasons",
      "approval_reference",
    ]);
    if (typeof receipt.cleanup.eligible !== "boolean") {
      throw new Error("cleanup.eligible must be a boolean.");
    }
    if (!Array.isArray(receipt.cleanup.reasons) || receipt.cleanup.reasons.length > 20) {
      throw new Error("cleanup.reasons must be an array of at most 20 strings.");
    }
    for (const [index, reason] of receipt.cleanup.reasons.entries()) {
      nonEmptyString(reason, `cleanup.reasons[${index}]`, 256);
    }
    if (receipt.cleanup.approval_reference !== null) {
      boundedSafeText(receipt.cleanup.approval_reference, "cleanup.approval_reference", 1000);
    }
    if (state === "cleanup_approved" && !receipt.cleanup.approval_reference) {
      throw new Error("cleanup_approved receipt requires cleanup.approval_reference.");
    }
    for (const key of ["observed_at", "created_at", "updated_at"]) {
      requireIsoTimestamp(receipt[key], key);
    }
    if (!/^[0-9a-f]{64}$/.test(receipt.creation_fingerprint)) {
      throw new Error("creation_fingerprint must be a lowercase SHA-256 digest.");
    }
    if (!Array.isArray(receipt.history) || receipt.history.length !== receipt.version) {
      throw new Error("worktree closeout receipt history must contain one entry per version.");
    }
    for (const [index, event] of receipt.history.entries()) {
      const label = `history[${index}]`;
      assertAllowedKeys(event, label, ["version", "event", "actor", "from", "to", "at"]);
      if (event.version !== index + 1) {
        throw new Error(`${label}.version must be sequential.`);
      }
      requireEnum(event.event, `${label}.event`, new Set(["observed", "transition"]));
      nonEmptyString(event.actor, `${label}.actor`, 128);
      if (event.from !== null) requireEnum(event.from, `${label}.from`, CLOSEOUT_STATES);
      requireEnum(event.to, `${label}.to`, CLOSEOUT_STATES);
      requireIsoTimestamp(event.at, `${label}.at`);
    }
    if (receipt.history.at(-1).to !== state) {
      throw new Error("worktree closeout receipt history must end in the current state.");
    }
    return receipt;
  }

  const { persistVersion, readBoundCloseout } = createCloseoutStore({
    atomicWriteJson,
    ensureStateDirectory,
    readCloseout,
  });

  async function resolveBase(repository, baseRef, pinnedHead = null) {
    const head = pinnedHead ?? (
      await runGit(repository.path, ["rev-parse", "--verify", `${baseRef}^{commit}`], {
        operation: `Resolve closeout base for ${repository.id}`,
      })
    ).stdout.trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(head)) {
      throw new Error(`Resolved closeout base is not a commit for ${repository.id}.`);
    }
    const counts = (
      await runGit(repository.path, [
        "rev-list",
        "--left-right",
        "--count",
        `HEAD...${head}`,
      ], { operation: `Compare closeout base for ${repository.id}` })
    ).stdout.trim().split(/\s+/).map(Number);
    return { ref: baseRef, head, ahead: counts[0], behind: counts[1] };
  }

  function cleanupEligibility(
    status,
    base,
    validationEvidence,
    acceptanceReference,
    preservation
  ) {
    const reasons = [];
    if (status.dirty.total > 0) reasons.push("worktree_is_dirty");
    if (status.dirty.conflicted > 0) reasons.push("worktree_has_conflicts");
    if (status.ahead !== null && status.ahead > 0) {
      reasons.push("local_commits_are_ahead_of_upstream");
    }
    if (base.ahead > 0) reasons.push("local_commits_are_ahead_of_base");
    if (!validationEvidence.some((evidence) => evidence.outcome === "passed")) {
      reasons.push("no_passing_validation_evidence");
    }
    if (validationEvidence.some((evidence) => evidence.outcome === "failed")) {
      reasons.push("validation_evidence_contains_failure");
    }
    if (!acceptanceReference) reasons.push("acceptance_reference_is_missing");
    if (preservation.length > 0) reasons.push("preservation_requirements_exist");
    return { eligible: reasons.length === 0, reasons, approval_reference: null };
  }

  async function recordRepositoryCloseout(args = {}, options = {}) {
    assertAllowedKeys(args, "arguments", [
      "repo_id",
      "owner",
      "lease_id",
      "receipt_id",
      "state",
      "expected_version",
      "base_ref",
      "task_lineage",
      "agent_lineage",
      "acceptance_reference",
      "validation_evidence",
      "preservation_requirements",
      "summary",
      "classification",
      "disposition_summary",
      "approval_reference",
    ]);
    const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
    const owner = requireOwner(args.owner);
    const leaseId = requireLeaseId(args.lease_id);
    const receiptId = requireCloseoutId(args.receipt_id);
    const state = requireEnum(args.state, "state", CLOSEOUT_STATES);
    const expectedVersion = boundedInteger(args.expected_version, "expected_version", {
      defaultValue: null,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    if (expectedVersion === null) throw new Error("expected_version is required.");
    const lease = await assertActiveLease(config, repository, owner, leaseId, options);
    const paths = closeoutPaths(config.stateRoot, repository.id, receiptId);

    return withRecordLock(paths, lease, async () => {
      const existing = await readBoundCloseout(paths);
      if (existing) {
        if (expectedVersion === 0) {
          assertCreationShape(args, state);
          const fingerprint = creationFingerprint(normalizeCreation(args));
          if (existing.creation_fingerprint === fingerprint) {
            return { ...existing, idempotent: true };
          }
          throw new Error(
            `Worktree closeout receipt already exists with different creation input: ${receiptId}.`
          );
        }
        if (existing.version !== expectedVersion) {
          throw new Error(
            `Closeout receipt version conflict for ${receiptId}: expected ${expectedVersion}, current ${existing.version}.`
          );
        }
        if (!CLOSEOUT_TRANSITIONS[existing.state].has(state)) {
          throw new Error(`Illegal closeout transition: ${existing.state} -> ${state}.`);
        }
        for (const creationOnly of [
          "base_ref",
          "task_lineage",
          "agent_lineage",
          "validation_evidence",
          "summary",
        ]) {
          if (args[creationOnly] !== undefined) {
            throw new Error(`${creationOnly} is immutable after closeout receipt creation.`);
          }
        }

        const classification = args.classification === undefined
          ? existing.classification
          : requireEnum(args.classification, "classification", CLOSEOUT_CLASSIFICATIONS);
        if (state === "classified" && !classification) {
          throw new Error("classified state requires classification.");
        }
        const dispositionSummary = boundedSafeText(
          args.disposition_summary,
          "disposition_summary",
          2000
        );
        const preservation = args.preservation_requirements === undefined
          ? existing.preservation_requirements
          : parsePreservationRequirements(args.preservation_requirements);
        if (state === "preservation_required" && preservation.length === 0) {
          throw new Error("preservation_required state requires preservation_requirements.");
        }
        if (
          ["archive_eligible", "cleanup_pending_approval", "cleanup_approved"].includes(state) &&
          !["superseded", "archive_candidate"].includes(classification)
        ) {
          throw new Error(
            `${state} requires a superseded or archive_candidate classification.`
          );
        }
        const acceptanceReference = args.acceptance_reference === undefined
          ? existing.acceptance_reference
          : optionalBoundedSafeText(args.acceptance_reference, "acceptance_reference", 1000);
        if (
          existing.acceptance_reference &&
          acceptanceReference !== existing.acceptance_reference
        ) {
          throw new Error("acceptance_reference is immutable once recorded.");
        }
        if (args.approval_reference !== undefined && state !== "cleanup_approved") {
          throw new Error("approval_reference is allowed only for cleanup_approved state.");
        }
        const approvalReference = state === "cleanup_approved"
          ? boundedSafeText(args.approval_reference, "approval_reference", 1000)
          : null;

        const status = await getResolvedRepositoryStatus(repository);
        const base = await resolveBase(
          repository,
          existing.git.base.ref,
          existing.git.base.head
        );
        const cleanup = cleanupEligibility(
          status,
          base,
          existing.validation_evidence,
          acceptanceReference,
          preservation
        );
        cleanup.approval_reference = approvalReference;
        if (
          ["archive_eligible", "cleanup_pending_approval", "cleanup_approved"].includes(state) &&
          !cleanup.eligible
        ) {
          throw new Error(
            `${state} requires cleanup eligibility; blockers: ${cleanup.reasons.join(", ")}.`
          );
        }
        const now = new Date(
          typeof options.now === "function" ? options.now() : Date.now()
        ).toISOString();
        const version = existing.version + 1;
        return persistVersion(paths, {
          ...existing,
          state,
          version,
          repository: {
            repo_id: repository.id,
            path: status.path,
            source: status.source,
            root_id: status.root_id,
            relative_path: status.relative_path,
            remote: status.remote,
          },
          git: {
            branch: status.branch,
            head: status.head,
            base,
            upstream: { ref: status.upstream, ahead: status.ahead, behind: status.behind },
            dirty: status.dirty,
          },
          acceptance_reference: acceptanceReference,
          classification,
          disposition: { state, summary: dispositionSummary },
          preservation_requirements: preservation,
          cleanup,
          observed_at: now,
          updated_at: now,
          history: [...existing.history, {
            version,
            event: "transition",
            actor: owner,
            from: existing.state,
            to: state,
            at: now,
          }],
        });
      }

      if (expectedVersion !== 0) {
        throw new Error(`New closeout receipt expected_version must be 0: ${receiptId}.`);
      }
      assertCreationShape(args, state);
      const normalized = normalizeCreation(args);
      const status = await getResolvedRepositoryStatus(repository);
      const base = await resolveBase(repository, normalized.base_ref);
      const now = new Date(
        typeof options.now === "function" ? options.now() : Date.now()
      ).toISOString();
      return persistVersion(paths, {
        schema_version: 1,
        repo_id: repository.id,
        receipt_id: receiptId,
        state,
        version: 1,
        repository: {
          repo_id: repository.id,
          path: status.path,
          source: status.source,
          root_id: status.root_id,
          relative_path: status.relative_path,
          remote: status.remote,
        },
        git: {
          branch: status.branch,
          head: status.head,
          base,
          upstream: { ref: status.upstream, ahead: status.ahead, behind: status.behind },
          dirty: status.dirty,
        },
        task_lineage: normalized.task_lineage,
        agent_lineage: normalized.agent_lineage,
        acceptance_reference: normalized.acceptance_reference,
        validation_evidence: normalized.validation_evidence,
        classification: null,
        disposition: { state, summary: normalized.summary },
        preservation_requirements: normalized.preservation_requirements,
        cleanup: cleanupEligibility(
          status,
          base,
          normalized.validation_evidence,
          normalized.acceptance_reference,
          normalized.preservation_requirements
        ),
        observed_at: now,
        created_at: now,
        updated_at: now,
        creation_fingerprint: creationFingerprint(normalized),
        history: [{
          version: 1,
          event: "observed",
          actor: owner,
          from: null,
          to: state,
          at: now,
        }],
      });
    }, options, "Closeout receipt update");
  }

  async function listRepositoryCloseouts(args = {}, options = {}) {
    assertAllowedKeys(args, "arguments", ["repo_id", "state", "limit"]);
    const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
    const limit = boundedInteger(args.limit, "limit", {
      defaultValue: 50,
      min: 1,
      max: 500,
    });
    const state = args.state === undefined
      ? null
      : requireEnum(args.state, "state", CLOSEOUT_STATES);
    const paths = closeoutPaths(config.stateRoot, repository.id, "placeholder");
    let entries;
    try {
      entries = await fs.readdir(paths.actionsRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return { repo_id: repository.id, receipts: [] };
      throw error;
    }
    const receipts = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".json")) {
        continue;
      }
      const receiptId = entry.name.slice(0, -".json".length);
      const receipt = await readBoundCloseout(
        closeoutPaths(config.stateRoot, repository.id, receiptId)
      );
      if (!receipt || (state && receipt.state !== state)) continue;
      receipts.push(receipt);
    }
    receipts.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    return { repo_id: repository.id, receipts: receipts.slice(0, limit) };
  }

  return { listRepositoryCloseouts, recordRepositoryCloseout };
}
