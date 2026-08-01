export const AGENT_HOST_ADAPTER_IDS = Object.freeze([
  "deepseek-http-v1",
  "claude-code-cli-v1",
  "codex-cli-v1",
]);

const AGENT_HOST_READINESS = new Set([
  "not_authenticated",
  "not_configured",
  "not_installed",
  "ready",
  "unavailable",
]);
const AGENT_HOST_FAILURE_CLASSES = new Set([
  "busy",
  "cancelled",
  "configuration_invalid",
  "invalid_output",
  "not_authenticated",
  "not_available",
  "process_failed",
  "provider_rejected",
  "provider_unavailable",
  "rate_limited",
  "termination_unconfirmed",
  "timeout",
]);
const MAX_AGENT_HOST_OUTPUT_BYTES = 1_048_576;
const MAX_AGENT_HOST_PROMPT_CODE_UNITS = 200_000;
const INVOCATION_KEYS = Object.freeze([
  "adapter_id",
  "content_class",
  "correlation_id",
  "invocation_id",
  "output_format",
  "prompt",
  "timeout_ms",
]);

export class AgentHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentHostError";
    this.code = code;
  }
}

export function createAgentHostService({ adapters }) {
  const registry = createRegistry(adapters);
  const activeAdapters = new Set();

  return Object.freeze({
    list() {
      return {
        adapters: AGENT_HOST_ADAPTER_IDS.map((adapterId) => ({
          adapter_id: adapterId,
        })),
        default_adapter_id: null,
      };
    },
    async probe(args = {}) {
      assertPlainObject(args);
      assertOnlyKeys(args, ["adapter_id"]);
      const adapterIds = args.adapter_id === undefined
        ? AGENT_HOST_ADAPTER_IDS
        : [requireAdapterId(args.adapter_id)];
      const results = await Promise.all(adapterIds.map(async (adapterId) => {
        const result = await registry.get(adapterId).probe();
        return normalizeProbeResult(result, adapterId);
      }));
      return { adapters: results };
    },
    async invoke(args) {
      const request = validateInvocation(args);
      if (activeAdapters.has(request.adapterId)) {
        return normalizeInvocationResult({
          adapterId: request.adapterId,
          failureClass: "busy",
          invocationId: request.invocationId,
          ok: false,
          retryable: true,
          summary: "Agent Host adapter already has an invocation in progress.",
        }, request);
      }

      activeAdapters.add(request.adapterId);
      try {
        let result;
        try {
          result = await registry.get(request.adapterId).invoke(request);
        } catch {
          result = {
            adapterId: request.adapterId,
            failureClass: "provider_unavailable",
            invocationId: request.invocationId,
            ok: false,
            retryable: true,
            summary: "Agent Host provider did not return a result.",
          };
        }
        return normalizeInvocationResult(result, request);
      } finally {
        activeAdapters.delete(request.adapterId);
      }
    },
  });
}

function createRegistry(adapters) {
  if (!Array.isArray(adapters)) {
    throw new Error("Agent Host adapters must be an array.");
  }
  const registry = new Map();
  for (const adapter of adapters) {
    if (!adapter || typeof adapter !== "object") {
      throw new Error("Agent Host adapter is invalid.");
    }
    if (!AGENT_HOST_ADAPTER_IDS.includes(adapter.adapterId)) {
      throw new Error("Agent Host adapter id is not allowlisted.");
    }
    if (registry.has(adapter.adapterId)) {
      throw new Error("Agent Host adapter id is duplicated.");
    }
    registry.set(adapter.adapterId, adapter);
  }
  if (
    registry.size !== AGENT_HOST_ADAPTER_IDS.length
    || AGENT_HOST_ADAPTER_IDS.some((adapterId) => !registry.has(adapterId))
  ) {
    throw new Error("Agent Host registry must contain the complete fixed fleet.");
  }
  return registry;
}

function normalizeProbeResult(result, expectedAdapterId) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host probe returned an invalid result."
    );
  }
  if (
    result.adapterId !== expectedAdapterId
    || !AGENT_HOST_READINESS.has(result.status)
  ) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host probe returned an invalid result."
    );
  }
  return {
    adapter_id: result.adapterId,
    ...(safeOptionalMetadata(result.modelRef) === undefined
      ? {}
      : { model_ref: result.modelRef }),
    ...(safeOptionalMetadata(result.runtimeRef) === undefined
      ? {}
      : { runtime_ref: result.runtimeRef }),
    status: result.status,
    ...(safeOptionalMetadata(result.summary, 240) === undefined
      ? {}
      : { summary: result.summary }),
  };
}

function validateInvocation(args) {
  assertPlainObject(args);
  assertOnlyKeys(args, INVOCATION_KEYS);
  if (Object.keys(args).length !== INVOCATION_KEYS.length) {
    throw new AgentHostError(
      "invalid_request",
      "Agent Host invocation is missing a required field."
    );
  }
  const adapterId = requireAdapterId(args.adapter_id);
  if (args.content_class !== "synthetic_nonprivate") {
    throw new AgentHostError(
      "invalid_request",
      "Agent Host content_class must be synthetic_nonprivate in V0."
    );
  }
  const correlationId = requireIdentity(args.correlation_id, "correlation_id");
  const invocationId = requireIdentity(args.invocation_id, "invocation_id");
  if (args.output_format !== "json" && args.output_format !== "text") {
    throw new AgentHostError(
      "invalid_request",
      "Agent Host output_format must be json or text."
    );
  }
  if (
    typeof args.prompt !== "string"
    || args.prompt.trim().length === 0
    || args.prompt.length > MAX_AGENT_HOST_PROMPT_CODE_UNITS
    || args.prompt.includes("\0")
  ) {
    throw new AgentHostError(
      "invalid_request",
      "Agent Host prompt is invalid or oversized."
    );
  }
  if (
    !Number.isInteger(args.timeout_ms)
    || args.timeout_ms < 1_000
    || args.timeout_ms > 25_000
  ) {
    throw new AgentHostError(
      "invalid_request",
      "Agent Host timeout_ms must be from 1000 through 25000."
    );
  }
  return {
    adapterId,
    contentClass: args.content_class,
    correlationId,
    invocationId,
    outputFormat: args.output_format,
    prompt: args.prompt,
    timeoutMs: args.timeout_ms,
  };
}

function normalizeInvocationResult(result, request) {
  if (
    !result
    || typeof result !== "object"
    || Array.isArray(result)
    || result.adapterId !== request.adapterId
    || result.invocationId !== request.invocationId
    || typeof result.ok !== "boolean"
  ) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host provider returned an invalid result."
    );
  }
  if (result.ok === false) {
    if (
      !AGENT_HOST_FAILURE_CLASSES.has(result.failureClass)
      || typeof result.retryable !== "boolean"
      || safeOptionalMetadata(result.summary, 240) === undefined
    ) {
      throw new AgentHostError(
        "provider_contract_violation",
        "Agent Host provider returned an invalid failure result."
      );
    }
    return {
      adapter_id: result.adapterId,
      correlation_id: request.correlationId,
      failure_class: result.failureClass,
      invocation_id: result.invocationId,
      ok: false,
      retryable: result.retryable,
      summary: result.summary,
    };
  }
  if (
    typeof result.outputText !== "string"
    || result.outputText.includes("\0")
    || Buffer.byteLength(result.outputText, "utf8") > MAX_AGENT_HOST_OUTPUT_BYTES
    || safeOptionalMetadata(result.modelRef) === undefined
    || safeOptionalMetadata(result.runtimeRef) === undefined
  ) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host provider returned an invalid success result."
    );
  }
  if (request.outputFormat === "json") {
    try {
      JSON.parse(result.outputText);
    } catch {
      throw new AgentHostError(
        "provider_contract_violation",
        "Agent Host provider returned invalid JSON output."
      );
    }
  }
  return {
    adapter_id: result.adapterId,
    correlation_id: request.correlationId,
    ...(validCost(result.costUsd) ? { cost_usd: result.costUsd } : {}),
    invocation_id: result.invocationId,
    model_ref: result.modelRef,
    ok: true,
    output_text: result.outputText,
    ...(safeOptionalMetadata(result.providerSessionRef) === undefined
      ? {}
      : { provider_session_ref: result.providerSessionRef }),
    runtime_ref: result.runtimeRef,
    ...(result.usage === undefined ? {} : { usage: normalizeUsage(result.usage) }),
  };
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host provider returned invalid usage metadata."
    );
  }
  const output = {};
  for (const [source, target] of [
    ["inputTokens", "input_tokens"],
    ["outputTokens", "output_tokens"],
    ["totalTokens", "total_tokens"],
  ]) {
    const count = value[source];
    if (count !== undefined) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new AgentHostError(
          "provider_contract_violation",
          "Agent Host provider returned invalid usage metadata."
        );
      }
      output[target] = count;
    }
  }
  if (Object.keys(output).length === 0) {
    throw new AgentHostError(
      "provider_contract_violation",
      "Agent Host provider returned empty usage metadata."
    );
  }
  return output;
}

function validCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeOptionalMetadata(value, maxLength = 200) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && !/[\r\n\t\0]/u.test(value)
    ? value
    : undefined;
}

function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentHostError("invalid_request", "Arguments must be an object.");
  }
}

function assertOnlyKeys(value, allowedKeys) {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new AgentHostError(
      "invalid_request",
      "Arguments contain an unsupported field."
    );
  }
}

function requireAdapterId(value) {
  if (typeof value !== "string" || !AGENT_HOST_ADAPTER_IDS.includes(value)) {
    throw new AgentHostError(
      "adapter_not_found",
      "Agent Host adapter is not registered."
    );
  }
  return value;
}

function requireIdentity(value, field) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(value)
  ) {
    throw new AgentHostError(
      "invalid_request",
      `Agent Host ${field} is invalid.`
    );
  }
  return value;
}
