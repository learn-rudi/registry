import { execFile } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { delimiter, dirname, join } from "path";
import { promisify } from "util";

import { hostnameMatches, parseHttpUrl } from "./url-policy.js";
import { extractReddit, formatRedditResult } from "./reddit.js";
import { extractGitHub, formatGitHubResult } from "./github.js";
import { extractArticle, extractTikTok, extractYouTube, formatArticleResult, formatTikTokResult, formatYouTubeResult } from "./index.js";

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "outputs");

function ensureOutputDir(outputPath = DEFAULT_OUTPUT_DIR): void { const dir = outputPath.includes(".") ? dirname(outputPath) : outputPath; if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function safeSlug(text: string | undefined, fallback: string): string {
  return slugify(text || fallback) || fallback;
}

function csvEscape(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim().length > 0)) rows.push(row);
  return rows;
}

function parseCsvRecords(csv: string): Record<string, string>[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index] ?? "";
    });
    return record;
  });
}

// BATCH EXTRACTOR
// =============================================================================

type BatchPlatform = "youtube" | "reddit" | "tiktok" | "github" | "article" | "unknown";
type BatchStatus = "success" | "unsupported_binary" | "no_transcript" | "blocked" | "rate_limited" | "fetch_failed" | "error" | "invalid_url" | "browser_captured" | "browser_blocked" | "browser_empty" | "browser_not_found" | "browser_unclassified" | "browser_unavailable" | "browser_failed";
type BrowserFallbackStatus = "captured" | "unavailable" | "failed";
type BrowserCaptureClassification = "content" | "blocked" | "empty" | "not_found" | "unclassified";

interface BrowserFallbackResult {
  status: BrowserFallbackStatus;
  binary?: string;
  screenshotPath?: string;
  classification?: BrowserCaptureClassification;
  classifier?: string;
  classifierError?: string;
  textPath?: string;
  textSample?: string;
  textWordCount?: number;
  error?: string;
}

interface BrowserFallbackOptions {
  enabled: boolean;
  timeoutMs: number;
  statuses: Set<BatchStatus>;
}

export interface BatchInputItem {
  id?: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface BatchInput {
  urls?: string[];
  items?: BatchInputItem[];
  csv_path?: string;
  url_column?: string;
  output_dir?: string;
  max_concurrency?: number;
  browser_fallback?: boolean;
  browser_timeout_ms?: number;
  browser_fallback_statuses?: BatchStatus[];
}

interface NormalizedBatchRow {
  id: string;
  rowNumber: number;
  url: string;
  normalizedUrl: string;
  metadata: Record<string, unknown>;
  validationError?: string;
}

export interface BatchExtractionResult {
  url: string;
  platform: BatchPlatform;
  status: BatchStatus;
  title: string;
  content: string;
  outputPath?: string;
  artifactDir?: string;
  sourcePath?: string;
  resultPath?: string;
  errorPath?: string;
  screenshotPath?: string;
  originalStatus?: BatchStatus;
  browserFallback?: BrowserFallbackResult;
  metadata: Record<string, unknown>;
  error?: string;
}

export interface BatchMention {
  id: string;
  rowNumber: number;
  url: string;
  normalizedUrl: string;
  platform: BatchPlatform;
  status: BatchStatus;
  title: string;
  outputPath?: string;
  artifactDir?: string;
  errorPath?: string;
  screenshotPath?: string;
  error?: string;
  duplicateOf?: string;
  metadata: Record<string, unknown>;
}

export interface BatchResult {
  status: "complete";
  totalRows: number;
  uniqueUrls: number;
  statusCounts: Record<string, number>;
  outputDir: string;
  manifestPath: string;
  reportCsvPath: string;
  resultsJsonlPath: string;
  results: BatchExtractionResult[];
  mentions: BatchMention[];
}

function normalizeBatchConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 4;
  return Math.min(Math.max(Math.floor(value), 1), 10);
}

const DEFAULT_BROWSER_TIMEOUT_MS = 15_000;
const MIN_BROWSER_TIMEOUT_MS = 1_000;
const MAX_BROWSER_TIMEOUT_MS = 60_000;
const DEFAULT_BROWSER_FALLBACK_STATUSES: BatchStatus[] = ["blocked", "rate_limited", "fetch_failed"];
const ALLOWED_BROWSER_FALLBACK_STATUSES = new Set<BatchStatus>([
  "blocked",
  "rate_limited",
  "fetch_failed",
  "error",
  "no_transcript",
]);

function normalizeBrowserTimeoutMs(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_BROWSER_TIMEOUT_MS;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("browser_timeout_ms must be a finite number");
  }
  return Math.min(Math.max(Math.floor(value), MIN_BROWSER_TIMEOUT_MS), MAX_BROWSER_TIMEOUT_MS);
}

function normalizeBrowserFallbackStatuses(value: unknown): Set<BatchStatus> {
  if (value === undefined || value === null) return new Set(DEFAULT_BROWSER_FALLBACK_STATUSES);
  if (!Array.isArray(value)) {
    throw new Error("browser_fallback_statuses must be an array of supported status strings");
  }

  return new Set(value.map((status) => {
    if (typeof status !== "string" || !ALLOWED_BROWSER_FALLBACK_STATUSES.has(status as BatchStatus)) {
      throw new Error(`Unsupported browser_fallback_statuses value: ${String(status)}`);
    }
    return status as BatchStatus;
  }));
}

function browserFallbackOptions(input: BatchInput): BrowserFallbackOptions {
  return {
    enabled: input.browser_fallback === true,
    timeoutMs: normalizeBrowserTimeoutMs(input.browser_timeout_ms),
    statuses: normalizeBrowserFallbackStatuses(input.browser_fallback_statuses),
  };
}

function batchOutputDir(inputDir: unknown): string {
  if (typeof inputDir === "string" && inputDir.trim().length > 0) return inputDir.trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(DEFAULT_OUTPUT_DIR, `content-extractor-batch-${stamp}`);
}

function normalizeBatchUrl(rawUrl: unknown, rowNumber: number): { url: string; normalizedUrl: string; validationError?: string } {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  try {
    return { url, normalizedUrl: parseHttpUrl(url, `row ${rowNumber} url`).toString() };
  } catch (error: any) {
    return { url, normalizedUrl: `invalid:${rowNumber}:${hashText(String(rawUrl ?? ""))}`, validationError: error.message };
  }
}

function objectMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function normalizeBatchRows(input: BatchInput): NormalizedBatchRow[] {
  const rows: NormalizedBatchRow[] = [];

  const addRow = (rawUrl: unknown, id: string | undefined, metadata: Record<string, unknown>) => {
    const rowNumber = rows.length + 1;
    const normalized = normalizeBatchUrl(rawUrl, rowNumber);
    rows.push({
      id: id || `row-${rowNumber}`,
      rowNumber,
      url: normalized.url,
      normalizedUrl: normalized.normalizedUrl,
      metadata,
      validationError: normalized.validationError,
    });
  };

  if (Array.isArray(input.urls)) {
    input.urls.forEach((url, index) => addRow(url, `url-${index + 1}`, {}));
  }

  if (Array.isArray(input.items)) {
    input.items.forEach((item, index) => {
      addRow(item?.url, item?.id || `item-${index + 1}`, objectMetadata(item?.metadata));
    });
  }

  if (input.csv_path) {
    const records = parseCsvRecords(readFileSync(input.csv_path, "utf8"));
    const headers = records[0] ? Object.keys(records[0]) : [];
    const urlColumn = input.url_column || headers.find((header) => header.toLowerCase() === "url");
    if (!urlColumn) throw new Error("csv_path requires url_column when the CSV has no url header");

    records.forEach((record, index) => {
      const metadata: Record<string, unknown> = {};
      Object.entries(record).forEach(([key, value]) => {
        if (key !== urlColumn && key.toLowerCase() !== "id") metadata[key] = value;
      });
      addRow(record[urlColumn], record.id || record.ID || `csv-${index + 1}`, metadata);
    });
  }

  if (rows.length === 0) throw new Error("extractBatch requires urls, items, or csv_path");
  return rows;
}

function detectBatchPlatform(url: string): BatchPlatform {
  try {
    const parsed = parseHttpUrl(url);
    if (hostnameMatches(parsed, ["youtube.com", "youtu.be"])) return "youtube";
    if (hostnameMatches(parsed, ["reddit.com", "redd.it"])) return "reddit";
    if (hostnameMatches(parsed, ["tiktok.com"])) return "tiktok";
    if (hostnameMatches(parsed, ["github.com", "gist.github.com", "raw.githubusercontent.com"])) return "github";
    return "article";
  } catch {
    return "unknown";
  }
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }));

  return results;
}

async function extractBatchUrl(row: NormalizedBatchRow): Promise<BatchExtractionResult> {
  if (row.validationError) {
    return {
      url: row.url,
      platform: "unknown",
      status: "invalid_url",
      title: row.url || `row-${row.rowNumber}`,
      content: "",
      metadata: {},
      error: row.validationError,
    };
  }

  const platform = detectBatchPlatform(row.normalizedUrl);

  try {
    switch (platform) {
      case "youtube": {
        const data = await extractYouTube(row.normalizedUrl);
        return { url: data.url, platform, status: data.hasTranscript ? "success" : "no_transcript", title: data.title, content: formatYouTubeResult(data), metadata: { videoId: data.videoId, extractionMethod: data.extractionMethod } };
      }
      case "reddit": {
        const data = await extractReddit(row.normalizedUrl);
        return { url: data.url, platform, status: "success", title: data.title, content: formatRedditResult(data), metadata: data.metadata as unknown as Record<string, unknown> };
      }
      case "tiktok": {
        const data = await extractTikTok(row.normalizedUrl);
        return { url: data.url, platform, status: data.hasTranscript ? "success" : "no_transcript", title: data.metadata.description || `@${data.metadata.user}`, content: formatTikTokResult(data), metadata: data.metadata as unknown as Record<string, unknown> };
      }
      case "github": {
        const data = await extractGitHub(row.normalizedUrl);
        return { url: data.url, platform, status: data.status, title: data.title, content: formatGitHubResult(data), metadata: { kind: data.kind, ...data.metadata } };
      }
      case "article": {
        const data = await extractArticle(row.normalizedUrl);
        return { url: data.url, platform, status: "success", title: data.title, content: formatArticleResult(data), metadata: { author: data.author, siteName: data.siteName, domain: data.domain, wordCount: data.wordCount } };
      }
      default:
        return { url: row.normalizedUrl, platform: "unknown", status: "error", title: row.url, content: "", metadata: {}, error: "Unsupported URL platform" };
    }
  } catch (error: any) {
    const message = batchErrorMessage(error);
    return {
      url: row.normalizedUrl,
      platform,
      status: classifyBatchError(message),
      title: row.url,
      content: "",
      metadata: {},
      error: message,
    };
  }
}

function batchErrorMessage(error: any): string {
  const message = error?.message ? String(error.message) : String(error);
  const cause = error?.cause;
  if (!cause) return message;
  const causeParts = [cause.code, cause.message].filter(Boolean).map(String);
  if (causeParts.length === 0) return message;
  return `${message}: ${causeParts.join(": ")}`;
}

function classifyBatchError(message: string): BatchStatus {
  if (/HTTP\s+429|Too Many Requests|rate limit|rate-limit/i.test(message)) return "rate_limited";
  if (/HTTP\s+(401|403)|Forbidden|Access Denied|cf-mitigated|captcha|challenge/i.test(message)) return "blocked";
  if (/fetch failed|UND_ERR_|Headers Overflow|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return "fetch_failed";
  return "error";
}

function isExecutableCandidate(path: string | undefined): path is string {
  if (!path) return false;
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findExecutableOnPath(name: string): string | undefined {
  const pathEntries = (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = join(entry, name);
    if (isExecutableCandidate(candidate)) return candidate;
  }
  return undefined;
}

function resolvePlaywrightBinary(): string | undefined {
  const envCandidates = [process.env.RUDI_PLAYWRIGHT_BIN, process.env.PLAYWRIGHT_BIN]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  for (const candidate of envCandidates) {
    if (isExecutableCandidate(candidate)) return candidate;
  }

  const rudiManagedBinary = join(homedir(), ".rudi", "bins", "playwright");
  if (isExecutableCandidate(rudiManagedBinary)) return rudiManagedBinary;

  return findExecutableOnPath("playwright");
}

function resolveTesseractBinary(): string | undefined {
  const envCandidates = [process.env.RUDI_TESSERACT_BIN, process.env.TESSERACT_BIN]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  for (const candidate of envCandidates) {
    if (isExecutableCandidate(candidate)) return candidate;
  }

  const rudiManagedBinary = join(homedir(), ".rudi", "bins", "tesseract");
  if (isExecutableCandidate(rudiManagedBinary)) return rudiManagedBinary;

  return findExecutableOnPath("tesseract");
}

function processExecutionErrorMessage(error: any): string {
  const message = batchErrorMessage(error);
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  if (!stderr) return message;
  return `${message}: ${stderr.slice(0, 500)}`;
}

function normalizeBrowserCaptureText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function browserCaptureTextSample(value: string): string {
  const sample = value.replace(/\s+/g, " ").trim();
  return sample.length > 500 ? `${sample.slice(0, 500)}...` : sample;
}

function classifyBrowserCaptureText(text: string): BrowserCaptureClassification {
  const normalized = text.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (!text.trim()) return "empty";
  if (/404|page not found|not found/i.test(text) && wordCount < 120) return "not_found";
  if (
    /not a robot|not a bot|malicious bots|security verification|verifying\.\.\.|unusual activity|access is temporarily restricted|automated \(bot\) activity|suspect that you're a robot|blocked from the new york times|press\s*&\s*hold to confirm you are a human|enable javascript and cookies|captcha|cloudflare/i.test(normalized)
  ) {
    return "blocked";
  }
  if (/sign in|log in|login|create account|register/i.test(text) && wordCount < 80) return "blocked";
  if (wordCount >= 40) return "content";
  return "unclassified";
}

function browserCaptureStatusForClassification(classification: BrowserCaptureClassification): BatchStatus {
  if (classification === "content") return "browser_captured";
  if (classification === "blocked") return "browser_blocked";
  if (classification === "empty") return "browser_empty";
  if (classification === "not_found") return "browser_not_found";
  return "browser_unclassified";
}

async function classifyBrowserScreenshot(screenshotPath: string, timeoutMs: number): Promise<Pick<BrowserFallbackResult, "classification" | "classifier" | "classifierError" | "textPath" | "textSample" | "textWordCount">> {
  const binary = resolveTesseractBinary();
  if (!binary) {
    return {
      classification: "unclassified",
      classifier: "tesseract_unavailable",
      textWordCount: 0,
    };
  }

  try {
    const { stdout } = await execFileAsync(binary, [
      screenshotPath,
      "stdout",
      "-l",
      "eng",
      "--psm",
      "11",
    ], {
      timeout: Math.min(Math.max(timeoutMs, 5_000), 30_000),
      maxBuffer: 1024 * 1024,
    });
    const text = normalizeBrowserCaptureText(stdout || "");
    const textPath = join(dirname(screenshotPath), "browser_text.txt");
    writeFileSync(textPath, text ? `${text}\n` : "", "utf8");
    return {
      classification: classifyBrowserCaptureText(text),
      classifier: "tesseract",
      textPath,
      textSample: browserCaptureTextSample(text),
      textWordCount: text.split(/\s+/).filter(Boolean).length,
    };
  } catch (error: any) {
    return {
      classification: "unclassified",
      classifier: "tesseract_failed",
      classifierError: processExecutionErrorMessage(error),
      textWordCount: 0,
    };
  }
}

async function captureBrowserScreenshot(url: string, screenshotPath: string, timeoutMs: number): Promise<BrowserFallbackResult> {
  let browserUrl: string;
  try {
    browserUrl = parseHttpUrl(url, "browser fallback url").toString();
  } catch (error: any) {
    return {
      status: "failed",
      error: error.message,
    };
  }

  const binary = resolvePlaywrightBinary();
  if (!binary) {
    return {
      status: "unavailable",
      error: "Playwright binary not found. Install or expose the RUDI-managed playwright binary.",
    };
  }

  ensureOutputDir(screenshotPath);

  try {
    await execFileAsync(binary, [
      "screenshot",
      "--browser",
      "chromium",
      "--full-page",
      "--timeout",
      String(timeoutMs),
      browserUrl,
      screenshotPath,
    ], {
      timeout: timeoutMs + 5_000,
      maxBuffer: 1024 * 1024,
    });

    const classification = await classifyBrowserScreenshot(screenshotPath, timeoutMs);
    return {
      status: "captured",
      binary,
      screenshotPath,
      ...classification,
    };
  } catch (error: any) {
    return {
      status: "failed",
      binary,
      error: processExecutionErrorMessage(error),
    };
  }
}

function shouldRunBrowserFallback(result: BatchExtractionResult, options: BrowserFallbackOptions): boolean {
  return options.enabled && options.statuses.has(result.status);
}

function uniqueArtifactSlug(row: NormalizedBatchRow, result: BatchExtractionResult, usedSlugs: Set<string>): string {
  const base = safeSlug(row.id || result.title, `row-${row.rowNumber}`);
  if (!usedSlugs.has(base)) {
    usedSlugs.add(base);
    return base;
  }
  const withHash = `${base}-${hashText(row.normalizedUrl).slice(0, 6)}`;
  usedSlugs.add(withHash);
  return withHash;
}

async function writeBatchArtifactFiles(outputDir: string, rows: NormalizedBatchRow[], results: BatchExtractionResult[], browserFallback: BrowserFallbackOptions): Promise<BatchExtractionResult[]> {
  const linksDir = join(outputDir, "links");
  ensureOutputDir(linksDir);
  const usedSlugs = new Set<string>();
  const resultsWithArtifacts: BatchExtractionResult[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const row = rows[index];
    const artifactDir = join(linksDir, uniqueArtifactSlug(row, result, usedSlugs));
    ensureOutputDir(artifactDir);

    const sourcePath = join(artifactDir, "source.json");
    writeFileSync(sourcePath, JSON.stringify({
      id: row.id,
      rowNumber: row.rowNumber,
      url: row.url,
      normalizedUrl: row.normalizedUrl,
      metadata: row.metadata,
    }, null, 2) + "\n", "utf8");

    let withArtifacts: BatchExtractionResult = { ...result, artifactDir, sourcePath };
    if (shouldRunBrowserFallback(withArtifacts, browserFallback)) {
      const originalStatus = withArtifacts.status;
      const screenshotPath = join(artifactDir, "page.png");
      const fallback = await captureBrowserScreenshot(withArtifacts.url, screenshotPath, browserFallback.timeoutMs);

      if (fallback.status === "captured") {
        const browserStatus = browserCaptureStatusForClassification(fallback.classification || "unclassified");
        withArtifacts = {
          ...withArtifacts,
          status: browserStatus,
          originalStatus,
          screenshotPath: fallback.screenshotPath,
          browserFallback: fallback,
        };
      } else if (fallback.status === "unavailable") {
        withArtifacts = {
          ...withArtifacts,
          status: "browser_unavailable",
          originalStatus,
          browserFallback: fallback,
        };
      } else {
        withArtifacts = {
          ...withArtifacts,
          status: "browser_failed",
          originalStatus,
          browserFallback: fallback,
        };
      }
    }

    if (result.content) {
      withArtifacts.outputPath = join(artifactDir, "content.md");
      writeFileSync(withArtifacts.outputPath, result.content, "utf8");
    }
    if (result.error) {
      withArtifacts.errorPath = join(artifactDir, "error.json");
      writeFileSync(withArtifacts.errorPath, JSON.stringify({
        url: result.url,
        platform: result.platform,
        status: withArtifacts.status,
        originalStatus: withArtifacts.originalStatus,
        title: result.title,
        error: result.error,
        browserFallback: withArtifacts.browserFallback,
      }, null, 2) + "\n", "utf8");
    }

    withArtifacts.resultPath = join(artifactDir, "result.json");
    const { content, ...serializableResult } = withArtifacts;
    writeFileSync(withArtifacts.resultPath, JSON.stringify({
      ...serializableResult,
      contentBytes: Buffer.byteLength(content || "", "utf8"),
    }, null, 2) + "\n", "utf8");

    resultsWithArtifacts.push(withArtifacts);
  }

  return resultsWithArtifacts;
}

function buildBatchReport(mentions: BatchMention[]): string {
  const headers = ["id", "row_number", "url", "normalized_url", "platform", "status", "title", "output_path", "artifact_dir", "error_path", "screenshot_path", "error", "duplicate_of", "metadata_json"];
  const rows = mentions.map((mention) => [
    mention.id,
    mention.rowNumber,
    mention.url,
    mention.normalizedUrl,
    mention.platform,
    mention.status,
    mention.title,
    mention.outputPath || "",
    mention.artifactDir || "",
    mention.errorPath || "",
    mention.screenshotPath || "",
    mention.error || "",
    mention.duplicateOf || "",
    JSON.stringify(mention.metadata),
  ]);
  return [csvLine(headers), ...rows.map(csvLine)].join("\n");
}

export async function extractBatch(input: BatchInput): Promise<BatchResult> {
  const rows = normalizeBatchRows(input || {});
  const outputDir = batchOutputDir(input?.output_dir);
  const maxConcurrency = normalizeBatchConcurrency(input?.max_concurrency);
  const fallbackOptions = browserFallbackOptions(input || {});
  ensureOutputDir(outputDir);

  const uniqueRows = Array.from(new Map(rows.map((row) => [row.normalizedUrl, row])).values());
  const extracted = await mapLimit(uniqueRows, maxConcurrency, extractBatchUrl);
  const results = await writeBatchArtifactFiles(outputDir, uniqueRows, extracted, fallbackOptions);
  const resultByUrl = new Map(results.map((result, index) => [uniqueRows[index].normalizedUrl, result]));
  const firstRowIdByUrl = new Map<string, string>();

  const mentions = rows.map((row): BatchMention => {
    const result = resultByUrl.get(row.normalizedUrl);
    const duplicateOf = firstRowIdByUrl.get(row.normalizedUrl);
    if (!duplicateOf) firstRowIdByUrl.set(row.normalizedUrl, row.id);

    return {
      id: row.id,
      rowNumber: row.rowNumber,
      url: row.url,
      normalizedUrl: row.normalizedUrl,
      platform: result?.platform || "unknown",
      status: result?.status || "error",
      title: result?.title || row.url,
      outputPath: result?.outputPath,
      artifactDir: result?.artifactDir,
      errorPath: result?.errorPath,
      screenshotPath: result?.screenshotPath,
      error: result?.error,
      duplicateOf,
      metadata: row.metadata,
    };
  });

  const statusCounts = results.reduce<Record<string, number>>((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  const manifestPath = join(outputDir, "batch_manifest.json");
  const reportCsvPath = join(outputDir, "batch_report.csv");
  const resultsJsonlPath = join(outputDir, "batch_results.jsonl");
  const manifest = {
    status: "complete",
    generatedAt: new Date().toISOString(),
    totalRows: rows.length,
    uniqueUrls: uniqueRows.length,
    maxConcurrency,
    browserFallback: {
      enabled: fallbackOptions.enabled,
      timeoutMs: fallbackOptions.timeoutMs,
      statuses: Array.from(fallbackOptions.statuses),
    },
    statusCounts,
    outputDir,
    reportCsvPath,
    resultsJsonlPath,
    results: results.map(({ content, ...result }) => ({ ...result, contentBytes: Buffer.byteLength(content || "", "utf8") })),
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(reportCsvPath, buildBatchReport(mentions), "utf8");
  writeFileSync(resultsJsonlPath, results.map((result) => JSON.stringify(result)).join("\n") + "\n", "utf8");

  return {
    status: "complete",
    totalRows: rows.length,
    uniqueUrls: uniqueRows.length,
    statusCounts,
    outputDir,
    manifestPath,
    reportCsvPath,
    resultsJsonlPath,
    results,
    mentions,
  };
}

export function formatBatchResult(result: BatchResult): string {
  const counts = Object.entries(result.statusCounts).map(([status, count]) => `${status}: ${count}`).join(", ");
  return `**Batch Extraction Complete**\n\n**Rows:** ${result.totalRows}\n**Unique URLs fetched:** ${result.uniqueUrls}\n**Status counts:** ${counts || "none"}\n\n**Output directory:** ${result.outputDir}\n**Manifest:** ${result.manifestPath}\n**Report CSV:** ${result.reportCsvPath}\n**Results JSONL:** ${result.resultsJsonlPath}`;
}
