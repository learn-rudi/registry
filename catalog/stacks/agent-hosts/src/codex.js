import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { createMinimalAgentHostEnvironment, NodeProcessExecutor } from "./process-executor.js";
import {
  failure,
  isRecord,
  safeMetadata,
  validateProviderInvocation,
  validateProviderOutput,
} from "./provider-contract.js";

const MAX_CLI_STDOUT_BYTES = 2_097_152;
export const SUPPORTED_CODEX_RUNTIME_REF = "codex-cli 0.145.0";

export class CodexCliAgentHost {
  adapterId = "codex-cli-v1";

  constructor({
    binaryPath,
    codexHome,
    executor = new NodeProcessExecutor(),
    modelRef = "codex-subscription-default",
    runtimeDirectory,
    runtimeRef = "codex-cli-runtime-unresolved",
  }) {
    if (!isAbsolute(binaryPath)) throw new Error("Codex binary path must be absolute.");
    this.binaryPath = binaryPath;
    this.codexHome = requireCodexHome(codexHome);
    this.executor = executor;
    this.modelRef = requireMetadata(modelRef, "Codex model reference");
    this.runtimeDirectory = requireEmptyDirectory(runtimeDirectory);
    this.runtimeRef = requireMetadata(runtimeRef, "Codex runtime reference");
  }

  async probe() {
    const version = await this.executor.execute({
      arguments: ["--version"],
      command: this.binaryPath,
      environment: this.environment(),
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
    if (observedRuntimeRef !== SUPPORTED_CODEX_RUNTIME_REF) {
      return {
        adapterId: this.adapterId,
        runtimeRef: observedRuntimeRef,
        status: "unavailable",
        summary: "Installed Codex runtime is outside the V0 allowlist.",
      };
    }
    const auth = await this.executor.execute({
      arguments: ["login", "status"],
      command: this.binaryPath,
      environment: this.environment(),
      maxStdoutBytes: 16_384,
      stdin: "",
      timeoutMs: 5_000,
      workingDirectory: this.runtimeDirectory,
    });
    return {
      adapterId: this.adapterId,
      modelRef: this.modelRef,
      runtimeRef: observedRuntimeRef,
      status: auth.exitCode === 0 && !auth.stdoutOverflow && !auth.startError
        ? "ready"
        : "not_authenticated",
    };
  }

  async invoke(request, options = {}) {
    if (this.runtimeRef !== SUPPORTED_CODEX_RUNTIME_REF) {
      return failure(this.adapterId, request?.invocationId,
        "configuration_invalid", false,
        "Installed Codex runtime is outside the V0 allowlist.");
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
        "exec", "-",
        "-C", this.runtimeDirectory,
        "--skip-git-repo-check",
        "--json",
        "--ephemeral",
        "--color", "never",
        "--sandbox", "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
      ],
      command: this.binaryPath,
      environment: this.environment(),
      maxStdoutBytes: MAX_CLI_STDOUT_BYTES,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      workingDirectory: this.runtimeDirectory,
    });
    const processFailure = mapProcessFailure(this.adapterId, request.invocationId, execution);
    if (processFailure) return processFailure;

    try {
      const parsed = parseCodexJsonLines(execution.stdout);
      validateProviderOutput(parsed.outputText, request.outputFormat);
      return {
        adapterId: this.adapterId,
        invocationId: request.invocationId,
        modelRef: this.modelRef,
        ok: true,
        outputText: parsed.outputText,
        ...(parsed.providerSessionRef === undefined
          ? {}
          : { providerSessionRef: parsed.providerSessionRef }),
        runtimeRef: this.runtimeRef,
        ...(parsed.usage === undefined ? {} : { usage: parsed.usage }),
      };
    } catch {
      return failure(this.adapterId, request.invocationId, "invalid_output", false,
        "Codex returned invalid or oversized output.");
    }
  }

  environment() {
    return createMinimalAgentHostEnvironment({
      ...process.env,
      CODEX_HOME: this.codexHome,
    });
  }
}

function parseCodexJsonLines(stdout) {
  let outputText;
  let providerSessionRef;
  let usage;
  let turnCompleted = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const event = JSON.parse(line);
    if (!isRecord(event) || typeof event.type !== "string" || turnCompleted) {
      throw new Error("Codex event stream is invalid.");
    }
    if (
      event.type === "thread.started"
      && safeMetadata(event.thread_id, undefined) !== undefined
    ) {
      providerSessionRef = event.thread_id;
    }
    if (
      event.type === "item.completed"
      && isRecord(event.item)
      && event.item.type === "agent_message"
      && typeof event.item.text === "string"
    ) {
      outputText = event.item.text;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      throw new Error("Codex provider failed.");
    }
    if (event.type === "turn.completed") {
      const inputTokens = safeCount(event.usage?.input_tokens);
      const outputTokens = safeCount(event.usage?.output_tokens);
      usage = inputTokens === undefined && outputTokens === undefined
        ? undefined
        : {
            ...(inputTokens === undefined ? {} : { inputTokens }),
            ...(outputTokens === undefined ? {} : { outputTokens }),
            ...(inputTokens === undefined || outputTokens === undefined
              ? {}
              : { totalTokens: inputTokens + outputTokens }),
          };
      turnCompleted = true;
    }
  }
  if (outputText === undefined || !turnCompleted) {
    throw new Error("Codex terminal output is missing.");
  }
  return {
    outputText,
    ...(providerSessionRef === undefined ? {} : { providerSessionRef }),
    ...(usage === undefined ? {} : { usage }),
  };
}

function mapProcessFailure(adapterId, invocationId, execution) {
  if (!execution.terminationConfirmed) {
    return failure(adapterId, invocationId, "termination_unconfirmed", false,
      "Codex process termination could not be confirmed.");
  }
  if (execution.cancelled) {
    return failure(adapterId, invocationId, "cancelled", false,
      "Codex invocation was cancelled.");
  }
  if (execution.timedOut) {
    return failure(adapterId, invocationId, "timeout", true,
      "Codex invocation timed out.");
  }
  if (execution.startError) {
    return failure(adapterId, invocationId, "not_available", false,
      "Codex could not be started.");
  }
  if (execution.stdoutOverflow) {
    return failure(adapterId, invocationId, "invalid_output", false,
      "Codex process output exceeded its byte limit.");
  }
  if (execution.exitCode !== 0) {
    return failure(adapterId, invocationId, "process_failed", false,
      "Codex exited without a successful result.");
  }
  return undefined;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function requireMetadata(value, label) {
  const safe = safeMetadata(value, undefined);
  if (safe === undefined) throw new Error(`${label} is invalid.`);
  return safe;
}

function requireEmptyDirectory(value) {
  try {
    if (!isAbsolute(value) || !statSync(value).isDirectory() || readdirSync(value).length !== 0) {
      throw new Error("invalid directory");
    }
  } catch {
    throw new Error("Codex runtime directory must be an existing empty directory.");
  }
  return value;
}

function requireCodexHome(value) {
  try {
    if (!isAbsolute(value) || !statSync(value).isDirectory()) {
      throw new Error("invalid directory");
    }
    for (const forbidden of ["AGENTS.md", "config.toml", "rules"]) {
      if (existsSync(join(value, forbidden))) throw new Error("customization present");
    }
  } catch {
    throw new Error("Codex home must exclude mutable customizations.");
  }
  return value;
}
