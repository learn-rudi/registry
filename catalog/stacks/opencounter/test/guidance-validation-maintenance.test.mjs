import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildGuidanceValidationReport,
  compareMasterQuestionnaireVersions,
  createGuidanceValidationReportStore
} from "../src/guidance-validation-maintenance.mjs";
import { evaluatePreliminaryGuidance } from
  "../src/preliminary-guidance.mjs";
import {
  candidateUse,
  catalog,
  createPreliminaryGuidanceFixture,
  request,
  siteContext
} from "./fixtures/preliminary-guidance-fixture.mjs";

test("scores predicted questions and outcomes against exact read-back cases", () => {
  const fixture = createPreliminaryGuidanceFixture("Prohibited");
  const legal = legalAssessment(fixture);
  const questionId = legal.assessments[0].observedPaths[0].sourceQuestionId;
  const report = buildGuidanceValidationReport({
    cases: [{
      caseId: "known-project-exact",
      catalogEntryId: fixture.selectedCatalogEntryId,
      legalAssessment: legal,
      observed: observedProject({
        classification: "Prohibited",
        internalQuestionIds: [questionId],
        project: 2_970_001
      })
    }, {
      caseId: "known-project-novel-question",
      catalogEntryId: fixture.selectedCatalogEntryId,
      legalAssessment: legal,
      observed: observedProject({
        classification: "Conditional",
        internalQuestionIds: [questionId, `ocq_${"f".repeat(64)}`],
        project: 2_970_002
      })
    }],
    questionnaire: fixture.questionnaire,
    reportEpoch: "2026-08-04T23:00:00.000Z"
  });
  assert.equal(report.metrics.caseCount, 2);
  assert.equal(report.metrics.classification.correct, 1);
  assert.equal(report.metrics.classification.scorable, 2);
  assert.equal(report.metrics.classification.accuracy, 0.5);
  assert.equal(report.metrics.questions.truePositive, 2);
  assert.equal(report.metrics.questions.falsePositive, 0);
  assert.equal(report.metrics.questions.falseNegative, 1);
  assert.equal(report.metrics.questions.recall, 0.666667);
  assert.equal(report.cases[1].novelObservedQuestionIds.length, 1);
  assert.match(report.reportId, /^ocvr_[0-9a-f]{64}$/);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-guidance-validation-"
  ));
  try {
    const store = createGuidanceValidationReportStore({ stateDirectory });
    const write = store.write(report);
    assert.equal(statSync(write.path).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(write.path)).mode & 0o777, 0o700);
    assert.deepEqual(store.read(report.reportSha256), report);
  } finally {
    rmSync(stateDirectory, { recursive: true });
  }
});

test("turns exact questionnaire evidence drift into a bounded rerun set", () => {
  const baseline = createPreliminaryGuidanceFixture("Prohibited").questionnaire;
  const current = createPreliminaryGuidanceFixture("Permitted").questionnaire;
  const drift = compareMasterQuestionnaireVersions({
    baseline,
    current,
    observedAt: "2026-08-04T23:05:00.000Z"
  });
  assert.equal(drift.status, "targeted_rerun_recommended");
  assert.equal(drift.changedQuestionIds.length, 1);
  assert.equal(drift.affectedCatalogEntryIds.length, 126);
  assert.equal(drift.authorizationGranted, false);
  assert.match(drift.driftReportId, /^ocdr_[0-9a-f]{64}$/);

  const unchanged = compareMasterQuestionnaireVersions({
    baseline,
    current: baseline,
    observedAt: "2026-08-04T23:05:00.000Z"
  });
  assert.equal(unchanged.status, "no_drift");
  assert.equal(unchanged.affectedCatalogEntryIds.length, 0);
});

function legalAssessment(fixture) {
  const candidateUses = [candidateUse(fixture.selectedCatalogEntryId)];
  const intake = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses,
    catalog,
    questionnaire: fixture.questionnaire,
    request,
    siteContext: siteContext()
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
    siteContext: siteContext()
  });
}

function observedProject({ classification, internalQuestionIds, project }) {
  return {
    classification,
    evidenceRef: `known-project-readback:${project}`,
    internalQuestionIds,
    observedAt: "2026-08-04T22:30:00.000Z",
    providerReference: `opencounter:project:${project}`
  };
}
