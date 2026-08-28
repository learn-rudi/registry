import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));
const registryRoot = path.resolve(stackRoot, "../../..");
const skillRoot = path.join(registryRoot, "catalog", "skills", "rudi-repo-steward");
const closeoutContractPath = path.join(
  registryRoot,
  "catalog",
  "skills",
  "rudi-worktree-closeout",
  "references",
  "receipt-contract.md"
);

async function collectFiles(directory, relative = "") {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["node_modules", "dist"].includes(entry.name)) continue;
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(directory, next));
    else if (entry.isFile()) files.push(next.replaceAll(path.sep, "/"));
  }
  return files;
}

test("package contract keeps Repo Steward portable and non-mutating", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await fs.readFile(path.join(stackRoot, "package.json"), "utf8"));
  const readme = await fs.readFile(path.join(stackRoot, "README.md"), "utf8");
  const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const closeoutContract = await fs.readFile(closeoutContractPath, "utf8");

  assert.equal(manifest.id, "stack:repo-steward");
  assert.equal(manifest.version, "0.3.0");
  assert.deepEqual(manifest.requires, { binaries: ["git"], secrets: [] });
  assert.equal(manifest.related.operatorSkill, "skill:rudi-repo-steward");
  assert.ok(manifest.related.skills.includes("skill:rudi-worktree-closeout"));
  assert.ok(manifest.related.skills.includes("skill:github"));
  assert.deepEqual(manifest.provides.tools, [
    "repo_steward_preflight",
    "repo_steward_enroll_root",
    "repo_steward_discover_repositories",
    "repo_steward_scan_fleet",
    "repo_steward_get_status",
    "repo_steward_acquire_lease",
    "repo_steward_release_lease",
    "repo_steward_list_actions",
    "repo_steward_list_closeouts",
    "repo_steward_record_action",
    "repo_steward_record_closeout",
    "repo_steward_record_verification",
  ]);
  assert.equal(
    manifest.provides.tools.some((name) => /commit|push|merge|reset|clean|delete|create_issue|create_pr/.test(name)),
    false
  );
  assert.equal(packageJson.scripts.verify, "npm test");
  assert.equal(packageJson.version, "0.3.0");
  assert.match(skill, /- stack:repo-steward/);
  assert.match(skill, /- stack:github/);
  assert.match(readme, /REPO_STEWARD_CONFIG_PATH/);
  assert.match(readme, /one directory path/);
  assert.match(readme, /node_modules/);
  assert.match(readme, /never stages, commits, pushes, merges, resets, or cleans/);
  assert.match(readme, /cleanup_approved/);
  assert.match(closeoutContract, /`acceptance_reference`/);
  assert.match(closeoutContract, /`validation_evidence`: `command`, `outcome`, `exit_code`, `summary`, and `at`/);
  assert.match(closeoutContract, /`cleanup`: `eligible`, `reasons`, and `approval_reference`/);
  assert.doesNotMatch(closeoutContract, /`acceptance_lineage`|`cleanup_eligibility`/);

  const files = await collectFiles(stackRoot);
  assert.ok(files.includes("package-lock.json"));
  assert.equal(files.some((file) => file.includes(".DS_Store")), false);
  const portableContent = (await Promise.all(
    files
      .filter((file) => /\.(?:js|json|md)$/.test(file))
      .map((file) => fs.readFile(path.join(stackRoot, file), "utf8"))
  )).join("\n");
  const macHomePrefix = ["", "Users", ""].join("/");
  assert.equal(portableContent.includes(macHomePrefix), false);
});
