import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { syncIndexFiles } from "./index-sync.js";

describe("index synchronization", () => {
  it("writes the v2 index to the unversioned root without compatibility aliases", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-index-sync-"));
    try {
      await fs.mkdir(path.join(root, "dist"), { recursive: true });
      await fs.writeFile(path.join(root, "dist/index.json"), JSON.stringify({
        schemaVersion: "2",
        packages: {},
        aliases: {},
      }, null, 2) + "\n");

      await syncIndexFiles(root, "write");

      const rootIndex = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
      expect(rootIndex.schemaVersion).toBe("2");
      await expect(fs.access(path.join(root, "index.v2.json"))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
