import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import { createDiscoveryDispatchRequest } from "../src/discovery-dispatch.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryPreEffectRetry,
  queueDiscoveryReconciliation,
  queueDiscoveryReconciliationRetry,
  recordDiscoveryFailure,
  recordDiscoveryResult,
  recordDiscoveryVerification
} from "../src/discovery-ledger.mjs";
import { createCatalogDiscoveryLedger } from "../src/discovery-plan.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
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

function createCatalogTestLedger() {
  return createCatalogDiscoveryLedger({
    authorization: {
      approvedAt: "2026-08-03T12:15:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-126-first-pass",
      maximumProviderProjects: 126
    },
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    discoveryDefinition,
    locationFixture
  });
}

test("reconciles an uncertain catalog start on the same provider project", () => {
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
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000200",
      providerRoute: "/projects/3000200/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });

  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(job.nextAction.kind, "reconcile_start");
  assert.deepEqual(job.nextAction.input, {
    ...leased.job.nextAction.input,
    providerInputSha256: leased.job.providerInputSha256,
    providerReference: "opencounter:project:3000200"
  });
});

test("requeues one same-project start reconciliation after provider HTML access recovers", () => {
  let ledger = createCatalogTestLedger();
  const initialLease = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(initialLease.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: initialLease.job.jobId,
    leaseToken: initialLease.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: initialLease.job.jobId,
    leaseToken: initialLease.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000200",
      providerRoute: "/projects/3000200/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: initialLease.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });

  const reconciliationLease = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:35:00.000Z",
    workerId: "runner-1"
  });
  assert.equal(reconciliationLease.job.jobId, initialLease.job.jobId);
  ledger = beginDiscoveryDispatch(reconciliationLease.ledger, {
    dispatchedAt: "2026-08-03T12:36:00.000Z",
    jobId: reconciliationLease.job.jobId,
    leaseToken: reconciliationLease.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: reconciliationLease.job.jobId,
    leaseToken: reconciliationLease.job.lease.leaseToken,
    observedAt: "2026-08-03T12:37:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000200",
      providerRoute: "/projects/3000200/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });

  ledger = queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: initialLease.job.jobId,
    queuedAt: "2026-08-03T12:38:00.000Z",
    retryReason: "provider_html_access_restored"
  });
  const retry = ledger.jobs.find(({ jobId }) => jobId === initialLease.job.jobId);
  assert.equal(retry.status, "queued");
  assert.equal(retry.pendingMutation, null);
  assert.equal(retry.providerReference, "opencounter:project:3000200");
  assert.equal(retry.nextAction.kind, "reconcile_start");
  assert.equal(
    retry.nextAction.input.providerReference,
    "opencounter:project:3000200"
  );
  assert.equal(retry.evidence.at(-1).eventType,
    "same_project_reconciliation_retry_queued");

  assert.throws(() => queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: initialLease.job.jobId,
    queuedAt: "2026-08-03T12:39:00.000Z",
    retryReason: "provider_html_access_restored"
  }), /opencounter_discovery_reconciliation_retry_invalid/);

  const staleModuleLease = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:40:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(staleModuleLease.ledger, {
    dispatchedAt: "2026-08-03T12:41:00.000Z",
    jobId: staleModuleLease.job.jobId,
    leaseToken: staleModuleLease.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: staleModuleLease.job.jobId,
    leaseToken: staleModuleLease.job.lease.leaseToken,
    observedAt: "2026-08-03T12:42:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000200",
      providerRoute: "/projects/3000200/guide/business_type",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });

  ledger = queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: initialLease.job.jobId,
    queuedAt: "2026-08-03T12:43:00.000Z",
    retryReason: "provider_module_reload_verified"
  });
  const moduleReloadRetry = ledger.jobs.find(
    ({ jobId }) => jobId === initialLease.job.jobId
  );
  assert.equal(moduleReloadRetry.status, "queued");
  assert.equal(
    moduleReloadRetry.evidence.at(-1).eventType,
    "same_project_module_reload_retry_queued"
  );
  assert.throws(() => queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: initialLease.job.jobId,
    queuedAt: "2026-08-03T12:44:00.000Z",
    retryReason: "provider_module_reload_verified"
  }), /opencounter_discovery_reconciliation_retry_invalid/);
});

test("leases same-project recovery before any queued replacement start", () => {
  let ledger = createCatalogTestLedger();
  const firstStart = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(firstStart.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: firstStart.job.jobId,
    leaseToken: firstStart.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "opencounter_use_ambiguous",
      effect: "none",
      message: "Read-only catalog preflight failed before project creation."
    },
    jobId: firstStart.job.jobId,
    leaseToken: firstStart.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    workerId: "runner-1"
  });

  const secondStart = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:34:00.000Z",
    workerId: "runner-2"
  });
  ledger = beginDiscoveryDispatch(secondStart.ledger, {
    dispatchedAt: "2026-08-03T12:35:00.000Z",
    jobId: secondStart.job.jobId,
    leaseToken: secondStart.job.lease.leaseToken,
    workerId: "runner-2"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: secondStart.job.jobId,
    leaseToken: secondStart.job.lease.leaseToken,
    observedAt: "2026-08-03T12:36:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000201",
      providerRoute: "/projects/3000201/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-2"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: secondStart.job.jobId,
    queuedAt: "2026-08-03T12:37:00.000Z"
  });
  const reconciliation = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:38:00.000Z",
    workerId: "runner-2"
  });
  ledger = beginDiscoveryDispatch(reconciliation.ledger, {
    dispatchedAt: "2026-08-03T12:39:00.000Z",
    jobId: reconciliation.job.jobId,
    leaseToken: reconciliation.job.lease.leaseToken,
    workerId: "runner-2"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: reconciliation.job.jobId,
    leaseToken: reconciliation.job.lease.leaseToken,
    observedAt: "2026-08-03T12:40:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference: "opencounter:project:3000201",
      providerRoute: "/projects/3000201/guide/location",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-2"
  });
  ledger = queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: secondStart.job.jobId,
    queuedAt: "2026-08-03T12:41:00.000Z",
    retryReason: "provider_html_access_restored"
  });
  ledger = queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: firstStart.job.jobId,
    queuedAt: "2026-08-03T12:42:00.000Z",
    retryReason: "catalog_slug_disambiguation_verified"
  });

  const next = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:43:00.000Z",
    workerId: "runner-3"
  });
  assert.equal(next.job.jobId, secondStart.job.jobId);
  assert.equal(next.job.nextAction.kind, "reconcile_start");
});

test("preserves submitted answers while reconciling an uncertain continuation", () => {
  const ledger = createCatalogTestLedger();
  const job = ledger.jobs[0];
  const providerReference = "opencounter:project:3000250";
  const uncertainAction = {
    answerBasis: {
      kind: "location_fixture",
      locationId: locationFixture.locationId,
      locationVersion: locationFixture.locationVersion
    },
    input: {
      answers: [{ questionId: "opencounter-address", value: locationFixture.address }],
      checkpointSha256: "a".repeat(64),
      providerReference
    },
    kind: "continue"
  };
  job.nextAction = uncertainAction;
  job.pendingMutation = {
    dispatchId: "uncertain-continuation-dispatch",
    inputSha256: "b".repeat(64),
    kind: "continue",
    startedAt: "2026-08-03T12:32:00.000Z"
  };
  job.providerReference = providerReference;
  job.status = "indeterminate";
  job.updatedAt = "2026-08-03T12:33:00.000Z";
  ledger.updatedAt = "2026-08-03T12:33:00.000Z";

  const reconciled = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const queued = reconciled.jobs.find(({ jobId }) => job.jobId === jobId);

  assert.equal(queued.nextAction.kind, "reconcile");
  assert.deepEqual(queued.nextAction.uncertainAction, uncertainAction);
});

test("requeues one same-project continuation reconciliation after HTML recovers", () => {
  let ledger = createCatalogTestLedger();
  const job = ledger.jobs[0];
  const providerReference = "opencounter:project:3000251";
  const uncertainAction = {
    answerBasis: {
      kind: "location_fixture",
      locationId: locationFixture.locationId,
      locationVersion: locationFixture.locationVersion
    },
    input: {
      answers: [{
        questionId: "opencounter-address",
        value: locationFixture.address
      }],
      checkpointSha256: "a".repeat(64),
      providerReference
    },
    kind: "continue"
  };
  job.nextAction = uncertainAction;
  job.pendingMutation = {
    dispatchId: "uncertain-continuation-dispatch",
    inputSha256: "b".repeat(64),
    kind: "continue",
    startedAt: "2026-08-03T12:32:00.000Z"
  };
  job.providerReference = providerReference;
  job.status = "indeterminate";
  job.updatedAt = "2026-08-03T12:33:00.000Z";
  ledger.updatedAt = "2026-08-03T12:33:00.000Z";

  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const reconciliationLease = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:35:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(reconciliationLease.ledger, {
    dispatchedAt: "2026-08-03T12:36:00.000Z",
    jobId: job.jobId,
    leaseToken: reconciliationLease.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryResult(ledger, {
    jobId: job.jobId,
    leaseToken: reconciliationLease.job.lease.leaseToken,
    observedAt: "2026-08-03T12:37:00.000Z",
    result: {
      failureClass: "indeterminate",
      providerReference,
      providerRoute: "/projects/3000251/apply/summary",
      schemaVersion: 1,
      source: "opencounter",
      status: "indeterminate"
    },
    workerId: "runner-1"
  });

  ledger = queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: job.jobId,
    queuedAt: "2026-08-03T12:38:00.000Z",
    retryReason: "provider_html_access_restored"
  });
  const retry = ledger.jobs.find(({ jobId }) => job.jobId === jobId);
  assert.equal(retry.status, "queued");
  assert.equal(retry.pendingMutation, null);
  assert.equal(retry.nextAction.kind, "reconcile");
  assert.equal(retry.nextAction.input.providerReference, providerReference);
  assert.deepEqual(retry.nextAction.uncertainAction, uncertainAction);
  assert.equal(retry.evidence.at(-1).eventType,
    "same_project_reconciliation_retry_queued");

  assert.throws(() => queueDiscoveryReconciliationRetry(ledger, {
    actorId: "coordinator",
    jobId: job.jobId,
    queuedAt: "2026-08-03T12:39:00.000Z",
    retryReason: "provider_html_access_restored"
  }), /opencounter_discovery_reconciliation_retry_invalid/);
});

test("maps a persisted mutation intent to the exact provider tool call", () => {
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
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);

  assert.deepEqual(createDiscoveryDispatchRequest(job), {
    args: leased.job.nextAction.input,
    dispatchId: job.pendingMutation.dispatchId,
    jobId: job.jobId,
    leaseToken: job.lease.leaseToken,
    tool: "opencounter_start_zoning_guidance",
    workerId: "runner-1"
  });
});

test("records a provider not-found result as a terminal failed job", () => {
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
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: {
      failureClass: "not_found",
      schemaVersion: 1,
      source: "opencounter",
      status: "not_found"
    },
    workerId: "runner-1"
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);

  assert.equal(job.status, "failed");
  assert.deepEqual(job.terminalResult, { failureClass: "not_found" });
  assert.equal(job.nextAction, null);
});

test("records a matching provider read-back as verification evidence", () => {
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
  const providerReference = "opencounter:project:3000300";
  const questions = [{
    id: "opencounter-address",
    options: [{ label: locationFixture.address, value: locationFixture.address }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(providerReference, questions);
  const result = {
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
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-03T12:34:00.000Z",
    result
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);

  assert.deepEqual(job.verification, {
    checkpointSha256,
    observedAt: "2026-08-03T12:34:00.000Z",
    providerReference,
    status: "needs_requester_input"
  });
});
