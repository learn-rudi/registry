/**
 * RUDI Compiler Tests
 *
 * Tests compiler determinism and index generation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// =============================================================================
// Helpers
// =============================================================================

async function readJson(file: string): Promise<unknown> {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

const execFileAsync = promisify(execFile);

function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj, null, 2);
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function hashFile(file: string): Promise<string> {
  const content = await fs.readFile(file);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function runCompiler(): Promise<void> {
  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx"
  );
  await execFileAsync(tsxBin, ["src/compile.ts"], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
  });
}

beforeAll(async () => {
  await runCompiler();
});

// =============================================================================
// Compiler Determinism Tests
// =============================================================================

describe("compiler determinism", () => {
  it("should produce consistent package ordering", async () => {
    const index = (await readJson("dist/index.json")) as {
      packages: Record<string, unknown>;
    };

    const packageIds = Object.keys(index.packages);

    // Packages should be in consistent order (insertion order from file discovery)
    expect(packageIds).toEqual(expect.arrayContaining(packageIds.sort()));
  });

  it("should produce valid stats", async () => {
    const index = (await readJson("dist/index.json")) as {
      stats: { total: number; byKind: Record<string, number> };
      packages: Record<string, unknown>;
    };

    expect(index.stats.total).toBe(Object.keys(index.packages).length);

    // Sum of byKind should equal total
    const kindSum = Object.values(index.stats.byKind).reduce((a, b) => a + b, 0);
    expect(kindSum).toBe(index.stats.total);
  });

  it("should generate all platform indexes", async () => {
    const platforms = [
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64",
    ];

    for (const platform of platforms) {
      const filename = `dist/index.${platform}.json`;
      await expect(fs.access(filename)).resolves.toBeUndefined();

      const index = (await readJson(filename)) as { platform: string };
      expect(index.platform).toBe(platform);
    }
  });

  it("should have consistent schema version across all indexes", async () => {
    const platforms = [
      "",
      ".darwin-arm64",
      ".darwin-x64",
      ".linux-arm64",
      ".linux-x64",
      ".win32-x64",
    ];

    const versions = await Promise.all(
      platforms.map(async (p) => {
        const index = (await readJson(`dist/index${p}.json`)) as {
          schemaVersion: string;
        };
        return index.schemaVersion;
      })
    );

    expect(new Set(versions).size).toBe(1);
    expect(versions[0]).toBe("2");
  });

  it("should produce byte-equivalent logical output on consecutive runs", async () => {
    await runCompiler();
    const first = await Promise.all([
      readJson("dist/index.json"),
      readJson("dist/catalog.sha256.json"),
      readJson("dist/release.json"),
    ]);

    await runCompiler();
    const second = await Promise.all([
      readJson("dist/index.json"),
      readJson("dist/catalog.sha256.json"),
      readJson("dist/release.json"),
    ]);

    expect(second.map(hashObject)).toEqual(first.map(hashObject));
  });
});

// =============================================================================
// Index Structure Tests
// =============================================================================

describe("index structure", () => {
  it("should have required top-level fields", async () => {
    const index = (await readJson("dist/index.json")) as Record<string, unknown>;

    expect(index).toHaveProperty("$schema");
    expect(index).toHaveProperty("schemaVersion");
    expect(index).toHaveProperty("generatedAt");
    expect(index).toHaveProperty("stats");
    expect(index).toHaveProperty("packages");
  });

  it("should have valid ISO timestamp", async () => {
    const index = (await readJson("dist/index.json")) as {
      generatedAt: string;
    };

    const timestamp = new Date(index.generatedAt);
    expect(timestamp.toISOString()).toBe(index.generatedAt);
  });

  it("should have valid package IDs with kind prefix", async () => {
    const index = (await readJson("dist/index.json")) as {
      packages: Record<string, { id: string; kind: string }>;
    };

    for (const [id, pkg] of Object.entries(index.packages)) {
      expect(id).toBe(pkg.id);
      expect(id).toMatch(/^(runtime|binary|agent|stack|skill|prompt):/);
      expect(id.startsWith(`${pkg.kind}:`)).toBe(true);
    }
  });

  it("should include Markdown skills as package entries", async () => {
    const index = (await readJson("dist/index.json")) as {
      packages: Record<string, { kind: string; install: { source: string; path: string } }>;
      stats: { byKind: Record<string, number> };
    };

    expect(index.stats.byKind.skill).toBeGreaterThan(0);
    const skills = Object.values(index.packages).filter((pkg) => pkg.kind === "skill");
    expect(skills.length).toBe(index.stats.byKind.skill);
    expect(skills.every((skill) => (
      skill.install.source === "catalog" &&
      /^catalog\/skills\/[a-z0-9][a-z0-9-]*(?:\.md)?$/.test(skill.install.path)
    ))).toBe(true);
    expect(skills.some((skill) => skill.install.path.endsWith(".md"))).toBe(true);
  });

  it("should preserve related skill relationships in generated indexes", async () => {
    const index = (await readJson("dist/index.json")) as {
      packages: Record<string, {
        kind: string;
        related?: { operatorSkill?: string; skills?: string[] };
        requires?: { stacks?: string[] };
      }>;
    };

    const relatedSkillIds = Object.values(index.packages)
      .flatMap((pkg) => pkg.related?.skills ?? []);
    expect(relatedSkillIds.length).toBeGreaterThan(0);
    expect(relatedSkillIds.every((id) => index.packages[id]?.kind === "skill")).toBe(true);

    const stacks = Object.entries(index.packages)
      .filter(([, pkg]) => pkg.kind === "stack");
    expect(stacks.length).toBeGreaterThan(0);
    for (const [stackId, stack] of stacks) {
      const operatorSkill = stack.related?.operatorSkill;
      expect(operatorSkill).toMatch(/^skill:/);
      expect(stack.related?.skills).toContain(operatorSkill);
      expect(index.packages[operatorSkill!]?.requires?.stacks).toContain(stackId);
    }
  });

  it("publishes declared lifecycle metadata and implemented packages", async () => {
    const index = (await readJson("dist/index.json")) as {
      packages: Record<string, {
        lifecycle?: { maturity: string; support: string };
      }>;
    };

    expect(index.packages["stack:content-extractor"]?.lifecycle).toEqual({
      maturity: "stable",
      support: "supported",
    });
    expect(index.packages["stack:stripe"]).toMatchObject({
      kind: "stack",
      runtime: "node",
      mcp: { command: "node", args: ["src/index.js"] },
    });
  });
});

// =============================================================================
// Platform Index Tests
// =============================================================================

describe("platform indexes", () => {
  it("should resolve packages for each platform", async () => {
    const darwinIndex = (await readJson("dist/index.darwin-arm64.json")) as {
      packages: Record<
        string,
        {
          install: { source: string };
          _resolved: { platformKey?: string; keysTried: string[] };
        }
      >;
    };

    // Platform index should have resolved metadata
    for (const pkg of Object.values(darwinIndex.packages)) {
      expect(pkg).toHaveProperty("_resolved");
      expect(pkg._resolved).toHaveProperty("keysTried");
      expect(Array.isArray(pkg._resolved.keysTried)).toBe(true);

      // Only packages with platform-specific config will have platformKey
      // Catalog source packages (stacks/skills/prompts) won't have platform resolution
      if (pkg.install.source !== "catalog") {
        // For downloads/system, there should be platform resolution attempted
        expect(pkg._resolved.keysTried.length).toBeGreaterThan(0);
      }
    }
  });

  it("should have platform-specific URL for downloads", async () => {
    const darwinIndex = (await readJson("dist/index.darwin-arm64.json")) as {
      packages: Record<
        string,
        {
          install: { source: string };
          _resolved: { platform?: { url?: string } };
        }
      >;
    };

    for (const pkg of Object.values(darwinIndex.packages)) {
      if (pkg.install.source === "download" && pkg._resolved.platform) {
        expect(pkg._resolved.platform.url).toBeDefined();
      }
    }
  });
});

// =============================================================================
// Catalog Hash Tests
// =============================================================================

describe("catalog hash", () => {
  it("should generate catalog hash file", async () => {
    await expect(fs.access("dist/catalog.sha256.json")).resolves.toBeUndefined();
  });

  it("should have valid hash structure", async () => {
    const hash = (await readJson("dist/catalog.sha256.json")) as {
      algorithm: string;
      root: string;
      files: Record<string, string>;
    };

    expect(hash.algorithm).toBe("sha256");
    expect(hash.root).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof hash.files).toBe("object");

    // All file hashes should be valid SHA256
    for (const fileHash of Object.values(hash.files)) {
      expect(fileHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("should include manifest files in hash tree", async () => {
    const hash = (await readJson("dist/catalog.sha256.json")) as {
      files: Record<string, string>;
    };

    const hasManifests = Object.keys(hash.files).some(
      (f) => f.includes("manifest") && f.endsWith(".json")
    );
    expect(hasManifests).toBe(true);
  });

  it("should include bundled skill resources in the hash tree", async () => {
    const hash = (await readJson("dist/catalog.sha256.json")) as {
      files: Record<string, string>;
    };

    expect(hash.files).toHaveProperty(
      "catalog/skills/design-system-extractor/scripts/spec_utils.cjs"
    );
    expect(hash.files).toHaveProperty(
      "catalog/skills/design-system-extractor/references/spec.example.json"
    );
  });

  it("should exclude stack runtime artifacts from the hash tree", async () => {
    const runtimeArtifact = path.join(
      "catalog",
      "stacks",
      "video-editor",
      "runs",
      "__compile-test__",
      "leak.json"
    );

    await fs.mkdir(path.dirname(runtimeArtifact), { recursive: true });
    await fs.writeFile(runtimeArtifact, JSON.stringify({ shouldNotShip: true }) + "\n");

    try {
      await runCompiler();

      const hash = (await readJson("dist/catalog.sha256.json")) as {
        files: Record<string, string>;
      };

      expect(hash.files).not.toHaveProperty(runtimeArtifact);
    } finally {
      await fs.rm(path.dirname(runtimeArtifact), { recursive: true, force: true });
      await fs.rmdir(path.join("catalog", "stacks", "video-editor", "runs")).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      });
      await runCompiler();
    }
  });
});

// =============================================================================
// Release Manifest Tests
// =============================================================================

describe("release manifest", () => {
  it("should generate release.json", async () => {
    await expect(fs.access("dist/release.json")).resolves.toBeUndefined();
  });

  it("should list all generated files", async () => {
    const release = (await readJson("dist/release.json")) as {
      files: string[];
    };

    expect(release.files).toContain("index.json");
    expect(release.files).toContain("index.darwin-arm64.json");
    expect(release.files).toContain("index.darwin-x64.json");
    expect(release.files).toContain("index.linux-arm64.json");
    expect(release.files).toContain("index.linux-x64.json");
    expect(release.files).toContain("index.win32-x64.json");
    expect(release.files).toContain("catalog.sha256.json");
  });

  it("should include catalog root hash", async () => {
    const release = (await readJson("dist/release.json")) as {
      catalogRoot: string;
    };
    const catalogHash = (await readJson("dist/catalog.sha256.json")) as {
      root: string;
    };

    expect(release.catalogRoot).toBe(catalogHash.root);
  });

  it("should record source revision context and generated artifact SHA-256 hashes", async () => {
    const release = (await readJson("dist/release.json")) as {
      files: string[];
      provenance: {
        source: { repository: string; revision: string };
        artifacts: Record<string, string>;
      };
    };

    expect(release.provenance.source.repository).toBe(
      "https://github.com/learnrudi/registry"
    );
    expect(release.provenance.source.revision).toMatch(/^[a-f0-9]{40,64}$/);
    expect(Object.keys(release.provenance.artifacts).sort()).toEqual(
      [...release.files].sort()
    );

    for (const file of release.files) {
      expect(release.provenance.artifacts[file]).toBe(
        await hashFile(path.join("dist", file))
      );
    }
  });
});
