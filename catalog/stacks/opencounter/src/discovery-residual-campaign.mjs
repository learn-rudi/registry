import { randomUUID } from "node:crypto";

import { createZoningProviderInputSha256 } from "./core.mjs";
import { validateDiscoveryLedgerShape } from "./discovery-ledger-schema.mjs";
import {
  createZoningPortfolioResidualJobSha256,
  createZoningPortfolioResidualLedgerSha256
} from "./discovery-residual-identity.mjs";
import { validateZoningLocationPortfolio } from
  "./discovery-zoning-portfolio.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const START_DISPATCH_EVENT = "start_dispatch_started";

export function createZoningPortfolioResidualLedger({
  authorization,
  catalog,
  createdAt,
  locationPortfolio,
  sourceConsumedProviderProjects,
  sourceLedger
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const source = validateDiscoveryLedgerShape(sourceLedger);
  if (source.schemaVersion !== 3
    || source.jobs.some(({ status }) => status === "active" || status === "indeterminate")) {
    throw new Error("opencounter_discovery_residual_source_invalid");
  }
  const consumedJobs = source.jobs.filter(hasStartDispatchIntent);
  if (!Number.isSafeInteger(sourceConsumedProviderProjects)
    || sourceConsumedProviderProjects !== consumedJobs.length) {
    throw new Error("opencounter_discovery_residual_consumed_count_invalid");
  }
  const remainingSourceJobs = source.jobs.filter((job) => !hasStartDispatchIntent(job));
  if (remainingSourceJobs.length < 1
    || sourceConsumedProviderProjects + remainingSourceJobs.length
      !== source.campaign.authorization.maximumProviderProjects) {
    throw new Error("opencounter_discovery_residual_authorization_invalid");
  }
  if (!Number.isSafeInteger(locationPortfolio?.portfolioVersion)
    || locationPortfolio.portfolioVersion
      <= source.campaign.locationPortfolio.portfolioVersion) {
    throw new Error("opencounter_discovery_residual_portfolio_version_invalid");
  }
  const portfolio = validateZoningLocationPortfolio(locationPortfolio, {
    expectedLocationCount: source.campaign.locationPortfolio.locationCount,
    jurisdiction: "cincinnati-oh",
    locationPortfolioId: source.campaign.locationPortfolio.portfolioId,
    locationPortfolioVersion: locationPortfolio.portfolioVersion,
    requiredBaseZoningCodes: source.campaign.locationPortfolio.requiredBaseZoningCodes
  });
  const approvedVolume = validateResidualAuthorization(
    authorization,
    remainingSourceJobs.length,
    timestamp
  );
  if (approvedVolume.maximumProviderProjects + sourceConsumedProviderProjects
    !== source.campaign.authorization.maximumProviderProjects) {
    throw new Error("opencounter_discovery_residual_authorization_invalid");
  }
  const campaign = {
    authorization: approvedVolume,
    authorizationRequired: true,
    campaignId: "all-use-zoning-portfolio-question-discovery-residual",
    campaignVersion: 1,
    leaseDurationSeconds: source.campaign.leaseDurationSeconds,
    locationPortfolio: {
      assignmentStrategy: source.campaign.locationPortfolio.assignmentStrategy,
      locationCount: portfolio.locations.length,
      portfolioId: portfolio.portfolioId,
      portfolioSha256: portfolio.portfolioSha256,
      portfolioVersion: portfolio.portfolioVersion,
      requiredBaseZoningCodes: structuredClone(
        source.campaign.locationPortfolio.requiredBaseZoningCodes
      )
    },
    maximumProviderConcurrency: source.campaign.maximumProviderConcurrency,
    plannedRunCount: remainingSourceJobs.length,
    residualOf: {
      consumedProviderProjects: sourceConsumedProviderProjects,
      ledgerId: source.ledgerId,
      ledgerSha256: source.ledgerSha256
    }
  };
  const entriesById = flattenCatalogEntries(catalog);
  const locationsByZone = new Map(portfolio.locations.map((location) => [
    location.expectedBaseZoningCode,
    location
  ]));
  const jobs = remainingSourceJobs.map((sourceJob) => {
    const entryRecord = entriesById.get(sourceJob.catalogEntryId);
    const locationFixture = locationsByZone.get(
      sourceJob.locationFixture.expectedBaseZoningCode
    );
    if (entryRecord === undefined || locationFixture === undefined
      || JSON.stringify(entryRecord.categoryPath) !== JSON.stringify(sourceJob.categoryPath)) {
      throw new Error("opencounter_discovery_residual_source_job_invalid");
    }
    const { categoryPath, entry } = entryRecord;
    const startInput = {
      address: locationFixture.address,
      catalogEntryId: entry.catalogEntryId,
      catalogId: catalog.catalogId,
      jurisdiction: catalog.jurisdiction,
      schemaVersion: 1
    };
    const providerInputSha256 = createZoningProviderInputSha256({
      address: locationFixture.address,
      catalogEntryId: entry.catalogEntryId,
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      categoryPath,
      description: entry.description,
      jurisdiction: catalog.jurisdiction,
      proposedUse: entry.providerLabel,
      providerUseSlug: entry.providerUseSlug,
      workflow: catalog.workflow
    });
    const scenario = structuredClone(sourceJob.scenario);
    const jobSha256 = createZoningPortfolioResidualJobSha256({
      campaign,
      catalog,
      catalogEntryId: entry.catalogEntryId,
      locationFixture,
      providerInputSha256,
      scenario
    });
    return {
      answerPath: [],
      answersSupplied: [],
      catalogEntryId: entry.catalogEntryId,
      categoryPath,
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
  const ledgerSha256 = createZoningPortfolioResidualLedgerSha256({
    campaign,
    catalog,
    jobs
  });
  return {
    campaign,
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
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 4,
    updatedAt: timestamp
  };
}

function hasStartDispatchIntent(job) {
  return job.evidence.some(({ eventType }) => eventType === START_DISPATCH_EVENT);
}

function flattenCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.categories)) {
    throw new Error("opencounter_discovery_residual_catalog_invalid");
  }
  const flattened = [];
  for (const category of catalog.categories) {
    for (const entry of category.entries) {
      flattened.push({ categoryPath: [category.label], entry });
    }
    for (const group of category.groups) {
      for (const entry of group.entries) {
        flattened.push({ categoryPath: [category.label, group.label], entry });
      }
    }
  }
  flattened.sort((left, right) => left.entry.displayOrder - right.entry.displayOrder);
  if (flattened.length !== 126
    || new Set(flattened.map(({ entry }) => entry.catalogEntryId)).size !== 126) {
    throw new Error("opencounter_discovery_residual_catalog_invalid");
  }
  return new Map(flattened.map((record) => [record.entry.catalogEntryId, record]));
}

function validateResidualAuthorization(value, plannedRunCount, createdAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([
        "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects"
      ].sort())) {
    throw new Error("opencounter_discovery_residual_authorization_invalid");
  }
  const approvedAt = isoTimestamp(value.approvedAt, "authorization.approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)
    || !ID_PATTERN.test(value.approvedBy)
    || !ID_PATTERN.test(value.authorizationId)
    || value.maximumProviderProjects !== plannedRunCount) {
    throw new Error("opencounter_discovery_residual_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: value.approvedBy,
    authorizationId: value.authorizationId,
    maximumProviderProjects: value.maximumProviderProjects
  };
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}
