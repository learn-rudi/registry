import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANUAL_ROOT = join(__dirname, "manual");
const SCANNER_PATH = join(__dirname, "tools", "agent-debt-scan.cjs");
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const MAX_MANUAL_CHARS = 200_000;

export const MANUAL_DOCUMENTS = [
  {
    id: "master-engineering-doctrine",
    filename: "01-Master-Engineering-Doctrine.txt",
    title: "Master Engineering Doctrine",
  },
  {
    id: "engineering-quick-reference",
    filename: "02-Engineering-Quick-Reference.txt",
    title: "Engineering Quick Reference",
  },
  {
    id: "testing-doctrine-source",
    filename: "03-Testing-Doctrine-Source.txt",
    title: "Testing Doctrine Source",
  },
  {
    id: "debugging-doctrine-source",
    filename: "04-Debugging-Doctrine-Source.txt",
    title: "Debugging Doctrine Source",
  },
  {
    id: "api-engineering-standard",
    filename: "05-API-Engineering-Standard.md",
    title: "API Engineering Standard",
  },
  {
    id: "security-engineering-standard",
    filename: "06-Security-Engineering-Standard.md",
    title: "Security Engineering Standard",
  },
  {
    id: "backend-application-engineering-standard",
    filename: "07-Backend-Application-Engineering-Standard.md",
    title: "Backend Application Engineering Standard",
  },
  {
    id: "infrastructure-and-deployment-engineering-standard",
    filename: "08-Infrastructure-and-Deployment-Engineering-Standard.md",
    title: "Infrastructure And Deployment Engineering Standard",
  },
  {
    id: "build-order-and-engineering-system",
    filename: "09-Build-Order-and-Engineering-System.md",
    title: "Build Order And Engineering System",
  },
  {
    id: "engineering-operating-manual-index",
    filename: "10-Engineering-Operating-Manual-Index.md",
    title: "Engineering Operating Manual Index",
  },
  {
    id: "agent-copilot-operating-standard",
    filename: "11-Agent-Copilot-Operating-Standard.md",
    title: "Agent Co-Pilot Operating Standard",
  },
];

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return nonEmptyString(value, label);
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function boundedInteger(value, label, defaults) {
  const { defaultValue, min, max } = defaults;
  if (value === undefined || value === null || value === "") return defaultValue;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function optionalStringArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => item.trim());
}

function resolveManualDocument(document) {
  const requested = nonEmptyString(document, "document");
  const normalized = requested.toLowerCase();
  const match = MANUAL_DOCUMENTS.find((item) => {
    return item.id === normalized || item.filename.toLowerCase() === normalized;
  });

  if (!match) {
    throw new Error(
      `Unknown manual document "${requested}". Use swe_manual_list for valid ids.`
    );
  }

  return match;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, maxChars),
    truncated: true,
  };
}

export async function listManualDocuments(options = {}) {
  const manualRoot = options.manualRoot || DEFAULT_MANUAL_ROOT;
  const documents = [];

  for (const item of MANUAL_DOCUMENTS) {
    const filePath = join(manualRoot, item.filename);
    const stat = await fs.stat(filePath);
    documents.push({
      id: item.id,
      title: item.title,
      filename: item.filename,
      bytes: stat.size,
    });
  }

  return { manualRoot, documents };
}

export async function readManualDocument(args = {}, options = {}) {
  assertPlainObject(args, "arguments");
  const manualRoot = options.manualRoot || DEFAULT_MANUAL_ROOT;
  const document = resolveManualDocument(args.document);
  const maxChars = boundedInteger(args.max_chars, "max_chars", {
    defaultValue: 50_000,
    min: 1,
    max: MAX_MANUAL_CHARS,
  });
  const filePath = join(manualRoot, document.filename);
  const content = await fs.readFile(filePath, "utf8");
  const truncated = truncateText(content, maxChars);

  return {
    document,
    max_chars: maxChars,
    truncated: truncated.truncated,
    content: truncated.text,
  };
}

export async function searchManual(args = {}, options = {}) {
  assertPlainObject(args, "arguments");
  const manualRoot = options.manualRoot || DEFAULT_MANUAL_ROOT;
  const query = nonEmptyString(args.query, "query").toLowerCase();
  const maxResults = boundedInteger(args.max_results, "max_results", {
    defaultValue: 20,
    min: 1,
    max: 100,
  });
  const documents = args.document
    ? [resolveManualDocument(args.document)]
    : MANUAL_DOCUMENTS;
  const matches = [];

  for (const document of documents) {
    const filePath = join(manualRoot, document.filename);
    const lines = (await fs.readFile(filePath, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.toLowerCase().includes(query)) continue;
      matches.push({
        document: document.id,
        filename: document.filename,
        line: index + 1,
        text: line.trim(),
      });
      if (matches.length >= maxResults) {
        return { query: args.query, max_results: maxResults, matches };
      }
    }
  }

  return { query: args.query, max_results: maxResults, matches };
}

export function buildDebtScanArgs(args = {}, options = {}) {
  assertPlainObject(args, "arguments");
  const scannerPath = options.scannerPath || SCANNER_PATH;
  const repo = resolve(nonEmptyString(args.repo, "repo"));

  if (!existsSync(repo)) {
    throw new Error(`repo does not exist: ${repo}`);
  }

  const commandArgs = [scannerPath, "--repo", repo];
  const addStringFlag = (flag, value, label) => {
    const parsed = optionalString(value, label);
    if (parsed) commandArgs.push(flag, parsed);
  };

  addStringFlag("--graph-root", args.graph_root, "graph_root");
  addStringFlag("--scope", args.scope, "scope");
  addStringFlag("--profile", args.profile, "profile");
  addStringFlag("--config", args.config, "config");
  addStringFlag("--layer", args.layer, "layer");
  addStringFlag("--changed-since", args.changed_since, "changed_since");
  addStringFlag("--severity", args.severity, "severity");

  for (const check of optionalStringArray(args.checks, "checks")) {
    commandArgs.push("--check", check);
  }
  for (const entrypoint of optionalStringArray(args.entrypoints, "entrypoints")) {
    commandArgs.push("--entrypoint", entrypoint);
  }
  for (const include of optionalStringArray(args.include, "include")) {
    commandArgs.push("--include", include);
  }
  for (const exclude of optionalStringArray(args.exclude, "exclude")) {
    commandArgs.push("--exclude", exclude);
  }

  const files = optionalStringArray(args.files, "files");
  if (files.length > 0) commandArgs.push("--files", files.join(","));

  const heuristics = optionalBoolean(args.heuristics, "heuristics");
  if (heuristics) commandArgs.push("--heuristics");

  const json = optionalBoolean(args.json, "json");
  if (json !== false) commandArgs.push("--json");

  return { repo, scannerPath, command: process.execPath, args: commandArgs };
}

export async function runDebtScan(args = {}, options = {}) {
  const plan = buildDebtScanArgs(args, options);
  const timeoutMs = boundedInteger(args.timeout_ms, "timeout_ms", {
    defaultValue: DEFAULT_TIMEOUT_MS,
    min: 1_000,
    max: 300_000,
  });
  const maxOutputChars = boundedInteger(args.max_output_chars, "max_output_chars", {
    defaultValue: DEFAULT_MAX_OUTPUT_CHARS,
    min: 1_000,
    max: 2_000_000,
  });

  return new Promise((resolvePromise) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.repo,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;

    const append = (current, chunk) => {
      if (current.length >= maxOutputChars) {
        outputTruncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > maxOutputChars) {
        outputTruncated = true;
        return next.slice(0, maxOutputChars);
      }
      return next;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: null,
        timed_out: timedOut,
        output_truncated: outputTruncated,
        stdout,
        stderr: stderr ? `${stderr}\n${error.message}` : error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exit_code: timedOut ? null : code,
        timed_out: timedOut,
        output_truncated: outputTruncated,
        stdout,
        stderr,
      });
    });
  });
}
