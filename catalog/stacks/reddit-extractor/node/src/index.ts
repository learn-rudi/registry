#!/usr/bin/env node
/**
 * Reddit Extractor
 * Extract Reddit posts and comments as structured content
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { extractReddit } from './index'
 *   - As CLI: node index.ts <reddit-url> [output-dir]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

const USER_AGENT = "RedditExtractorMCP/1.0";
const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

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
    created: string;
    permalink: string;
    isVideo: boolean;
    isNsfw: boolean;
    awards: number;
  };
}

interface RedditComment {
  kind: string;
  data: {
    author: string;
    score: number;
    body: string;
    total_awards_received?: number;
    replies?: { data?: { children?: RedditComment[] } };
  };
}

interface RedditPost {
  title: string;
  author: string;
  subreddit: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  created_utc: number;
  total_awards_received?: number;
  selftext?: string;
  url?: string;
  link_flair_text?: string;
  permalink: string;
  is_video?: boolean;
  over_18?: boolean;
}

async function resolveShortLink(url: string): Promise<string> {
  if (!/\/r\/[^\/]+\/s\//.test(url)) return url;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "manual" });
  if (response.status === 301 || response.status === 302) {
    const location = response.headers.get("location");
    if (location) return location.split("?")[0];
  }
  throw new Error("Failed to resolve short link");
}

function formatComment(comment: RedditComment, depth = 0): string {
  if (!comment.data || comment.kind !== "t1") return "";
  const indent = "  ".repeat(depth);
  const { author, score, body, total_awards_received } = comment.data;
  let formatted = `${indent}u/${author} | ${score} points`;
  if (total_awards_received) formatted += ` | ${total_awards_received} awards`;
  formatted += `\n${indent}${body.replace(/\n/g, "\n" + indent)}\n`;
  if (comment.data.replies?.data?.children) {
    for (const reply of comment.data.replies.data.children) {
      if (reply.kind === "t1") formatted += "\n" + formatComment(reply, depth + 1);
    }
  }
  return formatted;
}

/**
 * Extract a Reddit post and its comments
 * @param url - Reddit thread URL (full URL or short link)
 * @param maxComments - Maximum top-level comments to include (default: 20)
 */
export async function extractReddit(url: string, maxComments = 20): Promise<RedditResult> {
  const resolvedUrl = await resolveShortLink(url);
  const jsonUrl = resolvedUrl.replace(/\/$/, "") + ".json";

  const response = await fetch(jsonUrl, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const postData: RedditPost = data[0].data.children[0].data;
  const commentsData: RedditComment[] = data[1].data.children;

  let content = `# ${postData.title}\n\n`;
  content += `**Posted by** u/${postData.author} in r/${postData.subreddit}\n`;
  content += `**Score:** ${postData.score} points (${Math.round(postData.upvote_ratio * 100)}% upvoted)\n`;
  content += `**Comments:** ${postData.num_comments}\n`;
  content += `**Posted:** ${new Date(postData.created_utc * 1000).toLocaleString()}\n`;
  if (postData.total_awards_received) content += `**Awards:** ${postData.total_awards_received}\n`;
  content += `\n---\n\n`;
  if (postData.selftext) {
    content += `${postData.selftext}\n\n`;
  } else if (postData.url && postData.url !== url) {
    content += `**Link post:** ${postData.url}\n\n`;
  }
  if (postData.link_flair_text) content += `**Flair:** ${postData.link_flair_text}\n\n`;
  content += `---\n\n## Comments\n\n`;

  const topComments = commentsData.filter((c) => c.kind === "t1").slice(0, maxComments);
  if (topComments.length === 0) {
    content += "*No comments yet*\n";
  } else {
    for (const comment of topComments) {
      content += formatComment(comment) + "\n---\n\n";
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
      created: new Date(postData.created_utc * 1000).toISOString(),
      permalink: `https://reddit.com${postData.permalink}`,
      isVideo: postData.is_video || false,
      isNsfw: postData.over_18 || false,
      awards: postData.total_awards_received || 0,
    },
  };
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function resolveOutputPath(output: string | undefined, subreddit: string, title: string): string {
  const filename = `reddit-${subreddit}-${slugify(title)}-${new Date().toISOString().split("T")[0]}.md`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, filename);
  return output;
}

const server = new Server(
  { name: "reddit-extractor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "extract_reddit",
    description: "Extract a Reddit post and its comments. Returns structured content with title, author, scores, and threaded comments.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Reddit thread URL (full URL or short link like reddit.com/r/sub/s/abc)" },
        max_comments: { type: "number", description: "Maximum number of top-level comments to include (default: 20)" },
        output: { type: "string", description: "Optional file path to save markdown output (e.g., /path/to/file.md)" },
      },
      required: ["url"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "extract_reddit") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await extractReddit(args?.url as string, args?.max_comments as number);
    const text = `**Extracted Reddit Post**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Subreddit:** r/${result.subreddit}\n**Score:** ${result.metadata.score} (${Math.round(result.metadata.upvoteRatio * 100)}% upvoted)\n**Comments:** ${result.metadata.numComments}\n\n---\n\n${result.content}`;

    if (args?.output) {
      const filePath = resolveOutputPath(args.output as string, result.subreddit, result.title);
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

// CLI mode: node index.ts <url> [output]
if (args.length > 0 && args[0].includes("reddit.com")) {
  extractReddit(args[0]).then((result) => {
    const text = `**Extracted Reddit Post**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Subreddit:** r/${result.subreddit}\n**Score:** ${result.metadata.score}\n\n---\n\n${result.content}`;
    if (args[1]) {
      const filePath = resolveOutputPath(args[1], result.subreddit, result.title);
      writeFileSync(filePath, text, "utf-8");
      console.log(`Saved to ${filePath}`);
    } else {
      console.log(text);
    }
  }).catch(console.error);
}
// MCP mode: no args, JSON-RPC over stdio
else {
  const transport = new StdioServerTransport();
  server.connect(transport).catch(console.error);
}
