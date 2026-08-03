import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const MUNICODE_LIBRARY_ORIGIN = "https://library.municode.com";
const MUNICODE_API_ORIGIN = `${MUNICODE_LIBRARY_ORIGIN}/api`;
const MUNICODE_PDF_ORIGIN = "https://mcclibrary.blob.core.usgovcloudapi.net";
const MAX_JSON_BYTES = 5_000_000;
const MAX_REVIEWED_LISTING_METADATA_BYTES = 500_000;
const MAX_PDF_BYTES = 25_000_000;
const MAX_SECTION_TEXT_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 30_000;
const REVIEWED_BUNDLE_DISCLAIMER =
  "This reviewed baseline zoning-code evidence bundle is source evidence only. It is not legal advice and does not determine legal completeness, applicability, approval, or permitting.";
const execFileAsync = promisify(execFile);

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  deg: "°",
  frac12: "½",
  gt: ">",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  plusmn: "±",
  quot: '"',
  times: "×"
});

// Each profile fixes the provider product identity; callers never supply IDs or origins.
const JURISDICTION_PROFILES = Object.freeze({
  "cincinnati-oh": Object.freeze({
    clientId: 1650,
    jurisdiction: "cincinnati-oh",
    libraryPath: "/oh/cincinnati/codes/code_of_ordinances",
    municipality: "Cincinnati, Ohio",
    productId: 19996
  })
});

export class MunicodeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "MunicodeError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

export function createMunicodeClient({
  extractPdfText = extractPdfTextWithPdftotext,
  fetchImpl = fetch,
  now = () => new Date(),
  reviewedZoningEvidenceRelease
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new MunicodeError("invalid_configuration", "fetchImpl must be a function.");
  }
  if (typeof now !== "function") {
    throw new MunicodeError("invalid_configuration", "now must be a function.");
  }
  if (typeof extractPdfText !== "function") {
    throw new MunicodeError("invalid_configuration", "extractPdfText must be a function.");
  }
  const reviewedRelease = reviewedZoningEvidenceRelease === undefined
    ? null
    : validateReviewedRelease(reviewedZoningEvidenceRelease);

  async function resolvePublication(profile) {
    const jobs = await fetchJson(
      fetchImpl,
      `${MUNICODE_API_ORIGIN}/Jobs/product/${profile.productId}`
    );
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new MunicodeError(
        "invalid_provider_response",
        "Municode returned no publication records."
      );
    }
    const latest = jobs.find((job) => job?.IsLatest === true)
      ?? [...jobs].sort((left, right) => Number(right?.Id ?? 0) - Number(left?.Id ?? 0))[0];
    return {
      clientId: profile.clientId,
      isLatest: latest?.IsLatest === true,
      jobId: requirePositiveInteger(latest?.Id, "publication job ID"),
      name: requireBoundedText(latest?.Name, "publication name", 500),
      productId: profile.productId
    };
  }

  return {
    getReviewedZoningEvidenceReadiness() {
      if (reviewedRelease === null) {
        return {
          productionReady: false,
          reason: "reviewed_release_not_configured"
        };
      }
      const lineage = reviewedReleaseLineage(reviewedRelease);
      if (reviewedRelease.snapshot.attestation.kind !== "planning_domain") {
        return {
          productionReady: false,
          reason: "planning_domain_attestation_required",
          ...lineage
        };
      }
      return {
        productionReady: true,
        reason: "ready",
        ...lineage
      };
    },

    async getReviewedZoningEvidenceBundle(input) {
      try {
        if (reviewedRelease === null) {
          throw new MunicodeError(
            "selection_not_supported",
            "No reviewed zoning evidence release is configured."
          );
        }
        const request = validateReviewedBundleInput(input);
        const { selectorPolicy, snapshot, snapshotSha256 } = reviewedRelease;
        if (
          request.operationInput.selectorPolicyId !== snapshot.selectorPolicyId
          || request.operationInput.selectorPolicyId
            !== selectorPolicy.selectorPolicyId
        ) {
          throw new MunicodeError(
            "selector_drift",
            "The requested selector policy does not match the accepted release."
          );
        }
        const selection = snapshot.selections.find((candidate) =>
          candidate.zoningCode === request.cagisContext.zoningCode
          && arraysEqual(
            candidate.zoningOverlayDistrictNames,
            request.cagisContext.zoningOverlayDistrictNames
          )
          && candidate.proposedUseCategory
            === request.operationInput.proposedUseCategory
        );
        if (selection === undefined) {
          throw new MunicodeError(
            "selection_not_supported",
            "The complete CAGIS zoning context and proposed-use category have no accepted reviewed bundle."
          );
        }

        const publication = {
          clientId: snapshot.clientId,
          isLatest: snapshot.isLatest,
          jobId: snapshot.jobId,
          name: snapshot.publicationName,
          productId: snapshot.productId
        };
        let listingMetadataBytes = 0;
        for (const parent of snapshot.parents) {
          const payload = await fetchFixedJobChildren(
            fetchImpl,
            publication,
            parent.nodeId
          );
          listingMetadataBytes += Buffer.byteLength(
            JSON.stringify(payload),
            "utf8"
          );
          if (listingMetadataBytes > MAX_REVIEWED_LISTING_METADATA_BYTES) {
            throw new MunicodeError(
              "provider_response_too_large",
              "Municode reviewed inventory metadata exceeds the size limit."
            );
          }
          const observedChildren = validateObservedChildren(payload);
          if (!arraysEqualByJson(observedChildren, parent.children)) {
            throw new MunicodeError(
              "publication_drift",
              "Municode reviewed inventory does not match the accepted snapshot."
            );
          }
        }

        const reasonByNodeId = new Map(
          selectorPolicy.sectionReasons.map((entry) => [
            entry.nodeId,
            entry.reasonCode
          ])
        );
        const profile = JURISDICTION_PROFILES[snapshot.jurisdiction];
        const sections = [];
        for (const nodeId of selection.sectionNodeIds) {
          const selected = await getFixedJobCodeSection({
            extractPdfText,
            fetchImpl,
            nodeId,
            profile,
            publication
          });
          const reasonCode = reasonByNodeId.get(nodeId);
          if (reasonCode === undefined) {
            throw new MunicodeError(
              "selector_drift",
              "The accepted policy omits a selected section reason."
            );
          }
          const retainedContent = selected.text.length <= 20_000
            ? {
                contentForm: "text",
                text: selected.text
              }
            : {
                contentForm: "excerpt",
                excerpt: selected.text.slice(0, 20_000)
              };
          sections.push({
            applicableDate: "not_reported",
            ...retainedContent,
            contentSha256: selected.contentSha256,
            nodeId,
            reasonCode,
            retrievedAt: requireTimestamp(now()),
            sourceUrl: libraryUrl(profile, nodeId),
            title: selected.title
          });
        }

        return {
          disclaimer: REVIEWED_BUNDLE_DISCLAIMER,
          jurisdiction: snapshot.jurisdiction,
          mappingContext: {
            zoningCode: request.cagisContext.zoningCode,
            zoningContextSha256: sha256(JSON.stringify(request.cagisContext)),
            zoningOverlayDistrictNames:
              request.cagisContext.zoningOverlayDistrictNames
          },
          publication,
          retrievedAt: requireTimestamp(now()),
          schemaVersion: 1,
          sections,
          selection: {
            selectorPolicyId: snapshot.selectorPolicyId,
            selectorPolicySha256: snapshot.selectorPolicySha256,
            snapshotId: snapshot.snapshotId,
            snapshotSha256
          },
          source: "municode",
          status: "succeeded"
        };
      } catch (error) {
        return reviewedBundleFailure(error);
      }
    },

    async getPublication(input) {
      const profile = requireProfileInput(input, ["jurisdiction"]);
      const publication = await resolvePublication(profile);

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile)
      });
    },

    async getCodeSection(input) {
      const profile = requireProfileInput(input, ["jurisdiction", "nodeId"]);
      const nodeId = requireNodeId(input.nodeId, "nodeId");
      const publication = await resolvePublication(profile);
      const url = new URL("/api/CodesContent", MUNICODE_LIBRARY_ORIGIN);
      url.searchParams.set("productId", String(publication.productId));
      url.searchParams.set("jobId", String(publication.jobId));
      url.searchParams.set("nodeId", nodeId);
      const payload = await fetchJson(fetchImpl, url);
      const docs = selectCodeDocuments(payload, nodeId);
      const htmlDocs = docs.filter((doc) => typeof doc?.Content === "string");
      const primaryDoc = docs.find((doc) => doc?.Id === nodeId) ?? docs[0];
      let contentFormat = "text";
      let documentUrl;
      let text;
      if (htmlDocs.length > 0) {
        text = htmlDocs
          .map((doc) => htmlToText(doc.Content))
          .filter(Boolean)
          .join("\n\n")
          .trim();
      } else if (primaryDoc?.DocType === 2) {
        contentFormat = "pdf_text";
        documentUrl = pdfUrl(publication, nodeId);
        const pdfBytes = await fetchPdf(fetchImpl, documentUrl);
        let extracted;
        try {
          extracted = await extractPdfText(pdfBytes, {
            documentUrl,
            jurisdiction: profile.jurisdiction,
            jobId: publication.jobId,
            nodeId,
            productId: publication.productId
          });
        } catch (error) {
          if (error instanceof MunicodeError) throw error;
          throw new MunicodeError(
            "pdf_extraction_failed",
            "Municode PDF text extraction failed.",
            { cause: error }
          );
        }
        if (typeof extracted !== "string") {
          throw new MunicodeError(
            "pdf_extraction_failed",
            "Municode PDF text extraction returned invalid text."
          );
        }
        text = normalizeText(extracted);
      } else {
        throw new MunicodeError(
          "unsupported_content_type",
          "The requested Municode section has an unsupported content type."
        );
      }
      if (text.length === 0) {
        throw new MunicodeError(
          "invalid_provider_response",
          "Municode returned an empty code section."
        );
      }
      if (text.length > MAX_SECTION_TEXT_CHARS) {
        throw new MunicodeError(
          "provider_response_too_large",
          "Municode section text exceeds the size limit."
        );
      }

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile, nodeId),
        values: {
          section: {
            contentFormat,
            contentSha256: sha256(text),
            ...(documentUrl === undefined ? {} : { documentUrl }),
            nodeId,
            text,
            title: requireBoundedText(primaryDoc?.Title, "provider section title", 1_000)
          }
        }
      });
    },

    async listCodeSections(input) {
      const profile = requireProfileInput(input, [
        "cursor",
        "jurisdiction",
        "limit",
        "parentNodeId"
      ]);
      const parentNodeId = requireNodeId(input.parentNodeId);
      const limit = optionalPageLimit(input.limit);
      const cursor = optionalCursor(input.cursor);
      const publication = await resolvePublication(profile);
      const url = new URL("/api/codesToc/children", MUNICODE_LIBRARY_ORIGIN);
      url.searchParams.set("productId", String(publication.productId));
      url.searchParams.set("jobId", String(publication.jobId));
      url.searchParams.set("nodeId", parentNodeId);
      const payload = await fetchJson(fetchImpl, url);
      if (!Array.isArray(payload)) {
        throw new MunicodeError(
          "invalid_provider_response",
          "Municode returned an invalid code-section collection."
        );
      }
      const sections = payload.map((entry) => ({
        hasChildren: entry?.HasChildren === true,
        nodeId: requireNodeId(entry?.Id, "provider node ID"),
        sourceUrl: libraryUrl(profile, requireNodeId(entry?.Id, "provider node ID")),
        title: requireBoundedText(entry?.Heading, "provider section title", 1_000)
      }));
      const start = cursor === null ? 0 : cursor;
      const pageSections = sections.slice(start, start + limit);
      const nextOffset = start + pageSections.length;

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile, parentNodeId),
        values: {
          page: {
            cursor: cursor === null ? null : String(cursor),
            limit,
            nextCursor: nextOffset < sections.length ? String(nextOffset) : null
          },
          parentNodeId,
          sections: pageSections
        }
      });
    }
  };
}

async function fetchFixedJobChildren(fetchImpl, publication, parentNodeId) {
  const url = new URL("/api/codesToc/children", MUNICODE_LIBRARY_ORIGIN);
  url.searchParams.set("productId", String(publication.productId));
  url.searchParams.set("jobId", String(publication.jobId));
  url.searchParams.set("nodeId", parentNodeId);
  return fetchJson(fetchImpl, url);
}

async function getFixedJobCodeSection({
  extractPdfText,
  fetchImpl,
  nodeId,
  profile,
  publication
}) {
  const url = new URL("/api/CodesContent", MUNICODE_LIBRARY_ORIGIN);
  url.searchParams.set("productId", String(publication.productId));
  url.searchParams.set("jobId", String(publication.jobId));
  url.searchParams.set("nodeId", nodeId);
  const payload = await fetchJson(fetchImpl, url);
  const docs = selectCodeDocuments(payload, nodeId);
  const htmlDocs = docs.filter((doc) => typeof doc?.Content === "string");
  const primaryDoc = docs.find((doc) => doc?.Id === nodeId) ?? docs[0];
  let text;
  if (htmlDocs.length > 0) {
    text = htmlDocs
      .map((doc) => htmlToText(doc.Content))
      .filter(Boolean)
      .join("\n\n")
      .trim();
  } else if (primaryDoc?.DocType === 2) {
    const documentUrl = pdfUrl(publication, nodeId);
    const pdfBytes = await fetchPdf(fetchImpl, documentUrl);
    let extracted;
    try {
      extracted = await extractPdfText(pdfBytes, {
        documentUrl,
        jurisdiction: profile.jurisdiction,
        jobId: publication.jobId,
        nodeId,
        productId: publication.productId
      });
    } catch (error) {
      if (error instanceof MunicodeError) throw error;
      throw new MunicodeError(
        "invalid_provider_response",
        "Municode PDF text extraction failed.",
        { cause: error }
      );
    }
    if (typeof extracted !== "string") {
      throw new MunicodeError(
        "invalid_provider_response",
        "Municode PDF text extraction returned invalid text."
      );
    }
    text = normalizeText(extracted);
  } else {
    throw new MunicodeError(
      "unsupported_content_type",
      "The selected Municode section has an unsupported content type."
    );
  }
  if (text.length === 0) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned an empty selected code section."
    );
  }
  if (text.length > MAX_SECTION_TEXT_CHARS) {
    throw new MunicodeError(
      "provider_response_too_large",
      "Municode selected section text exceeds the size limit."
    );
  }
  return {
    contentSha256: sha256(text),
    text,
    title: requireBoundedText(
      primaryDoc?.Title,
      "provider section title",
      1_000
    )
  };
}

function validateReviewedRelease(value) {
  const release = requireConfigRecord(value, "reviewed release");
  requireExactConfigKeys(
    release,
    ["selectorPolicy", "snapshot", "snapshotSha256"],
    "reviewed release"
  );
  const selectorPolicy = validateSelectorPolicy(release.selectorPolicy);
  const selectorPolicySha256 = sha256(JSON.stringify(selectorPolicy));
  const snapshot = validateAcceptedSnapshot(release.snapshot);
  const snapshotSha256 = requireSha256Config(
    release.snapshotSha256,
    "snapshotSha256"
  );
  if (snapshotSha256 !== sha256(JSON.stringify(snapshot))) {
    throw new MunicodeError(
      "invalid_configuration",
      "The reviewed snapshot digest does not match its bytes."
    );
  }
  if (
    snapshot.selectorPolicyId !== selectorPolicy.selectorPolicyId
    || snapshot.selectorPolicySha256 !== selectorPolicySha256
  ) {
    throw new MunicodeError(
      "invalid_configuration",
      "The reviewed selector policy does not match the accepted snapshot."
    );
  }
  const inventoryNodeIds = new Set(
    snapshot.parents.flatMap((parent) =>
      parent.children.map((child) => child.nodeId)
    )
  );
  const policyNodeIds = new Set(
    selectorPolicy.sectionReasons.map((entry) => entry.nodeId)
  );
  for (const selection of snapshot.selections) {
    for (const nodeId of selection.sectionNodeIds) {
      if (!inventoryNodeIds.has(nodeId) || !policyNodeIds.has(nodeId)) {
        throw new MunicodeError(
          "invalid_configuration",
          "A reviewed selection references an unbound section node."
        );
      }
    }
  }
  return Object.freeze({ selectorPolicy, snapshot, snapshotSha256 });
}

function validateSelectorPolicy(value) {
  const policy = requireConfigRecord(value, "selector policy");
  requireExactConfigKeys(
    policy,
    ["schemaVersion", "sectionReasons", "selectorPolicyId"],
    "selector policy"
  );
  if (policy.schemaVersion !== 1) {
    throw new MunicodeError(
      "invalid_configuration",
      "The selector policy schemaVersion must be 1."
    );
  }
  const selectorPolicyId = requireConfigText(
    policy.selectorPolicyId,
    "selectorPolicyId",
    200
  );
  if (
    !Array.isArray(policy.sectionReasons)
    || policy.sectionReasons.length < 4
    || policy.sectionReasons.length > 400
  ) {
    throw new MunicodeError(
      "invalid_configuration",
      "The selector policy sectionReasons collection is invalid."
    );
  }
  const supportedReasons = new Set([
    "use_definition",
    "base_district_use_table",
    "use_specific_condition",
    "parking_and_loading",
    "overlay_condition",
    "reviewed_cross_reference"
  ]);
  const sectionReasons = policy.sectionReasons.map((value, index) => {
    const entry = requireConfigRecord(
      value,
      `selector policy sectionReasons[${index}]`
    );
    requireExactConfigKeys(
      entry,
      ["nodeId", "reasonCode"],
      `selector policy sectionReasons[${index}]`
    );
    const nodeId = requireProviderNodeIdConfig(entry.nodeId, "policy nodeId");
    if (!supportedReasons.has(entry.reasonCode)) {
      throw new MunicodeError(
        "invalid_configuration",
        "The selector policy reasonCode is unsupported."
      );
    }
    return { nodeId, reasonCode: entry.reasonCode };
  });
  assertUnique(
    sectionReasons.map((entry) => entry.nodeId),
    "selector policy node IDs"
  );
  return { schemaVersion: 1, sectionReasons, selectorPolicyId };
}

function validateAcceptedSnapshot(value) {
  const snapshot = requireConfigRecord(value, "accepted snapshot");
  requireExactConfigKeys(snapshot, [
    "schemaVersion",
    "snapshotId",
    "jurisdiction",
    "clientId",
    "productId",
    "jobId",
    "publicationName",
    "isLatest",
    "observedAt",
    "selectorPolicyId",
    "selectorPolicySha256",
    "attestation",
    "parents",
    "selections"
  ], "accepted snapshot");
  if (snapshot.schemaVersion !== 1 || snapshot.jurisdiction !== "cincinnati-oh") {
    throw new MunicodeError(
      "invalid_configuration",
      "The accepted snapshot identity is invalid."
    );
  }
  const profile = JURISDICTION_PROFILES["cincinnati-oh"];
  const clientId = requirePositiveSafeIntegerConfig(snapshot.clientId, "clientId");
  const productId = requirePositiveSafeIntegerConfig(snapshot.productId, "productId");
  const jobId = requirePositiveSafeIntegerConfig(snapshot.jobId, "jobId");
  if (clientId !== profile.clientId || productId !== profile.productId) {
    throw new MunicodeError(
      "invalid_configuration",
      "The accepted snapshot does not match the reviewed jurisdiction profile."
    );
  }
  if (typeof snapshot.isLatest !== "boolean") {
    throw new MunicodeError(
      "invalid_configuration",
      "The accepted snapshot isLatest value is invalid."
    );
  }
  requireUtcTimestampConfig(snapshot.observedAt, "observedAt");
  const attestation = validateAttestation(snapshot.attestation);
  if (!Array.isArray(snapshot.parents) || snapshot.parents.length < 1 || snapshot.parents.length > 20) {
    throw new MunicodeError(
      "invalid_configuration",
      "The accepted snapshot parent inventory is invalid."
    );
  }
  const parents = snapshot.parents.map(validateSnapshotParent);
  assertUnique(parents.map((parent) => parent.nodeId), "snapshot parent node IDs");
  const allChildren = parents.flatMap((parent) => parent.children);
  assertUnique(allChildren.map((child) => child.nodeId), "snapshot child node IDs");
  if (!Array.isArray(snapshot.selections) || snapshot.selections.length < 1 || snapshot.selections.length > 2_000) {
    throw new MunicodeError(
      "invalid_configuration",
      "The accepted snapshot selections are invalid."
    );
  }
  const selections = snapshot.selections.map(validateSnapshotSelection);
  assertUnique(selections.map((selection) => JSON.stringify([
    selection.zoningCode,
    selection.zoningOverlayDistrictNames,
    selection.proposedUseCategory
  ])), "snapshot selection tuples");
  return {
    schemaVersion: 1,
    snapshotId: requireConfigText(snapshot.snapshotId, "snapshotId", 200),
    jurisdiction: "cincinnati-oh",
    clientId,
    productId,
    jobId,
    publicationName: requireConfigText(
      snapshot.publicationName,
      "publicationName",
      500
    ),
    isLatest: snapshot.isLatest,
    observedAt: snapshot.observedAt,
    selectorPolicyId: requireConfigText(
      snapshot.selectorPolicyId,
      "selectorPolicyId",
      200
    ),
    selectorPolicySha256: requireSha256Config(
      snapshot.selectorPolicySha256,
      "selectorPolicySha256"
    ),
    attestation,
    parents,
    selections
  };
}

function validateAttestation(value) {
  const attestation = requireConfigRecord(value, "snapshot attestation");
  requireExactConfigKeys(
    attestation,
    ["kind", "attestorRef"],
    "snapshot attestation"
  );
  if (
    attestation.kind !== "synthetic_fixture"
    && attestation.kind !== "planning_domain"
  ) {
    throw new MunicodeError(
      "invalid_configuration",
      "The snapshot attestation kind is invalid."
    );
  }
  const attestorRef = requireConfigText(
    attestation.attestorRef,
    "attestorRef",
    200
  );
  if (
    attestation.kind === "synthetic_fixture"
    && attestorRef !== "synthetic-fixture-only"
  ) {
    throw new MunicodeError(
      "invalid_configuration",
      "Synthetic snapshot attestation is invalid."
    );
  }
  return { kind: attestation.kind, attestorRef };
}

function validateSnapshotParent(value, index) {
  const parent = requireConfigRecord(value, `snapshot parents[${index}]`);
  requireExactConfigKeys(
    parent,
    ["nodeId", "title", "children"],
    `snapshot parents[${index}]`
  );
  if (!Array.isArray(parent.children) || parent.children.length < 1 || parent.children.length > 2_000) {
    throw new MunicodeError(
      "invalid_configuration",
      "A snapshot child inventory is invalid."
    );
  }
  const children = parent.children.map((entry, childIndex) => {
    const child = requireConfigRecord(
      entry,
      `snapshot parents[${index}].children[${childIndex}]`
    );
    requireExactConfigKeys(
      child,
      ["nodeId", "title"],
      `snapshot parents[${index}].children[${childIndex}]`
    );
    return {
      nodeId: requireProviderNodeIdConfig(child.nodeId, "snapshot child nodeId"),
      title: requireConfigText(child.title, "snapshot child title", 1_000)
    };
  });
  assertUnique(children.map((child) => child.nodeId), "snapshot child node IDs");
  return {
    nodeId: requireProviderNodeIdConfig(parent.nodeId, "snapshot parent nodeId"),
    title: requireConfigText(parent.title, "snapshot parent title", 1_000),
    children
  };
}

function validateSnapshotSelection(value, index) {
  const selection = requireConfigRecord(value, `snapshot selections[${index}]`);
  requireExactConfigKeys(selection, [
    "zoningCode",
    "zoningOverlayDistrictNames",
    "proposedUseCategory",
    "sectionNodeIds"
  ], `snapshot selections[${index}]`);
  if (
    selection.proposedUseCategory !== "restaurant_full_service"
    && selection.proposedUseCategory !== "restaurant_limited_service"
  ) {
    throw new MunicodeError(
      "invalid_configuration",
      "A snapshot proposed-use category is unsupported."
    );
  }
  if (!Array.isArray(selection.sectionNodeIds) || selection.sectionNodeIds.length < 4 || selection.sectionNodeIds.length > 20) {
    throw new MunicodeError(
      "invalid_configuration",
      "A snapshot section selection must contain four through twenty nodes."
    );
  }
  const sectionNodeIds = selection.sectionNodeIds.map((nodeId) =>
    requireProviderNodeIdConfig(nodeId, "snapshot selected nodeId")
  );
  assertUnique(sectionNodeIds, "snapshot selected node IDs");
  return {
    zoningCode: requireConfigText(selection.zoningCode, "zoningCode", 200),
    zoningOverlayDistrictNames: requireSortedUniqueTextArrayConfig(
      selection.zoningOverlayDistrictNames,
      "zoningOverlayDistrictNames",
      10,
      300
    ),
    proposedUseCategory: selection.proposedUseCategory,
    sectionNodeIds
  };
}

function validateReviewedBundleInput(value) {
  const input = requireInputRecord(value, "reviewed bundle input");
  requireExactInputKeys(
    input,
    ["operationInput", "cagisContext"],
    "reviewed bundle input"
  );
  const operationInput = requireInputRecord(
    input.operationInput,
    "operationInput"
  );
  requireExactInputKeys(operationInput, [
    "jurisdiction",
    "proposedUseCategory",
    "schemaVersion",
    "selectorPolicyId"
  ], "operationInput");
  if (
    operationInput.jurisdiction !== "cincinnati-oh"
    || operationInput.schemaVersion !== 1
    || (
      operationInput.proposedUseCategory !== "restaurant_full_service"
      && operationInput.proposedUseCategory !== "restaurant_limited_service"
    )
  ) {
    throw new MunicodeError(
      "invalid_input",
      "The reviewed bundle Operation input is unsupported."
    );
  }
  const cagisContext = requireInputRecord(input.cagisContext, "cagisContext");
  requireExactInputKeys(cagisContext, [
    "auditorParcelId",
    "parcelKey",
    "provider",
    "resultSha256",
    "retrievedAt",
    "sourceUrl",
    "zoningCode",
    "zoningContextComplete",
    "zoningFetchedAt",
    "zoningOverlayDistrictNames",
    "zoningSource"
  ], "cagisContext");
  const auditorParcelId = optionalNullableInputText(
    cagisContext.auditorParcelId,
    "auditorParcelId",
    100
  );
  const parcelKey = optionalNullableInputText(
    cagisContext.parcelKey,
    "parcelKey",
    100
  );
  if (auditorParcelId === null && parcelKey === null) {
    throw new MunicodeError(
      "invalid_input",
      "CAGIS context requires at least one parcel identifier."
    );
  }
  if (cagisContext.provider !== "cagis" || cagisContext.zoningContextComplete !== true) {
    throw new MunicodeError(
      "invalid_input",
      "CAGIS context identity or completeness is invalid."
    );
  }
  const sourceUrl = requireHttpsInputUrl(cagisContext.sourceUrl, "sourceUrl");
  return {
    operationInput: {
      jurisdiction: "cincinnati-oh",
      proposedUseCategory: operationInput.proposedUseCategory,
      schemaVersion: 1,
      selectorPolicyId: requireInputText(
        operationInput.selectorPolicyId,
        "selectorPolicyId",
        200
      )
    },
    cagisContext: {
      auditorParcelId,
      parcelKey,
      provider: "cagis",
      resultSha256: requireSha256Input(cagisContext.resultSha256, "resultSha256"),
      retrievedAt: requireUtcTimestampInput(cagisContext.retrievedAt, "retrievedAt"),
      sourceUrl,
      zoningCode: requireInputText(cagisContext.zoningCode, "zoningCode", 200),
      zoningContextComplete: true,
      zoningFetchedAt: requireUtcTimestampInput(
        cagisContext.zoningFetchedAt,
        "zoningFetchedAt"
      ),
      zoningOverlayDistrictNames: requireSortedUniqueTextArrayInput(
        cagisContext.zoningOverlayDistrictNames,
        "zoningOverlayDistrictNames",
        10,
        300
      ),
      zoningSource: requireInputText(cagisContext.zoningSource, "zoningSource", 200)
    }
  };
}

function validateObservedChildren(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2_000) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned an invalid reviewed child inventory."
    );
  }
  const children = value.map((entry) => ({
    nodeId: requireProviderNodeIdResponse(entry?.Id, "provider child node ID"),
    title: requireBoundedText(entry?.Heading, "provider child title", 1_000)
  }));
  const ids = children.map((child) => child.nodeId);
  if (new Set(ids).size !== ids.length) {
    throw new MunicodeError(
      "publication_drift",
      "Municode returned duplicate reviewed child nodes."
    );
  }
  return children;
}

function reviewedReleaseLineage(release) {
  return {
    selectorPolicyId: release.snapshot.selectorPolicyId,
    selectorPolicySha256: release.snapshot.selectorPolicySha256,
    snapshotId: release.snapshot.snapshotId,
    snapshotSha256: release.snapshotSha256
  };
}

function reviewedBundleFailure(error) {
  const supportedCodes = new Set([
    "invalid_input",
    "selection_not_supported",
    "publication_drift",
    "selector_drift",
    "provider_reference_not_found",
    "provider_response_too_large",
    "invalid_provider_response",
    "unsupported_content_type",
    "dependency_unavailable",
    "dependency_http_error"
  ]);
  const failureCode = error instanceof MunicodeError && supportedCodes.has(error.code)
    ? error.code
    : "invalid_provider_response";
  return {
    detail: error instanceof MunicodeError
      ? requireSafeFailureDetail(error.message)
      : "The reviewed Municode bundle failed closed.",
    failureCode,
    retryClassification:
      error instanceof MunicodeError
      && error.retryable
      && (error.code === "dependency_unavailable" || error.code === "dependency_http_error")
        ? "definitive_retryable_pre_effect"
        : "definitive_nonretryable",
    schemaVersion: 1,
    status: "failed"
  };
}

function requireSafeFailureDetail(value) {
  const text = typeof value === "string" ? value.trim().slice(0, 500) : "";
  return text.length > 0 && !/[\u0000-\u001f\u007f]/u.test(text)
    ? text
    : "The reviewed Municode bundle failed closed.";
}

function requireConfigRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MunicodeError("invalid_configuration", `${label} must be an object.`);
  }
  return value;
}

function requireInputRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MunicodeError("invalid_input", `${label} must be an object.`);
  }
  return value;
}

function requireExactConfigKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  if (!arraysEqual(keys, [...expected].sort())) {
    throw new MunicodeError("invalid_configuration", `${label} has unsupported fields.`);
  }
}

function requireExactInputKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  if (!arraysEqual(keys, [...expected].sort())) {
    throw new MunicodeError("invalid_input", `${label} has unsupported fields.`);
  }
}

function requireConfigText(value, field, maxLength) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maxLength
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new MunicodeError("invalid_configuration", `${field} is invalid.`);
  }
  return value;
}

function requireProviderNodeIdConfig(value, field) {
  return requireConfigText(value, field, 300);
}

function requireProviderNodeIdResponse(value, field) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 300
    || value !== value.trim()
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new MunicodeError("invalid_provider_response", `${field} is invalid.`);
  }
  return value;
}

function requirePositiveSafeIntegerConfig(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new MunicodeError("invalid_configuration", `${field} is invalid.`);
  }
  return value;
}

function requireSha256Config(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new MunicodeError("invalid_configuration", `${field} is invalid.`);
  }
  return value;
}

function requireSha256Input(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  return value;
}

function requireUtcTimestampConfig(value, field) {
  let normalized;
  try {
    normalized = typeof value === "string" ? new Date(value).toISOString() : "";
  } catch {
    normalized = "";
  }
  if (typeof value !== "string" || value.length < 20 || value.length > 35 || normalized !== value) {
    throw new MunicodeError("invalid_configuration", `${field} is invalid.`);
  }
  return value;
}

function requireUtcTimestampInput(value, field) {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  let normalized;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  if (normalized !== value) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  return value;
}

function requireHttpsInputUrl(value, field) {
  const text = requireInputText(value, field, 2_000);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.toString() !== text) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  return text;
}

function optionalNullableInputText(value, field, maxLength) {
  return value === null ? null : requireInputText(value, field, maxLength);
}

function requireSortedUniqueTextArrayConfig(value, field, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new MunicodeError("invalid_configuration", `${field} is invalid.`);
  }
  const items = value.map((entry) => requireConfigText(entry, field, maxLength));
  if (!arraysEqual(items, [...new Set(items)].sort())) {
    throw new MunicodeError("invalid_configuration", `${field} must be sorted and unique.`);
  }
  return items;
}

function requireSortedUniqueTextArrayInput(value, field, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  const items = value.map((entry) => requireInputText(entry, field, maxLength));
  if (!arraysEqual(items, [...new Set(items)].sort())) {
    throw new MunicodeError("invalid_input", `${field} must be sorted and unique.`);
  }
  return items;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new MunicodeError("invalid_configuration", `${label} must be unique.`);
  }
}

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function arraysEqualByJson(left, right) {
  return arraysEqual(
    left.map((value) => JSON.stringify(value)),
    right.map((value) => JSON.stringify(value))
  );
}

function selectCodeDocuments(payload, requestedNodeId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned an invalid code-content payload."
    );
  }
  const docs = Array.isArray(payload.Docs) ? payload.Docs : [];
  const target = docs.find((doc) => doc?.Id === requestedNodeId);
  if (!target) {
    throw new MunicodeError(
      "provider_reference_not_found",
      "Municode did not return the requested code section."
    );
  }
  const groupId = target.ChunkGroupStartingNodeId ?? target.Id;
  const selected = target.Id === groupId
    ? docs.filter((doc) => (doc?.ChunkGroupStartingNodeId ?? doc?.Id) === groupId)
    : [target];
  const seen = new Set();
  return selected.filter((doc) => {
    const id = typeof doc?.Id === "string" ? doc.Id : null;
    if (id === null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function htmlToText(html) {
  if (typeof html !== "string") {
    throw new MunicodeError("invalid_provider_response", "Municode HTML content is invalid.");
  }
  let text = html.replace(/\r/gu, "");
  text = text.replace(/<\s*(?:script|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/giu, "");
  text = text.replace(/<\s*br\s*\/?>/giu, "\n");
  text = text.replace(/<\s*li\b[^>]*>/giu, "- ");
  text = text.replace(/<\s*\/\s*li\s*>/giu, "\n");
  text = text.replace(/<\s*\/\s*(?:p|div|section|article|ul|ol|table|thead|tbody|tfoot|figure)\s*>/giu, "\n");
  text = text.replace(/<\s*tr\b[^>]*>/giu, "");
  text = text.replace(/<\s*\/\s*tr\s*>/giu, "\n");
  text = text.replace(/<\s*(?:td|th)\b[^>]*>/giu, "");
  text = text.replace(/<\s*\/\s*(?:td|th)\s*>/giu, "\t");
  text = text.replace(/<[^>]+>/gu, "");
  text = decodeHtmlEntities(text);
  return normalizeText(text);
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => safeCodePoint(hex, 16))
    .replace(/&#([0-9]+);/gu, (_, number) => safeCodePoint(number, 10))
    .replace(/&([a-z0-9]+);/giu, (match, name) => (
      NAMED_HTML_ENTITIES[name.toLowerCase()] ?? match
    ));
}

function safeCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "�";
}

function normalizeText(value) {
  const lines = value.split("\n").map((line) => (
    line
      .split("\t")
      .map((cell) => cell.replace(/[ \f\v]+/gu, " ").trim())
      .join("\t")
      .replace(/\t+$/u, "")
  ));
  const output = [];
  for (const line of lines) {
    if (line.length === 0 && output[output.length - 1] === "") continue;
    output.push(line);
  }
  return output.join("\n").trim();
}

function resultEnvelope({ now, profile, publication, sourceUrl, values = {} }) {
  return {
    jurisdiction: profile.jurisdiction,
    publication,
    retrievedAt: requireTimestamp(now()),
    schemaVersion: 1,
    source: "municode",
    sourceUrl,
    status: "succeeded",
    ...values
  };
}

function libraryUrl(profile, nodeId) {
  const url = new URL(profile.libraryPath, MUNICODE_LIBRARY_ORIGIN);
  if (nodeId !== undefined) {
    url.searchParams.set("nodeId", nodeId);
  }
  return url.toString();
}

function pdfUrl(publication, nodeId) {
  return `${MUNICODE_PDF_ORIGIN}/codecontent/${publication.productId}/${publication.jobId}/${encodeURIComponent(nodeId)}.pdf`;
}

async function fetchJson(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "X-CSRF": "1"
      },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new MunicodeError(
      "dependency_unavailable",
      "Municode request failed before a response was received.",
      { cause: error, retryable: true }
    );
  }

  const text = await readBoundedText(response, MAX_JSON_BYTES, "Municode JSON response");
  if (!response.ok) {
    throw new MunicodeError(
      "dependency_http_error",
      `Municode dependency returned HTTP ${response.status}.`,
      { retryable: response.status === 429 || response.status >= 500 }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned invalid JSON.",
      { cause: error }
    );
  }
}

async function fetchPdf(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/pdf" },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new MunicodeError(
      "dependency_unavailable",
      "Municode PDF request failed before a response was received.",
      { cause: error, retryable: true }
    );
  }
  if (!response.ok) {
    throw new MunicodeError(
      "dependency_http_error",
      `Municode PDF dependency returned HTTP ${response.status}.`,
      { retryable: response.status === 429 || response.status >= 500 }
    );
  }
  const bytes = await readBoundedBytes(response, MAX_PDF_BYTES, "Municode PDF response");
  if (
    bytes.byteLength < 4
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
  ) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode PDF response is not a PDF document."
    );
  }
  return bytes;
}

async function readBoundedText(response, maxBytes, label) {
  const bytes = await readBoundedBytes(response, maxBytes, label);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new MunicodeError(
      "invalid_provider_response",
      `${label} is not valid UTF-8.`,
      { cause: error }
    );
  }
}

async function readBoundedBytes(response, maxBytes, label) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new MunicodeError("provider_response_too_large", `${label} exceeds the size limit.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new MunicodeError("provider_response_too_large", `${label} exceeds the size limit.`);
  }
  return bytes;
}

export async function extractPdfTextWithPdftotext(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "rudi-municode-"));
  const inputPath = join(directory, "code-section.pdf");
  try {
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-nopgbrk", inputPath, "-"],
      {
        encoding: "utf8",
        maxBuffer: 1_000_000,
        timeout: REQUEST_TIMEOUT_MS,
        windowsHide: true
      }
    );
    const text = normalizeText(stdout);
    if (text.length === 0) {
      throw new MunicodeError(
        "pdf_extraction_failed",
        "Municode PDF text extraction returned empty text."
      );
    }
    return text;
  } catch (error) {
    if (error instanceof MunicodeError) throw error;
    throw new MunicodeError(
      "pdf_extraction_failed",
      "Municode PDF text extraction failed.",
      { cause: error }
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function requireProfileInput(input, allowedKeys) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MunicodeError("invalid_input", "Tool input must be an object.");
  }
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new MunicodeError("invalid_input", "Tool input contains unknown fields.");
  }
  const jurisdiction = requireInputText(input.jurisdiction, "jurisdiction", 100);
  const profile = JURISDICTION_PROFILES[jurisdiction];
  if (!profile) {
    throw new MunicodeError(
      "unsupported_jurisdiction",
      "No reviewed Municode profile exists for the requested jurisdiction."
    );
  }
  return profile;
}

function requirePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new MunicodeError("invalid_provider_response", `Municode ${field} is invalid.`);
  }
  return number;
}

function requireNodeId(value, field = "parentNodeId") {
  const text = requireInputText(value, field, 300);
  let decoded;
  try {
    decoded = decodeURIComponent(text);
  } catch (error) {
    throw new MunicodeError("invalid_input", `${field} is not valid URL text.`, {
      cause: error
    });
  }
  if (!/^[\p{L}\p{N}_.:()' -]+$/u.test(decoded)) {
    throw new MunicodeError("invalid_input", `${field} contains unsupported characters.`);
  }
  return decoded;
}

function optionalPageLimit(value) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new MunicodeError("invalid_input", "limit must be an integer from 1 through 100.");
  }
  return value;
}

function optionalCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d{1,9}$/u.test(value)) {
    throw new MunicodeError("invalid_input", "cursor must be a decimal offset string.");
  }
  return Number(value);
}

function requireBoundedText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new MunicodeError("invalid_provider_response", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new MunicodeError("invalid_provider_response", `${field} is invalid.`);
  }
  return text;
}

function requireInputText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new MunicodeError("invalid_input", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  return text;
}

function requireTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new MunicodeError("invalid_configuration", "now returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const MUNICODE_ORIGINS = Object.freeze({
  api: MUNICODE_API_ORIGIN,
  library: MUNICODE_LIBRARY_ORIGIN,
  pdf: MUNICODE_PDF_ORIGIN
});
