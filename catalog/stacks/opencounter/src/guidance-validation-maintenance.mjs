import { createHash } from "node:crypto";

import { validateMasterQuestionnaire } from
  "./discovery-master-questionnaire.mjs";
import { validatePreliminaryGuidance } from "./preliminary-guidance.mjs";

const QUESTION_ID_PATTERN = /^ocq_[0-9a-f]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^opencounter:project:[1-9][0-9]*$/;
const PROVIDER_CLASSIFICATIONS = new Set([
  "Conditional",
  "Permitted",
  "Permitted with Limitations",
  "Prohibited"
]);
const PROVIDER_TO_PRELIMINARY = new Map([
  ["Conditional", "conditional"],
  ["Permitted", "likely_permitted"],
  ["Permitted with Limitations", "permitted_with_limitations"],
  ["Prohibited", "likely_prohibited"]
]);

export function buildGuidanceValidationReport({
  cases,
  questionnaire,
  reportEpoch
}) {
  const library = validateMasterQuestionnaire(questionnaire);
  timestamp(reportEpoch, "report_epoch");
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 10_000) {
    throw new Error("opencounter_guidance_validation_cases_invalid");
  }
  const libraryQuestionIds = new Set(library.questions.map(
    ({ internalQuestionId }) => internalQuestionId
  ));
  const caseIds = new Set();
  const normalizedCases = cases.map((value) => {
    exactRecord(value, [
      "caseId", "catalogEntryId", "legalAssessment", "observed"
    ], "case");
    const caseId = boundedText(value.caseId, 200, "case_id");
    if (caseIds.has(caseId)) {
      throw new Error("opencounter_guidance_validation_case_duplicate");
    }
    caseIds.add(caseId);
    const legal = validatePreliminaryGuidance(value.legalAssessment);
    if (legal.evidence.questionnaireSha256 !== library.questionnaireSha256) {
      throw new Error(
        "opencounter_guidance_validation_questionnaire_mismatch"
      );
    }
    const assessment = legal.assessments.find(({ catalogEntryId }) =>
      catalogEntryId === value.catalogEntryId);
    if (assessment === undefined) {
      throw new Error("opencounter_guidance_validation_use_mismatch");
    }
    const observed = validateObservedProject(value.observed);
    const predictedQuestionIds = sortedUnique([
      ...assessment.observedPaths.map(({ sourceQuestionId }) =>
        sourceQuestionId),
      ...assessment.remainingQuestions.map(({ internalQuestionId }) =>
        internalQuestionId)
    ], QUESTION_ID_PATTERN, "predicted_question_ids");
    const predicted = new Set(predictedQuestionIds);
    const actual = new Set(observed.internalQuestionIds);
    const truePositive = predictedQuestionIds.filter((questionId) =>
      actual.has(questionId));
    const falsePositive = predictedQuestionIds.filter((questionId) =>
      !actual.has(questionId));
    const falseNegative = observed.internalQuestionIds.filter((questionId) =>
      !predicted.has(questionId));
    const expectedPreliminary = observed.classification === null
      ? null
      : PROVIDER_TO_PRELIMINARY.get(observed.classification);
    const classificationScorable = expectedPreliminary !== null;
    const classificationCorrect = classificationScorable
      && legal.preliminaryClassification === expectedPreliminary;
    return {
      caseId,
      catalogEntryId: boundedText(
        value.catalogEntryId,
        200,
        "catalog_entry_id"
      ),
      classification: {
        correct: classificationCorrect,
        observed: observed.classification,
        predicted: legal.preliminaryClassification,
        scorable: classificationScorable
      },
      legalDecisionId: legal.decisionId,
      novelObservedQuestionIds: falseNegative.filter((questionId) =>
        !libraryQuestionIds.has(questionId)),
      observed,
      questions: {
        falseNegative,
        falsePositive,
        predictedQuestionIds,
        truePositive
      },
      status: classificationCorrect && falseNegative.length === 0
        && falsePositive.length === 0
        ? "matched"
        : "mismatch"
    };
  }).sort((left, right) => left.caseId.localeCompare(right.caseId));
  const questionCounts = normalizedCases.reduce((counts, value) => ({
    falseNegative: counts.falseNegative
      + value.questions.falseNegative.length,
    falsePositive: counts.falsePositive
      + value.questions.falsePositive.length,
    truePositive: counts.truePositive
      + value.questions.truePositive.length
  }), { falseNegative: 0, falsePositive: 0, truePositive: 0 });
  const classificationScorable = normalizedCases.filter(
    ({ classification }) => classification.scorable
  ).length;
  const classificationCorrect = normalizedCases.filter(
    ({ classification }) => classification.correct
  ).length;
  const payload = {
    artifactKind: "opencounter_guidance_validation_report",
    cases: normalizedCases,
    evidence: {
      questionnaireId: library.questionnaireId,
      questionnaireSha256: library.questionnaireSha256,
      sourceFreezeId: library.evidence.sourceFreezeId
    },
    metrics: {
      caseCount: normalizedCases.length,
      classification: {
        accuracy: ratio(classificationCorrect, classificationScorable),
        correct: classificationCorrect,
        scorable: classificationScorable
      },
      questions: {
        ...questionCounts,
        precision: ratio(
          questionCounts.truePositive,
          questionCounts.truePositive + questionCounts.falsePositive
        ),
        recall: ratio(
          questionCounts.truePositive,
          questionCounts.truePositive + questionCounts.falseNegative
        )
      }
    },
    reportEpoch,
    schemaVersion: 1
  };
  const reportSha256 = sha256(payload);
  return {
    ...payload,
    reportId: `ocvr_${reportSha256}`,
    reportSha256
  };
}

export function compareMasterQuestionnaireVersions({
  baseline,
  current,
  observedAt
}) {
  const baselineLibrary = validateMasterQuestionnaire(baseline);
  const currentLibrary = validateMasterQuestionnaire(current);
  timestamp(observedAt, "drift_observed_at");
  const baselineById = new Map(baselineLibrary.questions.map((question) => [
    question.internalQuestionId,
    question
  ]));
  const currentById = new Map(currentLibrary.questions.map((question) => [
    question.internalQuestionId,
    question
  ]));
  const addedQuestionIds = [...currentById.keys()].filter((questionId) =>
    !baselineById.has(questionId)).sort(compareText);
  const removedQuestionIds = [...baselineById.keys()].filter((questionId) =>
    !currentById.has(questionId)).sort(compareText);
  const changedQuestionIds = [...baselineById.keys()].filter((questionId) =>
    currentById.has(questionId)
    && sha256(baselineById.get(questionId))
      !== sha256(currentById.get(questionId))).sort(compareText);
  const providerOrCatalogDrift =
    baselineLibrary.catalog.catalogId !== currentLibrary.catalog.catalogId
    || baselineLibrary.catalog.catalogSha256
      !== currentLibrary.catalog.catalogSha256
    || baselineLibrary.catalog.tenantId !== currentLibrary.catalog.tenantId
    || baselineLibrary.catalog.tenantVersion
      !== currentLibrary.catalog.tenantVersion;
  const affectedCatalogEntryIds = providerOrCatalogDrift
    ? allCatalogEntryIds(baselineLibrary, currentLibrary)
    : affectedEntries({
      addedQuestionIds,
      baselineById,
      changedQuestionIds,
      currentById,
      removedQuestionIds
    });
  let status = "no_drift";
  if (providerOrCatalogDrift) status = "full_catalog_refresh_recommended";
  else if (addedQuestionIds.length > 0
    || removedQuestionIds.length > 0
    || changedQuestionIds.length > 0) {
    status = "targeted_rerun_recommended";
  }
  const payload = {
    affectedCatalogEntryIds,
    addedQuestionIds,
    artifactKind: "opencounter_questionnaire_drift_report",
    authorizationGranted: false,
    baseline: libraryReference(baselineLibrary),
    changedQuestionIds,
    current: libraryReference(currentLibrary),
    observedAt,
    providerOrCatalogDrift,
    removedQuestionIds,
    schemaVersion: 1,
    status
  };
  const driftReportSha256 = sha256(payload);
  return {
    ...payload,
    driftReportId: `ocdr_${driftReportSha256}`,
    driftReportSha256
  };
}

function validateObservedProject(value) {
  exactRecord(value, [
    "classification", "evidenceRef", "internalQuestionIds", "observedAt",
    "providerReference"
  ], "observed_project");
  if (value.classification !== null
    && !PROVIDER_CLASSIFICATIONS.has(value.classification)
    || !PROVIDER_REFERENCE_PATTERN.test(value.providerReference)) {
    throw new Error("opencounter_guidance_validation_observed_invalid");
  }
  return {
    classification: value.classification,
    evidenceRef: boundedText(value.evidenceRef, 500, "evidence_ref"),
    internalQuestionIds: sortedUnique(
      value.internalQuestionIds,
      QUESTION_ID_PATTERN,
      "observed_question_ids"
    ),
    observedAt: timestamp(value.observedAt, "observed_at"),
    providerReference: value.providerReference
  };
}

function affectedEntries({
  addedQuestionIds,
  baselineById,
  changedQuestionIds,
  currentById,
  removedQuestionIds
}) {
  const entries = new Set();
  for (const questionId of addedQuestionIds) {
    addAll(entries, currentById.get(questionId).applicability.catalogEntryIds);
  }
  for (const questionId of removedQuestionIds) {
    addAll(entries, baselineById.get(questionId).applicability.catalogEntryIds);
  }
  for (const questionId of changedQuestionIds) {
    addAll(entries, baselineById.get(questionId).applicability.catalogEntryIds);
    addAll(entries, currentById.get(questionId).applicability.catalogEntryIds);
  }
  return [...entries].sort(compareText);
}

function allCatalogEntryIds(...libraries) {
  const entries = new Set();
  for (const library of libraries) {
    for (const family of library.questionFamilies) {
      addAll(entries, family.applicability.catalogEntryIds);
    }
  }
  return [...entries].sort(compareText);
}

function libraryReference(library) {
  return {
    catalogId: library.catalog.catalogId,
    catalogSha256: library.catalog.catalogSha256,
    questionnaireId: library.questionnaireId,
    questionnaireSha256: library.questionnaireSha256,
    tenantId: library.catalog.tenantId,
    tenantVersion: library.catalog.tenantVersion
  };
}

function ratio(numerator, denominator) {
  return denominator === 0
    ? null
    : Number((numerator / denominator).toFixed(6));
}

function sortedUnique(values, pattern, label) {
  if (!Array.isArray(values)
    || values.length > 10_000
    || values.some((value) => typeof value !== "string"
      || !pattern.test(value))
    || new Set(values).size !== values.length) {
    throw new Error(`opencounter_guidance_validation_${label}_invalid`);
  }
  return [...values].sort(compareText);
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_guidance_validation_${label}_invalid`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_guidance_validation_${label}_invalid`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_guidance_validation_${label}_invalid`);
  }
  return value;
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function compareText(left, right) {
  return left.localeCompare(right);
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
