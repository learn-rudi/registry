import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidenceRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(evidenceRoot, "../../..");
const planPath = path.join(repositoryRoot, ".rudi/orchestration/plan.json");
const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
const prefix = "artifact://rudi-engineering-skills/";
let verified = 0;

for (const node of plan.nodes) {
  for (const reconciliation of node.reconciliations) {
    for (const evidence of reconciliation.evidence) {
      assert.ok(
        evidence.uri.startsWith(prefix),
        `unsupported task-local evidence URI: ${evidence.uri}`
      );
      const relativePath = decodeURIComponent(evidence.uri.slice(prefix.length));
      assert.ok(relativePath && !path.isAbsolute(relativePath));
      const artifactPath = path.resolve(repositoryRoot, relativePath);
      assert.ok(
        artifactPath.startsWith(repositoryRoot + path.sep),
        `evidence escapes repository: ${evidence.uri}`
      );
      const content = await fs.readFile(artifactPath);
      const actual = `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`;
      assert.equal(actual, evidence.digest, `${evidence.uri} digest mismatch`);
      verified += 1;
    }
  }
}

process.stdout.write(
  JSON.stringify({ verified: true, evidenceRecords: verified }, null, 2) + "\n"
);
