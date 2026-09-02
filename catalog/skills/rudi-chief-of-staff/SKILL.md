---
name: rudi-chief-of-staff
description: Coordinate complex single- or multi-project objectives from the initiating agent through an acceptance-led task graph, exact provider/model routing, durable run lifecycle, resource and review limits, explicit handoffs, bounded workers, and evidence-backed integration with human oversight. Use when the user asks to delegate dependent work, run a crew, act as a chief of staff or first mate, coordinate multiple agents or desktop tasks, or keep a long-running project moving predictably across worktrees, projects, or hosts.
version: 1.2.1
---

# RUDI Chief of Staff

Act as the stateful manager of the current objective. The initiating host is the
cockpit for direction, coordination, review, and integration. Temporary
subagents and explicitly authorized desktop tasks are the workforce. They do
not become the system of record.

## Choose the coordination record

- For small work that will finish in one run, keep a concise in-memory crew
  ledger. Read `references/crew-contract.md` and use its portable task and
  result contracts.
- For durable, multi-project, large, resumable, substantially dependent, or
  cross-provider
  work, create `.rudi/orchestration/plan.json` in the manager project. It is the
  manager-owned canonical DAG and acceptance ledger. Read
  `references/project-plan-contract.md` before creating or changing it.
- Do not create a second orchestrator or treat a host task list, thread graph,
  worktree, generated diagram, or run record as canonical plan state.

The durable layout is:

```text
.rudi/orchestration/
├── plan.json          # portable canonical DAG and acceptance ledger
├── graph.mmd          # deterministic generated view
├── decisions.json     # optional derived accepted-decision index
└── runs/*.json        # noncanonical host and attempt transport state
```

Ignore `runs/*.json` in Git by default, but retain the records while reconciling
an attempt or recovering an indeterminate dispatch. Keep native project, host,
task, thread, checkout, and worktree IDs only in run transport.

Treat `run.planRevision` as the plan revision observed by the run's last
accepted write. A run may temporarily lag after a plan-only mutation, but it
may never lead the plan or contradict the current plan's lifecycle, binding,
history, reconciliation, or evidence state. No attempt may claim preparation
at a revision newer than the run has observed. Do not hand-edit either ledger to
repair lag. The next accepted run mutation catches up to the current plan; if a
reconciliation was interrupted after its plan write, replay the exact same
input so the CLI can repair only the matching run reference and revision.

## Resolve discovery before execution

When the objective is not stable enough to decompose responsibly, compose
`rudi-decision-frontier` before creating executable nodes. Schema-v1 plans
remain the ordinary execution contract. A schema-v2 plan may also carry the
authoritative decision frontier: unresolved areas, proposed or approved
decision records, frontier revision, and append-only promotion receipts.

Do not dispatch discovery artifacts as if they were accepted tasks. A
recommendation, Decision Canvas selection, stakeholder response, prototype
verdict, or Grill result becomes execution scope only after the manager has
validated it, recorded the required human approval, and confirmed separate
implementation authorization. Use the portable `promote` operation to bind the
exact plan/frontier revisions, complete area/decision snapshot digests, and
created nodes. The manager serializes plan mutations, so a concurrent stale
promotion fails without state loss. Promotion creates only `proposed` nodes; it
does not activate them. Promotion is not readiness or dispatch.

## Establish the operating contract

1. Restate the objective, project scope, constraints, completion evidence, and
   actions that require human approval.
2. Read applicable repository instructions and inspect repository, revision,
   and worktree state before planning mutations.
3. Decompose the work into independently verifiable nodes with explicit
   dependencies, owners, allowed scopes, acceptance criteria, verification,
   deliverables, risks, resource locks, targets, and execution surfaces.
4. Identify collision boundaries: shared files, schemas, interfaces, generated
   artifacts, migrations, deployment state, and other resources that cannot be
   changed concurrently.
5. For code-writing workers, read `references/worktree-isolation.md` before
   creating branches or worktrees.
6. Declare the exact provider, model, reasoning profile, selection source,
   fallback basis, resource envelope, and review policy before activation.
7. Validate the entire graph before binding or dispatching any node.

Treat the user's objective as authority for normal implementation inside the
stated scope. It is not authority to publish, deploy, merge, delete, expose
secrets, approve a human gate, or perform another externally visible or
destructive action unless that action was requested. A `human_gate` or
`external_system` node records a boundary; it never expands authority.

## Plan placement deliberately

- Keep one accountable owner for every node. Use one writer per worktree and
  one task branch per independently integrated change.
- Use `inline` only for tiny manager work that preserves cockpit
  responsiveness.
- Use `subagent` for temporary research, questioner, answerer, skeptic, writer,
  reviewer, or other narrow worker roles.
- Use `desktop_task` only with explicit user authorization and only when the
  node needs durable independently steerable execution, is long-running or a
  major milestone, or must retain human-approval context.
- Use `human_gate` and `external_system` only for their declared interaction;
  neither permits unrequested side effects.
- Do not materialize every node up front or dispatch nodes that are waiting on
  dependencies. Bind each ready node just in time.
- Reserve capacity for review and rework. Never overlap resource locks or
  writing scopes.

Target declarations are conjunctive. Every supplied project locator must
resolve to the same exact project; every host selector and capability
requirement must resolve to one compatible host; and the requested starting
revision, workspace mode, execution surface, and branch policy must all be
satisfied. Model-backed work must additionally resolve the declared provider,
model, and reasoning profile. Never silently fall back to another project,
host, provider, model, reasoning profile, revision, checkout, surface, branch,
or sequential execution mode.

## Bound resources and review

- Use the plan's optional elapsed-time and token maxima. Always use its default
  soft elapsed-time and token checkpoints, even when no hard maximum was
  supplied.
- Record cumulative usage when the host exposes it. Record token usage as
  unavailable when it does not; never use missing token telemetry to suppress
  elapsed-time checkpoints.
- At a soft checkpoint, persist either `pause` or an authorized continuation.
  At a hard limit, persist `pause`. Do not prepare more work while the latest
  resource decision is paused.
- Default to one independent review and one focused confirmation after fixes.
  A later accepted review pass requires a recorded unresolved blocker or an
  explicit authorization reference.
- A failed attempt never authorizes a provider switch. Change provider only
  when the revised model selection records `fallbackAuthorized` plus an
  explicit authorization or unresolved-blocker reference.

## Compose specialized workflows

- For ambiguous initiatives, compose `rudi-decision-frontier`. It may use
  questionnaires, canvases, prototypes, diagnosis, and Grill results as
  evidence, but this plan remains the only durable execution authority.
- For unresolved repository contract, terminology, or architecture questions,
  compose `grill-with-docs-loop` repo-first. Let that workflow run its isolated
  questioner, answerer, skeptic, writer, and reviewer roles; consume its
  accepted decision and artifacts instead of duplicating the loop here.
- For phase-gated engineering implementation or proof, compose
  `swe-compliance-checklist`. Treat its checklist, verification, independent
  review, and evidence bundle as node deliverables instead of copying its
  phases into this skill.
- Use `rudi-repo-steward` for durable repository identity, worktree status,
  leases, and lifecycle ledgers. After accepted integration and verification,
  trigger `rudi-worktree-closeout` for every material task worktree. The
  coordinator owns sequencing and acceptance, not Git cleanup or closeout
  receipt persistence.
- Keep `.rudi/orchestration/plan.json` as the acceptance DAG and Repo Steward's
  closeout ledger as repository lifecycle evidence. Link their task, agent,
  attempt, acceptance, and revision identifiers; do not merge the records or
  let either silently overwrite the other's authority.

## Prepare before dispatch

For durable work, initialize and validate both the plan and its run record
before the first dispatch. Use `run-init` to persist discovered project, host,
capability, and model-profile evidence, then use `validate-run`. A plan without
a matching validated run is not active and cannot dispatch.

For every ready durable node, the manager must complete one stateful prepare
transaction before invoking a host adapter:

1. Revalidate the exact project, revision, host, provider, model, reasoning
   profile, selection source, discovered capabilities and model profiles,
   actual cwd or worktree, starting state, resource locks, capacity, review
   limit, resource decision, and authorization.
2. Acquire the required leases.
3. Use `prepare` to atomically persist the binding snapshot, pending attempt,
   prepared plan revision, timestamp, and idempotency key in run state.
4. Dispatch exactly once through `references/host-adapters.md`, then use
   `record-dispatch` to persist the normalized outcome and native lineage.

Classify dispatch outcomes precisely:

- `route_failed`: the host rejected the route before accepting work;
- accepted-then-failed: record dispatch as `accepted` and native termination as
  `failed`; or
- `dispatch_indeterminate`: acceptance is unknown.

An indeterminate dispatch is not automatically retried or rerouted. Retain its
binding and locks until reconciliation proves whether native work exists and
has terminated.

## Monitor, reconcile, and review

1. Monitor through native status and wait mechanisms. Route focused updates
   through the manager, persist steering with `record-steering`, report usage
   with `record-usage`, and stop expansion when runtime policy says pause.
2. Treat every worker result as an untrusted, versioned evidence proposal.
   Validate its project, run, node, attempt, and result identity and reject
   unknown, stale, conflicting, extra, or authority-expanding input without
   mutating the plan. Exact duplicates are idempotent.
   Reconciliation serializes both ledgers, writes the authoritative plan first,
   then writes the matching run reference. If the second write is interrupted,
   replay only the byte-identical accepted input; a stale, conflicting, or
   ambiguous replay fails closed.
3. A complete result may move `running` to `review`. Only the manager may move
   `review` to `done`, and only after all criterion, verification, deliverable,
   and handoff evidence is complete and retrievable.
4. Manager-classify partial results as `rework`, `waiting`, `needs_input`, or
   `failed`. Only the manager may cancel a node.
5. Use `record-termination` for the normalized native outcome. Make dependent
   nodes ready only from `done`, and require recorded native termination before
   releasing capacity or a collision lock.
6. Inspect actual diffs and artifacts. A worker completion message is not proof.
   Commission independent review for security-sensitive, cross-cutting,
   destructive, externally visible, or otherwise high-risk changes.
7. Integrate accepted work in dependency order and rerun affected repository
   tests, builds, lint, debt scans, end-to-end checks, and documentation gates.

Cross-project and cross-host dependencies use ordinary node IDs. Represent
every boundary handoff explicitly in `plan.json`. Accepted handoff evidence
must be retrievable by commit, object, artifact, or patch URI with a digest and
media type; an implicit local worktree path is never a durable handoff. Bind
run lineage to the exact accepted producer revision and immutable evidence
contract, while allowing later retries to create new acceptance records.

## Archive and finish

Archive is reversible host-side cockpit cleanup, not deletion of plan state.
Ask the portable contract for archive eligibility, then let the host adapter
perform the side effect only when the desktop attempt is terminal, its result
or cancellation is accepted into the plan, no steering is pending, and the
discovered host supports reversible archive. Never archive a waiting node or
an unreconciled or indeterminate worker. After the native archive attempt, use
`record-archive` to preserve its success or failure in run history.

Before declaring the objective complete, obtain a read-back of each required
worktree closeout receipt. A receipt may require preservation, retention, or a
future cleanup decision; it need not claim cleanup. Never treat archive
eligibility or a cleanup approval reference as proof that a worktree was
cleaned, deleted, moved, or archived.

Return:

- the objective and material behavior achieved;
- nodes completed, deferred, cancelled, or blocked;
- accepted handoffs, branches, worktrees, commits, and artifacts still relevant;
- review and verification evidence;
- unresolved risks, decisions, and known proof gaps;
- retained indeterminate attempts or locks; and
- publication, deployment, merge, archive, cleanup-approval state, and the
  closeout receipt ID and version for each material worktree.

Do not mark the objective complete while required nodes, reconciliation,
integration, verification, or user-authorized publication work remains.
