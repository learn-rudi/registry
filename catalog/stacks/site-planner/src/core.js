import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const CONFIG_SCHEMA_VERSION = 1;
const WRITE_AUTH_SCHEMA_VERSION = 1;
const WRITE_AUTH_KEY_VERSION = 1;
const WRITE_AUTH_DOMAIN = "RUDI-SITE-PLANNER-WRITE-V1";
const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 48 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_WRITE_GRANT_LIFETIME_MS = 60 * 60 * 1000;
const ALLOWED_OPERATIONS = new Set([
  "inspectConcept",
  "generateLotPlan",
  "optimizeLotPlan",
  "previewConceptCommands",
  "forkConcept",
  "applyConceptCommands",
]);
const WRITE_OPERATIONS = new Set([
  "forkConcept",
  "applyConceptCommands",
]);
const CONFIG_KEYS = new Set([
  "artifactRoot",
  "commandTimeoutMs",
  "expectedCommit",
  "gitPath",
  "maxOutputBytes",
  "nodePath",
  "schemaVersion",
  "sitePlannerRoot",
  "workspaceRoot",
]);
const WRITE_AUTH_KEYS = new Set([
  "approvalDecisionId",
  "approvedOperationId",
  "expiresAt",
  "keyVersion",
  "requestDigest",
  "schemaVersion",
  "signature",
]);

export class SitePlannerStackError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "SitePlannerStackError";
    this.code = code;
  }
}

export function loadConfiguration(options = {}) {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  requireAbsolutePath(homeDirectory, "homeDirectory");
  const configuredPath = options.configPath
    ?? environment.SITE_PLANNER_STACK_CONFIG
    ?? join(
      homeDirectory,
      ".rudi",
      "state",
      "stacks",
      "site-planner",
      "config.json",
    );
  const configPath = requireAbsolutePath(
    configuredPath,
    "SITE_PLANNER_STACK_CONFIG",
  );
  let metadata;
  let text;

  try {
    metadata = statSync(configPath);
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    throw new SitePlannerStackError(
      "configuration_unavailable",
      "Site Planner stack configuration is unavailable.",
      { cause: error },
    );
  }

  if (
    !metadata.isFile()
    || metadata.size < 2
    || metadata.size > MAX_CONFIG_BYTES
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      "Site Planner stack configuration has an invalid size or type.",
    );
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new SitePlannerStackError(
      "insecure_configuration",
      "Site Planner stack configuration must be owner-only.",
    );
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      "Site Planner stack configuration is not valid JSON.",
      { cause: error },
    );
  }

  assertPlainObject(value, "Site Planner stack configuration");
  assertExactKeys(value, CONFIG_KEYS, "Site Planner stack configuration");
  if (value.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new SitePlannerStackError(
      "unsupported_configuration",
      "Site Planner stack configuration schemaVersion is unsupported.",
    );
  }

  const sitePlannerRoot = requireAbsolutePath(
    value.sitePlannerRoot,
    "sitePlannerRoot",
  );
  const workspaceRoot = requireAbsolutePath(
    value.workspaceRoot,
    "workspaceRoot",
  );
  const artifactRoot = requireAbsolutePath(
    value.artifactRoot,
    "artifactRoot",
  );
  const nodePath = requireAbsolutePath(value.nodePath, "nodePath");
  const gitPath = requireAbsolutePath(
    value.gitPath ?? "/usr/bin/git",
    "gitPath",
  );
  const expectedCommit = requirePattern(
    value.expectedCommit,
    "expectedCommit",
    /^[a-f0-9]{40}$/,
    "a 40-character lowercase Git commit",
  );

  if (
    isPathWithin(sitePlannerRoot, workspaceRoot)
    || isPathWithin(sitePlannerRoot, artifactRoot)
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      "Workspace and artifact roots must remain outside the Site Planner checkout.",
    );
  }
  if (
    isPathWithin(workspaceRoot, artifactRoot)
    || isPathWithin(artifactRoot, workspaceRoot)
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      "Workspace and artifact roots must be separate.",
    );
  }

  return Object.freeze({
    artifactRoot,
    commandTimeoutMs: boundedInteger(
      value.commandTimeoutMs,
      "commandTimeoutMs",
      DEFAULT_TIMEOUT_MS,
      1_000,
      300_000,
    ),
    configPath,
    expectedCommit,
    gitPath,
    maxOutputBytes: boundedInteger(
      value.maxOutputBytes,
      "maxOutputBytes",
      DEFAULT_MAX_OUTPUT_BYTES,
      1_000,
      64 * 1024 * 1024,
    ),
    nodePath,
    sitePlannerRoot,
    workspaceRoot,
  });
}

export async function assertRuntimeReady(configuration, dependencies = {}) {
  const run = dependencies.execFile ?? execFile;
  assertConfigurationShape(configuration);
  requireDirectory(configuration.sitePlannerRoot, "Site Planner checkout");
  requireDirectory(configuration.workspaceRoot, "Site Planner workspace");
  requireDirectory(configuration.artifactRoot, "Site Planner artifact root");
  requireExecutableFile(configuration.nodePath, "Configured Node executable");
  requireExecutableFile(configuration.gitPath, "Configured Git executable");
  const cliPath = join(
    configuration.sitePlannerRoot,
    "apps",
    "site-planner",
    "src",
    "agent-operation-cli.ts",
  );
  requireRegularFile(cliPath, "Site Planner agent-operation CLI");
  assertNotSymlinkedRoot(
    configuration.sitePlannerRoot,
    "Site Planner checkout",
  );
  assertNotSymlinkedRoot(configuration.workspaceRoot, "Site Planner workspace");
  assertNotSymlinkedRoot(configuration.artifactRoot, "Site Planner artifact root");

  const commandOptions = {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: Math.min(configuration.commandTimeoutMs, 30_000),
  };
  const [{ stdout: commitOutput }, { stdout: statusOutput }, { stdout: nodeOutput }] =
    await Promise.all([
      run(
        configuration.gitPath,
        ["-C", configuration.sitePlannerRoot, "rev-parse", "HEAD"],
        commandOptions,
      ),
      run(
        configuration.gitPath,
        [
          "-C",
          configuration.sitePlannerRoot,
          "status",
          "--porcelain=v1",
          "--untracked-files=normal",
        ],
        commandOptions,
      ),
      run(configuration.nodePath, ["--version"], commandOptions),
    ]);
  const commit = String(commitOutput).trim();
  const status = String(statusOutput).trim();
  const nodeVersion = requireNodeVersion(String(nodeOutput).trim());

  if (commit !== configuration.expectedCommit) {
    throw new SitePlannerStackError(
      "revision_mismatch",
      "Site Planner checkout does not match the configured commit.",
    );
  }
  if (status !== "") {
    throw new SitePlannerStackError(
      "dirty_checkout",
      "Site Planner checkout must be clean before adapter execution.",
    );
  }

  return {
    commit,
    nodeVersion,
    ready: true,
  };
}

export function createWriteAuthorization(input) {
  assertPlainObject(input, "write authorization input");
  requireWriteKey(input.key);
  const requestDigest = digestJson(input.request, "request");
  const authorization = {
    approvalDecisionId: safeIdentifier(
      input.approvalDecisionId,
      "approvalDecisionId",
    ),
    approvedOperationId: safeIdentifier(
      input.approvedOperationId,
      "approvedOperationId",
    ),
    expiresAt: canonicalTimestamp(input.expiresAt, "expiresAt"),
    keyVersion: requireKeyVersion(input.keyVersion),
    requestDigest,
    schemaVersion: WRITE_AUTH_SCHEMA_VERSION,
  };
  const signature = createHmac("sha256", input.key)
    .update(writeAuthorizationMessage(authorization))
    .digest("base64url");
  return Object.freeze({ ...authorization, signature });
}

export async function executeSitePlannerOperation(input, dependencies = {}) {
  assertPlainObject(input, "Site Planner execution input");
  assertConfigurationShape(input.configuration);
  const operation = requireAllowedOperation(input.request);
  const requestDigest = digestJson(input.request, "request");
  const now = input.now ?? (() => new Date());
  let approval = null;

  if (WRITE_OPERATIONS.has(operation)) {
    requireWriteKey(input.writeKey);
    if (input.writeAuthorization === undefined) {
      throw new SitePlannerStackError(
        "write_authorization_required",
        "Site Planner write authorization is required.",
      );
    }
    approval = verifyWriteAuthorization({
      authorization: input.writeAuthorization,
      key: input.writeKey,
      now: now(),
      operation,
      requestDigest,
    });
  } else if (input.writeAuthorization !== undefined) {
    throw new SitePlannerStackError(
      "unexpected_write_authorization",
      "Read-only Site Planner operations do not accept write authorization.",
    );
  }

  const runtime = await assertRuntimeReady(
    input.configuration,
    dependencies,
  );
  const result = await invokeSitePlannerCli({
    configuration: input.configuration,
    operation,
    request: input.request,
    run: dependencies.execFile ?? execFile,
  });
  const artifact = persistExecutionArtifact({
    approval,
    configuration: input.configuration,
    now: canonicalTimestamp(now().toISOString(), "now"),
    operation,
    requestDigest,
    result,
    runtime,
  });

  return {
    artifact,
    result,
    runtime,
  };
}

async function invokeSitePlannerCli(input) {
  const requestsRoot = join(input.configuration.artifactRoot, ".requests");
  mkdirSync(requestsRoot, { mode: 0o700, recursive: true });
  chmodSync(requestsRoot, 0o700);
  const requestDirectory = mkdtempSync(join(requestsRoot, "request-"));
  chmodSync(requestDirectory, 0o700);
  const requestPath = join(requestDirectory, "request.json");
  writeFileSync(
    requestPath,
    `${JSON.stringify(input.request)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  const cliPath = join(
    input.configuration.sitePlannerRoot,
    "apps",
    "site-planner",
    "src",
    "agent-operation-cli.ts",
  );

  try {
    let output;
    try {
      output = await input.run(
        input.configuration.nodePath,
        [
          cliPath,
          "--workspace-root",
          input.configuration.workspaceRoot,
          "--request",
          requestPath,
        ],
        {
          cwd: input.configuration.sitePlannerRoot,
          encoding: "utf8",
          env: {
            HOME: homedir(),
            PATH: `${dirname(input.configuration.nodePath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
          },
          maxBuffer: input.configuration.maxOutputBytes,
          timeout: input.configuration.commandTimeoutMs,
        },
      );
    } catch (error) {
      const parsed = parseCliJson(error?.stdout, input.operation, true);
      if (parsed) {
        throw new SitePlannerStackError(
          parsed.error?.code ?? "site_planner_failed",
          parsed.error?.message ?? "Site Planner operation failed.",
          { cause: error },
        );
      }
      throw new SitePlannerStackError(
        error?.killed ? "site_planner_timeout" : "site_planner_failed",
        error?.killed
          ? "Site Planner operation timed out."
          : "Site Planner operation failed.",
        { cause: error },
      );
    }

    const result = parseCliJson(output.stdout, input.operation, false);
    if (!result) {
      throw new SitePlannerStackError(
        "invalid_site_planner_result",
        "Site Planner returned an invalid result.",
      );
    }
    return result;
  } finally {
    rmSync(requestDirectory, { force: true, recursive: true });
  }
}

function parseCliJson(output, operation, allowError) {
  if (typeof output !== "string" || output.trim() === "") {
    return null;
  }
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (
    !isPlainObject(value)
    || value.operation !== operation
    || (
      value.messageType !== "result"
      && !(allowError && value.messageType === "error")
    )
  ) {
    return null;
  }
  return value;
}

function persistExecutionArtifact(input) {
  const resultDigest = digestJson(
    input.result,
    "result",
    input.configuration.maxOutputBytes,
  );
  const artifactDirectory = join(
    input.configuration.artifactRoot,
    safePathSegment(input.operation),
    input.requestDigest,
  );
  mkdirSync(artifactDirectory, { mode: 0o700, recursive: true });
  chmodSync(artifactDirectory, 0o700);
  const resultPath = join(artifactDirectory, `${resultDigest}.result.json`);
  const manifestPath = join(artifactDirectory, `${resultDigest}.manifest.json`);
  const approval = input.approval
    ? {
        approvalDecisionId: input.approval.approvalDecisionId,
        approvedOperationId: input.approval.approvedOperationId,
        keyVersion: input.approval.keyVersion,
      }
    : undefined;
  const manifest = {
    ...(approval ? { approval } : {}),
    createdAt: input.now,
    operation: input.operation,
    requestDigest: input.requestDigest,
    resultDigest,
    resultPath,
    schemaVersion: 1,
    sitePlannerCommit: input.runtime.commit,
  };
  writeImmutablePrivateJson(resultPath, input.result);
  writeImmutablePrivateJson(manifestPath, manifest);

  return {
    ...(approval ? { approval } : {}),
    manifestPath,
    requestDigest: input.requestDigest,
    resultDigest,
    resultPath,
  };
}

function verifyWriteAuthorization(input) {
  assertPlainObject(input.authorization, "write authorization");
  assertExactKeys(
    input.authorization,
    WRITE_AUTH_KEYS,
    "write authorization",
  );
  if (input.authorization.schemaVersion !== WRITE_AUTH_SCHEMA_VERSION) {
    throw new SitePlannerStackError(
      "invalid_write_authorization",
      "Site Planner write authorization schemaVersion is unsupported.",
    );
  }
  const authorization = {
    approvalDecisionId: safeIdentifier(
      input.authorization.approvalDecisionId,
      "approvalDecisionId",
    ),
    approvedOperationId: safeIdentifier(
      input.authorization.approvedOperationId,
      "approvedOperationId",
    ),
    expiresAt: canonicalTimestamp(
      input.authorization.expiresAt,
      "expiresAt",
    ),
    keyVersion: requireKeyVersion(input.authorization.keyVersion),
    requestDigest: requirePattern(
      input.authorization.requestDigest,
      "requestDigest",
      /^[a-f0-9]{64}$/,
      "a lowercase SHA-256 digest",
    ),
    schemaVersion: WRITE_AUTH_SCHEMA_VERSION,
  };
  const signature = requirePattern(
    input.authorization.signature,
    "signature",
    /^[A-Za-z0-9_-]{43}$/,
    "a 43-character base64url HMAC",
  );
  if (authorization.requestDigest !== input.requestDigest) {
    throw new SitePlannerStackError(
      "invalid_write_authorization",
      "Site Planner write authorization does not match the request.",
    );
  }
  const currentTime = requireDate(input.now, "now").getTime();
  const expiresAt = new Date(authorization.expiresAt).getTime();
  if (expiresAt <= currentTime) {
    throw new SitePlannerStackError(
      "expired_write_authorization",
      "Site Planner write authorization has expired.",
    );
  }
  if (expiresAt - currentTime > MAX_WRITE_GRANT_LIFETIME_MS) {
    throw new SitePlannerStackError(
      "invalid_write_authorization",
      "Site Planner write authorization lifetime is too long.",
    );
  }
  const expected = createHmac("sha256", input.key)
    .update(writeAuthorizationMessage(authorization))
    .digest("base64url");
  const suppliedBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    suppliedBuffer.length !== expectedBuffer.length
    || !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new SitePlannerStackError(
      "invalid_write_authorization",
      "Site Planner write authorization signature is invalid.",
    );
  }
  return authorization;
}

function writeAuthorizationMessage(authorization) {
  const fields = [
    WRITE_AUTH_DOMAIN,
    authorization.schemaVersion.toString(),
    authorization.keyVersion.toString(),
    authorization.approvalDecisionId,
    authorization.approvedOperationId,
    authorization.expiresAt,
    authorization.requestDigest,
  ];
  return Buffer.concat(fields.map((field) => {
    const bytes = Buffer.from(field, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  }));
}

function digestJson(value, label, maximumBytes = MAX_REQUEST_BYTES) {
  const normalized = normalizeJson(value, label);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new SitePlannerStackError(
      "oversized_input",
      `${label} exceeds the ${maximumBytes}-byte limit.`,
    );
  }
  return createHash("sha256").update(serialized).digest("hex");
}

function normalizeJson(value, label, ancestors = new WeakSet(), depth = 0) {
  if (depth > 50) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} exceeds the maximum JSON depth.`,
    );
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SitePlannerStackError(
        "invalid_input",
        `${label} contains a non-finite number.`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must be JSON-compatible.`,
    );
  }
  if (ancestors.has(value)) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must not contain cycles.`,
    );
  }
  ancestors.add(value);
  const normalized = Array.isArray(value)
    ? value.map((entry) => (
        normalizeJson(entry, label, ancestors, depth + 1)
      ))
    : Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [
            key,
            normalizeJson(value[key], label, ancestors, depth + 1),
          ]),
      );
  ancestors.delete(value);
  return normalized;
}

function requireAllowedOperation(request) {
  assertPlainObject(request, "request");
  if (
    typeof request.operation !== "string"
    || !ALLOWED_OPERATIONS.has(request.operation)
  ) {
    throw new SitePlannerStackError(
      "unsupported_operation",
      "Site Planner operation is not registered.",
    );
  }
  return request.operation;
}

function assertConfigurationShape(value) {
  if (
    !isPlainObject(value)
    || !isAbsolute(value.sitePlannerRoot ?? "")
    || !isAbsolute(value.workspaceRoot ?? "")
    || !isAbsolute(value.artifactRoot ?? "")
    || !isAbsolute(value.nodePath ?? "")
    || !isAbsolute(value.gitPath ?? "")
    || !/^[a-f0-9]{40}$/.test(value.expectedCommit ?? "")
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      "Site Planner runtime configuration is invalid.",
    );
  }
}

function assertExactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} contains unsupported fields.`,
    );
  }
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must be an object.`,
    );
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireAbsolutePath(value, label) {
  if (
    typeof value !== "string"
    || !isAbsolute(value)
    || value.length > 4096
    || value.includes("\0")
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      `${label} must be an absolute path.`,
    );
  }
  return resolve(value);
}

function requirePattern(value, label, pattern, expected) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must be ${expected}.`,
    );
  }
  return value;
}

function boundedInteger(value, label, defaultValue, minimum, maximum) {
  const resolved = value === undefined ? defaultValue : value;
  if (
    !Number.isSafeInteger(resolved)
    || resolved < minimum
    || resolved > maximum
  ) {
    throw new SitePlannerStackError(
      "invalid_configuration",
      `${label} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return resolved;
}

function isPathWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === ""
    || (
      pathFromParent !== ".."
      && !pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      && !isAbsolute(pathFromParent)
    )
  );
}

function requireDirectory(path, label) {
  let metadata;
  try {
    metadata = statSync(path);
  } catch (error) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      `${label} is unavailable.`,
      { cause: error },
    );
  }
  if (!metadata.isDirectory()) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      `${label} must be a directory.`,
    );
  }
}

function requireRegularFile(path, label) {
  let metadata;
  try {
    metadata = statSync(path);
  } catch (error) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      `${label} is unavailable.`,
      { cause: error },
    );
  }
  if (!metadata.isFile()) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      `${label} must be a file.`,
    );
  }
}

function requireExecutableFile(path, label) {
  requireRegularFile(path, label);
  if ((statSync(path).mode & 0o111) === 0) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      `${label} is not executable.`,
    );
  }
}

function assertNotSymlinkedRoot(path, label) {
  if (lstatSync(path).isSymbolicLink()) {
    throw new SitePlannerStackError(
      "runtime_drift",
      `${label} must not be a symbolic link.`,
    );
  }
}

function requireNodeVersion(value) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      "Configured Node executable returned an invalid version.",
    );
  }
  const [, major, minor] = match.map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    throw new SitePlannerStackError(
      "runtime_unavailable",
      "Site Planner requires Node 22.18 or newer.",
    );
  }
  return value;
}

function requireWriteKey(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new SitePlannerStackError(
      "write_authorization_unavailable",
      "Site Planner write authorization key is unavailable.",
    );
  }
  return value;
}

function requireKeyVersion(value) {
  if (value !== WRITE_AUTH_KEY_VERSION) {
    throw new SitePlannerStackError(
      "invalid_write_authorization",
      "Site Planner write authorization keyVersion is unsupported.",
    );
  }
  return value;
}

function safeIdentifier(value, label) {
  return requirePattern(
    value,
    label,
    /^[A-Za-z0-9._:-]{1,200}$/,
    "a bounded safe identifier",
  );
}

function canonicalTimestamp(value, label) {
  if (
    typeof value !== "string"
    || value.length < 20
    || value.length > 35
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must be a canonical ISO timestamp.`,
    );
  }
  return value;
}

function requireDate(value, label) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new SitePlannerStackError(
      "invalid_input",
      `${label} must be a valid Date.`,
    );
  }
  return value;
}

function safePathSegment(value) {
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value)) {
    throw new SitePlannerStackError(
      "invalid_input",
      "Site Planner operation cannot be used as an artifact path.",
    );
  }
  return value;
}

function writeImmutablePrivateJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== text) {
      throw new SitePlannerStackError(
        "artifact_conflict",
        "Existing Site Planner artifact conflicts with this result.",
      );
    }
    return;
  }
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(
      temporaryPath,
      text,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) {
      rmSync(temporaryPath, { force: true });
    }
  }
}
