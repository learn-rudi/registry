#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_DEPTH = 8;
const MAX_FILE_BYTES = 512 * 1024;
const LARGE_FILE_LINES = 400;
const LARGE_FILE_BYTES = 20 * 1024;
const MIN_DUPLICATE_BLOCK_LENGTH = 80;

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "output",
  "outputs",
  "target",
  "vendor",
]);

const EXACT_INSTRUCTION_FILES = new Set([
  "AGENTS.md",
  "AGENTS.override.md",
  "CLAUDE.md",
  "GEMINI.md",
]);

const CONDITIONAL_WORKFLOW_PATTERN =
  /\b(api|database|debug|deploy|deployment|incident|migration|publish|publishing|release|security|test|testing|video|workflow)\b/i;

function usage() {
  return [
    "Usage: audit-agent-context.mjs [options]",
    "",
    "Options:",
    "  --root <path>        Repository or workspace root (default: current directory)",
    "  --format <format>    json or markdown (default: markdown)",
    `  --max-files <count>  Maximum instruction files to read (default: ${DEFAULT_MAX_FILES})`,
    `  --max-depth <count>  Maximum directory depth to traverse (default: ${DEFAULT_MAX_DEPTH})`,
    "  --help               Show this help",
  ].join("\n");
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(args) {
  const options = {
    root: process.cwd(),
    format: "markdown",
    maxFiles: DEFAULT_MAX_FILES,
    maxDepth: DEFAULT_MAX_DEPTH,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--root") {
      options.root = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--max-files") {
      options.maxFiles = parsePositiveInteger(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    if (arg === "--max-depth") {
      options.maxDepth = parsePositiveInteger(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!new Set(["json", "markdown"]).has(options.format)) {
    throw new Error("--format must be json or markdown");
  }
  return options;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isInstructionFile(relativePath, name) {
  if (EXACT_INSTRUCTION_FILES.has(name)) return true;
  return toPosix(relativePath) === ".github/copilot-instructions.md";
}

async function assertReadableRoot(rootInput) {
  const root = await fs.realpath(path.resolve(rootInput));
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) {
    throw new Error(`Audit root is not a directory: ${rootInput}`);
  }
  return root;
}

async function discoverInstructionFiles(root, maxDepth, maxFiles) {
  const discovered = [];
  let truncated = false;

  async function visit(directory, depth) {
    if (depth > maxDepth || truncated) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await visit(absolute, depth + 1);
        }
        if (truncated) return;
        continue;
      }
      if (!entry.isFile() || !isInstructionFile(relative, entry.name)) continue;
      if (discovered.length >= maxFiles) {
        truncated = true;
        return;
      }
      discovered.push({ absolute, relative: toPosix(relative) });
    }
  }

  await visit(root, 0);
  discovered.sort((left, right) => left.relative.localeCompare(right.relative));
  return { discovered, truncated };
}

function extractParagraphs(content) {
  return content
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(
      (paragraph) =>
        paragraph.length >= MIN_DUPLICATE_BLOCK_LENGTH &&
        paragraph.length <= 2_000 &&
        !paragraph.startsWith("#")
    );
}

function extractHostReferences(content) {
  const patterns = [
    ["Codex", /(?:\.codex\b|\bCODEX_HOME\b|\bCodex\b|\/(?:goal|review)\b)/giu],
    ["Claude", /(?:\.claude\b|\bCLAUDE_HOME\b|\bClaude Code\b)/giu],
  ];
  const references = [];
  for (const [host, pattern] of patterns) {
    const matches = [...content.matchAll(pattern)].map((match) => match[0]);
    const unique = [...new Set(matches.map((match) => match.toLowerCase()))];
    if (unique.length > 0) references.push({ host, matches: unique.sort() });
  }
  return references;
}

function extractConditionalCandidates(content) {
  const candidates = [];
  for (const line of content.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
    if (!match || !CONDITIONAL_WORKFLOW_PATTERN.test(match[2])) continue;
    candidates.push(match[2]);
  }
  return [...new Set(candidates)];
}

function buildDuplicateBlocks(files) {
  const occurrences = new Map();
  for (const file of files) {
    for (const paragraph of file.paragraphs) {
      const normalized = paragraph.toLowerCase();
      const existing = occurrences.get(normalized) ?? {
        excerpt: paragraph.slice(0, 180),
        files: new Set(),
      };
      existing.files.add(file.path);
      occurrences.set(normalized, existing);
    }
  }

  return [...occurrences.values()]
    .filter((entry) => entry.files.size > 1)
    .map((entry) => ({ excerpt: entry.excerpt, files: [...entry.files].sort() }))
    .sort((left, right) => left.excerpt.localeCompare(right.excerpt));
}

export async function auditInstructionContext(options) {
  const root = await assertReadableRoot(options.root);
  const { discovered, truncated } = await discoverInstructionFiles(
    root,
    options.maxDepth,
    options.maxFiles
  );
  const files = [];

  for (const file of discovered) {
    const stats = await fs.stat(file.absolute);
    if (stats.size > MAX_FILE_BYTES) {
      files.push({
        path: file.relative,
        bytes: stats.size,
        lines: null,
        skipped: `larger than ${MAX_FILE_BYTES} bytes`,
        paragraphs: [],
        hostReferences: [],
        conditionalCandidates: [],
      });
      continue;
    }
    const content = await fs.readFile(file.absolute, "utf8");
    files.push({
      path: file.relative,
      bytes: Buffer.byteLength(content),
      lines: content === "" ? 0 : content.split("\n").length,
      skipped: null,
      paragraphs: extractParagraphs(content),
      hostReferences: extractHostReferences(content),
      conditionalCandidates: extractConditionalCandidates(content),
    });
  }

  const duplicateBlocks = buildDuplicateBlocks(files);
  const largeAlwaysLoadedFiles = files
    .filter(
      (file) =>
        !file.skipped &&
        ((file.lines ?? 0) > LARGE_FILE_LINES || file.bytes > LARGE_FILE_BYTES)
    )
    .map((file) => file.path);
  const hostSpecificReferences = files.flatMap((file) =>
    file.hostReferences.map((reference) => ({ file: file.path, ...reference }))
  );
  const conditionalWorkflowCandidates = files.flatMap((file) =>
    file.conditionalCandidates.map((heading) => ({ file: file.path, heading }))
  );

  const publicFiles = files.map(
    ({ paragraphs: _paragraphs, hostReferences: _hosts, conditionalCandidates: _candidates, ...file }) =>
      file
  );
  return {
    schemaVersion: 1,
    root,
    summary: {
      filesScanned: publicFiles.length,
      totalLines: publicFiles.reduce((sum, file) => sum + (file.lines ?? 0), 0),
      totalBytes: publicFiles.reduce((sum, file) => sum + file.bytes, 0),
      truncated,
    },
    files: publicFiles,
    duplicateBlocks,
    signals: {
      largeAlwaysLoadedFiles,
      hostSpecificReferences,
      conditionalWorkflowCandidates,
    },
  };
}

export function formatAuditMarkdown(report) {
  const lines = [
    "# Agent Context Audit",
    "",
    `- Root: \`${report.root}\``,
    `- Files scanned: ${report.summary.filesScanned}`,
    `- Total lines: ${report.summary.totalLines}`,
    `- Traversal truncated: ${report.summary.truncated ? "yes" : "no"}`,
    "",
    "## Instruction inventory",
    "",
    "| File | Lines | Bytes | Status |",
    "|---|---:|---:|---|",
    ...report.files.map(
      (file) =>
        `| \`${file.path}\` | ${file.lines ?? "-"} | ${file.bytes} | ${file.skipped ?? "read"} |`
    ),
    "",
    "## Duplicate blocks",
    "",
  ];

  if (report.duplicateBlocks.length === 0) {
    lines.push("None detected.");
  } else {
    for (const duplicate of report.duplicateBlocks) {
      lines.push(`- ${duplicate.files.map((file) => `\`${file}\``).join(", ")}: ${duplicate.excerpt}`);
    }
  }

  lines.push("", "## Placement signals", "");
  lines.push(
    `- Large always-loaded files: ${report.signals.largeAlwaysLoadedFiles.length > 0 ? report.signals.largeAlwaysLoadedFiles.map((file) => `\`${file}\``).join(", ") : "none"}`
  );
  lines.push(
    `- Host-specific references: ${report.signals.hostSpecificReferences.length > 0 ? report.signals.hostSpecificReferences.map((signal) => `\`${signal.file}\` (${signal.host})`).join(", ") : "none"}`
  );
  lines.push(
    `- Conditional workflow candidates: ${report.signals.conditionalWorkflowCandidates.length > 0 ? report.signals.conditionalWorkflowCandidates.map((signal) => `\`${signal.file}\` → ${signal.heading}`).join(", ") : "none"}`
  );
  lines.push(
    "",
    "These are deterministic placement signals. Read the surrounding instructions before moving, rewriting, or deleting guidance.",
    ""
  );
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await auditInstructionContext(options);
  process.stdout.write(
    options.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${formatAuditMarkdown(report)}\n`
  );
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
