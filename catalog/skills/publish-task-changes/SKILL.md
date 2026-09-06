---
name: Publish Task Changes
description: Safely stage and commit only the current task's verified changes, with push and draft pull-request steps only when each endpoint is explicitly requested. Use when the user asks to commit, push, open a PR, or publish the current task from a cleanly attributable diff; do not use merely because implementation finished or when task-owned paths cannot be separated from unrelated work.
category: code
tags:
  - capability:publish
version: 1.0.1
---

# Publish Task Changes

Publish one verified task without absorbing unrelated work. Treat commit, push,
pull request, merge, release, and deployment as separate endpoints and authority
gates.

## Determine The Requested Endpoint

- An unqualified `commit` means stage and create one local commit only.
- `push` adds an upstream push after the local commit.
- `PR` or `draft PR` adds branch push and a draft pull request unless the user
  explicitly requests ready-for-review state.
- Merge, release, deploy, branch deletion, and cleanup require their own
  explicit requests.
- Never infer publication from successful implementation, verification, issue
  state, Decision Frontier promotion, or Chief-of-Staff completion.

## Establish Task Ownership

1. Read active repository instructions and resolve the exact repository,
   branch, base revision, and remote default.
2. Inspect staged, unstaged, untracked, and ignored state. Treat pre-existing
   staged changes as user-owned.
3. Build an explicit task-owned path list from the current task record, impact
   map, compliance record, diff, and generated-source relationships.
4. In a fresh context, infer ownership only when the diff separates into one
   unambiguous concern. Otherwise present candidate paths and stop for
   confirmation.
5. Never equate the whole dirty worktree with the current task.

## Choose Isolation

- If only task-owned changes exist, stage their explicit paths.
- If unrelated changes occupy other files, leave them untouched and stage only
  task paths.
- If one source file has clearly separable mixed hunks, use narrow hunk staging
  and inspect every staged hunk.
- If mixed hunks or generated output cannot be separated safely, create an
  isolated task worktree from the accepted clean base, transfer only task-owned
  source/test/docs changes, and regenerate there.
- Do not stage a mixed generated artifact from the original dirty worktree.

## Verify Before Staging

- Confirm the implementation's required focused and full gates are current for
  the exact files being published.
- Re-run affected proof after any covered file changed.
- Inspect new files for credentials, secrets, private data, caches, logs,
  downloads, generated junk, and accidental large artifacts.
- Confirm generated artifacts match their canonical sources and commands.
- Stop before commit when a required check fails unless the user explicitly
  accepts the exact failure and repository policy permits it.

## Stage And Audit

1. Stage explicit task-owned paths with `git add -- <path>...`.
2. In a mixed worktree, never use `git add -A`, `git add .`, or a broad parent
   directory.
3. Run `git diff --staged --check`, inspect the staged stat, then inspect the
   complete staged diff.
4. Confirm every staged hunk belongs to the task, every required task file is
   present, and unrelated changes remain unstaged.
5. Correct index mistakes without discarding working-tree content, then repeat
   the audit.

## Commit, Push, And PR

- Use a concise conventional subject describing the delivered outcome. Add a
  body for non-obvious rationale, migration, failure behavior, or issue links.
- Create a new commit. Do not amend, squash, rebase, or rewrite history unless
  explicitly requested.
- Verify the new commit and remaining worktree state before any push.
- Push only the exact task branch when requested; never force-push.
- Open a pull request only when requested. Include task contract, risk,
  compliance record, red/green proof, review verdict, accepted debt, and known
  gaps. Link parent plan node and issue IDs when composed.
- Report partial success precisely: a local commit can succeed while push or PR
  creation remains failed or unauthorized.

## Composed Delivery

- Under `rudi-chief-of-staff`, publication is a downstream node or explicit
  authority gate. The plan records accepted evidence; Git remains the source of
  repository history.
- Under `rudi-swe-issue-loop`, use the issue and PR links as projections of the
  same task contract. Issue state does not replace plan acceptance.
- After accepted integration, hand the exact worktree and lineage to
  `rudi-worktree-closeout`. Publication does not authorize cleanup.

## Authority Boundaries

- Invoking this skill does not itself authorize a commit, push, PR, merge,
  release, deploy, force operation, branch deletion, or cleanup.
- Never expose or modify credentials to make publication succeed.
- Never reset, checkout, clean, stash, force-push, or overwrite user work unless
  the user explicitly authorizes the exact operation and target.
- Stop when ownership, base revision, generated output, required proof, or
  publication endpoint is ambiguous.

## Host Adaptation

Use the current host's Git, repository, and pull-request interfaces. Prefer a
connected provider tool for PR creation when it covers the requested operation,
and use the provider CLI only as a bounded fallback. Keep host invocation syntax
and native IDs out of the portable publication record.

## Output

Return the requested and reached endpoint, branch, commit hash and subject,
pushed remote, PR link and state when applicable, verification used, committed
paths, unrelated changes left behind, partial failures, and remaining merge,
release, deploy, cleanup, or closeout gates.
