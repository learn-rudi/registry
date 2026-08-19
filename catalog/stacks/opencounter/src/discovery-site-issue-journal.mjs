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
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const LEDGER_ID_PATTERN = /^ocdl_[0-9a-f]{64}$/;
const JOB_ID_PATTERN = /^ocdj_[0-9a-f]{64}$/;
const PROVIDER_REFERENCE_PATTERN = /^opencounter:project:[0-9]{1,20}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const CATEGORIES = new Set([
  "provider_address_resolution",
  "provider_catalog_drift",
  "provider_dispatch_timeout_or_unusable",
  "provider_http_failure",
  "provider_readback_conflict",
  "provider_state_failure",
  "provider_ui_drift",
  "provider_unknown_failure",
  "provider_zoning_context_drift"
]);
const STAGES = new Set([
  "address", "catalog", "continue", "questionnaire", "readback",
  "reconcile", "start", "summary", "zoning"
]);
const RECOVERY_ACTIONS = new Set([
  "exact_checkpoint_replay", "human_adjudication", "none",
  "readback_retry", "same_project_reconciliation", "versioned_preview"
]);
const RESOLUTION_KINDS = new Map([
  ["accepted_verified_context", "adjudicated"],
  ["recovered_same_project", "recovered"],
  ["superseded_by_version", "adjudicated"]
]);
const MAXIMUM_ARTIFACT_BYTES = 20 * 1024 * 1024;

export function createSiteIssueDetectionEvent(input) {
  const normalized = normalizeDetectionInput(input);
  const incidentPayload = {
    category: normalized.category,
    code: normalized.code,
    jobId: normalized.jobId,
    ledgerId: normalized.ledgerId,
    sourceEventKey: normalized.sourceEventKey,
    stage: normalized.stage
  };
  const incidentSha256 = sha256(incidentPayload);
  return addEventIdentity({
    artifactKind: "opencounter_site_issue_event",
    ...normalized,
    eventType: "detected",
    incidentId: `ocsi_${incidentSha256}`,
    incidentSha256,
    observedAt: normalized.detectedAt,
    relatedEventId: null,
    resolutionKind: null,
    schemaVersion: 1
  }, ["detectedAt"]);
}

export function createSiteIssueResolutionEvent({
  detectedEvent,
  resolutionAt,
  resolutionKind
}) {
  const detected = validateSiteIssueEvent(detectedEvent);
  if (detected.eventType !== "detected") {
    throw new Error("opencounter_site_issue_resolution_detected_invalid");
  }
  const eventType = RESOLUTION_KINDS.get(resolutionKind);
  const timestamp = isoTimestamp(resolutionAt, "resolutionAt");
  if (eventType === undefined
    || Date.parse(timestamp) < Date.parse(detected.observedAt)) {
    throw new Error("opencounter_site_issue_resolution_invalid");
  }
  return addEventIdentity({
    artifactKind: "opencounter_site_issue_event",
    category: detected.category,
    checkpointSha256: detected.checkpointSha256,
    code: detected.code,
    effect: detected.effect,
    eventType,
    incidentId: detected.incidentId,
    incidentSha256: detected.incidentSha256,
    jobId: detected.jobId,
    ledgerId: detected.ledgerId,
    observedAt: timestamp,
    providerReference: detected.providerReference,
    recoveryAction: detected.recoveryAction,
    relatedEventId: detected.eventId,
    resolutionKind,
    schemaVersion: 1,
    severity: detected.severity,
    sourceArtifactSha256: detected.sourceArtifactSha256,
    sourceEventKey: detected.sourceEventKey,
    stage: detected.stage
  });
}

export function createLedgerErrorSourceEventKey({ error, errorIndex }) {
  if (!Number.isInteger(errorIndex) || errorIndex < 0 || errorIndex > 2_000) {
    throw new Error("opencounter_site_issue_error_index_invalid");
  }
  return `ledger-error:${errorIndex}:${sha256(record(error, "job error"))}`;
}

export function buildSiteIssueSnapshot({ builtAt, events }) {
  const timestamp = isoTimestamp(builtAt, "builtAt");
  if (!Array.isArray(events) || events.length > 20_000) {
    throw new Error("opencounter_site_issue_snapshot_events_invalid");
  }
  const byEvent = new Map();
  for (const value of events) {
    const event = validateSiteIssueEvent(value);
    const existing = byEvent.get(event.eventSha256);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error("opencounter_site_issue_event_conflict");
    }
    byEvent.set(event.eventSha256, event);
  }
  const normalizedEvents = [...byEvent.values()].sort(compareEvents);
  if (normalizedEvents.some(({ observedAt }) =>
    Date.parse(observedAt) > Date.parse(timestamp))) {
    throw new Error("opencounter_site_issue_snapshot_time_invalid");
  }
  const groups = new Map();
  for (const event of normalizedEvents) {
    const values = groups.get(event.incidentId) ?? [];
    values.push(event);
    groups.set(event.incidentId, values);
  }
  const incidents = [...groups.entries()].map(([incidentId, values]) => {
    const detections = values.filter(({ eventType }) => eventType === "detected");
    const resolutions = values.filter(({ eventType }) => eventType !== "detected");
    if (detections.length !== 1 || resolutions.length > 1
      || resolutions.some(({ relatedEventId }) =>
        relatedEventId !== detections[0].eventId)) {
      throw new Error("opencounter_site_issue_lifecycle_invalid");
    }
    const detected = detections[0];
    const resolution = resolutions[0] ?? null;
    return {
      category: detected.category,
      code: detected.code,
      detectedAt: detected.observedAt,
      incidentId,
      incidentSha256: detected.incidentSha256,
      jobId: detected.jobId,
      lastEventId: resolution?.eventId ?? detected.eventId,
      ledgerId: detected.ledgerId,
      providerReference: detected.providerReference,
      resolvedAt: resolution?.observedAt ?? null,
      severity: detected.severity,
      stage: detected.stage,
      status: resolution?.eventType ?? "open"
    };
  }).sort((left, right) => left.incidentId.localeCompare(right.incidentId));
  const payload = {
    artifactKind: "opencounter_site_issue_snapshot",
    builtAt: timestamp,
    events: normalizedEvents,
    incidents,
    schemaVersion: 1,
    summary: {
      categoryCounts: countBy(incidents, "category"),
      codeCounts: countBy(incidents, "code"),
      statusCounts: {
        adjudicated: incidents.filter(({ status }) => status === "adjudicated").length,
        open: incidents.filter(({ status }) => status === "open").length,
        recovered: incidents.filter(({ status }) => status === "recovered").length
      }
    }
  };
  const snapshotSha256 = sha256(payload);
  return {
    ...payload,
    snapshotId: `ocsis_${snapshotSha256}`,
    snapshotSha256
  };
}

export function deriveSiteIssueEventsFromLedgers({ ledgers }) {
  if (!Array.isArray(ledgers) || ledgers.length < 1 || ledgers.length > 100) {
    throw new Error("opencounter_site_issue_ledgers_invalid");
  }
  const events = [];
  for (const ledgerValue of ledgers) {
    const ledger = record(ledgerValue, "ledger");
    const ledgerId = identifier(ledger.ledgerId, LEDGER_ID_PATTERN, "ledgerId");
    if (!Array.isArray(ledger.jobs) || ledger.jobs.length > 5_000) {
      throw new Error("opencounter_site_issue_ledger_jobs_invalid");
    }
    for (const jobValue of ledger.jobs) {
      const job = record(jobValue, "job");
      const jobId = identifier(job.jobId, JOB_ID_PATTERN, "jobId");
      const providerReference = nullableProviderReference(job.providerReference);
      if (!Array.isArray(job.errors) || job.errors.length > 2_000
        || !Array.isArray(job.evidence) || job.evidence.length > 10_000) {
        throw new Error("opencounter_site_issue_job_invalid");
      }
      for (const [errorIndex, errorValue] of job.errors.entries()) {
        const error = record(errorValue, "job error");
        const code = id(error.code, "job error code");
        const effect = error.effect === undefined ? "unknown" : error.effect;
        if (effect !== "none" && effect !== "unknown") {
          throw new Error("opencounter_site_issue_effect_invalid");
        }
        const observedAt = isoTimestamp(error.observedAt, "job error observedAt");
        const stage = inferStage(job.evidence, observedAt);
        const historicalProviderReference = providerReferenceForLedgerError(
          code,
          providerReference
        );
        const detected = createSiteIssueDetectionEvent({
          category: categoryForLedgerError(code),
          checkpointSha256: checkpointForLedgerError(job, observedAt),
          code,
          detectedAt: observedAt,
          effect,
          jobId,
          ledgerId,
          providerReference: historicalProviderReference,
          recoveryAction: recoveryActionForLedgerError(
            code,
            historicalProviderReference
          ),
          severity: effect === "unknown" ? "warning" : "error",
          sourceArtifactSha256: null,
          sourceEventKey: createLedgerErrorSourceEventKey({ error, errorIndex }),
          stage
        });
        events.push(detected);
        if (job.status === "completed" && job.verification?.status === "completed") {
          const verificationAt = isoTimestamp(
            job.verification.observedAt,
            "job verification observedAt"
          );
          if (Date.parse(verificationAt) < Date.parse(observedAt)) {
            throw new Error("opencounter_site_issue_ledger_verification_invalid");
          }
          events.push(createSiteIssueResolutionEvent({
            detectedEvent: detected,
            resolutionAt: verificationAt,
            resolutionKind: "recovered_same_project"
          }));
        }
      }
    }
  }
  return events.sort(compareEvents);
}

export function createSiteIssueJournalStore({ stateDirectory }) {
  const root = privateDirectory(stateDirectory, "stateDirectory");
  const directory = privateDirectory(
    path.join(root, "site-issues"),
    "issueDirectory"
  );
  const events = privateDirectory(path.join(directory, "events"), "eventDirectory");
  const snapshots = privateDirectory(
    path.join(directory, "snapshots"),
    "snapshotDirectory"
  );
  return {
    readEvent(eventSha256) {
      return readArtifact({
        digest: eventSha256,
        directory: events,
        validate: validateSiteIssueEvent
      });
    },
    readSnapshot(snapshotSha256) {
      return readArtifact({
        digest: snapshotSha256,
        directory: snapshots,
        validate: validateSiteIssueSnapshot
      });
    },
    listEvents() {
      return listStoredEvents(events);
    },
    writeEvent(value) {
      const artifact = validateSiteIssueEvent(value);
      const existing = listStoredEvents(events).filter((event) =>
        event.incidentId === artifact.incidentId
        && (event.eventType === "detected")
          === (artifact.eventType === "detected"));
      if (existing.length > 1) {
        throw new Error("opencounter_site_issue_lifecycle_invalid");
      }
      if (existing.length === 1) {
        if (JSON.stringify(eventLifecyclePayload(existing[0]))
          !== JSON.stringify(eventLifecyclePayload(artifact))) {
          throw new Error("opencounter_site_issue_event_conflict");
        }
        return writeArtifact({
          artifact: existing[0],
          digest: existing[0].eventSha256,
          directory: events
        });
      }
      return writeArtifact({
        artifact,
        digest: artifact.eventSha256,
        directory: events
      });
    },
    writeSnapshot(value) {
      const artifact = validateSiteIssueSnapshot(value);
      return writeArtifact({
        artifact,
        digest: artifact.snapshotSha256,
        directory: snapshots
      });
    }
  };
}

function listStoredEvents(directory) {
  const names = readdirSync(directory).sort();
  if (names.length > 20_000
    || names.some((name) => !/^[0-9a-f]{64}\.json$/.test(name))) {
    throw new Error("opencounter_site_issue_event_directory_invalid");
  }
  return names.map((name) => readArtifact({
    digest: name.slice(0, 64),
    directory,
    validate: validateSiteIssueEvent
  }).artifact).sort(compareEvents);
}

function eventLifecyclePayload(value) {
  const payload = structuredClone(value);
  delete payload.eventId;
  delete payload.eventSha256;
  delete payload.observedAt;
  if (payload.eventType !== "detected") delete payload.relatedEventId;
  return payload;
}

function normalizeDetectionInput(value) {
  const input = record(value, "detection");
  exactKeys(input, [
    "category", "checkpointSha256", "code", "detectedAt", "effect", "jobId",
    "ledgerId", "providerReference", "recoveryAction", "severity",
    "sourceArtifactSha256", "sourceEventKey", "stage"
  ], "detection");
  if (!CATEGORIES.has(input.category) || !STAGES.has(input.stage)
    || !RECOVERY_ACTIONS.has(input.recoveryAction)
    || !["none", "unknown", "confirmed"].includes(input.effect)
    || !["info", "warning", "error", "blocking"].includes(input.severity)) {
    throw new Error("opencounter_site_issue_detection_invalid");
  }
  const ledgerId = nullableIdentifier(input.ledgerId, LEDGER_ID_PATTERN, "ledgerId");
  const jobId = nullableIdentifier(input.jobId, JOB_ID_PATTERN, "jobId");
  if ((ledgerId === null) !== (jobId === null)) {
    throw new Error("opencounter_site_issue_detection_reference_invalid");
  }
  return {
    category: input.category,
    checkpointSha256: nullableSha256(input.checkpointSha256, "checkpointSha256"),
    code: id(input.code, "code"),
    detectedAt: isoTimestamp(input.detectedAt, "detectedAt"),
    effect: input.effect,
    jobId,
    ledgerId,
    providerReference: nullableProviderReference(input.providerReference),
    recoveryAction: input.recoveryAction,
    severity: input.severity,
    sourceArtifactSha256: nullableSha256(
      input.sourceArtifactSha256,
      "sourceArtifactSha256"
    ),
    sourceEventKey: boundedText(input.sourceEventKey, "sourceEventKey", 500),
    stage: input.stage
  };
}

function addEventIdentity(value, deletedKeys = []) {
  const payload = structuredClone(value);
  for (const key of deletedKeys) delete payload[key];
  const eventSha256 = sha256(payload);
  return {
    ...payload,
    eventId: `ocsie_${eventSha256}`,
    eventSha256
  };
}

function validateSiteIssueEvent(value) {
  const event = record(value, "event");
  exactKeys(event, [
    "artifactKind", "category", "checkpointSha256", "code", "effect",
    "eventId", "eventSha256", "eventType", "incidentId", "incidentSha256",
    "jobId", "ledgerId", "observedAt", "providerReference", "recoveryAction",
    "relatedEventId", "resolutionKind", "schemaVersion", "severity",
    "sourceArtifactSha256", "sourceEventKey", "stage"
  ], "event");
  const payload = structuredClone(event);
  delete payload.eventId;
  delete payload.eventSha256;
  const incidentPayload = {
    category: event.category,
    code: event.code,
    jobId: event.jobId,
    ledgerId: event.ledgerId,
    sourceEventKey: event.sourceEventKey,
    stage: event.stage
  };
  const incidentSha256 = sha256(incidentPayload);
  if (event.artifactKind !== "opencounter_site_issue_event"
    || event.schemaVersion !== 1
    || !SHA256_PATTERN.test(event.eventSha256)
    || event.eventId !== `ocsie_${event.eventSha256}`
    || sha256(payload) !== event.eventSha256
    || !SHA256_PATTERN.test(event.incidentSha256)
    || event.incidentSha256 !== incidentSha256
    || event.incidentId !== `ocsi_${incidentSha256}`) {
    throw new Error("opencounter_site_issue_event_invalid");
  }
  normalizeDetectionInput({
    category: event.category,
    checkpointSha256: event.checkpointSha256,
    code: event.code,
    detectedAt: event.observedAt,
    effect: event.effect,
    jobId: event.jobId,
    ledgerId: event.ledgerId,
    providerReference: event.providerReference,
    recoveryAction: event.recoveryAction,
    severity: event.severity,
    sourceArtifactSha256: event.sourceArtifactSha256,
    sourceEventKey: event.sourceEventKey,
    stage: event.stage
  });
  if (event.eventType === "detected") {
    if (event.relatedEventId !== null || event.resolutionKind !== null) {
      throw new Error("opencounter_site_issue_event_invalid");
    }
  } else if (RESOLUTION_KINDS.get(event.resolutionKind) !== event.eventType
    || typeof event.relatedEventId !== "string"
    || !/^ocsie_[0-9a-f]{64}$/.test(event.relatedEventId)) {
    throw new Error("opencounter_site_issue_event_invalid");
  }
  return structuredClone(event);
}

function validateSiteIssueSnapshot(value) {
  const snapshot = record(value, "snapshot");
  const expected = buildSiteIssueSnapshot({
    builtAt: snapshot.builtAt,
    events: snapshot.events
  });
  if (snapshot.snapshotSha256 !== expected.snapshotSha256
    || JSON.stringify(snapshot) !== JSON.stringify(expected)) {
    throw new Error("opencounter_site_issue_snapshot_invalid");
  }
  return expected;
}

function inferStage(evidence, observedAt) {
  const candidates = evidence.filter((value) => value
    && typeof value === "object"
    && typeof value.eventType === "string"
    && value.eventType.endsWith("_dispatch_started")
    && typeof value.observedAt === "string"
    && Date.parse(value.observedAt) <= Date.parse(observedAt)
  ).sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const operation = candidates.at(-1)?.eventType.replace("_dispatch_started", "");
  if (operation === "continue") return "continue";
  if (operation === "reconcile" || operation === "reconcile_start") {
    return "reconcile";
  }
  return "start";
}

function categoryForLedgerError(code) {
  if ([
    "lease_expired_after_mutation_intent",
    "provider_dispatch_unusable",
    "provider_request_timeout",
    "provider_timeout"
  ].includes(code)) return "provider_dispatch_timeout_or_unusable";
  if (["opencounter_use_ambiguous", "opencounter_use_not_found"].includes(code)) {
    return "provider_catalog_drift";
  }
  if (code === "opencounter_start_control_missing") return "provider_ui_drift";
  if (code === "runner_scope_race_before_provider_call") {
    return "provider_state_failure";
  }
  if (code === "provider_http_failure") return "provider_http_failure";
  if (code === "provider_ui_drift") return "provider_ui_drift";
  return "provider_unknown_failure";
}

function checkpointForLedgerError(job, observedAt) {
  if (!Array.isArray(job.observations) || job.observations.length > 10_000) {
    throw new Error("opencounter_site_issue_job_observations_invalid");
  }
  const candidates = job.observations.map((value) => {
    const observation = record(value, "job observation");
    const timestamp = isoTimestamp(
      observation.observedAt,
      "job observation observedAt"
    );
    return {
      checkpointSha256: nullableSha256(
        observation.checkpointSha256,
        "checkpointSha256"
      ),
      observedAt: timestamp
    };
  }).filter((value) => Date.parse(value.observedAt) <= Date.parse(observedAt))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  return candidates.at(-1)?.checkpointSha256 ?? null;
}

function providerReferenceForLedgerError(code, providerReference) {
  return [
    "opencounter_start_control_missing",
    "opencounter_use_ambiguous",
    "opencounter_use_not_found"
  ].includes(code) ? null : providerReference;
}

function recoveryActionForLedgerError(code, providerReference) {
  if ([
    "opencounter_start_control_missing",
    "opencounter_use_ambiguous",
    "opencounter_use_not_found"
  ].includes(code)) return "versioned_preview";
  return providerReference === null
    ? "readback_retry"
    : "same_project_reconciliation";
}

function countBy(values, key) {
  const counts = new Map();
  for (const value of values) counts.set(value[key], (counts.get(value[key]) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)));
}

function compareEvents(left, right) {
  return Date.parse(left.observedAt) - Date.parse(right.observedAt)
    || left.eventType.localeCompare(right.eventType)
    || left.eventSha256.localeCompare(right.eventSha256);
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

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`opencounter_site_issue_${label.replaceAll(" ", "_")}_invalid`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`opencounter_site_issue_${label.replaceAll(" ", "_")}_invalid`);
  }
}

function id(value, label) {
  const normalized = boundedText(value, label, 100);
  if (!ID_PATTERN.test(normalized)) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  return normalized;
}

function identifier(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  return value;
}

function nullableIdentifier(value, pattern, label) {
  return value === null ? null : identifier(value, pattern, label);
}

function nullableProviderReference(value) {
  if (value === null) return null;
  return identifier(value, PROVIDER_REFERENCE_PATTERN, "providerReference");
}

function nullableSha256(value, label) {
  if (value === null) return null;
  return identifier(value, SHA256_PATTERN, label);
}

function boundedText(value, label, maximumLength) {
  if (typeof value !== "string" || value.length < 1
    || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  return value;
}

function isoTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))
    || !value.endsWith("Z")) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  return value;
}

function privateDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || value.length > 2_000) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  mkdirSync(value, { mode: 0o700, recursive: true });
  const details = lstatSync(value);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`opencounter_site_issue_${label}_invalid`);
  }
  chmodSync(value, 0o700);
  return path.resolve(value);
}

function artifactPath(directory, digest) {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error("opencounter_site_issue_artifact_digest_invalid");
  }
  return path.join(directory, `${digest}.json`);
}

function writeArtifact({ artifact, digest, directory }) {
  const target = artifactPath(directory, digest);
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_site_issue_artifact_too_large");
  }
  if (existsSync(target)) {
    const existing = readJson(target);
    if (sha256(existing) !== sha256(artifact)) {
      throw new Error("opencounter_site_issue_artifact_conflict");
    }
    return { bytes, digest, path: target };
  }
  const temporary = path.join(directory, `${digest}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, target);
    unlinkSync(temporary);
    chmodSync(target, 0o600);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    if (error?.code !== "EEXIST") throw error;
    const existing = readJson(target);
    if (sha256(existing) !== sha256(artifact)) {
      throw new Error("opencounter_site_issue_artifact_conflict");
    }
  }
  return { bytes, digest, path: target };
}

function readArtifact({ digest, directory, validate }) {
  const target = artifactPath(directory, digest);
  return { artifact: validate(readJson(target)), digest, path: target };
}

function readJson(target) {
  const details = lstatSync(target);
  if (!details.isFile() || details.isSymbolicLink()
    || details.size < 1 || details.size > MAXIMUM_ARTIFACT_BYTES) {
    throw new Error("opencounter_site_issue_artifact_invalid");
  }
  return JSON.parse(readFileSync(target, "utf8"));
}
