import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("registry quality workflow", () => {
  it("enforces the mandatory quality gates for every quality-relevant change", async () => {
    const [workflow, packageJson] = await Promise.all([
      fs.readFile(path.join(repoRoot, ".github/workflows/registry.yml"), "utf8"),
      fs.readFile(path.join(repoRoot, "package.json"), "utf8").then(JSON.parse),
    ]);

    const requiredCommands = [
      "npm test",
      "npm run build",
      "npm run validate:public -- --json",
      "npm run indexes:check",
      "npm run catalog:clean:check",
      "npm run stacks:verify",
      "npm run release:verify",
      "npm run debt:scan",
      "npm pack --dry-run --json",
    ];
    for (const command of requiredCommands) {
      expect(workflow, `missing mandatory CI command: ${command}`).toContain(
        `run: ${command}`
      );
    }

    const requiredTriggerPaths = [
      ".github/workflows/**",
      ".debt-scan.json",
      ".stack-debt-baseline.json",
      "scripts/**",
      "package.json",
      "package-lock.json",
      "vitest.config.ts",
    ];
    for (const triggerPath of requiredTriggerPaths) {
      expect(workflow, `CI does not run when ${triggerPath} changes`).toContain(
        `- '${triggerPath}'`
      );
    }

    expect(
      workflow.match(/name: Configure deterministic source date/g),
      "validate and release jobs must preserve the committed index timestamp"
    ).toHaveLength(2);
    expect(workflow).toContain("SOURCE_DATE_EPOCH");
    expect(workflow).toContain("JSON.parse");
    expect(workflow).toContain("$GITHUB_ENV");

    expect(packageJson.scripts?.["debt:scan"]).toBeTypeOf("string");
    expect(packageJson.scripts["debt:scan"].trim()).not.toBe("");
  });

  it("packages ESM stack runtime modules", async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(repoRoot, "package.json"), "utf8")
    );

    expect(packageJson.files).toContain(
      "catalog/stacks/**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,py,txt}"
    );
  });
});
