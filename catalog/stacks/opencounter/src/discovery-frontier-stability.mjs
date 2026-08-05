import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const ARTIFACT_DIRECTORY = "branch-frontier-stability";
const MAXIMUM_ARTIFACT_BYTES = 2 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CATALOG_ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,255}$/;
const SOURCE_FREEZE_PATTERN = /^ocof_[0-9a-f]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^opencounter:project:[0-9]{1,20}$/;
const SWEEP_STATUSES = new Set([
  "sweep_complete_zero_novelty",
  "sweep_complete_with_novelty",
  "sweep_incomplete",
  "wave_complete_scope_unsaturated"
]);
const STABILITY_STATUSES = new Set([
  "branch_frontier_stable_for_manifest",
  "manifest_version_required",
  "stability_not_yet_established",
  "sweep_incomplete",
  "wave_complete_scope_unsaturated"
]);
const REQUIRED_ZERO_NOVELTY_SWEEPS = 2;

export function buildBranchFrontierManifest(value) {
  const payload = normalizeManifestPayload(value);
  const frontierSha256 = sha256({
    answerRules: payload.answerRules,
    answerVocabulary: payload.answerVocabulary,
    catalog: payload.catalog,
    catalogEntryIds: payload.catalogEntryIds,
    contexts: payload.contexts,
    evidence: payload.evidence,
    frontierCells: payload.frontierCells,
    limits: payload.limits,
    providerFingerprintSha256: payload.providerFingerprintSha256,
    validity: payload.validity
  });
  const manifestPayload = {
    ...payload,
    authorizationGranted: false,
    frontierSha256,
    schemaVersion: 1
  };
  const manifestSha256 = sha256(manifestPayload);
  return {
    ...manifestPayload,
    manifestId: `ocfm_${manifestSha256}`,
    manifestSha256
  };
}

export function validateBranchFrontierManifest(value) {
  const manifest = record(value, "manifest");
  exactRecord(manifest, [
    "answerRules",
    "answerVocabulary",
    "authorizationGranted",
    "catalog",
    "catalogEntryIds",
    "contexts",
    "evidence",
    "frontierCells",
    "frontierSha256",
    "generatedAt",
    "limits",
    "manifestId",
    "manifestSha256",
    "providerFingerprintSha256",
    "schemaVersion",
    "validity"
  ], "manifest");
  if (manifest.schemaVersion !== 1 || manifest.authorizationGranted !== false) {
    throw new Error("opencounter_branch_frontier_manifest_authorization_invalid");
  }
  const payload = normalizeManifestPayload(manifest);
  const frontierSha256 = sha256({
    answerRules: payload.answerRules,
    answerVocabulary: payload.answerVocabulary,
    catalog: payload.catalog,
    catalogEntryIds: payload.catalogEntryIds,
    contexts: payload.contexts,
    evidence: payload.evidence,
    frontierCells: payload.frontierCells,
    limits: payload.limits,
    providerFingerprintSha256: payload.providerFingerprintSha256,
    validity: payload.validity
  });
  const manifestPayload = {
    ...payload,
    authorizationGranted: false,
    frontierSha256,
    schemaVersion: 1
  };
  const manifestSha256 = sha256(manifestPayload);
  if (manifest.frontierSha256 !== frontierSha256
    || manifest.manifestSha256 !== manifestSha256
    || manifest.manifestId !== `ocfm_${manifestSha256}`) {
    throw new Error("opencounter_branch_frontier_manifest_digest_mismatch");
  }
  return {
    ...manifestPayload,
    manifestId: `ocfm_${manifestSha256}`,
    manifestSha256
  };
}

export function buildBranchFrontierSweep(value) {
  const input = record(value, "sweep");
  exactRecord(input, [
    "authorization",
    "capReached",
    "cellResults",
    "completedAt",
    "manifest",
    "novelty",
    "startedAt"
  ], "sweep");
  const manifest = validateBranchFrontierManifest(input.manifest);
  const startedAt = timestamp(input.startedAt, "sweep.startedAt");
  const completedAt = timestamp(input.completedAt, "sweep.completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("opencounter_branch_frontier_sweep_time_invalid");
  }
  const authorization = normalizeSweepAuthorization({
    createdAt: startedAt,
    manifest,
    value: input.authorization
  });
  const capReached = boolean(input.capReached, "sweep.capReached");
  const novelty = normalizeNovelty(input.novelty, "sweep.novelty");
  const cellResults = normalizeCellResults(input.cellResults, manifest);
  const status = classifySweep({ capReached, cellResults, novelty });
  const payload = {
    authorization,
    capReached,
    cellResults,
    completedAt,
    frontierSha256: manifest.frontierSha256,
    manifestId: manifest.manifestId,
    manifestSha256: manifest.manifestSha256,
    novelty,
    schemaVersion: 1,
    startedAt,
    status,
    sweepOrdinal: authorization.sweepOrdinal
  };
  const sweepSha256 = sha256(payload);
  return {
    ...payload,
    sweepId: `ocfs_${sweepSha256}`,
    sweepSha256
  };
}

export function evaluateBranchFrontierStability(value) {
  const input = record(value, "stability evaluation");
  exactRecord(input, ["evaluatedAt", "manifest", "sweeps"], "stability evaluation");
  const evaluatedAt = timestamp(input.evaluatedAt, "evaluatedAt");
  const manifest = validateBranchFrontierManifest(input.manifest);
  if (!Array.isArray(input.sweeps)) {
    throw new Error("opencounter_branch_frontier_sweeps_invalid");
  }
  const sweeps = input.sweeps
    .map((sweep) => validateBranchFrontierSweep(sweep, manifest))
    .sort((left, right) => left.sweepOrdinal - right.sweepOrdinal);
  validateSweepIndependence(sweeps);
  validateSweepVolume(sweeps, manifest);
  const status = classifyStabilityStatus(sweeps);
  const consecutiveCompleteZeroNoveltySweeps =
    countTrailingZeroNoveltySweeps(sweeps);
  const claim = status === "branch_frontier_stable_for_manifest"
    ? {
        frontierSha256: manifest.frontierSha256,
        kind: "branch_frontier_stable_for_manifest",
        manifestId: manifest.manifestId,
        manifestSha256: manifest.manifestSha256
      }
    : null;
  const payload = {
    claim,
    evaluatedAt,
    frontierSha256: manifest.frontierSha256,
    manifestId: manifest.manifestId,
    manifestSha256: manifest.manifestSha256,
    schemaVersion: 1,
    stability: {
      consecutiveCompleteZeroNoveltySweeps,
      requiredCompleteZeroNoveltySweeps: REQUIRED_ZERO_NOVELTY_SWEEPS
    },
    status,
    sweepSha256s: sweeps.map(({ sweepSha256 }) => sweepSha256)
  };
  const reportSha256 = sha256(payload);
  return {
    ...payload,
    reportId: `ocfsr_${reportSha256}`,
    reportSha256
  };
}

export function createBranchFrontierArtifactStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "stateDirectory");
  const directory = privateDirectory(path.join(root, ARTIFACT_DIRECTORY),
    ARTIFACT_DIRECTORY);
  const manifests = privateDirectory(path.join(directory, "manifests"),
    "manifests");
  const sweeps = privateDirectory(path.join(directory, "sweeps"), "sweeps");
  const reports = privateDirectory(path.join(directory, "reports"), "reports");
  return {
    readManifest(manifestSha256) {
      return readArtifact({
        directory: manifests,
        digest: manifestSha256,
        label: "manifest",
        validate: (artifact) => validateBranchFrontierManifest(artifact),
        digestKey: "manifestSha256"
      });
    },
    readStabilityReport(reportSha256) {
      return readArtifact({
        directory: reports,
        digest: reportSha256,
        label: "stability_report",
        validate: validateStabilityReport,
        digestKey: "reportSha256"
      });
    },
    readSweep(sweepSha256) {
      return readArtifact({
        directory: sweeps,
        digest: sweepSha256,
        label: "sweep",
        validate: (artifact) => validateBranchFrontierSweep(artifact),
        digestKey: "sweepSha256"
      });
    },
    writeManifest(value) {
      const manifest = validateBranchFrontierManifest(value);
      return writeArtifact({
        artifact: manifest,
        directory: manifests,
        digest: manifest.manifestSha256,
        digestKey: "manifestSha256",
        label: "manifest"
      });
    },
    writeStabilityReport(value) {
      const report = validateStabilityReport(value);
      return writeArtifact({
        artifact: report,
        directory: reports,
        digest: report.reportSha256,
        digestKey: "reportSha256",
        label: "stability_report"
      });
    },
    writeSweep(value) {
      const sweep = validateBranchFrontierSweep(value);
      return writeArtifact({
        artifact: sweep,
        directory: sweeps,
        digest: sweep.sweepSha256,
        digestKey: "sweepSha256",
        label: "sweep"
      });
    }
  };
}

function validateBranchFrontierSweep(value, expectedManifest = null) {
  const sweep = record(value, "sweep");
  exactRecord(sweep, [
    "authorization",
    "capReached",
    "cellResults",
    "completedAt",
    "frontierSha256",
    "manifestId",
    "manifestSha256",
    "novelty",
    "schemaVersion",
    "startedAt",
    "status",
    "sweepId",
    "sweepOrdinal",
    "sweepSha256"
  ], "sweep");
  if (sweep.schemaVersion !== 1 || !SWEEP_STATUSES.has(sweep.status)) {
    throw new Error("opencounter_branch_frontier_sweep_invalid");
  }
  const manifest = expectedManifest;
  if (manifest !== null
    && (sweep.manifestId !== manifest.manifestId
      || sweep.manifestSha256 !== manifest.manifestSha256
      || sweep.frontierSha256 !== manifest.frontierSha256)) {
    throw new Error("opencounter_branch_frontier_sweep_manifest_mismatch");
  }
  const startedAt = timestamp(sweep.startedAt, "sweep.startedAt");
  const completedAt = timestamp(sweep.completedAt, "sweep.completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("opencounter_branch_frontier_sweep_time_invalid");
  }
  const authorization = normalizeSweepAuthorization({
    createdAt: startedAt,
    manifest: manifest ?? {
      frontierCells: [],
      limits: {
        maximumProviderConcurrency: Number.MAX_SAFE_INTEGER,
        maximumProviderProjectsPerSweep: Number.MAX_SAFE_INTEGER
      },
      manifestSha256: sweep.manifestSha256
    },
    value: sweep.authorization
  });
  const capReached = boolean(sweep.capReached, "sweep.capReached");
  const novelty = normalizeNovelty(sweep.novelty, "sweep.novelty");
  const cellResults = manifest === null
    ? normalizeStoredCellResults(sweep.cellResults)
    : normalizeCellResults(sweep.cellResults, manifest);
  const status = classifySweep({ capReached, cellResults, novelty });
  const payload = {
    authorization,
    capReached,
    cellResults,
    completedAt,
    frontierSha256: sha256Text(sweep.frontierSha256, "sweep.frontierSha256"),
    manifestId: text(sweep.manifestId, 100, "sweep.manifestId"),
    manifestSha256: sha256Text(sweep.manifestSha256, "sweep.manifestSha256"),
    novelty,
    schemaVersion: 1,
    startedAt,
    status,
    sweepOrdinal: authorization.sweepOrdinal
  };
  if (sweep.sweepOrdinal !== authorization.sweepOrdinal
    || sweep.status !== status
    || !sweep.manifestId.startsWith("ocfm_")) {
    throw new Error("opencounter_branch_frontier_sweep_invalid");
  }
  const sweepSha256 = sha256(payload);
  if (sweep.sweepSha256 !== sweepSha256
    || sweep.sweepId !== `ocfs_${sweepSha256}`) {
    throw new Error("opencounter_branch_frontier_sweep_digest_mismatch");
  }
  return {
    ...payload,
    sweepId: `ocfs_${sweepSha256}`,
    sweepSha256
  };
}

function validateStabilityReport(value) {
  const report = record(value, "stability report");
  exactRecord(report, [
    "claim",
    "evaluatedAt",
    "frontierSha256",
    "manifestId",
    "manifestSha256",
    "reportId",
    "reportSha256",
    "schemaVersion",
    "stability",
    "status",
    "sweepSha256s"
  ], "stability report");
  if (report.schemaVersion !== 1
    || !STABILITY_STATUSES.has(report.status)
    || !report.manifestId.startsWith("ocfm_")) {
    throw new Error("opencounter_branch_frontier_stability_report_invalid");
  }
  const payload = {
    claim: normalizeStabilityClaim(report.claim, report),
    evaluatedAt: timestamp(report.evaluatedAt, "report.evaluatedAt"),
    frontierSha256: sha256Text(report.frontierSha256, "report.frontierSha256"),
    manifestId: text(report.manifestId, 100, "report.manifestId"),
    manifestSha256: sha256Text(report.manifestSha256, "report.manifestSha256"),
    schemaVersion: 1,
    stability: normalizeStability(report.stability),
    status: report.status,
    sweepSha256s: uniqueShaArray(report.sweepSha256s, "report.sweepSha256s")
  };
  const reportSha256 = sha256(payload);
  if (report.reportSha256 !== reportSha256
    || report.reportId !== `ocfsr_${reportSha256}`) {
    throw new Error("opencounter_branch_frontier_stability_report_digest_mismatch");
  }
  return {
    ...payload,
    reportId: `ocfsr_${reportSha256}`,
    reportSha256
  };
}

function normalizeManifestPayload(value) {
  const input = record(value, "manifest");
  const catalog = normalizeCatalog(input.catalog);
  const answerRules = normalizeAnswerRules(input.answerRules);
  const answerVocabulary = normalizeAnswerVocabulary(input.answerVocabulary);
  const contexts = normalizeContexts(input.contexts);
  const catalogEntryIds = uniqueTextArray(
    input.catalogEntryIds,
    "catalogEntryIds",
    CATALOG_ENTRY_ID_PATTERN
  );
  const evidence = normalizeManifestEvidence(input.evidence);
  const frontierCells = normalizeFrontierCells(input.frontierCells, {
    answerRules,
    catalogEntryIds,
    contexts
  });
  const limits = normalizeLimits(input.limits);
  const generatedAt = timestamp(input.generatedAt, "manifest.generatedAt");
  const validity = normalizeValidity(input.validity);
  if (Date.parse(generatedAt) < Date.parse(validity.validFrom)
    || Date.parse(generatedAt) > Date.parse(validity.validUntil)) {
    throw new Error("opencounter_branch_frontier_manifest_validity_invalid");
  }
  return {
    answerRules,
    answerVocabulary,
    catalog,
    catalogEntryIds,
    contexts,
    evidence,
    frontierCells,
    generatedAt,
    limits,
    providerFingerprintSha256: sha256Text(
      input.providerFingerprintSha256,
      "providerFingerprintSha256"
    ),
    validity
  };
}

function normalizeCatalog(value) {
  const catalog = record(value, "catalog");
  const tenantVersion = catalog.provider?.tenantVersion ?? catalog.tenantVersion;
  if (!ID_PATTERN.test(catalog.catalogId)
    || !SHA256_PATTERN.test(catalog.catalogSha256)
    || catalog.jurisdiction !== "cincinnati-oh"
    || !Number.isSafeInteger(tenantVersion)
    || tenantVersion < 1) {
    throw new Error("opencounter_branch_frontier_catalog_invalid");
  }
  return {
    catalogId: catalog.catalogId,
    catalogSha256: catalog.catalogSha256,
    jurisdiction: catalog.jurisdiction,
    tenantVersion
  };
}

function normalizeAnswerRules(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000) {
    throw new Error("opencounter_branch_frontier_answer_rules_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    exactRecord(record(value, "answer rule"), [
      "ownership",
      "proposalFactDeclarationSha256",
      "questionSignatureSha256",
      "ruleKey",
      "siteFactEvidenceSha256",
      "value"
    ], "answer rule");
    const ruleKey = text(value.ruleKey, 200, "answer rule.ruleKey");
    if (seen.has(ruleKey)) {
      throw new Error("opencounter_branch_frontier_answer_rule_duplicate");
    }
    seen.add(ruleKey);
    if (!["mixed_fact", "proposal_fact", "site_fact"].includes(value.ownership)) {
      throw new Error("opencounter_branch_frontier_answer_rule_invalid");
    }
    return {
      ownership: value.ownership,
      proposalFactDeclarationSha256: nullableSha(
        value.proposalFactDeclarationSha256,
        "answer rule.proposalFactDeclarationSha256"
      ),
      questionSignatureSha256: sha256Text(
        value.questionSignatureSha256,
        "answer rule.questionSignatureSha256"
      ),
      ruleKey,
      siteFactEvidenceSha256: nullableSha(
        value.siteFactEvidenceSha256,
        "answer rule.siteFactEvidenceSha256"
      ),
      value: text(value.value, 2_000, "answer rule.value")
    };
  }).sort((left, right) => left.ruleKey.localeCompare(right.ruleKey));
}

function normalizeAnswerVocabulary(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000) {
    throw new Error("opencounter_branch_frontier_answer_vocabulary_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    exactRecord(record(value, "answer vocabulary"), [
      "allowedValues",
      "questionSignatureSha256",
      "responseKind"
    ], "answer vocabulary");
    const questionSignatureSha256 = sha256Text(
      value.questionSignatureSha256,
      "answer vocabulary.questionSignatureSha256"
    );
    if (seen.has(questionSignatureSha256)) {
      throw new Error("opencounter_branch_frontier_answer_vocabulary_duplicate");
    }
    seen.add(questionSignatureSha256);
    if (typeof value.responseKind !== "string" || value.responseKind.length < 1) {
      throw new Error("opencounter_branch_frontier_answer_vocabulary_invalid");
    }
    return {
      allowedValues: uniqueTextArray(value.allowedValues, "allowedValues"),
      questionSignatureSha256,
      responseKind: value.responseKind
    };
  }).sort((left, right) =>
    left.questionSignatureSha256.localeCompare(right.questionSignatureSha256));
}

function normalizeContexts(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 1_000) {
    throw new Error("opencounter_branch_frontier_contexts_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    exactRecord(record(value, "context"), [
      "baseZoningCode",
      "contextId",
      "locationFixtureSha256",
      "observedZoningCodes",
      "overlayCodes"
    ], "context");
    const contextId = text(value.contextId, 100, "context.contextId");
    if (!ID_PATTERN.test(contextId) || seen.has(contextId)) {
      throw new Error("opencounter_branch_frontier_context_invalid");
    }
    seen.add(contextId);
    return {
      baseZoningCode: zoningCode(value.baseZoningCode, "context.baseZoningCode"),
      contextId,
      locationFixtureSha256: sha256Text(
        value.locationFixtureSha256,
        "context.locationFixtureSha256"
      ),
      observedZoningCodes: uniqueTextArray(
        value.observedZoningCodes,
        "context.observedZoningCodes",
        /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/
      ),
      overlayCodes: uniqueTextArray(
        value.overlayCodes,
        "context.overlayCodes",
        /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/
      )
    };
  }).sort((left, right) => left.contextId.localeCompare(right.contextId));
}

function normalizeManifestEvidence(value) {
  exactRecord(record(value, "manifest evidence"), [
    "sourceFreezeId",
    "sourceLedgerSnapshotSha256s"
  ], "manifest evidence");
  if (!SOURCE_FREEZE_PATTERN.test(value.sourceFreezeId)) {
    throw new Error("opencounter_branch_frontier_evidence_invalid");
  }
  return {
    sourceFreezeId: value.sourceFreezeId,
    sourceLedgerSnapshotSha256s: uniqueShaArray(
      value.sourceLedgerSnapshotSha256s,
      "sourceLedgerSnapshotSha256s"
    )
  };
}

function normalizeFrontierCells(values, { answerRules, catalogEntryIds, contexts }) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10_000) {
    throw new Error("opencounter_branch_frontier_cells_invalid");
  }
  const allowedCatalogEntries = new Set(catalogEntryIds);
  const allowedContexts = new Set(contexts.map(({ contextId }) => contextId));
  const allowedRules = new Set(answerRules.map(({ ruleKey }) => ruleKey));
  const seenKeys = new Set();
  const cells = values.map((value) => {
    const cell = record(value, "frontier cell");
    const expectedKeys = [
      "catalogEntryId",
      "cellKey",
      "completeAnswerRuleKeys",
      "contextId",
      "priorAnswerRuleKeys",
      "providerQuestionId",
      "questionSignatureSha256",
      "sourceCheckpointQuestionSignatureSha256s"
    ];
    if (Object.hasOwn(cell, "cellId")) expectedKeys.push("cellId");
    exactRecord(cell, expectedKeys, "frontier cell");
    const normalizedCatalogEntryId = normalizeCatalogEntryId(cell.catalogEntryId,
      "frontier cell.catalogEntryId");
    const contextId = text(cell.contextId, 100, "frontier cell.contextId");
    const cellKey = text(cell.cellKey, 200, "frontier cell.cellKey");
    if (!allowedCatalogEntries.has(normalizedCatalogEntryId)
      || !allowedContexts.has(contextId)
      || !ID_PATTERN.test(contextId)
      || !ID_PATTERN.test(cellKey)) {
      throw new Error("opencounter_branch_frontier_cell_invalid");
    }
    const completeAnswerRuleKeys = uniqueTextArray(
      cell.completeAnswerRuleKeys,
      "frontier cell.completeAnswerRuleKeys"
    );
    const priorAnswerRuleKeys = uniqueTextArray(
      cell.priorAnswerRuleKeys,
      "frontier cell.priorAnswerRuleKeys"
    );
    for (const ruleKey of [...completeAnswerRuleKeys, ...priorAnswerRuleKeys]) {
      if (!allowedRules.has(ruleKey)) {
        throw new Error("opencounter_branch_frontier_cell_rule_invalid");
      }
    }
    const payload = {
      catalogEntryId: normalizedCatalogEntryId,
      cellKey,
      completeAnswerRuleKeys,
      contextId,
      priorAnswerRuleKeys,
      providerQuestionId: text(
        cell.providerQuestionId,
        200,
        "frontier cell.providerQuestionId"
      ),
      questionSignatureSha256: sha256Text(
        cell.questionSignatureSha256,
        "frontier cell.questionSignatureSha256"
      ),
      sourceCheckpointQuestionSignatureSha256s: uniqueShaArray(
        cell.sourceCheckpointQuestionSignatureSha256s,
        "frontier cell.sourceCheckpointQuestionSignatureSha256s"
      )
    };
    const cellId = `ocfc_${sha256(payload)}`;
    if (Object.hasOwn(cell, "cellId") && cell.cellId !== cellId) {
      throw new Error("opencounter_branch_frontier_cell_digest_mismatch");
    }
    const uniqueKey = `${contextId}:${normalizedCatalogEntryId}:${cellKey}`;
    if (seenKeys.has(uniqueKey)) {
      throw new Error("opencounter_branch_frontier_cell_duplicate");
    }
    seenKeys.add(uniqueKey);
    return { ...payload, cellId };
  });
  return cells.sort((left, right) =>
    `${left.contextId}:${left.catalogEntryId}:${left.cellKey}`.localeCompare(
      `${right.contextId}:${right.catalogEntryId}:${right.cellKey}`
    ));
}

function normalizeLimits(value) {
  exactRecord(record(value, "limits"), [
    "maximumDepth",
    "maximumProviderConcurrency",
    "maximumProviderProjectsPerSweep",
    "maximumProviderProjectsTotal"
  ], "limits");
  const maximumProviderProjectsPerSweep = positiveInteger(
    value.maximumProviderProjectsPerSweep,
    "limits.maximumProviderProjectsPerSweep"
  );
  const maximumProviderProjectsTotal = positiveInteger(
    value.maximumProviderProjectsTotal,
    "limits.maximumProviderProjectsTotal"
  );
  if (maximumProviderProjectsTotal < maximumProviderProjectsPerSweep) {
    throw new Error("opencounter_branch_frontier_limits_invalid");
  }
  return {
    maximumDepth: positiveInteger(value.maximumDepth, "limits.maximumDepth"),
    maximumProviderConcurrency: positiveInteger(
      value.maximumProviderConcurrency,
      "limits.maximumProviderConcurrency"
    ),
    maximumProviderProjectsPerSweep,
    maximumProviderProjectsTotal
  };
}

function normalizeValidity(value) {
  exactRecord(record(value, "validity"), ["validFrom", "validUntil"], "validity");
  const validFrom = timestamp(value.validFrom, "validity.validFrom");
  const validUntil = timestamp(value.validUntil, "validity.validUntil");
  if (Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new Error("opencounter_branch_frontier_validity_invalid");
  }
  return { validFrom, validUntil };
}

function normalizeSweepAuthorization({ createdAt, manifest, value }) {
  const authorization = record(value, "sweep authorization");
  exactRecord(authorization, [
    "approvedAt",
    "approvedBy",
    "authorizationId",
    "manifestSha256",
    "maximumProviderConcurrency",
    "maximumProviderProjects",
    "previewSha256",
    "sweepOrdinal"
  ], "sweep authorization");
  const approvedAt = timestamp(authorization.approvedAt,
    "authorization.approvedAt");
  if (Date.parse(approvedAt) > Date.parse(createdAt)) {
    throw new Error("opencounter_branch_frontier_authorization_time_invalid");
  }
  if (authorization.manifestSha256 !== manifest.manifestSha256
    || !ID_PATTERN.test(authorization.approvedBy)
    || !ID_PATTERN.test(authorization.authorizationId)
    || !SHA256_PATTERN.test(authorization.previewSha256)
    || authorization.maximumProviderConcurrency
      > manifest.limits.maximumProviderConcurrency
    || authorization.maximumProviderProjects
      > manifest.limits.maximumProviderProjectsPerSweep
    || (manifest.frontierCells.length > 0
      && authorization.maximumProviderProjects !== manifest.frontierCells.length)) {
    throw new Error("opencounter_branch_frontier_authorization_invalid");
  }
  return {
    approvedAt,
    approvedBy: authorization.approvedBy,
    authorizationId: authorization.authorizationId,
    manifestSha256: authorization.manifestSha256,
    maximumProviderConcurrency: positiveInteger(
      authorization.maximumProviderConcurrency,
      "authorization.maximumProviderConcurrency"
    ),
    maximumProviderProjects: positiveInteger(
      authorization.maximumProviderProjects,
      "authorization.maximumProviderProjects"
    ),
    previewSha256: authorization.previewSha256,
    sweepOrdinal: positiveInteger(
      authorization.sweepOrdinal,
      "authorization.sweepOrdinal"
    )
  };
}

function normalizeCellResults(values, manifest) {
  if (!Array.isArray(values) || values.length !== manifest.frontierCells.length) {
    throw new Error("opencounter_branch_frontier_cell_results_invalid");
  }
  const allowedCellIds = new Set(manifest.frontierCells.map(({ cellId }) => cellId));
  const seen = new Set();
  const normalized = values.map((value) => normalizeCellResult(value));
  for (const result of normalized) {
    if (!allowedCellIds.has(result.cellId) || seen.has(result.cellId)) {
      throw new Error("opencounter_branch_frontier_cell_results_invalid");
    }
    seen.add(result.cellId);
  }
  return normalized.sort((left, right) => left.cellId.localeCompare(right.cellId));
}

function normalizeStoredCellResults(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 10_000) {
    throw new Error("opencounter_branch_frontier_cell_results_invalid");
  }
  const seen = new Set();
  return values.map((value) => {
    const result = normalizeCellResult(value);
    if (seen.has(result.cellId)) {
      throw new Error("opencounter_branch_frontier_cell_results_invalid");
    }
    seen.add(result.cellId);
    return result;
  }).sort((left, right) => left.cellId.localeCompare(right.cellId));
}

function normalizeCellResult(value) {
  exactRecord(record(value, "cell result"), [
    "cellId",
    "disposition",
    "evidenceSha256",
    "providerReference",
    "terminalClassification"
  ], "cell result");
  const cellId = text(value.cellId, 100, "cell result.cellId");
  if (!cellId.startsWith("ocfc_")) {
    throw new Error("opencounter_branch_frontier_cell_result_invalid");
  }
  const disposition = text(value.disposition, 100, "cell result.disposition");
  return {
    cellId,
    disposition,
    evidenceSha256: sha256Text(
      value.evidenceSha256,
      "cell result.evidenceSha256"
    ),
    providerReference: nullableProviderReference(value.providerReference),
    terminalClassification: nullableText(
      value.terminalClassification,
      200,
      "cell result.terminalClassification"
    )
  };
}

function normalizeNovelty(value, pathLabel) {
  exactRecord(record(value, pathLabel), [
    "answerOptionSignatures",
    "contextAssociationSignatures",
    "questionSignatures",
    "transitionSignatures"
  ], pathLabel);
  return {
    answerOptionSignatures: uniqueShaArray(
      value.answerOptionSignatures,
      `${pathLabel}.answerOptionSignatures`
    ),
    contextAssociationSignatures: uniqueShaArray(
      value.contextAssociationSignatures,
      `${pathLabel}.contextAssociationSignatures`
    ),
    questionSignatures: uniqueShaArray(
      value.questionSignatures,
      `${pathLabel}.questionSignatures`
    ),
    transitionSignatures: uniqueShaArray(
      value.transitionSignatures,
      `${pathLabel}.transitionSignatures`
    )
  };
}

function classifySweep({ capReached, cellResults, novelty }) {
  if (capReached) return "wave_complete_scope_unsaturated";
  if (cellResults.some((result) =>
    result.disposition !== "verified_terminal"
    || result.providerReference === null
    || result.terminalClassification === null)) {
    return "sweep_incomplete";
  }
  if (Object.values(novelty).some((items) => items.length > 0)) {
    return "sweep_complete_with_novelty";
  }
  return "sweep_complete_zero_novelty";
}

function classifyStabilityStatus(sweeps) {
  if (sweeps.some(({ status }) => status === "sweep_complete_with_novelty")) {
    return "manifest_version_required";
  }
  if (sweeps.some(({ status }) => status === "wave_complete_scope_unsaturated")) {
    return "wave_complete_scope_unsaturated";
  }
  if (sweeps.some(({ status }) => status === "sweep_incomplete")) {
    return "sweep_incomplete";
  }
  const zeroNoveltyCount = countTrailingZeroNoveltySweeps(sweeps);
  return zeroNoveltyCount >= REQUIRED_ZERO_NOVELTY_SWEEPS
    ? "branch_frontier_stable_for_manifest"
    : "stability_not_yet_established";
}

function countTrailingZeroNoveltySweeps(sweeps) {
  let count = 0;
  for (let index = sweeps.length - 1; index >= 0; index -= 1) {
    if (sweeps[index].status !== "sweep_complete_zero_novelty") break;
    count += 1;
  }
  return count;
}

function validateSweepIndependence(sweeps) {
  const authorizations = new Set();
  const evidence = new Set();
  const ordinals = new Set();
  const providers = new Set();
  for (const sweep of sweeps) {
    if (authorizations.has(sweep.authorization.authorizationId)
      || ordinals.has(sweep.sweepOrdinal)) {
      throw new Error("opencounter_branch_frontier_authorization_reused");
    }
    authorizations.add(sweep.authorization.authorizationId);
    ordinals.add(sweep.sweepOrdinal);
    for (const result of sweep.cellResults) {
      if (evidence.has(result.evidenceSha256)
        || (result.providerReference !== null
          && providers.has(result.providerReference))) {
        throw new Error("opencounter_branch_frontier_execution_provider_evidence_reused");
      }
      evidence.add(result.evidenceSha256);
      if (result.providerReference !== null) providers.add(result.providerReference);
    }
  }
}

function validateSweepVolume(sweeps, manifest) {
  const totalAuthorizedProviderProjects = sweeps.reduce((sum, sweep) =>
    sum + sweep.authorization.maximumProviderProjects, 0);
  if (totalAuthorizedProviderProjects > manifest.limits.maximumProviderProjectsTotal) {
    throw new Error("opencounter_branch_frontier_total_volume_limit_exceeded");
  }
}

function normalizeStability(value) {
  exactRecord(record(value, "stability"), [
    "consecutiveCompleteZeroNoveltySweeps",
    "requiredCompleteZeroNoveltySweeps"
  ], "stability");
  return {
    consecutiveCompleteZeroNoveltySweeps: nonNegativeInteger(
      value.consecutiveCompleteZeroNoveltySweeps,
      "stability.consecutiveCompleteZeroNoveltySweeps"
    ),
    requiredCompleteZeroNoveltySweeps: positiveInteger(
      value.requiredCompleteZeroNoveltySweeps,
      "stability.requiredCompleteZeroNoveltySweeps"
    )
  };
}

function normalizeStabilityClaim(value, report) {
  if (value === null) return null;
  exactRecord(record(value, "stability claim"), [
    "frontierSha256",
    "kind",
    "manifestId",
    "manifestSha256"
  ], "stability claim");
  if (report.status !== "branch_frontier_stable_for_manifest"
    || value.kind !== "branch_frontier_stable_for_manifest"
    || value.frontierSha256 !== report.frontierSha256
    || value.manifestId !== report.manifestId
    || value.manifestSha256 !== report.manifestSha256) {
    throw new Error("opencounter_branch_frontier_stability_claim_invalid");
  }
  return {
    frontierSha256: sha256Text(value.frontierSha256, "claim.frontierSha256"),
    kind: "branch_frontier_stable_for_manifest",
    manifestId: text(value.manifestId, 100, "claim.manifestId"),
    manifestSha256: sha256Text(value.manifestSha256, "claim.manifestSha256")
  };
}

function readArtifact({ digest, digestKey, directory, label, validate }) {
  const artifactPath = resolveArtifactPath(directory, digest, label);
  const stat = lstatSync(artifactPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  chmodSync(artifactPath, 0o600);
  const bytes = readFileSync(artifactPath);
  if (bytes.length > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error(`opencounter_branch_frontier_${label}_too_large`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  const artifact = validate(value);
  if (artifact[digestKey] !== digest) {
    throw new Error(`opencounter_branch_frontier_${label}_digest_mismatch`);
  }
  return artifact;
}

function writeArtifact({ artifact, digest, digestKey, directory, label }) {
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error(`opencounter_branch_frontier_${label}_too_large`);
  }
  const artifactPath = resolveArtifactPath(directory, digest, label);
  if (existsSync(artifactPath)) {
    readArtifact({
      digest,
      digestKey,
      directory,
      label,
      validate: (value) => value
    });
    return { bytes, [digestKey]: digest, path: artifactPath };
  }
  const temporaryPath = path.join(directory, `${digest}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporaryPath, artifactPath);
    unlinkSync(temporaryPath);
    chmodSync(artifactPath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    if (error?.code === "EEXIST") {
      readArtifact({
        digest,
        digestKey,
        directory,
        label,
        validate: (value) => value
      });
      return { bytes, [digestKey]: digest, path: artifactPath };
    }
    throw error;
  }
  return { bytes, [digestKey]: digest, path: artifactPath };
}

function resolveArtifactPath(directory, digest, label) {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`opencounter_branch_frontier_${label}_digest_invalid`);
  }
  return path.join(directory, `${digest}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || !path.isAbsolute(value)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const stat = lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function exactRecord(value, keys, label) {
  const actual = Object.keys(record(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`opencounter_branch_frontier_${label.replaceAll(" ", "_")}_invalid`);
  }
}

function uniqueShaArray(values, label) {
  return uniqueTextArray(values, label, SHA256_PATTERN);
}

function uniqueTextArray(values, label, pattern = null) {
  if (!Array.isArray(values) || values.length > 10_000) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  const seen = new Set();
  const normalized = values.map((value) => {
    const item = text(value, 2_000, label);
    if (pattern !== null && !pattern.test(item)) {
      throw new Error(`opencounter_branch_frontier_${label}_invalid`);
    }
    if (seen.has(item)) {
      throw new Error(`opencounter_branch_frontier_${label}_duplicate`);
    }
    seen.add(item);
    return item;
  });
  return normalized.sort((left, right) => left.localeCompare(right));
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`opencounter_branch_frontier_${label.replaceAll(" ", "_")}_invalid`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function normalizeCatalogEntryId(value, label) {
  return textWithPattern(value, 256, label, CATALOG_ENTRY_ID_PATTERN);
}

function zoningCode(value, label) {
  return textWithPattern(value, 100, label, /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/);
}

function textWithPattern(value, maximum, label, pattern) {
  const normalized = text(value, maximum, label);
  if (!pattern.test(normalized)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return normalized;
}

function text(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function nullableText(value, maximum, label) {
  if (value === null) return null;
  return text(value, maximum, label);
}

function sha256Text(value, label) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function nullableSha(value, label) {
  if (value === null) return null;
  return sha256Text(value, label);
}

function nullableProviderReference(value) {
  if (value === null) return null;
  if (!PROVIDER_REFERENCE_PATTERN.test(value)) {
    throw new Error("opencounter_branch_frontier_provider_reference_invalid");
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
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
