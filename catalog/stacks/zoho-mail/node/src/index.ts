#!/usr/bin/env node
/**
 * Zoho Mail MCP Server (TypeScript)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

// Default output: ~/.prompt-stack/output/
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");
if (!existsSync(DEFAULT_OUTPUT_DIR)) {
  mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function generateFilename(prefix: string, identifier: string): string {
  const date = new Date().toISOString().split("T")[0];
  return `zoho-${prefix}-${slugify(identifier)}-${date}.md`;
}

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

function resolveOutputPath(output: string | undefined, prefix: string, identifier: string): string {
  if (!output) {
    return join(DEFAULT_OUTPUT_DIR, generateFilename(prefix, identifier));
  }
  const expanded = expandPath(output);
  if (existsSync(expanded) && statSync(expanded).isDirectory()) {
    return join(expanded, generateFilename(prefix, identifier));
  }
  if (expanded.endsWith("/") || !expanded.includes(".")) {
    return join(expanded, generateFilename(prefix, identifier));
  }
  return expanded;
}

const TOKEN_FILE = join(__dirname, "..", "token.json");
const ZOHO_MAIL_URL = "https://mail.zoho.com";

interface TokenData {
  access_token: string;
  refresh_token: string;
  account_id?: string;
  primary_email?: string;
  display_name?: string;
  signature_content?: string;
}

function loadToken(): TokenData | null {
  if (existsSync(TOKEN_FILE)) {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
  }
  return null;
}

function saveToken(data: TokenData): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

async function refreshAccessToken(tokenData: TokenData): Promise<TokenData> {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      refresh_token: tokenData.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  tokenData.access_token = data.access_token;
  saveToken(tokenData);
  return tokenData;
}

async function zohoRequest(
  method: string,
  endpoint: string,
  tokenData: TokenData,
  body?: any
): Promise<any> {
  const url = `${ZOHO_MAIL_URL}/api/accounts/${tokenData.account_id}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken(tokenData);
    return zohoRequest(method, endpoint, refreshed, body);
  }

  return response.json();
}

async function fetchAccountInfo(tokenData: TokenData): Promise<void> {
  const response = await fetch(`${ZOHO_MAIL_URL}/api/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
  });
  const data = await response.json();
  if (data.data?.[0]) {
    const account = data.data[0];
    tokenData.account_id = account.accountId;
    tokenData.primary_email = account.primaryEmailAddress;
    const sendDetails = account.sendMailDetails?.[0];
    if (sendDetails) {
      tokenData.display_name = sendDetails.displayName;
    }
    saveToken(tokenData);
  }
}

async function fetchSignature(tokenData: TokenData): Promise<void> {
  const response = await fetch(`${ZOHO_MAIL_URL}/api/accounts/signature`, {
    headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
  });
  if (response.ok) {
    const data = await response.json();
    if (data.data?.[0]) {
      tokenData.signature_content = data.data[0].content;
      tokenData.display_name = data.data[0].name || tokenData.display_name;
      saveToken(tokenData);
    }
  }
}

const server = new Server(
  { name: "zoho-mail", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "zoho_send_email",
      description: "Send an email via Zoho Mail",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email(s), comma-separated" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body (HTML supported)" },
          cc: { type: "string", description: "CC recipients (optional)" },
          bcc: { type: "string", description: "BCC recipients (optional)" },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "zoho_list_emails",
      description: "List emails in inbox or folder",
      inputSchema: {
        type: "object",
        properties: {
          folder_id: { type: "string", description: "Folder ID (optional)" },
          limit: { type: "number", description: "Max results (default 25)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
      },
    },
    {
      name: "zoho_get_email",
      description: "Get full email content by message ID",
      inputSchema: {
        type: "object",
        properties: {
          message_id: { type: "string", description: "Message ID" },
          folder_id: { type: "string", description: "Folder ID (optional, defaults to inbox)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["message_id"],
      },
    },
    {
      name: "zoho_search_email",
      description: "Search emails",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query. Use 'subject:term' or 'from:name' syntax. Plain text searches subject." },
          limit: { type: "number", description: "Max results (default 25)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["query"],
      },
    },
    {
      name: "zoho_list_folders",
      description: "List all mail folders",
      inputSchema: {
        type: "object",
        properties: {
          output: { type: "string", description: "Optional file path to save output" },
        },
      },
    },
    {
      name: "zoho_create_draft",
      description: "Create an email draft",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email(s)" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tokenData = loadToken();
  if (!tokenData) {
    return {
      content: [{ type: "text", text: "Error: Not authenticated. Run 'npm run auth' first." }],
      isError: true,
    };
  }

  if (!tokenData.account_id) {
    await fetchAccountInfo(tokenData);
  }
  if (!tokenData.signature_content) {
    await fetchSignature(tokenData);
  }

  try {
    switch (name) {
      case "zoho_send_email": {
        const fromAddress = tokenData.display_name
          ? `${tokenData.display_name} <${tokenData.primary_email}>`
          : tokenData.primary_email;

        let body = args?.body as string;
        if (tokenData.signature_content) {
          body = `${body}<br><br>${tokenData.signature_content}`;
        }

        const result = await zohoRequest("POST", "/messages", tokenData, {
          toAddress: args?.to,
          fromAddress,
          subject: args?.subject,
          content: body,
          mailFormat: "html",
          ccAddress: args?.cc,
          bccAddress: args?.bcc,
        });

        return {
          content: [
            {
              type: "text",
              text: `Email sent!\nMessage ID: ${result.data?.messageId}`,
            },
          ],
        };
      }

      case "zoho_list_emails": {
        const params = new URLSearchParams({
          limit: String((args?.limit as number) || 25),
          start: "0",
        });
        if (args?.folder_id) {
          params.set("folderId", args.folder_id as string);
        }
        const result = await zohoRequest("GET", `/messages/view?${params}`, tokenData);
        const emails = (result.data || []).map((msg: any) => ({
          id: msg.messageId,
          subject: msg.subject,
          from: msg.fromAddress,
          date: msg.receivedTime,
          isRead: msg.isRead,
        }));
        const text = JSON.stringify(emails, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "emails", "list");
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "zoho_get_email": {
        let folderId = args?.folder_id as string;
        if (!folderId) {
          const folders = await zohoRequest("GET", "/folders", tokenData);
          const inbox = folders.data?.find((f: any) => f.folderName?.toLowerCase() === "inbox");
          folderId = inbox?.folderId;
        }
        const result = await zohoRequest(
          "GET",
          `/folders/${folderId}/messages/${args?.message_id}/content`,
          tokenData
        );
        const text = result.data?.content || "(empty)";
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "email", args.message_id as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "zoho_search_email": {
        // Zoho requires search syntax like "subject:term" or "from:term"
        // Plain text queries fail with 500 error
        let searchKey = args?.query as string;
        if (!searchKey.includes(":")) {
          // Wrap plain text in subject search (most common use case)
          searchKey = `subject:${searchKey}`;
        }
        const params = new URLSearchParams({
          searchKey,
          limit: String((args?.limit as number) || 25),
        });
        const result = await zohoRequest("GET", `/messages/search?${params}`, tokenData);
        const dataArray = Array.isArray(result.data) ? result.data : [];
        const emails = dataArray.map((msg: any) => ({
          id: msg.messageId,
          subject: msg.subject,
          from: msg.fromAddress,
          date: msg.receivedTime,
        }));
        const text = JSON.stringify(emails, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "search", args.query as string);
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "zoho_list_folders": {
        const result = await zohoRequest("GET", "/folders", tokenData);
        const folders = (result.data || []).map((f: any) => ({
          id: f.folderId,
          name: f.folderName,
          unread: f.unreadCount,
          total: f.mailCount,
        }));
        const text = JSON.stringify(folders, null, 2);
        if (args?.output) {
          const filePath = resolveOutputPath(args.output as string, "folders", "list");
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "zoho_create_draft": {
        const result = await zohoRequest("POST", "/messages", tokenData, {
          toAddress: args?.to,
          fromAddress: tokenData.primary_email,
          subject: args?.subject,
          content: args?.body,
          mailFormat: "html",
          action: "draft",
        });
        return {
          content: [{ type: "text", text: `Draft created: ${result.data?.messageId}` }],
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// =============================================================================
// EXPORTED API - For direct script usage
// =============================================================================

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface ListEmailsOptions {
  folder_id?: string;
  limit?: number;
  output?: string;
}

export interface GetEmailOptions {
  message_id: string;
  folder_id?: string;
  output?: string;
}

export interface SearchEmailOptions {
  query: string;
  limit?: number;
  output?: string;
}

export interface ListFoldersOptions {
  output?: string;
}

export interface CreateDraftOptions {
  to: string;
  subject: string;
  body: string;
}

async function ensureAuth(): Promise<TokenData> {
  const tokenData = loadToken();
  if (!tokenData) {
    throw new Error("Not authenticated. Run 'npm run auth' first.");
  }
  if (!tokenData.account_id) {
    await fetchAccountInfo(tokenData);
  }
  if (!tokenData.signature_content) {
    await fetchSignature(tokenData);
  }
  return tokenData;
}

export async function sendEmail(options: SendEmailOptions): Promise<{ messageId: string }> {
  const tokenData = await ensureAuth();
  const fromAddress = tokenData.display_name
    ? `${tokenData.display_name} <${tokenData.primary_email}>`
    : tokenData.primary_email;
  let body = options.body;
  if (tokenData.signature_content) {
    body = `${body}<br><br>${tokenData.signature_content}`;
  }
  const result = await zohoRequest("POST", "/messages", tokenData, {
    toAddress: options.to,
    fromAddress,
    subject: options.subject,
    content: body,
    mailFormat: "html",
    ccAddress: options.cc,
    bccAddress: options.bcc,
  });
  return { messageId: result.data?.messageId };
}

export async function listEmails(options: ListEmailsOptions = {}): Promise<any[]> {
  const tokenData = await ensureAuth();
  const params = new URLSearchParams({
    limit: String(options.limit || 25),
    start: "0",
  });
  if (options.folder_id) {
    params.set("folderId", options.folder_id);
  }
  const result = await zohoRequest("GET", `/messages/view?${params}`, tokenData);
  const emails = (result.data || []).map((msg: any) => ({
    id: msg.messageId,
    subject: msg.subject,
    from: msg.fromAddress,
    date: msg.receivedTime,
    isRead: msg.isRead,
  }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "emails", "list");
    writeFileSync(filePath, JSON.stringify(emails, null, 2), "utf-8");
  }
  return emails;
}

export async function getEmail(options: GetEmailOptions): Promise<string> {
  const tokenData = await ensureAuth();
  let folderId = options.folder_id;
  if (!folderId) {
    const folders = await zohoRequest("GET", "/folders", tokenData);
    const inbox = folders.data?.find((f: any) => f.folderName?.toLowerCase() === "inbox");
    folderId = inbox?.folderId;
  }
  const result = await zohoRequest(
    "GET",
    `/folders/${folderId}/messages/${options.message_id}/content`,
    tokenData
  );
  const content = result.data?.content || "(empty)";
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "email", options.message_id);
    writeFileSync(filePath, content, "utf-8");
  }
  return content;
}

export async function searchEmail(options: SearchEmailOptions): Promise<any[]> {
  const tokenData = await ensureAuth();
  // Zoho requires search syntax like "subject:term" or "from:term"
  let searchKey = options.query;
  if (!searchKey.includes(":")) {
    searchKey = `subject:${searchKey}`;
  }
  const params = new URLSearchParams({
    searchKey,
    limit: String(options.limit || 25),
  });
  const result = await zohoRequest("GET", `/messages/search?${params}`, tokenData);
  const dataArray = Array.isArray(result.data) ? result.data : [];
  const emails = dataArray.map((msg: any) => ({
    id: msg.messageId,
    subject: msg.subject,
    from: msg.fromAddress,
    date: msg.receivedTime,
  }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "search", options.query);
    writeFileSync(filePath, JSON.stringify(emails, null, 2), "utf-8");
  }
  return emails;
}

export async function listFolders(options: ListFoldersOptions = {}): Promise<any[]> {
  const tokenData = await ensureAuth();
  const result = await zohoRequest("GET", "/folders", tokenData);
  const folders = (result.data || []).map((f: any) => ({
    id: f.folderId,
    name: f.folderName,
    unread: f.unreadCount,
    total: f.mailCount,
  }));
  if (options.output) {
    const filePath = resolveOutputPath(options.output, "folders", "list");
    writeFileSync(filePath, JSON.stringify(folders, null, 2), "utf-8");
  }
  return folders;
}

export async function createDraft(options: CreateDraftOptions): Promise<{ messageId: string }> {
  const tokenData = await ensureAuth();
  const result = await zohoRequest("POST", "/messages", tokenData, {
    toAddress: options.to,
    fromAddress: tokenData.primary_email,
    subject: options.subject,
    content: options.body,
    mailFormat: "html",
    action: "draft",
  });
  return { messageId: result.data?.messageId };
}

// Only run MCP server when executed directly (not imported)
if (!process.argv[1]?.includes("node_modules")) {
  main().catch(console.error);
}
