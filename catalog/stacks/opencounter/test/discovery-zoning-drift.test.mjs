import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createDiscoveryLedgerStore } from "../src/discovery-ledger-store.mjs";
import { createZoningPortfolioDiscoveryLedger } from
  "../src/discovery-zoning-portfolio.mjs";
import {
  beginDiscoveryDispatch,
  leaseNextDiscoveryJob,
  recordDiscoveryResult,
  recordDiscoveryVerification,
  summarizeDiscoveryLedger
} from "../src/discovery-ledger.mjs";
import { buildObservedQuestionGraph } from "../src/discovery-question-graph.mjs";
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

function createLedger() {
  return createZoningPortfolioDiscoveryLedger({
    authorization,
    catalog,
    createdAt: "2026-08-03T12:30:00.000Z",
    discoveryDefinition,
    locationPortfolio: createTestPortfolio()
  });
}

function completeVerifiedJob({ terminalResult }) {
  let ledger = createLedger();
  const targetIndex = ledger.jobs.findIndex(
    ({ locationFixture }) => locationFixture.expectedBaseZoningCode === "RM-1.2"
  );
  assert.notEqual(targetIndex, -1);

  for (const job of ledger.jobs.slice(0, targetIndex)) {
    job.nextAction = null;
    job.status = "failed";
    job.terminalResult = { failureClass: "test_fixture_skip" };
  }

  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:00.000Z",
    workerId: "runner-1"
  });
  assert.equal(
    leased.job.locationFixture.expectedBaseZoningCode,
    "RM-1.2"
  );
  ledger = beginDiscoveryDispatch(leased.ledger, {
    dispatchedAt: "2026-08-03T12:31:01.000Z",
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    workerId: "runner-1"
  });
  const providerReference = "opencounter:project:3999901";
  const providerResult = {
    providerReference,
    result: terminalResult,
    schemaVersion: 1,
    source: "opencounter",
    status: "completed"
  };
  ledger = recordDiscoveryResult(ledger, {
    jobId: leased.job.jobId,
    leaseToken: leased.job.lease.leaseToken,
    observedAt: "2026-08-03T12:31:02.000Z",
    result: providerResult,
    workerId: "runner-1"
  });
  ledger = recordDiscoveryVerification(ledger, {
    actorId: "validator",
    jobId: leased.job.jobId,
    observedAt: "2026-08-03T12:31:03.000Z",
    result: providerResult
  });
  return { jobId: leased.job.jobId, ledger };
}

function permittedResult(zoningDistrict) {
  return {
    classification: "Permitted",
    landUseCode: "Portable storage containers",
    ...(zoningDistrict === undefined ? {} : { zoningDistrict })
  };
}

function queueSyntheticRecovery(ledger) {
  const job = ledger.jobs.find(({ status }) => status === "queued");
  assert.ok(job);
  const providerReference = "opencounter:project:3999902";
  const checkpointSha256 = "a".repeat(64);
  job.checkpoint = {
    checkpointSha256,
    expiresAt: "2026-08-04T12:31:00.000Z",
    questions: [{
      id: "existing_use",
      options: [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    }],
    schemaVersion: 1
  };
  job.nextAction = {
    answerBasis: {
      approvalId: "requester-campaign-baseline-v1",
      approvedAt: "2026-08-03T12:31:03.000Z",
      approvedBy: "requester",
      kind: "requester_approval"
    },
    input: {
      answers: [{ questionId: "existing_use", value: "No" }],
      checkpointSha256,
      providerReference
    },
    kind: "continue"
  };
  job.providerReference = providerReference;
  return job.jobId;
}

test("reports a verified completed provider-zone mismatch as zoning-context drift", () => {
  const { jobId, ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Commercial General (CG-A)")
  });

  const summary = summarizeDiscoveryLedger(ledger, {
    observedAt: "2026-08-03T12:32:00.000Z"
  });

  assert.equal(summary.zoningContextDriftCount, 1);
  assert.deepEqual(summary.zoningContextDriftJobIds, [jobId]);
});

test("leases queued recovery work even while verified zoning drift fences starts", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Commercial General (CG-A)")
  });
  const recoveryJobId = queueSyntheticRecovery(ledger);

  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:04.000Z",
    workerId: "runner-2"
  });

  assert.equal(leased.job?.jobId, recoveryJobId);
  assert.equal(leased.job?.nextAction.kind, "continue");
});

test("returns no new start while any verified completed zoning drift exists", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Commercial General (CG-A)")
  });

  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:04.000Z",
    workerId: "runner-2"
  });

  assert.equal(leased.job, null);
});

test("accepts a provider zoning suffix compatible with the assigned base zone", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Residential Multi-family (RM-1.2-T)")
  });
  const summary = summarizeDiscoveryLedger(ledger, {
    observedAt: "2026-08-03T12:32:00.000Z"
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:32:01.000Z",
    workerId: "runner-2"
  });

  assert.equal(summary.zoningContextDriftCount, 0);
  assert.equal(leased.job?.nextAction.kind, "start");
});

test("accepts a compatible zoning code before provider parenthetical detail", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult(
      "Residential Multi-family (RM-1.2-T - Residential multi-family - transit)"
    )
  });
  const summary = summarizeDiscoveryLedger(ledger, {
    observedAt: "2026-08-03T12:32:00.000Z"
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:32:01.000Z",
    workerId: "runner-2"
  });

  assert.equal(summary.zoningContextDriftCount, 0);
  assert.equal(leased.job?.nextAction.kind, "start");
});

test("fences starts when verified terminal zoning is missing", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult(undefined)
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:04.000Z",
    workerId: "runner-2"
  });

  assert.equal(leased.job, null);
});

test("fences starts when verified terminal zoning is unparseable", () => {
  const { ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Provider zoning unavailable")
  });
  const leased = leaseNextDiscoveryJob(ledger, {
    leasedAt: "2026-08-03T12:31:04.000Z",
    workerId: "runner-2"
  });

  assert.equal(leased.job, null);
});

test("graph keeps assigned zoning separate from effective provider-observed zoning", () => {
  const { jobId, ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Commercial General (CG-A)")
  });
  const job = ledger.jobs.find((candidate) => candidate.jobId === jobId);
  job.observations.unshift({
    answers: [],
    checkpointSha256: "b".repeat(64),
    observedAt: "2026-08-03T12:31:01.500Z",
    operation: "start",
    questions: [{
      id: "existing_use",
      options: [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  });

  const graph = buildObservedQuestionGraph(ledger);
  const question = graph.questions.find(
    ({ providerQuestionId }) => providerQuestionId === "existing_use"
  );

  assert.deepEqual(question.expectedBaseZoningCodes, ["RM-1.2"]);
  assert.deepEqual(question.observedZoningCodes, ["CG-A"]);
  assert.equal(question.observedZoningCodes.includes("RM-1.2"), false);
});

test("durably refreshes a stale graph without rewriting provider evidence", async () => {
  const { jobId, ledger } = completeVerifiedJob({
    terminalResult: permittedResult("Commercial General (CG-A)")
  });
  const job = ledger.jobs.find((candidate) => candidate.jobId === jobId);
  job.observations.unshift({
    answers: [],
    checkpointSha256: "c".repeat(64),
    observedAt: "2026-08-03T12:31:01.500Z",
    operation: "start",
    questions: [{
      id: "existing_use",
      options: [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }],
      prompt: "Does this use already exist?",
      required: true,
      type: "single_select"
    }],
    resultStatus: "needs_requester_input"
  });
  ledger.questionGraph = buildObservedQuestionGraph(ledger);
  ledger.questionGraph.questions[0].observedZoningCodes = ["RM-1.2"];
  const sourceBefore = structuredClone(job);
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-drift-refresh-"));
  const ledgerPath = path.join(stateDirectory, `${ledger.ledgerId}.json`);
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    await assert.rejects(() => store.read(ledger.ledgerId), /question_graph_stale/);
    const refreshed = await store.refreshQuestionGraph({ ledgerId: ledger.ledgerId });
    const persisted = await store.read(ledger.ledgerId);
    const question = persisted.questionGraph.questions.find(
      ({ providerQuestionId }) => providerQuestionId === "existing_use"
    );

    assert.deepEqual(question.observedZoningCodes, ["CG-A"]);
    assert.deepEqual(
      refreshed.jobs.find((candidate) => candidate.jobId === jobId),
      sourceBefore
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});
