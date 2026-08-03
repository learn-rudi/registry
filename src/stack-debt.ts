import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

export interface StackDebtBaseline {
  schemaVersion: 1;
  maxLines: number;
  oversized: Record<string, number>;
}

export interface StackDebtIssue {
  packageId: string;
  path: string;
  lines: number;
  allowedLines: number;
  code: "new-oversized-module" | "oversized-module-growth";
  message: string;
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/).length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

function assertBaseline(baseline: StackDebtBaseline): void {
  if (baseline.schemaVersion !== 1) {
    throw new Error("Stack debt baseline must use schemaVersion 1");
  }
  if (!Number.isInteger(baseline.maxLines) || baseline.maxLines < 1) {
    throw new Error("Stack debt baseline maxLines must be a positive integer");
  }
  if (!baseline.oversized || typeof baseline.oversized !== "object") {
    throw new Error("Stack debt baseline requires an oversized path map");
  }

  for (const [file, lines] of Object.entries(baseline.oversized)) {
    if (!/^catalog\/stacks\/[a-z0-9][a-z0-9-_]*\/src\//.test(file)) {
      throw new Error(`Invalid stack debt baseline path: ${file}`);
    }
    if (!Number.isInteger(lines) || lines <= baseline.maxLines) {
      throw new Error(`Invalid stack debt baseline line count for ${file}`);
    }
  }
}

export async function loadStackDebtBaseline(root: string): Promise<StackDebtBaseline> {
  const raw = await fs.readFile(
    path.join(path.resolve(root), ".stack-debt-baseline.json"),
    "utf8"
  );
  const baseline = JSON.parse(raw) as StackDebtBaseline;
  assertBaseline(baseline);
  return baseline;
}

export async function auditStackModuleSizes(
  root: string,
  packageIds: string[],
  baseline: StackDebtBaseline
): Promise<StackDebtIssue[]> {
  assertBaseline(baseline);
  const absoluteRoot = path.resolve(root);
  const issues: StackDebtIssue[] = [];

  for (const packageId of [...new Set(packageIds)].sort()) {
    const match = /^stack:([a-z0-9][a-z0-9-_]*)$/.exec(packageId);
    if (!match) throw new Error(`Invalid stack package ID: ${packageId}`);
    const files = await fg(
      `catalog/stacks/${match[1]}/src/**/*.{cjs,js,mjs,py,ts,tsx}`,
      { cwd: absoluteRoot, onlyFiles: true }
    );

    for (const file of files.sort()) {
      const lines = countLines(await fs.readFile(path.join(absoluteRoot, file), "utf8"));
      const recordedLines = baseline.oversized[file];
      const allowedLines = recordedLines ?? baseline.maxLines;
      if (lines <= allowedLines) continue;

      const code = recordedLines === undefined
        ? "new-oversized-module"
        : "oversized-module-growth";
      issues.push({
        packageId,
        path: file,
        lines,
        allowedLines,
        code,
        message: recordedLines === undefined
          ? `${file} has ${lines} lines; new stack source modules are limited to ${allowedLines}`
          : `${file} grew from its ${allowedLines}-line debt baseline to ${lines}; split responsibilities before adding lines`,
      });
    }
  }

  return issues;
}
