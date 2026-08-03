import { readdirSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { createMinimalAgentHostEnvironment, NodeProcessExecutor } from "./process-executor.js";
import {
  failure,
  isRecord,
  safeMetadata,
  validateProviderInvocation,
  validateProviderOutput,
} from "./provider-contract.js";

const MAX_CLI_STDOUT_BYTES = 2_097_152;
export const SUPPORTED_CLAUDE_RUNTIME_REF = "2.1.219 (Claude Code)";

export class ClaudeCodeAgentHost {
  adapterId = "claude-code-cli-v1";

  constructor({
    binaryPath,
    executor = new NodeProcessExecutor(),
    modelRef = "claude-host-default",
    runtimeDirectory,
    runtimeRef = "claude-code-runtime-unresolved",
  }) {
    if (!isAbsolute(binaryPath)) throw new Error("Claude binary path must be absolute.");
    this.binaryPath = binaryPath;
    this.executor = executor;
    this.modelRef = requireMetadata(modelRef, "Claude model reference");
    this.runtimeDirectory = requireEmptyDirectory(runtimeDirectory, "Claude");
    this.runtimeRef = requireMetadata(runtimeRef, "Claude runtime reference");
  }

  async probe() {
    const version = await this.executor.execute({
      arguments: ["--version"],
      command: this.binaryPath,
      environment: createMinimalAgentHostEnvironment(),
      maxStdoutBytes: 16_384,
      stdin: "",
      timeoutMs: 5_000,
      workingDirectory: this.runtimeDirectory,
    });
    if (version.startError) return { adapterId: this.adapterId, status: "not_installed" };
    if (version.exitCode !== 0 || version.stdoutOverflow) {
      return { adapterId: this.adapterId, status: "unavailable" };
    }
    const observedRuntimeRef = safeMetadata(version.stdout, this.runtimeRef);
    if (observedRuntimeRef !== SUPPORTED_CLAUDE_RUNTIME_REF) {
      return {
        adapterId: this.adapterId,
        runtimeRef: observedRuntimeRef,
        status: "unavailable",
        summary: "Installed Claude runtime is outside the V0 allowlist.",
      };
    }
    const auth = await this.executor.execute({
      arguments: ["auth", "status"],
      command: this.binaryPath,
      environment: createMinimalAgentHostEnvironment(),
      maxStdoutBytes: 16_384,
      stdin: "",
      timeoutMs: 5_000,
      workingDirectory: this.runtimeDirectory,
    });
    return {
      adapterId: this.adapterId,
      modelRef: this.modelRef,
      runtimeRef: observedRuntimeRef,
      status: isClaudeAuthenticated(auth) ? "ready" : "not_authenticated",
    };
  }

  async invoke(request, options = {}) {
    if (this.runtimeRef !== SUPPORTED_CLAUDE_RUNTIME_REF) {
      return failure(this.adapterId, request?.invocationId,
        "configuration_invalid", false,
        "Installed Claude runtime is outside the V0 allowlist.");
    }
    try {
      validateProviderInvocation(request, this.adapterId);
    } catch {
      return failure(this.adapterId, request?.invocationId,
        "configuration_invalid", false,
        "Agent Host invocation did not satisfy the contract.");
    }
    const execution = await this.executor.execute({
      arguments: [
        "--print",
        "--input-format", "text",
        "--output-format", "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--safe-mode",
        "--disable-slash-commands",
        "--no-chrome",
        "--strict-mcp-config",
        "--tools", "",
        "--permission-mode", "plan",
      ],
      command: this.binaryPath,
      environment: createMinimalAgentHostEnvironment(),
      maxStdoutBytes: MAX_CLI_STDOUT_BYTES,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      workingDirectory: this.runtimeDirectory,
    });
    const processFailure = mapProcessFailure(this.adapterId, request.invocationId, execution);
    if (processFailure) return processFailure;

    try {
      const parsed = parseClaudeStreamJson(execution.stdout);
      validateProviderOutput(parsed.outputText, request.outputFormat);
      return {
        adapterId: this.adapterId,
        ...(parsed.costUsd === undefined ? {} : { costUsd: parsed.costUsd }),
        invocationId: request.invocationId,
        modelRef: parsed.modelRef ?? this.modelRef,
        ok: true,
        outputText: parsed.outputText,
        ...(parsed.providerSessionRef === undefined
          ? {}
          : { providerSessionRef: parsed.providerSessionRef }),
        runtimeRef: this.runtimeRef,
        ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
      };
    } catch (error) {
      const providerRejected = error instanceof ClaudeProviderRejectedError;
      return failure(
        this.adapterId,
        request.invocationId,
        providerRejected ? "provider_rejected" : "invalid_output",
        false,
        providerRejected
          ? "Claude rejected the invocation without a result."
          : "Claude returned invalid or oversized output."
      );
    }
  }
}

class ClaudeProviderRejectedError extends Error {}

function parseClaudeStreamJson(stdout) {
  let modelRef;
  let resultEvent;
  let terminalSeen = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const event = JSON.parse(line);
    if (!isRecord(event) || typeof event.type !== "string" || terminalSeen) {
      throw new Error("Claude event stream is invalid.");
    }
    if (safeMetadata(event.model, undefined) !== undefined) modelRef = event.model;
    if (
      event.type === "assistant"
      && isRecord(event.message)
      && safeMetadata(event.message.model, undefined) !== undefined
    ) {
      modelRef = event.message.model;
    }
    if (event.type === "result") {
      if (resultEvent !== undefined) throw new Error("Duplicate Claude result.");
      resultEvent = event;
      terminalSeen = true;
    }
  }
  if (!resultEvent) throw new Error("Claude result is missing.");
  if (resultEvent.is_error === true) throw new ClaudeProviderRejectedError();
  if (
    resultEvent.is_error !== false
    || resultEvent.subtype !== "success"
    || typeof resultEvent.result !== "string"
  ) {
    throw new Error("Claude result is invalid.");
  }
  const inputTokens = safeCount(resultEvent.usage?.input_tokens);
  const outputTokens = safeCount(resultEvent.usage?.output_tokens);
  const usage = inputTokens === undefined && outputTokens === undefined
    ? undefined
    : {
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(outputTokens === undefined ? {} : { outputTokens }),
        ...(inputTokens === undefined || outputTokens === undefined
          ? {}
          : { totalTokens: inputTokens + outputTokens }),
      };
  return {
    ...(typeof resultEvent.total_cost_usd === "number"
      && Number.isFinite(resultEvent.total_cost_usd)
      && resultEvent.total_cost_usd >= 0
      ? { costUsd: resultEvent.total_cost_usd }
      : {}),
    ...(modelRef === undefined ? {} : { modelRef }),
    outputText: resultEvent.result,
    ...(safeMetadata(resultEvent.session_id, undefined) === undefined
      ? {}
      : { providerSessionRef: resultEvent.session_id }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function mapProcessFailure(adapterId, invocationId, execution) {
  if (!execution.terminationConfirmed) {
    return failure(adapterId, invocationId, "termination_unconfirmed", false,
      "Claude process termination could not be confirmed.");
  }
  if (execution.cancelled) {
    return failure(adapterId, invocationId, "cancelled", false,
      "Claude invocation was cancelled.");
  }
  if (execution.timedOut) {
    return failure(adapterId, invocationId, "timeout", true,
      "Claude invocation timed out.");
  }
  if (execution.startError) {
    return failure(adapterId, invocationId, "not_available", false,
      "Claude could not be started.");
  }
  if (execution.stdoutOverflow) {
    return failure(adapterId, invocationId, "invalid_output", false,
      "Claude process output exceeded its byte limit.");
  }
  if (execution.exitCode !== 0) {
    return failure(adapterId, invocationId, "process_failed", false,
      "Claude exited without a successful result.");
  }
  return undefined;
}

function isClaudeAuthenticated(execution) {
  if (execution.exitCode !== 0 || execution.stdoutOverflow || execution.startError) return false;
  try {
    const status = JSON.parse(execution.stdout);
    return isRecord(status) && status.loggedIn === true;
  } catch {
    return false;
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function requireMetadata(value, label) {
  const safe = safeMetadata(value, undefined);
  if (safe === undefined) throw new Error(`${label} is invalid.`);
  return safe;
}

function requireEmptyDirectory(value, label) {
  try {
    if (!isAbsolute(value) || !statSync(value).isDirectory() || readdirSync(value).length !== 0) {
      throw new Error("invalid directory");
    }
  } catch {
    throw new Error(`${label} runtime directory must be an existing empty directory.`);
  }
  return value;
}
