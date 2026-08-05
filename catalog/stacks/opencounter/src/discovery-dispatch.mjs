import { createHash } from "node:crypto";

const TOOL_BY_ACTION = Object.freeze({
  continue: "opencounter_continue_guidance",
  reconcile: "opencounter_reconcile_guidance",
  reconcile_start: "opencounter_reconcile_zoning_start",
  start: "opencounter_start_zoning_guidance"
});
const JOB_ID_PATTERN = /^ocdj_[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function createDiscoveryDispatchRequest(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)
    || job.status !== "active"
    || !JOB_ID_PATTERN.test(job.jobId)
    || !job.lease
    || typeof job.lease !== "object"
    || !ID_PATTERN.test(job.lease.workerId)
    || typeof job.lease.leaseToken !== "string"
    || job.lease.leaseToken.length < 1
    || job.lease.leaseToken.length > 100
    || !job.pendingMutation
    || typeof job.pendingMutation !== "object"
    || !job.nextAction
    || typeof job.nextAction !== "object") {
    throw new Error("opencounter_discovery_dispatch_job_invalid");
  }
  const tool = TOOL_BY_ACTION[job.nextAction.kind];
  if (tool === undefined
    || job.pendingMutation.kind !== job.nextAction.kind
    || job.pendingMutation.inputSha256 !== sha256(job.nextAction)
    || typeof job.pendingMutation.dispatchId !== "string"
    || job.pendingMutation.dispatchId.length < 1
    || job.pendingMutation.dispatchId.length > 100
    || !job.nextAction.input
    || typeof job.nextAction.input !== "object"
    || Array.isArray(job.nextAction.input)) {
    throw new Error("opencounter_discovery_dispatch_intent_invalid");
  }
  return {
    args: structuredClone(job.nextAction.input),
    dispatchId: job.pendingMutation.dispatchId,
    jobId: job.jobId,
    leaseToken: job.lease.leaseToken,
    tool,
    workerId: job.lease.workerId
  };
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
