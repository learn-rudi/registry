#!/usr/bin/env node
/**
 * Content Extractor MCP
 * Extract content from YouTube, Reddit, TikTok, web articles, and link pages
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { extractYouTube, extractReddit, ... } from './index'
 *   - As CLI: node index.ts <url> [output]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync, existsSync, statSync, mkdirSync, readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "dotenv";
import { fileURLToPath, pathToFileURL } from "url";
import { delimiter, dirname, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import * as cheerio from "cheerio";
import { decode } from "html-entities";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const execFileAsync = promisify(execFile);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "output");
const READABILITY_VIRTUAL_CONSOLE = new VirtualConsole();

// =============================================================================
// UTILITIES
// =============================================================================

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function resolveOutputPath(output: string | undefined, prefix: string, name: string, extension = "md"): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "") || "md";
  const filename = `${prefix}-${slugify(name)}-${new Date().toISOString().split("T")[0]}.${safeExtension}`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, filename);
  return output;
}

function ensureOutputDir(outputPath = DEFAULT_OUTPUT_DIR) {
  const dir = outputPath.includes(".") ? dirname(outputPath) : outputPath;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function parseHttpUrl(rawUrl: unknown, fieldName = "url"): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${fieldName} must use http or https`);
  }

  return parsed;
}

function hostnameMatches(parsed: URL, domains: string[]): boolean {
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; the original HTTP error is more useful.
  }
}

async function throwHttpResponseError(response: Response, prefix = "HTTP"): Promise<never> {
  await discardResponseBody(response);
  throw new Error(`${prefix} ${response.status}: ${response.statusText}`);
}

function removeStyleBlocks(html: string): string {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function requirePlatformUrl(rawUrl: unknown, platform: string, domains: string[]): string {
  const parsed = parseHttpUrl(rawUrl);
  if (!hostnameMatches(parsed, domains)) {
    throw new Error(`${platform} extractor requires a ${domains.join(" or ")} URL`);
  }
  return parsed.toString();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
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

// =============================================================================
// YOUTUBE EXTRACTOR
// =============================================================================

export interface YouTubeResult {
  title: string;
  author: string;
  videoId: string;
  url: string;
  duration: string;
  viewCount: number;
  hasTranscript: boolean;
  transcript: string;
  wordCount: number;
  extractionMethod?: string;
  error?: string;
}

function extractVideoId(url: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  throw new Error("Invalid YouTube URL or video ID");
}

async function getYouTubeTranscriptViaSupaData(videoId: string, url: string) {
  const apiKey = process.env.SUPA_DATA_API;
  if (!apiKey) return { success: false, error: "Supadata API key not configured" };

  try {
    const apiUrl = new URL("https://api.supadata.ai/v1/youtube/transcript");
    apiUrl.searchParams.append("url", url);
    apiUrl.searchParams.append("text", "true");

    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    });

    if (!response.ok) await throwHttpResponseError(response, "Supadata API returned");
    const data = await response.json();
    if (!data.content) throw new Error("Supadata returned empty transcript");

    return { success: true, method: "supadata-api", transcript: data.content.trim() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function getYouTubeTranscriptViaAPI(videoId: string) {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) throw new Error("No captions available");

    const fullText = transcript.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    if (!fullText) throw new Error("Transcript segments contained no text");

    return { success: true, method: "youtube-transcript-api", transcript: fullText };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function getYouTubeTranscriptViaHTML(videoId: string) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    const html = await response.text();

    const captionsRegex = /"captions":\{"playerCaptionsTracklistRenderer":\{"captionTracks":\[(.*?)\]/;
    const match = html.match(captionsRegex);
    if (!match) throw new Error("No captions found in page HTML");

    const captionTracks = JSON.parse(`[${match[1]}]`);
    const englishTrack = captionTracks.find((t: any) => t.languageCode === "en" || t.languageCode?.startsWith("en-"));
    if (!englishTrack) throw new Error("No English captions available");

    const captionResponse = await fetch(englishTrack.baseUrl);
    const captionXML = await captionResponse.text();

    const texts: string[] = [];
    let textMatch;
    const textRegex = /<text[^>]*>(.*?)<\/text>/g;
    while ((textMatch = textRegex.exec(captionXML)) !== null) {
      texts.push(textMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, ""));
    }

    return { success: true, method: "html-scraping", transcript: texts.join(" ").replace(/\s+/g, " ").trim() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function getYouTubeMetadata(videoId: string) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    const html = await response.text();

    const titleMatch = html.match(/<meta name="title" content="([^"]+)">/);
    const authorMatch = html.match(/"author":"([^"]+)"/);
    const viewsMatch = html.match(/"viewCount":"(\d+)"/);
    const lengthMatch = html.match(/"lengthSeconds":"(\d+)"/);

    return {
      title: titleMatch?.[1] || "Unknown Title",
      author: authorMatch?.[1] || "Unknown Channel",
      viewCount: viewsMatch ? parseInt(viewsMatch[1]) : 0,
      duration: lengthMatch ? parseInt(lengthMatch[1]) : 0,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
    };
  } catch {
    return { title: "Unknown Title", author: "Unknown Channel", viewCount: 0, duration: 0, url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  }
}

export async function extractYouTube(url: string): Promise<YouTubeResult> {
  const videoId = extractVideoId(url);
  const metadata = await getYouTubeMetadata(videoId);

  const methods = [
    () => getYouTubeTranscriptViaSupaData(videoId, url),
    () => getYouTubeTranscriptViaAPI(videoId),
    () => getYouTubeTranscriptViaHTML(videoId),
  ];

  for (const method of methods) {
    const result = await method();
    if (result.success && result.transcript) {
      const wordCount = result.transcript.split(/\s+/).filter((w: string) => w.length > 0).length;
      return {
        ...metadata,
        duration: metadata.duration ? `${Math.floor(metadata.duration / 60)}m ${metadata.duration % 60}s` : "Unknown",
        hasTranscript: true,
        transcript: result.transcript,
        wordCount,
        extractionMethod: result.method,
      };
    }
  }

  return {
    ...metadata,
    duration: metadata.duration ? `${Math.floor(metadata.duration / 60)}m ${metadata.duration % 60}s` : "Unknown",
    hasTranscript: false,
    transcript: "",
    wordCount: 0,
    error: "No transcript available - all extraction methods failed",
  };
}

function formatYouTubeResult(result: YouTubeResult): string {
  let text = `**YouTube Video Extracted**\n\n`;
  text += `**Title:** ${result.title}\n`;
  text += `**Channel:** ${result.author}\n`;
  text += `**Duration:** ${result.duration}\n`;
  text += `**Views:** ${result.viewCount?.toLocaleString() || "N/A"}\n`;
  text += `**URL:** ${result.url}\n`;
  if (result.hasTranscript) {
    text += `**Extraction Method:** ${result.extractionMethod}\n\n`;
    text += `---\n\n## Transcript (${result.wordCount} words)\n\n${result.transcript}`;
  } else {
    text += `\n---\n\n*No transcript available: ${result.error}*`;
  }
  return text;
}

// =============================================================================
// REDDIT EXTRACTOR
// =============================================================================

const REDDIT_USER_AGENT = "ContentExtractorMCP/1.0";
const REDDIT_MAX_REDIRECTS = 5;
const REDDIT_MAX_FETCH_ATTEMPTS = 3;
const REDDIT_RETRY_BASE_MS = 500;
const REDDIT_MAX_RETRY_DELAY_MS = 2000;

export interface RedditResult {
  title: string;
  author: string;
  subreddit: string;
  url: string;
  content: string;
  metadata: {
    score: number;
    upvoteRatio: number;
    numComments: number;
    extractedComments: number;
    extractedTopComments: number;
    maxDepth: number;
    created: string;
    permalink: string;
    originalUrl: string;
    isVideo: boolean;
    isNsfw: boolean;
    awards: number;
    retrievalMethod: string;
  };
}

interface RedditFetchResult {
  data: unknown;
  retrievalMethod: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalizeRedditUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com", "redd.it"]);

  if (!allowedHosts.has(hostname)) {
    throw new Error("Reddit extractor requires a reddit.com or redd.it URL");
  }

  if (hostname !== "redd.it") {
    parsed.hostname = "www.reddit.com";
  }

  parsed.hash = "";
  parsed.search = "";

  if (parsed.hostname !== "redd.it" && !parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }

  return parsed.toString();
}

function shouldFollowRedditRedirect(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "redd.it" || /\/r\/[^/]+\/s\//.test(parsed.pathname) || /\/s\//.test(parsed.pathname);
}

async function resolveRedditUrl(url: string): Promise<string> {
  let currentUrl = canonicalizeRedditUrl(url);

  if (!shouldFollowRedditRedirect(currentUrl)) return currentUrl;

  for (let attempt = 0; attempt < REDDIT_MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(currentUrl, {
      headers: {
        "User-Agent": REDDIT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.ok) return currentUrl;
      await throwHttpResponseError(response, "Failed to resolve Reddit link: HTTP");
    }

    const location = response.headers.get("location");
    if (!location) throw new Error("Failed to resolve Reddit link: redirect missing location header");

    currentUrl = canonicalizeRedditUrl(new URL(location, currentUrl).toString());
    if (!shouldFollowRedditRedirect(currentUrl)) return currentUrl;
  }

  throw new Error("Failed to resolve Reddit link: too many redirects");
}

function redditJsonUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/$/, "") + ".json";
  parsed.search = "";
  parsed.searchParams.set("limit", "500");
  parsed.searchParams.set("raw_json", "1");
  return parsed.toString();
}

function redditOAuthJsonUrl(url: string): string {
  const parsed = new URL(redditJsonUrl(url));
  parsed.protocol = "https:";
  parsed.hostname = "oauth.reddit.com";
  return parsed.toString();
}

function redditOldHtmlUrl(url: string): string {
  const parsed = new URL(canonicalizeRedditUrl(url));
  parsed.protocol = "https:";
  parsed.hostname = "old.reddit.com";
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function isRetryableRedditStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function redditRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number.parseInt(response.headers.get("retry-after") || "", 10);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, REDDIT_MAX_RETRY_DELAY_MS);
  }
  return Math.min(REDDIT_RETRY_BASE_MS * attempt, REDDIT_MAX_RETRY_DELAY_MS);
}

function hasRedditOAuthConfig(): boolean {
  return Boolean(process.env.REDDIT_BEARER_TOKEN || (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET));
}

async function getRedditOAuthToken(): Promise<{ token: string; retrievalMethod: string }> {
  if (process.env.REDDIT_BEARER_TOKEN) {
    return { token: process.env.REDDIT_BEARER_TOKEN, retrievalMethod: "oauth_bearer" };
  }

  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    throw new Error("Reddit OAuth fallback is not configured");
  }

  const credentials = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "User-Agent": REDDIT_USER_AGENT,
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    await throwHttpResponseError(response, "Reddit OAuth token request failed: HTTP");
  }

  const tokenPayload = await response.json();
  const accessToken = tokenPayload && typeof tokenPayload === "object" && "access_token" in tokenPayload ? tokenPayload.access_token : undefined;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Reddit OAuth token response did not include an access token");
  }

  return { token: accessToken, retrievalMethod: "oauth_client_credentials" };
}

async function fetchPublicRedditData(url: string): Promise<RedditFetchResult> {
  const jsonUrl = redditJsonUrl(url);

  for (let attempt = 1; attempt <= REDDIT_MAX_FETCH_ATTEMPTS; attempt += 1) {
    const response = await fetch(jsonUrl, {
      headers: { "User-Agent": REDDIT_USER_AGENT, Accept: "application/json" },
    });

    if (response.ok) {
      return { data: await response.json(), retrievalMethod: "public_json" };
    }

    if (!isRetryableRedditStatus(response.status) || attempt === REDDIT_MAX_FETCH_ATTEMPTS) {
      await throwHttpResponseError(response);
    }

    await discardResponseBody(response);
    await delay(redditRetryDelayMs(response, attempt));
  }

  throw new Error("Reddit JSON request failed after retries");
}

async function fetchOAuthRedditData(url: string): Promise<RedditFetchResult> {
  const { token, retrievalMethod } = await getRedditOAuthToken();
  const response = await fetch(redditOAuthJsonUrl(url), {
    headers: {
      "User-Agent": REDDIT_USER_AGENT,
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    await throwHttpResponseError(response, "Reddit OAuth JSON failed: HTTP");
  }

  return { data: await response.json(), retrievalMethod };
}

function parseScore(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue || "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferSubredditFromUrl(url: string): string {
  return new URL(url).pathname.match(/\/r\/([^/]+)/)?.[1] || "unknown";
}

function ownCommentText($: cheerio.CheerioAPI, comment: cheerio.Cheerio<any>): string {
  return cleanText(comment.children(".entry").find(".usertext-body .md").first().text());
}

function ownCommentScore($: cheerio.CheerioAPI, comment: cheerio.Cheerio<any>): number {
  return parseScore(comment.children(".entry").find(".score.unvoted").first().text() || comment.children(".entry").find(".score").first().text());
}

function directOldRedditReplies($: cheerio.CheerioAPI, comment: cheerio.Cheerio<any>): any[] {
  return comment.children(".child").children(".sitetable").children(".thing.comment").toArray();
}

function parseOldRedditComment($: cheerio.CheerioAPI, element: any): any | null {
  const comment = $(element);
  const body = ownCommentText($, comment);
  if (!body) return null;

  const replies = directOldRedditReplies($, comment)
    .map((reply) => parseOldRedditComment($, reply))
    .filter(Boolean);

  return {
    kind: "t1",
    data: {
      author: comment.attr("data-author") || cleanText(comment.children(".entry").find("a.author").first().text()) || "[deleted]",
      score: ownCommentScore($, comment),
      body,
      total_awards_received: 0,
      replies: replies.length > 0 ? { data: { children: replies } } : "",
    },
  };
}

function parseOldRedditHtml(html: string, finalUrl: string, sourceUrl: string): unknown {
  const $ = cheerio.load(html);
  const post = $(".thing.link").first();
  const title = cleanText(post.find("a.title").first().text());

  if (!post.length || !title) {
    throw new Error("old Reddit HTML did not contain a parseable post");
  }

  const canonicalSourceUrl = canonicalizeRedditUrl(sourceUrl);
  const permalink = post.attr("data-permalink") || new URL(finalUrl).pathname;
  const createdAt = Date.parse(post.find("time[datetime]").first().attr("datetime") || "");
  const comments = $(".thing.comment")
    .filter((_, element) => $(element).parents(".thing.comment").length === 0)
    .toArray()
    .map((element) => parseOldRedditComment($, element))
    .filter(Boolean);

  const commentCount = parseScore(post.find("a.comments").first().text()) || comments.length;
  const dataUrl = post.attr("data-url") || canonicalSourceUrl;
  const postUrl = dataUrl.startsWith("/r/") ? canonicalSourceUrl : new URL(dataUrl, finalUrl).toString();
  const flair = post.find(".linkflairlabel").first();

  return [
    {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              title,
              author: post.attr("data-author") || cleanText(post.find("a.author").first().text()) || "[deleted]",
              subreddit: post.attr("data-subreddit") || inferSubredditFromUrl(sourceUrl),
              score: parseScore(post.attr("data-score") || post.find(".score.unvoted").first().text()),
              upvote_ratio: 0,
              num_comments: commentCount,
              created_utc: Number.isFinite(createdAt) ? Math.floor(createdAt / 1000) : 0,
              total_awards_received: 0,
              selftext: cleanText(post.find(".usertext-body .md").first().text()),
              url: postUrl,
              link_flair_text: flair.attr("title") || cleanText(flair.text()) || null,
              permalink,
              is_video: false,
              over_18: post.hasClass("over18"),
            },
          },
        ],
      },
    },
    {
      data: {
        children: comments,
      },
    },
  ];
}

async function fetchOldRedditHtmlData(url: string): Promise<RedditFetchResult> {
  const htmlUrl = redditOldHtmlUrl(url);
  const response = await fetch(htmlUrl, {
    headers: {
      "User-Agent": ARTICLE_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    await throwHttpResponseError(response);
  }

  const html = await response.text();
  return {
    data: parseOldRedditHtml(html, response.url || htmlUrl, url),
    retrievalMethod: "old_reddit_html",
  };
}

async function fetchRedditData(url: string): Promise<RedditFetchResult> {
  try {
    return await fetchOldRedditHtmlData(url);
  } catch (htmlError: any) {
    const failures = [`old Reddit HTML fallback failed (${htmlError.message})`];

    try {
      return await fetchPublicRedditData(url);
    } catch (publicError: any) {
      failures.push(`Public Reddit JSON failed (${publicError.message})`);
    }

    if (hasRedditOAuthConfig()) {
      try {
        return await fetchOAuthRedditData(url);
      } catch (oauthError: any) {
        failures.push(`OAuth fallback failed (${oauthError.message})`);
      }
    }

    throw new Error(failures.join("; "));
  }
}

function normalizeMaxComments(maxComments: unknown): number {
  if (typeof maxComments !== "number" || !Number.isFinite(maxComments)) return 20;
  return Math.max(0, Math.min(Math.floor(maxComments), 100));
}

function normalizeMaxDepth(maxDepth: unknown): number {
  if (typeof maxDepth !== "number" || !Number.isFinite(maxDepth)) return 2;
  return Math.max(1, Math.min(Math.floor(maxDepth), 5));
}

function parseRedditPayload(data: unknown): { postData: any; commentsData: any[] } {
  const payload = data as any;
  const postData = payload?.[0]?.data?.children?.[0]?.data;
  const commentsData = payload?.[1]?.data?.children;

  if (!postData || typeof postData !== "object" || !Array.isArray(commentsData)) {
    throw new Error("Reddit response was malformed");
  }

  return { postData, commentsData };
}

function formatRedditComment(comment: any, depth: number, maxDepth: number, counter: { count: number }): string {
  if (!comment.data || comment.kind !== "t1") return "";
  const indent = "  ".repeat(depth);
  const { author, score, body, total_awards_received } = comment.data;
  counter.count += 1;
  let formatted = `${indent}u/${author} | ${score} points`;
  if (total_awards_received) formatted += ` | ${total_awards_received} awards`;
  formatted += `\n${indent}${String(body || "").replace(/\n/g, "\n" + indent)}\n`;
  if (depth + 1 < maxDepth && comment.data.replies?.data?.children) {
    for (const reply of comment.data.replies.data.children) {
      if (reply.kind === "t1") formatted += "\n" + formatRedditComment(reply, depth + 1, maxDepth, counter);
    }
  }
  return formatted;
}

export async function extractReddit(url: string, maxComments = 20, maxDepth = 2): Promise<RedditResult> {
  const boundedMaxComments = normalizeMaxComments(maxComments);
  const boundedMaxDepth = normalizeMaxDepth(maxDepth);
  const resolvedUrl = await resolveRedditUrl(url);
  const { data, retrievalMethod } = await fetchRedditData(resolvedUrl);
  const { postData, commentsData } = parseRedditPayload(data);

  let content = `# ${postData.title}\n\n`;
  content += `**Posted by** u/${postData.author} in r/${postData.subreddit}\n`;
  content += `**Score:** ${postData.score} points (${Math.round(postData.upvote_ratio * 100)}% upvoted)\n`;
  content += `**Comments:** ${postData.num_comments}\n\n---\n\n`;
  if (postData.selftext) content += `${postData.selftext}\n\n`;
  else if (postData.url && postData.url !== resolvedUrl) content += `**Link post:** ${postData.url}\n\n`;
  if (postData.link_flair_text) content += `**Flair:** ${postData.link_flair_text}\n\n`;
  content += `## Comments\n\n`;

  const topComments = commentsData.filter((c: any) => c.kind === "t1").slice(0, boundedMaxComments);
  const commentCounter = { count: 0 };
  if (topComments.length === 0) {
    content += "*No comments yet*\n";
  } else {
    for (const comment of topComments) {
      content += formatRedditComment(comment, 0, boundedMaxDepth, commentCounter) + "\n---\n\n";
    }
  }

  return {
    title: postData.title,
    author: `u/${postData.author}`,
    subreddit: postData.subreddit,
    url: resolvedUrl,
    content,
    metadata: {
      score: postData.score,
      upvoteRatio: postData.upvote_ratio,
      numComments: postData.num_comments,
      extractedComments: commentCounter.count,
      extractedTopComments: topComments.length,
      maxDepth: boundedMaxDepth,
      created: new Date(postData.created_utc * 1000).toISOString(),
      permalink: `https://reddit.com${postData.permalink}`,
      originalUrl: url,
      isVideo: Boolean(postData.is_video),
      isNsfw: Boolean(postData.over_18),
      awards: postData.total_awards_received || 0,
      retrievalMethod,
    },
  };
}

function formatRedditResult(result: RedditResult): string {
  return `**Reddit Post Extracted**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Subreddit:** r/${result.subreddit}\n**Score:** ${result.metadata.score}\n\n---\n\n${result.content}`;
}

// =============================================================================
// TIKTOK EXTRACTOR
// =============================================================================

const TIKTOK_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  referer: "https://www.tiktok.com/",
};

export interface TikTokResult {
  url: string;
  hasTranscript: boolean;
  transcript: string;
  wordCount: number;
  metadata: {
    user: string;
    videoId: string;
    description: string;
    language?: string;
  };
}

function stripVtt(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((l) => l && l !== "WEBVTT" && !/^\d\d:\d\d/.test(l) && !/-->/.test(l))
    .join("\n");
}

export async function extractTikTok(url: string, preferLang = "eng"): Promise<TikTokResult> {
  const tiktokUrl = requirePlatformUrl(url, "TikTok", ["tiktok.com"]);
  const response = await fetch(tiktokUrl, { headers: TIKTOK_HEADERS, redirect: "follow" });
  const fullUrl = response.url;
  const html = await response.text();

  const $ = cheerio.load(html);
  const script = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__");

  if (!script.length) throw new Error("Could not find TikTok data");

  const data = JSON.parse(decode(script.html() || "{}"));
  const videoDetail = data.__DEFAULT_SCOPE__?.["webapp.video-detail"];

  if (!videoDetail?.itemInfo?.itemStruct) throw new Error("Could not parse TikTok video data");

  const item = videoDetail.itemInfo.itemStruct;
  const user = item.author?.uniqueId || "unknown";
  const videoId = item.id;
  const description = item.desc || "";
  const subtitles = item.video?.subtitleInfos || [];

  if (!subtitles.length) {
    return { url: fullUrl, hasTranscript: false, transcript: "", wordCount: 0, metadata: { user, videoId, description } };
  }

  const track = subtitles.find((s: any) => s.LanguageCodeName?.startsWith(preferLang)) || subtitles[0];
  const vttResponse = await fetch(track.Url, { headers: TIKTOK_HEADERS });
  const vtt = await vttResponse.text();
  const transcript = stripVtt(vtt);
  const wordCount = transcript.split(/\s+/).filter((w) => w.length > 0).length;

  return { url: fullUrl, hasTranscript: true, transcript, wordCount, metadata: { user, videoId, description, language: track.LanguageCodeName } };
}

function formatTikTokResult(result: TikTokResult): string {
  let text = `**TikTok Video Extracted**\n\n`;
  text += `**Creator:** @${result.metadata.user}\n`;
  text += `**URL:** ${result.url}\n`;
  if (result.metadata.description) text += `**Description:** ${result.metadata.description}\n`;
  if (result.hasTranscript) {
    text += `\n---\n\n## Transcript (${result.wordCount} words)\n\n${result.transcript}`;
  } else {
    text += `\n---\n\n*No captions available*`;
  }
  return text;
}

// =============================================================================
// ARTICLE EXTRACTOR
// =============================================================================

const ARTICLE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export interface ArticleResult {
  url: string;
  title: string;
  author: string;
  siteName: string;
  domain: string;
  excerpt: string;
  content: string;
  wordCount: number;
}

function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndownService.addRule("removeMedia", { filter: ["img", "video", "iframe"], replacement: () => "" });
  return turndownService.turndown(html);
}

export async function extractArticle(url: string): Promise<ArticleResult> {
  const articleUrl = parseHttpUrl(url).toString();

  const response = await fetch(articleUrl, {
    headers: { "User-Agent": ARTICLE_USER_AGENT, Accept: "text/html" },
    redirect: "follow",
  });

  if (!response.ok) await throwHttpResponseError(response);

  let html = await response.text();
  const finalUrl = response.url;

  // Uncomment hidden content for Sports Reference sites
  if (articleUrl.includes("-reference.com")) {
    html = html.replace(/<!--([\s\S]*?)-->/g, "$1");
  }

  const dom = new JSDOM(removeStyleBlocks(html), { url: finalUrl, virtualConsole: READABILITY_VIRTUAL_CONSOLE });
  try {
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) throw new Error("Could not parse article");

    const articleContent = article.content || article.textContent;
    if (!articleContent) throw new Error("Parsed article contained no content");

    const markdown = article.content ? htmlToMarkdown(article.content) : articleContent;
    const cleanText = markdown.replace(/\n{3,}/g, "\n\n").trim();
    const wordCount = cleanText.split(/\s+/).filter((w) => w.length > 0).length;
    const domain = new URL(finalUrl).hostname.replace("www.", "");

    return {
      url: finalUrl,
      title: article.title || "Untitled",
      author: article.byline || "Unknown",
      siteName: article.siteName || domain,
      domain,
      excerpt: article.excerpt || cleanText.substring(0, 200) + "...",
      content: cleanText,
      wordCount,
    };
  } finally {
    dom.window.close();
  }
}

function formatArticleResult(result: ArticleResult): string {
  return `**Article Extracted**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Source:** ${result.siteName}\n**URL:** ${result.url}\n**Words:** ${result.wordCount}\n\n---\n\n${result.content}`;
}

// =============================================================================
// GITHUB EXTRACTOR
// =============================================================================

type GitHubKind = "repository" | "file" | "directory" | "release" | "gist" | "binary_asset";
type GitHubStatus = "success" | "unsupported_binary";

export interface GitHubResult {
  platform: "github";
  kind: GitHubKind;
  status: GitHubStatus;
  url: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface GitHubRepoApiResult {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  default_branch?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  topics?: string[];
}

interface GitHubReleaseApiResult {
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  published_at?: string | null;
  assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
}

interface GitHubContentApiResult {
  name?: string;
  path?: string;
  type?: string;
  html_url?: string;
  download_url?: string | null;
  size?: number;
}

interface GitHubGistApiResult {
  description?: string | null;
  html_url?: string;
  files?: Record<string, { filename?: string; language?: string | null; content?: string; raw_url?: string; truncated?: boolean }>;
}

const GITHUB_USER_AGENT = "ContentExtractorMCP/1.0";
const GITHUB_TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "rst", "adoc", "json", "jsonl", "csv", "tsv", "yaml", "yml", "toml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "c", "cc", "cpp", "h", "hpp", "sh", "sql"]);
const GITHUB_BINARY_EXTENSIONS = new Set(["7z", "avi", "bmp", "bz2", "dmg", "doc", "docx", "exe", "gif", "gz", "ico", "jpeg", "jpg", "mov", "mp3", "mp4", "ogg", "otf", "pdf", "pkg", "png", "ppt", "pptx", "rar", "tar", "tgz", "tif", "tiff", "ttf", "wav", "webm", "webp", "woff", "woff2", "xls", "xlsx", "xz", "zip"]);

function githubHeaders(accept = "application/vnd.github+json"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": GITHUB_USER_AGENT,
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function githubPathParts(parsed: URL): string[] {
  return parsed.pathname.split("/").filter((part) => part.length > 0);
}

function pathExtension(pathname: string): string {
  const cleanPath = pathname.split(/[?#]/)[0].toLowerCase();
  const filename = cleanPath.split("/").pop() || "";
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex + 1) : "";
}

function isLikelyGitHubBinary(pathname: string): boolean {
  const extension = pathExtension(pathname);
  if (!extension) return false;
  if (GITHUB_TEXT_EXTENSIONS.has(extension)) return false;
  return GITHUB_BINARY_EXTENSIONS.has(extension);
}

function releaseAssetResult(url: string, title: string, owner: string, repo: string): GitHubResult {
  return {
    platform: "github",
    kind: "binary_asset",
    status: "unsupported_binary",
    url,
    title,
    content: `Unsupported binary GitHub asset: ${title}\n\nThe extractor intentionally does not download binary release assets. Use the URL directly if the binary artifact is needed.`,
    metadata: { owner, repo, reason: "binary_asset" },
  };
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) await throwHttpResponseError(response, "GitHub API returned");
  return (await response.json()) as T;
}

async function fetchGitHubText(url: string): Promise<string> {
  const response = await fetch(url, { headers: githubHeaders("text/plain, text/markdown, */*") });
  if (!response.ok) await throwHttpResponseError(response, "GitHub content returned");
  return response.text();
}

async function extractGitHubRepository(owner: string, repo: string, url: string): Promise<GitHubResult> {
  const repoData = await fetchGitHubJson<GitHubRepoApiResult>(`https://api.github.com/repos/${owner}/${repo}`);
  const title = repoData.full_name || `${owner}/${repo}`;
  const defaultBranch = repoData.default_branch || "main";
  const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/README.md`;
  let readme = "";
  let readmeError: string | undefined;

  try {
    readme = await fetchGitHubText(readmeUrl);
  } catch (error: any) {
    readmeError = error.message;
  }

  const lines = [
    `# ${title}`,
    "",
    repoData.description || "No repository description provided.",
    "",
    `Repository: ${repoData.html_url || url}`,
    `Default branch: ${defaultBranch}`,
    `Stars: ${repoData.stargazers_count ?? 0}`,
    `Forks: ${repoData.forks_count ?? 0}`,
    `Open issues: ${repoData.open_issues_count ?? 0}`,
  ];

  if (repoData.language) lines.push(`Language: ${repoData.language}`);
  if (repoData.topics?.length) lines.push(`Topics: ${repoData.topics.join(", ")}`);
  lines.push("", "## README", "", readme || `README unavailable${readmeError ? `: ${readmeError}` : "."}`);

  return {
    platform: "github",
    kind: "repository",
    status: "success",
    url: repoData.html_url || url,
    title,
    content: lines.join("\n").trim(),
    metadata: {
      owner,
      repo,
      defaultBranch,
      stars: repoData.stargazers_count ?? 0,
      forks: repoData.forks_count ?? 0,
      openIssues: repoData.open_issues_count ?? 0,
      language: repoData.language || null,
      topics: Array.isArray(repoData.topics) ? repoData.topics : [],
      readmeUrl,
      readmeError,
    },
  };
}

async function extractGitHubFile(owner: string, repo: string, branch: string, filePath: string, url: string): Promise<GitHubResult> {
  if (isLikelyGitHubBinary(filePath)) {
    return releaseAssetResult(url, filePath.split("/").pop() || filePath, owner, repo);
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const content = await fetchGitHubText(rawUrl);
  const title = `${owner}/${repo}/${filePath}`;

  return {
    platform: "github",
    kind: "file",
    status: "success",
    url,
    title,
    content: `# ${title}\n\nSource: ${url}\n\n---\n\n${content}`.trim(),
    metadata: { owner, repo, branch, path: filePath, rawUrl, words: wordCount(content) },
  };
}

async function extractGitHubDirectory(owner: string, repo: string, branch: string, dirPath: string, url: string): Promise<GitHubResult> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(dirPath)}?ref=${encodeURIComponent(branch)}`;
  const items = await fetchGitHubJson<GitHubContentApiResult[]>(apiUrl);
  const title = `${owner}/${repo}/${dirPath}`;
  const rows = items.map((item) => `- ${item.type || "item"}: ${item.path || item.name || "unknown"}${item.size !== undefined ? ` (${item.size} bytes)` : ""}`);

  return {
    platform: "github",
    kind: "directory",
    status: "success",
    url,
    title,
    content: `# ${title}\n\nSource: ${url}\n\n## Directory contents\n\n${rows.join("\n")}`,
    metadata: { owner, repo, branch, path: dirPath, itemCount: items.length },
  };
}

async function extractGitHubRelease(owner: string, repo: string, releaseRef: string, url: string): Promise<GitHubResult> {
  const apiUrl = releaseRef === "latest"
    ? `https://api.github.com/repos/${owner}/${repo}/releases/latest`
    : `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(releaseRef)}`;
  const release = await fetchGitHubJson<GitHubReleaseApiResult>(apiUrl);
  const title = `${owner}/${repo} ${release.name || release.tag_name || releaseRef}`;
  const assets = release.assets || [];
  const assetLines = assets.map((asset) => `- ${asset.name || "asset"}${asset.size !== undefined ? ` (${asset.size} bytes)` : ""}${asset.browser_download_url ? `: ${asset.browser_download_url}` : ""}`);

  return {
    platform: "github",
    kind: "release",
    status: "success",
    url: release.html_url || url,
    title,
    content: [`# ${title}`, "", `Tag: ${release.tag_name || releaseRef}`, release.published_at ? `Published: ${release.published_at}` : "", "", "## Notes", "", release.body || "No release notes provided.", "", "## Assets", "", assetLines.join("\n") || "No assets listed."].filter((line) => line !== "").join("\n"),
    metadata: { owner, repo, tagName: release.tag_name || releaseRef, publishedAt: release.published_at || null, assetCount: assets.length },
  };
}

async function extractGitHubGist(gistId: string, url: string): Promise<GitHubResult> {
  const gist = await fetchGitHubJson<GitHubGistApiResult>(`https://api.github.com/gists/${gistId}`);
  const files = Object.values(gist.files || {});
  const sections: string[] = [];

  for (const file of files) {
    const filename = file.filename || "gist-file";
    let content = file.content || "";
    if (file.truncated && file.raw_url) {
      content = await fetchGitHubText(file.raw_url);
    }
    sections.push(`## ${filename}\n\n${content}`);
  }

  return {
    platform: "github",
    kind: "gist",
    status: "success",
    url: gist.html_url || url,
    title: gist.description || `gist:${gistId}`,
    content: [`# ${gist.description || `Gist ${gistId}`}`, "", `Source: ${gist.html_url || url}`, "", ...sections].join("\n").trim(),
    metadata: { gistId, fileCount: files.length, files: files.map((file) => file.filename || "gist-file") },
  };
}

export async function extractGitHub(url: string): Promise<GitHubResult> {
  const parsed = parseHttpUrl(url);
  const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

  if (hostname === "raw.githubusercontent.com") {
    const parts = githubPathParts(parsed);
    if (parts.length < 4) throw new Error("Raw GitHub URL must include owner, repo, branch, and path");
    const [owner, repoName, branch, ...fileParts] = parts;
    return extractGitHubFile(owner, repoName.replace(/\.git$/, ""), branch, fileParts.join("/"), parsed.toString());
  }

  if (hostname === "gist.github.com") {
    const parts = githubPathParts(parsed);
    const gistId = parts[parts.length - 1];
    if (!gistId) throw new Error("Gist URL must include a gist ID");
    return extractGitHubGist(gistId, parsed.toString());
  }

  if (hostname !== "github.com") {
    throw new Error("GitHub extractor requires a github.com, gist.github.com, or raw.githubusercontent.com URL");
  }

  const parts = githubPathParts(parsed);
  if (parts.length < 2) throw new Error("GitHub URL must include owner and repository");
  const [owner, repoPart, ...rest] = parts;
  const repo = repoPart.replace(/\.git$/, "");

  if (rest[0] === "releases" && rest[1] === "latest" && rest[2] === "download") {
    const assetPath = rest.slice(3).join("/");
    if (isLikelyGitHubBinary(assetPath)) return releaseAssetResult(parsed.toString(), assetPath.split("/").pop() || assetPath, owner, repo);
    return extractGitHubFile(owner, repo, "HEAD", assetPath, parsed.toString());
  }

  if (rest[0] === "releases" && rest[1] === "latest") {
    return extractGitHubRelease(owner, repo, "latest", parsed.toString());
  }

  if (rest[0] === "releases" && rest[1] === "tag" && rest[2]) {
    return extractGitHubRelease(owner, repo, rest[2], parsed.toString());
  }

  if ((rest[0] === "blob" || rest[0] === "raw") && rest.length >= 3) {
    return extractGitHubFile(owner, repo, rest[1], rest.slice(2).join("/"), parsed.toString());
  }

  if (rest[0] === "tree" && rest.length >= 3) {
    return extractGitHubDirectory(owner, repo, rest[1], rest.slice(2).join("/"), parsed.toString());
  }

  return extractGitHubRepository(owner, repo, parsed.toString());
}

function formatGitHubResult(result: GitHubResult): string {
  return `**GitHub Content Extracted**\n\n**Title:** ${result.title}\n**Kind:** ${result.kind}\n**Status:** ${result.status}\n**URL:** ${result.url}\n\n---\n\n${result.content}`;
}

// =============================================================================
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

function formatBatchResult(result: BatchResult): string {
  const counts = Object.entries(result.statusCounts).map(([status, count]) => `${status}: ${count}`).join(", ");
  return `**Batch Extraction Complete**\n\n**Rows:** ${result.totalRows}\n**Unique URLs fetched:** ${result.uniqueUrls}\n**Status counts:** ${counts || "none"}\n\n**Output directory:** ${result.outputDir}\n**Manifest:** ${result.manifestPath}\n**Report CSV:** ${result.reportCsvPath}\n**Results JSONL:** ${result.resultsJsonlPath}`;
}

// =============================================================================
// LINK EXTRACTOR
// =============================================================================

export interface LinkItem {
  title: string;
  url: string;
  domain: string;
  category: string;
  originalHref: string;
}

export interface LinksResult {
  url: string;
  totalLinks: number;
  categories: Record<string, number>;
  links: LinkItem[];
  csv: string;
}

function categorizeLink(linkUrl: URL, baseUrl: URL, text: string): string {
  const domain = linkUrl.hostname.toLowerCase();
  const pathname = linkUrl.pathname.toLowerCase();
  const label = text.toLowerCase();

  if (domain.includes("youtube.com") || domain.includes("youtu.be")) return "video";
  if (pathname.endsWith(".pdf")) return "document";
  if (domain.includes("facebook") || domain.includes("twitter") || domain.includes("x.com") || domain.includes("instagram") || domain.includes("linkedin")) return "social";
  if (label.includes("contact") || pathname.includes("contact")) return "contact";
  if (label.includes("about") || pathname.includes("about")) return "about";
  if (domain === baseUrl.hostname.toLowerCase()) return "internal";
  return "external";
}

function collectLinksFromHtml(html: string, baseUrl: string, maxLinks: number): LinkItem[] {
  const $ = cheerio.load(html);
  const parsedBase = new URL(baseUrl);
  const seenUrls = new Set<string>();
  const links: LinkItem[] = [];

  $("a[href]").each((_, element) => {
    if (links.length >= maxLinks) return false;

    const $link = $(element);
    const href = $link.attr("href");
    const text = $link.text().replace(/\s+/g, " ").trim();
    const title = ($link.attr("title") || "").trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
    if (!text && !title) return;

    try {
      const parsedUrl = new URL(href, baseUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return;
      const normalized = parsedUrl.toString();
      if (seenUrls.has(normalized)) return;
      seenUrls.add(normalized);

      links.push({
        title: text || title || "No title",
        url: normalized,
        domain: parsedUrl.hostname.toLowerCase(),
        category: categorizeLink(parsedUrl, parsedBase, text || title),
        originalHref: href,
      });
    } catch {
      return;
    }
  });

  return links.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });
}

function linksToCsv(result: Omit<LinksResult, "csv">): string {
  const rows = [
    ["Title", "URL", "Domain", "Category", "Original Href"],
    ...result.links.map((link) => [link.title, link.url, link.domain, link.category, link.originalHref]),
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export async function extractLinks(url: string, maxLinks = 250): Promise<LinksResult> {
  const pageUrl = parseHttpUrl(url).toString();
  const boundedMaxLinks = Math.min(Math.max(Math.floor(maxLinks || 250), 1), 1000);

  const response = await fetch(pageUrl, {
    headers: { "User-Agent": ARTICLE_USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
  });

  if (!response.ok) await throwHttpResponseError(response);

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) {
    await discardResponseBody(response);
    throw new Error(`Expected HTML content, received ${contentType}`);
  }

  const html = await response.text();
  const finalUrl = response.url;
  const links = collectLinksFromHtml(html, finalUrl, boundedMaxLinks);
  const categories = links.reduce<Record<string, number>>((acc, link) => {
    acc[link.category] = (acc[link.category] || 0) + 1;
    return acc;
  }, {});

  const partial = { url: finalUrl, totalLinks: links.length, categories, links };
  return { ...partial, csv: linksToCsv(partial) };
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatLinksResult(result: LinksResult, format = "markdown"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "csv") return result.csv;

  const categorySummary = Object.entries(result.categories)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");

  const rows = result.links.map((link) => `| ${escapeMarkdownTableCell(link.title)} | ${escapeMarkdownTableCell(link.category)} | ${escapeMarkdownTableCell(link.url)} |`);

  return `**Links Extracted**\n\n**URL:** ${result.url}\n**Total:** ${result.totalLinks}\n**Categories:** ${categorySummary || "none"}\n\n| Title | Category | URL |\n| --- | --- | --- |\n${rows.join("\n")}`;
}

// =============================================================================
// MCP SERVER
// =============================================================================

const server = new Server({ name: "content-extractor", version: "1.0.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "extract_youtube",
      description: "Extract YouTube video metadata and, when available, transcript text. Supadata is recommended for reliable transcripts; without it, public no-key caption access is best-effort and may return metadata with hasTranscript=false.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "YouTube video URL or video ID" },
          output: { type: "string", description: "Optional file path to save markdown output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_reddit",
      description: "Extract a Reddit post and its comments. Returns structured content with title, author, scores, and threaded comments.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Reddit thread URL (full URL or short link)" },
          max_comments: { type: "number", minimum: 0, maximum: 100, description: "Maximum top-level comments to include, from 0 to 100 (default: 20)" },
          max_depth: { type: "number", minimum: 1, maximum: 5, description: "Maximum comment depth to include, from 1 to 5 (default: 2). Depth 1 includes only top-level comments; depth 2 includes direct replies." },
          output: { type: "string", description: "Optional file path to save markdown output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_tiktok",
      description: "Extract transcript/captions from a TikTok video. Returns video info and transcript if captions are available.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "TikTok video URL (full URL or short link)" },
          lang: { type: "string", description: "Preferred language code (default: eng)" },
          output: { type: "string", description: "Optional file path to save markdown output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_article",
      description: "Extract clean content from a web article. Uses Readability for parsing and converts to markdown.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the article to extract" },
          output: { type: "string", description: "Optional file path to save markdown output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_github",
      description: "Extract GitHub repository, file, gist, or release content. Repository URLs include metadata and README content; binary release assets are classified without downloading them.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "GitHub repository, file, gist, release, or raw.githubusercontent.com URL" },
          output: { type: "string", description: "Optional file path to save markdown output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_links",
      description: "Extract and categorize links from an HTML page. Returns internal, external, document, video, social, contact, and about links.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL of the HTML page to scan" },
          max_links: { type: "number", description: "Maximum links to return, from 1 to 1000 (default: 250)" },
          format: { type: "string", enum: ["markdown", "json", "csv"], description: "Output format (default: markdown)" },
          output: { type: "string", description: "Optional file path to save output" },
        },
        required: ["url"],
      },
    },
    {
      name: "extract_batch",
      description: "Batch extract content from URL arrays, metadata items, or a CSV file. Deduplicates normalized URLs, routes each URL to the right extractor, classifies blocked/rate-limited failures, and writes per-link artifact folders plus a manifest, CSV report, and JSONL results file. Optional Playwright browser screenshot fallback captures page images for selected failed statuses and, when Tesseract is available, classifies captured screenshots as browser_captured, browser_blocked, browser_empty, browser_not_found, or browser_unclassified.",
      inputSchema: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of URLs to extract",
          },
          items: {
            type: "array",
            description: "Optional list of URL items with per-row metadata",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Optional stable row identifier" },
                url: { type: "string", description: "URL to extract" },
                metadata: { type: "object", description: "Optional caller metadata copied to the report" },
              },
              required: ["url"],
            },
          },
          csv_path: { type: "string", description: "Optional local CSV path to read URLs from" },
          url_column: { type: "string", description: "CSV column containing URLs (default: url)" },
          output_dir: { type: "string", description: "Directory where content, manifest, report, and JSONL files are written" },
          max_concurrency: { type: "number", minimum: 1, maximum: 10, description: "Maximum concurrent unique URL extractions (default: 4)" },
          browser_fallback: { type: "boolean", description: "Enable Playwright browser screenshot fallback for blocked/rate-limited/fetch-failed URLs (default: false)" },
          browser_timeout_ms: { type: "number", minimum: 1000, maximum: 60000, description: "Playwright browser screenshot fallback timeout in milliseconds (default: 15000)" },
          browser_fallback_statuses: {
            type: "array",
            items: { type: "string", enum: ["blocked", "rate_limited", "fetch_failed", "error", "no_transcript"] },
            description: "Statuses that should trigger Playwright browser screenshot fallback (default: blocked, rate_limited, fetch_failed)",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;
    let outputPath: string | undefined;

    switch (name) {
      case "extract_youtube": {
        const data = await extractYouTube(args?.url as string);
        result = formatYouTubeResult(data);
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "youtube", data.title);
        break;
      }
      case "extract_reddit": {
        const data = await extractReddit(args?.url as string, args?.max_comments as number, args?.max_depth as number);
        result = formatRedditResult(data);
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "reddit", data.title);
        break;
      }
      case "extract_tiktok": {
        const data = await extractTikTok(args?.url as string, args?.lang as string);
        result = formatTikTokResult(data);
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "tiktok", data.metadata.user);
        break;
      }
      case "extract_article": {
        const data = await extractArticle(args?.url as string);
        result = formatArticleResult(data);
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "article", data.title);
        break;
      }
      case "extract_github": {
        const data = await extractGitHub(args?.url as string);
        result = formatGitHubResult(data);
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "github", data.title);
        break;
      }
      case "extract_links": {
        const data = await extractLinks(args?.url as string, args?.max_links as number);
        const format = (args?.format as string) || "markdown";
        result = formatLinksResult(data, format);
        const extension = format === "csv" || format === "json" ? format : "md";
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "links", new URL(data.url).hostname, extension);
        break;
      }
      case "extract_batch": {
        const data = await extractBatch(args as any);
        result = formatBatchResult(data);
        break;
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }

    if (outputPath) {
      ensureOutputDir(outputPath);
      writeFileSync(outputPath, result, "utf-8");
      return { content: [{ type: "text", text: `Saved to ${outputPath}` }] };
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const cliArgs = process.argv.slice(2);
const isMainModule = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

function detectPlatform(url: string): string | null {
  try {
    const parsed = parseHttpUrl(url);
    if (hostnameMatches(parsed, ["youtube.com", "youtu.be"])) return "youtube";
    if (hostnameMatches(parsed, ["reddit.com", "redd.it"])) return "reddit";
    if (hostnameMatches(parsed, ["tiktok.com"])) return "tiktok";
    if (hostnameMatches(parsed, ["github.com", "gist.github.com", "raw.githubusercontent.com"])) return "github";
    return "article";
  } catch {
    return null;
  }
}

if (isMainModule && cliArgs[0] === "links") {
  const url = cliArgs[1];
  const output = cliArgs[2];

  (async () => {
    try {
      const data = await extractLinks(url);
      const result = output?.endsWith(".csv") ? formatLinksResult(data, "csv") : formatLinksResult(data);
      const extension = output?.endsWith(".csv") ? "csv" : "md";
      const outputPath = output ? resolveOutputPath(output, "links", new URL(data.url).hostname, extension) : undefined;

      if (outputPath) {
        ensureOutputDir(outputPath);
        writeFileSync(outputPath, result, "utf-8");
        console.log(`Saved to ${outputPath}`);
      } else {
        console.log(result);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  })();
}
// CLI mode
else if (isMainModule && cliArgs.length > 0 && cliArgs[0] !== "--mcp") {
  const url = cliArgs[0];
  const output = cliArgs[1];
  const platform = detectPlatform(url);

  if (!platform) {
    console.error("Could not detect platform from URL");
    process.exit(1);
  }

  (async () => {
    try {
      let result: string;
      let outputPath: string | undefined;

      switch (platform) {
        case "youtube": {
          const data = await extractYouTube(url);
          result = formatYouTubeResult(data);
          if (output) outputPath = resolveOutputPath(output, "youtube", data.title);
          break;
        }
        case "reddit": {
          const data = await extractReddit(url);
          result = formatRedditResult(data);
          if (output) outputPath = resolveOutputPath(output, "reddit", data.title);
          break;
        }
        case "tiktok": {
          const data = await extractTikTok(url);
          result = formatTikTokResult(data);
          if (output) outputPath = resolveOutputPath(output, "tiktok", data.metadata.user);
          break;
        }
        case "article": {
          const data = await extractArticle(url);
          result = formatArticleResult(data);
          if (output) outputPath = resolveOutputPath(output, "article", data.title);
          break;
        }
        case "github": {
          const data = await extractGitHub(url);
          result = formatGitHubResult(data);
          if (output) outputPath = resolveOutputPath(output, "github", data.title);
          break;
        }
        default:
          throw new Error("Unknown platform");
      }

      if (outputPath) {
        ensureOutputDir(outputPath);
        writeFileSync(outputPath, result, "utf-8");
        console.log(`Saved to ${outputPath}`);
      } else {
        console.log(result);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  })();
}
// MCP mode
else if (isMainModule) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
