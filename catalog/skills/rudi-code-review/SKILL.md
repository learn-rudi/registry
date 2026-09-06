---
name: RUDI Code Review
description: Review a completed software change independently against three separate axes—engineering Standards, the approved Spec, and the claimed Proof—and return prioritized, evidence-backed findings without editing by default. Use for pre-merge, pre-release, or high-risk change review when a diff and task contract exist; do not use for initial implementation, generic architecture consolidation, or debugging an unknown cause.
category: code
tags:
  - capability:review
version: 1.0.1
---

# RUDI Code Review

Review what changed, what was promised, and what was proved as independent
questions. A clean style pass cannot compensate for a missed requirement, and
green tests cannot prove an untested claim.

Read [the review contract](references/assessment-contract.md) before reviewing a
medium- or high-risk change.

## Inputs

Require or reconstruct:

- approved task contract, acceptance criteria, non-goals, and risk tier;
- applicable repository instructions, ADRs, public contracts, and standards;
- exact base and head revisions or a bounded unstaged/staged diff;
- changed-file list and generated-source relationships;
- red/green, build, debt, smoke, migration, and other claimed evidence; and
- known gaps, accepted debt, and authorization boundaries.

If the spec is missing, review Standards and Proof but mark Spec unreviewable;
do not infer requirements from the implementation alone.

## Review Axes

### Standards

Inspect correctness, state transitions, input validation, failure behavior,
security, privacy, concurrency, observability, compatibility, dependency
discipline, maintainability, and repository conventions. Read enough caller and
consumer context to distinguish a local change from a broken shared contract.

### Spec

Trace every acceptance criterion to implementation and user-visible behavior.
Check non-goals and authority limits for scope creep. Identify behavior that is
implemented but unrequested, requested but absent, or semantically different
from the approved decision.

### Proof

Trace each material claim to a rerunnable command, artifact, or inspection.
Check that red failures were behavioral, green used unchanged assertions,
negative and failure paths are represented, generated output is current, and
smoke evidence exercises the real boundary it claims. Treat missing, stale,
partial, or non-reproducible evidence as a finding.

## Workflow

1. Confirm the exact review boundary and dirty-worktree state.
2. Read the task contract and applicable instructions before the diff.
3. Inspect the changed files and enough adjacent code, tests, schemas,
   configuration, generated artifacts, and history to understand the contract.
4. Review Standards, Spec, and Proof independently. Do not let a pass on one
   axis bias another.
5. Rank actionable findings by consequence:
   - **P0:** immediate catastrophic or exploit risk;
   - **P1:** blocks acceptance because correctness, security, data, or required
     behavior is materially wrong;
   - **P2:** important defect or proof gap that should be fixed before ordinary
     release;
   - **P3:** bounded improvement that does not invalidate acceptance.
6. For every finding, cite the tightest path and line, explain the concrete
   failure scenario, and state the smallest closing proof.
7. Separate findings from questions, residual risks, and optional suggestions.
8. Return one verdict per axis—`pass`, `revise`, or `blocked`—plus an overall
   verdict. No findings means say so; do not manufacture style comments.
9. If fixes are authorized, hand findings to the implementing workflow. A
   focused confirmation may verify corrections, but it is not a fresh second
   independent review unless policy authorizes one.

## Authority Boundaries

- Review is read-only by default. It does not authorize edits, commits,
  comments, approvals, merges, releases, deployments, or external messages.
- The reviewer must be independent of the implementation reasoning. Receive the
  task contract, diff, instructions, and evidence—not hidden chain-of-thought.
- Do not approve beyond the available evidence or lower risk to bypass a gate.
- Use `horizontal-engineering-review` for repository-wide semantic duplication
  and consolidation; ordinary code review records but does not silently absorb
  that remediation.

## Host Adaptation

Use the current host's diff, file, test, security, and review interfaces. Emit
native inline comments only when the user requested them and the host supports
them. Keep host identifiers and command syntax out of the portable verdict.

## Output

Lead with findings ordered P0–P3. Then return the Standards, Spec, and Proof
verdicts; questions; residual risks; verification inspected or rerun; and the
overall `pass`, `revise`, or `blocked` verdict.
