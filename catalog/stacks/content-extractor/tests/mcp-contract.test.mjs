import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

async function collectStackFiles(directoryUrl, files = []) {
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      await collectStackFiles(entryUrl, files);
    } else {
      files.push(entryUrl);
    }
  }
  return files;
}

const EXPECTED_TOOLS = [
  "extract_youtube",
  "extract_reddit",
  "extract_tiktok",
  "extract_article",
  "extract_github",
  "extract_links",
  "extract_batch",
];

const EXPECTED_OPTIONAL_SECRETS = [
  "SUPA_DATA_API",
  "REDDIT_BEARER_TOKEN",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
];

test("content-extractor manifest declares the public MCP tool surface", async () => {
  const manifest = await readJson("../manifest.json");

  assert.deepEqual(manifest.provides.tools, EXPECTED_TOOLS);
});

test("content-extractor manifest declares browser fallback binaries", async () => {
  const manifest = await readJson("../manifest.json");

  assert.deepEqual(manifest.requires.binaries, ["playwright", "tesseract"]);
});

test("content-extractor manifest declares optional extractor secrets without requiring them", async () => {
  const manifest = await readJson("../manifest.json");

  const secrets = new Map(manifest.requires.secrets.map((secret) => [secret.key, secret]));

  for (const key of EXPECTED_OPTIONAL_SECRETS) {
    assert.equal(secrets.get(key)?.required, false, `${key} should be optional in manifest.json`);
  }

  assert.equal(secrets.get("SUPA_DATA_API")?.helpUrl, "https://supadata.ai");
});

test("content-extractor stack files do not reference private local paths", async () => {
  const files = await collectStackFiles(new URL("../", import.meta.url));
  const privateExtractorPath = ["/Users", "example", "dev", "tools", "private"].join("/");

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.equal(content.includes(privateExtractorPath), false, `${file.pathname} contains a private extractor path`);
  }
});

test("extract_reddit MCP contract exposes and forwards comment depth", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /max_depth/);
  assert.match(source, /Maximum comment depth/);
  assert.match(source, /extractReddit\(args\?\.url as string, args\?\.max_comments as number, args\?\.max_depth as number\)/);
});

test("extract_youtube MCP contract does not overpromise no-key transcript fallback", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /Supadata is recommended for reliable transcripts/);
  assert.match(source, /hasTranscript=false/);
});

test("extract_batch MCP contract accepts csv, urls, and metadata items", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /extract_batch/);
  assert.match(source, /csv_path/);
  assert.match(source, /url_column/);
  assert.match(source, /items/);
  assert.match(source, /max_concurrency/);
  assert.match(source, /extractBatch\(args as any\)/);
});

test("extract_batch MCP contract exposes Playwright browser fallback controls", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /browser_fallback/);
  assert.match(source, /browser_timeout_ms/);
  assert.match(source, /browser_fallback_statuses/);
  assert.match(source, /Playwright browser screenshot fallback/);
});

test("extract_github MCP contract is exposed as a routed extractor", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

  assert.match(source, /extract_github/);
  assert.match(source, /Extract GitHub repository, file, gist, or release content/);
  assert.match(source, /extractGitHub\(args\?\.url as string\)/);
  assert.match(source, /github\.com/);
});
