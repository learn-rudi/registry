import { randomUUID } from "node:crypto";
import { validateDiscoveryLedgerShape } from "./discovery-ledger-schema.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const ISO_TIMESTAMP_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function cloneLedger(value) {
  return validateDiscoveryLedgerShape(value);
}

export function expireStaleLeases(ledger, timestamp) {
  let changed = false;
  for (const job of ledger.jobs) {
    if (job.status !== "active" || job.lease === null) continue;
    if (Date.parse(job.lease.expiresAt) > Date.parse(timestamp)) continue;
    const actorId = job.lease.workerId;
    if (job.pendingMutation === null) {
      job.status = "queued";
      job.evidence.push({
        actorId,
        eventId: randomUUID(),
        eventType: "lease_expired_before_dispatch",
        observedAt: timestamp
      });
    } else {
      job.status = "indeterminate";
      job.errors.push({
        code: "lease_expired_after_mutation_intent",
        message: "The worker lease expired after provider mutation intent was recorded; reconcile the same project and do not start a replacement.",
        observedAt: timestamp
      });
      job.evidence.push({
        actorId,
        eventId: randomUUID(),
        eventType: "lease_expired_after_mutation_intent",
        observedAt: timestamp
      });
    }
    job.lease = null;
    job.updatedAt = timestamp;
    changed = true;
  }
  if (changed) ledger.updatedAt = timestamp;
}

export function findJob(ledger, jobId) {
  const normalizedJobId = boundedText(jobId, "jobId", 80);
  if (!/^ocdj_[0-9a-f]{64}$/.test(normalizedJobId)) {
    throw new Error("opencounter_discovery_job_id_invalid");
  }
  const job = ledger.jobs.find((candidate) => candidate.jobId === normalizedJobId);
  if (job === undefined) throw new Error("opencounter_discovery_job_not_found");
  return job;
}

export function requireActiveLease(ledger, {
  jobId,
  leaseToken,
  timestamp,
  workerId
}) {
  const job = findJob(ledger, jobId);
  const actorId = id(workerId, "workerId");
  const token = boundedText(leaseToken, "leaseToken", 100);
  if (
    job.status !== "active"
    || job.lease === null
    || job.lease.workerId !== actorId
    || job.lease.leaseToken !== token
    || Date.parse(job.lease.expiresAt) <= Date.parse(timestamp)
  ) {
    throw new Error("opencounter_discovery_lease_invalid");
  }
  return job;
}

export function requireExpiredActiveLease(ledger, {
  jobId,
  leaseToken,
  timestamp,
  workerId
}) {
  const job = findJob(ledger, jobId);
  const actorId = id(workerId, "workerId");
  const token = boundedText(leaseToken, "leaseToken", 100);
  if (
    job.status !== "active"
    || job.lease === null
    || job.lease.workerId !== actorId
    || job.lease.leaseToken !== token
    || Date.parse(job.lease.expiresAt) > Date.parse(timestamp)
  ) {
    throw new Error("opencounter_discovery_expired_lease_required");
  }
  return job;
}

export function assertMonotonicTimestamp(ledger, timestamp) {
  if (Date.parse(timestamp) < Date.parse(ledger.updatedAt)) {
    throw new Error("opencounter_discovery_timestamp_out_of_order");
  }
}

export function id(value, path) {
  const text = boundedText(value, path, 100);
  if (!ID_PATTERN.test(text)) throw new Error(`${path} is invalid.`);
  return text;
}

function boundedText(value, path, maximum) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximum
    || value !== value.trim()
    || /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

export function isoTimestamp(value, path) {
  if (
    typeof value !== "string"
    || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${path} is invalid.`);
  }
  return value;
}

export function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}
