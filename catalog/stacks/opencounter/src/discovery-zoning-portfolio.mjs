import { createHash, randomUUID } from "node:crypto";

import { createZoningProviderInputSha256 } from "./core.mjs";
import { normalizeAddress } from "./discovery-ledger-inputs.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PARCEL_KEY_PATTERN = /^[0-9A-Z]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function createZoningPortfolioDiscoveryLedger({
  authorization,
  catalog,
  createdAt,
  discoveryDefinition,
  locationPortfolio
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const campaignDefinition = validatePortfolioDiscoveryDefinition(
    discoveryDefinition,
    catalog
  );
  const portfolio = validateZoningLocationPortfolio(
    locationPortfolio,
    campaignDefinition
  );
  const entries = flattenCatalogEntries(catalog, campaignDefinition);
  const approvedVolume = validateAuthorization(
    authorization,
    entries.length,
    timestamp
  );
  const scenario = {
    answerRules: [],
    assumptions: {},
    scenarioId: "first-pass-question-observation",
    scenarioVersion: 1
  };
  const jobs = entries.map(({ categoryPath, entry }, index) => {
    const locationFixture = portfolio.locations[index % portfolio.locations.length];
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
    const jobSha256 = createZoningPortfolioDiscoveryJobSha256({
      campaignDefinition,
      catalog,
      catalogEntryId: entry.catalogEntryId,
      locationFixture,
      portfolioSha256: portfolio.portfolioSha256,
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
      scenario: structuredClone(scenario),
      status: "queued",
      terminalResult: null,
      updatedAt: timestamp,
      verification: null
    };
  });
  const campaign = {
    authorization: approvedVolume,
    authorizationRequired: campaignDefinition.authorizationRequired,
    campaignId: campaignDefinition.campaignId,
    campaignVersion: campaignDefinition.campaignVersion,
    leaseDurationSeconds: campaignDefinition.leaseDurationSeconds,
    locationPortfolio: {
      assignmentStrategy: campaignDefinition.locationAssignment,
      locationCount: portfolio.locations.length,
      portfolioId: portfolio.portfolioId,
      portfolioSha256: portfolio.portfolioSha256,
      portfolioVersion: portfolio.portfolioVersion,
      requiredBaseZoningCodes: structuredClone(
        campaignDefinition.requiredBaseZoningCodes
      )
    },
    maximumProviderConcurrency: campaignDefinition.maximumProviderConcurrency,
    plannedRunCount: jobs.length
  };
  const ledgerSha256 = createZoningPortfolioDiscoveryLedgerSha256({
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
    schemaVersion: 3,
    updatedAt: timestamp
  };
}

export function createZoningPortfolioDiscoveryJobSha256({
  campaignDefinition,
  catalog,
  catalogEntryId,
  locationFixture,
  portfolioSha256,
  providerInputSha256,
  scenario
}) {
  return sha256({
    campaignId: campaignDefinition.campaignId,
    campaignVersion: campaignDefinition.campaignVersion,
    catalogEntryId,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    locationFixtureSha256: sha256(locationFixture),
    portfolioSha256,
    providerInputSha256,
    scenarioSha256: sha256(scenario),
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

export function createZoningPortfolioDiscoveryLedgerSha256({
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

function validatePortfolioDiscoveryDefinition(value, catalog) {
  const definition = record(value, "discoveryDefinition");
  exactKeys(definition, [
    "authorizationRequired", "campaignId", "campaignVersion", "catalogId",
    "catalogSha256", "expectedCategoryCount", "expectedEntryCount",
    "expectedLocationCount", "jurisdiction", "leaseDurationSeconds",
    "locationAssignment", "locationPortfolioId", "locationPortfolioVersion",
    "maximumProviderConcurrency", "requiredBaseZoningCodes", "schemaVersion",
    "selection", "tenantVersion", "workflow"
  ], "discoveryDefinition");
  if (
    definition.schemaVersion !== 1
    || definition.authorizationRequired !== true
    || definition.campaignId
      !== "all-use-zoning-portfolio-question-discovery-first-pass"
    || definition.campaignVersion !== 1
    || definition.catalogId !== catalog?.catalogId
    || definition.catalogSha256 !== catalog?.catalogSha256
    || definition.tenantVersion !== catalog?.provider?.tenantVersion
    || definition.jurisdiction !== "cincinnati-oh"
    || definition.workflow !== "zoning"
    || definition.selection !== "all_catalog_entries"
    || definition.expectedCategoryCount !== 7
    || definition.expectedEntryCount !== 126
    || definition.expectedLocationCount !== 37
    || definition.locationAssignment !== "balanced_round_robin"
    || definition.locationPortfolioId
      !== "cincinnati-base-zoning-address-portfolio"
    || definition.locationPortfolioVersion !== 1
    || definition.maximumProviderConcurrency !== 2
    || !Number.isSafeInteger(definition.leaseDurationSeconds)
    || definition.leaseDurationSeconds < 60
    || definition.leaseDurationSeconds > 3_600
    || !Array.isArray(definition.requiredBaseZoningCodes)
    || definition.requiredBaseZoningCodes.length !== definition.expectedLocationCount
    || new Set(definition.requiredBaseZoningCodes).size
      !== definition.requiredBaseZoningCodes.length
    || !definition.requiredBaseZoningCodes.every(isZoningCode)
  ) {
    throw new Error("opencounter_discovery_definition_invalid");
  }
  return structuredClone(definition);
}

export function validateZoningLocationPortfolio(value, definition) {
  const portfolio = record(value, "locationPortfolio");
  exactKeys(portfolio, [
    "jurisdiction", "locations", "portfolioId", "portfolioVersion",
    "schemaVersion"
  ], "locationPortfolio");
  if (
    portfolio.schemaVersion !== 1
    || portfolio.portfolioId !== definition.locationPortfolioId
    || portfolio.portfolioVersion !== definition.locationPortfolioVersion
    || portfolio.jurisdiction !== definition.jurisdiction
    || !Array.isArray(portfolio.locations)
    || portfolio.locations.length !== definition.expectedLocationCount
  ) {
    throw new Error("opencounter_discovery_location_portfolio_invalid");
  }
  const locationsByZone = new Map();
  const addressKeys = new Set();
  const locationIds = new Set();
  const parcelKeys = new Set();
  for (const [index, value_] of portfolio.locations.entries()) {
    const location = validateZoningLocation(value_, index);
    if (locationsByZone.has(location.expectedBaseZoningCode)
      || addressKeys.has(normalizeAddress(location.address))
      || locationIds.has(location.locationId)
      || parcelKeys.has(location.parcelKey)) {
      throw new Error("opencounter_discovery_location_portfolio_invalid");
    }
    locationsByZone.set(location.expectedBaseZoningCode, location);
    addressKeys.add(normalizeAddress(location.address));
    locationIds.add(location.locationId);
    parcelKeys.add(location.parcelKey);
  }
  const locations = definition.requiredBaseZoningCodes.map((zone) =>
    locationsByZone.get(zone));
  if (locations.some((location) => location === undefined)) {
    throw new Error("opencounter_discovery_location_portfolio_invalid");
  }
  const normalized = {
    jurisdiction: portfolio.jurisdiction,
    locations,
    portfolioId: portfolio.portfolioId,
    portfolioVersion: portfolio.portfolioVersion,
    schemaVersion: portfolio.schemaVersion
  };
  return {
    ...normalized,
    portfolioSha256: sha256(normalized)
  };
}

function validateZoningLocation(value, index) {
  const path = `locationPortfolio.locations[${index}]`;
  const location = record(value, path);
  exactKeys(location, [
    "address", "boundarySha256", "evidence", "expectedBaseZoningCode",
    "locationId", "locationVersion", "municipality", "observedZoningCode",
    "overlayFlags", "parcelKey", "rollupId"
  ], path);
  const expectedBaseZoningCode = zoningCode(
    location.expectedBaseZoningCode,
    `${path}.expectedBaseZoningCode`
  );
  const observedZoningCode = zoningCode(
    location.observedZoningCode,
    `${path}.observedZoningCode`
  );
  if (observedZoningCode !== expectedBaseZoningCode
    && !observedZoningCode.startsWith(`${expectedBaseZoningCode}-`)) {
    throw new Error("opencounter_discovery_location_zoning_invalid");
  }
  if (!ID_PATTERN.test(location.locationId)
    || !Number.isSafeInteger(location.locationVersion)
    || location.locationVersion < 1
    || location.municipality !== "City of Cincinnati"
    || !SHA256_PATTERN.test(location.boundarySha256)
    || !PARCEL_KEY_PATTERN.test(location.parcelKey)
    || !UUID_PATTERN.test(location.rollupId)
    || !Array.isArray(location.overlayFlags)
    || location.overlayFlags.length > 50
    || new Set(location.overlayFlags).size !== location.overlayFlags.length
    || !location.overlayFlags.every((flag) => ID_PATTERN.test(flag))
    || !Array.isArray(location.evidence)
    || location.evidence.length < 1
    || location.evidence.length > 50) {
    throw new Error("opencounter_discovery_location_fixture_invalid");
  }
  return {
    address: boundedText(location.address, `${path}.address`, 500),
    boundarySha256: location.boundarySha256,
    evidence: location.evidence.map((value_, evidenceIndex) => {
      const evidencePath = `${path}.evidence[${evidenceIndex}]`;
      const evidence = record(value_, evidencePath);
      exactKeys(evidence, ["evidenceRef", "observedAt", "source"], evidencePath);
      return {
        evidenceRef: boundedText(evidence.evidenceRef, `${evidencePath}.evidenceRef`, 200),
        observedAt: isoTimestamp(evidence.observedAt, `${evidencePath}.observedAt`),
        source: boundedText(evidence.source, `${evidencePath}.source`, 2_000)
      };
    }),
    expectedBaseZoningCode,
    locationId: location.locationId,
    locationVersion: location.locationVersion,
    municipality: location.municipality,
    observedZoningCode,
    overlayFlags: [...location.overlayFlags].sort(),
    parcelKey: location.parcelKey,
    rollupId: location.rollupId
  };
}

function validateAuthorization(value, plannedRunCount, createdAt) {
  const authorization = record(value, "authorization");
  exactKeys(authorization, [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects"
  ], "authorization");
  const approvedAt = isoTimestamp(authorization.approvedAt, "authorization.approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)
    || authorization.maximumProviderProjects !== plannedRunCount) {
    throw new Error("opencounter_discovery_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: id(authorization.approvedBy, "authorization.approvedBy"),
    authorizationId: id(authorization.authorizationId, "authorization.authorizationId"),
    maximumProviderProjects: authorization.maximumProviderProjects
  };
}

function flattenCatalogEntries(catalog, campaign) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.categories)
    || catalog.categories.length !== campaign.expectedCategoryCount) {
    throw new Error("opencounter_discovery_catalog_invalid");
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
  if (flattened.length !== campaign.expectedEntryCount
    || new Set(flattened.map(({ entry }) => entry.catalogEntryId)).size
      !== flattened.length
    || flattened.some(({ entry }, index) => entry.displayOrder !== index)) {
    throw new Error("opencounter_discovery_catalog_selection_invalid");
  }
  return flattened;
}

function isZoningCode(value) {
  return typeof value === "string"
    && /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(value)
    && value.length <= 30;
}

function zoningCode(value, path) {
  if (!isZoningCode(value)) throw new Error(`${path} is invalid.`);
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

function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${path} has unsupported or missing fields.`);
  }
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function id(value, path) {
  const text = boundedText(value, path, 100);
  if (!ID_PATTERN.test(text)) throw new Error(`${path} is invalid.`);
  return text;
}

function boundedText(value, path, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}
