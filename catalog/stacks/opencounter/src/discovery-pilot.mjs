import { createHash, randomUUID } from "node:crypto";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ENTRY_ID_PATTERN = /^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function createResidentialPilotLedger({
  authorization,
  catalog,
  createdAt,
  pilotDefinition,
  propertyProfiles
}) {
  const timestamp = isoTimestamp(createdAt, "createdAt");
  const pilot = validatePilotDefinition(pilotDefinition, catalog);
  const profiles = validatePropertyProfiles(propertyProfiles, pilot.propertyProfileCount);
  const approvedVolume = validatePilotAuthorization(
    authorization,
    pilot.entries.length * profiles.length,
    timestamp
  );
  const catalogEntries = indexCatalogEntries(catalog);
  const jobs = [];
  const jobIds = new Set();

  for (const plannedEntry of pilot.entries) {
    const catalogEntry = catalogEntries.get(plannedEntry.catalogEntryId);
    if (catalogEntry === undefined) {
      throw new Error("opencounter_discovery_catalog_entry_missing");
    }
    if (catalogEntry.categoryPath.join(" / ")
      !== "Residential Uses / Permanent residential") {
      throw new Error("opencounter_discovery_pilot_entry_out_of_scope");
    }
    for (const profile of profiles) {
      const jobSha256 = createDiscoveryJobSha256({
        catalog: {
          catalogId: catalog.catalogId,
          catalogSha256: catalog.catalogSha256,
          tenantVersion: catalog.provider.tenantVersion
        },
        job: {
          catalogEntryId: plannedEntry.catalogEntryId,
          propertyProfile: profile,
          scenario: plannedEntry.scenario
        },
        pilot
      });
      const jobId = `ocdj_${jobSha256}`;
      if (jobIds.has(jobId)) throw new Error("opencounter_discovery_duplicate_job");
      jobIds.add(jobId);
      jobs.push(createPlannedJob({
        catalog,
        catalogEntry,
        jobId,
        jobSha256,
        plannedEntry,
        profile,
        timestamp
      }));
    }
  }

  const ledgerSha256 = createDiscoveryLedgerSha256({
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantVersion: catalog.provider.tenantVersion
    },
    jobs,
    pilot: {
      authorization: approvedVolume,
      pilotId: pilot.pilotId,
      pilotVersion: pilot.pilotVersion
    }
  });
  return {
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
    pilot: {
      authorization: approvedVolume,
      authorizationRequired: pilot.authorizationRequired,
      leaseDurationSeconds: pilot.leaseDurationSeconds,
      maximumProviderConcurrency: pilot.maximumProviderConcurrency,
      pilotId: pilot.pilotId,
      pilotVersion: pilot.pilotVersion,
      plannedRunCount: jobs.length
    },
    questionGraph: { edges: [], questions: [] },
    schemaVersion: 1,
    updatedAt: timestamp
  };
}

export function createDiscoveryJobSha256({ catalog, job, pilot }) {
  return sha256({
    catalogEntryId: job.catalogEntryId,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    pilotId: pilot.pilotId,
    pilotVersion: pilot.pilotVersion,
    propertyProfileSha256: sha256(job.propertyProfile),
    scenarioSha256: sha256(job.scenario),
    tenantVersion: catalog.tenantVersion
  });
}

export function createDiscoveryLedgerSha256({ catalog, jobs, pilot }) {
  return sha256({
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    pilotId: pilot.pilotId,
    pilotVersion: pilot.pilotVersion,
    providerVolumeAuthorization: pilot.authorization,
    tenantVersion: catalog.tenantVersion
  });
}

function createPlannedJob({
  catalog,
  catalogEntry,
  jobId,
  jobSha256,
  plannedEntry,
  profile,
  timestamp
}) {
  return {
    answerPath: [],
    answersSupplied: [],
    catalogEntryId: plannedEntry.catalogEntryId,
    categoryPath: catalogEntry.categoryPath,
    checkpoint: null,
    createdAt: timestamp,
    errors: [],
    evidence: [{
      actorId: "coordinator",
      eventId: randomUUID(),
      eventType: "job_planned",
      observedAt: timestamp
    }],
    jobId,
    jobSha256,
    lease: null,
    nextAction: {
      input: {
        address: profile.address,
        catalogEntryId: plannedEntry.catalogEntryId,
        catalogId: catalog.catalogId,
        jurisdiction: catalog.jurisdiction,
        schemaVersion: 1
      },
      kind: "start"
    },
    observations: [],
    pendingMutation: null,
    propertyProfile: profile,
    providerReference: null,
    scenario: structuredClone(plannedEntry.scenario),
    status: "queued",
    terminalResult: null,
    updatedAt: timestamp
  };
}

function validatePilotAuthorization(value, plannedRunCount, createdAt) {
  if (value === undefined) {
    throw new Error("opencounter_discovery_authorization_required");
  }
  const authorization = record(value, "authorization");
  exactKeys(authorization, [
    "approvedAt",
    "approvedBy",
    "authorizationId",
    "maximumProviderProjects"
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

function validatePilotDefinition(value, catalog) {
  const pilot = record(value, "pilotDefinition");
  exactKeys(pilot, [
    "authorizationRequired", "catalogId", "catalogSha256", "entries",
    "jurisdiction", "leaseDurationSeconds", "maximumProviderConcurrency",
    "pilotId", "pilotVersion", "propertyProfileCount", "schemaVersion",
    "tenantVersion", "workflow"
  ], "pilotDefinition");
  if (
    pilot.schemaVersion !== 1
    || pilot.authorizationRequired !== true
    || pilot.catalogId !== catalog?.catalogId
    || pilot.catalogSha256 !== catalog?.catalogSha256
    || pilot.jurisdiction !== "cincinnati-oh"
    || pilot.workflow !== "zoning"
    || pilot.tenantVersion !== catalog?.provider?.tenantVersion
    || pilot.propertyProfileCount !== 3
    || pilot.maximumProviderConcurrency !== 2
    || !Number.isSafeInteger(pilot.leaseDurationSeconds)
    || pilot.leaseDurationSeconds < 60
    || pilot.leaseDurationSeconds > 3_600
    || !ID_PATTERN.test(pilot.pilotId)
    || pilot.pilotVersion !== 1
    || !Array.isArray(pilot.entries)
    || pilot.entries.length !== 6
  ) {
    throw new Error("opencounter_discovery_pilot_invalid");
  }
  const entryIds = new Set();
  const scenarioIds = new Set();
  for (const value_ of pilot.entries) {
    const entry = record(value_, "pilot entry");
    exactKeys(entry, ["catalogEntryId", "scenario"], "pilot entry");
    if (!ENTRY_ID_PATTERN.test(entry.catalogEntryId) || entryIds.has(entry.catalogEntryId)) {
      throw new Error("opencounter_discovery_pilot_entry_invalid");
    }
    entryIds.add(entry.catalogEntryId);
    validateScenario(entry.scenario, scenarioIds);
  }
  return structuredClone(pilot);
}

function validateScenario(value, scenarioIds) {
  const scenario = record(value, "scenario");
  exactKeys(scenario, [
    "answerRules", "assumptions", "scenarioId", "scenarioVersion"
  ], "scenario");
  if (
    !ID_PATTERN.test(scenario.scenarioId)
    || scenarioIds.has(scenario.scenarioId)
    || scenario.scenarioVersion !== 1
    || !Array.isArray(scenario.answerRules)
    || scenario.answerRules.length > 100
  ) {
    throw new Error("opencounter_discovery_scenario_invalid");
  }
  scenarioIds.add(scenario.scenarioId);
  const ruleQuestions = new Set();
  for (const value_ of scenario.answerRules) {
    const rule = record(value_, "scenario.answerRule");
    exactKeys(rule, [
      "questionId", "questionSignatureSha256", "value"
    ], "scenario.answerRule");
    const questionId = boundedText(rule.questionId, "scenario.answerRule.questionId", 100);
    if (ruleQuestions.has(questionId) || !SHA256_PATTERN.test(rule.questionSignatureSha256)) {
      throw new Error("opencounter_discovery_scenario_answer_rule_invalid");
    }
    ruleQuestions.add(questionId);
    boundedText(rule.value, "scenario.answerRule.value", 2_000);
  }
  boundedJsonObject(scenario.assumptions, "scenario.assumptions", 10_000);
}

function validatePropertyProfiles(values, expectedCount) {
  if (!Array.isArray(values) || values.length !== expectedCount) {
    throw new Error("opencounter_discovery_property_profiles_invalid");
  }
  const identities = new Set();
  return values.map((value, index) => {
    const profile = record(value, `propertyProfiles[${index}]`);
    exactKeys(profile, [
      "address", "evidence", "profileId", "profileVersion", "propertyFacts"
    ], `propertyProfiles[${index}]`);
    const profileId = id(profile.profileId, `propertyProfiles[${index}].profileId`);
    if (!Number.isSafeInteger(profile.profileVersion) || profile.profileVersion < 1) {
      throw new Error("opencounter_discovery_property_profile_version_invalid");
    }
    const identity = `${profileId}:${profile.profileVersion}`;
    if (identities.has(identity)) {
      throw new Error("opencounter_discovery_property_profile_duplicate");
    }
    identities.add(identity);
    return {
      address: boundedText(profile.address, `propertyProfiles[${index}].address`, 500),
      evidence: validateEvidence(profile.evidence, index),
      profileId,
      profileVersion: profile.profileVersion,
      propertyFacts: boundedJsonObject(
        profile.propertyFacts,
        `propertyProfiles[${index}].propertyFacts`,
        20_000
      )
    };
  });
}

function validateEvidence(values, profileIndex) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("opencounter_discovery_property_evidence_invalid");
  }
  return values.map((value, evidenceIndex) => {
    const path = `propertyProfiles[${profileIndex}].evidence[${evidenceIndex}]`;
    const evidence = record(value, path);
    exactKeys(evidence, ["observedAt", "source"], path);
    return {
      observedAt: isoTimestamp(evidence.observedAt, `${path}.observedAt`),
      source: boundedText(evidence.source, `${path}.source`, 2_000)
    };
  });
}

function indexCatalogEntries(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.categories)) {
    throw new Error("opencounter_discovery_catalog_invalid");
  }
  const entries = new Map();
  for (const category of catalog.categories) {
    for (const entry of category.entries) {
      entries.set(entry.catalogEntryId, { categoryPath: [category.label], entry });
    }
    for (const group of category.groups) {
      for (const entry of group.entries) {
        entries.set(entry.catalogEntryId, {
          categoryPath: [category.label, group.label],
          entry
        });
      }
    }
  }
  return entries;
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}

function boundedJsonObject(value, path, maximumBytes) {
  const object = record(value, path);
  if (Buffer.byteLength(canonicalJson(object), "utf8") > maximumBytes) {
    throw new Error(`${path} is too large.`);
  }
  return structuredClone(object);
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
  if (
    typeof value !== "string" || value.length < 1 || value.length > maximum
    || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)
  ) {
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
