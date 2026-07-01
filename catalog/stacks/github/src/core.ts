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

export interface GitHubDependencies {
  env?: EnvLike;
  fetchImpl?: FetchLike;
}

export interface ConfigStatus {
  token_configured: boolean;
  api_base_url: string;
  can_authenticate: boolean;
  blocker?: string;
}

export interface PaginationLinks {
  first?: string;
  previous?: string;
  next?: string;
  last?: string;
}

interface ApiResult<T> {
  data: T;
  pagination: PaginationLinks;
}

interface RepoLocator {
  owner: string;
  repo: string;
}

type OwnerType = "authenticated" | "user" | "org";
type Direction = "asc" | "desc";

export const DEFAULT_API_BASE_URL = "https://api.github.com";
export const DEFAULT_API_VERSION = "2022-11-28";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MAX_PER_PAGE = 100;
export const MAX_BODY_LENGTH = 65_536;
export const MAX_TITLE_LENGTH = 256;

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const SAFE_TEXT_PATTERN = /^(?:[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f])+$/;

const REPO_VISIBILITIES = ["all", "public", "private"] as const;
const AUTH_REPO_TYPES = ["all", "owner", "public", "private", "member"] as const;
const USER_REPO_TYPES = ["all", "owner", "member"] as const;
const ORG_REPO_TYPES = [
  "all",
  "public",
  "private",
  "forks",
  "sources",
  "member",
  "internal",
] as const;
const REPO_SORTS = ["created", "updated", "pushed", "full_name"] as const;
const ISSUE_STATES = ["open", "closed", "all"] as const;
const ISSUE_SORTS = ["created", "updated", "comments"] as const;
const PULL_STATES = ["open", "closed", "all"] as const;
const PULL_SORTS = ["created", "updated", "popularity", "long-running"] as const;
const REST_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
const MERGE_METHODS = ["merge", "squash", "rebase"] as const;

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
    api_base_url: getApiBaseUrl(env),
    can_authenticate: Boolean(token),
    blocker: token ? undefined : "Set GITHUB_TOKEN in RUDI secrets.",
  };
}

function asRecord(args: ToolArgs): Record<string, unknown> {
  if (args === undefined || args === null) {
    return {};
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new Error("arguments must be an object");
  }
  return args;
}

function requireString(value: unknown, name: string, maxLength = 1_000): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty string`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${name} must be at most ${maxLength} characters`);
  }
  if (!SAFE_TEXT_PATTERN.test(trimmed)) {
    throw new Error(`${name} must not contain control characters`);
  }
  return trimmed;
}

function optionalString(
  value: unknown,
  name: string,
  maxLength = 1_000
): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requireString(value, name, maxLength);
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

function optionalNullBoolean(value: unknown, name: string): boolean | null | undefined {
  if (value === null) {
    return null;
  }
  return optionalBoolean(value, name);
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

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  const integer = optionalInteger(value, name);
  if (integer === undefined) {
    return undefined;
  }
  if (integer < 1) {
    throw new Error(`${name} must be at least 1`);
  }
  return integer;
}

function optionalPerPage(value: unknown): number | undefined {
  const perPage = optionalPositiveInteger(value, "per_page");
  if (perPage === undefined) {
    return undefined;
  }
  if (perPage > MAX_PER_PAGE) {
    throw new Error(`per_page must be between 1 and ${MAX_PER_PAGE}`);
  }
  return perPage;
}

function optionalStringArray(
  value: unknown,
  name: string,
  maxItems = 20,
  maxItemLength = 100
): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const rawItems = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(rawItems)) {
    throw new Error(`${name} must be an array of strings or a comma-separated string`);
  }
  if (rawItems.length > maxItems) {
    throw new Error(`${name} must contain at most ${maxItems} items`);
  }

  return rawItems
    .map((item, index) => requireString(item, `${name}[${index}]`, maxItemLength))
    .filter(Boolean);
}

function optionalEnum<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T | undefined {
  const text = optionalString(value, name, 100);
  if (text === undefined) {
    return undefined;
  }
  if (!allowed.includes(text as T)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return text as T;
}

function requireOwner(value: unknown, name = "owner"): string {
  const owner = requireString(value, name, 39);
  if (!OWNER_PATTERN.test(owner)) {
    throw new Error(`${name} must be a valid GitHub owner name`);
  }
  return owner;
}

function requireRepo(value: unknown): string {
  const repo = requireString(value, "repo", 100);
  if (!REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    throw new Error("repo must be a valid GitHub repository name");
  }
  return repo;
}

function requireRepoLocator(args: Record<string, unknown>): RepoLocator {
  return {
    owner: requireOwner(args.owner),
    repo: requireRepo(args.repo),
  };
}

function requireIssueNumber(value: unknown, name = "issue_number"): number {
  const number = optionalPositiveInteger(value, name);
  if (number === undefined) {
    throw new Error(`${name} must be an integer`);
  }
  return number;
}

function requireBody(value: unknown, name = "body"): string {
  const body = requireString(value, name, MAX_BODY_LENGTH);
  if (body.length > MAX_BODY_LENGTH) {
    throw new Error(`${name} must be at most ${MAX_BODY_LENGTH} characters`);
  }
  return body;
}

function optionalNullableString(
  value: unknown,
  name: string,
  maxLength = 1_000
): string | null | undefined {
  if (value === null) {
    return null;
  }
  return optionalString(value, name, maxLength);
}

function optionalBody(value: unknown, name = "body"): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requireBody(value, name);
}

function requireTitle(value: unknown): string {
  return requireString(value, "title", MAX_TITLE_LENGTH);
}

function requireRef(value: unknown, name: string): string {
  return requireString(value, name, 255);
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
  const base = getApiBaseUrl(env).replace(/\/+$/, "");
  const url = new URL(`${base}/`);
  if (url.protocol !== "https:") {
    throw new Error("GITHUB_API_BASE_URL must use https");
  }
  return url;
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

async function githubApiRequest<T>(
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
    "User-Agent": "rudi-github-stack/1.0",
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
    throw new Error(
      `GitHub API error ${response.status}: ${JSON.stringify(body, null, 2)}`
    );
  }

  return {
    data: parseJson(raw) as T,
    pagination: parseLinkHeader(response.headers?.get("link")),
  };
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value);
}

function repoPath({ owner, repo }: RepoLocator): string {
  return `/repos/${encodePathPart(owner)}/${encodePathPart(repo)}`;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null && item !== "") {
      result[key] = item;
    }
  }
  return result as T;
}

function compactObjectPreservingNull<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== "") {
      result[key] = item;
    }
  }
  return result as T;
}

function summarizeRepo(repo: Record<string, unknown>): Record<string, unknown> {
  const owner = repo.owner && typeof repo.owner === "object" ? repo.owner as Record<string, unknown> : {};
  return compactObject({
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    private: repo.private,
    html_url: repo.html_url,
    description: repo.description,
    default_branch: repo.default_branch,
    archived: repo.archived,
    fork: repo.fork,
    owner: owner.login,
    updated_at: repo.updated_at,
  });
}

function summarizePullRequest(pr: Record<string, unknown>): Record<string, unknown> {
  const user = pr.user && typeof pr.user === "object" ? pr.user as Record<string, unknown> : {};
  const head = pr.head && typeof pr.head === "object" ? pr.head as Record<string, unknown> : {};
  const base = pr.base && typeof pr.base === "object" ? pr.base as Record<string, unknown> : {};
  return compactObject({
    id: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    html_url: pr.html_url,
    user: user.login,
    head: head.ref,
    base: base.ref,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
    merged_at: pr.merged_at,
  });
}

function summarizeIssue(issue: Record<string, unknown>): Record<string, unknown> {
  const user = issue.user && typeof issue.user === "object" ? issue.user as Record<string, unknown> : {};
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label) =>
        label && typeof label === "object"
          ? (label as Record<string, unknown>).name
          : label
      )
    : undefined;
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.map((assignee) =>
        assignee && typeof assignee === "object"
          ? (assignee as Record<string, unknown>).login
          : assignee
      )
    : undefined;
  return compactObject({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    html_url: issue.html_url,
    user: user.login,
    labels,
    assignees,
    is_pull_request: Boolean(issue.pull_request),
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
  });
}

function summarizeComment(comment: Record<string, unknown>): Record<string, unknown> {
  const user = comment.user && typeof comment.user === "object" ? comment.user as Record<string, unknown> : {};
  return compactObject({
    id: comment.id,
    html_url: comment.html_url,
    user: user.login,
    body: comment.body,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  });
}

function summarizeCodeSearchItem(item: Record<string, unknown>): Record<string, unknown> {
  const repository = item.repository && typeof item.repository === "object"
    ? item.repository as Record<string, unknown>
    : {};
  return compactObject({
    name: item.name,
    path: item.path,
    sha: item.sha,
    html_url: item.html_url,
    url: item.url,
    repository: repository.full_name,
  });
}

function requireObjectArray(data: unknown, description: string): Record<string, unknown>[] {
  if (!Array.isArray(data)) {
    throw new Error(`GitHub API returned an unexpected ${description} payload`);
  }
  return data.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${description}[${index}] must be an object`);
    }
    return item as Record<string, unknown>;
  });
}

function requireObject(data: unknown, description: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`GitHub API returned an unexpected ${description} payload`);
  }
  return data as Record<string, unknown>;
}

function parseListReposArgs(args: ToolArgs) {
  const input = asRecord(args);
  const owner = optionalString(input.owner, "owner", 39);
  const ownerType = optionalEnum(input.owner_type, "owner_type", [
    "authenticated",
    "user",
    "org",
  ] as const) ?? (owner ? "user" : "authenticated");
  if (ownerType !== "authenticated" && !owner) {
    throw new Error("owner is required when owner_type is user or org");
  }
  if (ownerType === "authenticated" && owner) {
    throw new Error("owner must be omitted when owner_type is authenticated");
  }

  const affiliation = optionalStringArray(input.affiliation, "affiliation", 5);
  const visibility = optionalEnum(input.visibility, "visibility", REPO_VISIBILITIES);
  const sort = optionalEnum(input.sort, "sort", REPO_SORTS);
  const direction = optionalEnum(input.direction, "direction", ["asc", "desc"] as const);

  let type: string | undefined;
  if (ownerType === "authenticated") {
    type = optionalEnum(input.type, "type", AUTH_REPO_TYPES);
  } else if (ownerType === "org") {
    type = optionalEnum(input.type, "type", ORG_REPO_TYPES);
  } else {
    type = optionalEnum(input.type, "type", USER_REPO_TYPES);
  }

  if (owner) {
    requireOwner(owner);
  }
  if (ownerType === "authenticated" && type && (visibility || affiliation.length > 0)) {
    throw new Error("type cannot be combined with visibility or affiliation for authenticated repo listing");
  }

  return {
    owner,
    owner_type: ownerType as OwnerType,
    per_page: optionalPerPage(input.per_page),
    page: optionalPositiveInteger(input.page, "page"),
    visibility,
    affiliation,
    type,
    sort,
    direction,
  };
}

function repoListPath(ownerType: OwnerType, owner?: string): string {
  if (ownerType === "authenticated") {
    return "/user/repos";
  }
  const encodedOwner = encodePathPart(requireOwner(owner, "owner"));
  return ownerType === "org" ? `/orgs/${encodedOwner}/repos` : `/users/${encodedOwner}/repos`;
}

export async function listRepos(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseListReposArgs(args);
  const query: Record<string, unknown> = {
    per_page: input.per_page,
    page: input.page,
    type: input.type,
    sort: input.sort,
    direction: input.direction,
  };
  if (input.owner_type === "authenticated") {
    query.visibility = input.visibility;
    query.affiliation = input.affiliation.length ? input.affiliation.join(",") : undefined;
  }

  const result = await githubApiRequest<unknown[]>(
    repoListPath(input.owner_type, input.owner),
    { query },
    deps
  );

  return {
    repositories: requireObjectArray(result.data, "repositories").map(summarizeRepo),
    pagination: result.pagination,
  };
}

export async function getRepo(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const locator = requireRepoLocator(asRecord(args));
  const result = await githubApiRequest<Record<string, unknown>>(repoPath(locator), {}, deps);
  return { repository: requireObject(result.data, "repository") };
}

function requireRestPath(value: unknown): string {
  const path = requireString(value, "path", 2_000);
  if (!path.startsWith("/")) {
    throw new Error("path must start with / and be relative to the GitHub REST API base URL");
  }
  if (path.startsWith("//") || path.includes("://")) {
    throw new Error("path must be a relative GitHub REST API path");
  }
  return path;
}

function optionalQueryRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("query must be an object");
  }

  const query: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined || item === null || item === "") {
      continue;
    }
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      query[key] = item;
      continue;
    }
    if (
      Array.isArray(item) &&
      item.every(
        (arrayItem) =>
          typeof arrayItem === "string" ||
          typeof arrayItem === "number" ||
          typeof arrayItem === "boolean"
      )
    ) {
      query[key] = item;
      continue;
    }
    throw new Error(`query.${key} must be a string, number, boolean, or array of primitives`);
  }
  return query;
}

function optionalBodyRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("body must be an object");
  }
  return value as Record<string, unknown>;
}

export async function githubRestRequest(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const method = optionalEnum(input.method, "method", REST_METHODS) ?? "GET";
  const path = requireRestPath(input.path);
  const query = optionalQueryRecord(input.query);
  const body = optionalBodyRecord(input.body);
  const confirmWrite = optionalBoolean(input.confirm_write, "confirm_write") ?? false;
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;
  const isRead = method === "GET" || method === "HEAD";

  if (!isRead && !confirmWrite) {
    return {
      dry_run: true,
      would_request: compactObject({ method, path, query, body }),
      confirmation_required:
        method === "DELETE"
          ? "Pass confirm_write: true and confirm_delete: true to execute this DELETE request."
          : "Pass confirm_write: true to execute this mutating GitHub REST request.",
    };
  }
  if (method === "DELETE" && !confirmDelete) {
    return {
      dry_run: true,
      would_request: compactObject({ method, path, query, body }),
      confirmation_required:
        "Pass confirm_delete: true with confirm_write: true to execute this DELETE request.",
    };
  }

  const result = await githubApiRequest<unknown>(
    path,
    { method, query, body },
    deps
  );
  return {
    status: "ok",
    response: result.data,
    pagination: result.pagination,
  };
}

function parseCreateRepoArgs(args: ToolArgs) {
  const input = asRecord(args);
  const org = optionalString(input.org, "org", 39);
  if (org) {
    requireOwner(org, "org");
  }
  return {
    org,
    name: requireRepo(input.name),
    description: optionalString(input.description, "description", 500),
    homepage: optionalString(input.homepage, "homepage", 500),
    private: optionalBoolean(input.private, "private"),
    visibility: optionalEnum(input.visibility, "visibility", ["public", "private", "internal"] as const),
    has_issues: optionalBoolean(input.has_issues, "has_issues"),
    has_projects: optionalBoolean(input.has_projects, "has_projects"),
    has_wiki: optionalBoolean(input.has_wiki, "has_wiki"),
    auto_init: optionalBoolean(input.auto_init, "auto_init"),
    gitignore_template: optionalString(input.gitignore_template, "gitignore_template", 100),
    license_template: optionalString(input.license_template, "license_template", 100),
    allow_squash_merge: optionalBoolean(input.allow_squash_merge, "allow_squash_merge"),
    allow_merge_commit: optionalBoolean(input.allow_merge_commit, "allow_merge_commit"),
    allow_rebase_merge: optionalBoolean(input.allow_rebase_merge, "allow_rebase_merge"),
    allow_auto_merge: optionalBoolean(input.allow_auto_merge, "allow_auto_merge"),
    delete_branch_on_merge: optionalBoolean(input.delete_branch_on_merge, "delete_branch_on_merge"),
    confirm_create: optionalBoolean(input.confirm_create, "confirm_create") ?? false,
  };
}

export async function createRepo(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseCreateRepoArgs(args);
  const payload = compactObject({
    name: input.name,
    description: input.description,
    homepage: input.homepage,
    private: input.private,
    visibility: input.visibility,
    has_issues: input.has_issues,
    has_projects: input.has_projects,
    has_wiki: input.has_wiki,
    auto_init: input.auto_init,
    gitignore_template: input.gitignore_template,
    license_template: input.license_template,
    allow_squash_merge: input.allow_squash_merge,
    allow_merge_commit: input.allow_merge_commit,
    allow_rebase_merge: input.allow_rebase_merge,
    allow_auto_merge: input.allow_auto_merge,
    delete_branch_on_merge: input.delete_branch_on_merge,
  });
  const path = input.org ? `/orgs/${encodePathPart(input.org)}/repos` : "/user/repos";

  if (!input.confirm_create) {
    return {
      dry_run: true,
      would_create: {
        scope: input.org ? "organization" : "authenticated_user",
        org: input.org,
        ...payload,
      },
      confirmation_required: "Pass confirm_create: true to create the repository.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    path,
    { method: "POST", body: payload },
    deps
  );
  return { repository: summarizeRepo(requireObject(result.data, "repository")) };
}

function parseSearchCodeArgs(args: ToolArgs) {
  const input = asRecord(args);
  const query = requireString(input.query, "query", 1_000);
  const owner = optionalString(input.owner, "owner", 39);
  const repo = optionalString(input.repo, "repo", 100);
  if (owner) {
    requireOwner(owner);
  }
  if (repo) {
    if (!owner) {
      throw new Error("owner is required when repo is provided");
    }
    requireRepo(repo);
  }

  return {
    query,
    owner,
    repo,
    language: optionalString(input.language, "language", 80),
    path: optionalString(input.path, "path", 300),
    extension: optionalString(input.extension, "extension", 40),
    filename: optionalString(input.filename, "filename", 120),
    per_page: optionalPerPage(input.per_page),
    page: optionalPositiveInteger(input.page, "page"),
  };
}

export async function searchCode(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseSearchCodeArgs(args);
  const queryParts = [input.query];
  if (input.owner && input.repo) {
    queryParts.push(`repo:${input.owner}/${input.repo}`);
  } else if (input.owner) {
    queryParts.push(`user:${input.owner}`);
  }
  if (input.language) queryParts.push(`language:${input.language}`);
  if (input.path) queryParts.push(`path:${input.path}`);
  if (input.extension) queryParts.push(`extension:${input.extension}`);
  if (input.filename) queryParts.push(`filename:${input.filename}`);

  const result = await githubApiRequest<Record<string, unknown>>(
    "/search/code",
    {
      query: {
        q: queryParts.join(" "),
        per_page: input.per_page,
        page: input.page,
      },
    },
    deps
  );
  const data = requireObject(result.data, "code search");
  const items = requireObjectArray(data.items ?? [], "code search items");

  return {
    total_count: data.total_count,
    incomplete_results: data.incomplete_results,
    items: items.map(summarizeCodeSearchItem),
    pagination: result.pagination,
  };
}

function parseListPullsArgs(args: ToolArgs) {
  const input = asRecord(args);
  return {
    ...requireRepoLocator(input),
    state: optionalEnum(input.state, "state", PULL_STATES),
    head: optionalString(input.head, "head", 255),
    base: optionalString(input.base, "base", 255),
    sort: optionalEnum(input.sort, "sort", PULL_SORTS),
    direction: optionalEnum(input.direction, "direction", ["asc", "desc"] as const),
    per_page: optionalPerPage(input.per_page),
    page: optionalPositiveInteger(input.page, "page"),
  };
}

export async function listPullRequests(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseListPullsArgs(args);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(input)}/pulls`,
    {
      query: {
        state: input.state,
        head: input.head,
        base: input.base,
        sort: input.sort,
        direction: input.direction,
        per_page: input.per_page,
        page: input.page,
      },
    },
    deps
  );

  return {
    pull_requests: requireObjectArray(result.data, "pull requests").map(summarizePullRequest),
    pagination: result.pagination,
  };
}

export async function getPullRequest(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/pulls/${pullNumber}`,
    {},
    deps
  );
  return { pull_request: requireObject(result.data, "pull request") };
}

function parseCreatePullRequestArgs(args: ToolArgs) {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  return {
    ...locator,
    title: requireTitle(input.title),
    head: requireRef(input.head, "head"),
    base: requireRef(input.base, "base"),
    body: optionalBody(input.body),
    draft: optionalBoolean(input.draft, "draft"),
    maintainer_can_modify: optionalBoolean(
      input.maintainer_can_modify,
      "maintainer_can_modify"
    ),
    confirm_create: optionalBoolean(input.confirm_create, "confirm_create") ?? false,
  };
}

export async function createPullRequest(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseCreatePullRequestArgs(args);
  const payload = compactObject({
    title: input.title,
    head: input.head,
    base: input.base,
    body: input.body,
    draft: input.draft,
    maintainer_can_modify: input.maintainer_can_modify,
  });

  if (!input.confirm_create) {
    return {
      dry_run: true,
      would_create: {
        owner: input.owner,
        repo: input.repo,
        ...payload,
      },
      confirmation_required: "Pass confirm_create: true to create the pull request.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(input)}/pulls`,
    { method: "POST", body: payload },
    deps
  );
  return { pull_request: summarizePullRequest(requireObject(result.data, "pull request")) };
}

function parseMergePullRequestArgs(args: ToolArgs) {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  return {
    ...locator,
    pull_number: requireIssueNumber(input.pull_number ?? input.number, "pull_number"),
    commit_title: optionalString(input.commit_title, "commit_title", 256),
    commit_message: optionalBody(input.commit_message, "commit_message"),
    sha: optionalString(input.sha, "sha", 100),
    merge_method: optionalEnum(input.merge_method, "merge_method", MERGE_METHODS),
    confirm_merge: optionalBoolean(input.confirm_merge, "confirm_merge") ?? false,
  };
}

export async function mergePullRequest(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseMergePullRequestArgs(args);
  const payload = compactObject({
    commit_title: input.commit_title,
    commit_message: input.commit_message,
    sha: input.sha,
    merge_method: input.merge_method,
  });

  if (!input.confirm_merge) {
    return {
      dry_run: true,
      would_merge: {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pull_number,
        ...payload,
      },
      confirmation_required: "Pass confirm_merge: true to merge the pull request.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(input)}/pulls/${input.pull_number}/merge`,
    { method: "PUT", body: payload },
    deps
  );
  return { merge: requireObject(result.data, "pull request merge") };
}

function requireRepoContentPath(value: unknown): string {
  const filePath = requireString(value, "path", 1_000);
  const segments = filePath.split("/");
  if (filePath.startsWith("/") || segments.some((segment) => segment === ".." || segment === "")) {
    throw new Error("path must be a repository-relative file path without empty or .. segments");
  }
  return filePath;
}

function requireFileContent(input: Record<string, unknown>): string {
  if (typeof input.content_base64 === "string" && input.content_base64.trim()) {
    const encoded = input.content_base64.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error("content_base64 must be valid base64 text");
    }
    return encoded;
  }

  if (typeof input.content !== "string") {
    throw new Error("content or content_base64 must be provided");
  }
  if (input.content.length > 1_000_000) {
    throw new Error("content must be at most 1000000 characters");
  }
  return Buffer.from(input.content, "utf8").toString("base64");
}

function parseCreateOrUpdateFileArgs(args: ToolArgs) {
  const input = asRecord(args);
  return {
    ...requireRepoLocator(input),
    path: requireRepoContentPath(input.path),
    message: requireString(input.message, "message", 256),
    content: requireFileContent(input),
    sha: optionalString(input.sha, "sha", 100),
    branch: optionalString(input.branch, "branch", 255),
    committer: optionalBodyRecord(input.committer),
    author: optionalBodyRecord(input.author),
    confirm_write: optionalBoolean(input.confirm_write, "confirm_write") ?? false,
  };
}

export async function createOrUpdateFile(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseCreateOrUpdateFileArgs(args);
  const payload = compactObject({
    message: input.message,
    content: input.content,
    sha: input.sha,
    branch: input.branch,
    committer: input.committer,
    author: input.author,
  });

  if (!input.confirm_write) {
    return {
      dry_run: true,
      would_write: {
        owner: input.owner,
        repo: input.repo,
        path: input.path,
        message: input.message,
        branch: input.branch,
        updating_existing_file: Boolean(input.sha),
      },
      confirmation_required: "Pass confirm_write: true to create or update the file.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(input)}/contents/${input.path.split("/").map(encodePathPart).join("/")}`,
    { method: "PUT", body: payload },
    deps
  );
  return { content_result: requireObject(result.data, "content write") };
}

function parseListIssuesArgs(args: ToolArgs) {
  const input = asRecord(args);
  return {
    ...requireRepoLocator(input),
    state: optionalEnum(input.state, "state", ISSUE_STATES),
    labels: optionalStringArray(input.labels, "labels", 50),
    assignee: optionalString(input.assignee, "assignee", 100),
    milestone: optionalString(input.milestone, "milestone", 100),
    since: optionalString(input.since, "since", 80),
    sort: optionalEnum(input.sort, "sort", ISSUE_SORTS),
    direction: optionalEnum(input.direction, "direction", ["asc", "desc"] as const),
    include_pull_requests: optionalBoolean(
      input.include_pull_requests,
      "include_pull_requests"
    ) ?? false,
    per_page: optionalPerPage(input.per_page),
    page: optionalPositiveInteger(input.page, "page"),
  };
}

export async function listIssues(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseListIssuesArgs(args);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(input)}/issues`,
    {
      query: {
        state: input.state,
        labels: input.labels.length ? input.labels.join(",") : undefined,
        assignee: input.assignee,
        milestone: input.milestone,
        since: input.since,
        sort: input.sort,
        direction: input.direction,
        per_page: input.per_page,
        page: input.page,
      },
    },
    deps
  );

  const issues = requireObjectArray(result.data, "issues")
    .filter((issue) => input.include_pull_requests || !issue.pull_request)
    .map(summarizeIssue);

  return {
    issues,
    pagination: result.pagination,
  };
}

export async function getIssue(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/issues/${issueNumber}`,
    {},
    deps
  );
  return { issue: requireObject(result.data, "issue") };
}

function parseCreateIssueArgs(args: ToolArgs) {
  const input = asRecord(args);
  return {
    ...requireRepoLocator(input),
    title: requireTitle(input.title),
    body: optionalBody(input.body),
    labels: optionalStringArray(input.labels, "labels", 50),
    assignees: optionalStringArray(input.assignees, "assignees", 20, 39).map((assignee) =>
      requireOwner(assignee, "assignees[]")
    ),
    milestone: optionalPositiveInteger(input.milestone, "milestone"),
    confirm_create: optionalBoolean(input.confirm_create, "confirm_create") ?? false,
  };
}

export async function createIssue(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseCreateIssueArgs(args);
  const payload = compactObject({
    title: input.title,
    body: input.body,
    labels: input.labels.length ? input.labels : undefined,
    assignees: input.assignees.length ? input.assignees : undefined,
    milestone: input.milestone,
  });

  if (!input.confirm_create) {
    return {
      dry_run: true,
      would_create: {
        owner: input.owner,
        repo: input.repo,
        ...payload,
      },
      confirmation_required: "Pass confirm_create: true to create the issue.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(input)}/issues`,
    { method: "POST", body: payload },
    deps
  );
  return { issue: summarizeIssue(requireObject(result.data, "issue")) };
}

function parseAddCommentArgs(args: ToolArgs) {
  const input = asRecord(args);
  return {
    ...requireRepoLocator(input),
    issue_number: requireIssueNumber(input.issue_number ?? input.number),
    body: requireBody(input.body),
    confirm_create: optionalBoolean(input.confirm_create, "confirm_create") ?? false,
  };
}

export async function addComment(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = parseAddCommentArgs(args);
  const payload = { body: input.body };

  if (!input.confirm_create) {
    return {
      dry_run: true,
      would_create: {
        owner: input.owner,
        repo: input.repo,
        issue_number: input.issue_number,
        ...payload,
      },
      confirmation_required: "Pass confirm_create: true to add the comment.",
    };
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(input)}/issues/${input.issue_number}/comments`,
    { method: "POST", body: payload },
    deps
  );
  return { comment: summarizeComment(requireObject(result.data, "comment")) };
}

function requireConfirmation(value: boolean, message: string): boolean {
  return value || false;
}

function confirmationRequired(
  key: string,
  payload: Record<string, unknown>,
  message: string
): Record<string, unknown> {
  return {
    dry_run: true,
    [key]: payload,
    confirmation_required: message,
  };
}

function requireUsername(value: unknown, name = "username"): string {
  return requireOwner(value, name);
}

function optionalRawObjectArray(
  value: unknown,
  name: string,
  maxItems = 100
): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of objects`);
  }
  if (value.length > maxItems) {
    throw new Error(`${name} must contain at most ${maxItems} items`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${name}[${index}] must be an object`);
    }
    return item as Record<string, unknown>;
  });
}

function encodeRepoContentPath(pathValue: string): string {
  return pathValue.split("/").map(encodePathPart).join("/");
}

function summarizeSimple(data: unknown, description: string): Record<string, unknown> {
  return requireObject(data, description);
}

function requireLabelColor(value: unknown, name = "color"): string {
  const color = requireString(value, name, 7).replace(/^#/, "");
  if (!/^[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error(`${name} must be a 6-character hex color`);
  }
  return color;
}

function optionalLabelColor(value: unknown, name = "color"): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requireLabelColor(value, name);
}

export async function updateRepo(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const payload = compactObjectPreservingNull({
    name: optionalString(input.name, "name", 100),
    description: optionalNullableString(input.description, "description", 500),
    homepage: optionalNullableString(input.homepage, "homepage", 500),
    private: optionalBoolean(input.private, "private"),
    visibility: optionalEnum(input.visibility, "visibility", ["public", "private", "internal"] as const),
    has_issues: optionalBoolean(input.has_issues, "has_issues"),
    has_projects: optionalBoolean(input.has_projects, "has_projects"),
    has_wiki: optionalBoolean(input.has_wiki, "has_wiki"),
    has_discussions: optionalBoolean(input.has_discussions, "has_discussions"),
    default_branch: optionalString(input.default_branch, "default_branch", 255),
    archived: optionalBoolean(input.archived, "archived"),
    allow_squash_merge: optionalBoolean(input.allow_squash_merge, "allow_squash_merge"),
    allow_merge_commit: optionalBoolean(input.allow_merge_commit, "allow_merge_commit"),
    allow_rebase_merge: optionalBoolean(input.allow_rebase_merge, "allow_rebase_merge"),
    allow_auto_merge: optionalBoolean(input.allow_auto_merge, "allow_auto_merge"),
    delete_branch_on_merge: optionalBoolean(input.delete_branch_on_merge, "delete_branch_on_merge"),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!requireConfirmation(confirmUpdate, "confirm_update")) {
    return confirmationRequired(
      "would_update",
      { ...locator, ...payload },
      "Pass confirm_update: true to update the repository."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    repoPath(locator),
    { method: "PATCH", body: payload },
    deps
  );
  return { repository: summarizeRepo(requireObject(result.data, "repository")) };
}

export async function deleteRepo(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator },
      "Pass confirm_delete: true to permanently delete the repository."
    );
  }

  const result = await githubApiRequest<unknown>(
    repoPath(locator),
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

export async function listBranches(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/branches`,
    {
      query: {
        protected: optionalBoolean(input.protected, "protected"),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    branches: requireObjectArray(result.data, "branches"),
    pagination: result.pagination,
  };
}

export async function getBranch(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const branch = requireRef(input.branch, "branch");
  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/branches/${encodePathPart(branch)}`,
    {},
    deps
  );
  return { branch: requireObject(result.data, "branch") };
}

export async function createBranch(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const branch = requireRef(input.branch, "branch");
  let sha = optionalString(input.source_sha, "source_sha", 100);
  const sourceBranch = optionalString(input.source_branch, "source_branch", 255);
  const confirmCreate = optionalBoolean(input.confirm_create, "confirm_create") ?? false;

  if (!sha && !sourceBranch) {
    throw new Error("source_sha or source_branch must be provided");
  }

  if (!confirmCreate) {
    return confirmationRequired(
      "would_create",
      { ...locator, branch, source_sha: sha, source_branch: sourceBranch },
      "Pass confirm_create: true to create the branch."
    );
  }

  if (!sha && sourceBranch) {
    const branchResult = await githubApiRequest<Record<string, unknown>>(
      `${repoPath(locator)}/branches/${encodePathPart(sourceBranch)}`,
      {},
      deps
    );
    const branchData = requireObject(branchResult.data, "source branch");
    const commit = requireObject(branchData.commit, "source branch commit");
    sha = requireString(commit.sha, "source_branch.commit.sha", 100);
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/git/refs`,
    {
      method: "POST",
      body: {
        ref: `refs/heads/${branch}`,
        sha,
      },
    },
    deps
  );
  return { ref: requireObject(result.data, "git ref") };
}

export async function deleteBranch(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const branch = requireRef(input.branch, "branch");
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, branch },
      "Pass confirm_delete: true to delete the branch reference."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/git/refs/heads/${encodePathPart(branch)}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

export async function getFile(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pathValue = requireRepoContentPath(input.path);
  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/contents/${encodeRepoContentPath(pathValue)}`,
    {
      query: {
        ref: optionalString(input.ref, "ref", 255),
      },
    },
    deps
  );
  return { content: result.data };
}

export async function deleteFile(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pathValue = requireRepoContentPath(input.path);
  const payload = compactObject({
    message: requireString(input.message, "message", 256),
    sha: requireString(input.sha, "sha", 100),
    branch: optionalString(input.branch, "branch", 255),
    committer: optionalBodyRecord(input.committer),
    author: optionalBodyRecord(input.author),
  });
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, path: pathValue, message: payload.message, branch: payload.branch },
      "Pass confirm_delete: true to delete the file."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/contents/${encodeRepoContentPath(pathValue)}`,
    { method: "DELETE", body: payload },
    deps
  );
  return { content_result: requireObject(result.data, "content delete") };
}

export async function listCollaborators(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/collaborators`,
    {
      query: {
        affiliation: optionalEnum(input.affiliation, "affiliation", ["outside", "direct", "all"] as const),
        permission: optionalString(input.permission, "permission", 100),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    collaborators: requireObjectArray(result.data, "collaborators"),
    pagination: result.pagination,
  };
}

export async function addCollaborator(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const username = requireUsername(input.username);
  const permission = optionalString(input.permission, "permission", 100);
  const confirmWrite = optionalBoolean(input.confirm_write, "confirm_write") ?? false;

  if (!confirmWrite) {
    return confirmationRequired(
      "would_add",
      { ...locator, username, permission },
      "Pass confirm_write: true to add the collaborator."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/collaborators/${encodePathPart(username)}`,
    { method: "PUT", body: compactObject({ permission }) },
    deps
  );
  return { collaborator: result.data };
}

export async function removeCollaborator(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const username = requireUsername(input.username);
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_remove",
      { ...locator, username },
      "Pass confirm_delete: true to remove the collaborator."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/collaborators/${encodePathPart(username)}`,
    { method: "DELETE" },
    deps
  );
  return { removed: true, response: result.data };
}

export async function updateIssue(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const payload = compactObjectPreservingNull({
    title: optionalString(input.title, "title", MAX_TITLE_LENGTH),
    body: optionalNullableString(input.body, "body", MAX_BODY_LENGTH),
    state: optionalEnum(input.state, "state", ["open", "closed"] as const),
    state_reason: optionalEnum(input.state_reason, "state_reason", ["completed", "not_planned", "reopened"] as const),
    milestone: input.milestone === null ? null : optionalPositiveInteger(input.milestone, "milestone"),
    labels: input.labels === null ? null : optionalStringArray(input.labels, "labels", 50),
    assignees: input.assignees === null ? null : optionalStringArray(input.assignees, "assignees", 20, 39),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, issue_number: issueNumber, ...payload },
      "Pass confirm_update: true to update the issue."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/issues/${issueNumber}`,
    { method: "PATCH", body: payload },
    deps
  );
  return { issue: summarizeIssue(requireObject(result.data, "issue")) };
}

export async function listComments(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/issues/${issueNumber}/comments`,
    {
      query: {
        since: optionalString(input.since, "since", 80),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    comments: requireObjectArray(result.data, "comments").map(summarizeComment),
    pagination: result.pagination,
  };
}

export async function updateComment(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const commentId = requireIssueNumber(input.comment_id, "comment_id");
  const body = requireBody(input.body);
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, comment_id: commentId, body },
      "Pass confirm_update: true to update the comment."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/issues/comments/${commentId}`,
    { method: "PATCH", body: { body } },
    deps
  );
  return { comment: summarizeComment(requireObject(result.data, "comment")) };
}

export async function deleteComment(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const commentId = requireIssueNumber(input.comment_id, "comment_id");
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, comment_id: commentId },
      "Pass confirm_delete: true to delete the comment."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/issues/comments/${commentId}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

export async function listLabels(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/labels`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    labels: requireObjectArray(result.data, "labels"),
    pagination: result.pagination,
  };
}

export async function createLabel(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const payload = compactObject({
    name: requireString(input.name, "name", 100),
    color: requireLabelColor(input.color),
    description: optionalString(input.description, "description", 100),
  });
  const confirmCreate = optionalBoolean(input.confirm_create, "confirm_create") ?? false;

  if (!confirmCreate) {
    return confirmationRequired(
      "would_create",
      { ...locator, ...payload },
      "Pass confirm_create: true to create the label."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/labels`,
    { method: "POST", body: payload },
    deps
  );
  return { label: requireObject(result.data, "label") };
}

export async function updateLabel(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const name = requireString(input.name, "name", 100);
  const payload = compactObjectPreservingNull({
    new_name: optionalString(input.new_name, "new_name", 100),
    color: optionalLabelColor(input.color),
    description: optionalNullableString(input.description, "description", 100),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, name, ...payload },
      "Pass confirm_update: true to update the label."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/labels/${encodePathPart(name)}`,
    { method: "PATCH", body: payload },
    deps
  );
  return { label: requireObject(result.data, "label") };
}

export async function deleteLabel(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const name = requireString(input.name, "name", 100);
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, name },
      "Pass confirm_delete: true to delete the label."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/labels/${encodePathPart(name)}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

export async function addIssueLabels(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const labels = optionalStringArray(input.labels, "labels", 50);
  if (labels.length === 0) throw new Error("labels must contain at least one label");
  const confirmWrite = optionalBoolean(input.confirm_write, "confirm_write") ?? false;

  if (!confirmWrite) {
    return confirmationRequired(
      "would_add",
      { ...locator, issue_number: issueNumber, labels },
      "Pass confirm_write: true to add labels to the issue."
    );
  }

  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/issues/${issueNumber}/labels`,
    { method: "POST", body: { labels } },
    deps
  );
  return { labels: requireObjectArray(result.data, "issue labels") };
}

export async function setIssueLabels(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const labels = optionalStringArray(input.labels, "labels", 50);
  const confirmWrite = optionalBoolean(input.confirm_write, "confirm_write") ?? false;

  if (!confirmWrite) {
    return confirmationRequired(
      "would_set",
      { ...locator, issue_number: issueNumber, labels },
      "Pass confirm_write: true to replace the issue labels."
    );
  }

  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/issues/${issueNumber}/labels`,
    { method: "PUT", body: { labels } },
    deps
  );
  return { labels: requireObjectArray(result.data, "issue labels") };
}

export async function removeIssueLabel(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const issueNumber = requireIssueNumber(input.issue_number ?? input.number);
  const name = requireString(input.name, "name", 100);
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_remove",
      { ...locator, issue_number: issueNumber, name },
      "Pass confirm_delete: true to remove the label from the issue."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/issues/${issueNumber}/labels/${encodePathPart(name)}`,
    { method: "DELETE" },
    deps
  );
  return { labels: result.data };
}

export async function listMilestones(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/milestones`,
    {
      query: {
        state: optionalEnum(input.state, "state", ["open", "closed", "all"] as const),
        sort: optionalEnum(input.sort, "sort", ["due_on", "completeness"] as const),
        direction: optionalEnum(input.direction, "direction", ["asc", "desc"] as const),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    milestones: requireObjectArray(result.data, "milestones"),
    pagination: result.pagination,
  };
}

export async function createMilestone(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const payload = compactObject({
    title: requireTitle(input.title),
    state: optionalEnum(input.state, "state", ["open", "closed"] as const),
    description: optionalString(input.description, "description", 1_000),
    due_on: optionalString(input.due_on, "due_on", 80),
  });
  const confirmCreate = optionalBoolean(input.confirm_create, "confirm_create") ?? false;

  if (!confirmCreate) {
    return confirmationRequired(
      "would_create",
      { ...locator, ...payload },
      "Pass confirm_create: true to create the milestone."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/milestones`,
    { method: "POST", body: payload },
    deps
  );
  return { milestone: requireObject(result.data, "milestone") };
}

export async function updateMilestone(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const milestoneNumber = requireIssueNumber(input.milestone_number ?? input.number, "milestone_number");
  const payload = compactObjectPreservingNull({
    title: optionalString(input.title, "title", MAX_TITLE_LENGTH),
    state: optionalEnum(input.state, "state", ["open", "closed"] as const),
    description: optionalNullableString(input.description, "description", 1_000),
    due_on: optionalNullableString(input.due_on, "due_on", 80),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, milestone_number: milestoneNumber, ...payload },
      "Pass confirm_update: true to update the milestone."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/milestones/${milestoneNumber}`,
    { method: "PATCH", body: payload },
    deps
  );
  return { milestone: requireObject(result.data, "milestone") };
}

export async function deleteMilestone(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const milestoneNumber = requireIssueNumber(input.milestone_number ?? input.number, "milestone_number");
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, milestone_number: milestoneNumber },
      "Pass confirm_delete: true to delete the milestone."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/milestones/${milestoneNumber}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

export async function updatePullRequest(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const payload = compactObjectPreservingNull({
    title: optionalString(input.title, "title", MAX_TITLE_LENGTH),
    body: optionalNullableString(input.body, "body", MAX_BODY_LENGTH),
    state: optionalEnum(input.state, "state", ["open", "closed"] as const),
    base: optionalString(input.base, "base", 255),
    maintainer_can_modify: optionalBoolean(input.maintainer_can_modify, "maintainer_can_modify"),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, pull_number: pullNumber, ...payload },
      "Pass confirm_update: true to update the pull request."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/pulls/${pullNumber}`,
    { method: "PATCH", body: payload },
    deps
  );
  return { pull_request: summarizePullRequest(requireObject(result.data, "pull request")) };
}

export async function listPullRequestFiles(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/pulls/${pullNumber}/files`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    files: requireObjectArray(result.data, "pull request files"),
    pagination: result.pagination,
  };
}

export async function listPullRequestCommits(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/pulls/${pullNumber}/commits`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    commits: requireObjectArray(result.data, "pull request commits"),
    pagination: result.pagination,
  };
}

export async function listPullRequestReviews(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/pulls/${pullNumber}/reviews`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    reviews: requireObjectArray(result.data, "pull request reviews"),
    pagination: result.pagination,
  };
}

export async function createPullRequestReview(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const payload = compactObject({
    commit_id: optionalString(input.commit_id, "commit_id", 100),
    body: optionalBody(input.body),
    event: optionalEnum(input.event, "event", ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const),
    comments: optionalRawObjectArray(input.comments, "comments", 100),
  });
  const confirmCreate = optionalBoolean(input.confirm_create, "confirm_create") ?? false;

  if (!confirmCreate) {
    return confirmationRequired(
      "would_create",
      { ...locator, pull_number: pullNumber, ...payload },
      "Pass confirm_create: true to create the pull request review."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/pulls/${pullNumber}/reviews`,
    { method: "POST", body: payload },
    deps
  );
  return { review: requireObject(result.data, "pull request review") };
}

export async function requestPullRequestReviewers(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const payload = compactObject({
    reviewers: optionalStringArray(input.reviewers, "reviewers", 100, 39),
    team_reviewers: optionalStringArray(input.team_reviewers, "team_reviewers", 100, 100),
  });
  const confirmWrite = optionalBoolean(input.confirm_write, "confirm_write") ?? false;

  if (!confirmWrite) {
    return confirmationRequired(
      "would_request",
      { ...locator, pull_number: pullNumber, ...payload },
      "Pass confirm_write: true to request pull request reviewers."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/pulls/${pullNumber}/requested_reviewers`,
    { method: "POST", body: payload },
    deps
  );
  return { pull_request: requireObject(result.data, "pull request") };
}

export async function removePullRequestReviewers(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const pullNumber = requireIssueNumber(input.pull_number ?? input.number, "pull_number");
  const payload = compactObject({
    reviewers: optionalStringArray(input.reviewers, "reviewers", 100, 39),
    team_reviewers: optionalStringArray(input.team_reviewers, "team_reviewers", 100, 100),
  });
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_remove",
      { ...locator, pull_number: pullNumber, ...payload },
      "Pass confirm_delete: true to remove pull request reviewers."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/pulls/${pullNumber}/requested_reviewers`,
    { method: "DELETE", body: payload },
    deps
  );
  return { pull_request: requireObject(result.data, "pull request") };
}

export async function listReleases(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<unknown[]>(
    `${repoPath(locator)}/releases`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return {
    releases: requireObjectArray(result.data, "releases"),
    pagination: result.pagination,
  };
}

export async function getRelease(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const releaseId = optionalPositiveInteger(input.release_id, "release_id");
  const tag = optionalString(input.tag, "tag", 255);
  if (!releaseId && !tag) throw new Error("release_id or tag must be provided");
  const path = releaseId
    ? `${repoPath(locator)}/releases/${releaseId}`
    : `${repoPath(locator)}/releases/tags/${encodePathPart(tag as string)}`;
  const result = await githubApiRequest<Record<string, unknown>>(path, {}, deps);
  return { release: requireObject(result.data, "release") };
}

export async function createRelease(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const payload = compactObject({
    tag_name: requireString(input.tag_name, "tag_name", 255),
    target_commitish: optionalString(input.target_commitish, "target_commitish", 255),
    name: optionalString(input.name, "name", 255),
    body: optionalBody(input.body),
    draft: optionalBoolean(input.draft, "draft"),
    prerelease: optionalBoolean(input.prerelease, "prerelease"),
    generate_release_notes: optionalBoolean(input.generate_release_notes, "generate_release_notes"),
  });
  const confirmCreate = optionalBoolean(input.confirm_create, "confirm_create") ?? false;

  if (!confirmCreate) {
    return confirmationRequired(
      "would_create",
      { ...locator, ...payload },
      "Pass confirm_create: true to create the release."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/releases`,
    { method: "POST", body: payload },
    deps
  );
  return { release: requireObject(result.data, "release") };
}

export async function updateRelease(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const releaseId = requireIssueNumber(input.release_id, "release_id");
  const payload = compactObjectPreservingNull({
    tag_name: optionalString(input.tag_name, "tag_name", 255),
    target_commitish: optionalString(input.target_commitish, "target_commitish", 255),
    name: optionalNullableString(input.name, "name", 255),
    body: optionalNullableString(input.body, "body", MAX_BODY_LENGTH),
    draft: optionalBoolean(input.draft, "draft"),
    prerelease: optionalBoolean(input.prerelease, "prerelease"),
    make_latest: optionalString(input.make_latest, "make_latest", 40),
  });
  const confirmUpdate = optionalBoolean(input.confirm_update, "confirm_update") ?? false;

  if (!confirmUpdate) {
    return confirmationRequired(
      "would_update",
      { ...locator, release_id: releaseId, ...payload },
      "Pass confirm_update: true to update the release."
    );
  }

  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/releases/${releaseId}`,
    { method: "PATCH", body: payload },
    deps
  );
  return { release: requireObject(result.data, "release") };
}

export async function deleteRelease(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const releaseId = requireIssueNumber(input.release_id, "release_id");
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, release_id: releaseId },
      "Pass confirm_delete: true to delete the release."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/releases/${releaseId}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}

function requireWorkflowId(value: unknown): string | number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return requireString(value, "workflow_id", 255);
}

export async function listWorkflows(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/actions/workflows`,
    {
      query: {
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return { workflows: requireObject(result.data, "workflows"), pagination: result.pagination };
}

export async function dispatchWorkflow(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const workflowId = requireWorkflowId(input.workflow_id);
  const payload = compactObject({
    ref: requireRef(input.ref, "ref"),
    inputs: optionalBodyRecord(input.inputs),
  });
  const confirmDispatch = optionalBoolean(input.confirm_dispatch, "confirm_dispatch") ?? false;

  if (!confirmDispatch) {
    return confirmationRequired(
      "would_dispatch",
      { ...locator, workflow_id: workflowId, ...payload },
      "Pass confirm_dispatch: true to dispatch the workflow."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/actions/workflows/${encodePathPart(String(workflowId))}/dispatches`,
    { method: "POST", body: payload },
    deps
  );
  return { dispatched: true, response: result.data };
}

export async function listWorkflowRuns(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const workflowId = input.workflow_id === undefined ? undefined : requireWorkflowId(input.workflow_id);
  const path = workflowId
    ? `${repoPath(locator)}/actions/workflows/${encodePathPart(String(workflowId))}/runs`
    : `${repoPath(locator)}/actions/runs`;
  const result = await githubApiRequest<Record<string, unknown>>(
    path,
    {
      query: {
        actor: optionalString(input.actor, "actor", 100),
        branch: optionalString(input.branch, "branch", 255),
        event: optionalString(input.event, "event", 100),
        status: optionalString(input.status, "status", 100),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return { runs: requireObject(result.data, "workflow runs"), pagination: result.pagination };
}

export async function getWorkflowRun(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const runId = requireIssueNumber(input.run_id, "run_id");
  const result = await githubApiRequest<Record<string, unknown>>(
    `${repoPath(locator)}/actions/runs/${runId}`,
    {},
    deps
  );
  return { run: requireObject(result.data, "workflow run") };
}

export async function rerunWorkflowRun(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const runId = requireIssueNumber(input.run_id, "run_id");
  const confirmDispatch = optionalBoolean(input.confirm_dispatch, "confirm_dispatch") ?? false;

  if (!confirmDispatch) {
    return confirmationRequired(
      "would_rerun",
      { ...locator, run_id: runId },
      "Pass confirm_dispatch: true to rerun the workflow run."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/actions/runs/${runId}/rerun`,
    { method: "POST" },
    deps
  );
  return { rerun_requested: true, response: result.data };
}

export async function cancelWorkflowRun(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const runId = requireIssueNumber(input.run_id, "run_id");
  const confirmCancel = optionalBoolean(input.confirm_cancel, "confirm_cancel") ?? false;

  if (!confirmCancel) {
    return confirmationRequired(
      "would_cancel",
      { ...locator, run_id: runId },
      "Pass confirm_cancel: true to cancel the workflow run."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/actions/runs/${runId}/cancel`,
    { method: "POST" },
    deps
  );
  return { cancel_requested: true, response: result.data };
}

export async function listArtifacts(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const runId = optionalPositiveInteger(input.run_id, "run_id");
  const path = runId
    ? `${repoPath(locator)}/actions/runs/${runId}/artifacts`
    : `${repoPath(locator)}/actions/artifacts`;
  const result = await githubApiRequest<Record<string, unknown>>(
    path,
    {
      query: {
        name: optionalString(input.name, "name", 255),
        per_page: optionalPerPage(input.per_page),
        page: optionalPositiveInteger(input.page, "page"),
      },
    },
    deps
  );
  return { artifacts: requireObject(result.data, "artifacts"), pagination: result.pagination };
}

export async function deleteArtifact(
  args: ToolArgs = {},
  deps: GitHubDependencies = {}
): Promise<Record<string, unknown>> {
  const input = asRecord(args);
  const locator = requireRepoLocator(input);
  const artifactId = requireIssueNumber(input.artifact_id, "artifact_id");
  const confirmDelete = optionalBoolean(input.confirm_delete, "confirm_delete") ?? false;

  if (!confirmDelete) {
    return confirmationRequired(
      "would_delete",
      { ...locator, artifact_id: artifactId },
      "Pass confirm_delete: true to delete the artifact."
    );
  }

  const result = await githubApiRequest<unknown>(
    `${repoPath(locator)}/actions/artifacts/${artifactId}`,
    { method: "DELETE" },
    deps
  );
  return { deleted: true, response: result.data };
}
