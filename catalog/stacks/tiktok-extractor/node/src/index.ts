#!/usr/bin/env node
/**
 * TikTok Extractor
 * Extract transcripts/captions from TikTok videos
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { extractTikTok } from './index'
 *   - As CLI: node index.ts <tiktok-url> [output-dir]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as cheerio from "cheerio";
import { decode } from "html-entities";

const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

const UA_HEADERS = {
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

/**
 * Extract transcript/captions from a TikTok video
 * @param url - TikTok video URL (full URL or short link)
 * @param preferLang - Preferred language code (default: "eng")
 */
export async function extractTikTok(url: string, preferLang = "eng"): Promise<TikTokResult> {
  const response = await fetch(url, { headers: UA_HEADERS, redirect: "follow" });
  const fullUrl = response.url;
  const html = await response.text();

  const $ = cheerio.load(html);
  const script = $("#__UNIVERSAL_DATA_FOR_REHYDRATION__");

  if (!script.length) {
    throw new Error("Could not find TikTok data - page structure may have changed");
  }

  const data = JSON.parse(decode(script.html() || "{}"));
  const videoDetail = data.__DEFAULT_SCOPE__?.["webapp.video-detail"];

  if (!videoDetail?.itemInfo?.itemStruct) {
    throw new Error("Could not parse TikTok video data");
  }

  const item = videoDetail.itemInfo.itemStruct;
  const user = item.author?.uniqueId || "unknown";
  const videoId = item.id;
  const description = item.desc || "";
  const subtitles = item.video?.subtitleInfos || [];

  if (!subtitles.length) {
    return {
      url: fullUrl,
      hasTranscript: false,
      transcript: "",
      wordCount: 0,
      metadata: { user, videoId, description },
    };
  }

  const track = subtitles.find((s: any) => s.LanguageCodeName?.startsWith(preferLang)) || subtitles[0];
  const vttResponse = await fetch(track.Url, { headers: UA_HEADERS });
  const vtt = await vttResponse.text();
  const transcript = stripVtt(vtt);
  const wordCount = transcript.split(/\s+/).filter((w) => w.length > 0).length;

  return {
    url: fullUrl,
    hasTranscript: true,
    transcript,
    wordCount,
    metadata: { user, videoId, description, language: track.LanguageCodeName },
  };
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

function resolveOutputPath(output: string | undefined, user: string, videoId: string): string {
  const filename = `tiktok-${user}-${videoId}-${new Date().toISOString().split("T")[0]}.md`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, filename);
  return output;
}

function formatResult(result: TikTokResult): string {
  let text = `**TikTok Video Extracted**\n\n`;
  text += `**Creator:** @${result.metadata.user}\n`;
  text += `**Video ID:** ${result.metadata.videoId}\n`;
  text += `**URL:** ${result.url}\n\n`;
  if (result.metadata.description) {
    text += `**Description:** ${result.metadata.description}\n\n`;
  }
  if (result.hasTranscript) {
    text += `---\n\n## Transcript (${result.wordCount} words)\n`;
    text += `**Language:** ${result.metadata.language}\n\n`;
    text += result.transcript;
  } else {
    text += `---\n\n*No captions available for this video*`;
  }
  return text;
}

const server = new Server(
  { name: "tiktok-extractor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "extract_tiktok",
    description: "Extract transcript/captions from a TikTok video. Works with full URLs and short links. Returns video info and transcript text if captions are available.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "TikTok video URL (full URL or short link)" },
        lang: { type: "string", description: "Preferred language code (default: eng)" },
        output: { type: "string", description: "Optional file path to save markdown output (e.g., /path/to/file.md)" },
      },
      required: ["url"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "extract_tiktok") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await extractTikTok(args?.url as string, (args?.lang as string) || "eng");
    const text = formatResult(result);

    if (args?.output) {
      const filePath = resolveOutputPath(args.output as string, result.metadata.user, result.metadata.videoId);
      if (!existsSync(DEFAULT_OUTPUT_DIR)) mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
      writeFileSync(filePath, text, "utf-8");
      return { content: [{ type: "text", text: `Saved to ${filePath}` }] };
    }
    return { content: [{ type: "text", text }] };
  } catch (error: any) {
    let errorMsg = `Error: ${error.message}`;
    if (error.message.includes("403")) {
      errorMsg += "\n\nTikTok may be blocking automated requests. Try using a VPN or proxy.";
    }
    return { content: [{ type: "text", text: errorMsg }], isError: true };
  }
});

// =============================================================================
// ENTRY POINT
// =============================================================================

const args = process.argv.slice(2);

// CLI mode
if (args.length > 0 && args[0].includes("tiktok.com")) {
  extractTikTok(args[0]).then((result) => {
    const text = formatResult(result);
    if (args[1]) {
      const filePath = resolveOutputPath(args[1], result.metadata.user, result.metadata.videoId);
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
