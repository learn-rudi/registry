import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCloseoutOperations } from "./closeout.js";

const execFileAsync = promisify(execFile);

const CONFIG_SCHEMA_VERSION = 1;
const DEFAULT_GIT_TIMEOUT_MS = 30_000;
const FETCH_GIT_TIMEOUT_MS = 120_000;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const MAX_REPOSITORIES = 1000;
const MAX_DISCOVERY_DIRECTORIES = 100_000;
const DEFAULT_DISCOVERY_DEPTH = 12;
const MAX_DISCOVERY_DEPTH = 32;
const ENROLLMENT_LOCK_TTL_MS = 30_000;
const MAX_ENROLLMENT_HISTORY = 500;
const DISCOVERY_EXCLUDED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".rudi",
  ".tox",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]);
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
  if (value === undefined) return defaultValue;
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
  if (!value) return null;
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

function enrollmentPaths(stateRoot) {
  return {
    active: path.join(stateRoot, "enrollment.json"),
    lock: path.join(stateRoot, ".enrollment.lock"),
    history: path.join(stateRoot, "enrollment-history"),
  };
}

function emptyEnrollmentDocument() {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    version: 0,
    roots: [],
    history: [],
  };
}

async function readJsonFile(file, label, { optional = false } = {}) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    const message = error instanceof SyntaxError
      ? `${label} is not valid JSON`
      : redactText(error?.message);
    throw new Error(`Unable to load ${label}: ${message}`);
  }
}

async function requireDirectoryRealpath(value, label) {
  const configuredRootPath = nonEmptyString(value, label, 4096);
  if (!path.isAbsolute(configuredRootPath)) {
    throw new Error(`${label} must be absolute.`);
  }
  let rootPath;
  let stats;
  try {
    rootPath = await fs.realpath(configuredRootPath);
    stats = await fs.stat(rootPath);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  if (!stats.isDirectory()) throw new Error(`${label} must be a directory.`);
  return rootPath;
}

async function parseExplicitRepositories(values, label = "configuration.repositories") {
  if (!Array.isArray(values) || values.length > MAX_REPOSITORIES) {
    throw new Error(`${label} must be an array with at most ${MAX_REPOSITORIES} entries.`);
  }
  const repositories = [];
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const [index, value] of values.entries()) {
    const itemLabel = `${label}[${index}]`;
    assertAllowedKeys(value, itemLabel, ["id", "path", "fetchAllowed"]);
    const id = requireRepositoryId(value.id, `${itemLabel}.id`);
    const repositoryPath = await requireDirectoryRealpath(value.path, `${itemLabel}.path`);
    if (seenIds.has(id)) throw new Error(`Duplicate repository id: ${id}.`);
    if (seenPaths.has(repositoryPath)) {
      throw new Error(`Duplicate repository path: ${repositoryPath}.`);
    }
    seenIds.add(id);
    seenPaths.add(repositoryPath);
    repositories.push({
      id,
      path: repositoryPath,
      fetchAllowed: optionalBoolean(value.fetchAllowed, `${itemLabel}.fetchAllowed`),
      source: "explicit",
      rootId: null,
      relativePath: null,
    });
  }
  return repositories;
}

async function parseExternalRoots(values, label = "configuration.roots") {
  if (!Array.isArray(values) || values.length > MAX_REPOSITORIES) {
    throw new Error(`${label} must be an array with at most ${MAX_REPOSITORIES} entries.`);
  }
  const roots = [];
  for (const [index, value] of values.entries()) {
    const itemLabel = `${label}[${index}]`;
    assertAllowedKeys(value, itemLabel, ["id", "path", "fetchAllowed", "maxDepth"]);
    roots.push({
      id: requireRepositoryId(value.id, `${itemLabel}.id`),
      path: await requireDirectoryRealpath(value.path, `${itemLabel}.path`),
      fetchAllowed: optionalBoolean(value.fetchAllowed, `${itemLabel}.fetchAllowed`),
      maxDepth: boundedInteger(value.maxDepth, `${itemLabel}.maxDepth`, {
        defaultValue: DEFAULT_DISCOVERY_DEPTH,
        min: 0,
        max: MAX_DISCOVERY_DEPTH,
      }),
      source: "external",
    });
  }
  return roots;
}

async function readEnrollmentDocument(stateRoot) {
  const document = await readJsonFile(
    enrollmentPaths(stateRoot).active,
    "Repo Steward enrollment",
    { optional: true }
  );
  if (!document) return emptyEnrollmentDocument();
  assertAllowedKeys(document, "enrollment", ["schema_version", "version", "roots", "history"]);
  if (document.schema_version !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`enrollment.schema_version must equal ${CONFIG_SCHEMA_VERSION}.`);
  }
  if (!Number.isSafeInteger(document.version) || document.version < 1) {
    throw new Error("enrollment.version must be a positive integer.");
  }
  if (!Array.isArray(document.roots) || document.roots.length > MAX_REPOSITORIES) {
    throw new Error(`enrollment.roots must contain at most ${MAX_REPOSITORIES} entries.`);
  }
  if (!Array.isArray(document.history) || document.history.length > MAX_ENROLLMENT_HISTORY) {
    throw new Error(`enrollment.history must contain at most ${MAX_ENROLLMENT_HISTORY} entries.`);
  }
  for (const [index, root] of document.roots.entries()) {
    assertAllowedKeys(root, `enrollment.roots[${index}]`, [
      "root_id",
      "path",
      "fetch_allowed",
      "max_depth",
    ]);
    requireRepositoryId(root.root_id, `enrollment.roots[${index}].root_id`);
    if (!path.isAbsolute(nonEmptyString(root.path, `enrollment.roots[${index}].path`, 4096))) {
      throw new Error(`enrollment.roots[${index}].path must be absolute.`);
    }
    optionalBoolean(root.fetch_allowed, `enrollment.roots[${index}].fetch_allowed`);
    boundedInteger(root.max_depth, `enrollment.roots[${index}].max_depth`, {
      defaultValue: DEFAULT_DISCOVERY_DEPTH,
      min: 0,
      max: MAX_DISCOVERY_DEPTH,
    });
  }
  return document;
}

async function parseEnrollmentRoots(document) {
  const roots = [];
  for (const [index, value] of document.roots.entries()) {
    roots.push({
      id: requireRepositoryId(value.root_id, `enrollment.roots[${index}].root_id`),
      path: await requireDirectoryRealpath(value.path, `enrollment.roots[${index}].path`),
      fetchAllowed: optionalBoolean(
        value.fetch_allowed,
        `enrollment.roots[${index}].fetch_allowed`
      ),
      maxDepth: boundedInteger(value.max_depth, `enrollment.roots[${index}].max_depth`, {
        defaultValue: DEFAULT_DISCOVERY_DEPTH,
        min: 0,
        max: MAX_DISCOVERY_DEPTH,
      }),
      source: "enrollment",
    });
  }
  return roots;
}

function pathsOverlap(left, right) {
  const leftFromRight = path.relative(right, left);
  const rightFromLeft = path.relative(left, right);
  const inside = (relative) => relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
  return inside(leftFromRight) || inside(rightFromLeft);
}

function assertUniqueRoots(roots) {
  const ids = new Set();
  for (const [index, root] of roots.entries()) {
    if (ids.has(root.id)) throw new Error(`Duplicate root id: ${root.id}.`);
    ids.add(root.id);
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      if (pathsOverlap(root.path, roots[otherIndex].path)) {
        throw new Error(
          `Configured root ${root.id} overlaps configured root ${roots[otherIndex].id}.`
        );
      }
    }
  }
}

async function loadConfigurationSources(options = {}) {
  const stateRoot = defaultStateRoot(options);
  const configPath = configuredPath(options);
  let externalRepositories = [];
  let externalRoots = [];
  if (configPath) {
    const document = await readJsonFile(configPath, "Repo Steward configuration");
    assertAllowedKeys(document, "configuration", ["schemaVersion", "repositories", "roots"]);
    if (document.schemaVersion !== CONFIG_SCHEMA_VERSION) {
      throw new Error(`configuration.schemaVersion must equal ${CONFIG_SCHEMA_VERSION}.`);
    }
    externalRepositories = await parseExplicitRepositories(document.repositories ?? []);
    externalRoots = await parseExternalRoots(document.roots ?? []);
  }
  const enrollment = await readEnrollmentDocument(stateRoot);
  const roots = [...externalRoots, ...await parseEnrollmentRoots(enrollment)];
  assertUniqueRoots(roots);
  return {
    configPath,
    stateRoot,
    enrollment,
    roots,
    explicitRepositories: externalRepositories,
  };
}

function repositoryIdForRelativePath(rootId, relativePath) {
  const slug = relativePath === "."
    ? "root"
    : relativePath
      .split(path.sep)
      .map((segment) => segment
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "repo")
      .join("--");
  const candidate = `${rootId}--${slug}`;
  if (candidate.length <= 128) return candidate;
  const hash = createHash("sha256").update(relativePath).digest("hex").slice(0, 8);
  return `${candidate.slice(0, 118)}--${hash}`;
}

async function discoverOneRoot(root) {
  const queue = [{ directory: root.path, depth: 0 }];
  let queueIndex = 0;
  const repositories = [];
  const failures = [];
  let directoriesVisited = 0;
  let candidates = 0;
  let excludedDirectories = 0;
  let symlinksSkipped = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DISCOVERY_DIRECTORIES) {
      throw new Error(
        `Root ${root.id} exceeded ${MAX_DISCOVERY_DIRECTORIES} visited directories.`
      );
    }

    let entries;
    try {
      entries = await fs.readdir(current.directory, { withFileTypes: true });
    } catch (error) {
      failures.push({
        root_id: root.id,
        path: current.directory,
        error: redactText(error?.message || "Unable to read directory"),
      });
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    const gitMarker = entries.find((entry) =>
      entry.name === ".git" &&
      !entry.isSymbolicLink() &&
      (entry.isDirectory() || entry.isFile())
    );
    if (gitMarker) {
      candidates += 1;
      try {
        const gitRootOutput = (
          await runGit(current.directory, ["rev-parse", "--show-toplevel"], {
            operation: `Resolve discovered Git root under ${root.id}`,
          })
        ).stdout.trim();
        const gitRoot = await fs.realpath(gitRootOutput);
        if (gitRoot !== current.directory) {
          throw new Error("Git toplevel does not match the discovered directory.");
        }
        const relativePath = path.relative(root.path, current.directory) || ".";
        repositories.push({
          id: repositoryIdForRelativePath(root.id, relativePath),
          path: current.directory,
          fetchAllowed: root.fetchAllowed,
          source: "root",
          rootId: root.id,
          relativePath,
        });
      } catch (error) {
        failures.push({
          root_id: root.id,
          path: current.directory,
          error: redactText(error instanceof Error ? error.message : String(error)),
        });
      }
      if (repositories.length > MAX_REPOSITORIES) {
        throw new Error(`Root ${root.id} exceeds ${MAX_REPOSITORIES} repositories.`);
      }
    }

    if (current.depth >= root.maxDepth) continue;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        symlinksSkipped += 1;
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (DISCOVERY_EXCLUDED_DIRECTORIES.has(entry.name)) {
        excludedDirectories += 1;
        continue;
      }
      queue.push({
        directory: path.join(current.directory, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  repositories.sort((left, right) => left.id.localeCompare(right.id));
  return {
    root,
    repositories,
    failures,
    directoriesVisited,
    candidates,
    excludedDirectories,
    symlinksSkipped,
  };
}

async function discoverRootSet(roots) {
  const results = [];
  for (const root of roots) results.push(await discoverOneRoot(root));
  const repositories = results.flatMap((result) => result.repositories);
  if (repositories.length > MAX_REPOSITORIES) {
    throw new Error(`Discovered repository fleet exceeds ${MAX_REPOSITORIES} repositories.`);
  }
  return {
    roots,
    results,
    repositories,
    failures: results.flatMap((result) => result.failures),
    summary: {
      roots: roots.length,
      directories_visited: results.reduce((sum, result) => sum + result.directoriesVisited, 0),
      candidates: results.reduce((sum, result) => sum + result.candidates, 0),
      repositories: results.reduce((sum, result) => sum + result.repositories.length, 0),
      failed: results.reduce((sum, result) => sum + result.failures.length, 0),
      excluded_directories: results.reduce(
        (sum, result) => sum + result.excludedDirectories,
        0
      ),
      symlinks_skipped: results.reduce((sum, result) => sum + result.symlinksSkipped, 0),
    },
  };
}

function publicRoot(root) {
  return {
    root_id: root.id,
    path: root.path,
    fetch_allowed: root.fetchAllowed,
    max_depth: root.maxDepth,
  };
}

function publicRepository(repository) {
  return {
    repo_id: repository.id,
    path: repository.path,
    fetch_allowed: repository.fetchAllowed,
    source: repository.source,
    root_id: repository.rootId,
    relative_path: repository.relativePath,
  };
}

export async function loadStewardConfig(options = {}) {
  const sources = await loadConfigurationSources(options);
  const discovery = await discoverRootSet(sources.roots);
  const repositories = [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const repository of [...sources.explicitRepositories, ...discovery.repositories]) {
    if (seenPaths.has(repository.path)) continue;
    if (seenIds.has(repository.id)) throw new Error(`Duplicate repository id: ${repository.id}.`);
    seenIds.add(repository.id);
    seenPaths.add(repository.path);
    repositories.push(repository);
  }
  if (repositories.length > MAX_REPOSITORIES) {
    throw new Error(`Discovered repository fleet exceeds ${MAX_REPOSITORIES} repositories.`);
  }
  repositories.sort((left, right) => left.id.localeCompare(right.id));

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    configPath: sources.configPath,
    stateRoot: sources.stateRoot,
    enrollmentVersion: sources.enrollment.version,
    roots: sources.roots,
    repositories,
    discovery,
  };
}

async function readEnrollmentLock(file) {
  const lock = await readJsonFile(file, "Repo Steward enrollment lock", { optional: true });
  if (!lock) return null;
  assertAllowedKeys(lock, "enrollment lock", ["owner", "expires_at"]);
  const owner = requireOwner(lock.owner);
  if (typeof lock.expires_at !== "string" || !Number.isFinite(Date.parse(lock.expires_at))) {
    throw new Error("enrollment lock expires_at must be an ISO timestamp.");
  }
  return { owner, expires_at: lock.expires_at };
}

async function archiveEnrollmentLock(paths, nowMs) {
  const lockHistory = path.join(paths.history, "locks");
  await ensureStateDirectory(lockHistory);
  const target = path.join(lockHistory, `${nowMs}-stale-${randomUUID()}.json`);
  try {
    await fs.rename(paths.lock, target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function withEnrollmentLock(stateRoot, owner, operation, options = {}) {
  await ensureStateDirectory(stateRoot);
  const paths = enrollmentPaths(stateRoot);
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  let acquired = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let handle;
    try {
      handle = await fs.open(paths.lock, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({
        owner,
        expires_at: new Date(nowMs + ENROLLMENT_LOCK_TTL_MS).toISOString(),
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
      const existing = await readEnrollmentLock(paths.lock);
      if (!existing) continue;
      if (Date.parse(existing.expires_at) > nowMs) {
        throw new Error(`Root enrollment is already in progress by ${existing.owner}.`);
      }
      await archiveEnrollmentLock(paths, nowMs);
    }
  }
  if (!acquired) throw new Error("Unable to acquire root enrollment lock.");

  try {
    return await operation();
  } finally {
    await fs.unlink(paths.lock).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function defaultRootId(rootPath) {
  const candidate = path.basename(rootPath)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  return requireRepositoryId(candidate, "root_id");
}

export async function enrollRepositoryRoot(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", [
    "root_id",
    "root_path",
    "owner",
    "fetch_allowed",
    "max_depth",
  ]);
  const owner = requireOwner(args.owner);
  const rootPathInput = nonEmptyString(args.root_path, "root_path", 4096);
  if (!path.isAbsolute(rootPathInput)) throw new Error("root_path must be absolute.");
  const rootPath = await requireDirectoryRealpath(rootPathInput, "root_path");
  const rootId = args.root_id === undefined
    ? defaultRootId(rootPath)
    : requireRepositoryId(args.root_id, "root_id");
  const root = {
    id: rootId,
    path: rootPath,
    fetchAllowed: optionalBoolean(args.fetch_allowed, "fetch_allowed"),
    maxDepth: boundedInteger(args.max_depth, "max_depth", {
      defaultValue: DEFAULT_DISCOVERY_DEPTH,
      min: 0,
      max: MAX_DISCOVERY_DEPTH,
    }),
    source: "enrollment",
  };
  const stateRoot = defaultStateRoot(options);

  const enrollmentResult = await withEnrollmentLock(stateRoot, owner, async () => {
    const sources = await loadConfigurationSources(options);
    const existingByPath = sources.roots.find((candidate) => candidate.path === root.path);
    if (existingByPath) {
      const samePolicy =
        existingByPath.id === root.id &&
        existingByPath.fetchAllowed === root.fetchAllowed &&
        existingByPath.maxDepth === root.maxDepth;
      if (!samePolicy) {
        throw new Error(`Root ${root.path} is already enrolled with different policy.`);
      }
      return {
        enrollmentVersion: sources.enrollment.version,
        idempotent: true,
        root: existingByPath,
      };
    }
    const existingById = sources.roots.find((candidate) => candidate.id === root.id);
    if (existingById) {
      throw new Error(`Root ID already belongs to another path: ${root.id}.`);
    }
    const overlapping = sources.roots.find((candidate) => pathsOverlap(candidate.path, root.path));
    if (overlapping) {
      const label = overlapping.source === "enrollment" ? "enrolled" : "configured";
      throw new Error(`Root ${root.id} overlaps ${label} root ${overlapping.id}.`);
    }

    const current = sources.enrollment;
    const now = new Date(
      typeof options.now === "function" ? options.now() : Date.now()
    ).toISOString();
    const version = current.version + 1;
    const next = {
      schema_version: CONFIG_SCHEMA_VERSION,
      version,
      roots: [...current.roots, {
        root_id: root.id,
        path: root.path,
        fetch_allowed: root.fetchAllowed,
        max_depth: root.maxDepth,
      }],
      history: [...current.history, {
        version,
        event: "root_enrolled",
        owner,
        root_id: root.id,
        path: root.path,
        at: now,
      }].slice(-MAX_ENROLLMENT_HISTORY),
    };
    const paths = enrollmentPaths(stateRoot);
    if (current.version > 0) {
      await ensureStateDirectory(paths.history);
      await atomicWriteJson(
        path.join(paths.history, `enrollment-v${current.version}-${Date.now()}-${randomUUID()}.json`),
        current
      );
    }
    await atomicWriteJson(paths.active, next);
    return { enrollmentVersion: version, idempotent: false, root };
  }, options);

  const discovery = await discoverRepositories({ root_ids: [rootId] }, options);
  return {
    enrollment_version: enrollmentResult.enrollmentVersion,
    idempotent: enrollmentResult.idempotent,
    root: publicRoot(enrollmentResult.root),
    discovery,
  };
}

export async function discoverRepositories(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["root_ids"]);
  const sources = await loadConfigurationSources(options);
  let roots = sources.roots;
  if (args.root_ids !== undefined) {
    if (
      !Array.isArray(args.root_ids) ||
      args.root_ids.length > MAX_REPOSITORIES ||
      !args.root_ids.every((value) => typeof value === "string")
    ) {
      throw new Error(`root_ids must be an array of at most ${MAX_REPOSITORIES} root IDs.`);
    }
    const rootIds = [...new Set(args.root_ids.map((value) => requireRepositoryId(value, "root_id")))];
    for (const rootId of rootIds) {
      if (!sources.roots.some((root) => root.id === rootId)) {
        throw new Error(`Root is not configured: ${rootId}.`);
      }
    }
    const selected = new Set(rootIds);
    roots = sources.roots.filter((root) => selected.has(root.id));
  }
  const discovery = await discoverRootSet(roots);
  return {
    generated_at: new Date().toISOString(),
    summary: discovery.summary,
    roots: roots.map(publicRoot),
    repositories: discovery.repositories.map(publicRepository),
    failures: discovery.failures,
  };
}

async function assertRepositoryWorktree(repository) {
  const gitRootOutput = (
    await runGit(repository.path, ["rev-parse", "--show-toplevel"], {
      operation: `Resolve Git root for ${repository.id}`,
    })
  ).stdout.trim();
  const gitRoot = await fs.realpath(gitRootOutput);
  if (gitRoot !== repository.path) {
    throw new Error(`Configured path is not the exact Git worktree root for ${repository.id}.`);
  }
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
  for (const repository of config.repositories) await assertRepositoryWorktree(repository);
  return {
    configuration_valid: true,
    config_path: config.configPath,
    enrollment_version: config.enrollmentVersion,
    state_root: config.stateRoot,
    root_count: config.roots.length,
    repository_count: config.repositories.length,
    fetch_enabled_count: config.repositories.filter((repository) => repository.fetchAllowed).length,
    git_version: gitVersion,
    repository_mutation_tools_exposed: false,
    local_state_tools_exposed: true,
    discovery: config.discovery.summary,
    roots: config.roots.map(publicRoot),
    repositories: config.repositories.map(publicRepository),
  };
}

async function resolveConfiguredRepository(repoId, options = {}) {
  const id = requireRepositoryId(repoId);
  const config = await loadStewardConfig(options);
  const repository = config.repositories.find((candidate) => candidate.id === id);
  if (!repository) throw new Error(`Repository is not configured: ${id}.`);

  await assertRepositoryWorktree(repository);

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

async function readRecordLock(file) {
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read record lock: ${redactText(error?.message)}`);
  }
  assertAllowedKeys(lock, "record lock", ["lease_id", "owner", "expires_at"]);
  const leaseId = requireLeaseId(lock.lease_id);
  const owner = requireOwner(lock.owner);
  if (typeof lock.expires_at !== "string" || !Number.isFinite(Date.parse(lock.expires_at))) {
    throw new Error("record lock expires_at must be an ISO timestamp.");
  }
  return { lease_id: leaseId, owner, expires_at: lock.expires_at };
}

async function archiveRecordLock(paths, nowMs) {
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

async function withRecordLock(paths, lease, operation, options = {}, label = "Action update") {
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
      const existing = await readRecordLock(paths.lock);
      if (!existing) continue;
      if (Date.parse(existing.expires_at) > nowMs) {
        throw new Error(
          `${label} is already in progress: ${path.basename(paths.active, ".json")}.`
        );
      }
      await archiveRecordLock(paths, nowMs);
    }
  }

  if (!acquired) {
    throw new Error(
      `Unable to acquire ${label.toLowerCase()} lock after concurrent updates: ${path.basename(paths.active, ".json")}.`
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

async function getResolvedRepositoryStatus(repository, args = {}) {
  const startedAt = Date.now();
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
    source: repository.source,
    root_id: repository.rootId,
    relative_path: repository.relativePath,
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

export async function getRepositoryStatus(args = {}, options = {}) {
  assertAllowedKeys(args, "arguments", ["repo_id", "fetch"]);
  const { repository } = await resolveConfiguredRepository(args.repo_id, options);
  return getResolvedRepositoryStatus(repository, args);
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
      const repository = config.repositories.find((candidate) => candidate.id === repoId);
      repositories.push(await getResolvedRepositoryStatus(repository, {
        fetch: requestedFetch,
      }));
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
    discovery: config.discovery.summary,
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

  return withRecordLock(paths, lease, async () => {
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

  return withRecordLock(paths, lease, async () => {
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

export const { listRepositoryCloseouts, recordRepositoryCloseout } = createCloseoutOperations({
  assertActiveLease, assertAllowedKeys, atomicWriteJson, boundedInteger, boundedSafeText, ensureStateDirectory, getResolvedRepositoryStatus, nonEmptyString, redactText, requireEnum, requireLeaseId, requireOwner, requireRepositoryId, resolveConfiguredRepository, runGit, withRecordLock,
});
export const internal = { randomUUID, redactText, requireRepositoryId };
