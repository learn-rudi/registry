import { createHash, randomUUID } from "node:crypto";
import {
  validateAnswerBasis,
  validateCheckpointAnswers,
  validateDiscoveryFailure,
  validateDiscoveryResult
} from "./discovery-ledger-inputs.mjs";
import { addressesReferToSameCincinnatiStreet } from
  "./address-normalization.mjs";
import { validateDiscoveryLedgerShape } from "./discovery-ledger-schema.mjs";
import { findZoningContextDrifts } from "./discovery-zoning-context.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export { createResidentialPilotLedger } from "./discovery-pilot.mjs";
export { createCatalogDiscoveryLedger } from "./discovery-plan.mjs";
export { createZoningPortfolioDiscoveryLedger } from
  "./discovery-zoning-portfolio.mjs";
export { createZoningPortfolioResidualLedger } from
  "./discovery-residual-campaign.mjs";

export function leaseNextDiscoveryJob(ledgerValue, { leasedAt, workerId }) {
  const lease = prepareDiscoveryLease(ledgerValue, { leasedAt, workerId });
  if (lease.atCapacity) return { job: null, ledger: lease.ledger };
  const { ledger } = lease;
  const recoveryJob = ledger.jobs.find(({ nextAction, status }) =>
    status === "queued" && nextAction?.kind !== "start");
  const job = recoveryJob ?? (findZoningContextDrifts(ledger).length === 0
    ? ledger.jobs.find(({ status }) => status === "queued")
    : undefined);
  if (job === undefined) return { job: null, ledger };
  return completeDiscoveryLease(lease, job);
}

export function leaseDiscoveryJob(ledgerValue, {
  jobId,
  leasedAt,
  workerId
}) {
  const lease = prepareDiscoveryLease(ledgerValue, { leasedAt, workerId });
  if (lease.atCapacity) return { job: null, ledger: lease.ledger };
  const job = findJob(lease.ledger, jobId);
  if (job.status !== "queued" || job.nextAction?.kind === "start") {
    throw new Error("opencounter_discovery_job_affinity_invalid");
  }
  return completeDiscoveryLease(lease, job);
}

function prepareDiscoveryLease(ledgerValue, { leasedAt, workerId }) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(leasedAt, "leasedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const actorId = id(workerId, "workerId");
  const operationConfig = ledger.schemaVersion >= 2 ? ledger.campaign : ledger.pilot;
  expireStaleLeases(ledger, timestamp);
  const activeJobs = ledger.jobs.filter(({ status }) => status === "active");
  if (activeJobs.some(({ lease }) => lease?.workerId === actorId)) {
    throw new Error("opencounter_discovery_worker_already_leased");
  }
  return {
    actorId,
    atCapacity: activeJobs.length >= operationConfig.maximumProviderConcurrency,
    ledger,
    operationConfig,
    timestamp
  };
}

function completeDiscoveryLease(lease, job) {
  const { actorId, ledger, operationConfig, timestamp } = lease;
  job.lease = {
    expiresAt: addSeconds(timestamp, operationConfig.leaseDurationSeconds),
    leaseToken: randomUUID(),
    leasedAt: timestamp,
    workerId: actorId
  };
  job.status = "active";
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId,
    eventId: randomUUID(),
    eventType: "job_leased",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return { job: structuredClone(job), ledger };
}

export function validateDiscoveryLedger(value) {
  return cloneLedger(value);
}

export function summarizeDiscoveryLedger(ledgerValue, { observedAt }) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  if (Date.parse(timestamp) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_summary_time_invalid");
  }
  const statusCounts = {
    active: 0,
    completed: 0,
    failed: 0,
    indeterminate: 0,
    needs_input: 0,
    queued: 0
  };
  let errorCount = 0;
  let oldestQueuedAt = null;
  for (const job of ledger.jobs) {
    statusCounts[job.status] += 1;
    errorCount += job.errors.length;
    if (job.status === "queued"
      && (oldestQueuedAt === null || Date.parse(job.updatedAt) < Date.parse(oldestQueuedAt))) {
      oldestQueuedAt = job.updatedAt;
    }
  }
  const zoningContextDrifts = findZoningContextDrifts(ledger);
  return {
    activeLeaseCount: statusCounts.active,
    errorCount,
    oldestQueuedAgeSeconds: oldestQueuedAt === null
      ? null
      : Math.floor((Date.parse(timestamp) - Date.parse(oldestQueuedAt)) / 1_000),
    observedQuestionCount: ledger.questionGraph.questions.length,
    observedTransitionCount: ledger.questionGraph.edges.length,
    statusCounts,
    zoningContextDriftCount: zoningContextDrifts.length,
    zoningContextDriftJobIds: zoningContextDrifts.map(({ jobId }) => jobId)
  };
}

export function beginDiscoveryDispatch(ledgerValue, {
  dispatchedAt,
  jobId,
  leaseToken,
  workerId
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(dispatchedAt, "dispatchedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const job = requireActiveLease(ledger, {
    jobId,
    leaseToken,
    timestamp,
    workerId
  });
  if (job.pendingMutation !== null || job.nextAction === null) {
    throw new Error("opencounter_discovery_dispatch_state_invalid");
  }
  job.pendingMutation = {
    dispatchId: randomUUID(),
    inputSha256: sha256(job.nextAction),
    kind: job.nextAction.kind,
    startedAt: timestamp
  };
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: job.lease.workerId,
    eventId: randomUUID(),
    eventType: `${job.nextAction.kind}_dispatch_started`,
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

export function recordDiscoveryResult(ledgerValue, {
  jobId,
  leaseToken,
  observedAt,
  result,
  workerId
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const job = requireActiveLease(ledger, {
    jobId,
    leaseToken,
    timestamp,
    workerId
  });
  if (job.pendingMutation === null) {
    throw new Error("opencounter_discovery_result_without_dispatch");
  }
  const normalized = validateDiscoveryResult(result, timestamp);
  return applyDiscoveryResult(ledger, job, normalized, timestamp);
}

export function recordLateDiscoveryResult(ledgerValue, {
  jobId,
  leaseToken,
  observedAt,
  result,
  workerId
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const job = requireExpiredActiveLease(ledger, {
    jobId,
    leaseToken,
    timestamp,
    workerId
  });
  if (job.pendingMutation?.kind !== "start"
    || job.nextAction?.kind !== "start") {
    throw new Error("opencounter_discovery_late_result_state_invalid");
  }
  const normalized = validateDiscoveryResult(result, timestamp);
  if (normalized.providerReference === null) {
    throw new Error("opencounter_discovery_late_result_reference_required");
  }
  job.evidence.push({
    actorId: job.lease.workerId,
    eventId: randomUUID(),
    eventType: "late_dispatch_result_recovered",
    observedAt: timestamp
  });
  return applyDiscoveryResult(ledger, job, normalized, timestamp);
}

function applyDiscoveryResult(ledger, job, normalized, timestamp) {
  if (job.providerReference !== null
    && normalized.providerReference !== null
    && normalized.providerReference !== job.providerReference) {
    throw new Error("opencounter_discovery_provider_reference_conflict");
  }
  if (normalized.providerReference !== null) {
    job.providerReference = normalized.providerReference;
  }
  const submittedAction = job.pendingMutation.kind === "reconcile"
    ? job.nextAction.uncertainAction
    : job.nextAction;
  const reconciliationDidNotAdvance = job.pendingMutation.kind === "reconcile"
    && submittedAction?.kind === "continue"
    && normalized.status === "needs_requester_input"
    && normalized.checkpoint.checkpointSha256
      === submittedAction.input.checkpointSha256;
  const submittedAnswers = submittedAction?.kind === "continue"
    && !reconciliationDidNotAdvance
    ? structuredClone(submittedAction.input.answers)
    : [];
  const submittedCheckpointSha256 = submittedAnswers.length === 0
    ? null
    : submittedAction.input.checkpointSha256;
  if (normalized.status === "needs_requester_input") {
    recordCheckpointObservation(
      job,
      normalized,
      submittedAnswers,
      submittedCheckpointSha256,
      timestamp
    );
    finishDiscoveryTransition(job, timestamp, "needs_input");
    ledger.updatedAt = timestamp;
    return ledger;
  }
  if (normalized.status === "indeterminate") {
    job.checkpoint = null;
    job.observations.push({
      answers: [],
      checkpointSha256: null,
      observedAt: timestamp,
      operation: job.pendingMutation.kind,
      questions: [],
      resultStatus: "indeterminate"
    });
    job.terminalResult = normalized.terminalResult;
    job.evidence.push({
      actorId: job.lease.workerId,
      eventId: randomUUID(),
      eventType: `${job.pendingMutation.kind}_indeterminate_observed`,
      observedAt: timestamp
    });
    job.lease = null;
    job.status = "indeterminate";
    job.updatedAt = timestamp;
    ledger.updatedAt = timestamp;
    return ledger;
  }
  job.checkpoint = null;
  job.observations.push({
    answers: submittedAnswers,
    checkpointSha256: null,
    observedAt: timestamp,
    operation: job.pendingMutation.kind,
    questions: [],
    resultStatus: normalized.status
  });
  recordSuppliedAnswers(
    job,
    submittedAnswers,
    submittedCheckpointSha256,
    timestamp
  );
  job.terminalResult = normalized.terminalResult;
  finishDiscoveryTransition(job, timestamp, normalized.status);
  ledger.updatedAt = timestamp;
  return ledger;
}

export function queueDiscoveryLocationAnswer(ledgerValue, {
  actorId,
  checkpointSha256,
  jobId,
  queuedAt
}) {
  const ledger = cloneLedger(ledgerValue);
  const job = findJob(ledger, jobId);
  if (ledger.schemaVersion < 2
    || job.status !== "needs_input"
    || job.checkpoint === null
    || checkpointSha256 !== job.checkpoint.checkpointSha256
    || job.checkpoint.questions.length !== 1) {
    throw new Error("opencounter_discovery_location_answer_state_invalid");
  }
  const question = job.checkpoint.questions[0];
  if (question.id !== "opencounter-address"
    || question.type !== "single_select"
    || question.required !== true) {
    throw new Error("opencounter_discovery_location_question_invalid");
  }
  const matchingOptions = question.options.filter(({ value }) =>
    addressesReferToSameCincinnatiStreet(value, job.locationFixture.address));
  if (matchingOptions.length !== 1) {
    throw new Error("opencounter_discovery_location_match_invalid");
  }
  return queueDiscoveryAnswers(ledger, {
    actorId,
    answerBasis: {
      kind: "location_fixture",
      locationId: job.locationFixture.locationId,
      locationVersion: job.locationFixture.locationVersion
    },
    answers: [{
      questionId: question.id,
      value: matchingOptions[0].value
    }],
    checkpointSha256,
    jobId,
    queuedAt
  });
}

export function recordDiscoveryVerification(ledgerValue, {
  actorId,
  jobId,
  observedAt,
  result
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const validatorId = id(actorId, "actorId");
  const job = findJob(ledger, jobId);
  if (ledger.schemaVersion < 2
    || job.providerReference === null
    || (job.status !== "needs_input" && job.status !== "completed")) {
    throw new Error("opencounter_discovery_verification_state_invalid");
  }
  const normalized = validateDiscoveryResult(result, timestamp);
  if (normalized.providerReference !== job.providerReference) {
    throw new Error("opencounter_discovery_verification_reference_mismatch");
  }
  let verification;
  if (job.status === "needs_input") {
    if (normalized.status !== "needs_requester_input"
      || job.checkpoint === null) {
      throw new Error("opencounter_discovery_verification_checkpoint_mismatch");
    }
    if (normalized.checkpoint.checkpointSha256 !== job.checkpoint.checkpointSha256
      && !reconcileExpandedCheckpoint(job, normalized, timestamp, validatorId)) {
      throw new Error("opencounter_discovery_verification_checkpoint_mismatch");
    }
    verification = {
      checkpointSha256: normalized.checkpoint.checkpointSha256,
      observedAt: timestamp,
      providerReference: normalized.providerReference,
      status: normalized.status
    };
  } else {
    if (normalized.status !== "completed"
      || sha256(normalized.terminalResult) !== sha256(job.terminalResult)) {
      throw new Error("opencounter_discovery_verification_result_mismatch");
    }
    verification = {
      observedAt: timestamp,
      providerReference: normalized.providerReference,
      resultSha256: sha256(normalized.terminalResult),
      status: normalized.status
    };
  }
  job.verification = verification;
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: validatorId,
    eventId: randomUUID(),
    eventType: "provider_read_back_verified",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

function reconcileExpandedCheckpoint(job, normalized, timestamp, validatorId) {
  if (job.verification !== null
    || job.nextAction !== null
    || job.pendingMutation !== null
    || normalized.checkpoint.questions.length <= job.checkpoint.questions.length) {
    return false;
  }
  const readBackQuestions = new Map(normalized.checkpoint.questions.map(
    (question) => [question.id, question]
  ));
  if (job.checkpoint.questions.some((question) =>
    JSON.stringify(readBackQuestions.get(question.id)) !== JSON.stringify(question))) {
    return false;
  }
  const observation = job.observations.at(-1);
  if (observation?.resultStatus !== "needs_requester_input"
    || observation.checkpointSha256 !== job.checkpoint.checkpointSha256) {
    return false;
  }
  job.checkpoint = structuredClone(normalized.checkpoint);
  observation.checkpointSha256 = normalized.checkpoint.checkpointSha256;
  observation.observedAt = timestamp;
  observation.questions = structuredClone(normalized.checkpoint.questions);
  job.evidence.push({
    actorId: validatorId,
    eventId: randomUUID(),
    eventType: "provider_read_back_checkpoint_reconciled",
    observedAt: timestamp
  });
  return true;
}

function recordCheckpointObservation(
  job,
  normalized,
  submittedAnswers,
  submittedCheckpointSha256,
  timestamp
) {
  job.checkpoint = normalized.checkpoint;
  job.observations.push({
    answers: submittedAnswers,
    checkpointSha256: normalized.checkpoint.checkpointSha256,
    observedAt: timestamp,
    operation: job.pendingMutation.kind,
    questions: structuredClone(normalized.checkpoint.questions),
    resultStatus: "needs_requester_input"
  });
  recordSuppliedAnswers(
    job,
    submittedAnswers,
    submittedCheckpointSha256,
    timestamp
  );
}

function recordSuppliedAnswers(
  job,
  submittedAnswers,
  submittedCheckpointSha256,
  timestamp
) {
  if (submittedAnswers.length === 0) return;
  const supplied = {
    answers: submittedAnswers,
    checkpointSha256: submittedCheckpointSha256,
    observedAt: timestamp
  };
  job.answerPath.push(supplied);
  job.answersSupplied.push(supplied);
}

function finishDiscoveryTransition(job, timestamp, status) {
  job.evidence.push({
    actorId: job.lease.workerId,
    eventId: randomUUID(),
    eventType: `${job.pendingMutation.kind}_${status}_observed`,
    observedAt: timestamp
  });
  job.lease = null;
  job.nextAction = null;
  job.pendingMutation = null;
  job.status = status;
  job.updatedAt = timestamp;
}

export function queueDiscoveryAnswers(ledgerValue, {
  actorId,
  answerBasis,
  answers,
  checkpointSha256,
  jobId,
  queuedAt
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(queuedAt, "queuedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const coordinatorId = id(actorId, "actorId");
  const job = findJob(ledger, jobId);
  if (job.status !== "needs_input" || job.checkpoint === null) {
    throw new Error("opencounter_discovery_answer_state_invalid");
  }
  if (checkpointSha256 !== job.checkpoint.checkpointSha256) {
    throw new Error("opencounter_discovery_checkpoint_mismatch");
  }
  const normalizedAnswers = validateCheckpointAnswers(answers, job.checkpoint.questions);
  const normalizedBasis = validateAnswerBasis(
    answerBasis,
    job,
    normalizedAnswers,
    timestamp
  );
  job.nextAction = {
    answerBasis: normalizedBasis,
    input: {
      answers: normalizedAnswers,
      checkpointSha256,
      providerReference: job.providerReference
    },
    kind: "continue",
  };
  job.status = "queued";
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: coordinatorId,
    eventId: randomUUID(),
    eventType: "checkpoint_answers_queued",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

export function queueDiscoveryReconciliation(ledgerValue, {
  actorId,
  jobId,
  queuedAt
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(queuedAt, "queuedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const coordinatorId = id(actorId, "actorId");
  const job = findJob(ledger, jobId);
  if (
    job.status !== "indeterminate"
    || job.providerReference === null
    || job.pendingMutation === null
    || job.pendingMutation.kind === "reconcile"
    || job.pendingMutation.kind === "reconcile_start"
  ) {
    throw new Error("opencounter_discovery_reconciliation_state_invalid");
  }
  job.nextAction = ledger.schemaVersion >= 2 && job.pendingMutation.kind === "start"
    ? {
      input: {
        ...job.nextAction.input,
        providerInputSha256: job.providerInputSha256,
        providerReference: job.providerReference
      },
      kind: "reconcile_start",
      uncertainDispatchId: job.pendingMutation.dispatchId
    }
    : ledger.schemaVersion >= 2
      ? {
        input: { providerReference: job.providerReference },
        kind: "reconcile",
        uncertainAction: structuredClone(job.nextAction),
        uncertainDispatchId: job.pendingMutation.dispatchId
      }
      : {
      input: { providerReference: job.providerReference },
      kind: "reconcile",
      uncertainDispatchId: job.pendingMutation.dispatchId
      };
  job.pendingMutation = null;
  job.status = "queued";
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: coordinatorId,
    eventId: randomUUID(),
    eventType: "same_project_reconciliation_queued",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

export function queueDiscoveryReconciliationRetry(ledgerValue, {
  actorId,
  jobId,
  queuedAt,
  retryReason
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(queuedAt, "queuedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const coordinatorId = id(actorId, "actorId");
  const job = findJob(ledger, jobId);
  const hasHtmlAccessRetry = job.evidence.some(
    ({ eventType }) => eventType === "same_project_reconciliation_retry_queued",
  );
  const hasModuleReloadRetry = job.evidence.some(
    ({ eventType }) => eventType === "same_project_module_reload_retry_queued",
  );
  const isHtmlAccessRetry = retryReason === "provider_html_access_restored"
    && !hasHtmlAccessRetry;
  const isModuleReloadRetry = retryReason === "provider_module_reload_verified"
    && hasHtmlAccessRetry
    && !hasModuleReloadRetry;
  const isStartReconciliation = job.pendingMutation?.kind === "reconcile_start"
    && job.nextAction?.kind === "reconcile_start";
  const isContinuationReconciliation = isHtmlAccessRetry
    && job.pendingMutation?.kind === "reconcile"
    && job.nextAction?.kind === "reconcile"
    && job.nextAction.uncertainAction?.kind === "continue"
    && job.nextAction.uncertainAction.input?.providerReference
      === job.providerReference;
  if (
    (!isHtmlAccessRetry && !isModuleReloadRetry)
    || ledger.schemaVersion < 2
    || job.status !== "indeterminate"
    || job.providerReference === null
    || job.lease !== null
    || (!isStartReconciliation && !isContinuationReconciliation)
    || job.nextAction.input.providerReference !== job.providerReference
  ) {
    throw new Error("opencounter_discovery_reconciliation_retry_invalid");
  }
  job.pendingMutation = null;
  job.status = "queued";
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: coordinatorId,
    eventId: randomUUID(),
    eventType: isModuleReloadRetry
      ? "same_project_module_reload_retry_queued"
      : "same_project_reconciliation_retry_queued",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

export function queueDiscoveryPreEffectRetry(ledgerValue, {
  actorId,
  jobId,
  queuedAt,
  retryReason
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(queuedAt, "queuedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const coordinatorId = id(actorId, "actorId");
  const job = findJob(ledger, jobId);
  const lastError = job.errors.at(-1);
  const hasInitialRetry = job.evidence.some(
    ({ eventType }) => eventType === "pre_effect_retry_queued",
  );
  const hasDeploymentRetry = job.evidence.some(
    ({ eventType }) => eventType === "catalog_path_deployment_retry_queued",
  );
  const isDeploymentRetry =
    retryReason === "catalog_path_search_deployment_verified"
    && lastError?.code === "opencounter_use_not_found"
    && hasInitialRetry
    && !hasDeploymentRetry;
  const retryProofMatches = isDeploymentRetry
    || (!hasInitialRetry
      && ((retryReason === "catalog_slug_disambiguation_verified"
          && lastError?.code === "opencounter_use_ambiguous")
        || (retryReason === "catalog_path_search_verified"
          && lastError?.code === "opencounter_use_not_found")
        || (retryReason === "portal_start_control_render_verified"
          && lastError?.code === "opencounter_start_control_missing")));
  if (
    !retryProofMatches
    || job.status !== "failed"
    || job.providerReference !== null
    || job.lease !== null
    || job.nextAction?.kind !== "start"
    || job.pendingMutation?.kind !== "start"
    || lastError?.effect !== "none"
  ) {
    throw new Error("opencounter_discovery_pre_effect_retry_invalid");
  }
  job.pendingMutation = null;
  job.status = "queued";
  job.updatedAt = timestamp;
  job.evidence.push({
    actorId: coordinatorId,
    eventId: randomUUID(),
    eventType: isDeploymentRetry
      ? "catalog_path_deployment_retry_queued"
      : "pre_effect_retry_queued",
    observedAt: timestamp
  });
  ledger.updatedAt = timestamp;
  return ledger;
}

export function recordDiscoveryFailure(ledgerValue, {
  failure,
  jobId,
  leaseToken,
  observedAt,
  workerId
}) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(observedAt, "observedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const job = requireActiveLease(ledger, {
    jobId,
    leaseToken,
    timestamp,
    workerId
  });
  const normalizedFailure = validateDiscoveryFailure(failure);
  if (normalizedFailure.effect === "unknown" && job.pendingMutation === null) {
    throw new Error("opencounter_discovery_failure_state_invalid");
  }
  const status = normalizedFailure.effect === "unknown"
    ? "indeterminate"
    : "failed";
  job.errors.push({
    ...normalizedFailure,
    observedAt: timestamp
  });
  job.evidence.push({
    actorId: job.lease.workerId,
    eventId: randomUUID(),
    eventType: `${status}_failure_recorded`,
    observedAt: timestamp
  });
  job.lease = null;
  job.status = status;
  job.updatedAt = timestamp;
  ledger.updatedAt = timestamp;
  return ledger;
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function cloneLedger(value) {
  return validateDiscoveryLedgerShape(value);
}

function expireStaleLeases(ledger, timestamp) {
  let changed = false;
  for (const job of ledger.jobs) {
    if (job.status !== "active" || job.lease === null) continue;
    if (Date.parse(job.lease.expiresAt) > Date.parse(timestamp)) continue;
    const actorId = job.lease.workerId;
    if (job.pendingMutation === null) {
      job.status = "queued";
      job.evidence.push({
        actorId,
        eventId: randomUUID(),
        eventType: "lease_expired_before_dispatch",
        observedAt: timestamp
      });
    } else {
      job.status = "indeterminate";
      job.errors.push({
        code: "lease_expired_after_mutation_intent",
        message: "The worker lease expired after provider mutation intent was recorded; reconcile the same project and do not start a replacement.",
        observedAt: timestamp
      });
      job.evidence.push({
        actorId,
        eventId: randomUUID(),
        eventType: "lease_expired_after_mutation_intent",
        observedAt: timestamp
      });
    }
    job.lease = null;
    job.updatedAt = timestamp;
    changed = true;
  }
  if (changed) ledger.updatedAt = timestamp;
}

function findJob(ledger, jobId) {
  const normalizedJobId = boundedText(jobId, "jobId", 80);
  if (!/^ocdj_[0-9a-f]{64}$/.test(normalizedJobId)) {
    throw new Error("opencounter_discovery_job_id_invalid");
  }
  const job = ledger.jobs.find((candidate) => candidate.jobId === normalizedJobId);
  if (job === undefined) throw new Error("opencounter_discovery_job_not_found");
  return job;
}

function requireActiveLease(ledger, {
  jobId,
  leaseToken,
  timestamp,
  workerId
}) {
  const job = findJob(ledger, jobId);
  const actorId = id(workerId, "workerId");
  const token = boundedText(leaseToken, "leaseToken", 100);
  if (
    job.status !== "active"
    || job.lease === null
    || job.lease.workerId !== actorId
    || job.lease.leaseToken !== token
    || Date.parse(job.lease.expiresAt) <= Date.parse(timestamp)
  ) {
    throw new Error("opencounter_discovery_lease_invalid");
  }
  return job;
}

function requireExpiredActiveLease(ledger, {
  jobId,
  leaseToken,
  timestamp,
  workerId
}) {
  const job = findJob(ledger, jobId);
  const actorId = id(workerId, "workerId");
  const token = boundedText(leaseToken, "leaseToken", 100);
  if (
    job.status !== "active"
    || job.lease === null
    || job.lease.workerId !== actorId
    || job.lease.leaseToken !== token
    || Date.parse(job.lease.expiresAt) > Date.parse(timestamp)
  ) {
    throw new Error("opencounter_discovery_expired_lease_required");
  }
  return job;
}

function assertMonotonicTimestamp(ledger, timestamp) {
  if (Date.parse(timestamp) < Date.parse(ledger.updatedAt)) {
    throw new Error("opencounter_discovery_timestamp_out_of_order");
  }
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}

function id(value, path) {
  const text = boundedText(value, path, 100);
  if (!ID_PATTERN.test(text)) throw new Error(`${path} is invalid.`);
  return text;
}

function boundedText(value, path, maximum) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function isoTimestamp(value, path) {
  if (
    typeof value !== "string"
    || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

export const discoveryLedgerInternals = Object.freeze({
  canonicalJson,
  isoTimestamp,
  sha256
});
