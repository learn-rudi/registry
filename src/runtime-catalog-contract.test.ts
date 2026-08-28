import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type RuntimeManifest = {
  install: {
    platforms: Record<string, {
      extract?: {
        type?: string;
        strip?: number;
      };
    }>;
  };
};

async function loadPythonRuntime(): Promise<RuntimeManifest> {
  const manifestPath = path.resolve(
    import.meta.dirname,
    "../catalog/runtimes/python.json"
  );
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

describe("Python runtime catalog contract", () => {
  it("strips the single archive root for every supported Darwin platform", async () => {
    const manifest = await loadPythonRuntime();

    for (const platform of ["darwin-arm64", "darwin-x64"]) {
      expect(manifest.install.platforms[platform]?.extract).toEqual({
        type: "tar.gz",
        strip: 1,
      });
    }
  });
});
