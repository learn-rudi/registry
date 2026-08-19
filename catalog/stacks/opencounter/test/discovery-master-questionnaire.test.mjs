import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildMasterQuestionnaire,
  createMasterQuestionnaireStore,
  validateMasterQuestionnaire
} from "../src/discovery-master-questionnaire.mjs";
import { buildVerifiedObservationPortfolio } from
  "../src/discovery-observation-portfolio.mjs";
import { evaluatePreliminaryGuidance } from
  "../src/preliminary-guidance.mjs";
import { buildGuidanceValidationReport } from
  "../src/guidance-validation-maintenance.mjs";
import { loadZoningCatalog } from "../src/zoning-catalog.mjs";

const catalog = loadZoningCatalog(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
));

test("builds a deterministic observed-only questionnaire from exact sources", () => {
  const { freeze, sourceLedgers } = createFixtures();
  const first = buildMasterQuestionnaire({ catalog, freeze, sourceLedgers });
  const second = buildMasterQuestionnaire({ catalog, freeze, sourceLedgers });

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 3);
  assert.equal(first.libraryVersion, 3);
  assert.equal(first.catalog.tenantVersion, 307);
  assert.equal(first.evidence.sourceFreezeId, freeze.freezeId);
  assert.deepEqual(first.evidence.sourceLedgerSnapshotSha256s,
    freeze.sourceLedgers.map(({ ledgerSnapshotSha256 }) => ledgerSnapshotSha256));
  assert.equal(first.coverage.status, "first_pass_observed_non_exhaustive");
  assert.equal(first.coverage.canonicalQuestionCount, 2);
  assert.equal(first.coverage.questionFamilyCount, 2);
  assert.equal(first.coverage.universalQuestionFamilyCount, 1);
  assert.equal(first.coverage.conditionalQuestionFamilyCount, 1);
  assert.match(first.questionnaireId, /^ocmq_[0-9a-f]{64}$/);
  assert.equal(first.questionnaireId, `ocmq_${first.questionnaireSha256}`);

  const existingFamily = first.questionFamilies.find(
    ({ providerQuestionId }) => providerQuestionId === "existing_use"
  );
  const driveFamily = first.questionFamilies.find(
    ({ providerQuestionId }) => providerQuestionId === "drive_through"
  );
  assert.equal(existingFamily.scope, "observed_universal");
  assert.equal(existingFamily.applicability.catalogEntryIds.length, 126);
  assert.equal(driveFamily.scope, "observed_conditional");
  assert.equal(driveFamily.applicability.catalogEntryIds.length, 1);

  const existing = first.questions.find(
    ({ providerQuestionId }) => providerQuestionId === "existing_use"
  );
  const drive = first.questions.find(
    ({ providerQuestionId }) => providerQuestionId === "drive_through"
  );
  assert.equal(existing.internalQuestionId, existingFamily.canonicalQuestionIds[0]);
  assert.equal(existing.conditions.knowledgeStatus, "unobserved");
  assert.equal(existing.conditions.observedIncomingTransitions.length, 0);
  assert.equal(existing.outcomes.knowledgeStatus, "observed_partial");
  const nextQuestionTransition = existing.outcomes.observedTransitions.find(
    ({ targetQuestionId }) => targetQuestionId === drive.internalQuestionId
  );
  const terminalTransition = existing.outcomes.observedTransitions.find(
    ({ terminalStatus }) => terminalStatus === "completed"
  );
  assert.deepEqual({
    answerValue: nextQuestionTransition.answerValue,
    targetQuestionId: nextQuestionTransition.targetQuestionId,
    terminalClassifications: nextQuestionTransition.terminalClassifications,
    terminalStatus: nextQuestionTransition.terminalStatus
  }, {
    answerValue: "No",
    targetQuestionId: drive.internalQuestionId,
    terminalClassifications: [],
    terminalStatus: null
  });
  assert.deepEqual({
    answerValue: terminalTransition.answerValue,
    catalogEntryIds: terminalTransition.applicability.catalogEntryIds,
    targetQuestionId: terminalTransition.targetQuestionId,
    terminalClassifications: terminalTransition.terminalClassifications,
    terminalStatus: terminalTransition.terminalStatus
  }, {
    answerValue: "No",
    catalogEntryIds: [sourceLedgers[0].jobs[1].catalogEntryId],
    targetQuestionId: null,
    terminalClassifications: ["Prohibited"],
    terminalStatus: "completed"
  });
  assert.equal(existing.confidence.evidenceLevel, "observed_repeatedly");
  assert.equal(existing.confidence.exhaustivenessEstablished, false);
  assert.equal(drive.conditions.knowledgeStatus, "observed_partial");
  assert.equal(drive.conditions.observedIncomingTransitions[0].sourceQuestionId,
    existing.internalQuestionId);
  assert.equal(drive.outcomes.knowledgeStatus, "unobserved");
  assert.equal(drive.confidence.evidenceLevel, "observed_once");
  assert.deepEqual(validateMasterQuestionnaire(first), first);
});

test("extends the questionnaire with verified supplemental observations", () => {
  const { freeze, sourceLedgers } = createFixtures();
  const supplementalSourceLedgers = [createSupplementalLedger(sourceLedgers)];
  const supplementalEvidence = {
    adaptiveVerificationAssessmentSha256: digest("adaptive-assessment"),
    extendedAt: "2026-08-05T03:00:00.000Z",
    siteIssueSnapshotSha256: digest("site-issue-snapshot")
  };

  const questionnaire = buildMasterQuestionnaire({
    catalog,
    freeze,
    sourceLedgers,
    supplementalEvidence,
    supplementalSourceLedgers
  });

  assert.equal(questionnaire.schemaVersion, 5);
  assert.equal(questionnaire.libraryVersion, 5);
  assert.equal(questionnaire.coverage.status,
    "observed_branch_and_zoning_stability_verified_non_exhaustive");
  assert.equal(questionnaire.coverage.baselineVerifiedObservationCount, 126);
  assert.equal(questionnaire.coverage.supplementalVerifiedObservationCount, 3);
  assert.equal(questionnaire.coverage.verifiedObservationCount, 129);
  assert.equal(questionnaire.evidence.sourceFreezeId, freeze.freezeId);
  assert.equal(questionnaire.evidence.extendedAt,
    supplementalEvidence.extendedAt);
  assert.equal(questionnaire.evidence.adaptiveVerificationAssessmentSha256,
    supplementalEvidence.adaptiveVerificationAssessmentSha256);
  assert.equal(questionnaire.evidence.siteIssueSnapshotSha256,
    supplementalEvidence.siteIssueSnapshotSha256);
  assert.deepEqual(questionnaire.evidence.supplementalLedgerSnapshotSha256s, [
    digestArtifact(supplementalSourceLedgers[0])
  ]);
  assert.ok(questionnaire.questions.some(
    ({ providerQuestionId }) => providerQuestionId === "outdoor_activity"));
  const outdoor = questionnaire.questions.find(
    ({ providerQuestionId }) => providerQuestionId === "outdoor_activity"
  );
  const terminal = outdoor.outcomes.observedTransitions.find(
    ({ answerValue, terminalStatus }) =>
      answerValue === "No" && terminalStatus === "completed"
  );
  assert.deepEqual(terminal.terminalClassifications, ["Permitted", "Prohibited"]);
  assert.equal(terminal.contextEvidence.length, 2);
  assert.deepEqual(terminal.contextEvidence.map((outcome) => ({
    catalogEntryIds: outcome.applicability.catalogEntryIds,
    classification: outcome.terminalClassification
  })), supplementalSourceLedgers[0].jobs.filter((job) =>
    job.observations.some((observation) => observation.questions.some(
      ({ id }) => id === "outdoor_activity"
    ))
  ).map((job) => ({
    catalogEntryIds: [job.catalogEntryId],
    classification: job.terminalResult.classification
  })).sort((left, right) =>
    left.classification.localeCompare(right.classification)));
  assert.deepEqual(validateMasterQuestionnaire(questionnaire), questionnaire);

  const permittedJob = supplementalSourceLedgers[0].jobs[0];
  const request = {
    address: permittedJob.locationFixture.address,
    projectIdea: "Operate the verified fictional supplemental use.",
    schemaVersion: 1
  };
  const siteContext = {
    baseZoningCode: permittedJob.locationFixture.expectedBaseZoningCode,
    evidence: permittedJob.locationFixture.evidence,
    inputAddress: request.address,
    matchedAddress: request.address,
    overlayFlags: permittedJob.locationFixture.overlayFlags,
    parcelKey: permittedJob.locationFixture.parcelKey,
    rollupId: permittedJob.locationFixture.rollupId,
    schemaVersion: 1
  };
  const candidateUses = [{
    catalogEntryId: permittedJob.catalogEntryId,
    evidenceRefs: ["test:requester-confirmed-use"],
    mappingBasis: "requester_confirmed",
    rationale: "Requester confirmed the fictional catalog use."
  }];
  const intake = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses,
    catalog,
    questionnaire,
    request,
    siteContext
  });
  const existing = intake.nextQuestions.find(
    ({ providerQuestionId }) => providerQuestionId === "existing_use"
  );
  const branch = evaluatePreliminaryGuidance({
    answers: [{
      evidenceRefs: ["test:existing-use-answer"],
      internalQuestionId: existing.internalQuestionId,
      source: "requester",
      value: "No"
    }],
    candidateUses,
    catalog,
    questionnaire,
    request,
    siteContext
  });
  const result = evaluatePreliminaryGuidance({
    answers: [{
      evidenceRefs: ["test:existing-use-answer"],
      internalQuestionId: existing.internalQuestionId,
      source: "requester",
      value: "No"
    }, {
      evidenceRefs: ["test:outdoor-activity-answer"],
      internalQuestionId: branch.nextQuestions[0].internalQuestionId,
      source: "requester",
      value: "No"
    }],
    candidateUses,
    catalog,
    questionnaire,
    request,
    siteContext
  });
  assert.equal(result.status, "preliminary_result");
  assert.equal(result.preliminaryClassification, "likely_permitted");
  assert.deepEqual(result.assessments[0].predictedQuestionIds, [
    existing.internalQuestionId,
    branch.nextQuestions[0].internalQuestionId
  ].sort());
  const validation = buildGuidanceValidationReport({
    cases: [{
      caseId: "supplemental-multi-question-path",
      catalogEntryId: permittedJob.catalogEntryId,
      legalAssessment: result,
      observed: {
        classification: "Permitted",
        evidenceRef: "test:verified-supplemental-project",
        internalQuestionIds: [
          existing.internalQuestionId,
          branch.nextQuestions[0].internalQuestionId
        ].sort(),
        observedAt: "2026-08-05T02:10:00.000Z",
        providerReference: permittedJob.providerReference
      }
    }],
    questionnaire,
    reportEpoch: "2026-08-05T03:00:00.000Z"
  });
  assert.equal(validation.metrics.questions.recall, 1);
  assert.equal(validation.metrics.questions.precision, 1);

  const addressOnlyJob = supplementalSourceLedgers[0].jobs[2];
  const addressOnlyRequest = {
    address: addressOnlyJob.locationFixture.address,
    projectIdea: "Operate the verified fictional address-only use.",
    schemaVersion: 1
  };
  const addressOnly = evaluatePreliminaryGuidance({
    answers: [],
    candidateUses: [{
      catalogEntryId: addressOnlyJob.catalogEntryId,
      evidenceRefs: ["test:requester-confirmed-address-only-use"],
      mappingBasis: "requester_confirmed",
      rationale: "Requester confirmed the fictional address-only use."
    }],
    catalog,
    questionnaire,
    request: addressOnlyRequest,
    siteContext: {
      baseZoningCode: addressOnlyJob.locationFixture.expectedBaseZoningCode,
      evidence: addressOnlyJob.locationFixture.evidence,
      inputAddress: addressOnlyRequest.address,
      matchedAddress: addressOnlyRequest.address,
      overlayFlags: addressOnlyJob.locationFixture.overlayFlags,
      parcelKey: addressOnlyJob.locationFixture.parcelKey,
      rollupId: addressOnlyJob.locationFixture.rollupId,
      schemaVersion: 1
    }
  });
  assert.equal(addressOnly.status, "preliminary_result");
  assert.equal(addressOnly.preliminaryClassification,
    "permitted_with_limitations");
  assert.equal(addressOnly.assessments[0].predictedQuestionIds.length, 1);
  assert.equal(questionnaire.questions.find(({ internalQuestionId }) =>
    internalQuestionId
      === addressOnly.assessments[0].predictedQuestionIds[0]
  ).providerQuestionId, "opencounter-address");

  const unresolved = structuredClone(supplementalSourceLedgers);
  unresolved[0].jobs[0].status = "needs_input";
  unresolved[0].jobs[0].verification = {
    checkpointSha256: unresolved[0].jobs[0].checkpoint.checkpointSha256,
    observedAt: "2026-08-05T02:10:00.000Z",
    providerReference: unresolved[0].jobs[0].providerReference,
    status: "needs_requester_input"
  };
  assert.throws(() => buildMasterQuestionnaire({
    catalog,
    freeze,
    sourceLedgers,
    supplementalEvidence,
    supplementalSourceLedgers: unresolved
  }), /supplemental.*unresolved/i);
});

test("persists privately and rejects tampering or the wrong source snapshot", () => {
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-master-questionnaire-"
  ));
  try {
    const { freeze, sourceLedgers } = createFixtures();
    const questionnaire = buildMasterQuestionnaire({
      catalog,
      freeze,
      sourceLedgers
    });
    const store = createMasterQuestionnaireStore({ stateDirectory });
    const write = store.write(questionnaire);
    assert.equal(write.questionnaireSha256, questionnaire.questionnaireSha256);
    assert.equal(lstatSync(write.path).mode & 0o777, 0o600);
    assert.equal(lstatSync(path.dirname(write.path)).mode & 0o777, 0o700);
    assert.deepEqual(store.read(questionnaire.questionnaireSha256), questionnaire);

    const tampered = JSON.parse(readFileSync(write.path, "utf8"));
    tampered.questions[0].prompt = "Invented prompt";
    writeFileSync(write.path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    assert.throws(() => store.read(questionnaire.questionnaireSha256), /digest/i);

    const wrongSources = structuredClone(sourceLedgers);
    wrongSources[0].snapshotMutation = true;
    assert.throws(() => buildMasterQuestionnaire({
      catalog,
      freeze,
      sourceLedgers: wrongSources
    }), /source_snapshot_mismatch/i);
  } finally {
    chmodSync(stateDirectory, 0o700);
    rmSync(stateDirectory, { recursive: true });
  }
});

function createFixtures() {
  const sourceLedgers = createSourceLedgers();
  return {
    freeze: buildVerifiedObservationPortfolio({
      catalog,
      frozenAt: "2026-08-04T20:00:00.000Z",
      ledgers: sourceLedgers
    }),
    sourceLedgers
  };
}

function createSourceLedgers() {
  const entries = catalog.categories.flatMap((category) => [
    ...category.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label]
    })),
    ...category.groups.flatMap((group) => group.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label, group.label]
    })))
  ]).sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
  const jobs = entries.map(({ catalogEntryId, categoryPath }, index) => {
    const existingQuestion = question("existing_use", "Is this an existing use?");
    const firstCheckpointSha256 = digest(`master-first-${index}`);
    const observations = [{
      answers: [],
      checkpointSha256: firstCheckpointSha256,
      observedAt: "2026-08-04T19:00:00.000Z",
      operation: "start",
      questions: [existingQuestion],
      resultStatus: "needs_requester_input"
    }];
    let checkpointSha256 = firstCheckpointSha256;
    let questions = [existingQuestion];
    let status = "needs_input";
    let terminalResult = null;
    let verificationObservedAt = "2026-08-04T19:00:00.000Z";
    let verificationStatus = "needs_requester_input";
    if (index === 0) {
      checkpointSha256 = digest("master-second-0");
      questions = [question("drive_through", "Will there be a drive-through?")];
      observations.push({
        answers: [{ questionId: "existing_use", value: "No" }],
        checkpointSha256,
        observedAt: "2026-08-04T19:05:00.000Z",
        operation: "continue",
        questions,
        resultStatus: "needs_requester_input"
      });
      verificationObservedAt = "2026-08-04T19:05:00.000Z";
    } else if (index === 1) {
      observations.push({
        answers: [{ questionId: "existing_use", value: "No" }],
        checkpointSha256: null,
        observedAt: "2026-08-04T19:05:00.000Z",
        operation: "continue",
        questions: [],
        resultStatus: "completed"
      });
      status = "completed";
      terminalResult = { classification: "Prohibited" };
      verificationObservedAt = "2026-08-04T19:05:00.000Z";
      verificationStatus = "completed";
    }
    const providerReference = `opencounter:project:${2_930_000 + index}`;
    return {
      catalogEntryId,
      categoryPath,
      checkpoint: {
        checkpointSha256,
        expiresAt: "2026-08-05T19:00:00.000Z",
        questions,
        schemaVersion: 1
      },
      jobId: `ocdj_${digest(`master-job-${index}`)}`,
      locationFixture: {
        address: `SYNTHETIC MASTER LOCATION ${index + 1} - NOT A PROVIDER ADDRESS`,
        boundarySha256: digest(`master-boundary-${index}`),
        evidence: [{
          evidenceRef: `synthetic-master-location-${index + 1}`,
          observedAt: "2026-08-04T19:00:00.000Z",
          source: "test-fixture:master-questionnaire"
        }],
        expectedBaseZoningCode: "SF-2",
        locationId: `synthetic-master-location-${index + 1}`,
        locationVersion: 1,
        municipality: "City of Cincinnati",
        observedZoningCode: "SF-2",
        overlayFlags: [],
        parcelKey: String(index + 1).padStart(12, "0"),
        rollupId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
      },
      observations,
      providerReference,
      scenario: {
        answerRules: [],
        assumptions: {},
        scenarioId: "first-pass-question-observation",
        scenarioVersion: 1
      },
      status,
      terminalResult,
      verification: verificationStatus === "completed" ? {
        observedAt: verificationObservedAt,
        providerReference,
        resultSha256: digest(JSON.stringify(terminalResult)),
        status: verificationStatus
      } : {
        checkpointSha256,
        observedAt: verificationObservedAt,
        providerReference,
        status: verificationStatus
      }
    };
  });
  const ledgerSha256 = digest("synthetic-master-source-ledger");
  return [{
    catalog: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    jobs,
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    schemaVersion: 4
  }];
}

function createSupplementalLedger(sourceLedgers) {
  const job = structuredClone(sourceLedgers[0].jobs[2]);
  const outdoorActivity = question(
    "outdoor_activity",
    "Will activity occur outdoors?"
  );
  job.jobId = `ocdj_${digest("master-supplemental-job")}`;
  job.providerReference = "opencounter:project:2930999";
  job.scenario = {
    answerRules: [{ questionId: "outdoor_activity", value: "No" }],
    assumptions: { purpose: "verified supplemental branch fixture" },
    scenarioId: "verified-supplemental-branch",
    scenarioVersion: 1
  };
  job.answerPath = [{
    answers: [{ questionId: "outdoor_activity", value: "No" }],
    checkpointSha256: digest("master-supplemental-checkpoint"),
    observedAt: "2026-08-05T02:10:00.000Z"
  }];
  job.observations = [{
    ...structuredClone(job.observations[0]),
    observedAt: "2026-08-05T02:00:00.000Z"
  }, {
    answers: [{ questionId: "existing_use", value: "No" }],
    checkpointSha256: digest("master-supplemental-checkpoint"),
    observedAt: "2026-08-05T02:05:00.000Z",
    operation: "continue",
    questions: [outdoorActivity],
    resultStatus: "needs_requester_input"
  }, {
    answers: [],
    checkpointSha256: digest("master-supplemental-recovery-checkpoint"),
    observedAt: "2026-08-05T02:07:00.000Z",
    operation: "reconcile",
    questions: [],
    resultStatus: "needs_requester_input"
  }, {
    answers: [{ questionId: "outdoor_activity", value: "No" }],
    checkpointSha256: null,
    observedAt: "2026-08-05T02:10:00.000Z",
    operation: "continue",
    questions: [],
    resultStatus: "completed"
  }];
  job.status = "completed";
  job.terminalResult = { classification: "Permitted" };
  job.verification = {
    observedAt: "2026-08-05T02:10:00.000Z",
    providerReference: job.providerReference,
    resultSha256: digest(JSON.stringify(job.terminalResult)),
    status: "completed"
  };
  const prohibitedJob = structuredClone(job);
  prohibitedJob.catalogEntryId = sourceLedgers[0].jobs[3].catalogEntryId;
  prohibitedJob.categoryPath = structuredClone(
    sourceLedgers[0].jobs[3].categoryPath
  );
  prohibitedJob.jobId = `ocdj_${digest("master-supplemental-prohibited-job")}`;
  prohibitedJob.locationFixture = structuredClone(
    sourceLedgers[0].jobs[3].locationFixture
  );
  prohibitedJob.providerReference = "opencounter:project:2930998";
  prohibitedJob.terminalResult = { classification: "Prohibited" };
  prohibitedJob.verification = {
    observedAt: "2026-08-05T02:10:00.000Z",
    providerReference: prohibitedJob.providerReference,
    resultSha256: digest(JSON.stringify(prohibitedJob.terminalResult)),
    status: "completed"
  };
  const addressOnlyJob = structuredClone(sourceLedgers[0].jobs[4]);
  const addressQuestion = {
    id: "opencounter-address",
    options: [],
    prompt: "Which OpenCounter address match is the intended location?",
    required: true,
    type: "text"
  };
  addressOnlyJob.jobId = `ocdj_${digest("master-supplemental-address-job")}`;
  addressOnlyJob.observations = [{
    answers: [],
    checkpointSha256: digest("master-address-checkpoint"),
    observedAt: "2026-08-05T02:00:00.000Z",
    operation: "start",
    questions: [addressQuestion],
    resultStatus: "needs_requester_input"
  }, {
    answers: [{
      questionId: "opencounter-address",
      value: addressOnlyJob.locationFixture.address
    }],
    checkpointSha256: null,
    observedAt: "2026-08-05T02:10:00.000Z",
    operation: "continue",
    questions: [],
    resultStatus: "completed"
  }];
  addressOnlyJob.providerReference = "opencounter:project:2930997";
  addressOnlyJob.scenario = {
    answerRules: [],
    assumptions: { purpose: "verified address-only fixture" },
    scenarioId: "verified-address-only",
    scenarioVersion: 1
  };
  addressOnlyJob.status = "completed";
  addressOnlyJob.terminalResult = {
    classification: "Permitted with Limitations"
  };
  addressOnlyJob.verification = {
    observedAt: "2026-08-05T02:10:00.000Z",
    providerReference: addressOnlyJob.providerReference,
    resultSha256: digest(JSON.stringify(addressOnlyJob.terminalResult)),
    status: "completed"
  };
  const ledgerSha256 = digest("synthetic-master-supplemental-ledger");
  return {
    catalog: structuredClone(sourceLedgers[0].catalog),
    jobs: [job, prohibitedJob, addressOnlyJob],
    ledgerId: `ocdl_${ledgerSha256}`,
    ledgerSha256,
    schemaVersion: 8
  };
}

function question(id, prompt) {
  return {
    id,
    options: [
      { label: "Yes", value: "Yes" },
      { label: "No", value: "No" }
    ],
    prompt,
    required: true,
    type: "single_select"
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestArtifact(value) {
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
