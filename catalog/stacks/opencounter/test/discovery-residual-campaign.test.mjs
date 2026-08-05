import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createDiscoveryLedgerStore } from "../src/discovery-ledger-store.mjs";
import { createZoningPortfolioResidualLedger } from
  "../src/discovery-residual-campaign.mjs";
import {
  createZoningPortfolioDiscoveryLedger
} from "../src/discovery-zoning-portfolio.mjs";
import { validateDiscoveryLedger } from "../src/discovery-ledger.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const SOURCE_CREATED_AT = "2026-08-04T01:46:48.027Z";
const CORRECTED_RM_12_ADDRESS =
  "CORRECTED RM-1.2 TEST ADDRESS — NOT A PROVIDER ADDRESS";
const PORTABLE_STORAGE_PROJECT = "opencounter:project:2820098";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
const discoveryDefinition = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-zone-portfolio-first-pass.json",
  import.meta.url
), "utf8"));

function createPortfolio({ version = 1 } = {}) {
  const locations = discoveryDefinition.requiredBaseZoningCodes.map((zone, index) => ({
    address: `VERIFIED TEST ADDRESS ${String(index + 1).padStart(2, "0")} — NOT A PROVIDER ADDRESS`,
    boundarySha256: createHash("sha256").update(`boundary-${zone}`).digest("hex"),
    evidence: [{
      evidenceRef: `test-evidence-${String(index + 1).padStart(2, "0")}`,
      observedAt: "2026-08-04T01:00:00.000Z",
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
  }));
  if (version >= 2) {
    const rm12 = locations.find(({ expectedBaseZoningCode }) =>
      expectedBaseZoningCode === "RM-1.2");
    Object.assign(rm12, {
      address: CORRECTED_RM_12_ADDRESS,
      boundarySha256: createHash("sha256")
        .update("corrected-boundary-RM-1.2-v2")
        .digest("hex"),
      evidence: [{
        evidenceRef: `test-evidence-corrected-rm-1-2-v${version}`,
        observedAt: "2026-08-04T05:00:00.000Z",
        source: "test-fixture:corrected-rm-1-2-location"
      }],
      locationId: `zoning-context-rm-1-2-v${version}`,
      locationVersion: version,
      parcelKey: "999999999998",
      rollupId: "11111111-1111-4111-8111-111111111118"
    });
  }
  return {
    jurisdiction: "cincinnati-oh",
    locations,
    portfolioId: "cincinnati-base-zoning-address-portfolio",
    portfolioVersion: version,
    schemaVersion: 1
  };
}

function createSourceLedger({ duplicateStartEvidence = false } = {}) {
  const ledger = createZoningPortfolioDiscoveryLedger({
    authorization: {
      approvedAt: "2026-08-04T01:40:00.000Z",
      approvedBy: "requester",
      authorizationId: "requester-approved-126-zoning-portfolio",
      maximumProviderProjects: 126
    },
    catalog,
    createdAt: SOURCE_CREATED_AT,
    discoveryDefinition,
    locationPortfolio: createPortfolio()
  });

  for (const [index, job] of ledger.jobs.slice(0, 8).entries()) {
    const providerReference = `opencounter:project:${2820091 + index}`;
    job.evidence.push({
      actorId: "runner-1",
      eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      eventType: "start_dispatch_started",
      observedAt: SOURCE_CREATED_AT
    });
    job.nextAction = null;
    job.providerReference = providerReference;
    job.status = "completed";
    job.terminalResult = {
      address: job.locationFixture.address,
      classification: "Permitted",
      zoningDistrict: index === 7
        ? "Commercial General (CG-A)"
        : `Test district (${job.locationFixture.expectedBaseZoningCode})`
    };
  }
  if (duplicateStartEvidence) {
    ledger.jobs[0].evidence.push({
      actorId: "runner-1",
      eventId: "00000000-0000-4000-8000-999999999999",
      eventType: "start_dispatch_started",
      observedAt: SOURCE_CREATED_AT
    });
  }
  assert.equal(ledger.jobs[7].providerReference, PORTABLE_STORAGE_PROJECT);
  return validateDiscoveryLedger(ledger);
}

function createResidualAuthorization(maximumProviderProjects = 118) {
  return {
    approvedAt: "2026-08-04T05:15:00.000Z",
    approvedBy: "requester",
    authorizationId: "requester-approved-118-residual-zoning-portfolio",
    maximumProviderProjects
  };
}

function createResidual({
  authorization = createResidualAuthorization(),
  locationPortfolio = createPortfolio({ version: 2 }),
  sourceConsumedProviderProjects = 8,
  sourceLedger = createSourceLedger()
} = {}) {
  return createZoningPortfolioResidualLedger({
    authorization,
    catalog,
    createdAt: "2026-08-04T05:30:00.000Z",
    locationPortfolio,
    sourceConsumedProviderProjects,
    sourceLedger
  });
}

function hasStartIntent(job) {
  return job.evidence.some(({ eventType }) =>
    eventType === "start_dispatch_started");
}

test("plans exactly the 118 catalog entries that have no source start intent", () => {
  const sourceLedger = createSourceLedger();
  const residual = createResidual({ sourceLedger });
  const startedCatalogEntryIds = new Set(sourceLedger.jobs
    .filter(hasStartIntent)
    .map(({ catalogEntryId }) => catalogEntryId));
  const expectedResidualEntryIds = sourceLedger.jobs
    .filter((job) => !hasStartIntent(job))
    .map(({ catalogEntryId }) => catalogEntryId)
    .sort();

  assert.equal(startedCatalogEntryIds.size, 8);
  assert.equal(residual.jobs.length, 118);
  assert.deepEqual(
    residual.jobs.map(({ catalogEntryId }) => catalogEntryId).sort(),
    expectedResidualEntryIds
  );
  assert.equal(residual.jobs.some(({ catalogEntryId }) =>
    startedCatalogEntryIds.has(catalogEntryId)), false);
});

test("binds the residual authorization to eight consumed and 118 remaining projects", () => {
  const sourceLedger = createSourceLedger();
  const residual = createResidual({ sourceLedger });

  assert.deepEqual(residual.campaign.residualOf, {
    consumedProviderProjects: 8,
    ledgerId: sourceLedger.ledgerId,
    ledgerSha256: sourceLedger.ledgerSha256
  });
  assert.equal(residual.campaign.authorization.maximumProviderProjects, 118);
  assert.equal(
    residual.campaign.residualOf.consumedProviderProjects
      + residual.campaign.authorization.maximumProviderProjects,
    sourceLedger.campaign.authorization.maximumProviderProjects
  );
});

test("uses the corrected portfolio v2 context for the three unstarted RM-1.2 assignments", () => {
  const sourceLedger = createSourceLedger();
  const expectedEntryIds = sourceLedger.jobs
    .filter((job) => job.locationFixture.expectedBaseZoningCode === "RM-1.2")
    .filter((job) => !hasStartIntent(job))
    .map(({ catalogEntryId }) => catalogEntryId)
    .sort();
  const residual = createResidual({ sourceLedger });
  const rm12Jobs = residual.jobs.filter((job) =>
    job.locationFixture.expectedBaseZoningCode === "RM-1.2");

  assert.equal(expectedEntryIds.length, 3);
  assert.deepEqual(
    rm12Jobs.map(({ catalogEntryId }) => catalogEntryId).sort(),
    expectedEntryIds
  );
  assert.equal(rm12Jobs.length, 3);
  assert.equal(rm12Jobs.every(({ locationFixture }) =>
    locationFixture.address === CORRECTED_RM_12_ADDRESS
      && locationFixture.locationVersion === 2), true);
  assert.equal(residual.campaign.locationPortfolio.portfolioVersion, 2);
});

test("accepts a fully re-audited portfolio newer than v2", () => {
  const residual = createResidual({
    locationPortfolio: createPortfolio({ version: 3 })
  });
  const rm12Jobs = residual.jobs.filter((job) =>
    job.locationFixture.expectedBaseZoningCode === "RM-1.2");

  assert.equal(residual.campaign.locationPortfolio.portfolioVersion, 3);
  assert.equal(rm12Jobs.length, 3);
  assert.equal(rm12Jobs.every(({ locationFixture }) =>
    locationFixture.locationVersion === 3), true);
});

test("preserves project 2820098 only in the source ledger and never replans its use", () => {
  const sourceLedger = createSourceLedger();
  const sourceProject = sourceLedger.jobs.find(({ providerReference }) =>
    providerReference === PORTABLE_STORAGE_PROJECT);
  const residual = createResidual({ sourceLedger });

  assert.equal(sourceProject.catalogEntryId, "accessory_uses.portable_storage_containers");
  assert.equal(sourceProject.terminalResult.zoningDistrict,
    "Commercial General (CG-A)");
  assert.equal(residual.jobs.some(({ providerReference }) =>
    providerReference === PORTABLE_STORAGE_PROJECT), false);
  assert.equal(residual.jobs.some(({ catalogEntryId }) =>
    catalogEntryId === sourceProject.catalogEntryId), false);
});

test("deduplicates consumed jobs and rejects incorrect counts or portfolio v1", () => {
  const sourceWithDuplicateStartEvidence = createSourceLedger({
    duplicateStartEvidence: true
  });
  const residual = createResidual({
    sourceLedger: sourceWithDuplicateStartEvidence,
    sourceConsumedProviderProjects: 8
  });

  assert.equal(residual.jobs.length, 118);
  assert.throws(() => createResidual({
    sourceConsumedProviderProjects: 7,
    sourceLedger: sourceWithDuplicateStartEvidence
  }), /consumed|residual|authorization/i);
  assert.throws(() => createResidual({
    sourceConsumedProviderProjects: 9,
    sourceLedger: sourceWithDuplicateStartEvidence
  }), /consumed|residual|authorization/i);
  assert.throws(() => createResidual({
    locationPortfolio: createPortfolio({ version: 1 }),
    sourceLedger: sourceWithDuplicateStartEvidence
  }), /portfolio|version|residual/i);
});

test("produces stable unique job identities and round-trips without mutating the source", async () => {
  const sourceLedger = createSourceLedger();
  const sourceBefore = structuredClone(sourceLedger);
  const first = createResidual({ sourceLedger });
  const second = createResidual({ sourceLedger });
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-residual-campaign-test-"
  ));
  try {
    const store = createDiscoveryLedgerStore({ stateDirectory });
    await store.initialize(first);
    const roundTripped = await store.read(first.ledgerId);

    assert.equal(new Set(first.jobs.map(({ jobId }) => jobId)).size, 118);
    assert.deepEqual(
      first.jobs.map(({ jobId }) => jobId),
      second.jobs.map(({ jobId }) => jobId)
    );
    assert.equal(first.ledgerId, second.ledgerId);
    assert.equal(roundTripped.ledgerId, first.ledgerId);
    assert.deepEqual(
      roundTripped.jobs.map(({ jobId }) => jobId),
      first.jobs.map(({ jobId }) => jobId)
    );
    assert.deepEqual(sourceLedger, sourceBefore);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});
