#!/usr/bin/env node
/**
 * Article Extractor
 * Extract clean content from web articles
 *
 * Usage:
 *   - As MCP: Run without args, speaks JSON-RPC
 *   - As API: import { extractArticle } from './index'
 *   - As CLI: node index.ts <url> [output-dir]
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const DEFAULT_OUTPUT_DIR = join(homedir(), ".prompt-stack", "output");

// =============================================================================
// CORE API - The actual functionality
// =============================================================================

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

async function fetchPage(url: string): Promise<{ html: string; url: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  let html = await response.text();

  // Uncomment hidden content for Sports Reference sites
  if (url.includes("-reference.com")) {
    html = html.replace(/<!--([\s\S]*?)-->/g, "$1");
  }

  return { html, url: response.url };
}

function extractWithReadability(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) throw new Error("Readability could not parse article");

  return {
    title: article.title,
    author: article.byline,
    content: article.content,
    textContent: article.textContent,
    excerpt: article.excerpt,
    siteName: article.siteName,
  };
}

function extractWithCheerio(html: string, url: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  const title = $('meta[property="og:title"]').attr("content") || $('meta[name="twitter:title"]').attr("content") || $("title").text() || $("h1").first().text();
  const author = $('meta[name="author"]').attr("content") || $('meta[property="article:author"]').attr("content") || $(".author").first().text();
  const description = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");

  const contentSelectors = ["article", "main", '[role="main"]', ".post-content", ".entry-content", ".content", "#content", ".article-body"];
  let content = "";
  for (const selector of contentSelectors) {
    const element = $(selector).first();
    if (element.length && element.text().trim().length > 200) {
      content = element.html() || "";
      break;
    }
  }

  if (!content) {
    const paragraphs = $("p").map((_, el) => $(el).text().trim()).get().filter((p) => p.length > 50);
    if (paragraphs.length > 3) content = paragraphs.join("\n\n");
  }

  return { title: title?.trim(), author: author?.trim(), excerpt: description?.trim(), content, siteName: new URL(url).hostname };
}

function htmlToMarkdown(html: string): string {
  const turndownService = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  turndownService.addRule("removeMedia", { filter: ["img", "video", "iframe"], replacement: () => "" });
  return turndownService.turndown(html);
}

/**
 * Extract clean content from a web article
 * @param url - URL of the article to extract
 */
export async function extractArticle(url: string): Promise<ArticleResult> {
  const { html, url: finalUrl } = await fetchPage(url);

  let article;
  try {
    article = extractWithReadability(html, finalUrl);
  } catch {
    article = extractWithCheerio(html, finalUrl);
  }

  let markdown = article.content ? htmlToMarkdown(article.content) : (article as any).textContent || "";
  const cleanText = markdown.replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "").replace(/\t/g, "  ");
  const wordCount = cleanText.split(/\s+/).filter((w: string) => w.length > 0).length;
  const domain = new URL(finalUrl).hostname.replace("www.", "");

  return {
    url: finalUrl,
    title: article.title || "Untitled",
    author: article.author || "Unknown",
    siteName: article.siteName || domain,
    domain,
    excerpt: article.excerpt || cleanText.substring(0, 200) + "...",
    content: cleanText,
    wordCount,
  };
}

// =============================================================================
// MCP SERVER - Thin wrapper around core API
// =============================================================================

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function resolveOutputPath(output: string | undefined, domain: string, title: string): string {
  const filename = `article-${domain.replace(/\./g, "-")}-${slugify(title)}-${new Date().toISOString().split("T")[0]}.md`;
  if (!output) return join(DEFAULT_OUTPUT_DIR, filename);
  if (existsSync(output) && statSync(output).isDirectory()) return join(output, filename);
  if (output.endsWith("/") || !output.includes(".")) return join(output, filename);
  return output;
}

function formatResult(result: ArticleResult): string {
  let text = `**Article Extracted**\n\n`;
  text += `**Title:** ${result.title}\n`;
  text += `**Author:** ${result.author}\n`;
  text += `**Source:** ${result.siteName}\n`;
  text += `**URL:** ${result.url}\n`;
  text += `**Word Count:** ${result.wordCount}\n\n`;
  text += `---\n\n${result.content}`;
  return text;
}

const server = new Server(
  { name: "article-extractor", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "extract_article",
    description: "Extract clean content from a web article. Uses Readability for parsing and converts to markdown. Works with news sites, blogs, and most web pages.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL of the article to extract" },
        output: { type: "string", description: "Optional file path to save markdown output (e.g., /path/to/file.md)" },
      },
      required: ["url"],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name !== "extract_article") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  try {
    const result = await extractArticle(args?.url as string);
    const text = formatResult(result);

    if (args?.output) {
      const filePath = resolveOutputPath(args.output as string, result.domain, result.title);
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
if (args.length > 0 && (args[0].startsWith("http://") || args[0].startsWith("https://"))) {
  extractArticle(args[0]).then((result) => {
    const text = formatResult(result);
    if (args[1]) {
      const filePath = resolveOutputPath(args[1], result.domain, result.title);
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
