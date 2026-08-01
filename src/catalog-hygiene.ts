import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPRODUCIBLE_ARTIFACTS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  ".venv",
]);

const RUNTIME_STATE = new Set(["runs", "output", "outputs"]);
const CLEANUP_TARGETS = new Set([...REPRODUCIBLE_ARTIFACTS, ...RUNTIME_STATE]);

export interface ArtifactFacts {
  trackedFiles: number;
  containsFiles: boolean;
}

export type ArtifactDecision = {
  action: "remove" | "preserve" | "refuse" | "ignore";
  reason: string;
};

export interface CatalogCleanupResult {
  removed: string[];
  preserved: string[];
  refused: string[];
}

export function classifyCatalogArtifact(
  name: string,
  facts: ArtifactFacts
): ArtifactDecision {
  if (!CLEANUP_TARGETS.has(name)) {
    return { action: "ignore", reason: "not a cleanup target" };
  }
  if (facts.trackedFiles > 0) {
    return { action: "refuse", reason: "contains tracked files" };
  }
  if (REPRODUCIBLE_ARTIFACTS.has(name)) {
    return { action: "remove", reason: "reproducible artifact" };
  }
  if (facts.containsFiles) {
    return { action: "preserve", reason: "runtime state contains files" };
  }
  return { action: "remove", reason: "empty runtime state" };
}

function containsFiles(directory: string): boolean {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() || entry.isSymbolicLink()) return true;
    if (entry.isDirectory() && containsFiles(path.join(directory, entry.name))) return true;
  }
  return false;
}

function trackedFileCount(root: string, directory: string): number {
  const relative = path.relative(root, directory).replaceAll(path.sep, "/");
  const output = execFileSync("git", ["ls-files", "-z", "--", relative], {
    cwd: root,
    encoding: "utf8",
  });
  return output === "" ? 0 : output.split("\0").filter(Boolean).length;
}

function discoverTargets(directory: string): string[] {
  const targets: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(directory, entry.name);
    if (CLEANUP_TARGETS.has(entry.name)) {
      targets.push(child);
      continue;
    }
    targets.push(...discoverTargets(child));
  }
  return targets;
}

export function assertCatalogClean(result: CatalogCleanupResult): void {
  if (result.removed.length > 0) {
    throw new Error(`Catalog contains ${result.removed.length} removable artifact target(s)`);
  }
}

export function cleanCatalog(root: string, apply: boolean): CatalogCleanupResult {
  const catalogRoot = path.resolve(root, "catalog");
  const relativeCatalog = path.relative(path.resolve(root), catalogRoot);
  if (relativeCatalog !== "catalog" || !fs.statSync(catalogRoot).isDirectory()) {
    throw new Error(`Catalog cleanup root is invalid: ${catalogRoot}`);
  }

  const result = { removed: [] as string[], preserved: [] as string[], refused: [] as string[] };
  for (const target of discoverTargets(catalogRoot).sort()) {
    const relative = path.relative(root, target).replaceAll(path.sep, "/");
    const decision = classifyCatalogArtifact(path.basename(target), {
      trackedFiles: trackedFileCount(root, target),
      containsFiles: containsFiles(target),
    });

    if (decision.action === "refuse") {
      result.refused.push(relative);
      console.error(`REFUSE ${relative}: ${decision.reason}`);
      continue;
    }
    if (decision.action === "preserve") {
      result.preserved.push(relative);
      console.log(`PRESERVE ${relative}: ${decision.reason}`);
      continue;
    }
    if (decision.action === "remove") {
      result.removed.push(relative);
      console.log(`${apply ? "REMOVE" : "WOULD REMOVE"} ${relative}: ${decision.reason}`);
      if (apply) fs.rmSync(target, { recursive: true, force: true });
    }
  }

  if (result.refused.length > 0) {
    throw new Error(`Refused to remove ${result.refused.length} catalog target(s) containing tracked files`);
  }
  return result;
}

function main(): void {
  const flag = process.argv[2] ?? "--dry-run";
  if (flag !== "--dry-run" && flag !== "--apply") {
    throw new Error("Usage: tsx src/catalog-hygiene.ts --dry-run|--apply");
  }
  const result = cleanCatalog(process.cwd(), flag === "--apply");
  console.log(
    `${flag === "--apply" ? "Removed" : "Planned"} ${result.removed.length} target(s); ` +
    `preserved ${result.preserved.length}.`
  );
  if (flag === "--dry-run") assertCatalogClean(result);
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
