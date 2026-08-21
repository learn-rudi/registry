import { writeFileSync } from "fs";
import type { gmail_v1 } from "googleapis";

import {
  normalizeGmailDiscoveryPage,
  normalizeGmailHeaderSearchPage,
} from "./gmail.js";

type ToolArgs = Record<string, unknown> | undefined;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
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

export function gmailSearchToolDefinitions(accountInput: Record<string, unknown>) {
  return [
    {
      name: "gmail_search",
      description: "Search emails in Gmail",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query" },
          max_results: { type: "number", description: "Max results (default 10)" },
          next_page_token: { type: "string", description: "Pagination token from a previous Gmail search response" },
          output: { type: "string", description: "Optional file path to save results" },
          account: accountInput,
        },
        required: ["query"],
      },
    },
    {
      name: "gmail_discovery_page",
      description:
        "Read one bounded historical Gmail contact-discovery page for an exact account and window. Returns normalized From/To/Cc observations only; never Bcc, provider IDs, subjects, snippets, bodies, raw messages, URLs, or credentials.",
      inputSchema: {
        type: "object",
        properties: {
          account: accountInput,
          window_start: {
            type: "string",
            format: "date-time",
            description: "Inclusive ISO-8601 observation window start with offset.",
          },
          window_end: {
            type: "string",
            format: "date-time",
            description: "Exclusive ISO-8601 observation cutoff with offset.",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum provider messages in this page (default 50).",
          },
          max_records: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum normalized observations in this page (default 500).",
          },
          next_page_token: {
            type: "string",
            maxLength: 512,
            description: "Opaque pagination token returned by the prior discovery page.",
          },
        },
        required: ["account", "window_start", "window_end"],
      },
    },
    {
      name: "gmail_search_headers",
      description: "Search Gmail and return only contact-discovery headers; message bodies, snippets, and subjects are never returned",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Gmail search query" },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum messages in this page (default 100, maximum 500)",
          },
          next_page_token: { type: "string", description: "Pagination token from a previous header search response" },
          account: accountInput,
        },
        required: ["query"],
      },
    },
  ];
}

export async function runGmailSearch(gmail: gmail_v1.Gmail, args: ToolArgs) {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: args?.query as string,
    maxResults: (args?.max_results as number) || 10,
    pageToken: args?.next_page_token as string | undefined,
  });
  const messages = await Promise.all(
    (response.data.messages || []).map(async (message) => {
      const result = await gmail.users.messages.get({ userId: "me", id: message.id! });
      const headers = result.data.payload?.headers || [];
      return {
        id: message.id,
        subject: headers.find((header) => header.name === "Subject")?.value,
        from: headers.find((header) => header.name === "From")?.value,
        date: headers.find((header) => header.name === "Date")?.value,
      };
    })
  );
  const text = JSON.stringify({
    messages,
    nextPageToken: response.data.nextPageToken || null,
  }, null, 2);
  if (args?.output) {
    const filePath = args.output as string;
    writeFileSync(filePath, text, "utf-8");
    return { content: [{ type: "text" as const, text: `Saved to ${filePath}` }] };
  }
  return { content: [{ type: "text" as const, text }] };
}

export async function runGmailHeaderSearch(gmail: gmail_v1.Gmail, args: ToolArgs) {
  const query = requireString(args?.query, "query");
  const maxResults = boundedInteger(args?.max_results, "max_results", 100, 1, 500);
  const listed = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
    pageToken: args?.next_page_token as string | undefined,
  });
  const messages = await Promise.all(
    (listed.data.messages || []).map(async (message) => {
      if (!message.id) throw new Error("Gmail search returned a message without an ID");
      const response = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Bcc"],
      });
      return response.data;
    })
  );
  const page = normalizeGmailHeaderSearchPage({
    messages,
    nextPageToken: listed.data.nextPageToken,
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
}

export async function runGmailDiscoveryPage(gmail: gmail_v1.Gmail, args: ToolArgs) {
  const maxResults = boundedInteger(args?.max_results, "max_results", 50, 1, 500);
  const maxRecords = boundedInteger(args?.max_records, "max_records", 500, 1, 500);
  const account = requireString(args?.account, "account").toLowerCase();
  const emptyPage = normalizeGmailDiscoveryPage(
    { messages: [] },
    {
      account,
      window_start: requireString(args?.window_start, "window_start"),
      window_end: requireString(args?.window_end, "window_end"),
      max_records: maxRecords,
    }
  );
  const profile = await gmail.users.getProfile({ userId: "me" });
  if (profile.data.emailAddress?.trim().toLowerCase() !== emptyPage.account) {
    throw new Error("Authenticated Gmail profile does not match account");
  }

  const listed = await gmail.users.messages.list({
    userId: "me",
    q: [
      `after:${Math.max(0, Math.floor(Date.parse(emptyPage.window_start) / 1000) - 1)}`,
      `before:${Math.ceil(Date.parse(emptyPage.window_end) / 1000)}`,
      "-in:spam",
      "-in:trash",
    ].join(" "),
    maxResults,
    pageToken: optionalBoundedString(args?.next_page_token, "next_page_token", 512),
    fields: "messages/id,nextPageToken",
  });
  const messages = [];
  for (const [index, message] of (listed.data.messages || []).entries()) {
    if (!message.id) {
      throw new Error(`Gmail discovery result ${index} has no message ID`);
    }
    const response = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc"],
      fields: "id,internalDate,payload/headers",
    });
    messages.push(response.data);
  }
  const page = normalizeGmailDiscoveryPage(
    { messages, nextPageToken: listed.data.nextPageToken },
    {
      account: emptyPage.account,
      window_start: emptyPage.window_start,
      window_end: emptyPage.window_end,
      max_records: maxRecords,
    }
  );
  return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maximumLength: number
): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw new Error(`${field} must contain 1 to ${maximumLength} characters`);
  }
  return normalized;
}
