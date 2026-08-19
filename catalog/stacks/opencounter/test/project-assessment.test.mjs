import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createOpenCounterService } from "../src/core.mjs";
import { buildPhysicalFeasibilityAssessment } from
  "../src/combined-project-assessment.mjs";
import { evaluateProjectAssessment } from
  "../src/project-assessment.mjs";
import { createProjectAssessmentStore } from
  "../src/project-assessment-store.mjs";
import {
  catalog,
  questionnaire,
  request,
  selectedCatalogEntryId,
  siteContext
} from "./fixtures/preliminary-guidance-fixture.mjs";

test("completes a known project path locally without provider dispatch", async () => {
  const stateDirectory = mkdtempSync(path.join(
    os.tmpdir(),
    "opencounter-project-assessment-"
  ));
  let providerDispatches = 0;
  try {
    const service = createOpenCounterService({
      driver: {
        async startZoningGuidance() {
          providerDispatches += 1;
          throw new Error("provider dispatch is forbidden in assess_project");
        }
      },
      projectAssessmentStore: createProjectAssessmentStore({
        stateDirectory
      }),
      questionnaireStore: {
        read(questionnaireSha256) {
          assert.equal(
            questionnaireSha256,
            questionnaire.questionnaireSha256
          );
          return structuredClone(questionnaire);
        }
      },
      zoningCatalog: catalog
    });
    const intake = await service.assessProject(assessmentInput({
      assessmentKey: "pilot:known:requester-input"
    }));
    assert.equal(intake.assessment.status, "needs_project_input");
    assert.equal(intake.assessment.legalAssessment.nextQuestions.length, 1);
    assert.equal(intake.assessment.providerEscalation.authorizationGranted,
      false);
    assert.equal(intake.assessment.providerEscalation.required, false);
    assert.equal(providerDispatches, 0);

    const question = intake.assessment.legalAssessment.nextQuestions[0];
    const completedInput = assessmentInput({
      answers: [{
        evidenceRefs: ["requester:existing-use-answer"],
        internalQuestionId: question.internalQuestionId,
        source: "requester",
        value: "No"
      }],
      assessmentKey: "pilot:known:completed"
    });
    const completed = await service.assessProject(completedInput);
    assert.equal(completed.assessment.status, "preliminary_result");
    assert.equal(
      completed.assessment.legalAssessment.preliminaryClassification,
      "likely_prohibited"
    );
    assert.equal(completed.assessment.physicalFeasibility.status,
      "needs_evidence");
    assert.equal(completed.assessment.combinedAssessment, null);
    assert.equal(completed.assessment.providerEscalation.required, false);
    assert.equal(completed.assessment.providerEscalation.authorizationGranted,
      false);
    assert.match(completed.assessment.assessmentId,
      /^ocpa_[0-9a-f]{64}$/);
    assert.equal(statSync(completed.artifact.path).mode & 0o777, 0o600);
    assert.equal(providerDispatches, 0);

    const replay = await service.assessProject(completedInput);
    assert.equal(replay.assessment.assessmentId,
      completed.assessment.assessmentId);
    assert.equal(replay.artifact.path, completed.artifact.path);
    assert.equal(replay.artifact.replayed, true);
    assert.equal(providerDispatches, 0);
    await assert.rejects(
      service.assessProject({
        ...completedInput,
        projectIdea: "A conflicting retry under the same assessment key."
      }),
      /idempotency_conflict/
    );
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("returns deterministic catalog candidates for an ambiguous project idea", async () => {
  const stateDirectory = mkdtempSync(path.join(
    os.tmpdir(),
    "opencounter-project-assessment-ambiguous-"
  ));
  let providerDispatches = 0;
  try {
    const service = createOpenCounterService({
      driver: {
        async startZoningGuidance() {
          providerDispatches += 1;
          throw new Error("provider dispatch is forbidden in assess_project");
        }
      },
      projectAssessmentStore: createProjectAssessmentStore({
        stateDirectory
      }),
      questionnaireStore: {
        read() {
          return structuredClone(questionnaire);
        }
      },
      zoningCatalog: catalog
    });
    const result = await service.assessProject(assessmentInput({
      assessmentKey: "pilot:ambiguous-use",
      confirmedCatalogEntryId: null,
      projectIdea: "I want to create a dwelling."
    }));
    assert.equal(result.assessment.status, "needs_use_confirmation");
    assert.equal(result.assessment.useMapping.status, "needs_confirmation");
    assert.ok(result.assessment.useMapping.candidates.length >= 2);
    assert.ok(result.assessment.useMapping.candidates.length <= 5);
    assert.ok(result.assessment.useMapping.candidates.every(
      ({ mappingBasis }) => mappingBasis === "agent_candidate"
    ));
    assert.ok(result.assessment.issues.some(
      ({ code, status }) => code === "use_confirmation_required"
        && status === "open"
    ));
    assert.ok(result.assessment.nextActions.some(
      ({ action }) => action === "confirm_catalog_use"
    ));
    assert.equal(result.assessment.providerEscalation.authorizationGranted,
      false);
    assert.equal(providerDispatches, 0);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("creates an unauthorized bounded preview for an unobserved zoning context", async () => {
  const stateDirectory = mkdtempSync(path.join(
    os.tmpdir(),
    "opencounter-project-assessment-escalation-"
  ));
  let providerDispatches = 0;
  try {
    const service = createOpenCounterService({
      driver: {
        async startZoningGuidance() {
          providerDispatches += 1;
          throw new Error("provider dispatch is forbidden in assess_project");
        }
      },
      projectAssessmentStore: createProjectAssessmentStore({
        stateDirectory
      }),
      questionnaireStore: {
        read() {
          return structuredClone(questionnaire);
        }
      },
      zoningCatalog: catalog
    });
    const intake = await service.assessProject(assessmentInput({
      assessmentKey: "pilot:escalation:requester-input",
      siteResolution: {
        issues: [],
        siteContext: siteContext("CC-A"),
        status: "resolved"
      }
    }));
    const question = intake.assessment.legalAssessment.nextQuestions[0];
    const result = await service.assessProject(assessmentInput({
      answers: [{
        evidenceRefs: ["requester:existing-use-answer"],
        internalQuestionId: question.internalQuestionId,
        source: "requester",
        value: "No"
      }],
      assessmentKey: "pilot:escalation:preview",
      siteResolution: {
        issues: [],
        siteContext: siteContext("CC-A"),
        status: "resolved"
      }
    }));
    assert.equal(result.assessment.status, "needs_provider_confirmation");
    assert.equal(result.assessment.providerEscalation.required, true);
    assert.equal(result.assessment.providerEscalation.authorizationGranted,
      false);
    assert.equal(result.assessment.providerEscalation.preview.tool,
      "opencounter_start_zoning_guidance");
    assert.equal(
      result.assessment.providerEscalation.preview.authorizationGranted,
      false
    );
    assert.deepEqual(result.assessment.providerEscalation.preview.input, {
      address: request.address,
      catalogEntryId: selectedCatalogEntryId,
      catalogId: catalog.catalogId,
      jurisdiction: "cincinnati-oh",
      schemaVersion: 1
    });
    assert.match(result.assessment.providerEscalation.preview.previewId,
      /^ocpp_[0-9a-f]{64}$/);
    assert.equal(
      result.assessment.providerEscalation.preview.previewId,
      `ocpp_${result.assessment.providerEscalation.preview.previewSha256}`
    );
    assert.ok(result.assessment.nextActions.some(
      ({ action, authorizationRequired }) =>
        action === "preview_provider_confirmation"
        && authorizationRequired
    ));
    assert.equal(providerDispatches, 0);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});

test("preserves an ambiguous site resolution as a logged blocker", () => {
  const report = evaluateProjectAssessment({
    catalog,
    input: assessmentInput({
      assessmentKey: "pilot:ambiguous-site",
      siteResolution: {
        issues: [{
          code: "multiple_location_rollups",
          evidenceRefs: ["dwellow:lookup-location:ambiguous-example"],
          scope: "site",
          severity: "blocker",
          source: "stack:dwellow-mcp",
          status: "open",
          summary: "The address resolved to multiple plausible location rollups."
        }],
        siteContext: null,
        status: "ambiguous"
      }
    }),
    questionnaire
  });
  assert.equal(report.status, "needs_site_resolution");
  assert.ok(report.issues.some(({ code, source, status }) =>
    code === "multiple_location_rollups"
    && source === "stack:dwellow-mcp"
    && status === "open"));
  assert.ok(report.nextActions.some(({ action }) =>
    action === "resolve_site"));
  assert.equal(report.providerEscalation.authorizationGranted, false);
});

test("combines physical evidence only for the exact resolved parcel", () => {
  const intake = evaluateProjectAssessment({
    catalog,
    input: assessmentInput({ assessmentKey: "pilot:physical:intake" }),
    questionnaire
  });
  const question = intake.legalAssessment.nextQuestions[0];
  const physicalAssessment = physicalFixture();
  const report = evaluateProjectAssessment({
    catalog,
    input: assessmentInput({
      answers: [{
        evidenceRefs: ["requester:existing-use-answer"],
        internalQuestionId: question.internalQuestionId,
        source: "requester",
        value: "No"
      }],
      assessmentKey: "pilot:physical:combined",
      physicalAssessment
    }),
    questionnaire
  });
  assert.equal(report.status, "combined_result");
  assert.equal(report.physicalFeasibility.status, "available");
  assert.equal(report.physicalFeasibility.assessmentId,
    physicalAssessment.assessmentId);
  assert.equal(report.combinedAssessment.physicalAssessment.assessmentId,
    physicalAssessment.assessmentId);

  const mismatched = physicalFixture({
    parcelKey: "DIFFERENT-PARCEL"
  });
  assert.throws(() => evaluateProjectAssessment({
    catalog,
    input: assessmentInput({
      assessmentKey: "pilot:physical:mismatch",
      physicalAssessment: mismatched
    }),
    questionnaire
  }), /physical_site_mismatch/);
});

function assessmentInput(overrides = {}) {
  return {
    address: request.address,
    answers: [],
    assessmentKey: "pilot:known:default",
    confirmedCatalogEntryId: selectedCatalogEntryId,
    jurisdiction: "cincinnati-oh",
    observedAt: "2026-08-05T15:00:00.000Z",
    physicalAssessment: null,
    projectIdea: providerLabel(selectedCatalogEntryId),
    questionnaireSha256: questionnaire.questionnaireSha256,
    schemaVersion: 1,
    siteResolution: {
      issues: [],
      siteContext: siteContext("SF-2"),
      status: "resolved"
    },
    ...overrides
  };
}

function providerLabel(catalogEntryId) {
  for (const category of catalog.categories) {
    for (const entry of category.entries) {
      if (entry.catalogEntryId === catalogEntryId) return entry.providerLabel;
    }
    for (const group of category.groups) {
      for (const entry of group.entries) {
        if (entry.catalogEntryId === catalogEntryId) {
          return entry.providerLabel;
        }
      }
    }
  }
  throw new Error("test catalog entry missing");
}

function physicalFixture(siteOverrides = {}) {
  const domains = [
    "development_envelope",
    "existing_building",
    "parking_access_loading_circulation",
    "topography_flood_environment",
    "utilities_infrastructure"
  ];
  const site = siteContext("SF-2");
  return buildPhysicalFeasibilityAssessment({
    domains: domains.map((domain) => ({
      domain,
      evidenceRefs: ["site-engine:phase9-fixture"],
      findings: [],
      status: "pass"
    })),
    evidence: [{
      artifactSha256: "d".repeat(64),
      domains,
      evidenceRef: "site-engine:phase9-fixture",
      observedAt: "2026-08-05T14:55:00.000Z",
      source: "Pre Dev Intel site-engine Phase 9 test fixture"
    }],
    generatedAt: "2026-08-05T15:00:00.000Z",
    siteContext: {
      parcelKey: site.parcelKey,
      rollupId: site.rollupId,
      ...siteOverrides
    },
    sourceSystem: {
      artifactRef: "site-engine:phase9/site-envelope.json",
      name: "Pre Dev Intel site-engine",
      version: "phase9-test-v1"
    }
  });
}
