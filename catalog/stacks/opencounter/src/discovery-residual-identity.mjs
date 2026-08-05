import { createHash } from "node:crypto";

export function createZoningPortfolioResidualJobSha256({
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
    portfolioSha256: campaign.locationPortfolio.portfolioSha256,
    providerInputSha256,
    residualOfSha256: sha256(campaign.residualOf),
    scenarioSha256: sha256(scenario),
    tenantVersion: catalog.provider?.tenantVersion ?? catalog.tenantVersion
  });
}

export function createZoningPortfolioResidualLedgerSha256({
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
