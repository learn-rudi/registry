import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDebtScanArgs,
  listManualDocuments,
  readManualDocument,
  searchManual,
} from "../src/core.js";

test("manual list exposes the operating manual documents", async () => {
  const result = await listManualDocuments();

  assert.equal(result.documents.length, 11);
  assert.equal(result.documents[0].id, "master-engineering-doctrine");
  assert.equal(result.documents[10].id, "agent-copilot-operating-standard");
  assert.ok(result.documents.every((document) => document.bytes > 0));
});

test("manual read rejects path traversal and reads allowlisted documents", async () => {
  await assert.rejects(
    () => readManualDocument({ document: "../package.json" }),
    /Unknown manual document/
  );

  const result = await readManualDocument({
    document: "engineering-operating-manual-index",
    max_chars: 2000,
  });

  assert.equal(result.document.filename, "10-Engineering-Operating-Manual-Index.md");
  assert.match(result.content, /Engineering Operating Manual Index/);
});

test("manual search returns matching line references", async () => {
  const result = await searchManual({
    query: "red-green-refactor",
    max_results: 5,
  });

  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((match) => match.filename && match.line > 0));
});

test("debt scan command builder uses an allowlisted argument shape", () => {
  const result = buildDebtScanArgs({
    repo: process.cwd(),
    graph_root: "src",
    checks: ["logging", "large-files"],
    files: ["src/index.js", "test/core.test.js"],
  });

  assert.equal(result.command, process.execPath);
  assert.ok(result.args[0].endsWith("tools/agent-debt-scan.cjs"));
  assert.deepEqual(result.args.slice(1), [
    "--repo",
    process.cwd(),
    "--graph-root",
    "src",
    "--check",
    "logging",
    "--check",
    "large-files",
    "--files",
    "src/index.js,test/core.test.js",
    "--json",
  ]);
});

test("debt scanner does not load target repo TypeScript by default", () => {
  const repo = mkdtempSync(join(tmpdir(), "swe-debt-scan-target-"));
  const marker = join(repo, "target-typescript-loaded.txt");
  const scanner = fileURLToPath(new URL("../src/tools/agent-debt-scan.cjs", import.meta.url));

  try {
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(join(repo, "node_modules", "typescript"), { recursive: true });
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fixture" }, null, 2));
    writeFileSync(join(repo, "src", "index.ts"), "export const value = 1;\n");
    writeFileSync(
      join(repo, "node_modules", "typescript", "package.json"),
      JSON.stringify({ name: "typescript", version: "0.0.0", main: "index.js" }, null, 2)
    );
    writeFileSync(
      join(repo, "node_modules", "typescript", "index.js"),
      [
        "const fs = require('node:fs');",
        `fs.writeFileSync(${JSON.stringify(marker)}, 'loaded');`,
        "module.exports = {};",
      ].join("\n")
    );

    const result = spawnSync(process.execPath, [
      scanner,
      "--repo",
      repo,
      "--graph-root",
      "src",
      "--scope",
      "src",
      "--check",
      "logging",
      "--json",
    ], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
