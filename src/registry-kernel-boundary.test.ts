import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("registry kernel boundary", () => {
  it("keeps named stack package contracts out of the registry root suite", async () => {
    const entries = await fs.readdir(path.resolve("src"), { withFileTypes: true });
    const namedStackTests = entries
      .filter((entry) => entry.isFile() && /-stack\.test\.ts$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    expect(namedStackTests).toEqual([]);
  });

  it("exposes every existing Node stack test suite through scripts.verify", async () => {
    const stacksRoot = path.resolve("catalog/stacks");
    const entries = await fs.readdir(stacksRoot, { withFileTypes: true });
    const missingContracts: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageFile = path.join(stacksRoot, entry.name, "package.json");
      try {
        const packageJson = JSON.parse(await fs.readFile(packageFile, "utf8")) as {
          scripts?: Record<string, unknown>;
        };
        if (
          typeof packageJson.scripts?.test === "string" &&
          typeof packageJson.scripts?.verify !== "string"
        ) {
          missingContracts.push(entry.name);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }

    expect(missingContracts.sort()).toEqual([]);
  });
});
