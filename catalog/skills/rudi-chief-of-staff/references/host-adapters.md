# Host Adapters

Use the current host's native capabilities as the source of truth. Tool names,
native identifiers, concurrency, persistence, visibility, archive behavior,
model profiles, usage telemetry, and worktree creation differ by host. Discover them during just-in-time binding
and persist observations in `.rudi/orchestration/runs/*.json`, never in a
portable plan node.

An adapter owns side effects: project discovery, checkout or worktree creation,
dispatch, observation, steering, interruption, and reversible archive. The
portable project-plan script only validates, computes readiness, renders,
transitions accepted state, reconciles evidence, and reports archive
eligibility. It never dispatches or archives.

## Common binding contract

Before dispatch, an adapter must prove all supplied target constraints
conjunctively:

1. Every project locator resolves to the same exact project.
2. The host selector, when present, resolves to exactly one host.
3. The discovered host satisfies every required capability and capacity need.
4. Its discovered model profiles include the exact provider, model, and
   reasoning profile declared by the node.
5. The observed revision and starting-state policy match exactly.
6. The actual cwd or newly created isolated worktree is the requested workspace.
7. The declared execution surface is supported and authorized.
8. The review-pass policy and latest resource decision permit another attempt.
9. Resource leases and the pending attempt with its idempotency key were
   durably recorded before the host accepts work.

Fail closed on ambiguity or mismatch. Do not substitute another project, host,
provider, model, reasoning profile, revision, checkout, branch, workspace,
surface, or execution mode.
Normalize surface support as `subagents`, `desktop_tasks`, `human_gates`, or
`external_systems`; isolated worktrees additionally require `git_worktrees`.
Apply the host selector to conjunctive project-host candidates before declaring
a repeated project discovery ambiguous.

Return transport lineage sufficient to map the prepared attempt to the native
execution: nullable native project, host, task, thread, and agent IDs; actual
cwd and worktree; observed revision; native lifecycle; dispatch timestamp; and
the idempotency key when the host can carry it. Nullable means unavailable, not
permission to invent a value.

Every prepared attempt records the selected host binding, provider, model,
reasoning profile, selection source, and fallback decision. A host failure must
not switch provider, model, or reasoning profile. Provider fallback requires a
revised plan selection whose `fallbackAuthorized` value is backed by either an
explicit authorization reference or a documented unresolved blocker. Record
that revised selection in a new prepared attempt; never infer it from failure.

Use normalized dispatch state `prepared`, `route_failed`, `accepted`, or
`dispatch_indeterminate` and a separate nullable termination outcome of
`complete`, `partial`, `failed`, or `cancelled`. Accepted-then-failed is
`accepted` plus termination `failed`. Never automatically retry or reroute an
indeterminate dispatch. Preserve its binding, attempt, and locks until native
reconciliation establishes whether execution was accepted and terminated.
Only `accepted` may pair with a terminal result outcome; pre-acceptance,
confirmed route failure, and indeterminate acceptance keep termination null.
Normalize native lifecycle observations into these fields before proposing a
result, and require the proposal outcome to equal the recorded termination.
Use `record-dispatch` and `record-termination` after native observation; do not
hand-author the normalized fields. Use `record-steering` for delivery state and
`record-archive` only after the portable eligibility check and native archive
attempt.

Report cumulative elapsed time and host-exposed token usage through
`record-usage`. If token telemetry is unavailable, say so and keep reporting
elapsed time. Pause native expansion at a hard limit or persisted pause. A soft
checkpoint may continue only with the manager's recorded authorization.

## Codex

### Temporary subagents

- Use native collaboration capabilities to create bounded workers, inspect
  status, send follow-ups, wait, interrupt, and collect final results.
- Keep the initiating task as manager. A subagent is a temporary workforce
  surface, not a durable visible project task.
- Record returned canonical task or agent references only in run transport.
  Pass the exact project path and worktree in the assignment because processes
  may share a filesystem but do not share context automatically.
- Respect discovered concurrency and retain capacity for review or rework.
- Record the exact OpenAI provider, Codex model, reasoning profile, and
  selection source that the host actually accepted.

### Desktop tasks

- Require explicit user authorization before creating a visible desktop task.
- Use Codex's native list-project discovery first. Match the portable project
  locator against discovered saved-project metadata and repository or absolute
  path evidence. Select exactly one project; zero or multiple matches are route
  failures that require correction.
- Resolve the required starting revision before creation. For
  `isolated_worktree`, use the native project/worktree workflow to create one
  worktree from that exact revision. For `direct`, verify the returned cwd is
  the resolved project and do not create a hidden checkout.
- Create each ready visible task explicitly only after the prepared attempt is
  persisted. Do not materialize waiting nodes or all future nodes.
- Bind the returned task, thread, project, worktree, and host references back to
  the prepared attempt. Preserve source-to-destination lineage in run state and
  include the portable project, run, node, attempt, and idempotency identity in
  the dispatched task contract when the host supports metadata or prompt
  context.
- For cross-project or cross-host work, attach lineage to the exact accepted
  producer reconciliation revision and retrievable evidence digest. Do not
  substitute a newer producer attempt or infer lineage from a shared local
  checkout.
- Use native task reads or bounded waits for observation and native messages
  for steering. A deep link is navigation only, not evidence or authority.
- Archive only after `archive-eligible` succeeds and discovery confirms Codex
  supports reversible archive. Record the native archive result in run state;
  never delete or complete the canonical node merely to clean the cockpit.

## Claude

- Discover and use the current Claude host's native task, subagent, or team
  capabilities only when the declared surface is available and authorized.
- Bind the exact repository, revision, cwd or isolated worktree, and capability
  requirements before dispatch. Do not assume a Claude worker inherits the
  manager's conversation or sees another worker's results.
- Record returned task, agent, session, project, and worktree handles only in
  run transport. Use native status, messaging, cancellation, and archive
  controls only when discovery proves they exist.
- Record the exact Anthropic provider, Claude model, reasoning profile, and
  selection source that the host actually accepted.
- If the host cannot expose or steer a requested worker, report a route failure.
  Do not silently turn a `desktop_task` into a subagent or inline task.

## Other native hosts and RUDI

- Map a native host to project discovery, bind, dispatch, observe, communicate,
  stop, and reversible-archive capability classes.
- Prefer host-owned agent execution. Use RUDI for tools, secrets, stack access,
  and normalized capability discovery rather than as the default agent runner.
- `stack:agent-hosts` is capability discovery and transport support; it is not
  a writable saved-project or visible project-task adapter.
- Use cross-provider groups only when the user explicitly requests that
  execution model and exact routing remains provable. A provider failure does
  not authorize switching to Codex, Claude, Gemini, or another provider.

## Sequential execution

Sequential execution is allowed only when explicitly selected in the plan or
by the user. It is not an automatic fallback for a failed placement.

When selected:

1. keep the same task graph, evidence gates, and resource locks;
2. run one ready `inline` node at a time in the initiating session;
3. preserve worktree isolation when requested and available;
4. record that no parallel worker was created; and
5. do not launch background terminal processes and represent them as managed
   agents.

If the plan requests another surface and that surface cannot bind, return a
route failure and request a plan transition or user decision. Do not rewrite
placement during dispatch.
