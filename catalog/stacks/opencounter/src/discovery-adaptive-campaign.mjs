import { createHash, randomUUID } from "node:crypto";

import { createZoningProviderInputSha256 } from "./core.mjs";
import { validateAdaptiveZoningPreview } from
  "./discovery-adaptive-zoning.mjs";
import { createScenarioWaveCompletionClaimSha256 } from
  "./discovery-scenario-residual-identity.mjs";
import { validateZoningLocationPortfolio } from
  "./discovery-zoning-portfolio.mjs";

const CAMPAIGN_ID = "cincinnati-adaptive-zoning-question-discovery-v1";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const REQUIRED_BASE_ZONING_CODES = [
  "SF-20", "SF-10", "SF-6", "SF-4", "SF-2", "RMX", "RM-2.0",
  "RM-1.2", "RM-0.7", "OL", "OG", "CN-P", "CN-M", "CC-P", "CC-M",
  "CC-A", "CG-A", "UM", "DD", "MA", "ML", "MG", "ME", "RF-R",
  "RF-C", "RF-M", "PR", "IR", "T3E", "T3N", "T4N.MF", "T4N.SF",
  "T5F", "T5MS", "T5N.LS", "T5N.SS", "PD"
];

export function createAdaptiveZoningCampaignLedger({
  authorization,
  catalog,
  completionClaim,
  createdAt,
  locationPortfolio,
  preview
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const approvedPreview = validateReadyPreview(preview, catalog);
  const prerequisiteClaim = validateCompletionClaim(completionClaim, timestamp);
  const approvedVolume = validateAuthorization(
    authorization,
    approvedPreview,
    timestamp
  );
  const portfolio = validateZoningLocationPortfolio(
    locationPortfolio,
    createPortfolioDefinition()
  );
  const entries = indexCatalogEntries(catalog);
  const locationsByZone = new Map(portfolio.locations.map((location) => [
    location.expectedBaseZoningCode,
    location
  ]));
  const scenarioByCandidate = new Map();
  const candidateManifest = [];
  const jobs = approvedPreview.candidates.map((candidate) => {
    const selected = entries.get(candidate.catalogEntryId);
    if (selected === undefined
      || JSON.stringify(selected.categoryPath)
        !== JSON.stringify(candidate.categoryPath)) {
      throw new Error("opencounter_adaptive_campaign_catalog_entry_invalid");
    }
    const locationFixture = locationsByZone.get(
      candidate.targetBaseZoningCode
    );
    if (locationFixture === undefined) {
      throw new Error("opencounter_adaptive_campaign_location_invalid");
    }
    const startInput = {
      address: locationFixture.address,
      catalogEntryId: candidate.catalogEntryId,
      catalogId: catalog.catalogId,
      jurisdiction: catalog.jurisdiction,
      schemaVersion: 1
    };
    const providerInputSha256 = createZoningProviderInputSha256({
      address: locationFixture.address,
      catalogEntryId: candidate.catalogEntryId,
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      categoryPath: selected.categoryPath,
      description: selected.entry.description,
      jurisdiction: catalog.jurisdiction,
      proposedUse: selected.entry.providerLabel,
      providerUseSlug: selected.entry.providerUseSlug,
      workflow: catalog.workflow
    });
    const scenario = {
      answerRules: [],
      assumptions: {
        candidateId: candidate.candidateId,
        targetBaseZoningCode: candidate.targetBaseZoningCode,
        targetSamplingStratum: candidate.targetSamplingStratum
      },
      scenarioId: "adaptive-zoning-initial-checkpoint-observation",
      scenarioVersion: 1
    };
    scenarioByCandidate.set(candidate.candidateId, scenario);
    const manifestRecord = {
      candidateId: candidate.candidateId,
      catalogEntryId: candidate.catalogEntryId,
      categoryPath: [...candidate.categoryPath],
      locationFixtureSha256: sha256(locationFixture),
      providerInputSha256,
      targetBaseZoningCode: candidate.targetBaseZoningCode,
      targetSamplingStratum: candidate.targetSamplingStratum
    };
    candidateManifest.push(manifestRecord);
    const jobSha256 = createAdaptiveZoningCampaignJobSha256({
      candidate: manifestRecord,
      catalog,
      portfolioSha256: portfolio.portfolioSha256,
      previewSha256: approvedPreview.previewSha256,
      scenario
    });
    return {
      answerPath: [],
      answersSupplied: [],
      catalogEntryId: candidate.catalogEntryId,
      categoryPath: [...candidate.categoryPath],
      checkpoint: null,
      createdAt: timestamp,
      errors: [],
      evidence: [{
        actorId: "coordinator",
        eventId: randomUUID(),
        eventType: "job_planned",
        observedAt: timestamp
      }],
      jobId: `ocdj_${jobSha256}`,
      jobSha256,
      lease: null,
      locationFixture: structuredClone(locationFixture),
      nextAction: { input: startInput, kind: "start" },
      observations: [],
      pendingMutation: null,
      providerInputSha256,
      providerReference: null,
      scenario,
      status: "queued",
      terminalResult: null,
      updatedAt: timestamp,
      verification: null
    };
  });
  const campaign = {
    authorization: approvedVolume,
    authorizationRequired: true,
    campaignId: CAMPAIGN_ID,
    campaignVersion: 1,
    candidateManifest,
    leaseDurationSeconds: 900,
    locationPortfolio: {
      assignedLocationCount: new Set(candidateManifest.map(
        ({ targetBaseZoningCode }) => targetBaseZoningCode
      )).size,
      assignmentStrategy: "target_zone_exact",
      portfolioId: portfolio.portfolioId,
      portfolioSha256: portfolio.portfolioSha256,
      portfolioVersion: portfolio.portfolioVersion
    },
    maximumProviderConcurrency: 2,
    plannedRunCount: jobs.length,
    source: {
      adaptivePreviewId: approvedPreview.previewId,
      adaptivePreviewSha256: approvedPreview.previewSha256,
      completionClaimId: prerequisiteClaim.claimId,
      completionClaimSha256: prerequisiteClaim.claimSha256,
      questionnaireId: approvedPreview.evidence.questionnaireId,
      questionnaireSha256: approvedPreview.evidence.questionnaireSha256,
      sourceFreezeId: approvedPreview.evidence.sourceFreezeId,
      sourceLedgerSnapshotSha256s: [
        ...approvedPreview.evidence.sourceLedgerSnapshotSha256s
      ]
    }
  };
  const ledgerCatalog = {
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    tenantId: catalog.provider.tenantId,
    tenantVersion: catalog.provider.tenantVersion
  };
  const ledgerSha256 = createAdaptiveZoningCampaignLedgerSha256({
    campaign,
    catalog: ledgerCatalog,
    jobs
  });
  return {
    campaign,
    catalog: ledgerCatalog,
    createdAt: timestamp,
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 8,
    updatedAt: timestamp
  };
}

export function createAdaptiveZoningCampaignJobSha256({
  candidate,
  catalog,
  portfolioSha256,
  previewSha256,
  scenario
}) {
  return sha256({
    campaignId: CAMPAIGN_ID,
    campaignVersion: 1,
    candidate,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    portfolioSha256,
    previewSha256,
    scenarioSha256: sha256(scenario),
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

export function createAdaptiveZoningCampaignLedgerSha256({
  campaign,
  catalog,
  jobs
}) {
  return sha256({
    campaign,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

function validateReadyPreview(value, catalog) {
  const preview = validateAdaptiveZoningPreview(value);
  if (preview.status !== "adaptive_preview_ready"
    || preview.prerequisite.observedStatus !== "scenario_wave_1_complete"
    || preview.prerequisite.satisfied !== true
    || preview.candidates.length < 1
    || preview.candidates.length !== preview.coverage.maximumProviderProjects
    || preview.catalog.catalogId !== catalog?.catalogId
    || preview.catalog.catalogSha256 !== catalog?.catalogSha256
    || preview.catalog.tenantId !== catalog?.provider?.tenantId
    || preview.catalog.tenantVersion !== catalog?.provider?.tenantVersion) {
    throw new Error("opencounter_adaptive_campaign_preview_invalid");
  }
  return preview;
}

function validateCompletionClaim(value, createdAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_adaptive_campaign_completion_claim_invalid");
  }
  const { claimId, claimSha256, ...payload } = value;
  if (!/^ocswc_[0-9a-f]{64}$/.test(claimId)
    || !SHA256_PATTERN.test(claimSha256)
    || claimId !== `ocswc_${claimSha256}`
    || createScenarioWaveCompletionClaimSha256(payload) !== claimSha256
    || payload.kind !== "scenario_wave_1_complete"
    || payload.coverageMetric
      !== "first_pass_provider_question_id_coverage"
    || payload.logicalScenarioCount !== 20
    || JSON.stringify(payload.excludedClaims)
      !== JSON.stringify(["answer_branch_complete"])
    || !Array.isArray(payload.limitations)
    || payload.limitations.length < 1
    || !payload.limitations.every((item) =>
      typeof item === "string" && item.length >= 1 && item.length <= 2_000)
    || !SHA256_PATTERN.test(payload.previewSha256)
    || !payload.source
    || typeof payload.source !== "object"
    || Array.isArray(payload.source)
    || JSON.stringify(payload.source).length > 50_000) {
    throw new Error("opencounter_adaptive_campaign_completion_claim_invalid");
  }
  const issuedAt = isoTimestamp(payload.issuedAt, "completionClaim.issuedAt");
  if (Date.parse(issuedAt) > Date.parse(createdAt)) {
    throw new Error("opencounter_adaptive_campaign_completion_claim_invalid");
  }
  return structuredClone(value);
}

function validateAuthorization(value, preview, createdAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      "approvedAt", "approvedBy", "authorizationId",
      "maximumProviderProjects", "previewSha256"
    ])) {
    throw new Error("opencounter_adaptive_campaign_authorization_invalid");
  }
  const approvedAt = isoTimestamp(authorizationText(value.approvedAt),
    "authorization.approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)
    || !ID_PATTERN.test(value.approvedBy)
    || !ID_PATTERN.test(value.authorizationId)
    || value.maximumProviderProjects !== preview.candidates.length
    || value.previewSha256 !== preview.previewSha256) {
    throw new Error("opencounter_adaptive_campaign_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: value.approvedBy,
    authorizationId: value.authorizationId,
    maximumProviderProjects: value.maximumProviderProjects,
    previewSha256: value.previewSha256
  };
}

function createPortfolioDefinition() {
  return {
    expectedLocationCount: REQUIRED_BASE_ZONING_CODES.length,
    jurisdiction: "cincinnati-oh",
    locationPortfolioId: "cincinnati-base-zoning-address-portfolio",
    locationPortfolioVersion: 1,
    requiredBaseZoningCodes: REQUIRED_BASE_ZONING_CODES
  };
}

function indexCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)
    || catalog.jurisdiction !== "cincinnati-oh"
    || catalog.workflow !== "zoning"
    || !Array.isArray(catalog.categories)) {
    throw new Error("opencounter_adaptive_campaign_catalog_invalid");
  }
  const entries = new Map();
  const add = (values, categoryPath) => {
    if (!Array.isArray(values)) {
      throw new Error("opencounter_adaptive_campaign_catalog_invalid");
    }
    for (const entry of values) {
      if (!entry || typeof entry !== "object"
        || entries.has(entry.catalogEntryId)) {
        throw new Error("opencounter_adaptive_campaign_catalog_invalid");
      }
      entries.set(entry.catalogEntryId, { categoryPath, entry });
    }
  };
  for (const category of catalog.categories) {
    add(category.entries, [category.label]);
    if (!Array.isArray(category.groups)) {
      throw new Error("opencounter_adaptive_campaign_catalog_invalid");
    }
    for (const group of category.groups) {
      add(group.entries, [category.label, group.label]);
    }
  }
  return entries;
}

function authorizationText(value) {
  return typeof value === "string" ? value : "";
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)), "utf8")
    .digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}
