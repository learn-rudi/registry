# ADR 0012: Decision Frontier Promotion Boundary

## Status

Accepted

## Context

RUDI already has strong but separate workflows for interrogating a domain,
building a visual decision artifact, mapping repository impact, coordinating a
durable task graph, projecting work into GitHub issues, enforcing engineering
gates, publishing accepted changes, and closing worktrees. What is missing is a
bounded transition between an ambiguous initiative and execution-ready work.

Treating that transition as another orchestrator would split authority between
discovery documents, issues, host task lists, and the Chief-of-Staff plan. It
would also let a recommendation silently become approval or let an accepted
decision silently grant implementation, publication, or deployment authority.

## Decision

Add `rudi-decision-frontier` as a discovery workflow composed by
`rudi-chief-of-staff`, not as another orchestrator.

For durable work, `.rudi/orchestration/plan.json` remains the sole authority for
the objective, decision frontier, promoted execution nodes, dependency
satisfaction, and accepted evidence. Schema-v1 plans remain valid. A schema-v2
plan may add one `decisionFrontier` object with:

- an initiative objective;
- unresolved areas with explicit terminal or open status;
- decision records that distinguish a recommendation from a human-approved
  resolution;
- a monotonically increasing frontier revision; and
- append-only promotion receipts bound to exact plan/frontier revisions,
  complete area/decision snapshot digests, authorization references, created
  node IDs, and the input digest.

The portable project-plan tool validates both schema versions. Discovery state
may be authored only by the manager and must pass whole-plan validation. The
`promote` command is the only portable operation that converts an accepted
frontier snapshot into execution nodes. It:

1. validates the complete plan and untrusted promotion input before mutation;
2. rejects open required areas or non-terminal decisions;
3. requires every terminal area and decision ID with its exact digest;
4. requires a human promotion-approval reference and a distinct implementation
   authorization reference;
5. requires a current expected plan revision and frontier revision;
6. accepts only new `proposed` nodes with empty reconciliation history;
7. serializes plan writers, re-reads current state under the lock, and appends
   nodes plus a promotion receipt atomically;
8. treats exact replay as idempotent and conflicting ID reuse as an error; and
9. never dispatches work or grants publication, deployment, destructive,
   external-system, or other authority.

Promotion is not readiness. Existing Chief-of-Staff dependency, placement,
resource, review, and authorization gates still decide when a promoted node may
become `ready` and dispatchable.

GitHub issues are optional projections. In a small standalone single-repository
loop, `rudi-swe-issue-loop` may use its issue ledger as the local delivery
record. When composed under Chief of Staff, issues are node-local projections
and evidence links; issue state never satisfies a plan dependency.

The lifecycle vocabulary is:

- **unresolved area** — an explicit question or boundary still preventing a
  stable task contract;
- **decision record** — proposed or human-resolved choice with evidence;
- **decision frontier** — the current boundary between resolved and unresolved
  initiative knowledge;
- **promotion** — guarded conversion of an accepted frontier snapshot into
  proposed execution nodes;
- **readiness** — existing plan-state eligibility after dependencies and gates;
  and
- **dispatch** — host-specific execution after prepare-before-dispatch.

## Consequences

- RUDI gains a resumable discovery-to-execution bridge without a second source
  of truth.
- Accepted decisions are digest-bound to their promoted work, making stale or
  conflicting promotion visible. Deferred and out-of-scope outcomes receive
  the same immutable binding.
- Existing schema-v1 plans and host adapters remain compatible.
- Managers must preserve the distinction between recommendation, approval,
  implementation authorization, promotion, readiness, and dispatch.
- Open discovery can remain conversational or use Grill, Decision Canvas,
  questionnaires, prototypes, and diagnosis; only validated durable state and
  accepted promotion receipts enter the plan.
- A future frontier-revision command may replace manual manager-authored
  revisions, but it must preserve this authority and history contract.
