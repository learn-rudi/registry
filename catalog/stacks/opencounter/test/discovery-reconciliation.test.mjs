import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryLocationAnswer,
  queueDiscoveryReconciliation,
  recordDiscoveryFailure,
  recordDiscoveryResult
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
const address = "CONFIRMED TEST LOCATION — NOT A PROVIDER ADDRESS";

function createLedger() {
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
    locationFixture: {
      address,
      evidence: [{
        observedAt: "2026-08-03T12:00:00.000Z",
        source: "test-fixture:requester-confirmed-location"
      }],
      locationId: "confirmed-test-location",
      locationVersion: 1
    }
  });
}

function addressResult(providerReference) {
  const questions = [{
    id: "opencounter-address",
    options: [{ label: address, value: address }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  return {
    checkpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(providerReference, questions),
      expiresAt: "2026-08-04T12:33:00.000Z",
      questions,
      schemaVersion: 1
    },
    providerReference,
    schemaVersion: 1,
    source: "opencounter",
    status: "needs_requester_input"
  };
}

function createUncertainAddressContinuation() {
  let ledger = createLedger();
  const start = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(start.ledger, {
    dispatchedAt: "2026-08-03T12:32:00.000Z",
    jobId: start.job.jobId,
    leaseToken: start.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const providerReference = "opencounter:project:3000500";
  const firstResult = addressResult(providerReference);
  ledger = recordDiscoveryResult(ledger, {
    jobId: start.job.jobId,
    leaseToken: start.job.lease.leaseToken,
    observedAt: "2026-08-03T12:33:00.000Z",
    result: firstResult,
    workerId: "runner-1"
  });
  ledger = queueDiscoveryLocationAnswer(ledger, {
    actorId: "validator",
    checkpointSha256: firstResult.checkpoint.checkpointSha256,
    jobId: start.job.jobId,
    queuedAt: "2026-08-03T12:34:00.000Z"
  });
  const continuation = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:35:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(continuation.ledger, {
    dispatchedAt: "2026-08-03T12:36:00.000Z",
    jobId: continuation.job.jobId,
    leaseToken: continuation.job.lease.leaseToken,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "provider_dispatch_unusable",
      effect: "unknown",
      message: "The provider continuation did not return a usable bounded result."
    },
    jobId: continuation.job.jobId,
    leaseToken: continuation.job.lease.leaseToken,
    observedAt: "2026-08-03T12:37:00.000Z",
    workerId: "runner-1"
  });
  ledger = queueDiscoveryReconciliation(ledger, {
    actorId: "coordinator",
    jobId: continuation.job.jobId,
    queuedAt: "2026-08-03T12:38:00.000Z"
  });
  const reconciliation = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:39:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(reconciliation.ledger, {
    dispatchedAt: "2026-08-03T12:40:00.000Z",
    jobId: reconciliation.job.jobId,
    leaseToken: reconciliation.job.lease.leaseToken,
    workerId: "runner-1"
  });
  return { firstResult, ledger, reconciliation };
}

test("does not claim an uncertain answer when reconciliation returns the same checkpoint", () => {
  const { firstResult, ledger, reconciliation } = createUncertainAddressContinuation();
  const reconciled = recordDiscoveryResult(ledger, {
    jobId: reconciliation.job.jobId,
    leaseToken: reconciliation.job.lease.leaseToken,
    observedAt: "2026-08-03T12:41:00.000Z",
    result: firstResult,
    workerId: "runner-1"
  });
  const job = reconciled.jobs.find(({ jobId }) => jobId === reconciliation.job.jobId);

  assert.deepEqual(job.observations.at(-1).answers, []);
  assert.deepEqual(job.answersSupplied, []);
  assert.equal(job.status, "needs_input");
});

test("attributes an uncertain answer when reconciliation has advanced", () => {
  const { firstResult, ledger, reconciliation } = createUncertainAddressContinuation();
  const providerReference = firstResult.providerReference;
  const questions = [{
    id: "new-construction",
    options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }],
    prompt: "Is this new construction?",
    required: true,
    type: "single_select"
  }];
  const result = {
    checkpoint: {
      checkpointSha256: createGuidanceCheckpointSha256(providerReference, questions),
      expiresAt: "2026-08-04T12:41:00.000Z",
      questions,
      schemaVersion: 1
    },
    providerReference,
    schemaVersion: 1,
    source: "opencounter",
    status: "needs_requester_input"
  };

  const reconciled = recordDiscoveryResult(ledger, {
    jobId: reconciliation.job.jobId,
    leaseToken: reconciliation.job.lease.leaseToken,
    observedAt: "2026-08-03T12:41:00.000Z",
    result,
    workerId: "runner-1"
  });
  const job = reconciled.jobs.find(({ jobId }) => jobId === reconciliation.job.jobId);

  assert.deepEqual(job.observations.at(-1).answers, [{
    questionId: "opencounter-address",
    value: address
  }]);
  assert.deepEqual(job.answersSupplied.at(-1), {
    answers: [{ questionId: "opencounter-address", value: address }],
    checkpointSha256: firstResult.checkpoint.checkpointSha256,
    observedAt: "2026-08-03T12:41:00.000Z"
  });
  assert.equal(job.status, "needs_input");
});
