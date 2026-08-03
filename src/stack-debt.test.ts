import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { auditStackModuleSizes } from "./stack-debt.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rudi-stack-debt-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("auditStackModuleSizes", () => {
  it("allows recorded debt without allowing new oversized modules or growth", async () => {
    const source = "catalog/stacks/demo/src/index.ts";
    const sourceFile = path.join(tmpDir, source);
    await fs.mkdir(path.dirname(sourceFile), { recursive: true });
    await fs.writeFile(sourceFile, "one\ntwo\nthree\nfour\n");

    await expect(auditStackModuleSizes(tmpDir, ["stack:demo"], {
      schemaVersion: 1,
      maxLines: 3,
      oversized: { [source]: 4 },
    })).resolves.toEqual([]);

    await fs.appendFile(sourceFile, "five\n");
    await expect(auditStackModuleSizes(tmpDir, ["stack:demo"], {
      schemaVersion: 1,
      maxLines: 3,
      oversized: { [source]: 4 },
    })).resolves.toEqual([
      expect.objectContaining({
        packageId: "stack:demo",
        path: source,
        lines: 5,
        allowedLines: 4,
        code: "oversized-module-growth",
      }),
    ]);

    await expect(auditStackModuleSizes(tmpDir, ["stack:demo"], {
      schemaVersion: 1,
      maxLines: 3,
      oversized: {},
    })).resolves.toEqual([
      expect.objectContaining({ code: "new-oversized-module" }),
    ]);
  });
});
