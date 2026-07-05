/**
 * RUDI Registry Index Compiler
 *
 * Compiles all v2 manifests into a single index.json for O(1) lookups.
 *
 * Outputs:
 * - dist/index.json (all packages keyed by id)
 * - dist/index.{platform}.json (platform-specific resolved packages)
 * - dist/catalog.sha256 (hash tree of catalog payloads)
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import fg from "fast-glob";

import {
  resolve,
  assertEffectivePolicy,
  type Package,
  type ResolveContext,
  type ResolvedPackage,
} from "./resolver.js";
import {
  assertCatalogReferences,
  discoverCatalogPackages,
  type CatalogPackageFile,
} from "./catalog.js";
import {
  CATALOG_ARTIFACT_IGNORE,
  CATALOG_PAYLOAD_PATTERNS,
} from "./catalog-artifacts.js";

// =============================================================================
// Types
// =============================================================================

interface RegistryIndex {
  $schema: string;
  schemaVersion: string;
  generatedAt: string;
  stats: {
    total: number;
    byKind: Record<string, number>;
  };
  packages: Record<string, Package>;
  aliases: Record<string, string>;
}

interface PlatformIndex extends Omit<RegistryIndex, "packages" | "aliases"> {
  platform: string;
  packages: Record<string, ResolvedPackage>;
  aliases: Record<string, string>;
}

interface CatalogHash {
  generatedAt: string;
  algorithm: string;
  files: Record<string, string>;
  root: string;
}

// =============================================================================
// Constants
// =============================================================================

const PLATFORMS: Array<{ os: "darwin" | "linux" | "win32"; arch: "arm64" | "x64" }> = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "win32", arch: "x64" },
];

const SCHEMA_URL = "https://learn-rudi.dev/schemas/registry/v2/index.schema.json";

// =============================================================================
// File Utilities
// =============================================================================

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

async function hashFile(file: string): Promise<string> {
  const content = await fs.readFile(file);
  return crypto.createHash("sha256").update(content).digest("hex");
}

// =============================================================================
// Index Building
// =============================================================================

function buildBaseIndex(manifests: CatalogPackageFile[]): RegistryIndex {
  const packages: Record<string, Package> = {};
  const aliases: Record<string, string> = {};
  const byKind: Record<string, number> = {};

  for (const { manifest } of manifests) {
    const id = manifest.id;
    packages[id] = manifest;

    const kind = manifest.kind;
    byKind[kind] = (byKind[kind] ?? 0) + 1;

    // Collect aliases
    if (manifest.aliases) {
      for (const alias of manifest.aliases) {
        aliases[alias] = id;
      }
    }
  }

  return {
    $schema: SCHEMA_URL,
    schemaVersion: "2",
    generatedAt: new Date().toISOString(),
    stats: {
      total: manifests.length,
      byKind,
    },
    packages,
    aliases,
  };
}

function buildPlatformIndex(
  manifests: CatalogPackageFile[],
  ctx: ResolveContext
): PlatformIndex {
  const packages: Record<string, ResolvedPackage> = {};
  const aliases: Record<string, string> = {};
  const byKind: Record<string, number> = {};
  const errors: string[] = [];

  for (const { manifest, path: filePath } of manifests) {
    try {
      const resolved = resolve(manifest, ctx);
      assertEffectivePolicy(resolved);

      packages[manifest.id] = resolved;

      const kind = manifest.kind;
      byKind[kind] = (byKind[kind] ?? 0) + 1;

      // Collect aliases
      if (manifest.aliases) {
        for (const alias of manifest.aliases) {
          aliases[alias] = manifest.id;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${manifest.id}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    console.warn(`\nWarnings for ${ctx.os}-${ctx.arch}:`);
    for (const err of errors) {
      console.warn(`  - ${err}`);
    }
  }

  return {
    $schema: SCHEMA_URL,
    schemaVersion: "2",
    generatedAt: new Date().toISOString(),
    platform: `${ctx.os}-${ctx.arch}`,
    stats: {
      total: Object.keys(packages).length,
      byKind,
    },
    packages,
    aliases,
  };
}

// =============================================================================
// Catalog Hash Tree
// =============================================================================

async function buildCatalogHash(): Promise<CatalogHash> {
  const files = await fg(CATALOG_PAYLOAD_PATTERNS, {
    dot: false,
    onlyFiles: true,
    cwd: process.cwd(),
    ignore: CATALOG_ARTIFACT_IGNORE,
  });

  const hashes: Record<string, string> = {};

  for (const file of files.sort()) {
    hashes[file] = await hashFile(file);
  }

  // Compute root hash (hash of all hashes)
  const allHashes = Object.entries(hashes)
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
  const root = crypto.createHash("sha256").update(allHashes).digest("hex");

  return {
    generatedAt: new Date().toISOString(),
    algorithm: "sha256",
    files: hashes,
    root,
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("RUDI Registry Compiler\n");

  // Discover manifests
  console.log("Discovering catalog packages...");
  const manifests = await discoverCatalogPackages();
  assertCatalogReferences(manifests);
  console.log(`Found ${manifests.length} package(s)\n`);

  if (manifests.length === 0) {
    console.log("No catalog packages found. Nothing to compile.");
    process.exit(0);
  }

  // Build base index
  console.log("Building base index...");
  const baseIndex = buildBaseIndex(manifests);
  await writeJson("dist/index.json", baseIndex);
  console.log(`  → dist/index.json (${baseIndex.stats.total} packages)`);

  // Build platform-specific indexes
  console.log("\nBuilding platform indexes...");
  for (const { os, arch } of PLATFORMS) {
    const ctx: ResolveContext = { os, arch };
    const platformIndex = buildPlatformIndex(manifests, ctx);
    const filename = `dist/index.${os}-${arch}.json`;
    await writeJson(filename, platformIndex);
    console.log(`  → ${filename} (${platformIndex.stats.total} packages)`);
  }

  // Build catalog hash tree
  console.log("\nBuilding catalog hash tree...");
  const catalogHash = await buildCatalogHash();
  await writeJson("dist/catalog.sha256.json", catalogHash);
  console.log(`  → dist/catalog.sha256.json (${Object.keys(catalogHash.files).length} files)`);
  console.log(`  → root: ${catalogHash.root.slice(0, 16)}...`);

  // Summary
  console.log("\n" + "─".repeat(60));
  console.log("Compilation complete!");
  console.log(`\nStats by kind:`);
  for (const [kind, count] of Object.entries(baseIndex.stats.byKind)) {
    console.log(`  ${kind}: ${count}`);
  }

  // Write a simple manifest for release
  const releaseManifest = {
    version: "2.0.0",
    generatedAt: baseIndex.generatedAt,
    files: [
      "index.json",
      ...PLATFORMS.map((p) => `index.${p.os}-${p.arch}.json`),
      "catalog.sha256.json",
    ],
    stats: baseIndex.stats,
    catalogRoot: catalogHash.root,
  };
  await writeJson("dist/release.json", releaseManifest);
  console.log(`\n  → dist/release.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
