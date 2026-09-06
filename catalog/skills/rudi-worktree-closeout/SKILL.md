---
name: RUDI Worktree Closeout
description: Classify an agent-development worktree at a delivery boundary and persist a non-mutating closeout receipt through Repo Steward. Use when accepted, superseded, retained, or archive-candidate work needs explicit lineage, preservation, disposition, and cleanup-approval evidence without changing Git state.
version: 1.0.1
category: code
tags:
  - rudi
  - git
  - worktrees
  - closeout
  - receipts
  - lineage
  - preservation
  - capability:review
requires:
  stacks:
    - stack:repo-steward
---

# RUDI Worktree Closeout

Close a delivery loop by observing one exact worktree, classifying its state,
and recording an immutable, versioned receipt through Repo Steward. This skill
is the closeout contract; Repo Steward owns the durable ledger and transition
engine.

## Boundaries

- This workflow is non-mutating and never performs cleanup. It never stages,
  commits, resets, cleans,
  deletes, prunes, archives, moves, or retires a worktree or branch.
- A cleanup approval reference records authorization only. It does not prove
  that cleanup happened, and this workflow has no cleanup-completed state.
- Preserve dirty, staged, untracked, conflicted, unaccepted, ahead-only, or
  otherwise unresolved evidence. Do not make it clean for the receipt.
- Resolve and record the exact repository and worktree before classifying it.
  A task title, agent report, or clean-looking directory is not authority.
- Never infer acceptance, supersession, archive eligibility, or cleanup
  approval. Record `blocked` when required evidence or authority is absent.

## Workflow

1. Read the applicable repository instructions and the complete
   [receipt contract](references/receipt-contract.md).
2. Run Repo Steward preflight, discover or resolve the exact repository, and
   obtain its current status without fetch unless fresher remote metadata was
   separately authorized.
3. Acquire the repository lease. Keep the lease token private.
4. Create an `observed` receipt from the actual Git state. Include task and
   agent lineage, acceptance lineage when available, validation evidence,
   intended disposition, and every preservation requirement.
5. Classify the receipt from evidence:
   - use `preservation_required` when dirty or unaccepted evidence must remain;
   - use `retained` for continuing work or an intentional durable checkout;
   - use `archive_eligible` only when the contract's fail-closed eligibility
     test passes;
   - use `blocked` when disposition or authority is unresolved.
6. Record each transition with the current receipt version. Treat version,
   lease, validation, or transition failures as stopping conditions.
7. Move `archive_eligible` to `cleanup_pending_approval` only to request a
   separately authorized cleanup workflow. Move to `cleanup_approved` only
   with an explicit approval reference for the exact target and operation.
8. Read the stored receipt back, release the matching lease, and report the
   receipt ID, version, state, disposition, preservation requirements,
   eligibility blockers, approval status, and ledger location.

## Delivery Loop handoff

- The Delivery Coordinator triggers closeout after integration and acceptance
  evidence is available; it does not own the closeout ledger or cleanup.
- The Engineering Gate requires the receipt as closure evidence for each
  material task worktree.
- Coherence Review may identify a cross-change residue risk but does not
  classify, preserve, or clean Git worktrees.
- Repo Steward owns repository discovery, status truth, leases, immutable
  receipt versions, and transition enforcement.

## Host Adaptation

Use the current host's installed Repo Steward tools. Keep host-specific MCP or
connector invocation syntax out of portable plans and receipts. If Repo
Steward is unavailable, stop with a proof gap; do not substitute an ad hoc
mutable file or claim closeout is complete.
