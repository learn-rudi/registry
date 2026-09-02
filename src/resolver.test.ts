/**
 * RUDI Resolver Tests
 *
 * Tests platform resolution, override precedence, and policy validation.
 */

import { describe, it, expect } from "vitest";
import {
  resolve,
  resolveToolSurface,
  assertEffectivePolicy,
  PolicyError,
  type Package,
  type ResolveContext,
} from "./resolver.js";

// =============================================================================
// Test Fixtures
// =============================================================================

const minimalBinary: Package = {
  id: "binary:test",
  kind: "binary",
  name: "Test Binary",
  version: "1.0.0",
  delivery: "remote",
  install: {
    source: "download",
    platforms: {
      "darwin-arm64": {
        url: "https://example.com/test-darwin-arm64.zip",
        checksum: { algo: "sha256", value: "a".repeat(64) },
        extract: { type: "zip" },
      },
      "darwin-x64": {
        url: "https://example.com/test-darwin-x64.zip",
        checksum: { algo: "sha256", value: "b".repeat(64) },
        extract: { type: "zip" },
      },
      "linux-x64": {
        url: "https://example.com/test-linux-x64.tar.gz",
        checksum: { algo: "sha256", value: "c".repeat(64) },
        extract: { type: "tar.gz" },
      },
    },
  },
  bins: ["test"],
  detect: { command: "test --version", expectExitCode: 0 },
};

const systemBinary: Package = {
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
        url: "https://sqlite.org/2024/sqlite-tools-win-x64.zip",
        checksum: { algo: "sha256", value: "d".repeat(64) },
        extract: { type: "zip" },
      },
    },
  },
  bins: ["sqlite3"],
  detect: { command: "sqlite3 --version", expectExitCode: 0 },
};

const minimalStack: Package = {
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
  requires: { binaries: ["ffmpeg"], secrets: [] },
  provides: { tools: ["video_trim", "video_speed"] },
  mcp: {
    transport: "stdio",
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: ".",
  },
};

// =============================================================================
// Platform Resolution Tests
// =============================================================================

describe("resolve", () => {
  describe("platform fallback", () => {
    it("should match exact platform key (darwin-arm64)", () => {
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(minimalBinary, ctx);

      expect(resolved._resolved.platformKey).toBe("darwin-arm64");
      expect(resolved._resolved.keysTried).toEqual([
        "darwin-arm64",
        "darwin",
        "default",
      ]);
      expect(resolved.install.platforms?.["darwin-arm64"]?.url).toBe(
        "https://example.com/test-darwin-arm64.zip"
      );
    });

    it("should fallback to OS-only key when exact not found", () => {
      const pkg: Package = {
        ...minimalBinary,
        install: {
          source: "download",
          platforms: {
            darwin: {
              url: "https://example.com/test-darwin.zip",
              checksum: { algo: "sha256", value: "e".repeat(64) },
              extract: { type: "zip" },
            },
          },
        },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved._resolved.platformKey).toBe("darwin");
    });

    it("should fallback to default when OS not found", () => {
      const pkg: Package = {
        ...minimalBinary,
        install: {
          source: "download",
          platforms: {
            default: {
              url: "https://example.com/test-default.zip",
              checksum: { algo: "sha256", value: "f".repeat(64) },
              extract: { type: "zip" },
            },
          },
        },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved._resolved.platformKey).toBe("default");
    });

    it("should return undefined platformKey when no match found", () => {
      const ctx: ResolveContext = { os: "win32", arch: "x64" };
      const resolved = resolve(minimalBinary, ctx);

      // win32-x64 not in minimalBinary platforms
      expect(resolved._resolved.platformKey).toBeUndefined();
      expect(resolved._resolved.platform).toBeUndefined();
    });
  });

  describe("override precedence", () => {
    it("should override source from platform", () => {
      const ctx: ResolveContext = { os: "win32", arch: "x64" };
      const resolved = resolve(systemBinary, ctx);

      // Top-level is system, but win32-x64 overrides to download
      expect(resolved.install.source).toBe("download");
    });

    it("should override delivery from platform", () => {
      const ctx: ResolveContext = { os: "win32", arch: "x64" };
      const resolved = resolve(systemBinary, ctx);

      // Top-level is system, but win32-x64 overrides to remote
      expect(resolved.delivery).toBe("remote");
    });

    it("should preserve top-level fields when platform doesn't override", () => {
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(systemBinary, ctx);

      // darwin platform doesn't override source
      expect(resolved.install.source).toBe("system");
      expect(resolved.delivery).toBe("system");
    });

    it("should merge nested objects with platform winning", () => {
      const pkg: Package = {
        ...minimalBinary,
        detect: { command: "test --version", expectExitCode: 0 },
        install: {
          source: "download",
          platforms: {
            "darwin-arm64": {
              url: "https://example.com/test.zip",
              checksum: { algo: "sha256", value: "g".repeat(64) },
              detect: { command: "test -v", expectExitCode: 1 },
            },
          },
        },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      // Platform detect should win
      expect(resolved.detect?.command).toBe("test -v");
      expect(resolved.detect?.expectExitCode).toBe(1);
    });
  });

  describe("catalog path derivation", () => {
    it("should derive stack path from id when omitted", () => {
      const pkg: Package = {
        ...minimalStack,
        install: { source: "catalog" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved.install.path).toBe("catalog/stacks/video-editor");
    });

    it("should derive prompt path from id when omitted", () => {
      const pkg: Package = {
        id: "prompt:code-review",
        kind: "prompt",
        name: "Code Review",
        version: "1.0.0",
        delivery: "remote",
        install: { source: "catalog" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved.install.path).toBe("catalog/prompts/code-review.md");
    });

    it("should derive skill path from id when omitted", () => {
      const pkg: Package = {
        id: "skill:grill-with-docs",
        kind: "skill",
        name: "Grill With Docs",
        version: "1.0.0",
        delivery: "remote",
        install: { source: "catalog" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved.install.path).toBe("catalog/skills/grill-with-docs.md");
    });

    it("should not override explicit path", () => {
      const pkg: Package = {
        ...minimalStack,
        install: { source: "catalog", path: "custom/path/video-editor" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(resolved.install.path).toBe("custom/path/video-editor");
    });
  });
});

// =============================================================================
// Policy Validation Tests
// =============================================================================

describe("assertEffectivePolicy", () => {
  describe("lifecycle constraints", () => {
    it("rejects a removal date before the deprecation announcement", () => {
      const pkg: Package = {
        ...minimalStack,
        lifecycle: {
          maturity: "stable",
          support: "maintenance",
          deprecation: {
            announcedAt: "2026-08-02",
            message: "Use stack:replacement.",
            replacementId: "stack:replacement",
            removalAfter: "2026-08-01",
          },
        },
      };
      const resolved = resolve(pkg, { os: "darwin", arch: "arm64" });

      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "lifecycle.deprecation.removalAfter must not precede announcedAt"
      );
    });

    it("rejects a package that names itself as its replacement", () => {
      const pkg: Package = {
        ...minimalStack,
        lifecycle: {
          maturity: "stable",
          support: "maintenance",
          deprecation: {
            announcedAt: "2026-08-02",
            message: "This package has no replacement.",
            replacementId: minimalStack.id,
          },
        },
      };
      const resolved = resolve(pkg, { os: "darwin", arch: "arm64" });

      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "lifecycle.deprecation.replacementId cannot reference the same package"
      );
    });
  });

  describe("kind constraints", () => {
    it("should require runtime to use download source", () => {
      const pkg: Package = {
        id: "runtime:node",
        kind: "runtime",
        name: "Node.js",
        version: "20.10.0",
        delivery: "remote",
        install: { source: "system" },
        detect: { command: "node --version" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "runtime must use install.source=download"
      );
    });

    it("should allow a system-installed agent with explicit detection", () => {
      const pkg: Package = {
        id: "agent:antigravity",
        kind: "agent",
        name: "Antigravity CLI",
        version: "system",
        delivery: "system",
        install: { source: "system" },
        bins: ["agy"],
        detect: { command: "agy --version", expectExitCode: 0 },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).not.toThrow();
    });

    it("should require externally managed agents to use the system source", () => {
      const pkg: Package = {
        id: "agent:claude",
        kind: "agent",
        name: "Claude",
        version: "1.0.0",
        delivery: "remote",
        install: { source: "pip", package: "claude" },
        bins: ["claude"],
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "agent must use system delivery and install.source=system"
      );
    });

    it("should reject npm-installed agents", () => {
      const pkg: Package = {
        id: "agent:codex",
        kind: "agent",
        name: "Codex",
        version: "latest",
        delivery: "remote",
        install: { source: "npm", package: "@openai/codex" },
        bins: ["codex"],
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "agent must use system delivery and install.source=system"
      );
    });

    it("should require stack to use catalog source", () => {
      const pkg: Package = {
        ...minimalStack,
        install: { source: "download" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "stack must use install.source=catalog"
      );
    });
  });

  describe("download source constraints", () => {
    it("should reject version=latest for downloads", () => {
      const pkg: Package = {
        ...minimalBinary,
        version: "latest",
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "downloads cannot use version=latest"
      );
    });

    it("should require url on resolved platform for downloads", () => {
      const pkg: Package = {
        ...minimalBinary,
        install: {
          source: "download",
          platforms: {
            "darwin-arm64": {
              checksum: { algo: "sha256", value: "h".repeat(64) },
            },
          },
        },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow("requires url");
    });

    it("should require checksum on resolved platform for downloads", () => {
      const pkg: Package = {
        ...minimalBinary,
        install: {
          source: "download",
          platforms: {
            "darwin-arm64": {
              url: "https://example.com/test.zip",
            },
          },
        },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow("requires checksum");
    });
  });

  describe("system source constraints", () => {
    it("should require detect.command for system delivery", () => {
      const pkg: Package = {
        id: "binary:git",
        kind: "binary",
        name: "Git",
        version: "system",
        delivery: "system",
        install: { source: "system" },
        bins: ["git"],
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "system delivery/source requires detect.command"
      );
    });

    it("should pass when detect.command is provided", () => {
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(systemBinary, ctx);

      expect(() => assertEffectivePolicy(resolved)).not.toThrow();
    });
  });

  describe("npm/pip source constraints", () => {
    it("should require package field for npm source", () => {
      const pkg: Package = {
        id: "binary:test",
        kind: "binary",
        name: "Test Binary",
        version: "1.0.0",
        delivery: "remote",
        install: { source: "npm" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "npm requires install.package"
      );
    });

    it("should reject npm source for agents even when package is provided", () => {
      const pkg: Package = {
        id: "agent:test",
        kind: "agent",
        name: "Test Agent",
        version: "1.0.0",
        delivery: "remote",
        install: { source: "npm", package: "@test/agent" },
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "agent must use system delivery and install.source=system"
      );
    });
  });

  describe("stack constraints", () => {
    it("defaults unclassified stacks and omitted tools on both surfaces to local-only", () => {
      expect(resolveToolSurface(minimalStack, "video_trim")).toBe("local-only");
      expect(
        resolveToolSurface({ ...minimalStack, surface: "both" }, "video_trim")
      ).toBe("local-only");
    });

    it("resolves only declared explicit tool surfaces", () => {
      const pkg: Package = {
        ...minimalStack,
        surface: "both",
        toolSurfaces: {
          video_trim: "cloud-hosted",
          video_speed: "local-only",
        },
      };

      expect(resolveToolSurface(pkg, "video_trim")).toBe("cloud-hosted");
      expect(resolveToolSurface(pkg, "video_speed")).toBe("local-only");
      expect(() => resolveToolSurface(pkg, "video_unknown")).toThrow(
        "tool is not declared"
      );
    });

    it("rejects local-only elevation and overrides for undeclared tools", () => {
      const elevated = resolve(
        {
          ...minimalStack,
          surface: "local-only",
          toolSurfaces: { video_trim: "cloud-hosted" },
        },
        { os: "darwin", arch: "arm64" }
      );
      const unknown = resolve(
        {
          ...minimalStack,
          surface: "both",
          toolSurfaces: { video_unknown: "cloud-hosted" },
        },
        { os: "darwin", arch: "arm64" }
      );

      expect(() => assertEffectivePolicy(elevated)).toThrow(
        "local-only stack cannot elevate tool video_trim"
      );
      expect(() => assertEffectivePolicy(unknown)).toThrow(
        "toolSurfaces key video_unknown is not declared"
      );
      expect(() => resolveToolSurface(elevated, "video_trim")).toThrow(
        "local-only stack cannot elevate tool video_trim"
      );
      expect(() => resolveToolSurface({
        ...minimalStack,
        toolSurfaces: { video_trim: "cloud-hosted" },
      }, "video_trim")).toThrow(
        "local-only stack cannot elevate tool video_trim"
      );
      expect(() => resolveToolSurface(unknown, "video_trim")).toThrow(
        "toolSurfaces key video_unknown is not declared"
      );
    });

    it("should require runtime field for stacks", () => {
      const pkg: Package = {
        ...minimalStack,
        runtime: undefined,
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "stack requires runtime field"
      );
    });

    it("should require mcp field for stacks", () => {
      const pkg: Package = {
        ...minimalStack,
        mcp: undefined,
      };
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(pkg, ctx);

      expect(() => assertEffectivePolicy(resolved)).toThrow(PolicyError);
      expect(() => assertEffectivePolicy(resolved)).toThrow(
        "stack requires mcp field"
      );
    });

    it("should pass for valid stack", () => {
      const ctx: ResolveContext = { os: "darwin", arch: "arm64" };
      const resolved = resolve(minimalStack, ctx);

      expect(() => assertEffectivePolicy(resolved)).not.toThrow();
    });
  });
});

// =============================================================================
// Snapshot Tests for Platform Resolution
// =============================================================================

describe("platform resolution snapshots", () => {
  const platforms: ResolveContext[] = [
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "x64" },
    { os: "linux", arch: "x64" },
    { os: "linux", arch: "arm64" },
    { os: "win32", arch: "x64" },
  ];

  describe("sqlite resolution across platforms", () => {
    for (const ctx of platforms) {
      it(`should resolve correctly for ${ctx.os}-${ctx.arch}`, () => {
        const resolved = resolve(systemBinary, ctx);
        expect({
          platformKey: resolved._resolved.platformKey,
          source: resolved.install.source,
          delivery: resolved.delivery,
          hasUrl: !!resolved._resolved.platform?.url,
        }).toMatchSnapshot();
      });
    }
  });

  describe("binary resolution across platforms", () => {
    for (const ctx of platforms) {
      it(`should resolve correctly for ${ctx.os}-${ctx.arch}`, () => {
        const resolved = resolve(minimalBinary, ctx);
        expect({
          platformKey: resolved._resolved.platformKey,
          source: resolved.install.source,
          hasUrl: !!resolved._resolved.platform?.url,
          url: resolved._resolved.platform?.url,
        }).toMatchSnapshot();
      });
    }
  });
});
