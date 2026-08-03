import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAXIMUM_CATALOG_BYTES = 512_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const CATALOG_ENTRY_ID_PATTERN =
  /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/;
const PROVIDER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TRIMMED_TEXT_PATTERN = /^(?=\S(?:.*\S)?$)[^\u0000-\u001F\u007F]+$/;

export function loadZoningCatalog(pathOrUrl) {
  const path = pathOrUrl instanceof URL ? fileURLToPath(pathOrUrl) : pathOrUrl;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Zoning catalog must be a regular file.");
  }
  if (metadata.size < 1 || metadata.size > MAXIMUM_CATALOG_BYTES) {
    throw new Error("Zoning catalog file size is invalid.");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Zoning catalog contains invalid JSON.");
  }
  return validateZoningCatalog(value);
}

export function validateZoningCatalog(value) {
  const catalog = record(value, "catalog");
  exactKeys(catalog, [
    "catalogId",
    "catalogSha256",
    "categories",
    "jurisdiction",
    "provider",
    "schemaVersion",
    "workflow"
  ], "catalog");
  if (
    catalog.schemaVersion !== 1
    || catalog.catalogId !== "cincinnati-opencounter-zoning-use-catalog-v1"
    || catalog.jurisdiction !== "cincinnati-oh"
    || catalog.workflow !== "zoning"
    || !SHA256_PATTERN.test(catalog.catalogSha256)
  ) {
    throw new Error("Zoning catalog identity is invalid.");
  }
  validateProvider(catalog.provider);
  const categories = array(catalog.categories, 1, 50, "catalog.categories");
  const categoryIds = new Set();
  const providerCategoryIds = new Set();
  const providerCategorySlugs = new Set();
  const catalogEntryIds = new Set();
  const providerUseSlugs = new Set();
  const entryDisplayOrders = new Set();
  let priorCategoryDisplayOrder = -1;

  for (const [categoryIndex, value_] of categories.entries()) {
    const path = `catalog.categories[${categoryIndex}]`;
    const category = record(value_, path);
    exactKeys(category, [
      "categoryId",
      "displayOrder",
      "entries",
      "groups",
      "label",
      "providerCategoryId",
      "providerCategorySlug"
    ], path);
    const categoryId = serviceId(category.categoryId, `${path}.categoryId`);
    unique(categoryIds, categoryId, "categoryId");
    positiveInteger(category.providerCategoryId, `${path}.providerCategoryId`);
    unique(providerCategoryIds, category.providerCategoryId, "providerCategoryId");
    providerSlug(category.providerCategorySlug, `${path}.providerCategorySlug`);
    unique(
      providerCategorySlugs,
      category.providerCategorySlug,
      "providerCategorySlug"
    );
    text(category.label, 300, `${path}.label`);
    const categoryDisplayOrder = displayOrder(
      category.displayOrder,
      `${path}.displayOrder`
    );
    if (categoryDisplayOrder <= priorCategoryDisplayOrder) {
      throw new Error("Category displayOrder values must be strictly increasing.");
    }
    priorCategoryDisplayOrder = categoryDisplayOrder;

    const entries = array(category.entries, 0, 500, `${path}.entries`);
    const groups = array(category.groups, 0, 50, `${path}.groups`);
    if (entries.length === 0 && groups.length === 0) {
      throw new Error(`${path} must contain an entry or group.`);
    }
    validateEntries(entries, `${path}.entries`, `${categoryId}.`, {
      catalogEntryIds,
      entryDisplayOrders,
      providerUseSlugs
    });

    const groupIds = new Set();
    let priorGroupDisplayOrder = -1;
    for (const [groupIndex, groupValue] of groups.entries()) {
      const groupPath = `${path}.groups[${groupIndex}]`;
      const group = record(groupValue, groupPath);
      exactKeys(group, [
        "displayOrder",
        "entries",
        "groupId",
        "label",
        "providerCategoryId",
        "providerCategorySlug"
      ], groupPath);
      const groupId = serviceId(group.groupId, `${groupPath}.groupId`);
      unique(groupIds, groupId, `groupId within ${categoryId}`);
      positiveInteger(group.providerCategoryId, `${groupPath}.providerCategoryId`);
      unique(providerCategoryIds, group.providerCategoryId, "providerCategoryId");
      providerSlug(group.providerCategorySlug, `${groupPath}.providerCategorySlug`);
      unique(
        providerCategorySlugs,
        group.providerCategorySlug,
        "providerCategorySlug"
      );
      text(group.label, 300, `${groupPath}.label`);
      const groupDisplayOrder = displayOrder(
        group.displayOrder,
        `${groupPath}.displayOrder`
      );
      if (groupDisplayOrder <= priorGroupDisplayOrder) {
        throw new Error(`${path} group displayOrder values must be strictly increasing.`);
      }
      priorGroupDisplayOrder = groupDisplayOrder;
      validateEntries(
        array(group.entries, 1, 500, `${groupPath}.entries`),
        `${groupPath}.entries`,
        `${categoryId}.${groupId}.`,
        { catalogEntryIds, entryDisplayOrders, providerUseSlugs }
      );
    }
  }

  const { catalogSha256: _digest, ...core } = catalog;
  const expected = createHash("sha256").update(canonicalJson(core)).digest("hex");
  if (catalog.catalogSha256 !== expected) {
    throw new Error("catalog.catalogSha256 does not match the canonical core.");
  }
  return structuredClone(catalog);
}

function validateProvider(value) {
  const provider = record(value, "catalog.provider");
  exactKeys(provider, [
    "catalogEndpoint",
    "name",
    "observedAt",
    "origin",
    "responseEtag",
    "responseLastModified",
    "responseSha256",
    "tenantId",
    "tenantSlug",
    "tenantVersion"
  ], "catalog.provider");
  if (
    provider.catalogEndpoint !== "https://opencounter.cincinnati-oh.gov/api/tenants/71"
    || provider.name !== "opencounter"
    || provider.origin !== "https://opencounter.cincinnati-oh.gov"
    || provider.tenantId !== 71
    || provider.tenantSlug !== "cincinnati"
    || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/.test(provider.observedAt)
    || Number.isNaN(Date.parse(provider.observedAt))
    || !/^W\/"[0-9a-f]{32,64}"$/.test(provider.responseEtag)
    || !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(provider.responseLastModified)
    || !SHA256_PATTERN.test(provider.responseSha256)
  ) {
    throw new Error("Zoning catalog provider identity is invalid.");
  }
  positiveInteger(provider.tenantVersion, "catalog.provider.tenantVersion");
}

function validateEntries(values, path, expectedPrefix, identities) {
  let priorDisplayOrder = -1;
  for (const [index, value] of values.entries()) {
    const entryPath = `${path}[${index}]`;
    const entry = record(value, entryPath);
    exactKeys(entry, [
      "catalogEntryId",
      "description",
      "displayOrder",
      "providerLabel",
      "providerUseSlug"
    ], entryPath);
    if (
      typeof entry.catalogEntryId !== "string"
      || entry.catalogEntryId.length > 200
      || !CATALOG_ENTRY_ID_PATTERN.test(entry.catalogEntryId)
      || !entry.catalogEntryId.startsWith(expectedPrefix)
      || entry.catalogEntryId.length === expectedPrefix.length
    ) {
      throw new Error(`${entryPath}.catalogEntryId is invalid.`);
    }
    unique(identities.catalogEntryIds, entry.catalogEntryId, "catalogEntryId");
    providerSlug(entry.providerUseSlug, `${entryPath}.providerUseSlug`);
    unique(identities.providerUseSlugs, entry.providerUseSlug, "providerUseSlug");
    text(entry.providerLabel, 300, `${entryPath}.providerLabel`);
    if (entry.description !== null) {
      text(entry.description, 5_000, `${entryPath}.description`);
    }
    const order = displayOrder(entry.displayOrder, `${entryPath}.displayOrder`);
    if (order <= priorDisplayOrder) {
      throw new Error(`${path} displayOrder values must be strictly increasing.`);
    }
    priorDisplayOrder = order;
    unique(identities.entryDisplayOrders, order, "entry displayOrder");
  }
}

function canonicalJson(value) {
  const json = JSON.stringify(sortJson(value));
  if (Buffer.byteLength(json, "utf8") > MAXIMUM_CATALOG_BYTES) {
    throw new Error("Zoning catalog canonical core is too large.");
  }
  return json;
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function exactKeys(value, expectedKeys, path) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path} must contain exactly: ${expected.join(", ")}.`);
  }
}

function array(value, minimum, maximum, path) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${path} must contain ${minimum} through ${maximum} items.`);
  }
  return value;
}

function serviceId(value, path) {
  if (typeof value !== "string" || value.length > 100 || !SERVICE_ID_PATTERN.test(value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function providerSlug(value, path) {
  if (typeof value !== "string" || value.length > 200 || !PROVIDER_SLUG_PATTERN.test(value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function text(value, maximum, path) {
  if (
    typeof value !== "string"
    || value.length > maximum
    || !TRIMMED_TEXT_PATTERN.test(value)
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}

function displayOrder(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a nonnegative integer.`);
  }
  return value;
}

function unique(set, value, field) {
  if (set.has(value)) throw new Error(`${field} must be unique.`);
  set.add(value);
}
