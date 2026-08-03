import * as cheerio from "cheerio";

import { parseHttpUrl } from "./url-policy.js";

const REDDIT_USER_AGENT = "ContentExtractorMCP/1.0";
const REDDIT_HTML_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
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

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; the original HTTP error is more useful.
  }
}

async function throwHttpResponseError(
  response: Response,
  prefix = "HTTP"
): Promise<never> {
  await discardResponseBody(response);
  throw new Error(`${prefix} ${response.status}: ${response.statusText}`);
}

function canonicalizeRedditUrl(url: string): string {
  const parsed = parseHttpUrl(url);
  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set([
    "reddit.com",
    "www.reddit.com",
    "old.reddit.com",
    "new.reddit.com",
    "m.reddit.com",
    "redd.it",
  ]);

  if (!allowedHosts.has(hostname)) {
    throw new Error("Reddit extractor requires a reddit.com or redd.it URL");
  }

  if (hostname !== "redd.it") parsed.hostname = "www.reddit.com";
  parsed.hash = "";
  parsed.search = "";

  if (parsed.hostname !== "redd.it" && !parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }

  return parsed.toString();
}

function shouldFollowRedditRedirect(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "redd.it" ||
    /\/r\/[^/]+\/s\//.test(parsed.pathname) ||
    /\/s\//.test(parsed.pathname);
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
      await throwHttpResponseError(
        response,
        "Failed to resolve Reddit link: HTTP"
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(
        "Failed to resolve Reddit link: redirect missing location header"
      );
    }

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
  const retryAfter = Number.parseInt(
    response.headers.get("retry-after") || "",
    10
  );
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, REDDIT_MAX_RETRY_DELAY_MS);
  }
  return Math.min(
    REDDIT_RETRY_BASE_MS * attempt,
    REDDIT_MAX_RETRY_DELAY_MS
  );
}

function hasRedditOAuthConfig(): boolean {
  return Boolean(
    process.env.REDDIT_BEARER_TOKEN ||
      (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)
  );
}

async function getRedditOAuthToken(): Promise<{
  token: string;
  retrievalMethod: string;
}> {
  if (process.env.REDDIT_BEARER_TOKEN) {
    return {
      token: process.env.REDDIT_BEARER_TOKEN,
      retrievalMethod: "oauth_bearer",
    };
  }

  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET) {
    throw new Error("Reddit OAuth fallback is not configured");
  }

  const credentials = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString("base64");
  const response = await fetch(
    "https://www.reddit.com/api/v1/access_token",
    {
      method: "POST",
      headers: {
        "User-Agent": REDDIT_USER_AGENT,
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    }
  );

  if (!response.ok) {
    await throwHttpResponseError(
      response,
      "Reddit OAuth token request failed: HTTP"
    );
  }

  const tokenPayload = await response.json();
  const accessToken = tokenPayload &&
      typeof tokenPayload === "object" &&
      "access_token" in tokenPayload
    ? tokenPayload.access_token
    : undefined;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error(
      "Reddit OAuth token response did not include an access token"
    );
  }

  return {
    token: accessToken,
    retrievalMethod: "oauth_client_credentials",
  };
}

async function fetchPublicRedditData(url: string): Promise<RedditFetchResult> {
  const jsonUrl = redditJsonUrl(url);
  for (let attempt = 1; attempt <= REDDIT_MAX_FETCH_ATTEMPTS; attempt += 1) {
    const response = await fetch(jsonUrl, {
      headers: {
        "User-Agent": REDDIT_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (response.ok) {
      return { data: await response.json(), retrievalMethod: "public_json" };
    }
    if (
      !isRetryableRedditStatus(response.status) ||
      attempt === REDDIT_MAX_FETCH_ATTEMPTS
    ) {
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
  const parsed = Number.parseInt(
    String(rawValue || "").replace(/,/g, ""),
    10
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function inferSubredditFromUrl(url: string): string {
  return new URL(url).pathname.match(/\/r\/([^/]+)/)?.[1] || "unknown";
}

function ownCommentText(
  $: cheerio.CheerioAPI,
  comment: cheerio.Cheerio<any>
): string {
  return cleanText(
    comment.children(".entry").find(".usertext-body .md").first().text()
  );
}

function ownCommentScore(
  $: cheerio.CheerioAPI,
  comment: cheerio.Cheerio<any>
): number {
  return parseScore(
    comment.children(".entry").find(".score.unvoted").first().text() ||
      comment.children(".entry").find(".score").first().text()
  );
}

function directOldRedditReplies(
  $: cheerio.CheerioAPI,
  comment: cheerio.Cheerio<any>
): any[] {
  return comment
    .children(".child")
    .children(".sitetable")
    .children(".thing.comment")
    .toArray();
}

function parseOldRedditComment(
  $: cheerio.CheerioAPI,
  element: any
): any | null {
  const comment = $(element);
  const body = ownCommentText($, comment);
  if (!body) return null;

  const replies = directOldRedditReplies($, comment)
    .map((reply) => parseOldRedditComment($, reply))
    .filter(Boolean);

  return {
    kind: "t1",
    data: {
      author:
        comment.attr("data-author") ||
        cleanText(comment.children(".entry").find("a.author").first().text()) ||
        "[deleted]",
      score: ownCommentScore($, comment),
      body,
      total_awards_received: 0,
      replies: replies.length > 0 ? { data: { children: replies } } : "",
    },
  };
}

function parseOldRedditHtml(
  html: string,
  finalUrl: string,
  sourceUrl: string
): unknown {
  const $ = cheerio.load(html);
  const post = $(".thing.link").first();
  const title = cleanText(post.find("a.title").first().text());
  if (!post.length || !title) {
    throw new Error("old Reddit HTML did not contain a parseable post");
  }

  const canonicalSourceUrl = canonicalizeRedditUrl(sourceUrl);
  const permalink = post.attr("data-permalink") || new URL(finalUrl).pathname;
  const createdAt = Date.parse(
    post.find("time[datetime]").first().attr("datetime") || ""
  );
  const comments = $(".thing.comment")
    .filter((_, element) => $(element).parents(".thing.comment").length === 0)
    .toArray()
    .map((element) => parseOldRedditComment($, element))
    .filter(Boolean);
  const commentCount =
    parseScore(post.find("a.comments").first().text()) || comments.length;
  const dataUrl = post.attr("data-url") || canonicalSourceUrl;
  const postUrl = dataUrl.startsWith("/r/")
    ? canonicalSourceUrl
    : new URL(dataUrl, finalUrl).toString();
  const flair = post.find(".linkflairlabel").first();

  return [
    {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              title,
              author:
                post.attr("data-author") ||
                cleanText(post.find("a.author").first().text()) ||
                "[deleted]",
              subreddit:
                post.attr("data-subreddit") || inferSubredditFromUrl(sourceUrl),
              score: parseScore(
                post.attr("data-score") ||
                  post.find(".score.unvoted").first().text()
              ),
              upvote_ratio: 0,
              num_comments: commentCount,
              created_utc: Number.isFinite(createdAt)
                ? Math.floor(createdAt / 1000)
                : 0,
              total_awards_received: 0,
              selftext: cleanText(
                post.find(".usertext-body .md").first().text()
              ),
              url: postUrl,
              link_flair_text:
                flair.attr("title") || cleanText(flair.text()) || null,
              permalink,
              is_video: false,
              over_18: post.hasClass("over18"),
            },
          },
        ],
      },
    },
    { data: { children: comments } },
  ];
}

async function fetchOldRedditHtmlData(url: string): Promise<RedditFetchResult> {
  const htmlUrl = redditOldHtmlUrl(url);
  const response = await fetch(htmlUrl, {
    headers: {
      "User-Agent": REDDIT_HTML_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    await throwHttpResponseError(response);
  }
  return {
    data: parseOldRedditHtml(await response.text(), response.url || htmlUrl, url),
    retrievalMethod: "old_reddit_html",
  };
}

async function fetchRedditData(url: string): Promise<RedditFetchResult> {
  try {
    return await fetchOldRedditHtmlData(url);
  } catch (htmlError: any) {
    const failures = [
      `old Reddit HTML fallback failed (${htmlError.message})`,
    ];
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
  if (typeof maxComments !== "number" || !Number.isFinite(maxComments)) {
    return 20;
  }
  return Math.max(0, Math.min(Math.floor(maxComments), 100));
}

function normalizeMaxDepth(maxDepth: unknown): number {
  if (typeof maxDepth !== "number" || !Number.isFinite(maxDepth)) return 2;
  return Math.max(1, Math.min(Math.floor(maxDepth), 5));
}

function parseRedditPayload(data: unknown): {
  postData: any;
  commentsData: any[];
} {
  const payload = data as any;
  const postData = payload?.[0]?.data?.children?.[0]?.data;
  const commentsData = payload?.[1]?.data?.children;
  if (!postData || typeof postData !== "object" || !Array.isArray(commentsData)) {
    throw new Error("Reddit response was malformed");
  }
  return { postData, commentsData };
}

function formatRedditComment(
  comment: any,
  depth: number,
  maxDepth: number,
  counter: { count: number }
): string {
  if (!comment.data || comment.kind !== "t1") return "";
  const indent = "  ".repeat(depth);
  const { author, score, body, total_awards_received } = comment.data;
  counter.count += 1;
  let formatted = `${indent}u/${author} | ${score} points`;
  if (total_awards_received) {
    formatted += ` | ${total_awards_received} awards`;
  }
  formatted += `\n${indent}${String(body || "").replace(
    /\n/g,
    "\n" + indent
  )}\n`;
  if (depth + 1 < maxDepth && comment.data.replies?.data?.children) {
    for (const reply of comment.data.replies.data.children) {
      if (reply.kind === "t1") {
        formatted +=
          "\n" + formatRedditComment(reply, depth + 1, maxDepth, counter);
      }
    }
  }
  return formatted;
}

export async function extractReddit(
  url: string,
  maxComments = 20,
  maxDepth = 2
): Promise<RedditResult> {
  const boundedMaxComments = normalizeMaxComments(maxComments);
  const boundedMaxDepth = normalizeMaxDepth(maxDepth);
  const resolvedUrl = await resolveRedditUrl(url);
  const { data, retrievalMethod } = await fetchRedditData(resolvedUrl);
  const { postData, commentsData } = parseRedditPayload(data);

  let content = `# ${postData.title}\n\n`;
  content += `**Posted by** u/${postData.author} in r/${postData.subreddit}\n`;
  content += `**Score:** ${postData.score} points (${Math.round(
    postData.upvote_ratio * 100
  )}% upvoted)\n`;
  content += `**Comments:** ${postData.num_comments}\n\n---\n\n`;
  if (postData.selftext) content += `${postData.selftext}\n\n`;
  else if (postData.url && postData.url !== resolvedUrl) {
    content += `**Link post:** ${postData.url}\n\n`;
  }
  if (postData.link_flair_text) {
    content += `**Flair:** ${postData.link_flair_text}\n\n`;
  }
  content += "## Comments\n\n";

  const topComments = commentsData
    .filter((comment: any) => comment.kind === "t1")
    .slice(0, boundedMaxComments);
  const commentCounter = { count: 0 };
  if (topComments.length === 0) {
    content += "*No comments yet*\n";
  } else {
    for (const comment of topComments) {
      content +=
        formatRedditComment(
          comment,
          0,
          boundedMaxDepth,
          commentCounter
        ) + "\n---\n\n";
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

export function formatRedditResult(result: RedditResult): string {
  return `**Reddit Post Extracted**\n\n**Title:** ${result.title}\n**Author:** ${result.author}\n**Subreddit:** r/${result.subreddit}\n**Score:** ${result.metadata.score}\n\n---\n\n${result.content}`;
}
