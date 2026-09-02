import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { supportsTrustedPublishingNpm } from "../scripts/validate-publish-runtime.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function workflowJob(workflow: string, name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  expect(start, `workflow job ${name} must exist`).not.toBe(-1);
  const contentStart = start + marker.length;
  const nextJobOffset = workflow
    .slice(contentStart)
    .search(/\n  [A-Za-z0-9_-]+:\n/);
  return nextJobOffset === -1
    ? workflow.slice(start)
    : workflow.slice(start, contentStart + nextJobOffset);
}

describe("SWE Engineering package publication", () => {
  it("enforces npm's complete trusted-publishing minimum version", () => {
    expect(supportsTrustedPublishingNpm("10.6.2")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.4.99")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.0")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.1-alpha.0")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.1-rc.1")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.1")).toBe(true);
    expect(supportsTrustedPublishingNpm("11.6.0")).toBe(true);
    expect(supportsTrustedPublishingNpm("12.0.0")).toBe(true);
    expect(supportsTrustedPublishingNpm("11.5.1+build.1")).toBe(true);
    expect(supportsTrustedPublishingNpm("invalid")).toBe(false);
  });

  it("uses an exact, manual, main-only trusted-publishing workflow", () => {
    const workflow = read(".github/workflows/publish-swe-engineering-stack.yml");
    const verifyJob = workflowJob(workflow, "verify");
    const publishJob = workflowJob(workflow, "publish");
    const workflowHeader = workflow.slice(0, workflow.indexOf("\njobs:\n"));
    const packageJson = JSON.parse(
      read("catalog/stacks/swe-engineering/package.json"),
    ) as {
      name: string;
      version: string;
      repository: { url: string; directory: string };
      publishConfig: { access: string };
    };

    expect(packageJson.name).toBe("@rudi/swe-engineering-stack");
    expect(packageJson.version).toBe("0.2.0");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/learnrudi/registry.git",
      directory: "catalog/stacks/swe-engineering",
    });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(workflow).toMatch(/^name: Publish @rudi\/swe-engineering-stack$/m);
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:$/m);
    expect(workflowHeader).toMatch(/^\s{2}contents: read$/m);
    expect(workflowHeader).not.toMatch(/id-token:/);
    expect(verifyJob).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
    expect(verifyJob).toMatch(/permissions:\n\s{6}contents: read/);
    expect(verifyJob).not.toMatch(/id-token:/);
    expect(publishJob).toMatch(/needs: verify/);
    expect(publishJob).toMatch(
      /permissions:\n\s{6}contents: read\n\s{6}id-token: write/,
    );
    expect(workflow).toMatch(
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
    );
    expect(workflow).toMatch(
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    );
    expect(workflow).toMatch(/node-version: ['"]24['"]/);
    expect(workflow).toMatch(
      /registry-url: ['"]https:\/\/registry\.npmjs\.org['"]/,
    );
    expect(workflow).toMatch(/package-manager-cache: false/);
    expect(workflow).toMatch(
      /node \.\.\/\.\.\/\.\.\/scripts\/validate-publish-runtime\.mjs/,
    );
    expect(verifyJob).toMatch(/npm ci --ignore-scripts/);
    expect(verifyJob).toMatch(/npm test/);
    expect(verifyJob).toMatch(
      /npm audit --omit=dev --audit-level=moderate/,
    );
    expect(publishJob).not.toMatch(
      /npm ci|npm test|npm audit|scripts\/validate-publish-runtime/,
    );
    expect(publishJob).toMatch(/ref: \$\{\{ github\.sha \}\}/);
    expect(publishJob).toMatch(/persist-credentials: false/);
    expect(workflow).toMatch(/registry\.npmjs\.org\/\$\{encodedName\}/);
    expect(workflow).toMatch(/npm pack --json --pack-destination/);
    expect(workflow).toMatch(/expectedFiles/);
    expect(verifyJob).toMatch(/npm pack --json --pack-destination/);
    expect(publishJob).toMatch(/npm pack --json --pack-destination/);
    expect(workflow).toMatch(
      /npm publish "\$RUNNER_TEMP\/\$PACKAGE_TARBALL" --access public --ignore-scripts/,
    );
    expect(publishJob).toMatch(
      /--registry=https:\/\/registry\.npmjs\.org/,
    );
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
  });
});
