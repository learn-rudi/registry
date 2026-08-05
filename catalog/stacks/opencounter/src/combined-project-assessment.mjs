import { createHash } from "node:crypto";

import { validatePreliminaryGuidance } from "./preliminary-guidance.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SITE_DOMAINS = [
  "development_envelope",
  "existing_building",
  "parking_access_loading_circulation",
  "topography_flood_environment",
  "utilities_infrastructure"
];
const DOMAIN_STATUSES = new Set([
  "fail",
  "pass",
  "pass_with_constraints",
  "unknown"
]);
const PHYSICAL_LIMITATION =
  "Physical feasibility is bounded to the five recorded evidence domains and does not establish legal permission, final design, cost, financing, or constructability.";
const COMBINED_LIMITATIONS = [
  "The legal classification remains preliminary observed guidance, not a City determination.",
  "The physical classification remains a separate evidence-domain assessment, not final design or constructability approval.",
  "A combined potentially-viable result does not remove remaining approvals, constraints, or professional review."
];

export function buildPhysicalFeasibilityAssessment(input) {
  exactRecord(input, [
    "domains", "evidence", "generatedAt", "siteContext", "sourceSystem"
  ], "physical_input");
  const evidence = validateEvidence(input.evidence);
  const domains = validateDomains(input.domains, new Set(evidence.map(
    ({ evidenceRef }) => evidenceRef
  )));
  const payload = {
    artifactKind: "opencounter_physical_feasibility",
    domains,
    evidence,
    feasibilityClassification: derivePhysicalClassification(domains),
    generatedAt: timestamp(input.generatedAt, "generatedAt"),
    limitation: PHYSICAL_LIMITATION,
    schemaVersion: 1,
    siteContext: validateSiteContext(input.siteContext),
    sourceSystem: validateSourceSystem(input.sourceSystem)
  };
  const assessmentSha256 = sha256(payload);
  return validatePhysicalFeasibilityAssessment({
    ...payload,
    assessmentId: `ocpf_${assessmentSha256}`,
    assessmentSha256
  });
}

export function validatePhysicalFeasibilityAssessment(value) {
  exactRecord(value, [
    "artifactKind", "assessmentId", "assessmentSha256", "domains",
    "evidence", "feasibilityClassification", "generatedAt", "limitation",
    "schemaVersion", "siteContext", "sourceSystem"
  ], "physical_artifact");
  if (value.artifactKind !== "opencounter_physical_feasibility"
    || value.schemaVersion !== 1
    || !/^ocpf_[0-9a-f]{64}$/.test(value.assessmentId)
    || !SHA256_PATTERN.test(value.assessmentSha256)
    || value.assessmentId !== `ocpf_${value.assessmentSha256}`
    || value.limitation !== PHYSICAL_LIMITATION) {
    throw new Error("opencounter_physical_feasibility_artifact_invalid");
  }
  const evidence = validateEvidence(value.evidence);
  const domains = validateDomains(value.domains, new Set(evidence.map(
    ({ evidenceRef }) => evidenceRef
  )));
  const feasibilityClassification = derivePhysicalClassification(domains);
  if (value.feasibilityClassification !== feasibilityClassification) {
    throw new Error("opencounter_physical_feasibility_classification_invalid");
  }
  const payload = {
    artifactKind: value.artifactKind,
    domains,
    evidence,
    feasibilityClassification,
    generatedAt: timestamp(value.generatedAt, "generatedAt"),
    limitation: value.limitation,
    schemaVersion: value.schemaVersion,
    siteContext: validateSiteContext(value.siteContext),
    sourceSystem: validateSourceSystem(value.sourceSystem)
  };
  if (sha256(payload) !== value.assessmentSha256) {
    throw new Error("opencounter_physical_feasibility_digest_mismatch");
  }
  return {
    ...payload,
    assessmentId: value.assessmentId,
    assessmentSha256: value.assessmentSha256
  };
}

export function combineLegalAndPhysicalAssessments(input) {
  exactRecord(input, [
    "legalAssessment", "physicalAssessment"
  ], "combined_input");
  const legal = validatePreliminaryGuidance(input.legalAssessment);
  const physical = validatePhysicalFeasibilityAssessment(
    input.physicalAssessment
  );
  if (legal.siteContext === null
    || legal.siteContext.parcelKey !== physical.siteContext.parcelKey
    || legal.siteContext.rollupId !== physical.siteContext.rollupId) {
    throw new Error("opencounter_combined_assessment_site_mismatch");
  }
  const combinedClassification = deriveCombinedClassification(
    legal.preliminaryClassification,
    physical.feasibilityClassification
  );
  const payload = {
    artifactKind: "opencounter_combined_project_assessment",
    combinedClassification,
    generatedAt: physical.generatedAt,
    legalAssessment: {
      decisionId: legal.decisionId,
      decisionSha256: legal.decisionSha256,
      status: legal.status
    },
    legalClassification: legal.preliminaryClassification,
    limitations: [...COMBINED_LIMITATIONS],
    physicalAssessment: {
      assessmentId: physical.assessmentId,
      assessmentSha256: physical.assessmentSha256
    },
    physicalClassification: physical.feasibilityClassification,
    remainingApprovalsAndRisks: deriveRemainingRisks(legal, physical),
    schemaVersion: 1,
    siteContext: structuredClone(physical.siteContext)
  };
  const combinedAssessmentSha256 = sha256(payload);
  return validateCombinedProjectAssessment({
    ...payload,
    combinedAssessmentId: `occa_${combinedAssessmentSha256}`,
    combinedAssessmentSha256
  });
}

export function validateCombinedProjectAssessment(value) {
  exactRecord(value, [
    "artifactKind", "combinedAssessmentId", "combinedAssessmentSha256",
    "combinedClassification", "generatedAt", "legalAssessment",
    "legalClassification", "limitations", "physicalAssessment",
    "physicalClassification", "remainingApprovalsAndRisks", "schemaVersion",
    "siteContext"
  ], "combined_artifact");
  if (value.artifactKind !== "opencounter_combined_project_assessment"
    || value.schemaVersion !== 1
    || !/^occa_[0-9a-f]{64}$/.test(value.combinedAssessmentId)
    || !SHA256_PATTERN.test(value.combinedAssessmentSha256)
    || value.combinedAssessmentId
      !== `occa_${value.combinedAssessmentSha256}`
    || ![
      "conditional", "insufficient_information", "likely_permitted",
      "likely_prohibited", "permitted_with_limitations"
    ].includes(value.legalClassification)
    || ![
      "feasible", "feasible_with_constraints", "insufficient_information",
      "not_feasible"
    ].includes(value.physicalClassification)
    || value.combinedClassification !== deriveCombinedClassification(
      value.legalClassification,
      value.physicalClassification
    )
    || JSON.stringify(value.limitations)
      !== JSON.stringify(COMBINED_LIMITATIONS)) {
    throw new Error("opencounter_combined_assessment_artifact_invalid");
  }
  exactRecord(value.legalAssessment, [
    "decisionId", "decisionSha256", "status"
  ], "combined_legal_reference");
  exactRecord(value.physicalAssessment, [
    "assessmentId", "assessmentSha256"
  ], "combined_physical_reference");
  if (!/^ocpg_[0-9a-f]{64}$/.test(value.legalAssessment.decisionId)
    || !SHA256_PATTERN.test(value.legalAssessment.decisionSha256)
    || value.legalAssessment.decisionId
      !== `ocpg_${value.legalAssessment.decisionSha256}`
    || !boundedReferenceStatus(value.legalAssessment.status)
    || !/^ocpf_[0-9a-f]{64}$/.test(value.physicalAssessment.assessmentId)
    || !SHA256_PATTERN.test(value.physicalAssessment.assessmentSha256)
    || value.physicalAssessment.assessmentId
      !== `ocpf_${value.physicalAssessment.assessmentSha256}`) {
    throw new Error("opencounter_combined_assessment_reference_invalid");
  }
  const payload = {
    artifactKind: value.artifactKind,
    combinedClassification: value.combinedClassification,
    generatedAt: timestamp(value.generatedAt, "combined_generatedAt"),
    legalAssessment: structuredClone(value.legalAssessment),
    legalClassification: value.legalClassification,
    limitations: [...value.limitations],
    physicalAssessment: structuredClone(value.physicalAssessment),
    physicalClassification: value.physicalClassification,
    remainingApprovalsAndRisks: stringArray(
      value.remainingApprovalsAndRisks,
      1_000
    ),
    schemaVersion: value.schemaVersion,
    siteContext: validateSiteContext(value.siteContext)
  };
  if (sha256(payload) !== value.combinedAssessmentSha256) {
    throw new Error("opencounter_combined_assessment_digest_mismatch");
  }
  return {
    ...payload,
    combinedAssessmentId: value.combinedAssessmentId,
    combinedAssessmentSha256: value.combinedAssessmentSha256
  };
}

function validateDomains(values, evidenceRefs) {
  if (!Array.isArray(values) || values.length !== SITE_DOMAINS.length) {
    throw new Error("opencounter_physical_feasibility_domains_invalid");
  }
  const domains = values.map((value) => {
    exactRecord(value, ["domain", "findings", "status"], "domain");
    if (!SITE_DOMAINS.includes(value.domain)
      || !DOMAIN_STATUSES.has(value.status)
      || !Array.isArray(value.findings)
      || value.findings.length > 100) {
      throw new Error("opencounter_physical_feasibility_domain_invalid");
    }
    const codes = new Set();
    const findings = value.findings.map((finding) => {
      exactRecord(finding, [
        "code", "evidenceRefs", "measurements", "severity", "summary"
      ], "finding");
      if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(finding.code)
        || codes.has(finding.code)
        || !["blocker", "info", "warning"].includes(finding.severity)) {
        throw new Error("opencounter_physical_feasibility_finding_invalid");
      }
      codes.add(finding.code);
      const findingEvidenceRefs = stringArray(
        finding.evidenceRefs,
        100,
        true
      );
      if (findingEvidenceRefs.some((evidenceRef) =>
        !evidenceRefs.has(evidenceRef))) {
        throw new Error(
          "opencounter_physical_feasibility_finding_evidence_invalid"
        );
      }
      return {
        code: finding.code,
        evidenceRefs: findingEvidenceRefs,
        measurements: validateMeasurements(finding.measurements),
        severity: finding.severity,
        summary: boundedText(finding.summary, 2_000, "finding_summary")
      };
    }).sort((left, right) => left.code.localeCompare(right.code));
    if (value.status === "pass" && findings.length !== 0
      || value.status !== "pass" && findings.length < 1
      || value.status === "fail"
        && !findings.some(({ severity }) => severity === "blocker")
      || value.status === "pass_with_constraints"
        && !findings.some(({ severity }) => severity !== "info")) {
      throw new Error("opencounter_physical_feasibility_domain_status_invalid");
    }
    return {
      domain: value.domain,
      findings,
      status: value.status
    };
  }).sort((left, right) => left.domain.localeCompare(right.domain));
  if (JSON.stringify(domains.map(({ domain }) => domain))
      !== JSON.stringify(SITE_DOMAINS)) {
    throw new Error("opencounter_physical_feasibility_domains_invalid");
  }
  return domains;
}

function validateMeasurements(values) {
  if (!Array.isArray(values) || values.length > 100) {
    throw new Error("opencounter_physical_feasibility_measurements_invalid");
  }
  const names = new Set();
  return values.map((value) => {
    exactRecord(value, ["name", "unit", "value"], "measurement");
    const name = boundedText(value.name, 200, "measurement_name");
    if (names.has(name) || !Number.isFinite(value.value)) {
      throw new Error("opencounter_physical_feasibility_measurement_invalid");
    }
    names.add(name);
    return {
      name,
      unit: boundedText(value.unit, 100, "measurement_unit"),
      value: value.value
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function validateEvidence(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 500) {
    throw new Error("opencounter_physical_feasibility_evidence_invalid");
  }
  const refs = new Set();
  return values.map((value) => {
    exactRecord(value, [
      "artifactSha256", "evidenceRef", "observedAt", "source"
    ], "evidence");
    const evidenceRef = boundedText(value.evidenceRef, 500, "evidence_ref");
    if (refs.has(evidenceRef) || !SHA256_PATTERN.test(value.artifactSha256)) {
      throw new Error("opencounter_physical_feasibility_evidence_invalid");
    }
    refs.add(evidenceRef);
    return {
      artifactSha256: value.artifactSha256,
      evidenceRef,
      observedAt: timestamp(value.observedAt, "evidence_observedAt"),
      source: boundedText(value.source, 500, "evidence_source")
    };
  }).sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef));
}

function validateSiteContext(value) {
  exactRecord(value, ["parcelKey", "rollupId"], "site_context");
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(value.parcelKey)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.rollupId)) {
    throw new Error("opencounter_physical_feasibility_site_context_invalid");
  }
  return structuredClone(value);
}

function validateSourceSystem(value) {
  exactRecord(value, ["artifactRef", "name", "version"], "source_system");
  return {
    artifactRef: boundedText(value.artifactRef, 1_000, "artifact_ref"),
    name: boundedText(value.name, 200, "source_name"),
    version: boundedText(value.version, 200, "source_version")
  };
}

function derivePhysicalClassification(domains) {
  const statuses = new Set(domains.map(({ status }) => status));
  if (statuses.has("fail")) return "not_feasible";
  if (statuses.has("unknown")) return "insufficient_information";
  if (statuses.has("pass_with_constraints")) {
    return "feasible_with_constraints";
  }
  return "feasible";
}

function deriveCombinedClassification(legal, physical) {
  if (legal === "insufficient_information"
    || physical === "insufficient_information") {
    return "insufficient_information";
  }
  const legalConflict = legal === "likely_prohibited";
  const physicalConflict = physical === "not_feasible";
  if (legalConflict && physicalConflict) {
    return "legal_and_physical_conflicts_identified";
  }
  if (legalConflict) return "legal_conflict_identified";
  if (physicalConflict) return "physical_conflict_identified";
  if (["conditional", "permitted_with_limitations"].includes(legal)
    || physical === "feasible_with_constraints") {
    return "potentially_viable_with_conditions";
  }
  return "potentially_viable";
}

function deriveRemainingRisks(legal, physical) {
  const risks = new Set();
  if (legal.providerConfirmation.recommended) {
    risks.add("municipal_confirmation_recommended");
  }
  if (["conditional", "permitted_with_limitations"].includes(
    legal.preliminaryClassification
  )) {
    risks.add("legal_condition_or_limitation_requires_review");
  }
  if (legal.preliminaryClassification === "insufficient_information") {
    risks.add("legal_evidence_incomplete");
  }
  for (const domain of physical.domains) {
    for (const finding of domain.findings) {
      if (finding.severity !== "info") {
        risks.add(`physical:${domain.domain}:${finding.code}`);
      }
    }
  }
  return [...risks].sort((left, right) => left.localeCompare(right));
}

function boundedReferenceStatus(value) {
  return [
    "needs_project_input",
    "needs_provider_confirmation",
    "needs_site_resolution",
    "needs_use_confirmation",
    "needs_use_mapping",
    "preliminary_result"
  ].includes(value);
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_combined_assessment_${label}_invalid`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_combined_assessment_${label}_invalid`);
  }
  return value;
}

function stringArray(values, maximum, requireNonEmpty = false) {
  if (!Array.isArray(values)
    || values.length > maximum
    || requireNonEmpty && values.length < 1
    || values.some((value) => typeof value !== "string"
      || value.length < 1
      || value.length > 2_000
      || value !== value.trim()
      || /[\u0000-\u001F\u007F]/.test(value))
    || new Set(values).size !== values.length) {
    throw new Error("opencounter_combined_assessment_string_array_invalid");
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function timestamp(value, label) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_combined_assessment_${label}_invalid`);
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
