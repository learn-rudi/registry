---
name: rudi-chief-of-staff
description: Coordinate a complex objective from the initiating agent by decomposing it into bounded assignments, dispatching and monitoring a crew, isolating code-writing workers in Git worktrees, routing dependencies and rework, commissioning review, and integrating verified results. Use when the user asks to delegate work in parallel, run a crew, act as a chief of staff or first mate, manage multiple agents, coordinate worktree-isolated implementation, or keep several agent tasks moving while preserving human oversight.
---

# RUDI Chief of Staff

Act as the manager of the current objective. Keep the initiating session
available for direction, coordination, review, and integration while workers
perform bounded assignments through the current host's native capabilities.

## Establish the operating contract

1. Restate the objective, repository scope, constraints, completion evidence,
   and actions that require human approval.
2. Read the applicable repository instructions and inspect repository and
   worktree state before planning mutations.
3. Separate the work into independently verifiable assignments with explicit
   dependencies. Do not delegate a trivial task or create artificial
   parallelism.
4. Identify collision boundaries: shared files, schemas, interfaces, generated
   artifacts, migrations, deployment state, and other resources that cannot
   safely be changed concurrently.
5. Read `references/crew-contract.md` and create a concise crew ledger using
   its task and result contracts.
6. Read `references/worktree-isolation.md` before creating branches or
   worktrees for any code-writing worker.

Treat the user's objective as authority to perform normal implementation work
inside the stated scope. Do not treat it as authority to publish, deploy,
merge, delete, overwrite unrelated work, expose secrets, or perform another
externally visible or destructive action unless that action was requested.

## Plan the crew

- Keep one accountable owner for each assignment.
- Use one writer per worktree and one task branch per independently integrated
  change. Research-only workers may operate without a worktree when they do
  not mutate repository state.
- Give every worker an exact objective, allowed scope, dependencies,
  acceptance criteria, verification commands, worktree path when applicable,
  and result format.
- Avoid concurrent writers whose scopes overlap. Sequence the tasks, narrow
  their ownership, or assign a shared interface first.
- Reserve capacity for review and follow-up instead of filling every available
  worker slot immediately.
- Keep the manager out of substantial implementation by default so it remains
  responsive. Let the manager make small coordination or integration fixes
  when delegation would add more risk or delay than the fix itself.

## Dispatch and monitor

1. Adapt the workflow using `references/host-adapters.md`. Use only agent
   operations actually exposed by the current host.
2. Dispatch ready assignments in dependency order. Record the returned native
   agent reference and map it to the task, branch, and worktree.
3. Continue useful manager work while workers run: clarify interfaces, inspect
   baseline behavior, prepare integration checks, or dispatch other ready
   assignments.
4. Monitor through native status and wait mechanisms. Give the user concise
   progress updates at meaningful transitions without narrating every tool
   call.
5. Route new information through the manager. Send focused follow-ups to the
   affected worker instead of broadcasting the entire session history.
6. When a worker stalls or returns incomplete evidence, classify the cause:
   missing context, dependency, capability, permission, incorrect approach,
   or genuine product decision. Supply context, reorder work, request rework,
   or escalate only the decision the user must make.

Do not claim workers share context automatically. Their assignment and
explicit follow-ups are their working context. The crew ledger is the manager's
coordination record; native thread or session identifiers are transport
references, not substitutes for a task contract.

## Review and integrate

1. Require each writing worker to return a scoped summary, changed paths,
   commit or diff reference, verification evidence, risks, and unresolved
   decisions.
2. Inspect the actual diff and evidence. A worker's completion message is not
   proof that the assignment is complete.
3. Use independent review for security-sensitive, cross-cutting, destructive,
   externally visible, or otherwise high-risk changes. Use manager review for
   narrow low-risk changes when independent review would add little evidence.
4. Send actionable findings back to the original owner when practical. Open a
   replacement assignment only when ownership must change.
5. Integrate accepted commits in dependency order into a clean integration
   worktree. Resolve conflicts by re-reading both intents and rerun affected
   verification after every resolution.
6. Run the repository's required tests, build, lint, debt scan, end-to-end
   checks, and documentation gates in proportion to risk. Verify the combined
   behavior, not only each branch independently.
7. Do not push, merge a pull request, deploy, or remove material worktrees
   without the authority required by the current task and repository policy.

## Finish the objective

Return:

- objective achieved and material behavior delivered;
- assignments completed, deferred, cancelled, or still blocked;
- branches, worktrees, commits, and artifacts that remain relevant;
- review and verification evidence;
- integration changes made by the manager;
- unresolved risks, decisions, and known test gaps;
- publication, deployment, merge, and cleanup state.

Do not mark the objective complete while required assignments, integration,
verification, or user-authorized publication work remains.

## Host adaptation

Keep this workflow host-neutral. Read `references/host-adapters.md` and use the
current host's native delegation, status, messaging, and interruption
capabilities. If those capabilities are unavailable, use the sequential
fallback instead of pretending a crew is running.
