import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createZoningPortfolioDiscoveryLedger } from
  "../src/discovery-zoning-portfolio.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  queueDiscoveryPreEffectRetry,
  queueDiscoveryLocationAnswer,
  recordDiscoveryResult,
  validateDiscoveryLedger
} from "../src/discovery-ledger.mjs";
import { buildObservedQuestionGraph } from "../src/discovery-question-graph.mjs";
import { createGuidanceCheckpointSha256 } from "../src/core.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const discoveryDefinition = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-zone-portfolio-first-pass.json",
  import.meta.url
), "utf8"));
const authorization = {
  approvedAt: "2026-08-03T12:15:00.000Z",
  approvedBy: "requester",
  authorizationId: "requester-approved-126-zoning-portfolio",
  maximumProviderProjects: 126
};

function createTestPortfolio() {
  return {
    jurisdiction: "cincinnati-oh",
    locations: discoveryDefinition.requiredBaseZoningCodes.map((zone, index) => ({
      address: `VERIFIED TEST ADDRESS ${String(index + 1).padStart(2, "0")} — NOT A PROVIDER ADDRESS`,
      boundarySha256: createHash("sha256").update(`boundary-${zone}`).digest("hex"),
      evidence: [{
        evidenceRef: `test-evidence-${String(index + 1).padStart(2, "0")}`,
        observedAt: "2026-08-03T12:00:00.000Z",
        source: "test-fixture:parcel-key-location-lookup"
      }],
      expectedBaseZoningCode: zone,
      locationId: `zoning-context-${String(index + 1).padStart(2, "0")}`,
      locationVersion: 1,
      municipality: "City of Cincinnati",
      observedZoningCode: zone === "T5N.SS" ? "T5N.SS-O" : zone,
      overlayFlags: zone === "T5N.SS" ? ["form_suffix_o"] : [],
      parcelKey: String(index + 1).padStart(12, "0"),
      rollupId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    })),
    portfolioId: "cincinnati-base-zoning-address-portfolio",
    portfolioVersion: 1,
    schemaVersion: 1
  };
}

function createLedger(overrides = {}) {
  return createZoningPortfolioDiscoveryLedger({
    authorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    discoveryDefinition,
    locationPortfolio: createTestPortfolio(),
    ...overrides
  });
}

test("plans 126 stable use-by-zoning jobs over every portfolio context", () => {
  const first = createLedger();
  const second = createLedger();
  const catalogEntryIds = catalog.categories.flatMap((category) => [
    ...category.entries,
    ...category.groups.flatMap((group) => group.entries)
  ]).sort((left, right) => left.displayOrder - right.displayOrder)
    .map(({ catalogEntryId }) => catalogEntryId);
  const contextCounts = new Map();
  for (const job of first.jobs) {
    const zone = job.locationFixture.expectedBaseZoningCode;
    contextCounts.set(zone, (contextCounts.get(zone) ?? 0) + 1);
    assert.equal(job.nextAction.input.address, job.locationFixture.address);
  }

  assert.equal(first.schemaVersion, 3);
  assert.equal(first.jobs.length, 126);
  assert.equal(new Set(first.jobs.map(({ jobId }) => jobId)).size, 126);
  assert.deepEqual(first.jobs.map(({ catalogEntryId }) => catalogEntryId), catalogEntryIds);
  assert.deepEqual(first.jobs.map(({ jobId }) => jobId), second.jobs.map(({ jobId }) => jobId));
  assert.equal(contextCounts.size, 37);
  assert.deepEqual(new Set(contextCounts.values()), new Set([3, 4]));
  assert.equal(first.campaign.maximumProviderConcurrency, 2);
  assert.equal(first.campaign.plannedRunCount, 126);
  assert.equal(first.campaign.locationPortfolio.locationCount, 37);
  assert.deepEqual(validateDiscoveryLedger(first), first);
});

test("carries the assigned zoning context into observed question coverage", () => {
  const ledger = createLedger();
  const job = ledger.jobs[0];
  job.observations.push({
    answers: [],
    checkpointSha256: "a".repeat(64),
    observedAt: "2026-08-03T12:31:00.000Z",
    operation: "start",
    questions: [{
      id: "project-intent",
      options: [],
      prompt: "What are you proposing?",
      required: true,
      type: "text"
    }],
    resultStatus: "needs_requester_input"
  });

  const graph = buildObservedQuestionGraph(ledger);
  assert.deepEqual(graph.questions[0].expectedBaseZoningCodes,
    [job.locationFixture.expectedBaseZoningCode]);
  assert.deepEqual(graph.questions[0].observedZoningCodes,
    [job.locationFixture.observedZoningCode]);
  assert.deepEqual(graph.questions[0].locationFixtureIds,
    [`${job.locationFixture.locationId}:${job.locationFixture.locationVersion}`]);
});

test("rejects an incomplete or zoning-mismatched portfolio before planning", () => {
  const incomplete = createTestPortfolio();
  incomplete.locations.pop();
  assert.throws(() => createLedger({ locationPortfolio: incomplete }),
    /location_portfolio_invalid/);

  const mismatched = createTestPortfolio();
  mismatched.locations[0].observedZoningCode = "MG";
  assert.throws(() => createLedger({ locationPortfolio: mismatched }),
    /location_zoning_invalid/);
});

test("enforces two leases and queues only the exact provider address match", () => {
  let ledger = createLedger();
  const first = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  const second = leaseNextDiscoveryJob(first.ledger, {
    leasedAt: "2026-08-03T12:31:01.000Z",
    workerId: "runner-2"
  });
  const third = leaseNextDiscoveryJob(second.ledger, {
    leasedAt: "2026-08-03T12:31:02.000Z",
    workerId: "runner-3"
  });
  assert.equal(third.job, null);

  ledger = beginDiscoveryDispatch(first.ledger, {
    dispatchedAt: "2026-08-03T12:31:01.000Z",
    jobId: first.job.jobId,
    leaseToken: first.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const address = first.job.locationFixture.address;
  const providerReference = "opencounter:project:3000500";
  const questions = [{
    id: "opencounter-address",
    options: [{ label: address, value: address }],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "single_select"
  }];
  const checkpointSha256 = createGuidanceCheckpointSha256(
    providerReference,
    questions
  );
  ledger = recordDiscoveryResult(ledger, {
    jobId: first.job.jobId,
    leaseToken: first.job.lease.leaseToken,
    observedAt: "2026-08-03T12:31:02.000Z",
    result: {
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-04T12:31:02.000Z",
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
    jobId: first.job.jobId,
    queuedAt: "2026-08-03T12:31:03.000Z"
  });
  const queued = ledger.jobs.find(({ jobId }) => jobId === first.job.jobId);
  assert.equal(queued.nextAction.kind, "continue");
  assert.deepEqual(queued.nextAction.input.answers, [{
    questionId: "opencounter-address",
    value: address
  }]);
  assert.deepEqual(validateDiscoveryLedger(ledger), ledger);
});

test("rejects a zoning fixture changed after ledger planning", () => {
  const ledger = createLedger();
  ledger.jobs[0].locationFixture.observedZoningCode = "MG";
  assert.throws(() => validateDiscoveryLedger(ledger),
    /location_fixture_invalid|location_fixture_conflict|location_assignment_invalid|job_identity_invalid/);
});

test("requeues only a recorded pre-effect start failure", async () => {
  let ledger = createLedger();
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:31:01.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const { recordDiscoveryFailure } = await import("../src/discovery-ledger.mjs");
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "opencounter_use_ambiguous",
      effect: "none",
      message: "Read-only catalog preflight failed before project creation."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:31:02.000Z",
    workerId: "runner-1"
  });
  ledger = queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:31:03.000Z",
    retryReason: "catalog_slug_disambiguation_verified"
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(job.status, "queued");
  assert.equal(job.pendingMutation, null);
  assert.equal(job.providerReference, null);
  assert.equal(job.nextAction.kind, "start");
});

test("requeues a no-project start after portal render proof", async () => {
  let ledger = createLedger();
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:10.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:31:11.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const { recordDiscoveryFailure } = await import("../src/discovery-ledger.mjs");
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "opencounter_start_control_missing",
      effect: "none",
      message: "The portal control was not rendered before the count check."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:31:12.000Z",
    workerId: "runner-1"
  });

  ledger = queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:31:13.000Z",
    retryReason: "portal_start_control_render_verified"
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(job.status, "queued");
  assert.equal(job.pendingMutation, null);
  assert.equal(job.providerReference, null);
  assert.equal(job.nextAction.kind, "start");

  assert.throws(() => queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:31:14.000Z",
    retryReason: "portal_start_control_render_verified"
  }), /pre_effect_retry_invalid/);
});

test("requeues a no-project truncated search after catalog-path proof", async () => {
  let ledger = createLedger();
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:32:00.000Z",
    workerId: "runner-1"
  });
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:32:01.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const { recordDiscoveryFailure } = await import("../src/discovery-ledger.mjs");
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "opencounter_use_not_found",
      effect: "none",
      message: "The provider label search truncated the exact catalog result."
    },
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:32:02.000Z",
    workerId: "runner-1"
  });

  ledger = queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: leased.job.jobId,
    queuedAt: "2026-08-03T12:32:03.000Z",
    retryReason: "catalog_path_search_verified"
  });
  const job = ledger.jobs.find(({ jobId }) => jobId === leased.job.jobId);
  assert.equal(job.status, "queued");
  assert.equal(job.pendingMutation, null);
  assert.equal(job.providerReference, null);

  const retryLease = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:32:04.000Z",
    workerId: "runner-2"
  });
  ledger = beginDiscoveryDispatch(retryLease.ledger, {
    dispatchedAt: "2026-08-03T12:32:05.000Z",
    jobId: retryLease.job.jobId,
    leaseToken: retryLease.job.lease.leaseToken,
    workerId: "runner-2"
  });
  ledger = recordDiscoveryFailure(ledger, {
    failure: {
      code: "opencounter_use_not_found",
      effect: "none",
      message: "The installed stack had not yet received the verified fix."
    },
    jobId: retryLease.job.jobId,
    leaseToken: retryLease.job.lease.leaseToken,
    observedAt: "2026-08-03T12:32:06.000Z",
    workerId: "runner-2"
  });
  ledger = queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: retryLease.job.jobId,
    queuedAt: "2026-08-03T12:32:07.000Z",
    retryReason: "catalog_path_search_deployment_verified"
  });
  const deployedRetry = ledger.jobs.find(({ jobId }) =>
    jobId === retryLease.job.jobId);
  assert.equal(deployedRetry.status, "queued");
  assert.equal(deployedRetry.evidence.filter(({ eventType }) =>
    eventType === "catalog_path_deployment_retry_queued").length, 1);
  assert.throws(() => queueDiscoveryPreEffectRetry(ledger, {
    actorId: "coordinator",
    jobId: retryLease.job.jobId,
    queuedAt: "2026-08-03T12:32:08.000Z",
    retryReason: "catalog_path_search_deployment_verified"
  }), /pre_effect_retry_invalid/);
});
