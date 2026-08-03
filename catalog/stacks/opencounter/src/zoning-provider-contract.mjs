const ORIGIN = "https://opencounter.cincinnati-oh.gov";

export async function waitForAddressOptions(page, address) {
  const street = address.split(",")[0].trim();
  if (street.length === 0) throw new Error("opencounter_address_invalid");
  await page.waitForFunction((street) => (
    Array.from(document.querySelectorAll("main *"))
      .some((element) => element.children.length === 0
        && element.textContent?.trim().startsWith(`${street},`)
        && element.textContent.includes("Cincinnati, Ohio"))
  ), street, { timeout: 15_000 });
}

export async function verifyZoningUseBeforeProjectMutation(page, input) {
  if (
    !page?.request
    || typeof page.request.get !== "function"
    || typeof input?.proposedUse !== "string"
    || typeof input.providerUseSlug !== "string"
    || !Array.isArray(input.categoryPath)
    || input.categoryPath.length < 1
    || input.categoryPath.length > 2
    || (input.description !== null && typeof input.description !== "string")
  ) {
    throw new Error("opencounter_catalog_contract_invalid");
  }
  const response = await page.request.get(`${ORIGIN}/api/zoning/uses`, {
    headers: { accept: "application/json" },
    params: { "filter[query_string]": input.proposedUse },
    timeout: 15_000
  });
  if (!response.ok()) {
    throw new Error(`opencounter_dependency_failure:${response.status()}`);
  }
  const contentType = response.headers()["content-type"] ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new Error("provider_ui_changed:use_search_content_type");
  }
  const bytes = await response.body();
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > 100_000) {
    throw new Error("provider_ui_changed:use_search_size");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("provider_ui_changed:use_search_json");
  }
  exactProviderKeys(value, ["data"], "use search response");
  if (!Array.isArray(value.data) || value.data.length > 20) {
    throw new Error("provider_ui_changed:use_search_results");
  }
  const results = value.data.map((item, index) =>
    validateProviderUseSearchResult(item, index)
  );
  const exactLabelMatches = results.filter((result) =>
    result.name === input.proposedUse
  );
  if (exactLabelMatches.length > 1) throw new Error("opencounter_use_ambiguous");
  if (exactLabelMatches.length === 0) {
    if (results.some((result) => result.slug === input.providerUseSlug)) {
      throw new Error("provider_ui_changed:use_label");
    }
    throw new Error("opencounter_use_not_found");
  }
  const match = exactLabelMatches[0];
  const expectedFullName = `${input.categoryPath.join(" > ")} > ${input.proposedUse}`;
  if (
    match.slug !== input.providerUseSlug
    || match.fullName !== expectedFullName
    || normalizeProviderDescription(match.description)
      !== normalizeProviderDescription(input.description)
    || match.categoryName !== input.categoryPath[0]
    || match.categoryIds.length !== input.categoryPath.length
  ) {
    throw new Error("provider_ui_changed:use_fingerprint");
  }
}

function validateProviderUseSearchResult(value, index) {
  const path = `use search response.data[${index}]`;
  exactProviderKeys(value, ["attributes", "id"], path);
  if (!Number.isSafeInteger(value.id) || value.id < 1) {
    throw new Error(`provider_ui_changed:${path}.id`);
  }
  const attributes = value.attributes;
  exactProviderKeys(attributes, [
    "category_id",
    "category_ids",
    "category_name",
    "description",
    "featured",
    "full_name",
    "name",
    "reference_url",
    "slug"
  ], `${path}.attributes`);
  if (
    !Number.isSafeInteger(attributes.category_id)
    || attributes.category_id < 1
    || !Array.isArray(attributes.category_ids)
    || attributes.category_ids.length < 1
    || attributes.category_ids.length > 2
    || attributes.category_ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    || attributes.category_id !== attributes.category_ids.at(-1)
    || typeof attributes.category_name !== "string"
    || typeof attributes.full_name !== "string"
    || typeof attributes.name !== "string"
    || typeof attributes.slug !== "string"
    || (attributes.description !== null && typeof attributes.description !== "string")
  ) {
    throw new Error(`provider_ui_changed:${path}.attributes`);
  }
  return {
    categoryIds: attributes.category_ids,
    categoryName: attributes.category_name,
    description: attributes.description,
    fullName: attributes.full_name,
    name: attributes.name,
    slug: attributes.slug
  };
}

function exactProviderKeys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`provider_ui_changed:${path}`);
  }
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])
  ) {
    throw new Error(`provider_ui_changed:${path}`);
  }
}

function normalizeProviderDescription(value) {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

export function providerUseRadioSelector(providerUseSlug) {
  return `input[type="radio"][value="${cssEscape(providerUseSlug)}"]`;
}

export function providerUseLabelMatches(value, proposedUse) {
  return typeof value === "string"
    && value.trim().startsWith(proposedUse);
}
