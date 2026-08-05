import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluatePreliminaryGuidance,
  validatePreliminaryGuidance
} from "../src/preliminary-guidance.mjs";
import {
  candidateUse,
  catalog,
  questionnaire,
  request,
  selectedCatalogEntryId,
  siteContext
} from "./fixtures/preliminary-guidance-fixture.mjs";

test("stages local resolution and use mapping before questionnaire intake", () => {
  const unresolved = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses: [],
    catalog,
    questionnaire,
    request,
    siteContext: null
  });
  assert.equal(unresolved.status, "needs_site_resolution");
  assert.equal(unresolved.preliminaryClassification, "insufficient_information");
  assert.equal(unresolved.providerConfirmation.recommended, false);

  const unmapped = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses: [],
    catalog,
    questionnaire,
    request,
    siteContext: siteContext("SF-2")
  });
  assert.equal(unmapped.status, "needs_use_mapping");
  assert.equal(unmapped.nextQuestions.length, 0);
});

test("returns only an evidence-bound preliminary result for an exact path", () => {
  const candidateUses = [candidateUse(selectedCatalogEntryId)];
  const intake = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses,
    catalog,
    questionnaire,
    request,
    siteContext: siteContext("SF-2")
  });
  assert.equal(intake.status, "needs_project_input");
  assert.equal(intake.nextQuestions.length, 1);
  assert.equal(intake.nextQuestions[0].providerQuestionId, "existing_use");

  const result = evaluatePreliminaryGuidance({
    answers: [{
      evidenceRefs: ["requester:existing-use-answer"],
      internalQuestionId: intake.nextQuestions[0].internalQuestionId,
      source: "requester",
      value: "No"
    }],
    candidateUses,
    catalog,
    questionnaire,
    request,
    siteContext: siteContext("SF-2")
  });
  assert.equal(result.status, "preliminary_result");
  assert.equal(result.preliminaryClassification, "likely_prohibited");
  assert.equal(result.assessments[0].observedPaths.length, 1);
  assert.deepEqual(
    result.assessments[0].observedPaths[0].terminalClassifications,
    ["Prohibited"]
  );
  assert.equal(result.evidence.questionnaireSha256,
    questionnaire.questionnaireSha256);
  assert.equal(result.providerConfirmation.recommended, true);
  assert.ok(result.providerConfirmation.reasons.includes(
    "observed_library_not_exhaustive"
  ));
  assert.match(result.decisionId, /^ocpg_[0-9a-f]{64}$/);
  assert.deepEqual(validatePreliminaryGuidance(result), result);
  const tampered = structuredClone(result);
  tampered.preliminaryClassification = "likely_permitted";
  assert.throws(() => validatePreliminaryGuidance(tampered), /digest/i);
});

test("does not reuse an outcome in an unobserved zoning context", () => {
  const intake = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses: [candidateUse(selectedCatalogEntryId)],
    catalog,
    questionnaire,
    request,
    siteContext: siteContext("CC-A")
  });
  const result = evaluatePreliminaryGuidance({
    answers: [{
      evidenceRefs: ["requester:existing-use-answer"],
      internalQuestionId: intake.nextQuestions[0].internalQuestionId,
      source: "requester",
      value: "No"
    }],
    candidateUses: [candidateUse(selectedCatalogEntryId)],
    catalog,
    questionnaire,
    request,
    siteContext: siteContext("CC-A")
  });
  assert.equal(result.status, "needs_provider_confirmation");
  assert.equal(result.preliminaryClassification, "insufficient_information");
  assert.ok(result.providerConfirmation.reasons.includes(
    "zoning_context_not_observed"
  ));
});
