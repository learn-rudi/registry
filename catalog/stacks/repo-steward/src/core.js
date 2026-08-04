import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const FETCH_GIT_TIMEOUT_MS = 120_000;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_REPOSITORIES = 1000;
const REPOSITORY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const LEASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const ACTION_KINDS = new Set([
  "checkpoint",
  "issue",
  "repair",
  "review",
  "reconcile",
  "draft_pr",
]);
const ACTION_STATUSES = new Set([
  "proposed",
  "approved",
  "running",
  "completed",
  "blocked",
  "cancelled",
]);
const ACTION_TRANSITIONS = {
  proposed: new Set(["approved", "blocked", "cancelled"]),
  approved: new Set(["running", "blocked", "cancelled"]),
  running: new Set(["completed", "blocked", "cancelled"]),
  blocked: new Set(["approved", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertAllowedKeys(value, label, allowedKeys) {
  assertPlainObject(value, label);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} has unsupported field: ${key}.`);
    }
  }
}

function nonEmptyString(value, label, maxLength = 1000) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  const parsed = value.trim();
  if (parsed.length > maxLength) {
    throw new Error(`${label} must be at most ${maxLength} characters.`);
  }
  return parsed;
}

function optionalBoolean(value, label, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function requireRepositoryId(value, label = "repo_id") {
  const parsed = nonEmptyString(value, label, 128);
  if (!REPOSITORY_ID_PATTERN.test(parsed)) {
    throw new Error(
      `${label} must match ${REPOSITORY_ID_PATTERN.source}.`
    );
  }
  return parsed;
}

function boundedInteger(value, label, { defaultValue, min, max }) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function requireLeaseId(value) {
  const parsed = nonEmptyString(value, "lease_id", 36).toLowerCase();
  if (!LEASE_ID_PATTERN.test(parsed)) {
    throw new Error("lease_id must be a UUID v4.");
  }
  return parsed;
}

function requireOwner(value) {
  return nonEmptyString(value, "owner", 128);
}

function boundedSafeText(value, label, maxLength) {
  return redactText(nonEmptyString(value, label, maxLength)).slice(0, maxLength);
}

function requireActionId(value) {
  const parsed = nonEmptyString(value, "action_id", 128);
  if (!ACTION_ID_PATTERN.test(parsed)) {
    throw new Error(`action_id must match ${ACTION_ID_PATTERN.source}.`);
  }
  return parsed;
}

function requireEnum(value, label, accepted) {
  const parsed = nonEmptyString(value, label, 64);
  if (!accepted.has(parsed)) {
    throw new Error(`${label} must be one of: ${[...accepted].join(", ")}.`);
  }
  return parsed;
}

function requireExpectedVersion(value) {
  return boundedInteger(value, "expected_version", {
    defaultValue: null,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
}

function redactText(value) {
  return String(value ?? "")
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted-github-token]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted-github-token]")
    .replace(/xox[baprs]-[A-Za-z0-9-]{20,}/g, "[redacted-slack-token]")
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{24,}/g, "[redacted-api-token]")
    .slice(0, 4000);
}

function gitFailureMessage(error, operation) {
  const stderr = redactText(error?.stderr || error?.message || "Git failed");
  const timedOut = error?.killed || error?.signal === "SIGTERM";
  if (timedOut) return `${operation} timed out.`;
  return `${operation} failed${stderr ? `: ${stderr}` : "."}`;
}

async function runGit(repositoryPath, args, options = {}) {
  const timeout = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  try {
    const result = await execFileAsync("git", ["-C", repositoryPath, ...args], {
      encoding: "utf8",
      timeout,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      env: process.env,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    throw new Error(gitFailureMessage(error, options.operation || "Git command"));
  }
}

async function tryGit(repositoryPath, args) {
  try {
    return (await runGit(repositoryPath, args)).stdout.trim();
  } catch {
    return null;
  }
}

function configuredPath(options = {}) {
  const value = options.configPath ?? process.env.REPO_STEWARD_CONFIG_PATH;
  if (!value) {
    throw new Error("REPO_STEWARD_CONFIG_PATH is required.");
  }
  const parsed = nonEmptyString(value, "config path", 4096);
  if (!path.isAbsolute(parsed)) {
    throw new Error("REPO_STEWARD_CONFIG_PATH must be absolute.");
  }
  return path.resolve(parsed);
}

export function defaultStateRoot(options = {}) {
  if (options.stateRoot) return path.resolve(options.stateRoot);
  const rudiHome = process.env.RUDI_HOME
    ? path.resolve(process.env.RUDI_HOME)
    : path.join(homedir(), ".rudi");
  return path.join(rudiHome, "state", "repo-steward");
}

export async function loadStewardConfig(options = {}) {
  const configPath = configuredPath(options);
  let document;
  try {
    document = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof SyntaxError
      ? "configuration is not valid JSON"
      : redactText(error?.message);
    throw new Error(`Unable to load Repo Steward configuration: ${message}`);
  }

  assertAllowedKeys(document, "configuration", ["schemaVersion", "repositories"]);
  if (document.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`configuration.schemaVersion must equal ${CONFIG_SCHEMA_VERSION}.`);
  }
  if (
    !Array.isArray(document.repositories) ||
    document.repositories.length > MAX_REPOSITORIES
  ) {
    throw new Error(
      `configuration.repositories must be an array with at most ${MAX_REPOSITORIES} entries.`
    );
  }

  const seen = new Set();
  const seenPaths = new Set();
  const repositories = [];
  for (const [index, value] of document.repositories.entries()) {
    assertAllowedKeys(
      value,
      `configuration.repositories[${index}]`,
      ["id", "path", "fetchAllowed"]
    );
    const id = requireRepositoryId(value.id, `configuration.repositories[${index}].id`);
    if (seen.has(id)) throw new Error(`Duplicate repository id: ${id}.`);
    seen.add(id);
    const configuredRepositoryPath = nonEmptyString(
      value.path,
      `configuration.repositories[${index}].path`,
      4096
    );
    if (!path.isAbsolute(configuredRepositoryPath)) {
      throw new Error(`Repository path must be absolute for ${id}.`);
    }
    let repositoryPath;
    try {
      repositoryPath = await fs.realpath(configuredRepositoryPath);
    } catch {
      throw new Error(`Configured repository does not exist: ${id}.`);
    }
    if (seenPaths.has(repositoryPath)) {
      throw new Error(`Duplicate repository path: ${repositoryPath}.`);
    }
    seenPaths.add(repositoryPath);
    repositories.push({
      id,
      path: repositoryPath,
      fetchAllowed: optionalBoolean(value.fetchAllowed, `${id}.fetchAllowed`),
    });
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    configPath,
    stateRoot: defaultStateRoot(options),
    repositories,
  };
}

export async function preflightRepoSteward(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", []);
  const config = await loadStewardConfig(options);
  await ensureStateDirectory(config.stateRoot);
  let gitVersion;
  try {
    const result = await execFileAsync("git", ["--version"], {
      encoding: "utf8",
      timeout: DEFAULT_GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      env: process.env,
    });
    gitVersion = redactText(result.stdout).trim();
  } catch (error) {
    throw new Error(gitFailureMessage(error, "Git preflight"));
  }
  for (const repository of config.repositories) {
    await resolveConfiguredRepository(repository.id, options);
  }
  return {
    configuration_valid: true,
    config_path: config.configPath,
    state_root: config.stateRoot,
    repository_count: config.repositories.length,
    fetch_enabled_count: config.repositories.filter((repository) => repository.fetchAllowed).length,
    git_version: gitVersion,
    repository_mutation_tools_exposed: false,
    local_state_tools_exposed: true,
    repositories: config.repositories.map((repository) => ({
      repo_id: repository.id,
      path: repository.path,
      fetch_allowed: repository.fetchAllowed,
    })),
  };
}

async function resolveConfiguredRepository(repoId, options = {}) {
  const id = requireRepositoryId(repoId);
  const config = await loadStewardConfig(options);
  const repository = config.repositories.find((candidate) => candidate.id === id);
  if (!repository) throw new Error(`Repository is not configured: ${id}.`);

  const gitRootOutput = (
    await runGit(repository.path, ["rev-parse", "--show-toplevel"], {
      operation: `Resolve Git root for ${id}`,
    })
  ).stdout.trim();
  const gitRoot = await fs.realpath(gitRootOutput);
  if (gitRoot !== repository.path) {
    throw new Error(`Configured path is not the exact Git worktree root for ${id}.`);
  }

  return { config, repository };
}

async function ensureStateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

function leasePaths(stateRoot, repoId) {
  const leasesRoot = path.join(stateRoot, "leases");
  return {
    leasesRoot,
    active: path.join(leasesRoot, `${repoId}.json`),
    history: path.join(leasesRoot, "history"),
  };
}

function actionPaths(stateRoot, repoId, actionId) {
  const actionsRoot = path.join(stateRoot, "actions", repoId);
  return {
    actionsRoot,
    active: path.join(actionsRoot, `${actionId}.json`),
    lock: path.join(actionsRoot, `.${actionId}.lock`),
    lockHistory: path.join(actionsRoot, "lock-history"),
  };
}

async function readLease(file) {
  let lease;
  try {
    lease = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read repository lease: ${redactText(error?.message)}`);
  }
  assertPlainObject(lease, "repository lease");
  const repoId = requireRepositoryId(lease.repo_id, "repository lease repo_id");
  const leaseId = requireLeaseId(lease.lease_id);
  const owner = requireOwner(lease.owner);
  if (typeof lease.expires_at !== "string" || !Number.isFinite(Date.parse(lease.expires_at))) {
    throw new Error("repository lease expires_at must be an ISO timestamp.");
  }
  return { ...lease, repo_id: repoId, lease_id: leaseId, owner };
}

async function archiveLease(paths, reason, options = {}) {
  await ensureStateDirectory(paths.history);
  const timestamp = options.nowMs ?? Date.now();
  const target = path.join(
    paths.history,
    `${path.basename(paths.active, ".json")}-${timestamp}-${reason}-${randomUUID()}.json`
  );
  try {
    await fs.rename(paths.active, target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertActiveLease(config, repository, owner, leaseId, options = {}) {
  const paths = leasePaths(config.stateRoot, repository.id);
  const lease = await readLease(paths.active);
  if (!lease) throw new Error(`Repository is not currently leased: ${repository.id}.`);
  if (lease.owner !== owner || lease.lease_id !== leaseId) {
    throw new Error(`Active lease does not match owner and lease_id for ${repository.id}.`);
  }
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  if (Date.parse(lease.expires_at) <= nowMs) {
    throw new Error(`Repository lease has expired: ${repository.id}.`);
  }
  return lease;
}

async function readActionLock(file) {
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read action lock: ${redactText(error?.message)}`);
  }
  assertAllowedKeys(lock, "action lock", ["lease_id", "owner", "expires_at"]);
  const leaseId = requireLeaseId(lock.lease_id);
  const owner = requireOwner(lock.owner);
  if (typeof lock.expires_at !== "string" || !Number.isFinite(Date.parse(lock.expires_at))) {
    throw new Error("action lock expires_at must be an ISO timestamp.");
  }
  return { lease_id: leaseId, owner, expires_at: lock.expires_at };
}

async function archiveActionLock(paths, nowMs) {
  await ensureStateDirectory(paths.lockHistory);
  const target = path.join(
    paths.lockHistory,
    `${path.basename(paths.active, ".json")}-${nowMs}-stale-${randomUUID()}.json`
  );
  try {
    await fs.rename(paths.lock, target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function withActionLock(paths, lease, operation, options = {}) {
  await ensureStateDirectory(paths.actionsRoot);
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  let acquired = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(paths.lock, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        lease_id: lease.lease_id,
        owner: lease.owner,
        expires_at: lease.expires_at,
      }, null, 2)}\n`, "utf8");
      await handle.close();
      acquired = true;
      break;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (handle && error?.code !== "EEXIST") {
        await fs.unlink(paths.lock).catch(() => {});
      }
      if (error?.code !== "EEXIST") throw error;
      const existing = await readActionLock(paths.lock);
      if (!existing) continue;
      if (Date.parse(existing.expires_at) > nowMs) {
        throw new Error(
          `Action update is already in progress: ${path.basename(paths.active, ".json")}.`
        );
      }
      await archiveActionLock(paths, nowMs);
    }
  }

  if (!acquired) {
    throw new Error(
      `Unable to acquire action lock after concurrent updates: ${path.basename(paths.active, ".json")}.`
    );
  }

  try {
    return await operation();
  } finally {
    await fs.unlink(paths.lock).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function readAction(file) {
  let action;
  try {
    action = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read repository action: ${redactText(error?.message)}`);
  }
  assertPlainObject(action, "repository action");
  requireRepositoryId(action.repo_id, "repository action repo_id");
  requireActionId(action.action_id);
  requireEnum(action.kind, "repository action kind", ACTION_KINDS);
  requireEnum(action.status, "repository action status", ACTION_STATUSES);
  if (!Number.isSafeInteger(action.version) || action.version < 1) {
    throw new Error("repository action version must be a positive integer.");
  }
  if (!Array.isArray(action.history) || !Array.isArray(action.verifications)) {
    throw new Error("repository action history and verifications must be arrays.");
  }
  return action;
}

async function atomicWriteJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.close();
    await fs.rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

function parseDirtyStatus(output) {
  const entries = output.split("\0");
  const result = {
    total: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    if (x === "?" && y === "?") {
      result.total += 1;
      result.untracked += 1;
      continue;
    }
    result.total += 1;
    const conflicted = x === "U" || y === "U" || ["AA", "DD"].includes(`${x}${y}`);
    if (conflicted) result.conflicted += 1;
    if (x !== " " && x !== "?") result.staged += 1;
    if (y !== " " && y !== "?") result.unstaged += 1;
    if ([x, y].some((code) => code === "R" || code === "C")) index += 1;
  }

  return result;
}

export function safeRemoteIdentity(value) {
  if (!value) return null;
  const remote = value.trim();
  try {
    const parsed = new URL(remote);
    if (["http:", "https:", "ssh:"].includes(parsed.protocol)) {
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
    }
    if (parsed.protocol === "file:") return "local-file-remote";
  } catch {
    const scp = /^(?:[^@\s]+@)?([^:\s]+):(.+)$/.exec(remote);
    if (scp) return `${scp[1]}:${scp[2]}`;
    if (path.isAbsolute(remote)) return "local-path-remote";
  }
  return "unrecognized-remote";
}

async function remoteSummary(repositoryPath) {
  const remoteNames = (await tryGit(repositoryPath, ["remote"]))
    ?.split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  if (remoteNames.length === 0) {
    return { configured: false, identity: null };
  }
  const remoteName = remoteNames.includes("origin") ? "origin" : remoteNames[0];
  const remoteUrl = await tryGit(repositoryPath, ["remote", "get-url", remoteName]);
  return {
    configured: true,
    identity: safeRemoteIdentity(remoteUrl),
  };
}

async function maybeFetch(args, repository) {
  const requested = optionalBoolean(args.fetch, "fetch", false);
  if (!requested) return { requested: false, performed: false };
  if (!repository.fetchAllowed) {
    throw new Error(`Fetch is not allowed for repository: ${repository.id}.`);
  }
  await runGit(repository.path, ["fetch", "--prune", "--no-tags"], {
    timeoutMs: FETCH_GIT_TIMEOUT_MS,
    operation: `Fetch ${repository.id}`,
  });
  return { requested: true, performed: true };
}

export async function getRepositoryStatus(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_id", "fetch"]);
  const startedAt = Date.now();
  const { repository } = await resolveConfiguredRepository(args.repo_id, options);
  const fetch = await maybeFetch(args, repository);
  const branch = await tryGit(repository.path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const head = (
    await runGit(repository.path, ["rev-parse", "HEAD"], {
      operation: `Read HEAD for ${repository.id}`,
    })
  ).stdout.trim();
  const upstream = await tryGit(repository.path, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  let ahead = null;
  let behind = null;
  if (upstream) {
    const counts = (
      await runGit(repository.path, [
        "rev-list",
        "--left-right",
        "--count",
        "HEAD...@{upstream}",
      ], { operation: `Compare upstream for ${repository.id}` })
    ).stdout.trim().split(/\s+/).map(Number);
    [ahead, behind] = counts;
  }
  const status = (
    await runGit(repository.path, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ], { operation: `Read status for ${repository.id}` })
  ).stdout;

  return {
    repo_id: repository.id,
    path: repository.path,
    branch: branch || null,
    head,
    upstream: upstream || null,
    ahead,
    behind,
    dirty: parseDirtyStatus(status),
    remote: await remoteSummary(repository.path),
    fetch,
    duration_ms: Date.now() - startedAt,
  };
}

export async function scanFleet(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_ids", "fetch"]);
  const config = await loadStewardConfig(options);
  const requestedFetch = optionalBoolean(args.fetch, "fetch", false);
  let repositoryIds = config.repositories.map((repository) => repository.id);

  if (args.repo_ids !== undefined) {
    if (
      !Array.isArray(args.repo_ids) ||
      args.repo_ids.length > MAX_REPOSITORIES ||
      !args.repo_ids.every((value) => typeof value === "string")
    ) {
      throw new Error(
        `repo_ids must be an array of at most ${MAX_REPOSITORIES} repository IDs.`
      );
    }
    repositoryIds = [...new Set(args.repo_ids.map((value) => requireRepositoryId(value)))];
    for (const id of repositoryIds) {
      if (!config.repositories.some((repository) => repository.id === id)) {
        throw new Error(`Repository is not configured: ${id}.`);
      }
    }
  }

  const repositories = [];
  for (const repoId of repositoryIds) {
    try {
      repositories.push(await getRepositoryStatus(
        { repo_id: repoId, fetch: requestedFetch },
        options
      ));
    } catch (error) {
      repositories.push({
        repo_id: repoId,
        error: redactText(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  const scanned = repositories.filter((repository) => !("error" in repository));
  return {
    generated_at: new Date().toISOString(),
    summary: {
      total: repositories.length,
      scanned: scanned.length,
      failed: repositories.length - scanned.length,
      dirty: scanned.filter((repository) => repository.dirty.total > 0).length,
      needs_push: scanned.filter((repository) => (repository.ahead ?? 0) > 0).length,
      needs_pull: scanned.filter((repository) => (repository.behind ?? 0) > 0).length,
      diverged: scanned.filter(
        (repository) => (repository.ahead ?? 0) > 0 && (repository.behind ?? 0) > 0
      ).length,
    },
    repositories,
  };
}

export async function acquireRepositoryLease(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_id", "owner", "ttl_seconds"]);
  const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
  const owner = requireOwner(args.owner);
  const ttlSeconds = boundedInteger(args.ttl_seconds, "ttl_seconds", {
    defaultValue: 300,
    min: 30,
    max: 3600,
  });
  const paths = leasePaths(config.stateRoot, repository.id);
  await ensureStateDirectory(paths.leasesRoot);
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lease = {
      schema_version: 1,
      repo_id: repository.id,
      lease_id: randomUUID(),
      owner,
      acquired_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + ttlSeconds * 1000).toISOString(),
    };
    let handle;
    try {
      handle = await fs.open(paths.active, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, "utf8");
      await handle.close();
      return lease;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code !== "EEXIST") throw error;
      const existing = await readLease(paths.active);
      if (!existing) continue;
      if (Date.parse(existing.expires_at) > nowMs) {
        throw new Error(
          `Repository ${repository.id} is already leased by ${existing.owner} until ${existing.expires_at}.`
        );
      }
      await archiveLease(paths, "expired", { nowMs });
    }
  }

  throw new Error(`Unable to acquire repository lease after concurrent updates: ${repository.id}.`);
}

export async function releaseRepositoryLease(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_id", "owner", "lease_id"]);
  const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
  const owner = requireOwner(args.owner);
  const leaseId = requireLeaseId(args.lease_id);
  const paths = leasePaths(config.stateRoot, repository.id);
  const existing = await readLease(paths.active);
  if (!existing) throw new Error(`Repository is not currently leased: ${repository.id}.`);
  if (existing.lease_id !== leaseId || existing.owner !== owner) {
    throw new Error(`Active lease does not match owner and lease_id for ${repository.id}.`);
  }
  const moved = await archiveLease(paths, "released", {
    nowMs: typeof options.now === "function" ? options.now() : Date.now(),
  });
  if (!moved) throw new Error(`Repository lease changed before release: ${repository.id}.`);
  return {
    repo_id: repository.id,
    lease_id: leaseId,
    released: true,
  };
}

export async function recordRepositoryAction(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", [
    "repo_id",
    "owner",
    "lease_id",
    "action_id",
    "kind",
    "status",
    "summary",
    "source_head",
    "expected_version",
  ]);
  const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
  const owner = requireOwner(args.owner);
  const leaseId = requireLeaseId(args.lease_id);
  const actionId = requireActionId(args.action_id);
  const status = requireEnum(args.status, "status", ACTION_STATUSES);
  const expectedVersion = requireExpectedVersion(args.expected_version);
  if (expectedVersion === null) throw new Error("expected_version is required.");
  const lease = await assertActiveLease(config, repository, owner, leaseId, options);
  const paths = actionPaths(config.stateRoot, repository.id, actionId);

  return withActionLock(paths, lease, async () => {
    const existing = await readAction(paths.active);
    const now = new Date(
      typeof options.now === "function" ? options.now() : Date.now()
    ).toISOString();

    if (!existing) {
      if (expectedVersion !== 0) {
        throw new Error(`New action expected_version must be 0: ${actionId}.`);
      }
      if (status !== "proposed") {
        throw new Error("New actions must begin in proposed status.");
      }
      const kind = requireEnum(args.kind, "kind", ACTION_KINDS);
      const summary = boundedSafeText(args.summary, "summary", 2000);
      const sourceHead = nonEmptyString(args.source_head, "source_head", 40).toLowerCase();
      if (!/^[0-9a-f]{40}$/.test(sourceHead)) {
        throw new Error("source_head must be a 40-character Git object ID.");
      }
      const action = {
        schema_version: 1,
        repo_id: repository.id,
        action_id: actionId,
        kind,
        summary,
        source_head: sourceHead,
        status,
        version: 1,
        created_at: now,
        updated_at: now,
        history: [{
          version: 1,
          event: "created",
          actor: owner,
          from: null,
          to: status,
          at: now,
        }],
        verifications: [],
      };
      await atomicWriteJson(paths.active, action);
      return action;
    }

    if (expectedVersion === 0) {
      const kind = requireEnum(args.kind, "kind", ACTION_KINDS);
      const summary = boundedSafeText(args.summary, "summary", 2000);
      const sourceHead = nonEmptyString(args.source_head, "source_head", 40).toLowerCase();
      const sameCreation =
        existing.version === 1 &&
        existing.status === "proposed" &&
        existing.kind === kind &&
        existing.summary === summary &&
        existing.source_head === sourceHead;
      if (sameCreation) return { ...existing, idempotent: true };
      throw new Error(`Action ID already exists with different creation input: ${actionId}.`);
    }

    if (existing.version !== expectedVersion) {
      throw new Error(
        `Action version conflict for ${actionId}: expected ${expectedVersion}, current ${existing.version}.`
      );
    }
    if (ACTION_TRANSITIONS[existing.status].size === 0) {
      throw new Error(`Action is terminal and cannot transition: ${actionId}.`);
    }
    if (!ACTION_TRANSITIONS[existing.status].has(status)) {
      throw new Error(`Illegal action transition: ${existing.status} -> ${status}.`);
    }
    if (
      status === "completed" &&
      !existing.verifications.some((verification) => verification.outcome === "passed")
    ) {
      throw new Error(`Action requires at least one passing verification: ${actionId}.`);
    }

    const version = existing.version + 1;
    const action = {
      ...existing,
      status,
      version,
      updated_at: now,
      history: [...existing.history, {
        version,
        event: "transition",
        actor: owner,
        from: existing.status,
        to: status,
        at: now,
      }],
    };
    await atomicWriteJson(paths.active, action);
    return action;
  }, options);
}

export async function recordRepositoryVerification(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", [
    "repo_id",
    "owner",
    "lease_id",
    "action_id",
    "expected_version",
    "command",
    "outcome",
    "exit_code",
    "summary",
  ]);
  const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
  const owner = requireOwner(args.owner);
  const leaseId = requireLeaseId(args.lease_id);
  const actionId = requireActionId(args.action_id);
  const expectedVersion = requireExpectedVersion(args.expected_version);
  if (expectedVersion === null) throw new Error("expected_version is required.");
  const outcome = requireEnum(
    args.outcome,
    "outcome",
    new Set(["passed", "failed", "skipped"])
  );
  const command = boundedSafeText(args.command, "command", 500);
  const summary = boundedSafeText(args.summary, "summary", 2000);
  let exitCode = args.exit_code ?? null;
  if (exitCode !== null && (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255)) {
    throw new Error("exit_code must be null or an integer from 0 to 255.");
  }
  if (outcome === "passed" && exitCode !== 0) {
    throw new Error("passed verification requires exit_code 0.");
  }
  if (outcome === "failed" && (exitCode === null || exitCode === 0)) {
    throw new Error("failed verification requires a non-zero exit_code.");
  }
  if (outcome === "skipped" && exitCode !== null) {
    throw new Error("skipped verification requires a null exit_code.");
  }
  const lease = await assertActiveLease(config, repository, owner, leaseId, options);
  const paths = actionPaths(config.stateRoot, repository.id, actionId);

  return withActionLock(paths, lease, async () => {
    const existing = await readAction(paths.active);
    if (!existing) throw new Error(`Repository action does not exist: ${actionId}.`);
    if (existing.version !== expectedVersion) {
      throw new Error(
        `Action version conflict for ${actionId}: expected ${expectedVersion}, current ${existing.version}.`
      );
    }
    if (existing.status !== "running") {
      throw new Error(`Verification requires a running action: ${actionId}.`);
    }
    const now = new Date(
      typeof options.now === "function" ? options.now() : Date.now()
    ).toISOString();
    const version = existing.version + 1;
    const verification = {
      verification_id: randomUUID(),
      command,
      outcome,
      exit_code: exitCode,
      summary,
      actor: owner,
      at: now,
    };
    const action = {
      ...existing,
      version,
      updated_at: now,
      history: [...existing.history, {
        version,
        event: "verification_recorded",
        actor: owner,
        verification_id: verification.verification_id,
        outcome,
        at: now,
      }],
      verifications: [...existing.verifications, verification],
    };
    await atomicWriteJson(paths.active, action);
    return action;
  }, options);
}

export async function listRepositoryActions(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_id", "status", "kind", "limit"]);
  const { config, repository } = await resolveConfiguredRepository(args.repo_id, options);
  const limit = boundedInteger(args.limit, "limit", {
    defaultValue: 50,
    min: 1,
    max: 500,
  });
  const status = args.status === undefined
    ? null
    : requireEnum(args.status, "status", ACTION_STATUSES);
  const kind = args.kind === undefined
    ? null
    : requireEnum(args.kind, "kind", ACTION_KINDS);
  const paths = actionPaths(config.stateRoot, repository.id, "placeholder");
  let entries;
  try {
    entries = await fs.readdir(paths.actionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { repo_id: repository.id, actions: [] };
    }
    throw error;
  }
  const actions = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".json")) continue;
    const action = await readAction(path.join(paths.actionsRoot, entry.name));
    if (!action) continue;
    if (status && action.status !== status) continue;
    if (kind && action.kind !== kind) continue;
    actions.push(action);
  }
  actions.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  return {
    repo_id: repository.id,
    actions: actions.slice(0, limit),
  };
}

export const internal = {
  randomUUID,
  redactText,
  requireRepositoryId,
};
