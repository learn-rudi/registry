import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const registryRoot = process.env.RUDI_REGISTRY_UNDER_TEST;

assert.ok(
  registryRoot,
  "RUDI_REGISTRY_UNDER_TEST must name the registry checkout under test"
);

for (const skillName of [
  "rudi-code-review",
  "rudi-decision-frontier",
  "rudi-diagnose",
  "rudi-human-runbook",
  "rudi-prototype",
  "rudi-stakeholder-questionnaire",
]) {
  test(`publishes the ${skillName} skill bundle`, async () => {
    const skillPath = path.join(
      registryRoot,
      "catalog/skills",
      skillName,
      "SKILL.md"
    );
    const skill = await fs.readFile(skillPath, "utf8");
    assert.match(skill, /^---\nname: /u);
    assert.match(skill, /## Authority Boundaries/u);
  });
}

test("validates an explicit schema-v2 Decision Frontier", async () => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "rudi-preimplementation-proof-")
  );
  try {
    const orchestrationRoot = path.join(temporaryRoot, ".rudi/orchestration");
    await fs.mkdir(orchestrationRoot, { recursive: true });
    const planPath = path.join(orchestrationRoot, "plan.json");
    await fs.writeFile(
      planPath,
      JSON.stringify(
        {
          schemaVersion: 2,
          projectId: "baseline-proof",
          runId: "run-baseline-proof",
          revision: 1,
          objective: "Prove the preimplementation Decision Frontier behavior.",
          requestedMaxParallel: 1,
          resourceEnvelope: {
            maxElapsedSeconds: null,
            maxTokens: null,
            softCheckpointElapsedSeconds: 1800,
            softCheckpointTokens: 100000,
          },
          reviewPolicy: {
            maxIndependentReviews: 1,
            maxFocusedConfirmations: 1,
            additionalReviewRule:
              "unresolved_blocker_or_explicit_authorization",
          },
          decisionFrontier: {
            initiativeObjective: "Resolve the engineering skill lifecycle.",
            revision: 1,
            areas: [
              {
                id: "authority-boundary",
                question: "Which plan owns execution state?",
                status: "open",
                resolution: null,
                decisionIds: [],
                approvalRef: null,
                decidedAt: null,
              },
            ],
            decisions: [
              {
                id: "single-orchestrator",
                question: "Should discovery create another orchestrator?",
                recommendation: "Keep one authoritative plan.",
                resolution: null,
                status: "proposed",
                approvalRef: null,
                decidedAt: null,
              },
            ],
            promotions: [],
          },
          nodes: [],
          handoffs: [],
        },
        null,
        2
      ) + "\n"
    );

    await execFileAsync("node", [
      path.join(
        registryRoot,
        "catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs"
      ),
      "validate",
      "--plan",
      planPath,
    ]);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
