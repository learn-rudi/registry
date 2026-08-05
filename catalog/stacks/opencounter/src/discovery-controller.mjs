import { createDiscoveryDispatchRequest } from "./discovery-dispatch.mjs";

export function createDiscoveryCampaignController({ now, store }) {
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

  return {
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
      let updated = await store.recordVerification({
        actorId,
        jobId: job.jobId,
        ledgerId,
        observedAt: now(),
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
      return {
        automaticallyQueuedLocation,
        jobId: updatedJob.jobId,
        status: updatedJob.status
      };
    },

    async recordUnknownDispatchFailure({ ledgerId, request }) {
      const persisted = await store.read(ledgerId);
      const job = findJob(persisted, request?.jobId);
      const expectedRequest = createDiscoveryDispatchRequest(job);
      if (JSON.stringify(request) !== JSON.stringify(expectedRequest)) {
        throw new Error("opencounter_discovery_controller_dispatch_mismatch");
      }
      const updated = await store.recordFailure({
        failure: {
          code: "provider_dispatch_unusable",
          effect: "unknown",
          message: "The provider dispatch did not return a usable bounded result; reconcile the same project if a provider reference becomes available."
        },
        jobId: request.jobId,
        leaseToken: request.leaseToken,
        ledgerId,
        observedAt: now(),
        workerId: request.workerId
      });
      const updatedJob = findJob(updated, request.jobId);
      return {
        jobId: updatedJob.jobId,
        status: updatedJob.status
      };
    }
  };
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
