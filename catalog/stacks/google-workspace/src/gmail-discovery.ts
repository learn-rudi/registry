import type { gmail_v1 } from "googleapis";

import {
  GMAIL_HISTORY_TYPES,
  gmailHistoryErrorEnvelope,
  normalizeGmailHistoryPage,
} from "./gmail.js";

type ToolArgs = Record<string, unknown> | undefined;
type GmailDiscoveryToolName = "gmail_profile" | "gmail_history_list";

export function gmailDiscoveryToolDefinitions(
  accountInput: Record<string, unknown>
) {
  return [
    {
      name: "gmail_profile",
      description: "Show the authenticated Gmail profile for the selected account",
      inputSchema: {
        type: "object",
        properties: {
          account: accountInput,
        },
      },
    },
    {
      name: "gmail_history_list",
      description: "List ordered Gmail message-added history after a durable history cursor",
      inputSchema: {
        type: "object",
        properties: {
          start_history_id: {
            type: "string",
            description: "Required Gmail history ID cursor; returns records after this ID",
          },
          max_results: {
            type: "integer",
            minimum: 1,
            maximum: 500,
            description: "Maximum history records to return (default 100, maximum 500)",
          },
          next_page_token: {
            type: "string",
            description: "Pagination token from a previous Gmail history response",
          },
          label_id: {
            type: "string",
            description: "Optional Gmail label ID filter, such as INBOX",
          },
          account: accountInput,
        },
        required: ["start_history_id"],
      },
    },
  ];
}

export async function runGmailDiscoveryTool(
  name: GmailDiscoveryToolName,
  gmail: gmail_v1.Gmail,
  args: ToolArgs
) {
  if (name === "gmail_profile") {
    const profile = await gmail.users.getProfile({ userId: "me" });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          emailAddress: profile.data.emailAddress,
          messagesTotal: profile.data.messagesTotal,
          threadsTotal: profile.data.threadsTotal,
          historyId: profile.data.historyId,
        }, null, 2),
      }],
    };
  }

  const startHistoryId = requireString(args?.start_history_id, "start_history_id").trim();
  let response;
  try {
    response = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: [...GMAIL_HISTORY_TYPES],
      maxResults: boundedInteger(args?.max_results, "max_results", 100, 1, 500),
      pageToken: optionalToolString(args, "next_page_token"),
      labelId: optionalToolString(args, "label_id"),
    });
  } catch (error) {
    const envelope = gmailHistoryErrorEnvelope(error);
    if (envelope === null) throw error;
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      isError: true,
    };
  }

  const page = normalizeGmailHistoryPage(response.data, startHistoryId);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }],
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

function hasToolArg(args: ToolArgs, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(args || {}, field);
}

function optionalToolString(args: ToolArgs, field: string): string | undefined {
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
