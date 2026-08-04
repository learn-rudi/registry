---
name: rudi-repo-steward
description: Inspect and coordinate continuous improvement across a configured Git repository fleet using safe status scans, bounded leases, and an evidence-backed action ledger. Use when a user asks to catch repositories up, review uncommitted work, plan targeted commits, monitor divergence, or maintain repositories continuously without blindly mutating them.
version: 0.1.0
category: development
tags: [git, github, repositories, continuous-improvement, maintenance]
requires:
  stacks:
    - stack:repo-steward
    - stack:github
---

# RUDI Repo Steward

Operate repository maintenance as a controlled loop: observe, classify,
coordinate, act narrowly, verify, and record evidence. Use Repo Steward for
fleet state and coordination. Use ordinary Git commands only after inspecting
the exact repository and its instructions. Use the GitHub stack for authorized
issue and pull-request work.

## Boundaries

- Treat `stack:repo-steward` as read-mostly coordination infrastructure. Its
  only Git-side mutation is an explicit `git fetch --prune` when that
  repository's configuration permits fetch.
- Do not interpret a clean worktree as permission to commit, push, merge, or
  create GitHub artifacts.
- Do not stage unknown user changes. Never use broad staging such as
  `git add -A` for a targeted checkpoint.
- Do not reset, clean, discard, rewrite, or move work unless the user explicitly
  requests the exact destructive operation and its targets are verified.
- Treat scheduling as host-owned. A poller, launch agent, CI job, or headless
  Codex task may start this skill, but the stack itself does not schedule work.
- Treat GitHub writes as externally visible. Require the user's authorization,
  use `stack:github`, and verify the resulting issue, branch, or pull request.

## Choose the operating mode

- **Observe**: scan and report fleet state; do not fetch unless requested or
  already authorized by the repository policy and current task.
- **Checkpoint**: separate reviewed work into exact, coherent local commits.
- **Improve**: select an approved issue or action, implement it under the
  repository's engineering instructions, and verify it.
- **Publish**: push or create GitHub artifacts only when the user has authorized
  that externally visible step.

Default to Observe when the requested authority is ambiguous.

## Workflow

1. Call `repo_steward_preflight`. Stop on invalid configuration, missing Git,
   or an unavailable state directory.
2. Call `repo_steward_scan_fleet` without fetch. Classify repositories by clean
   or dirty state, staged and unstaged changes, untracked files, upstream
   presence, and ahead/behind counts.
3. If fresher remote metadata is required, request fetch only for repositories
   whose policy permits it. A policy rejection is a boundary, not a reason to
   bypass the stack with a shell command.
4. Propose the next bounded action. Prefer one repository and one concern at a
   time. Distinguish completed work awaiting a checkpoint from incomplete,
   generated, sensitive, or unrelated changes.
5. Acquire the repository lease before recording or executing an action. Keep
   the lease token private and release it when the bounded action ends.
6. Record the action as `proposed`. Transition it with the current version as
   authorization and execution state change. Record `blocked` rather than
   inventing missing authority or repository intent.
7. Before touching files, read the repository's `AGENTS.md` hierarchy, its
   diff, branch/upstream state, and relevant tests or documentation. Preserve
   all unrelated work.
8. For a checkpoint, group only one coherent concern. Stage exact paths, review
   `git diff --cached`, run the repository's required verification, and write a
   commit message describing the observed change. Do not push unless Publish
   mode is authorized.
9. For an improvement, follow the repository's testing doctrine. Record the
   failing behavior, passing verification, refactor verification, and any
   known gaps with `repo_steward_record_verification`.
10. Use `stack:github` for issue, pull-request, check, or review operations.
    Prefer a GitHub issue when work is understood but not authorized or safe to
    implement now. Confirm external writes by reading them back.
11. Mark an action `completed` only after a passing verification is recorded
    and the requested outcome exists. Otherwise leave it proposed, approved,
    running, or blocked with a concise reason.
12. Release the matching repository lease and rescan the repository so the
    final report reflects the actual post-action state.

## Selection rules

Prefer, in order:

1. clean repositories that are only ahead or behind and need an authorized
   synchronization decision;
2. small, clearly coherent reviewed diffs ready for a targeted checkpoint;
3. approved issues with explicit acceptance criteria and practical tests;
4. dirty repositories whose changes can be safely classified without editing.

Defer repositories with unknown ownership, secrets, unresolved conflicts,
large mixed diffs, failing baseline tests, missing instructions, or destructive
cleanup requirements. Report why they were deferred and the smallest next
decision needed.

## Completion report

Report the fleet state observed, repositories changed, exact commits or GitHub
artifacts created, verification evidence, deferred work, and current
ahead/behind state. Never claim a repository is synchronized from stale local
metadata; state whether fetch occurred and whether push was authorized.
