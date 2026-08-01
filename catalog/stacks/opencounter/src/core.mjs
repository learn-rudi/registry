const WORKFLOWS = new Set(["zoning", "business", "special_events", "residential"]);

export function createOpenCounterService({ driver, now = () => new Date().toISOString() }) {
  if (!driver || typeof driver !== "object") throw new Error("driver is required.");
  return {
    async startGuidance(input) {
      const normalized = validateStart(input);
      return validateDriverResult(await driver.startGuidance(normalized), now);
    },
    async continueGuidance(input) {
      const normalized = validateContinuation(input);
      return validateDriverResult(await driver.continueGuidance(normalized), now);
    },
    async getGuidanceResult(input) {
      const providerReference = validateProviderReference(input?.providerReference);
      return validateDriverResult(await driver.getGuidanceResult({ providerReference }), now);
    },
    async reconcileGuidance(input) {
      const providerReference = validateProviderReference(input?.providerReference);
      return validateDriverResult(await driver.reconcileGuidance({ providerReference }), now);
    }
  };
}

function validateStart(input) {
  exactKeys(input, ["address", "jurisdiction", "proposedUse", "workflow"]);
  if (input.jurisdiction !== "cincinnati-oh") throw new Error("jurisdiction must be cincinnati-oh.");
  if (!WORKFLOWS.has(input.workflow)) throw new Error("workflow is unsupported.");
  return {
    address: boundedText(input.address, "address", 500),
    jurisdiction: "cincinnati-oh",
    proposedUse: boundedText(input.proposedUse, "proposedUse", 2_000),
    workflow: input.workflow
  };
}

function validateContinuation(input) {
  exactKeys(input, ["answers", "checkpointSha256", "providerReference"]);
  if (!Array.isArray(input.answers) || input.answers.length > 50) throw new Error("answers are invalid.");
  const seen = new Set();
  const answers = input.answers.map((answer) => {
    exactKeys(answer, ["questionId", "value"]);
    const questionId = boundedText(answer.questionId, "questionId", 100);
    if (seen.has(questionId)) throw new Error("answer question IDs must be unique.");
    seen.add(questionId);
    return { questionId, value: boundedText(answer.value, "value", 2_000) };
  });
  if (!/^[0-9a-f]{64}$/.test(input.checkpointSha256)) throw new Error("checkpointSha256 is invalid.");
  return {
    answers,
    checkpointSha256: input.checkpointSha256,
    providerReference: validateProviderReference(input.providerReference)
  };
}

function validateDriverResult(value, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("browser driver returned invalid data.");
  if (value.status === "needs_requester_input") {
    const providerReference = validateProviderReference(value.providerReference);
    if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 50) {
      throw new Error("browser driver returned an invalid question set.");
    }
    const questions = value.questions.map(validateQuestion);
    return {
      checkpoint: {
        expiresAt: value.expiresAt ?? addHours(now(), 24),
        questions,
        schemaVersion: 1
      },
      providerReference,
      schemaVersion: 1,
      source: "opencounter",
      status: "needs_requester_input"
    };
  }
  if (value.status === "completed") {
    return {
      providerReference: validateProviderReference(value.providerReference),
      result: validateResult(value.result),
      schemaVersion: 1,
      source: "opencounter",
      status: "completed"
    };
  }
  if (value.status === "not_found") {
    return { failureClass: value.status, schemaVersion: 1, source: "opencounter", status: value.status };
  }
  if (value.status === "indeterminate") {
    return {
      failureClass: value.status,
      ...(value.providerReference === undefined
        ? {}
        : { providerReference: validateProviderReference(value.providerReference) }),
      ...(value.route === undefined
        ? {}
        : { providerRoute: validateProviderRoute(value.route) }),
      schemaVersion: 1,
      source: "opencounter",
      status: value.status
    };
  }
  throw new Error("browser driver status is unsupported.");
}

function validateQuestion(question) {
  if (!question || typeof question !== "object" || Array.isArray(question)) throw new Error("question is invalid.");
  const id = boundedText(question.id, "question.id", 100);
  const prompt = boundedText(question.prompt, "question.prompt", 2_000);
  if (typeof question.required !== "boolean") throw new Error("question.required is invalid.");
  if (question.type === "text") return { id, prompt, required: question.required, type: "text" };
  if (question.type !== "single_select" || !Array.isArray(question.options) || question.options.length < 2) {
    throw new Error("question type or options are invalid.");
  }
  return {
    id,
    options: question.options.map((option) => ({
      label: boundedText(option?.label, "option.label", 1_000),
      value: boundedText(option?.value, "option.value", 500)
    })),
    prompt,
    required: question.required,
    type: "single_select"
  };
}

function validateResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("guidance result is invalid.");
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > 250_000) throw new Error("guidance result is too large.");
  return result;
}

export function validateProviderReference(value) {
  const text = boundedText(value, "providerReference", 2_000);
  if (!/^opencounter:project:[0-9]{1,20}$/.test(text)) throw new Error("providerReference is invalid.");
  return text;
}

function validateProviderRoute(value) {
  const route = boundedText(value, "providerRoute", 2_000);
  if (!/^\/projects\/[0-9]{1,20}(?:\/[A-Za-z0-9_-]+)*$/.test(route)) {
    throw new Error("providerRoute is invalid.");
  }
  return route;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tool input must be an object.");
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error("tool input contains unsupported or missing fields.");
  }
}

function boundedText(value, field, max) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`${field} is invalid.`);
  return value.trim();
}

function addHours(value, hours) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error("clock returned an invalid timestamp.");
  return new Date(parsed + hours * 60 * 60 * 1_000).toISOString();
}
