import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClaudeCodeAgentHost } from "../src/claude.js";

test("Claude uses tool-free plan-mode stdin and returns only the terminal result", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-claude-host-test-"));
  try {
    const executor = new RecordingProcessExecutor({
      cancelled: false,
      exitCode: 0,
      startError: false,
      stderrHadOutput: false,
      stdout: [
        JSON.stringify({ model: "claude-opus-5", subtype: "init", type: "system" }),
        JSON.stringify({
          message: {
            content: [{ text: "intermediate text", type: "text" }],
            model: "claude-opus-5",
          },
          type: "assistant",
        }),
        JSON.stringify({
          is_error: false,
          result: '{"status":"ok"}',
          session_id: "claude-safe-ref",
          subtype: "success",
          total_cost_usd: 0.004,
          type: "result",
          usage: { input_tokens: 11, output_tokens: 5 },
        }),
      ].join("\n"),
      stdoutOverflow: false,
      terminationConfirmed: true,
      timedOut: false,
    });
    const host = new ClaudeCodeAgentHost({
      binaryPath: "/Applications/Claude/claude",
      executor,
      runtimeDirectory,
      runtimeRef: "2.1.219 (Claude Code)",
    });
    const prompt = "synthetic prompt supplied only over stdin";

    const result = await host.invoke({
      adapterId: "claude-code-cli-v1",
      contentClass: "synthetic_nonprivate",
      correlationId: "request:claude-1",
      invocationId: "invocation:claude-1",
      outputFormat: "json",
      prompt,
      timeoutMs: 25_000,
    });

    assert.deepEqual(result, {
      adapterId: "claude-code-cli-v1",
      costUsd: 0.004,
      invocationId: "invocation:claude-1",
      modelRef: "claude-opus-5",
      ok: true,
      outputText: '{"status":"ok"}',
      providerSessionRef: "claude-safe-ref",
      runtimeRef: "2.1.219 (Claude Code)",
      usage: { inputTokens: 11, outputTokens: 5, totalTokens: 16 },
    });
    const execution = executor.requests[0];
    assert.equal(execution.stdin, prompt);
    assert.equal(execution.arguments.includes(prompt), false);
    assert.equal(execution.arguments.includes("--print"), true);
    assert.equal(execution.arguments.includes("--safe-mode"), true);
    assert.equal(execution.arguments.includes("--no-session-persistence"), true);
    assert.equal(argumentValue(execution.arguments, "--tools"), "");
    assert.equal(argumentValue(execution.arguments, "--permission-mode"), "plan");
    assert.equal(execution.arguments.includes("--dangerously-skip-permissions"), false);
    assert.equal(Object.keys(execution.environment).some((name) => (
      name === "ANTHROPIC_API_KEY" || name.includes("SECRET")
    )), false);
    assert.equal(result.outputText.includes("intermediate"), false);
  } finally {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

test("Claude maps provider rejection without exposing provider text", async () => {
  const runtimeDirectory = mkdtempSync(join(tmpdir(), "rudi-claude-reject-test-"));
  try {
    const host = new ClaudeCodeAgentHost({
      binaryPath: "/Applications/Claude/claude",
      executor: new RecordingProcessExecutor({
        cancelled: false,
        exitCode: 0,
        startError: false,
        stderrHadOutput: true,
        stdout: JSON.stringify({
          is_error: true,
          result: "private provider body and prompt fragment",
          subtype: "error_max_turns",
          type: "result",
        }),
        stdoutOverflow: false,
        terminationConfirmed: true,
        timedOut: false,
      }),
      runtimeDirectory,
      runtimeRef: "2.1.219 (Claude Code)",
    });
    const result = await host.invoke({
      adapterId: "claude-code-cli-v1",
      contentClass: "synthetic_nonprivate",
      correlationId: "request:claude-reject",
      invocationId: "invocation:claude-reject",
      outputFormat: "text",
      prompt: "prompt fragment",
      timeoutMs: 25_000,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failureClass, "provider_rejected");
    assert.equal(result.summary.includes("private"), false);
    assert.equal(result.summary.includes("prompt fragment"), false);
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

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  return index < 0 ? undefined : arguments_[index + 1];
}
