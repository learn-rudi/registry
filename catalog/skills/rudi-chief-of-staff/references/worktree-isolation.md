# Worktree Isolation

Use worktrees to isolate concurrent writers, not as a substitute for task
boundaries. Follow the repository's own worktree manager or naming convention
when one exists.

## Preflight

Before creating a worktree:

1. Resolve the exact Git repository and read its applicable instructions.
2. Inspect the current branch, HEAD, worktree list, and staged, unstaged, and
   untracked state.
3. Choose a known base commit. Do not silently include uncommitted changes from
   the user's current worktree.
4. Validate the proposed branch and absolute worktree path. Keep the path
   inside the user's stated workspace or established worktree root.
5. Confirm that no existing worktree or branch already represents the task.

## Ownership rules

- Enforce one writer per worktree.
- Give each independently integrated task its own branch.
- Give every worker its exact absolute worktree path and require all commands
  to run there.
- Allow multiple read-only workers to inspect the same repository when their
  tools cannot mutate it.
- Do not let two writers concurrently own overlapping files, migrations,
  schemas, generated output, locks, or deployment resources.
- If tasks depend on the same interface, define and integrate that interface
  first or sequence the writers.

## Worker handoff

Require a writing worker to leave one of these auditable outcomes:

- a scoped commit on its task branch;
- an intentionally uncommitted diff when commits were not authorized;
- a no-change report with evidence;
- a partial result with exact remaining work and risks.

Never stage or commit unrelated user changes. Review exact paths and the diff
before accepting a handoff.

## Integration

Use a clean integration worktree when the user's current worktree is dirty or
when multiple worker branches must be combined. Integrate in dependency order.
After each merge or cherry-pick:

1. inspect the resulting diff and conflicts;
2. rerun affected focused checks;
3. update the crew ledger;
4. continue only when the combined state remains understandable.

Run broader verification after all accepted tasks are combined. A branch that
passes alone may fail after integration.

## Cleanup

Treat cleanup as a separate, verified action:

- Confirm the worktree is the exact intended target.
- Confirm it has no staged, unstaged, or untracked work.
- Preserve the branch or commit needed for recovery.
- Never use `--force` to remove a worktree as routine cleanup.
- Do not delete branches, worktrees, or artifacts merely to make status output
  look clean.
- When authority or recoverability is uncertain, report the retained worktree
  and leave it in place.
