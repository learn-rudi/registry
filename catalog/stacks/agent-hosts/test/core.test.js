import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_HOST_ADAPTER_IDS,
  createAgentHostService,
} from "../src/core.js";

test("fleet list is fixed and ordered without a default provider", () => {
  const adapters = AGENT_HOST_ADAPTER_IDS.map((adapterId) => ({
    adapterId,
    invoke: async () => ({ adapterId, invocationId: "unused", ok: true }),
    probe: async () => ({ adapterId, status: "ready" }),
  }));
  const service = createAgentHostService({ adapters });

  assert.deepEqual(service.list(), {
    adapters: [
      { adapter_id: "deepseek-http-v1" },
      { adapter_id: "claude-code-cli-v1" },
      { adapter_id: "codex-cli-v1" },
    ],
    default_adapter_id: null,
  });
});

test("probe targets one explicit adapter or the whole fixed fleet", async () => {
  const calls = [];
  const adapters = AGENT_HOST_ADAPTER_IDS.map((adapterId) => ({
    adapterId,
    invoke: async () => ({ adapterId, invocationId: "unused", ok: true }),
    probe: async () => {
      calls.push(adapterId);
      return { adapterId, status: "ready" };
    },
  }));
  const service = createAgentHostService({ adapters });

  assert.deepEqual(await service.probe({ adapter_id: "codex-cli-v1" }), {
    adapters: [{ adapter_id: "codex-cli-v1", status: "ready" }],
  });
  assert.deepEqual(calls, ["codex-cli-v1"]);

  calls.length = 0;
  assert.deepEqual(await service.probe({}), {
    adapters: [
      { adapter_id: "deepseek-http-v1", status: "ready" },
      { adapter_id: "claude-code-cli-v1", status: "ready" },
      { adapter_id: "codex-cli-v1", status: "ready" },
    ],
  });
  assert.deepEqual(calls, AGENT_HOST_ADAPTER_IDS);

  await assert.rejects(
    () => service.probe({ adapter_id: "not-a-provider" }),
    (error) => error?.code === "adapter_not_found"
  );
  await assert.rejects(
    () => service.probe({ unexpected: true }),
    (error) => error?.code === "invalid_request"
  );
});

test("invoke validates the full contract and rejects overlapping provider work", async () => {
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const received = [];
  const adapters = AGENT_HOST_ADAPTER_IDS.map((adapterId) => ({
    adapterId,
    invoke: async (request) => {
      received.push(request);
      if (request.invocationId === "invoke:first") {
        await firstBlocked;
      }
      return {
        adapterId,
        invocationId: request.invocationId,
        modelRef: "test-model",
        ok: true,
        outputText: '{"answer":"ok"}',
        runtimeRef: "test-runtime",
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      };
    },
    probe: async () => ({ adapterId, status: "ready" }),
  }));
  const service = createAgentHostService({ adapters });
  const request = {
    adapter_id: "deepseek-http-v1",
    content_class: "synthetic_nonprivate",
    correlation_id: "correlation:1",
    invocation_id: "invoke:first",
    output_format: "json",
    prompt: "Return one JSON object.",
    timeout_ms: 25_000,
  };

  const first = service.invoke(request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await service.invoke({
    ...request,
    invocation_id: "invoke:second",
  }), {
    adapter_id: "deepseek-http-v1",
    correlation_id: "correlation:1",
    failure_class: "busy",
    invocation_id: "invoke:second",
    ok: false,
    retryable: true,
    summary: "Agent Host adapter already has an invocation in progress.",
  });
  releaseFirst();
  assert.deepEqual(await first, {
    adapter_id: "deepseek-http-v1",
    correlation_id: "correlation:1",
    invocation_id: "invoke:first",
    model_ref: "test-model",
    ok: true,
    output_text: '{"answer":"ok"}',
    runtime_ref: "test-runtime",
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  });
  assert.deepEqual(received, [{
    adapterId: "deepseek-http-v1",
    contentClass: "synthetic_nonprivate",
    correlationId: "correlation:1",
    invocationId: "invoke:first",
    outputFormat: "json",
    prompt: "Return one JSON object.",
    timeoutMs: 25_000,
  }]);

  const invalidRequests = [
    {},
    { ...request, adapter_id: "not-a-provider" },
    { ...request, content_class: "private" },
    { ...request, correlation_id: "bad id" },
    { ...request, invocation_id: "" },
    { ...request, output_format: "markdown" },
    { ...request, prompt: "" },
    { ...request, prompt: "x".repeat(200_001) },
    { ...request, timeout_ms: 999 },
    { ...request, timeout_ms: 25_001 },
    { ...request, unexpected: true },
  ];
  for (const invalid of invalidRequests) {
    await assert.rejects(
      () => service.invoke(invalid),
      (error) => ["adapter_not_found", "invalid_request"].includes(error?.code)
    );
  }
});
