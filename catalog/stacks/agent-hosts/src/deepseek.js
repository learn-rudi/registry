import {
  failure,
  isRecord,
  parseUsage,
  safeMetadata,
  validateProviderInvocation,
  validateProviderOutput,
} from "./provider-contract.js";

const PINNED_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";
const SECRET_NAME = "DEEPSEEK_API_KEY";
const RUNTIME_REF = "deepseek-chat-completions-v1";
const MAX_HTTP_RESPONSE_BYTES = 2_097_152;

export class DeepSeekHttpAgentHost {
  adapterId = "deepseek-http-v1";

  constructor({ endpoint = PINNED_ENDPOINT, fetchImplementation = fetch, secretProvider }) {
    validatePinnedEndpoint(endpoint);
    if (!secretProvider || typeof secretProvider.getSecret !== "function") {
      throw new Error("DeepSeek secret provider is required.");
    }
    this.endpoint = endpoint;
    this.fetchImplementation = fetchImplementation;
    this.secretProvider = secretProvider;
  }

  async probe() {
    try {
      const secret = await this.secretProvider.getSecret(SECRET_NAME);
      return {
        adapterId: this.adapterId,
        modelRef: MODEL,
        runtimeRef: RUNTIME_REF,
        status: validApiKey(secret) ? "ready" : "not_configured",
      };
    } catch {
      return {
        adapterId: this.adapterId,
        modelRef: MODEL,
        runtimeRef: RUNTIME_REF,
        status: "not_configured",
      };
    }
  }

  async invoke(request, options = {}) {
    try {
      validateProviderInvocation(request, this.adapterId);
    } catch {
      return failure(this.adapterId, request?.invocationId,
        "configuration_invalid", false,
        "Agent Host invocation did not satisfy the contract.");
    }

    let apiKey;
    try {
      apiKey = await this.secretProvider.getSecret(SECRET_NAME);
      if (!validApiKey(apiKey)) throw new Error("invalid key");
    } catch {
      return failure(this.adapterId, request.invocationId, "not_authenticated", false,
        "DeepSeek credentials are not configured.");
    }

    const controller = new AbortController();
    let timedOut = false;
    let cancelled = options.signal?.aborted === true;
    const onAbort = () => {
      cancelled = true;
      controller.abort();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeoutMs);
    timeout.unref();
    if (cancelled) controller.abort();

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        body: JSON.stringify({
          messages: [{ content: request.prompt, role: "user" }],
          model: MODEL,
          ...(request.outputFormat === "json"
            ? { response_format: { type: "json_object" } }
            : {}),
          stream: false,
          thinking: { type: "disabled" },
        }),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return mapHttpFailure(this.adapterId, request.invocationId, response.status);
      }
      const raw = await readBoundedResponse(response, MAX_HTTP_RESPONSE_BYTES);
      let parsed;
      try {
        parsed = parseResponse(raw);
        validateProviderOutput(parsed.outputText, request.outputFormat);
      } catch {
        throw new DeepSeekInvalidOutputError();
      }
      return {
        adapterId: this.adapterId,
        invocationId: request.invocationId,
        modelRef: parsed.modelRef,
        ok: true,
        outputText: parsed.outputText,
        runtimeRef: RUNTIME_REF,
        ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
      };
    } catch (error) {
      if (timedOut) {
        return failure(this.adapterId, request.invocationId, "timeout", true,
          "DeepSeek invocation timed out.");
      }
      if (cancelled) {
        return failure(this.adapterId, request.invocationId, "cancelled", false,
          "DeepSeek invocation was cancelled.");
      }
      if (error instanceof DeepSeekInvalidOutputError) {
        return failure(this.adapterId, request.invocationId, "invalid_output", false,
          "DeepSeek returned invalid or oversized output.");
      }
      return failure(this.adapterId, request.invocationId, "provider_unavailable", true,
        "DeepSeek did not return a valid bounded response.");
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      apiKey = "";
    }
  }
}

function validatePinnedEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DeepSeek requires the pinned DeepSeek endpoint.");
  }
  if (
    url.href !== PINNED_ENDPOINT
    || url.protocol !== "https:"
    || url.origin !== "https://api.deepseek.com"
    || url.pathname !== "/chat/completions"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error("DeepSeek requires the pinned DeepSeek endpoint.");
  }
}

function validApiKey(value) {
  return typeof value === "string"
    && value.length >= 8
    && value.length <= 4_096
    && !/[\r\n\0]/u.test(value);
}

async function readBoundedResponse(response, maxBytes) {
  if (!response.body) throw new DeepSeekInvalidOutputError();
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new DeepSeekInvalidOutputError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

class DeepSeekInvalidOutputError extends Error {}

function parseResponse(raw) {
  const envelope = JSON.parse(raw);
  const choice = isRecord(envelope) && Array.isArray(envelope.choices)
    ? envelope.choices[0]
    : undefined;
  if (
    !isRecord(choice)
    || !isRecord(choice.message)
    || typeof choice.message.content !== "string"
  ) {
    throw new Error("DeepSeek response is invalid.");
  }
  return {
    modelRef: safeMetadata(envelope.model, MODEL),
    outputText: choice.message.content,
    usage: parseUsage(envelope.usage, {
      prompt_tokens: "inputTokens",
      completion_tokens: "outputTokens",
      total_tokens: "totalTokens",
    }),
  };
}

function mapHttpFailure(adapterId, invocationId, status) {
  if (status === 401 || status === 403) {
    return failure(adapterId, invocationId, "not_authenticated", false,
      "DeepSeek rejected the configured credentials.");
  }
  if (status === 429) {
    return failure(adapterId, invocationId, "rate_limited", true,
      "DeepSeek rate limited the invocation.");
  }
  if (status >= 500) {
    return failure(adapterId, invocationId, "provider_unavailable", true,
      "DeepSeek is currently unavailable.");
  }
  return failure(adapterId, invocationId, "provider_rejected", false,
    "DeepSeek rejected the invocation.");
}
