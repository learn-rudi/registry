#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STACK_ROOT = dirname(dirname(SCRIPT_PATH));

export const SUPPORTED_PROVIDERS = [
  "fetch",
  "rudi_playwright",
  "playwright_chromium_cli",
  "playwright_chrome_channel",
  "user_chrome_osascript",
];

const DEFAULT_PROVIDERS = [
  "fetch",
  "rudi_playwright",
  "playwright_chromium_cli",
  "playwright_chrome_channel",
];

const STATUS_PRIORITY = new Map([
  ["success", 0],
  ["captured_unclassified", 1],
  ["fetched_unclassified", 2],
  ["blocked", 3],
  ["timeout", 4],
  ["unavailable", 5],
  ["failed", 6],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function quoteAppleScriptString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function truncateText(value, maxLength = 1200) {
  if (!value) return "";
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function errorMessage(error) {
  const message = error?.message ? String(error.message) : String(error);
  const stderr = typeof error?.stderr === "string" && error.stderr.trim() ? `: ${error.stderr.trim()}` : "";
  return truncateText(`${message}${stderr}`, 1500);
}

function safeFilename(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "probe";
}

function requireHttpUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error("url must be a non-empty string");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("url must be a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http or https");
  }

  return parsed.toString();
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function includesExpected(value, expectedText) {
  if (!expectedText) return false;
  return normalizeText(value).includes(normalizeText(expectedText));
}

export function classifyProbeEvidence(evidence) {
  const title = evidence?.title || "";
  const textSample = evidence?.textSample || "";
  const error = evidence?.error || "";
  const httpStatus = Number(evidence?.httpStatus);

  if (includesExpected(title, evidence?.expectedText) || includesExpected(textSample, evidence?.expectedText)) {
    return "success";
  }

  const combined = `${title}\n${textSample}\n${error}`;
  if (/timeout|timed out|timeout_after/i.test(combined)) return "timeout";
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) return httpStatus === 429 ? "blocked" : "blocked";
  if (/just a moment|captcha|challenge|cloudflare|access denied|forbidden|too many requests|rate limit/i.test(combined)) {
    return "blocked";
  }

  if (Number(evidence?.screenshotBytes) > 0) return "captured_unclassified";
  if (Number.isFinite(httpStatus) && httpStatus >= 200 && httpStatus < 400) return "fetched_unclassified";
  if (evidence?.unavailable) return "unavailable";
  return error ? "failed" : "failed";
}

export function parseProviders(rawProviders) {
  const values = rawProviders
    ? String(rawProviders).split(",").map((value) => value.trim()).filter(Boolean)
    : DEFAULT_PROVIDERS;
  const unique = [];

  for (const provider of values) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      throw new Error(`Unsupported provider: ${provider}. Supported providers: ${SUPPORTED_PROVIDERS.join(", ")}`);
    }
    if (!unique.includes(provider)) unique.push(provider);
  }

  return unique;
}

export function summarizeBestProvider(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  return [...results].sort((left, right) => {
    const leftRank = STATUS_PRIORITY.get(left.status) ?? 99;
    const rightRank = STATUS_PRIORITY.get(right.status) ?? 99;
    return leftRank - rightRank;
  })[0];
}

function extractHtmlTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return match[1].replace(/\s+/g, " ").trim();
}

async function fileInfo(path) {
  const stats = await stat(path);
  const bytes = await readFile(path);
  return {
    path,
    bytes: stats.size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function findExecutableOnPath(name) {
  for (const entry of (process.env.PATH || "").split(":").filter(Boolean)) {
    const candidate = join(entry, name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function resolvePlaywrightBinary() {
  const candidates = [
    process.env.RUDI_PLAYWRIGHT_BIN,
    process.env.PLAYWRIGHT_BIN,
    join(homedir(), ".rudi", "bins", "playwright"),
    findExecutableOnPath("playwright"),
  ].filter(Boolean);

  return candidates.find((candidate) => isFile(candidate));
}

async function withElapsed(provider, fn) {
  const startedAt = new Date();
  const startMs = Date.now();
  try {
    const result = await fn();
    return {
      provider,
      startedAt: startedAt.toISOString(),
      elapsedMs: Date.now() - startMs,
      ...result,
    };
  } catch (error) {
    return {
      provider,
      startedAt: startedAt.toISOString(),
      elapsedMs: Date.now() - startMs,
      status: classifyProbeEvidence({ error: errorMessage(error) }),
      error: errorMessage(error),
    };
  }
}

async function runFetchProvider(context) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), context.timeoutMs);

  try {
    const response = await fetch(context.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ContentExtractorProbe/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    const body = await response.text();
    const evidence = {
      finalUrl: response.url,
      httpStatus: response.status,
      ok: response.ok,
      title: extractHtmlTitle(body),
      textSample: body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000),
      expectedText: context.expectedText,
    };

    return {
      ...evidence,
      status: classifyProbeEvidence(evidence),
    };
  } catch (error) {
    const message = error?.name === "AbortError" ? `timeout after ${context.timeoutMs}ms` : errorMessage(error);
    return {
      status: classifyProbeEvidence({ error: message }),
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runRudiPlaywrightProvider(context) {
  const distPath = join(STACK_ROOT, "dist", "index.js");
  if (!existsSync(distPath)) {
    return {
      status: "unavailable",
      unavailable: true,
      error: "dist/index.js is missing; run npm run build before this provider",
    };
  }

  const { extractBatch } = await import(`file://${distPath}`);
  const providerDir = join(context.outputDir, "providers", "rudi_playwright");
  await mkdir(providerDir, { recursive: true });
  const result = await extractBatch({
    output_dir: providerDir,
    max_concurrency: 1,
    browser_fallback: true,
    browser_timeout_ms: context.timeoutMs,
    items: [{ id: "probe", url: context.url, metadata: { provider: "rudi_playwright" } }],
  });

  const first = result.results[0];
  const screenshot = first?.screenshotPath && existsSync(first.screenshotPath)
    ? await fileInfo(first.screenshotPath)
    : undefined;
  const evidence = {
    finalUrl: first?.url,
    title: first?.title,
    textSample: first?.content || "",
    expectedText: context.expectedText,
    screenshotBytes: screenshot?.bytes,
    error: first?.error,
  };

  return {
    status: classifyProbeEvidence(evidence),
    batchStatus: first?.status,
    originalStatus: first?.originalStatus,
    finalUrl: first?.url,
    title: first?.title,
    error: first?.error,
    screenshot,
    artifactDir: first?.artifactDir,
    reportCsvPath: result.reportCsvPath,
  };
}

async function runPlaywrightCliProvider(context, provider, argsForBrowser) {
  const binary = resolvePlaywrightBinary();
  if (!binary) {
    return {
      status: "unavailable",
      unavailable: true,
      error: "playwright binary not found",
    };
  }

  const screenshotPath = join(context.outputDir, "providers", provider, "page.png");
  await mkdir(dirname(screenshotPath), { recursive: true });
  await execFileAsync(binary, [
    "screenshot",
    ...argsForBrowser,
    "--timeout",
    String(context.timeoutMs),
    context.url,
    screenshotPath,
  ], {
    timeout: context.timeoutMs + 5000,
    maxBuffer: 1024 * 1024,
  });

  const screenshot = await fileInfo(screenshotPath);
  const evidence = {
    expectedText: context.expectedText,
    screenshotBytes: screenshot.bytes,
  };

  return {
    status: classifyProbeEvidence(evidence),
    binary,
    screenshot,
  };
}

async function runUserChromeOsascriptProvider(context) {
  if (process.platform !== "darwin") {
    return {
      status: "unavailable",
      unavailable: true,
      error: "user_chrome_osascript requires macOS",
    };
  }

  await execFileAsync("osascript", ["-e", `
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set URL of active tab of front window to ${quoteAppleScriptString(context.url)}
end tell
`], { timeout: 10_000 });
  await sleep(Math.min(Math.max(context.settleMs, 3000), 30_000));

  const titleResult = await execFileAsync("osascript", ["-e", 'tell application "Google Chrome" to get title of active tab of front window'], { timeout: 10_000 });
  const urlResult = await execFileAsync("osascript", ["-e", 'tell application "Google Chrome" to get URL of active tab of front window'], { timeout: 10_000 });
  const screenshotPath = join(context.outputDir, "providers", "user_chrome_osascript", "screen.png");
  await mkdir(dirname(screenshotPath), { recursive: true });
  await execFileAsync("screencapture", ["-x", screenshotPath], { timeout: 10_000 });

  const screenshot = await fileInfo(screenshotPath);
  const evidence = {
    expectedText: context.expectedText,
    finalUrl: urlResult.stdout.trim(),
    title: titleResult.stdout.trim(),
    screenshotBytes: screenshot.bytes,
  };

  return {
    status: classifyProbeEvidence(evidence),
    finalUrl: evidence.finalUrl,
    title: evidence.title,
    screenshot,
  };
}

async function runProvider(provider, context) {
  return withElapsed(provider, async () => {
    if (provider === "fetch") return runFetchProvider(context);
    if (provider === "rudi_playwright") return runRudiPlaywrightProvider(context);
    if (provider === "playwright_chromium_cli") return runPlaywrightCliProvider(context, provider, ["--browser", "chromium"]);
    if (provider === "playwright_chrome_channel") return runPlaywrightCliProvider(context, provider, ["--channel", "chrome"]);
    if (provider === "user_chrome_osascript") return runUserChromeOsascriptProvider(context);
    throw new Error(`Unsupported provider: ${provider}`);
  });
}

function parseArgs(argv) {
  const args = {
    providers: undefined,
    timeoutMs: 15_000,
    settleMs: 8_000,
    expectedText: "",
    outputDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--url") {
      args.url = next;
      index += 1;
    } else if (arg === "--providers") {
      args.providers = next;
      index += 1;
    } else if (arg === "--expected-text") {
      args.expectedText = next || "";
      index += 1;
    } else if (arg === "--output-dir") {
      args.outputDir = next;
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--settle-ms") {
      args.settleMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  return `Usage: node scripts/browser-provider-probe.mjs --url <http-url> [options]

Options:
  --providers <list>       Comma list: ${SUPPORTED_PROVIDERS.join(", ")}
  --expected-text <text>   Text/title that marks a provider as success
  --output-dir <dir>       Probe output directory
  --timeout-ms <ms>        Per-provider timeout, 1000-60000 (default: 15000)
  --settle-ms <ms>         User Chrome settle wait, 3000-30000 (default: 8000)
`;
}

export async function runProbe(options) {
  const url = requireHttpUrl(options.url);
  const providers = parseProviders(options.providers);
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.min(Math.max(Math.floor(options.timeoutMs), 1000), 60_000) : 15_000;
  const settleMs = Number.isFinite(options.settleMs) ? Math.min(Math.max(Math.floor(options.settleMs), 3000), 30_000) : 8_000;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = options.outputDir || join(STACK_ROOT, "output", "browser-provider-probes", `${stamp}-${safeFilename(basename(new URL(url).pathname) || "url")}`);
  await mkdir(outputDir, { recursive: true });

  const context = {
    url,
    expectedText: options.expectedText || "",
    outputDir,
    timeoutMs,
    settleMs,
  };
  const results = [];

  for (const provider of providers) {
    results.push(await runProvider(provider, context));
  }

  const report = {
    status: "complete",
    generatedAt: new Date().toISOString(),
    url,
    expectedText: context.expectedText,
    providers,
    outputDir,
    best: summarizeBestProvider(results),
    results,
  };
  const reportPath = join(outputDir, "probe_report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  report.reportPath = reportPath;
  return report;
}

if (process.argv[1] === SCRIPT_PATH) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (!args.url) throw new Error("--url is required");
    const report = await runProbe(args);
    process.stdout.write(`${JSON.stringify({
      reportPath: report.reportPath,
      best: report.best,
      results: report.results.map((result) => ({
        provider: result.provider,
        status: result.status,
        title: result.title,
        finalUrl: result.finalUrl,
        screenshotPath: result.screenshot?.path,
        screenshotBytes: result.screenshot?.bytes,
        error: result.error,
      })),
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exit(1);
  }
}
