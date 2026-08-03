import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RELEASE_ARTIFACTS,
  verifyReleaseArtifacts,
} from "./release-provenance.js";

let tmpDir: string;

async function writeReleaseFixture(): Promise<Record<string, unknown>> {
  const catalogRoot = "b".repeat(64);
  for (const file of RELEASE_ARTIFACTS) {
    const content = file === "catalog.sha256.json"
      ? JSON.stringify({ algorithm: "sha256", root: catalogRoot }) + "\n"
      : `${file}\n`;
    await fs.writeFile(path.join(tmpDir, "dist", file), content);
  }

  const artifacts = Object.fromEntries(
    await Promise.all(RELEASE_ARTIFACTS.map(async (file) => {
      const content = await fs.readFile(path.join(tmpDir, "dist", file));
      return [file, crypto.createHash("sha256").update(content).digest("hex")];
    }))
  );
  const release = {
    files: [...RELEASE_ARTIFACTS],
    catalogRoot,
    provenance: {
      source: {
        repository: "https://github.com/learnrudi/registry",
        revision: "a".repeat(40),
      },
      catalog: { algorithm: "sha256", root: catalogRoot },
      artifacts,
    },
  };
  await fs.writeFile(
    path.join(tmpDir, "dist/release.json"),
    JSON.stringify(release)
  );
  return release;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-release-verify-"));
  await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("verifyReleaseArtifacts", () => {
  it("fails when a generated artifact no longer matches release provenance", async () => {
    await writeReleaseFixture();

    await expect(verifyReleaseArtifacts(tmpDir)).resolves.toEqual({
      verified: RELEASE_ARTIFACTS.length,
    });

    await fs.writeFile(path.join(tmpDir, "dist/index.json"), "tampered\n");
    await expect(verifyReleaseArtifacts(tmpDir)).rejects.toThrow(
      "[index.json] SHA-256 mismatch"
    );
  });

  it("rejects a self-consistent manifest that omits a canonical artifact", async () => {
    const release = await writeReleaseFixture() as {
      files: string[];
      provenance: { artifacts: Record<string, string> };
    };
    release.files = release.files.filter((file) => file !== "index.win32-x64.json");
    delete release.provenance.artifacts["index.win32-x64.json"];
    await fs.writeFile(
      path.join(tmpDir, "dist/release.json"),
      JSON.stringify(release)
    );

    await expect(verifyReleaseArtifacts(tmpDir)).rejects.toThrow(
      "Release files must match the canonical generated artifact set"
    );
  });

  it("rejects catalog provenance that disagrees with the catalog hash tree", async () => {
    await writeReleaseFixture();
    await fs.writeFile(
      path.join(tmpDir, "dist/catalog.sha256.json"),
      JSON.stringify({ algorithm: "sha256", root: "c".repeat(64) }) + "\n"
    );

    await expect(verifyReleaseArtifacts(tmpDir)).rejects.toThrow(
      "Release provenance catalog root does not match catalog.sha256.json"
    );
  });

  it("rejects symlinked artifacts before hashing them", async () => {
    await writeReleaseFixture();
    await fs.rm(path.join(tmpDir, "dist/index.json"));
    await fs.symlink(
      path.join(tmpDir, "dist/index.darwin-arm64.json"),
      path.join(tmpDir, "dist/index.json")
    );

    await expect(verifyReleaseArtifacts(tmpDir)).rejects.toThrow(
      "[index.json] Release artifact must be a regular file"
    );
  });
});
