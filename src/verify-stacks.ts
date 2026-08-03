import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  runStackVerifications,
  selectChangedStackIds,
} from "./stack-verification.js";
import {
  auditStackModuleSizes,
  loadStackDebtBaseline,
} from "./stack-debt.js";

const execFileAsync = promisify(execFile);

export type StackVerificationArgs =
  | { mode: "all"; json: boolean; prepare: boolean }
  | { mode: "changed"; base: string; json: boolean; prepare: boolean }
  | { mode: "selected"; packageIds: string[]; json: boolean; prepare: boolean };

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseStackVerificationArgs(argv: string[]): StackVerificationArgs {
  let all = false;
  let changedFrom: string | undefined;
  let json = false;
  let prepare = false;
  const packageIds: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      all = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--prepare") {
      prepare = true;
    } else if (arg === "--changed-from") {
      changedFrom = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--stack") {
      packageIds.push(requireValue(argv, index, arg));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const modeCount = Number(all) + Number(changedFrom !== undefined) + Number(packageIds.length > 0);
  if (modeCount !== 1) {
    throw new Error(
      "Choose exactly one stack verification selection mode: --all, " +
        "--changed-from <ref>, or one or more --stack <id>"
    );
  }

  if (all) return { mode: "all", json, prepare };
  if (changedFrom !== undefined) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(changedFrom) ||
      changedFrom.includes("..") ||
      changedFrom.includes("//")
    ) {
      throw new Error(`Invalid git base ref: ${changedFrom}`);
    }
    return { mode: "changed", base: changedFrom, json, prepare };
  }

  return {
    mode: "selected",
    packageIds: [...new Set(packageIds)].sort(),
    json,
    prepare,
  };
}

async function listAllStackIds(root: string): Promise<string[]> {
  const stacksDir = path.join(root, "catalog", "stacks");
  const entries = await fs.readdir(stacksDir, { withFileTypes: true });
  const packageIds: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestFile = path.join(stacksDir, entry.name, "manifest.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as {
        id?: unknown;
      };
      if (typeof manifest.id === "string") packageIds.push(manifest.id);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }
  }

  return [...new Set(packageIds)].sort();
}

async function listChangedPaths(root: string, base: string): Promise<string[]> {
  const result = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRT", `${base}...HEAD`, "--"],
    { cwd: root, encoding: "utf8" }
  ) as { stdout: string };

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const root = process.cwd();
  const args = parseStackVerificationArgs(process.argv.slice(2));
  let packageIds: string[];

  if (args.mode === "all") {
    packageIds = await listAllStackIds(root);
  } else if (args.mode === "changed") {
    packageIds = selectChangedStackIds(await listChangedPaths(root, args.base));
  } else {
    packageIds = args.packageIds;
  }

  const architectureIssues = await auditStackModuleSizes(
    root,
    packageIds,
    await loadStackDebtBaseline(root)
  );
  if (architectureIssues.length > 0) {
    const failedPackages = new Set(
      architectureIssues.map((issue) => issue.packageId)
    ).size;
    if (args.json) {
      console.log(JSON.stringify({
        summary: {
          selected: packageIds.length,
          passed: 0,
          failed: failedPackages,
        },
        architectureIssues,
        results: [],
      }, null, 2));
    } else {
      for (const issue of architectureIssues) {
        console.log(`FAILED ${issue.packageId}: ${issue.message}`);
      }
      console.log(
        `Stack architecture: ${failedPackages} package(s) exceeded the no-growth baseline.`
      );
    }
    process.exit(1);
  }

  const results = await runStackVerifications(root, packageIds, {
    prepare: args.prepare,
  });
  const summary = {
    selected: packageIds.length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
  };

  if (args.json) {
    console.log(JSON.stringify({ summary, results }, null, 2));
  } else if (packageIds.length === 0) {
    console.log("No changed stacks require verification.");
  } else {
    for (const result of results) {
      const suffix = result.error ? `: ${result.error}` : ` via ${result.source}`;
      console.log(`${result.status.toUpperCase()} ${result.packageId}${suffix}`);
    }
    console.log(
      `Stack verification: ${summary.passed} passed, ${summary.failed} failed, ` +
        `${summary.selected} selected.`
    );
  }

  process.exit(summary.failed > 0 ? 1 : 0);
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
