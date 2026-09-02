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

describe("SWE Engineering package publication", () => {
  it("enforces npm's complete trusted-publishing minimum version", () => {
    expect(supportsTrustedPublishingNpm("10.6.2")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.4.99")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.0")).toBe(false);
    expect(supportsTrustedPublishingNpm("11.5.1")).toBe(true);
    expect(supportsTrustedPublishingNpm("11.6.0")).toBe(true);
    expect(supportsTrustedPublishingNpm("12.0.0")).toBe(true);
    expect(supportsTrustedPublishingNpm("invalid")).toBe(false);
  });

  it("uses an exact, manual, main-only trusted-publishing workflow", () => {
    const workflow = read(".github/workflows/publish-swe-engineering-stack.yml");
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
    expect(workflow).toMatch(/^\s{2}contents: read$/m);
    expect(workflow).toMatch(/^\s{2}id-token: write$/m);
    expect(workflow).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
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
    expect(workflow).toMatch(/npm ci --ignore-scripts/);
    expect(workflow).toMatch(/npm test/);
    expect(workflow).toMatch(/npm audit --omit=dev --audit-level=moderate/);
    expect(workflow).toMatch(/registry\.npmjs\.org\/\$\{encodedName\}/);
    expect(workflow).toMatch(/npm pack --json --pack-destination/);
    expect(workflow).toMatch(/expectedFiles/);
    expect(workflow).toMatch(
      /npm publish "\$RUNNER_TEMP\/\$PACKAGE_TARBALL" --access public --ignore-scripts/,
    );
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN/);
  });
});
