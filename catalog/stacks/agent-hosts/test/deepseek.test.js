import assert from "node:assert/strict";
import test from "node:test";

import { DeepSeekHttpAgentHost } from "../src/deepseek.js";

test("DeepSeek uses only the pinned endpoint and a just-in-time RUDI secret", async () => {
  const secretProvider = new FakeSecretProvider("deepseek-test-secret");
  const calls = [];
  const host = new DeepSeekHttpAgentHost({
    fetchImplementation: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"status":"ok"}' } }],
        model: "deepseek-v4-flash-202607",
        usage: { completion_tokens: 6, prompt_tokens: 12, total_tokens: 18 },
      }), { status: 200 });
    },
    secretProvider,
  });

  const result = await host.invoke({
    adapterId: "deepseek-http-v1",
    contentClass: "synthetic_nonprivate",
    correlationId: "request:deepseek-1",
    invocationId: "invocation:deepseek-1",
    outputFormat: "json",
    prompt: "synthetic prompt",
    timeoutMs: 25_000,
  });

  assert.deepEqual(result, {
    adapterId: "deepseek-http-v1",
    invocationId: "invocation:deepseek-1",
    modelRef: "deepseek-v4-flash-202607",
    ok: true,
    outputText: '{"status":"ok"}',
    runtimeRef: "deepseek-chat-completions-v1",
    usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
  });
  assert.deepEqual(secretProvider.names, ["DEEPSEEK_API_KEY"]);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.input, "https://api.deepseek.com/chat/completions");
  assert.equal(call.init.redirect, "error");
  assert.equal(call.init.method, "POST");
  assert.equal(new Headers(call.init.headers).get("authorization"),
    "Bearer deepseek-test-secret");
  const body = JSON.parse(String(call.init.body));
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.stream, false);
  assert.equal("tools" in body, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("DeepSeek distinguishes dependency failure from invalid provider output", async () => {
  const host = new DeepSeekHttpAgentHost({
    fetchImplementation: async () => {
      throw new TypeError("network failure with internal details");
    },
    secretProvider: new FakeSecretProvider("deepseek-test-secret"),
  });
  const result = await host.invoke({
    adapterId: "deepseek-http-v1",
    contentClass: "synthetic_nonprivate",
    correlationId: "request:deepseek-network",
    invocationId: "invocation:deepseek-network",
    outputFormat: "text",
    prompt: "synthetic prompt",
    timeoutMs: 25_000,
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "provider_unavailable");
  assert.equal(result.retryable, true);
  assert.equal(result.summary.includes("internal"), false);
});

test("DeepSeek fails closed on endpoint drift and rate limits without body leakage", async () => {
  assert.throws(() => new DeepSeekHttpAgentHost({
    endpoint: "https://api.deepseek.com/chat/completions?forward=elsewhere",
    secretProvider: new FakeSecretProvider("deepseek-test-secret"),
  }), /pinned DeepSeek endpoint/);

  const host = new DeepSeekHttpAgentHost({
    fetchImplementation: async () => new Response(
      "private upstream body and prompt fragment",
      { status: 429 }
    ),
    secretProvider: new FakeSecretProvider("deepseek-test-secret"),
  });
  const result = await host.invoke({
    adapterId: "deepseek-http-v1",
    contentClass: "synthetic_nonprivate",
    correlationId: "request:deepseek-rate",
    invocationId: "invocation:deepseek-rate",
    outputFormat: "text",
    prompt: "prompt fragment",
    timeoutMs: 25_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "rate_limited");
  assert.equal(result.retryable, true);
  assert.equal(result.summary.includes("private"), false);
  assert.equal(result.summary.includes("prompt fragment"), false);
});

class FakeSecretProvider {
  names = [];

  constructor(value) {
    this.value = value;
  }

  async getSecret(name) {
    this.names.push(name);
    return this.value;
  }
}
