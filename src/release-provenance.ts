import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const RELEASE_ARTIFACTS = [
  "index.json",
  "index.darwin-arm64.json",
  "index.darwin-x64.json",
  "index.linux-arm64.json",
  "index.linux-x64.json",
  "index.win32-x64.json",
  "catalog.sha256.json",
] as const;

interface ReleaseManifest {
  files?: unknown;
  catalogRoot?: unknown;
  provenance?: {
    source?: {
      repository?: unknown;
      revision?: unknown;
    };
    catalog?: {
      algorithm?: unknown;
      root?: unknown;
    };
    artifacts?: unknown;
  };
}

interface CatalogHashManifest {
  algorithm?: unknown;
  root?: unknown;
}

function assertArtifactPath(file: string): void {
  if (
    file.includes("\\") ||
    file.includes("\0") ||
    path.posix.isAbsolute(file) ||
    path.posix.normalize(file) !== file ||
    file.startsWith("../")
  ) {
    throw new Error(`Invalid release artifact path: ${file}`);
  }
}

async function sha256(file: string): Promise<string> {
  const content = await fs.readFile(file);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function assertRegularFile(file: string, label: string): Promise<void> {
  const stat = await fs.lstat(file);
  if (!stat.isFile()) {
    throw new Error(`[${label}] Release artifact must be a regular file`);
  }
}

export async function verifyReleaseArtifacts(
  root: string
): Promise<{ verified: number }> {
  const distDir = path.join(path.resolve(root), "dist");
  const releaseFile = path.join(distDir, "release.json");
  await assertRegularFile(releaseFile, "release.json");
  const raw = await fs.readFile(releaseFile, "utf8");
  const release = JSON.parse(raw) as ReleaseManifest;
  const files = release.files;
  const artifacts = release.provenance?.artifacts;
  const source = release.provenance?.source;

  if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) {
    throw new Error("Release provenance requires a string files array");
  }
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new Error("Release provenance requires an artifacts hash map");
  }
  if (source?.repository !== "https://github.com/learnrudi/registry") {
    throw new Error("Release provenance has an unexpected source repository");
  }
  if (typeof source.revision !== "string" || !/^[a-f0-9]{40,64}$/.test(source.revision)) {
    throw new Error("Release provenance requires a hexadecimal source revision");
  }

  const hashMap = artifacts as Record<string, unknown>;
  const artifactNames = Object.keys(hashMap).sort();
  const declaredNames = [...(files as string[])].sort();
  const canonicalNames = [...RELEASE_ARTIFACTS].sort();
  if (JSON.stringify(declaredNames) !== JSON.stringify(canonicalNames)) {
    throw new Error("Release files must match the canonical generated artifact set");
  }
  const expectedNames = [...canonicalNames];
  if (JSON.stringify(artifactNames) !== JSON.stringify(expectedNames)) {
    throw new Error("Release files and provenance artifact hashes must match exactly");
  }

  const catalog = release.provenance?.catalog;
  if (
    catalog?.algorithm !== "sha256" ||
    typeof catalog.root !== "string" ||
    !/^[a-f0-9]{64}$/.test(catalog.root) ||
    release.catalogRoot !== catalog.root
  ) {
    throw new Error("Release provenance must bind the SHA-256 catalog root");
  }

  const catalogHashFile = path.join(distDir, "catalog.sha256.json");
  await assertRegularFile(catalogHashFile, "catalog.sha256.json");
  const catalogHash = JSON.parse(
    await fs.readFile(catalogHashFile, "utf8")
  ) as CatalogHashManifest;
  if (catalogHash.algorithm !== "sha256" || catalogHash.root !== catalog.root) {
    throw new Error("Release provenance catalog root does not match catalog.sha256.json");
  }

  for (const file of expectedNames) {
    assertArtifactPath(file);
    const expectedHash = hashMap[file];
    if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      throw new Error(`[${file}] Invalid SHA-256 provenance value`);
    }
    const artifactFile = path.join(distDir, file);
    await assertRegularFile(artifactFile, file);
    const actualHash = await sha256(artifactFile);
    if (actualHash !== expectedHash) {
      throw new Error(`[${file}] SHA-256 mismatch`);
    }
  }

  return { verified: expectedNames.length };
}
