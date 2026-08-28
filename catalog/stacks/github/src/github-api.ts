export interface EnvLike {
  [key: string]: string | undefined;
}

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

export interface GitHubDependencies {
  env?: EnvLike;
  fetchImpl?: FetchLike;
}

export interface ConfigStatus extends Record<string, unknown> {
  token_configured: boolean;
  credential_present: boolean;
  api_base_url: string;
  provider_verified: boolean;
  can_authenticate: boolean;
  authenticated_login?: string;
  provider_status?: number;
  blocker?: string;
}

export interface PaginationLinks {
  first?: string;
  previous?: string;
  next?: string;
  last?: string;
}

export interface ApiResult<T> {
  data: T;
  pagination: PaginationLinks;
}

export const DEFAULT_API_BASE_URL = "https://api.github.com";
export const DEFAULT_API_VERSION = "2022-11-28";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_PER_PAGE = 100;

const LOGIN_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

export function getEnv(name: string, env: EnvLike = process.env): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getApiBaseUrl(env: EnvLike = process.env): string {
  return getEnv("GITHUB_API_BASE_URL", env) || DEFAULT_API_BASE_URL;
}

export function getConfigStatus(env: EnvLike = process.env): ConfigStatus {
  const token = getEnv("GITHUB_TOKEN", env);
  return {
    token_configured: Boolean(token),
    credential_present: Boolean(token),
    api_base_url: getStatusApiBaseUrl(env),
    provider_verified: false,
    can_authenticate: false,
    blocker: token
      ? "GitHub identity has not been provider-verified. Call github_auth_status."
      : "Set GITHUB_TOKEN in RUDI secrets.",
  };
}

function appendQuery(url: URL, query: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

function normalizeApiBaseUrl(env: EnvLike = process.env): URL {
  let url: URL;
  try {
    url = new URL(getApiBaseUrl(env));
  } catch {
    throw new Error("GITHUB_API_BASE_URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("GITHUB_API_BASE_URL must use https");
  }
  if (url.username || url.password) {
    throw new Error("GITHUB_API_BASE_URL must not include credentials");
  }
  if (url.search || url.hash) {
    throw new Error("GITHUB_API_BASE_URL must not include a query string or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function getStatusApiBaseUrl(env: EnvLike = process.env): string {
  try {
    const url = new URL(getApiBaseUrl(env));
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return "(invalid GITHUB_API_BASE_URL)";
  }
}

function getToken(env: EnvLike = process.env): string {
  const token = getEnv("GITHUB_TOKEN", env);
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured");
  }
  return token;
}

function getTimeoutMs(env: EnvLike = process.env): number {
  const raw = getEnv("GITHUB_API_TIMEOUT_MS", env);
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const timeout = Number(raw);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > MAX_TIMEOUT_MS) {
    throw new Error(`GITHUB_API_TIMEOUT_MS must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
  }
  return timeout;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactText(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED_TOKEN]");
    }
  }
  return redacted.replace(
    /\b(Bearer|token)\s+[A-Za-z0-9_./:+\-]{8,}/gi,
    "$1 [REDACTED_TOKEN]"
  );
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(0, 2_000);
  }
}

function redactedErrorBody(raw: string, token: string): unknown {
  return parseJson(redactText(raw.slice(0, 5_000), [token]));
}

class GitHubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

function getAcceptedPermissions(
  response: FetchResponseLike,
  token: string
): string | undefined {
  const raw = response.headers?.get("x-accepted-github-permissions")?.trim();
  if (!raw || raw.length > 500) {
    return undefined;
  }
  const redacted = redactText(raw, [token]);
  if (redacted !== raw) {
    return undefined;
  }
  const permission = "[a-z][a-z0-9_]*=(?:read|write)";
  const permissionSet = `${permission}(?:\\s*,\\s*${permission})*`;
  if (!new RegExp(`^${permissionSet}(?:\\s*;\\s*${permissionSet})*$`).test(raw)) {
    return undefined;
  }
  return raw;
}

function getPermissionGuidance(
  response: FetchResponseLike,
  rawBody: string,
  path: string,
  method: string,
  token: string
): string {
  const acceptedPermissions = getAcceptedPermissions(response, token);
  if (acceptedPermissions) {
    return ` Accepted GitHub permissions: ${acceptedPermissions}.`;
  }

  const isFineGrainedPermissionFailure =
    response.status === 403 &&
    rawBody.includes("Resource not accessible by personal access token");
  const isCreatePullRequest =
    method === "POST" && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path);
  if (isFineGrainedPermissionFailure && isCreatePullRequest) {
    return " Required repository permission: Pull requests (write).";
  }

  return "";
}

function parseLinkHeader(linkHeader: string | null | undefined): PaginationLinks {
  if (!linkHeader) {
    return {};
  }
  const links: PaginationLinks = {};
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>;\s*rel="([^"]+)"/.exec(part.trim());
    if (!match) {
      continue;
    }
    const [, url, rel] = match;
    if (rel === "first" || rel === "prev" || rel === "next" || rel === "last") {
      const key = rel === "prev" ? "previous" : rel;
      links[key] = url;
    }
  }
  return links;
}

export async function githubApiRequest<T>(
  path: string,
  options: {
    method?: string;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  } = {},
  deps: GitHubDependencies = {}
): Promise<ApiResult<T>> {
  const env = deps.env ?? process.env;
  const token = getToken(env);
  const base = normalizeApiBaseUrl(env);
  const url = new URL(path.replace(/^\//, ""), base);
  appendQuery(url, options.query ?? {});

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "rudi-github-stack/1.0.1",
    "X-GitHub-Api-Version": DEFAULT_API_VERSION,
  };
  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  const timeoutMs = getTimeoutMs(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let response: FetchResponseLike;
  try {
    response = await getFetch(deps.fetchImpl)(url.toString(), init);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`GitHub API request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`GitHub API request failed: ${redactText(message, [token])}`);
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  if (!response.ok) {
    const body = redactedErrorBody(raw, token);
    const permissionGuidance = getPermissionGuidance(
      response,
      raw,
      path,
      init.method ?? "GET",
      token
    );
    throw new GitHubApiError(
      response.status,
      `GitHub API error ${response.status}: ${JSON.stringify(body, null, 2)}${permissionGuidance}`
    );
  }

  return {
    data: parseJson(raw) as T,
    pagination: parseLinkHeader(response.headers?.get("link")),
  };
}

function requireAuthenticatedLogin(data: unknown, token: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("GitHub API returned an unexpected authenticated user payload");
  }
  const login = (data as Record<string, unknown>).login;
  if (
    typeof login !== "string" ||
    !LOGIN_PATTERN.test(login) ||
    redactText(login, [token]) !== login
  ) {
    throw new Error("GitHub API returned an invalid authenticated user login");
  }
  return login;
}

export async function githubAuthStatus(
  args: Record<string, unknown> | undefined = {},
  deps: GitHubDependencies = {}
): Promise<ConfigStatus> {
  if (args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    throw new Error("arguments must be an object");
  }
  const env = deps.env ?? process.env;
  const configured = getConfigStatus(env);
  if (!configured.credential_present) {
    return configured;
  }

  try {
    const result = await githubApiRequest<Record<string, unknown>>("/user", {}, deps);
    return {
      token_configured: true,
      credential_present: true,
      api_base_url: configured.api_base_url,
      provider_verified: true,
      can_authenticate: true,
      authenticated_login: requireAuthenticatedLogin(result.data, getToken(env)),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      token_configured: true,
      credential_present: true,
      api_base_url: configured.api_base_url,
      provider_verified: false,
      can_authenticate: false,
      provider_status: error instanceof GitHubApiError ? error.status : undefined,
      blocker: `GitHub identity verification failed: ${message}`,
    };
  }
}
