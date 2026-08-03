import * as cheerio from "cheerio";

import { parseHttpUrl } from "./url-policy.js";

const ARTICLE_USER_AGENT =
  "Mozilla/5.0 (compatible; ContentExtractorMCP/1.0; +https://github.com)";

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; the original HTTP error is more useful.
  }
}

async function throwHttpResponseError(response: Response): Promise<never> {
  await discardResponseBody(response);
  throw new Error(`HTTP ${response.status}: ${response.statusText}`);
}

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

export function formatLinksResult(result: LinksResult, format = "markdown"): string {
  if (format === "json") return JSON.stringify(result, null, 2);
  if (format === "csv") return result.csv;

  const categorySummary = Object.entries(result.categories)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}: ${count}`)
    .join(", ");

  const rows = result.links.map((link) => `| ${escapeMarkdownTableCell(link.title)} | ${escapeMarkdownTableCell(link.category)} | ${escapeMarkdownTableCell(link.url)} |`);

  return `**Links Extracted**\n\n**URL:** ${result.url}\n**Total:** ${result.totalLinks}\n**Categories:** ${categorySummary || "none"}\n\n| Title | Category | URL |\n| --- | --- | --- |\n${rows.join("\n")}`;
}
