import { createHash } from "node:crypto";

export const SITE_DOMAINS = [
  "development_envelope",
  "existing_building",
  "parking_access_loading_circulation",
  "topography_flood_environment",
  "utilities_infrastructure"
];

const PROJECT_IDEA_STOP_WORDS = new Set([
  "a", "an", "and", "at", "create", "for", "i", "in", "of", "on",
  "open", "project", "the", "to", "use", "want", "with"
]);

export function indexCatalogEntries(catalog) {
  const entries = new Map();
  const add = (values, categoryPath) => values.forEach((entry) => {
    entries.set(entry.catalogEntryId, {
      categoryPath,
      description: entry.description,
      providerLabel: entry.providerLabel,
      providerUseSlug: entry.providerUseSlug
    });
  });
  for (const category of catalog.categories) {
    add(category.entries, [category.label]);
    for (const group of category.groups) {
      add(group.entries, [category.label, group.label]);
    }
  }
  return entries;
}

export function mapCatalogUses({
  confirmedCatalogEntryId,
  entries,
  projectIdea
}) {
  if (confirmedCatalogEntryId !== null) {
    if (!entries.has(confirmedCatalogEntryId)) {
      throw new Error("opencounter_project_assessment_use_not_found");
    }
    return [{
      catalogEntryId: confirmedCatalogEntryId,
      evidenceRefs: ["request:confirmedCatalogEntryId", "request:projectIdea"],
      mappingBasis: "requester_confirmed",
      rationale: "Requester confirmed the exact closed-catalog use."
    }];
  }
  const ideaTokens = meaningfulTokens(projectIdea);
  if (ideaTokens.length === 0) return [];
  return [...entries.entries()].map(([catalogEntryId, entry]) => {
    const labelTokens = new Set(meaningfulTokens(entry.providerLabel));
    const identifierTokens = new Set(meaningfulTokens(
      catalogEntryId.split(".").pop().replaceAll("_", " ")
    ));
    const descriptionTokens = new Set(meaningfulTokens(
      entry.description ?? ""
    ));
    const labelMatches = ideaTokens.filter((token) => labelTokens.has(token));
    const identifierMatches = ideaTokens.filter(
      (token) => identifierTokens.has(token)
    );
    const descriptionMatches = ideaTokens.filter(
      (token) => descriptionTokens.has(token)
    );
    return {
      catalogEntryId,
      score: labelMatches.length * 4
        + identifierMatches.length * 2
        + descriptionMatches.length
    };
  }).filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score
      || left.catalogEntryId.localeCompare(right.catalogEntryId))
    .slice(0, 5)
    .map(({ catalogEntryId, score }) => ({
      catalogEntryId,
      evidenceRefs: ["request:projectIdea"],
      mappingBasis: "agent_candidate",
      rationale: `Deterministic lexical candidate score ${score}; requester confirmation is required.`
    }));
}

export function buildProviderEscalation({
  catalog,
  legalAssessment,
  questionnaire,
  request,
  useMapping
}) {
  const required = legalAssessment.status === "needs_provider_confirmation";
  let preview = null;
  if (required && useMapping.confirmedCatalogEntryId !== null) {
    const payload = {
      authorizationGranted: false,
      basisDecisionId: legalAssessment.decisionId,
      basisDecisionSha256: legalAssessment.decisionSha256,
      catalogSha256: catalog.catalogSha256,
      input: {
        address: request.address,
        catalogEntryId: useMapping.confirmedCatalogEntryId,
        catalogId: catalog.catalogId,
        jurisdiction: "cincinnati-oh",
        schemaVersion: 1
      },
      questionnaireSha256: questionnaire.questionnaireSha256,
      tool: "opencounter_start_zoning_guidance"
    };
    const previewSha256 = sha256(payload);
    preview = {
      ...payload,
      previewId: `ocpp_${previewSha256}`,
      previewSha256
    };
  }
  return {
    authorizationGranted: false,
    preview,
    recommendationOnly: true,
    recommended: legalAssessment.providerConfirmation.recommended,
    reasons: [...legalAssessment.providerConfirmation.reasons],
    required,
    tool: "opencounter_start_zoning_guidance"
  };
}

export function buildPhysicalFeasibility(physicalAssessment) {
  return physicalAssessment === null ? {
    assessmentId: null,
    assessmentSha256: null,
    classification: null,
    requiredDomains: [...SITE_DOMAINS],
    status: "needs_evidence"
  } : {
    assessmentId: physicalAssessment.assessmentId,
    assessmentSha256: physicalAssessment.assessmentSha256,
    classification: physicalAssessment.feasibilityClassification,
    requiredDomains: [...SITE_DOMAINS],
    status: "available"
  };
}

export function buildIssues({
  legalAssessment,
  physicalAssessment,
  siteResolution,
  useMapping
}) {
  const issues = [...siteResolution.issues];
  if (siteResolution.status !== "resolved") {
    issues.push(issue({
      code: "site_resolution_required",
      scope: "site",
      severity: "blocker",
      status: "open",
      summary: "Authoritative site and zoning resolution is required."
    }));
  }
  if (useMapping.status === "unmapped") {
    issues.push(issue({
      code: "catalog_use_mapping_required",
      scope: "use_mapping",
      severity: "blocker",
      status: "open",
      summary: "The project idea is not yet mapped to a closed-catalog use."
    }));
  } else if (useMapping.status === "needs_confirmation") {
    issues.push(issue({
      code: "use_confirmation_required",
      evidenceRefs: useMapping.candidates.map(
        ({ catalogEntryId }) => catalogEntryId
      ),
      scope: "use_mapping",
      severity: "blocker",
      status: "open",
      summary: "One or more inferred catalog uses require requester confirmation."
    }));
  }
  if (legalAssessment.status === "needs_provider_confirmation") {
    issues.push(issue({
      code: "provider_confirmation_required",
      evidenceRefs: legalAssessment.providerConfirmation.reasons,
      scope: "provider",
      severity: "warning",
      status: "open",
      summary: "The observed questionnaire does not support a local conclusion for this exact context."
    }));
  }
  if (physicalAssessment === null) {
    issues.push(issue({
      code: "physical_evidence_required",
      scope: "physical",
      severity: "warning",
      status: "open",
      summary: "Physical feasibility has not been evaluated from domain-specific evidence."
    }));
  }
  issues.push(issue({
    code: "observed_library_non_exhaustive",
    evidenceRefs: [legalAssessment.evidence.questionnaireId],
    scope: "questionnaire",
    severity: "info",
    status: "known_limitation",
    summary: "The questionnaire records observed paths and is not branch-exhaustive."
  }));
  return issues.sort((left, right) => left.scope.localeCompare(right.scope)
    || left.code.localeCompare(right.code)
    || left.source.localeCompare(right.source));
}

export function buildNextActions({
  legalAssessment,
  physicalAssessment,
  providerEscalation,
  siteResolution,
  useMapping
}) {
  const actions = [];
  if (siteResolution.status !== "resolved") {
    actions.push(action({
      action: "resolve_site",
      reason: "Authoritative parcel and zoning evidence is missing.",
      stack: "stack:dwellow-mcp",
      tools: ["lookup_location", "get_zoning_rules"]
    }));
  } else if (useMapping.status === "unmapped") {
    actions.push(action({
      action: "map_catalog_use",
      reason: "The project idea is not mapped to the closed catalog.",
      stack: "stack:opencounter",
      tools: ["opencounter_get_zoning_use_catalog"]
    }));
  } else if (useMapping.status === "needs_confirmation") {
    actions.push(action({
      action: "confirm_catalog_use",
      reason: "The deterministic project-idea candidates require requester confirmation.",
      stack: "stack:opencounter",
      tools: ["opencounter_assess_project"]
    }));
  } else if (legalAssessment.status === "needs_project_input") {
    actions.push(action({
      action: "answer_project_questions",
      reason: "One or more observed-path questions remain unanswered.",
      stack: "stack:opencounter",
      tools: ["opencounter_assess_project"]
    }));
  }
  if (physicalAssessment === null && siteResolution.status === "resolved") {
    actions.push(action({
      action: "collect_physical_evidence",
      reason: "Physical feasibility requires separately sourced evidence.",
      stack: "stack:dwellow-mcp",
      tools: [
        "get_site_boundary",
        "build_frontage_workspace",
        "get_site_conditions",
        "run_site_envelope"
      ]
    }));
  }
  if (providerEscalation.required) {
    actions.push(action({
      action: "preview_provider_confirmation",
      authorizationRequired: true,
      reason: "The exact context is not supported by observed local evidence.",
      stack: "stack:opencounter",
      tools: ["opencounter_start_zoning_guidance"]
    }));
  }
  return actions.sort((left, right) => left.action.localeCompare(right.action));
}

function meaningfulTokens(value) {
  return String(value).toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2
      && !PROJECT_IDEA_STOP_WORDS.has(token));
}

function issue({
  code,
  evidenceRefs = [],
  scope,
  severity,
  status,
  summary
}) {
  return {
    code,
    evidenceRefs: [...evidenceRefs].sort((left, right) =>
      left.localeCompare(right)),
    scope,
    severity,
    source: "stack:opencounter",
    status,
    summary
  };
}

function action({
  action: name,
  authorizationRequired = false,
  reason,
  stack,
  tools
}) {
  return {
    action: name,
    authorizationRequired,
    reason,
    stack,
    tools: [...tools].sort((left, right) => left.localeCompare(right))
  };
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
