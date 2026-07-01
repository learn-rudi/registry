export interface EnvLike {
  [key: string]: string | undefined;
}

export type ToolArgs = Record<string, unknown> | undefined;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText?: string;
  headers?: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export type FetchLike = (
  url: string | URL,
  init?: RequestInit
) => Promise<FetchResponseLike>;

export interface NeonDependencies {
  env?: EnvLike;
  fetchImpl?: FetchLike;
}

export interface ConfigStatus {
  api_key_configured: boolean;
  api_base_url: string;
  can_authenticate: boolean;
  mcp_scope: "development-testing-only";
  production_guardrail: string;
  blocker?: string;
}

export const DEFAULT_API_BASE_URL = "https://console.neon.tech/api/v2";
export const MCP_PRODUCTION_GUARDRAIL =
  "Use Neon MCP only for development and testing. Do not connect MCP agents freely to production databases.";
export const MAX_LIST_LIMIT = 400;

const NEON_ID_PATTERN = /^[a-z0-9-]{1,60}$/;
const DEFAULT_MCP_URL = "https://mcp.neon.tech/mcp";
const MCP_CATEGORIES = new Set([
  "projects",
  "branches",
  "schema",
  "querying",
  "neon_auth",
  "data_api",
  "docs",
]);

export function getEnv(name: string, env: EnvLike = process.env): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getApiBaseUrl(env: EnvLike = process.env): string {
  return getEnv("NEON_API_BASE_URL", env) || DEFAULT_API_BASE_URL;
}

export function getConfigStatus(env: EnvLike = process.env): ConfigStatus {
  const apiKey = getEnv("NEON_API_KEY", env);

  return {
    api_key_configured: Boolean(apiKey),
    api_base_url: getApiBaseUrl(env),
    can_authenticate: Boolean(apiKey),
    mcp_scope: "development-testing-only",
    production_guardrail: MCP_PRODUCTION_GUARDRAIL,
    blocker: apiKey ? undefined : "Set NEON_API_KEY in RUDI secrets.",
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function optionalInteger(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

function optionalStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function optionalLimit(value: unknown): number | undefined {
  const limit = optionalInteger(value, "limit");
  if (limit === undefined) {
    return undefined;
  }
  if (limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }
  return limit;
}

function validateNeonId(value: string, name: string): string {
  if (!NEON_ID_PATTERN.test(value)) {
    throw new Error(`${name} must be 1-60 lowercase letters, numbers, or dashes`);
  }
  return value;
}

function optionalNeonId(value: unknown, name: string): string | undefined {
  const text = optionalString(value, name);
  return text ? validateNeonId(text, name) : undefined;
}

function requiredNeonId(value: unknown, name: string): string {
  return validateNeonId(requireString(value, name), name);
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function getApiKey(env: EnvLike = process.env): string {
  const apiKey = getEnv("NEON_API_KEY", env);
  if (!apiKey) {
    throw new Error("NEON_API_KEY is not configured");
  }
  return apiKey;
}

function getFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (typeof fetch !== "function") {
    throw new Error("global fetch is not available; use Node.js 20+");
  }
  return fetch as unknown as FetchLike;
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function normalizeApiBaseUrl(env: EnvLike = process.env): URL {
  const base = getApiBaseUrl(env).replace(/\/+$/, "");
  const url = new URL(`${base}/`);
  if (url.protocol !== "https:") {
    throw new Error("NEON_API_BASE_URL must use https");
  }
  return url;
}

function parseJsonResponse(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function redactedErrorBody(raw: string): unknown {
  const parsed = parseJsonResponse(raw);
  if (typeof parsed === "string") {
    return parsed.slice(0, 500);
  }
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }
  return parsed;
}

async function neonApiRequest(
  path: string,
  options: {
    method?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
  deps: NeonDependencies = {}
): Promise<unknown> {
  const env = deps.env ?? process.env;
  const apiKey = getApiKey(env);
  const base = normalizeApiBaseUrl(env);
  const url = new URL(path.replace(/^\//, ""), base);
  appendQuery(url, options.query ?? {});

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const response = await getFetch(deps.fetchImpl)(url, init);
  const raw = await response.text();
  if (!response.ok) {
    const retryAfter = response.headers?.get("retry-after") ?? undefined;
    throw new Error(JSON.stringify({
      error: "neon_api_error",
      status: response.status,
      status_text: response.statusText,
      retry_after: retryAfter,
      body: redactedErrorBody(raw),
    }));
  }

  return parseJsonResponse(raw);
}

export function redactConnectionUri(uri: string): string {
  try {
    const parsed = new URL(uri);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return uri.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");
  }
}

function responseConnectionUri(response: unknown): string {
  if (!response || typeof response !== "object") {
    throw new Error("Neon API response did not include a connection URI");
  }
  const record = response as Record<string, unknown>;
  const uri = record.uri ?? record.connection_uri ?? record.connection_string;
  if (typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error("Neon API response did not include a connection URI");
  }
  return uri;
}

export async function listOrgs(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<unknown> {
  void args;
  return neonApiRequest("/users/me/organizations", {}, deps);
}

export async function listProjects(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<unknown> {
  return neonApiRequest(
    "/projects",
    {
      query: {
        cursor: optionalString(args?.cursor, "cursor"),
        limit: optionalLimit(args?.limit),
        search: optionalString(args?.search, "search"),
        org_id: optionalNeonId(args?.org_id, "org_id"),
      },
    },
    deps
  );
}

export async function createProject(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<unknown> {
  const project: Record<string, unknown> = {
    name: requireString(args?.name, "name"),
  };

  const regionId = optionalString(args?.region_id, "region_id");
  const pgVersion = optionalInteger(args?.pg_version, "pg_version");
  const branchName = optionalString(args?.branch_name, "branch_name");
  const databaseName = optionalString(args?.database_name, "database_name");
  const roleName = optionalString(args?.role_name, "role_name");
  const orgId = optionalNeonId(args?.org_id, "org_id");
  const confirmCreate = optionalBoolean(args?.confirm_create, "confirm_create") === true;

  if (regionId) project.region_id = regionId;
  if (pgVersion !== undefined) {
    if (pgVersion < 1 || pgVersion > 99) {
      throw new Error("pg_version must be between 1 and 99");
    }
    project.pg_version = pgVersion;
  }
  if (branchName || databaseName || roleName) {
    project.branch = {
      ...(branchName ? { name: branchName } : {}),
      ...(databaseName ? { database_name: databaseName } : {}),
      ...(roleName ? { role_name: roleName } : {}),
    };
  }

  const body = { project };
  if (!confirmCreate) {
    return {
      dry_run: true,
      confirm_required: "Pass confirm_create: true to create a Neon project.",
      would_create: body,
      query: orgId ? { org_id: orgId } : {},
    };
  }

  return neonApiRequest(
    "/projects",
    {
      method: "POST",
      query: orgId ? { org_id: orgId } : {},
      body,
    },
    deps
  );
}

export async function listBranches(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<unknown> {
  const projectId = requiredNeonId(args?.project_id, "project_id");
  return neonApiRequest(
    `/projects/${projectId}/branches`,
    {
      query: {
        cursor: optionalString(args?.cursor, "cursor"),
        limit: optionalLimit(args?.limit),
        search: optionalString(args?.search, "search"),
      },
    },
    deps
  );
}

export async function createBranch(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<unknown> {
  const projectId = requiredNeonId(args?.project_id, "project_id");
  const branch: Record<string, unknown> = {};
  const name = optionalString(args?.name, "name");
  const parentId = optionalNeonId(args?.parent_id, "parent_id");
  const createCompute = optionalBoolean(args?.create_compute, "create_compute") === true;
  const confirmCreate = optionalBoolean(args?.confirm_create, "confirm_create") === true;

  if (name) branch.name = name;
  if (parentId) branch.parent_id = parentId;

  const body: Record<string, unknown> = {};
  if (Object.keys(branch).length > 0) {
    body.branch = branch;
  }
  if (createCompute) {
    body.endpoints = [{ type: "read_write" }];
  }

  if (!confirmCreate) {
    return {
      dry_run: true,
      confirm_required: "Pass confirm_create: true to create a Neon branch.",
      would_create: body,
      project_id: projectId,
    };
  }

  return neonApiRequest(
    `/projects/${projectId}/branches`,
    {
      method: "POST",
      body,
    },
    deps
  );
}

export async function getConnectionString(args: ToolArgs = {}, deps: NeonDependencies = {}): Promise<Record<string, unknown>> {
  const projectId = requiredNeonId(args?.project_id, "project_id");
  const reveal = optionalBoolean(args?.reveal, "reveal") === true;
  const confirmSensitive = optionalBoolean(args?.confirm_sensitive, "confirm_sensitive") === true;

  const response = await neonApiRequest(
    `/projects/${projectId}/connection_uri`,
    {
      query: {
        branch_id: optionalNeonId(args?.branch_id, "branch_id"),
        endpoint_id: optionalNeonId(args?.endpoint_id, "endpoint_id"),
        database_name: requireString(args?.database_name, "database_name"),
        role_name: requireString(args?.role_name, "role_name"),
        pooled: optionalBoolean(args?.pooled, "pooled"),
      },
    },
    deps
  );
  const uri = responseConnectionUri(response);
  const redacted = redactConnectionUri(uri);

  return {
    connection_uri_redacted: redacted,
    sensitive: true,
    reveal_blocker: reveal && !confirmSensitive
      ? "Pass confirm_sensitive: true to return the full connection URI."
      : undefined,
    connection_uri: reveal && confirmSensitive ? uri : undefined,
  };
}

export function generateMcpConfig(args: ToolArgs = {}): Record<string, unknown> {
  const serverName = optionalString(args?.server_name, "server_name") || "neon";
  const authMode = optionalString(args?.auth_mode, "auth_mode") || "oauth";
  if (!["oauth", "api_key"].includes(authMode)) {
    throw new Error("auth_mode must be oauth or api_key");
  }
  const readonly = optionalBoolean(args?.readonly, "readonly") === true;
  const projectId = optionalNeonId(args?.project_id, "project_id");
  const categories = optionalStringArray(args?.categories, "categories");
  for (const category of categories) {
    if (!MCP_CATEGORIES.has(category)) {
      throw new Error(`categories must contain only: ${[...MCP_CATEGORIES].join(", ")}`);
    }
  }

  const mcpUrl = new URL(DEFAULT_MCP_URL);
  if (readonly) {
    mcpUrl.searchParams.set("readonly", "true");
  }
  if (projectId) {
    mcpUrl.searchParams.set("projectId", projectId);
  }
  for (const category of categories) {
    mcpUrl.searchParams.append("category", category);
  }

  const serverConfig: Record<string, unknown> = {
    type: "http",
    url: mcpUrl.toString(),
  };
  if (authMode === "api_key") {
    serverConfig.headers = {
      Authorization: "Bearer ${NEON_API_KEY}",
    };
  }

  return {
    mcp_config: {
      mcpServers: {
        [serverName]: serverConfig,
      },
    },
    auth_mode: authMode,
    readonly,
    project_id: projectId,
    categories,
    production_guardrail: MCP_PRODUCTION_GUARDRAIL,
  };
}

export function generateCliWorkflow(args: ToolArgs = {}): Record<string, unknown> {
  const orgId = optionalNeonId(args?.org_id, "org_id");
  const projectName = requireString(args?.project_name, "project_name");
  const regionId = optionalString(args?.region_id, "region_id") || "aws-us-east-1";
  const databaseName = optionalString(args?.database_name, "database_name") || "neondb";
  const roleName = optionalString(args?.role_name, "role_name") || "app";
  const includeBrew = optionalBoolean(args?.include_brew_install, "include_brew_install") === true;
  const includeNpm = optionalBoolean(args?.include_npm_install, "include_npm_install") !== false;
  const vercelEnvironments = optionalStringArray(args?.vercel_environments, "vercel_environments");
  const localEnvPath = optionalString(args?.local_env_path, "local_env_path") || ".env.local";

  const install = [
    ...(includeBrew ? ["brew install neonctl"] : []),
    ...(includeNpm ? ["npm i -g neonctl"] : []),
  ];
  const createProject = [
    "neon projects create",
    ...(orgId ? ["--org-id", shellArg(orgId)] : []),
    "--name",
    shellArg(projectName),
    "--region-id",
    shellArg(regionId),
    "--database",
    shellArg(databaseName),
    "--role",
    shellArg(roleName),
    "--set-context",
    "--output",
    "json",
  ].join(" ");

  return {
    sensitive_values_included: false,
    guardrails: [
      "Run neon auth in a browser or set NEON_API_KEY through RUDI secrets. Do not paste API keys into chat.",
      "Use neon connection-string --pooled to retrieve DATABASE_URL, then pass it directly into Vercel/local env without printing it.",
      "Use app repo migrations and reviewed code for production database changes.",
    ],
    commands: {
      install,
      auth: [
        "neon auth",
        "rudi secrets set NEON_API_KEY",
      ],
      neon: [
        "neon orgs list",
        createProject,
        "neon connection-string --pooled",
      ],
      vercel: vercelEnvironments.map(
        (environment) => `vercel env add DATABASE_URL ${shellArg(environment)}`
      ),
      local: [
        `printf 'DATABASE_URL=%s\\n' '<paste-pooled-neon-connection-string>' >> ${shellArg(localEnvPath)}`,
      ],
      app: [
        "npm run migrate",
        "npm run seed",
        "npm test",
        "vercel deploy",
      ],
    },
  };
}
