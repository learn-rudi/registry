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
import { writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "dotenv";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";
import { homedir } from "os";
import * as cheerio from "cheerio";
import { decode } from "html-entities";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

import {
  extractReddit,
  formatRedditResult,
  type RedditResult,
} from "./reddit.js";
import { parseHttpUrl, requirePlatformUrl } from "./url-policy.js";

export { extractReddit, type RedditResult };

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const execAsync = promisify(exec);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".rudi", "outputs");

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

    if (!response.ok) throw new Error(`Supadata API returned ${response.status}`);
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

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  let html = await response.text();
  const finalUrl = response.url;

  // Uncomment hidden content for Sports Reference sites
  if (articleUrl.includes("-reference.com")) {
    html = html.replace(/<!--([\s\S]*?)-->/g, "$1");
  }

  const dom = new JSDOM(html, { url: finalUrl });
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
}

function formatArticleResult(result: ArticleResult): string {
  return `**Article Extracted**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Source:** ${result.siteName}\n**URL:** ${result.url}\n**Words:** ${result.wordCount}\n\n---\n\n${result.content}`;
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

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) {
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
      case "extract_links": {
        const data = await extractLinks(args?.url as string, args?.max_links as number);
        const format = (args?.format as string) || "markdown";
        result = formatLinksResult(data, format);
        const extension = format === "csv" || format === "json" ? format : "md";
        if (args?.output) outputPath = resolveOutputPath(args.output as string, "links", new URL(data.url).hostname, extension);
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
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("reddit.com")) return "reddit";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.startsWith("http://") || url.startsWith("https://")) return "article";
  return null;
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
