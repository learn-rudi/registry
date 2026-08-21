import type { calendar_v3, gmail_v1 } from "googleapis";

import { normalizeCalendarDiscoveryPage } from "./calendar.js";

type ToolArgs = Record<string, unknown> | undefined;

export function calendarDiscoveryToolDefinitions(
  accountInput: Record<string, unknown>
) {
  return [{
    name: "calendar_discovery_page",
    description:
      "Read one bounded historical Calendar contact-discovery page for an exact account, calendar, and window. Returns normalized organizer/attendee observations only; never provider IDs, event content, responses, URLs, or credentials.",
    inputSchema: {
      type: "object",
      properties: {
        account: accountInput,
        calendar_id: {
          type: "string",
          minLength: 1,
          maxLength: 512,
          description: "Exact Google Calendar ID to observe.",
        },
        window_start: {
          type: "string",
          format: "date-time",
          description: "Inclusive ISO-8601 event-start window with offset.",
        },
        window_end: {
          type: "string",
          format: "date-time",
          description: "Exclusive ISO-8601 event-start cutoff with offset.",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Maximum provider events in this page (default 50).",
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
      required: ["account", "calendar_id", "window_start", "window_end"],
    },
  }];
}

export async function runCalendarDiscoveryPage(
  calendar: calendar_v3.Calendar,
  gmail: gmail_v1.Gmail,
  args: ToolArgs
) {
  const maxResults = boundedInteger(args?.max_results, "max_results", 50, 1, 500);
  const maxRecords = boundedInteger(args?.max_records, "max_records", 500, 1, 500);
  const scope = normalizeCalendarDiscoveryPage(
    { items: [] },
    {
      account: requireString(args?.account, "account").toLowerCase(),
      calendar_id: requireString(args?.calendar_id, "calendar_id"),
      window_start: requireString(args?.window_start, "window_start"),
      window_end: requireString(args?.window_end, "window_end"),
      max_records: maxRecords,
    }
  );
  const profile = await gmail.users.getProfile({ userId: "me" });
  if (profile.data.emailAddress?.trim().toLowerCase() !== scope.account) {
    throw new Error("Authenticated Gmail profile does not match account");
  }

  const response = await calendar.events.list({
    calendarId: scope.calendar_id,
    timeMin: scope.window_start,
    timeMax: scope.window_end,
    maxResults,
    pageToken: optionalBoundedString(args?.next_page_token, "next_page_token", 512),
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
    fields:
      "items(id,recurringEventId,start,organizer(email,displayName),attendees(email,displayName)),nextPageToken",
  });
  const page = normalizeCalendarDiscoveryPage(response.data, {
    account: scope.account,
    calendar_id: scope.calendar_id,
    window_start: scope.window_start,
    window_end: scope.window_end,
    max_records: maxRecords,
  });
  return { content: [{ type: "text" as const, text: JSON.stringify(page, null, 2) }] };
}

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

function optionalBoundedString(
  value: unknown,
  field: string,
  maximum: number
): string | undefined {
  if (value == null) return undefined;
  const normalized = requireString(value, field);
  if (normalized.length > maximum) {
    throw new Error(`${field} must be at most ${maximum} characters`);
  }
  return normalized;
}
