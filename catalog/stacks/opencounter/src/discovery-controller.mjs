import { createDiscoveryDispatchRequest } from "./discovery-dispatch.mjs";
import {
  createLedgerErrorSourceEventKey,
  createSiteIssueDetectionEvent,
  deriveSiteIssueEventsFromLedgers
} from
  "./discovery-site-issue-journal.mjs";

const UNKNOWN_FAILURES = Object.freeze({
  provider_dispatch_unusable: {
    category: "provider_dispatch_timeout_or_unusable",
    message: "The provider dispatch did not return a usable bounded result; reconcile the same project if a provider reference becomes available.",
    severity: "warning"
  },
  provider_http_failure: {
    category: "provider_http_failure",
    message: "The provider returned an HTTP failure after mutation intent was recorded; reconcile the same project before any retry.",
    severity: "error"
  },
  provider_request_timeout: {
    category: "provider_dispatch_timeout_or_unusable",
    message: "The provider request timed out after mutation intent was recorded; reconcile the same project before any retry.",
    severity: "warning"
  },
  provider_ui_drift: {
    category: "provider_ui_drift",
    message: "The provider page no longer matched the bounded UI contract after mutation intent was recorded; reconcile the same project and review the contract.",
    severity: "error"
  }
});

export function createDiscoveryCampaignController({ issueStore = null, now, store }) {
  if (typeof now !== "function" || !store || typeof store !== "object") {
    throw new Error("opencounter_discovery_controller_config_invalid");
  }
  for (const operation of [
    "beginDispatch", "leaseNext", "queueLocationAnswer", "read",
    "leaseJob", "recordFailure", "recordLateResult", "recordResult",
    "recordVerification"
  ]) {
    if (typeof store[operation] !== "function") {
      throw new Error("opencounter_discovery_controller_store_invalid");
    }
  }
  if (issueStore !== null
    && (!issueStore || typeof issueStore !== "object"
      || typeof issueStore.writeEvent !== "function")) {
    throw new Error("opencounter_discovery_controller_issue_store_invalid");
  }

  return {
    async prepareStartJobDispatch({ jobId, ledgerId, workerId }) {
      if (typeof store.leaseStartJob !== "function") {
        throw new Error("opencounter_discovery_controller_store_invalid");
      }
      const leased = await store.leaseStartJob({
        jobId,
        leasedAt: now(),
        ledgerId,
        workerId
      });
      if (leased.job === null) return null;

      await store.beginDispatch({
        dispatchedAt: now(),
        jobId: leased.job.jobId,
        leaseToken: leased.job.lease.leaseToken,
        ledgerId,
        workerId
      });
      const persisted = await store.read(ledgerId);
      const job = persisted.jobs.find(({ jobId: candidateId }) =>
        candidateId === leased.job.jobId);
      if (job === undefined) {
        throw new Error("opencounter_discovery_controller_job_missing");
      }
      return createDiscoveryDispatchRequest(job);
    },

    async prepareJobDispatch({ jobId, ledgerId, workerId }) {
      const leased = await store.leaseJob({
        jobId,
        leasedAt: now(),
        ledgerId,
        workerId
      });
      if (leased.job === null) return null;

      await store.beginDispatch({
        dispatchedAt: now(),
        jobId: leased.job.jobId,
        leaseToken: leased.job.lease.leaseToken,
        ledgerId,
        workerId
      });
      const persisted = await store.read(ledgerId);
      const job = persisted.jobs.find(({ jobId: candidateId }) =>
        candidateId === leased.job.jobId);
      if (job === undefined) {
        throw new Error("opencounter_discovery_controller_job_missing");
      }
      return createDiscoveryDispatchRequest(job);
    },

    async prepareNextDispatch({ ledgerId, workerId }) {
      const leased = await store.leaseNext({
        leasedAt: now(),
        ledgerId,
        workerId
      });
      if (leased.job === null) return null;

      await store.beginDispatch({
        dispatchedAt: now(),
        jobId: leased.job.jobId,
        leaseToken: leased.job.lease.leaseToken,
        ledgerId,
        workerId
      });
      const persisted = await store.read(ledgerId);
      const job = persisted.jobs.find(({ jobId }) => jobId === leased.job.jobId);
      if (job === undefined) {
        throw new Error("opencounter_discovery_controller_job_missing");
      }
      return createDiscoveryDispatchRequest(job);
    },

    async recordDispatchResult({ ledgerId, request, result }) {
      const persisted = await store.read(ledgerId);
      const job = findJob(persisted, request?.jobId);
      const expectedRequest = createDiscoveryDispatchRequest(job);
      if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
        throw new Error("opencounter_discovery_controller_dispatch_mismatch");
      }
      const updated = await store.recordResult({
        jobId: request.jobId,
        leaseToken: request.leaseToken,
        ledgerId,
        observedAt: now(),
        result,
        workerId: request.workerId
      });
      const updatedJob = findJob(updated, request.jobId);
      if (updatedJob.providerReference === null
        || (updatedJob.status !== "needs_input" && updatedJob.status !== "completed")) {
        return null;
      }
      return {
        args: { providerReference: updatedJob.providerReference },
        jobId: updatedJob.jobId,
        tool: "opencounter_get_guidance_result"
      };
    },

    async recordLateDispatchResult({ ledgerId, request, result }) {
      const persisted = await store.read(ledgerId);
      const job = findJob(persisted, request?.jobId);
      const expectedRequest = createDiscoveryDispatchRequest(job);
      if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
        throw new Error("opencounter_discovery_controller_dispatch_mismatch");
      }
      const updated = await store.recordLateResult({
        jobId: request.jobId,
        leaseToken: request.leaseToken,
        ledgerId,
        observedAt: now(),
        result,
        workerId: request.workerId
      });
      const updatedJob = findJob(updated, request.jobId);
      if (updatedJob.providerReference === null
        || (updatedJob.status !== "needs_input" && updatedJob.status !== "completed")) {
        return null;
      }
      return {
        args: { providerReference: updatedJob.providerReference },
        jobId: updatedJob.jobId,
        tool: "opencounter_get_guidance_result"
      };
    },

    async recordVerificationResult({ actorId, ledgerId, request, result }) {
      const persisted = await store.read(ledgerId);
      const job = findJob(persisted, request?.jobId);
      const expectedRequest = job.providerReference === null ? null : {
        args: { providerReference: job.providerReference },
        jobId: job.jobId,
        tool: "opencounter_get_guidance_result"
      };
      if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
        throw new Error("opencounter_discovery_controller_verification_mismatch");
      }
      const verificationObservedAt = now();
      let updated = await store.recordVerification({
        actorId,
        jobId: job.jobId,
        ledgerId,
        observedAt: verificationObservedAt,
        result
      });
      let updatedJob = findJob(updated, job.jobId);
      let automaticallyQueuedLocation = false;
      if (isLocationOnlyCheckpoint(updatedJob)) {
        updated = await store.queueLocationAnswer({
          actorId,
          checkpointSha256: updatedJob.checkpoint.checkpointSha256,
          jobId: updatedJob.jobId,
          ledgerId,
          queuedAt: now()
        });
        updatedJob = findJob(updated, job.jobId);
        automaticallyQueuedLocation = true;
      }
      if (issueStore !== null && updatedJob.status === "completed") {
        const issueEvents = deriveSiteIssueEventsFromLedgers({ ledgers: [updated] })
          .filter(({ jobId: candidateId }) => candidateId === updatedJob.jobId);
        for (const event of issueEvents) issueStore.writeEvent(event);
      }
      return {
        automaticallyQueuedLocation,
        jobId: updatedJob.jobId,
        status: updatedJob.status
      };
    },

    async recordUnknownDispatchFailure({
      failureCode = "provider_dispatch_unusable",
      ledgerId,
      request
    }) {
      const persisted = await store.read(ledgerId);
      const job = findJob(persisted, request?.jobId);
      const expectedRequest = createDiscoveryDispatchRequest(job);
      if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
        throw new Error("opencounter_discovery_controller_dispatch_mismatch");
      }
      const failureDefinition = UNKNOWN_FAILURES[failureCode];
      if (failureDefinition === undefined) {
        throw new Error("opencounter_discovery_controller_failure_code_invalid");
      }
      const observedAt = now();
      const updated = await store.recordFailure({
        failure: {
          code: failureCode,
          effect: "unknown",
          message: failureDefinition.message
        },
        jobId: request.jobId,
        leaseToken: request.leaseToken,
        ledgerId,
        observedAt,
        workerId: request.workerId
      });
      const updatedJob = findJob(updated, request.jobId);
      const outcome = {
        jobId: updatedJob.jobId,
        status: updatedJob.status
      };
      if (issueStore === null) return outcome;
      const errorIndex = updatedJob.errors.length - 1;
      const persistedError = updatedJob.errors[errorIndex];
      const event = createSiteIssueDetectionEvent({
        category: failureDefinition.category,
        checkpointSha256: updatedJob.checkpoint?.checkpointSha256 ?? null,
        code: failureCode,
        detectedAt: observedAt,
        effect: "unknown",
        jobId: updatedJob.jobId,
        ledgerId,
        providerReference: updatedJob.providerReference,
        recoveryAction: updatedJob.providerReference === null
          ? "readback_retry"
          : "same_project_reconciliation",
        severity: failureDefinition.severity,
        sourceArtifactSha256: null,
        sourceEventKey: createLedgerErrorSourceEventKey({
          error: persistedError,
          errorIndex
        }),
        stage: issueStage(request.tool)
      });
      issueStore.writeEvent(event);
      return {
        ...outcome,
        issueEventId: event.eventId,
        issueEventSha256: event.eventSha256
      };
    }
  };
}

function issueStage(tool) {
  if (tool === "opencounter_continue_guidance") return "continue";
  if (tool === "opencounter_reconcile_guidance") return "reconcile";
  return "start";
}

function findJob(ledger, jobId) {
  const job = ledger.jobs.find((candidate) => candidate.jobId === jobId);
  if (job === undefined) {
    throw new Error("opencounter_discovery_controller_job_missing");
  }
  return job;
}

function isLocationOnlyCheckpoint(job) {
  return job.status === "needs_input"
    && job.checkpoint !== null
    && job.checkpoint.questions.length === 1
    && job.checkpoint.questions[0].id === "opencounter-address";
}
