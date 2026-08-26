# Horizontal Engineering And Codebase Stewardship Standard

How an engineering organization preserves repository-wide coherence across
many individually correct changes: detect repeated mechanisms and contract
drift, make the architectural decision explicit, and discharge consolidation
work without turning every feature into an unbounded refactor.

---

## Scope And Vocabulary

A **vertical change** delivers one bounded behavior through its implementation,
tests, documentation, and verification. The ordinary change checklist governs
that work.

A **horizontal concern** appears across changes, modules, packages, or runtime
boundaries. Examples include repeated serializers, receipt builders,
verification loops, publish staging, validation helpers, environment handling,
or multiple implementations of one shared contract.

A **horizontal obligation**, including a consolidation obligation, is an
evidence-backed need to decide whether those implementations should be
consolidated, standardized, intentionally separated, retired, or investigated
further. An obligation is not automatically a mandate to create a shared
library.

A **disposition** records the decision and its evidence. Valid dispositions are:

- no action: the implementations are similar in shape but represent different
  concepts or change independently;
- standardize contract: keep implementations separate behind one explicit
  interface or behavioral contract;
- consolidate implementation: establish one owned implementation and migrate
  consumers;
- retire: remove a superseded or unwired implementation;
- investigate: evidence is insufficient, with the next proof step recorded.

---

## Core Invariants

1. **Repeated code is a signal, not a verdict.** Textual similarity alone does
   not prove that two implementations share one responsibility or lifecycle.
2. **The third semantic implementation triggers review, not automatic
   extraction.** Earlier review is required when divergence threatens security,
   correctness, compatibility, data integrity, or operability.
3. **Feature scope does not expand silently.** A change records a horizontal
   obligation when consolidation is not already required for correctness or
   explicitly authorized.
4. **Accepted duplication is a decision.** Its rationale and reassessment
   trigger are recorded; it is not the absence of a decision.
5. **Consolidation preserves observable behavior before improving structure.**
   Characterization or contract tests precede migration whenever practical.
6. **One shared mechanism has one ownership boundary.** After consolidation,
   callers do not retain shadow implementations that can drift unnoticed.
7. **Runtime requirements are semantic; machine paths are incidental.** A
   supported interpreter or library range may be a valid verification gate. An
   absolute workstation path, moved virtual environment, or accidental local
   executable is provenance and must not become a portable contract.

---

## Detect At The Change Boundary

Every nontrivial change performs a bounded scan of the mechanism it adds or
modifies. The scan asks:

- Does another module already perform the same responsibility?
- Does this create a third semantic implementation of one mechanism?
- Has the same defect or contract mismatch been corrected in multiple places?
- Do related modules serialize, verify, publish, validate, or settle the same
  artifact differently?
- Does the change embed a machine-specific environment assumption in a
  portable artifact or verification gate?
- Will this change make an existing shared abstraction less coherent?

Search neighboring modules, callers, tests, schemas, manifests, and recent
history in proportion to the change's risk. Do not turn the scan into an
unbounded repository audit.

Record one of three results in the change checklist:

1. **No horizontal obligation** — state the evidence briefly.
2. **Resolve in this change** — select and record the applicable disposition
   above. Standardize, consolidate, or retire only when already necessary for
   the requested behavior, required to prevent a correctness or security
   defect, or explicitly authorized after the blast radius is known.
3. **Record an obligation** — preserve the bounded change and schedule a
   repository-level review or remediation task.

For every confirmed concern, record the five-way disposition separately from
the timing outcome above. The disposition says what should happen; the outcome
says whether it is resolved now or carried as an obligation.

---

## Obligation Record

An actionable horizontal obligation records:

- the shared concept or responsibility in domain language;
- exact implementation paths and important symbols;
- callers, consumers, persistence, or artifact contracts affected;
- evidence that the implementations are semantically related;
- observed or plausible divergence and its consequence;
- current disposition and rationale;
- risk, owner, review trigger, and target milestone or cadence;
- verification required before the obligation can close.

Do not use a generic statement such as "deduplicate this later." If the concept,
paths, evidence, and closing proof cannot be named, the obligation is not ready
for remediation.

---

## Repository-Level Review Triggers

Run a horizontal review when one or more of these conditions is met:

- a third semantic implementation is introduced;
- the same defect or manual repair recurs in related modules;
- a shared contract changes and independent consumers must remain aligned;
- a feature batch or release adds several related vertical slices;
- a horizontal obligation reaches its recorded age or milestone threshold;
- an incident, environment failure, or integration review exposes cross-module
  drift.

The repository or host owns scheduling. This standard defines the finite review
contract; it does not authorize a background agent, recurring task, or mutation.

---

## Decide Before Extracting

Prefer consolidation when the implementations represent one stable concept,
must evolve together, share failure semantics, and benefit from one ownership
boundary.

Prefer contract standardization with separate implementations when the concept
is shared but runtime, dependency, performance, deployment, or trust boundaries
require local implementations.

Prefer intentional separation when the implementations only look alike, serve
different domain concepts, change for different reasons, or would become more
tightly coupled through a shared dependency.

Prefer investigation when caller behavior, data contracts, or historical intent
remain unclear. Gather the missing evidence before selecting an abstraction.

No disposition is complete until it identifies the consequence of being wrong
and the proof that would reveal that error.

---

## Remediation Workflow

Horizontal remediation is its own bounded engineering change:

1. Lock the concept, affected paths, non-goals, migration order, compatibility
   window, and failure behavior.
2. Capture existing observable behavior with characterization or contract tests.
3. Define the shared interface and invariants before moving implementations.
4. Introduce the smallest shared mechanism or contract that satisfies the
   proven behavior.
5. Migrate one consumer at a time and rerun the affected tests after each step.
6. Remove or explicitly deprecate superseded implementations; do not leave
   silent shadows.
7. Verify callers, artifacts, failure paths, observability, documentation, and
   rollback behavior across the complete blast radius.
8. Close the obligation with evidence, or record the remaining partial state
   and owner.

If a migration cannot complete safely in one change, define compatibility
behavior and a fail-closed stopping condition. Partial completion must remain
visible.

---

## Integration And Environment Boundaries

Architectural coherence and repository integration are related but distinct:

- Horizontal engineering reviews mechanisms, contracts, abstractions, and
  cross-module behavior.
- Repo Steward or the equivalent repository workflow manages dirty worktrees,
  branches, leases, checkpoints, ahead/behind state, and publication status.
- A horizontal review may report stranded or conflicting implementations, but
  it does not infer permission to stage, commit, merge, retire, or publish Git
  work.

For reproducibility, declare supported runtime and dependency constraints in
portable configuration. Record the executable, environment, and artifact hashes
used for a particular verification as provenance. Reject machine-local paths as
portable verification requirements unless the repository explicitly owns that
fixed machine boundary.

---

## Evidence And Closure

A horizontal review reports:

- candidates examined and the evidence used;
- disposition for each confirmed obligation;
- required remediation order and dependencies;
- accepted duplication with rationale and reassessment trigger;
- verification performed and remaining proof gaps;
- integration work handed to the repository-management workflow.

Useful trend measures include confirmed obligations by age and risk, recurrent
defects across implementations, shared-contract divergence, and time from
obligation creation to verified disposition. Raw duplicate-line counts are
discovery hints, not quality metrics.

---

## Agent-Assisted Operating Contract

The SWE compliance checklist detects and records horizontal obligations at the
change boundary. The `horizontal-engineering-review` skill performs the finite
repository-level assessment and, when explicitly authorized, remediation. The
repository-management workflow owns Git integration state.

Agents must not volunteer an unrelated extraction inside a bounded feature.
They must not ignore evidence of cross-change drift either. The required action
is to make the obligation and its disposition visible at the correct scope.
