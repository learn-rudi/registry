export const MAX_AGENT_HOST_OUTPUT_BYTES = 1_048_576;

export function validateProviderInvocation(request, adapterId) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Agent Host invocation is invalid.");
  }
  if (request.adapterId !== adapterId) {
    throw new Error("Agent Host adapter id does not match provider.");
  }
  if (request.contentClass !== "synthetic_nonprivate") {
    throw new Error("Agent Host content class is invalid.");
  }
  requireIdentity(request.invocationId);
  requireIdentity(request.correlationId);
  if (
    typeof request.prompt !== "string"
    || request.prompt.trim().length === 0
    || request.prompt.length > 200_000
    || request.prompt.includes("\0")
  ) {
    throw new Error("Agent Host prompt is invalid.");
  }
  if (request.outputFormat !== "text" && request.outputFormat !== "json") {
    throw new Error("Agent Host output format is invalid.");
  }
  if (
    !Number.isInteger(request.timeoutMs)
    || request.timeoutMs < 1_000
    || request.timeoutMs > 25_000
  ) {
    throw new Error("Agent Host timeout is invalid.");
  }
}

export function validateProviderOutput(outputText, outputFormat) {
  if (
    typeof outputText !== "string"
    || outputText.includes("\0")
    || Buffer.byteLength(outputText, "utf8") > MAX_AGENT_HOST_OUTPUT_BYTES
  ) {
    throw new Error("Agent Host output is invalid.");
  }
  if (outputFormat === "json") JSON.parse(outputText);
}

export function failure(adapterId, invocationId, failureClass, retryable, summary) {
  return {
    adapterId,
    failureClass,
    invocationId: typeof invocationId === "string"
      ? invocationId.slice(0, 200)
      : "invalid-invocation",
    ok: false,
    retryable,
    summary: safeSummary(summary),
  };
}

export function parseUsage(value, fieldMap) {
  if (!isRecord(value)) return undefined;
  const usage = {};
  for (const [source, target] of Object.entries(fieldMap)) {
    const count = value[source];
    if (Number.isSafeInteger(count) && count >= 0) usage[target] = count;
  }
  return Object.keys(usage).length === 0 ? undefined : usage;
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeMetadata(value, fallback) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0
    && normalized.length <= 200
    && !/[\r\n\t\0]/u.test(normalized)
    ? normalized
    : fallback;
}

function safeSummary(summary) {
  const normalized = String(summary).replace(/[\r\n\t]+/gu, " ").trim();
  return normalized.slice(0, 240) || "Agent Host request failed.";
}

function requireIdentity(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 200
    || !/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(value)
  ) {
    throw new Error("Agent Host identity is invalid.");
  }
}
