import { createHash } from "node:crypto";

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const CATALOG_ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,255}$/;

const SOURCE_FREEZE_PATTERN = /^ocof_[0-9a-f]{64}$/;

export function normalizeManifestPayload(value) {
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

export function exactRecord(value, keys, label) {
  const actual = Object.keys(record(value, label)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`opencounter_branch_frontier_${label.replaceAll(" ", "_")}_invalid`);
  }
}

export function uniqueShaArray(values, label) {
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

export function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`opencounter_branch_frontier_${label.replaceAll(" ", "_")}_invalid`);
  }
  return value;
}

export function positiveInteger(value, label) {
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

export function text(value, maximum, label) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

export function sha256Text(value, label) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

function nullableSha(value, label) {
  if (value === null) return null;
  return sha256Text(value, label);
}

export function timestamp(value, label) {
  if (typeof value !== "string"
    || !value.endsWith("Z")
    || Number.isNaN(Date.parse(value))) {
    throw new Error(`opencounter_branch_frontier_${label}_invalid`);
  }
  return value;
}

export function sha256(value) {
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
