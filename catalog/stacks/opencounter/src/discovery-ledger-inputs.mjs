import {
  createGuidanceCheckpointSha256,
  validateProviderReference
} from "./core.mjs";
import { createNormalizedQuestionSignatureSha256 } from "./discovery-question-graph.mjs";
import {
  addressesReferToSameCincinnatiStreet,
  normalizeCincinnatiAddress
} from "./address-normalization.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function validateDiscoveryResult(value, observedAt) {
  const result = record(value, "result");
  if (result.status === "not_found") {
    exactKeys(result, [
      "failureClass", "schemaVersion", "source", "status"
    ], "result");
    if (result.failureClass !== "not_found"
      || result.schemaVersion !== 1
      || result.source !== "opencounter") {
      throw new Error("opencounter_discovery_result_invalid");
    }
    return {
      checkpoint: null,
      providerReference: null,
      status: "failed",
      terminalResult: { failureClass: "not_found" }
    };
  }
  if (result.status === "indeterminate") {
    const expectedKeys = [
      "failureClass", "schemaVersion", "source", "status",
      ...(result.providerReference === undefined ? [] : ["providerReference"]),
      ...(result.providerRoute === undefined ? [] : ["providerRoute"])
    ];
    exactKeys(result, expectedKeys, "result");
    if (result.failureClass !== "indeterminate"
      || result.schemaVersion !== 1
      || result.source !== "opencounter") {
      throw new Error("opencounter_discovery_result_invalid");
    }
    const providerReference = result.providerReference === undefined
      ? null
      : validateProviderReference(result.providerReference);
    let providerRoute = null;
    if (result.providerRoute !== undefined) {
      providerRoute = boundedText(result.providerRoute, "result.providerRoute", 2_000);
      if (!/^\/projects\/[0-9]{1,20}(?:\/[A-Za-z0-9_-]+)*$/.test(providerRoute)) {
        throw new Error("opencounter_discovery_provider_route_invalid");
      }
    }
    return {
      checkpoint: null,
      providerReference,
      status: "indeterminate",
      terminalResult: {
        failureClass: "indeterminate",
        ...(providerRoute === null ? {} : { providerRoute })
      }
    };
  }
  if (result.status === "completed") {
    const expectedKeys = result.providerPdf === undefined
      ? ["providerReference", "result", "schemaVersion", "source", "status"]
      : ["providerPdf", "providerReference", "result", "schemaVersion", "source", "status"];
    exactKeys(result, expectedKeys, "result");
    if (result.schemaVersion !== 1 || result.source !== "opencounter") {
      throw new Error("opencounter_discovery_result_invalid");
    }
    const terminalResult = boundedJsonObject(result.result, "result.result", 250_000);
    if (result.providerPdf !== undefined) {
      boundedJsonObject(result.providerPdf, "result.providerPdf", 50_000);
    }
    return {
      checkpoint: null,
      providerReference: validateProviderReference(result.providerReference),
      status: "completed",
      terminalResult
    };
  }
  exactKeys(result, [
    "checkpoint", "providerReference", "schemaVersion", "source", "status"
  ], "result");
  if (result.schemaVersion !== 1
    || result.source !== "opencounter"
    || result.status !== "needs_requester_input") {
    throw new Error("opencounter_discovery_result_invalid");
  }
  const providerReference = validateProviderReference(result.providerReference);
  const checkpoint = record(result.checkpoint, "result.checkpoint");
  exactKeys(checkpoint, [
    "checkpointSha256", "expiresAt", "questions", "schemaVersion"
  ], "result.checkpoint");
  if (checkpoint.schemaVersion !== 1
    || !SHA256_PATTERN.test(checkpoint.checkpointSha256)
    || Date.parse(isoTimestamp(checkpoint.expiresAt, "result.checkpoint.expiresAt"))
      <= Date.parse(observedAt)
    || !Array.isArray(checkpoint.questions)
    || checkpoint.questions.length < 1
    || checkpoint.questions.length > 50) {
    throw new Error("opencounter_discovery_checkpoint_invalid");
  }
  const expectedSha256 = createGuidanceCheckpointSha256(
    providerReference,
    checkpoint.questions
  );
  if (checkpoint.checkpointSha256 !== expectedSha256) {
    throw new Error("opencounter_discovery_checkpoint_digest_invalid");
  }
  return {
    checkpoint: structuredClone(checkpoint),
    providerReference,
    status: "needs_requester_input",
    terminalResult: null
  };
}

export function validateCheckpointAnswers(values, questions) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) {
    throw new Error("opencounter_discovery_answers_invalid");
  }
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answers = [];
  const seen = new Set();
  for (const value of values) {
    const answer = record(value, "answer");
    exactKeys(answer, ["questionId", "value"], "answer");
    const questionId = boundedText(answer.questionId, "answer.questionId", 100);
    const answerValue = boundedText(answer.value, "answer.value", 2_000);
    if (seen.has(questionId)) throw new Error("opencounter_discovery_answer_duplicate");
    seen.add(questionId);
    const question = questionsById.get(questionId);
    if (question === undefined) throw new Error("opencounter_discovery_answer_unknown");
    if (question.type === "single_select"
      && !question.options.some(({ value: optionValue }) => optionValue === answerValue)) {
      throw new Error("opencounter_discovery_answer_invalid");
    }
    answers.push({ questionId, value: answerValue });
  }
  if (questions.some((question) => question.required && !seen.has(question.id))) {
    throw new Error("opencounter_discovery_answers_incomplete");
  }
  return answers;
}

export function validateDiscoveryFailure(value) {
  const failure = record(value, "failure");
  exactKeys(failure, ["code", "effect", "message"], "failure");
  const code = id(failure.code, "failure.code");
  if (failure.effect !== "none" && failure.effect !== "unknown") {
    throw new Error("opencounter_discovery_failure_effect_invalid");
  }
  return {
    code,
    effect: failure.effect,
    message: boundedText(failure.message, "failure.message", 2_000)
  };
}

export function validateAnswerBasis(value, job, answers, queuedAt) {
  if (value === undefined) {
    throw new Error("opencounter_discovery_answer_basis_required");
  }
  const basis = record(value, "answerBasis");
  if (basis.kind === "requester_approval") {
    exactKeys(basis, [
      "approvalId", "approvedAt", "approvedBy", "kind"
    ], "answerBasis");
    const approvedAt = isoTimestamp(basis.approvedAt, "answerBasis.approvedAt");
    if (Date.parse(approvedAt) > Date.parse(queuedAt)) {
      throw new Error("opencounter_discovery_answer_basis_invalid");
    }
    return {
      approvalId: id(basis.approvalId, "answerBasis.approvalId"),
      approvedAt,
      approvedBy: id(basis.approvedBy, "answerBasis.approvedBy"),
      kind: "requester_approval"
    };
  }
  if (basis.kind === "scenario_fixture") {
    const previewBound = job.scenario.scenarioVersion >= 2;
    exactKeys(basis, [
      "kind",
      ...(previewBound ? ["previewSha256"] : []),
      "scenarioId",
      "scenarioVersion"
    ], "answerBasis");
    if (basis.scenarioId !== job.scenario.scenarioId
      || basis.scenarioVersion !== job.scenario.scenarioVersion
      || (previewBound && (
        !SHA256_PATTERN.test(basis.previewSha256)
        || basis.previewSha256 !== job.scenario.previewSha256
      ))) {
      throw new Error("opencounter_discovery_answer_basis_invalid");
    }
    for (const answer of answers) {
      const question = job.checkpoint.questions.find(
        ({ id: questionId }) => questionId === answer.questionId
      );
      const signature = createNormalizedQuestionSignatureSha256(question);
      const rule = job.scenario.answerRules.find((candidate) =>
        candidate.questionId === answer.questionId
        && candidate.questionSignatureSha256 === signature
        && candidate.value === answer.value);
      if (rule === undefined
        || (previewBound && !scenarioRuleMatchesProvenance(rule, job))) {
        throw new Error("opencounter_discovery_scenario_answer_not_authorized");
      }
    }
    return {
      kind: "scenario_fixture",
      ...(previewBound ? { previewSha256: basis.previewSha256 } : {}),
      scenarioId: basis.scenarioId,
      scenarioVersion: basis.scenarioVersion
    };
  }
  if (basis.kind === "location_fixture") {
    exactKeys(basis, ["kind", "locationId", "locationVersion"], "answerBasis");
    if (!job.locationFixture
      || basis.locationId !== job.locationFixture.locationId
      || basis.locationVersion !== job.locationFixture.locationVersion
      || answers.length !== 1
      || answers[0].questionId !== "opencounter-address"
      || !addressesReferToSameCincinnatiStreet(
        answers[0].value,
        job.locationFixture.address
      )) {
      throw new Error("opencounter_discovery_answer_basis_invalid");
    }
    return {
      kind: "location_fixture",
      locationId: basis.locationId,
      locationVersion: basis.locationVersion
    };
  }
  throw new Error("opencounter_discovery_answer_basis_invalid");
}

function scenarioRuleMatchesProvenance(rule, job) {
  if (rule.ownership === "proposal_fact") {
    return rule.siteFactEvidence === undefined
      && proposalFactDeclarationIsValid(rule.proposalFactDeclaration);
  }
  if (rule.ownership !== "site_fact" && rule.ownership !== "mixed_fact") {
    return false;
  }
  if (rule.ownership === "site_fact"
    && rule.proposalFactDeclaration !== undefined) {
    return false;
  }
  if (rule.ownership === "mixed_fact"
    && !proposalFactDeclarationIsValid(rule.proposalFactDeclaration)) {
    return false;
  }
  const evidence = rule.siteFactEvidence;
  const fixture = job.locationFixture;
  return evidence
    && fixture
    && evidence.scenarioId === job.scenario.scenarioId
    && evidence.questionId === rule.questionId
    && evidence.questionSignatureSha256 === rule.questionSignatureSha256
    && evidence.value === rule.value
    && evidence.locationId === fixture.locationId
    && evidence.locationVersion === fixture.locationVersion
    && evidence.parcelKey === fixture.parcelKey
    && evidence.rollupId === fixture.rollupId
    && evidence.boundarySha256 === fixture.boundarySha256;
}

function proposalFactDeclarationIsValid(value) {
  return value
    && SHA256_PATTERN.test(value.declarationSha256)
    && value.kind === "explicitly_synthetic_coverage_fact"
    && value.notRealProjectFact === true;
}

export function normalizeAddress(value) {
  return normalizeCincinnatiAddress(value);
}

function boundedJsonObject(value, path, maximumBytes) {
  const object = record(value, path);
  const serialized = JSON.stringify(sortJson(object));
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error(`${path} is too large.`);
  }
  return structuredClone(object);
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}

function exactKeys(value, expected, path) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length
    || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${path} has unsupported or missing fields.`);
  }
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function id(value, path) {
  const text = boundedText(value, path, 100);
  if (!ID_PATTERN.test(text)) throw new Error(`${path} is invalid.`);
  return text;
}

function boundedText(value, path, maximum) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

function isoTimestamp(value, path) {
  if (typeof value !== "string"
    || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}
