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

import { buildObservedQuestionGraph } from "./discovery-question-graph.mjs";

const LEDGER_ID_PATTERN = /^ocdl_[0-9a-f]{64}$/;
const JOB_ID_PATTERN = /^ocdj_[0-9a-f]{64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^opencounter:project:[0-9]{1,20}$/;
const FREEZE_ID_PATTERN = /^ocof_[0-9a-f]{64}$/;
const MAXIMUM_FREEZE_BYTES = 10 * 1024 * 1024;
const MAXIMUM_LEDGER_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const OBSERVED_STATUSES = new Set(["completed", "needs_input"]);
const UNSAFE_UNRESOLVED_STATUSES = new Set(["active", "failed", "indeterminate"]);

export function buildVerifiedObservationPortfolio({ catalog, frozenAt, ledgers }) {
  const timestamp = isoTimestamp(frozenAt, "frozenAt");
  const catalogIdentity = validateCatalog(catalog);
  if (!Array.isArray(ledgers) || ledgers.length < 1 || ledgers.length > 10) {
    throw new Error("opencounter_observation_portfolio_ledgers_invalid");
  }

  const observedJobs = [];
  const sourceLedgers = [];
  const catalogEntryIds = new Set();
  const jobIds = new Set();
  const providerReferences = new Set();
  const statusCounts = { completed: 0, needs_input: 0 };

  for (const ledger of ledgers) {
    validateLedgerIdentity(ledger, catalogIdentity);
    const jobs = ledger.jobs.filter((job) => OBSERVED_STATUSES.has(job?.status));
    if (ledger.jobs.some((job) => UNSAFE_UNRESOLVED_STATUSES.has(job?.status))) {
      throw new Error("opencounter_observation_portfolio_unresolved_job");
    }
    if (jobs.length < 1) {
      throw new Error("opencounter_observation_portfolio_source_empty");
    }
    for (const job of jobs) {
      validateVerifiedJob(job);
      if (catalogEntryIds.has(job.catalogEntryId)) {
        throw new Error("opencounter_observation_portfolio_catalog_entry_duplicate");
      }
      if (jobIds.has(job.jobId)) {
        throw new Error("opencounter_observation_portfolio_job_duplicate");
      }
      if (providerReferences.has(job.providerReference)) {
        throw new Error("opencounter_observation_portfolio_provider_reference_duplicate");
      }
      catalogEntryIds.add(job.catalogEntryId);
      jobIds.add(job.jobId);
      providerReferences.add(job.providerReference);
      statusCounts[job.status] += 1;
      observedJobs.push(structuredClone(job));
    }
    sourceLedgers.push({
      ledgerId: ledger.ledgerId,
      ledgerIdentitySha256: ledger.ledgerSha256,
      ledgerSnapshotSha256: sha256(ledger),
      schemaVersion: ledger.schemaVersion,
      verifiedObservationCount: jobs.length
    });
  }

  const expectedIds = new Set(catalogIdentity.catalogEntryIds);
  if (catalogEntryIds.size !== expectedIds.size
    || [...expectedIds].some((catalogEntryId) => !catalogEntryIds.has(catalogEntryId))) {
    throw new Error("opencounter_observation_portfolio_coverage_incomplete");
  }

  observedJobs.sort((left, right) =>
    left.catalogEntryId.localeCompare(right.catalogEntryId));
  sourceLedgers.sort((left, right) => left.ledgerId.localeCompare(right.ledgerId));
  const evidenceSetSha256 = sha256(sourceLedgers);
  const questionGraph = buildObservedQuestionGraph({
    jobs: observedJobs,
    ledgerSha256: evidenceSetSha256,
    schemaVersion: 4
  });
  const payload = {
    catalog: {
      catalogId: catalogIdentity.catalogId,
      catalogSha256: catalogIdentity.catalogSha256,
      tenantId: catalogIdentity.tenantId,
      tenantVersion: catalogIdentity.tenantVersion
    },
    coverage: {
      catalogEntryCount: expectedIds.size,
      statusCounts,
      verifiedObservationCount: observedJobs.length
    },
    evidenceSetSha256,
    frozenAt: timestamp,
    questionGraph,
    schemaVersion: 1,
    sourceLedgers
  };
  return {
    ...payload,
    freezeId: `ocof_${sha256(payload)}`
  };
}

export function validateVerifiedObservationPortfolio({ catalog, freeze }) {
  return validateFreeze(freeze, validateCatalog(catalog));
}

export function validateVerifiedObservationPortfolioSources({
  catalog,
  freeze,
  ledgers
}) {
  const validatedFreeze = validateVerifiedObservationPortfolio({ catalog, freeze });
  if (!Array.isArray(ledgers)
    || ledgers.length !== validatedFreeze.sourceLedgers.length) {
    throw new Error("opencounter_observation_portfolio_source_snapshot_mismatch");
  }
  let rebuilt;
  try {
    rebuilt = buildVerifiedObservationPortfolio({
      catalog,
      frozenAt: validatedFreeze.frozenAt,
      ledgers
    });
  } catch (cause) {
    throw new Error(
      "opencounter_observation_portfolio_source_snapshot_mismatch",
      { cause }
    );
  }
  if (JSON.stringify(sortJson(rebuilt))
    !== JSON.stringify(sortJson(validatedFreeze))) {
    throw new Error("opencounter_observation_portfolio_source_snapshot_mismatch");
  }
  return validatedFreeze;
}

export function createVerifiedObservationPortfolioStore({ stateDirectory }) {
  const root = validateStateDirectory(stateDirectory);
  const directory = path.join(root, "observation-freezes");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  validatePrivateDirectory(directory);
  return {
    read(freezeId) {
      return readFreeze(resolveFreezePath(directory, freezeId), freezeId);
    },
    write(value) {
      const freeze = validateFreeze(value);
      const serialized = `${JSON.stringify(freeze, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_FREEZE_BYTES) {
        throw new Error("opencounter_observation_portfolio_freeze_too_large");
      }
      const freezePath = resolveFreezePath(directory, freeze.freezeId);
      if (existsSync(freezePath)) {
        readFreeze(freezePath, freeze.freezeId);
        return { bytes, freezeId: freeze.freezeId, path: freezePath };
      }
      const temporaryPath = path.join(
        directory,
        `${freeze.freezeId}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, freezePath);
        unlinkSync(temporaryPath);
        chmodSync(freezePath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readFreeze(freezePath, freeze.freezeId);
          return { bytes, freezeId: freeze.freezeId, path: freezePath };
        }
        throw error;
      }
      return { bytes, freezeId: freeze.freezeId, path: freezePath };
    }
  };
}

export function createVerifiedObservationSnapshotStore({ stateDirectory }) {
  const root = validateStateDirectory(stateDirectory);
  const directory = path.join(root, "observation-snapshots");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  validatePrivateDirectory(directory);
  return {
    read(ledgerSnapshotSha256) {
      return readLedgerSnapshot(
        resolveLedgerSnapshotPath(directory, ledgerSnapshotSha256),
        ledgerSnapshotSha256
      );
    },
    write(value) {
      const snapshot = validateSnapshotLedger(value);
      const ledgerSnapshotSha256 = sha256(snapshot);
      const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > MAXIMUM_LEDGER_SNAPSHOT_BYTES) {
        throw new Error("opencounter_observation_portfolio_snapshot_too_large");
      }
      const snapshotPath = resolveLedgerSnapshotPath(
        directory,
        ledgerSnapshotSha256
      );
      if (existsSync(snapshotPath)) {
        readLedgerSnapshot(snapshotPath, ledgerSnapshotSha256);
        return { bytes, ledgerSnapshotSha256, path: snapshotPath };
      }
      const temporaryPath = path.join(
        directory,
        `${ledgerSnapshotSha256}.${randomUUID()}.tmp`
      );
      let descriptor;
      try {
        descriptor = openSync(temporaryPath, "wx", 0o600);
        writeFileSync(descriptor, serialized, "utf8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = undefined;
        linkSync(temporaryPath, snapshotPath);
        unlinkSync(temporaryPath);
        chmodSync(snapshotPath, 0o600);
      } catch (error) {
        if (descriptor !== undefined) closeSync(descriptor);
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
        if (error?.code === "EEXIST") {
          readLedgerSnapshot(snapshotPath, ledgerSnapshotSha256);
          return { bytes, ledgerSnapshotSha256, path: snapshotPath };
        }
        throw error;
      }
      return { bytes, ledgerSnapshotSha256, path: snapshotPath };
    }
  };
}

function validateCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !Array.isArray(value.categories)
    || typeof value.catalogId !== "string"
    || !SHA256_PATTERN.test(value.catalogSha256)
    || !Number.isSafeInteger(value.provider?.tenantId)
    || !Number.isSafeInteger(value.provider?.tenantVersion)) {
    throw new Error("opencounter_observation_portfolio_catalog_invalid");
  }
  const catalogEntryIds = value.categories.flatMap((category) => [
    ...category.entries,
    ...category.groups.flatMap((group) => group.entries)
  ]).map(({ catalogEntryId }) => catalogEntryId);
  if (catalogEntryIds.length !== 126
    || new Set(catalogEntryIds).size !== catalogEntryIds.length
    || catalogEntryIds.some((catalogEntryId) =>
      typeof catalogEntryId !== "string" || catalogEntryId.length > 200)) {
    throw new Error("opencounter_observation_portfolio_catalog_invalid");
  }
  return {
    catalogEntryIds,
    catalogId: value.catalogId,
    catalogSha256: value.catalogSha256,
    tenantId: value.provider.tenantId,
    tenantVersion: value.provider.tenantVersion
  };
}

function validateLedgerIdentity(value, catalog) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !LEDGER_ID_PATTERN.test(value.ledgerId)
    || !SHA256_PATTERN.test(value.ledgerSha256)
    || !Number.isSafeInteger(value.schemaVersion)
    || value.schemaVersion < 3
    || !Array.isArray(value.jobs)
    || value.catalog?.catalogId !== catalog.catalogId
    || value.catalog?.catalogSha256 !== catalog.catalogSha256
    || value.catalog?.tenantId !== catalog.tenantId
    || value.catalog?.tenantVersion !== catalog.tenantVersion) {
    throw new Error("opencounter_observation_portfolio_ledger_invalid");
  }
}

function validateVerifiedJob(job) {
  const expectedVerificationStatus = job.status === "completed"
    ? "completed"
    : "needs_requester_input";
  if (!job || typeof job !== "object" || Array.isArray(job)
    || typeof job.catalogEntryId !== "string"
    || !JOB_ID_PATTERN.test(job.jobId)
    || !PROVIDER_REFERENCE_PATTERN.test(job.providerReference)
    || !Array.isArray(job.categoryPath)
    || job.categoryPath.length < 1
    || !Array.isArray(job.observations)
    || job.observations.length < 1
    || !job.verification
    || job.verification.providerReference !== job.providerReference
    || job.verification.status !== expectedVerificationStatus) {
    throw new Error("opencounter_observation_portfolio_verification_missing");
  }
  if (job.status === "completed") {
    if (job.terminalResult === null
      || !SHA256_PATTERN.test(job.verification.resultSha256)) {
      throw new Error("opencounter_observation_portfolio_verification_missing");
    }
    return;
  }
  if (!job.checkpoint
    || !SHA256_PATTERN.test(job.checkpoint.checkpointSha256)
    || job.verification.checkpointSha256 !== job.checkpoint.checkpointSha256) {
    throw new Error("opencounter_observation_portfolio_verification_missing");
  }
}

function validateFreeze(value, catalog = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opencounter_observation_portfolio_freeze_invalid");
  }
  const expectedKeys = [
    "catalog", "coverage", "evidenceSetSha256", "freezeId", "frozenAt",
    "questionGraph", "schemaVersion", "sourceLedgers"
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys.sort())
    || !FREEZE_ID_PATTERN.test(value.freezeId)
    || value.schemaVersion !== 1
    || !SHA256_PATTERN.test(value.evidenceSetSha256)
    || !Array.isArray(value.sourceLedgers)
    || value.sourceLedgers.length < 1
    || !Array.isArray(value.questionGraph?.questions)
    || !Array.isArray(value.questionGraph?.edges)
    || value.questionGraph.generatedFromLedgerSha256 !== value.evidenceSetSha256) {
    throw new Error("opencounter_observation_portfolio_freeze_invalid");
  }
  const freezeCatalogKeys = [
    "catalogId", "catalogSha256", "tenantId", "tenantVersion"
  ];
  if (!value.catalog || typeof value.catalog !== "object"
    || Array.isArray(value.catalog)
    || JSON.stringify(Object.keys(value.catalog).sort())
      !== JSON.stringify(freezeCatalogKeys.sort())
    || typeof value.catalog.catalogId !== "string"
    || !SHA256_PATTERN.test(value.catalog.catalogSha256)
    || !Number.isSafeInteger(value.catalog.tenantId)
    || !Number.isSafeInteger(value.catalog.tenantVersion)
    || (catalog !== null && (
      value.catalog.catalogId !== catalog.catalogId
      || value.catalog.catalogSha256 !== catalog.catalogSha256
      || value.catalog.tenantId !== catalog.tenantId
      || value.catalog.tenantVersion !== catalog.tenantVersion
    ))) {
    throw new Error("opencounter_observation_portfolio_freeze_invalid");
  }
  isoTimestamp(value.frozenAt, "frozenAt");
  const coverage = value.coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)
    || JSON.stringify(Object.keys(coverage).sort()) !== JSON.stringify([
      "catalogEntryCount", "statusCounts", "verifiedObservationCount"
    ].sort())
    || coverage.catalogEntryCount !== 126
    || coverage.verifiedObservationCount !== 126
    || coverage.statusCounts?.completed + coverage.statusCounts?.needs_input !== 126
    || value.sourceLedgers.reduce((sum, source) =>
      sum + source.verifiedObservationCount, 0) !== 126) {
    throw new Error("opencounter_observation_portfolio_freeze_invalid");
  }
  if (JSON.stringify(Object.keys(coverage.statusCounts ?? {}).sort())
      !== JSON.stringify(["completed", "needs_input"])
    || !Number.isSafeInteger(coverage.statusCounts.completed)
    || !Number.isSafeInteger(coverage.statusCounts.needs_input)
    || coverage.statusCounts.completed < 0
    || coverage.statusCounts.needs_input < 0) {
    throw new Error("opencounter_observation_portfolio_freeze_invalid");
  }
  const sourceKeys = [
    "ledgerId", "ledgerIdentitySha256", "ledgerSnapshotSha256",
    "schemaVersion", "verifiedObservationCount"
  ];
  const ledgerIds = new Set();
  const snapshotDigests = new Set();
  for (const source of value.sourceLedgers) {
    if (!source || typeof source !== "object" || Array.isArray(source)
      || JSON.stringify(Object.keys(source).sort())
        !== JSON.stringify(sourceKeys.sort())
      || !LEDGER_ID_PATTERN.test(source.ledgerId)
      || !SHA256_PATTERN.test(source.ledgerIdentitySha256)
      || !SHA256_PATTERN.test(source.ledgerSnapshotSha256)
      || !Number.isSafeInteger(source.schemaVersion)
      || source.schemaVersion < 3
      || !Number.isSafeInteger(source.verifiedObservationCount)
      || source.verifiedObservationCount < 1
      || ledgerIds.has(source.ledgerId)
      || snapshotDigests.has(source.ledgerSnapshotSha256)) {
      throw new Error("opencounter_observation_portfolio_freeze_invalid");
    }
    ledgerIds.add(source.ledgerId);
    snapshotDigests.add(source.ledgerSnapshotSha256);
  }
  const canonicalSourceLedgers = [...value.sourceLedgers].sort((left, right) =>
    left.ledgerId.localeCompare(right.ledgerId));
  if (JSON.stringify(value.sourceLedgers) !== JSON.stringify(canonicalSourceLedgers)
    || value.evidenceSetSha256 !== sha256(value.sourceLedgers)) {
    throw new Error("opencounter_observation_portfolio_evidence_set_invalid");
  }
  const { freezeId, ...payload } = value;
  if (freezeId !== `ocof_${sha256(payload)}`) {
    throw new Error("opencounter_observation_portfolio_freeze_identity_invalid");
  }
  return structuredClone(value);
}

function validateStateDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("opencounter_observation_portfolio_state_directory_invalid");
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  validatePrivateDirectory(value);
  return path.resolve(value);
}

function validatePrivateDirectory(value) {
  const metadata = lstatSync(value);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("opencounter_observation_portfolio_state_directory_invalid");
  }
  chmodSync(value, 0o700);
}

function resolveFreezePath(directory, freezeId) {
  if (typeof freezeId !== "string" || !FREEZE_ID_PATTERN.test(freezeId)) {
    throw new Error("opencounter_observation_portfolio_freeze_id_invalid");
  }
  return path.join(directory, `${freezeId}.json`);
}

function resolveLedgerSnapshotPath(directory, ledgerSnapshotSha256) {
  if (typeof ledgerSnapshotSha256 !== "string"
    || !SHA256_PATTERN.test(ledgerSnapshotSha256)) {
    throw new Error("opencounter_observation_portfolio_snapshot_id_invalid");
  }
  return path.join(directory, `${ledgerSnapshotSha256}.json`);
}

function readFreeze(freezePath, expectedFreezeId) {
  const metadata = lstatSync(freezePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()
    || metadata.size < 1 || metadata.size > MAXIMUM_FREEZE_BYTES) {
    throw new Error("opencounter_observation_portfolio_freeze_file_invalid");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(freezePath, "utf8"));
  } catch {
    throw new Error("opencounter_observation_portfolio_freeze_json_invalid");
  }
  const freeze = validateFreeze(value);
  if (freeze.freezeId !== expectedFreezeId) {
    throw new Error("opencounter_observation_portfolio_freeze_identity_invalid");
  }
  return freeze;
}

function readLedgerSnapshot(snapshotPath, expectedSha256) {
  const metadata = lstatSync(snapshotPath);
  if (metadata.isSymbolicLink() || !metadata.isFile()
    || metadata.size < 1 || metadata.size > MAXIMUM_LEDGER_SNAPSHOT_BYTES) {
    throw new Error("opencounter_observation_portfolio_snapshot_file_invalid");
  }
  let value;
  try {
    value = JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch {
    throw new Error("opencounter_observation_portfolio_snapshot_json_invalid");
  }
  const snapshot = validateSnapshotLedger(value);
  if (sha256(snapshot) !== expectedSha256) {
    throw new Error("opencounter_observation_portfolio_snapshot_identity_invalid");
  }
  return snapshot;
}

function validateSnapshotLedger(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !LEDGER_ID_PATTERN.test(value.ledgerId)
    || !SHA256_PATTERN.test(value.ledgerSha256)
    || !Number.isSafeInteger(value.schemaVersion)
    || value.schemaVersion < 3
    || !Array.isArray(value.jobs)) {
    throw new Error("opencounter_observation_portfolio_snapshot_invalid");
  }
  return sortJson(structuredClone(value));
}

function isoTimestamp(value, path) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`opencounter_observation_portfolio_${path}_invalid`);
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
