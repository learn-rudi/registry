import { createHash } from "node:crypto";

export function createScenarioWaveResidualJobSha256({
  campaign,
  catalog,
  job,
  sourceJob
}) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogEntryId: job.catalogEntryId,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    locationFixtureSha256: sha256(job.locationFixture),
    providerInputSha256: job.providerInputSha256,
    residualPreviewSha256: campaign.authorization.previewSha256,
    scenarioSha256: sha256(job.scenario),
    sourceJobId: sourceJob.jobId,
    sourceJobSha256: sourceJob.jobSha256,
    sourceLedgerSnapshotSha256:
      campaign.residualOf.sourceLedgerSnapshotSha256,
    tenantVersion: catalog.tenantVersion
  });
}

export function createScenarioWaveResidualLedgerSha256({ campaign, catalog, jobs }) {
  return sha256({
    campaignId: campaign.campaignId,
    campaignVersion: campaign.campaignVersion,
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jobs: jobs.map(({ jobSha256 }) => jobSha256),
    providerVolumeAuthorization: campaign.authorization,
    residualOf: campaign.residualOf,
    sourceObservation: campaign.sourceObservation,
    tenantVersion: catalog.tenantVersion
  });
}

export function createScenarioWaveResidualSnapshotSha256(value) {
  return sha256(value);
}

export function createScenarioWaveDriftPacketSha256(value) {
  return sha256(value);
}

export function createScenarioWaveAdjudicationSha256(value) {
  return sha256(value);
}

export function createScenarioWaveAdjudicationPreviewSha256(value) {
  return sha256(value);
}

export function createScenarioWaveAdjudicationResolutionSha256(value) {
  return sha256(value);
}

export function createScenarioWaveCompletionClaimSha256(value) {
  return sha256(value);
}

export function createScenarioWaveFenceSha256(value) {
  return sha256(value);
}

export function createScenarioWaveResidualValueSha256(value) {
  return sha256(value);
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
