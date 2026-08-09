#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateDecisionSpec } from "./build-decision-canvas.mjs";

const MAX_HTML_BYTES = 2 * 1024 * 1024;

function usage() {
  return [
    "Usage: verify-decision-canvas.mjs --input <canvas.html> [--format json|markdown]",
    "",
    "Options:",
    "  --input <path>     Standalone decision canvas HTML",
    "  --format <format>  json or markdown (default: markdown)",
    "  --help             Show this help",
  ].join("\n");
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(flag + " requires a value");
  return value;
}

function parseArgs(args) {
  const options = { input: null, format: "markdown", help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--input" || arg === "--format") {
      options[arg.slice(2)] = readValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error("Unknown option: " + arg);
  }
  if (!options.help && !options.input) throw new Error("--input is required");
  if (!new Set(["json", "markdown"]).has(options.format)) {
    throw new Error("--format must be json or markdown");
  }
  return options;
}

function extractEmbeddedSpec(html) {
  const match =
    /<script id="rudi-decision-spec" type="application\/json">([\s\S]*?)<\/script>/u.exec(
      html
    );
  if (!match) throw new Error("Embedded decision specification is missing");
  try {
    return validateDecisionSpec(JSON.parse(match[1]));
  } catch (error) {
    throw new Error(
      "Embedded decision specification is invalid: " +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

export async function verifyDecisionCanvas(inputPath) {
  const absolute = path.resolve(inputPath);
  const stats = await fs.stat(absolute);
  if (!stats.isFile()) throw new Error("Input is not a regular file: " + inputPath);
  if (stats.size > MAX_HTML_BYTES) {
    throw new Error("Input exceeds " + MAX_HTML_BYTES + " bytes");
  }
  const html = await fs.readFile(absolute, "utf8");
  const checks = {
    doctype: /^<!doctype html>/iu.test(html),
    canvasMarker: html.includes('data-rudi-decision-canvas="1"'),
    contentSecurityPolicy: html.includes("Content-Security-Policy"),
    noExternalResources:
      !/(?:src|href)\s*=\s*["']https?:\/\//iu.test(html) &&
      !/url\(\s*["']?https?:\/\//iu.test(html),
    feedbackControls:
      html.includes('id="copy-feedback"') && html.includes('id="export-feedback"'),
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const spec = extractEmbeddedSpec(html);
  return {
    valid: failedChecks.length === 0,
    input: absolute,
    title: spec.title,
    optionCount: spec.options.length,
    decisionCount: spec.decisions.length,
    checks,
    failedChecks,
  };
}

function formatMarkdown(report) {
  return [
    "# Decision Canvas Verification",
    "",
    "- Input: `" + report.input + "`",
    "- Valid: " + (report.valid ? "yes" : "no"),
    "- Title: " + report.title,
    "- Options: " + report.optionCount,
    "- Decisions: " + report.decisionCount,
    "- Failed checks: " +
      (report.failedChecks.length > 0 ? report.failedChecks.join(", ") : "none"),
    "",
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage() + "\n");
    return;
  }
  const report = await verifyDecisionCanvas(options.input);
  process.stdout.write(
    options.format === "json"
      ? JSON.stringify(report, null, 2) + "\n"
      : formatMarkdown(report)
  );
  if (!report.valid) process.exitCode = 1;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    process.stderr.write("ERROR: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
