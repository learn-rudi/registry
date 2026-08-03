import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const MAX_MODULE_LINES = 800;
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    if (entry.isFile() && /\.(?:js|mjs|ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

test("content-extractor keeps each source module below the package boundary limit", async () => {
  const oversized = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const content = await readFile(file, "utf8");
    const lines = content.endsWith("\n")
      ? content.split(/\r?\n/).length - 1
      : content.split(/\r?\n/).length;
    if (lines > MAX_MODULE_LINES) {
      oversized.push({
        file: path.relative(sourceRoot, file).replaceAll(path.sep, "/"),
        lines,
      });
    }
  }

  assert.deepEqual(oversized, []);
});
