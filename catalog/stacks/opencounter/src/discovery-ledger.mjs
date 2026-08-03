import { createHash, randomUUID } from "node:crypto";
import {
  createGuidanceCheckpointSha256,
  validateProviderReference
} from "./core.mjs";
import { createNormalizedQuestionSignatureSha256 } from "./discovery-question-graph.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ENTRY_ID_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function createResidentialPilotLedger({
  authorization,
  catalog,
  createdAt,
  pilotDefinition,
  propertyProfiles
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const pilot = validatePilotDefinition(pilotDefinition, catalog);
  const profiles = validatePropertyProfiles(
    propertyProfiles,
    pilot.propertyProfileCount
  );
  const approvedVolume = validatePilotAuthorization(
    authorization,
    pilot.entries.length * profiles.length,
    timestamp
  );
  const catalogEntries = indexCatalogEntries(catalog);
  const jobs = [];
  const jobIds = new Set();

  for (const plannedEntry of pilot.entries) {
    const catalogEntry = catalogEntries.get(plannedEntry.catalogEntryId);
    if (catalogEntry === undefined) {
      throw new Error("opencounter_discovery_catalog_entry_missing");
    }
    if (catalogEntry.categoryPath.join(" / ")
      !== "Residential Uses / Permanent residential") {
      throw new Error("opencounter_discovery_pilot_entry_out_of_scope");
    }
    for (const profile of profiles) {
      const jobIdentity = {
        catalogEntryId: plannedEntry.catalogEntryId,
        catalogId: catalog.catalogId,
        catalogSha256: catalog.catalogSha256,
        pilotId: pilot.pilotId,
        pilotVersion: pilot.pilotVersion,
        profileId: profile.profileId,
        profileVersion: profile.profileVersion,
        scenarioId: plannedEntry.scenario.scenarioId,
        scenarioVersion: plannedEntry.scenario.scenarioVersion,
        tenantVersion: pilot.tenantVersion
      };
      const jobSha256 = sha256(jobIdentity);
      const jobId = `ocdj_${jobSha256}`;
      if (jobIds.has(jobId)) {
        throw new Error("opencounter_discovery_duplicate_job");
      }
      jobIds.add(jobId);
      jobs.push({
        answerPath: [],
        answersSupplied: [],
        catalogEntryId: plannedEntry.catalogEntryId,
        categoryPath: catalogEntry.categoryPath,
        checkpoint: null,
        createdAt: timestamp,
        errors: [],
        evidence: [{
          actorId: "coordinator",
          eventId: randomUUID(),
          eventType: "job_planned",
          observedAt: timestamp
        }],
        jobId,
        jobSha256,
        lease: null,
        nextAction: {
          input: {
            address: profile.address,
            catalogEntryId: plannedEntry.catalogEntryId,
            catalogId: catalog.catalogId,
            jurisdiction: catalog.jurisdiction,
            schemaVersion: 1
          },
          kind: "start"
        },
        observations: [],
        pendingMutation: null,
        propertyProfile: profile,
        providerReference: null,
        scenario: structuredClone(plannedEntry.scenario),
        status: "queued",
        terminalResult: null,
        updatedAt: timestamp
      });
    }
  }

  const ledgerIdentity = {
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    pilotId: pilot.pilotId,
    pilotVersion: pilot.pilotVersion,
    providerVolumeAuthorizationId: approvedVolume.authorizationId,
    tenantVersion: pilot.tenantVersion
  };
  const ledgerSha256 = sha256(ledgerIdentity);
  return {
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    createdAt: timestamp,
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    pilot: {
      authorization: approvedVolume,
      authorizationRequired: pilot.authorizationRequired,
      leaseDurationSeconds: pilot.leaseDurationSeconds,
      maximumProviderConcurrency: pilot.maximumProviderConcurrency,
      pilotId: pilot.pilotId,
      pilotVersion: pilot.pilotVersion,
      plannedRunCount: jobs.length
    },
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 1,
    updatedAt: timestamp
  };
}

function validatePilotAuthorization(value, plannedRunCount, createdAt) {
  if (value === undefined) {
    throw new Error("opencounter_discovery_authorization_required");
  }
  const authorization = record(value, "authorization");
  exactKeys(authorization, [
    "approvedAt",
    "approvedBy",
    "authorizationId",
    "maximumProviderProjects"
  ], "authorization");
  const approvedAt = isoTimestamp(authorization.approvedAt, "authorization.approvedAt");
  if (
    Date.parse(approvedAt) > Date.parse(createdAt)
    || authorization.maximumProviderProjects !== plannedRunCount
  ) {
    throw new Error("opencounter_discovery_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: id(authorization.approvedBy, "authorization.approvedBy"),
    authorizationId: id(authorization.authorizationId, "authorization.authorizationId"),
    maximumProviderProjects: authorization.maximumProviderProjects
  };
}

export function leaseNextDiscoveryJob(ledgerValue, { leasedAt, workerId }) {
  const ledger = cloneLedger(ledgerValue);
  const timestamp = isoTimestamp(leasedAt, "leasedAt");
  assertMonotonicTimestamp(ledger, timestamp);
  const actorId = id(workerId, "workerId");
  expireStaleLeases(ledger, timestamp);
  const activeJobs = ledger.jobs.filter(({ status }) => status === "active");
  if (activeJobs.some(({ lease }) => lease?.workerId === actorId)) {
    throw new Error("opencounter_discovery_worker_already_leased");
  }
  if (activeJobs.length >= ledger.pilot.maximumProviderConcurrency) {
    return { job: null, ledger };
  }
  const job = ledger.jobs.find(({ status }) => status === "queued");
  if (job === undefined) return { job: null, ledger };

  job.lease = {
    expiresAt: addSeconds(timestamp, ledger.pilot.leaseDurationSeconds),
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
  if (job.providerReference !== null
    && normalized.providerReference !== null
    && normalized.providerReference !== job.providerReference) {
    throw new Error("opencounter_discovery_provider_reference_conflict");
  }
  if (normalized.providerReference !== null) {
    job.providerReference = normalized.providerReference;
  }
  const submittedAnswers = job.pendingMutation.kind === "continue"
    ? structuredClone(job.nextAction.input.answers)
    : [];
  if (normalized.status === "needs_requester_input") {
    recordCheckpointObservation(job, normalized, submittedAnswers, timestamp);
    finishDiscoveryTransition(job, timestamp, "needs_input");
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
  recordSuppliedAnswers(job, submittedAnswers, timestamp);
  job.terminalResult = normalized.terminalResult;
  finishDiscoveryTransition(job, timestamp, normalized.status);
  ledger.updatedAt = timestamp;
  return ledger;
}

function recordCheckpointObservation(job, normalized, submittedAnswers, timestamp) {
  job.checkpoint = normalized.checkpoint;
  job.observations.push({
    answers: submittedAnswers,
    checkpointSha256: normalized.checkpoint.checkpointSha256,
    observedAt: timestamp,
    operation: job.pendingMutation.kind,
    questions: structuredClone(normalized.checkpoint.questions),
    resultStatus: "needs_requester_input"
  });
  recordSuppliedAnswers(job, submittedAnswers, timestamp);
}

function recordSuppliedAnswers(job, submittedAnswers, timestamp) {
  if (submittedAnswers.length === 0) return;
  const supplied = {
    answers: submittedAnswers,
    checkpointSha256: job.nextAction.input.checkpointSha256,
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

function validatePilotDefinition(value, catalog) {
  const pilot = record(value, "pilotDefinition");
  exactKeys(pilot, [
    "authorizationRequired",
    "catalogId",
    "catalogSha256",
    "entries",
    "jurisdiction",
    "leaseDurationSeconds",
    "maximumProviderConcurrency",
    "pilotId",
    "pilotVersion",
    "propertyProfileCount",
    "schemaVersion",
    "tenantVersion",
    "workflow"
  ], "pilotDefinition");
  if (
    pilot.schemaVersion !== 1
    || pilot.authorizationRequired !== true
    || pilot.catalogId !== catalog?.catalogId
    || pilot.catalogSha256 !== catalog?.catalogSha256
    || pilot.jurisdiction !== "cincinnati-oh"
    || pilot.workflow !== "zoning"
    || pilot.tenantVersion !== catalog?.provider?.tenantVersion
    || pilot.propertyProfileCount !== 3
    || pilot.maximumProviderConcurrency !== 2
    || !Number.isSafeInteger(pilot.leaseDurationSeconds)
    || pilot.leaseDurationSeconds < 60
    || pilot.leaseDurationSeconds > 3_600
    || !ID_PATTERN.test(pilot.pilotId)
    || pilot.pilotVersion !== 1
    || !Array.isArray(pilot.entries)
    || pilot.entries.length !== 6
  ) {
    throw new Error("opencounter_discovery_pilot_invalid");
  }
  const entryIds = new Set();
  const scenarioIds = new Set();
  for (const value_ of pilot.entries) {
    const entry = record(value_, "pilot entry");
    exactKeys(entry, ["catalogEntryId", "scenario"], "pilot entry");
    if (!ENTRY_ID_PATTERN.test(entry.catalogEntryId) || entryIds.has(entry.catalogEntryId)) {
      throw new Error("opencounter_discovery_pilot_entry_invalid");
    }
    entryIds.add(entry.catalogEntryId);
    validateScenario(entry.scenario, scenarioIds);
  }
  return structuredClone(pilot);
}

function validateScenario(value, scenarioIds) {
  const scenario = record(value, "scenario");
  exactKeys(scenario, [
    "answerRules",
    "assumptions",
    "scenarioId",
    "scenarioVersion"
  ], "scenario");
  if (
    !ID_PATTERN.test(scenario.scenarioId)
    || scenarioIds.has(scenario.scenarioId)
    || scenario.scenarioVersion !== 1
    || !Array.isArray(scenario.answerRules)
    || scenario.answerRules.length > 100
  ) {
    throw new Error("opencounter_discovery_scenario_invalid");
  }
  scenarioIds.add(scenario.scenarioId);
  const ruleQuestions = new Set();
  for (const value_ of scenario.answerRules) {
    const rule = record(value_, "scenario.answerRule");
    exactKeys(rule, [
      "questionId",
      "questionSignatureSha256",
      "value"
    ], "scenario.answerRule");
    const questionId = boundedText(rule.questionId, "scenario.answerRule.questionId", 100);
    if (
      ruleQuestions.has(questionId)
      || !SHA256_PATTERN.test(rule.questionSignatureSha256)
    ) {
      throw new Error("opencounter_discovery_scenario_answer_rule_invalid");
    }
    ruleQuestions.add(questionId);
    boundedText(rule.value, "scenario.answerRule.value", 2_000);
  }
  boundedJsonObject(scenario.assumptions, "scenario.assumptions", 10_000);
}

function validatePropertyProfiles(values, expectedCount) {
  if (!Array.isArray(values) || values.length !== expectedCount) {
    throw new Error("opencounter_discovery_property_profiles_invalid");
  }
  const identities = new Set();
  return values.map((value, index) => {
    const profile = record(value, `propertyProfiles[${index}]`);
    exactKeys(profile, [
      "address",
      "evidence",
      "profileId",
      "profileVersion",
      "propertyFacts"
    ], `propertyProfiles[${index}]`);
    const profileId = id(profile.profileId, `propertyProfiles[${index}].profileId`);
    if (!Number.isSafeInteger(profile.profileVersion) || profile.profileVersion < 1) {
      throw new Error("opencounter_discovery_property_profile_version_invalid");
    }
    const identity = `${profileId}:${profile.profileVersion}`;
    if (identities.has(identity)) {
      throw new Error("opencounter_discovery_property_profile_duplicate");
    }
    identities.add(identity);
    const evidence = validateEvidence(profile.evidence, index);
    return {
      address: boundedText(profile.address, `propertyProfiles[${index}].address`, 500),
      evidence,
      profileId,
      profileVersion: profile.profileVersion,
      propertyFacts: boundedJsonObject(
        profile.propertyFacts,
        `propertyProfiles[${index}].propertyFacts`,
        20_000
      )
    };
  });
}

function validateEvidence(values, profileIndex) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("opencounter_discovery_property_evidence_invalid");
  }
  return values.map((value, evidenceIndex) => {
    const path = `propertyProfiles[${profileIndex}].evidence[${evidenceIndex}]`;
    const evidence = record(value, path);
    exactKeys(evidence, ["observedAt", "source"], path);
    return {
      observedAt: isoTimestamp(evidence.observedAt, `${path}.observedAt`),
      source: boundedText(evidence.source, `${path}.source`, 2_000)
    };
  });
}

function indexCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.categories)) {
    throw new Error("opencounter_discovery_catalog_invalid");
  }
  const entries = new Map();
  for (const category of catalog.categories) {
    for (const entry of category.entries) {
      entries.set(entry.catalogEntryId, {
        categoryPath: [category.label],
        entry
      });
    }
    for (const group of category.groups) {
      for (const entry of group.entries) {
        entries.set(entry.catalogEntryId, {
          categoryPath: [category.label, group.label],
          entry
        });
      }
    }
  }
  return entries;
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function cloneLedger(value) {
  const ledger = record(value, "ledger");
  if (
    ledger.schemaVersion !== 1
    || !/^ocdl_[0-9a-f]{64}$/.test(ledger.ledgerId)
    || !Array.isArray(ledger.jobs)
    || !ledger.pilot
    || !Number.isSafeInteger(ledger.pilot.maximumProviderConcurrency)
    || ledger.pilot.maximumProviderConcurrency < 1
    || ledger.pilot.maximumProviderConcurrency > 10
    || !Number.isSafeInteger(ledger.pilot.leaseDurationSeconds)
  ) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  return structuredClone(ledger);
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

function validateDiscoveryResult(value, observedAt) {
  const result = record(value, "result");
  if (result.status === "completed") {
    const expectedKeys = result.providerPdf === undefined
      ? ["providerReference", "result", "schemaVersion", "source", "status"]
      : ["providerPdf", "providerReference", "result", "schemaVersion", "source", "status"];
    exactKeys(result, expectedKeys, "result");
    if (result.schemaVersion !== 1 || result.source !== "opencounter") {
      throw new Error("opencounter_discovery_result_invalid");
    }
    const terminalResult = boundedJsonObject(
      result.result,
      "result.result",
      250_000
    );
    if (result.providerPdf !== undefined) {
      boundedJsonObject(result.providerPdf, "result.providerPdf", 50_000);
    }
    return {
      checkpoint: null,
      providerReference: validateProviderReference(result.providerReference),
      status: "completed",
      terminalResult
    };
  }
  exactKeys(result, [
    "checkpoint",
    "providerReference",
    "schemaVersion",
    "source",
    "status"
  ], "result");
  if (
    result.schemaVersion !== 1
    || result.source !== "opencounter"
    || result.status !== "needs_requester_input"
  ) {
    throw new Error("opencounter_discovery_result_invalid");
  }
  const providerReference = validateProviderReference(result.providerReference);
  const checkpoint = record(result.checkpoint, "result.checkpoint");
  exactKeys(checkpoint, [
    "checkpointSha256",
    "expiresAt",
    "questions",
    "schemaVersion"
  ], "result.checkpoint");
  if (
    checkpoint.schemaVersion !== 1
    || !SHA256_PATTERN.test(checkpoint.checkpointSha256)
    || Date.parse(isoTimestamp(checkpoint.expiresAt, "result.checkpoint.expiresAt"))
      <= Date.parse(observedAt)
    || !Array.isArray(checkpoint.questions)
    || checkpoint.questions.length < 1
    || checkpoint.questions.length > 50
  ) {
    throw new Error("opencounter_discovery_checkpoint_invalid");
  }
  const expectedSha256 = createGuidanceCheckpointSha256(
    providerReference,
    checkpoint.questions
  );
  if (checkpoint.checkpointSha256 !== expectedSha256) {
    throw new Error("opencounter_discovery_checkpoint_digest_invalid");
  }
  return {
    checkpoint: structuredClone(checkpoint),
    providerReference,
    status: "needs_requester_input",
    terminalResult: null
  };
}

function validateCheckpointAnswers(values, questions) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("opencounter_discovery_answers_invalid");
  }
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answers = [];
  const seen = new Set();
  for (const value of values) {
    const answer = record(value, "answer");
    exactKeys(answer, ["questionId", "value"], "answer");
    const questionId = boundedText(answer.questionId, "answer.questionId", 100);
    const answerValue = boundedText(answer.value, "answer.value", 2_000);
    if (seen.has(questionId)) throw new Error("opencounter_discovery_answer_duplicate");
    seen.add(questionId);
    const question = questionsById.get(questionId);
    if (question === undefined) throw new Error("opencounter_discovery_answer_unknown");
    if (question.type === "single_select"
      && !question.options.some(({ value: optionValue }) => optionValue === answerValue)) {
      throw new Error("opencounter_discovery_answer_invalid");
    }
    answers.push({ questionId, value: answerValue });
  }
  if (questions.some((question) => question.required && !seen.has(question.id))) {
    throw new Error("opencounter_discovery_answers_incomplete");
  }
  return answers;
}

function validateDiscoveryFailure(value) {
  const failure = record(value, "failure");
  exactKeys(failure, ["code", "effect", "message"], "failure");
  const code = id(failure.code, "failure.code");
  if (failure.effect !== "none" && failure.effect !== "unknown") {
    throw new Error("opencounter_discovery_failure_effect_invalid");
  }
  return {
    code,
    effect: failure.effect,
    message: boundedText(failure.message, "failure.message", 2_000)
  };
}

function validateAnswerBasis(value, job, answers, queuedAt) {
  if (value === undefined) {
    throw new Error("opencounter_discovery_answer_basis_required");
  }
  const basis = record(value, "answerBasis");
  if (basis.kind === "requester_approval") {
    exactKeys(basis, [
      "approvalId",
      "approvedAt",
      "approvedBy",
      "kind"
    ], "answerBasis");
    const approvedAt = isoTimestamp(basis.approvedAt, "answerBasis.approvedAt");
    if (Date.parse(approvedAt) > Date.parse(queuedAt)) {
      throw new Error("opencounter_discovery_answer_basis_invalid");
    }
    return {
      approvalId: id(basis.approvalId, "answerBasis.approvalId"),
      approvedAt,
      approvedBy: id(basis.approvedBy, "answerBasis.approvedBy"),
      kind: "requester_approval"
    };
  }
  if (basis.kind === "scenario_fixture") {
    exactKeys(basis, ["kind", "scenarioId", "scenarioVersion"], "answerBasis");
    if (
      basis.scenarioId !== job.scenario.scenarioId
      || basis.scenarioVersion !== job.scenario.scenarioVersion
    ) {
      throw new Error("opencounter_discovery_answer_basis_invalid");
    }
    for (const answer of answers) {
      const question = job.checkpoint.questions.find(
        ({ id: questionId }) => questionId === answer.questionId
      );
      const signature = createNormalizedQuestionSignatureSha256(question);
      const rule = job.scenario.answerRules.find((candidate) =>
        candidate.questionId === answer.questionId
        && candidate.questionSignatureSha256 === signature
        && candidate.value === answer.value);
      if (rule === undefined) {
        throw new Error("opencounter_discovery_scenario_answer_not_authorized");
      }
    }
    return {
      kind: "scenario_fixture",
      scenarioId: basis.scenarioId,
      scenarioVersion: basis.scenarioVersion
    };
  }
  throw new Error("opencounter_discovery_answer_basis_invalid");
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

function boundedJsonObject(value, path, maximumBytes) {
  const object = record(value, path);
  const serialized = canonicalJson(object);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error(`${path} is too large.`);
  }
  return structuredClone(object);
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${path} has unsupported or missing fields.`);
  }
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
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
