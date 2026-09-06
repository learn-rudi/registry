---
name: RUDI Repo Steward
description: Enroll a user-provided folder, discover all nested Git worktrees, and coordinate continuous improvement across that dynamic repository fleet using safe status scans, bounded leases, targeted commits, and an evidence-backed action ledger. Use when a user asks to steward every repo below a path, catch repositories up, review agent work, plan targeted commits, monitor divergence, or maintain repositories continuously without blindly mutating them.
version: 0.3.1
category: code
tags:
  - git
  - github
  - repositories
  - continuous-improvement
  - maintenance
  - capability:review
requires:
  stacks:
    - stack:repo-steward
    - stack:github
---

# RUDI Repo Steward

Operate repository maintenance as a controlled loop: observe, classify,
coordinate, act narrowly, verify, and record evidence. Use Repo Steward for
root discovery, fleet state, and coordination. Use ordinary Git commands only
after inspecting the exact repository and its instructions. Use the GitHub
stack for authorized issue and pull-request work.

## Boundaries

- Treat `stack:repo-steward` as read-mostly coordination infrastructure. Its
  only Git-side mutation is an explicit `git fetch --prune` when that
  repository's configuration permits fetch.
- Treat root enrollment as local scope configuration, not permission to edit,
  commit, push, or publish every discovered repository.
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
- **Closeout**: classify one exact worktree and record its immutable lifecycle
  receipt without changing Git state.

Default to Observe when the requested authority is ambiguous.

## Schedule bounded observation

Treat text after the skill mention as the operating request. Support either
plain language or a compact flag-like form, for example:

```text
$rudi-repo-steward <user-provided-repository-root> --mode observe --every 1m --for 8h
```

When the user supplies a cadence and duration:

1. Resolve the absolute root, operating mode, cadence, start time, and explicit
   end time. Reject a cadence shorter than one minute, a non-positive duration,
   or an unbounded recurring request.
2. Default recurring work to Observe, `fetch_allowed = false`, no file edits,
   no commits, and no external writes. Checkpoint, Improve, and Publish still
   require their normal authority on every affected repository.
3. Use the current host's recurring-task facility to trigger one finite skill
   run per interval. Do not keep an MCP tool call or agent process open for the
   entire monitoring window. In Codex, prefer a thread heartbeat automation;
   in another host, use its native scheduler or an explicitly approved local
   scheduler.
4. Put the absolute root, mode, cadence, and end time in the scheduled prompt.
   Require each trigger to stop without scanning when the end time has passed.
5. On every trigger, rediscover repositories, run preflight, scan without
   fetch, compare with the prior recorded fleet state, and report material
   changes. Use leases so an overlapping trigger skips a busy repository rather
   than competing with another agent.
6. End the schedule at the stated time and produce a final summary of observed
   changes, actions taken, deferred repositories, and remaining divergence.

Scheduling grants permission to observe at the requested cadence; it does not
grant permission to edit, commit, fetch, push, open issues, or create pull
requests.

## Workflow

1. When the user supplies a folder path, call `repo_steward_enroll_root` with a
   concise stable root ID, the absolute path, the current agent identity,
   `fetch_allowed = false`, and a depth that covers the workspace. Repeating
   the same enrollment and policy is safe and idempotent.
2. Call `repo_steward_discover_repositories`. Report the full repository tree,
   discovery exclusions, and failures before acting. Never bypass a depth,
   symlink, cache, dependency, or repository-count boundary with an arbitrary
   shell traversal.
3. Call `repo_steward_preflight`. Stop on invalid configuration, missing Git,
   an unavailable state directory, or an unresolved discovery failure that
   affects the requested repository.
4. Call `repo_steward_scan_fleet` without fetch. Classify repositories by clean
   or dirty state, staged and unstaged changes, untracked files, upstream
   presence, and ahead/behind counts.
5. If fresher remote metadata is required, request fetch only for repositories
   whose policy permits it. A policy rejection is a boundary, not a reason to
   bypass the stack with a shell command.
6. Propose the next bounded action. Prefer one repository and one concern at a
   time. Distinguish completed work awaiting a checkpoint from incomplete,
   generated, sensitive, or unrelated changes.
7. Acquire the repository lease before recording or executing an action. Keep
   the lease token private and release it when the bounded action ends.
8. Record the action as `proposed`. Transition it with the current version as
   authorization and execution state change. Record `blocked` rather than
   inventing missing authority or repository intent.
9. Before touching files, read the repository's `AGENTS.md` hierarchy, its
   diff, branch/upstream state, and relevant tests or documentation. Preserve
   all unrelated work.
10. For a checkpoint, group only one coherent concern. Stage exact paths, review
   `git diff --cached`, run the repository's required verification, and write a
   commit message describing the observed change. Do not push unless Publish
   mode is authorized.
11. For an improvement, follow the repository's testing doctrine. Record the
   failing behavior, passing verification, refactor verification, and any
   known gaps with `repo_steward_record_verification`.
12. Use `stack:github` for issue, pull-request, check, or review operations.
    Prefer a GitHub issue when work is understood but not authorized or safe to
    implement now. Confirm external writes by reading them back.
13. Mark an action `completed` only after a passing verification is recorded
    and the requested outcome exists. Otherwise leave it proposed, approved,
    running, or blocked with a concise reason.
14. Release the matching repository lease and rescan the repository so the
    final report reflects the actual post-action state.
15. On recurring runs, rediscover before scanning. New child worktrees are new
    stewardship candidates; they are not automatically authorized for commit
    or publication.

## Close out a worktree

Use `rudi-worktree-closeout` for the portable decision contract. Repo Steward
owns the durable evidence engine:

1. Resolve the exact configured repository and current status, then acquire its
   lease.
2. Call `repo_steward_record_closeout` to create the `observed` receipt with
   task, agent, acceptance, validation, disposition, and preservation evidence.
3. Transition the receipt with its current version. Dirty or unaccepted work
   must be preserved; archive eligibility fails closed.
4. Use `repo_steward_list_closeouts` to read the stored projection back before
   reporting completion.
5. Release the matching lease.

The stack records `cleanup_pending_approval` and `cleanup_approved` decisions,
but never performs or verifies cleanup. An approval reference is evidence of
authority only. Deletion, pruning, moving, archive side effects, or branch
retirement require a separately authorized mutating workflow.

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
metadata; state whether fetch occurred and whether push was authorized. For
closeout work, also report the receipt ID, version, state, disposition,
preservation requirements, eligibility blockers, and approval reference.
