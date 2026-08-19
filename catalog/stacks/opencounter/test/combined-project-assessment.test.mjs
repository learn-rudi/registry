import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  buildPhysicalFeasibilityAssessment,
  combineLegalAndPhysicalAssessments,
  validateCombinedProjectAssessment,
  validatePhysicalFeasibilityAssessment
} from "../src/combined-project-assessment.mjs";
import { evaluatePreliminaryGuidance } from
  "../src/preliminary-guidance.mjs";
import {
  candidateUse,
  catalog,
  createPreliminaryGuidanceFixture,
  request,
  siteContext
} from "./fixtures/preliminary-guidance-fixture.mjs";

const SITE_DOMAINS = [
  "development_envelope",
  "existing_building",
  "parking_access_loading_circulation",
  "topography_flood_environment",
  "utilities_infrastructure"
];

test("derives physical feasibility only from all required evidence domains", () => {
  const physical = physicalAssessment({
    parking_access_loading_circulation: "pass_with_constraints"
  });
  assert.equal(physical.feasibilityClassification,
    "feasible_with_constraints");
  assert.equal(physical.schemaVersion, 2);
  assert.ok(physical.domains.every(({ evidenceRefs }) =>
    evidenceRefs.length > 0));
  assert.match(physical.assessmentId, /^ocpf_[0-9a-f]{64}$/);
  assert.deepEqual(validatePhysicalFeasibilityAssessment(physical), physical);
  const legacy = toLegacyPhysicalAssessment(physical);
  assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(validatePhysicalFeasibilityAssessment(legacy), legacy);

  assert.throws(() => buildPhysicalFeasibilityAssessment({
    domains: domains().slice(0, 4),
    evidence: evidence(),
    generatedAt: "2026-08-04T22:00:00.000Z",
    siteContext: physicalSiteContext(),
    sourceSystem: sourceSystem()
  }), /domains/i);

  const unsupported = evidence();
  unsupported[0].domains = unsupported[0].domains.filter(
    (domain) => domain !== "utilities_infrastructure"
  );
  assert.throws(() => buildPhysicalFeasibilityAssessment({
    domains: domains(),
    evidence: unsupported,
    generatedAt: "2026-08-04T22:00:00.000Z",
    siteContext: physicalSiteContext(),
    sourceSystem: sourceSystem()
  }), /domain.*evidence|evidence.*domain/i);
});

test("keeps legal and physical conclusions separate in one combined result", () => {
  const legal = legalAssessment("Permitted");
  const physical = physicalAssessment({
    parking_access_loading_circulation: "pass_with_constraints"
  });
  const combined = combineLegalAndPhysicalAssessments({
    legalAssessment: legal,
    physicalAssessment: physical
  });
  assert.equal(legal.preliminaryClassification, "likely_permitted");
  assert.equal(combined.legalClassification, "likely_permitted");
  assert.equal(combined.physicalClassification,
    "feasible_with_constraints");
  assert.equal(combined.combinedClassification,
    "potentially_viable_with_conditions");
  assert.ok(combined.remainingApprovalsAndRisks.includes(
    "municipal_confirmation_recommended"
  ));
  assert.ok(combined.remainingApprovalsAndRisks.includes(
    "physical:parking_access_loading_circulation:shared_access_review"
  ));
  assert.match(combined.combinedAssessmentId, /^occa_[0-9a-f]{64}$/);
  assert.deepEqual(validateCombinedProjectAssessment(combined), combined);
  const tampered = structuredClone(combined);
  tampered.combinedClassification = "potentially_viable";
  assert.throws(() => validateCombinedProjectAssessment(tampered),
    /artifact|digest/i);
});

test("fails closed for unknown physical domains or a different parcel", () => {
  const legal = legalAssessment("Permitted");
  const unknown = physicalAssessment({ utilities_infrastructure: "unknown" });
  const combined = combineLegalAndPhysicalAssessments({
    legalAssessment: legal,
    physicalAssessment: unknown
  });
  assert.equal(combined.combinedClassification, "insufficient_information");

  const mismatched = structuredClone(unknown);
  mismatched.siteContext.parcelKey = "DIFFERENT-PARCEL";
  assert.throws(() => combineLegalAndPhysicalAssessments({
    legalAssessment: legal,
    physicalAssessment: mismatched
  }), /digest|site/i);
});

function legalAssessment(terminalClassification) {
  const fixture = createPreliminaryGuidanceFixture(terminalClassification);
  const candidateUses = [candidateUse(fixture.selectedCatalogEntryId)];
  const site = siteContext();
  const intake = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses,
    catalog,
    questionnaire: fixture.questionnaire,
    request,
    siteContext: site
  });
  return evaluatePreliminaryGuidance({
    answers: [{
      evidenceRefs: ["requester:existing-use-answer"],
      internalQuestionId: intake.nextQuestions[0].internalQuestionId,
      source: "requester",
      value: "No"
    }],
    candidateUses,
    catalog,
    questionnaire: fixture.questionnaire,
    request,
    siteContext: site
  });
}

function physicalAssessment(statusOverrides = {}) {
  return buildPhysicalFeasibilityAssessment({
    domains: domains(statusOverrides),
    evidence: evidence(),
    generatedAt: "2026-08-04T22:00:00.000Z",
    siteContext: physicalSiteContext(),
    sourceSystem: sourceSystem()
  });
}

function domains(statusOverrides = {}) {
  return SITE_DOMAINS.map((domain) => {
    const status = statusOverrides[domain] ?? "pass";
    return {
      domain,
      evidenceRefs: ["site-engine:example-assessment"],
      findings: status === "pass" ? [] : [{
        code: domain === "parking_access_loading_circulation"
          ? "shared_access_review"
          : `${domain}_evidence_incomplete`,
        evidenceRefs: ["site-engine:example-assessment"],
        measurements: [],
        severity: status === "fail" ? "blocker" : "warning",
        summary: status === "unknown"
          ? "Additional evidence is required."
          : "A documented site constraint requires follow-up."
      }],
      status
    };
  });
}

function evidence() {
  return [{
    artifactSha256: "a".repeat(64),
    domains: [...SITE_DOMAINS],
    evidenceRef: "site-engine:example-assessment",
    observedAt: "2026-08-04T21:30:00.000Z",
    source: "Pre Dev Intel site-engine test fixture"
  }];
}

function physicalSiteContext() {
  const site = siteContext();
  return {
    parcelKey: site.parcelKey,
    rollupId: site.rollupId
  };
}

function sourceSystem() {
  return {
    artifactRef: "site-engine:projects/example/site-envelope.json",
    name: "Pre Dev Intel site-engine",
    version: "test-fixture-v1"
  };
}

function toLegacyPhysicalAssessment(value) {
  const payload = structuredClone(value);
  delete payload.assessmentId;
  delete payload.assessmentSha256;
  payload.schemaVersion = 1;
  payload.domains.forEach((domain) => delete domain.evidenceRefs);
  payload.evidence.forEach((item) => delete item.domains);
  const assessmentSha256 = createHash("sha256")
    .update(JSON.stringify(sortJson(payload)), "utf8")
    .digest("hex");
  return {
    ...payload,
    assessmentId: `ocpf_${assessmentSha256}`,
    assessmentSha256
  };
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}
