const BRAVE_WEB_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESPONSE_BYTES = 2_000_000;
const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

export class BraveSearchError extends Error {
  constructor(code, message, { cause, retryable = false, status = null } = {}) {
    super(message, { cause });
    this.name = "BraveSearchError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export function createBraveSearchClient({
  apiKey,
  backoffMaxSeconds = 30,
  backoffSeconds = 2,
  fetchImpl = fetch,
  maxAttempts = 3,
  monotonicSeconds = () => performance.now() / 1_000,
  now = () => new Date(),
  sleepImpl = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1_000)),
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw configurationError("BRAVE_SEARCH_API_KEY is required.");
  }
  if (typeof fetchImpl !== "function") {
    throw configurationError("fetchImpl must be a function.");
  }
  if (typeof monotonicSeconds !== "function") {
    throw configurationError("monotonicSeconds must be a function.");
  }
  if (typeof now !== "function") throw configurationError("now must be a function.");
  if (typeof sleepImpl !== "function") {
    throw configurationError("sleepImpl must be a function.");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw configurationError("maxAttempts must be an integer between 1 and 5.");
  }

  return {
    async searchWeb(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw invalidArgument("Brave Search arguments must be an object.");
      }
      const allowedArguments = new Set(["count", "freshness", "query", "timeout_seconds"]);
      const unknownArguments = Object.keys(input)
        .filter((key) => !allowedArguments.has(key))
        .sort();
      if (unknownArguments.length > 0) {
        throw invalidArgument(
          `unsupported Brave Search arguments: ${unknownArguments.join(", ")}.`,
        );
      }
      if (typeof input?.query !== "string") {
        throw invalidArgument("query must be a string.");
      }
      const query = input.query.trim();
      const count = input?.count ?? 10;
      const freshness = validateFreshness(input?.freshness);
      const timeoutSeconds = input?.timeout_seconds ?? 10;
      if (!query) throw invalidArgument("query is required.");
      if (query.length > 400) {
        throw invalidArgument("query must contain at most 400 characters.");
      }
      if (query.split(/\s+/u).length > 50) {
        throw invalidArgument("query must contain at most 50 words.");
      }
      if (!Number.isInteger(count) || count < 1 || count > 20) {
        throw invalidArgument("count must be an integer between 1 and 20.");
      }
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0.1 || timeoutSeconds > 25) {
        throw invalidArgument("timeout_seconds must be between 0.1 and 25.");
      }

      const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      url.searchParams.set("country", "us");
      url.searchParams.set("search_lang", "en");
      if (freshness) url.searchParams.set("freshness", freshness);

      const deadlineSeconds = monotonicSeconds() + timeoutSeconds;
      const payload = await fetchJsonWithRetry({
        backoffMaxSeconds,
        backoffSeconds,
        deadlineSeconds,
        fetchImpl,
        maxAttempts,
        monotonicSeconds,
        request: {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
          signalFactory: (remainingSeconds) => AbortSignal.timeout(
            Math.max(1, Math.floor(remainingSeconds * 1_000)),
          ),
        },
        sleepImpl,
        url,
      });
      let rawResults = [];
      if (payload.web !== undefined) {
        if (!payload.web || typeof payload.web !== "object" || Array.isArray(payload.web)) {
          throw new BraveSearchError(
            "invalid_provider_response",
            "Brave Search web payload was malformed.",
          );
        }
        if (payload.web.results !== undefined && !Array.isArray(payload.web.results)) {
          throw new BraveSearchError(
            "invalid_provider_response",
            "Brave Search web.results was not a list.",
          );
        }
        rawResults = payload.web.results ?? [];
      }
      const results = [];
      let resultsSkipped = Math.max(0, rawResults.length - count);
      for (const [index, item] of rawResults.slice(0, count).entries()) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          resultsSkipped += 1;
          continue;
        }
        const urlValue = optionalText(item.url);
        if (!urlValue || !isHttpUrl(urlValue)) {
          resultsSkipped += 1;
          continue;
        }
        const result = {
          rank: index + 1,
          snippet: optionalText(item.description) ?? "",
          title: optionalText(item.title) ?? "",
          url: urlValue,
        };
        const publishedAt = optionalText(item.age ?? item.page_age);
        if (publishedAt) result.published_at = publishedAt;
        results.push(result);
      }
      return {
        count_requested: count,
        freshness: freshness || null,
        provider: "brave",
        query,
        results,
        results_skipped: resultsSkipped,
        retrieved_at: now().toISOString(),
      };
    },
  };
}

async function fetchJsonWithRetry({
  backoffMaxSeconds,
  backoffSeconds,
  deadlineSeconds,
  fetchImpl,
  maxAttempts,
  monotonicSeconds,
  request,
  sleepImpl,
  url,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remainingSeconds = deadlineSeconds - monotonicSeconds();
    if (remainingSeconds <= 0) throw requestTimeoutError(attempt - 1);
    let response;
    try {
      response = await fetchImpl(url, {
        headers: request.headers,
        signal: request.signalFactory(remainingSeconds),
      });
    } catch (error) {
      if (attempt < maxAttempts) {
        await boundedRetrySleep({
          attempt,
          backoffMaxSeconds,
          backoffSeconds,
          deadlineSeconds,
          monotonicSeconds,
          sleepImpl,
        });
        continue;
      }
      if (deadlineSeconds - monotonicSeconds() <= 0) {
        throw requestTimeoutError(attempt);
      }
      throw new BraveSearchError(
        "dependency_unavailable",
        `Brave Search request failed after ${attempt} attempts.`,
        { cause: error, retryable: true },
      );
    }

    if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt < maxAttempts) {
      await boundedRetrySleep({
        attempt,
        backoffMaxSeconds,
        backoffSeconds,
        deadlineSeconds,
        monotonicSeconds,
        retryAfter: response.headers.get("Retry-After"),
        sleepImpl,
      });
      continue;
    }

    if (!response.ok) throw httpError(response.status);
    const body = await readBoundedResponseText(response);
    try {
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("not an object");
      }
      return payload;
    } catch (error) {
      throw new BraveSearchError(
        "invalid_provider_response",
        "Brave Search returned invalid JSON.",
        { cause: error },
      );
    }
  }
  throw new BraveSearchError("dependency_unavailable", "Brave Search request failed.");
}

async function readBoundedResponseText(response) {
  const rawContentLength = response.headers?.get?.("Content-Length");
  if (typeof rawContentLength === "string" && /^\d+$/u.test(rawContentLength)) {
    const contentLength = Number(rawContentLength);
    if (Number.isSafeInteger(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw oversizedResponseError();
    }
  }
  if (!response.body) return "";
  if (typeof response.body.getReader !== "function") {
    throw new BraveSearchError(
      "invalid_provider_response",
      "Brave Search response body was not readable.",
    );
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new BraveSearchError(
          "invalid_provider_response",
          "Brave Search response contained an invalid byte chunk.",
        );
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded-response failure if cancellation itself fails.
        }
        throw oversizedResponseError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function oversizedResponseError() {
  return new BraveSearchError(
    "invalid_provider_response",
    "Brave Search response exceeded the bounded response size.",
  );
}

async function boundedRetrySleep({
  attempt,
  backoffMaxSeconds,
  backoffSeconds,
  deadlineSeconds,
  monotonicSeconds,
  retryAfter,
  sleepImpl,
}) {
  const delay = retryDelay(attempt, backoffSeconds, backoffMaxSeconds, retryAfter);
  if (delay >= deadlineSeconds - monotonicSeconds()) {
    throw requestTimeoutError(attempt);
  }
  await sleepImpl(delay);
  if (deadlineSeconds - monotonicSeconds() <= 0) {
    throw requestTimeoutError(attempt);
  }
}

function requestTimeoutError(attempts) {
  return new BraveSearchError(
    "request_timeout",
    `Brave Search exhausted its end-to-end timeout after ${attempts} attempts.`,
    { retryable: true },
  );
}

function retryDelay(attempt, backoffSeconds, backoffMaxSeconds, retryAfter) {
  let delay = Math.min(backoffMaxSeconds, backoffSeconds * (2 ** (attempt - 1)));
  const parsedRetryAfter = Number(retryAfter);
  if (Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0) {
    delay = Math.min(backoffMaxSeconds, Math.max(delay, parsedRetryAfter));
  }
  return delay;
}

function httpError(status) {
  const details = {
    401: ["authentication_failed", "authentication failed; check the configured API key"],
    402: ["payment_required", "payment required; the plan or quota must be raised"],
    403: ["access_denied", "access denied; check the subscription and key scope"],
    422: ["provider_rejected_input", "the provider rejected the request input"],
    429: ["rate_limited", "rate limit persisted after bounded retries"],
  };
  const [code, guidance] = details[status] ?? ["dependency_failed", "provider request failed"];
  return new BraveSearchError(
    code,
    `Brave Search failed with HTTP ${status}: ${guidance}.`,
    { retryable: RETRYABLE_HTTP_STATUSES.has(status), status },
  );
}

function optionalText(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateFreshness(value) {
  if (value !== undefined && typeof value !== "string") {
    throw invalidArgument("freshness must be a string.");
  }
  const freshness = (value ?? "").trim();
  if (!freshness || new Set(["pd", "pw", "pm", "py"]).has(freshness)) {
    return freshness;
  }
  const match = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/u.exec(freshness);
  if (!match || !isIsoDate(match[1]) || !isIsoDate(match[2])) {
    throw invalidArgument(
      "freshness must be pd, pw, pm, py, or YYYY-MM-DDtoYYYY-MM-DD.",
    );
  }
  if (match[1] > match[2]) {
    throw invalidArgument("freshness range start must not be after its end.");
  }
  return freshness;
}

function invalidArgument(message) {
  return new BraveSearchError("invalid_arguments", message);
}

function configurationError(message) {
  return new BraveSearchError("configuration_error", message);
}

function isIsoDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
