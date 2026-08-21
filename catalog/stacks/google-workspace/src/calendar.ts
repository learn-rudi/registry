import { createHash } from "node:crypto";

type CalendarCreateArgs = Record<string, unknown>;

type CalendarDiscoveryPageLike = {
  items?: Array<{
    id?: unknown;
    recurringEventId?: unknown;
    start?: { dateTime?: unknown; date?: unknown } | null;
    organizer?: { email?: unknown; displayName?: unknown } | null;
    attendees?: Array<{ email?: unknown; displayName?: unknown }> | null;
  }> | null;
  nextPageToken?: unknown;
};

export type CalendarDiscoveryScope = {
  account: string;
  calendar_id: string;
  window_start: string;
  window_end: string;
  max_records: number;
};

export type NormalizedCalendarDiscoveryPage = {
  source: "calendar";
  account: string;
  calendar_id: string;
  window_start: string;
  window_end: string;
  observations: Array<{
    resource_key: string;
    observed_at: string;
    address_role: "organizer" | "attendee";
    address: string;
    display_name?: string;
    recurrence_key?: string;
  }>;
  next_page_token?: string;
};

export type CalendarEventInsert = {
  calendarId: string;
  conferenceDataVersion?: number;
  sendUpdates?: string;
  requestBody: {
    summary: string;
    start: { dateTime: string; timeZone?: string };
    end: { dateTime: string; timeZone?: string };
    description?: string;
    location?: string;
    attendees?: Array<{ email: string }>;
    conferenceData?: {
      createRequest: {
        requestId: string;
        conferenceSolutionKey: { type: "hangoutsMeet" };
      };
    };
  };
};

export function buildCalendarEventInsert(args: CalendarCreateArgs): CalendarEventInsert {
  const attendees = optionalStringArray(args.attendees, "attendees").map((email) => ({ email }));
  const createMeet = args.create_meet === true;
  const sendUpdates = optionalEnum(args.send_updates, "send_updates", ["all", "externalOnly", "none"]);
  const calendarId = optionalString(args.calendar_id, "calendar_id") || "primary";
  const timeZone = optionalString(args.time_zone, "time_zone");

  const requestBody: CalendarEventInsert["requestBody"] = {
    summary: requireString(args.summary, "summary"),
    start: { dateTime: requireString(args.start, "start") },
    end: { dateTime: requireString(args.end, "end") },
  };

  if (timeZone) {
    requestBody.start.timeZone = timeZone;
    requestBody.end.timeZone = timeZone;
  }

  const description = optionalString(args.description, "description");
  const location = optionalString(args.location, "location");
  if (description) requestBody.description = description;
  if (location) requestBody.location = location;
  if (attendees.length > 0) requestBody.attendees = attendees;
  if (createMeet) {
    requestBody.conferenceData = {
      createRequest: {
        requestId: makeConferenceRequestId(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const insert: CalendarEventInsert = { calendarId, requestBody };
  if (createMeet) insert.conferenceDataVersion = 1;
  if (sendUpdates) insert.sendUpdates = sendUpdates;
  return insert;
}

export function normalizeCalendarDiscoveryPage(
  input: CalendarDiscoveryPageLike,
  scope: CalendarDiscoveryScope
): NormalizedCalendarDiscoveryPage {
  const account = requireEmail(scope.account, "account");
  const calendarId = requireBoundedString(scope.calendar_id, "calendar_id", 512);
  const windowStart = requireTimestamp(scope.window_start, "window_start");
  const windowEnd = requireTimestamp(scope.window_end, "window_end");
  if (windowStart >= windowEnd) {
    throw new Error("window_start must precede window_end");
  }
  if (!Number.isInteger(scope.max_records) || scope.max_records < 1 || scope.max_records > 500) {
    throw new Error("max_records must be an integer between 1 and 500");
  }
  const items = input.items ?? [];
  if (!Array.isArray(items)) {
    throw new Error("items must be an array");
  }

  const observations: NormalizedCalendarDiscoveryPage["observations"] = [];
  for (const [eventIndex, event] of items.entries()) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new Error(`items[${eventIndex}] must be an object`);
    }
    const providerId = requireBoundedString(event.id, `items[${eventIndex}].id`, 512);
    const observedAt = calendarObservedAt(event.start, eventIndex);
    if (observedAt < windowStart || observedAt >= windowEnd) {
      continue;
    }
    const resourceKey = scopedKey("calendar", account, calendarId, providerId);
    const recurringProviderId = optionalBoundedString(
      event.recurringEventId,
      `items[${eventIndex}].recurringEventId`,
      512
    );
    const recurrenceKey = recurringProviderId
      ? scopedKey("calendar-recurrence", account, calendarId, recurringProviderId)
      : undefined;

    if (event.organizer?.email != null) {
      observations.push(calendarIdentityObservation({
        identity: event.organizer,
        field: `items[${eventIndex}].organizer`,
        role: "organizer",
        resourceKey,
        recurrenceKey,
        observedAt,
      }));
    }
    const attendees = event.attendees ?? [];
    if (!Array.isArray(attendees)) {
      throw new Error(`items[${eventIndex}].attendees must be an array`);
    }
    for (const [attendeeIndex, attendee] of attendees.entries()) {
      observations.push(calendarIdentityObservation({
        identity: attendee,
        field: `items[${eventIndex}].attendees[${attendeeIndex}]`,
        role: "attendee",
        resourceKey,
        recurrenceKey,
        observedAt,
      }));
    }
  }

  const uniqueObservations = deduplicateCalendarObservations(observations);
  uniqueObservations.sort((left, right) =>
    left.observed_at.localeCompare(right.observed_at)
    || left.resource_key.localeCompare(right.resource_key)
    || left.address_role.localeCompare(right.address_role)
    || left.address.localeCompare(right.address)
  );
  if (uniqueObservations.length > scope.max_records) {
    throw new Error(`Calendar discovery page exceeds max_records (${scope.max_records})`);
  }
  const nextPageToken = optionalBoundedString(input.nextPageToken, "nextPageToken", 512);
  return {
    source: "calendar",
    account,
    calendar_id: calendarId,
    window_start: windowStart,
    window_end: windowEnd,
    observations: uniqueObservations,
    ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
  };
}

function deduplicateCalendarObservations(
  observations: NormalizedCalendarDiscoveryPage["observations"]
): NormalizedCalendarDiscoveryPage["observations"] {
  const unique = new Map<
    string,
    NormalizedCalendarDiscoveryPage["observations"][number]
  >();
  for (const observation of observations) {
    const key = [
      observation.observed_at,
      observation.resource_key,
      observation.address_role,
      observation.address,
    ].join("\u001f");
    const prior = unique.get(key);
    if (
      !prior
      || (!prior.display_name && observation.display_name)
      || (
        prior.display_name
        && observation.display_name
        && observation.display_name.localeCompare(prior.display_name) < 0
      )
    ) {
      unique.set(key, observation);
    }
  }
  return [...unique.values()];
}

function calendarIdentityObservation(args: {
  identity: { email?: unknown; displayName?: unknown };
  field: string;
  role: "organizer" | "attendee";
  resourceKey: string;
  recurrenceKey?: string;
  observedAt: string;
}): NormalizedCalendarDiscoveryPage["observations"][number] {
  const address = requireEmail(args.identity.email, `${args.field}.email`);
  const displayName = optionalBoundedString(
    args.identity.displayName,
    `${args.field}.displayName`,
    200
  );
  return {
    resource_key: args.resourceKey,
    ...(args.recurrenceKey ? { recurrence_key: args.recurrenceKey } : {}),
    observed_at: args.observedAt,
    address_role: args.role,
    address,
    ...(displayName ? { display_name: displayName } : {}),
  };
}

function calendarObservedAt(
  start: { dateTime?: unknown; date?: unknown } | null | undefined,
  eventIndex: number
): string {
  if (typeof start?.dateTime === "string") {
    return requireTimestamp(start.dateTime, `items[${eventIndex}].start.dateTime`);
  }
  if (typeof start?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start.date)) {
    return requireTimestamp(`${start.date}T00:00:00Z`, `items[${eventIndex}].start.date`);
  }
  throw new Error(`items[${eventIndex}].start must contain dateTime or date`);
}

function requireEmail(value: unknown, field: string): string {
  const normalized = requireBoundedString(value, field, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`${field} must be a valid email address`);
  }
  return normalized;
}

function requireTimestamp(value: unknown, field: string): string {
  const text = requireBoundedString(value, field, 64);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(text);
  if (match === null) {
    throw new Error(`${field} must be an ISO-8601 timestamp with offset`);
  }
  const [, year, month, day, hour, minute, second, offsetHour = "00", offsetMinute = "00"] = match;
  const numericMonth = Number(month);
  const maximumDay = new Date(Date.UTC(Number(year), numericMonth, 0)).getUTCDate();
  const parsed = new Date(text);
  if (
    numericMonth < 1
    || numericMonth > 12
    || Number(day) < 1
    || Number(day) > maximumDay
    || Number(hour) > 23
    || Number(minute) > 59
    || Number(second) > 59
    || Number(offsetHour) > 23
    || Number(offsetMinute) > 59
    || Number.isNaN(parsed.getTime())
  ) {
    throw new Error(`${field} must be an ISO-8601 timestamp with offset`);
  }
  return parsed.toISOString();
}

function requireBoundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\r\n]/.test(normalized)) {
    throw new Error(`${field} must contain 1 to ${maximum} characters without newlines`);
  }
  return normalized;
}

function optionalBoundedString(
  value: unknown,
  field: string,
  maximum: number
): string | undefined {
  if (value == null) return undefined;
  return requireBoundedString(value, field, maximum);
}

function scopedKey(source: string, account: string, calendarId: string, id: string): string {
  return createHash("sha256")
    .update(`${source}\0${account}\0${calendarId}\0${id}`)
    .digest("hex");
}

export function makeConferenceRequestId(): string {
  return `rudi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
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

function optionalEnum(value: unknown, field: string, allowed: string[]): string | undefined {
  const stringValue = optionalString(value, field);
  if (!stringValue) return undefined;
  if (!allowed.includes(stringValue)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return stringValue;
}
