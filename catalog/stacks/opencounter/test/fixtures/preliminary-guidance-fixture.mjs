import { createHash } from "node:crypto";

import { buildMasterQuestionnaire } from
  "../../src/discovery-master-questionnaire.mjs";
import { buildVerifiedObservationPortfolio } from
  "../../src/discovery-observation-portfolio.mjs";
import { loadZoningCatalog } from "../../src/zoning-catalog.mjs";

export const catalog = loadZoningCatalog(new URL(
  "../../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));
export const request = {
  address: "123 Example Street, Cincinnati, Ohio 45202",
  projectIdea: "Open a new neighborhood retail use.",
  schemaVersion: 1
};
export const { questionnaire, selectedCatalogEntryId } =
  createPreliminaryGuidanceFixture();

export function createPreliminaryGuidanceFixture(
  terminalClassification = "Prohibited",
  { includeQueuedDuplicate = false } = {}
) {
  return createQuestionnaire(terminalClassification, includeQueuedDuplicate);
}

export function siteContext(baseZoningCode = "SF-2") {
  return {
    baseZoningCode,
    evidence: [{
      evidenceRef: "cagis:parcel-zoning:example",
      observedAt: "2026-08-04T21:00:00.000Z",
      source: "City of Cincinnati CAGIS parcel zoning"
    }],
    inputAddress: request.address,
    matchedAddress: request.address,
    overlayFlags: [],
    parcelKey: "012300040056",
    rollupId: "00000000-0000-4000-8000-000000000123",
    schemaVersion: 1
  };
}

export function candidateUse(catalogEntryId = selectedCatalogEntryId) {
  return {
    catalogEntryId,
    evidenceRefs: ["request:projectIdea"],
    mappingBasis: "requester_confirmed",
    rationale: "Requester confirmed the catalog use candidate."
  };
}

function createQuestionnaire(terminalClassification, includeQueuedDuplicate = false) {
  const entries = catalog.categories.flatMap((category) => [
    ...category.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label]
    })),
    ...category.groups.flatMap((group) => group.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label, group.label]
    })))
  ]).sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
  const jobs = entries.map(({ catalogEntryId, categoryPath }, index) => {
    const question = existingUseQuestion();
    const checkpointSha256 = digest(`preliminary-checkpoint-${index}`);
    const terminalResult = { classification: terminalClassification };
    const providerReference = `opencounter:project:${2_950_000 + index}`;
    return {
      catalogEntryId,
      categoryPath,
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T19:00:00.000Z",
        questions: [question],
        schemaVersion: 1
      },
      jobId: `ocdj_${digest(`preliminary-job-${index}`)}`,
      locationFixture: {
        address: `SYNTHETIC GUIDANCE LOCATION ${index + 1} - NOT A PROVIDER ADDRESS`,
        boundarySha256: digest(`preliminary-boundary-${index}`),
        evidence: [{
          evidenceRef: `synthetic-guidance-location-${index + 1}`,
          observedAt: "2026-08-04T19:00:00.000Z",
          source: "test-fixture:preliminary-guidance"
        }],
        expectedBaseZoningCode: "SF-2",
        locationId: `synthetic-guidance-location-${index + 1}`,
        locationVersion: 1,
        municipality: "City of Cincinnati",
        observedZoningCode: "SF-2",
        overlayFlags: [],
        parcelKey: String(index + 1).padStart(12, "0"),
        rollupId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      },
      observations: [{
        answers: [],
        checkpointSha256,
        observedAt: "2026-08-04T19:00:00.000Z",
        operation: "start",
        questions: [question],
        resultStatus: "needs_requester_input"
      }, {
        answers: [{ questionId: "existing_use", value: "No" }],
        checkpointSha256: null,
        observedAt: "2026-08-04T19:05:00.000Z",
        operation: "continue",
        questions: [],
        resultStatus: "completed"
      }],
      providerReference,
      scenario: {
        answerRules: [],
        assumptions: {},
        scenarioId: "preliminary-guidance-fixture",
        scenarioVersion: 1
      },
      status: "completed",
      terminalResult,
      verification: {
        observedAt: "2026-08-04T19:05:00.000Z",
        providerReference,
        resultSha256: digest(JSON.stringify(terminalResult)),
        status: "completed"
      }
    };
  });
  if (includeQueuedDuplicate) {
    jobs.push({
      ...structuredClone(jobs[0]),
      jobId: `ocdj_${digest("preliminary-queued-duplicate")}`,
      observations: [],
      status: "queued",
      terminalResult: null,
      verification: null
    });
  }
  const ledgerSha256 = digest("preliminary-guidance-ledger");
  const sourceLedgers = [{
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    schemaVersion: 4
  }];
  const freeze = buildVerifiedObservationPortfolio({
    catalog,
    frozenAt: "2026-08-04T20:00:00.000Z",
    ledgers: sourceLedgers
  });
  return {
    freeze,
    questionnaire: buildMasterQuestionnaire({
      catalog,
      freeze,
      sourceLedgers
    }),
    selectedCatalogEntryId: entries[0].catalogEntryId,
    sourceLedgers
  };
}

function existingUseQuestion() {
  return {
    id: "existing_use",
    options: [
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" }
    ],
    prompt: "Is this an existing use?",
    required: true,
    type: "single_select"
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
