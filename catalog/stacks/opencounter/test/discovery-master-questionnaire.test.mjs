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
