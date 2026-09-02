import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANUAL_ROOT = join(__dirname, "manual");
const MAX_MANUAL_CHARS = 200_000;

export const MANUAL_DOCUMENTS = [
  { id: "master-engineering-doctrine", filename: "01-Master-Engineering-Doctrine.txt", title: "Master Engineering Doctrine" },
  { id: "engineering-quick-reference", filename: "02-Engineering-Quick-Reference.txt", title: "Engineering Quick Reference" },
  { id: "testing-doctrine-source", filename: "03-Testing-Doctrine-Source.txt", title: "Testing Doctrine Source" },
  { id: "debugging-doctrine-source", filename: "04-Debugging-Doctrine-Source.txt", title: "Debugging Doctrine Source" },
  { id: "api-engineering-standard", filename: "05-API-Engineering-Standard.md", title: "API Engineering Standard" },
  { id: "security-engineering-standard", filename: "06-Security-Engineering-Standard.md", title: "Security Engineering Standard" },
  { id: "backend-application-engineering-standard", filename: "07-Backend-Application-Engineering-Standard.md", title: "Backend Application Engineering Standard" },
  { id: "infrastructure-and-deployment-engineering-standard", filename: "08-Infrastructure-and-Deployment-Engineering-Standard.md", title: "Infrastructure And Deployment Engineering Standard" },
  { id: "build-order-and-engineering-system", filename: "09-Build-Order-and-Engineering-System.md", title: "Build Order And Engineering System" },
  { id: "engineering-operating-manual-index", filename: "10-Engineering-Operating-Manual-Index.md", title: "Engineering Operating Manual Index" },
  { id: "agent-copilot-operating-standard", filename: "11-Agent-Copilot-Operating-Standard.md", title: "Agent Co-Pilot Operating Standard" },
  { id: "horizontal-engineering-and-codebase-stewardship-standard", filename: "12-Horizontal-Engineering-and-Codebase-Stewardship-Standard.md", title: "Horizontal Engineering And Codebase Stewardship Standard" },
  { id: "rudi-agentic-engineering-standard", filename: "13-RUDI-Agentic-Engineering-Standard.md", title: "RUDI Agentic Engineering Standard" },
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

function boundedInteger(value, label, defaults) {
  const { defaultValue, min, max } = defaults;
  if (value === undefined || value === null || value === "") return defaultValue;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function resolveManualDocument(document) {
  const requested = nonEmptyString(document, "document");
  const normalized = requested.toLowerCase();
  const match = MANUAL_DOCUMENTS.find((item) => (
    item.id === normalized || item.filename.toLowerCase() === normalized
  ));
  if (!match) {
    throw new Error(
      `Unknown manual document "${requested}". Use swe_manual_list for valid ids.`
    );
  }
  return match;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

export async function listManualDocuments(options = {}) {
  const manualRoot = options.manualRoot || DEFAULT_MANUAL_ROOT;
  const documents = [];
  for (const item of MANUAL_DOCUMENTS) {
    const stat = await fs.stat(join(manualRoot, item.filename));
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
  const content = await fs.readFile(join(manualRoot, document.filename), "utf8");
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
    const lines = (await fs.readFile(join(manualRoot, document.filename), "utf8")).split(/\r?\n/);
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
