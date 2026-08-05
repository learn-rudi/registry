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
  buildBranchFrontierManifest,
  buildBranchFrontierSweep,
  createBranchFrontierArtifactStore,
  evaluateBranchFrontierStability,
  validateBranchFrontierManifest
} from "../src/discovery-frontier-stability.mjs";

const catalog = JSON.parse(readFileSync(new URL(
  "../catalog/cincinnati-opencounter-zoning-use-catalog-v1.json",
  import.meta.url
), "utf8"));
const catalogEntryId =
  "commercial_uses.eating_and_drinking_establishments.restaurants_full_service";
const existingUseSignature = "1".repeat(64);

test("requires two independent complete zero-novelty sweeps for stability", () => {
  const manifest = createManifest();
  const first = createSweep(manifest, 1, 2_980_001);
  const once = evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T13:00:00.000Z",
    manifest,
    sweeps: [first]
  });
  assert.equal(once.status, "stability_not_yet_established");
  assert.equal(once.claim, null);
  assert.equal(once.stability.consecutiveCompleteZeroNoveltySweeps, 1);

  const second = createSweep(manifest, 2, 2_980_101);
  const stable = evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, second]
  });
  assert.equal(stable.status, "branch_frontier_stable_for_manifest");
  assert.deepEqual(stable.claim, {
    frontierSha256: manifest.frontierSha256,
    kind: "branch_frontier_stable_for_manifest",
    manifestId: manifest.manifestId,
    manifestSha256: manifest.manifestSha256
  });
  assert.equal(stable.stability.consecutiveCompleteZeroNoveltySweeps, 2);
  assert.equal(stable.stability.requiredCompleteZeroNoveltySweeps, 2);
  assert.match(stable.reportId, /^ocfsr_[0-9a-f]{64}$/);
});

test("novelty, incomplete work, caps, or reused evidence cannot earn stability", () => {
  const manifest = createManifest();
  const first = createSweep(manifest, 1, 2_981_001);
  const novelty = createSweep(manifest, 2, 2_981_101, {
    novelty: {
      answerOptionSignatures: [],
      contextAssociationSignatures: [],
      questionSignatures: ["a".repeat(64)],
      transitionSignatures: []
    }
  });
  assert.equal(novelty.status, "sweep_complete_with_novelty");
  assert.equal(evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, novelty]
  }).status, "manifest_version_required");

  const incomplete = createSweep(manifest, 2, 2_982_101, {
    disposition: "needs_input"
  });
  assert.equal(incomplete.status, "sweep_incomplete");
  assert.equal(evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, incomplete]
  }).status, "sweep_incomplete");

  const capped = createSweep(manifest, 2, 2_983_101, { capReached: true });
  assert.equal(capped.status, "wave_complete_scope_unsaturated");
  assert.equal(evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, capped]
  }).status, "wave_complete_scope_unsaturated");

  const reusedAuthorization = structuredClone(createSweep(
    manifest,
    2,
    2_984_101
  ));
  reusedAuthorization.authorization.authorizationId =
    first.authorization.authorizationId;
  assert.throws(() => evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, reusedAuthorization]
  }), /authorization|digest/i);

  const reusedExecution = createSweep(manifest, 2, 2_981_001);
  assert.throws(() => evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T15:00:00.000Z",
    manifest,
    sweeps: [first, reusedExecution]
  }), /execution|provider|evidence/i);

  const third = createSweep(manifest, 3, 2_986_201);
  assert.throws(() => evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T18:00:00.000Z",
    manifest,
    sweeps: [first, createSweep(manifest, 2, 2_986_101), third]
  }), /limit|total|volume/i);

  const widerManifest = createManifest({ maximumProviderProjectsTotal: 6 });
  const noveltyFirst = createSweep(widerManifest, 1, 2_987_001, {
    novelty: {
      answerOptionSignatures: [],
      contextAssociationSignatures: [],
      questionSignatures: ["b".repeat(64)],
      transitionSignatures: []
    }
  });
  const afterNovelty = evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T18:00:00.000Z",
    manifest: widerManifest,
    sweeps: [
      noveltyFirst,
      createSweep(widerManifest, 2, 2_987_101),
      createSweep(widerManifest, 3, 2_987_201)
    ]
  });
  assert.equal(afterNovelty.status, "manifest_version_required");
  assert.equal(afterNovelty.claim, null);
});

test("persists content-addressed artifacts privately and rejects tampering", () => {
  const manifest = createManifest();
  assert.deepEqual(validateBranchFrontierManifest(manifest), manifest);
  const sweep = createSweep(manifest, 1, 2_985_001);
  const report = evaluateBranchFrontierStability({
    evaluatedAt: "2026-08-05T13:00:00.000Z",
    manifest,
    sweeps: [sweep]
  });
  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-frontier-stability-"
  ));
  try {
    const store = createBranchFrontierArtifactStore({ stateDirectory });
    const manifestWrite = store.writeManifest(manifest);
    const sweepWrite = store.writeSweep(sweep);
    const reportWrite = store.writeStabilityReport(report);
    for (const write of [manifestWrite, sweepWrite, reportWrite]) {
      assert.equal(lstatSync(write.path).mode & 0o777, 0o600);
      assert.equal(lstatSync(path.dirname(write.path)).mode & 0o777, 0o700);
    }
    assert.deepEqual(store.readManifest(manifest.manifestSha256), manifest);
    assert.deepEqual(store.readSweep(sweep.sweepSha256), sweep);
    assert.deepEqual(store.readStabilityReport(report.reportSha256), report);

    const tampered = JSON.parse(readFileSync(manifestWrite.path, "utf8"));
    tampered.authorizationGranted = true;
    writeFileSync(
      manifestWrite.path,
      `${JSON.stringify(tampered, null, 2)}\n`,
      "utf8"
    );
    assert.throws(() => store.readManifest(manifest.manifestSha256),
      /authorization|digest|manifest/i);
  } finally {
    chmodSync(stateDirectory, 0o700);
    rmSync(stateDirectory, { recursive: true });
  }
});

function createManifest({ maximumProviderProjectsTotal = 4 } = {}) {
  return buildBranchFrontierManifest({
    answerRules: [{
      ownership: "proposal_fact",
      proposalFactDeclarationSha256: "2".repeat(64),
      questionSignatureSha256: existingUseSignature,
      ruleKey: "existing_use_no",
      siteFactEvidenceSha256: null,
      value: "No"
    }, {
      ownership: "proposal_fact",
      proposalFactDeclarationSha256: "3".repeat(64),
      questionSignatureSha256: existingUseSignature,
      ruleKey: "existing_use_yes",
      siteFactEvidenceSha256: null,
      value: "Yes"
    }],
    answerVocabulary: [{
      allowedValues: ["No", "Yes"],
      questionSignatureSha256: existingUseSignature,
      responseKind: "closed_options"
    }],
    catalog,
    catalogEntryIds: [catalogEntryId],
    contexts: [{
      baseZoningCode: "MA",
      contextId: "zone_context_20",
      locationFixtureSha256: "4".repeat(64),
      observedZoningCodes: ["MA"],
      overlayCodes: []
    }],
    evidence: {
      sourceFreezeId: `ocof_${"5".repeat(64)}`,
      sourceLedgerSnapshotSha256s: ["6".repeat(64)]
    },
    frontierCells: [{
      catalogEntryId,
      cellKey: "existing_use_no_path",
      completeAnswerRuleKeys: ["existing_use_no"],
      contextId: "zone_context_20",
      priorAnswerRuleKeys: [],
      providerQuestionId: "existing_use",
      questionSignatureSha256: existingUseSignature,
      sourceCheckpointQuestionSignatureSha256s: [existingUseSignature]
    }, {
      catalogEntryId,
      cellKey: "existing_use_yes_path",
      completeAnswerRuleKeys: ["existing_use_yes"],
      contextId: "zone_context_20",
      priorAnswerRuleKeys: [],
      providerQuestionId: "existing_use",
      questionSignatureSha256: existingUseSignature,
      sourceCheckpointQuestionSignatureSha256s: [existingUseSignature]
    }],
    generatedAt: "2026-08-05T10:00:00.000Z",
    limits: {
      maximumDepth: 4,
      maximumProviderConcurrency: 2,
      maximumProviderProjectsPerSweep: 2,
      maximumProviderProjectsTotal
    },
    providerFingerprintSha256: "7".repeat(64),
    validity: {
      validFrom: "2026-08-05T10:00:00.000Z",
      validUntil: "2026-08-12T10:00:00.000Z"
    }
  });
}

function createSweep(manifest, sweepOrdinal, firstProject, overrides = {}) {
  const startedHour = 10 + sweepOrdinal * 2;
  const approvedHour = startedHour - 1;
  const disposition = overrides.disposition ?? "verified_terminal";
  return buildBranchFrontierSweep({
    authorization: {
      approvedAt: `2026-08-05T${String(approvedHour).padStart(2, "0")}:00:00.000Z`,
      approvedBy: "requester",
      authorizationId: `frontier_sweep_${sweepOrdinal}_authorization`,
      manifestSha256: manifest.manifestSha256,
      maximumProviderConcurrency: 2,
      maximumProviderProjects: manifest.frontierCells.length,
      previewSha256: String(7 + sweepOrdinal).repeat(64).slice(0, 64),
      sweepOrdinal
    },
    capReached: overrides.capReached ?? false,
    cellResults: manifest.frontierCells.map((cell, index) => ({
      cellId: cell.cellId,
      disposition,
      evidenceSha256: String(firstProject + index).padStart(64, "0"),
      providerReference: disposition === "verified_terminal"
        ? `opencounter:project:${firstProject + index}`
        : null,
      terminalClassification: disposition === "verified_terminal"
        ? "Permitted"
        : null
    })),
    completedAt: `2026-08-05T${String(startedHour + 1).padStart(2, "0")}:00:00.000Z`,
    manifest,
    novelty: overrides.novelty ?? {
      answerOptionSignatures: [],
      contextAssociationSignatures: [],
      questionSignatures: [],
      transitionSignatures: []
    },
    startedAt: `2026-08-05T${String(startedHour).padStart(2, "0")}:00:00.000Z`
  });
}
