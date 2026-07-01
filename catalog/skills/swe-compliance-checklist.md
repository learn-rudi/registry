---
name: RUDI SWE Compliance Checklist
description: Create and execute a RUDI phase-gated engineering checklist for software changes that must comply with the SWE Operating Manual, including scope, tests, proof commands, smoke checks, documentation gates, accepted debt, and Definition of Done
version: 1.0.0
category: coding
icon: ✅
tags: [rudi, swe, compliance, checklist, testing, verification, engineering]
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
- Risks and invariants:
- Exit criteria:

## Phase 1: Scope Lock

- In scope:
- Non-goals:
- Expected files touched:
- External inputs and trust boundaries:
- Failure behavior to define:
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
- Exit criteria:

## Phase 5: Full Verification

- Targeted tests:
- Full suite:
- Build/typecheck/lint:
- JS/TS debt scan, if applicable:
- Live smoke checks:
- Exit criteria:

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
- Final files touched:
- Commands run and results:
- Accepted debt:
- Definition of Done:
```

## Phase Guidance

### Phase 0: Baseline And Manual Lookup

Establish the current state before making claims. Inspect repo instructions, current git state, relevant source files, existing tests, and the SWE manual sections that match the task.

Prefer targeted commands such as:

- `git status -sb`
- `rg --files`
- `rg "<symbol-or-route-name>"`
- `sed -n '<start>,<end>p' <file>`

### Phase 1: Scope Lock

Name the work boundary before editing. Include files expected to change, non-goals, user-visible behavior, invariants, external inputs, and failure behavior. For multi-file work, define interfaces before implementation.

### Phase 2: Red Tests

Create one behavior-level test for the next observable behavior. Run it and record the exact command plus expected failure. Avoid broad speculative test batches.

If automated tests are impractical, define the smallest credible manual or smoke proof and explain the gap.

### Phase 3: Implementation

Make the smallest change that can pass the red test while preserving local patterns. Validate boundary inputs, design failure behavior, avoid stubs, and do not add dependencies unless explicitly justified.

### Phase 4: Green Tests And Refactor

Rerun the red command unchanged and confirm it passes. Refactor only after green, then rerun affected tests.

### Phase 5: Full Verification

Run the verification appropriate to the blast radius:

- targeted tests for changed behavior
- full relevant test suite when feasible
- build, typecheck, lint, or syntax checks for the package
- JS/TS debt scan after editing JS/TS files
- live smoke checks for user-facing workflows or services

### Phase 6: Docs, Contracts, And Closure

Update docs, examples, contracts, manifests, or API references only when behavior changed. Close with a concise proof report that includes files touched, commands run, results, smoke evidence, and accepted debt.

## Definition Of Done

The work is not done until:

- targeted tests pass
- full relevant test suite passes or an explicit gap is recorded
- build/typecheck/lint passes where applicable
- debt scan has no unexplained blocking findings
- live smoke checks prove the behavior when applicable
- docs and contracts match the verified behavior
- final report lists files touched, commands run, results, and accepted debt
