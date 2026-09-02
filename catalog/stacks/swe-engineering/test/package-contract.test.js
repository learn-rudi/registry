import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));

async function collectFiles(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "node_modules"].includes(entry.name)) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(directory, next));
    else if (entry.isFile()) files.push(next.replaceAll(path.sep, "/"));
  }
  return files;
}

test("package contract keeps the manual and tool surface portable", async () => {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(stackRoot, "package.json"), "utf8")
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );
  assert.equal(manifest.id, "stack:swe-engineering");
  assert.equal(manifest.version, "0.5.0");
  assert.deepEqual(manifest.related.skills, [
    "skill:swe-compliance-checklist",
    "skill:map-change-impact",
    "skill:rudi-chief-of-staff",
    "skill:horizontal-engineering-review",
    "skill:rudi-repo-steward",
    "skill:rudi-worktree-closeout",
  ]);
  assert.deepEqual(manifest.provides.tools, [
    "swe_manual_list",
    "swe_manual_read",
    "swe_manual_search",
    "swe_debt_scan",
  ]);
  assert.equal(manifest.surface, "both");
  assert.deepEqual(manifest.toolSurfaces, {
    swe_manual_list: "cloud-hosted",
    swe_manual_read: "cloud-hosted",
    swe_manual_search: "cloud-hosted",
    swe_debt_scan: "local-only",
  });
  assert.equal(packageJson.version, "0.2.0");
  assert.equal(packageJson.exports["./hosted"], "./src/hosted.js");

  const files = await collectFiles(stackRoot);
  assert.equal(files.includes(".DS_Store"), false);
  assert.equal(files.includes("AGENTS.md"), false);
  assert.equal(files.includes("CLAUDE.md"), false);
  const manualFiles = files.filter((file) => file.startsWith("src/manual/")).sort();
  assert.equal(manualFiles.length, 13);
  assert.equal(
    manualFiles.includes("src/manual/11-Agent-Copilot-Operating-Standard.md"),
    true
  );
  assert.equal(
    manualFiles.includes(
      "src/manual/12-Horizontal-Engineering-and-Codebase-Stewardship-Standard.md"
    ),
    true
  );
  assert.equal(
    manualFiles.includes("src/manual/13-RUDI-Agentic-Engineering-Standard.md"),
    true
  );
  const manualContent = (await Promise.all(
    manualFiles.map((file) => fs.readFile(path.join(stackRoot, file), "utf8"))
  )).join("\n");
  assert.equal(manualContent.includes("/Users/"), false);
});
