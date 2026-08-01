import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const MUNICODE_LIBRARY_ORIGIN = "https://library.municode.com";
const MUNICODE_API_ORIGIN = `${MUNICODE_LIBRARY_ORIGIN}/api`;
const MUNICODE_PDF_ORIGIN = "https://mcclibrary.blob.core.usgovcloudapi.net";
const MAX_JSON_BYTES = 5_000_000;
const MAX_PDF_BYTES = 25_000_000;
const MAX_SECTION_TEXT_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(execFile);

const NAMED_HTML_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  deg: "°",
  frac12: "½",
  gt: ">",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  plusmn: "±",
  quot: '"',
  times: "×"
});

// Each profile fixes the provider product identity; callers never supply IDs or origins.
const JURISDICTION_PROFILES = Object.freeze({
  "cincinnati-oh": Object.freeze({
    clientId: 1650,
    jurisdiction: "cincinnati-oh",
    libraryPath: "/oh/cincinnati/codes/code_of_ordinances",
    municipality: "Cincinnati, Ohio",
    productId: 19996
  })
});

export class MunicodeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "MunicodeError";
    this.code = code;
    this.retryable = options.retryable === true;
  }
}

export function createMunicodeClient({
  extractPdfText = extractPdfTextWithPdftotext,
  fetchImpl = fetch,
  now = () => new Date()
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new MunicodeError("invalid_configuration", "fetchImpl must be a function.");
  }
  if (typeof now !== "function") {
    throw new MunicodeError("invalid_configuration", "now must be a function.");
  }
  if (typeof extractPdfText !== "function") {
    throw new MunicodeError("invalid_configuration", "extractPdfText must be a function.");
  }

  async function resolvePublication(profile) {
    const jobs = await fetchJson(
      fetchImpl,
      `${MUNICODE_API_ORIGIN}/Jobs/product/${profile.productId}`
    );
    if (!Array.isArray(jobs) || jobs.length === 0) {
      throw new MunicodeError(
        "invalid_provider_response",
        "Municode returned no publication records."
      );
    }
    const latest = jobs.find((job) => job?.IsLatest === true)
      ?? [...jobs].sort((left, right) => Number(right?.Id ?? 0) - Number(left?.Id ?? 0))[0];
    return {
      clientId: profile.clientId,
      isLatest: latest?.IsLatest === true,
      jobId: requirePositiveInteger(latest?.Id, "publication job ID"),
      name: requireBoundedText(latest?.Name, "publication name", 500),
      productId: profile.productId
    };
  }

  return {
    async getPublication(input) {
      const profile = requireProfileInput(input, ["jurisdiction"]);
      const publication = await resolvePublication(profile);

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile)
      });
    },

    async getCodeSection(input) {
      const profile = requireProfileInput(input, ["jurisdiction", "nodeId"]);
      const nodeId = requireNodeId(input.nodeId, "nodeId");
      const publication = await resolvePublication(profile);
      const url = new URL("/api/CodesContent", MUNICODE_LIBRARY_ORIGIN);
      url.searchParams.set("productId", String(publication.productId));
      url.searchParams.set("jobId", String(publication.jobId));
      url.searchParams.set("nodeId", nodeId);
      const payload = await fetchJson(fetchImpl, url);
      const docs = selectCodeDocuments(payload, nodeId);
      const htmlDocs = docs.filter((doc) => typeof doc?.Content === "string");
      const primaryDoc = docs.find((doc) => doc?.Id === nodeId) ?? docs[0];
      let contentFormat = "text";
      let documentUrl;
      let text;
      if (htmlDocs.length > 0) {
        text = htmlDocs
          .map((doc) => htmlToText(doc.Content))
          .filter(Boolean)
          .join("\n\n")
          .trim();
      } else if (primaryDoc?.DocType === 2) {
        contentFormat = "pdf_text";
        documentUrl = pdfUrl(publication, nodeId);
        const pdfBytes = await fetchPdf(fetchImpl, documentUrl);
        let extracted;
        try {
          extracted = await extractPdfText(pdfBytes, {
            documentUrl,
            jurisdiction: profile.jurisdiction,
            jobId: publication.jobId,
            nodeId,
            productId: publication.productId
          });
        } catch (error) {
          if (error instanceof MunicodeError) throw error;
          throw new MunicodeError(
            "pdf_extraction_failed",
            "Municode PDF text extraction failed.",
            { cause: error }
          );
        }
        if (typeof extracted !== "string") {
          throw new MunicodeError(
            "pdf_extraction_failed",
            "Municode PDF text extraction returned invalid text."
          );
        }
        text = normalizeText(extracted);
      } else {
        throw new MunicodeError(
          "unsupported_content_type",
          "The requested Municode section has an unsupported content type."
        );
      }
      if (text.length === 0) {
        throw new MunicodeError(
          "invalid_provider_response",
          "Municode returned an empty code section."
        );
      }
      if (text.length > MAX_SECTION_TEXT_CHARS) {
        throw new MunicodeError(
          "provider_response_too_large",
          "Municode section text exceeds the size limit."
        );
      }

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile, nodeId),
        values: {
          section: {
            contentFormat,
            contentSha256: sha256(text),
            ...(documentUrl === undefined ? {} : { documentUrl }),
            nodeId,
            text,
            title: requireBoundedText(primaryDoc?.Title, "provider section title", 1_000)
          }
        }
      });
    },

    async listCodeSections(input) {
      const profile = requireProfileInput(input, [
        "cursor",
        "jurisdiction",
        "limit",
        "parentNodeId"
      ]);
      const parentNodeId = requireNodeId(input.parentNodeId);
      const limit = optionalPageLimit(input.limit);
      const cursor = optionalCursor(input.cursor);
      const publication = await resolvePublication(profile);
      const url = new URL("/api/codesToc/children", MUNICODE_LIBRARY_ORIGIN);
      url.searchParams.set("productId", String(publication.productId));
      url.searchParams.set("jobId", String(publication.jobId));
      url.searchParams.set("nodeId", parentNodeId);
      const payload = await fetchJson(fetchImpl, url);
      if (!Array.isArray(payload)) {
        throw new MunicodeError(
          "invalid_provider_response",
          "Municode returned an invalid code-section collection."
        );
      }
      const sections = payload.map((entry) => ({
        hasChildren: entry?.HasChildren === true,
        nodeId: requireNodeId(entry?.Id, "provider node ID"),
        sourceUrl: libraryUrl(profile, requireNodeId(entry?.Id, "provider node ID")),
        title: requireBoundedText(entry?.Heading, "provider section title", 1_000)
      }));
      const start = cursor === null ? 0 : cursor;
      const pageSections = sections.slice(start, start + limit);
      const nextOffset = start + pageSections.length;

      return resultEnvelope({
        now,
        profile,
        publication,
        sourceUrl: libraryUrl(profile, parentNodeId),
        values: {
          page: {
            cursor: cursor === null ? null : String(cursor),
            limit,
            nextCursor: nextOffset < sections.length ? String(nextOffset) : null
          },
          parentNodeId,
          sections: pageSections
        }
      });
    }
  };
}

function selectCodeDocuments(payload, requestedNodeId) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned an invalid code-content payload."
    );
  }
  const docs = Array.isArray(payload.Docs) ? payload.Docs : [];
  const target = docs.find((doc) => doc?.Id === requestedNodeId);
  if (!target) {
    throw new MunicodeError(
      "provider_reference_not_found",
      "Municode did not return the requested code section."
    );
  }
  const groupId = target.ChunkGroupStartingNodeId ?? target.Id;
  const selected = target.Id === groupId
    ? docs.filter((doc) => (doc?.ChunkGroupStartingNodeId ?? doc?.Id) === groupId)
    : [target];
  const seen = new Set();
  return selected.filter((doc) => {
    const id = typeof doc?.Id === "string" ? doc.Id : null;
    if (id === null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function htmlToText(html) {
  if (typeof html !== "string") {
    throw new MunicodeError("invalid_provider_response", "Municode HTML content is invalid.");
  }
  let text = html.replace(/\r/gu, "");
  text = text.replace(/<\s*(?:script|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/giu, "");
  text = text.replace(/<\s*br\s*\/?>/giu, "\n");
  text = text.replace(/<\s*li\b[^>]*>/giu, "- ");
  text = text.replace(/<\s*\/\s*li\s*>/giu, "\n");
  text = text.replace(/<\s*\/\s*(?:p|div|section|article|ul|ol|table|thead|tbody|tfoot|figure)\s*>/giu, "\n");
  text = text.replace(/<\s*tr\b[^>]*>/giu, "");
  text = text.replace(/<\s*\/\s*tr\s*>/giu, "\n");
  text = text.replace(/<\s*(?:td|th)\b[^>]*>/giu, "");
  text = text.replace(/<\s*\/\s*(?:td|th)\s*>/giu, "\t");
  text = text.replace(/<[^>]+>/gu, "");
  text = decodeHtmlEntities(text);
  return normalizeText(text);
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => safeCodePoint(hex, 16))
    .replace(/&#([0-9]+);/gu, (_, number) => safeCodePoint(number, 10))
    .replace(/&([a-z0-9]+);/giu, (match, name) => (
      NAMED_HTML_ENTITIES[name.toLowerCase()] ?? match
    ));
}

function safeCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "�";
}

function normalizeText(value) {
  const lines = value.split("\n").map((line) => (
    line
      .split("\t")
      .map((cell) => cell.replace(/[ \f\v]+/gu, " ").trim())
      .join("\t")
      .replace(/\t+$/u, "")
  ));
  const output = [];
  for (const line of lines) {
    if (line.length === 0 && output[output.length - 1] === "") continue;
    output.push(line);
  }
  return output.join("\n").trim();
}

function resultEnvelope({ now, profile, publication, sourceUrl, values = {} }) {
  return {
    jurisdiction: profile.jurisdiction,
    publication,
    retrievedAt: requireTimestamp(now()),
    schemaVersion: 1,
    source: "municode",
    sourceUrl,
    status: "succeeded",
    ...values
  };
}

function libraryUrl(profile, nodeId) {
  const url = new URL(profile.libraryPath, MUNICODE_LIBRARY_ORIGIN);
  if (nodeId !== undefined) {
    url.searchParams.set("nodeId", nodeId);
  }
  return url.toString();
}

function pdfUrl(publication, nodeId) {
  return `${MUNICODE_PDF_ORIGIN}/codecontent/${publication.productId}/${publication.jobId}/${encodeURIComponent(nodeId)}.pdf`;
}

async function fetchJson(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "X-CSRF": "1"
      },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new MunicodeError(
      "dependency_unavailable",
      "Municode request failed before a response was received.",
      { cause: error, retryable: true }
    );
  }

  const text = await readBoundedText(response, MAX_JSON_BYTES, "Municode JSON response");
  if (!response.ok) {
    throw new MunicodeError(
      "dependency_http_error",
      `Municode dependency returned HTTP ${response.status}.`,
      { retryable: response.status === 429 || response.status >= 500 }
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode returned invalid JSON.",
      { cause: error }
    );
  }
}

async function fetchPdf(fetchImpl, url) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/pdf" },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new MunicodeError(
      "dependency_unavailable",
      "Municode PDF request failed before a response was received.",
      { cause: error, retryable: true }
    );
  }
  if (!response.ok) {
    throw new MunicodeError(
      "dependency_http_error",
      `Municode PDF dependency returned HTTP ${response.status}.`,
      { retryable: response.status === 429 || response.status >= 500 }
    );
  }
  const bytes = await readBoundedBytes(response, MAX_PDF_BYTES, "Municode PDF response");
  if (
    bytes.byteLength < 4
    || bytes[0] !== 0x25
    || bytes[1] !== 0x50
    || bytes[2] !== 0x44
    || bytes[3] !== 0x46
  ) {
    throw new MunicodeError(
      "invalid_provider_response",
      "Municode PDF response is not a PDF document."
    );
  }
  return bytes;
}

async function readBoundedText(response, maxBytes, label) {
  const bytes = await readBoundedBytes(response, maxBytes, label);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new MunicodeError(
      "invalid_provider_response",
      `${label} is not valid UTF-8.`,
      { cause: error }
    );
  }
}

async function readBoundedBytes(response, maxBytes, label) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maxBytes) {
    throw new MunicodeError("provider_response_too_large", `${label} exceeds the size limit.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new MunicodeError("provider_response_too_large", `${label} exceeds the size limit.`);
  }
  return bytes;
}

export async function extractPdfTextWithPdftotext(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "rudi-municode-"));
  const inputPath = join(directory, "code-section.pdf");
  try {
    await writeFile(inputPath, bytes, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-nopgbrk", inputPath, "-"],
      {
        encoding: "utf8",
        maxBuffer: 1_000_000,
        timeout: REQUEST_TIMEOUT_MS,
        windowsHide: true
      }
    );
    const text = normalizeText(stdout);
    if (text.length === 0) {
      throw new MunicodeError(
        "pdf_extraction_failed",
        "Municode PDF text extraction returned empty text."
      );
    }
    return text;
  } catch (error) {
    if (error instanceof MunicodeError) throw error;
    throw new MunicodeError(
      "pdf_extraction_failed",
      "Municode PDF text extraction failed.",
      { cause: error }
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function requireProfileInput(input, allowedKeys) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MunicodeError("invalid_input", "Tool input must be an object.");
  }
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new MunicodeError("invalid_input", "Tool input contains unknown fields.");
  }
  const jurisdiction = requireInputText(input.jurisdiction, "jurisdiction", 100);
  const profile = JURISDICTION_PROFILES[jurisdiction];
  if (!profile) {
    throw new MunicodeError(
      "unsupported_jurisdiction",
      "No reviewed Municode profile exists for the requested jurisdiction."
    );
  }
  return profile;
}

function requirePositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new MunicodeError("invalid_provider_response", `Municode ${field} is invalid.`);
  }
  return number;
}

function requireNodeId(value, field = "parentNodeId") {
  const text = requireInputText(value, field, 300);
  let decoded;
  try {
    decoded = decodeURIComponent(text);
  } catch (error) {
    throw new MunicodeError("invalid_input", `${field} is not valid URL text.`, {
      cause: error
    });
  }
  if (!/^[\p{L}\p{N}_.:()' -]+$/u.test(decoded)) {
    throw new MunicodeError("invalid_input", `${field} contains unsupported characters.`);
  }
  return decoded;
}

function optionalPageLimit(value) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new MunicodeError("invalid_input", "limit must be an integer from 1 through 100.");
  }
  return value;
}

function optionalCursor(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d{1,9}$/u.test(value)) {
    throw new MunicodeError("invalid_input", "cursor must be a decimal offset string.");
  }
  return Number(value);
}

function requireBoundedText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new MunicodeError("invalid_provider_response", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new MunicodeError("invalid_provider_response", `${field} is invalid.`);
  }
  return text;
}

function requireInputText(value, field, maxLength) {
  if (typeof value !== "string") {
    throw new MunicodeError("invalid_input", `${field} must be text.`);
  }
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) {
    throw new MunicodeError("invalid_input", `${field} is invalid.`);
  }
  return text;
}

function requireTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new MunicodeError("invalid_configuration", "now returned an invalid timestamp.");
  }
  return timestamp.toISOString();
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const MUNICODE_ORIGINS = Object.freeze({
  api: MUNICODE_API_ORIGIN,
  library: MUNICODE_LIBRARY_ORIGIN,
  pdf: MUNICODE_PDF_ORIGIN
});
