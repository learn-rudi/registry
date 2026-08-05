import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildAdaptiveZoningPreview,
  createAdaptiveZoningPreviewStore,
  validateAdaptiveZoningPreview
} from "../src/discovery-adaptive-zoning.mjs";
import {
  catalog,
  createPreliminaryGuidanceFixture
} from "./fixtures/preliminary-guidance-fixture.mjs";

const policy = JSON.parse(readFileSync(new URL(
  "../catalog/zoning-question-discovery-adaptive-policy-v1.json",
  import.meta.url
), "utf8"));

test("prioritizes capped cross-stratum retests without authorizing projects", () => {
  const fixture = createPreliminaryGuidanceFixture("Prohibited", {
    includeQueuedDuplicate: true
  });
  const limitedPolicy = structuredClone(policy);
  limitedPolicy.maximumProviderProjects = 4;
  const first = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy: limitedPolicy,
    precursorStatus: null,
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });
  const second = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy: limitedPolicy,
    precursorStatus: null,
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, "provisional_before_scenario_wave_1");
  assert.equal(first.authorizationRequired, true);
  assert.equal(first.authorizationGranted, false);
  assert.equal(first.candidates.length, 4);
  assert.ok(first.candidates.every(({ priorityReasons, priorityScore }) =>
    priorityReasons.includes("first_pass_prohibited")
    && priorityScore >= 60));
  assert.ok(first.candidates.every(({ targetBaseZoningCode }) =>
    targetBaseZoningCode !== "SF-2"));
  const byUse = new Map();
  for (const candidate of first.candidates) {
    const values = byUse.get(candidate.catalogEntryId) ?? [];
    values.push(candidate);
    byUse.set(candidate.catalogEntryId, values);
  }
  assert.ok([...byUse.values()].every((candidates) =>
    candidates.length <= 2
    && new Set(candidates.map(({ targetSamplingStratum }) =>
      targetSamplingStratum)).size === candidates.length));
  assert.match(first.previewId, /^ocaz_[0-9a-f]{64}$/);
});

test("produces no speculative reruns when the exact signals are absent", () => {
  const fixture = createPreliminaryGuidanceFixture("Permitted");
  const preview = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });
  assert.equal(preview.status, "no_adaptive_candidates");
  assert.deepEqual(preview.candidates, []);

  const invalidPolicy = structuredClone(policy);
  invalidPolicy.samplingStrata[0].baseZoningCodes.pop();
  assert.throws(() => buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy: invalidPolicy,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  }), /policy|zoning/i);

  const loosenedCap = structuredClone(policy);
  loosenedCap.maximumProviderProjects += 1;
  assert.throws(() => buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy: loosenedCap,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  }), /policy/i);

  const changedWeights = structuredClone(policy);
  changedWeights.signalWeights.firstPassProhibited -= 1;
  assert.throws(() => buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy: changedWeights,
    precursorStatus: "scenario_wave_1_complete",
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  }), /policy/i);
});

test("persists one private content-addressed preview and rejects tampering", () => {
  const fixture = createPreliminaryGuidanceFixture("Prohibited");
  const preview = buildAdaptiveZoningPreview({
    catalog,
    freeze: fixture.freeze,
    generatedAt: "2026-08-04T23:30:00.000Z",
    policy,
    precursorStatus: null,
    questionnaire: fixture.questionnaire,
    sourceLedgers: fixture.sourceLedgers
  });
  assert.deepEqual(validateAdaptiveZoningPreview(preview), preview);
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-adaptive-zoning-"
  ));
  try {
    const store = createAdaptiveZoningPreviewStore({ stateDirectory });
    const write = store.write(preview);
    assert.equal(lstatSync(write.path).mode & 0o777, 0o600);
    assert.equal(lstatSync(path.dirname(write.path)).mode & 0o777, 0o700);
    assert.deepEqual(store.read(preview.previewSha256), preview);
    const tampered = JSON.parse(readFileSync(write.path, "utf8"));
    tampered.authorizationGranted = true;
    writeFileSync(write.path, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    assert.throws(() => store.read(preview.previewSha256),
      /authorization|digest|preview/i);
  } finally {
    chmodSync(stateDirectory, 0o700);
    rmSync(stateDirectory, { recursive: true });
  }
});
