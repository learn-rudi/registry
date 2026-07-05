import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validatePublicReadiness } from "./public-readiness.js";
import { CATALOG_PACKAGE_ARTIFACT_EXCLUDES } from "./catalog-artifacts.js";

let tmpDir: string;

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function writeText(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-registry-public-"));
  await fs.mkdir(path.join(tmpDir, "catalog/stacks/demo"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "catalog/skills"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "catalog/workflows"), { recursive: true });
  await writeJson(path.join(tmpDir, "package.json"), {
    name: "@rudi/registry-test",
    files: ["index.json", "catalog", "dist", ...CATALOG_PACKAGE_ARTIFACT_EXCLUDES],
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("validatePublicReadiness", () => {
  it("passes a minimal tracked registry", async () => {
    await writeJson(path.join(tmpDir, "index.json"), {
      packages: {
        stacks: {
          official: [
            {
              id: "stack:demo",
              path: "catalog/stacks/demo",
            },
          ],
        },
      },
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/manifest.json"), {
      id: "stack:demo",
      name: "Demo",
    });

    const report = await validatePublicReadiness(tmpDir, {
      trackedFiles: new Set([
        "index.json",
        "package.json",
        "catalog/stacks/demo/manifest.json",
      ]),
    });

    expect(report.summary.errors).toBe(0);
  });

  it("reports missing paths, untracked paths, placeholder checksums, and secret-like files", async () => {
    await writeJson(path.join(tmpDir, "index.json"), {
      packages: {
        stacks: {
          official: [
            { id: "stack:missing", path: "catalog/stacks/missing" },
            { id: "stack:untracked", path: "catalog/stacks/untracked" },
          ],
        },
      },
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/untracked/manifest.json"), {
      id: "stack:untracked",
      name: "Untracked",
    });
    await writeJson(path.join(tmpDir, "catalog/runtimes/v2/node.json"), {
      id: "runtime:node",
      checksum: { value: "0".repeat(64) },
    });
    await writeText(path.join(tmpDir, "catalog/stacks/untracked/token.json"), "{}");

    const report = await validatePublicReadiness(tmpDir, {
      trackedFiles: new Set(["index.json", "package.json"]),
    });
    const codes = report.issues.map((item) => item.code);

    expect(codes).toContain("index-path-missing");
    expect(codes).toContain("index-path-untracked");
    expect(codes).toContain("checksum-placeholder");
    expect(codes).toContain("secret-like-file");
    expect(report.summary.errors).toBeGreaterThanOrEqual(4);
  });

  it("reports tracked runtime artifacts inside catalog stack payloads", async () => {
    await writeJson(path.join(tmpDir, "index.json"), {
      packages: {
        stacks: {
          official: [
            {
              id: "stack:demo",
              path: "catalog/stacks/demo",
            },
          ],
        },
      },
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/manifest.json"), {
      id: "stack:demo",
      name: "Demo",
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/runs/leak.json"), {
      shouldNotShip: true,
    });

    const report = await validatePublicReadiness(tmpDir, {
      trackedFiles: new Set([
        "index.json",
        "package.json",
        "catalog/stacks/demo/manifest.json",
        "catalog/stacks/demo/runs/leak.json",
      ]),
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "forbidden-catalog-artifact",
        path: "catalog/stacks/demo/runs/leak.json",
      })
    );
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
  });

  it("reports package allowlists that do not exclude generated stack artifacts", async () => {
    await writeJson(path.join(tmpDir, "package.json"), {
      name: "@rudi/registry-test",
      files: ["index.json", "catalog/stacks/**/*.{js,json,md}", "dist"],
    });
    await writeJson(path.join(tmpDir, "index.json"), {
      packages: {
        stacks: {
          official: [
            {
              id: "stack:demo",
              path: "catalog/stacks/demo",
            },
          ],
        },
      },
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/demo/manifest.json"), {
      id: "stack:demo",
      name: "Demo",
    });

    const report = await validatePublicReadiness(tmpDir, {
      trackedFiles: new Set([
        "index.json",
        "package.json",
        "catalog/stacks/demo/manifest.json",
      ]),
    });

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "package-artifact-excludes-missing",
        path: "package.json",
      })
    );
  });

  it("reports stack binary requirements that cannot resolve to installable or detectable providers", async () => {
    await writeJson(path.join(tmpDir, "index.json"), {
      packages: {
        stacks: {
          official: [
            {
              id: "stack:media",
              path: "catalog/stacks/media",
            },
          ],
        },
        binaries: {
          official: [
            {
              id: "binary:ffmpeg",
              path: "catalog/binaries/ffmpeg.json",
            },
            {
              id: "binary:badtool",
              path: "catalog/binaries/badtool.json",
            },
          ],
        },
      },
    });
    await writeJson(path.join(tmpDir, "catalog/stacks/media/manifest.json"), {
      id: "stack:media",
      name: "Media",
      requires: {
        binaries: ["ffmpeg", "ffprobe", "missing-tool", "badtool"],
      },
    });
    await writeJson(path.join(tmpDir, "catalog/binaries/ffmpeg.json"), {
      id: "binary:ffmpeg",
      name: "FFmpeg",
      downloads: {
        "darwin-arm64": [
          {
            url: "https://example.com/ffmpeg.zip",
            type: "zip",
            binary: "ffmpeg",
          },
        ],
      },
      bins: ["ffmpeg", "ffprobe"],
    });
    await writeJson(path.join(tmpDir, "catalog/binaries/badtool.json"), {
      id: "binary:badtool",
      name: "Bad Tool",
    });

    const report = await validatePublicReadiness(tmpDir, {
      trackedFiles: new Set([
        "index.json",
        "package.json",
        "catalog/stacks/media/manifest.json",
        "catalog/binaries/ffmpeg.json",
        "catalog/binaries/badtool.json",
      ]),
    });
    const codes = report.issues.map((item) => item.code);

    expect(codes).toContain("stack-binary-requirement-unresolved");
    expect(codes).toContain("stack-binary-provider-uninstallable");
    expect(
      report.issues.some(
        (item) =>
          item.code === "stack-binary-requirement-unresolved" &&
          item.details?.binary === "missing-tool"
      )
    ).toBe(true);
    expect(
      report.issues.some(
        (item) =>
          item.code === "stack-binary-provider-uninstallable" &&
          item.details?.providerId === "binary:badtool"
      )
    ).toBe(true);
    expect(
      report.issues.some(
        (item) =>
          item.code === "stack-binary-requirement-unresolved" &&
          item.details?.binary === "ffprobe"
      )
    ).toBe(false);
  });
});
