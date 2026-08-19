import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexCliAgentHost } from "../src/codex.js";

test("Codex uses an isolated read-only ephemeral stdin invocation", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-codex-host-test-"));
  try {
    const executor = new RecordingProcessExecutor({
      cancelled: false,
      exitCode: 0,
      startError: false,
      stderrHadOutput: false,
      stdout: [
        JSON.stringify({ type: "thread.started", thread_id: "thread-safe-ref" }),
        JSON.stringify({
          item: { id: "item-1", text: '{"status":"ok"}', type: "agent_message" },
          type: "item.completed",
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 9, output_tokens: 4 },
        }),
      ].join("\n"),
      stdoutOverflow: false,
      terminationConfirmed: true,
      timedOut: false,
    });
    const host = new CodexCliAgentHost({
      binaryPath: "/usr/local/bin/codex",
      capabilitiesVerified: true,
      codexHome: runtimeDirectory,
      executor,
      runtimeDirectory,
      runtimeRef: "codex-cli 0.147.0",
    });
    const prompt = "synthetic prompt supplied only over stdin";

    const result = await host.invoke({
      adapterId: "codex-cli-v1",
      contentClass: "synthetic_nonprivate",
      correlationId: "request:codex-1",
      invocationId: "invocation:codex-1",
      outputFormat: "json",
      prompt,
      timeoutMs: 25_000,
    });

    assert.deepEqual(result, {
      adapterId: "codex-cli-v1",
      invocationId: "invocation:codex-1",
      modelRef: "codex-subscription-default",
      ok: true,
      outputText: '{"status":"ok"}',
      providerSessionRef: "thread-safe-ref",
      runtimeRef: "codex-cli 0.147.0",
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
    });
    const execution = executor.requests[0];
    assert.equal(execution.stdin, prompt);
    assert.equal(execution.arguments.includes(prompt), false);
    assert.equal(execution.arguments.includes("exec"), true);
    assert.equal(execution.arguments.includes("--json"), true);
    assert.equal(execution.arguments.includes("--ephemeral"), true);
    assert.equal(execution.arguments.includes("read-only"), true);
    assert.equal(execution.arguments.includes("--ignore-user-config"), true);
    assert.equal(execution.arguments.includes("--ignore-rules"), true);
    assert.equal(execution.arguments.includes("--strict-config"), true);
    assert.equal(execution.arguments.includes("danger-full-access"), false);
    assert.equal(execution.arguments.includes("--full-auto"), false);
    assert.equal(execution.environment.CODEX_HOME, runtimeDirectory);
    assert.equal(Object.keys(execution.environment).some((name) => (
      name.includes("SECRET") || name === "OPENAI_API_KEY"
    )), false);
  } finally {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

test("Codex rejects an in-range runtime without verified guarded capabilities", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-codex-capability-test-"));
  try {
    const executor = new RecordingProcessExecutor(successfulCodexResult());
    const host = new CodexCliAgentHost({
      binaryPath: "/usr/local/bin/codex",
      capabilitiesVerified: false,
      codexHome: runtimeDirectory,
      executor,
      runtimeDirectory,
      runtimeRef: "codex-cli 0.147.0",
    });
    const result = await host.invoke(validCodexRequest("missing-option"));
    assert.equal(result.failureClass, "configuration_invalid");
    assert.equal(executor.requests.length, 0);
  } finally {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

test("Codex rejects the unreviewed upper version boundary before execution", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-codex-version-test-"));
  try {
    const executor = new RecordingProcessExecutor(successfulCodexResult());
    const host = new CodexCliAgentHost({
      binaryPath: "/usr/local/bin/codex",
      capabilitiesVerified: true,
      codexHome: runtimeDirectory,
      executor,
      runtimeDirectory,
      runtimeRef: "codex-cli 0.150.0",
    });
    const result = await host.invoke(validCodexRequest("future-version"));
    assert.equal(result.failureClass, "configuration_invalid");
    assert.equal(executor.requests.length, 0);
  } finally {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

test("Codex blocks retry when process termination is unconfirmed", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-codex-stop-test-"));
  try {
    const host = new CodexCliAgentHost({
      binaryPath: "/usr/local/bin/codex",
      capabilitiesVerified: true,
      codexHome: runtimeDirectory,
      executor: new RecordingProcessExecutor({
        cancelled: true,
        exitCode: null,
        startError: false,
        stderrHadOutput: false,
        stdout: "",
        stdoutOverflow: false,
        terminationConfirmed: false,
        timedOut: false,
      }),
      runtimeDirectory,
      runtimeRef: "codex-cli 0.145.0",
    });
    const result = await host.invoke({
      adapterId: "codex-cli-v1",
      contentClass: "synthetic_nonprivate",
      correlationId: "request:codex-stop",
      invocationId: "invocation:codex-stop",
      outputFormat: "text",
      prompt: "synthetic prompt",
      timeoutMs: 25_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failureClass, "termination_unconfirmed");
    assert.equal(result.retryable, false);
  } finally {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

class RecordingProcessExecutor {
  requests = [];

  constructor(result) {
    this.result = result;
  }

  async execute(request) {
    this.requests.push(request);
    return this.result;
  }
}

function validCodexRequest(suffix) {
  return {
    adapterId: "codex-cli-v1",
    contentClass: "synthetic_nonprivate",
    correlationId: `request:codex-${suffix}`,
    invocationId: `invocation:codex-${suffix}`,
    outputFormat: "json",
    prompt: "synthetic prompt",
    timeoutMs: 25_000,
  };
}

function successfulCodexResult() {
  return {
    cancelled: false,
    exitCode: 0,
    startError: false,
    stderrHadOutput: false,
    stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "thread-safe-ref" }),
      JSON.stringify({
        item: { id: "item-1", text: '{"status":"ok"}', type: "agent_message" },
        type: "item.completed",
      }),
      JSON.stringify({ type: "turn.completed", usage: {} }),
    ].join("\n"),
    stdoutOverflow: false,
    terminationConfirmed: true,
    timedOut: false,
  };
}
