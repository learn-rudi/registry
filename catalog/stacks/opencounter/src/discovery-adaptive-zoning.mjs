import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { validateMasterQuestionnaire } from "./discovery-master-questionnaire.mjs";
import { validateVerifiedObservationPortfolioSources } from "./discovery-observation-portfolio.mjs";
import {
  ID_PATTERN,
  MAXIMUM_PROVIDER_PROJECTS,
  MAXIMUM_ZONES_PER_USE,
  REQUIRED_SAMPLING_STRATA,
  REQUIRED_SIGNAL_WEIGHTS,
  SIGNAL_WEIGHT_KEYS,
  ZONING_CODE_PATTERN,
  exactRecord,
  validateAdaptivePolicy
} from "./discovery-adaptive-policy.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const QUESTIONNAIRE_ID_PATTERN = /^ocmq_[0-9a-f]{64}$/;

const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;

const MAXIMUM_PREVIEW_BYTES = 10 * 1024 * 1024;

const REQUIRED_STRATUM_BY_ZONE = new Map(REQUIRED_SAMPLING_STRATA.flatMap(
  ([stratumId, zones]) => zones.map((zone) => [zone, stratumId])
));

const REASON_BY_WEIGHT = {
  firstPassProhibited: "first_pass_prohibited",
  questionPatternDivergence: "question_pattern_divergence",
  terminalOutcomeDivergence: "terminal_outcome_divergence",
  uniqueQuestionSignature: "unique_question_signature"
};

const WEIGHT_BY_REASON = Object.fromEntries(SIGNAL_WEIGHT_KEYS.map((key) => [
  REASON_BY_WEIGHT[key],
  REQUIRED_SIGNAL_WEIGHTS[key]
]));

export function buildAdaptiveZoningPreview({
  catalog,
  freeze,
  generatedAt,
  policy,
  precursorStatus,
  questionnaire,
  sourceLedgers
}) {
  timestamp(generatedAt, "generatedAt");
  if (precursorStatus !== null
    && precursorStatus !== "scenario_wave_1_complete") {
    throw new Error("opencounter_adaptive_zoning_precursor_status_invalid");
  }
  const verifiedFreeze = validateVerifiedObservationPortfolioSources({
    catalog,
    freeze,
    ledgers: sourceLedgers
  });
  const library = validateMasterQuestionnaire(questionnaire);
  const samplingPolicy = validateAdaptivePolicy(policy, catalog);
  if (library.evidence.sourceFreezeId !== verifiedFreeze.freezeId
    || JSON.stringify(library.evidence.sourceLedgerSnapshotSha256s)
      !== JSON.stringify(verifiedFreeze.sourceLedgers.map(
        ({ ledgerSnapshotSha256 }) => ledgerSnapshotSha256
      ))
    || library.catalog.catalogId !== verifiedFreeze.catalog.catalogId
    || library.catalog.catalogSha256 !== verifiedFreeze.catalog.catalogSha256
    || library.catalog.tenantId !== verifiedFreeze.catalog.tenantId
    || library.catalog.tenantVersion !== verifiedFreeze.catalog.tenantVersion) {
    throw new Error("opencounter_adaptive_zoning_source_mismatch");
  }
  const entries = flattenCatalog(catalog);
  const sourceJobs = indexSourceJobs(sourceLedgers, entries);
  const questionPatterns = new Map(entries.map((entry) => [
    entry.catalogEntryId,
    library.questions.filter((question) =>
      question.providerQuestionId !== "opencounter-address"
      && question.applicability.catalogEntryIds.includes(entry.catalogEntryId))
      .map(({ internalQuestionId }) => internalQuestionId)
      .sort(compareText)
  ]));
  const terminalOutcomes = new Map(entries.map((entry) => [
    entry.catalogEntryId,
    observedTerminalClassifications(library, entry.catalogEntryId)
  ]));
  const peersByCategoryPath = groupBy(entries, ({ categoryPath }) =>
    categoryPath.join(" / "));
  const policyZones = samplingPolicy.samplingStrata.flatMap(
    ({ baseZoningCodes }) => baseZoningCodes
  );
  const stratumByZone = new Map(samplingPolicy.samplingStrata.flatMap(
    (stratum) => stratum.baseZoningCodes.map((zone) => [zone, stratum])
  ));
  const eligible = [];
  for (const entry of entries) {
    const job = sourceJobs.get(entry.catalogEntryId);
    const peers = peersByCategoryPath.get(entry.categoryPath.join(" / "));
    const questionPattern = questionPatterns.get(entry.catalogEntryId);
    const questionPatternKey = JSON.stringify(questionPattern);
    const outcomeKey = JSON.stringify(terminalOutcomes.get(entry.catalogEntryId));
    const signals = {
      firstPassProhibited: job.status === "completed"
        && job.terminalResult?.classification === "Prohibited",
      questionPatternDivergence: peers.some((peer) =>
        JSON.stringify(questionPatterns.get(peer.catalogEntryId))
          !== questionPatternKey),
      terminalOutcomeDivergence: peers.some((peer) =>
        JSON.stringify(terminalOutcomes.get(peer.catalogEntryId))
          !== outcomeKey),
      uniqueQuestionSignature: questionPattern.some((questionId) =>
        peers.filter((peer) =>
          questionPatterns.get(peer.catalogEntryId).includes(questionId)
        ).length === 1)
    };
    const priorityReasons = SIGNAL_WEIGHT_KEYS.filter((signal) =>
      signals[signal]).map((signal) => REASON_BY_WEIGHT[signal]);
    const priorityScore = SIGNAL_WEIGHT_KEYS.reduce((score, signal) =>
      score + (signals[signal]
        ? samplingPolicy.signalWeights[signal]
        : 0), 0);
    if (priorityScore < samplingPolicy.minimumPriorityScore) continue;
    const observedBaseZoningCodes = observedZonesForEntry(
      library,
      entry.catalogEntryId,
      job
    );
    const observedStrata = new Set(observedBaseZoningCodes.map((zone) =>
      stratumByZone.get(zone)?.stratumId).filter(Boolean));
    const availableStrata = rotate(
      samplingPolicy.samplingStrata.filter(({ stratumId }) =>
        !observedStrata.has(stratumId)),
      stableOffset(entry.catalogEntryId, samplingPolicy.samplingStrata.length)
    );
    const targetCount = Math.min(
      samplingPolicy.maximumZonesPerUse,
      availableStrata.length
    );
    for (let selectionRank = 0; selectionRank < targetCount; selectionRank += 1) {
      const stratum = availableStrata[selectionRank];
      const availableZones = stratum.baseZoningCodes.filter((zone) =>
        !observedBaseZoningCodes.includes(zone));
      if (availableZones.length === 0) continue;
      const zoneOffset = stableOffset(
        `${entry.catalogEntryId}:${stratum.stratumId}`,
        availableZones.length
      );
      const targetBaseZoningCode = availableZones[zoneOffset];
      if (!policyZones.includes(targetBaseZoningCode)) {
        throw new Error("opencounter_adaptive_zoning_target_invalid");
      }
      const candidatePayload = {
        catalogEntryId: entry.catalogEntryId,
        categoryPath: entry.categoryPath,
        observedBaseZoningCodes,
        observedSamplingStrata: [...observedStrata].sort(compareText),
        priorityReasons: [...priorityReasons].sort(compareText),
        priorityScore,
        selectionRank,
        targetBaseZoningCode,
        targetSamplingStratum: stratum.stratumId
      };
      eligible.push({
        ...candidatePayload,
        candidateId: `ocazc_${sha256(candidatePayload)}`
      });
    }
  }
  eligible.sort((left, right) =>
    right.priorityScore - left.priorityScore
    || left.catalogEntryId.localeCompare(right.catalogEntryId)
    || left.selectionRank - right.selectionRank
    || left.targetBaseZoningCode.localeCompare(right.targetBaseZoningCode));
  const candidates = eligible.slice(0, samplingPolicy.maximumProviderProjects);
  const prerequisiteSatisfied =
    precursorStatus === samplingPolicy.requiredPrecursorStatus;
  const status = candidates.length === 0
    ? "no_adaptive_candidates"
    : prerequisiteSatisfied
      ? "adaptive_preview_ready"
      : "provisional_before_scenario_wave_1";
  const selectedUseCount = new Set(candidates.map(
    ({ catalogEntryId }) => catalogEntryId
  )).size;
  const payload = {
    artifactKind: "opencounter_adaptive_zoning_preview",
    authorizationGranted: false,
    authorizationRequired: true,
    candidates,
    catalog: {
      catalogId: library.catalog.catalogId,
      catalogSha256: library.catalog.catalogSha256,
      tenantId: library.catalog.tenantId,
      tenantVersion: library.catalog.tenantVersion
    },
    coverage: {
      candidateCountBeforeCap: eligible.length,
      maximumProviderProjects: samplingPolicy.maximumProviderProjects,
      plannedProviderProjects: candidates.length,
      selectedUseCount
    },
    evidence: {
      questionnaireId: library.questionnaireId,
      questionnaireSha256: library.questionnaireSha256,
      sourceFreezeId: verifiedFreeze.freezeId,
      sourceLedgerSnapshotSha256s:
        library.evidence.sourceLedgerSnapshotSha256s
    },
    generatedAt,
    policy: {
      policyId: samplingPolicy.policyId,
      policySha256: sha256(samplingPolicy),
      policyVersion: samplingPolicy.policyVersion
    },
    prerequisite: {
      observedStatus: precursorStatus,
      requiredStatus: samplingPolicy.requiredPrecursorStatus,
      satisfied: prerequisiteSatisfied
    },
    saturation: {
      claim: null,
      requiredCompleteZeroNoveltySweeps: 2,
      status: "not_evaluated"
    },
    schemaVersion: 1,
    status
  };
  const previewSha256 = sha256(payload);
  return validateAdaptiveZoningPreview({
    ...payload,
    previewId: `ocaz_${previewSha256}`,
    previewSha256
  });
}

export function validateAdaptiveZoningPreview(value) {
  exactRecord(value, [
    "artifactKind", "authorizationGranted", "authorizationRequired",
    "candidates", "catalog", "coverage", "evidence", "generatedAt",
    "policy", "prerequisite", "previewId", "previewSha256", "saturation",
    "schemaVersion", "status"
  ], "preview");
  if (value.artifactKind !== "opencounter_adaptive_zoning_preview"
    || value.schemaVersion !== 1
    || value.authorizationGranted !== false
    || value.authorizationRequired !== true
    || !/^ocaz_[0-9a-f]{64}$/.test(value.previewId)
    || !SHA256_PATTERN.test(value.previewSha256)
    || value.previewId !== `ocaz_${value.previewSha256}`
    || ![
      "adaptive_preview_ready",
      "no_adaptive_candidates",
      "provisional_before_scenario_wave_1"
    ].includes(value.status)) {
    throw new Error("opencounter_adaptive_zoning_preview_invalid");
  }
  exactRecord(value.catalog, [
    "catalogId", "catalogSha256", "tenantId", "tenantVersion"
  ], "preview_catalog");
  if (value.catalog.catalogId
      !== "cincinnati-opencounter-zoning-use-catalog-v1"
    || !SHA256_PATTERN.test(value.catalog.catalogSha256)
    || !Number.isSafeInteger(value.catalog.tenantId)
    || value.catalog.tenantId < 1
    || !Number.isSafeInteger(value.catalog.tenantVersion)
    || value.catalog.tenantVersion < 1) {
    throw new Error("opencounter_adaptive_zoning_preview_catalog_invalid");
  }
  exactRecord(value.evidence, [
    "questionnaireId", "questionnaireSha256", "sourceFreezeId",
    "sourceLedgerSnapshotSha256s"
  ], "preview_evidence");
  if (!QUESTIONNAIRE_ID_PATTERN.test(value.evidence.questionnaireId)
    || !SHA256_PATTERN.test(value.evidence.questionnaireSha256)
    || value.evidence.questionnaireId
      !== `ocmq_${value.evidence.questionnaireSha256}`
    || !FREEZE_ID_PATTERN.test(value.evidence.sourceFreezeId)) {
    throw new Error("opencounter_adaptive_zoning_preview_evidence_invalid");
  }
  const sourceLedgerSnapshotSha256s = stringArray(
    value.evidence.sourceLedgerSnapshotSha256s,
    10,
    SHA256_PATTERN,
    true
  );
  exactRecord(value.policy, [
    "policyId", "policySha256", "policyVersion"
  ], "preview_policy");
  if (value.policy.policyId
      !== "cincinnati-adaptive-zoning-question-discovery-v1"
    || !SHA256_PATTERN.test(value.policy.policySha256)
    || value.policy.policyVersion !== 1) {
    throw new Error("opencounter_adaptive_zoning_preview_policy_invalid");
  }
  exactRecord(value.prerequisite, [
    "observedStatus", "requiredStatus", "satisfied"
  ], "preview_prerequisite");
  if (value.prerequisite.requiredStatus !== "scenario_wave_1_complete"
    || value.prerequisite.observedStatus !== null
      && value.prerequisite.observedStatus !== "scenario_wave_1_complete"
    || value.prerequisite.satisfied
      !== (value.prerequisite.observedStatus
        === value.prerequisite.requiredStatus)) {
    throw new Error(
      "opencounter_adaptive_zoning_preview_prerequisite_invalid"
    );
  }
  exactRecord(value.saturation, [
    "claim", "requiredCompleteZeroNoveltySweeps", "status"
  ], "preview_saturation");
  if (value.saturation.claim !== null
    || value.saturation.requiredCompleteZeroNoveltySweeps !== 2
    || value.saturation.status !== "not_evaluated") {
    throw new Error("opencounter_adaptive_zoning_preview_saturation_invalid");
  }
  if (!Array.isArray(value.candidates)
    || value.candidates.length > MAXIMUM_PROVIDER_PROJECTS) {
    throw new Error("opencounter_adaptive_zoning_preview_candidates_invalid");
  }
  const cells = new Set();
  const candidateIds = new Set();
  const candidates = value.candidates.map((candidate) => {
    exactRecord(candidate, [
      "candidateId", "catalogEntryId", "categoryPath",
      "observedBaseZoningCodes", "observedSamplingStrata", "priorityReasons",
      "priorityScore", "selectionRank", "targetBaseZoningCode",
      "targetSamplingStratum"
    ], "preview_candidate");
    const { candidateId, ...candidatePayload } = candidate;
    const cell = `${candidate.catalogEntryId}:${candidate.targetBaseZoningCode}`;
    if (!/^ocazc_[0-9a-f]{64}$/.test(candidateId)
      || candidateId !== `ocazc_${sha256(candidatePayload)}`
      || candidateIds.has(candidateId)
      || cells.has(cell)
      || !/^[a-z0-9_]+(?:\.[a-z0-9_]+)+$/.test(candidate.catalogEntryId)
      || !Array.isArray(candidate.categoryPath)
      || candidate.categoryPath.length < 1
      || candidate.categoryPath.length > 2
      || candidate.categoryPath.some((part) => !trimmedText(part, 500))
      || !ZONING_CODE_PATTERN.test(candidate.targetBaseZoningCode)
      || !ID_PATTERN.test(candidate.targetSamplingStratum)
      || REQUIRED_STRATUM_BY_ZONE.get(candidate.targetBaseZoningCode)
        !== candidate.targetSamplingStratum
      || !Number.isSafeInteger(candidate.priorityScore)
      || candidate.priorityScore < 1
      || candidate.priorityScore > 400
      || !Number.isSafeInteger(candidate.selectionRank)
      || candidate.selectionRank < 0
      || candidate.selectionRank >= MAXIMUM_ZONES_PER_USE) {
      throw new Error("opencounter_adaptive_zoning_preview_candidate_invalid");
    }
    candidateIds.add(candidateId);
    cells.add(cell);
    const observedBaseZoningCodes = stringArray(
      candidate.observedBaseZoningCodes,
      37,
      ZONING_CODE_PATTERN,
      true
    );
    if (observedBaseZoningCodes.includes(candidate.targetBaseZoningCode)) {
      throw new Error("opencounter_adaptive_zoning_preview_candidate_invalid");
    }
    const priorityReasons = stringArray(
      candidate.priorityReasons,
      SIGNAL_WEIGHT_KEYS.length,
      null,
      true
    );
    if (priorityReasons.some((reason) => WEIGHT_BY_REASON[reason] === undefined)
      || priorityReasons.reduce((score, reason) =>
        score + WEIGHT_BY_REASON[reason], 0) !== candidate.priorityScore) {
      throw new Error("opencounter_adaptive_zoning_preview_candidate_invalid");
    }
    return {
      candidateId,
      catalogEntryId: candidate.catalogEntryId,
      categoryPath: [...candidate.categoryPath],
      observedBaseZoningCodes,
      observedSamplingStrata: stringArray(
        candidate.observedSamplingStrata,
        37,
        ID_PATTERN
      ),
      priorityReasons,
      priorityScore: candidate.priorityScore,
      selectionRank: candidate.selectionRank,
      targetBaseZoningCode: candidate.targetBaseZoningCode,
      targetSamplingStratum: candidate.targetSamplingStratum
    };
  });
  const sortedCandidates = [...candidates].sort((left, right) =>
    right.priorityScore - left.priorityScore
    || left.catalogEntryId.localeCompare(right.catalogEntryId)
    || left.selectionRank - right.selectionRank
    || left.targetBaseZoningCode.localeCompare(right.targetBaseZoningCode));
  if (JSON.stringify(candidates) !== JSON.stringify(sortedCandidates)) {
    throw new Error("opencounter_adaptive_zoning_preview_order_invalid");
  }
  exactRecord(value.coverage, [
    "candidateCountBeforeCap", "maximumProviderProjects",
    "plannedProviderProjects", "selectedUseCount"
  ], "preview_coverage");
  const selectedUseCount = new Set(candidates.map(
    ({ catalogEntryId }) => catalogEntryId
  )).size;
  if (!Number.isSafeInteger(value.coverage.candidateCountBeforeCap)
    || value.coverage.candidateCountBeforeCap < candidates.length
    || !Number.isSafeInteger(value.coverage.maximumProviderProjects)
    || value.coverage.maximumProviderProjects < 1
    || value.coverage.maximumProviderProjects > MAXIMUM_PROVIDER_PROJECTS
    || value.coverage.plannedProviderProjects !== candidates.length
    || candidates.length > value.coverage.maximumProviderProjects
    || value.coverage.selectedUseCount !== selectedUseCount) {
    throw new Error("opencounter_adaptive_zoning_preview_coverage_invalid");
  }
  const expectedStatus = candidates.length === 0
    ? "no_adaptive_candidates"
    : value.prerequisite.satisfied
      ? "adaptive_preview_ready"
      : "provisional_before_scenario_wave_1";
  if (value.status !== expectedStatus) {
    throw new Error("opencounter_adaptive_zoning_preview_status_invalid");
  }
  const payload = {
    artifactKind: value.artifactKind,
    authorizationGranted: value.authorizationGranted,
    authorizationRequired: value.authorizationRequired,
    candidates,
    catalog: structuredClone(value.catalog),
    coverage: structuredClone(value.coverage),
    evidence: {
      questionnaireId: value.evidence.questionnaireId,
      questionnaireSha256: value.evidence.questionnaireSha256,
      sourceFreezeId: value.evidence.sourceFreezeId,
      sourceLedgerSnapshotSha256s
    },
    generatedAt: timestamp(value.generatedAt, "generatedAt"),
    policy: structuredClone(value.policy),
    prerequisite: structuredClone(value.prerequisite),
    saturation: structuredClone(value.saturation),
    schemaVersion: value.schemaVersion,
    status: value.status
  };
  if (sha256(payload) !== value.previewSha256) {
    throw new Error("opencounter_adaptive_zoning_preview_digest_mismatch");
  }
  return {
    ...payload,
    previewId: value.previewId,
    previewSha256: value.previewSha256
  };
}

export function createAdaptiveZoningPreviewStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "state_directory");
  const directory = path.join(root, "adaptive-zoning-previews");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  privateDirectory(directory, "preview_directory");
  return {
    read(previewSha256) {
      return readPreview(resolvePreviewPath(directory, previewSha256),
        previewSha256);
    },
    write(value) {
      const preview = validateAdaptiveZoningPreview(value);
      const serialized = `${JSON.stringify(preview, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_PREVIEW_BYTES) {
        throw new Error("opencounter_adaptive_zoning_preview_too_large");
      }
      const previewPath = resolvePreviewPath(
        directory,
        preview.previewSha256
      );
      if (existsSync(previewPath)) {
        readPreview(previewPath, preview.previewSha256);
        return { bytes, path: previewPath, previewSha256: preview.previewSha256 };
      }
      const temporaryPath = path.join(
        directory,
        `${preview.previewSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, previewPath);
        unlinkSync(temporaryPath);
        chmodSync(previewPath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readPreview(previewPath, preview.previewSha256);
          return {
            bytes,
            path: previewPath,
            previewSha256: preview.previewSha256
          };
        }
        throw error;
      }
      return { bytes, path: previewPath, previewSha256: preview.previewSha256 };
    }
  };
}

function flattenCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.categories)) {
    throw new Error("opencounter_adaptive_zoning_catalog_invalid");
  }
  return catalog.categories.flatMap((category) => [
    ...category.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label]
    })),
    ...category.groups.flatMap((group) => group.entries.map((entry) => ({
      catalogEntryId: entry.catalogEntryId,
      categoryPath: [category.label, group.label]
    })))
  ]).sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
}

function indexSourceJobs(sourceLedgers, entries) {
  const byEntry = new Map();
  for (const ledger of sourceLedgers) {
    for (const job of ledger.jobs) {
      if (!["completed", "needs_input"].includes(job.status)) continue;
      if (byEntry.has(job.catalogEntryId)) {
        throw new Error("opencounter_adaptive_zoning_source_job_duplicate");
      }
      byEntry.set(job.catalogEntryId, job);
    }
  }
  if (byEntry.size !== entries.length
    || entries.some(({ catalogEntryId }) => !byEntry.has(catalogEntryId))) {
    throw new Error("opencounter_adaptive_zoning_source_jobs_incomplete");
  }
  return byEntry;
}

function observedTerminalClassifications(library, catalogEntryId) {
  const classifications = new Set();
  for (const question of library.questions) {
    for (const transition of question.outcomes.observedTransitions) {
      if (transition.targetQuestionId === null
        && transition.applicability.catalogEntryIds.includes(catalogEntryId)) {
        for (const classification of transition.terminalClassifications) {
          classifications.add(classification);
        }
      }
    }
  }
  return [...classifications].sort(compareNullableText);
}

function observedZonesForEntry(library, catalogEntryId, job) {
  const zones = new Set([
    job.locationFixture.expectedBaseZoningCode
  ]);
  for (const question of library.questions) {
    if (!question.applicability.catalogEntryIds.includes(catalogEntryId)) continue;
    addAll(zones, question.applicability.expectedBaseZoningCodes);
    addAll(zones, question.applicability.observedZoningCodes);
    for (const transition of question.outcomes.observedTransitions) {
      if (!transition.applicability.catalogEntryIds.includes(catalogEntryId)) {
        continue;
      }
      addAll(zones, transition.applicability.expectedBaseZoningCodes);
      addAll(zones, transition.applicability.observedZoningCodes);
    }
  }
  return [...zones].sort(compareText);
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function rotate(values, offset) {
  if (values.length === 0) return [];
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function stableOffset(value, modulus) {
  if (modulus < 1) return 0;
  return Number.parseInt(sha256(value).slice(0, 12), 16) % modulus;
}

function readPreview(previewPath, expectedSha256) {
  const metadata = lstatSync(previewPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()
    || metadata.size < 1 || metadata.size > MAXIMUM_PREVIEW_BYTES) {
    throw new Error("opencounter_adaptive_zoning_preview_file_invalid");
  }
  chmodSync(previewPath, 0o600);
  let value;
  try {
    value = JSON.parse(readFileSync(previewPath, "utf8"));
  } catch {
    throw new Error("opencounter_adaptive_zoning_preview_json_invalid");
  }
  const preview = validateAdaptiveZoningPreview(value);
  if (preview.previewSha256 !== expectedSha256) {
    throw new Error("opencounter_adaptive_zoning_preview_digest_mismatch");
  }
  return preview;
}

function resolvePreviewPath(directory, previewSha256) {
  if (!SHA256_PATTERN.test(previewSha256)) {
    throw new Error("opencounter_adaptive_zoning_preview_digest_invalid");
  }
  return path.join(directory, `${previewSha256}.json`);
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1 || !path.isAbsolute(value)) {
    throw new Error(`opencounter_adaptive_zoning_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const metadata = lstatSync(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`opencounter_adaptive_zoning_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return value;
}

function stringArray(
  value,
  maximum,
  pattern = null,
  requireNonEmpty = false
) {
  if (!Array.isArray(value)
    || value.length > maximum
    || requireNonEmpty && value.length < 1
    || value.some((entry) => !trimmedText(entry, 2_000)
      || pattern !== null && !pattern.test(entry))
    || new Set(value).size !== value.length
    || JSON.stringify(value) !== JSON.stringify([...value].sort(compareText))) {
    throw new Error("opencounter_adaptive_zoning_string_array_invalid");
  }
  return [...value];
}

function trimmedText(value, maximum) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= maximum
    && value === value.trim()
    && !/[\u0000-\u001F\u007F]/.test(value);
}

function timestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_adaptive_zoning_${label}_invalid`);
  }
  return value;
}

function addAll(target, values) {
  for (const value of values) target.add(value);
}

function compareText(left, right) {
  return left.localeCompare(right);
}

function compareNullableText(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left.localeCompare(right);
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
