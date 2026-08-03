#!/usr/bin/env node
/**
 * Zoho Mail MCP server.
 *
 * OAuth app credentials come from RUDI secrets or the stack state directory;
 * per-account OAuth tokens live under RUDI state, never in package source.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

type ToolArgs = Record<string, unknown>;

interface Credentials {
  client_id: string;
  client_secret: string;
}

interface ZohoToken {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  accounts_server: string;
  api_domain?: string;
  api_base: string;
  location?: string;
  scope?: string;
  account: string;
}

interface AuthContext {
  localAccount: string;
  token: ZohoToken;
}

interface ZohoStatus {
  code?: string | number;
  description?: string;
}

interface ZohoEnvelope<T = unknown> {
  status?: ZohoStatus;
  data?: T;
  [key: string]: unknown;
}

interface ZohoAccountRecord {
  accountId?: string | number;
  accountID?: string | number;
  accountKey?: string | number;
  id?: string | number;
  primaryEmailAddress?: string;
  emailAddress?: string;
  mailboxAddress?: string;
  fromAddress?: string;
  accountName?: string;
  displayName?: string;
  [key: string]: unknown;
}

interface MessageRecord {
  messageId?: string | number;
  folderId?: string | number;
  threadId?: string | number;
  subject?: string;
  summary?: string;
  fromAddress?: string;
  toAddress?: string;
  ccAddress?: string;
  sender?: string;
  receivedTime?: string | number;
  sentDateInGMT?: string | number;
  hasAttachment?: string | number;
  [key: string]: unknown;
}

interface ZohoUploadedAttachment {
  storeName: string;
  attachmentName: string;
  attachmentPath: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const STACK_DIR = join(__dirname, "..");
const RUDI_HOME = resolve(process.env.RUDI_HOME || join(homedir(), ".rudi"));
const STACK_STATE_DIR = resolve(
  process.env.ZOHO_MAIL_STATE_DIR || join(RUDI_HOME, "state", "stacks", "zoho-mail")
);
const ACCOUNTS_DIR = join(STACK_STATE_DIR, "accounts");
const CREDENTIALS_PATH = resolve(
  process.env.ZOHO_MAIL_CREDENTIALS_PATH || join(STACK_STATE_DIR, "credentials.json")
);
const STATE_FILE = join(STACK_STATE_DIR, "state.json");
const DEFAULT_OUTPUT_DIR = resolve(
  process.env.RUDI_OUTPUT_DIR || join(RUDI_HOME, "outputs")
);
const REQUEST_TIMEOUT_MS = 20_000;
const ATTACHMENT_PATHS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  description: "Optional absolute file paths to attach",
};

config({ path: join(STACK_DIR, ".env") });
mkdirSync(STACK_STATE_DIR, { recursive: true });
mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });

const server = new Server(
  { name: "zoho-mail", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJsonFile(path: string, value: unknown, mode?: number) {
  writeFileSync(path, JSON.stringify(value, null, 2), mode === undefined ? undefined : { mode });
  if (mode !== undefined) chmodSync(path, mode);
}

function loadCurrentAccount(): string | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    const state = readJsonFile<{ currentAccount?: unknown }>(STATE_FILE);
    if (
      typeof state.currentAccount === "string" &&
      existsSync(join(ACCOUNTS_DIR, state.currentAccount, "token.json"))
    ) {
      return state.currentAccount;
    }
  } catch {
    return null;
  }
  return null;
}

function saveCurrentAccount(account: string | null) {
  writeJsonFile(STATE_FILE, { currentAccount: account });
}

let currentAccount: string | null = loadCurrentAccount();

function getAvailableAccounts(): string[] {
  if (!existsSync(ACCOUNTS_DIR)) return [];
  return readdirSync(ACCOUNTS_DIR)
    .filter((name) => !name.startsWith("."))
    .filter((name) => existsSync(join(ACCOUNTS_DIR, name, "token.json")))
    .sort();
}

function resolveLocalAccount(account?: string): string {
  if (account) {
    const tokenPath = join(ACCOUNTS_DIR, account, "token.json");
    if (!existsSync(tokenPath)) {
      throw new Error(`Zoho account '${account}' is not configured. Run npm run auth first.`);
    }
    return account;
  }

  if (currentAccount && existsSync(join(ACCOUNTS_DIR, currentAccount, "token.json"))) {
    return currentAccount;
  }

  const accounts = getAvailableAccounts();
  if (accounts.length === 0) {
    throw new Error("No Zoho accounts configured. Run: npm run auth -- --email you@example.com --region us");
  }

  currentAccount = accounts[0];
  saveCurrentAccount(currentAccount);
  return currentAccount;
}

function loadToken(localAccount?: string): { localAccount: string; token: ZohoToken } {
  const resolvedAccount = resolveLocalAccount(localAccount);
  const tokenPath = join(ACCOUNTS_DIR, resolvedAccount, "token.json");
  const token = readJsonFile<ZohoToken>(tokenPath);

  if (
    !token ||
    typeof token.access_token !== "string" ||
    typeof token.accounts_server !== "string" ||
    typeof token.api_base !== "string" ||
    typeof token.account !== "string"
  ) {
    throw new Error(`Invalid token file for Zoho account '${resolvedAccount}'. Re-run auth.`);
  }

  return { localAccount: resolvedAccount, token };
}

function saveToken(localAccount: string, token: ZohoToken) {
  const tokenPath = join(ACCOUNTS_DIR, localAccount, "token.json");
  writeJsonFile(tokenPath, token, 0o600);
}

function readCredentials(): Credentials {
  const envClientId = process.env.ZOHO_CLIENT_ID?.trim();
  const envClientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  if (envClientId && envClientSecret) {
    return { client_id: envClientId, client_secret: envClientSecret };
  }
  if (!existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing Zoho OAuth credentials. Configure ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET with RUDI secrets, or create ${CREDENTIALS_PATH}.`
    );
  }
  const raw = readJsonFile<Record<string, unknown>>(CREDENTIALS_PATH);
  const credentials = (raw.zoho && typeof raw.zoho === "object" ? raw.zoho : raw) as Partial<Credentials>;
  if (
    typeof credentials.client_id !== "string" ||
    typeof credentials.client_secret !== "string" ||
    credentials.client_id.trim() === "" ||
    credentials.client_secret.trim() === ""
  ) {
    throw new Error("credentials.json must contain non-empty client_id and client_secret strings.");
  }
  return {
    client_id: credentials.client_id.trim(),
    client_secret: credentials.client_secret.trim(),
  };
}

function tokenExpiresSoon(token: ZohoToken): boolean {
  if (!token.expires_at) return true;
  const expiresAt = Date.parse(token.expires_at);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + 120_000;
}

async function refreshAccessToken(localAccount: string, token: ZohoToken): Promise<ZohoToken> {
  if (!token.refresh_token) {
    throw new Error(`Zoho account '${localAccount}' has no refresh token. Re-run auth with access_type=offline.`);
  }

  const credentials = readCredentials();
  const params = new URLSearchParams({
    refresh_token: token.refresh_token,
    client_id: credentials.client_id,
    client_secret: credentials.client_secret,
    grant_type: "refresh_token",
  });

  const response = await fetch(`${token.accounts_server}/oauth/v2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  const data = JSON.parse(text || "{}") as {
    access_token?: string;
    api_domain?: string;
    expires_in?: number;
    expires_in_sec?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || data.error || !data.access_token) {
    const detail = data.error_description || data.error || `HTTP ${response.status}`;
    throw new Error(`Zoho token refresh failed for '${localAccount}': ${detail}`);
  }

  const expiresIn = Number(data.expires_in || data.expires_in_sec || 3600);
  const refreshedToken: ZohoToken = {
    ...token,
    access_token: data.access_token,
    api_domain: data.api_domain || token.api_domain,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
  saveToken(localAccount, refreshedToken);
  return refreshedToken;
}

async function getAuthContext(localAccount?: string): Promise<AuthContext> {
  const loaded = loadToken(localAccount);
  const token = tokenExpiresSoon(loaded.token)
    ? await refreshAccessToken(loaded.localAccount, loaded.token)
    : loaded.token;
  return { localAccount: loaded.localAccount, token };
}

function argsObject(args: unknown): ToolArgs {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return args as ToolArgs;
}

function requireString(args: ToolArgs, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required string argument: ${name}`);
  }
  return value.trim();
}

function optionalString(args: ToolArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Argument '${name}' must be a string.`);
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalStringArray(args: ToolArgs, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`Argument '${name}' must be an array of non-empty file path strings.`);
  }
  return value.map((item) => item.trim());
}

function optionalBoolean(args: ToolArgs, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`Argument '${name}' must be a boolean.`);
  return value;
}

function optionalNumber(args: ToolArgs, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Argument '${name}' must be a finite number.`);
  }
  return value;
}

function boundedInt(value: number | undefined, defaultValue: number, min: number, max: number): number {
  const resolved = value === undefined ? defaultValue : Math.trunc(value);
  if (resolved < min || resolved > max) {
    throw new Error(`Value must be between ${min} and ${max}.`);
  }
  return resolved;
}

function ensureNoLineBreaks(value: string, fieldName: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Argument '${fieldName}' must not contain line breaks.`);
  }
  return value;
}

function mailFormat(args: ToolArgs): "html" | "plaintext" {
  return optionalMailFormat(args) || "html";
}

function optionalMailFormat(args: ToolArgs): "html" | "plaintext" | undefined {
  const value = optionalString(args, "mail_format");
  if (value === undefined) return undefined;
  if (value !== "html" && value !== "plaintext") {
    throw new Error("mail_format must be either 'html' or 'plaintext'.");
  }
  return value;
}

function encodeSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function zohoUrl(token: ZohoToken, path: string, query?: Record<string, string | number | boolean | undefined>) {
  const base = path.startsWith("http") ? path : `${token.api_base}${path}`;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

function formatZohoError(response: Response, body: string): string {
  try {
    const data = JSON.parse(body) as ZohoEnvelope;
    const code = data.status?.code;
    const description = data.status?.description;
    if (code || description) return `${code || response.status}: ${description || response.statusText}`;
    if (typeof data.error === "string") return data.error;
  } catch {
    // Return sanitized fallback below.
  }
  return `HTTP ${response.status}: ${body.slice(0, 500)}`;
}

async function zohoJson<T = unknown>(
  context: AuthContext,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
  } = {}
): Promise<ZohoEnvelope<T>> {
  const url = zohoUrl(context.token, path, options.query);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Zoho-oauthtoken ${context.token.access_token}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(formatZohoError(response, text));
  }

  const data = JSON.parse(text || "{}") as ZohoEnvelope<T>;
  const statusCode = Number(data.status?.code);
  if (Number.isFinite(statusCode) && statusCode >= 400) {
    throw new Error(`${data.status?.code}: ${data.status?.description || "Zoho API error"}`);
  }
  return data;
}

async function zohoRaw(
  context: AuthContext,
  path: string,
  query?: Record<string, string | number | boolean | undefined>
): Promise<Response> {
  const url = zohoUrl(context.token, path, query);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Zoho-oauthtoken ${context.token.access_token}`,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatZohoError(response, text));
  }
  return response;
}

async function uploadZohoAttachments(
  context: AuthContext,
  accountId: string,
  attachmentPaths?: string[]
): Promise<ZohoUploadedAttachment[]> {
  if (!attachmentPaths?.length) return [];

  const uploaded: ZohoUploadedAttachment[] = [];
  for (const attachmentPath of attachmentPaths) {
    if (!isAbsolute(attachmentPath)) {
      throw new Error(`Attachment path must be absolute: ${attachmentPath}`);
    }
    if (!existsSync(attachmentPath)) {
      throw new Error(`Attachment path does not exist: ${attachmentPath}`);
    }
    const stats = statSync(attachmentPath);
    if (!stats.isFile()) {
      throw new Error(`Attachment path is not a file: ${attachmentPath}`);
    }

    const filename = basename(attachmentPath);
    const bytes = readFileSync(attachmentPath);
    const url = zohoUrl(context.token, `/accounts/${encodeSegment(accountId)}/messages/attachments`, {
      fileName: filename,
      isInline: false,
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/octet-stream",
        Authorization: `Zoho-oauthtoken ${context.token.access_token}`,
      },
      body: bytes,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(formatZohoError(response, text));
    }

    const envelope = JSON.parse(text || "{}") as ZohoEnvelope<unknown>;
    const statusCode = Number(envelope.status?.code);
    if (Number.isFinite(statusCode) && statusCode >= 400) {
      throw new Error(`${envelope.status?.code}: ${envelope.status?.description || "Zoho attachment upload failed"}`);
    }

    const records = asArray<Record<string, unknown>>(envelopeData(envelope));
    const attachmentRecords = records.length ? records : [envelopeData(envelope) as Record<string, unknown>];
    for (const record of attachmentRecords) {
      const storeName = record.storeName;
      const attachmentName = record.attachmentName;
      const uploadedPath = record.attachmentPath;
      if (
        (typeof storeName !== "string" && typeof storeName !== "number") ||
        typeof attachmentName !== "string" ||
        typeof uploadedPath !== "string"
      ) {
        throw new Error(`Zoho attachment upload returned an unexpected response for ${attachmentPath}.`);
      }
      uploaded.push({
        storeName: String(storeName),
        attachmentName,
        attachmentPath: uploadedPath,
      });
    }
  }

  return uploaded;
}

async function uploadRequestedAttachments(
  context: AuthContext,
  accountId: string,
  args: ToolArgs
): Promise<ZohoUploadedAttachment[]> {
  return uploadZohoAttachments(context, accountId, optionalStringArray(args, "attachments"));
}

function envelopeData<T>(envelope: ZohoEnvelope<T>): T {
  if (envelope.data === undefined) return envelope as T;
  return envelope.data;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function accountIdFromRecord(record: ZohoAccountRecord): string | null {
  const value = record.accountId ?? record.accountID ?? record.accountKey ?? record.id;
  return value === undefined || value === null ? null : String(value);
}

function emailFromRecord(record: ZohoAccountRecord): string | null {
  const candidates = [
    record.primaryEmailAddress,
    record.emailAddress,
    record.mailboxAddress,
    record.fromAddress,
    record.accountName,
  ];
  const email = candidates.find((candidate) => typeof candidate === "string" && candidate.includes("@"));
  return email || null;
}

async function listRemoteAccounts(context: AuthContext): Promise<ZohoAccountRecord[]> {
  const response = await zohoJson<ZohoAccountRecord[]>(context, "/accounts");
  return asArray<ZohoAccountRecord>(envelopeData(response));
}

async function resolveZohoAccount(
  context: AuthContext,
  requestedAccountId?: string
): Promise<{ accountId: string; fromAddress: string; record?: ZohoAccountRecord }> {
  if (requestedAccountId) {
    return {
      accountId: requestedAccountId,
      fromAddress: context.token.account,
    };
  }

  const records = await listRemoteAccounts(context);
  const matchingRecord =
    records.find((record) => emailFromRecord(record)?.toLowerCase() === context.token.account.toLowerCase()) ||
    records[0];

  if (!matchingRecord) {
    throw new Error("Zoho did not return any mail accounts for the authenticated user.");
  }

  const accountId = accountIdFromRecord(matchingRecord);
  if (!accountId) {
    throw new Error("Could not determine Zoho accountId from /accounts response.");
  }

  return {
    accountId,
    fromAddress: emailFromRecord(matchingRecord) || context.token.account,
    record: matchingRecord,
  };
}

async function listMessages(
  context: AuthContext,
  accountId: string,
  options: {
    folderId?: string;
    start?: number;
    limit?: number;
    includeTo?: boolean;
    includeSent?: boolean;
    includeArchive?: boolean;
  } = {}
): Promise<MessageRecord[]> {
  const response = await zohoJson<MessageRecord[]>(context, `/accounts/${encodeSegment(accountId)}/messages/view`, {
    query: {
      folderId: options.folderId,
      start: options.start || 1,
      limit: options.limit || 50,
      includeto: options.includeTo,
      includesent: options.includeSent,
      includearchive: options.includeArchive,
    },
  });
  return asArray<MessageRecord>(envelopeData(response));
}

async function resolveMessageLocation(
  context: AuthContext,
  accountId: string,
  messageId: string,
  folderId?: string
): Promise<{ messageId: string; folderId: string; record?: MessageRecord }> {
  if (folderId) return { messageId, folderId };

  const messages = await listMessages(context, accountId, {
    limit: 200,
    includeTo: true,
    includeSent: true,
    includeArchive: true,
  });
  const match = messages.find((message) => String(message.messageId) === messageId);
  if (!match?.folderId) {
    throw new Error("folder_id is required when the message is not present in the recent 200-message scan.");
  }

  return {
    messageId,
    folderId: String(match.folderId),
    record: match,
  };
}

async function getMessage(
  context: AuthContext,
  accountId: string,
  messageId: string,
  folderId?: string,
  includeBlockContent?: boolean
) {
  const location = await resolveMessageLocation(context, accountId, messageId, folderId);
  const encodedAccount = encodeSegment(accountId);
  const encodedFolder = encodeSegment(location.folderId);
  const encodedMessage = encodeSegment(messageId);

  const [details, content] = await Promise.all([
    zohoJson<MessageRecord>(
      context,
      `/accounts/${encodedAccount}/folders/${encodedFolder}/messages/${encodedMessage}/details`
    ),
    zohoJson<{ messageId: string | number; content?: string }>(
      context,
      `/accounts/${encodedAccount}/folders/${encodedFolder}/messages/${encodedMessage}/content`,
      { query: { includeBlockContent } }
    ),
  ]);

  return {
    folderId: location.folderId,
    details: envelopeData(details),
    content: envelopeData(content),
  };
}

function buildMessageBody(args: ToolArgs, fromAddress: string, attachments: ZohoUploadedAttachment[] = []) {
  const body: Record<string, unknown> = {
    fromAddress: ensureNoLineBreaks(optionalString(args, "from") || fromAddress, "from"),
    toAddress: ensureNoLineBreaks(requireString(args, "to"), "to"),
    subject: ensureNoLineBreaks(requireString(args, "subject"), "subject"),
    content: requireString(args, "body"),
    mailFormat: mailFormat(args),
    encoding: "UTF-8",
  };

  const cc = optionalString(args, "cc");
  const bcc = optionalString(args, "bcc");
  if (cc) body.ccAddress = ensureNoLineBreaks(cc, "cc");
  if (bcc) body.bccAddress = ensureNoLineBreaks(bcc, "bcc");
  if (attachments.length) body.attachments = attachments;
  return body;
}

function buildDraftUpdateBody(args: ToolArgs, attachments: ZohoUploadedAttachment[] = []) {
  const body: Record<string, unknown> = {};
  const from = optionalString(args, "from");
  const to = optionalString(args, "to");
  const subject = optionalString(args, "subject");
  const content = optionalString(args, "body");
  const cc = optionalString(args, "cc");
  const bcc = optionalString(args, "bcc");
  const format = optionalMailFormat(args);

  if (from) body.fromAddress = ensureNoLineBreaks(from, "from");
  if (to) body.toAddress = ensureNoLineBreaks(to, "to");
  if (subject) body.subject = ensureNoLineBreaks(subject, "subject");
  if (content) body.content = content;
  if (cc) body.ccAddress = ensureNoLineBreaks(cc, "cc");
  if (bcc) body.bccAddress = ensureNoLineBreaks(bcc, "bcc");
  if (format) body.mailFormat = format;
  if (attachments.length) body.attachments = attachments;

  if (Object.keys(body).length === 0) {
    throw new Error("Provide at least one draft field to update.");
  }
  return body;
}

function resultText(value: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function sanitizeFilename(filename: string): string {
  const base = basename(filename).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `zoho-attachment-${Date.now()}`;
}

function outputPathFor(filename: string, requestedPath?: string): string {
  const outputRoot = resolve(DEFAULT_OUTPUT_DIR);
  const path = requestedPath
    ? isAbsolute(requestedPath)
      ? resolve(requestedPath)
      : resolve(outputRoot, requestedPath)
    : resolve(outputRoot, sanitizeFilename(filename));

  const childPath = relative(outputRoot, path);
  if (childPath.startsWith("..") || isAbsolute(childPath)) {
    throw new Error(`Attachment output must stay under ${outputRoot}.`);
  }
  return path;
}

function isTextLike(filename: string | undefined, contentType: string | null): boolean {
  if (contentType?.startsWith("text/")) return true;
  if (contentType?.includes("json") || contentType?.includes("xml")) return true;
  const ext = filename?.split(".").pop()?.toLowerCase();
  return !!ext && ["txt", "md", "csv", "json", "xml", "html", "htm", "log"].includes(ext);
}

const tools = [
  {
    name: "zoho_account_list",
    description: "List configured local Zoho Mail OAuth accounts",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zoho_account_current",
    description: "Show the active Zoho Mail OAuth account",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "zoho_account_switch",
    description: "Switch the active Zoho Mail OAuth account",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", description: "Configured account email" },
      },
      required: ["account"],
    },
  },
  {
    name: "zoho_folder_list",
    description: "List folders for the active Zoho Mail account",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Optional Zoho account ID" },
      },
    },
  },
  {
    name: "zoho_search",
    description: "Search Zoho Mail messages using Zoho searchKey syntax",
    inputSchema: {
      type: "object",
      properties: {
        search_key: { type: "string", description: "Zoho Mail searchKey" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        start: { type: "number", description: "Start offset, default 1" },
        limit: { type: "number", description: "Result limit, 1-200, default 10" },
        include_to: { type: "boolean", description: "Include To details in results" },
        received_time: { type: "number", description: "Optional received-before Unix timestamp in milliseconds" },
      },
      required: ["search_key"],
    },
  },
  {
    name: "zoho_get",
    description: "Get Zoho Mail message metadata and content by message ID",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Zoho message ID" },
        folder_id: { type: "string", description: "Folder ID from search/list results" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        include_block_content: { type: "boolean", description: "Include quoted block content" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "zoho_send",
    description: "Send an email via Zoho Mail",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address or comma-separated addresses" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        from: { type: "string", description: "Optional sender address" },
        cc: { type: "string", description: "Optional Cc address list" },
        bcc: { type: "string", description: "Optional Bcc address list" },
        mail_format: { type: "string", enum: ["html", "plaintext"], description: "Body format, default html" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        attachments: ATTACHMENT_PATHS_SCHEMA,
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "zoho_draft",
    description: "Create a Zoho Mail draft",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address or comma-separated addresses" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
        from: { type: "string", description: "Optional sender address" },
        cc: { type: "string", description: "Optional Cc address list" },
        bcc: { type: "string", description: "Optional Bcc address list" },
        mail_format: { type: "string", enum: ["html", "plaintext"], description: "Body format, default html" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        attachments: ATTACHMENT_PATHS_SCHEMA,
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "zoho_draft_update",
    description: "Update fields on an existing Zoho Mail draft",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "Zoho draft ID" },
        to: { type: "string", description: "Replacement recipient email address or comma-separated addresses" },
        subject: { type: "string", description: "Replacement email subject" },
        body: { type: "string", description: "Replacement email body" },
        from: { type: "string", description: "Replacement sender address" },
        cc: { type: "string", description: "Replacement Cc address list" },
        bcc: { type: "string", description: "Replacement Bcc address list" },
        mail_format: { type: "string", enum: ["html", "plaintext"], description: "Replacement body format" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        attachments: ATTACHMENT_PATHS_SCHEMA,
      },
      required: ["draft_id"],
    },
  },
  {
    name: "zoho_draft_delete",
    description: "Delete a Zoho Mail draft",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "Zoho draft ID" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "zoho_reply",
    description: "Reply to a Zoho Mail message",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Zoho message ID to reply to" },
        body: { type: "string", description: "Reply body" },
        folder_id: { type: "string", description: "Folder ID for the original message" },
        to: { type: "string", description: "Optional reply recipient" },
        subject: { type: "string", description: "Optional reply subject" },
        from: { type: "string", description: "Optional sender address" },
        cc: { type: "string", description: "Optional Cc address list" },
        bcc: { type: "string", description: "Optional Bcc address list" },
        mail_format: { type: "string", enum: ["html", "plaintext"], description: "Body format, default html" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        attachments: ATTACHMENT_PATHS_SCHEMA,
      },
      required: ["message_id", "body"],
    },
  },
  {
    name: "zoho_message_delete",
    description: "Delete a Zoho Mail message. By default this moves the message to trash; set expunge=true to delete permanently.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Zoho message ID" },
        folder_id: { type: "string", description: "Folder ID. If omitted, recent messages are searched." },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        expunge: { type: "boolean", description: "Permanently delete instead of moving to trash. Default false." },
      },
      required: ["message_id"],
    },
  },
  {
    name: "zoho_list_attachments",
    description: "List attachments for a Zoho Mail message",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Zoho message ID" },
        folder_id: { type: "string", description: "Folder ID" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "zoho_get_attachment",
    description: "Download a Zoho Mail attachment to disk or return text content for text-like files",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Zoho message ID" },
        folder_id: { type: "string", description: "Folder ID" },
        attachment_id: { type: "string", description: "Attachment ID from zoho_list_attachments" },
        filename: { type: "string", description: "Optional original filename" },
        output: { type: "string", description: "Optional output file path" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
      },
      required: ["message_id", "attachment_id"],
    },
  },
  {
    name: "zoho_get_thread",
    description: "Best-effort lookup of recent Zoho Mail messages with a matching thread ID",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Zoho thread ID" },
        folder_id: { type: "string", description: "Optional folder ID to search" },
        account_id: { type: "string", description: "Optional Zoho account ID" },
        limit: { type: "number", description: "Recent message scan limit, 1-200, default 50" },
      },
      required: ["thread_id"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = argsObject(request.params.arguments);

  try {
    switch (name) {
      case "zoho_account_list": {
        const accounts = getAvailableAccounts();
        return resultText(
          accounts.length
            ? accounts.map((account) => `${account}${account === currentAccount ? " (active)" : ""}`).join("\n")
            : "No Zoho accounts configured. Run npm run auth first."
        );
      }

      case "zoho_account_current": {
        return resultText(currentAccount ? `Current Zoho account: ${currentAccount}` : "No active Zoho account selected.");
      }

      case "zoho_account_switch": {
        const account = requireString(args, "account");
        const accounts = getAvailableAccounts();
        if (!accounts.includes(account)) {
          throw new Error(`Zoho account '${account}' is not configured. Available: ${accounts.join(", ") || "none"}`);
        }
        currentAccount = account;
        saveCurrentAccount(account);
        return resultText(`Switched to Zoho account: ${account}`);
      }

      case "zoho_folder_list": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const response = await zohoJson(context, `/accounts/${encodeSegment(account.accountId)}/folders`);
        return resultText(envelopeData(response));
      }

      case "zoho_search": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const limit = boundedInt(optionalNumber(args, "limit"), 10, 1, 200);
        const start = boundedInt(optionalNumber(args, "start"), 1, 1, Number.MAX_SAFE_INTEGER);
        const response = await zohoJson(context, `/accounts/${encodeSegment(account.accountId)}/messages/search`, {
          query: {
            searchKey: requireString(args, "search_key"),
            start,
            limit,
            includeto: optionalBoolean(args, "include_to"),
            receivedTime: optionalNumber(args, "received_time"),
          },
        });
        return resultText(envelopeData(response));
      }

      case "zoho_get": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const message = await getMessage(
          context,
          account.accountId,
          requireString(args, "message_id"),
          optionalString(args, "folder_id"),
          optionalBoolean(args, "include_block_content")
        );
        return resultText(message);
      }

      case "zoho_send": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const attachments = await uploadRequestedAttachments(context, account.accountId, args);
        const body = buildMessageBody(args, account.fromAddress, attachments);
        const response = await zohoJson(context, `/accounts/${encodeSegment(account.accountId)}/messages`, {
          method: "POST",
          body,
        });
        return resultText({ sent: true, attachments: attachments.length, result: envelopeData(response) });
      }

      case "zoho_draft": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const attachments = await uploadRequestedAttachments(context, account.accountId, args);
        const body = { mode: "draft", ...buildMessageBody(args, account.fromAddress, attachments) };
        const response = await zohoJson(context, `/accounts/${encodeSegment(account.accountId)}/messages`, {
          method: "POST",
          body,
        });
        return resultText({ drafted: true, attachments: attachments.length, result: envelopeData(response) });
      }

      case "zoho_draft_update": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const draftId = requireString(args, "draft_id");
        const attachments = await uploadRequestedAttachments(context, account.accountId, args);
        const body = buildDraftUpdateBody(args, attachments);
        const response = await zohoJson(
          context,
          `/accounts/${encodeSegment(account.accountId)}/drafts/${encodeSegment(draftId)}`,
          { method: "PUT", body }
        );
        return resultText({ updated: true, draftId, attachments: attachments.length, result: envelopeData(response) });
      }

      case "zoho_draft_delete": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const draftId = requireString(args, "draft_id");
        const response = await zohoJson(
          context,
          `/accounts/${encodeSegment(account.accountId)}/drafts/${encodeSegment(draftId)}`,
          { method: "DELETE" }
        );
        return resultText({ deleted: true, draftId, result: envelopeData(response) });
      }

      case "zoho_reply": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const messageId = requireString(args, "message_id");
        const original = await getMessage(context, account.accountId, messageId, optionalString(args, "folder_id"));
        const details = original.details as MessageRecord;
        const originalSubject = typeof details.subject === "string" ? details.subject : "";
        const subject =
          optionalString(args, "subject") ||
          (originalSubject.toLowerCase().startsWith("re:") ? originalSubject : `Re: ${originalSubject}`);
        const to = optionalString(args, "to") || (typeof details.fromAddress === "string" ? details.fromAddress : "");
        if (!to) throw new Error("Could not determine reply recipient. Provide the 'to' argument.");
        const attachments = await uploadRequestedAttachments(context, account.accountId, args);
        const cc = optionalString(args, "cc");
        const bcc = optionalString(args, "bcc");

        const body: Record<string, unknown> = {
          fromAddress: ensureNoLineBreaks(optionalString(args, "from") || account.fromAddress, "from"),
          toAddress: ensureNoLineBreaks(to, "to"),
          subject: ensureNoLineBreaks(subject, "subject"),
          content: requireString(args, "body"),
          action: "reply",
          mailFormat: mailFormat(args),
          encoding: "UTF-8",
          ...(cc ? { ccAddress: ensureNoLineBreaks(cc, "cc") } : {}),
          ...(bcc ? { bccAddress: ensureNoLineBreaks(bcc, "bcc") } : {}),
        };
        if (attachments.length) body.attachments = attachments;

        const response = await zohoJson(
          context,
          `/accounts/${encodeSegment(account.accountId)}/messages/${encodeSegment(messageId)}`,
          { method: "POST", body }
        );
        return resultText({ replied: true, attachments: attachments.length, result: envelopeData(response) });
      }

      case "zoho_message_delete": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const messageId = requireString(args, "message_id");
        const location = await resolveMessageLocation(
          context,
          account.accountId,
          messageId,
          optionalString(args, "folder_id")
        );
        const expunge = optionalBoolean(args, "expunge") || false;
        const response = await zohoJson(
          context,
          `/accounts/${encodeSegment(account.accountId)}/folders/${encodeSegment(location.folderId)}/messages/${encodeSegment(messageId)}`,
          { method: "DELETE", query: { expunge } }
        );
        return resultText({ deleted: true, expunge, messageId, folderId: location.folderId, result: envelopeData(response) });
      }

      case "zoho_list_attachments": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const messageId = requireString(args, "message_id");
        const location = await resolveMessageLocation(
          context,
          account.accountId,
          messageId,
          optionalString(args, "folder_id")
        );
        const response = await zohoJson(
          context,
          `/accounts/${encodeSegment(account.accountId)}/folders/${encodeSegment(location.folderId)}/messages/${encodeSegment(messageId)}/attachmentinfo`
        );
        return resultText(envelopeData(response));
      }

      case "zoho_get_attachment": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const messageId = requireString(args, "message_id");
        const attachmentId = requireString(args, "attachment_id");
        const location = await resolveMessageLocation(
          context,
          account.accountId,
          messageId,
          optionalString(args, "folder_id")
        );
        const response = await zohoRaw(
          context,
          `/accounts/${encodeSegment(account.accountId)}/folders/${encodeSegment(location.folderId)}/messages/${encodeSegment(messageId)}/attachments/${encodeSegment(attachmentId)}`
        );
        const filename = optionalString(args, "filename") || `zoho-attachment-${attachmentId}`;
        const contentType = response.headers.get("content-type");
        const bytes = Buffer.from(await response.arrayBuffer());

        if (isTextLike(filename, contentType) && !optionalString(args, "output")) {
          return resultText(bytes.toString("utf-8"));
        }

        const path = outputPathFor(filename, optionalString(args, "output"));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, bytes, { mode: 0o600 });
        chmodSync(path, 0o600);
        return resultText({ saved: path, bytes: bytes.length, contentType });
      }

      case "zoho_get_thread": {
        const context = await getAuthContext();
        const account = await resolveZohoAccount(context, optionalString(args, "account_id"));
        const threadId = requireString(args, "thread_id");
        const limit = boundedInt(optionalNumber(args, "limit"), 50, 1, 200);
        const messages = await listMessages(context, account.accountId, {
          folderId: optionalString(args, "folder_id"),
          limit,
          includeTo: true,
          includeSent: true,
          includeArchive: true,
        });
        const matches = messages.filter((message) => String(message.threadId) === threadId);
        const withContent = await Promise.all(
          matches.map(async (message) => {
            if (!message.messageId || !message.folderId) return message;
            try {
              return await getMessage(context, account.accountId, String(message.messageId), String(message.folderId));
            } catch {
              return message;
            }
          })
        );
        return resultText({
          threadId,
          scanned: messages.length,
          matched: withContent.length,
          messages: withContent,
        });
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
