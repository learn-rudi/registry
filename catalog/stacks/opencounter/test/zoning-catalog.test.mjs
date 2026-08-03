import assert from "node:assert/strict";
import { test } from "node:test";

import {
  loadZoningCatalog,
  validateZoningCatalog
} from "../src/zoning-catalog.mjs";

const catalogUrl = new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
);

test("loads the closed Cincinnati Zoning catalog with its canonical digest", () => {
  const catalog = loadZoningCatalog(catalogUrl);

  assert.equal(catalog.catalogSha256,
    "0fa60c5b7588d51676961de779f2757ed0fb99f58d8cd257ced313a941c26bf0");
  assert.equal(catalog.provider.tenantVersion, 307);
  assert.equal(catalog.categories.reduce(
    (total, category) => total
      + category.entries.length
      + category.groups.reduce(
        (groupTotal, group) => groupTotal + group.entries.length,
        0
      ),
    0
  ), 126);

  const badDigest = structuredClone(catalog);
  badDigest.catalogSha256 = "f".repeat(64);
  assert.throws(() => validateZoningCatalog(badDigest), /catalogSha256/);

  const duplicate = structuredClone(catalog);
  duplicate.categories[0].entries.push({
    ...duplicate.categories[0].entries[0],
    displayOrder: 999
  });
  delete duplicate.catalogSha256;
  assert.throws(() => validateZoningCatalog(duplicate), /exactly|catalogSha256/);
});
