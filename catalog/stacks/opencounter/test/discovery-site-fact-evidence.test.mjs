import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createScenarioSiteFactEvidenceArtifact,
  createScenarioSiteFactEvidenceArtifactStore,
  validateScenarioSiteFactEvidenceArtifact
} from "../src/discovery-site-fact-evidence.mjs";

test("binds verified site facts to immutable content-addressed source packets", () => {
  const created = createScenarioSiteFactEvidenceArtifact({
    assertion: {
      boundarySha256: "a".repeat(64),
      locationId: "zone-context-01",
      locationVersion: 1,
      parcelKey: "000000000001",
      questionId: "floodplain_100_year",
      questionSignatureSha256: "b".repeat(64),
      rollupId: "00000000-0000-4000-8000-000000000001",
      scenarioId: "outside-floodplain",
      value: "Yes"
    },
    conclusionRationale: "The authoritative overlay reports no special flood hazard area.",
    observedAt: "2026-08-04T21:22:04.031Z",
    sources: [{
      evidenceRef: "evidence-source-1",
      payload: {
        coveragePct: 100,
        sfha: false,
        zoneCodes: ["X"]
      },
      retrievedAt: "2026-08-04T21:22:04.031Z",
      source: "site-engine:site-conditions"
    }]
  });

  assert.match(created.evidenceArtifactSha256, /^[0-9a-f]{64}$/);
  assert.equal(created.evidenceRef,
    `ocse_${created.evidenceArtifactSha256}`);
  assert.deepEqual(validateScenarioSiteFactEvidenceArtifact({
    artifact: created.artifact,
    evidenceArtifactSha256: created.evidenceArtifactSha256
  }), created.artifact);

  const stateDirectory = mkdtempSync(path.join(tmpdir(), "opencounter-site-evidence-"));
  const store = createScenarioSiteFactEvidenceArtifactStore({ stateDirectory });
  const first = store.write(created.artifact);
  const second = store.write(created.artifact);
  assert.deepEqual(first, second);
  assert.equal(statSync(path.dirname(first.path)).mode & 0o777, 0o700);
  assert.equal(statSync(first.path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(first.path, "utf8")), created.artifact);

  const tampered = structuredClone(created.artifact);
  tampered.sources[0].payload.sfha = true;
  assert.throws(() => validateScenarioSiteFactEvidenceArtifact({
    artifact: tampered,
    evidenceArtifactSha256: created.evidenceArtifactSha256
  }), /digest|artifact/i);
});
