import { createHash } from "node:crypto";

import {
  createDiscoveryJobSha256,
  createDiscoveryLedgerSha256
} from "./discovery-pilot.mjs";
import {
  createCatalogDiscoveryJobSha256,
  createCatalogDiscoveryLedgerSha256
} from "./discovery-plan.mjs";
import {
  createZoningPortfolioDiscoveryJobSha256,
  createZoningPortfolioDiscoveryLedgerSha256
} from "./discovery-zoning-portfolio.mjs";
import {
  createZoningPortfolioResidualJobSha256,
  createZoningPortfolioResidualLedgerSha256
} from "./discovery-residual-identity.mjs";
import {
  createScenarioBranchJobSha256,
  createScenarioBranchLedgerSha256
} from "./discovery-scenario-wave.mjs";
import {
  boundedObject, exactKeys, record, text, timestamp, validateBoundedArray,
  validateEvidenceRecords, validateProviderReference, validateQuestionGraph
} from "./discovery-schema-helpers.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const JOB_ID_PATTERN = /^ocdj_[0-9a-f]{64}$/;
const LEDGER_ID_PATTERN = /^ocdl_[0-9a-f]{64}$/;
const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const PARCEL_KEY_PATTERN = /^[0-9A-Z]{12}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const REQUIRED_BASE_ZONING_CODES = [
  "SF-20", "SF-10", "SF-6", "SF-4", "SF-2", "RMX", "RM-2.0",
  "RM-1.2", "RM-0.7", "OL", "OG", "CN-P", "CN-M", "CC-P", "CC-M",
  "CC-A", "CG-A", "UM", "DD", "MA", "ML", "MG", "ME", "RF-R",
  "RF-C", "RF-M", "PR", "IR", "T3E", "T3N", "T4N.MF", "T4N.SF",
  "T5F", "T5MS", "T5N.LS", "T5N.SS", "PD"
];
const STATUSES = new Set([
  "active", "completed", "failed", "indeterminate", "needs_input", "queued"
]);

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

function validateScenarioBranchCampaignLedger(ledger) {
  exactKeys(ledger, [
    "campaign", "catalog", "createdAt", "jobs", "ledgerId", "ledgerSha256",
    "questionGraph", "schemaVersion", "updatedAt"
  ], "ledger");
  if (ledger.schemaVersion !== 6
    || !LEDGER_ID_PATTERN.test(ledger.ledgerId)
    || !SHA256_PATTERN.test(ledger.ledgerSha256)
    || ledger.ledgerId !== `ocdl_${ledger.ledgerSha256}`
    || !Array.isArray(ledger.jobs)
    || ledger.jobs.length !== 20) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  timestamp(ledger.createdAt, "ledger.createdAt");
  timestamp(ledger.updatedAt, "ledger.updatedAt");
  if (Date.parse(ledger.updatedAt) < Date.parse(ledger.createdAt)) {
    throw new Error("opencounter_discovery_ledger_time_invalid");
  }
  validateCatalogCampaignIdentity(ledger.catalog);
  validateScenarioBranchCampaign(ledger.campaign, ledger.jobs.length, ledger.createdAt);
  const jobIds = new Set();
  const scenarioIds = new Set();
  for (const [index, job] of ledger.jobs.entries()) {
    validateCatalogCampaignJobFields(job, index, ledger);
    validateZoningPortfolioLocationFixture(job.locationFixture, index);
    validateScenarioBranchJobProvenance(job, ledger.campaign);
    const addressRules = job.scenario.answerRules.filter(({ questionId }) =>
      questionId === "opencounter-address");
    const expectedJobSha256 = createScenarioBranchJobSha256({
      campaign: ledger.campaign,
      catalog: ledger.catalog,
      catalogEntryId: job.catalogEntryId,
      locationFixture: job.locationFixture,
      providerInputSha256: job.providerInputSha256,
      scenario: job.scenario
    });
    if (expectedJobSha256 !== job.jobSha256
      || jobIds.has(job.jobId)
      || scenarioIds.has(job.scenario.scenarioId)
      || addressRules.length !== 0
      || job.scenario.previewSha256
        !== ledger.campaign.sourceObservation.previewSha256) {
      throw new Error("opencounter_discovery_scenario_job_identity_invalid");
    }
    jobIds.add(job.jobId);
    scenarioIds.add(job.scenario.scenarioId);
  }
  const expectedLedgerSha256 = createScenarioBranchLedgerSha256({
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

function validateScenarioBranchJobProvenance(job, campaign) {
  if (job.scenario.sourceObservation.locationFixtureSha256
    !== sha256(job.locationFixture)) {
    throw new Error("opencounter_discovery_scenario_source_invalid");
  }
  for (const rule of job.scenario.answerRules) {
    if (rule.ownership === "proposal_fact" || rule.ownership === "mixed_fact") {
      const expectedDeclarationSha256 = sha256({
        campaignId: campaign.campaignId,
        campaignVersion: campaign.campaignVersion,
        policy: campaign.proposalFactPolicy,
        questionId: rule.questionId,
        questionSignatureSha256: rule.questionSignatureSha256,
        scenarioId: job.scenario.scenarioId,
        scenarioVersion: job.scenario.scenarioVersion,
        value: rule.value
      });
      if (rule.proposalFactDeclaration?.declarationSha256
        !== expectedDeclarationSha256) {
        throw new Error("opencounter_discovery_scenario_proposal_fact_invalid");
      }
    }
    if (rule.ownership !== "site_fact" && rule.ownership !== "mixed_fact") continue;
    const evidence = rule.siteFactEvidence;
    if (evidence.scenarioId !== job.scenario.scenarioId
      || evidence.questionId !== rule.questionId
      || evidence.questionSignatureSha256 !== rule.questionSignatureSha256
      || evidence.value !== rule.value
      || evidence.locationId !== job.locationFixture.locationId
      || evidence.locationVersion !== job.locationFixture.locationVersion
      || evidence.parcelKey !== job.locationFixture.parcelKey
      || evidence.rollupId !== job.locationFixture.rollupId
      || evidence.boundarySha256 !== job.locationFixture.boundarySha256) {
      throw new Error("opencounter_discovery_scenario_site_fact_evidence_invalid");
    }
  }
}

function validateScenarioBranchCampaign(value, jobCount, createdAt) {
  const campaign = record(value, "ledger.campaign");
  exactKeys(campaign, [
    "authorization", "authorizationRequired", "campaignId", "campaignVersion",
    "leaseDurationSeconds", "maximumProviderConcurrency", "plannedRunCount",
    "proposalFactPolicy", "sourceObservation"
  ], "ledger.campaign");
  if (campaign.authorizationRequired !== true
    || campaign.campaignId !== "cincinnati-zoning-scenario-branch-wave-1"
    || campaign.campaignVersion !== 3
    || campaign.leaseDurationSeconds !== 900
    || campaign.maximumProviderConcurrency !== 2
    || campaign.plannedRunCount !== jobCount) {
    throw new Error("opencounter_discovery_scenario_campaign_invalid");
  }
  validateProposalFactPolicy(campaign.proposalFactPolicy);
  const source = record(
    campaign.sourceObservation,
    "ledger.campaign.sourceObservation"
  );
  exactKeys(source, [
    "evidenceSetSha256", "freezeId", "previewSha256"
  ], "ledger.campaign.sourceObservation");
  if (!SHA256_PATTERN.test(source.evidenceSetSha256)
    || !FREEZE_ID_PATTERN.test(source.freezeId)
    || !SHA256_PATTERN.test(source.previewSha256)) {
    throw new Error("opencounter_discovery_scenario_source_invalid");
  }
  validateScenarioCampaignAuthorization(
    campaign.authorization,
    jobCount,
    createdAt,
    source.previewSha256
  );
}

function validateScenarioCampaignAuthorization(
  value,
  jobCount,
  createdAt,
  expectedPreviewSha256
) {
  const authorization = record(value, "ledger.campaign.authorization");
  exactKeys(authorization, [
    "approvedAt", "approvedBy", "authorizationId", "maximumProviderProjects",
    "previewSha256"
  ], "ledger.campaign.authorization");
  timestamp(authorization.approvedAt, "ledger.campaign.authorization.approvedAt");
  if (Date.parse(authorization.approvedAt) > Date.parse(createdAt)
    || !ID_PATTERN.test(authorization.approvedBy)
    || !ID_PATTERN.test(authorization.authorizationId)
    || authorization.maximumProviderProjects !== jobCount
    || authorization.previewSha256 !== expectedPreviewSha256) {
    throw new Error("opencounter_discovery_authorization_invalid");
  }
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

function validateCatalogCampaignIdentity(value) {
  const catalog = record(value, "ledger.catalog");
  exactKeys(catalog, [
    "catalogId", "catalogSha256", "tenantId", "tenantVersion"
  ], "ledger.catalog");
  if (
    catalog.catalogId !== "cincinnati-opencounter-zoning-use-catalog-v1"
    || catalog.catalogSha256 !== "0fa60c5b7588d51676961de779f2757ed0fb99f58d8cd257ced313a941c26bf0"
    || catalog.tenantId !== 71
    || catalog.tenantVersion !== 307
  ) {
    throw new Error("opencounter_discovery_catalog_identity_invalid");
  }
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

function validateCatalogCampaignJobFields(job, index, ledger) {
  exactKeys(job, [
    "answerPath", "answersSupplied", "catalogEntryId", "categoryPath",
    "checkpoint", "createdAt", "errors", "evidence", "jobId", "jobSha256",
    "lease", "locationFixture", "nextAction", "observations", "pendingMutation",
    "providerInputSha256", "providerReference", "scenario", "status",
    "terminalResult", "updatedAt", "verification"
  ], `ledger.jobs[${index}]`);
  if (
    !JOB_ID_PATTERN.test(job.jobId)
    || !SHA256_PATTERN.test(job.jobSha256)
    || job.jobId !== `ocdj_${job.jobSha256}`
    || !SHA256_PATTERN.test(job.providerInputSha256)
    || !STATUSES.has(job.status)
    || !Array.isArray(job.categoryPath)
    || job.categoryPath.length < 1
    || job.categoryPath.length > 2
    || !job.categoryPath.every((segment) => {
      try {
        text(segment, 200, "categoryPath segment");
        return true;
      } catch {
        return false;
      }
    })
    || !Array.isArray(job.answerPath)
    || !Array.isArray(job.answersSupplied)
    || !Array.isArray(job.errors)
    || !Array.isArray(job.evidence)
    || !Array.isArray(job.observations)
  ) {
    throw new Error("opencounter_discovery_job_invalid");
  }
  text(job.catalogEntryId, 200, "catalogEntryId");
  timestamp(job.createdAt, `ledger.jobs[${index}].createdAt`);
  timestamp(job.updatedAt, `ledger.jobs[${index}].updatedAt`);
  if (job.createdAt !== ledger.createdAt
    || Date.parse(job.updatedAt) > Date.parse(ledger.updatedAt)) {
    throw new Error("opencounter_discovery_job_time_invalid");
  }
  validateScenario(job.scenario, index);
  validateLease(job, index);
  validateProviderReference(job.providerReference, index);
  validateCatalogCampaignNextAction(job, index, ledger.catalog.catalogId);
  validateEvidenceRecords(job.evidence);
  validateBoundedArray(job.errors, 2_000, "errors");
  validateBoundedArray(job.observations, 2_000, "observations");
  validateBoundedArray(job.answerPath, 2_000, "answerPath");
  validateBoundedArray(job.answersSupplied, 2_000, "answersSupplied");
  if (job.pendingMutation !== null) boundedObject(job.pendingMutation, 50_000, "pendingMutation");
  if (job.checkpoint !== null) boundedObject(job.checkpoint, 250_000, "checkpoint");
  if (job.terminalResult !== null) boundedObject(job.terminalResult, 250_000, "terminalResult");
  if (job.verification !== null) boundedObject(job.verification, 250_000, "verification");
}

function validateZoningPortfolioLocationFixture(value, jobIndex) {
  const path = `ledger.jobs[${jobIndex}].locationFixture`;
  const fixture = record(value, path);
  exactKeys(fixture, [
    "address", "boundarySha256", "evidence", "expectedBaseZoningCode",
    "locationId", "locationVersion", "municipality", "observedZoningCode",
    "overlayFlags", "parcelKey", "rollupId"
  ], path);
  text(fixture.address, 500, `${path}.address`);
  if (!ID_PATTERN.test(fixture.locationId)
    || !Number.isSafeInteger(fixture.locationVersion)
    || fixture.locationVersion < 1
    || fixture.municipality !== "City of Cincinnati"
    || !SHA256_PATTERN.test(fixture.boundarySha256)
    || !PARCEL_KEY_PATTERN.test(fixture.parcelKey)
    || !UUID_PATTERN.test(fixture.rollupId)
    || !ZONING_CODE_PATTERN.test(fixture.expectedBaseZoningCode)
    || !ZONING_CODE_PATTERN.test(fixture.observedZoningCode)
    || (fixture.observedZoningCode !== fixture.expectedBaseZoningCode
      && !fixture.observedZoningCode.startsWith(
        `${fixture.expectedBaseZoningCode}-`
      ))
    || !Array.isArray(fixture.overlayFlags)
    || fixture.overlayFlags.length > 50
    || new Set(fixture.overlayFlags).size !== fixture.overlayFlags.length
    || !fixture.overlayFlags.every((flag) => ID_PATTERN.test(flag))
    || !Array.isArray(fixture.evidence)
    || fixture.evidence.length < 1
    || fixture.evidence.length > 50) {
    throw new Error("opencounter_discovery_location_fixture_invalid");
  }
  for (const [evidenceIndex, value_] of fixture.evidence.entries()) {
    const evidencePath = `${path}.evidence[${evidenceIndex}]`;
    const evidence = record(value_, evidencePath);
    exactKeys(evidence, ["evidenceRef", "observedAt", "source"], evidencePath);
    text(evidence.evidenceRef, 200, `${evidencePath}.evidenceRef`);
    timestamp(evidence.observedAt, `${evidencePath}.observedAt`);
    text(evidence.source, 2_000, `${evidencePath}.source`);
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

function validateCatalogCampaignNextAction(job, index, catalogId) {
  if (job.nextAction === null) return;
  const action = record(job.nextAction, `ledger.jobs[${index}].nextAction`);
  if (action.kind === "start") {
    exactKeys(action, ["input", "kind"], "nextAction");
    const input = record(action.input, "nextAction.input");
    exactKeys(input, [
      "address", "catalogEntryId", "catalogId", "jurisdiction", "schemaVersion"
    ], "nextAction.input");
    if (input.address !== job.locationFixture.address
      || input.catalogEntryId !== job.catalogEntryId
      || input.catalogId !== catalogId
      || input.jurisdiction !== "cincinnati-oh"
      || input.schemaVersion !== 1) {
      throw new Error("opencounter_discovery_start_action_invalid");
    }
    return;
  }
  if (action.kind === "reconcile_start") {
    exactKeys(action, [
      "input", "kind", "uncertainDispatchId"
    ], "nextAction");
    const input = record(action.input, "nextAction.input");
    exactKeys(input, [
      "address", "catalogEntryId", "catalogId", "jurisdiction",
      "providerInputSha256", "providerReference", "schemaVersion"
    ], "nextAction.input");
    if (input.address !== job.locationFixture.address
      || input.catalogEntryId !== job.catalogEntryId
      || input.catalogId !== catalogId
      || input.jurisdiction !== "cincinnati-oh"
      || input.providerInputSha256 !== job.providerInputSha256
      || input.providerReference !== job.providerReference
      || input.schemaVersion !== 1
      || typeof action.uncertainDispatchId !== "string"
      || action.uncertainDispatchId.length > 100) {
      throw new Error("opencounter_discovery_start_reconciliation_action_invalid");
    }
    return;
  }
  if (action.kind === "reconcile") {
    exactKeys(action, [
      "input", "kind", "uncertainAction", "uncertainDispatchId"
    ], "nextAction");
    const input = record(action.input, "nextAction.input");
    exactKeys(input, ["providerReference"], "nextAction.input");
    const uncertainAction = record(action.uncertainAction, "nextAction.uncertainAction");
    if (input.providerReference !== job.providerReference
      || uncertainAction.kind !== "continue"
      || typeof action.uncertainDispatchId !== "string"
      || action.uncertainDispatchId.length > 100) {
      throw new Error("opencounter_discovery_reconciliation_action_invalid");
    }
    boundedObject(uncertainAction, 50_000, "nextAction.uncertainAction");
    return;
  }
  validateNextAction(job, index, catalogId);
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

function validateScenario(value, jobIndex) {
  const scenario = record(value, `ledger.jobs[${jobIndex}].scenario`);
  if (scenario.scenarioVersion >= 2 && scenario.scenarioVersion <= 3) {
    exactKeys(scenario, [
      "answerRules", "previewSha256", "scenarioId", "scenarioVersion",
      "sourceObservation"
    ], `ledger.jobs[${jobIndex}].scenario`);
    if (!ID_PATTERN.test(scenario.scenarioId)
      || !SHA256_PATTERN.test(scenario.previewSha256)
      || !Array.isArray(scenario.answerRules)
      || scenario.answerRules.length < 1
      || scenario.answerRules.length > 100) {
      throw new Error("opencounter_discovery_scenario_invalid");
    }
    const source = record(
      scenario.sourceObservation,
      `ledger.jobs[${jobIndex}].scenario.sourceObservation`
    );
    exactKeys(source, [
      "checkpointSha256", "jobId", "ledgerSnapshotSha256",
      "locationFixtureSha256"
    ], `ledger.jobs[${jobIndex}].scenario.sourceObservation`);
    if (!SHA256_PATTERN.test(source.checkpointSha256)
      || !JOB_ID_PATTERN.test(source.jobId)
      || !SHA256_PATTERN.test(source.ledgerSnapshotSha256)
      || !SHA256_PATTERN.test(source.locationFixtureSha256)) {
      throw new Error("opencounter_discovery_scenario_source_invalid");
    }
    const questionIds = new Set();
    for (const [ruleIndex, value_] of scenario.answerRules.entries()) {
      const rulePath =
        `ledger.jobs[${jobIndex}].scenario.answerRules[${ruleIndex}]`;
      const rule = record(value_, rulePath);
      const siteFact = rule.ownership === "site_fact"
        || rule.ownership === "mixed_fact";
      const proposalFact = rule.ownership === "proposal_fact"
        || rule.ownership === "mixed_fact";
      exactKeys(rule, [
        "ownership", "questionId", "questionKey", "questionSignatureSha256",
        ...(proposalFact ? ["proposalFactDeclaration"] : []),
        ...(siteFact ? ["siteFactEvidence"] : []), "value"
      ], rulePath);
      text(rule.questionId, 100, `${rulePath}.questionId`);
      text(rule.value, 2_000, `${rulePath}.value`);
      if ((rule.ownership !== "proposal_fact" && !siteFact)
        || !/^ocq_[0-9a-f]{64}$/.test(rule.questionKey)
        || !SHA256_PATTERN.test(rule.questionSignatureSha256)
        || rule.questionId === "opencounter-address"
        || questionIds.has(rule.questionId)) {
        throw new Error("opencounter_discovery_scenario_rule_invalid");
      }
      questionIds.add(rule.questionId);
      if (proposalFact) validateProposalFactDeclaration(
        rule.proposalFactDeclaration,
        rulePath
      );
      if (siteFact) validateScenarioSiteFactEvidence(rule.siteFactEvidence, rulePath);
    }
    return;
  }
  exactKeys(scenario, [
    "answerRules", "assumptions", "scenarioId", "scenarioVersion"
  ], `ledger.jobs[${jobIndex}].scenario`);
  if (!ID_PATTERN.test(scenario.scenarioId)
    || scenario.scenarioVersion !== 1
    || !Array.isArray(scenario.answerRules)
    || scenario.answerRules.length > 100) {
    throw new Error("opencounter_discovery_scenario_invalid");
  }
  boundedObject(scenario.assumptions, 10_000, "scenario assumptions");
  validateBoundedArray(scenario.answerRules, 100, "scenario answer rules");
}

function validateProposalFactPolicy(value) {
  const policy = record(value, "proposalFactPolicy");
  exactKeys(policy, [
    "appliesToOwnership", "kind", "notRealProjectFacts", "schemaVersion"
  ], "proposalFactPolicy");
  if (JSON.stringify(policy.appliesToOwnership)
      !== JSON.stringify(["mixed_fact", "proposal_fact"])
    || policy.kind !== "explicitly_synthetic_coverage_scenario"
    || policy.notRealProjectFacts !== true
    || policy.schemaVersion !== 1) {
    throw new Error("opencounter_discovery_scenario_proposal_fact_policy_invalid");
  }
}

function validateProposalFactDeclaration(value, rulePath) {
  const path = `${rulePath}.proposalFactDeclaration`;
  const declaration = record(value, path);
  exactKeys(declaration, [
    "declarationSha256", "kind", "notRealProjectFact"
  ], path);
  if (!SHA256_PATTERN.test(declaration.declarationSha256)
    || declaration.kind !== "explicitly_synthetic_coverage_fact"
    || declaration.notRealProjectFact !== true) {
    throw new Error("opencounter_discovery_scenario_proposal_fact_invalid");
  }
}

function validateScenarioSiteFactEvidence(value, rulePath) {
  const path = `${rulePath}.siteFactEvidence`;
  const evidence = record(value, path);
  exactKeys(evidence, [
    "boundarySha256", "evidenceArtifactSha256", "evidenceRef", "locationId",
    "locationVersion", "observedAt", "parcelKey", "questionId",
    "questionSignatureSha256", "rollupId", "scenarioId", "source", "value"
  ], path);
  if (!SHA256_PATTERN.test(evidence.boundarySha256)
    || !SHA256_PATTERN.test(evidence.evidenceArtifactSha256)
    || !ID_PATTERN.test(evidence.locationId)
    || !Number.isSafeInteger(evidence.locationVersion)
    || evidence.locationVersion < 1
    || !PARCEL_KEY_PATTERN.test(evidence.parcelKey)
    || !SHA256_PATTERN.test(evidence.questionSignatureSha256)
    || !UUID_PATTERN.test(evidence.rollupId)
    || !ID_PATTERN.test(evidence.scenarioId)) {
    throw new Error("opencounter_discovery_scenario_site_fact_evidence_invalid");
  }
  text(evidence.evidenceRef, 500, `${path}.evidenceRef`);
  text(evidence.questionId, 100, `${path}.questionId`);
  text(evidence.source, 2_000, `${path}.source`);
  text(evidence.value, 2_000, `${path}.value`);
  timestamp(evidence.observedAt, `${path}.observedAt`);
}

function validateLease(job, index) {
  if (job.status === "active" && job.lease === null) {
    throw new Error("opencounter_discovery_active_lease_missing");
  }
  if (job.status !== "active" && job.lease !== null) {
    throw new Error("opencounter_discovery_inactive_lease_present");
  }
  if (job.lease === null) return;
  const lease = record(job.lease, `ledger.jobs[${index}].lease`);
  exactKeys(lease, [
    "expiresAt", "leaseToken", "leasedAt", "workerId"
  ], `ledger.jobs[${index}].lease`);
  timestamp(lease.leasedAt, "lease.leasedAt");
  timestamp(lease.expiresAt, "lease.expiresAt");
  if (!ID_PATTERN.test(lease.workerId)
    || typeof lease.leaseToken !== "string"
    || lease.leaseToken.length > 100
    || Date.parse(lease.expiresAt) <= Date.parse(lease.leasedAt)) {
    throw new Error("opencounter_discovery_lease_invalid");
  }
}

function validateNextAction(job, index, catalogId) {
  if (job.nextAction === null) return;
  const action = record(job.nextAction, `ledger.jobs[${index}].nextAction`);
  if (action.kind === "start") {
    exactKeys(action, ["input", "kind"], "nextAction");
    const input = record(action.input, "nextAction.input");
    exactKeys(input, [
      "address", "catalogEntryId", "catalogId", "jurisdiction", "schemaVersion"
    ], "nextAction.input");
    if (input.address !== job.propertyProfile.address
      || input.catalogEntryId !== job.catalogEntryId
      || input.catalogId !== catalogId
      || input.jurisdiction !== "cincinnati-oh"
      || input.schemaVersion !== 1) {
      throw new Error("opencounter_discovery_start_action_invalid");
    }
    return;
  }
  if (action.kind === "continue") {
    exactKeys(action, ["answerBasis", "input", "kind"], "nextAction");
    boundedObject(action.answerBasis, 10_000, "answerBasis");
    boundedObject(action.input, 50_000, "nextAction.input");
    return;
  }
  if (action.kind === "reconcile") {
    exactKeys(action, [
      "input", "kind", "uncertainDispatchId"
    ], "nextAction");
    const input = record(action.input, "nextAction.input");
    exactKeys(input, ["providerReference"], "nextAction.input");
    if (input.providerReference !== job.providerReference
      || typeof action.uncertainDispatchId !== "string"
      || action.uncertainDispatchId.length > 100) {
      throw new Error("opencounter_discovery_reconciliation_action_invalid");
    }
    return;
  }
  throw new Error("opencounter_discovery_next_action_invalid");
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
