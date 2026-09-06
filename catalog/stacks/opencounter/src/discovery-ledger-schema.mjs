import { createDiscoveryJobSha256, createDiscoveryLedgerSha256 } from "./discovery-pilot.mjs";
import { createCatalogDiscoveryJobSha256, createCatalogDiscoveryLedgerSha256 } from "./discovery-plan.mjs";
import { createZoningPortfolioDiscoveryJobSha256, createZoningPortfolioDiscoveryLedgerSha256 } from "./discovery-zoning-portfolio.mjs";
import { createZoningPortfolioResidualJobSha256, createZoningPortfolioResidualLedgerSha256 } from "./discovery-residual-identity.mjs";
import { boundedObject, exactKeys, record, text, timestamp, validateBoundedArray, validateEvidenceRecords, validateProviderReference, validateQuestionGraph } from "./discovery-schema-helpers.mjs";
import {
  ID_PATTERN,
  JOB_ID_PATTERN,
  LEDGER_ID_PATTERN,
  SHA256_PATTERN,
  STATUSES,
  validateCatalogCampaignIdentity,
  validateCatalogCampaignJobFields,
  validateLease,
  validateNextAction,
  validateScenario,
  validateScenarioBranchCampaignLedger,
  validateZoningPortfolioLocationFixture
} from "./discovery-ledger-scenario-schema.mjs";

const REQUIRED_BASE_ZONING_CODES = [
  "SF-20", "SF-10", "SF-6", "SF-4", "SF-2", "RMX", "RM-2.0",
  "RM-1.2", "RM-0.7", "OL", "OG", "CN-P", "CN-M", "CC-P", "CC-M",
  "CC-A", "CG-A", "UM", "DD", "MA", "ML", "MG", "ME", "RF-R",
  "RF-C", "RF-M", "PR", "IR", "T3E", "T3N", "T4N.MF", "T4N.SF",
  "T5F", "T5MS", "T5N.LS", "T5N.SS", "PD"
];

export function validateDiscoveryLedgerShape(value) {
  const ledger = record(value, "ledger");
  if (ledger.schemaVersion === 6) return validateScenarioBranchCampaignLedger(ledger);
  if (ledger.schemaVersion === 4) return validateZoningPortfolioResidualLedger(ledger);
  if (ledger.schemaVersion === 3) return validateZoningPortfolioCampaignLedger(ledger);
  if (ledger.schemaVersion === 2) return validateCatalogCampaignLedger(ledger);
  exactKeys(ledger, [
    "catalog", "createdAt", "jobs", "ledgerId", "ledgerSha256", "pilot",
    "questionGraph", "schemaVersion", "updatedAt"
  ], "ledger");
  if (
    ledger.schemaVersion !== 1
    || !LEDGER_ID_PATTERN.test(ledger.ledgerId)
    || !SHA256_PATTERN.test(ledger.ledgerSha256)
    || ledger.ledgerId !== `ocdl_${ledger.ledgerSha256}`
    || !Array.isArray(ledger.jobs)
    || ledger.jobs.length !== 18
  ) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  timestamp(ledger.createdAt, "ledger.createdAt");
  timestamp(ledger.updatedAt, "ledger.updatedAt");
  if (Date.parse(ledger.updatedAt) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_ledger_time_invalid");
  }
  validateCatalog(ledger.catalog);
  validatePilot(ledger.pilot, ledger.jobs.length, ledger.createdAt);
  const jobIds = new Set();
  for (const [index, job] of ledger.jobs.entries()) {
    validateJob(job, index, ledger);
    if (jobIds.has(job.jobId)) throw new Error("opencounter_discovery_duplicate_job");
    jobIds.add(job.jobId);
  }
  const expectedLedgerSha256 = createDiscoveryLedgerSha256(ledger);
  if (expectedLedgerSha256 !== ledger.ledgerSha256) {
    throw new Error("opencounter_discovery_ledger_identity_invalid");
  }
  validateQuestionGraph(ledger.questionGraph);
  return structuredClone(ledger);
}

function validateZoningPortfolioResidualLedger(ledger) {
  exactKeys(ledger, [
    "campaign", "catalog", "createdAt", "jobs", "ledgerId", "ledgerSha256",
    "questionGraph", "schemaVersion", "updatedAt"
  ], "ledger");
  if (ledger.schemaVersion !== 4
    || !LEDGER_ID_PATTERN.test(ledger.ledgerId)
    || !SHA256_PATTERN.test(ledger.ledgerSha256)
    || ledger.ledgerId !== `ocdl_${ledger.ledgerSha256}`
    || !Array.isArray(ledger.jobs)
    || ledger.jobs.length < 1
    || ledger.jobs.length >= 126) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  timestamp(ledger.createdAt, "ledger.createdAt");
  timestamp(ledger.updatedAt, "ledger.updatedAt");
  if (Date.parse(ledger.updatedAt) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_ledger_time_invalid");
  }
  validateCatalogCampaignIdentity(ledger.catalog);
  validateResidualCampaign(ledger.campaign, ledger.jobs.length, ledger.createdAt);
  const jobIds = new Set();
  const entryIds = new Set();
  const fixturesByZone = new Map();
  for (const [index, job] of ledger.jobs.entries()) {
    validateCatalogCampaignJobFields(job, index, ledger);
    validateZoningPortfolioLocationFixture(job.locationFixture, index);
    const expectedJobSha256 = createZoningPortfolioResidualJobSha256({
      campaign: ledger.campaign,
      catalog: ledger.catalog,
      catalogEntryId: job.catalogEntryId,
      locationFixture: job.locationFixture,
      providerInputSha256: job.providerInputSha256,
      scenario: job.scenario
    });
    if (expectedJobSha256 !== job.jobSha256
      || jobIds.has(job.jobId)
      || entryIds.has(job.catalogEntryId)) {
      throw new Error("opencounter_discovery_residual_job_identity_invalid");
    }
    const zone = job.locationFixture.expectedBaseZoningCode;
    const priorFixture = fixturesByZone.get(zone);
    if (priorFixture !== undefined
      && JSON.stringify(priorFixture) !== JSON.stringify(job.locationFixture)) {
      throw new Error("opencounter_discovery_location_fixture_conflict");
    }
    fixturesByZone.set(zone, job.locationFixture);
    jobIds.add(job.jobId);
    entryIds.add(job.catalogEntryId);
  }
  if (fixturesByZone.size !== REQUIRED_BASE_ZONING_CODES.length) {
    throw new Error("opencounter_discovery_location_portfolio_invalid");
  }
  const expectedLedgerSha256 = createZoningPortfolioResidualLedgerSha256({
    campaign: ledger.campaign,
    catalog: ledger.catalog,
    jobs: ledger.jobs
  });
  if (expectedLedgerSha256 !== ledger.ledgerSha256) {
    throw new Error("opencounter_discovery_ledger_identity_invalid");
  }
  validateQuestionGraph(ledger.questionGraph);
  return structuredClone(ledger);
}

function validateResidualCampaign(value, jobCount, createdAt) {
  const campaign = record(value, "ledger.campaign");
  exactKeys(campaign, [
    "authorization", "authorizationRequired", "campaignId", "campaignVersion",
    "leaseDurationSeconds", "locationPortfolio", "maximumProviderConcurrency",
    "plannedRunCount", "residualOf"
  ], "ledger.campaign");
  if (campaign.authorizationRequired !== true
    || campaign.campaignId !== "all-use-zoning-portfolio-question-discovery-residual"
    || campaign.campaignVersion !== 1
    || campaign.maximumProviderConcurrency !== 2
    || campaign.plannedRunCount !== jobCount
    || !Number.isSafeInteger(campaign.leaseDurationSeconds)
    || campaign.leaseDurationSeconds < 60
    || campaign.leaseDurationSeconds > 3_600) {
    throw new Error("opencounter_discovery_residual_campaign_invalid");
  }
  validateCampaignAuthorization(campaign.authorization, jobCount, createdAt);
  const residualOf = record(campaign.residualOf, "ledger.campaign.residualOf");
  exactKeys(residualOf, [
    "consumedProviderProjects", "ledgerId", "ledgerSha256"
  ], "ledger.campaign.residualOf");
  if (!Number.isSafeInteger(residualOf.consumedProviderProjects)
    || residualOf.consumedProviderProjects < 1
    || residualOf.consumedProviderProjects + jobCount !== 126
    || !LEDGER_ID_PATTERN.test(residualOf.ledgerId)
    || !SHA256_PATTERN.test(residualOf.ledgerSha256)
    || residualOf.ledgerId !== `ocdl_${residualOf.ledgerSha256}`) {
    throw new Error("opencounter_discovery_residual_source_invalid");
  }
  const portfolio = record(campaign.locationPortfolio, "ledger.campaign.locationPortfolio");
  exactKeys(portfolio, [
    "assignmentStrategy", "locationCount", "portfolioId", "portfolioSha256",
    "portfolioVersion", "requiredBaseZoningCodes"
  ], "ledger.campaign.locationPortfolio");
  if (portfolio.assignmentStrategy !== "balanced_round_robin"
    || portfolio.locationCount !== REQUIRED_BASE_ZONING_CODES.length
    || portfolio.portfolioId !== "cincinnati-base-zoning-address-portfolio"
    || !Number.isSafeInteger(portfolio.portfolioVersion)
    || portfolio.portfolioVersion < 2
    || !SHA256_PATTERN.test(portfolio.portfolioSha256)
    || JSON.stringify(portfolio.requiredBaseZoningCodes)
      !== JSON.stringify(REQUIRED_BASE_ZONING_CODES)) {
    throw new Error("opencounter_discovery_location_portfolio_identity_invalid");
  }
}

function validateZoningPortfolioCampaignLedger(ledger) {
  exactKeys(ledger, [
    "campaign", "catalog", "createdAt", "jobs", "ledgerId", "ledgerSha256",
    "questionGraph", "schemaVersion", "updatedAt"
  ], "ledger");
  if (
    ledger.schemaVersion !== 3
    || !LEDGER_ID_PATTERN.test(ledger.ledgerId)
    || !SHA256_PATTERN.test(ledger.ledgerSha256)
    || ledger.ledgerId !== `ocdl_${ledger.ledgerSha256}`
    || !Array.isArray(ledger.jobs)
    || ledger.jobs.length !== 126
  ) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  timestamp(ledger.createdAt, "ledger.createdAt");
  timestamp(ledger.updatedAt, "ledger.updatedAt");
  if (Date.parse(ledger.updatedAt) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_ledger_time_invalid");
  }
  validateCatalogCampaignIdentity(ledger.catalog);
  validateZoningPortfolioCampaign(ledger.campaign, ledger.jobs.length, ledger.createdAt);
  const jobIds = new Set();
  const entryIds = new Set();
  const fixturesByZone = new Map();
  for (const [index, job] of ledger.jobs.entries()) {
    validateZoningPortfolioCampaignJob(job, index, ledger);
    if (jobIds.has(job.jobId) || entryIds.has(job.catalogEntryId)) {
      throw new Error("opencounter_discovery_duplicate_job");
    }
    const expectedZone = REQUIRED_BASE_ZONING_CODES[index % REQUIRED_BASE_ZONING_CODES.length];
    if (job.locationFixture.expectedBaseZoningCode !== expectedZone) {
      throw new Error("opencounter_discovery_location_assignment_invalid");
    }
    const priorFixture = fixturesByZone.get(expectedZone);
    if (priorFixture !== undefined
      && JSON.stringify(priorFixture) !== JSON.stringify(job.locationFixture)) {
      throw new Error("opencounter_discovery_location_fixture_conflict");
    }
    fixturesByZone.set(expectedZone, job.locationFixture);
    jobIds.add(job.jobId);
    entryIds.add(job.catalogEntryId);
  }
  if (fixturesByZone.size !== REQUIRED_BASE_ZONING_CODES.length
    || new Set([...fixturesByZone.values()].map(({ address }) => address.toLowerCase())).size
      !== REQUIRED_BASE_ZONING_CODES.length
    || new Set([...fixturesByZone.values()].map(({ locationId }) => locationId)).size
      !== REQUIRED_BASE_ZONING_CODES.length
    || new Set([...fixturesByZone.values()].map(({ parcelKey }) => parcelKey)).size
      !== REQUIRED_BASE_ZONING_CODES.length
    || new Set([...fixturesByZone.values()].map(({ rollupId }) => rollupId)).size
      !== REQUIRED_BASE_ZONING_CODES.length) {
    throw new Error("opencounter_discovery_location_portfolio_invalid");
  }
  const expectedLedgerSha256 = createZoningPortfolioDiscoveryLedgerSha256({
    campaign: ledger.campaign,
    catalog: ledger.catalog,
    jobs: ledger.jobs
  });
  if (expectedLedgerSha256 !== ledger.ledgerSha256) {
    throw new Error("opencounter_discovery_ledger_identity_invalid");
  }
  validateQuestionGraph(ledger.questionGraph);
  return structuredClone(ledger);
}

function validateZoningPortfolioCampaign(value, jobCount, createdAt) {
  const campaign = record(value, "ledger.campaign");
  exactKeys(campaign, [
    "authorization", "authorizationRequired", "campaignId", "campaignVersion",
    "leaseDurationSeconds", "locationPortfolio", "maximumProviderConcurrency",
    "plannedRunCount"
  ], "ledger.campaign");
  if (
    campaign.authorizationRequired !== true
    || campaign.campaignId
      !== "all-use-zoning-portfolio-question-discovery-first-pass"
    || campaign.campaignVersion !== 1
    || campaign.maximumProviderConcurrency !== 2
    || campaign.plannedRunCount !== jobCount
    || !Number.isSafeInteger(campaign.leaseDurationSeconds)
    || campaign.leaseDurationSeconds < 60
    || campaign.leaseDurationSeconds > 3_600
  ) {
    throw new Error("opencounter_discovery_campaign_identity_invalid");
  }
  validateCampaignAuthorization(campaign.authorization, jobCount, createdAt);
  const portfolio = record(campaign.locationPortfolio, "ledger.campaign.locationPortfolio");
  exactKeys(portfolio, [
    "assignmentStrategy", "locationCount", "portfolioId", "portfolioSha256",
    "portfolioVersion", "requiredBaseZoningCodes"
  ], "ledger.campaign.locationPortfolio");
  if (
    portfolio.assignmentStrategy !== "balanced_round_robin"
    || portfolio.locationCount !== REQUIRED_BASE_ZONING_CODES.length
    || portfolio.portfolioId !== "cincinnati-base-zoning-address-portfolio"
    || portfolio.portfolioVersion !== 1
    || !SHA256_PATTERN.test(portfolio.portfolioSha256)
    || !Array.isArray(portfolio.requiredBaseZoningCodes)
    || JSON.stringify(portfolio.requiredBaseZoningCodes)
      !== JSON.stringify(REQUIRED_BASE_ZONING_CODES)
  ) {
    throw new Error("opencounter_discovery_location_portfolio_identity_invalid");
  }
}

function validateZoningPortfolioCampaignJob(value, index, ledger) {
  const job = record(value, `ledger.jobs[${index}]`);
  validateCatalogCampaignJobFields(job, index, ledger);
  validateZoningPortfolioLocationFixture(job.locationFixture, index);
  const expectedJobSha256 = createZoningPortfolioDiscoveryJobSha256({
    campaignDefinition: ledger.campaign,
    catalog: ledger.catalog,
    catalogEntryId: job.catalogEntryId,
    locationFixture: job.locationFixture,
    portfolioSha256: ledger.campaign.locationPortfolio.portfolioSha256,
    providerInputSha256: job.providerInputSha256,
    scenario: job.scenario
  });
  if (expectedJobSha256 !== job.jobSha256) {
    throw new Error("opencounter_discovery_job_identity_invalid");
  }
}

function validateCatalogCampaignLedger(ledger) {
  exactKeys(ledger, [
    "campaign", "catalog", "createdAt", "jobs", "ledgerId", "ledgerSha256",
    "questionGraph", "schemaVersion", "updatedAt"
  ], "ledger");
  if (
    ledger.schemaVersion !== 2
    || !LEDGER_ID_PATTERN.test(ledger.ledgerId)
    || !SHA256_PATTERN.test(ledger.ledgerSha256)
    || ledger.ledgerId !== `ocdl_${ledger.ledgerSha256}`
    || !Array.isArray(ledger.jobs)
    || ledger.jobs.length !== 126
  ) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  timestamp(ledger.createdAt, "ledger.createdAt");
  timestamp(ledger.updatedAt, "ledger.updatedAt");
  if (Date.parse(ledger.updatedAt) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_ledger_time_invalid");
  }
  validateCatalogCampaignIdentity(ledger.catalog);
  validateCampaign(ledger.campaign, ledger.jobs.length, ledger.createdAt);
  const jobIds = new Set();
  const entryIds = new Set();
  for (const [index, job] of ledger.jobs.entries()) {
    validateCatalogCampaignJob(job, index, ledger);
    if (jobIds.has(job.jobId) || entryIds.has(job.catalogEntryId)) {
      throw new Error("opencounter_discovery_duplicate_job");
    }
    jobIds.add(job.jobId);
    entryIds.add(job.catalogEntryId);
  }
  const expectedLedgerSha256 = createCatalogDiscoveryLedgerSha256({
    authorization: ledger.campaign.authorization,
    campaign: ledger.campaign,
    catalog: ledger.catalog,
    jobs: ledger.jobs
  });
  if (expectedLedgerSha256 !== ledger.ledgerSha256) {
    throw new Error("opencounter_discovery_ledger_identity_invalid");
  }
  validateQuestionGraph(ledger.questionGraph);
  return structuredClone(ledger);
}

function validateCampaign(value, jobCount, createdAt) {
  const campaign = record(value, "ledger.campaign");
  exactKeys(campaign, [
    "authorization", "authorizationRequired", "campaignId", "campaignVersion",
    "leaseDurationSeconds", "maximumProviderConcurrency", "plannedRunCount"
  ], "ledger.campaign");
  if (
    campaign.authorizationRequired !== true
    || campaign.campaignId !== "all-use-question-discovery-first-pass"
    || campaign.campaignVersion !== 1
    || campaign.maximumProviderConcurrency !== 2
    || campaign.plannedRunCount !== jobCount
    || !Number.isSafeInteger(campaign.leaseDurationSeconds)
    || campaign.leaseDurationSeconds < 60
    || campaign.leaseDurationSeconds > 3_600
  ) {
    throw new Error("opencounter_discovery_campaign_identity_invalid");
  }
  validateCampaignAuthorization(campaign.authorization, jobCount, createdAt);
}

function validateCampaignAuthorization(value, jobCount, createdAt) {
  const authorization = record(value, "ledger.campaign.authorization");
  exactKeys(authorization, [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects"
  ], "ledger.campaign.authorization");
  timestamp(authorization.approvedAt, "ledger.campaign.authorization.approvedAt");
  if (
    Date.parse(authorization.approvedAt) > Date.parse(createdAt)
    || !ID_PATTERN.test(authorization.approvedBy)
    || !ID_PATTERN.test(authorization.authorizationId)
    || authorization.maximumProviderProjects !== jobCount
  ) {
    throw new Error("opencounter_discovery_authorization_invalid");
  }
}

function validateCatalogCampaignJob(value, index, ledger) {
  const job = record(value, `ledger.jobs[${index}]`);
  validateCatalogCampaignJobFields(job, index, ledger);
  validateLocationFixture(job.locationFixture, index);
  const expectedJobSha256 = createCatalogDiscoveryJobSha256({
    campaign: ledger.campaign,
    catalog: ledger.catalog,
    catalogEntryId: job.catalogEntryId,
    locationFixture: job.locationFixture,
    providerInputSha256: job.providerInputSha256,
    scenario: job.scenario
  });
  if (expectedJobSha256 !== job.jobSha256) {
    throw new Error("opencounter_discovery_job_identity_invalid");
  }
}

function validateLocationFixture(value, jobIndex) {
  const fixture = record(value, `ledger.jobs[${jobIndex}].locationFixture`);
  exactKeys(fixture, [
    "address", "evidence", "locationId", "locationVersion"
  ], `ledger.jobs[${jobIndex}].locationFixture`);
  text(fixture.address, 500, "locationFixture.address");
  if (!ID_PATTERN.test(fixture.locationId)
    || !Number.isSafeInteger(fixture.locationVersion)
    || fixture.locationVersion < 1
    || !Array.isArray(fixture.evidence)
    || fixture.evidence.length < 1) {
    throw new Error("opencounter_discovery_location_fixture_invalid");
  }
  validateBoundedArray(fixture.evidence, 50, "location evidence");
}

function validateCatalog(value) {
  const catalog = record(value, "ledger.catalog");
  exactKeys(catalog, [
    "catalogId", "catalogSha256", "tenantId", "tenantVersion"
  ], "ledger.catalog");
  if (
    catalog.catalogId !== "cincinnati-opencounter-zoning-use-catalog-v1"
    || !SHA256_PATTERN.test(catalog.catalogSha256)
    || catalog.tenantId !== 71
    || !Number.isSafeInteger(catalog.tenantVersion)
    || catalog.tenantVersion < 1
  ) {
    throw new Error("opencounter_discovery_catalog_identity_invalid");
  }
}

function validatePilot(value, jobCount, createdAt) {
  const pilot = record(value, "ledger.pilot");
  exactKeys(pilot, [
    "authorization", "authorizationRequired", "leaseDurationSeconds",
    "maximumProviderConcurrency", "pilotId", "pilotVersion", "plannedRunCount"
  ], "ledger.pilot");
  if (
    pilot.authorizationRequired !== true
    || pilot.maximumProviderConcurrency !== 2
    || pilot.plannedRunCount !== jobCount
    || pilot.pilotId !== "permanent-residential-question-discovery"
    || pilot.pilotVersion !== 1
    || !Number.isSafeInteger(pilot.leaseDurationSeconds)
    || pilot.leaseDurationSeconds < 60
    || pilot.leaseDurationSeconds > 3_600
  ) {
    throw new Error("opencounter_discovery_pilot_identity_invalid");
  }
  const authorization = record(pilot.authorization, "ledger.pilot.authorization");
  exactKeys(authorization, [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects"
  ], "ledger.pilot.authorization");
  timestamp(authorization.approvedAt, "ledger.pilot.authorization.approvedAt");
  if (
    Date.parse(authorization.approvedAt) > Date.parse(createdAt)
    || !ID_PATTERN.test(authorization.approvedBy)
    || !ID_PATTERN.test(authorization.authorizationId)
    || authorization.maximumProviderProjects !== jobCount
  ) {
    throw new Error("opencounter_discovery_authorization_invalid");
  }
}

function validateJob(value, index, ledger) {
  const job = record(value, `ledger.jobs[${index}]`);
  exactKeys(job, [
    "answerPath", "answersSupplied", "catalogEntryId", "categoryPath",
    "checkpoint", "createdAt", "errors", "evidence", "jobId", "jobSha256",
    "lease", "nextAction", "observations", "pendingMutation", "propertyProfile",
    "providerReference", "scenario", "status", "terminalResult", "updatedAt"
  ], `ledger.jobs[${index}]`);
  if (
    !JOB_ID_PATTERN.test(job.jobId)
    || !SHA256_PATTERN.test(job.jobSha256)
    || job.jobId !== `ocdj_${job.jobSha256}`
    || !STATUSES.has(job.status)
    || !Array.isArray(job.categoryPath)
    || job.categoryPath.join(" / ") !== "Residential Uses / Permanent residential"
    || !Array.isArray(job.answerPath)
    || !Array.isArray(job.answersSupplied)
    || !Array.isArray(job.errors)
    || !Array.isArray(job.evidence)
    || !Array.isArray(job.observations)
  ) {
    throw new Error("opencounter_discovery_job_invalid");
  }
  timestamp(job.createdAt, `ledger.jobs[${index}].createdAt`);
  timestamp(job.updatedAt, `ledger.jobs[${index}].updatedAt`);
  if (job.createdAt !== ledger.createdAt
    || Date.parse(job.updatedAt) > Date.parse(ledger.updatedAt)) {
    throw new Error("opencounter_discovery_job_time_invalid");
  }
  validateProfile(job.propertyProfile, index);
  validateScenario(job.scenario, index);
  validateLease(job, index);
  validateProviderReference(job.providerReference, index);
  validateNextAction(job, index, ledger.catalog.catalogId);
  validateEvidenceRecords(job.evidence);
  validateBoundedArray(job.errors, 2_000, "errors");
  validateBoundedArray(job.observations, 2_000, "observations");
  validateBoundedArray(job.answerPath, 2_000, "answerPath");
  validateBoundedArray(job.answersSupplied, 2_000, "answersSupplied");
  if (job.pendingMutation !== null) boundedObject(job.pendingMutation, 10_000, "pendingMutation");
  if (job.checkpoint !== null) boundedObject(job.checkpoint, 250_000, "checkpoint");
  if (job.terminalResult !== null) boundedObject(job.terminalResult, 250_000, "terminalResult");
  const expectedJobSha256 = createDiscoveryJobSha256({
    catalog: ledger.catalog,
    job,
    pilot: ledger.pilot
  });
  if (expectedJobSha256 !== job.jobSha256) {
    throw new Error("opencounter_discovery_job_identity_invalid");
  }
}

function validateProfile(value, jobIndex) {
  const profile = record(value, `ledger.jobs[${jobIndex}].propertyProfile`);
  exactKeys(profile, [
    "address", "evidence", "profileId", "profileVersion", "propertyFacts"
  ], `ledger.jobs[${jobIndex}].propertyProfile`);
  text(profile.address, 500, "propertyProfile.address");
  if (!ID_PATTERN.test(profile.profileId)
    || !Number.isSafeInteger(profile.profileVersion)
    || profile.profileVersion < 1
    || !Array.isArray(profile.evidence)
    || profile.evidence.length < 1) {
    throw new Error("opencounter_discovery_property_profile_invalid");
  }
  boundedObject(profile.propertyFacts, 20_000, "propertyFacts");
  validateBoundedArray(profile.evidence, 50, "property evidence");
}
