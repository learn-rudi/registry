#!/usr/bin/env node
/**
 * Google Workspace MCP Server (TypeScript)
 * Gmail, Sheets, Docs, Drive, Calendar
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { basename, dirname, extname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { homedir } from "os";
import { buildCalendarEventInsert } from "./calendar.js";
import {
  calendarDiscoveryToolDefinitions,
  runCalendarDiscoveryPage,
} from "./calendar-discovery.js";
import {
  gmailDiscoveryToolDefinitions,
  runGmailDiscoveryTool,
} from "./gmail-discovery.js";
import {
  buildGmailDraftMessage,
  buildGmailRawMessage,
  encodeMimeBody,
  encodeMimeHeaderValue,
  inferGmailContentType,
  normalizeGmailRawMessage,
  normalizeGmailSendResult,
  resolveRequestedAccount,
} from "./gmail.js";
import { gmailSearchToolDefinitions, runGmailHeaderSearch, runGmailSearch } from "./gmail-search.js";
import { resolveOAuthClientConfig } from "./oauthCredentials.js";
import {
  getWorkspacePaths,
  migrateLegacyStateIfNeeded,
  readJsonFile,
  writeJsonFile,
} from "./state.js";
import {
  DEFAULT_TASKLIST_ID,
  buildTaskComplete,
  buildTaskDelete,
  buildTaskInsert,
  buildTaskList,
  buildTaskListsList,
  buildTaskPatch,
  summarizeTask,
  summarizeTaskList,
} from "./tasks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default output: ~/.rudi/outputs/
const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "outputs");
if (!existsSync(DEFAULT_OUTPUT_DIR)) {
  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function generateOutputPath(prefix: string, name: string): string {
  const date = new Date().toISOString().split("T")[0];
  const slug = slugify(name);
  return join(DEFAULT_OUTPUT_DIR, `${prefix}-${slug}-${date}.md`);
}
config({ path: join(__dirname, "..", ".env") });

const WORKSPACE_PATHS = getWorkspacePaths({ packageRoot: join(__dirname, "..") });
migrateLegacyStateIfNeeded(WORKSPACE_PATHS);
const ACCOUNTS_DIR = WORKSPACE_PATHS.accountsDir;
const TOKEN_FILE = WORKSPACE_PATHS.tokenFile;
const STATE_FILE = WORKSPACE_PATHS.stateFile;

type AccountState = {
  currentAccount?: string;
};

type TokenData = {
  token?: string;
  refresh_token?: string;
  expiry?: string | null;
  client_id?: string;
  client_secret?: string;
  account?: string;
};

type EmailAttachment = {
  filename: string;
  mimeType: string;
  data: Buffer;
};

// Load persisted account on startup
function loadCurrentAccount(): string | null {
  try {
    const state = readJsonFile<AccountState>(STATE_FILE);
    if (state?.currentAccount && existsSync(join(ACCOUNTS_DIR, state.currentAccount, "token.json"))) {
      return state.currentAccount;
    }
  } catch {
    return null;
  }
  return null;
}

// Save current account to disk
function saveCurrentAccount(account: string | null) {
  writeJsonFile(STATE_FILE, { currentAccount: account });
}

let currentAccount: string | null = loadCurrentAccount();

function getAvailableAccounts(): string[] {
  if (!existsSync(ACCOUNTS_DIR)) return [];
  return readdirSync(ACCOUNTS_DIR).filter((name: string) => {
    const tokenPath = join(ACCOUNTS_DIR, name, "token.json");
    return existsSync(tokenPath);
  });
}

function loadToken(account?: string) {
  let tokenPath = TOKEN_FILE;
  if (account) {
    tokenPath = join(ACCOUNTS_DIR, account, "token.json");
  } else if (currentAccount) {
    tokenPath = join(ACCOUNTS_DIR, currentAccount, "token.json");
  }
  return readJsonFile<TokenData>(tokenPath);
}

function getAuth(account?: string | null) {
  const requestedAccount = account || undefined;
  const token = loadToken(requestedAccount);
  if (!token) {
    const suffix = requestedAccount ? ` for account '${requestedAccount}'` : "";
    throw new Error(`Not authenticated${suffix}. Run 'npm run auth' first.`);
  }

  const credentials = resolveOAuthClientConfig(
    WORKSPACE_PATHS,
    token,
    requestedAccount || currentAccount || token.account
  );

  const oauth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret
  );
  oauth2Client.setCredentials({
    access_token: token.token,
    refresh_token: token.refresh_token,
    expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
  });
  return oauth2Client;
}

function getAuthForArgs(args: Record<string, unknown> | undefined) {
  return getAuth(resolveRequestedAccount(args, currentAccount));
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

function hasToolArg(args: Record<string, unknown> | undefined, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(args || {}, field);
}

function optionalToolString(args: Record<string, unknown> | undefined, field: string): string | undefined {
  if (!hasToolArg(args, field)) return undefined;
  const value = args?.[field];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function boundedInteger(
  value: unknown,
  field: string,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (value == null) return defaultValue;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function optionalStringArray(args: Record<string, unknown> | undefined, field: string): string[] | undefined {
  if (!hasToolArg(args, field)) return undefined;
  const value = args?.[field];
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        throw new Error(`${field}[${index}] must be a non-empty string`);
      }
      return entry.trim();
    });
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  throw new Error(`${field} must be an array of strings or a comma-separated string`);
}

function requireStringArray(args: Record<string, unknown> | undefined, field: string): string[] {
  const values = optionalStringArray(args, field);
  if (!values || values.length === 0) {
    throw new Error(`${field} must include at least one value`);
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObjectArray(args: Record<string, unknown> | undefined, field: string): Record<string, unknown>[] {
  const value = args?.[field];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${field} must include at least one request`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${field}[${index}] must be an object`);
    }
    return entry;
  });
}

function optionalObject(args: Record<string, unknown> | undefined, field: string): Record<string, unknown> | undefined {
  if (!hasToolArg(args, field)) return undefined;
  const value = args?.[field];
  if (value == null) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function normalizePresentationId(args: Record<string, unknown> | undefined, field = "presentation_id"): string {
  const raw = requireString(args?.[field], field).trim();
  const urlMatch = raw.match(/\/presentation\/d\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw;
  throw new Error(`${field} must be a raw Google Slides ID or presentation URL`);
}

type SlidesThumbnailSize = "SMALL" | "MEDIUM" | "LARGE";

function optionalSlidesThumbnailSize(args: Record<string, unknown> | undefined): SlidesThumbnailSize {
  const value = (optionalToolString(args, "thumbnail_size") || "LARGE").toUpperCase();
  if (value !== "SMALL" && value !== "MEDIUM" && value !== "LARGE") {
    throw new Error("thumbnail_size must be one of: SMALL, MEDIUM, LARGE");
  }
  return value;
}

function getHeaderValue(headers: any[], name: string): string {
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractGmailPayloadBody(payload: any): { text: string; html: string } {
  const result = { text: "", html: "" };
  if (!payload) return result;

  if (payload.parts) {
    for (const part of payload.parts) {
      const nested = extractGmailPayloadBody(part);
      if (nested.text) result.text = nested.text;
      if (nested.html) result.html = nested.html;
    }
    return result;
  }

  if (payload.body?.data) {
    const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    if (payload.mimeType === "text/html") {
      result.html = decoded;
    } else {
      result.text = decoded;
    }
  }

  return result;
}

function chooseDraftContentType(payload: any): string | undefined {
  return payload?.mimeType === "text/html" ? "text/html; charset=utf-8" : undefined;
}

function summarizeGmailMessage(message: any): Record<string, unknown> {
  const headers = message?.payload?.headers || [];
  const body = extractGmailPayloadBody(message?.payload);
  return {
    id: message?.id,
    threadId: message?.threadId,
    subject: getHeaderValue(headers, "Subject"),
    from: getHeaderValue(headers, "From"),
    to: getHeaderValue(headers, "To"),
    cc: getHeaderValue(headers, "Cc"),
    date: getHeaderValue(headers, "Date"),
    snippet: message?.snippet,
    labels: message?.labelIds,
    body: body.text || body.html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
    bodyHtml: body.html,
  };
}

function optionalAttachmentPaths(args: Record<string, unknown> | undefined): string[] {
  return optionalStringArray(args, "attachments") || [];
}

function loadAttachmentFiles(paths: string[]): EmailAttachment[] {
  return paths.map((filePath) => {
    if (!existsSync(filePath)) {
      throw new Error(`Attachment not found: ${filePath}`);
    }
    return {
      filename: basename(filePath),
      mimeType: guessMimeType(filePath),
      data: readFileSync(filePath),
    };
  });
}

async function loadGmailPayloadAttachments(gmail: any, messageId: string, payload: any): Promise<EmailAttachment[]> {
  const attachments: EmailAttachment[] = [];

  async function visit(part: any): Promise<void> {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      const attachment = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId,
        id: part.body.attachmentId,
      });
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || guessMimeType(part.filename),
        data: Buffer.from(attachment.data.data || "", "base64url"),
      });
    }
    for (const child of part.parts || []) {
      await visit(child);
    }
  }

  await visit(payload);
  return attachments;
}

function buildRawEmail(options: {
  from?: unknown;
  to: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject: unknown;
  body: unknown;
  contentType?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
  attachments?: EmailAttachment[];
}): string {
  const attachments = options.attachments || [];
  if (attachments.length === 0) {
    return buildGmailRawMessage(options);
  }

  const body = requireString(options.body, "body");
  const boundary = `rudi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const lines: string[] = [];
  const from = optionalHeaderValue(options.from, "from");
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${sanitizeHeaderValue(requireString(options.to, "to"), "to")}`);
  const cc = optionalHeaderValue(options.cc, "cc");
  const bcc = optionalHeaderValue(options.bcc, "bcc");
  const inReplyTo = optionalHeaderValue(options.inReplyTo, "In-Reply-To");
  const references = optionalHeaderValue(options.references, "References");
  const contentType = optionalHeaderValue(options.contentType, "Content-Type") || inferGmailContentType(body);

  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${encodeMimeHeaderValue(sanitizeHeaderValue(requireString(options.subject, "subject"), "subject"))}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: ${contentType}`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(encodeMimeBody(body));

  for (const attachment of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${sanitizeHeaderValue(attachment.mimeType, "attachment mimeType")}; name="${sanitizeHeaderValue(attachment.filename, "attachment filename")}"`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename="${sanitizeHeaderValue(attachment.filename, "attachment filename")}"`);
    lines.push("");
    lines.push(wrapBase64(attachment.data.toString("base64")));
  }

  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

function optionalHeaderValue(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed ? sanitizeHeaderValue(trimmed, field) : undefined;
}

function sanitizeHeaderValue(value: string, field: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must not contain newlines`);
  }
  return value.trim();
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function guessMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".txt":
    case ".md":
      return "text/plain";
    case ".html":
    case ".htm":
      return "text/html";
    case ".csv":
      return "text/csv";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ACCOUNT_INPUT = {
  type: "string",
  description: "Optional configured Google account email/name. Overrides the currently active account for this call.",
};

const MESSAGE_ID_INPUT = { type: "string", description: "Gmail message ID" };

const MESSAGE_IDS_INPUT = {
  type: "array",
  items: { type: "string" },
  description: "Gmail message IDs",
};

const LABEL_IDS_INPUT = {
  type: "array",
  items: { type: "string" },
  description: "Gmail label IDs, not display names",
};

const ATTACHMENTS_INPUT = {
  type: "array",
  items: { type: "string" },
  description: "Optional absolute local file paths to attach",
};

const TASKLIST_ID_INPUT = {
  type: "string",
  description: `Google Tasks task list ID (default: ${DEFAULT_TASKLIST_ID})`,
};

const TASK_ID_INPUT = { type: "string", description: "Google Tasks task ID" };

const TASK_DUE_INPUT = {
  type: "string",
  description: "Optional RFC 3339 due datetime. Google Tasks stores date precision only.",
};

const PRESENTATION_ID_INPUT = {
  type: "string",
  description: "Google Slides presentation ID or URL",
};

const SLIDE_ID_INPUT = {
  type: "string",
  description: "Google Slides slide/page object ID",
};

const SLIDES_FIELDS_INPUT = {
  type: "string",
  description: "Optional Google API partial response fields selector",
};

const SLIDES_REQUESTS_INPUT = {
  type: "array",
  items: { type: "object" },
  description: "Raw Google Slides presentations.batchUpdate request objects",
};

const SLIDES_WRITE_CONTROL_INPUT = {
  type: "object",
  description: "Optional Google Slides writeControl object, such as requiredRevisionId",
};

const server = new Server(
  { name: "google-workspace", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Account Management
    {
      name: "account_list",
      description: "List all configured Google accounts",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "account_switch",
      description: "Switch to a different Google account",
      inputSchema: {
        type: "object",
        properties: {
          account: { type: "string", description: "Account name (e.g., 'personal', 'work')" },
        },
        required: ["account"],
      },
    },
    {
      name: "account_current",
      description: "Show the currently active Google account",
      inputSchema: { type: "object", properties: {} },
    },
    // Gmail
    ...gmailDiscoveryToolDefinitions(ACCOUNT_INPUT),
    {
      name: "gmail_send",
      description: "Send an email via Gmail",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email. Optional for reply sends; defaults to the original sender." },
          subject: { type: "string", description: "Email subject. Optional for reply sends; defaults to Re: original subject." },
          body: { type: "string", description: "Email body" },
          cc: { type: "string", description: "Optional Cc recipient list" },
          bcc: { type: "string", description: "Optional Bcc recipient list" },
          reply_message_id: { type: "string", description: "Optional Gmail message ID to reply to so the email stays in the original thread" },
          reply_all: { type: "boolean", description: "For threaded sends, include original To/Cc recipients except the authenticated account (default: false)" },
          attachments: ATTACHMENTS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["body"],
      },
    },
    ...gmailSearchToolDefinitions(ACCOUNT_INPUT),
    {
      name: "gmail_draft",
      description: "Create a Gmail draft. Pass reply_message_id to create a threaded reply draft.",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email. Optional for reply drafts; defaults to the original sender." },
          subject: { type: "string", description: "Email subject. Optional for reply drafts; defaults to Re: original subject." },
          body: { type: "string", description: "Email body" },
          cc: { type: "string", description: "Optional Cc recipient list" },
          bcc: { type: "string", description: "Optional Bcc recipient list" },
          reply_message_id: { type: "string", description: "Optional Gmail message ID to reply to so the draft stays in the original thread" },
          reply_all: { type: "boolean", description: "For reply drafts, include original To/Cc recipients except the authenticated account (default: false)" },
          attachments: ATTACHMENTS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["body"],
      },
    },
    {
      name: "gmail_draft_list",
      description: "List Gmail drafts with draft IDs, message IDs, subjects, recipients, and thread IDs",
      inputSchema: {
        type: "object",
        properties: {
          max_results: { type: "number", description: "Max drafts to return (default 10)" },
          next_page_token: { type: "string", description: "Pagination token from a previous draft list response" },
          account: ACCOUNT_INPUT,
        },
      },
    },
    {
      name: "gmail_draft_get",
      description: "Get one Gmail draft by draft ID, including headers, thread ID, snippet, and body",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "Gmail draft ID" },
          output: { type: "string", description: "Optional file path to save draft JSON" },
          account: ACCOUNT_INPUT,
        },
        required: ["draft_id"],
      },
    },
    {
      name: "gmail_draft_update",
      description: "Update an existing Gmail draft. Omitted to/subject/body/cc/bcc fields are preserved.",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "Gmail draft ID" },
          to: { type: "string", description: "Replacement recipient email list" },
          subject: { type: "string", description: "Replacement email subject" },
          body: { type: "string", description: "Replacement email body" },
          cc: { type: "string", description: "Replacement Cc recipient list" },
          bcc: { type: "string", description: "Replacement Bcc recipient list" },
          attachments: ATTACHMENTS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["draft_id"],
      },
    },
    {
      name: "gmail_draft_delete",
      description: "Delete a Gmail draft by draft ID",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "Gmail draft ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["draft_id"],
      },
    },
    {
      name: "gmail_draft_send",
      description: "Send an existing Gmail draft by draft ID",
      inputSchema: {
        type: "object",
        properties: {
          draft_id: { type: "string", description: "Gmail draft ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["draft_id"],
      },
    },
    {
      name: "gmail_get",
      description: "Get full email content by message ID (includes body text)",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          output: { type: "string", description: "Optional file path to save email content" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_get_raw",
      description: "Get one Gmail message as provider metadata plus raw RFC 2822 base64url",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_list_attachments",
      description: "List attachments in an email without downloading them",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_get_attachment",
      description: "Download an attachment from an email. Returns text content for text/document files, or saves binary files to disk.",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          attachment_id: { type: "string", description: "Attachment ID (from gmail_list_attachments)" },
          filename: { type: "string", description: "Original filename (for determining file type)" },
          output: { type: "string", description: "File path to save attachment (required for binary files)" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id", "attachment_id"],
      },
    },
    {
      name: "gmail_reply",
      description: "Reply to an email, keeping it in the same thread",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID to reply to" },
          to: { type: "string", description: "Optional replacement reply recipient list" },
          subject: { type: "string", description: "Optional replacement reply subject" },
          body: { type: "string", description: "Reply body (HTML supported)" },
          reply_all: { type: "boolean", description: "Reply to all recipients (default: false)" },
          cc: { type: "string", description: "Optional Cc recipient list" },
          bcc: { type: "string", description: "Optional Bcc recipient list" },
          attachments: ATTACHMENTS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id", "body"],
      },
    },
    {
      name: "gmail_forward",
      description: "Forward an existing Gmail message with original content and attachments",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          to: { type: "string", description: "Forward recipient email list" },
          note: { type: "string", description: "Optional note to include above the forwarded message" },
          cc: { type: "string", description: "Optional Cc recipient list" },
          bcc: { type: "string", description: "Optional Bcc recipient list" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id", "to"],
      },
    },
    {
      name: "gmail_get_thread",
      description: "Get all messages in an email thread/conversation",
      inputSchema: {
        type: "object",
        properties: {
          thread_id: { type: "string", description: "Gmail thread ID" },
          output: { type: "string", description: "Optional file path to save thread" },
          account: ACCOUNT_INPUT,
        },
        required: ["thread_id"],
      },
    },
    {
      name: "gmail_message_trash",
      description: "Move a Gmail message to trash",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_untrash",
      description: "Restore a Gmail message from trash",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_delete",
      description: "Permanently delete a Gmail message by message ID",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Gmail message ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_label_list",
      description: "List Gmail labels with IDs, names, types, and message/thread counts",
      inputSchema: {
        type: "object",
        properties: {
          account: ACCOUNT_INPUT,
        },
      },
    },
    {
      name: "gmail_label_create",
      description: "Create a Gmail user label",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "New label display name" },
          label_list_visibility: { type: "string", description: "Optional Gmail labelListVisibility value" },
          message_list_visibility: { type: "string", description: "Optional Gmail messageListVisibility value" },
          account: ACCOUNT_INPUT,
        },
        required: ["name"],
      },
    },
    {
      name: "gmail_label_update",
      description: "Update a Gmail user label",
      inputSchema: {
        type: "object",
        properties: {
          label_id: { type: "string", description: "Gmail label ID" },
          name: { type: "string", description: "Replacement label display name" },
          label_list_visibility: { type: "string", description: "Optional Gmail labelListVisibility value" },
          message_list_visibility: { type: "string", description: "Optional Gmail messageListVisibility value" },
          account: ACCOUNT_INPUT,
        },
        required: ["label_id"],
      },
    },
    {
      name: "gmail_label_delete",
      description: "Delete a Gmail user label",
      inputSchema: {
        type: "object",
        properties: {
          label_id: { type: "string", description: "Gmail label ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["label_id"],
      },
    },
    {
      name: "gmail_message_modify_labels",
      description: "Add or remove Gmail labels on one message by label ID",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          add_label_ids: LABEL_IDS_INPUT,
          remove_label_ids: LABEL_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_archive",
      description: "Archive one Gmail message by removing the INBOX label",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_mark_read",
      description: "Mark one Gmail message read by removing the UNREAD label",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_mark_unread",
      description: "Mark one Gmail message unread by adding the UNREAD label",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_star",
      description: "Star one Gmail message",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_unstar",
      description: "Unstar one Gmail message",
      inputSchema: {
        type: "object",
        properties: {
          message_id: MESSAGE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_id"],
      },
    },
    {
      name: "gmail_message_batch_get",
      description: "Get multiple Gmail messages by message ID",
      inputSchema: {
        type: "object",
        properties: {
          message_ids: MESSAGE_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_ids"],
      },
    },
    {
      name: "gmail_thread_batch_get",
      description: "Get multiple Gmail threads by thread ID",
      inputSchema: {
        type: "object",
        properties: {
          thread_ids: {
            type: "array",
            items: { type: "string" },
            description: "Gmail thread IDs",
          },
          max_messages: { type: "number", description: "Optional maximum messages per thread" },
          account: ACCOUNT_INPUT,
        },
        required: ["thread_ids"],
      },
    },
    {
      name: "gmail_message_batch_modify_labels",
      description: "Add or remove Gmail labels on multiple messages by label ID",
      inputSchema: {
        type: "object",
        properties: {
          message_ids: MESSAGE_IDS_INPUT,
          add_label_ids: LABEL_IDS_INPUT,
          remove_label_ids: LABEL_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_ids"],
      },
    },
    {
      name: "gmail_message_batch_trash",
      description: "Move multiple Gmail messages to trash",
      inputSchema: {
        type: "object",
        properties: {
          message_ids: MESSAGE_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_ids"],
      },
    },
    {
      name: "gmail_message_batch_untrash",
      description: "Restore multiple Gmail messages from trash",
      inputSchema: {
        type: "object",
        properties: {
          message_ids: MESSAGE_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_ids"],
      },
    },
    {
      name: "gmail_message_batch_delete",
      description: "Permanently delete multiple Gmail messages by message ID",
      inputSchema: {
        type: "object",
        properties: {
          message_ids: MESSAGE_IDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["message_ids"],
      },
    },
    // Sheets
    {
      name: "sheets_read",
      description: "Read data from a Google Sheet",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string", description: "Spreadsheet ID" },
          range: { type: "string", description: "Cell range (e.g., Sheet1!A1:B10)" },
          output: { type: "string", description: "Optional file path to save as CSV/JSON" },
        },
        required: ["spreadsheet_id", "range"],
      },
    },
    {
      name: "sheets_write",
      description: "Write data to a Google Sheet",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string", description: "Spreadsheet ID" },
          range: { type: "string", description: "Cell range" },
          values: { type: "array", description: "2D array of values" },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
    {
      name: "sheets_append",
      description: "Append rows to a Google Sheet",
      inputSchema: {
        type: "object",
        properties: {
          spreadsheet_id: { type: "string", description: "Spreadsheet ID" },
          range: { type: "string", description: "Sheet name or range" },
          values: { type: "array", description: "2D array of rows" },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
    {
      name: "sheets_create",
      description: "Create a new Google Spreadsheet",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Spreadsheet title" },
          sheets: { type: "array", description: "Optional array of sheet names to create" },
        },
        required: ["title"],
      },
    },
    // Docs
    {
      name: "docs_create",
      description: "Create a new Google Doc",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          content: { type: "string", description: "Initial content" },
        },
        required: ["title"],
      },
    },
    {
      name: "docs_read",
      description: "Read content from a Google Doc",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "Document ID" },
          output: { type: "string", description: "Optional file path to save as markdown" },
        },
        required: ["document_id"],
      },
    },
    {
      name: "docs_insert_image",
      description: "Insert an image into a Google Doc from a URL",
      inputSchema: {
        type: "object",
        properties: {
          document_id: { type: "string", description: "Document ID" },
          image_url: { type: "string", description: "Public URL of the image to insert" },
          index: { type: "number", description: "Position to insert (default: 1, start of doc)" },
        },
        required: ["document_id", "image_url"],
      },
    },
    // Slides
    {
      name: "slides_get_presentation",
      description: "Get a Google Slides presentation by ID or URL",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: PRESENTATION_ID_INPUT,
          fields: SLIDES_FIELDS_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["presentation_id"],
      },
    },
    {
      name: "slides_get_slide",
      description: "Get one slide from a Google Slides presentation by slide/page object ID",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: PRESENTATION_ID_INPUT,
          slide_id: SLIDE_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["presentation_id", "slide_id"],
      },
    },
    {
      name: "slides_get_thumbnail",
      description: "Get a temporary PNG thumbnail URL for one Google Slides slide",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: PRESENTATION_ID_INPUT,
          slide_id: SLIDE_ID_INPUT,
          thumbnail_size: {
            type: "string",
            description: "Thumbnail size: SMALL, MEDIUM, or LARGE (default: LARGE)",
          },
          account: ACCOUNT_INPUT,
        },
        required: ["presentation_id", "slide_id"],
      },
    },
    {
      name: "slides_batch_update",
      description: "Apply raw Google Slides presentations.batchUpdate requests",
      inputSchema: {
        type: "object",
        properties: {
          presentation_id: PRESENTATION_ID_INPUT,
          requests: SLIDES_REQUESTS_INPUT,
          write_control: SLIDES_WRITE_CONTROL_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["presentation_id", "requests"],
      },
    },
    // Drive
    {
      name: "drive_list",
      description: "List files in Google Drive",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          max_results: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "drive_upload",
      description: "Upload a file to Google Drive",
      inputSchema: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Local file path" },
          name: { type: "string", description: "Name in Drive" },
          folder_id: { type: "string", description: "Destination folder ID" },
        },
        required: ["file_path"],
      },
    },
    {
      name: "drive_update",
      description: "Replace a Drive file's content in place while preserving its file ID and shared links",
      inputSchema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "Existing Drive file ID" },
          file_path: { type: "string", description: "Local replacement file path" },
          name: { type: "string", description: "Optional replacement file name" },
        },
        required: ["file_id", "file_path"],
      },
    },
    {
      name: "drive_create_folder",
      description: "Create a folder in Google Drive",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Folder name" },
          parent_id: { type: "string", description: "Parent folder ID (optional, defaults to root)" },
        },
        required: ["name"],
      },
    },
    {
      name: "drive_move_file",
      description: "Move a file to a different folder in Google Drive",
      inputSchema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "File ID to move" },
          new_parent_id: { type: "string", description: "Destination folder ID" },
        },
        required: ["file_id", "new_parent_id"],
      },
    },
    {
      name: "drive_download",
      description: "Download a Drive file's bytes to a local path",
      inputSchema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "File ID to download" },
          output_path: { type: "string", description: "Local path to write to" },
        },
        required: ["file_id", "output_path"],
      },
    },
    {
      name: "drive_make_public",
      description: "Make a Drive file publicly viewable and get a direct URL (useful for embedding images in Docs)",
      inputSchema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "The file ID to make public" },
        },
        required: ["file_id"],
      },
    },
    {
      name: "drive_delete",
      description: "Delete a file from Google Drive (moves to trash)",
      inputSchema: {
        type: "object",
        properties: {
          file_id: { type: "string", description: "The file ID to delete" },
        },
        required: ["file_id"],
      },
    },
    // Calendar
    ...calendarDiscoveryToolDefinitions(ACCOUNT_INPUT),
    {
      name: "calendar_list",
      description: "List upcoming calendar events",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string", description: "Calendar ID to list (default: primary)" },
          days: { type: "number", description: "Days to look ahead (default 7)" },
          max_results: { type: "number", description: "Max events (default 20)" },
          account: ACCOUNT_INPUT,
        },
      },
    },
    {
      name: "calendar_create",
      description: "Create a calendar event",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string", description: "Calendar ID to create on (default: primary)" },
          summary: { type: "string", description: "Event title" },
          start: { type: "string", description: "Start datetime (ISO format)" },
          end: { type: "string", description: "End datetime (ISO format)" },
          time_zone: { type: "string", description: "Optional IANA time zone, e.g. America/New_York" },
          description: { type: "string", description: "Event description" },
          location: { type: "string", description: "Event location" },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Optional attendee email addresses",
          },
          create_meet: { type: "boolean", description: "Create a Google Meet conference link" },
          send_updates: {
            type: "string",
            description: "Google Calendar guest notification mode: all, externalOnly, or none",
          },
          account: ACCOUNT_INPUT,
        },
        required: ["summary", "start", "end"],
      },
    },
    {
      name: "calendar_quick_add",
      description: "Create event using natural language",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string", description: "Calendar ID for quick add (default: primary)" },
          text: { type: "string", description: "Natural language event description" },
          send_updates: {
            type: "string",
            description: "Google Calendar guest notification mode: all, externalOnly, or none",
          },
          account: ACCOUNT_INPUT,
        },
        required: ["text"],
      },
    },
    {
      name: "calendar_delete",
      description: "Delete a calendar event",
      inputSchema: {
        type: "object",
        properties: {
          calendar_id: { type: "string", description: "Calendar ID containing the event (default: primary)" },
          event_id: { type: "string", description: "Event ID to delete" },
          send_updates: {
            type: "string",
            description: "Google Calendar guest notification mode: all, externalOnly, or none",
          },
          account: ACCOUNT_INPUT,
        },
        required: ["event_id"],
      },
    },
    // Tasks
    {
      name: "tasks_tasklists_list",
      description: "List Google Tasks task lists",
      inputSchema: {
        type: "object",
        properties: {
          max_results: { type: "number", description: "Max task lists, 1-100" },
          next_page_token: { type: "string", description: "Pagination token from a previous response" },
          account: ACCOUNT_INPUT,
        },
      },
    },
    {
      name: "tasks_list",
      description: "List Google Tasks in a task list",
      inputSchema: {
        type: "object",
        properties: {
          tasklist_id: TASKLIST_ID_INPUT,
          max_results: { type: "number", description: "Max tasks, 1-100" },
          next_page_token: { type: "string", description: "Pagination token from a previous response" },
          show_completed: { type: "boolean", description: "Whether completed tasks are returned" },
          show_deleted: { type: "boolean", description: "Whether deleted tasks are returned" },
          show_hidden: { type: "boolean", description: "Whether hidden tasks are returned" },
          completed_min: { type: "string", description: "Lower RFC 3339 completion datetime filter" },
          completed_max: { type: "string", description: "Upper RFC 3339 completion datetime filter" },
          due_min: { type: "string", description: "Lower RFC 3339 due datetime filter" },
          due_max: { type: "string", description: "Upper RFC 3339 due datetime filter" },
          updated_min: { type: "string", description: "Lower RFC 3339 update datetime filter" },
          account: ACCOUNT_INPUT,
        },
      },
    },
    {
      name: "tasks_create",
      description: "Create a Google Task",
      inputSchema: {
        type: "object",
        properties: {
          tasklist_id: TASKLIST_ID_INPUT,
          title: { type: "string", description: "Task title" },
          notes: { type: "string", description: "Optional task notes" },
          due: TASK_DUE_INPUT,
          parent: { type: "string", description: "Optional parent task ID for a subtask" },
          previous: { type: "string", description: "Optional previous sibling task ID" },
          account: ACCOUNT_INPUT,
        },
        required: ["title"],
      },
    },
    {
      name: "tasks_update",
      description: "Update a Google Task title, notes, due date, or status",
      inputSchema: {
        type: "object",
        properties: {
          tasklist_id: TASKLIST_ID_INPUT,
          task_id: TASK_ID_INPUT,
          title: { type: "string", description: "Replacement task title" },
          notes: { type: ["string", "null"], description: "Replacement task notes; pass null to clear" },
          due: { ...TASK_DUE_INPUT, type: ["string", "null"], description: "Replacement RFC 3339 due datetime; pass null to clear" },
          status: { type: "string", description: "Task status: needsAction or completed" },
          account: ACCOUNT_INPUT,
        },
        required: ["task_id"],
      },
    },
    {
      name: "tasks_complete",
      description: "Mark a Google Task completed",
      inputSchema: {
        type: "object",
        properties: {
          tasklist_id: TASKLIST_ID_INPUT,
          task_id: TASK_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["task_id"],
      },
    },
    {
      name: "tasks_delete",
      description: "Delete a Google Task",
      inputSchema: {
        type: "object",
        properties: {
          tasklist_id: TASKLIST_ID_INPUT,
          task_id: TASK_ID_INPUT,
          account: ACCOUNT_INPUT,
        },
        required: ["task_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Account Management
      case "account_list": {
        const accounts = getAvailableAccounts();
        return {
          content: [{
            type: "text",
            text: accounts.length > 0
              ? `Available accounts:\n${accounts.map(a => `- ${a}${a === currentAccount ? " (active)" : ""}`).join("\n")}`
              : `No accounts configured. Run npm run auth to create accounts in ${ACCOUNTS_DIR}.`,
          }],
        };
      }

      case "account_switch": {
        const account = args?.account as string;
        const accounts = getAvailableAccounts();
        if (!accounts.includes(account)) {
          return {
            content: [{ type: "text", text: `Account '${account}' not found. Available: ${accounts.join(", ")}` }],
            isError: true,
          };
        }
        currentAccount = account;
        saveCurrentAccount(account);  // Persist to disk
        return { content: [{ type: "text", text: `Switched to account: ${account}` }] };
      }

      case "account_current": {
        return {
          content: [{
            type: "text",
            text: currentAccount ? `Current account: ${currentAccount}` : "No account selected (using default state token)",
          }],
        };
      }

      // Gmail
      case "gmail_profile":
      case "gmail_history_list": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        return runGmailDiscoveryTool(name, gmail, args);
      }

      case "gmail_send": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const replyMessageId = typeof args?.reply_message_id === "string"
          ? args.reply_message_id.trim()
          : "";
        const original = replyMessageId
          ? await gmail.users.messages.get({
              userId: "me",
              id: replyMessageId,
              format: "full",
            })
          : null;
        const profile = await gmail.users.getProfile({ userId: "me" });
        const from = sanitizeHeaderValue(
          requireString(
            profile.data.emailAddress,
            "gmail profile emailAddress"
          ),
          "gmail profile emailAddress"
        );
        const attachments = loadAttachmentFiles(optionalAttachmentPaths(args));
        const outgoing = replyMessageId
          ? buildGmailDraftMessage({
              to: args?.to,
              cc: args?.cc,
              bcc: args?.bcc,
              subject: args?.subject,
              body: args?.body,
              replyMessageId,
              replyAll: args?.reply_all,
              originalMessage: original?.data,
              selfEmail: profile.data.emailAddress,
            })
          : {
              to: args?.to as string,
              cc: args?.cc as string | undefined,
              bcc: args?.bcc as string | undefined,
              subject: args?.subject as string,
              body: args?.body as string,
              threadId: undefined,
              contentType: undefined,
              inReplyTo: undefined,
              references: undefined,
            };
        const raw = buildRawEmail({
          from,
          to: outgoing.to,
          cc: outgoing.cc,
          bcc: outgoing.bcc,
          subject: outgoing.subject,
          body: args?.body,
          contentType: outgoing.contentType,
          inReplyTo: outgoing.inReplyTo,
          references: outgoing.references,
          attachments,
        });
        const requestBody: { raw: string; threadId?: string } = { raw };
        if (outgoing.threadId) {
          requestBody.threadId = outgoing.threadId;
        }
        const sent = await gmail.users.messages.send({
          userId: "me",
          requestBody,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sent: true,
              ...normalizeGmailSendResult(sent.data),
            }, null, 2),
          }],
        };
      }

      case "gmail_search": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        return runGmailSearch(gmail, args);
      }

      case "gmail_search_headers": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        return runGmailHeaderSearch(gmail, args);
      }

      case "gmail_draft": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const replyMessageId = typeof args?.reply_message_id === "string"
          ? args.reply_message_id.trim()
          : "";
        const original = replyMessageId
          ? await gmail.users.messages.get({
              userId: "me",
              id: replyMessageId,
              format: "full",
            })
          : null;
        const profile = replyMessageId && args?.reply_all === true
          ? await gmail.users.getProfile({ userId: "me" })
          : null;
        const draftMessage = buildGmailDraftMessage({
          to: args?.to,
          cc: args?.cc,
          bcc: args?.bcc,
          subject: args?.subject,
          body: args?.body,
          replyMessageId,
          replyAll: args?.reply_all,
          originalMessage: original?.data,
          selfEmail: profile?.data.emailAddress,
        });
        const attachments = loadAttachmentFiles(optionalAttachmentPaths(args));
        const raw = buildRawEmail({
          to: draftMessage.to,
          cc: draftMessage.cc,
          bcc: draftMessage.bcc,
          subject: draftMessage.subject,
          body: args?.body,
          contentType: draftMessage.contentType,
          inReplyTo: draftMessage.inReplyTo,
          references: draftMessage.references,
          attachments,
        });
        const messageRequest: { raw: string; threadId?: string } = { raw };
        if (draftMessage.threadId) {
          messageRequest.threadId = draftMessage.threadId;
        }
        const draft = await gmail.users.drafts.create({
          userId: "me",
          requestBody: { message: messageRequest },
        });
        const threadText = draftMessage.threadId ? `\nThread: ${draftMessage.threadId}` : "";
        return {
          content: [{
            type: "text",
            text: `Draft created: ${draft.data.id}${threadText}\nTo: ${draftMessage.to}`,
          }],
        };
      }

      case "gmail_draft_list": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const maxResults = (args?.max_results as number) || 10;
        const listed = await gmail.users.drafts.list({
          userId: "me",
          maxResults,
          pageToken: args?.next_page_token as string | undefined,
        });
        const drafts = await Promise.all(
          (listed.data.drafts || []).map(async (draftRef) => {
            const draft = await gmail.users.drafts.get({
              userId: "me",
              id: draftRef.id!,
              format: "full",
            });
            const message = draft.data.message;
            const headers = message?.payload?.headers || [];
            return {
              draftId: draft.data.id || draftRef.id,
              messageId: message?.id,
              threadId: message?.threadId,
              subject: getHeaderValue(headers, "Subject"),
              to: getHeaderValue(headers, "To"),
              cc: getHeaderValue(headers, "Cc"),
              date: getHeaderValue(headers, "Date"),
              snippet: message?.snippet,
            };
          })
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              drafts,
              nextPageToken: listed.data.nextPageToken || null,
            }, null, 2),
          }],
        };
      }

      case "gmail_draft_get": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const draftId = requireString(args?.draft_id, "draft_id");
        const draft = await gmail.users.drafts.get({
          userId: "me",
          id: draftId,
          format: "full",
        });
        const message = draft.data.message;
        const headers = message?.payload?.headers || [];
        const body = extractGmailPayloadBody(message?.payload);
        const draftData = {
          draftId: draft.data.id || draftId,
          messageId: message?.id,
          threadId: message?.threadId,
          subject: getHeaderValue(headers, "Subject"),
          to: getHeaderValue(headers, "To"),
          cc: getHeaderValue(headers, "Cc"),
          bcc: getHeaderValue(headers, "Bcc"),
          date: getHeaderValue(headers, "Date"),
          snippet: message?.snippet,
          labels: message?.labelIds,
          body: body.text || body.html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim(),
          bodyHtml: body.html,
        };
        const text = JSON.stringify(draftData, null, 2);
        if (args?.output) {
          const filePath = args.output as string;
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Draft saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "gmail_draft_update": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const draftId = requireString(args?.draft_id, "draft_id");
        const currentDraft = await gmail.users.drafts.get({
          userId: "me",
          id: draftId,
          format: "full",
        });
        const currentMessage = currentDraft.data.message;
        if (!currentMessage?.payload) {
          throw new Error(`Draft '${draftId}' did not include a readable message payload.`);
        }

        const headers = currentMessage.payload.headers || [];
        const currentBody = extractGmailPayloadBody(currentMessage.payload);
        const attachments = hasToolArg(args, "attachments")
          ? loadAttachmentFiles(optionalAttachmentPaths(args))
          : currentMessage.id
            ? await loadGmailPayloadAttachments(gmail, currentMessage.id, currentMessage.payload)
            : [];
        const raw = buildRawEmail({
          to: optionalToolString(args, "to") || getHeaderValue(headers, "To"),
          cc: hasToolArg(args, "cc") ? optionalToolString(args, "cc") : getHeaderValue(headers, "Cc"),
          bcc: hasToolArg(args, "bcc") ? optionalToolString(args, "bcc") : getHeaderValue(headers, "Bcc"),
          subject: optionalToolString(args, "subject") || getHeaderValue(headers, "Subject"),
          body: hasToolArg(args, "body")
            ? args?.body
            : currentBody.html || currentBody.text || "",
          contentType: chooseDraftContentType(currentMessage.payload),
          inReplyTo: getHeaderValue(headers, "In-Reply-To"),
          references: getHeaderValue(headers, "References"),
          attachments,
        });
        const messageRequest: { raw: string; threadId?: string } = { raw };
        if (currentMessage.threadId) {
          messageRequest.threadId = currentMessage.threadId;
        }
        const updated = await gmail.users.drafts.update({
          userId: "me",
          id: draftId,
          requestBody: { message: messageRequest },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              updated: true,
              draftId: updated.data.id || draftId,
              messageId: updated.data.message?.id,
              threadId: updated.data.message?.threadId || currentMessage.threadId,
            }, null, 2),
          }],
        };
      }

      case "gmail_draft_delete": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const draftId = requireString(args?.draft_id, "draft_id");
        await gmail.users.drafts.delete({
          userId: "me",
          id: draftId,
        });
        return { content: [{ type: "text", text: `Draft deleted: ${draftId}` }] };
      }

      case "gmail_draft_send": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const draftId = requireString(args?.draft_id, "draft_id");
        const sent = await gmail.users.drafts.send({
          userId: "me",
          requestBody: { id: draftId },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sent: true,
              draftId,
              messageId: sent.data.id,
              threadId: sent.data.threadId,
            }, null, 2),
          }],
        };
      }

      case "gmail_get": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = args?.message_id as string;
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });
        const headers = msg.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "";
        const from = headers.find((h) => h.name === "From")?.value || "";
        const to = headers.find((h) => h.name === "To")?.value || "";
        const date = headers.find((h) => h.name === "Date")?.value || "";

        // Extract body from payload
        function extractBody(payload: any): { text: string; html: string } {
          const result = { text: "", html: "" };
          if (payload.parts) {
            for (const part of payload.parts) {
              if (part.mimeType === "text/plain" && part.body?.data) {
                result.text = Buffer.from(part.body.data, "base64url").toString("utf-8");
              } else if (part.mimeType === "text/html" && part.body?.data) {
                result.html = Buffer.from(part.body.data, "base64url").toString("utf-8");
              } else if (part.parts) {
                const nested = extractBody(part);
                if (nested.text) result.text = nested.text;
                if (nested.html) result.html = nested.html;
              }
            }
          } else if (payload.body?.data) {
            const decoded = Buffer.from(payload.body.data, "base64url").toString("utf-8");
            if (payload.mimeType === "text/html") {
              result.html = decoded;
            } else {
              result.text = decoded;
            }
          }
          return result;
        }

        const body = extractBody(msg.data.payload);
        // Prefer plain text, fall back to stripping HTML
        let bodyText = body.text;
        if (!bodyText && body.html) {
          bodyText = body.html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        }

        const emailData = {
          id: messageId,
          threadId: msg.data.threadId,
          subject,
          from,
          to,
          date,
          snippet: msg.data.snippet,
          body: bodyText,
          bodyHtml: body.html,
          labels: msg.data.labelIds,
        };

        const text = JSON.stringify(emailData, null, 2);
        if (args?.output) {
          const filePath = args.output as string;
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "gmail_get_raw": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const message = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "raw",
        });
        const normalized = normalizeGmailRawMessage(message.data);
        if (normalized.messageId !== messageId) {
          throw new Error("Gmail raw response message ID does not match the request");
        }
        return {
          content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
        };
      }

      case "gmail_list_attachments": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = args?.message_id as string;
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        function findAttachments(parts: any[], results: any[] = []): any[] {
          if (!parts) return results;
          for (const part of parts) {
            if (part.filename && part.body?.attachmentId) {
              results.push({
                filename: part.filename,
                mimeType: part.mimeType,
                attachmentId: part.body.attachmentId,
                size: part.body.size,
              });
            }
            if (part.parts) findAttachments(part.parts, results);
          }
          return results;
        }

        const attachments = findAttachments(msg.data.payload?.parts || []);
        return { content: [{ type: "text", text: JSON.stringify(attachments, null, 2) }] };
      }

      case "gmail_get_attachment": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = args?.message_id as string;
        const attachmentId = args?.attachment_id as string;
        const filename = args?.filename as string || "attachment";
        const outputPath = args?.output as string;

        const attachment = await gmail.users.messages.attachments.get({
          userId: "me",
          messageId,
          id: attachmentId,
        });

        const data = Buffer.from(attachment.data.data!, "base64url");
        const ext = filename.split(".").pop()?.toLowerCase();

        // Handle document files - extract text
        if (ext === "docx") {
          const tempPath = join(tmpdir(), `gmail-attachment-${Date.now()}.docx`);
          const tempDir = join(tmpdir(), `gmail-doc-${Date.now()}`);
          writeFileSync(tempPath, data);
          try {
            execSync(`unzip -o "${tempPath}" -d "${tempDir}"`, { stdio: "pipe" });
            const xmlPath = join(tempDir, "word", "document.xml");
            if (existsSync(xmlPath)) {
              const xml = readFileSync(xmlPath, "utf-8");
              const text = xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
              // Cleanup
              execSync(`rm -rf "${tempDir}" "${tempPath}"`, { stdio: "pipe" });
              if (outputPath) {
                writeFileSync(outputPath, text, "utf-8");
                return { content: [{ type: "text", text: `Extracted text saved to ${outputPath}` }] };
              }
              return { content: [{ type: "text", text: `# ${filename}\n\n${text}` }] };
            }
          } catch (e: any) {
            return { content: [{ type: "text", text: `Error extracting docx: ${e.message}` }], isError: true };
          }
        }

        // Handle text files
        if (["txt", "md", "csv", "json", "xml", "html", "htm"].includes(ext || "")) {
          const text = data.toString("utf-8");
          if (outputPath) {
            writeFileSync(outputPath, text, "utf-8");
            return { content: [{ type: "text", text: `Saved to ${outputPath}` }] };
          }
          return { content: [{ type: "text", text }] };
        }

        // Handle PDF - save and notify
        if (ext === "pdf") {
          const savePath = outputPath || join(DEFAULT_OUTPUT_DIR, filename);
          writeFileSync(savePath, data);
          return { content: [{ type: "text", text: `PDF saved to ${savePath} (use a PDF reader to view)` }] };
        }

        // Binary files - must save to disk
        if (!outputPath) {
          return {
            content: [{ type: "text", text: `Binary file (${ext}). Provide 'output' path to save.` }],
            isError: true,
          };
        }
        writeFileSync(outputPath, data);
        return { content: [{ type: "text", text: `Saved ${filename} to ${outputPath}` }] };
      }

      case "gmail_reply": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const original = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });
        const profile = args?.reply_all === true
          ? await gmail.users.getProfile({ userId: "me" })
          : null;
        const replyMessage = buildGmailDraftMessage({
          to: args?.to,
          cc: args?.cc,
          bcc: args?.bcc,
          subject: args?.subject,
          body: args?.body,
          replyMessageId: messageId,
          replyAll: args?.reply_all,
          originalMessage: original.data,
          selfEmail: profile?.data.emailAddress,
        });
        const raw = buildRawEmail({
          to: replyMessage.to,
          cc: replyMessage.cc,
          bcc: replyMessage.bcc,
          subject: replyMessage.subject,
          body: args?.body,
          contentType: replyMessage.contentType,
          inReplyTo: replyMessage.inReplyTo,
          references: replyMessage.references,
          attachments: loadAttachmentFiles(optionalAttachmentPaths(args)),
        });
        const sent = await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw,
            threadId: replyMessage.threadId,
          },
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              sent: true,
              replyToMessageId: messageId,
              to: replyMessage.to,
              ...normalizeGmailSendResult(sent.data),
            }, null, 2),
          }],
        };
      }

      case "gmail_forward": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const original = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });
        const headers = original.data.payload?.headers || [];
        const originalBody = extractGmailPayloadBody(original.data.payload);
        const originalSubject = getHeaderValue(headers, "Subject");
        const subject = originalSubject.toLowerCase().startsWith("fwd:")
          ? originalSubject
          : `Fwd: ${originalSubject}`;
        const note = optionalToolString(args, "note");
        const body = [
          note ? `<p>${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : "",
          "<br><br>---------- Forwarded message ---------<br>",
          `<b>From:</b> ${escapeHtml(getHeaderValue(headers, "From"))}<br>`,
          `<b>Date:</b> ${escapeHtml(getHeaderValue(headers, "Date"))}<br>`,
          `<b>Subject:</b> ${escapeHtml(originalSubject)}<br>`,
          `<b>To:</b> ${escapeHtml(getHeaderValue(headers, "To"))}<br><br>`,
          originalBody.html || `<pre>${escapeHtml(originalBody.text)}</pre>`,
        ].join("");
        const attachments = original.data.id && original.data.payload
          ? await loadGmailPayloadAttachments(gmail, original.data.id, original.data.payload)
          : [];
        const raw = buildRawEmail({
          to: args?.to,
          cc: args?.cc,
          bcc: args?.bcc,
          subject,
          body,
          contentType: "text/html; charset=utf-8",
          attachments,
        });
        const sent = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              forwarded: true,
              sourceMessageId: messageId,
              messageId: sent.data.id,
              threadId: sent.data.threadId,
              attachments: attachments.length,
            }, null, 2),
          }],
        };
      }

      case "gmail_get_thread": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const threadId = args?.thread_id as string;

        const thread = await gmail.users.threads.get({
          userId: "me",
          id: threadId,
          format: "full",
        });

        function extractBody(payload: any): string {
          if (payload.parts) {
            for (const part of payload.parts) {
              if (part.mimeType === "text/plain" && part.body?.data) {
                return Buffer.from(part.body.data, "base64url").toString("utf-8");
              }
              if (part.parts) {
                const nested = extractBody(part);
                if (nested) return nested;
              }
            }
            // Fallback to HTML
            for (const part of payload.parts) {
              if (part.mimeType === "text/html" && part.body?.data) {
                const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
                return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              }
            }
          } else if (payload.body?.data) {
            return Buffer.from(payload.body.data, "base64url").toString("utf-8");
          }
          return "";
        }

        const messages = (thread.data.messages || []).map((msg) => {
          const headers = msg.payload?.headers || [];
          return {
            id: msg.id,
            from: headers.find((h) => h.name === "From")?.value,
            to: headers.find((h) => h.name === "To")?.value,
            date: headers.find((h) => h.name === "Date")?.value,
            subject: headers.find((h) => h.name === "Subject")?.value,
            body: extractBody(msg.payload),
          };
        });

        const result = {
          threadId,
          subject: messages[0]?.subject,
          messageCount: messages.length,
          messages,
        };

        const text = JSON.stringify(result, null, 2);
        if (args?.output) {
          writeFileSync(args.output as string, text, "utf-8");
          return { content: [{ type: "text", text: `Thread saved to ${args.output}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "gmail_message_trash": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const trashed = await gmail.users.messages.trash({
          userId: "me",
          id: messageId,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              trashed: true,
              messageId: trashed.data.id || messageId,
              threadId: trashed.data.threadId,
              labels: trashed.data.labelIds,
            }, null, 2),
          }],
        };
      }

      case "gmail_message_untrash": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const restored = await gmail.users.messages.untrash({
          userId: "me",
          id: messageId,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              untrashed: true,
              messageId: restored.data.id || messageId,
              threadId: restored.data.threadId,
              labels: restored.data.labelIds,
            }, null, 2),
          }],
        };
      }

      case "gmail_message_delete": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        await gmail.users.messages.delete({
          userId: "me",
          id: messageId,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              deleted: true,
              messageId,
            }, null, 2),
          }],
        };
      }

      case "gmail_label_list": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const labels = await gmail.users.labels.list({ userId: "me" });
        return {
          content: [{
            type: "text",
            text: JSON.stringify((labels.data.labels || []).map((label) => ({
              id: label.id,
              name: label.name,
              type: label.type,
              labelListVisibility: label.labelListVisibility,
              messageListVisibility: label.messageListVisibility,
              messagesTotal: label.messagesTotal,
              messagesUnread: label.messagesUnread,
              threadsTotal: label.threadsTotal,
              threadsUnread: label.threadsUnread,
            })), null, 2),
          }],
        };
      }

      case "gmail_label_create": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const created = await gmail.users.labels.create({
          userId: "me",
          requestBody: {
            name: requireString(args?.name, "name"),
            labelListVisibility: optionalToolString(args, "label_list_visibility") as any,
            messageListVisibility: optionalToolString(args, "message_list_visibility") as any,
          },
        });
        return { content: [{ type: "text", text: JSON.stringify(created.data, null, 2) }] };
      }

      case "gmail_label_update": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const labelId = requireString(args?.label_id, "label_id");
        const updated = await gmail.users.labels.patch({
          userId: "me",
          id: labelId,
          requestBody: {
            name: optionalToolString(args, "name"),
            labelListVisibility: optionalToolString(args, "label_list_visibility") as any,
            messageListVisibility: optionalToolString(args, "message_list_visibility") as any,
          },
        });
        return { content: [{ type: "text", text: JSON.stringify(updated.data, null, 2) }] };
      }

      case "gmail_label_delete": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const labelId = requireString(args?.label_id, "label_id");
        await gmail.users.labels.delete({
          userId: "me",
          id: labelId,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ deleted: true, labelId }, null, 2),
          }],
        };
      }

      case "gmail_message_modify_labels":
      case "gmail_message_archive":
      case "gmail_message_mark_read":
      case "gmail_message_mark_unread":
      case "gmail_message_star":
      case "gmail_message_unstar": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = requireString(args?.message_id, "message_id");
        const addLabelIds = optionalStringArray(args, "add_label_ids") || [];
        const removeLabelIds = optionalStringArray(args, "remove_label_ids") || [];

        if (name === "gmail_message_archive") removeLabelIds.push("INBOX");
        if (name === "gmail_message_mark_read") removeLabelIds.push("UNREAD");
        if (name === "gmail_message_mark_unread") addLabelIds.push("UNREAD");
        if (name === "gmail_message_star") addLabelIds.push("STARRED");
        if (name === "gmail_message_unstar") removeLabelIds.push("STARRED");

        if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
          throw new Error("At least one label must be added or removed");
        }

        const modified = await gmail.users.messages.modify({
          userId: "me",
          id: messageId,
          requestBody: {
            addLabelIds: [...new Set(addLabelIds)],
            removeLabelIds: [...new Set(removeLabelIds)],
          },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              messageId: modified.data.id || messageId,
              threadId: modified.data.threadId,
              labels: modified.data.labelIds,
            }, null, 2),
          }],
        };
      }

      case "gmail_message_batch_get": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageIds = requireStringArray(args, "message_ids");
        const messages = await Promise.all(messageIds.map(async (messageId) => {
          const message = await gmail.users.messages.get({
            userId: "me",
            id: messageId,
            format: "full",
          });
          return summarizeGmailMessage(message.data);
        }));
        return { content: [{ type: "text", text: JSON.stringify(messages, null, 2) }] };
      }

      case "gmail_thread_batch_get": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const threadIds = requireStringArray(args, "thread_ids");
        const maxMessages = typeof args?.max_messages === "number" && args.max_messages > 0
          ? Math.floor(args.max_messages)
          : undefined;
        const threads = await Promise.all(threadIds.map(async (threadId) => {
          const thread = await gmail.users.threads.get({
            userId: "me",
            id: threadId,
            format: "full",
          });
          const allMessages = thread.data.messages || [];
          const selectedMessages = maxMessages ? allMessages.slice(-maxMessages) : allMessages;
          return {
            threadId: thread.data.id || threadId,
            messageCount: allMessages.length,
            messages: selectedMessages.map(summarizeGmailMessage),
          };
        }));
        return { content: [{ type: "text", text: JSON.stringify(threads, null, 2) }] };
      }

      case "gmail_message_batch_modify_labels": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageIds = requireStringArray(args, "message_ids");
        const addLabelIds = optionalStringArray(args, "add_label_ids") || [];
        const removeLabelIds = optionalStringArray(args, "remove_label_ids") || [];
        if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
          throw new Error("At least one label must be added or removed");
        }
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: messageIds,
            addLabelIds: [...new Set(addLabelIds)],
            removeLabelIds: [...new Set(removeLabelIds)],
          },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              modified: true,
              messageIds,
              addedLabelIds: [...new Set(addLabelIds)],
              removedLabelIds: [...new Set(removeLabelIds)],
            }, null, 2),
          }],
        };
      }

      case "gmail_message_batch_trash":
      case "gmail_message_batch_untrash": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageIds = requireStringArray(args, "message_ids");
        const trashing = name === "gmail_message_batch_trash";
        const messages = await Promise.all(messageIds.map(async (messageId) => {
          const message = trashing
            ? await gmail.users.messages.trash({ userId: "me", id: messageId })
            : await gmail.users.messages.untrash({ userId: "me", id: messageId });
          return {
            messageId: message.data.id || messageId,
            threadId: message.data.threadId,
            labels: message.data.labelIds,
          };
        }));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              [trashing ? "trashed" : "untrashed"]: true,
              messages,
            }, null, 2),
          }],
        };
      }

      case "gmail_message_batch_delete": {
        const auth = getAuthForArgs(args);
        const gmail = google.gmail({ version: "v1", auth });
        const messageIds = requireStringArray(args, "message_ids");
        await gmail.users.messages.batchDelete({
          userId: "me",
          requestBody: { ids: messageIds },
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              deleted: true,
              messageIds,
            }, null, 2),
          }],
        };
      }

      // Sheets
      case "sheets_read": {
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId: args?.spreadsheet_id as string,
          range: args?.range as string,
        });
        const text = JSON.stringify(res.data.values, null, 2);
        if (args?.output) {
          const filePath = args.output as string;
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "sheets_write": {
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });
        await sheets.spreadsheets.values.update({
          spreadsheetId: args?.spreadsheet_id as string,
          range: args?.range as string,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: args?.values as any[][] },
        });
        return { content: [{ type: "text", text: "Data written successfully" }] };
      }

      case "sheets_append": {
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });
        await sheets.spreadsheets.values.append({
          spreadsheetId: args?.spreadsheet_id as string,
          range: args?.range as string,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: args?.values as any[][] },
        });
        return { content: [{ type: "text", text: "Rows appended successfully" }] };
      }

      case "sheets_create": {
        const auth = getAuth();
        const sheets = google.sheets({ version: "v4", auth });
        const title = args?.title as string;
        const sheetNames = (args?.sheets as string[]) || ["Sheet1"];

        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title },
            sheets: sheetNames.map((name, index) => ({
              properties: { sheetId: index, title: name },
            })),
          },
        });

        const spreadsheetId = spreadsheet.data.spreadsheetId;
        const url = spreadsheet.data.spreadsheetUrl;
        return {
          content: [{
            type: "text",
            text: `Created spreadsheet: ${url}\nID: ${spreadsheetId}`,
          }],
        };
      }

      // Docs
      case "docs_create": {
        const auth = getAuth();
        const docs = google.docs({ version: "v1", auth });
        const doc = await docs.documents.create({
          requestBody: { title: args?.title as string },
        });
        if (args?.content) {
          await docs.documents.batchUpdate({
            documentId: doc.data.documentId!,
            requestBody: {
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: args.content as string,
                  },
                },
              ],
            },
          });
        }
        return {
          content: [
            {
              type: "text",
              text: `Doc created: https://docs.google.com/document/d/${doc.data.documentId}`,
            },
          ],
        };
      }

      case "docs_read": {
        const auth = getAuth();
        const docs = google.docs({ version: "v1", auth });
        const doc = await docs.documents.get({ documentId: args?.document_id as string });
        const content = doc.data.body?.content
          ?.map((block) =>
            block.paragraph?.elements?.map((e) => e.textRun?.content || "").join("")
          )
          .join("");
        const text = content || "(empty)";
        if (args?.output) {
          const filePath = args.output as string;
          const title = doc.data.title || "untitled";
          const outputPath = filePath.endsWith(".md") ? filePath : generateOutputPath("gdoc", title);
          writeFileSync(outputPath, `# ${title}\n\n${text}`, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${outputPath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "docs_insert_image": {
        const auth = getAuth();
        const docs = google.docs({ version: "v1", auth });
        const documentId = args?.document_id as string;
        const imageUrl = args?.image_url as string;
        const index = (args?.index as number) || 1;
        await docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: [
              {
                insertInlineImage: {
                  location: { index },
                  uri: imageUrl,
                },
              },
            ],
          },
        });
        return { content: [{ type: "text", text: "Image inserted into document" }] };
      }

      // Slides
      case "slides_get_presentation": {
        const presentationId = normalizePresentationId(args);
        const fields = optionalToolString(args, "fields");
        const auth = getAuthForArgs(args);
        const slides = google.slides({ version: "v1", auth });
        const presentation = await slides.presentations.get({
          presentationId,
          fields,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(presentation.data, null, 2) }],
        };
      }

      case "slides_get_slide": {
        const presentationId = normalizePresentationId(args);
        const slideId = requireString(args?.slide_id, "slide_id");
        const auth = getAuthForArgs(args);
        const slides = google.slides({ version: "v1", auth });
        const presentation = await slides.presentations.get({ presentationId });
        const slide = presentation.data.slides?.find((entry) => entry.objectId === slideId);
        if (!slide) {
          throw new Error(`slide_id not found: ${slideId}`);
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId: presentation.data.presentationId,
              title: presentation.data.title,
              slide,
            }, null, 2),
          }],
        };
      }

      case "slides_get_thumbnail": {
        const presentationId = normalizePresentationId(args);
        const slideId = requireString(args?.slide_id, "slide_id");
        const thumbnailSize = optionalSlidesThumbnailSize(args);
        const auth = getAuthForArgs(args);
        const slides = google.slides({ version: "v1", auth });
        const thumbnail = await slides.presentations.pages.getThumbnail({
          presentationId,
          pageObjectId: slideId,
          "thumbnailProperties.mimeType": "PNG",
          "thumbnailProperties.thumbnailSize": thumbnailSize,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId,
              slideId,
              thumbnailSize,
              ...thumbnail.data,
            }, null, 2),
          }],
        };
      }

      case "slides_batch_update": {
        const presentationId = normalizePresentationId(args);
        const requests = requireObjectArray(args, "requests");
        const writeControl = optionalObject(args, "write_control");
        const auth = getAuthForArgs(args);
        const slides = google.slides({ version: "v1", auth });
        const requestBody: Record<string, unknown> = { requests };
        if (writeControl) {
          requestBody.writeControl = writeControl;
        }
        const update = await slides.presentations.batchUpdate({
          presentationId,
          requestBody,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              presentationId,
              replies: update.data.replies || [],
              writeControl: update.data.writeControl,
            }, null, 2),
          }],
        };
      }

      // Drive
      case "drive_list": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const res = await drive.files.list({
          q: args?.query as string,
          pageSize: (args?.max_results as number) || 20,
          fields: "files(id, name, mimeType, webViewLink)",
        });
        return { content: [{ type: "text", text: JSON.stringify(res.data.files, null, 2) }] };
      }

      case "drive_upload": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fs = await import("fs");
        const path = await import("path");
        const filePath = args?.file_path as string;
        const fileName = (args?.name as string) || path.basename(filePath);
        const res = await drive.files.create({
          requestBody: {
            name: fileName,
            parents: args?.folder_id ? [args.folder_id as string] : undefined,
          },
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: "id, webViewLink",
        });
        return {
          content: [{ type: "text", text: `Uploaded: ${res.data.webViewLink}` }],
        };
      }

      case "drive_update": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fs = await import("fs");
        const fileId = requireString(args?.file_id, "file_id");
        const filePath = requireString(args?.file_path, "file_path");
        const name = optionalToolString(args, "name");
        const res = await drive.files.update({
          fileId,
          requestBody: name ? { name } : undefined,
          media: {
            body: fs.createReadStream(filePath),
          },
          fields: "id, name, mimeType, modifiedTime, webViewLink",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(res.data, null, 2) }],
        };
      }

      case "drive_create_folder": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const name = requireString(args?.name, "name");
        const parentId = args?.parent_id as string | undefined;
        const res = await drive.files.create({
          requestBody: {
            name,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : undefined,
          },
          fields: "id, name, mimeType, parents",
        });
        return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
      }

      case "drive_move_file": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fileId = requireString(args?.file_id, "file_id");
        const newParentId = requireString(args?.new_parent_id, "new_parent_id");
        const file = await drive.files.get({
          fileId,
          fields: "parents",
        });
        const previousParents = (file.data.parents || []).join(",");
        const updateParams: {
          fileId: string;
          addParents: string;
          removeParents?: string;
          fields: string;
        } = {
          fileId,
          addParents: newParentId,
          fields: "id, name, parents",
        };
        if (previousParents) {
          updateParams.removeParents = previousParents;
        }
        const res = await drive.files.update(updateParams);
        return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
      }

      case "drive_download": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fs = await import("fs");
        const path = await import("path");
        const { pipeline } = await import("stream/promises");
        const fileId = requireString(args?.file_id, "file_id");
        const outputPath = requireString(args?.output_path, "output_path");
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const response = await drive.files.get(
          { fileId, alt: "media" },
          { responseType: "stream" }
        );
        await pipeline(response.data as NodeJS.ReadableStream, fs.createWriteStream(outputPath));
        const stat = fs.statSync(outputPath);
        return {
          content: [{ type: "text", text: JSON.stringify({ path: outputPath, bytes: stat.size }) }],
        };
      }

      case "drive_make_public": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fileId = args?.file_id as string;
        await drive.permissions.create({
          fileId,
          requestBody: {
            role: "reader",
            type: "anyone",
          },
        });
        const publicUrl = `https://drive.google.com/uc?id=${fileId}`;
        return {
          content: [{ type: "text", text: `File is now public.\nDirect URL: ${publicUrl}` }],
        };
      }

      case "drive_delete": {
        const auth = getAuth();
        const drive = google.drive({ version: "v3", auth });
        const fileId = args?.file_id as string;
        await drive.files.delete({ fileId });
        return {
          content: [{ type: "text", text: `Deleted file: ${fileId}` }],
        };
      }

      // Calendar
      case "calendar_discovery_page": {
        const auth = getAuthForArgs(args);
        const calendar = google.calendar({ version: "v3", auth });
        const gmail = google.gmail({ version: "v1", auth });
        return runCalendarDiscoveryPage(calendar, gmail, args);
      }

      case "calendar_list": {
        const auth = getAuthForArgs(args);
        const calendar = google.calendar({ version: "v3", auth });
        const days = (args?.days as number) || 7;
        const now = new Date();
        const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const res = await calendar.events.list({
          calendarId: optionalToolString(args, "calendar_id") || "primary",
          timeMin: now.toISOString(),
          timeMax: future.toISOString(),
          maxResults: (args?.max_results as number) || 20,
          singleEvents: true,
          orderBy: "startTime",
        });
        const events = (res.data.items || []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location,
        }));
        return { content: [{ type: "text", text: JSON.stringify(events, null, 2) }] };
      }

      case "calendar_create": {
        const auth = getAuthForArgs(args);
        const calendar = google.calendar({ version: "v3", auth });
        const insert = buildCalendarEventInsert(args || {});
        const event = await calendar.events.insert(insert);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              eventId: event.data.id,
              calendarId: insert.calendarId,
              htmlLink: event.data.htmlLink,
              hangoutLink: event.data.hangoutLink,
              meetLink: event.data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri,
              attendees: event.data.attendees?.map((attendee) => attendee.email),
            }, null, 2),
          }],
        };
      }

      case "calendar_quick_add": {
        const auth = getAuthForArgs(args);
        const calendar = google.calendar({ version: "v3", auth });
        const event = await calendar.events.quickAdd({
          calendarId: optionalToolString(args, "calendar_id") || "primary",
          text: args?.text as string,
          sendUpdates: optionalToolString(args, "send_updates") as any,
        });
        return {
          content: [{ type: "text", text: `Event created: ${event.data.htmlLink}` }],
        };
      }

      case "calendar_delete": {
        const auth = getAuthForArgs(args);
        const calendar = google.calendar({ version: "v3", auth });
        await calendar.events.delete({
          calendarId: optionalToolString(args, "calendar_id") || "primary",
          eventId: args?.event_id as string,
          sendUpdates: optionalToolString(args, "send_updates") as any,
        });
        return { content: [{ type: "text", text: "Event deleted successfully" }] };
      }

      // Tasks
      case "tasks_tasklists_list": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const params = buildTaskListsList(args || {});
        const res = await tasks.tasklists.list(params);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              taskLists: (res.data.items || []).map((taskList) => summarizeTaskList(taskList as any)),
              nextPageToken: res.data.nextPageToken,
            }, null, 2),
          }],
        };
      }

      case "tasks_list": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const params = buildTaskList(args || {});
        const res = await tasks.tasks.list(params);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasklistId: params.tasklist,
              tasks: (res.data.items || []).map((task) => summarizeTask(task as any)),
              nextPageToken: res.data.nextPageToken,
            }, null, 2),
          }],
        };
      }

      case "tasks_create": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const insert = buildTaskInsert(args || {});
        const task = await tasks.tasks.insert(insert);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasklistId: insert.tasklist,
              task: summarizeTask(task.data as any),
            }, null, 2),
          }],
        };
      }

      case "tasks_update": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const patch = buildTaskPatch(args || {});
        const task = await tasks.tasks.patch(patch);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasklistId: patch.tasklist,
              task: summarizeTask(task.data as any),
            }, null, 2),
          }],
        };
      }

      case "tasks_complete": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const patch = buildTaskComplete(args || {});
        const task = await tasks.tasks.patch(patch);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tasklistId: patch.tasklist,
              task: summarizeTask(task.data as any),
            }, null, 2),
          }],
        };
      }

      case "tasks_delete": {
        const auth = getAuthForArgs(args);
        const tasks = google.tasks({ version: "v1", auth });
        const deletion = buildTaskDelete(args || {});
        await tasks.tasks.delete(deletion);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              deleted: true,
              tasklistId: deletion.tasklist,
              taskId: deletion.task,
            }, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function runMCP() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// =============================================================================
// EXPORTED API - For direct script usage
// =============================================================================

export async function gmailSend(options: { to: string; subject: string; body: string }) {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const encoded = buildGmailRawMessage({
    to: options.to,
    subject: options.subject,
    body: options.body,
  });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: encoded } });
  return { success: true };
}

export async function gmailSearch(options: { query: string; max_results?: number; output?: string }) {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.list({
    userId: "me",
    q: options.query,
    maxResults: options.max_results || 10,
  });
  const messages = await Promise.all(
    (res.data.messages || []).map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: "me", id: m.id! });
      const headers = msg.data.payload?.headers || [];
      return {
        id: m.id,
        subject: headers.find((h) => h.name === "Subject")?.value,
        from: headers.find((h) => h.name === "From")?.value,
        date: headers.find((h) => h.name === "Date")?.value,
      };
    })
  );
  if (options.output) {
    writeFileSync(options.output, JSON.stringify(messages, null, 2), "utf-8");
  }
  return { messages, filePath: options.output };
}

export async function docsRead(options: { document_id: string; output?: string }) {
  const auth = getAuth();
  const docs = google.docs({ version: "v1", auth });
  const doc = await docs.documents.get({ documentId: options.document_id });
  const content = doc.data.body?.content
    ?.map((block) => block.paragraph?.elements?.map((e) => e.textRun?.content || "").join(""))
    .join("");
  const text = content || "";
  const title = doc.data.title || "untitled";
  if (options.output) {
    const outputPath = options.output.endsWith(".md") ? options.output : generateOutputPath("gdoc", title);
    writeFileSync(outputPath, `# ${title}\n\n${text}`, "utf-8");
    return { title, content: text, filePath: outputPath };
  }
  return { title, content: text };
}

export async function docsCreate(options: { title: string; content?: string }) {
  const auth = getAuth();
  const docs = google.docs({ version: "v1", auth });
  const doc = await docs.documents.create({ requestBody: { title: options.title } });
  if (options.content) {
    await docs.documents.batchUpdate({
      documentId: doc.data.documentId!,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: options.content } }] },
    });
  }
  return { documentId: doc.data.documentId, url: `https://docs.google.com/document/d/${doc.data.documentId}` };
}

export async function sheetsRead(options: { spreadsheet_id: string; range: string; output?: string }) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: options.spreadsheet_id, range: options.range });
  const values = res.data.values || [];
  if (options.output) {
    writeFileSync(options.output, JSON.stringify(values, null, 2), "utf-8");
    return { values, filePath: options.output };
  }
  return { values };
}

export async function sheetsWrite(options: { spreadsheet_id: string; range: string; values: any[][] }) {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: options.spreadsheet_id,
    range: options.range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: options.values },
  });
  return { success: true };
}

export async function driveUpload(options: { file_path: string; name?: string; folder_id?: string }) {
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });
  const fs = await import("fs");
  const path = await import("path");
  const fileName = options.name || path.basename(options.file_path);
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: options.folder_id ? [options.folder_id] : undefined },
    media: { body: fs.createReadStream(options.file_path) },
    fields: "id, webViewLink",
  });
  return { fileId: res.data.id, url: res.data.webViewLink };
}

export async function calendarList(options?: { days?: number; max_results?: number }) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const days = options?.days || 7;
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    maxResults: options?.max_results || 20,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location,
  }));
}

export async function calendarCreate(options: {
  calendar_id?: string;
  summary: string;
  start: string;
  end: string;
  time_zone?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  create_meet?: boolean;
  send_updates?: "all" | "externalOnly" | "none";
}) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const insert = buildCalendarEventInsert(options);
  const event = await calendar.events.insert(insert);
  return {
    eventId: event.data.id,
    calendarId: insert.calendarId,
    url: event.data.htmlLink,
    hangoutLink: event.data.hangoutLink,
    meetLink: event.data.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri,
    attendees: event.data.attendees?.map((attendee) => attendee.email),
  };
}

// Only start MCP when run directly
const isMainModule = process.argv[1]?.includes("google-workspace");
if (isMainModule && !process.argv.includes("--no-mcp")) {
  runMCP().catch(console.error);
}
