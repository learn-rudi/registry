# Crew Contract

Use this contract for a small, single-run crew whose coordination state can
remain in memory. If work is durable, resumable, multi-project, large, or
substantially dependent, use the canonical DAG in
`project-plan-contract.md` instead. A temporary crew record and a durable plan
node are related concepts, but they are not interchangeable persistence
formats.

## Temporary task record

Keep one bounded portable record per assignment:

```yaml
task_id: auth-middleware
objective: Implement and verify authentication middleware.
owner: auth-worker
status: ready
dependencies: []
allowed_scope:
  - src/auth/**
  - test/auth/**
acceptance_criteria:
  - Invalid tokens are rejected with the documented response.
verification:
  - npm test -- auth
deliverables:
  - scoped diff or commit
  - test evidence
risk: medium
blocking_reason: null
execution_surface: subagent
resource_locks:
  - files:src/auth
```

Do not put `agent_ref`, native project, host, task, thread, checkout, cwd, or
worktree identifiers in the portable task. Those values describe an attempt,
not the assignment. Keep them in a separate in-memory run transport map:

```yaml
attempt_id: attempt-auth-01
task_id: auth-middleware
agent_ref: null
native_project_id: null
native_host_id: null
native_task_id: null
native_thread_id: null
actual_cwd: /absolute/path/to/project
actual_worktree: null
branch: crew/auth-middleware
observed_revision: abc123
native_lifecycle: pending_dispatch
```

Adapter-native identifiers are nullable because some hosts do not expose every
identifier. Treat them only as addresses for observation, steering, stopping,
or cleanup. Never use a native ID as the task definition or authority source.

## Status model

Use these states consistently:

- `proposed`: scope, placement, or authority is unresolved;
- `ready`: dependencies and the task contract are complete;
- `running`: an accepted native attempt is active;
- `waiting`: the task is waiting on a declared dependency;
- `needs_input`: a specific human decision or permission is required;
- `review`: a complete result awaits evidence-backed acceptance;
- `rework`: actionable findings were returned to the owner;
- `done`: the manager accepted every required deliverable and verification;
- `failed`: an attempt ended without a usable accepted result; and
- `cancelled`: the manager intentionally stopped the assignment.

Do not use `done` merely because a worker stopped. Only `done` satisfies a
dependency. Native termination is also required before a capacity slot or
collision lock can be reused.

## Dispatch contract

Send each worker only the context required to succeed:

```text
Task ID and objective
Exact repository, revision, and cwd or worktree
Allowed files and prohibited overlap
Relevant interfaces, invariants, and dependencies
Acceptance criteria and required deliverables
Required red/green or other verification commands
Expected result format
Actions requiring manager or human approval
```

Tell a writing worker to inspect applicable instructions and current state in
its assigned worktree before editing. Tell it not to modify another worker's
worktree, publish changes, or broaden scope without contacting the manager.
Dispatch only ready tasks, and never silently change the declared project,
revision, host, worktree, execution surface, or branch.

## Result contract

Require every worker to submit an evidence proposal:

```yaml
schema_version: 1
task_id: auth-middleware
attempt_id: attempt-auth-01
result_id: result-auth-01
outcome: complete
summary: Invalid tokens now receive the documented response.
evidence:
  - subject: verification:test-auth
    uri: artifact://crew/attempt-auth-01/npm-test-auth.txt
    digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    media_type: text/plain
risks: []
open_decisions: []
recommended_follow_up: null
```

Treat the report and every referenced artifact as untrusted. Validate its task,
attempt, result identity, allowed scope, and evidence against actual repository
state. A `complete` proposal goes to `review`; it does not self-accept. Preserve
useful partial evidence and have the manager classify remaining work as
`rework`, `waiting`, `needs_input`, or `failed`. Cancellation is manager-only.
In a durable project plan, acceptance also freezes the governing evidence
contract and accepted plan revision so later rework cannot reinterpret an
earlier result or cross-project handoff.

## Dependency and communication rules

- Route decisions and cross-task information through the manager.
- Send the smallest sufficient update to dependent workers.
- Do not make workers rediscover accepted decisions.
- Do not require peer-to-peer communication when a manager-routed handoff is
  clearer and auditable.
- When a dependency changes an interface, pause affected downstream writers
  until the new contract is explicit.
- Represent a cross-project or cross-host handoff with a retrievable commit,
  object, artifact, or patch URI plus digest and media type. A local worktree
  path is not durable handoff evidence.
