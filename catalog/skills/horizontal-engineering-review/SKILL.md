---
name: Horizontal Engineering Review
description: Assess repository-wide architectural coherence across multiple changes, assign evidence-backed dispositions to semantic duplication and shared-contract drift, and plan or execute authorized consolidation. Use for horizontal architecture reviews, repeated mechanisms, consolidation obligations, or cross-module drift; do not use for ordinary single-change code review or Git worktree cleanup.
version: 1.1.1
category: code
tags:
  - architecture
  - consolidation
  - codebase-stewardship
  - technical-debt
  - engineering
  - capability:review
requires:
  stacks:
    - stack:swe-engineering
---

# Horizontal Engineering Review

Preserve coherence across individually correct changes. Find mechanisms and
contracts that have drifted across modules, collect enough evidence to decide
whether they should converge, and turn that decision into a bounded obligation
or verified remediation.

## Boundaries

- Default to **Assess** when mutation authority is ambiguous. Assessment and
  planning are read-only.
- Use **Remediate** only when the user has asked to implement the consolidation
  or has approved the resulting bounded plan.
- Repeated lines are a discovery signal, not proof of one abstraction. Confirm
  shared responsibility, callers, lifecycle, failure semantics, and expected
  evolution before recommending consolidation.
- Do not widen an active feature silently. Record a consolidation obligation
  unless the extraction is necessary for that feature's correctness or is
  explicitly authorized.
- Use the SWE compliance checklist for behavior-bearing remediation. Keep its
  red-green loop, evidence bundle, review gate, and authorization boundaries.
- Use Repo Steward or the repository's equivalent workflow for branch,
  worktree, checkpoint, merge, and publication state. This skill does not infer
  Git authority.
- Scheduling is host-owned. A request for a recurring cadence does not itself
  authorize edits, commits, publication, or cleanup.

## Select The Mode

- **Assess:** inspect a repository or bounded subsystem and disposition
  horizontal candidates; make no edits.
- **Plan:** turn confirmed obligations into ordered remediation contracts with
  exact paths, dependencies, risks, and verification.
- **Remediate:** execute one approved obligation, migrate consumers, retire the
  superseded implementation, and verify the full blast radius.

## Orient

1. Resolve the repository root and read applicable instruction files.
2. Inspect Git status before planning work. Preserve unrelated changes and use
   an isolated worktree when paths overlap.
3. Load the SWE manual index and the Horizontal Engineering And Codebase
   Stewardship Standard through `swe_manual_read`. Search the manual only for
   additional standards relevant to the candidate's layer or risk.
4. Load relevant persisted SWE checklists, obligation records, accepted-debt
   entries, ADRs, or the repository's equivalent backlog within the review
   boundary. Reuse their evidence and status instead of rediscovering known
   obligations from code alone.
5. Name the review boundary: recent changes, packages, modules, contract,
   artifact lifecycle, or incident. Do not substitute an unbounded tree dump.

## Detect And Prove Candidates

Search for mechanisms that appear across changes or modules, including:

- serializers, receipt builders, verification loops, publish staging, and
  validation helpers;
- shared schemas or interfaces implemented with divergent behavior;
- the same defect or compatibility repair repeated in multiple paths;
- machine-specific runtime assumptions embedded in portable verification;
- superseded implementations that remain wired or can drift silently.

For each candidate, trace implementation paths, important symbols, callers,
consumers, persistence or artifact contracts, tests, configuration, and recent
history. State why the implementations share one responsibility. If that cannot
be established, classify the candidate as unconfirmed.

The third semantic implementation triggers a review, not automatic extraction.
Review earlier when divergence threatens security, correctness, compatibility,
data integrity, or operability.

## Module And Seam Quality

For confirmed architectural candidates, assess more than duplicate code:

- **Deep module:** does a small stable interface hide meaningful complexity, or
  does the abstraction merely rename its implementation?
- **Seam:** do callers cross one explicit contract, or reach through internal
  state and couple unrelated lifecycles?
- **Leverage:** will one correction improve several consumers that must evolve
  together, or create a dependency between concepts that change separately?
- **Locality:** can a maintainer understand and change one behavior in a bounded
  neighborhood?
- **Deletion test:** after consolidation, can superseded implementations and
  compatibility shadows actually be removed?

Use these as evidence for the existing disposition; they do not create another
scoring system or justify an unrequested refactor.

## Disposition

Assign one evidence-backed disposition:

- **No action:** similar shape, different concept or independent evolution.
- **Standardize contract:** common behavior or interface, separate
  implementations remain justified.
- **Consolidate implementation:** one stable concept should have one owned
  implementation.
- **Retire:** an implementation is superseded or unwired.
- **Investigate:** a named evidence gap prevents a responsible decision.

For every confirmed obligation, record:

- shared concept in domain language;
- exact paths and important symbols;
- callers, consumers, and contracts affected;
- evidence, divergence risk, and consequence;
- disposition and rationale;
- owner, priority, review trigger, and dependencies;
- proof required to close it.

Do not emit "deduplicate later" as an obligation. If the concept, evidence, and
closing proof are missing, keep investigating.

## Remediate An Approved Obligation

1. Create or load the repository's SWE compliance checklist and lock the exact
   blast radius, migration order, compatibility behavior, and non-goals.
2. Add characterization or contract tests for the observable behavior and
   verify the expected red failure for the next migration step.
3. Define the shared interface and invariants before moving implementations.
4. Introduce the smallest shared mechanism or standardized contract that can
   satisfy the proven behavior.
5. Migrate one consumer at a time, rerunning the affected tests after each
   step.
6. Remove or explicitly deprecate superseded implementations. Do not leave
   silent shadow copies.
7. Verify callers, failure paths, artifacts, observability, documentation, and
   rollback behavior across the complete blast radius.
8. Close the obligation with evidence or record the remaining partial state,
   owner, and fail-closed stopping condition.

## Required Output

Report:

- review boundary and evidence inspected;
- candidates with exact paths and evidence level;
- disposition and rationale for each confirmed obligation;
- ordered remediation actions and dependencies;
- verification performed or required;
- accepted duplication and its reassessment trigger;
- unresolved proof gaps and the smallest next decision;
- Git integration work handed to Repo Steward or the repository workflow.

For assessment-only requests, stop after the report. For remediation, stop when
the approved obligation is verified, superseded implementations are retired or
explicitly deferred, and the compliance evidence bundle is complete.

## Host Adaptation

Use the current host's native repository search, planning, review, and
automation capabilities. Keep host-specific invocation syntax out of the
portable output, and never let a long-running or recurring mode broaden the
user's authority.
