# ADR 0009: Chief of Staff Execution Governance

## Status

Accepted

## Context

The portable DAG and reconciliation contract established one authoritative
plan, but the first large multi-provider run exposed a second boundary: runtime
selection and consumption were still manager conventions rather than durable
state. The run did not record an exact provider/model/reasoning choice before
dispatch, did not constrain provider switching, did not persist time or token
checkpoints, and did not bound repeated independent review. The portable script
could validate manually authored run state but could not create and advance the
attempt lifecycle safely.

Those omissions make a correct graph operationally unpredictable. A manager can
spend excessive resources, switch providers after a failure without authority,
repeat reviewers indefinitely, or dispatch before the intended binding is
durable while still producing a superficially valid plan.

## Decision

Keep the existing project DAG and host-adapter boundary. Add execution
governance as closed plan and run state rather than a second orchestrator.

- Every model-backed node declares an exact provider, model, reasoning profile,
  selection source, and fallback basis. Each prepared attempt freezes the same
  selection and proves that its bound host advertised a matching model profile.
- Provider failure grants no fallback authority. A provider change requires a
  revised selection backed by explicit authorization or a documented unresolved
  blocker.
- Every plan has a resource envelope. Hard elapsed-time or token limits are
  optional; conservative elapsed-time and token checkpoints are always present.
  Append-only usage reports persist pause or authorized-continuation decisions,
  and a paused run cannot prepare more work.
- Review policy defaults to one independent review and one focused confirmation.
  Both declared review nodes and accepted runtime review attempts count against
  the limits. Additional passes require explicit authorization or an unresolved
  blocker.
- Durable, resumable, dependent, multi-project, or cross-provider work must
  initialize and validate both plan and run state before first dispatch.
- The portable script owns deterministic run-state mutation through
  `run-init`, `validate-run`, `prepare`, `record-dispatch`,
  `record-termination`, `record-usage`, `record-steering`, and
  `record-archive`. It records observations and policy decisions but never
  performs discovery, model calls, dispatch, steering, stop, or archive side
  effects.
- Dispatch, termination, and archive histories derive normalized state.
  `validate-run` rejects accepted or terminal lifecycle fields that were not
  produced by recorded events. Command IDs and prepare identity are idempotent;
  conflicting reuse fails closed.

## Consequences

- A run can now explain which provider/model was selected, why fallback was
  allowed, how much resource was observed, which checkpoint decision applied,
  how many review passes ran, and which lifecycle events changed native state.
- The host adapter must report model profiles and whatever usage telemetry the
  host exposes. Missing token telemetry remains visible and elapsed-time
  checkpoints still apply.
- Managers must activate run state before dispatch and use lifecycle commands
  rather than hand-author normalized fields. This adds ceremony but makes
  prepare-before-dispatch executable and auditable.
- Run files remain noncanonical transport and stay ignored by Git. The plan
  remains the sole authority for objective, scope, dependencies, acceptance,
  review exceptions, resource policy, and provider-fallback authority.
- The portable tooling still cannot make two-file plan/run mutation atomic.
  Reconciliation and host adapters must continue to detect exact revision
  mismatch and repair transport references deliberately rather than guessing.
