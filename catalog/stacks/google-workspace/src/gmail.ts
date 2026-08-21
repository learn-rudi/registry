import { createHash } from "node:crypto";

type HeaderLike = {
  name?: string | null;
  value?: string | null;
};

type GmailMessageLike = {
  id?: string | null;
  threadId?: string | null;
  payload?: {
    headers?: HeaderLike[] | null;
  } | null;
};

type DraftMessageOptions = {
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  replyMessageId?: unknown;
  replyAll?: unknown;
  originalMessage?: GmailMessageLike | null;
  selfEmail?: string | null;
};

export type GmailDraftMessage = {
  raw: string;
  to: string;
  subject: string;
  cc?: string;
  bcc?: string;
  contentType?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
};

export type GmailRawMessageOptions = {
  from?: unknown;
  to: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject: unknown;
  body: unknown;
  contentType?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
};

type GmailSendResultLike = {
  id?: unknown;
  threadId?: unknown;
  historyId?: unknown;
  labelIds?: unknown;
};

type GmailRawMessageLike = GmailSendResultLike & {
  internalDate?: unknown;
  raw?: unknown;
};

type GmailHistoryMessageLike = {
  id?: unknown;
  threadId?: unknown;
  labelIds?: unknown;
};

type GmailHistoryPageLike = {
  history?: Array<{
    id?: unknown;
    messagesAdded?: Array<{
      message?: GmailHistoryMessageLike | null;
    }> | null;
  }> | null;
  nextPageToken?: unknown;
  historyId?: unknown;
};

type GmailHeaderSearchPageLike = {
  messages?: Array<GmailMessageLike & {
    internalDate?: unknown;
  }> | null;
  nextPageToken?: unknown;
};

export type NormalizedGmailSendResult = {
  messageId: string;
  threadId: string;
  historyId?: string;
  labelIds: string[];
};

export type NormalizedGmailRawMessage = NormalizedGmailSendResult & {
  internalDate?: string;
  rawBase64Url: string;
};

export type NormalizedGmailHistoryPage = {
  startHistoryId: string;
  records: Array<{
    historyId: string;
    messagesAdded: Array<{
      messageId: string;
      threadId: string;
      labelIds: string[];
    }>;
  }>;
  nextPageToken?: string;
  historyId: string;
};

export type NormalizedGmailHeaderSearchPage = {
  messages: Array<{
    messageId: string;
    threadId: string;
    observedAt: string;
    from: string;
    to: string;
    cc: string;
    bcc: string;
  }>;
  nextPageToken?: string;
};

export type GmailDiscoveryScope = {
  account: string;
  window_start: string;
  window_end: string;
  max_records: number;
};

export type NormalizedGmailDiscoveryPage = {
  source: "gmail";
  account: string;
  window_start: string;
  window_end: string;
  observations: Array<{
    resource_key: string;
    observed_at: string;
    address_role: "from" | "to" | "cc";
    address: string;
    display_name?: string;
  }>;
  next_page_token?: string;
};

export const DEFAULT_GMAIL_CONTENT_TYPE = 'text/plain; charset="UTF-8"';

export function resolveRequestedAccount(
  args: Record<string, unknown> | undefined,
  currentAccount: string | null
): string | null {
  if (!args || args.account == null) return currentAccount;
  if (typeof args.account !== "string" || args.account.trim() === "") {
    throw new Error("account must be a non-empty string");
  }
  return sanitizeHeaderValue(args.account, "account");
}

export function normalizeGmailSendResult(
  input: GmailSendResultLike
): NormalizedGmailSendResult {
  return {
    messageId: requireOpaqueProviderId(input.id, "messageId"),
    threadId: requireOpaqueProviderId(input.threadId, "threadId"),
    ...(input.historyId == null
      ? {}
      : { historyId: requireDecimalHistoryId(input.historyId, "historyId") }),
    labelIds: normalizeProviderStringArray(input.labelIds, "labelIds"),
  };
}

export function normalizeGmailRawMessage(
  input: GmailRawMessageLike
): NormalizedGmailRawMessage {
  const normalized = normalizeGmailSendResult(input);
  if (typeof input.raw !== "string") {
    throw new Error("raw must be a string");
  }
  const providerRaw = input.raw.trim();
  if (
    providerRaw.length === 0
    || providerRaw.length > 40_000_002
    || !/^[A-Za-z0-9_-]+={0,2}$/.test(providerRaw)
  ) {
    throw new Error("raw must be bounded base64url");
  }
  const rawBase64Url = providerRaw.replace(/=+$/, "");
  const decoded = Buffer.from(providerRaw, "base64url");
  if (
    rawBase64Url.length > 40_000_000
    || decoded.toString("base64url") !== rawBase64Url
  ) {
    throw new Error("raw must use canonical base64url encoding");
  }

  return {
    ...normalized,
    ...(input.internalDate == null
      ? {}
      : {
          internalDate: requireDecimalHistoryId(
            input.internalDate,
            "internalDate"
          )
        }),
    rawBase64Url
  };
}

export function normalizeGmailHistoryPage(
  input: GmailHistoryPageLike,
  startHistoryId: unknown
): NormalizedGmailHistoryPage {
  const normalizedStart = requireDecimalHistoryId(startHistoryId, "startHistoryId");
  const pageHistoryId = requireDecimalHistoryId(input.historyId, "historyId");
  const rawRecords = input.history ?? [];
  if (!Array.isArray(rawRecords)) {
    throw new Error("history must be an array");
  }

  let previousHistoryId = BigInt(normalizedStart);
  const records = rawRecords.map((record, recordIndex) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`history[${recordIndex}] must be an object`);
    }
    const historyId = requireDecimalHistoryId(record.id, `history[${recordIndex}].id`);
    const numericHistoryId = BigInt(historyId);
    if (numericHistoryId <= previousHistoryId) {
      throw new Error("Gmail history records must be strictly increasing");
    }
    previousHistoryId = numericHistoryId;

    const rawAdded = record.messagesAdded ?? [];
    if (!Array.isArray(rawAdded)) {
      throw new Error(`history[${recordIndex}].messagesAdded must be an array`);
    }
    const messagesAdded = rawAdded.map((entry, entryIndex) => {
      const message = entry?.message;
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        throw new Error(
          `history[${recordIndex}].messagesAdded[${entryIndex}].message must be an object`
        );
      }
      return {
        messageId: requireOpaqueProviderId(
          message.id,
          `history[${recordIndex}].messagesAdded[${entryIndex}].message.id`
        ),
        threadId: requireOpaqueProviderId(
          message.threadId,
          `history[${recordIndex}].messagesAdded[${entryIndex}].message.threadId`
        ),
        labelIds: normalizeProviderStringArray(
          message.labelIds,
          `history[${recordIndex}].messagesAdded[${entryIndex}].message.labelIds`
        ),
      };
    });
    return { historyId, messagesAdded };
  });

  if (BigInt(pageHistoryId) < previousHistoryId) {
    throw new Error("Gmail page historyId cannot precede a returned history record");
  }

  const nextPageToken = optionalProviderString(input.nextPageToken, "nextPageToken");
  return {
    startHistoryId: normalizedStart,
    records,
    ...(nextPageToken ? { nextPageToken } : {}),
    historyId: pageHistoryId,
  };
}

export function normalizeGmailHeaderSearchPage(
  input: GmailHeaderSearchPageLike
): NormalizedGmailHeaderSearchPage {
  const rawMessages = input.messages ?? [];
  if (!Array.isArray(rawMessages)) {
    throw new Error("messages must be an array");
  }

  const messages = rawMessages.map((message, index) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error(`messages[${index}] must be an object`);
    }
    const internalDate = requireDecimalHistoryId(
      message.internalDate,
      `messages[${index}].internalDate`
    );
    const internalDateNumber = Number(internalDate);
    const observedDate = new Date(internalDateNumber);
    if (!Number.isSafeInteger(internalDateNumber) || Number.isNaN(observedDate.getTime())) {
      throw new Error(`messages[${index}].internalDate must be a valid timestamp`);
    }
    const observedAt = observedDate.toISOString();
    const headers = message.payload?.headers ?? [];
    if (!Array.isArray(headers)) {
      throw new Error(`messages[${index}].payload.headers must be an array`);
    }
    return {
      messageId: requireOpaqueProviderId(message.id, `messages[${index}].id`),
      threadId: requireOpaqueProviderId(message.threadId, `messages[${index}].threadId`),
      observedAt,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      cc: getHeader(headers, "Cc"),
      bcc: getHeader(headers, "Bcc"),
    };
  });

  const nextPageToken = optionalProviderString(input.nextPageToken, "nextPageToken");
  return {
    messages,
    ...(nextPageToken ? { nextPageToken } : {}),
  };
}

export function normalizeGmailDiscoveryPage(
  input: GmailHeaderSearchPageLike,
  scope: GmailDiscoveryScope
): NormalizedGmailDiscoveryPage {
  const account = requireNormalizedEmail(scope.account, "account");
  const windowStart = requireIsoTimestamp(scope.window_start, "window_start");
  const windowEnd = requireIsoTimestamp(scope.window_end, "window_end");
  if (windowStart >= windowEnd) {
    throw new Error("window_start must precede window_end");
  }
  if (!Number.isInteger(scope.max_records) || scope.max_records < 1 || scope.max_records > 500) {
    throw new Error("max_records must be an integer between 1 and 500");
  }

  const rawMessages = input.messages ?? [];
  if (!Array.isArray(rawMessages)) {
    throw new Error("messages must be an array");
  }

  const observations: NormalizedGmailDiscoveryPage["observations"] = [];
  for (const [messageIndex, message] of rawMessages.entries()) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error(`messages[${messageIndex}] must be an object`);
    }
    const providerId = requireOpaqueProviderId(message.id, `messages[${messageIndex}].id`);
    const resourceKey = scopedProviderKey("gmail", account, providerId);
    const observedAt = gmailObservedAt(message.internalDate, messageIndex);
    if (observedAt < windowStart || observedAt >= windowEnd) {
      continue;
    }
    const headers = message.payload?.headers ?? [];
    if (!Array.isArray(headers)) {
      throw new Error(`messages[${messageIndex}].payload.headers must be an array`);
    }

    for (const role of ["from", "to", "cc"] as const) {
      const value = getHeader(headers, role);
      for (const identity of parseDiscoveryAddresses(value, role)) {
        observations.push({
          resource_key: resourceKey,
          observed_at: observedAt,
          address_role: role,
          address: identity.address,
          ...(identity.displayName ? { display_name: identity.displayName } : {}),
        });
      }
    }
  }

  const uniqueObservations = deduplicateGmailObservations(observations);
  uniqueObservations.sort((left, right) =>
    left.observed_at.localeCompare(right.observed_at)
    || left.resource_key.localeCompare(right.resource_key)
    || left.address_role.localeCompare(right.address_role)
    || left.address.localeCompare(right.address)
  );
  if (uniqueObservations.length > scope.max_records) {
    throw new Error(`Gmail discovery page exceeds max_records (${scope.max_records})`);
  }

  const nextPageToken = optionalProviderString(input.nextPageToken, "nextPageToken");
  return {
    source: "gmail",
    account,
    window_start: windowStart,
    window_end: windowEnd,
    observations: uniqueObservations,
    ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
  };
}

function deduplicateGmailObservations(
  observations: NormalizedGmailDiscoveryPage["observations"]
): NormalizedGmailDiscoveryPage["observations"] {
  const unique = new Map<string, NormalizedGmailDiscoveryPage["observations"][number]>();
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

function gmailObservedAt(value: unknown, messageIndex: number): string {
  const internalDate = requireDecimalHistoryId(
    value,
    `messages[${messageIndex}].internalDate`
  );
  const numeric = Number(internalDate);
  const observedAt = new Date(numeric);
  if (!Number.isSafeInteger(numeric) || Number.isNaN(observedAt.getTime())) {
    throw new Error(`messages[${messageIndex}].internalDate must be a valid timestamp`);
  }
  return observedAt.toISOString();
}

function parseDiscoveryAddresses(
  value: string,
  field: string
): Array<{ address: string; displayName?: string }> {
  if (!value) return [];
  if (value.length > 20_000) {
    throw new Error(`${field} header is too large`);
  }
  const parts = splitAddressList(value);
  if (parts.length > 100) {
    throw new Error(`${field} header contains too many addresses`);
  }
  return parts.map((part, index) => {
    const angle = part.match(/^(.*?)<([^<>]+)>$/);
    const address = requireNormalizedEmail(
      angle?.[2] ?? part,
      `${field}[${index}].address`
    );
    const rawDisplayName = angle?.[1]?.trim().replace(/^"|"$/g, "");
    if (!rawDisplayName) return { address };
    const displayName = sanitizeHeaderValue(rawDisplayName, `${field}[${index}].display_name`);
    if (displayName.length > 200) {
      throw new Error(`${field}[${index}].display_name must be at most 200 characters`);
    }
    return { address, displayName };
  });
}

function requireNormalizedEmail(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0
    || normalized.length > 320
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    throw new Error(`${field} must be a valid email address`);
  }
  return normalized;
}

function requireIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${field} must be an ISO-8601 timestamp with offset`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be an ISO-8601 timestamp with offset`);
  }
  return parsed.toISOString();
}

function scopedProviderKey(source: string, scope: string, providerId: string): string {
  return createHash("sha256")
    .update(`${source}\0${scope}\0${providerId}`)
    .digest("hex");
}

export function buildGmailDraftMessage(options: DraftMessageOptions): GmailDraftMessage {
  const body = requireString(options.body, "body");
  const replyMessageId = optionalString(options.replyMessageId, "reply_message_id");

  if (!replyMessageId) {
    const to = requireHeaderSafeString(options.to, "to");
    const subject = requireHeaderSafeString(options.subject, "subject");
    const cc = optionalHeaderSafeString(options.cc, "cc");
    const bcc = optionalHeaderSafeString(options.bcc, "bcc");
    const contentType = inferGmailContentType(body);
    return {
      raw: buildGmailRawMessage({
        to,
        cc,
        bcc,
        subject,
        body,
        contentType,
      }),
      to,
      subject,
      cc,
      bcc,
      contentType,
    };
  }

  const originalMessage = options.originalMessage;
  if (!originalMessage) {
    throw new Error("originalMessage is required when reply_message_id is provided");
  }

  const headers = originalMessage.payload?.headers || [];
  const originalSubject = getHeader(headers, "Subject");
  const messageIdHeader = getHeader(headers, "Message-ID");
  const referencesHeader = getHeader(headers, "References");
  const subject =
    optionalHeaderSafeString(options.subject, "subject") || buildReplySubject(originalSubject);
  const to =
    optionalHeaderSafeString(options.to, "to") ||
    buildReplyRecipients({
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      cc: getHeader(headers, "Cc"),
      replyAll: options.replyAll === true,
      selfEmail: options.selfEmail || "",
    });

  if (!to) {
    throw new Error("to is required because the original message has no reply recipient");
  }

  const references = buildReferencesHeader(referencesHeader, messageIdHeader);
  const cc = optionalHeaderSafeString(options.cc, "cc");
  const bcc = optionalHeaderSafeString(options.bcc, "bcc");
  const contentType = inferGmailContentType(body);

  return {
    raw: buildGmailRawMessage({
      to,
      cc,
      bcc,
      subject,
      body,
      contentType,
      inReplyTo: messageIdHeader || undefined,
      references,
    }),
    to,
    subject,
    cc,
    bcc,
    contentType,
    inReplyTo: messageIdHeader || undefined,
    references,
    threadId: originalMessage.threadId || undefined,
  };
}

export function buildGmailRawMessage(options: GmailRawMessageOptions): string {
  const body = requireString(options.body, "body");
  const contentType =
    optionalHeaderSafeString(options.contentType, "Content-Type") || inferGmailContentType(body);
  const lines: string[] = [];
  const from = optionalHeaderSafeString(options.from, "from");
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${requireHeaderSafeString(options.to, "to")}`);
  const cc = optionalHeaderSafeString(options.cc, "cc");
  const bcc = optionalHeaderSafeString(options.bcc, "bcc");
  const inReplyTo = optionalHeaderSafeString(options.inReplyTo, "In-Reply-To");
  const references = optionalHeaderSafeString(options.references, "References");

  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: ${encodeMimeHeaderValue(requireHeaderSafeString(options.subject, "subject"))}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: ${contentType}`);
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("", encodeMimeBody(body));
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export function inferGmailContentType(body: string): string {
  return looksLikeHtml(body) ? "text/html; charset=utf-8" : DEFAULT_GMAIL_CONTENT_TYPE;
}

export function encodeMimeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return splitHeaderValue(value)
    .map((part) => `=?UTF-8?B?${Buffer.from(part, "utf-8").toString("base64")}?=`)
    .join("\r\n ");
}

export function encodeMimeBody(value: string): string {
  return wrapBase64(Buffer.from(normalizeMimeLineEndings(value), "utf-8").toString("base64"));
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function normalizeMimeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
}

function looksLikeHtml(body: string): boolean {
  return /<\/?(?:a|article|b|blockquote|body|br|div|em|h[1-6]|html|i|li|ol|p|pre|span|strong|table|tbody|td|th|thead|tr|ul)(?:\s|>|\/)/i.test(body);
}

function splitHeaderValue(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "";

  for (const char of Array.from(value)) {
    const candidate = chunk + char;
    if (chunk && Buffer.byteLength(candidate, "utf-8") > 45) {
      chunks.push(chunk);
      chunk = char;
    } else {
      chunk = candidate;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

function buildReplySubject(subject: string): string {
  if (!subject) return "Re:";
  return subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function buildReferencesHeader(references: string, messageId: string): string | undefined {
  if (!messageId) return references || undefined;
  return references ? `${references} ${messageId}` : messageId;
}

function buildReplyRecipients(options: {
  from: string;
  to: string;
  cc: string;
  replyAll: boolean;
  selfEmail: string;
}): string {
  const candidates = options.replyAll
    ? splitAddressList([options.from, options.to, options.cc].filter(Boolean).join(", "))
    : splitAddressList(options.from);
  const self = normalizeEmailAddress(options.selfEmail);
  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const candidate of candidates) {
    const identity = normalizeEmailAddress(candidate);
    if (!identity || identity === self || seen.has(identity)) continue;
    seen.add(identity);
    recipients.push(candidate);
  }

  return recipients.join(", ");
}

function splitAddressList(value: string): string[] {
  if (value.length > 20_000) {
    throw new Error("address list is too large");
  }
  if (value.trim() === "") return [];

  const parts: string[] = [];
  let part = "";
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;

  const appendPart = () => {
    const normalized = part.trim();
    part = "";
    if (!normalized) throw new Error("address list contains an empty address");
    if (parts.length >= 100) {
      throw new Error("address list contains too many addresses");
    }
    parts.push(normalized);
  };

  for (const character of value) {
    if (escaped) {
      part += character;
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      part += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      part += character;
      continue;
    }
    if (!quoted && character === "<") {
      if (angleDepth !== 0) throw new Error("address list contains nested angle brackets");
      angleDepth = 1;
      part += character;
      continue;
    }
    if (!quoted && character === ">") {
      if (angleDepth !== 1) throw new Error("address list contains unmatched angle brackets");
      angleDepth = 0;
      part += character;
      continue;
    }
    if (!quoted && angleDepth === 0 && character === ",") {
      appendPart();
      continue;
    }
    part += character;
  }

  if (quoted || escaped) throw new Error("address list contains an unterminated quote");
  if (angleDepth !== 0) throw new Error("address list contains unmatched angle brackets");
  appendPart();
  return parts;
}

function normalizeEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim().toLowerCase();
}

function getHeader(headers: HeaderLike[], name: string): string {
  const value = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
  return sanitizeHeaderValue(value, name);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalHeaderSafeString(value: unknown, field: string): string | undefined {
  const stringValue = optionalString(value, field);
  return stringValue ? sanitizeHeaderValue(stringValue, field) : undefined;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requireOpaqueProviderId(value: unknown, field: string): string {
  const normalized = optionalProviderString(value, field);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  if (normalized.length > 512) {
    throw new Error(`${field} must be at most 512 characters`);
  }
  return normalized;
}

function requireDecimalHistoryId(value: unknown, field: string): string {
  const normalized = requireOpaqueProviderId(value, field);
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) {
    throw new Error(`${field} must be an unsigned decimal Gmail history ID`);
  }
  return normalized;
}

function optionalProviderString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeProviderStringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  return value.map((entry, index) =>
    requireOpaqueProviderId(entry, `${field}[${index}]`)
  );
}

function requireHeaderSafeString(value: unknown, field: string): string {
  return sanitizeHeaderValue(requireString(value, field).trim(), field);
}

function sanitizeHeaderValue(value: string, field: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} must not contain newlines`);
  }
  return value.trim();
}
