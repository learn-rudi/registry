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
import { dirname, join } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default output: ~/.prompt-stack/output/
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");
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

const ACCOUNTS_DIR = join(__dirname, "..", "accounts");
const TOKEN_FILE = join(__dirname, "..", "token.json");

let currentAccount: string | null = null;

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
  if (existsSync(tokenPath)) {
    return JSON.parse(readFileSync(tokenPath, "utf-8"));
  }
  return null;
}

function getAuth() {
  const token = loadToken();
  if (!token) {
    throw new Error("Not authenticated. Run 'npm run auth' first.");
  }

  const oauth2Client = new google.auth.OAuth2(
    token.client_id,
    token.client_secret
  );
  oauth2Client.setCredentials({
    access_token: token.token,
    refresh_token: token.refresh_token,
    expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
  });
  return oauth2Client;
}

const server = new Server(
  { name: "google-workspace", version: "1.0.0" },
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
    {
      name: "gmail_send",
      description: "Send an email via Gmail",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
      },
    },
    {
      name: "gmail_search",
      description: "Search emails in Gmail",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query" },
          max_results: { type: "number", description: "Max results (default 10)" },
          output: { type: "string", description: "Optional file path to save results" },
        },
        required: ["query"],
      },
    },
    {
      name: "gmail_draft",
      description: "Create an email draft",
      inputSchema: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email" },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body" },
        },
        required: ["to", "subject", "body"],
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
          body: { type: "string", description: "Reply body (HTML supported)" },
          reply_all: { type: "boolean", description: "Reply to all recipients (default: false)" },
        },
        required: ["message_id", "body"],
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
        },
        required: ["thread_id"],
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
    {
      name: "calendar_list",
      description: "List upcoming calendar events",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Days to look ahead (default 7)" },
          max_results: { type: "number", description: "Max events (default 20)" },
        },
      },
    },
    {
      name: "calendar_create",
      description: "Create a calendar event",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Event title" },
          start: { type: "string", description: "Start datetime (ISO format)" },
          end: { type: "string", description: "End datetime (ISO format)" },
          description: { type: "string", description: "Event description" },
          location: { type: "string", description: "Event location" },
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
          text: { type: "string", description: "Natural language event description" },
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
          event_id: { type: "string", description: "Event ID to delete" },
        },
        required: ["event_id"],
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
              : "No accounts configured. Add accounts to the 'accounts/' directory.",
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
        return { content: [{ type: "text", text: `Switched to account: ${account}` }] };
      }

      case "account_current": {
        return {
          content: [{
            type: "text",
            text: currentAccount ? `Current account: ${currentAccount}` : "No account selected (using default token.json)",
          }],
        };
      }

      // Gmail
      case "gmail_send": {
        const auth = getAuth();
        const gmail = google.gmail({ version: "v1", auth });
        const message = [
          `To: ${args?.to}`,
          `Subject: ${args?.subject}`,
          "",
          args?.body,
        ].join("\n");
        const encoded = Buffer.from(message).toString("base64url");
        await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encoded },
        });
        return { content: [{ type: "text", text: "Email sent successfully" }] };
      }

      case "gmail_search": {
        const auth = getAuth();
        const gmail = google.gmail({ version: "v1", auth });
        const res = await gmail.users.messages.list({
          userId: "me",
          q: args?.query as string,
          maxResults: (args?.max_results as number) || 10,
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
        const text = JSON.stringify(messages, null, 2);
        if (args?.output) {
          const filePath = args.output as string;
          writeFileSync(filePath, text, "utf-8");
          return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
        }
        return { content: [{ type: "text", text }] };
      }

      case "gmail_draft": {
        const auth = getAuth();
        const gmail = google.gmail({ version: "v1", auth });
        const message = [
          `To: ${args?.to}`,
          `Subject: ${args?.subject}`,
          "",
          args?.body,
        ].join("\n");
        const encoded = Buffer.from(message).toString("base64url");
        const draft = await gmail.users.drafts.create({
          userId: "me",
          requestBody: { message: { raw: encoded } },
        });
        return { content: [{ type: "text", text: `Draft created: ${draft.data.id}` }] };
      }

      case "gmail_get": {
        const auth = getAuth();
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

      case "gmail_list_attachments": {
        const auth = getAuth();
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
        const auth = getAuth();
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
        const auth = getAuth();
        const gmail = google.gmail({ version: "v1", auth });
        const messageId = args?.message_id as string;
        const replyBody = args?.body as string;
        const replyAll = args?.reply_all as boolean || false;

        // Get original message for threading info
        const original = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const headers = original.data.payload?.headers || [];
        const subject = headers.find((h) => h.name === "Subject")?.value || "";
        const from = headers.find((h) => h.name === "From")?.value || "";
        const to = headers.find((h) => h.name === "To")?.value || "";
        const cc = headers.find((h) => h.name === "Cc")?.value || "";
        const messageIdHeader = headers.find((h) => h.name === "Message-ID")?.value || "";
        const references = headers.find((h) => h.name === "References")?.value || "";

        // Build recipient list
        let recipients = from; // Reply to sender
        if (replyAll) {
          // Add original To and Cc, excluding self
          const profile = await gmail.users.getProfile({ userId: "me" });
          const myEmail = profile.data.emailAddress || "";
          const allRecipients = [from, to, cc]
            .filter(Boolean)
            .join(", ")
            .split(",")
            .map((e) => e.trim())
            .filter((e) => !e.toLowerCase().includes(myEmail.toLowerCase()));
          recipients = [...new Set(allRecipients)].join(", ");
        }

        // Build reply subject
        const replySubject = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;

        // Build message with threading headers
        const message = [
          `To: ${recipients}`,
          `Subject: ${replySubject}`,
          `In-Reply-To: ${messageIdHeader}`,
          `References: ${references ? `${references} ${messageIdHeader}` : messageIdHeader}`,
          "Content-Type: text/html; charset=utf-8",
          "",
          replyBody,
        ].join("\r\n");

        const encoded = Buffer.from(message).toString("base64url");
        await gmail.users.messages.send({
          userId: "me",
          requestBody: {
            raw: encoded,
            threadId: original.data.threadId,
          },
        });

        return { content: [{ type: "text", text: `Reply sent to ${recipients}` }] };
      }

      case "gmail_get_thread": {
        const auth = getAuth();
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
      case "calendar_list": {
        const auth = getAuth();
        const calendar = google.calendar({ version: "v3", auth });
        const days = (args?.days as number) || 7;
        const now = new Date();
        const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        const res = await calendar.events.list({
          calendarId: "primary",
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
        const auth = getAuth();
        const calendar = google.calendar({ version: "v3", auth });
        const event = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: args?.summary as string,
            start: { dateTime: args?.start as string },
            end: { dateTime: args?.end as string },
            description: args?.description as string,
            location: args?.location as string,
          },
        });
        return {
          content: [{ type: "text", text: `Event created: ${event.data.htmlLink}` }],
        };
      }

      case "calendar_quick_add": {
        const auth = getAuth();
        const calendar = google.calendar({ version: "v3", auth });
        const event = await calendar.events.quickAdd({
          calendarId: "primary",
          text: args?.text as string,
        });
        return {
          content: [{ type: "text", text: `Event created: ${event.data.htmlLink}` }],
        };
      }

      case "calendar_delete": {
        const auth = getAuth();
        const calendar = google.calendar({ version: "v3", auth });
        await calendar.events.delete({
          calendarId: "primary",
          eventId: args?.event_id as string,
        });
        return { content: [{ type: "text", text: "Event deleted successfully" }] };
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
  const message = [`To: ${options.to}`, `Subject: ${options.subject}`, "", options.body].join("\n");
  const encoded = Buffer.from(message).toString("base64url");
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

export async function calendarCreate(options: { summary: string; start: string; end: string; description?: string; location?: string }) {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const event = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: options.summary,
      start: { dateTime: options.start },
      end: { dateTime: options.end },
      description: options.description,
      location: options.location,
    },
  });
  return { eventId: event.data.id, url: event.data.htmlLink };
}

// Only start MCP when run directly
const isMainModule = process.argv[1]?.includes("google-workspace");
if (isMainModule && !process.argv.includes("--no-mcp")) {
  runMCP().catch(console.error);
}
