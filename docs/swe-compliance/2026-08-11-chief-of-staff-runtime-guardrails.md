# Chief of Staff Runtime Guardrails

## Phase 0: Baseline And Manual Lookup

**Status: complete**

- Scope: harden the existing `c3be` project-DAG implementation without
  replacing its authority, evidence, routing, or reconciliation model.
- Files inspected before editing: repository instructions; the complete Chief
  of Staff bundle; the project-plan script and tests; the prior orchestration
  ADR/checklist; the canonical Registry scripts; and all relevant worktree and
  branch state.
- Relevant SWE manual sections: Appendix C testing and red-green-refactor;
  Security F5 and F13; Backend G3, G7, G11-G13; and Build Order Phase 5 plus
  the Agents-to-Production gate.
- Current-state commands: `git status -sb`, `git worktree list --porcelain`,
  branch/commit comparison, targeted source reads, and
  `npx vitest run src/project-orchestration.test.ts src/rudi-chief-of-staff.test.ts`.
- Baseline evidence: the detached `c3be` worktree contained the complete
  uncommitted DAG candidate on top of current `origin/main`; its 65 focused
  tests passed. The local canonical `main` checkout is seven commits behind and
  contains extensive unrelated user changes, so it is not a safe writing or
  integration surface.
- Exit criteria: the `c3be` candidate is isolated on
  `codex/chief-of-staff-runtime-guardrails`, unrelated work remains untouched,
  and the applicable operational invariants are explicit.

## Phase 1: Scope Lock

**Status: complete**

- In scope:
  - exact host, provider, model, reasoning profile, selection source, and
    fallback-authorization binding for every model-backed attempt;
  - plan-level elapsed-time/token envelopes with conservative soft checkpoints,
    append-only usage reporting, and a persisted pause decision;
  - a default maximum of one independent review plus one focused confirmation,
    with later review passes gated by an unresolved blocker or explicit
    authorization;
  - durable plan and run activation before the first dispatch for large,
    resumable, dependent, cross-project, or cross-provider work;
  - deterministic `run-init`, `validate-run`, `prepare`, `record-dispatch`,
    `record-termination`, `record-usage`, `record-steering`, and
    `record-archive` commands.
- Interfaces before implementation:
  - Plan records add closed `resourceEnvelope` and `reviewPolicy` objects.
  - Model-backed node host targets declare a closed exact model-selection
    record; prepared attempt bindings freeze the same record.
  - Review nodes declare a closed review kind and optional exception evidence.
  - Run records add append-only usage reports; lifecycle commands accept closed,
    versioned JSON event/request documents and mutate only the canonical run.
  - Provider changes between attempts require a plan-declared fallback
    authorization reference. No failure state implies fallback authority.
  - Hard resource limits force pause; soft checkpoint crossings require pause
    or an explicitly authorized continuation. A paused run cannot prepare work.
- Non-goals: model dispatch inside `project-plan.mjs`; a scheduler, daemon, or
  second orchestrator; changes to host products; dependency additions; or edits
  to unrelated Registry packages.
- Expected files touched:
  - `catalog/skills/rudi-chief-of-staff/SKILL.md`
  - `catalog/skills/rudi-chief-of-staff/agents/openai.yaml` only if stale
  - `catalog/skills/rudi-chief-of-staff/references/host-adapters.md`
  - `catalog/skills/rudi-chief-of-staff/references/project-plan-contract.md`
  - `catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs`
  - `src/project-orchestration-policy.test.ts`
  - focused assertions in `src/rudi-chief-of-staff.test.ts`
  - `docs/adr/0009-chief-of-staff-execution-governance.md`
  - this checklist and generated `index.json`.
- External inputs and trust boundaries: model selectors, fallback and review
  authorization references, resource limits, usage reports, discovery records,
  prepared bindings, native IDs, lifecycle events, timestamps, and CLI paths.
- Failure behavior: reject missing or ambiguous model selection, unapproved
  provider switching, excess review passes, prepare-before-run, prepare while
  paused, hard-limit continuation, soft-checkpoint continuation without an
  authorization reference, illegal lifecycle transitions, duplicates,
  out-of-order events, unknown fields, stale plan revisions, and unsafe files
  without partially mutating run state.
- Exit criteria: the five requested behavior changes have one authoritative
  schema and deterministic command contract before implementation.

## Phase 2: Red Tests

**Status: complete**

- Observable behaviors: exact model binding/no silent provider switch;
  resource-envelope pause; bounded review passes; no preparation before durable
  run activation; and every executable run lifecycle transition.
- Test files: add `src/project-orchestration-policy.test.ts`; keep the existing
  2,457-line orchestration suite stable except for shared schema compatibility.
- Red command: run the individual named Vitest test for each behavior before
  implementing it, then retain the test in the focused policy suite.
- Expected failure: absent plan fields and commands, or the existing validator
  accepting policy-unsafe state.
- Red evidence: each of the fourteen policy behaviors was run by exact Vitest
  name before implementation. Missing-schema cases initially validated when
  they should have failed, and lifecycle cases failed with an unknown command;
  one fixture that first failed at an earlier boundary was corrected before the
  implementation changed.
- Exit criteria: each behavior produces the expected red failure independently.

## Phase 3: Implementation

**Status: complete**

- Implementation rules: Node built-ins only; closed schemas; exact identity;
  deterministic serialization; atomic same-directory replacement; idempotent
  duplicate events; no live discovery, model call, dispatch, steering, stop, or
  archive side effect in the portable script.
- Files allowed to change: the Phase 1 list only unless direct verification
  proves another narrowly related projection artifact is required.
- Validation and error handling: validate the entire candidate run in memory
  before replacing bytes; retain indeterminate dispatches and collision locks;
  do not derive provider fallback from failures; do not use token unavailability
  to suppress elapsed-time checkpoints.
- Observability: every command reports project, run, node/attempt/event identity,
  resulting lifecycle state, and policy decision without secret values.
- Implemented: closed resource, review, model-selection, usage, and lifecycle
  records; deterministic activation and preparation; append-only event
  histories; idempotent duplicate handling; provider-fallback enforcement; and
  pause/review gates. The portable script performs no host side effect.
- Exit criteria: every unchanged red command passes with the smallest policy
  implementation, followed by green-preserving refactor only.

## Phase 4: Green Tests And Refactor

**Status: complete**

- Green command: each exact named red command, followed by the split focused
  suite `npx vitest run --reporter=dot src/project-orchestration*.test.ts src/rudi-chief-of-staff.test.ts`.
- Refactor constraints: preserve the established plan/run authority split and
  isolate parsing, validation, policy calculation, and atomic mutation.
- Regression checks: `node --check` and the three focused suites after refactor.
- Green evidence: nine focused orchestration/skill files passed 81 tests;
  `node --check` and `git diff --check` passed. The original large tests were
  split along policy, reconciliation, archive/lineage, input-safety, and
  cancellation/history seams without changing assertions.
- Exit criteria: policy and legacy orchestration behavior remain green.

## Phase 5: Full Verification

**Status: complete**

- Targeted tests: the three focused Chief of Staff suites.
- Full suite and Registry gates: `npm test`, `npm run validate`,
  `npm run indexes:sync`, `npm run indexes:check`,
  `npm run catalog:clean:check`, and `npm run build`.
- JS/TS debt scan: run the repository debt runner against the edited script and
  policy test, plus `npm run debt:scan` if required by policy.
- Package/skill proof: `npm pack --dry-run --json`, Skill Creator
  `quick_validate.py`, metadata validation/regeneration if stale, and
  `git diff --check`.
- Live smoke: initialize a plan/run, prepare exactly one route, record dispatch,
  usage/checkpoint, steering, termination, reconciliation, and archive state;
  prove no dispatch preparation without run activation, no automatic provider
  switch, and no unbounded review loop.
- Verification evidence:
  - `npm test`: 28 files and 245 tests passed.
  - `npm run validate`: 152 catalog packages passed.
  - `npm run indexes:sync`, `npm run indexes:check`,
    `npm run catalog:clean:check`, and `npm run build`: passed.
  - `npm pack --dry-run --json`: one `@rudi/registry@2.0.0` package with 958
    files was produced successfully.
  - Skill Creator `quick_validate.py`: `Skill is valid!`; metadata was
    regenerated with the canonical generator in an isolated temporary PyYAML
    environment, with no project dependency added.
  - JS/TS debt scan: zero findings across the eleven edited test/contract
    modules after the behavior-seam split. A separate skill-script neighborhood
    scan reports the accepted module-size debt recorded in Phase 6.
  - Smoke command selected eleven CLI-level behaviors spanning activation,
    exact preparation, bounded review, checkpoint pause, dispatch, termination,
    steering, provider fallback, state transition, reconciliation, and archive;
    all eleven passed.
- Exit criteria: every required gate passes with no unexplained blocking debt.

## Phase 6: Docs, Contracts, And Closure

**Status: complete**

- Docs/contracts: update the skill, project-plan contract, host adapters, and
  ADR 0009 to match the verified command/state machine exactly.
- Integration/publication: commit only scoped branch changes; integrate through
  a clean current-main surface so the dirty local `main` checkout is preserved;
  publish the canonical Registry state; run
  `rudi update skill:rudi-chief-of-staff` and
  `rudi skills sync codex --force`.
- Publication evidence: commit `aaedc7c` was pushed from the isolated
  `codex/chief-of-staff-runtime-guardrails` worktree, PR #21 passed all four
  pull-request checks, and merge commit `b52a505` integrated it into canonical
  `main`. The post-merge Registry CI run `31547299689` passed test/build,
  release-provenance, public-readiness, index, catalog, debt, package, all three
  platform validation jobs, and the release job.
- Installed-state evidence: the default unauthenticated raw-GitHub refresh
  returned 404 because `learnrudi/registry` is private. Retrying the same
  `rudi update skill:rudi-chief-of-staff` through RUDI v1.11.0's supported
  `USE_LOCAL_REGISTRY=true` and `RUDI_REGISTRY_ROOT` path against the
  merged-and-CI-proven checkout succeeded. `rudi skills sync codex --force`
  then updated 34 wrappers, including `skill:rudi-chief-of-staff`; the installed
  RUDI bundle and both installed CLI scripts are byte-identical to canonical
  source. Codex's expected wrapper metadata normalization is the only bundle
  diff.
- Accepted debt: `catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs`
  is a 3,743-line, 102-function self-contained CLI and exceeds the Registry
  scanner's generic 800-line/80-function advisory. It has no scanner errors,
  uses Node built-ins only, and is covered by 75 CLI-level orchestration tests.
  Splitting its parser/schema/state-machine boundary is a separate structural
  refactor with materially higher regression risk than this runtime-control
  pass. The prior oversized test warning was resolved through focused splits.
- Definition of Done: all five operational controls are schema-backed,
  executable, documented, smoke-proven, packaged, published, installed, and
  force-synced; every named Registry and debt gate is green; no unrelated user
  change is overwritten.

## Execution Record

- Baseline focused command passed 65 tests before runtime-governance changes.
- Fourteen policy tests failed for their expected missing behavior before the
  corresponding implementation and all passed afterward.
- Focused verification passed 81 tests; full Registry verification passed 245
  tests and every required validation, index, hygiene, build, and package gate.
- The eleven-behavior runtime smoke passed. PR #21 and post-merge Registry CI
  passed, the canonical bundle was installed, and 34 Codex wrappers were
  force-synced successfully.
