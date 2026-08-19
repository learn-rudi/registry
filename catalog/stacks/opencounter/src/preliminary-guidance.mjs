import { createHash } from "node:crypto";

import { addressesReferToSameCincinnatiStreet } from
  "./address-normalization.mjs";
import { validateMasterQuestionnaire } from
  "./discovery-master-questionnaire.mjs";
import { validateZoningCatalog } from "./zoning-catalog.mjs";

const CATALOG_ENTRY_ID_PATTERN =
  /^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*)+$/;
const QUESTION_ID_PATTERN = /^ocq_[0-9a-f]{64}$/;
const ZONING_CODE_PATTERN = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;
const CLASSIFICATION_MAP = new Map([
  ["Conditional", "conditional"],
  ["Permitted", "likely_permitted"],
  ["Permitted with Limitations", "permitted_with_limitations"],
  ["Prohibited", "likely_prohibited"]
]);
const LIMITATIONS = [
  "Observed OpenCounter behavior is not a normative zoning-code determination.",
  "The questionnaire is observed evidence and does not establish branch exhaustiveness.",
  "Physical feasibility, development-envelope constraints, and remaining approvals are outside this result."
];

export function evaluatePreliminaryGuidance(input) {
  exactRecord(input, [
    "answers", "candidateUses", "catalog", "questionnaire", "request",
    "siteContext"
  ], "input");
  const catalog = validateZoningCatalog(input.catalog);
  const questionnaire = validateMasterQuestionnaire(input.questionnaire);
  if (questionnaire.schemaVersion < 3
    || questionnaire.catalog.catalogId !== catalog.catalogId
    || questionnaire.catalog.catalogSha256 !== catalog.catalogSha256
    || questionnaire.catalog.tenantId !== catalog.provider.tenantId
    || questionnaire.catalog.tenantVersion !== catalog.provider.tenantVersion) {
    throw new Error("opencounter_preliminary_guidance_version_mismatch");
  }
  const entries = indexCatalogEntries(catalog);
  const request = validateRequest(input.request);
  const siteContext = validateSiteContext(input.siteContext, request);
  const candidateUses = validateCandidateUses(input.candidateUses, entries);
  const questionsById = new Map(questionnaire.questions.map((question) => [
    question.internalQuestionId,
    question
  ]));
  const answers = validateAnswers(input.answers, questionsById, siteContext);
  const base = {
    artifactKind: "opencounter_preliminary_guidance",
    evidence: {
      catalogId: catalog.catalogId,
      catalogSha256: catalog.catalogSha256,
      questionnaireId: questionnaire.questionnaireId,
      questionnaireSha256: questionnaire.questionnaireSha256,
      sourceFreezeId: questionnaire.evidence.sourceFreezeId,
      tenantId: catalog.provider.tenantId,
      tenantVersion: catalog.provider.tenantVersion
    },
    limitations: [...LIMITATIONS],
    request,
    schemaVersion: 1
  };

  if (siteContext === null) {
    if (answers.length > 0) {
      throw new Error("opencounter_preliminary_guidance_site_required");
    }
    return finalize({
      ...base,
      assessments: [],
      candidateUses,
      nextQuestions: [],
      preliminaryClassification: "insufficient_information",
      providerConfirmation: providerConfirmation(false, []),
      siteContext: null,
      status: "needs_site_resolution"
    });
  }
  if (candidateUses.length === 0) {
    if (answers.length > 0) {
      throw new Error("opencounter_preliminary_guidance_use_required");
    }
    return finalize({
      ...base,
      assessments: [],
      candidateUses,
      nextQuestions: [],
      preliminaryClassification: "insufficient_information",
      providerConfirmation: providerConfirmation(false, []),
      siteContext,
      status: "needs_use_mapping"
    });
  }
  if (candidateUses.some(({ mappingBasis }) =>
    mappingBasis !== "requester_confirmed")) {
    if (answers.length > 0) {
      throw new Error("opencounter_preliminary_guidance_use_confirmation_required");
    }
    return finalize({
      ...base,
      assessments: [],
      candidateUses,
      nextQuestions: [],
      preliminaryClassification: "insufficient_information",
      providerConfirmation: providerConfirmation(false, []),
      siteContext,
      status: "needs_use_confirmation"
    });
  }

  const answersByQuestionId = new Map(answers.map((answer) => [
    answer.internalQuestionId,
    answer
  ]));
  const usedAnswerIds = new Set();
  const assessments = candidateUses.map((candidateUse) => assessUse({
    answersByQuestionId,
    candidateUse,
    entry: entries.get(candidateUse.catalogEntryId),
    questionnaire,
    questionsById,
    siteContext,
    usedAnswerIds
  }));
  const unusedAnswer = answers.find(
    ({ internalQuestionId }) => !usedAnswerIds.has(internalQuestionId)
  );
  if (unusedAnswer !== undefined) {
    throw new Error("opencounter_preliminary_guidance_answer_not_applicable");
  }
  const nextQuestions = mergeNextQuestions(assessments);
  const reasons = new Set(["observed_library_not_exhaustive"]);
  for (const assessment of assessments) {
    for (const reason of assessment.reasons) reasons.add(reason);
  }
  const classifications = new Set(assessments.map(
    ({ preliminaryClassification }) => preliminaryClassification
  ));
  let status;
  let preliminaryClassification = "insufficient_information";
  if (nextQuestions.length > 0) {
    status = "needs_project_input";
  } else if (classifications.size === 1
    && !classifications.has("insufficient_information")) {
    status = "preliminary_result";
    preliminaryClassification = [...classifications][0];
  } else {
    status = "needs_provider_confirmation";
    if (classifications.size > 1) reasons.add("candidate_use_outcomes_conflict");
  }
  return finalize({
    ...base,
    assessments,
    candidateUses,
    nextQuestions,
    preliminaryClassification,
    providerConfirmation: providerConfirmation(
      nextQuestions.length === 0,
      [...reasons]
    ),
    siteContext,
    status
  });
}

export function validatePreliminaryGuidance(value) {
  exactRecord(value, [
    "artifactKind", "assessments", "candidateUses", "decisionId",
    "decisionSha256", "evidence", "limitations", "nextQuestions",
    "preliminaryClassification", "providerConfirmation", "request",
    "schemaVersion", "siteContext", "status"
  ], "artifact");
  if (value.artifactKind !== "opencounter_preliminary_guidance"
    || value.schemaVersion !== 1
    || !/^ocpg_[0-9a-f]{64}$/.test(value.decisionId)
    || !/^[0-9a-f]{64}$/.test(value.decisionSha256)
    || value.decisionId !== `ocpg_${value.decisionSha256}`
    || ![
      "needs_project_input",
      "needs_provider_confirmation",
      "needs_site_resolution",
      "needs_use_confirmation",
      "needs_use_mapping",
      "preliminary_result"
    ].includes(value.status)
    || ![
      "conditional",
      "insufficient_information",
      "likely_permitted",
      "likely_prohibited",
      "permitted_with_limitations"
    ].includes(value.preliminaryClassification)) {
    throw new Error("opencounter_preliminary_guidance_artifact_invalid");
  }
  const request = validateRequest(value.request);
  validateSiteContext(value.siteContext, request);
  exactRecord(value.evidence, [
    "catalogId", "catalogSha256", "questionnaireId",
    "questionnaireSha256", "sourceFreezeId", "tenantId", "tenantVersion"
  ], "artifact_evidence");
  if (!boundedArtifactText(value.evidence.catalogId, 200)
    || !/^[0-9a-f]{64}$/.test(value.evidence.catalogSha256)
    || !/^ocmq_[0-9a-f]{64}$/.test(value.evidence.questionnaireId)
    || !/^[0-9a-f]{64}$/.test(value.evidence.questionnaireSha256)
    || value.evidence.questionnaireId
      !== `ocmq_${value.evidence.questionnaireSha256}`
    || !/^ocof_[0-9a-f]{64}$/.test(value.evidence.sourceFreezeId)
    || !Number.isSafeInteger(value.evidence.tenantId)
    || value.evidence.tenantId < 1
    || !Number.isSafeInteger(value.evidence.tenantVersion)
    || value.evidence.tenantVersion < 1) {
    throw new Error("opencounter_preliminary_guidance_evidence_invalid");
  }
  exactRecord(value.providerConfirmation, [
    "authorizationGranted", "recommendationOnly", "recommended", "reasons"
  ], "provider_confirmation");
  if (value.providerConfirmation.authorizationGranted !== false
    || value.providerConfirmation.recommendationOnly !== true
    || typeof value.providerConfirmation.recommended !== "boolean") {
    throw new Error(
      "opencounter_preliminary_guidance_provider_confirmation_invalid"
    );
  }
  stringArray(value.providerConfirmation.reasons, 100);
  if (!Array.isArray(value.limitations)
    || JSON.stringify(value.limitations) !== JSON.stringify(LIMITATIONS)
    || !boundedObjectArray(value.assessments, 20)
    || !boundedObjectArray(value.candidateUses, 20)
    || !boundedObjectArray(value.nextQuestions, 200)
    || Buffer.byteLength(JSON.stringify(value), "utf8") > 5 * 1024 * 1024) {
    throw new Error("opencounter_preliminary_guidance_artifact_invalid");
  }
  if (value.status === "preliminary_result"
    && (value.preliminaryClassification === "insufficient_information"
      || value.siteContext === null)
    || value.status !== "preliminary_result"
      && value.preliminaryClassification !== "insufficient_information") {
    throw new Error("opencounter_preliminary_guidance_status_invalid");
  }
  const { decisionId: _decisionId, decisionSha256: _digest, ...payload } = value;
  if (sha256(payload) !== value.decisionSha256) {
    throw new Error("opencounter_preliminary_guidance_digest_mismatch");
  }
  return structuredClone(value);
}

function assessUse({
  answersByQuestionId,
  candidateUse,
  entry,
  questionnaire,
  questionsById,
  siteContext,
  usedAnswerIds
}) {
  const relevantQuestions = questionnaire.questions.filter((question) =>
    question.providerQuestionId !== "opencounter-address"
    && question.applicability.catalogEntryIds.includes(
      candidateUse.catalogEntryId
    ));
  const relevantIds = new Set(relevantQuestions.map(
    ({ internalQuestionId }) => internalQuestionId
  ));
  const addressQuestions = questionnaire.questions.filter(
    ({ providerQuestionId }) => providerQuestionId === "opencounter-address"
  );
  const addressQuestionIds = new Set(addressQuestions
    .map(({ internalQuestionId }) => internalQuestionId));
  const addressTerminalEvidence = buildAddressTerminalPaths({
    addressQuestions,
    candidateUse,
    siteContext
  });
  const addressTerminalPaths = addressTerminalEvidence.paths;
  const predictedQuestionIds = new Set(addressTerminalPaths.map(
    ({ sourceQuestionId }) => sourceQuestionId
  ));
  const rootQuestions = [];
  for (const question of relevantQuestions) {
    if (question.conditions.observedIncomingTransitions.length === 0) {
      if (addressTerminalPaths.length === 0
        || rootMatchesAddressTerminalContext(
          question,
          addressTerminalEvidence.contexts
        )) {
        rootQuestions.push(question);
      }
      continue;
    }
    const addressTransitions = question.conditions.observedIncomingTransitions
      .filter((transition) =>
        addressQuestionIds.has(transition.sourceQuestionId)
        && addressesReferToSameCincinnatiStreet(
          transition.answerValue,
          siteContext.matchedAddress
        )
        && matchingTransitionContexts(
          transition,
          candidateUse.catalogEntryId,
          siteContext
        ).length > 0);
    if (addressTransitions.length > 0) {
      rootQuestions.push(question);
      addressTransitions.forEach(({ sourceQuestionId }) =>
        predictedQuestionIds.add(sourceQuestionId));
    }
  }
  const queue = [...rootQuestions].sort(compareQuestions);
  const visited = new Set();
  const nextQuestions = [];
  const observedPaths = [...addressTerminalPaths];
  const reasons = new Set();
  while (queue.length > 0) {
    const question = queue.shift();
    if (visited.has(question.internalQuestionId)) continue;
    visited.add(question.internalQuestionId);
    predictedQuestionIds.add(question.internalQuestionId);
    if (!contextMatches(question.applicability, siteContext)) {
      reasons.add("zoning_context_not_observed");
    }
    const answer = answersByQuestionId.get(question.internalQuestionId);
    if (answer === undefined) {
      nextQuestions.push(toNextQuestion(question, candidateUse.catalogEntryId));
      continue;
    }
    usedAnswerIds.add(question.internalQuestionId);
    const useTransitions = question.outcomes.observedTransitions.filter(
      (transition) => transition.answerValue === answer.value
        && transition.applicability.catalogEntryIds.includes(
          candidateUse.catalogEntryId
        )
    );
    const transitions = useTransitions.map((transition) => ({
      contexts: matchingTransitionContexts(
        transition,
        candidateUse.catalogEntryId,
        siteContext
      ),
      transition
    })).filter(({ contexts }) => contexts.length > 0);
    if (transitions.length === 0) {
      reasons.add(useTransitions.length > 0
        ? "zoning_context_not_observed"
        : "answer_branch_unobserved");
      continue;
    }
    for (const { contexts, transition } of transitions) {
      if (transition.targetQuestionId !== null) {
        const target = questionsById.get(transition.targetQuestionId);
        if (target === undefined || !relevantIds.has(target.internalQuestionId)) {
          throw new Error(
            "opencounter_preliminary_guidance_transition_link_invalid"
          );
        }
        queue.push(target);
        queue.sort(compareQuestions);
        continue;
      }
      const scopedEvidence = scopeTerminalTransitionEvidence(
        transition,
        contexts
      );
      observedPaths.push({
        answer: {
          evidenceRefs: [...answer.evidenceRefs],
          source: answer.source,
          value: answer.value
        },
        firstObservedAt: scopedEvidence.firstObservedAt,
        independentObservationCount:
          scopedEvidence.independentObservationCount,
        lastObservedAt: scopedEvidence.lastObservedAt,
        observationCount: scopedEvidence.observationCount,
        sourceQuestionId: transition.sourceQuestionId,
        terminalClassifications: scopedEvidence.terminalClassifications,
        terminalStatus: transition.terminalStatus
      });
    }
  }
  if (rootQuestions.length === 0 && observedPaths.length === 0) {
    reasons.add("question_entry_path_unobserved");
  }
  let preliminaryClassification = "insufficient_information";
  if (nextQuestions.length === 0 && reasons.size === 0) {
    const classifications = new Set(observedPaths.flatMap(
      ({ terminalClassifications }) => terminalClassifications
    ));
    if (classifications.has(null)) {
      reasons.add("terminal_classification_missing");
    } else if (classifications.size === 1) {
      preliminaryClassification = CLASSIFICATION_MAP.get(
        [...classifications][0]
      ) ?? "insufficient_information";
    } else if (classifications.size > 1) {
      reasons.add("observed_terminal_classifications_conflict");
    } else {
      reasons.add("terminal_path_unobserved");
    }
  }
  return {
    catalogEntryId: candidateUse.catalogEntryId,
    categoryPath: [...entry.categoryPath],
    observedPaths: observedPaths.sort(compareObservedPaths),
    preliminaryClassification,
    predictedQuestionIds: [...predictedQuestionIds].sort(
      (left, right) => left.localeCompare(right)
    ),
    providerLabel: entry.providerLabel,
    reasons: [...reasons].sort((left, right) => left.localeCompare(right)),
    remainingQuestions: nextQuestions.sort(compareQuestions)
  };
}

function buildAddressTerminalPaths({
  addressQuestions,
  candidateUse,
  siteContext
}) {
  const evidenceRefs = siteContext.evidence.map(({ evidenceRef }) => evidenceRef);
  const matchedContexts = [];
  const paths = [];
  for (const question of addressQuestions) {
    for (const transition of question.outcomes.observedTransitions) {
      if (transition.terminalStatus === null
        || !Array.isArray(transition.contextEvidence)
        || !addressesReferToSameCincinnatiStreet(
          transition.answerValue,
          siteContext.matchedAddress
        )) {
        continue;
      }
      const contexts = matchingTransitionContexts(
        transition,
        candidateUse.catalogEntryId,
        siteContext
      );
      if (contexts.length === 0) continue;
      const scopedEvidence = scopeTerminalTransitionEvidence(
        transition,
        contexts
      );
      matchedContexts.push(...contexts);
      paths.push({
        answer: {
          evidenceRefs: [...evidenceRefs],
          source: "site_evidence",
          value: transition.answerValue
        },
        firstObservedAt: scopedEvidence.firstObservedAt,
        independentObservationCount:
          scopedEvidence.independentObservationCount,
        lastObservedAt: scopedEvidence.lastObservedAt,
        observationCount: scopedEvidence.observationCount,
        sourceQuestionId: transition.sourceQuestionId,
        terminalClassifications: scopedEvidence.terminalClassifications,
        terminalStatus: transition.terminalStatus
      });
    }
  }
  return {
    contexts: matchedContexts,
    paths: paths.sort(compareObservedPaths)
  };
}

function rootMatchesAddressTerminalContext(question, contexts) {
  return contexts.some(({ applicability }) =>
    applicability.locationFixtureIds.some((fixtureId) =>
      question.applicability.locationFixtureIds.includes(fixtureId))
    && applicability.scenarioIds.some((scenarioId) =>
      question.applicability.scenarioIds.includes(scenarioId)));
}

function matchingTransitionContexts(transition, catalogEntryId, siteContext) {
  if (!Array.isArray(transition.contextEvidence)) {
    return transition.applicability.catalogEntryIds.includes(catalogEntryId)
      && contextMatches(transition.applicability, siteContext)
      ? [null]
      : [];
  }
  return transition.contextEvidence.filter(({ applicability }) =>
    applicability.catalogEntryIds.includes(catalogEntryId)
    && contextMatches(applicability, siteContext));
}

function scopeTerminalTransitionEvidence(transition, contexts) {
  if (contexts.length === 1 && contexts[0] === null) {
    return {
      firstObservedAt: transition.firstObservedAt,
      independentObservationCount: transition.independentObservationCount,
      lastObservedAt: transition.lastObservedAt,
      observationCount: transition.observationCount,
      terminalClassifications: [...transition.terminalClassifications]
    };
  }
  return {
    firstObservedAt: contexts.reduce((earliest, context) =>
      context.firstObservedAt.localeCompare(earliest) < 0
        ? context.firstObservedAt
        : earliest, contexts[0].firstObservedAt),
    independentObservationCount: contexts.reduce((sum, context) =>
      sum + context.independentObservationCount, 0),
    lastObservedAt: contexts.reduce((latest, context) =>
      context.lastObservedAt.localeCompare(latest) > 0
        ? context.lastObservedAt
        : latest, contexts[0].lastObservedAt),
    observationCount: contexts.reduce((sum, context) =>
      sum + context.observationCount, 0),
    terminalClassifications: [...new Set(contexts.map(
      ({ terminalClassification }) => terminalClassification
    ))].sort(compareTerminalClassifications)
  };
}

function compareTerminalClassifications(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
}

function mergeNextQuestions(assessments) {
  const byId = new Map();
  for (const assessment of assessments) {
    for (const question of assessment.remainingQuestions) {
      let merged = byId.get(question.internalQuestionId);
      if (merged === undefined) {
        merged = {
          ...question,
          applicableCatalogEntryIds: new Set()
        };
        byId.set(question.internalQuestionId, merged);
      }
      question.applicableCatalogEntryIds.forEach((catalogEntryId) =>
        merged.applicableCatalogEntryIds.add(catalogEntryId));
    }
  }
  return [...byId.values()].map((question) => ({
    ...question,
    applicableCatalogEntryIds: [...question.applicableCatalogEntryIds]
      .sort((left, right) => left.localeCompare(right))
  })).sort(compareQuestions);
}

function toNextQuestion(question, catalogEntryId) {
  return {
    applicableCatalogEntryIds: [catalogEntryId],
    internalQuestionId: question.internalQuestionId,
    options: structuredClone(question.options),
    prompt: question.prompt,
    providerQuestionId: question.providerQuestionId,
    required: question.requiredStatuses.includes(true),
    type: question.type
  };
}

function validateRequest(value) {
  exactRecord(value, ["address", "projectIdea", "schemaVersion"], "request");
  if (value.schemaVersion !== 1) {
    throw new Error("opencounter_preliminary_guidance_request_invalid");
  }
  return {
    address: boundedText(value.address, 500, "address"),
    projectIdea: boundedText(value.projectIdea, 5_000, "projectIdea"),
    schemaVersion: 1
  };
}

function validateSiteContext(value, request) {
  if (value === null) return null;
  exactRecord(value, [
    "baseZoningCode", "evidence", "inputAddress", "matchedAddress",
    "overlayFlags", "parcelKey", "rollupId", "schemaVersion"
  ], "site_context");
  if (value.schemaVersion !== 1
    || value.inputAddress !== request.address
    || !ZONING_CODE_PATTERN.test(value.baseZoningCode)
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(value.parcelKey)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value.rollupId)) {
    throw new Error("opencounter_preliminary_guidance_site_context_invalid");
  }
  const evidence = validateEvidenceRefs(value.evidence);
  return {
    baseZoningCode: value.baseZoningCode,
    evidence,
    inputAddress: value.inputAddress,
    matchedAddress: boundedText(value.matchedAddress, 500, "matchedAddress"),
    overlayFlags: stringArray(value.overlayFlags, 100),
    parcelKey: value.parcelKey,
    rollupId: value.rollupId,
    schemaVersion: 1
  };
}

function validateEvidenceRefs(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    throw new Error("opencounter_preliminary_guidance_evidence_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    exactRecord(value, ["evidenceRef", "observedAt", "source"], "evidence");
    const evidenceRef = boundedText(value.evidenceRef, 500, "evidenceRef");
    if (seen.has(evidenceRef)) {
      throw new Error("opencounter_preliminary_guidance_evidence_invalid");
    }
    seen.add(evidenceRef);
    timestamp(value.observedAt);
    return {
      evidenceRef,
      observedAt: value.observedAt,
      source: boundedText(value.source, 500, "source")
    };
  }).sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef));
}

function validateCandidateUses(values, entries) {
  if (!Array.isArray(values) || values.length > 20) {
    throw new Error("opencounter_preliminary_guidance_candidate_uses_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    exactRecord(value, [
      "catalogEntryId", "evidenceRefs", "mappingBasis", "rationale"
    ], "candidate_use");
    if (!CATALOG_ENTRY_ID_PATTERN.test(value.catalogEntryId)
      || !entries.has(value.catalogEntryId)
      || seen.has(value.catalogEntryId)
      || !["agent_candidate", "requester_confirmed"].includes(
        value.mappingBasis
      )) {
      throw new Error(
        "opencounter_preliminary_guidance_candidate_uses_invalid"
      );
    }
    seen.add(value.catalogEntryId);
    return {
      catalogEntryId: value.catalogEntryId,
      evidenceRefs: stringArray(value.evidenceRefs, 100, true),
      mappingBasis: value.mappingBasis,
      rationale: boundedText(value.rationale, 2_000, "rationale")
    };
  }).sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
}

function validateAnswers(values, questionsById, siteContext) {
  if (!Array.isArray(values) || values.length > 200) {
    throw new Error("opencounter_preliminary_guidance_answers_invalid");
  }
  const siteEvidenceRefs = new Set(siteContext?.evidence.map(
    ({ evidenceRef }) => evidenceRef
  ) ?? []);
  const seen = new Set();
  return values.map((value) => {
    exactRecord(value, [
      "evidenceRefs", "internalQuestionId", "source", "value"
    ], "answer");
    const question = questionsById.get(value.internalQuestionId);
    if (!QUESTION_ID_PATTERN.test(value.internalQuestionId)
      || question === undefined
      || seen.has(value.internalQuestionId)
      || !["requester", "site_evidence"].includes(value.source)) {
      throw new Error("opencounter_preliminary_guidance_answer_invalid");
    }
    seen.add(value.internalQuestionId);
    const answerValue = boundedText(value.value, 2_000, "answer value");
    if (question.type === "single_select"
      && !question.options.some(({ value: optionValue }) =>
        optionValue === answerValue)) {
      throw new Error("opencounter_preliminary_guidance_answer_invalid");
    }
    const evidenceRefs = stringArray(value.evidenceRefs, 100, true);
    if (value.source === "site_evidence"
      && evidenceRefs.some((evidenceRef) =>
        !siteEvidenceRefs.has(evidenceRef))) {
      throw new Error("opencounter_preliminary_guidance_answer_evidence_invalid");
    }
    return {
      evidenceRefs,
      internalQuestionId: value.internalQuestionId,
      source: value.source,
      value: answerValue
    };
  }).sort((left, right) =>
    left.internalQuestionId.localeCompare(right.internalQuestionId));
}

function indexCatalogEntries(catalog) {
  const entries = new Map();
  const add = (values, categoryPath) => {
    for (const entry of values) {
      entries.set(entry.catalogEntryId, {
        categoryPath,
        providerLabel: entry.providerLabel
      });
    }
  };
  for (const category of catalog.categories) {
    add(category.entries, [category.label]);
    for (const group of category.groups) {
      add(group.entries, [category.label, group.label]);
    }
  }
  return entries;
}

function contextMatches(applicability, siteContext) {
  const zoningCodes = [
    ...applicability.observedZoningCodes,
    ...applicability.expectedBaseZoningCodes
  ];
  const zoningMatches = zoningCodes.some((zoningCode) =>
    siteContext.baseZoningCode === zoningCode
    || siteContext.baseZoningCode.startsWith(`${zoningCode}-`));
  const overlaysMatch = siteContext.overlayFlags.every((overlayFlag) =>
    applicability.overlayFlags.includes(overlayFlag));
  return zoningMatches && overlaysMatch;
}

function providerConfirmation(recommended, reasons) {
  return {
    authorizationGranted: false,
    recommendationOnly: true,
    recommended,
    reasons: [...new Set(reasons)].sort((left, right) =>
      left.localeCompare(right))
  };
}

function finalize(payload) {
  const decisionSha256 = sha256(payload);
  return validatePreliminaryGuidance({
    ...payload,
    decisionId: `ocpg_${decisionSha256}`,
    decisionSha256
  });
}

function compareQuestions(left, right) {
  return left.internalQuestionId.localeCompare(right.internalQuestionId);
}

function compareObservedPaths(left, right) {
  return left.sourceQuestionId.localeCompare(right.sourceQuestionId)
    || left.answer.value.localeCompare(right.answer.value)
    || left.firstObservedAt.localeCompare(right.firstObservedAt);
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_preliminary_guidance_${label}_invalid`);
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_preliminary_guidance_${label}_invalid`);
  }
  return value;
}

function boundedArtifactText(value, maximum) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function boundedObjectArray(values, maximum) {
  return Array.isArray(values)
    && values.length <= maximum
    && values.every((value) => value
      && typeof value === "object"
      && !Array.isArray(value));
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
    throw new Error("opencounter_preliminary_guidance_string_array_invalid");
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function timestamp(value) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error("opencounter_preliminary_guidance_timestamp_invalid");
  }
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
