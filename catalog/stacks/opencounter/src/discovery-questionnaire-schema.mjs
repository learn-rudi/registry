import { createHash } from "node:crypto";

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const QUESTION_ID_PATTERN = /^ocq_[0-9a-f]{64}$/;

const FAMILY_ID_PATTERN = /^ocqf_[0-9a-f]{64}$/;

export const COVERAGE_STATUS = "first_pass_observed_non_exhaustive";

export const TERMINAL_CLASSIFICATIONS = new Set([
  "Conditional",
  "Permitted",
  "Permitted with Limitations",
  "Prohibited"
]);

export const OBSERVED_ONLY_LIMITATION =
  "Observed provider behavior only; normative applicability and branch exhaustiveness are not established.";

export function validateFamilies(values, catalog) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000) {
    throw new Error("opencounter_master_questionnaire_families_invalid");
  }
  const ids = new Set();
  const providerIds = new Set();
  const questionIds = new Set();
  const families = values.map((value) => {
    exactRecord(value, [
      "applicability", "canonicalQuestionIds", "familyId",
      "providerQuestionId", "scope", "signatureCount"
    ], "family");
    if (!FAMILY_ID_PATTERN.test(value.familyId)
      || !text(value.providerQuestionId, 100)
      || createQuestionFamilyId(value.providerQuestionId) !== value.familyId
      || !["observed_conditional", "observed_universal"].includes(value.scope)
      || ids.has(value.familyId)
      || providerIds.has(value.providerQuestionId)) {
      throw new Error("opencounter_master_questionnaire_family_invalid");
    }
    ids.add(value.familyId);
    providerIds.add(value.providerQuestionId);
    const canonicalQuestionIds = stringArray(value.canonicalQuestionIds, {
      maximum: 1_000,
      pattern: QUESTION_ID_PATTERN,
      requireNonEmpty: true
    });
    if (value.signatureCount !== canonicalQuestionIds.length
      || canonicalQuestionIds.some((questionId) => questionIds.has(questionId))) {
      throw new Error("opencounter_master_questionnaire_family_invalid");
    }
    canonicalQuestionIds.forEach((questionId) => questionIds.add(questionId));
    const applicability = validateFamilyApplicability(value.applicability);
    const expectedScope = applicability.catalogEntryIds.length
      === catalog.catalogEntryCount
      ? "observed_universal"
      : "observed_conditional";
    if (value.scope !== expectedScope) {
      throw new Error("opencounter_master_questionnaire_family_scope_invalid");
    }
    return {
      applicability,
      canonicalQuestionIds,
      familyId: value.familyId,
      providerQuestionId: value.providerQuestionId,
      scope: value.scope,
      signatureCount: value.signatureCount
    };
  });
  const sortedFamilies = [...families].sort((left, right) =>
    left.providerQuestionId.localeCompare(right.providerQuestionId));
  if (JSON.stringify(families) !== JSON.stringify(sortedFamilies)) {
    throw new Error("opencounter_master_questionnaire_families_order_invalid");
  }
  return families;
}

export function validateQuestions(values, families, evidence, schemaVersion) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10_000) {
    throw new Error("opencounter_master_questionnaire_questions_invalid");
  }
  const familiesById = new Map(families.map((family) => [family.familyId, family]));
  const questionsById = new Map();
  const questions = values.map((value) => {
    exactRecord(value, [
      "applicability", "conditions", "confidence", "evidence", "familyId",
      "internalQuestionId", "normalizedSignatureSha256", "options", "outcomes",
      "prompt", "providerQuestionId", "requiredStatuses", "scope", "type"
    ], "question");
    const family = familiesById.get(value.familyId);
    if (!QUESTION_ID_PATTERN.test(value.internalQuestionId)
      || questionsById.has(value.internalQuestionId)
      || !SHA256_PATTERN.test(value.normalizedSignatureSha256)
      || family === undefined
      || family.providerQuestionId !== value.providerQuestionId
      || family.scope !== value.scope
      || !family.canonicalQuestionIds.includes(value.internalQuestionId)
      || !text(value.prompt, 2_000)
      || !text(value.providerQuestionId, 100)
      || !text(value.type, 100)) {
      throw new Error("opencounter_master_questionnaire_question_invalid");
    }
    const applicability = validateQuestionApplicability(value.applicability);
    const conditions = validateTransitionCollection(
      value.conditions,
      "observedIncomingTransitions",
      schemaVersion
    );
    const outcomes = validateTransitionCollection(
      value.outcomes,
      "observedTransitions",
      schemaVersion
    );
    const confidence = validateConfidence(value.confidence);
    exactRecord(value.evidence, [
      "firstObservedAt", "lastObservedAt", "sourceFreezeId"
    ], "question_evidence");
    timestamp(value.evidence.firstObservedAt, "question_firstObservedAt");
    timestamp(value.evidence.lastObservedAt, "question_lastObservedAt");
    if (Date.parse(value.evidence.firstObservedAt)
        > Date.parse(value.evidence.lastObservedAt)
      || value.evidence.sourceFreezeId !== evidence.sourceFreezeId) {
      throw new Error("opencounter_master_questionnaire_question_evidence_invalid");
    }
    if (!Array.isArray(value.options) || value.options.length > 1_000) {
      throw new Error("opencounter_master_questionnaire_options_invalid");
    }
    const options = value.options.map((option) => {
      exactRecord(option, ["label", "value"], "option");
      if (!text(option.label, 2_000) || !text(option.value, 2_000)) {
        throw new Error("opencounter_master_questionnaire_option_invalid");
      }
      return structuredClone(option);
    });
    if (value.type === "single_select" && options.length < 1
      || value.type === "text" && options.length !== 0) {
      throw new Error("opencounter_master_questionnaire_options_invalid");
    }
    if (!Array.isArray(value.requiredStatuses)
      || value.requiredStatuses.length < 1
      || value.requiredStatuses.length > 2
      || value.requiredStatuses.some((required) => typeof required !== "boolean")
      || new Set(value.requiredStatuses).size !== value.requiredStatuses.length) {
      throw new Error("opencounter_master_questionnaire_required_invalid");
    }
    const question = {
      applicability,
      conditions,
      confidence,
      evidence: structuredClone(value.evidence),
      familyId: value.familyId,
      internalQuestionId: value.internalQuestionId,
      normalizedSignatureSha256: value.normalizedSignatureSha256,
      options,
      outcomes,
      prompt: value.prompt,
      providerQuestionId: value.providerQuestionId,
      requiredStatuses: [...value.requiredStatuses],
      scope: value.scope,
      type: value.type
    };
    questionsById.set(value.internalQuestionId, question);
    return question;
  });
  const sortedQuestions = [...questions].sort((left, right) =>
    left.internalQuestionId.localeCompare(right.internalQuestionId));
  if (JSON.stringify(questions) !== JSON.stringify(sortedQuestions)) {
    throw new Error("opencounter_master_questionnaire_questions_order_invalid");
  }
  for (const family of families) {
    const actual = questions
      .filter(({ familyId }) => familyId === family.familyId)
      .map(({ internalQuestionId }) => internalQuestionId)
      .sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(actual) !== JSON.stringify(family.canonicalQuestionIds)) {
      throw new Error("opencounter_master_questionnaire_family_link_invalid");
    }
  }
  for (const question of questions) {
    for (const transition of question.conditions.observedIncomingTransitions) {
      if (transition.targetQuestionId !== question.internalQuestionId
        || !questionsById.has(transition.sourceQuestionId)) {
        throw new Error("opencounter_master_questionnaire_condition_link_invalid");
      }
    }
    for (const transition of question.outcomes.observedTransitions) {
      if (transition.sourceQuestionId !== question.internalQuestionId
        || transition.targetQuestionId !== null
          && !questionsById.has(transition.targetQuestionId)) {
        throw new Error("opencounter_master_questionnaire_outcome_link_invalid");
      }
    }
  }
  return questions;
}

export function validateCoverage(value, families, questions, catalog) {
  exactRecord(value, [
    "canonicalQuestionCount", "conditionalQuestionFamilyCount",
    "questionFamilyCount", "status", "universalQuestionFamilyCount",
    "verifiedObservationCount"
  ], "coverage");
  const universal = families.filter(
    ({ scope }) => scope === "observed_universal"
  ).length;
  if (value.canonicalQuestionCount !== questions.length
    || value.questionFamilyCount !== families.length
    || value.universalQuestionFamilyCount !== universal
    || value.conditionalQuestionFamilyCount !== families.length - universal
    || value.status !== COVERAGE_STATUS
    || value.verifiedObservationCount !== catalog.catalogEntryCount) {
    throw new Error("opencounter_master_questionnaire_coverage_invalid");
  }
  return structuredClone(value);
}

function validateFamilyApplicability(value) {
  exactRecord(value, [
    "catalogEntryIds", "categoryPaths", "expectedBaseZoningCodes", "kind",
    "observedZoningCodes", "overlayFlags"
  ], "family_applicability");
  if (value.kind !== "observed_only") {
    throw new Error("opencounter_master_questionnaire_applicability_invalid");
  }
  return {
    catalogEntryIds: stringArray(value.catalogEntryIds, {
      maximum: 126,
      requireNonEmpty: true
    }),
    categoryPaths: stringArray(value.categoryPaths, {
      maximum: 126,
      requireNonEmpty: true
    }),
    expectedBaseZoningCodes: stringArray(value.expectedBaseZoningCodes, {
      maximum: 100
    }),
    kind: value.kind,
    observedZoningCodes: stringArray(value.observedZoningCodes, {
      maximum: 100
    }),
    overlayFlags: stringArray(value.overlayFlags, { maximum: 100 })
  };
}

function validateQuestionApplicability(value) {
  exactRecord(value, [
    "catalogEntryIds", "categoryPaths", "expectedBaseZoningCodes", "kind",
    "locationFixtureIds", "observedZoningCodes", "overlayFlags", "scenarioIds"
  ], "question_applicability");
  if (value.kind !== "observed_only") {
    throw new Error("opencounter_master_questionnaire_applicability_invalid");
  }
  return {
    catalogEntryIds: stringArray(value.catalogEntryIds, {
      maximum: 126,
      requireNonEmpty: true
    }),
    categoryPaths: stringArray(value.categoryPaths, {
      maximum: 126,
      requireNonEmpty: true
    }),
    expectedBaseZoningCodes: stringArray(value.expectedBaseZoningCodes, {
      maximum: 100
    }),
    kind: value.kind,
    locationFixtureIds: stringArray(value.locationFixtureIds, {
      maximum: 1_000,
      requireNonEmpty: true
    }),
    observedZoningCodes: stringArray(value.observedZoningCodes, {
      maximum: 100
    }),
    overlayFlags: stringArray(value.overlayFlags, { maximum: 100 }),
    scenarioIds: stringArray(value.scenarioIds, {
      maximum: 1_000,
      requireNonEmpty: true
    })
  };
}

function validateTransitionCollection(value, transitionKey, schemaVersion) {
  exactRecord(value, ["knowledgeStatus", transitionKey], "transition_collection");
  if (!Array.isArray(value[transitionKey])
    || value[transitionKey].length > 10_000) {
    throw new Error("opencounter_master_questionnaire_transitions_invalid");
  }
  const transitions = value[transitionKey].map((transition) =>
    validateTransition(transition, schemaVersion));
  const knowledgeStatus = transitions.length > 0
    ? "observed_partial"
    : "unobserved";
  if (value.knowledgeStatus !== knowledgeStatus) {
    throw new Error("opencounter_master_questionnaire_transition_knowledge_invalid");
  }
  const sortedTransitions = [...transitions].sort(compareTransitions);
  if (JSON.stringify(transitions) !== JSON.stringify(sortedTransitions)) {
    throw new Error("opencounter_master_questionnaire_transitions_order_invalid");
  }
  return {
    knowledgeStatus,
    [transitionKey]: transitions
  };
}

function validateTransition(value, schemaVersion) {
  const keys = [
    "answerValue", "expectedBaseZoningCodes", "firstObservedAt",
    "independentObservationCount", "lastObservedAt", "locationFixtureIds",
    "observationCount", "observedZoningCodes", "sourceQuestionId",
    "targetQuestionId", "terminalStatus"
  ];
  if (schemaVersion >= 2) keys.push("terminalClassifications");
  if (schemaVersion >= 3) keys.push("applicability");
  exactRecord(value, keys, "transition");
  if (!text(value.answerValue, 2_000)
    || !QUESTION_ID_PATTERN.test(value.sourceQuestionId)
    || value.targetQuestionId !== null
      && !QUESTION_ID_PATTERN.test(value.targetQuestionId)
    || value.terminalStatus !== null && !text(value.terminalStatus, 100)
    || (value.targetQuestionId === null) === (value.terminalStatus === null)
    || !Number.isSafeInteger(value.independentObservationCount)
    || value.independentObservationCount < 1
    || !Number.isSafeInteger(value.observationCount)
    || value.observationCount < value.independentObservationCount) {
    throw new Error("opencounter_master_questionnaire_transition_invalid");
  }
  timestamp(value.firstObservedAt, "transition_firstObservedAt");
  timestamp(value.lastObservedAt, "transition_lastObservedAt");
  if (Date.parse(value.firstObservedAt) > Date.parse(value.lastObservedAt)) {
    throw new Error("opencounter_master_questionnaire_transition_time_invalid");
  }
  const terminalClassifications = schemaVersion >= 2
    ? validateTerminalClassifications(value.terminalClassifications)
    : null;
  const applicability = schemaVersion >= 3
    ? validateTransitionApplicability(value.applicability)
    : null;
  if (schemaVersion >= 2
    && (value.terminalStatus === null
      ? terminalClassifications.length !== 0
      : terminalClassifications.length < 1)) {
    throw new Error(
      "opencounter_master_questionnaire_terminal_classifications_invalid"
    );
  }
  return {
    answerValue: value.answerValue,
    ...(schemaVersion >= 3 ? { applicability } : {}),
    expectedBaseZoningCodes: stringArray(value.expectedBaseZoningCodes, {
      maximum: 100
    }),
    firstObservedAt: value.firstObservedAt,
    independentObservationCount: value.independentObservationCount,
    lastObservedAt: value.lastObservedAt,
    locationFixtureIds: stringArray(value.locationFixtureIds, {
      maximum: 1_000,
      requireNonEmpty: true
    }),
    observationCount: value.observationCount,
    observedZoningCodes: stringArray(value.observedZoningCodes, {
      maximum: 100
    }),
    sourceQuestionId: value.sourceQuestionId,
    targetQuestionId: value.targetQuestionId,
    ...(schemaVersion >= 2 ? { terminalClassifications } : {}),
    terminalStatus: value.terminalStatus
  };
}

function validateTransitionApplicability(value) {
  exactRecord(value, [
    "catalogEntryIds", "categoryPaths", "expectedBaseZoningCodes",
    "kind", "locationFixtureIds", "observedZoningCodes", "overlayFlags",
    "scenarioIds"
  ], "transition_applicability");
  if (value.kind !== "observed_only") {
    throw new Error("opencounter_master_questionnaire_applicability_invalid");
  }
  return {
    catalogEntryIds: stringArray(value.catalogEntryIds, {
      maximum: 126,
      requireNonEmpty: true
    }),
    categoryPaths: stringArray(value.categoryPaths, {
      maximum: 126,
      requireNonEmpty: true
    }),
    expectedBaseZoningCodes: stringArray(value.expectedBaseZoningCodes, {
      maximum: 100,
      requireNonEmpty: true
    }),
    kind: value.kind,
    locationFixtureIds: stringArray(value.locationFixtureIds, {
      maximum: 1_000,
      requireNonEmpty: true
    }),
    observedZoningCodes: stringArray(value.observedZoningCodes, {
      maximum: 100
    }),
    overlayFlags: stringArray(value.overlayFlags, { maximum: 100 }),
    scenarioIds: stringArray(value.scenarioIds, {
      maximum: 1_000,
      requireNonEmpty: true
    })
  };
}

function validateConfidence(value) {
  exactRecord(value, [
    "evidenceLevel", "exhaustivenessEstablished", "independentObservationCount",
    "limitation", "observationCount"
  ], "confidence");
  if (!["observed_once", "observed_repeatedly"].includes(value.evidenceLevel)
    || value.exhaustivenessEstablished !== false
    || !Number.isSafeInteger(value.independentObservationCount)
    || value.independentObservationCount < 1
    || !Number.isSafeInteger(value.observationCount)
    || value.observationCount < value.independentObservationCount
    || value.limitation !== OBSERVED_ONLY_LIMITATION
    || value.evidenceLevel !== (value.independentObservationCount > 1
      ? "observed_repeatedly"
      : "observed_once")) {
    throw new Error("opencounter_master_questionnaire_confidence_invalid");
  }
  return structuredClone(value);
}

function validateTerminalClassifications(values) {
  if (!Array.isArray(values)
    || values.length > TERMINAL_CLASSIFICATIONS.size + 1
    || values.some((classification) => classification !== null
      && !TERMINAL_CLASSIFICATIONS.has(classification))
    || new Set(values).size !== values.length
    || JSON.stringify(values) !== JSON.stringify(
      [...values].sort(compareTerminalClassifications)
    )) {
    throw new Error(
      "opencounter_master_questionnaire_terminal_classifications_invalid"
    );
  }
  return [...values];
}

export function compareTerminalClassifications(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

export function compareTransitions(left, right) {
  return left.sourceQuestionId.localeCompare(right.sourceQuestionId)
    || left.answerValue.localeCompare(right.answerValue)
    || (left.targetQuestionId ?? "").localeCompare(right.targetQuestionId ?? "")
    || (left.terminalStatus ?? "").localeCompare(right.terminalStatus ?? "")
    || left.firstObservedAt.localeCompare(right.firstObservedAt);
}

export function createQuestionFamilyId(providerQuestionId) {
  return `ocqf_${sha256({ providerQuestionId })}`;
}

export function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
}

export function stringArray(value, {
  maximum,
  pattern = null,
  requireNonEmpty = false
}) {
  if (!Array.isArray(value)
    || value.length > maximum
    || requireNonEmpty && value.length < 1
    || value.some((entry) => !text(entry, 2_000)
      || pattern !== null && !pattern.test(entry))
    || new Set(value).size !== value.length
    || JSON.stringify(value) !== JSON.stringify([...value].sort(
      (left, right) => left.localeCompare(right)
    ))) {
    throw new Error("opencounter_master_questionnaire_string_array_invalid");
  }
  return [...value];
}

export function text(value, maximum) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

export function timestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  return value;
}

export function sha256(value) {
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
