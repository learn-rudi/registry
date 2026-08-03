/**
 * RUDI Schema Validation Tests
 *
 * Tests JSON Schema validation with valid and invalid fixtures.
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

// =============================================================================
// Setup
// =============================================================================

let validate: ValidateFunction;

beforeAll(async () => {
  const schemaPath = path.resolve(
    import.meta.dirname,
    "../schemas/package.schema.json"
  );
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf8"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  validate = ajv.compile(schema);
});

async function loadFixture(name: string): Promise<unknown> {
  const fixturePath = path.resolve(
    import.meta.dirname,
    `fixtures/invalid/${name}.json`
  );
  return JSON.parse(await fs.readFile(fixturePath, "utf8"));
}

function getErrorMessages(validate: ValidateFunction): string[] {
  if (!validate.errors) return [];
  return validate.errors.map((e) => `${e.instancePath} ${e.message}`);
}

// =============================================================================
// Invalid Manifest Tests
// =============================================================================

describe("schema validation - invalid manifests", () => {
  describe("required fields", () => {
    it("should reject manifest missing id", async () => {
      const manifest = await loadFixture("missing-id");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("id")
      );
    });

    it("should reject manifest missing kind", async () => {
      const manifest = await loadFixture("missing-kind");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("kind")
      );
    });
  });

  describe("enum validation", () => {
    it("should reject invalid kind value", async () => {
      const manifest = await loadFixture("invalid-kind");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("kind")
      );
    });

    it("should reject invalid source value", async () => {
      const manifest = await loadFixture("invalid-source");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("source")
      );
    });

    it("should reject invalid delivery value", async () => {
      const manifest = await loadFixture("invalid-delivery");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("delivery")
      );
    });

    it("should reject invalid extract type", async () => {
      const manifest = await loadFixture("invalid-extract-type");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("type")
      );
    });

    it("should reject invalid mcp transport", async () => {
      const manifest = await loadFixture("invalid-mcp-transport");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("transport")
      );
    });

    it("should reject invalid runtime", async () => {
      const manifest = await loadFixture("invalid-runtime");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("runtime")
      );
    });
  });

  describe("checksum validation", () => {
    it("should reject invalid checksum algorithm", async () => {
      const manifest = await loadFixture("invalid-checksum-algo");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("algo")
      );
    });

    it("should reject invalid checksum format", async () => {
      const manifest = await loadFixture("invalid-checksum-format");
      const valid = validate(manifest);

      expect(valid).toBe(false);
      expect(getErrorMessages(validate)).toContainEqual(
        expect.stringContaining("pattern")
      );
    });
  });
});

// =============================================================================
// Valid Manifest Tests
// =============================================================================

describe("schema validation - valid manifests", () => {
  it("should accept minimal binary manifest", () => {
    const manifest = {
      id: "binary:test",
      kind: "binary",
      name: "Test",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "download",
        platforms: {
          "darwin-arm64": {
            url: "https://example.com/test.zip",
            checksum: {
              algo: "sha256",
              value: "a".repeat(64),
            },
          },
        },
      },
      bins: ["test"],
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept system binary manifest", () => {
    const manifest = {
      id: "binary:git",
      kind: "binary",
      name: "Git",
      version: "system",
      delivery: "system",
      install: {
        source: "system",
      },
      bins: ["git"],
      detect: {
        command: "git --version",
        expectExitCode: 0,
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept minimal stack manifest", () => {
    const manifest = {
      id: "stack:test",
      kind: "stack",
      name: "Test Stack",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/test",
      },
      runtime: "node",
      provides: {
        tools: ["test_tool"],
      },
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["index.js"],
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept additive lifecycle and deprecation metadata", () => {
    const manifest = {
      id: "stack:test",
      kind: "stack",
      name: "Test Stack",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/test",
      },
      lifecycle: {
        maturity: "stable",
        support: "maintenance",
        deprecation: {
          announcedAt: "2026-08-02",
          message: "Use the replacement stack for new installations.",
          replacementId: "stack:replacement",
          removalAfter: "2026-11-01",
        },
      },
      runtime: "node",
      provides: { tools: ["test_tool"] },
      mcp: { transport: "stdio", command: "node", args: ["index.js"] },
    };

    expect(validate(manifest)).toBe(true);
  });

  it("should reject invalid or incomplete lifecycle metadata", () => {
    const base = {
      id: "stack:test",
      kind: "stack",
      name: "Test Stack",
      version: "1.0.0",
      delivery: "remote",
      install: { source: "catalog", path: "catalog/stacks/test" },
      runtime: "node",
      provides: { tools: ["test_tool"] },
      mcp: { transport: "stdio", command: "node" },
    };

    expect(validate({
      ...base,
      lifecycle: { maturity: "beta", support: "supported" },
    })).toBe(false);
    expect(validate({
      ...base,
      lifecycle: {
        maturity: "stable",
        support: "unsupported",
        deprecation: { announcedAt: "2026-08-02" },
      },
    })).toBe(false);
    expect(validate({
      ...base,
      lifecycle: { maturity: "stable", support: "supported", unknown: true },
    })).toBe(false);
  });

  it("should accept minimal skill manifest", () => {
    const manifest = {
      id: "skill:grill-with-docs",
      kind: "skill",
      name: "Grill With Docs",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/skills/grill-with-docs.md",
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept skill manifest requiring stack package ids", () => {
    const manifest = {
      id: "skill:shortform-your-words-script",
      kind: "skill",
      name: "Shortform Your-Words Script",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/skills/shortform-your-words-script.md",
      },
      requires: {
        stacks: ["stack:video-editor"],
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept agent manifest with npm source", () => {
    const manifest = {
      id: "agent:claude",
      kind: "agent",
      name: "Claude",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "npm",
        package: "@anthropic/claude-code",
      },
      bins: ["claude"],
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept a detected system-installed agent", () => {
    const manifest = {
      id: "agent:antigravity",
      kind: "agent",
      name: "Antigravity CLI",
      version: "system",
      delivery: "system",
      install: { source: "system" },
      bins: ["agy"],
      detect: { command: "agy --version", expectExitCode: 0 },
    };

    expect(validate(manifest)).toBe(true);
  });

  it("should accept full binary manifest with all optional fields", () => {
    const manifest = {
      id: "binary:ffmpeg",
      kind: "binary",
      name: "FFmpeg",
      version: "7.1",
      delivery: "remote",
      install: {
        source: "download",
        platforms: {
          "darwin-arm64": {
            url: "https://example.com/ffmpeg-darwin-arm64.zip",
            checksum: { algo: "sha256", value: "a".repeat(64) },
            extract: { type: "zip", strip: 1 },
          },
          "darwin-x64": {
            url: "https://example.com/ffmpeg-darwin-x64.zip",
            checksum: { algo: "sha256", value: "b".repeat(64) },
            extract: { type: "zip" },
          },
          "linux-x64": {
            url: "https://example.com/ffmpeg-linux-x64.tar.gz",
            checksum: { algo: "sha256", value: "c".repeat(64) },
            extract: { type: "tar.gz", strip: 1 },
          },
        },
      },
      bins: {
        ffmpeg: { path: "ffmpeg" },
        ffprobe: { path: "ffprobe" },
      },
      detect: {
        command: "ffmpeg -version",
        expectExitCode: 0,
      },
      installHints: {
        brew: "brew install ffmpeg",
        apt: "sudo apt install ffmpeg",
      },
      meta: {
        description: "Audio/video processing toolkit",
        category: "media",
        tags: ["video", "audio"],
        icon: "🎬",
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept stack with requires and provides", () => {
    const manifest = {
      id: "stack:video-editor",
      kind: "stack",
      name: "Video Editor",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/video-editor",
      },
      runtime: "node",
      requires: {
        binaries: ["ffmpeg"],
        secrets: [
          {
            key: "API_KEY",
            label: "API Key",
            required: true,
            helpUrl: "https://example.com/docs",
          },
        ],
      },
      provides: {
        tools: ["video_trim", "video_speed", "video_concat"],
      },
      related: {
        operatorSkill: "skill:rudi-video-editor",
        skills: ["skill:rudi-video-editor", "skill:shortform-your-words-script"],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["tsx", "src/index.ts"],
        cwd: ".",
        env: { NODE_ENV: "production" },
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should reject related.skills entries that are not skill package ids", () => {
    const manifest = {
      id: "stack:video-editor",
      kind: "stack",
      name: "Video Editor",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/video-editor",
      },
      runtime: "node",
      provides: {
        tools: ["video_trim"],
      },
      related: {
        skills: ["stack:video-editor"],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(false);
    expect(getErrorMessages(validate)).toContainEqual(
      expect.stringContaining("pattern")
    );
  });

  it("should reject related.operatorSkill when it is not a skill package id", () => {
    const manifest = {
      id: "stack:video-editor",
      kind: "stack",
      name: "Video Editor",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "catalog",
        path: "catalog/stacks/video-editor",
      },
      runtime: "node",
      provides: {
        tools: ["video_trim"],
      },
      related: {
        operatorSkill: "stack:video-editor",
        skills: ["skill:rudi-video-editor"],
      },
      mcp: {
        transport: "stdio",
        command: "npx",
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(false);
    expect(getErrorMessages(validate)).toContainEqual(
      expect.stringContaining("pattern")
    );
  });

  it("should accept platform with system override to download", () => {
    const manifest = {
      id: "binary:sqlite",
      kind: "binary",
      name: "SQLite",
      version: "system",
      delivery: "system",
      install: {
        source: "system",
        platforms: {
          darwin: { preinstalled: true },
          linux: { preinstalled: false },
          "win32-x64": {
            source: "download",
            delivery: "remote",
            url: "https://sqlite.org/sqlite-tools-win-x64.zip",
            checksum: { algo: "sha256", value: "d".repeat(64) },
            extract: { type: "zip" },
          },
        },
      },
      bins: ["sqlite3"],
      detect: {
        command: "sqlite3 --version",
        expectExitCode: 0,
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("schema validation - edge cases", () => {
  it("should accept bins as array of strings", () => {
    const manifest = {
      id: "binary:test",
      kind: "binary",
      name: "Test",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "download",
        platforms: {
          "darwin-arm64": {
            url: "https://example.com/test.zip",
            checksum: { algo: "sha256", value: "a".repeat(64) },
          },
        },
      },
      bins: ["bin1", "bin2"],
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept bins as object with path", () => {
    const manifest = {
      id: "binary:test",
      kind: "binary",
      name: "Test",
      version: "1.0.0",
      delivery: "remote",
      install: {
        source: "download",
        platforms: {
          "darwin-arm64": {
            url: "https://example.com/test.zip",
            checksum: { algo: "sha256", value: "a".repeat(64) },
          },
        },
      },
      bins: {
        bin1: { path: "bin1" },
        bin2: { path: "subdir/bin2" },
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept http mcp transport", () => {
    const manifest = {
      id: "stack:http-server",
      kind: "stack",
      name: "HTTP Server",
      version: "1.0.0",
      delivery: "remote",
      install: { source: "catalog", path: "catalog/stacks/http-server" },
      runtime: "node",
      provides: { tools: ["http_get"] },
      mcp: {
        transport: "http",
        command: "node",
        args: ["server.js"],
      },
    };

    const valid = validate(manifest);
    expect(valid).toBe(true);
  });

  it("should accept all valid runtimes", () => {
    const runtimes = ["node", "python", "deno", "bun"];

    for (const runtime of runtimes) {
      const manifest = {
        id: `stack:test-${runtime}`,
        kind: "stack",
        name: `Test ${runtime}`,
        version: "1.0.0",
        delivery: "remote",
        install: { source: "catalog", path: `catalog/stacks/test-${runtime}` },
        runtime,
        provides: { tools: ["test_tool"] },
        mcp: {
          transport: "stdio",
          command: runtime,
          args: ["index.js"],
        },
      };

      const valid = validate(manifest);
      expect(valid).toBe(true);
    }
  });

  it("should accept all valid extract types", () => {
    const extractTypes = ["zip", "tar.gz", "tar.xz", "raw"];

    for (const type of extractTypes) {
      const manifest = {
        id: "binary:test",
        kind: "binary",
        name: "Test",
        version: "1.0.0",
        delivery: "remote",
        install: {
          source: "download",
          platforms: {
            "darwin-arm64": {
              url: `https://example.com/test.${type}`,
              checksum: { algo: "sha256", value: "a".repeat(64) },
              extract: { type },
            },
          },
        },
        bins: ["test"],
      };

      const valid = validate(manifest);
      expect(valid).toBe(true);
    }
  });
});
