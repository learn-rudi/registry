---
name: RUDI SWE Compliance Checklist
description: Create and execute a RUDI phase-gated engineering checklist for software changes that must comply with the SWE Operating Manual, including scope, tests, proof commands, smoke checks, documentation gates, accepted debt, and Definition of Done
version: 1.5.1
category: code
icon: ✅
tags:
  - rudi
  - swe
  - compliance
  - checklist
  - testing
  - verification
  - engineering
  - capability:review
requires:
  stacks:
    - stack:swe-engineering
---

# RUDI SWE Compliance Checklist

## Purpose

Turn an engineering concern into an executable SWE-manual-compliant control plan.

The output is not a loose TODO list. It is a phase-gated checklist that records:

- what will be inspected
- what files may be changed
- what behavior must be proven
- what tests must fail first, then pass
- what build, debt, and documentation checks are required
- what live smoke checks prove the system works
- what accepted debt remains
- what horizontal obligations this change opens, closes, or explicitly accepts
- what risk tier governs review and approval
- what independent evidence supports completion
- what worktree closeout receipt preserves each material task worktree and its lineage
- what commit boundaries, authorization, and publication status make the work reviewable

## When To Use

Use this skill when the user asks for SWE compliance, engineering correctness, proof that a change works, a robust checklist before code changes, or a phase-by-phase execution plan.

Common triggers:

- "Is this engineered correctly?"
- "Is this SWE manual compliant?"
- "Make a robust checklist before we touch code."
- "Show me proof this works."
- "Work through this phase by phase."
- "Create a compliance checklist for this fix."

## Operating Rules

1. Follow active `AGENTS.md` files, repo-local instructions, and explicit user instructions first.
2. Use targeted retrieval from the SWE Operating Manual before guessing. If the `swe-engineering` stack is installed, use its tools: `swe_manual_list` to enumerate documents, `swe_manual_read` to load the index (`10-Engineering-Operating-Manual-Index.md`) and then only the relevant standard or appendix, and `swe_manual_search` to locate sections by phrase. Otherwise use a local manual checkout, starting with its index file. For JS/TS debt scans, prefer the stack's `swe_debt_scan` tool.
3. If the user asks only for a checklist or review plan, do not edit files.
4. If the user asks to execute the checklist, update phase status as work progresses and do not skip proof steps silently.
5. For behavior-bearing code changes where automated tests are practical, use red-green-refactor: write one behavior-level red test, verify the expected failure, implement the smallest fix, rerun green, then refactor only while green.
6. If red tests, smoke checks, full tests, build, debt scan, or docs checks are not practical, state why and record the residual risk.
7. Keep scope tight. Do not add unrelated refactors, dependency changes, or speculative features.
8. Classify risk before implementation and raise the tier if the observed blast
   radius grows. Do not lower risk silently to bypass review.
9. For nontrivial changes, require a read-only review in a fresh context after
   implementation. Supply the task contract, applicable instructions, diff,
   and verification evidence; do not supply private reasoning.
10. For multi-file or medium/high-risk work, plan coherent commit boundaries
    during scope lock. A commit plan does not authorize committing or pushing:
    record that authority separately, stage task-owned paths explicitly, and
    defer publication unless it is authorized.
11. For every nontrivial change, perform a bounded horizontal-pattern scan under
    the Horizontal Engineering And Codebase Stewardship Standard. A third
    semantic implementation or shared-contract drift requires a disposition,
    not automatic extraction. Record an obligation rather than silently
    widening scope unless consolidation is already required for correctness or
    explicitly authorized.
12. When the cause of a failure is unknown, compose `rudi-diagnose` before
    implementation. Its reproduction, first incorrect state, and regression
    case become checklist evidence; random edits do not satisfy Phase 2.
13. Use `rudi-code-review` for the required fresh-context review. Require
    separate Standards, Spec, and Proof verdicts so green commands cannot hide
    a requirement miss or unsupported completion claim.
14. Prototype output is discovery evidence, not production proof. If a
    prototype concept is adopted, map the production blast radius and restart
    red-green verification against the production contract.

## Plan Persistence

When a compliance checklist is meant to be executed, audited, resumed, or attached to a code change, save it in the repository it governs.

Default location:

- Determine repo root with `git rev-parse --show-toplevel`.
- First follow an existing repo convention if there is a clear equivalent such as `docs/plans/`, `docs/engineering/`, `docs/compliance/`, or another established planning folder.
- If no convention exists, create `<repo-root>/docs/swe-compliance/`.
- Name files `YYYY-MM-DD-<short-task-slug>.md`.

Do not create a plan file for a brief answer, one-off review comment, or exploratory discussion unless the user asks to save it. If there is no git repo, use the workspace root only when it is clearly the project root; otherwise ask before creating files.

## Required Checklist Shape

Use this structure unless the user requests a different format:

```markdown
## Phase 0: Baseline And Manual Lookup

- Scope:
- Files to inspect before editing:
- Relevant SWE manual sections:
- Current-state commands:
- Horizontal-pattern scan:
- Risks and invariants:
- Initial risk tier and rationale:
- Exit criteria:

## Phase 1: Scope Lock

- In scope:
- Non-goals:
- Expected files touched:
- External inputs and trust boundaries:
- Failure behavior to define:
- Authorized external actions:
- Commit strategy and authorization:
- Horizontal-obligation disposition:
- Review and approval gates:
- Exit criteria:

## Phase 2: Red Tests

- Observable behavior to prove:
- Test files to add or edit:
- Red command:
- Expected failure:
- Exit criteria:

## Phase 3: Implementation

- Implementation rules:
- Files allowed to change:
- Validation and error-handling requirements:
- Observability requirements:
- Exit criteria:

## Phase 4: Green Tests And Refactor

- Green command:
- Refactor constraints:
- Regression checks:
- Commit checkpoint:
- Exit criteria:

## Phase 5: Full Verification

- Targeted tests:
- Full suite:
- Build/typecheck/lint:
- JS/TS debt scan, if applicable:
- Live smoke checks:
- Independent review:
- Risk-tier approval:
- Exit criteria:

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
- Final files touched:
- Commands run and results:
- Evidence artifacts:
- Independent-review result:
- Commit ledger and publication status:
- Horizontal obligations opened, closed, or accepted:
- Final verdict: ready / needs human decision / failed
- Accepted debt:
- Proof gaps:
- Definition of Done:
```

## Phase Guidance

### Phase 0: Baseline And Manual Lookup

Establish the current state before making claims. Inspect repo instructions, current git state, relevant source files, existing tests, and the SWE manual sections that match the task.

For a nontrivial change, search the mechanism being added or modified across
neighboring modules, callers, tests, schemas, manifests, and recent history in
proportion to risk. Record whether it introduces another semantic
implementation, changes a shared contract, or embeds a portable-environment
assumption. This is a bounded change scan, not an unbounded codebase audit.

Prefer targeted commands such as:

- `git status -sb`
- `rg --files`
- `rg "<symbol-or-route-name>"`
- `sed -n '<start>,<end>p' <file>`

### Phase 1: Scope Lock

Name the work boundary before editing. Include files expected to change, non-goals, user-visible behavior, invariants, external inputs, and failure behavior. For multi-file work, define interfaces before implementation.

Classify the change:

- **Low:** narrow, reversible, no trust-boundary or persistent-contract change.
- **Medium:** user-visible behavior, API/data contract, persistent state, or
  meaningful regression potential.
- **High:** auth, secrets, payments, destructive behavior, migrations,
  production deployment, or difficult rollback.

Record required human approval and rollback expectations before implementation.

For multi-file or medium/high-risk work, name the intended commit slices,
their order or dependencies, and the verification checkpoint for each slice.
Keep behavior, refactors, docs, and generated artifacts separate when that
improves reviewability. For trivial one-file work, a single verified slice is
usually sufficient. Record whether commits and publication are authorized;
planning commit boundaries grants neither authority.

Disposition the timing of any confirmed horizontal concern as: no obligation,
resolve in this change, or record a consolidation obligation for
repository-level review. Separately record the horizontal standard's five-way
decision: no action, standardize contract, consolidate implementation, retire,
or investigate. Use the standard to distinguish shared responsibility from
superficial similarity. Name the concept, exact paths, evidence, risk, owner,
trigger, and closing proof for every recorded obligation.

### Phase 2: Red Tests

Create one behavior-level test for the next observable behavior. Run it and record the exact command plus expected failure. Avoid broad speculative test batches.

If automated tests are impractical, define the smallest credible manual or smoke proof and explain the gap.

### Phase 3: Implementation

Make the smallest change that can pass the red test while preserving local patterns. Validate boundary inputs, design failure behavior, avoid stubs, and do not add dependencies unless explicitly justified.

### Phase 4: Green Tests And Refactor

Rerun the red command unchanged and confirm it passes. Refactor only after green, then rerun affected tests.

When commits are authorized, commit after each coherent green slice when
practical. Stage only task-owned paths and inspect the staged diff before each
commit. Each commit should be independently understandable and preferably
green; do not create an unexplained end-of-task mega-commit for substantial
work. When commits are not authorized, preserve the planned boundaries in the
checklist and leave the work uncommitted.

### Phase 5: Full Verification

Run the verification appropriate to the blast radius:

- targeted tests for changed behavior
- full relevant test suite when feasible
- build, typecheck, lint, or syntax checks for the package
- JS/TS debt scan after editing JS/TS files
- live smoke checks for user-facing workflows or services

Then run an independent read-only review in a fresh context. Review against the
original intent, applicable instructions, diff, and recorded evidence. Fix
deterministic in-scope findings and rerun affected checks. Escalate ambiguous
product or risk decisions.

### Phase 6: Docs, Contracts, And Closure

Update docs, examples, contracts, manifests, or API references only when
behavior changed. Close with a concise evidence bundle containing the task
contract, risk tier, files touched, commands and results, smoke artifacts,
independent-review result, accepted debt, proof gaps, and one verdict:
`ready`, `needs human decision`, or `failed`.

Also record the commit ledger: commit hashes and subjects for completed slices,
or the planned slices that remain uncommitted. State push, pull-request, merge,
and deployment status separately; authorization for one does not imply another.

For every material task worktree, record a `rudi-worktree-closeout` receipt or
an explicit proof gap. The receipt must identify the repository and worktree,
Git state, task and agent lineage, validation and acceptance evidence,
disposition, preservation requirements, cleanup eligibility, approval
reference when present, and timestamp. The receipt is non-mutating and never
proves cleanup occurred.

Record horizontal obligations opened, closed, deferred, or accepted by the
change. Accepted duplication needs a rationale and reassessment trigger; a
generic "deduplicate later" note is not a complete disposition.

## Host Adaptation

- Use the current host's native planning, review, worktree, and subagent
  capabilities when available.
- Otherwise persist the checklist in the repository, use ordinary Git
  isolation, and run independent review in a separate fresh session.
- Keep host-specific invocation syntax outside this portable workflow.
- A host's long-running mode never broadens the user's authority or the active
  sandbox, network, publishing, merge, or deployment boundaries.

## Definition Of Done

The work is not done until:

- targeted tests pass
- full relevant test suite passes or an explicit gap is recorded
- build/typecheck/lint passes where applicable
- debt scan has no unexplained blocking findings
- live smoke checks prove the behavior when applicable
- the required independent review has no unresolved blocking finding
- the risk-tier approval gate is satisfied
- docs and contracts match the verified behavior
- horizontal concerns have an evidence-backed disposition and any remaining
  obligation has an owner, trigger, and closing proof
- substantial work has coherent verified commits, or its planned commit
  boundaries and missing authorization are recorded
- every material task worktree has a read-back closeout receipt, or an explicit
  owner, trigger, and closing proof for the missing receipt
- final report includes the evidence bundle, verdict, and accepted debt
