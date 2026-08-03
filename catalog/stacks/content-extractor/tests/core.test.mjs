import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractArticle,
  extractBatch,
  extractGitHub,
  extractLinks,
  extractReddit,
  extractTikTok,
  extractYouTube,
} from "../src/index.ts";

function makeJsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    url: init.url ?? "https://example.test/",
    headers: {
      get(name) {
        return init.headers?.[name.toLowerCase()] ?? null;
      },
    },
    async json() {
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

function redditPayload(commentCount = 1) {
  return [
    {
      data: {
        children: [
          {
            kind: "t3",
            data: {
              title: "Portable extractor title",
              author: "poster",
              subreddit: "test",
              score: 42,
              upvote_ratio: 0.95,
              num_comments: 1,
              created_utc: 0,
              total_awards_received: 0,
              selftext: "Post body",
              url: "https://www.reddit.com/r/test/comments/abc/post/",
              link_flair_text: null,
              permalink: "/r/test/comments/abc/post/",
              is_video: false,
              over_18: false,
            },
          },
        ],
      },
    },
    {
      data: {
        children: Array.from({ length: commentCount }, (_, index) => ({
            kind: "t1",
            data: {
              author: `commenter${index + 1}`,
              score: 7 + index,
              body: `Comment ${index + 1}`,
              total_awards_received: 0,
              replies: "",
            },
          })),
      },
    },
  ];
}

test("extractReddit falls back to Reddit OAuth bearer when public JSON is blocked", async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.REDDIT_BEARER_TOKEN;
  const originalClientId = process.env.REDDIT_CLIENT_ID;
  const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const calls = [];

  process.env.REDDIT_BEARER_TOKEN = "test-bearer-token";
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, headers: options.headers || {} });

    if (requestUrl.startsWith("https://old.reddit.com/")) {
      return makeJsonResponse("blocked", { ok: false, status: 403, statusText: "Blocked" });
    }

    if (requestUrl.startsWith("https://oauth.reddit.com/")) {
      assert.equal(options.headers.Authorization, "Bearer test-bearer-token");
      return makeJsonResponse(redditPayload());
    }

    assert.ok(requestUrl.startsWith("https://www.reddit.com/"));
    return makeJsonResponse({}, { ok: false, status: 403, statusText: "Forbidden" });
  };

  try {
    const result = await extractReddit("https://www.reddit.com/r/test/comments/abc/post/", 5);

    assert.equal(result.title, "Portable extractor title");
    assert.equal(result.metadata.retrievalMethod, "oauth_bearer");
    assert.equal(result.metadata.extractedComments, 1);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].url.startsWith("https://old.reddit.com/"));
    assert.ok(calls[1].url.startsWith("https://www.reddit.com/"));
    assert.ok(calls[2].url.startsWith("https://oauth.reddit.com/"));
    assert.equal(JSON.stringify(result).includes("test-bearer-token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBearer === undefined) {
      delete process.env.REDDIT_BEARER_TOKEN;
    } else {
      process.env.REDDIT_BEARER_TOKEN = originalBearer;
    }
    if (originalClientId === undefined) {
      delete process.env.REDDIT_CLIENT_ID;
    } else {
      process.env.REDDIT_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
  }
});

test("extractYouTube uses Supadata transcript fallback when configured", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.SUPA_DATA_API;
  const calls = [];

  process.env.SUPA_DATA_API = "test-supadata-key";

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push({ url: requestUrl, headers: options.headers || {} });

    if (requestUrl.startsWith("https://www.youtube.com/watch")) {
      return makeJsonResponse(`
        <html>
          <head><meta name="title" content="Fixture Video"></head>
          <body>
            <script>
              {"author":"Fixture Channel","viewCount":"12345","lengthSeconds":"125"}
            </script>
          </body>
        </html>
      `);
    }

    if (requestUrl.startsWith("https://api.supadata.ai/v1/youtube/transcript")) {
      assert.equal(options.headers["x-api-key"], "test-supadata-key");
      assert.match(requestUrl, /url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Dabcdefghijk/);
      return makeJsonResponse({ content: "Hello transcript text from fixture." });
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await extractYouTube("https://www.youtube.com/watch?v=abcdefghijk");

    assert.equal(result.title, "Fixture Video");
    assert.equal(result.author, "Fixture Channel");
    assert.equal(result.videoId, "abcdefghijk");
    assert.equal(result.duration, "2m 5s");
    assert.equal(result.viewCount, 12345);
    assert.equal(result.hasTranscript, true);
    assert.equal(result.transcript, "Hello transcript text from fixture.");
    assert.equal(result.wordCount, 5);
    assert.equal(result.extractionMethod, "supadata-api");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SUPA_DATA_API;
    } else {
      process.env.SUPA_DATA_API = originalApiKey;
    }
  }
});

test("extractTikTok extracts caption VTT text from TikTok page data", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const pageData = {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            id: "7350000000000000000",
            desc: "Fixture TikTok description",
            author: { uniqueId: "fixturecreator" },
            video: {
              subtitleInfos: [
                {
                  LanguageCodeName: "eng-US",
                  Url: "https://v16m.tiktokcdn-us.com/caption.vtt",
                },
              ],
            },
          },
        },
      },
    },
  };

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.startsWith("https://www.tiktok.com/")) {
      return makeJsonResponse(`
        <html>
          <body>
            <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(pageData)}</script>
          </body>
        </html>
      `, { url: "https://www.tiktok.com/@fixturecreator/video/7350000000000000000" });
    }

    if (requestUrl === "https://v16m.tiktokcdn-us.com/caption.vtt") {
      return makeJsonResponse(`WEBVTT

00:00:00.000 --> 00:00:01.000
Hello there

00:00:01.000 --> 00:00:02.000
general kenobi`);
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await extractTikTok("https://www.tiktok.com/@fixturecreator/video/7350000000000000000");

    assert.equal(result.url, "https://www.tiktok.com/@fixturecreator/video/7350000000000000000");
    assert.equal(result.hasTranscript, true);
    assert.equal(result.transcript, "Hello there\ngeneral kenobi");
    assert.equal(result.wordCount, 4);
    assert.deepEqual(result.metadata, {
      user: "fixturecreator",
      videoId: "7350000000000000000",
      description: "Fixture TikTok description",
      language: "eng-US",
    });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractTikTok returns metadata without transcript when captions are unavailable", async () => {
  const originalFetch = globalThis.fetch;
  const pageData = {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            id: "6718335390845095173",
            desc: "No captions fixture",
            author: { uniqueId: "scout2015" },
            video: { subtitleInfos: [] },
          },
        },
      },
    },
  };

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    assert.ok(requestUrl.startsWith("https://www.tiktok.com/"));
    return makeJsonResponse(`
      <html>
        <body>
          <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(pageData)}</script>
        </body>
      </html>
    `, { url: "https://www.tiktok.com/@scout2015/video/6718335390845095173" });
  };

  try {
    const result = await extractTikTok("https://www.tiktok.com/@scout2015/video/6718335390845095173");

    assert.equal(result.url, "https://www.tiktok.com/@scout2015/video/6718335390845095173");
    assert.equal(result.hasTranscript, false);
    assert.equal(result.transcript, "");
    assert.equal(result.wordCount, 0);
    assert.deepEqual(result.metadata, {
      user: "scout2015",
      videoId: "6718335390845095173",
      description: "No captions fixture",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractArticle parses readable HTML into markdown", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://news.example.com/story");
    assert.equal(options.headers.Accept, "text/html");
    return makeJsonResponse(`
      <!doctype html>
      <html>
        <head>
          <title>Fixture Article</title>
          <meta name="author" content="Ada Writer">
          <meta property="og:site_name" content="Example News">
          <meta name="description" content="Fixture article excerpt.">
        </head>
        <body>
          <article>
            <h1>Fixture Article</h1>
            <p>This article has enough readable body copy for Readability to keep it as the primary story content.</p>
            <p><strong>Second paragraph</strong> keeps markdown formatting and removes media.</p>
            <img src="/tracking-pixel.png" alt="tracking pixel">
          </article>
        </body>
      </html>
    `, { url: "https://news.example.com/story" });
  };

  try {
    const result = await extractArticle("https://news.example.com/story");

    assert.equal(result.url, "https://news.example.com/story");
    assert.equal(result.title, "Fixture Article");
    assert.equal(result.author, "Ada Writer");
    assert.equal(result.siteName, "Example News");
    assert.equal(result.domain, "news.example.com");
    assert.match(result.excerpt, /Fixture article excerpt/);
    assert.match(result.content, /This article has enough readable body copy/);
    assert.match(result.content, /\*\*Second paragraph\*\*/);
    assert.doesNotMatch(result.content, /tracking-pixel/);
    assert.ok(result.wordCount > 15);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractLinks collects unique categorized page links and CSV output", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options = {}) => {
    assert.equal(String(url), "https://example.com/page");
    assert.equal(options.headers.Accept, "text/html,application/xhtml+xml");
    return makeJsonResponse(`
      <!doctype html>
      <html>
        <body>
          <a href="/about">About us</a>
          <a href="/contact">Contact</a>
          <a href="/pricing">Pricing</a>
          <a href="/about">About duplicate</a>
          <a href="/files/report.pdf">Annual Report</a>
          <a href="https://youtu.be/abcdefghijk">Demo Video</a>
          <a href="https://external.example.org/story">External Story</a>
          <a href="mailto:hello@example.com">Email</a>
          <a href="javascript:void(0)">Ignored JavaScript</a>
        </body>
      </html>
    `, {
      url: "https://example.com/page",
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  try {
    const result = await extractLinks("https://example.com/page", 20);

    assert.equal(result.url, "https://example.com/page");
    assert.equal(result.totalLinks, 6);
    assert.deepEqual(result.categories, {
      about: 1,
      contact: 1,
      document: 1,
      external: 1,
      internal: 1,
      video: 1,
    });
    assert.deepEqual(
      result.links.map((link) => link.category),
      ["about", "contact", "document", "external", "internal", "video"]
    );
    assert.equal(result.links.filter((link) => link.url === "https://example.com/about").length, 1);
    assert.match(result.csv, /^"Title","URL","Domain","Category","Original Href"/);
    assert.match(result.csv, /"Annual Report","https:\/\/example.com\/files\/report.pdf","example.com","document","\/files\/report.pdf"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractGitHub extracts repository README and metadata", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl === "https://api.github.com/repos/acme/widget") {
      return makeJsonResponse({
        full_name: "acme/widget",
        description: "Widget toolkit",
        html_url: "https://github.com/acme/widget",
        default_branch: "main",
        stargazers_count: 42,
        forks_count: 7,
        open_issues_count: 3,
        language: "TypeScript",
        topics: ["widgets", "toolkit"],
      }, {
        headers: { "content-type": "application/json" },
      });
    }

    if (requestUrl === "https://raw.githubusercontent.com/acme/widget/main/README.md") {
      return makeJsonResponse("# Widget\n\nThis README documents the widget toolkit.", {
        headers: { "content-type": "text/markdown" },
      });
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await extractGitHub("https://github.com/acme/widget");

    assert.equal(result.platform, "github");
    assert.equal(result.kind, "repository");
    assert.equal(result.status, "success");
    assert.equal(result.title, "acme/widget");
    assert.match(result.content, /Widget toolkit/);
    assert.match(result.content, /This README documents/);
    assert.equal(result.metadata.defaultBranch, "main");
    assert.equal(result.metadata.stars, 42);
    assert.deepEqual(result.metadata.topics, ["widgets", "toolkit"]);
    assert.deepEqual(calls, [
      "https://api.github.com/repos/acme/widget",
      "https://raw.githubusercontent.com/acme/widget/main/README.md",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractGitHub classifies release binary assets without downloading them", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for binary assets");
  };

  try {
    const result = await extractGitHub("https://github.com/palmier-io/palmier-pro/releases/latest/download/PalmierPro.dmg");

    assert.equal(result.platform, "github");
    assert.equal(result.kind, "binary_asset");
    assert.equal(result.status, "unsupported_binary");
    assert.match(result.content, /Unsupported binary GitHub asset/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractBatch routes URLs, dedupes fetches, and writes output artifacts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const outputDir = await mkdtemp(join(tmpdir(), "content-extractor-batch-"));

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl === "https://news.example.com/story") {
      assert.equal(options.headers.Accept, "text/html");
      return makeJsonResponse(`
        <!doctype html>
        <html>
          <head><title>Batch Article</title></head>
          <body>
            <article>
              <h1>Batch Article</h1>
              <p>This batch article has enough readable body copy for extraction to succeed.</p>
              <p>The second paragraph proves the article extractor was routed by the batch tool.</p>
            </article>
          </body>
        </html>
      `, { url: "https://news.example.com/story" });
    }

    if (requestUrl === "https://api.github.com/repos/acme/widget") {
      return makeJsonResponse({
        full_name: "acme/widget",
        description: "Widget toolkit",
        html_url: "https://github.com/acme/widget",
        default_branch: "main",
        stargazers_count: 1,
        forks_count: 0,
        open_issues_count: 0,
        language: "TypeScript",
        topics: [],
      });
    }

    if (requestUrl === "https://raw.githubusercontent.com/acme/widget/main/README.md") {
      return makeJsonResponse("# Widget\n\nReadme body.");
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await extractBatch({
      output_dir: outputDir,
      max_concurrency: 1,
      items: [
        { id: "article-1", url: "https://news.example.com/story", metadata: { source: "newsletter", profile: "ai" } },
        { id: "article-duplicate", url: "https://news.example.com/story", metadata: { source: "newsletter", profile: "finance" } },
        { id: "github-1", url: "https://github.com/acme/widget", metadata: { source: "newsletter" } },
      ],
    });

    assert.equal(result.status, "complete");
    assert.equal(result.totalRows, 3);
    assert.equal(result.uniqueUrls, 2);
    assert.deepEqual(result.statusCounts, { success: 2 });
    assert.equal(result.results.length, 2);
    assert.equal(result.mentions.length, 3);
    assert.ok(result.manifestPath.endsWith("batch_manifest.json"));
    assert.ok(result.reportCsvPath.endsWith("batch_report.csv"));
    assert.ok(result.resultsJsonlPath.endsWith("batch_results.jsonl"));

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.totalRows, 3);
    assert.equal(manifest.uniqueUrls, 2);

    const report = await readFile(result.reportCsvPath, "utf8");
    assert.match(report, /article-duplicate/);
    assert.match(report, /github/);

    assert.equal(calls.filter((url) => url === "https://news.example.com/story").length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractBatch writes per-link artifact folders and classifies blocked failures", async () => {
  const originalFetch = globalThis.fetch;
  const outputDir = await mkdtemp(join(tmpdir(), "content-extractor-batch-artifacts-"));

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);

    if (requestUrl === "https://blocked.example.com/story") {
      return makeJsonResponse("<html>challenge</html>", {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        url: requestUrl,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      });
    }

    if (requestUrl === "https://limited.example.com/story") {
      return makeJsonResponse("Edge: Too Many Requests", {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        url: requestUrl,
        headers: { "content-type": "text/html" },
      });
    }

    if (requestUrl === "https://overflow.example.com/story") {
      const error = new TypeError("fetch failed");
      error.cause = { code: "UND_ERR_HEADERS_OVERFLOW", message: "Headers Overflow Error" };
      throw error;
    }

    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await extractBatch({
      output_dir: outputDir,
      max_concurrency: 1,
      items: [
        { id: "openai-story", url: "https://blocked.example.com/story", metadata: { source: "newsletter" } },
        { id: "yahoo-story", url: "https://limited.example.com/story", metadata: { source: "newsletter" } },
        { id: "overflow-story", url: "https://overflow.example.com/story", metadata: { source: "newsletter" } },
      ],
    });

    assert.deepEqual(result.statusCounts, { blocked: 1, rate_limited: 1, fetch_failed: 1 });
    assert.equal(result.results.length, 3);

    const blocked = result.results.find((item) => item.url === "https://blocked.example.com/story");
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.artifactDir.endsWith("/links/openai-story"));
    assert.ok(blocked.errorPath.endsWith("/links/openai-story/error.json"));

    const rateLimited = result.results.find((item) => item.url === "https://limited.example.com/story");
    assert.equal(rateLimited.status, "rate_limited");
    assert.ok(rateLimited.errorPath.endsWith("/links/yahoo-story/error.json"));

    const fetchFailed = result.results.find((item) => item.url === "https://overflow.example.com/story");
    assert.equal(fetchFailed.status, "fetch_failed");
    assert.match(fetchFailed.error, /UND_ERR_HEADERS_OVERFLOW/);

    const source = JSON.parse(await readFile(join(outputDir, "links", "openai-story", "source.json"), "utf8"));
    assert.equal(source.id, "openai-story");
    assert.equal(source.normalizedUrl, "https://blocked.example.com/story");

    const error = JSON.parse(await readFile(join(outputDir, "links", "openai-story", "error.json"), "utf8"));
    assert.equal(error.status, "blocked");
    assert.match(error.error, /HTTP 403/);

    const report = await readFile(result.reportCsvPath, "utf8");
    assert.match(report.split("\n")[0], /artifact_dir/);
    assert.match(report.split("\n")[0], /error_path/);
    assert.match(report, /links\/openai-story/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractBatch captures a browser screenshot for blocked URLs when Playwright is available", async () => {
  const originalFetch = globalThis.fetch;
  const originalPlaywrightBin = process.env.RUDI_PLAYWRIGHT_BIN;
  const originalTesseractBin = process.env.RUDI_TESSERACT_BIN;
  const outputDir = await mkdtemp(join(tmpdir(), "content-extractor-browser-fallback-"));
  const binDir = await mkdtemp(join(tmpdir(), "content-extractor-playwright-bin-"));
  const playwrightBin = join(binDir, "playwright");
  const tesseractBin = join(binDir, "tesseract");

  await writeFile(playwrightBin, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const outputPath = args[args.length - 1];
writeFileSync(outputPath, "fake png");
`, "utf8");
  await chmod(playwrightBin, 0o755);
  await writeFile(tesseractBin, `#!/usr/bin/env node
process.stdout.write("Article headline\\nThis rendered article page contains enough body text to classify the browser screenshot as content. It includes multiple sentences about the topic, context for the reader, and visible article copy from the body of the page. The classifier should treat this page as content-bearing evidence.");
`, "utf8");
  await chmod(tesseractBin, 0o755);

  process.env.RUDI_PLAYWRIGHT_BIN = playwrightBin;
  process.env.RUDI_TESSERACT_BIN = tesseractBin;
  globalThis.fetch = async (url) => makeJsonResponse("<html>challenge</html>", {
    ok: false,
    status: 403,
    statusText: "Forbidden",
    url: String(url),
    headers: { "content-type": "text/html" },
  });

  try {
    const result = await extractBatch({
      output_dir: outputDir,
      max_concurrency: 1,
      browser_fallback: true,
      browser_timeout_ms: 5000,
      items: [
        { id: "blocked-story", url: "https://blocked.example.com/story", metadata: { source: "newsletter" } },
      ],
    });

    assert.deepEqual(result.statusCounts, { browser_captured: 1 });
    assert.equal(result.results[0].status, "browser_captured");
    assert.equal(result.results[0].originalStatus, "blocked");
    assert.ok(result.results[0].screenshotPath.endsWith("/links/blocked-story/page.png"));
    assert.equal(await readFile(result.results[0].screenshotPath, "utf8"), "fake png");

    const report = await readFile(result.reportCsvPath, "utf8");
    assert.match(report.split("\n")[0], /screenshot_path/);
    assert.match(report, /browser_captured/);

    const resultJson = JSON.parse(await readFile(join(outputDir, "links", "blocked-story", "result.json"), "utf8"));
    assert.equal(resultJson.status, "browser_captured");
    assert.equal(resultJson.browserFallback.status, "captured");
    assert.equal(resultJson.browserFallback.classification, "content");
    assert.ok(resultJson.browserFallback.textPath.endsWith("/links/blocked-story/browser_text.txt"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPlaywrightBin === undefined) {
      delete process.env.RUDI_PLAYWRIGHT_BIN;
    } else {
      process.env.RUDI_PLAYWRIGHT_BIN = originalPlaywrightBin;
    }
    if (originalTesseractBin === undefined) {
      delete process.env.RUDI_TESSERACT_BIN;
    } else {
      process.env.RUDI_TESSERACT_BIN = originalTesseractBin;
    }
  }
});

test("extractBatch classifies browser fallback bot walls instead of treating any screenshot as captured content", async () => {
  const originalFetch = globalThis.fetch;
  const originalPlaywrightBin = process.env.RUDI_PLAYWRIGHT_BIN;
  const originalTesseractBin = process.env.RUDI_TESSERACT_BIN;
  const outputDir = await mkdtemp(join(tmpdir(), "content-extractor-browser-blocked-"));
  const binDir = await mkdtemp(join(tmpdir(), "content-extractor-browser-blocked-bin-"));
  const playwrightBin = join(binDir, "playwright");
  const tesseractBin = join(binDir, "tesseract");

  await writeFile(playwrightBin, `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const outputPath = args[args.length - 1];
writeFileSync(outputPath, "fake png");
`, "utf8");
  await chmod(playwrightBin, 0o755);
  await writeFile(tesseractBin, `#!/usr/bin/env node
process.stdout.write("Just a moment... Performing security verification. This website uses a security service to protect against malicious bots.");
`, "utf8");
  await chmod(tesseractBin, 0o755);

  process.env.RUDI_PLAYWRIGHT_BIN = playwrightBin;
  process.env.RUDI_TESSERACT_BIN = tesseractBin;
  globalThis.fetch = async (url) => makeJsonResponse("<html>challenge</html>", {
    ok: false,
    status: 403,
    statusText: "Forbidden",
    url: String(url),
    headers: { "content-type": "text/html" },
  });

  try {
    const result = await extractBatch({
      output_dir: outputDir,
      max_concurrency: 1,
      browser_fallback: true,
      browser_timeout_ms: 5000,
      items: [
        { id: "bot-wall-story", url: "https://blocked.example.com/story", metadata: { source: "newsletter" } },
      ],
    });

    assert.deepEqual(result.statusCounts, { browser_blocked: 1 });
    assert.equal(result.results[0].status, "browser_blocked");
    assert.equal(result.results[0].originalStatus, "blocked");
    assert.ok(result.results[0].screenshotPath.endsWith("/links/bot-wall-story/page.png"));

    const report = await readFile(result.reportCsvPath, "utf8");
    assert.match(report, /browser_blocked/);

    const resultJson = JSON.parse(await readFile(join(outputDir, "links", "bot-wall-story", "result.json"), "utf8"));
    assert.equal(resultJson.status, "browser_blocked");
    assert.equal(resultJson.browserFallback.status, "captured");
    assert.equal(resultJson.browserFallback.classification, "blocked");
    assert.match(resultJson.browserFallback.textSample, /security verification/i);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPlaywrightBin === undefined) {
      delete process.env.RUDI_PLAYWRIGHT_BIN;
    } else {
      process.env.RUDI_PLAYWRIGHT_BIN = originalPlaywrightBin;
    }
    if (originalTesseractBin === undefined) {
      delete process.env.RUDI_TESSERACT_BIN;
    } else {
      process.env.RUDI_TESSERACT_BIN = originalTesseractBin;
    }
  }
});

test("extractArticle suppresses stylesheet parser diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errors = [];

  globalThis.fetch = async (url) => makeJsonResponse(`
    <html>
      <head>
        <title>Modern CSS Article</title>
        <style>
          @layer components {
            .card {
              color: red;
              .nested { color: blue; }
            }
          }
        </style>
      </head>
      <body>
        <article>
          <h1>Modern CSS Article</h1>
          <p>This story has enough body copy for readability extraction.</p>
          <p>The parser should ignore stylesheet diagnostics entirely.</p>
        </article>
      </body>
    </html>
  `, {
    url: String(url),
    headers: { "content-type": "text/html" },
  });
  console.error = (...args) => errors.push(args.map(String).join(" "));

  try {
    const result = await extractArticle("https://example.com/modern-css");

    assert.equal(result.title, "Modern CSS Article");
    assert.equal(errors.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("extractReddit rejects non-Reddit URLs before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  };

  try {
    await assert.rejects(
      () => extractReddit("https://example.com/r/test/comments/abc/post/"),
      /Reddit extractor requires/
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function oldRedditHtml() {
  return `<!doctype html>
<html>
  <body>
    <div class="thing link" data-author="htmlposter" data-subreddit="redditdev" data-score="12" data-permalink="/r/redditdev/comments/abc/html_post/" data-url="/r/redditdev/comments/abc/html_post/">
      <a class="title">HTML fallback title</a>
      <p class="tagline"><time datetime="2024-01-02T03:04:05+00:00">posted</time></p>
      <a class="comments">4 comments</a>
      <div class="usertext-body"><div class="md"><p>HTML post body</p></div></div>
    </div>
    <div class="thing comment" data-author="commenter1">
      <div class="entry">
        <span class="score unvoted">9 points</span>
        <div class="usertext-body"><div class="md"><p>First HTML comment</p></div></div>
      </div>
      <div class="child">
        <div class="sitetable">
          <div class="thing comment" data-author="reply1">
            <div class="entry">
              <span class="score unvoted">3 points</span>
              <div class="usertext-body"><div class="md"><p>First HTML reply</p></div></div>
            </div>
            <div class="child">
              <div class="sitetable">
                <div class="thing comment" data-author="grandchild1">
                  <div class="entry">
                    <span class="score unvoted">1 point</span>
                    <div class="usertext-body"><div class="md"><p>Nested grandchild reply</p></div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="thing comment" data-author="commenter2">
      <div class="entry">
        <span class="score unvoted">5 points</span>
        <div class="usertext-body"><div class="md"><p>Second HTML comment</p></div></div>
      </div>
    </div>
  </body>
</html>`;
}

test("extractReddit falls back to old Reddit HTML when public JSON is blocked without OAuth", async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.REDDIT_BEARER_TOKEN;
  const originalClientId = process.env.REDDIT_CLIENT_ID;
  const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const calls = [];

  delete process.env.REDDIT_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.startsWith("https://old.reddit.com/")) {
      return makeJsonResponse(oldRedditHtml(), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }
    return makeJsonResponse({}, { ok: false, status: 403, statusText: "Blocked" });
  };

  try {
    const result = await extractReddit("https://www.reddit.com/r/redditdev/comments/abc/html_post/", 1);

    assert.equal(result.title, "HTML fallback title");
    assert.equal(result.author, "u/htmlposter");
    assert.equal(result.subreddit, "redditdev");
    assert.equal(result.metadata.retrievalMethod, "old_reddit_html");
    assert.equal(result.metadata.extractedTopComments, 1);
    assert.equal(result.metadata.extractedComments, 2);
    assert.equal(result.metadata.maxDepth, 2);
    assert.match(result.content, /HTML post body/);
    assert.match(result.content, /First HTML comment/);
    assert.match(result.content, /First HTML reply/);
    assert.doesNotMatch(result.content, /Nested grandchild reply/);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith("https://old.reddit.com/"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBearer === undefined) {
      delete process.env.REDDIT_BEARER_TOKEN;
    } else {
      process.env.REDDIT_BEARER_TOKEN = originalBearer;
    }
    if (originalClientId === undefined) {
      delete process.env.REDDIT_CLIENT_ID;
    } else {
      process.env.REDDIT_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
  }
});

test("extractReddit prefers old Reddit HTML before public JSON for no-credential extraction", async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.REDDIT_BEARER_TOKEN;
  const originalClientId = process.env.REDDIT_CLIENT_ID;
  const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;
  const calls = [];

  delete process.env.REDDIT_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);
    if (requestUrl.startsWith("https://old.reddit.com/")) {
      return makeJsonResponse(oldRedditHtml(), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    }
    throw new Error(`unexpected non-HTML request: ${requestUrl}`);
  };

  try {
    const result = await extractReddit("https://www.reddit.com/r/redditdev/comments/abc/html_post/", 1);

    assert.equal(result.metadata.retrievalMethod, "old_reddit_html");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith("https://old.reddit.com/"));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBearer === undefined) {
      delete process.env.REDDIT_BEARER_TOKEN;
    } else {
      process.env.REDDIT_BEARER_TOKEN = originalBearer;
    }
    if (originalClientId === undefined) {
      delete process.env.REDDIT_CLIENT_ID;
    } else {
      process.env.REDDIT_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
  }
});

test("extractReddit maxDepth 1 includes only top-level comments", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => makeJsonResponse(oldRedditHtml(), {
    headers: { "content-type": "text/html; charset=UTF-8" },
  });

  try {
    const result = await extractReddit("https://www.reddit.com/r/redditdev/comments/abc/html_post/", 1, 1);

    assert.equal(result.metadata.extractedTopComments, 1);
    assert.equal(result.metadata.extractedComments, 1);
    assert.equal(result.metadata.maxDepth, 1);
    assert.match(result.content, /First HTML comment/);
    assert.doesNotMatch(result.content, /First HTML reply/);
    assert.doesNotMatch(result.content, /Nested grandchild reply/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractReddit maxDepth 3 includes grandchildren replies", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => makeJsonResponse(oldRedditHtml(), {
    headers: { "content-type": "text/html; charset=UTF-8" },
  });

  try {
    const result = await extractReddit("https://www.reddit.com/r/redditdev/comments/abc/html_post/", 1, 3);

    assert.equal(result.metadata.extractedTopComments, 1);
    assert.equal(result.metadata.extractedComments, 3);
    assert.equal(result.metadata.maxDepth, 3);
    assert.match(result.content, /First HTML comment/);
    assert.match(result.content, /First HTML reply/);
    assert.match(result.content, /Nested grandchild reply/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractReddit accepts mobile Reddit links through the old HTML path", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    assert.ok(requestUrl.startsWith("https://old.reddit.com/r/redditdev/comments/abc/html_post/"));
    return makeJsonResponse(oldRedditHtml(), {
      headers: { "content-type": "text/html; charset=UTF-8" },
    });
  };

  try {
    const result = await extractReddit("https://m.reddit.com/r/redditdev/comments/abc/html_post/?share_id=mobile", 1);

    assert.equal(result.metadata.retrievalMethod, "old_reddit_html");
    assert.equal(result.title, "HTML fallback title");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extractReddit explains failure when both public JSON and old Reddit HTML are blocked", async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.REDDIT_BEARER_TOKEN;
  const originalClientId = process.env.REDDIT_CLIENT_ID;
  const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;

  delete process.env.REDDIT_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  globalThis.fetch = async () => makeJsonResponse({}, { ok: false, status: 403, statusText: "Blocked" });

  try {
    await assert.rejects(
      () => extractReddit("https://www.reddit.com/r/test/comments/abc/post/"),
      /old Reddit HTML fallback failed/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBearer === undefined) {
      delete process.env.REDDIT_BEARER_TOKEN;
    } else {
      process.env.REDDIT_BEARER_TOKEN = originalBearer;
    }
    if (originalClientId === undefined) {
      delete process.env.REDDIT_CLIENT_ID;
    } else {
      process.env.REDDIT_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
  }
});

test("extractReddit bounds requested comments to the public stack limit", async () => {
  const originalFetch = globalThis.fetch;
  const originalBearer = process.env.REDDIT_BEARER_TOKEN;
  const originalClientId = process.env.REDDIT_CLIENT_ID;
  const originalClientSecret = process.env.REDDIT_CLIENT_SECRET;

  delete process.env.REDDIT_BEARER_TOKEN;
  delete process.env.REDDIT_CLIENT_ID;
  delete process.env.REDDIT_CLIENT_SECRET;

  globalThis.fetch = async (url) => {
    const requestUrl = String(url);
    assert.match(requestUrl, /limit=500/);
    assert.match(requestUrl, /raw_json=1/);
    return makeJsonResponse(redditPayload(105));
  };

  try {
    const result = await extractReddit("https://old.reddit.com/r/test/comments/abc/post/?utm_source=share", 500);

    assert.equal(result.url, "https://www.reddit.com/r/test/comments/abc/post/");
    assert.equal(result.metadata.retrievalMethod, "public_json");
    assert.equal(result.metadata.extractedComments, 100);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBearer === undefined) {
      delete process.env.REDDIT_BEARER_TOKEN;
    } else {
      process.env.REDDIT_BEARER_TOKEN = originalBearer;
    }
    if (originalClientId === undefined) {
      delete process.env.REDDIT_CLIENT_ID;
    } else {
      process.env.REDDIT_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.REDDIT_CLIENT_SECRET;
    } else {
      process.env.REDDIT_CLIENT_SECRET = originalClientSecret;
    }
  }
});
