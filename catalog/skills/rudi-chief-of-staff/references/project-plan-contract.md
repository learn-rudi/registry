# Project Plan Contract

This reference defines schema version 1 for ordinary durable execution and the
additive schema-v2 Decision Frontier extension. The manager owns
`.rudi/orchestration/plan.json` as the canonical decision, DAG, and acceptance
ledger. Hosts execute work; they do not own or infer plan state.

## Contents

- [Files and authority](#files-and-authority)
- [Closed plan schema](#closed-plan-schema)
- [Decision frontier and promotion](#decision-frontier-and-promotion)
- [Targets and routing](#targets-and-routing)
- [Handoffs and evidence](#handoffs-and-evidence)
- [Run transport](#run-transport)
- [Validation and readiness](#validation-and-readiness)
- [Prepare and dispatch](#prepare-and-dispatch)
- [Results and transitions](#results-and-transitions)
- [Archive eligibility](#archive-eligibility)
- [Portable command surface](#portable-command-surface)
- [Safe deterministic writes](#safe-deterministic-writes)

## Files and authority

```text
.rudi/orchestration/
├── plan.json          # canonical portable DAG and acceptance ledger
├── graph.mmd          # generated; never an authority source
├── decisions.json     # durable accepted decisions, when needed
└── runs/*.json        # noncanonical host and attempt transport
```

`runs/*.json` must be ignored by Git by default, but retained until all
reconciliation and indeterminate-dispatch recovery is complete.
The CLI accepts a plan only at the exact `.rudi/orchestration/plan.json`
suffix and a run only at `.rudi/orchestration/runs/<runId>.json`. The run and
plan must share the same manager-project orchestration root, and the run
filename must equal its portable `runId`; a similarly shaped file in another
project is not a substitute.
`decisions.json` may be a derived human-readable index of accepted product or
architecture decisions but cannot override `plan.json`. Schema-v2 frontier
state and promotion receipts live only in `plan.json`. Native task lists,
thread graphs, worktrees, and
adapter metadata are cockpit or transport views, not competing ledgers.

## Closed plan schema

The top-level object has exactly these fields, in this canonical write order:

| Field | Contract |
|---|---|
| `schemaVersion` | Integer literal `1`, or `2` when `decisionFrontier` is present. |
| `projectId` | Stable portable ID of the manager project. |
| `runId` | Stable portable ID of this orchestration run. |
| `revision` | Positive integer, incremented once per accepted mutation. |
| `objective` | Non-empty bounded string. |
| `requestedMaxParallel` | Positive integer manager-requested ceiling. |
| `resourceEnvelope` | Closed elapsed-time/token limits and soft checkpoints defined below. |
| `reviewPolicy` | Closed review-pass limits and exception rule defined below. |
| `decisionFrontier` | Forbidden in v1; required closed discovery and promotion state in v2. |
| `nodes` | Array of closed node objects. |
| `handoffs` | Array of closed handoff objects. |

A node has exactly these fields:

| Field | Contract |
|---|---|
| `id` | Unique portable ID matching `[a-z][a-z0-9._-]{0,63}`. |
| `title` | Short non-empty display name. |
| `objective` | One bounded observable objective. |
| `dependencies` | Unique node IDs; no self-reference or cycle. |
| `owner` | Portable accountable role or person label, never a native ID. |
| `allowedScope` | Unique project-relative POSIX paths or globs; no `..`, absolute path, or escape. May be empty only for non-writing gates. |
| `acceptanceCriteria` | Non-empty unique `{ "id", "statement" }` records. |
| `verification` | Unique `{ "id", "method", "instruction" }` records; method is `command`, `inspection`, `human_ack`, or `external_check`. |
| `deliverables` | Unique `{ "id", "description", "mediaTypes" }` records; media types are non-empty IANA strings. |
| `risk` | Exactly `low`, `medium`, or `high`. |
| `blockingReason` | `null` or a non-empty reason; required for `proposed`, `waiting`, `needs_input`, `rework`, `failed`, and `cancelled`, and otherwise `null`. |
| `status` | Exactly `proposed`, `ready`, `running`, `waiting`, `needs_input`, `review`, `rework`, `done`, `failed`, or `cancelled`. |
| `executionSurface` | Exactly `inline`, `subagent`, `desktop_task`, `human_gate`, or `external_system`. |
| `resourceLocks` | Unique portable logical lock names matching `[a-z][a-z0-9._:/-]{0,127}`. |
| `target` | Closed target object defined below. |
| `review` | `null` or a closed review declaration defined below. |
| `reconciliations` | Accepted result/cancellation records defined below, ordered by acceptance. |

Every nested record is closed. Unknown or duplicate fields are invalid. Strings
must be UTF-8, free of control characters, and within implementation-declared
size bounds. Arrays preserve authored order, but IDs within each namespace must
be unique. Native saved-project, host, agent, task, thread, checkout, cwd, and
worktree IDs or paths are forbidden in portable nodes; the sole absolute path
allowed in a node is `target.project.absolutePath`.

`resourceEnvelope` has exactly `maxElapsedSeconds`, `maxTokens`,
`softCheckpointElapsedSeconds`, and `softCheckpointTokens`. The two maxima are
`null` or positive safe integers supplied by the user or manager. Soft
checkpoints are always positive safe integers; `init` defaults them to 1,800
seconds and 100,000 tokens. A hard limit requires pause. A soft checkpoint
requires pause or an explicitly authorized continuation. Missing token
telemetry never disables elapsed-time checkpoints.

`reviewPolicy` has exactly `maxIndependentReviews`,
`maxFocusedConfirmations`, and `additionalReviewRule`. Both limits are positive
safe integers and default to `1`. The rule is the literal
`unresolved_blocker_or_explicit_authorization`.

A non-null `review` declaration has exactly `kind`, `sequence`,
`authorizationRef`, and `unresolvedBlockerRef`. Kind is `independent` or
`focused_confirmation`; sequences are unique and contiguous from 1 within each
kind. Review declarations above the corresponding policy limit require either
an authorization reference or unresolved-blocker reference. Runtime preparation
also counts prior accepted review attempts, so retrying the same review node
cannot create an unbounded review loop.

## Decision frontier and promotion

Schema-v1 plans remain valid and `init` continues to create them. Schema v2 is
additive: it requires exactly one `decisionFrontier` object and otherwise uses
the same node, handoff, routing, run, evidence, and transition contracts.

`decisionFrontier` has exactly `initiativeObjective`, `revision`, `areas`,
`decisions`, and `promotions`:

- `initiativeObjective` is a non-empty bounded string.
- `revision` is a positive safe integer incremented for each accepted frontier
  mutation.
- `areas` is a non-empty array of closed unresolved-area records with exactly
  `id`, optional `introducedAtFrontierRevision`, `question`, `status`,
  `resolution`, `decisionIds`, `approvalRef`, and `decidedAt`. Omission of the
  introduction revision means revision 1 for backward compatibility. Status is
  `open`, `resolved`, `accepted_deferral`, or
  `out_of_scope`. Open areas claim no resolution, decisions, approval, or
  timestamp. Resolved areas cite one or more accepted decision records.
  Deferrals and out-of-scope decisions require their own approval reference and
  canonical UTC timestamp.
- `decisions` is a non-empty array of closed records with exactly `id`, optional
  `introducedAtFrontierRevision`, `question`, `recommendation`, `resolution`,
  `status`, `approvalRef`, and `decidedAt`. Omission of the introduction
  revision means revision 1 for backward compatibility. Status is `proposed`,
  `accepted`, `rejected`, or `superseded`.
  Proposed recommendations claim no resolution or approval. Terminal decisions
  require a resolution, approval reference, and canonical UTC timestamp.
- `promotions` is an append-only array of closed receipts. Each receipt binds a
  unique `promotionId`, SHA-256 input digest, source plan/frontier revisions,
  a digest of the complete accepted source snapshot, exact area-outcome and
  terminal-decision IDs and digests, promotion approval, distinct implementation
  authorization, timestamp, created node IDs, and accepted plan revision.

Only the manager authors frontier state. Every authored revision must pass
whole-plan `validate`; workers and discovery artifacts propose evidence but do
not mutate the plan. Once a decision is bound into a promotion receipt, preserve
that exact record. The same rule applies to resolved, deferred, and out-of-scope
area outcomes. Introduce a new ID for later change rather than rewriting
digest-bound history. Records introduced after revision 1 must state their exact
`introducedAtFrontierRevision`; stored promotion receipts must cover exactly the
records whose introduction revision is at or before their source frontier
revision.

`promote --plan <path> --input <path>` is the only portable operation that
converts a frontier snapshot into execution nodes. Promotion input is closed,
untrusted schema v1 and must contain exact project/run identity, unique
promotion ID, current expected plan/frontier revisions, all accepted decisions
and all terminal area outcomes in the frontier with exact SHA-256 digests,
promotion approval, distinct implementation authorization, canonical UTC time,
and one or more complete nodes.

Promotion rejects open areas, proposed decisions, stale revisions, incomplete
decision bindings, invalid or duplicate nodes, missing or conflated authority,
promotion timestamps preceding bound approvals, and conflicting ID reuse before
mutation. New nodes must begin `proposed` with empty reconciliation history.
Plan-mutating commands serialize on the plan lock, re-read after acquiring it,
and validate the complete candidate before atomic replacement. Concurrent stale
writers fail without state loss. Accepted plan revisions are unique across
promotion and reconciliation history. Exact replay is idempotent. Rejected or
conflicting input leaves plan bytes unchanged.

Promotion is not readiness or dispatch. It grants no issue creation, commit,
publication, deployment, destructive, secret, human-gate, or external-system
authority. Existing transition, placement, dependency, resource, review, and
prepare-before-dispatch rules still govern every promoted node.

## Targets and routing

`target` has required `project` and `workspaceMode`, plus optional `host` and
`startingState`. Model-backed surfaces also require `modelSelection`:

```json
{
  "project": {
    "projectId": "registry",
    "repository": "https://github.com/learnrudi/registry.git",
    "absolutePath": "/workspace/registry"
  },
  "host": {
    "selector": "codex-desktop",
    "requiredCapabilities": ["desktop_tasks", "git_worktrees"]
  },
  "modelSelection": {
    "provider": "openai",
    "model": "gpt-5.6-sol",
    "reasoningProfile": "high",
    "selectionSource": "user",
    "fallbackAuthorized": false,
    "fallbackAuthorizationRef": null,
    "fallbackUnresolvedBlockerRef": null
  },
  "workspaceMode": "isolated_worktree",
  "startingState": { "policy": "ref", "ref": "refs/heads/main" }
}
```

- `project` may contain `projectId`, canonical credential-free repository
  identity, absolute normalized path, or any combination, with at least one.
  Supplied forms are conjunctive and must resolve to the same exact project.
- `host` may contain `selector`, `requiredCapabilities`, or both. It is
  optional. Requirements may select only one compatible discovered host;
  ambiguity or no match is a route failure. A selector is portable intent, not
  a native host ID.
- Execution surfaces imply portable capabilities: `subagent` requires
  `subagents`, `desktop_task` requires `desktop_tasks`, `human_gate` requires
  `human_gates`, and `external_system` requires `external_systems`. `inline`
  has no implicit host capability. Explicit requirements are additive.
- `workspaceMode` is exactly `direct` or `isolated_worktree`.
- `startingState.policy` is exactly `current_revision`, `default_branch`, or
  `ref`. `ref` is required only for policy `ref` and forbidden otherwise.
  `startingState` is optional; omission is exactly equivalent to
  `{ "policy": "current_revision" }`. In either form, the binder records the
  exact observed revision in the prepared attempt and it cannot drift.
- `modelSelection` is required for `inline`, `subagent`, and `desktop_task`
  nodes and forbidden for non-model gates. It has exactly `provider`, `model`,
  `reasoningProfile`, `selectionSource`, `fallbackAuthorized`,
  `fallbackAuthorizationRef`, and `fallbackUnresolvedBlockerRef`.
  `selectionSource` is `user`, `plan`, `manager`, or `host_default` and records
  where the exact choice came from. `fallbackAuthorized` is true exactly when
  at least one fallback authorization or unresolved-blocker reference is
  present. A previous failure grants no fallback authority.

There is no precedence or fallback among locators and no silent substitution of
project, host, provider, model, reasoning profile, revision, checkout,
workspace, branch, execution surface, or sequential mode. Omitting `host` does not select or imply a default host: live
discovery must still yield one uniquely compatible route. `human_gate` and
`external_system` never broaden authorization.

## Handoffs and evidence

A handoff has exactly `id`, `producerNodeId`, `consumerNodeId`, `deliverableId`,
`transport`, and `requiredEvidence`. The node IDs must exist, the consumer must
depend on the producer, and `deliverableId` must name a producer deliverable.
`transport` is exactly `{ "medium", "mediaType" }`, where `medium` is `commit`,
`object`, `artifact`, or `patch`. `requiredEvidence` is the following canonical
JSON array, with no alternate order or members:

```json
["uri", "digest", "mediaType"]
```

Accepted evidence records have exactly:

```json
{
  "subjectType": "deliverable",
  "subjectId": "implementation",
  "uri": "artifact://run-17/node-a/implementation.patch",
  "digest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "mediaType": "text/x-diff"
}
```

`subjectType` is `criterion`, `verification`, `deliverable`, or `handoff` and
must reference a declared ID. The URI must use `artifact`, `git+https`, `gs`,
`http`, `https`, `ipfs`, `oci`, or `s3`, contain no credentials, and identify a
commit, object, artifact, or patch. The portable validator checks URI shape,
digest, media type, and declared subject identity. Deliverable evidence media
type must be one of that deliverable's declared `mediaTypes`; handoff evidence
media type must exactly match its declared transport and producer deliverable.
The manager must inspect the
retrieved object and confirm semantic consistency with the declared transport
before accepting it. Digests are SHA-256. Absolute or relative local worktree paths and `file:` URIs
are not accepted handoff evidence. Cross-project and cross-host dependencies
remain ordinary node IDs; handoffs make their transport explicit.

## Run transport

A noncanonical run record is a closed object with exactly `schemaVersion`,
`projectId`, `runId`, `planRevision`, `projects`, `hosts`, `attempts`,
`usageReports`, and `lineage`. `schemaVersion` is `1`; `projectId` and `runId` equal the plan values;
and `planRevision` is the exact plan revision observed when the record was last
written. It may equal or lag the current plan revision but may never lead it.
A lagging run is valid only when its complete semantic state remains consistent
with the current plan. An accepted reconciliation whose revision has already
been observed by the run requires its exact matching `resultReference`; a
reconciliation newer than the run may omit that reference only as the
recoverable result of a plan-first interrupted write. All nested records below
are closed. An attempt's `preparedPlanRevision` may not exceed the run's
`planRevision`; lag cannot be used to carry future-revision attempt state.

Each `projects` discovery record has exactly:

| Field | Contract |
|---|---|
| `projectBindingId` | Unique portable run-local ID. |
| `hostBindingId` | Host that discovered this project, or `null` for host-neutral filesystem discovery. |
| `locator` | Exact closed copy of the node's project locator. |
| `nativeSavedProjectId` | Native saved-project ID or `null`. |
| `repositoryIdentity` | Resolved credential-free repository identity or `null`. |
| `resolvedRoot` | Resolved absolute project root. |
| `startingState` | Exact normalized requested starting-state object that this binding resolved. Omission in a node is recorded as `{ "policy": "current_revision" }`. |
| `observedRevision` | Exact discovered revision. |
| `defaultBranch` | Exact discovered default branch or `null`. |
| `discoveredAt` | RFC 3339 UTC timestamp. |

Each `hosts` discovery record has exactly:

| Field | Contract |
|---|---|
| `hostBindingId` | Unique portable run-local ID. |
| `selector` | Supplied portable selector or `null`; never a default. |
| `nativeHostId` | Native host ID or `null`. |
| `capabilities` | Sorted unique discovered capability strings. |
| `modelProfiles` | Code-unit-sorted closed `{ "provider", "model", "reasoningProfiles" }` records proving exact selectable routes. Reasoning profiles are sorted and unique. |
| `maxConcurrency` | Discovered positive integer capacity. |
| `supportsReversibleArchive` | Discovered boolean capability. |
| `discoveredAt` | RFC 3339 UTC timestamp. |

The `attempts` array is append-only and ordered by preparation. A node may have
at most one active attempt, and only its latest attempt may submit a result or
cancellation. Each `attempts` record has exactly `attemptId`, `nodeId`,
`preparedPlanRevision`, `preparedAt`, `binding`, `nativeIds`, `dispatchState`,
`terminationOutcome`, `nativeLifecycle`, `dispatchHistory`,
`terminationHistory`, `pendingSteering`, `dispatchTimestamp`, `archive`,
`archiveHistory`, and `resultReference`.

Multiple discovery bindings for one project are allowed when they resolve
different starting-state requests or host-specific discoveries. Readiness
constructs conjunctive `(project, host)` candidates before testing ambiguity,
so an explicit host selector may disambiguate the same project on two hosts.
It also matches the exact normalized `startingState`; `observedRevision` is the
revision produced by that resolution, never the symbolic ref itself.

`binding` has exactly `projectBindingId`, `hostBindingId`, `executionSurface`,
`workspaceMode`, `actualCwd`, `actualWorktree`, `observedRevision`, `branch`,
`resourceLocks`, `authorizationRef`, `idempotencyKey`, and `modelSelection`. A prepared attempt
always has one discovered host binding. Worktree, branch, and authorization
reference may be `null` only when the declared surface or workspace does not
require them. Paths are absolute;
resource locks exactly copy the node locks; authorization is a reference, never
a credential; and the idempotency key is unique within the run.
`modelSelection` is an exact closed copy of the node declaration. The selected
provider, model, and reasoning profile must exist in the bound host's discovered
`modelProfiles`. This binding is the immutable placement snapshot for that
attempt. Active attempts must still equal the current node contract. Terminated
or reconciled attempts are historical: retain and validate their own closed
binding snapshots without reinterpreting them against a later revised retry
contract.

`nativeIds` has exactly `savedProjectId`, `hostId`, `agentId`, `taskId`, and
`threadId`, each a native string or `null`. Native IDs may also appear in the
explicit run discovery fields defined above. Every such occurrence is
run-transport state; native IDs remain forbidden in portable plan state.
`dispatchState` is exactly `prepared`, `route_failed`, `accepted`, or
`dispatch_indeterminate`. `terminationOutcome` is `null` until native
termination is confirmed, then exactly `complete`, `partial`, `failed`, or
`cancelled`. Thus accepted-then-failed is represented without a competing
state as `dispatchState: "accepted"` plus `terminationOutcome: "failed"`.
`nativeLifecycle` is the adapter's latest observed lifecycle string or `null`;
it is informational and never overrides the normalized dispatch and termination
fields. `dispatchHistory` is append-only and contains exact closed
`{ "dispatchId", "dispatchState", "nativeIds", "nativeLifecycle", "recordedAt" }`
records. It derives every non-`prepared` dispatch state and preserves
indeterminate resolution. `terminationHistory` contains at most one exact
closed `{ "terminationId", "outcome", "nativeLifecycle", "recordedAt" }`
record and derives every non-null terminal outcome. `validate-run` rejects
normalized lifecycle state that lacks or conflicts with these records.

`pendingSteering` is an array of closed records with exactly `steeringId`,
`payloadDigest`, `createdAt`, `updatedAt`, and `state`; state is `pending`,
`delivered`, `rejected`, or `indeterminate`. Terminal steering decisions cannot
be rewritten. `dispatchTimestamp` is the first recorded dispatch observation or
`null`. `archive` has exactly `state`, `archivedAt`, and `lastAttemptedAt`;
state is `not_archived`, `archived`, or `archive_failed`. `archiveHistory` is an
append-only array of exact `{ "archiveId", "state", "recordedAt" }` records;
`archived` is terminal while `archive_failed` may be retried. `resultReference` is `null` or exactly `{ "kind", "id",
"acceptedPlanRevision" }`, where kind is `result` or `cancellation`.

`usageReports` is append-only. Each closed record has exactly `usageId`,
`attemptId`, `elapsedSeconds`, `inputTokens`, `outputTokens`, `totalTokens`,
`reportedAt`, `source`, `decision`, and `authorizationRef`. Elapsed seconds and
available cumulative token totals are monotonic. Source is `host`, `manager`,
or `unavailable`; decision is `continue`, `pause`, or `continue_authorized`.
Only `continue_authorized` carries a non-null authorization reference. The
validator replays the resource envelope across the reports: hard-limit
continuation and unauthorized soft-checkpoint continuation are invalid, and a
latest `pause` blocks `prepare`.

An attempt is active for capacity and collision calculation exactly when its
dispatch state is `prepared`, `accepted`, or `dispatch_indeterminate` and its
termination outcome is `null`. A confirmed `route_failed` attempt is not
active. Only a non-null termination outcome can terminate accepted or
indeterminate native work and permit lock/capacity release.

Each `lineage` record has exactly `lineageId`, `handoffId`, `source`, and
`destination`. `source` has exactly `nodeId`, `attemptId`, `resultId`,
`acceptedPlanRevision`, `uri`, `digest`, and `mediaType`. `destination` has
exactly `nodeId`, `attemptId`, and
`projectBindingId`; `attemptId` may be `null` until prepared. All IDs must
resolve within the run and handoff, and evidence must equal accepted plan
evidence at the exact accepted plan revision named by the source. A later retry
or reconciliation does not reinterpret or invalidate this historical source
snapshot. The source attempt's `resultReference` and normalized terminal
outcome must match that exact complete reconciliation, not merely another
accepted record for the same node. Even while `attemptId` is null, the destination project binding must
match the consumer's project locator and normalized starting state. Once a
consumer attempt is prepared, every incoming handoff must have a lineage
record whose destination attempt and project binding equal that prepared
attempt. The current consumer attempt, however, may be prepared only from the
producer's current complete reconciliation; a later non-complete reconciliation
blocks new consumption without erasing earlier accepted lineage. This is the
source-to-destination transport lineage.

Adapter-native IDs remain nullable and run-only. `stack:agent-hosts` may help
discover or transport capabilities, but is not a writable saved-project or
visible project-task adapter.

## Validation and readiness

Validate the complete graph before any binding:

- exact schema, scalar bounds, safe paths, IDs, references, and enums;
- unique nodes, criteria, verification, deliverables, handoffs, and locks;
- acyclic dependencies and valid producer-to-consumer handoffs;
- target conjunctions and declared route compatibility;
- exact model-selection availability, fallback basis, resource envelope, and
  bounded review declarations;
- status, blocking reason, and reconciliation consistency; and
- absence of native IDs, undeclared fields, unsafe content, or authority claims.

A node is statically ready only when its contract is complete, its status is
`ready`, and every dependency is `done`. Run-aware readiness also requires one
exact compatible project, host, workspace, and revision, an open global and
per-host capacity slot, an exact available model profile, no lock collision,
no active attempt for the node, no review-limit violation, and no persisted
resource pause.

`ready --plan <path> [--run <path>]` has two deterministic modes:

- Without `--run`, report statically ready node IDs in lexical order and mark
  every placement `unverified`. This does not claim safe dispatchability.
- With `--run`, validate exact plan/run identity and the safe revision relation,
  then calculate unique
  conjunctive project-host routes from discovery records, and greedily select a safe
  dispatchable cohort in lexical node-ID order. Count active attempts against
  `requestedMaxParallel` globally and `maxConcurrency` per host, and treat both
  their locks and earlier selected cohort locks as occupied. Exclude any node
  that already has an active attempt before calculating capacity or locks.

The run-aware result returns dispatchable node IDs plus deterministic blocked
reasons from this closed set: `status_not_ready`, `dependency_not_done`,
`active_attempt`, `project_unresolved`, `project_mismatch`, `host_unresolved`,
`host_ambiguous`, `capability_missing`, `model_unavailable`, `workspace_mismatch`,
`revision_mismatch`, `global_capacity`, `host_capacity`,
`resource_lock_collision`, and `indeterminate_attempt`. Sort reasons in that
listed order. `ready` never creates a binding, acquires a lease, reserves
capacity, creates a task, or changes either file. The manager still performs a
fresh just-in-time revalidation, including authorization, and persists that
authorization during the prepare transaction before dispatch.

## Prepare and dispatch

Durable orchestration is active only after `run-init` creates the canonical run
from closed discovery input and `validate-run` proves exact plan/run identity,
revision, project bindings, host capabilities, and model profiles. `prepare`
fails if the run file does not exist. No adapter may dispatch before this
activation.

Before calling a host adapter, atomically:

1. acquire all resource leases;
2. persist the exact host, provider, model, reasoning profile, selection source,
   fallback basis, project, revision, and workspace binding snapshot;
3. create a pending attempt and unique idempotency key; and
4. persist authorization and source lineage references.

Then dispatch once. `dispatchState: "route_failed"` means the host did not accept the work and
leases may be released only after non-acceptance is established.
Accepted work uses `dispatchState: "accepted"`; any later failure is recorded
as `terminationOutcome: "failed"`, reconciled, and observed as terminated.
`dispatchState: "dispatch_indeterminate"` means acceptance is unknown: retain
binding, locks, and attempt, and never automatically retry or reroute.
Dependency readiness, collision release, and capacity release use only the
normalized fields defined above.

`prepare` is idempotent by attempt ID and deterministically derived idempotency
key. A conflicting reuse fails. A new attempt cannot change provider unless the
new plan selection records `fallbackAuthorized` and its authorization or
unresolved-blocker basis. Accepted review attempts count against the matching
review limit even when the same review node is reused.

After the native call, use `record-dispatch` to append the dispatch observation.
Only an indeterminate dispatch may later resolve to `accepted` or
`route_failed`; accepted and confirmed route-failure states cannot be
overwritten. Use `record-termination` exactly once after accepted native work
terminates. Both commands are input-ID idempotent and reject conflicting reuse.
Use `record-usage` throughout execution and before expansion near a checkpoint.
Use `record-steering` to preserve pending and terminal delivery state.

Lifecycle fields are closed: `prepared`, `route_failed`, and
`dispatch_indeterminate` attempts cannot claim a terminal outcome. A result is
reconcilable only when dispatch is `accepted`, termination is non-null, and the
proposal outcome exactly equals that terminal outcome. An accepted
reconciliation referenced from run state must continue to match the attempt's
normalized lifecycle.

## Results and transitions

A result proposal is closed and versioned with exactly `schemaVersion`,
`projectId`, `runId`, `nodeId`, `attemptId`, `resultId`, `outcome`, `summary`,
and `evidence`. Outcome is exactly `complete`, `partial`, or `failed`.
`projectId` always equals the manager plan's top-level `projectId`; it never
names the target project. The target project comes only from the attempt's
prepared `projectBindingId`. Results cannot change objective, owner,
dependencies, scope, locks, concurrency, approvals, target, surface, or native
binding.

A manager cancellation input is a separate closed object with exactly
`schemaVersion`, `projectId`, `runId`, `nodeId`, `attemptId`, `cancellationId`,
`reason`, and `evidence`. Its `projectId` has the same manager-plan meaning.
Only the manager may create it. `attemptId` may be `null` only when the node was
never dispatched; otherwise it must name the current attempt and acceptance
requires native stop reconciliation unless no native work was accepted.

Reject unknown, stale, conflicting, extra, illegal, or authority-expanding
input with no plan mutation or revision increment. An exact duplicate of an
already accepted `resultId` or `cancellationId` is idempotent; reuse of either
ID with different bytes fails. Cancellation `reason` is non-empty and bounded,
and cancellation `evidence` uses the same closed evidence record shape.

Each accepted node reconciliation has exactly `resultId`, `cancellationId`,
`attemptId`, `inputDigest`, `outcome`, `fromStatus`, `toStatus`, `acceptedAt`,
`acceptedPlanRevision`, `managerReason`, `evidenceContract`, and `evidence`.
`inputDigest` is the SHA-256 digest of the
accepted result or cancellation input bytes. Exactly one of `resultId` and
`cancellationId` is non-null. `acceptedPlanRevision` is the plan revision
created by that reconciliation and must match a run `resultReference` before
archive eligibility.
`evidenceContract` is the immutable, code-unit-sorted snapshot of criterion
IDs, verification IDs, deliverable IDs and allowed media types, and outgoing
handoff identity/transport that governed acceptance. Stored evidence is always
validated against this snapshot, so a later retry contract cannot rewrite
historical meaning. A node may be `done` only when its latest reconciliation is
complete and that snapshot exactly equals the current node/handoff contract.
Reconciliations are append ordered by unique, strictly increasing
`acceptedPlanRevision`, and an accepted revision may occur only once across the
whole plan. Result and cancellation IDs are globally unique across the plan. A
non-null `attemptId` may appear in only one terminal reconciliation, must belong
to that reconciliation's node, and must have been prepared at a strictly earlier
plan revision. Rework or retry requires a new attempt. A cancellation
reconciliation is terminal: it must be
the final record and the node must remain `cancelled`.
Cancellation records use outcome `cancelled`; result records use their proposal
outcome. `attemptId` may be `null` only for cancellation of a never-dispatched
node. When an attempt exists, the accepted `cancellationId` is also the ID in
the attempt's `resultReference`; no attempt reference is required when
`attemptId` is `null`. Reconciliations record evidence, not native identifiers.

| From | To | Gate |
|---|---|---|
| `proposed` | `ready` | Contract, authority, and static validation complete. |
| `waiting` | `ready` | Every declared dependency is `done`. |
| `needs_input` | `ready` | The recorded human decision or permission is accepted. |
| `rework` | `ready` | Rework contract is explicit and valid. |
| `failed` | `ready` | The manager explicitly authorizes a new attempt against the unchanged or revised node contract. |
| `ready` | `running` | Prepared attempt was accepted by the declared surface. |
| `running` | `review` | A valid `complete` result was reconciled. |
| `running` | `rework`, `waiting`, `needs_input`, or `failed` | Manager classification of a valid partial or failed result. |
| `review` | `done` | Manager accepts complete criterion, verification, deliverable, and handoff evidence. |
| `review` | `rework` | Evidence-backed review finds actionable gaps. |
| Any nonterminal state | `cancelled` | Manager-only cancellation with reason and native stop reconciliation. |

No other transition is valid. The `transition` command cannot perform a
result-classification or cancellation edge: those edges require `reconcile`.
Transitioning `ready` to `running` requires a matching run record whose latest
attempt for the node is accepted and active, and every dependency must still
be `done` at that transition boundary. `done` alone unlocks dependents. A host message
cannot self-transition a node, and a terminal plan state does not release locks
or capacity until native termination is confirmed.

## Archive eligibility

A desktop attempt is eligible only when all are true:

- its binding surface is `desktop_task` and its native task ID is non-null;
- `terminationOutcome` is `complete`, `partial`, `failed`, or `cancelled`;
- `resultReference` is non-null and matches an accepted plan reconciliation;
- no steering record has state `pending` or `indeterminate`;
- the node is not `waiting`, the attempt is reconciled, and `dispatchState` is
  not `dispatch_indeterminate`; and
- discovery confirms the host supports reversible archive.

Archive is host-side cockpit cleanup, never plan deletion. The portable command
reports eligibility and reasons; the adapter performs the archive. After that
native attempt, `record-archive` records `archived` or `archive_failed` only if
eligibility was proven. A successful archive is terminal; a failed archive may
be retried and remains auditable in `archiveHistory`.

## Portable command surface

| Command | Portable responsibility |
|---|---|
| `init` | Create a validated v1 plan/layout and establish default Git ignore for `runs/*.json`. |
| `validate` | Perform closed-schema and graph-wide static validation without mutation. |
| `promote` | Validate one accepted schema-v2 frontier snapshot and atomically append proposed nodes plus an idempotent, revision- and decision-bound receipt; never dispatch. |
| `run-init` | Create the canonical run exactly once from closed project/host/model discovery input, with empty attempts and usage history. |
| `validate-run` | Validate exact plan/run identity, safe revision relation, routes, histories, accepted references, usage policy, and lineage without mutation. |
| `ready` | Run `ready --plan <path> [--run <path>]` for static eligibility or run-aware safe concurrency and route calculation; never bind or reserve. |
| `prepare` | Atomically append one exact immutable attempt binding and deterministic idempotency key after all route, lock, capacity, review, resource, and fallback gates pass. |
| `record-dispatch` | Append and normalize one dispatch observation; reconcile an indeterminate outcome without overwriting accepted work. |
| `record-termination` | Append exactly one accepted native termination and derive its normalized outcome. |
| `record-usage` | Append cumulative usage and enforce hard limits, soft checkpoints, pause, and authorized continuation. |
| `record-steering` | Create or advance one digest-bound steering delivery record without rewriting terminal state. |
| `render` | Regenerate `graph.mmd` from a validated plan. |
| `transition` | Apply one manager-authorized legal transition and atomic revision increment. |
| `reconcile` | Validate one result/cancellation, apply an idempotent accepted reconciliation, or fail with no mutation. |
| `archive-eligible` | Read plan plus run state and report eligibility; never archive. |
| `record-archive` | After the adapter's native attempt, append eligible archive success or failure to run history; never performs archive itself. |

The script never performs live discovery, creates worktrees, calls models,
dispatches, sends steering, stops, or archives. It records adapter-observed
lifecycle and policy evidence only. Run-aware `ready` selects only among already
discovered run records; host adapters own discovery and external side effects.

## Safe deterministic writes

Commands accept only the resolved project orchestration paths they own and are
side-effect-free outside those files. Reject path traversal, symlinks,
non-regular files, duplicate JSON keys, invalid UTF-8,
trailing content, oversized content, unsafe paths, unknown fields, and values
outside the closed contract. Never partially salvage invalid input.
`init` validates its safe-integer concurrency value, complete initial plan, and
every existing `.rudi/orchestration` path component before creating any
directory, so a symlinked ancestor cannot redirect even preliminary setup.
It also refuses to initialize over an existing `runs` directory, preserving
retained transport instead of treating it as disposable.

Mutation validates the in-memory object, serializes it deterministically, then
uses a same-directory temporary regular file, complete write and flush, and
atomic rename. Plan mutations first acquire the adjacent exclusive mutation
lock and re-read the authoritative plan while holding it, so concurrent writers
cannot both accept the same source revision. A bounded lock wait fails closed;
the tool does not break or guess that an existing lock is stale. Increment
`revision` exactly once only after a successful accepted mutation. A rejected
or idempotent duplicate leaves the authoritative plan bytes and revision
unchanged. Every run writer acquires the adjacent run mutation lock and re-reads
the run while holding it, preventing accepted events from overwriting one
another. Run-only lifecycle mutations never increment plan revision; they
validate a safe equal-or-lagging run, require their input to name the current
plan revision, and persist the current revision on an accepted mutation or
idempotent catch-up.

Reconciliation holds the plan lock and then the run lock, validates both
ledgers, and updates both in memory. It writes the authoritative plan first and
the run second. The plan reconciliation and run `resultReference` must bind the
same input digest, attempt, ID, outcome, and accepted plan revision. If the run
write is interrupted, the old run revision makes that state recognizable: a
replay with byte-identical result or cancellation input and identical target,
manager reason, and acceptance timestamp repairs only the missing matching
reference and catches the run up without incrementing the plan. Run-ahead,
missing-attempt, non-lagging missing
reference, stale, conflicting, or ambiguous state is rejected without an owned
file write. Plan-and-run operations use the same plan-then-run lock order; no
command acquires those locks in reverse order.

`render` is byte-identical for identical validated input. Sort nodes, evidence
snapshots, and edges by JavaScript string code units, independent of host
locale; assign synthetic Mermaid IDs (`n0`, `n1`, ...), normalize line
endings, and JSON-quote escaped labels. Never place raw plan text in Mermaid
syntax positions and never emit directives, HTML, click targets, links, styles,
or initialization blocks from plan content.
