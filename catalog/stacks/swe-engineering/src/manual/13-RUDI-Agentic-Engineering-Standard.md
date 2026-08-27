# RUDI Agentic Engineering Standard

How RUDI agents turn an approved engineering objective into bounded,
evidence-backed delivery without losing authority, repository lineage, or
unfinished work. The executable form is the **RUDI Delivery Loop**.

---

## Scope

This standard composes existing portable skills. It does not create another
agent runner, repository manager, or source of truth. Each capability keeps one
owner and hands immutable evidence to the next gate.

The standard applies to nontrivial agent-assisted changes. A narrow change may
skip optional coordination or repository-wide review when the checklist records
why, but it may not skip authority, scope, proof, or closeout.

---

## Core Invariants

1. **Authority is explicit and does not flow from state.** A clean worktree,
   passing test, accepted worker result, or cleanup-eligible receipt grants no
   permission to commit, publish, install, deploy, archive, or delete.
2. **Current source and lineage precede action.** Resolve the exact repository,
   instructions, live accepted base, worktree, branch or detached state, dirty
   state, and generated-source boundaries before edits.
3. **One capability has one owner.** Coordination, engineering proof,
   architectural coherence, Git lifecycle, and closeout classification do not
   silently absorb one another.
4. **Evidence crosses gates; private reasoning does not.** Handoffs contain the
   task contract, exact source identity, changed paths, verification, accepted
   decisions, risks, and retrievable artifacts.
5. **Dirty or uncertain work is preserved.** Unknown ownership, untracked
   evidence, conflicts, local-only commits, failed validation, or missing
   acceptance blocks cleanup eligibility.
6. **Closeout is non-destructive by default.** A closeout receipt may classify
   work and record approval. It never performs cleanup, and approval must be
   separately exercised and verified by an explicitly authorized workflow.
7. **Stable package IDs are compatibility contracts.** Role labels may improve
   the vocabulary without renaming published skill IDs or breaking existing
   prompts, catalogs, and installed projections.

---

## RUDI Delivery Loop

### 1. Establish Authority And Baseline

Read applicable instructions, resolve current accepted source and base lineage,
inspect Git and worktree state, name external-action boundaries, and preserve
unrelated work. If mutation is approved, use an isolated worktree when required
by repository policy or collision risk.

### 2. Map The Change

The **RUDI Change Map** role is fulfilled by `skill:map-change-impact`. It names
Confirmed, Likely, and Conditional paths, callers, generated outputs,
compatibility decisions, non-goals, ordered actions, and proof before edits.

The Change Map owns blast-radius evidence. It does not coordinate workers,
implement the change, approve scope expansion, or manage Git cleanup.

### 3. Coordinate Delivery When Needed

The **RUDI Delivery Coordinator** role is fulfilled by
`skill:rudi-chief-of-staff`. It decomposes complex objectives into bounded
nodes, sequences dependencies and collision locks, selects execution surfaces,
collects evidence, and triggers the Engineering Gate, Coherence Review, Repo
Steward, and Worktree Closeout at their declared points.

The Coordinator's canonical DAG and acceptance ledger remain distinct from
Repo Steward's local Git-state and closeout ledger. A worker result is an
evidence proposal until the Coordinator accepts it.

### 4. Lock And Execute Engineering Gates

The **RUDI Engineering Gate** role is fulfilled by
`skill:swe-compliance-checklist`. It locks scope, risk, invariants, failure
behavior, test strategy, documentation, commit boundaries, review, accepted
debt, and Definition of Done.

Behavior-bearing implementation follows red-green-refactor. Tests must fail for
the expected missing behavior before implementation, pass without weakened
assertions, and remain green through refactor and full verification.

### 5. Review Cross-Change Coherence

The **RUDI Coherence Review** role is fulfilled by
`skill:horizontal-engineering-review`. It evaluates shared-contract drift,
repeated semantic mechanisms, superseded implementations, and consolidation
obligations. It records one evidence-backed disposition: no action, standardize
contract, consolidate implementation, retire, or investigate.

Coherence Review never owns worktree cleanup, staging, commits, publication, or
repository fleet state. It hands Git integration findings to Repo Steward.

### 6. Integrate Repository State

`skill:rudi-repo-steward` and `stack:repo-steward` own repository discovery,
normalized Git state, bounded leases, action and verification records, and the
durable local closeout ledger. They do not infer authority from a completed
engineering gate or accepted coordination node.

### 7. Close Out Every Material Worktree

The **RUDI Worktree Closeout** role is fulfilled by
`skill:rudi-worktree-closeout`. It classifies the final worktree state, records
lineage and validation, preserves dirty or unaccepted evidence, and identifies
retained, superseded, archive-eligible, or cleanup-pending work.

A material worktree is not closed merely because its implementation passed.
Closeout is complete when a versioned receipt records the disposition and the
remaining worktree state honestly. Actual cleanup is a separate destructive
gate.

---

## Capability Ownership

| Role | Stable package ID | Owns | Must not own |
|---|---|---|---|
| RUDI Change Map | `skill:map-change-impact` | Blast radius, dependencies, compatibility, non-goals, proof plan | Implementation or Git effects |
| RUDI Delivery Coordinator | `skill:rudi-chief-of-staff` | Decomposition, sequencing, routing, acceptance, lifecycle triggers | Engineering policy or Git cleanup |
| RUDI Engineering Gate | `skill:swe-compliance-checklist` | Phase gates, risk, red-green proof, DoD, evidence bundle | Crew routing or worktree deletion |
| RUDI Coherence Review | `skill:horizontal-engineering-review` | Architectural integrity and horizontal dispositions | Git integration or cleanup |
| RUDI Repo Steward | `skill:rudi-repo-steward` | Git/worktree observation, leases, action and closeout ledgers | Automatic destructive cleanup |
| RUDI Worktree Closeout | `skill:rudi-worktree-closeout` | Receipt contract, classification, preservation, cleanup readiness | Performing cleanup or granting approval |

---

## Worktree Closeout Receipt

Repo Steward persists closeout receipts in machine-local RUDI state. Public
Registry artifacts define the contract but never contain machine paths, task
records, or runtime receipts.

Every receipt records:

- schema and receipt version, repository ID, canonical worktree path, remote
  identity, observation time, and lease actor;
- branch, HEAD, base ref and commit, upstream, ahead/behind, and dirty, staged,
  unstaged, untracked, and conflicted counts;
- task, plan/node, agent/host, attempt, and acceptance lineage when available;
- bounded validation evidence with outcome, command, summary, exit code, and
  timestamp;
- classification, disposition summary, preservation requirements, computed
  cleanup eligibility and blockers, and an approval reference when approved.

Receipt versions are immutable. Creation and transitions are lease-bound,
expected-version checked, and idempotent only for an exact replay.

Valid states are:

- `observed`: an exact Git and lineage snapshot exists;
- `classified`: the work is active, superseded, retained, an archive candidate,
  or unknown;
- `preservation_required`: named dirty, unaccepted, or uncertain evidence must
  remain;
- `retained`: the worktree remains intentionally available;
- `archive_eligible`: clean accepted work may be considered for reversible
  archive by a separately authorized host workflow;
- `cleanup_pending_approval`: destructive cleanup is proposed but unauthorized;
- `cleanup_approved`: an explicit approval reference is recorded, but Repo
  Steward still performs no cleanup;
- `blocked`: a named evidence or authority gap prevents disposition.

Illegal transitions, stale versions, invalid refs, missing leases, failed
validation, local-ahead commits, dirty state, preservation requirements, and
missing approval references fail closed.

---

## Compatibility And Evolution

The role labels in this standard do not rename package IDs. Registry derives a
skill ID from its canonical path and provides no first-class alias contract.
Physical renames therefore require a separately approved, tested deprecation
cycle with old-prompt, catalog, resolver, and installed-host coverage.

Generated indexes, release artifacts, RUDI installations, and native host skill
projections are outputs. Change canonical Registry sources, regenerate through
the prescribed commands, and activate or synchronize only under a separate
authorization.

---

## Definition Of Done

An agentic engineering objective is done only when:

- the approved outcome exists within the locked scope;
- targeted and full proof are green or explicit gaps are accepted;
- independent review and horizontal disposition are complete when required;
- docs, contracts, generated outputs, and source versions agree;
- coordinator nodes and handoffs are reconciled;
- every material worktree has a truthful closeout receipt;
- commit, publication, deployment, installation, archive, and cleanup states
  are reported separately; and
- no action beyond current authority is represented as completed.
