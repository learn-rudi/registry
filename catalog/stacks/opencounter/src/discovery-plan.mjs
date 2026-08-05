import { createHash, randomUUID } from "node:crypto";

import { createZoningProviderInputSha256 } from "./core.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function createCatalogDiscoveryLedger({
  authorization,
  catalog,
  createdAt,
  discoveryDefinition,
  locationFixture
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const campaign = validateDiscoveryDefinition(discoveryDefinition, catalog);
  const location = validateLocationFixture(locationFixture);
  const entries = flattenCatalogEntries(catalog, campaign);
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
  const jobs = entries.map(({ categoryPath, entry }) => {
    const startInput = {
      address: location.address,
      catalogEntryId: entry.catalogEntryId,
      catalogId: catalog.catalogId,
      jurisdiction: catalog.jurisdiction,
      schemaVersion: 1
    };
    const providerInputSha256 = createZoningProviderInputSha256({
      address: location.address,
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
    const jobSha256 = createCatalogDiscoveryJobSha256({
      campaign,
      catalog,
      catalogEntryId: entry.catalogEntryId,
      locationFixture: location,
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
      locationFixture: structuredClone(location),
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
  const ledgerSha256 = createCatalogDiscoveryLedgerSha256({
    authorization: approvedVolume,
    campaign,
    catalog,
    jobs
  });
  return {
    campaign: {
      authorization: approvedVolume,
      authorizationRequired: campaign.authorizationRequired,
      campaignId: campaign.campaignId,
      campaignVersion: campaign.campaignVersion,
      leaseDurationSeconds: campaign.leaseDurationSeconds,
      maximumProviderConcurrency: campaign.maximumProviderConcurrency,
      plannedRunCount: jobs.length
    },
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
    schemaVersion: 2,
    updatedAt: timestamp
  };
}

export function createCatalogDiscoveryJobSha256({
  campaign,
  catalog,
  catalogEntryId,
  locationFixture,
  providerInputSha256,
  scenario
}) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogEntryId,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    locationFixtureSha256: sha256(locationFixture),
    providerInputSha256,
    scenarioSha256: sha256(scenario),
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

export function createCatalogDiscoveryLedgerSha256({
  authorization,
  campaign,
  catalog,
  jobs
}) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    providerVolumeAuthorization: authorization,
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

function validateDiscoveryDefinition(value, catalog) {
  const definition = record(value, "discoveryDefinition");
  exactKeys(definition, [
    "authorizationRequired", "campaignId", "campaignVersion", "catalogId",
    "catalogSha256", "expectedCategoryCount", "expectedEntryCount",
    "jurisdiction", "leaseDurationSeconds", "locationFixtureCount",
    "maximumProviderConcurrency", "schemaVersion", "selection",
    "tenantVersion", "workflow"
  ], "discoveryDefinition");
  if (
    definition.schemaVersion !== 1
    || definition.authorizationRequired !== true
    || definition.campaignId !== "all-use-question-discovery-first-pass"
    || definition.campaignVersion !== 1
    || definition.catalogId !== catalog?.catalogId
    || definition.catalogSha256 !== catalog?.catalogSha256
    || definition.tenantVersion !== catalog?.provider?.tenantVersion
    || definition.jurisdiction !== "cincinnati-oh"
    || definition.workflow !== "zoning"
    || definition.selection !== "all_catalog_entries"
    || definition.expectedCategoryCount !== 7
    || definition.expectedEntryCount !== 126
    || definition.locationFixtureCount !== 1
    || definition.maximumProviderConcurrency !== 2
    || !Number.isSafeInteger(definition.leaseDurationSeconds)
    || definition.leaseDurationSeconds < 60
    || definition.leaseDurationSeconds > 3_600
  ) {
    throw new Error("opencounter_discovery_definition_invalid");
  }
  return structuredClone(definition);
}

function validateLocationFixture(value) {
  const fixture = record(value, "locationFixture");
  exactKeys(fixture, [
    "address", "evidence", "locationId", "locationVersion"
  ], "locationFixture");
  if (!ID_PATTERN.test(fixture.locationId)
    || !Number.isSafeInteger(fixture.locationVersion)
    || fixture.locationVersion < 1) {
    throw new Error("opencounter_discovery_location_fixture_invalid");
  }
  if (!Array.isArray(fixture.evidence)
    || fixture.evidence.length < 1
    || fixture.evidence.length > 50) {
    throw new Error("opencounter_discovery_location_evidence_invalid");
  }
  return {
    address: boundedText(fixture.address, "locationFixture.address", 500),
    evidence: fixture.evidence.map((value_, index) => {
      const evidence = record(value_, `locationFixture.evidence[${index}]`);
      exactKeys(evidence, ["observedAt", "source"],
        `locationFixture.evidence[${index}]`);
      return {
        observedAt: isoTimestamp(
          evidence.observedAt,
          `locationFixture.evidence[${index}].observedAt`
        ),
        source: boundedText(
          evidence.source,
          `locationFixture.evidence[${index}].source`,
          2_000
        )
      };
    }),
    locationId: fixture.locationId,
    locationVersion: fixture.locationVersion
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
    || new Set(flattened.map(({ entry }) => entry.catalogEntryId)).size !== flattened.length
    || flattened.some(({ entry }, index) => entry.displayOrder !== index)) {
    throw new Error("opencounter_discovery_catalog_selection_invalid");
  }
  return flattened;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(sortJson(value)), "utf8").digest("hex");
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
