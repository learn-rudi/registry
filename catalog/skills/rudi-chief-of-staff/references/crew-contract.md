# Crew Contract

Use one bounded task record per assignment. Keep the ledger in the host's
native task or plan state when possible. For long-running work, persist a
project-local ledger only when repository conventions allow it; do not commit
runtime coordination state by default.

## Task record

```yaml
task_id: auth-middleware
objective: Implement and verify authentication middleware.
owner: auth-worker
agent_ref: null
status: ready
dependencies: []
worktree: /absolute/path/to/auth-worktree
branch: crew/auth-middleware
allowed_scope:
  - src/auth/**
  - test/auth/**
acceptance_criteria:
  - Invalid tokens are rejected with the documented response.
verification:
  - npm test -- auth
deliverables:
  - scoped commit
  - test evidence
risks: []
blocked_reason: null
```

Use `null` for `worktree` and `branch` on read-only research assignments.
`agent_ref` is the native target, task, thread, or session handle returned by
the host. Treat it as an address, not as the assignment definition.

## Status model

Use these states consistently:

- `proposed`: task exists but scope or authority is unresolved;
- `ready`: dependencies and task contract are complete;
- `running`: a worker owns the task and is active;
- `waiting`: worker is waiting on a declared dependency;
- `needs_input`: a specific human decision or permission is required;
- `review`: implementation is ready for evidence-backed review;
- `rework`: actionable findings were returned to an owner;
- `done`: accepted result is integrated or ready for the agreed handoff;
- `failed`: attempt ended without a usable result;
- `cancelled`: manager intentionally stopped the assignment.

Do not use `done` merely because a worker stopped. Require the contracted
deliverables and verification evidence.

## Dispatch contract

Send each worker only the context required to succeed:

```text
Task ID and objective
Repository and exact worktree path
Allowed files and prohibited overlap
Relevant interfaces, invariants, and dependencies
Acceptance criteria
Required red/green or other verification commands
Expected deliverables and reporting format
Actions requiring manager or human approval
```

Tell a writing worker to inspect applicable instructions and current state
inside its assigned worktree before editing. Tell it not to modify another
worker's worktree, publish changes, or broaden scope without contacting the
manager.

## Result contract

Require every worker to report:

```yaml
task_id: auth-middleware
outcome: complete | partial | blocked | failed
summary: concise observable result
changed_paths: []
commit: null
verification:
  - command: npm test -- auth
    result: passed
risks: []
open_decisions: []
recommended_follow_up: null
```

Validate the report against the actual repository state. Preserve useful
partial results and reassign only the remaining work.

## Dependency and communication rules

- Route decisions and cross-task information through the manager.
- Send the smallest sufficient update to dependent workers.
- Do not make workers rediscover decisions already recorded in the ledger.
- Do not require peer-to-peer communication when a manager-routed handoff is
  clearer and auditable.
- When a dependency changes an interface, pause affected downstream writers
  until the new contract is explicit.
