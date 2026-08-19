import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildSiteIssueSnapshot,
  createSiteIssueDetectionEvent,
  createSiteIssueJournalStore,
  createSiteIssueResolutionEvent,
  deriveSiteIssueEventsFromLedgers
} from "../src/discovery-site-issue-journal.mjs";

test("stores immutable issue events and folds them deterministically", () => {
  const detected = createSiteIssueDetectionEvent({
    category: "provider_dispatch_timeout_or_unusable",
    checkpointSha256: digest("checkpoint"),
    code: "provider_request_timeout",
    detectedAt: "2026-08-05T01:00:00.000Z",
    effect: "unknown",
    jobId: `ocdj_${digest("job")}`,
    ledgerId: `ocdl_${digest("ledger")}`,
    providerReference: "opencounter:project:2821000",
    recoveryAction: "same_project_reconciliation",
    severity: "warning",
    sourceArtifactSha256: null,
    sourceEventKey: "dispatch:stable-attempt-1",
    stage: "continue"
  });
  assert.deepEqual(detected, createSiteIssueDetectionEvent({
    category: "provider_dispatch_timeout_or_unusable",
    checkpointSha256: digest("checkpoint"),
    code: "provider_request_timeout",
    detectedAt: "2026-08-05T01:00:00.000Z",
    effect: "unknown",
    jobId: `ocdj_${digest("job")}`,
    ledgerId: `ocdl_${digest("ledger")}`,
    providerReference: "opencounter:project:2821000",
    recoveryAction: "same_project_reconciliation",
    severity: "warning",
    sourceArtifactSha256: null,
    sourceEventKey: "dispatch:stable-attempt-1",
    stage: "continue"
  }));
  const recovered = createSiteIssueResolutionEvent({
    detectedEvent: detected,
    resolutionAt: "2026-08-05T01:01:00.000Z",
    resolutionKind: "recovered_same_project"
  });
  const repeatedDetection = createSiteIssueDetectionEvent({
    category: "provider_dispatch_timeout_or_unusable",
    checkpointSha256: digest("checkpoint"),
    code: "provider_request_timeout",
    detectedAt: "2026-08-05T01:00:30.000Z",
    effect: "unknown",
    jobId: `ocdj_${digest("job")}`,
    ledgerId: `ocdl_${digest("ledger")}`,
    providerReference: "opencounter:project:2821000",
    recoveryAction: "same_project_reconciliation",
    severity: "warning",
    sourceArtifactSha256: null,
    sourceEventKey: "dispatch:stable-attempt-1",
    stage: "continue"
  });
  const repeatedResolution = createSiteIssueResolutionEvent({
    detectedEvent: detected,
    resolutionAt: "2026-08-05T01:02:00.000Z",
    resolutionKind: "recovered_same_project"
  });
  const open = createSiteIssueDetectionEvent({
    category: "provider_ui_drift",
    checkpointSha256: null,
    code: "provider_summary_incomplete",
    detectedAt: "2026-08-05T01:02:00.000Z",
    effect: "none",
    jobId: null,
    ledgerId: null,
    providerReference: null,
    recoveryAction: "versioned_preview",
    severity: "error",
    sourceArtifactSha256: digest("provider-contract-fixture"),
    sourceEventKey: "fixture:summary-v1",
    stage: "summary"
  });
  const first = buildSiteIssueSnapshot({
    builtAt: "2026-08-05T01:03:00.000Z",
    events: [open, recovered, detected]
  });
  const second = buildSiteIssueSnapshot({
    builtAt: "2026-08-05T01:03:00.000Z",
    events: [detected, open, recovered]
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.summary.statusCounts, {
    adjudicated: 0,
    open: 1,
    recovered: 1
  });
  assert.equal(first.incidents.length, 2);
  assert.equal(first.events.length, 3);
  assert.match(first.snapshotId, /^ocsis_[0-9a-f]{64}$/);

  const stateDirectory = mkdtempSync(path.join(
    tmpdir(),
    "opencounter-site-issue-test-"
  ));
  try {
    const store = createSiteIssueJournalStore({ stateDirectory });
    const firstWrite = store.writeEvent(detected);
    const duplicateWrite = store.writeEvent(detected);
    const repeatedDetectionWrite = store.writeEvent(repeatedDetection);
    const resolutionWrite = store.writeEvent(recovered);
    const repeatedResolutionWrite = store.writeEvent(repeatedResolution);
    const snapshotWrite = store.writeSnapshot(first);
    assert.equal(firstWrite.path, duplicateWrite.path);
    assert.equal(firstWrite.path, repeatedDetectionWrite.path);
    assert.equal(resolutionWrite.path, repeatedResolutionWrite.path);
    assert.equal(statSync(firstWrite.path).mode & 0o777, 0o600);
    assert.equal(statSync(resolutionWrite.path).mode & 0o777, 0o600);
    assert.equal(statSync(snapshotWrite.path).mode & 0o777, 0o600);
    assert.deepEqual(store.readEvent(detected.eventSha256).artifact, detected);
    assert.deepEqual(store.listEvents(), [detected, recovered]);
    assert.deepEqual(store.readSnapshot(first.snapshotSha256).artifact, first);

    const tampered = structuredClone(detected);
    tampered.incidentSha256 = digest("forged-incident");
    tampered.incidentId = `ocsi_${tampered.incidentSha256}`;
    const forgedPayload = structuredClone(tampered);
    delete forgedPayload.eventId;
    delete forgedPayload.eventSha256;
    tampered.eventSha256 = canonicalDigest(forgedPayload);
    tampered.eventId = `ocsie_${tampered.eventSha256}`;
    assert.throws(() => store.writeEvent(tampered), /event_invalid/);
  } finally {
    rmSync(stateDirectory, { force: true, recursive: true });
  }

  assert.throws(() => createSiteIssueResolutionEvent({
    detectedEvent: recovered,
    resolutionAt: "2026-08-05T01:04:00.000Z",
    resolutionKind: "recovered_same_project"
  }), /detected/i);
});

test("derives stable detection and recovery events from ledger failures", () => {
  const ledgerId = `ocdl_${digest("ledger-derived")}`;
  const jobId = `ocdj_${digest("job-derived")}`;
  const ledgers = [{
    jobs: [{
      checkpoint: null,
      errors: [{
        code: "provider_dispatch_unusable",
        effect: "unknown",
        message: "Bounded historical message is not copied into the issue log.",
        observedAt: "2026-08-05T02:00:01.000Z"
      }],
      evidence: [{
        eventId: "persisted-dispatch-event",
        eventType: "continue_dispatch_started",
        observedAt: "2026-08-05T02:00:00.000Z"
      }, {
        eventId: "persisted-reconcile-event",
        eventType: "reconcile_completed_observed",
        observedAt: "2026-08-05T02:00:02.000Z"
      }],
      jobId,
      observations: [],
      providerReference: "opencounter:project:2821001",
      status: "completed",
      verification: {
        observedAt: "2026-08-05T02:00:03.000Z",
        providerReference: "opencounter:project:2821001",
        status: "completed"
      }
    }],
    ledgerId
  }];
  const first = deriveSiteIssueEventsFromLedgers({ ledgers });
  const second = deriveSiteIssueEventsFromLedgers({ ledgers });

  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first[0].eventType, "detected");
  assert.equal(first[0].category,
    "provider_dispatch_timeout_or_unusable");
  assert.equal(first[0].stage, "continue");
  assert.equal(first[1].eventType, "recovered");
  assert.equal(first[1].resolutionKind, "recovered_same_project");
  assert.equal(JSON.stringify(first).includes("historical message"), false);

  const malformed = structuredClone(ledgers);
  malformed[0].jobs[0].verification.observedAt = "not-a-timestamp";
  assert.throws(() => deriveSiteIssueEventsFromLedgers({ ledgers: malformed }),
    /observedAt_invalid/);
});

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalDigest(value) {
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
