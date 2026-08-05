import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildScenarioSiteFactEvidenceReadiness,
  createScenarioSiteFactEvidenceReadinessStore
} from "../src/discovery-scenario-readiness.mjs";
import { createScenarioSiteFactEvidenceArtifact } from
  "../src/discovery-site-fact-evidence.mjs";

test("derives readiness only from exact immutable requirement matches", () => {
  const firstRequirement = requirement({
    questionId: "floodplain_100_year",
    questionSignatureSha256: "b".repeat(64),
    scenarioId: "drive-box",
    value: "Yes"
  });
  const secondRequirement = requirement({
    boundarySha256: "c".repeat(64),
    locationId: "zone-context-02",
    parcelKey: "000000000002",
    questionId: "within_100_ft_of_residential",
    questionSignatureSha256: "d".repeat(64),
    rollupId: "00000000-0000-4000-8000-000000000002",
    scenarioId: "drive-box",
    value: "Yes"
  });
  const requirements = requirementsManifest([
    firstRequirement,
    secondRequirement
  ]);
  const matching = evidence(firstRequirement);
  const historical = evidence(requirement({
    questionId: "historical_question",
    questionSignatureSha256: "e".repeat(64),
    scenarioId: "historical-scenario",
    value: "No"
  }));

  const first = buildScenarioSiteFactEvidenceReadiness({
    artifacts: [historical, matching],
    createdAt: "2026-08-04T22:30:00.000Z",
    requirements
  });
  const second = buildScenarioSiteFactEvidenceReadiness({
    artifacts: [matching, historical],
    createdAt: "2026-08-04T22:30:00.000Z",
    requirements
  });

  assert.deepEqual(first, second);
  assert.equal(first.authorizationReady, false);
  assert.equal(first.verifiedEvidenceCount, 1);
  assert.equal(first.requiredEvidenceCount, 2);
  assert.equal(first.ignoredArtifactCount, 1);
  assert.deepEqual(first.statusCounts, {
    evidence_required: 1,
    verified: 1
  });
  assert.equal(first.assessments[0].status, "verified");
  assert.equal(first.assessments[0].evidence.evidenceRef,
    matching.evidenceRef);
  assert.equal(first.assessments[1].status, "evidence_required");
  assert.match(first.readinessSha256, /^[0-9a-f]{64}$/);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(), "opencounter-scenario-readiness-"
  ));
  const store = createScenarioSiteFactEvidenceReadinessStore({
    stateDirectory
  });
  const stored = store.write(first);
  assert.equal(statSync(path.dirname(stored.path)).mode & 0o777, 0o700);
  assert.equal(statSync(stored.path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(stored.path, "utf8")), first);

  const ready = buildScenarioSiteFactEvidenceReadiness({
    artifacts: [matching, evidence(secondRequirement)],
    createdAt: "2026-08-04T22:31:00.000Z",
    requirements
  });
  assert.equal(ready.authorizationReady, true);
  assert.equal(ready.verifiedEvidenceCount, 2);
  assert.deepEqual(ready.statusCounts, { verified: 2 });
});

test("rejects tampered evidence and requirements manifests", () => {
  const required = requirement({
    questionId: "arterial_street",
    questionSignatureSha256: "f".repeat(64),
    scenarioId: "personal-services",
    value: "Yes"
  });
  const requirements = requirementsManifest([required]);
  const created = evidence(required);
  const tampered = structuredClone(created);
  tampered.artifact.assertion.value = "No";
  assert.throws(() => buildScenarioSiteFactEvidenceReadiness({
    artifacts: [tampered],
    createdAt: "2026-08-04T22:30:00.000Z",
    requirements
  }), /digest|artifact/i);

  const badRequirements = structuredClone(requirements);
  badRequirements.requirements[0].value = "No";
  assert.throws(() => buildScenarioSiteFactEvidenceReadiness({
    artifacts: [],
    createdAt: "2026-08-04T22:30:00.000Z",
    requirements: badRequirements
  }), /requirements/i);
});

function evidence(assertion) {
  const created = createScenarioSiteFactEvidenceArtifact({
    assertion: pickAssertion(assertion),
    conclusionRationale: "The authoritative source verifies the exact fact.",
    observedAt: "2026-08-04T22:29:00.000Z",
    sources: [{
      evidenceRef: `source-${assertion.questionId}`,
      payload: { verified: true },
      retrievedAt: "2026-08-04T22:29:00.000Z",
      source: "authoritative test source"
    }]
  });
  return created;
}

function pickAssertion(value) {
  return Object.fromEntries([
    "boundarySha256",
    "locationId",
    "locationVersion",
    "parcelKey",
    "questionId",
    "questionSignatureSha256",
    "rollupId",
    "scenarioId",
    "value"
  ].map((key) => [key, value[key]]));
}

function requirement(overrides) {
  return {
    boundarySha256: "a".repeat(64),
    catalogEntryId: "accessory_uses.drive_box",
    expectedBaseZoningCode: "SF-2",
    locationId: "zone-context-01",
    locationVersion: 1,
    ownership: "site_fact",
    parcelKey: "000000000001",
    questionId: "question",
    questionSignatureSha256: "b".repeat(64),
    rollupId: "00000000-0000-4000-8000-000000000001",
    scenarioId: "scenario",
    value: "Yes",
    ...overrides
  };
}

function requirementsManifest(requirements) {
  const payload = {
    campaignId: "cincinnati-zoning-scenario-branch-wave-1",
    campaignVersion: 2,
    evidenceSetSha256: "1".repeat(64),
    freezeId: `ocof_${"2".repeat(64)}`,
    requiredEvidenceCount: requirements.length,
    requirements,
    schemaVersion: 1
  };
  return { ...payload, requirementsSha256: sha256(payload) };
}

function sha256(value) {
  return createHash("sha256")
    .update(JSON.stringify(sortJson(value)), "utf8")
    .digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJson(value[key])
  ]));
}
