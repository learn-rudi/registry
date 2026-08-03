import { createHash } from "node:crypto";

export function buildObservedQuestionGraph(ledger) {
  if (!ledger || typeof ledger !== "object" || !Array.isArray(ledger.jobs)) {
    throw new Error("opencounter_discovery_ledger_invalid");
  }
  const nodes = new Map();
  const edgesByKey = new Map();

  for (const job of ledger.jobs) {
    if (!Array.isArray(job.observations)) {
      throw new Error("opencounter_discovery_observations_invalid");
    }
    for (const observation of job.observations) {
      if (!Array.isArray(observation.questions)) {
        throw new Error("opencounter_discovery_observation_invalid");
      }
      for (const question of observation.questions) {
        const signature = normalizedQuestionSignature(question);
        const normalizedSignatureSha256 = sha256(signature);
        const questionKey = `ocq_${sha256({
          normalizedSignatureSha256,
          providerQuestionId: question.id
        })}`;
        let node = nodes.get(questionKey);
        if (node === undefined) {
          node = {
            catalogEntryIds: new Set(),
            categoryPaths: new Set(),
            firstObservedAt: observation.observedAt,
            independentJobIds: new Set(),
            lastObservedAt: observation.observedAt,
            normalizedSignatureSha256,
            observationCount: 0,
            options: question.type === "single_select"
              ? structuredClone(question.options)
              : [],
            prompt: question.prompt.trim(),
            propertyProfileIds: new Set(),
            providerQuestionId: question.id,
            questionKey,
            requiredStatuses: new Set(),
            scenarioIds: new Set(),
            type: question.type
          };
          nodes.set(questionKey, node);
        }
        node.catalogEntryIds.add(job.catalogEntryId);
        node.categoryPaths.add(job.categoryPath.join(" / "));
        node.independentJobIds.add(job.jobId);
        node.propertyProfileIds.add(
          `${job.propertyProfile.profileId}:${job.propertyProfile.profileVersion}`
        );
        node.requiredStatuses.add(question.required);
        node.scenarioIds.add(`${job.scenario.scenarioId}:${job.scenario.scenarioVersion}`);
        node.observationCount += 1;
        if (Date.parse(observation.observedAt) < Date.parse(node.firstObservedAt)) {
          node.firstObservedAt = observation.observedAt;
        }
        if (Date.parse(observation.observedAt) > Date.parse(node.lastObservedAt)) {
          node.lastObservedAt = observation.observedAt;
        }
      }
    }
    addJobEdges(edgesByKey, job);
  }

  const questions = [...nodes.values()].map((node) => ({
    catalogEntryIds: sorted(node.catalogEntryIds),
    categoryPaths: sorted(node.categoryPaths),
    firstObservedAt: node.firstObservedAt,
    independentObservationCount: node.independentJobIds.size,
    lastObservedAt: node.lastObservedAt,
    normalizedSignatureSha256: node.normalizedSignatureSha256,
    observationCount: node.observationCount,
    options: node.options,
    prompt: node.prompt,
    propertyProfileIds: sorted(node.propertyProfileIds),
    providerQuestionId: node.providerQuestionId,
    questionKey: node.questionKey,
    requiredStatuses: [...node.requiredStatuses].sort(),
    scenarioIds: sorted(node.scenarioIds),
    type: node.type
  })).sort((left, right) =>
    left.firstObservedAt.localeCompare(right.firstObservedAt)
    || left.questionKey.localeCompare(right.questionKey));

  const edges = [...edgesByKey.values()].map((edge) => ({
    answerValue: edge.answerValue,
    firstObservedAt: edge.firstObservedAt,
    independentObservationCount: edge.independentJobIds.size,
    lastObservedAt: edge.lastObservedAt,
    observationCount: edge.observationCount,
    sourceQuestionKey: edge.sourceQuestionKey,
    targetQuestionKey: edge.targetQuestionKey,
    terminalStatus: edge.terminalStatus
  })).sort((left, right) =>
    left.firstObservedAt.localeCompare(right.firstObservedAt)
    || left.sourceQuestionKey.localeCompare(right.sourceQuestionKey));

  return {
    edges,
    generatedFromLedgerSha256: ledger.ledgerSha256,
    questions,
    schemaVersion: 1
  };
}

function addJobEdges(edgesByKey, job) {
  for (let index = 1; index < job.observations.length; index += 1) {
    const previous = job.observations[index - 1];
    const current = job.observations[index];
    if (!Array.isArray(current.answers)) {
      throw new Error("opencounter_discovery_observation_answers_invalid");
    }
    for (const answer of current.answers) {
      const sourceQuestion = previous.questions.find(
        (question) => question.id === answer.questionId
      );
      if (sourceQuestion === undefined) {
        throw new Error("opencounter_discovery_answer_path_invalid");
      }
      validateObservedAnswer(sourceQuestion, answer.value);
      const destinations = current.questions.length > 0
        ? current.questions.map((question) => ({
          targetQuestionKey: createQuestionKey(question),
          terminalStatus: null
        }))
        : [{
          targetQuestionKey: null,
          terminalStatus: current.resultStatus
        }];
      for (const destination of destinations) {
        const sourceQuestionKey = createQuestionKey(sourceQuestion);
        const edgeKey = sha256({
          answerValue: answer.value,
          sourceQuestionKey,
          ...destination
        });
        let edge = edgesByKey.get(edgeKey);
        if (edge === undefined) {
          edge = {
            answerValue: answer.value,
            firstObservedAt: current.observedAt,
            independentJobIds: new Set(),
            lastObservedAt: current.observedAt,
            observationCount: 0,
            sourceQuestionKey,
            ...destination
          };
          edgesByKey.set(edgeKey, edge);
        }
        edge.independentJobIds.add(job.jobId);
        edge.observationCount += 1;
        if (Date.parse(current.observedAt) < Date.parse(edge.firstObservedAt)) {
          edge.firstObservedAt = current.observedAt;
        }
        if (Date.parse(current.observedAt) > Date.parse(edge.lastObservedAt)) {
          edge.lastObservedAt = current.observedAt;
        }
      }
    }
  }
}

function validateObservedAnswer(question, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("opencounter_discovery_answer_path_invalid");
  }
  if (question.type === "single_select"
    && !question.options.some((option) => option.value === value)) {
    throw new Error("opencounter_discovery_answer_path_invalid");
  }
}

function createQuestionKey(question) {
  const normalizedSignatureSha256 = sha256(normalizedQuestionSignature(question));
  return `ocq_${sha256({
    normalizedSignatureSha256,
    providerQuestionId: question.id
  })}`;
}

export function createNormalizedQuestionSignatureSha256(question) {
  return sha256(normalizedQuestionSignature(question));
}

function normalizedQuestionSignature(question) {
  if (!question || typeof question !== "object") {
    throw new Error("opencounter_discovery_question_invalid");
  }
  if (question.type === "text") {
    return {
      options: [],
      prompt: normalizeText(question.prompt),
      type: "text"
    };
  }
  if (question.type !== "single_select" || !Array.isArray(question.options)) {
    throw new Error("opencounter_discovery_question_invalid");
  }
  const options = question.options.map((option) => ({
    label: normalizeText(option?.label),
    value: normalizeText(option?.value)
  })).sort((left, right) =>
    left.value.localeCompare(right.value) || left.label.localeCompare(right.label));
  return {
    options,
    prompt: normalizeText(question.prompt),
    type: "single_select"
  };
}

function normalizeText(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2_000) {
    throw new Error("opencounter_discovery_question_text_invalid");
  }
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
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

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}
