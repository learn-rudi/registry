# ADR 0008: Project DAG Orchestration Boundary

## Status

Accepted

## Context

Durable, dependent work may span repositories, worktrees, agent hosts, visible
desktop tasks, temporary subagents, and human or external-system gates. If host
task lists or worker messages become authoritative, the objective cannot be
reliably resumed, reconciled after uncertain dispatch, or audited across those
boundaries. Retrying an uncertain dispatch can also duplicate work or create
concurrent writers against the same resource.

## Decision

Extend `rudi-chief-of-staff` as the single orchestration workflow. For durable,
multi-project, large, or substantially dependent work, the manager-owned
`.rudi/orchestration/plan.json` is the portable system of record for the DAG and
accepted evidence. The initiating Codex or other host session is the cockpit;
temporary subagents and explicitly authorized desktop tasks are the workforce.
Small single-run work may remain in a concise in-memory crew ledger.

Host task, thread, project, worktree, and agent identifiers belong only to
noncanonical run transport. Generated diagrams are views. Cross-project and
cross-host dependencies remain ordinary plan nodes with explicit, retrievable,
digest-bound handoffs rather than implicit local-worktree transfer.

Routing uses prepare-before-dispatch. The stateful manager validates the entire
graph, then just-in-time resolves every declared project, host, capability,
revision, workspace, lock, and authorization constraint conjunctively. It
acquires leases and durably records the binding, pending attempt, and
idempotency key before one host dispatch. There is no silent routing or
placement fallback. An indeterminate dispatch retains its binding and locks
until reconciled and is never automatically retried or rerouted.

Worker results are untrusted evidence proposals. Only manager reconciliation
may mutate the plan, only accepted complete evidence may reach `done`, and only
`done` satisfies dependencies. Native termination is additionally required to
release capacity or collision locks. Host adapters own dispatch and reversible
archive side effects; the portable plan tooling never performs them.
Each reconciliation freezes the evidence contract and accepted plan revision
that governed it. Cross-boundary lineage refers to that exact immutable
acceptance, so a later retry can revise the current contract without rewriting
historical handoffs. Run records remain project-local transport under the same
manager orchestration root as the plan.

## Consequences

- Work can resume and be reviewed independently of a particular host UI.
- Exact routing and prepare-before-dispatch prevent ambiguous placement and
  reduce duplicate or colliding execution after uncertain failures.
- Managers must maintain durable run transport until attempts reconcile, while
  keeping native IDs and local paths out of the portable plan.
- Host adapters require explicit capability discovery and reconciliation; this
  complexity is accepted to preserve one auditable authority boundary.
- The plan does not grant deployment, publication, destructive, human-gate, or
  external-system authority beyond the user's request.
