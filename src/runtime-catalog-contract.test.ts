import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type RuntimeManifest = {
  id: string;
  version: string;
  install: {
    platforms: Record<string, {
      url?: string;
      checksum?: {
        algo?: string;
        value?: string;
      };
      extract?: {
        type?: string;
        strip?: number;
      };
    }>;
  };
  bins?: Record<string, { path?: string }>;
};

async function loadRuntime(name: string): Promise<RuntimeManifest> {
  const manifestPath = path.resolve(
    import.meta.dirname,
    `../catalog/runtimes/${name}.json`
  );
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

describe("Python runtime catalog contract", () => {
  it("strips the single archive root for every supported Darwin platform", async () => {
    const manifest = await loadRuntime("python");

    for (const platform of ["darwin-arm64", "darwin-x64"]) {
      expect(manifest.install.platforms[platform]?.extract).toEqual({
        type: "tar.gz",
        strip: 1,
      });
    }
  });
});

describe("Node runtime catalog contract", () => {
  it("publishes Node 20.20.2 side-by-side without replacing the shared Node runtime", async () => {
    const [shared, versioned] = await Promise.all([
      loadRuntime("node"),
      loadRuntime("node-20-20-2"),
    ]);

    expect(shared).toMatchObject({
      id: "runtime:node",
      version: "20.10.0",
    });
    expect(versioned).toMatchObject({
      id: "runtime:node-20-20-2",
      version: "20.20.2",
      bins: {
        node: { path: "bin/node" },
        npm: { path: "bin/npm" },
        npx: { path: "bin/npx" },
      },
    });

    const expectedPlatforms = {
      "darwin-arm64": {
        checksum: "466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6",
      },
      "darwin-x64": {
        checksum: "8be6f5e4bb128c82774f8a0b8d7a1cc1365a7977d9657cece0ca647b3fe04e61",
      },
      "linux-arm64": {
        checksum: "47ef73d543ecf6eb19435f6c03a0ac4809b3bf0dd6b26c7c571efc2a6572a74d",
      },
      "linux-x64": {
        checksum: "19e56f0825510207dd904f087fe52faa0a4eb6b2aab5f0ea7a33830d04888b8b",
      },
    } as const;

    expect(Object.keys(versioned.install.platforms).sort()).toEqual(
      Object.keys(expectedPlatforms).sort()
    );

    for (const [platform, expected] of Object.entries(expectedPlatforms)) {
      expect(versioned.install.platforms[platform]).toEqual({
        url: `https://nodejs.org/dist/v20.20.2/node-v20.20.2-${platform}.tar.gz`,
        checksum: {
          algo: "sha256",
          value: expected.checksum,
        },
        extract: {
          type: "tar.gz",
          strip: 1,
        },
      });
    }
  });
});
