import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import { validateVerifiedObservationPortfolioSources } from
  "./discovery-observation-portfolio.mjs";
import { createNormalizedQuestionSignatureSha256 } from
  "./discovery-question-graph.mjs";
import { observedZoningCodeForGraph } from
  "./discovery-zoning-context.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;
const QUESTION_ID_PATTERN = /^ocq_[0-9a-f]{64}$/;
const FAMILY_ID_PATTERN = /^ocqf_[0-9a-f]{64}$/;
const QUESTIONNAIRE_ID_PATTERN = /^ocmq_[0-9a-f]{64}$/;
const MAXIMUM_QUESTIONNAIRE_BYTES = 10 * 1024 * 1024;
const COVERAGE_STATUS = "first_pass_observed_non_exhaustive";
const TERMINAL_CLASSIFICATIONS = new Set([
  "Conditional",
  "Permitted",
  "Permitted with Limitations",
  "Prohibited"
]);
const OBSERVED_ONLY_LIMITATION =
  "Observed provider behavior only; normative applicability and branch exhaustiveness are not established.";

export function buildMasterQuestionnaire({
  catalog,
  freeze,
  sourceLedgers
}) {
  const verifiedFreeze = validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: sourceLedgers
  });
  const graph = verifiedFreeze.questionGraph;
  const transitionEvidenceByEdge = buildTransitionEvidenceByEdge(sourceLedgers);
  const familyBuilders = new Map();
  for (const question of graph.questions) {
    let family = familyBuilders.get(question.providerQuestionId);
    if (family === undefined) {
      family = {
        canonicalQuestionIds: new Set(),
        catalogEntryIds: new Set(),
        categoryPaths: new Set(),
        expectedBaseZoningCodes: new Set(),
        observedZoningCodes: new Set(),
        overlayFlags: new Set(),
        providerQuestionId: question.providerQuestionId
      };
      familyBuilders.set(question.providerQuestionId, family);
    }
    family.canonicalQuestionIds.add(question.questionKey);
    addAll(family.catalogEntryIds, question.catalogEntryIds);
    addAll(family.categoryPaths, question.categoryPaths);
    addAll(family.expectedBaseZoningCodes,
      question.expectedBaseZoningCodes ?? []);
    addAll(family.observedZoningCodes, question.observedZoningCodes ?? []);
    addAll(family.overlayFlags, question.overlayFlags ?? []);
  }

  const questionFamilies = [...familyBuilders.values()].map((family) => {
    const canonicalQuestionIds = sorted(family.canonicalQuestionIds);
    const catalogEntryIds = sorted(family.catalogEntryIds);
    return {
      applicability: {
        catalogEntryIds,
        categoryPaths: sorted(family.categoryPaths),
        expectedBaseZoningCodes: sorted(family.expectedBaseZoningCodes),
        kind: "observed_only",
        observedZoningCodes: sorted(family.observedZoningCodes),
        overlayFlags: sorted(family.overlayFlags)
      },
      canonicalQuestionIds,
      familyId: createQuestionFamilyId(family.providerQuestionId),
      providerQuestionId: family.providerQuestionId,
      scope: catalogEntryIds.length === verifiedFreeze.coverage.catalogEntryCount
        ? "observed_universal"
        : "observed_conditional",
      signatureCount: canonicalQuestionIds.length
    };
  }).sort((left, right) =>
    left.providerQuestionId.localeCompare(right.providerQuestionId));
  const familiesByProviderId = new Map(questionFamilies.map((family) => [
    family.providerQuestionId,
    family
  ]));

  const questions = graph.questions.map((question) => {
    const family = familiesByProviderId.get(question.providerQuestionId);
    const incoming = graph.edges
      .filter(({ targetQuestionKey }) => targetQuestionKey === question.questionKey)
      .map((edge) => toObservedTransition(edge, transitionEvidenceByEdge))
      .sort(compareTransitions);
    const outgoing = graph.edges
      .filter(({ sourceQuestionKey }) => sourceQuestionKey === question.questionKey)
      .map((edge) => toObservedTransition(edge, transitionEvidenceByEdge))
      .sort(compareTransitions);
    return {
      applicability: {
        catalogEntryIds: sorted(question.catalogEntryIds),
        categoryPaths: sorted(question.categoryPaths),
        expectedBaseZoningCodes: sorted(question.expectedBaseZoningCodes ?? []),
        kind: "observed_only",
        locationFixtureIds: sorted(question.locationFixtureIds ?? []),
        observedZoningCodes: sorted(question.observedZoningCodes ?? []),
        overlayFlags: sorted(question.overlayFlags ?? []),
        scenarioIds: sorted(question.scenarioIds)
      },
      conditions: {
        knowledgeStatus: incoming.length > 0
          ? "observed_partial"
          : "unobserved",
        observedIncomingTransitions: incoming
      },
      confidence: {
        evidenceLevel: question.independentObservationCount > 1
          ? "observed_repeatedly"
          : "observed_once",
        exhaustivenessEstablished: false,
        independentObservationCount: question.independentObservationCount,
        limitation: OBSERVED_ONLY_LIMITATION,
        observationCount: question.observationCount
      },
      evidence: {
        firstObservedAt: question.firstObservedAt,
        lastObservedAt: question.lastObservedAt,
        sourceFreezeId: verifiedFreeze.freezeId
      },
      familyId: family.familyId,
      internalQuestionId: question.questionKey,
      normalizedSignatureSha256: question.normalizedSignatureSha256,
      options: structuredClone(question.options),
      outcomes: {
        knowledgeStatus: outgoing.length > 0
          ? "observed_partial"
          : "unobserved",
        observedTransitions: outgoing
      },
      prompt: question.prompt,
      providerQuestionId: question.providerQuestionId,
      requiredStatuses: [...question.requiredStatuses].sort(),
      scope: family.scope,
      type: question.type
    };
  }).sort((left, right) =>
    left.internalQuestionId.localeCompare(right.internalQuestionId));

  const universalQuestionFamilyCount = questionFamilies.filter(
    ({ scope }) => scope === "observed_universal"
  ).length;
  const payload = {
    artifactKind: "opencounter_master_questionnaire",
    catalog: {
      catalogEntryCount: verifiedFreeze.coverage.catalogEntryCount,
      catalogId: verifiedFreeze.catalog.catalogId,
      catalogSha256: verifiedFreeze.catalog.catalogSha256,
      tenantId: verifiedFreeze.catalog.tenantId,
      tenantVersion: verifiedFreeze.catalog.tenantVersion
    },
    coverage: {
      canonicalQuestionCount: questions.length,
      conditionalQuestionFamilyCount:
        questionFamilies.length - universalQuestionFamilyCount,
      questionFamilyCount: questionFamilies.length,
      status: COVERAGE_STATUS,
      universalQuestionFamilyCount,
      verifiedObservationCount:
        verifiedFreeze.coverage.verifiedObservationCount
    },
    evidence: {
      evidenceSetSha256: verifiedFreeze.evidenceSetSha256,
      frozenAt: verifiedFreeze.frozenAt,
      sourceFreezeId: verifiedFreeze.freezeId,
      sourceLedgerSnapshotSha256s: verifiedFreeze.sourceLedgers.map(
        ({ ledgerSnapshotSha256 }) => ledgerSnapshotSha256
      )
    },
    libraryVersion: 3,
    questionFamilies,
    questions,
    schemaVersion: 3
  };
  const questionnaireSha256 = sha256(payload);
  return validateMasterQuestionnaire({
    ...payload,
    questionnaireId: `ocmq_${questionnaireSha256}`,
    questionnaireSha256
  });
}

export function validateMasterQuestionnaire(value) {
  exactRecord(value, [
    "artifactKind", "catalog", "coverage", "evidence", "libraryVersion",
    "questionFamilies", "questionnaireId", "questionnaireSha256", "questions",
    "schemaVersion"
  ], "artifact");
  if (value.artifactKind !== "opencounter_master_questionnaire"
    || ![[1, 1], [2, 2], [3, 3]].some(([schemaVersion, libraryVersion]) =>
      value.schemaVersion === schemaVersion
      && value.libraryVersion === libraryVersion)
    || !QUESTIONNAIRE_ID_PATTERN.test(value.questionnaireId)
    || !SHA256_PATTERN.test(value.questionnaireSha256)
    || value.questionnaireId !== `ocmq_${value.questionnaireSha256}`) {
    throw new Error("opencounter_master_questionnaire_artifact_invalid");
  }
  const catalog = validateCatalogIdentity(value.catalog);
  const evidence = validateEvidence(value.evidence);
  const families = validateFamilies(value.questionFamilies, catalog);
  const questions = validateQuestions(
    value.questions,
    families,
    evidence,
    value.schemaVersion
  );
  const coverage = validateCoverage(value.coverage, families, questions, catalog);
  const payload = {
    artifactKind: value.artifactKind,
    catalog,
    coverage,
    evidence,
    libraryVersion: value.libraryVersion,
    questionFamilies: families,
    questions,
    schemaVersion: value.schemaVersion
  };
  if (sha256(payload) !== value.questionnaireSha256) {
    throw new Error("opencounter_master_questionnaire_digest_mismatch");
  }
  return {
    ...payload,
    questionnaireId: value.questionnaireId,
    questionnaireSha256: value.questionnaireSha256
  };
}

export function createMasterQuestionnaireStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "state_directory");
  const directory = path.join(root, "master-questionnaires");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  privateDirectory(directory, "questionnaire_directory");
  return {
    read(questionnaireSha256) {
      return readQuestionnaire(
        resolveQuestionnairePath(directory, questionnaireSha256),
        questionnaireSha256
      );
    },
    write(value) {
      const questionnaire = validateMasterQuestionnaire(value);
      const serialized = `${JSON.stringify(questionnaire, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_QUESTIONNAIRE_BYTES) {
        throw new Error("opencounter_master_questionnaire_too_large");
      }
      const questionnairePath = resolveQuestionnairePath(
        directory,
        questionnaire.questionnaireSha256
      );
      if (existsSync(questionnairePath)) {
        readQuestionnaire(questionnairePath, questionnaire.questionnaireSha256);
        return {
          bytes,
          path: questionnairePath,
          questionnaireSha256: questionnaire.questionnaireSha256
        };
      }
      const temporaryPath = path.join(
        directory,
        `${questionnaire.questionnaireSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, questionnairePath);
        unlinkSync(temporaryPath);
        chmodSync(questionnairePath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readQuestionnaire(questionnairePath, questionnaire.questionnaireSha256);
          return {
            bytes,
            path: questionnairePath,
            questionnaireSha256: questionnaire.questionnaireSha256
          };
        }
        throw error;
      }
      return {
        bytes,
        path: questionnairePath,
        questionnaireSha256: questionnaire.questionnaireSha256
      };
    }
  };
}

function validateCatalogIdentity(value) {
  exactRecord(value, [
    "catalogEntryCount", "catalogId", "catalogSha256", "tenantId",
    "tenantVersion"
  ], "catalog");
  if (value.catalogEntryCount !== 126
    || !text(value.catalogId, 200)
    || !SHA256_PATTERN.test(value.catalogSha256)
    || !Number.isSafeInteger(value.tenantId)
    || value.tenantId < 1
    || !Number.isSafeInteger(value.tenantVersion)
    || value.tenantVersion < 1) {
    throw new Error("opencounter_master_questionnaire_catalog_invalid");
  }
  return structuredClone(value);
}

function validateEvidence(value) {
  exactRecord(value, [
    "evidenceSetSha256", "frozenAt", "sourceFreezeId",
    "sourceLedgerSnapshotSha256s"
  ], "evidence");
  const snapshots = stringArray(value.sourceLedgerSnapshotSha256s, {
    maximum: 10,
    pattern: SHA256_PATTERN,
    requireNonEmpty: true
  });
  if (!SHA256_PATTERN.test(value.evidenceSetSha256)
    || !FREEZE_ID_PATTERN.test(value.sourceFreezeId)) {
    throw new Error("opencounter_master_questionnaire_evidence_invalid");
  }
  timestamp(value.frozenAt, "evidence_frozenAt");
  return {
    evidenceSetSha256: value.evidenceSetSha256,
    frozenAt: value.frozenAt,
    sourceFreezeId: value.sourceFreezeId,
    sourceLedgerSnapshotSha256s: snapshots
  };
}

function validateFamilies(values, catalog) {
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

function validateQuestions(values, families, evidence, schemaVersion) {
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

function validateCoverage(value, families, questions, catalog) {
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

function toObservedTransition(edge, transitionEvidenceByEdge) {
  const identity = transitionIdentity({
    answerValue: edge.answerValue,
    sourceQuestionId: edge.sourceQuestionKey,
    targetQuestionId: edge.targetQuestionKey,
    terminalStatus: edge.terminalStatus
  });
  const evidence = transitionEvidenceByEdge.get(identity);
  if (evidence === undefined
    || evidence.observationCount !== edge.observationCount
    || evidence.independentJobIds.size !== edge.independentObservationCount
    || !sameSorted(evidence.expectedBaseZoningCodes,
      edge.expectedBaseZoningCodes ?? [])
    || !sameSorted(evidence.locationFixtureIds, edge.locationFixtureIds ?? [])
    || !sameSorted(evidence.observedZoningCodes,
      edge.observedZoningCodes ?? [])) {
    throw new Error(
      "opencounter_master_questionnaire_transition_evidence_mismatch"
    );
  }
  return {
    answerValue: edge.answerValue,
    applicability: {
      catalogEntryIds: sorted(evidence.catalogEntryIds),
      categoryPaths: sorted(evidence.categoryPaths),
      expectedBaseZoningCodes: sorted(evidence.expectedBaseZoningCodes),
      kind: "observed_only",
      locationFixtureIds: sorted(evidence.locationFixtureIds),
      observedZoningCodes: sorted(evidence.observedZoningCodes),
      overlayFlags: sorted(evidence.overlayFlags),
      scenarioIds: sorted(evidence.scenarioIds)
    },
    expectedBaseZoningCodes: sorted(edge.expectedBaseZoningCodes ?? []),
    firstObservedAt: edge.firstObservedAt,
    independentObservationCount: edge.independentObservationCount,
    lastObservedAt: edge.lastObservedAt,
    locationFixtureIds: sorted(edge.locationFixtureIds ?? []),
    observationCount: edge.observationCount,
    observedZoningCodes: sorted(edge.observedZoningCodes ?? []),
    sourceQuestionId: edge.sourceQuestionKey,
    targetQuestionId: edge.targetQuestionKey,
    terminalClassifications: [...evidence.terminalClassifications]
      .sort(compareTerminalClassifications),
    terminalStatus: edge.terminalStatus
  };
}

function buildTransitionEvidenceByEdge(sourceLedgers) {
  const evidenceByEdge = new Map();
  for (const ledger of sourceLedgers) {
    for (const job of ledger.jobs) {
      const classification = job.terminalResult !== null
        && Object.hasOwn(job.terminalResult, "classification")
        ? job.terminalResult.classification
        : null;
      if (classification !== null
        && !TERMINAL_CLASSIFICATIONS.has(classification)) {
        throw new Error(
          "opencounter_master_questionnaire_terminal_classification_unknown"
        );
      }
      for (let index = 1; index < job.observations.length; index += 1) {
        const previous = job.observations[index - 1];
        const current = job.observations[index];
        for (const answer of current.answers) {
          const sourceQuestion = previous.questions.find(
            (question) => question.id === answer.questionId
          );
          if (sourceQuestion === undefined) {
            throw new Error(
              "opencounter_master_questionnaire_answer_path_invalid"
            );
          }
          const destinations = current.questions.length > 0
            ? current.questions.map((question) => ({
              targetQuestionId: createQuestionId(question),
              terminalStatus: null
            }))
            : [{
              targetQuestionId: null,
              terminalStatus: current.resultStatus
            }];
          for (const destination of destinations) {
            const identity = transitionIdentity({
              answerValue: answer.value,
              sourceQuestionId: createQuestionId(sourceQuestion),
              ...destination
            });
            let evidence = evidenceByEdge.get(identity);
            if (evidence === undefined) {
              evidence = {
                catalogEntryIds: new Set(),
                categoryPaths: new Set(),
                expectedBaseZoningCodes: new Set(),
                independentJobIds: new Set(),
                locationFixtureIds: new Set(),
                observationCount: 0,
                observedZoningCodes: new Set(),
                overlayFlags: new Set(),
                scenarioIds: new Set(),
                terminalClassifications: new Set()
              };
              evidenceByEdge.set(identity, evidence);
            }
            evidence.catalogEntryIds.add(job.catalogEntryId);
            evidence.categoryPaths.add(job.categoryPath.join(" / "));
            evidence.expectedBaseZoningCodes.add(
              job.locationFixture.expectedBaseZoningCode
            );
            evidence.independentJobIds.add(job.jobId);
            evidence.locationFixtureIds.add(
              `${job.locationFixture.locationId}:${job.locationFixture.locationVersion}`
            );
            evidence.observationCount += 1;
            const observedZoningCode = observedZoningCodeForGraph(job);
            if (observedZoningCode !== null) {
              evidence.observedZoningCodes.add(observedZoningCode);
            }
            addAll(evidence.overlayFlags, job.locationFixture.overlayFlags);
            evidence.scenarioIds.add(
              `${job.scenario.scenarioId}:${job.scenario.scenarioVersion}`
            );
            if (destination.terminalStatus !== null) {
              evidence.terminalClassifications.add(classification);
            }
          }
        }
      }
    }
  }
  return evidenceByEdge;
}

function createQuestionId(question) {
  const normalizedSignatureSha256 =
    createNormalizedQuestionSignatureSha256(question);
  return `ocq_${sha256({
    normalizedSignatureSha256,
    providerQuestionId: question.id
  })}`;
}

function transitionIdentity({
  answerValue,
  sourceQuestionId,
  targetQuestionId,
  terminalStatus
}) {
  return JSON.stringify([
    sourceQuestionId,
    answerValue,
    targetQuestionId,
    terminalStatus
  ]);
}

function sameSorted(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
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

function compareTerminalClassifications(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

function compareTransitions(left, right) {
  return left.sourceQuestionId.localeCompare(right.sourceQuestionId)
    || left.answerValue.localeCompare(right.answerValue)
    || (left.targetQuestionId ?? "").localeCompare(right.targetQuestionId ?? "")
    || (left.terminalStatus ?? "").localeCompare(right.terminalStatus ?? "")
    || left.firstObservedAt.localeCompare(right.firstObservedAt);
}

function createQuestionFamilyId(providerQuestionId) {
  return `ocqf_${sha256({ providerQuestionId })}`;
}

function readQuestionnaire(questionnairePath, expectedSha256) {
  const metadata = lstatSync(questionnairePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 1 || metadata.size > MAXIMUM_QUESTIONNAIRE_BYTES) {
    throw new Error("opencounter_master_questionnaire_file_invalid");
  }
  chmodSync(questionnairePath, 0o600);
  let value;
  try {
    value = JSON.parse(readFileSync(questionnairePath, "utf8"));
  } catch {
    throw new Error("opencounter_master_questionnaire_json_invalid");
  }
  const questionnaire = validateMasterQuestionnaire(value);
  if (questionnaire.questionnaireSha256 !== expectedSha256) {
    throw new Error("opencounter_master_questionnaire_digest_mismatch");
  }
  return questionnaire;
}

function resolveQuestionnairePath(directory, questionnaireSha256) {
  if (!SHA256_PATTERN.test(questionnaireSha256)) {
    throw new Error("opencounter_master_questionnaire_digest_invalid");
  }
  return path.join(directory, `${questionnaireSha256}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || !path.isAbsolute(value)) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const metadata = lstatSync(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
}

function stringArray(value, {
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

function text(value, maximum) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function timestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_master_questionnaire_${label}_invalid`);
  }
  return value;
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
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
