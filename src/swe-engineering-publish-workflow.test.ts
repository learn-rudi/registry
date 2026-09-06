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

    expect(packageJson.name).toBe("@learnrudi/swe-engineering-stack");
    expect(packageJson.version).toBe("0.5.0");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/learnrudi/registry.git",
      directory: "catalog/stacks/swe-engineering",
    });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(workflow).toMatch(
      /^name: Publish @learnrudi\/swe-engineering-stack$/m,
    );
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

  it("isolates the one-time first-package bootstrap credential", () => {
    const workflow = read(
      ".github/workflows/bootstrap-swe-engineering-stack.yml",
    );
    const verifyJob = workflowJob(workflow, "verify");
    const bootstrapJob = workflowJob(workflow, "bootstrap");
    const workflowHeader = workflow.slice(0, workflow.indexOf("\njobs:\n"));

    expect(workflow).toMatch(
      /^name: Bootstrap @learnrudi\/swe-engineering-stack@0\.2\.0$/m,
    );
    expect(workflow).toMatch(/^\s{2}workflow_dispatch:$/m);
    expect(workflow).toMatch(/^\s{6}accepted_sha:$/m);
    expect(workflow).toMatch(/^\s{6}confirmation:$/m);
    expect(workflow).not.toMatch(/inputs\.version/);
    expect(workflowHeader).toMatch(/^\s{2}contents: read$/m);
    expect(workflowHeader).not.toMatch(/id-token:/);
    expect(workflowHeader).not.toMatch(/NPM_BOOTSTRAP_TOKEN/);

    expect(verifyJob).toMatch(
      /github\.repository == 'learnrudi\/registry'/,
    );
    expect(verifyJob).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(verifyJob).toMatch(/permissions:\n\s{6}contents: read/);
    expect(verifyJob).not.toMatch(/id-token:|NPM_BOOTSTRAP_TOKEN/);
    expect(verifyJob).toMatch(/inputs\.accepted_sha/);
    expect(verifyJob).toMatch(
      /bootstrap @learnrudi\/swe-engineering-stack@0\.2\.0/,
    );
    expect(verifyJob).toMatch(/npm ci --ignore-scripts/);
    expect(verifyJob).toMatch(/npm test/);
    expect(verifyJob).toMatch(
      /npm audit --omit=dev --audit-level=moderate/,
    );
    expect(verifyJob).toMatch(/response\.status !== 404/);
    expect(verifyJob).toMatch(/npm pack --json --pack-destination/);

    expect(bootstrapJob).toMatch(/needs: verify/);
    expect(bootstrapJob).toMatch(
      /github\.repository == 'learnrudi\/registry'/,
    );
    expect(bootstrapJob).toMatch(/github\.ref == 'refs\/heads\/main'/);
    expect(bootstrapJob).toMatch(/environment: npm-bootstrap/);
    expect(bootstrapJob).toMatch(
      /permissions:\n\s{6}contents: read\n\s{6}id-token: write/,
    );
    expect(bootstrapJob).not.toMatch(
      /npm ci|npm test|npm audit|scripts\/validate-publish-runtime/,
    );
    expect(bootstrapJob).toMatch(/ref: \$\{\{ github\.sha \}\}/);
    expect(bootstrapJob).toMatch(/persist-credentials: false/);
    expect(bootstrapJob).toMatch(/inputs\.accepted_sha/);
    expect(bootstrapJob).toMatch(/response\.status !== 404/);
    expect(bootstrapJob).toMatch(/npm pack --json --pack-destination/);
    expect(bootstrapJob).toMatch(
      /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_BOOTSTRAP_TOKEN \}\}/,
    );
    expect(workflow.match(/secrets\.NPM_BOOTSTRAP_TOKEN/g)).toHaveLength(1);
    expect(workflow.match(/^\s+NODE_AUTH_TOKEN:/gm)).toHaveLength(1);
    expect(workflow.match(/NPM_BOOTSTRAP_TOKEN/g)).toHaveLength(2);
    expect(
      workflow.match(
        /EXPECTED_PACKAGE_TREE='a20da20c28a138c8ab537c367fa98b380f16ece1'/g,
      ),
    ).toHaveLength(2);
    expect(workflow.match(/runs-on: ubuntu-24\.04/g)).toHaveLength(2);
    expect(workflow.match(/node-version: '24\.19\.0'/g)).toHaveLength(2);
    expect(
      workflow.match(/NPM_VERSION" != '11\.17\.0'/g),
    ).toHaveLength(2);
    expect(
      workflow.split(
        "sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==",
      ),
    ).toHaveLength(3);
    expect(workflow.split("5b6fd58434ed3ccead4770365c7efd58c33622f3")).toHaveLength(
      3,
    );
    const credentialStep = bootstrapJob.slice(
      bootstrapJob.indexOf("- name: Publish first package with provenance"),
    );
    expect(credentialStep).toContain("authorization: `Bearer ${token}`");
    expect(credentialStep).toMatch(/response\.status !== 404/);
    expect(credentialStep).toMatch(
      /Authenticated npm package lookup failed with HTTP/,
    );
    expect(
      credentialStep.indexOf("authorization: `Bearer ${token}`"),
    ).toBeLessThan(
      credentialStep.indexOf('npm publish "$RUNNER_TEMP/$PACKAGE_TARBALL"'),
    );
    expect(bootstrapJob).toMatch(
      /npm publish "\$RUNNER_TEMP\/\$PACKAGE_TARBALL" --access public --ignore-scripts --provenance --registry=https:\/\/registry\.npmjs\.org/,
    );
    expect(workflow).toMatch(
      /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
    );
    expect(workflow).toMatch(
      /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/,
    );
  });
});
