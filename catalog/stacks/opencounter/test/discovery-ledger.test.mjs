import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  beginDiscoveryDispatch,
  createResidentialPilotLedger,
  leaseNextDiscoveryJob,
  queueDiscoveryAnswers,
  queueDiscoveryReconciliation,
  recordDiscoveryFailure,
  recordDiscoveryResult,
  summarizeDiscoveryLedger,
  validateDiscoveryLedger
} from "../src/discovery-ledger.mjs";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import { buildObservedQuestionGraph } from "../src/discovery-question-graph.mjs";
import { createDiscoveryLedgerStore } from "../src/discovery-ledger-store.mjs";
import { createCatalogDiscoveryLedger } from "../src/discovery-plan.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const pilotDefinition = JSON.parse(readFileSync(new URL(
  "../catalog/residential-question-discovery-pilot.json",
  import.meta.url
), "utf8"));

const propertyProfiles = [1, 2, 3].map((number) => ({
  address: `TEST PROFILE ${number} — NOT A PROVIDER ADDRESS`,
  evidence: [{
    observedAt: "2026-08-03T12:00:00.000Z",
    source: `test-fixture:profile-${number}`
  }],
  profileId: `test-profile-${number}`,
  profileVersion: 1,
  propertyFacts: {
    profileClass: number === 1 ? "single_family" : number === 2 ? "two_family" : "multi_family"
  }
}));
const testAuthorization = {
  approvedAt: "2026-08-03T12:15:00.000Z",
  approvedBy: "test-suite",
  authorizationId: "synthetic-fixture-only",
  maximumProviderProjects: 18
};
const discoveryDefinition = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-first-pass.json",
  import.meta.url
), "utf8"));
const locationFixture = {
  address: "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS",
  evidence: [{
    observedAt: "2026-08-03T12:00:00.000Z",
    source: "test-fixture:requester-confirmed-location"
  }],
  locationId: "confirmed-test-location",
  locationVersion: 1
};
const catalogAuthorization = {
  approvedAt: "2026-08-03T12:15:00.000Z",
  approvedBy: "requester",
  authorizationId: "requester-approved-126-first-pass",
  maximumProviderProjects: 126
};

function createCatalogTestLedger() {
  return createCatalogDiscoveryLedger({
    authorization: catalogAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    discoveryDefinition,
    locationFixture
  });
}

test("plans one stable first-pass job for every catalog use code", async () => {
  const first = createCatalogTestLedger();
  const second = createCatalogTestLedger();
  const catalogEntryIds = catalog.categories.flatMap((category) => [
    ...category.entries,
    ...category.groups.flatMap((group) => group.entries)
  ]).sort((left, right) => left.displayOrder - right.displayOrder)
    .map(({ catalogEntryId }) => catalogEntryId);

  assert.equal(first.schemaVersion, 2);
  assert.equal(first.jobs.length, 126);
  assert.equal(new Set(first.jobs.map(({ jobId }) => jobId)).size, 126);
  assert.deepEqual(first.jobs.map(({ catalogEntryId }) => catalogEntryId), catalogEntryIds);
  assert.deepEqual(first.jobs.map(({ jobId }) => jobId), second.jobs.map(({ jobId }) => jobId));
  assert.deepEqual(new Set(first.jobs.map(({ status }) => status)), new Set(["queued"]));
  assert.equal(new Set(first.jobs.map(({ categoryPath }) => categoryPath[0])).size, 7);
  assert.deepEqual(new Set(first.jobs.map(({ locationFixture }) => locationFixture.address)),
    new Set([locationFixture.address]));
  assert.equal(first.campaign.plannedRunCount, 126);
  assert.equal(first.campaign.authorization.maximumProviderProjects, 126);
  assert.deepEqual(validateDiscoveryLedger(first), first);
  const leased = leaseNextDiscoveryJob(first, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  assert.equal(leased.job.catalogEntryId, catalogEntryIds[0]);
  assert.equal(leased.ledger.jobs.filter(({ status }) => status === "active").length, 1);

  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-126-ledger-test-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    await store.initialize(first);
    const persisted = await store.read(first.ledgerId);
    assert.equal(persisted.jobs.length, 126);
    assert.equal(persisted.ledgerId, first.ledgerId);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("queues only the exact confirmed location answer", async () => {
  const { queueDiscoveryLocationAnswer } = await import("../src/discovery-ledger.mjs");
  let ledger = createCatalogTestLedger();
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const providerReference = "opencounter:project:3000100";
  const questions = [{
    id: "opencounter-address",
    options: [{ label: locationFixture.address, value: locationFixture.address }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(providerReference, questions);
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:33:00.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    },
    workerId: "runner-1"
  });

  ledger = queueDiscoveryLocationAnswer(ledger, {
    actorId: "coordinator",
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const queued = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(queued.status, "queued");
  assert.deepEqual(queued.nextAction, {
    answerBasis: {
      kind: "location_fixture",
      locationId: locationFixture.locationId,
      locationVersion: locationFixture.locationVersion
    },
    input: {
      answers: [{ questionId: "opencounter-address", value: locationFixture.address }],
      checkpointSha256,
      providerReference
    },
    kind: "continue"
  });
});

test("enforces the two-project lease cap for the catalog-wide campaign", () => {
  let ledger = createCatalogTestLedger();

  const first = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "campaign-runner-1"
  });
  ledger = first.ledger;
  const second = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:01.000Z",
    workerId: "campaign-runner-2"
  });
  ledger = second.ledger;
  const third = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:02.000Z",
    workerId: "campaign-runner-3"
  });

  assert.notEqual(first.job.jobId, second.job.jobId);
  assert.equal(third.job, null);
  assert.equal(third.ledger.jobs.filter(({ status }) => status === "active").length, 2);
});

test("requires exact provider-volume authorization before jobs are queued", () => {
  assert.throws(() => createResidentialPilotLedger({
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  }), /authorization_required/);
});

test("expands the permanent-residential pilot into 18 stable unique jobs", () => {
  const first = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const second = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });

  assert.equal(first.jobs.length, 18);
  assert.equal(new Set(first.jobs.map(({ jobId }) => jobId)).size, 18);
  assert.deepEqual(first.jobs.map(({ jobId }) => jobId), second.jobs.map(({ jobId }) => jobId));
  assert.deepEqual(new Set(first.jobs.map(({ status }) => status)), new Set(["queued"]));
  assert.deepEqual(new Set(first.jobs.map(({ categoryPath }) => categoryPath.join(" / "))),
    new Set(["Residential Uses / Permanent residential"]));
  assert.equal(first.catalog.tenantVersion, 307);
  assert.equal(first.pilot.plannedRunCount, 18);
});

test("leases at most two distinct jobs to distinct workers", () => {
  let ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });

  const first = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = first.ledger;
  const second = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:01.000Z",
    workerId: "runner-2"
  });
  ledger = second.ledger;
  const third = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:02.000Z",
    workerId: "runner-3"
  });

  assert.notEqual(first.job.jobId, second.job.jobId);
  assert.notEqual(first.job.lease.leaseToken, second.job.lease.leaseToken);
  assert.equal(first.job.status, "active");
  assert.equal(second.job.status, "active");
  assert.equal(third.job, null);
  assert.equal(third.ledger.jobs.filter(({ status }) => status === "active").length, 2);
});

test("requeues expired pre-dispatch work but makes expired post-intent work indeterminate", () => {
  let ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const first = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  const second = leaseNextDiscoveryJob(first.ledger, {
    leasedAt: "2026-08-03T12:31:01.000Z",
    workerId: "runner-2"
  });
  ledger = beginDiscoveryDispatch(second.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: first.job.jobId,
    leaseToken: first.job.lease.leaseToken,
    workerId: "runner-1"
  });

  const reclaimed = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:47:00.000Z",
    workerId: "runner-3"
  });
  const abandoned = reclaimed.ledger.jobs.find(({ jobId }) => jobId === first.job.jobId);

  assert.equal(abandoned.status, "indeterminate");
  assert.equal(abandoned.errors.at(-1).code, "lease_expired_after_mutation_intent");
  assert.equal(reclaimed.job.jobId, second.job.jobId);
  assert.equal(reclaimed.job.lease.workerId, "runner-3");
});

test("records an exact checkpoint and queues only complete allowed answers", () => {
  let ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const providerReference = "opencounter:project:3000001";
  const questions = [{
    id: "new-construction",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
    prompt: "Is this new construction?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(providerReference, questions);
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:33:00.000Z",
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    },
    workerId: "runner-1"
  });

  const checkpointed = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(checkpointed.status, "needs_input");
  assert.equal(checkpointed.providerReference, providerReference);
  assert.equal(checkpointed.lease, null);
  assert.throws(() => queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answers: [{ questionId: "new-construction", value: "maybe" }],
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  }), /answer_invalid/);
  assert.throws(() => queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answers: [{ questionId: "new-construction", value: "yes" }],
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  }), /answer_basis_required/);
  assert.throws(() => queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      kind: "scenario_fixture",
      scenarioId: checkpointed.scenario.scenarioId,
      scenarioVersion: checkpointed.scenario.scenarioVersion
    },
    answers: [{ questionId: "new-construction", value: "yes" }],
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  }), /scenario_answer_not_authorized/);

  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      approvalId: "requester-answer-1",
      approvedAt: "2026-08-03T12:33:30.000Z",
      approvedBy: "requester",
      kind: "requester_approval"
    },
    answers: [{ questionId: "new-construction", value: "yes" }],
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const queued = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(queued.status, "queued");
  assert.deepEqual(queued.nextAction, {
    answerBasis: {
      approvalId: "requester-answer-1",
      approvedAt: "2026-08-03T12:33:30.000Z",
      approvedBy: "requester",
      kind: "requester_approval"
    },
    input: {
      answers: [{ questionId: "new-construction", value: "yes" }],
      checkpointSha256,
      providerReference
    },
    kind: "continue",
  });

  const continuation = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:35:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(continuation.ledger, {
    dispatchedAt: "2026-08-03T12:36:00.000Z",
    jobId: queued.jobId,
    leaseToken: continuation.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: queued.jobId,
    leaseToken: continuation.job.lease.leaseToken,
    observedAt: "2026-08-03T12:37:00.000Z",
    result: {
      providerReference,
      result: { classification: "Permitted" },
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    },
    workerId: "runner-1"
  });
  const completed = ledger.jobs.find(({ jobId }) => jobId === queued.jobId);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.terminalResult, { classification: "Permitted" });
  assert.deepEqual(completed.answersSupplied.at(-1).answers,
    [{ questionId: "new-construction", value: "yes" }]);
});

test("deduplicates observed questions by provider ID and normalized signature", () => {
  const ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  ledger.jobs[0].observations.push({
    answers: [],
    checkpointSha256: "a".repeat(64),
    observedAt: "2026-08-03T13:00:00.000Z",
    operation: "start",
    questions: [{
      id: "new-construction",
      options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
      prompt: "Is this new construction?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  });
  ledger.jobs[1].observations.push({
    answers: [],
    checkpointSha256: "b".repeat(64),
    observedAt: "2026-08-03T13:05:00.000Z",
    operation: "start",
    questions: [{
      id: "new-construction",
      options: [{ label: " YES ", value: "yes" }, { label: "No", value: "no" }],
      prompt: "  Is this   NEW construction? ",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  });
  ledger.jobs[2].observations.push({
    answers: [],
    checkpointSha256: "c".repeat(64),
    observedAt: "2026-08-03T13:10:00.000Z",
    operation: "start",
    questions: [{
      id: "new-construction",
      options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }, { label: "Unknown", value: "unknown" }],
      prompt: "Is this new construction?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  });

  const graph = buildObservedQuestionGraph(ledger);

  assert.equal(graph.questions.length, 2);
  assert.equal(graph.questions[0].independentObservationCount, 2);
  assert.deepEqual(graph.questions[0].propertyProfileIds, [
    "test-profile-1:1",
    "test-profile-2:1"
  ]);
  assert.equal(graph.questions[0].firstObservedAt, "2026-08-03T13:00:00.000Z");
  assert.equal(graph.questions[0].lastObservedAt, "2026-08-03T13:05:00.000Z");
  assert.notEqual(
    graph.questions[0].normalizedSignatureSha256,
    graph.questions[1].normalizedSignatureSha256
  );
});

test("links exact supplied answers to the next question or terminal result", () => {
  const ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const yesNo = [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }];
  ledger.jobs[0].observations.push({
    answers: [],
    checkpointSha256: "a".repeat(64),
    observedAt: "2026-08-03T13:00:00.000Z",
    operation: "start",
    questions: [{
      id: "new-construction",
      options: yesNo,
      prompt: "Is this new construction?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  }, {
    answers: [{ questionId: "new-construction", value: "yes" }],
    checkpointSha256: "b".repeat(64),
    observedAt: "2026-08-03T13:05:00.000Z",
    operation: "continue",
    questions: [{
      id: "outdoor-activity",
      options: yesNo,
      prompt: "Will there be outdoor activity?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  }, {
    answers: [{ questionId: "outdoor-activity", value: "no" }],
    checkpointSha256: null,
    observedAt: "2026-08-03T13:10:00.000Z",
    operation: "continue",
    questions: [],
    resultStatus: "completed"
  });

  const graph = buildObservedQuestionGraph(ledger);

  assert.equal(graph.edges.length, 2);
  assert.deepEqual(graph.edges.map(({ answerValue, terminalStatus }) => ({
    answerValue,
    terminalStatus
  })), [{
    answerValue: "yes",
    terminalStatus: null
  }, {
    answerValue: "no",
    terminalStatus: "completed"
  }]);
});

test("durably serializes concurrent lease attempts without duplicate assignment", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-ledger-test-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createResidentialPilotLedger({
      authorization: testAuthorization,
      catalog,
      createdAt: "2026-08-03T12:30:00.000Z",
      pilotDefinition,
      propertyProfiles
    });
    await store.initialize(ledger);

    const [first, second] = await Promise.all([
      store.leaseNext({
        leasedAt: "2026-08-03T12:31:00.000Z",
        ledgerId: ledger.ledgerId,
        workerId: "runner-1"
      }),
      store.leaseNext({
        leasedAt: "2026-08-03T12:31:01.000Z",
        ledgerId: ledger.ledgerId,
        workerId: "runner-2"
      })
    ]);
    const persisted = await store.read(ledger.ledgerId);
    const ledgerPath = path.join(stateDirectory, `${ledger.ledgerId}.json`);

    assert.notEqual(first.job.jobId, second.job.jobId);
    assert.equal(persisted.jobs.filter(({ status }) => status === "active").length, 2);
    assert.equal(statSync(ledgerPath).mode & 0o777, 0o600);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("distinguishes known pre-effect failure from uncertain post-intent failure", () => {
  let ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const preEffect = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = recordDiscoveryFailure(preEffect.ledger, {
    failure: {
      code: "provider_preflight_failed",
      effect: "none",
      message: "The read-only provider fingerprint did not match."
    },
    jobId: preEffect.job.jobId,
    leaseToken: preEffect.job.lease.leaseToken,
    observedAt: "2026-08-03T12:32:00.000Z",
    workerId: "runner-1"
  });
  assert.equal(ledger.jobs.find(({ jobId }) => jobId === preEffect.job.jobId).status,
    "failed");

  const uncertain = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:33:00.000Z",
    workerId: "runner-2"
  });
  ledger = beginDiscoveryDispatch(uncertain.ledger, {
    dispatchedAt: "2026-08-03T12:34:00.000Z",
    jobId: uncertain.job.jobId,
    leaseToken: uncertain.job.lease.leaseToken,
    workerId: "runner-2"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "provider_timeout",
      effect: "unknown",
      message: "The provider timed out after dispatch."
    },
    jobId: uncertain.job.jobId,
    leaseToken: uncertain.job.lease.leaseToken,
    observedAt: "2026-08-03T12:35:00.000Z",
    workerId: "runner-2"
  });
  const indeterminate = ledger.jobs.find(({ jobId }) => jobId === uncertain.job.jobId);
  assert.equal(indeterminate.status, "indeterminate");
  assert.equal(indeterminate.errors.at(-1).code, "provider_timeout");
  assert.equal(indeterminate.nextAction.kind, "start");
});

test("rejects a durable ledger whose job fixture no longer matches its stable identity", async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-ledger-tamper-"));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const ledger = createResidentialPilotLedger({
      authorization: testAuthorization,
      catalog,
      createdAt: "2026-08-03T12:30:00.000Z",
      pilotDefinition,
      propertyProfiles
    });
    await store.initialize(ledger);
    const ledgerPath = path.join(stateDirectory, `${ledger.ledgerId}.json`);
    const tampered = JSON.parse(readFileSync(ledgerPath, "utf8"));
    tampered.jobs[0].propertyProfile.address = "CHANGED WITHOUT A PROFILE VERSION";
    tampered.jobs[0].nextAction.input.address = "CHANGED WITHOUT A PROFILE VERSION";
    writeFileSync(ledgerPath, JSON.stringify(tampered), { mode: 0o600 });

    await assert.rejects(store.read(ledger.ledgerId), /job_identity_invalid/);

    tampered.jobs[0].propertyProfile.address = ledger.jobs[0].propertyProfile.address;
    tampered.jobs[0].nextAction.input.address = ledger.jobs[0].propertyProfile.address;
    tampered.jobs[0].evidence[0].inventedField = "untrusted";
    writeFileSync(ledgerPath, JSON.stringify(tampered), { mode: 0o600 });
    await assert.rejects(store.read(ledger.ledgerId), /evidence_invalid/);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("records the stack's indeterminate result without making a replacement start", () => {
  let ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000002",
      providerRoute: "/projects/3000002/apply/questions",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });

  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(job.status, "indeterminate");
  assert.equal(job.providerReference, "opencounter:project:3000002");
  assert.equal(job.nextAction.kind, "start");
  assert.equal(job.lease, null);

  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const reconciliation = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(reconciliation.status, "queued");
  assert.deepEqual(reconciliation.nextAction, {
    input: { providerReference: "opencounter:project:3000002" },
    kind: "reconcile",
    uncertainDispatchId: job.pendingMutation.dispatchId
  });
});

test("summarizes queue depth, age, active leases, errors and graph coverage", () => {
  const ledger = createResidentialPilotLedger({
    authorization: testAuthorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    pilotDefinition,
    propertyProfiles
  });

  assert.deepEqual(summarizeDiscoveryLedger(ledger, {
    observedAt: "2026-08-03T12:31:00.000Z"
  }), {
    activeLeaseCount: 0,
    errorCount: 0,
    oldestQueuedAgeSeconds: 60,
    observedQuestionCount: 0,
    observedTransitionCount: 0,
    statusCounts: {
      active: 0,
      completed: 0,
      failed: 0,
      indeterminate: 0,
      needs_input: 0,
      queued: 18
    },
    zoningContextDriftCount: 0,
    zoningContextDriftJobIds: []
  });
});
