#!/usr/bin/env node
/**
 * YouTube Extractor
 * Extract transcripts from YouTube videos
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { extractYouTube } from './index'
 *   - As CLI: node index.ts <youtube-url> [output-dir]
 *
 * Extraction methods (in order):
 *   0. Supadata API - Professional service (fastest, most reliable)
 *   1. youtube-transcript npm - Direct API access
 *   2. HTML scraping - Parse from page
 *   3. yt-dlp - Heavy fallback
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { YoutubeTranscript } from "youtube-transcript";
import { writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const execAsync = promisify(exec);
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

// =============================================================================
// CORE API - The actual functionality
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

interface ExtractionResult {
  success: boolean;
  method?: string;
  transcript?: string;
  lang?: string;
  segments?: number;
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

// METHOD 0: Supadata API (fastest)
async function getTranscriptViaSupaData(videoId: string, url: string): Promise<ExtractionResult> {
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

    return { success: true, method: "supadata-api", transcript: data.content.trim(), lang: data.lang || "en" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// METHOD 1: youtube-transcript npm
async function getTranscriptViaAPI(videoId: string): Promise<ExtractionResult> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) throw new Error("No captions available");

    const fullText = transcript.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    if (!fullText) throw new Error("Transcript segments contained no text");

    return { success: true, method: "youtube-transcript-api", transcript: fullText, segments: transcript.length };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// METHOD 2: HTML scraping
async function getTranscriptViaHTML(videoId: string): Promise<ExtractionResult> {
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

    return { success: true, method: "html-scraping", transcript: texts.join(" ").replace(/\s+/g, " ").trim(), segments: texts.length };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// METHOD 3: yt-dlp fallback
async function getTranscriptViaYtdlp(videoId: string): Promise<ExtractionResult> {
  try {
    await execAsync("yt-dlp --version");
  } catch {
    return { success: false, error: "yt-dlp not installed" };
  }

  try {
    const { stdout } = await execAsync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --print-to-file "%(subtitles)j" - "https://www.youtube.com/watch?v=${videoId}" 2>/dev/null || echo "{}"`,
      { maxBuffer: 10 * 1024 * 1024 }
    );
    if (!stdout || stdout.trim() === "{}") throw new Error("No subtitles via yt-dlp");
    return { success: true, method: "yt-dlp", transcript: stdout.trim() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function getVideoMetadata(videoId: string) {
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

/**
 * Extract transcript from a YouTube video
 * @param url - YouTube video URL or video ID
 */
export async function extractYouTube(url: string): Promise<YouTubeResult> {
  const videoId = extractVideoId(url);
  const metadata = await getVideoMetadata(videoId);

  const methods = [
    () => getTranscriptViaSupaData(videoId, url),
    () => getTranscriptViaAPI(videoId),
    () => getTranscriptViaHTML(videoId),
    () => getTranscriptViaYtdlp(videoId),
  ];

  for (const method of methods) {
    const result = await method();
    if (result.success && result.transcript) {
      const wordCount = result.transcript.split(/\s+/).filter((w) => w.length > 0).length;
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

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function resolveOutputPath(output: string | undefined, channel: string, title: string): string {
  const filename = `youtube-${slugify(channel)}-${slugify(title)}-${new Date().toISOString().split("T")[0]}.md`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, filename);
  return output;
}

function formatResult(result: YouTubeResult): string {
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

const server = new Server(
  { name: "youtube-extractor", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "extract_youtube",
    description: "Extract transcript from a YouTube video. Uses Supadata API (fastest) with fallbacks to youtube-transcript npm, HTML scraping, and yt-dlp. Returns video info and full transcript.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "YouTube video URL or video ID" },
        output: { type: "string", description: "Optional file path to save markdown output (e.g., /path/to/file.md)" },
      },
      required: ["url"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "extract_youtube") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await extractYouTube(args?.url as string);
    const text = formatResult(result);

    if (args?.output) {
      const filePath = resolveOutputPath(args.output as string, result.author, result.title);
      if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
      writeFileSync(filePath, text, "utf-8");
      return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
    }
    return { content: [{ type: "text", text }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);

// CLI mode
if (args.length > 0 && (args[0].includes("youtube.com") || args[0].includes("youtu.be"))) {
  extractYouTube(args[0]).then((result) => {
    const text = formatResult(result);
    if (args[1]) {
      const filePath = resolveOutputPath(args[1], result.author, result.title);
      writeFileSync(filePath, text, "utf-8");
      console.log(`Saved to ${filePath}`);
    } else {
      console.log(text);
    }
  }).catch(console.error);
}
// MCP mode
else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
