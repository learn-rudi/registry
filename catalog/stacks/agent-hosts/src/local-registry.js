import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

import {
  ClaudeCodeAgentHost,
  claudeHelpExposesGuardedCapabilities,
  isCompatibleClaudeRuntime,
} from "./claude.js";
import {
  CodexCliAgentHost,
  codexHelpExposesGuardedCapabilities,
  isCompatibleCodexRuntime,
} from "./codex.js";
import { DeepSeekHttpAgentHost } from "./deepseek.js";
import { createMinimalAgentHostEnvironment } from "./process-executor.js";

export function createLocalAgentHostAdapters(options = {}) {
  const stateRoot = options.stateRoot ?? defaultStateRoot();
  const runtimeDirectory = options.runtimeDirectory
    ?? createEmptyRuntimeDirectory(stateRoot);
  const codexHome = options.codexHome ?? createCodexHome(stateRoot);
  const claudeBinaryPath = options.claudeBinaryPath
    ?? resolveClaudeBinaryPath(runtimeDirectory);
  const codexBinaryPath = options.codexBinaryPath
    ?? resolveCodexBinaryPath(runtimeDirectory);
  validateAbsolutePath(claudeBinaryPath, "Claude binary");
  validateAbsolutePath(codexBinaryPath, "Codex binary");
  const claudeRuntimeRef = detectRuntimeRef(claudeBinaryPath, runtimeDirectory);
  const codexRuntimeRef = detectRuntimeRef(codexBinaryPath, runtimeDirectory);

  return [
    new DeepSeekHttpAgentHost({
      ...(options.fetchImplementation === undefined
        ? {}
        : { fetchImplementation: options.fetchImplementation }),
      secretProvider: options.secretProvider ?? new RudiInjectedSecretProvider(),
    }),
    new ClaudeCodeAgentHost({
      binaryPath: claudeBinaryPath,
      capabilitiesVerified: commandHelpMatches(
        claudeBinaryPath,
        ["--help"],
        runtimeDirectory,
        claudeHelpExposesGuardedCapabilities
      ),
      runtimeDirectory,
      runtimeRef: claudeRuntimeRef,
    }),
    new CodexCliAgentHost({
      binaryPath: codexBinaryPath,
      capabilitiesVerified: commandHelpMatches(
        codexBinaryPath,
        ["exec", "--help"],
        runtimeDirectory,
        codexHelpExposesGuardedCapabilities
      ),
      codexHome,
      runtimeDirectory,
      runtimeRef: codexRuntimeRef,
    }),
  ];
}

export class RudiInjectedSecretProvider {
  constructor(environment = process.env) {
    this.environment = environment;
  }

  async getSecret(name) {
    if (name !== "DEEPSEEK_API_KEY") {
      throw new Error("Agent Host secret is not allowlisted.");
    }
    const value = this.environment[name];
    if (
      typeof value !== "string"
      || value.length < 8
      || value.length > 4_096
      || /[\r\n\0]/u.test(value)
    ) {
      throw new Error("Agent Host secret is unavailable.");
    }
    return value;
  }
}

export function resolveClaudeBinaryPath(runtimeDirectory = homedir()) {
  const candidates = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    join(homedir(), ".local", "bin", "claude"),
    ...installedClaudeBundleCandidates(),
    ...pathCandidates("claude"),
  ];
  return firstCompatibleExecutable(candidates, {
    helpArguments: ["--help"],
    helpMatches: claudeHelpExposesGuardedCapabilities,
    runtimeDirectory,
    runtimeMatches: isCompatibleClaudeRuntime,
  }) ?? firstExecutable(candidates) ?? "/usr/local/bin/claude";
}

export function resolveCodexBinaryPath(runtimeDirectory = homedir()) {
  const candidates = [
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
    join(homedir(), ".local", "bin", "codex"),
    ...pathCandidates("codex"),
  ];
  return firstCompatibleExecutable(candidates, {
    helpArguments: ["exec", "--help"],
    helpMatches: codexHelpExposesGuardedCapabilities,
    runtimeDirectory,
    runtimeMatches: isCompatibleCodexRuntime,
  }) ?? firstExecutable(candidates) ?? "/usr/local/bin/codex";
}

function defaultStateRoot() {
  const configuredRudiHome = process.env.RUDI_HOME;
  const rudiHome = typeof configuredRudiHome === "string"
    && isAbsolute(configuredRudiHome)
    && configuredRudiHome.length <= 4_096
    && !/[\r\n\0]/u.test(configuredRudiHome)
    ? configuredRudiHome
    : join(homedir(), ".rudi");
  return join(rudiHome, "state", "stacks", "agent-hosts");
}

function createEmptyRuntimeDirectory(stateRoot) {
  const directory = join(stateRoot, "empty");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  if (readdirSync(directory).length !== 0) {
    throw new Error("Agent Host runtime directory is not empty.");
  }
  return directory;
}

function createCodexHome(stateRoot) {
  const directory = join(stateRoot, "codex-home");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  for (const forbidden of ["AGENTS.md", "config.toml", "rules"]) {
    if (existsSync(join(directory, forbidden))) {
      throw new Error("Agent Host Codex home contains mutable customizations.");
    }
  }
  const sourceAuth = join(homedir(), ".codex", "auth.json");
  const runtimeAuth = join(directory, "auth.json");
  if (existsSync(sourceAuth)) {
    if (!pathEntryExists(runtimeAuth)) {
      symlinkSync(sourceAuth, runtimeAuth);
    } else if (realpathSync(runtimeAuth) !== realpathSync(sourceAuth)) {
      throw new Error("Agent Host Codex auth reference is not the expected file.");
    }
  }
  return directory;
}

function pathEntryExists(value) {
  try {
    lstatSync(value);
    return true;
  } catch {
    return false;
  }
}

function installedClaudeBundleCandidates() {
  const root = join(homedir(), "Library", "Application Support", "Claude", "claude-code");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionsDescending)
      .map((version) => join(
        root, version, "claude.app", "Contents", "MacOS", "claude"
      ));
  } catch {
    return [];
  }
}

function compareVersionsDescending(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return right.localeCompare(left);
}

function pathCandidates(binaryName) {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((directory) => isAbsolute(directory))
    .map((directory) => join(directory, binaryName));
}

function firstExecutable(candidates) {
  const visited = new Set();
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through the fixed local candidate list.
    }
  }
  return undefined;
}

function firstCompatibleExecutable(candidates, options) {
  const visited = new Set();
  for (const candidate of candidates) {
    let resolved;
    try {
      accessSync(candidate, constants.X_OK);
      resolved = realpathSync(candidate);
    } catch {
      continue;
    }
    if (visited.has(resolved)) continue;
    visited.add(resolved);
    const runtimeRef = detectRuntimeRef(resolved, options.runtimeDirectory);
    if (!options.runtimeMatches(runtimeRef)) continue;
    if (commandHelpMatches(
      resolved,
      options.helpArguments,
      options.runtimeDirectory,
      options.helpMatches
    )) return resolved;
  }
  return undefined;
}

function commandHelpMatches(binaryPath, arguments_, runtimeDirectory, helpMatches) {
  const captureDirectory = mkdtempSync(join(tmpdir(), "rudi-agent-host-help-"));
  const capturePath = join(captureDirectory, "stdout.txt");
  let outputFile;
  try {
    outputFile = openSync(capturePath, "w", 0o600);
    const result = spawnSync(binaryPath, arguments_, {
      cwd: runtimeDirectory,
      env: { ...createMinimalAgentHostEnvironment() },
      shell: false,
      stdio: ["ignore", outputFile, "ignore"],
      timeout: 5_000,
    });
    closeSync(outputFile);
    outputFile = undefined;
    if (result.status !== 0 || result.error || statSync(capturePath).size > 65_536) {
      return false;
    }
    return helpMatches(readFileSync(capturePath, "utf8"));
  } catch {
    return false;
  } finally {
    if (outputFile !== undefined) closeSync(outputFile);
    rmSync(captureDirectory, { force: true, recursive: true });
  }
}

function detectRuntimeRef(binaryPath, runtimeDirectory) {
  const result = spawnSync(binaryPath, ["--version"], {
    cwd: runtimeDirectory,
    encoding: "utf8",
    env: { ...createMinimalAgentHostEnvironment() },
    maxBuffer: 16_384,
    shell: false,
    timeout: 5_000,
  });
  const observed = result.status === 0 ? result.stdout.trim() : "";
  return observed.length > 0
    && observed.length <= 200
    && !/[\r\n\t\0]/u.test(observed)
    ? observed
    : "runtime-unresolved";
}

function validateAbsolutePath(value, label) {
  if (!isAbsolute(value) || value.length > 4_096 || /[\r\n\0]/u.test(value)) {
    throw new Error(`${label} path is invalid.`);
  }
}
