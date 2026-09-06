---
name: Set Goal And Execute
description: Turn an explicitly approved brief into a durable active goal and execute it end to end through implementation and verification. Use when the user says "set the goal and execute," invokes $set-goal-and-execute, or unmistakably requests this exact goal-driven execution mode; do not use for planning-only, review-only, or ordinary task requests.
version: 1.0.1
category: agents
tags:
  - rudi
  - goals
  - execution
  - verification
  - authority
  - workflow
  - capability:coordinate
---

# Set Goal And Execute

Convert the user's approved scope into an active goal, then keep working until
the promised outcome is verified, genuinely blocked, or superseded by the user.
This is an execution contract, not a request to restate the brief or stop after
producing a plan.

## Establish The Goal

1. Read the preceding brief, referenced artifacts, and active instructions
   closely enough to identify the intended outcome, success conditions,
   invariants, non-goals, and authority boundaries. Read-only discovery needed
   to make the goal concrete may happen before goal creation.
2. Inspect the current goal state when goal tools are available.
   - If no unfinished goal exists, create one before making task changes.
   - If a matching active goal already exists, continue it; do not create a
     duplicate.
   - If a different unfinished goal prevents creation, preserve it. Do not
     complete or block it merely to replace it. Explain the conflict and request
     direction only if the new request cannot safely be treated as an addition
     or supersession.
3. Write the goal as a concrete outcome with verification criteria and material
   exclusions, not as a vague topic or a list of exploratory steps.
4. Set a token budget only when the user explicitly requested one.

## Execute

- Treat explicit invocation of this skill as authorization to perform normal,
  in-scope implementation work in the current task: inspect, plan, edit local
  files, run tests and diagnostics, create required local artifacts, and update
  directly affected documentation.
- Preserve any narrower instruction in the approved brief, including a
  read-only boundary. If the brief is internally inconsistent or a missing
  choice would materially change the outcome, surface that issue instead of
  inventing authority.
- Use a working plan for multi-step work and keep it current, but do not make
  plan approval an extra gate unless the user requested one.
- Follow all applicable repository instructions and domain skills. For
  behavior-bearing code, use the repository's required red-green-refactor and
  verification workflow.
- Make reasonable, reversible assumptions that keep the work moving. State
  material assumptions when they affect the result.
- Continue through implementation, targeted verification, relevant regression
  checks, and required review. Do not declare success based only on file
  existence, a healthy process, or an unverified implementation.
- Do not silently narrow a broad approved outcome to its easiest first phase.
  Sequence the work into coherent checkpoints while keeping the full goal
  active.

## Ownership And Composition

This skill owns goal establishment, continuity, and honest terminal status. It
does not create another agent runner, engineering standard, repository manager,
or closeout ledger.

Compose the existing RUDI Delivery Loop capabilities when the task needs them:

- use Change Map behavior when the approved outcome still needs a repository
  blast-radius map;
- use the Delivery Coordinator only when the user has requested delegation or
  the task genuinely requires authorized multi-project coordination;
- use the Engineering Gate for phase-gated implementation and proof;
- use Repo Steward for repository and worktree lifecycle state; and
- use Worktree Closeout for required non-mutating delivery receipts.

Do not require every capability for a small task. Each composed workflow keeps
its own authority, source of truth, and completion evidence.

## Keep Authority Gates Separate

This skill does not itself authorize:

- creating commits or tags;
- pushing, opening or modifying pull requests, or merging;
- publishing, deploying, releasing, scheduling, or activating behavior;
- purchases, paid services, or new external accounts;
- sending external messages or making other externally visible changes; or
- destructive actions, cleanup, irreversible migrations, or overwriting
  retained evidence.

Perform one of these actions only when the user has separately authorized that
specific gate. Authorization for one gate does not imply another. Prepare the
work up to an unauthorized gate, verify everything possible locally, and report
the exact remaining action or approval.

## Persist And Stop Correctly

- Keep the goal active while required in-scope work remains. Do not mark it
  complete because one phase passed, the response is long, or the remaining
  work is difficult.
- Exhaust safe in-scope checks and alternatives before calling the goal
  blocked. Follow the host's blocked-status threshold; a first request for
  input or authority is not automatically a blocked goal.
- Mark the goal complete only after every required outcome is implemented and
  the proportionate verification and review gates have passed. If goal tools
  are available, update the goal status explicitly.
- If the user replaces or cancels the objective, stop the superseded work and
  follow the newest instruction without fabricating completion evidence.

## Host Adaptation

Use the current host's native goal read, create, and update surfaces. Keep
host-specific invocation syntax out of portable plans and artifacts. Follow
stricter host rules for goal replacement, completion, blocked status, budgets,
and automatic continuation.

If the host has no durable goal mechanism, keep the objective explicit in the
current task and working plan, and report goal durability as unavailable. Do
not silently substitute a new task, automation, background process, or ad hoc
state file, and do not claim persistence that the host cannot provide.

## Report The Outcome

Lead with the verified result. Include:

- what is now implemented or otherwise accomplished;
- the decisive verification evidence and any known proof gaps;
- the goal's final status;
- commit, publication, deployment, activation, and destructive-action status
  as separate gates when relevant; and
- the precise blocker or next authorization needed if the work cannot yet be
  completed.
