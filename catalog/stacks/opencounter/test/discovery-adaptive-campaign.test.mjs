import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import {
  createAdaptiveZoningCampaignLedger
} from "../src/discovery-adaptive-campaign.mjs";
import {
  buildAdaptiveZoningPreview
} from "../src/discovery-adaptive-zoning.mjs";
import { createDiscoveryLedgerStore } from
  "../src/discovery-ledger-store.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryAnswers,
  queueDiscoveryReconciliation,
  queueDiscoveryReconciliationRetry,
  recordDiscoveryAuthorizedCompletionVerification,
  recordDiscoveryFailure,
  recordDiscoveryResult,
  recordDiscoveryVerification,
  validateDiscoveryLedger
} from "../src/discovery-ledger.mjs";
import { createScenarioWaveCompletionClaimSha256 } from
  "../src/discovery-scenario-residual-identity.mjs";
import {
  catalog,
  createPreliminaryGuidanceFixture
} from "./fixtures/preliminary-guidance-fixture.mjs";

const policy = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-adaptive-policy-v1.json",
  import.meta.url
), "utf8"));

test("creates one exact approval-bound adaptive ledger before provider starts", async () => {
  const fixture = createPreliminaryGuidanceFixture("Prohibited");
  const limitedPolicy = structuredClone(policy);
  limitedPolicy.maximumProviderProjects = 4;
  const preview = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-05T14:00:00.000Z",
    policy: limitedPolicy,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });
  const completionClaim = createCompletionClaim();
  const inputs = {
    authorization: {
      approvedAt: "2026-08-05T14:01:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-adaptive-test",
      maximumProviderProjects: 4,
      previewSha256: preview.previewSha256
    },
    catalog,
    completionClaim,
    createdAt: "2026-08-05T14:02:00.000Z",
    locationPortfolio: createTestPortfolio(),
    preview
  };
  const first = createAdaptiveZoningCampaignLedger(inputs);
  const second = createAdaptiveZoningCampaignLedger(inputs);

  assert.equal(first.schemaVersion, 8);
  assert.equal(first.campaign.campaignId,
    "cincinnati-adaptive-zoning-question-discovery-v1");
  assert.equal(first.campaign.authorization.previewSha256,
    preview.previewSha256);
  assert.equal(first.campaign.authorization.maximumProviderProjects, 4);
  assert.equal(first.campaign.maximumProviderConcurrency, 2);
  assert.equal(first.jobs.length, 4);
  assert.equal(new Set(first.jobs.map(({ jobId }) => jobId)).size, 4);
  assert.equal(first.jobs.every(({ providerReference }) =>
    providerReference === null), true);
  assert.deepEqual(first.jobs.map(({ jobId }) => jobId),
    second.jobs.map(({ jobId }) => jobId));
  assert.deepEqual(first.jobs.map(({ catalogEntryId, locationFixture }) => ({
    catalogEntryId,
    targetBaseZoningCode: locationFixture.expectedBaseZoningCode
  })), preview.candidates.map(({ catalogEntryId, targetBaseZoningCode }) => ({
    catalogEntryId,
    targetBaseZoningCode
  })));
  assert.deepEqual(validateDiscoveryLedger(first), first);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-adaptive-campaign-"
  ));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    const initialized = await store.initialize(first);
    const readBack = await store.read(initialized.ledgerId);
    assert.deepEqual(readBack, initialized);
    const one = await store.leaseNext({
      ledgerId: initialized.ledgerId,
      leasedAt: "2026-08-05T14:03:00.000Z",
      workerId: "adaptive-worker-1"
    });
    const two = await store.leaseNext({
      ledgerId: initialized.ledgerId,
      leasedAt: "2026-08-05T14:03:01.000Z",
      workerId: "adaptive-worker-2"
    });
    const three = await store.leaseNext({
      ledgerId: initialized.ledgerId,
      leasedAt: "2026-08-05T14:03:02.000Z",
      workerId: "adaptive-worker-3"
    });
    assert.notEqual(one.job, null);
    assert.notEqual(two.job, null);
    assert.equal(three.job, null);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }

  const targetedStateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-adaptive-targeted-start-"
  ));
  try {
    const targetedStore = createDiscoveryLedgerStore({
      stateDirectory: targetedStateDirectory
    });
    const initialized = await targetedStore.initialize(first);
    const targeted = await targetedStore.leaseStartJob({
      jobId: initialized.jobs[3].jobId,
      leasedAt: "2026-08-05T14:03:00.000Z",
      ledgerId: initialized.ledgerId,
      workerId: "adaptive-target-worker"
    });
    assert.equal(targeted.job.jobId, initialized.jobs[3].jobId);
    assert.equal(targeted.job.nextAction.kind, "start");
    assert.equal(targeted.job.providerReference, null);
  } finally {
    rmSync(targetedStateDirectory, { force: true, recursive: true });
  }

  assert.throws(() => createAdaptiveZoningCampaignLedger({
    ...inputs,
    authorization: {
      ...inputs.authorization,
      maximumProviderProjects: 3
    }
  }), /authorization/i);
  const changedPortfolio = createTestPortfolio();
  const target = preview.candidates[0].targetBaseZoningCode;
  changedPortfolio.locations.find(({ expectedBaseZoningCode }) =>
    expectedBaseZoningCode === target).observedZoningCode = "SF-2";
  assert.throws(() => createAdaptiveZoningCampaignLedger({
    ...inputs,
    locationPortfolio: changedPortfolio
  }), /location|zoning/i);
});

test("promotes a verified schema-v8 adaptive completion after an indeterminate reconciliation", () => {
  let ledger = createAdaptiveTestLedger();
  let leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T14:03:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:04:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  const providerReference = "opencounter:project:2999100";
  const questions = [{
    id: "opencounter-address",
    options: [{
      label: leased.job.locationFixture.address,
      value: leased.job.locationFixture.address
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  const checkpointResult = {
    checkpoint: {
      checkpointSha256,
      expiresAt: "2026-08-06T14:05:00.000Z",
      questions,
      schemaVersion: 1
    },
    providerReference,
    schemaVersion: 1,
    source: "opencounter",
    status: "needs_requester_input"
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:05:00.000Z",
    result: checkpointResult,
    workerId: "adaptive-recovery-worker"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-05T14:06:00.000Z",
    result: checkpointResult
  });
  const answers = [{
    questionId: "opencounter-address",
    value: leased.job.locationFixture.address
  }];
  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis: {
      approvalId: "requester-approved-adaptive-verification-test",
      approvedAt: "2026-08-05T14:01:00.000Z",
      approvedBy: "requester",
      kind: "requester_approval"
    },
    answers,
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:07:00.000Z"
  });
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T14:08:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:09:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "provider_request_timeout",
      effect: "unknown",
      message: "Continuation timed out after persisted mutation intent."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:10:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:11:00.000Z"
  });
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T14:12:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:13:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  const reconcilingLedger = structuredClone(ledger);
  const terminalResult = {
    classification: "Prohibited",
    zoningDistrict: leased.job.locationFixture.expectedBaseZoningCode
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:14:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference,
      providerRoute: "/projects/2999100/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "adaptive-recovery-worker"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-05T14:15:00.000Z",
    result: {
      providerReference,
      result: terminalResult,
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    }
  });
  const recovered = ledger.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(recovered.status, "completed");
  assert.deepEqual(recovered.answersSupplied.at(-1).answers, answers);
  assert.deepEqual(recovered.terminalResult, terminalResult);
  assert.equal(recovered.verification.status, "completed");
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);

  let oscillating = recordDiscoveryResult(reconcilingLedger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:14:00.000Z",
    result: {
      providerReference,
      result: terminalResult,
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    },
    workerId: "adaptive-recovery-worker"
  });
  oscillating = recordDiscoveryVerification(oscillating, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-05T14:15:00.000Z",
    result: checkpointResult
  });
  const reopened = oscillating.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(reopened.status, "needs_input");
  assert.equal(reopened.terminalResult, null);
  assert.equal(reopened.checkpoint.checkpointSha256, checkpointSha256);
  assert.equal(reopened.observations.at(-2).resultStatus, "indeterminate");
  assert.equal(reopened.observations.at(-1).resultStatus,
    "needs_requester_input");
  assert.deepEqual(reopened.answersSupplied, []);
  assert.deepEqual(validateDiscoveryLedger(oscillating), oscillating);

  oscillating = queueDiscoveryAnswers(oscillating, {
    actorId: "coordinator",
    answerBasis: {
      approvalId: "requester-approved-adaptive-verification-test",
      approvedAt: "2026-08-05T14:01:00.000Z",
      approvedBy: "requester",
      kind: "requester_approval"
    },
    answers,
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:16:00.000Z"
  });
  leased = leaseNextDiscoveryJob(oscillating, {
    leasedAt: "2026-08-05T14:17:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  oscillating = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:18:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  oscillating = recordDiscoveryFailure(oscillating, {
    failure: {
      code: "opencounter_checkpoint_state_missing",
      effect: "none",
      message: "The persisted checkpoint is stale; reconcile the same project."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:19:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  const staleCheckpoint = oscillating.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(staleCheckpoint.status, "indeterminate");
  assert.equal(staleCheckpoint.errors.at(-1).effect, "none");
  assert.equal(staleCheckpoint.pendingMutation.kind, "continue");
  oscillating = queueDiscoveryReconciliation(oscillating, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:20:00.000Z"
  });
  const reconcilingStaleCheckpoint = oscillating.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(reconcilingStaleCheckpoint.status, "queued");
  assert.equal(reconcilingStaleCheckpoint.nextAction.kind, "reconcile");
  let asynchronouslyCompleted = structuredClone(oscillating);
  let asynchronousLease = leaseNextDiscoveryJob(asynchronouslyCompleted, {
    leasedAt: "2026-08-05T14:21:00.000Z",
    workerId: "adaptive-async-completion-worker"
  });
  asynchronouslyCompleted = beginDiscoveryDispatch(asynchronousLease.ledger, {
    dispatchedAt: "2026-08-05T14:22:00.000Z",
    jobId: asynchronousLease.job.jobId,
    leaseToken: asynchronousLease.job.lease.leaseToken,
    workerId: "adaptive-async-completion-worker"
  });
  asynchronouslyCompleted = recordDiscoveryResult(asynchronouslyCompleted, {
    jobId: asynchronousLease.job.jobId,
    leaseToken: asynchronousLease.job.lease.leaseToken,
    observedAt: "2026-08-05T14:23:00.000Z",
    result: checkpointResult,
    workerId: "adaptive-async-completion-worker"
  });
  asynchronouslyCompleted = recordDiscoveryVerification(
    asynchronouslyCompleted,
    {
      actorId: "validator",
      jobId: asynchronousLease.job.jobId,
      observedAt: "2026-08-05T14:24:00.000Z",
      result: {
        providerReference,
        result: terminalResult,
        schemaVersion: 1,
        source: "opencounter",
        status: "completed"
      }
    }
  );
  const asynchronousJob = asynchronouslyCompleted.jobs.find(({ jobId }) =>
    jobId === asynchronousLease.job.jobId);
  assert.equal(asynchronousJob.status, "completed");
  assert.deepEqual(asynchronousJob.answersSupplied.at(-1).answers, answers);
  assert.equal(asynchronousJob.verification.status, "completed");
  assert.deepEqual(
    validateDiscoveryLedger(asynchronouslyCompleted),
    asynchronouslyCompleted
  );
  leased = leaseNextDiscoveryJob(oscillating, {
    leasedAt: "2026-08-05T14:21:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  oscillating = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:22:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  oscillating = recordDiscoveryFailure(oscillating, {
    failure: {
      code: "provider_request_timeout",
      effect: "unknown",
      message: "Reconciliation timed out after persisted mutation intent."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:23:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  oscillating = queueDiscoveryReconciliationRetry(oscillating, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:24:00.000Z",
    retryReason: "provider_html_access_restored"
  });
  leased = leaseNextDiscoveryJob(oscillating, {
    leasedAt: "2026-08-05T14:25:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  oscillating = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T14:26:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-recovery-worker"
  });
  oscillating = recordDiscoveryFailure(oscillating, {
    failure: {
      code: "provider_request_timeout",
      effect: "unknown",
      message: "Reconciliation timed out after persisted mutation intent."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T14:27:00.000Z",
    workerId: "adaptive-recovery-worker"
  });
  oscillating = queueDiscoveryReconciliationRetry(oscillating, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T14:28:00.000Z",
    retryReason: "provider_module_reload_verified"
  });
  const moduleReloadRetry = oscillating.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(moduleReloadRetry.status, "queued");
  assert.equal(moduleReloadRetry.nextAction.kind, "reconcile");
  assert.deepEqual(validateDiscoveryLedger(oscillating), oscillating);
});

test("records an approval-bound schema-v8 completion after unchanged reconciliation", () => {
  let ledger = createAdaptiveTestLedger();
  let leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T15:00:00.000Z",
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T15:01:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-authorized-recovery-worker"
  });
  const providerReference = "opencounter:project:2999200";
  const questions = [{
    id: "opencounter-address",
    options: [{
      label: leased.job.locationFixture.address,
      value: leased.job.locationFixture.address
    }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }, {
    id: "modification_existing_use",
    options: [
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" }
    ],
    prompt: "Are you modifying an existing residential unit?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  const checkpointResult = {
    checkpoint: {
      checkpointSha256,
      expiresAt: "2026-08-06T15:02:00.000Z",
      questions,
      schemaVersion: 1
    },
    providerReference,
    schemaVersion: 1,
    source: "opencounter",
    status: "needs_requester_input"
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T15:02:00.000Z",
    result: checkpointResult,
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-05T15:03:00.000Z",
    result: checkpointResult
  });
  const answers = [{
    questionId: "opencounter-address",
    value: leased.job.locationFixture.address
  }, {
    questionId: "modification_existing_use",
    value: "Yes"
  }];
  const answerBasis = {
    approvalId: "requester-approved-adaptive-verification-test",
    approvedAt: "2026-08-05T14:01:00.000Z",
    approvedBy: "requester",
    kind: "requester_approval"
  };
  ledger = queueDiscoveryAnswers(ledger, {
    actorId: "coordinator",
    answerBasis,
    answers,
    checkpointSha256,
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T15:04:00.000Z"
  });
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T15:05:00.000Z",
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T15:06:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "provider_request_timeout",
      effect: "unknown",
      message: "Continuation timed out after persisted mutation intent."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T15:07:00.000Z",
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-05T15:08:00.000Z"
  });
  leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-05T15:09:00.000Z",
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-05T15:10:00.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "adaptive-authorized-recovery-worker"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-05T15:11:00.000Z",
    result: checkpointResult,
    workerId: "adaptive-authorized-recovery-worker"
  });
  const terminalResult = {
    classification: "Prohibited",
    zoningDistrict: leased.job.locationFixture.expectedBaseZoningCode
  };
  ledger = recordDiscoveryAuthorizedCompletionVerification(ledger, {
    actorId: "validator",
    answerBasis,
    answers,
    checkpointSha256,
    jobId: leased.job.jobId,
    observedAt: "2026-08-05T15:12:00.000Z",
    result: {
      providerReference,
      result: terminalResult,
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    }
  });
  const completed = ledger.jobs.find(({ jobId }) =>
    jobId === leased.job.jobId);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.answersSupplied.at(-1).answers, answers);
  assert.deepEqual(completed.terminalResult, terminalResult);
  assert.equal(completed.verification.status, "completed");
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);
});

function createCompletionClaim() {
  const payload = {
    coverageMetric: "first_pass_provider_question_id_coverage",
    excludedClaims: ["answer_branch_complete"],
    issuedAt: "2026-08-05T13:59:00.000Z",
    kind: "scenario_wave_1_complete",
    limitations: [
      "Test completion claim for an adaptive campaign fixture."
    ],
    logicalScenarioCount: 20,
    previewSha256: "a".repeat(64),
    source: { adjudicationSha256: "b".repeat(64) }
  };
  const claimSha256 = createScenarioWaveCompletionClaimSha256(payload);
  return {
    ...payload,
    claimId: `ocswc_${claimSha256}`,
    claimSha256
  };
}

function createAdaptiveTestLedger() {
  const fixture = createPreliminaryGuidanceFixture("Prohibited");
  const limitedPolicy = structuredClone(policy);
  limitedPolicy.maximumProviderProjects = 4;
  const preview = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-05T14:00:00.000Z",
    policy: limitedPolicy,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });
  return createAdaptiveZoningCampaignLedger({
    authorization: {
      approvedAt: "2026-08-05T14:01:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-adaptive-recovery-test",
      maximumProviderProjects: 4,
      previewSha256: preview.previewSha256
    },
    catalog,
    completionClaim: createCompletionClaim(),
    createdAt: "2026-08-05T14:02:00.000Z",
    locationPortfolio: createTestPortfolio(),
    preview
  });
}

function createTestPortfolio() {
  const zones = policy.samplingStrata.flatMap(
    ({ baseZoningCodes }) => baseZoningCodes
  );
  return {
    jurisdiction: "cincinnati-oh",
    locations: zones.map((zone, index) => ({
      address:
        `VERIFIED ADAPTIVE TEST ADDRESS ${String(index + 1).padStart(2, "0")} - NOT A PROVIDER ADDRESS`,
      boundarySha256: digest(`adaptive-boundary-${zone}`),
      evidence: [{
        evidenceRef: `adaptive-test-evidence-${index + 1}`,
        observedAt: "2026-08-05T13:00:00.000Z",
        source: "test-fixture:adaptive-zoning-location"
      }],
      expectedBaseZoningCode: zone,
      locationId: `adaptive-zone-context-${String(index + 1).padStart(2, "0")}`,
      locationVersion: 1,
      municipality: "City of Cincinnati",
      observedZoningCode: zone,
      overlayFlags: [],
      parcelKey: String(index + 1).padStart(12, "0"),
      rollupId:
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    })),
    portfolioId: "cincinnati-base-zoning-address-portfolio",
    portfolioVersion: 1,
    schemaVersion: 1
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
