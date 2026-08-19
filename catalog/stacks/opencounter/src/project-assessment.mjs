import { createHash } from "node:crypto";

import {
  combineLegalAndPhysicalAssessments,
  validateCombinedProjectAssessment,
  validatePhysicalFeasibilityAssessment
} from "./combined-project-assessment.mjs";
import { validateMasterQuestionnaire } from
  "./discovery-master-questionnaire.mjs";
import {
  evaluatePreliminaryGuidance,
  validatePreliminaryGuidance
} from "./preliminary-guidance.mjs";
import {
  buildIssues,
  buildNextActions,
  buildPhysicalFeasibility,
  buildProviderEscalation,
  indexCatalogEntries,
  mapCatalogUses,
  SITE_DOMAINS
} from "./project-assessment-policy.mjs";
import { validateZoningCatalog } from "./zoning-catalog.mjs";

const ASSESSMENT_ID_PATTERN = /^ocpa_[0-9a-f]{64}$/;
const CATALOG_ENTRY_ID_PATTERN =
  /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LIMITATIONS = [
  "The legal result is preliminary observed guidance, not a normative City determination.",
  "The physical-feasibility result remains separate and must cite its own source-system evidence.",
  "The assessment action never authorizes or dispatches an OpenCounter provider project."
];

export function evaluateProjectAssessment({ catalog, input, questionnaire }) {
  const validatedCatalog = validateZoningCatalog(catalog);
  const validatedQuestionnaire = validateMasterQuestionnaire(questionnaire);
  const request = validateAssessmentInput(input);
  if (request.questionnaireSha256
      !== validatedQuestionnaire.questionnaireSha256
    || validatedQuestionnaire.catalog.catalogId
      !== validatedCatalog.catalogId
    || validatedQuestionnaire.catalog.catalogSha256
      !== validatedCatalog.catalogSha256) {
    throw new Error("opencounter_project_assessment_questionnaire_mismatch");
  }
  const entries = indexCatalogEntries(validatedCatalog);
  const siteResolution = validateSiteResolution(
    request.siteResolution,
    request.address
  );
  const candidateUses = mapCatalogUses({
    confirmedCatalogEntryId: request.confirmedCatalogEntryId,
    entries,
    projectIdea: request.projectIdea
  });
  if (siteResolution.siteContext === null && request.answers.length > 0) {
    throw new Error("opencounter_project_assessment_site_required");
  }
  const legalAssessment = evaluatePreliminaryGuidance({
    answers: request.answers,
    candidateUses,
    catalog: validatedCatalog,
    questionnaire: validatedQuestionnaire,
    request: {
      address: request.address,
      projectIdea: request.projectIdea,
      schemaVersion: 1
    },
    siteContext: siteResolution.siteContext
  });
  const physicalAssessment = request.physicalAssessment === null
    ? null
    : validatePhysicalFeasibilityAssessment(request.physicalAssessment);
  if (physicalAssessment !== null) {
    if (siteResolution.siteContext === null) {
      throw new Error(
        "opencounter_project_assessment_physical_site_unresolved"
      );
    }
    if (physicalAssessment.siteContext.parcelKey
        !== siteResolution.siteContext.parcelKey
      || physicalAssessment.siteContext.rollupId
        !== siteResolution.siteContext.rollupId) {
      throw new Error("opencounter_project_assessment_physical_site_mismatch");
    }
  }
  const combinedAssessment = physicalAssessment !== null
      && legalAssessment.status === "preliminary_result"
    ? combineLegalAndPhysicalAssessments({
      legalAssessment,
      physicalAssessment
    })
    : null;
  const useMapping = {
    candidates: candidateUses,
    confirmedCatalogEntryId: request.confirmedCatalogEntryId,
    status: candidateUses.length === 0
      ? "unmapped"
      : candidateUses.every(
        ({ mappingBasis }) => mappingBasis === "requester_confirmed"
      ) ? "confirmed" : "needs_confirmation"
  };
  const providerEscalation = buildProviderEscalation({
    catalog: validatedCatalog,
    legalAssessment,
    questionnaire: validatedQuestionnaire,
    request,
    useMapping
  });
  const physicalFeasibility = buildPhysicalFeasibility(physicalAssessment);
  const status = combinedAssessment === null
    ? legalAssessment.status
    : "combined_result";
  const issues = buildIssues({
    legalAssessment,
    physicalAssessment,
    siteResolution,
    useMapping
  });
  const payload = {
    artifactKind: "opencounter_project_assessment",
    assessmentKey: request.assessmentKey,
    combinedAssessment,
    issues,
    legalAssessment,
    limitations: [...LIMITATIONS],
    nextActions: buildNextActions({
      legalAssessment,
      physicalAssessment,
      providerEscalation,
      siteResolution,
      useMapping
    }),
    observedAt: request.observedAt,
    physicalFeasibility,
    providerEscalation,
    questionnaire: {
      questionnaireId: validatedQuestionnaire.questionnaireId,
      questionnaireSha256: validatedQuestionnaire.questionnaireSha256
    },
    request: {
      address: request.address,
      jurisdiction: request.jurisdiction,
      projectIdea: request.projectIdea
    },
    schemaVersion: 1,
    siteResolution,
    status,
    useMapping
  };
  const assessmentSha256 = sha256(payload);
  return validateProjectAssessment({
    ...payload,
    assessmentId: `ocpa_${assessmentSha256}`,
    assessmentSha256
  });
}

export function validateProjectAssessment(value) {
  exactRecord(value, [
    "artifactKind", "assessmentId", "assessmentKey", "assessmentSha256",
    "combinedAssessment", "issues", "legalAssessment", "limitations",
    "nextActions", "observedAt", "physicalFeasibility",
    "providerEscalation", "questionnaire", "request", "schemaVersion",
    "siteResolution", "status", "useMapping"
  ], "artifact");
  if (value.artifactKind !== "opencounter_project_assessment"
    || value.schemaVersion !== 1
    || !ASSESSMENT_ID_PATTERN.test(value.assessmentId)
    || !SHA256_PATTERN.test(value.assessmentSha256)
    || value.assessmentId !== `ocpa_${value.assessmentSha256}`
    || JSON.stringify(value.limitations) !== JSON.stringify(LIMITATIONS)) {
    throw new Error("opencounter_project_assessment_artifact_invalid");
  }
  const request = validateArtifactRequest(value.request);
  const siteResolution = validateSiteResolution(
    value.siteResolution,
    request.address
  );
  const legalAssessment = validatePreliminaryGuidance(value.legalAssessment);
  const physicalFeasibility = validatePhysicalFeasibilitySummary(
    value.physicalFeasibility
  );
  const combinedAssessment = value.combinedAssessment === null
    ? null
    : validateCombinedProjectAssessment(value.combinedAssessment);
  const status = combinedAssessment === null
    ? legalAssessment.status
    : "combined_result";
  if (value.status !== status
    || physicalFeasibility.status === "available"
      && physicalFeasibility.assessmentId === null
    || combinedAssessment !== null
      && physicalFeasibility.assessmentId
        !== combinedAssessment.physicalAssessment.assessmentId) {
    throw new Error("opencounter_project_assessment_status_invalid");
  }
  const payload = {
    artifactKind: value.artifactKind,
    assessmentKey: boundedText(value.assessmentKey, 200, "assessment_key"),
    combinedAssessment,
    issues: validateIssues(value.issues),
    legalAssessment,
    limitations: [...value.limitations],
    nextActions: validateNextActions(value.nextActions),
    observedAt: timestamp(value.observedAt, "observedAt"),
    physicalFeasibility,
    providerEscalation: validateProviderEscalation(
      value.providerEscalation
    ),
    questionnaire: validateQuestionnaireReference(value.questionnaire),
    request,
    schemaVersion: value.schemaVersion,
    siteResolution,
    status,
    useMapping: validateUseMapping(value.useMapping)
  };
  if (sha256(payload) !== value.assessmentSha256) {
    throw new Error("opencounter_project_assessment_digest_mismatch");
  }
  return {
    ...payload,
    assessmentId: value.assessmentId,
    assessmentSha256: value.assessmentSha256
  };
}

function validateAssessmentInput(value) {
  exactRecord(value, [
    "address", "answers", "assessmentKey", "confirmedCatalogEntryId",
    "jurisdiction", "observedAt", "physicalAssessment", "projectIdea",
    "questionnaireSha256", "schemaVersion", "siteResolution"
  ], "input");
  if (value.schemaVersion !== 1 || value.jurisdiction !== "cincinnati-oh"
    || !SHA256_PATTERN.test(value.questionnaireSha256)
    || !Array.isArray(value.answers)
    || value.answers.length > 200
    || value.confirmedCatalogEntryId !== null
      && !CATALOG_ENTRY_ID_PATTERN.test(value.confirmedCatalogEntryId)
    || value.physicalAssessment !== null
      && (!value.physicalAssessment
        || typeof value.physicalAssessment !== "object"
        || Array.isArray(value.physicalAssessment))) {
    throw new Error("opencounter_project_assessment_input_invalid");
  }
  return {
    address: boundedText(value.address, 500, "address"),
    answers: structuredClone(value.answers),
    assessmentKey: boundedText(value.assessmentKey, 200, "assessment_key"),
    confirmedCatalogEntryId: value.confirmedCatalogEntryId,
    jurisdiction: value.jurisdiction,
    observedAt: timestamp(value.observedAt, "observedAt"),
    physicalAssessment: value.physicalAssessment === null
      ? null
      : structuredClone(value.physicalAssessment),
    projectIdea: boundedText(value.projectIdea, 2_000, "project_idea"),
    questionnaireSha256: value.questionnaireSha256,
    schemaVersion: value.schemaVersion,
    siteResolution: structuredClone(value.siteResolution)
  };
}

function validateArtifactRequest(value) {
  exactRecord(value, ["address", "jurisdiction", "projectIdea"], "request");
  if (value.jurisdiction !== "cincinnati-oh") {
    throw new Error("opencounter_project_assessment_request_invalid");
  }
  return {
    address: boundedText(value.address, 500, "address"),
    jurisdiction: value.jurisdiction,
    projectIdea: boundedText(value.projectIdea, 2_000, "project_idea")
  };
}

function validateSiteResolution(value, address) {
  exactRecord(value, ["issues", "siteContext", "status"], "site_resolution");
  if (!["ambiguous", "failed", "not_attempted", "resolved"].includes(
    value.status
  )) {
    throw new Error("opencounter_project_assessment_site_resolution_invalid");
  }
  const siteContext = value.siteContext === null
    ? null
    : validateSiteContext(value.siteContext, address);
  if (value.status === "resolved" && siteContext === null
    || value.status !== "resolved" && siteContext !== null) {
    throw new Error("opencounter_project_assessment_site_resolution_invalid");
  }
  const issues = validateIssues(value.issues);
  if (["ambiguous", "failed"].includes(value.status)
    && !issues.some(({ severity, status }) =>
      severity === "blocker" && status === "open")) {
    throw new Error("opencounter_project_assessment_site_issue_required");
  }
  return { issues, siteContext, status: value.status };
}

function validateSiteContext(value, address) {
  exactRecord(value, [
    "baseZoningCode", "evidence", "inputAddress", "matchedAddress",
    "overlayFlags", "parcelKey", "rollupId", "schemaVersion"
  ], "site_context");
  if (value.schemaVersion !== 1 || value.inputAddress !== address
    || !/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/.test(value.baseZoningCode)
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.parcelKey)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.rollupId)
    || !Array.isArray(value.overlayFlags)
    || new Set(value.overlayFlags).size !== value.overlayFlags.length
    || !Array.isArray(value.evidence)
    || value.evidence.length < 1
    || value.evidence.length > 100) {
    throw new Error("opencounter_project_assessment_site_context_invalid");
  }
  const evidenceRefs = new Set();
  const evidence = value.evidence.map((item) => {
    exactRecord(item, ["evidenceRef", "observedAt", "source"],
      "site_evidence");
    const evidenceRef = boundedText(item.evidenceRef, 500, "evidence_ref");
    if (evidenceRefs.has(evidenceRef)) {
      throw new Error("opencounter_project_assessment_site_evidence_invalid");
    }
    evidenceRefs.add(evidenceRef);
    return {
      evidenceRef,
      observedAt: timestamp(item.observedAt, "site_evidence_observedAt"),
      source: boundedText(item.source, 500, "site_evidence_source")
    };
  }).sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef));
  return {
    baseZoningCode: value.baseZoningCode,
    evidence,
    inputAddress: value.inputAddress,
    matchedAddress: boundedText(value.matchedAddress, 500, "matched_address"),
    overlayFlags: stringArray(value.overlayFlags, 50),
    parcelKey: value.parcelKey,
    rollupId: value.rollupId,
    schemaVersion: 1
  };
}

function validateProviderEscalation(value) {
  exactRecord(value, [
    "authorizationGranted", "preview", "recommendationOnly", "recommended",
    "reasons", "required", "tool"
  ], "provider_escalation");
  if (value.authorizationGranted !== false
    || value.recommendationOnly !== true
    || typeof value.recommended !== "boolean"
    || typeof value.required !== "boolean"
    || value.required !== (value.preview !== null)
    || value.tool !== "opencounter_start_zoning_guidance") {
    throw new Error("opencounter_project_assessment_provider_invalid");
  }
  return {
    authorizationGranted: false,
    preview: value.preview === null
      ? null
      : validateProviderPreview(value.preview),
    recommendationOnly: true,
    recommended: value.recommended,
    reasons: stringArray(value.reasons, 100),
    required: value.required,
    tool: value.tool
  };
}

function validateProviderPreview(value) {
  exactRecord(value, [
    "authorizationGranted", "basisDecisionId", "basisDecisionSha256",
    "catalogSha256", "input", "previewId", "previewSha256",
    "questionnaireSha256", "tool"
  ], "provider_preview");
  exactRecord(value.input, [
    "address", "catalogEntryId", "catalogId", "jurisdiction", "schemaVersion"
  ], "provider_preview_input");
  if (value.authorizationGranted !== false
    || !/^ocpg_[0-9a-f]{64}$/.test(value.basisDecisionId)
    || !SHA256_PATTERN.test(value.basisDecisionSha256)
    || value.basisDecisionId !== `ocpg_${value.basisDecisionSha256}`
    || !SHA256_PATTERN.test(value.catalogSha256)
    || !/^ocpp_[0-9a-f]{64}$/.test(value.previewId)
    || !SHA256_PATTERN.test(value.previewSha256)
    || value.previewId !== `ocpp_${value.previewSha256}`
    || !SHA256_PATTERN.test(value.questionnaireSha256)
    || value.tool !== "opencounter_start_zoning_guidance"
    || value.input.jurisdiction !== "cincinnati-oh"
    || value.input.schemaVersion !== 1
    || !CATALOG_ENTRY_ID_PATTERN.test(value.input.catalogEntryId)) {
    throw new Error("opencounter_project_assessment_provider_preview_invalid");
  }
  const payload = {
    authorizationGranted: false,
    basisDecisionId: value.basisDecisionId,
    basisDecisionSha256: value.basisDecisionSha256,
    catalogSha256: value.catalogSha256,
    input: {
      address: boundedText(value.input.address, 500, "address"),
      catalogEntryId: value.input.catalogEntryId,
      catalogId: boundedText(value.input.catalogId, 200, "catalog_id"),
      jurisdiction: value.input.jurisdiction,
      schemaVersion: 1
    },
    questionnaireSha256: value.questionnaireSha256,
    tool: value.tool
  };
  if (sha256(payload) !== value.previewSha256) {
    throw new Error(
      "opencounter_project_assessment_provider_preview_digest_mismatch"
    );
  }
  return {
    ...payload,
    previewId: value.previewId,
    previewSha256: value.previewSha256
  };
}

function validatePhysicalFeasibilitySummary(value) {
  exactRecord(value, [
    "assessmentId", "assessmentSha256", "classification", "requiredDomains",
    "status"
  ], "physical_summary");
  if (!['available', 'needs_evidence'].includes(value.status)
    || JSON.stringify(value.requiredDomains) !== JSON.stringify(SITE_DOMAINS)) {
    throw new Error("opencounter_project_assessment_physical_invalid");
  }
  if (value.status === "needs_evidence") {
    if (value.assessmentId !== null || value.assessmentSha256 !== null
      || value.classification !== null) {
      throw new Error("opencounter_project_assessment_physical_invalid");
    }
  } else if (!/^ocpf_[0-9a-f]{64}$/.test(value.assessmentId)
    || !SHA256_PATTERN.test(value.assessmentSha256)
    || value.assessmentId !== `ocpf_${value.assessmentSha256}`
    || ![
      "feasible", "feasible_with_constraints", "insufficient_information",
      "not_feasible"
    ].includes(value.classification)) {
    throw new Error("opencounter_project_assessment_physical_invalid");
  }
  return structuredClone(value);
}

function validateQuestionnaireReference(value) {
  exactRecord(value, ["questionnaireId", "questionnaireSha256"],
    "questionnaire_reference");
  if (!/^ocmq_[0-9a-f]{64}$/.test(value.questionnaireId)
    || !SHA256_PATTERN.test(value.questionnaireSha256)
    || value.questionnaireId !== `ocmq_${value.questionnaireSha256}`) {
    throw new Error("opencounter_project_assessment_questionnaire_invalid");
  }
  return structuredClone(value);
}

function validateUseMapping(value) {
  exactRecord(value, [
    "candidates", "confirmedCatalogEntryId", "status"
  ], "use_mapping");
  if (!Array.isArray(value.candidates) || value.candidates.length > 20
    || !["confirmed", "needs_confirmation", "unmapped"].includes(value.status)
    || value.confirmedCatalogEntryId !== null
      && !CATALOG_ENTRY_ID_PATTERN.test(value.confirmedCatalogEntryId)) {
    throw new Error("opencounter_project_assessment_use_mapping_invalid");
  }
  const candidates = value.candidates.map((candidate) => {
    exactRecord(candidate, [
      "catalogEntryId", "evidenceRefs", "mappingBasis", "rationale"
    ], "use_candidate");
    if (!CATALOG_ENTRY_ID_PATTERN.test(candidate.catalogEntryId)
      || !["agent_candidate", "requester_confirmed"].includes(
        candidate.mappingBasis
      )) {
      throw new Error("opencounter_project_assessment_use_mapping_invalid");
    }
    return {
      catalogEntryId: candidate.catalogEntryId,
      evidenceRefs: stringArray(candidate.evidenceRefs, 100, true),
      mappingBasis: candidate.mappingBasis,
      rationale: boundedText(candidate.rationale, 2_000, "rationale")
    };
  });
  if (value.status === "confirmed"
      && (value.confirmedCatalogEntryId === null || candidates.length !== 1)
    || value.status === "needs_confirmation"
      && (value.confirmedCatalogEntryId !== null || candidates.length < 1
        || candidates.some(
          ({ mappingBasis }) => mappingBasis !== "agent_candidate"
        ))
    || value.status === "unmapped" && candidates.length !== 0) {
    throw new Error("opencounter_project_assessment_use_mapping_invalid");
  }
  return {
    candidates,
    confirmedCatalogEntryId: value.confirmedCatalogEntryId,
    status: value.status
  };
}

function validateIssues(values) {
  if (!Array.isArray(values) || values.length > 200) {
    throw new Error("opencounter_project_assessment_issues_invalid");
  }
  const identities = new Set();
  return values.map((value) => {
    exactRecord(value, [
      "code", "evidenceRefs", "scope", "severity", "source", "status",
      "summary"
    ], "issue");
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value.code)
      || ![
        "physical", "provider", "questionnaire", "site", "use_mapping"
      ].includes(value.scope)
      || !["blocker", "info", "warning"].includes(value.severity)
      || !["known_limitation", "open", "resolved"].includes(value.status)) {
      throw new Error("opencounter_project_assessment_issue_invalid");
    }
    const identity = `${value.scope}:${value.code}:${value.source}`;
    if (identities.has(identity)) {
      throw new Error("opencounter_project_assessment_issue_duplicate");
    }
    identities.add(identity);
    return {
      code: value.code,
      evidenceRefs: stringArray(value.evidenceRefs, 100),
      scope: value.scope,
      severity: value.severity,
      source: boundedText(value.source, 500, "issue_source"),
      status: value.status,
      summary: boundedText(value.summary, 2_000, "issue_summary")
    };
  }).sort((left, right) => left.scope.localeCompare(right.scope)
    || left.code.localeCompare(right.code)
    || left.source.localeCompare(right.source));
}

function validateNextActions(values) {
  if (!Array.isArray(values) || values.length > 20) {
    throw new Error("opencounter_project_assessment_actions_invalid");
  }
  const names = new Set();
  return values.map((value) => {
    exactRecord(value, [
      "action", "authorizationRequired", "reason", "stack", "tools"
    ], "next_action");
    if (![
      "answer_project_questions", "collect_physical_evidence",
      "confirm_catalog_use", "map_catalog_use", "preview_provider_confirmation",
      "resolve_site"
    ].includes(value.action)
      || names.has(value.action)
      || typeof value.authorizationRequired !== "boolean"
      || value.authorizationRequired
        !== (value.action === "preview_provider_confirmation")
      || !/^stack:[a-z0-9][a-z0-9-]*$/.test(value.stack)) {
      throw new Error("opencounter_project_assessment_action_invalid");
    }
    names.add(value.action);
    return {
      action: value.action,
      authorizationRequired: value.authorizationRequired,
      reason: boundedText(value.reason, 2_000, "action_reason"),
      stack: value.stack,
      tools: stringArray(value.tools, 20, true)
    };
  }).sort((left, right) => left.action.localeCompare(right.action));
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1
    || value.length > maximum || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
  return value;
}

function stringArray(values, maximum, requireNonEmpty = false) {
  if (!Array.isArray(values) || values.length > maximum
    || requireNonEmpty && values.length < 1
    || values.some((value) => typeof value !== "string"
      || value.length < 1 || value.length > 2_000
      || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value))
    || new Set(values).size !== values.length) {
    throw new Error("opencounter_project_assessment_string_array_invalid");
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function timestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_project_assessment_${label}_invalid`);
  }
  return value;
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
