# Portable Project-DAG Orchestration

## Phase 0: Baseline And Manual Lookup

**Status: complete**

- Scope: extend the existing `rudi-chief-of-staff` skill with a portable,
  deterministic project-DAG contract and a host-neutral Node.js control script.
- Files inspected before editing: `AGENTS.md`, the complete Chief of Staff
  bundle, its existing tests, relevant Registry catalog/generation code,
  accepted host/artifact ADRs, and prior portable-skill compliance evidence.
- Relevant SWE manual sections: the manual index; Appendix C testing and
  red-green-refactor; Backend state-machine/idempotency rules; Security F13
  agent-output and authority boundaries; Build Order Phase 5 agent gates.
- Current-state commands: `git status --short --branch`, `rg --files`, targeted
  `sed`/`rg` reads, and catalog/package script inspection.
- Risks and invariants:
  - The project plan is the manager-owned system of record; host tasks are
    execution/visibility projections and subagents are temporary workforce.
  - Native task, thread, saved-project, and host identifiers never become
    portable node identity.
  - Run transport state is noncanonical and ignored by Git by default, but is
    retained until reconciliation makes cleanup safe.
  - Project-plan content, paths, titles, summaries, result payloads, Mermaid
    labels, and host observations are untrusted inputs.
  - Existing user changes must remain untouched; the initial worktree was
    clean and detached.
- Exit criteria: applicable contracts, generation paths, trust boundaries, and
  existing test patterns are understood.

## Phase 1: Scope Lock

**Status: complete**

- In scope:
  - `.rudi/orchestration/plan.json`, `graph.mmd`, `decisions.json`, and ignored
    `runs/*.json` layout.
  - Schema-v1 project/run identity, node contracts, status transitions,
    dependency/collision/concurrency readiness, evidence-backed reconciliation,
    archive eligibility, deterministic Mermaid, and fail-closed CLI behavior.
  - Cross-project and cross-host routing with portable locators, capability
    requirements, direct versus isolated-worktree execution, optional starting
    state, explicit handoffs, prepare-before-dispatch bindings, and
    source-to-destination lineage.
  - Codex adapter policy for project discovery/selection, worktree creation,
    explicit visible-task authorization, reconciliation, and reversible archive.
  - Isolated Codex/Claude projection evidence and a temporary sample-project
    smoke test.
- Non-goals: `organization.sqlite`; Codex desktop internals; a new stack,
  daemon, scheduler, or agent runner; changes to `grill-with-docs-loop` or
  `swe-compliance-checklist`; publication, push, PR, merge, deployment, or
  installed global skills.
- Expected files touched:
  - `catalog/skills/rudi-chief-of-staff/SKILL.md`
  - `catalog/skills/rudi-chief-of-staff/agents/openai.yaml`
  - `catalog/skills/rudi-chief-of-staff/references/crew-contract.md`
  - `catalog/skills/rudi-chief-of-staff/references/host-adapters.md`
  - `catalog/skills/rudi-chief-of-staff/references/project-plan-contract.md`
  - `catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs`
  - `src/rudi-chief-of-staff.test.ts`
  - `src/project-orchestration.test.ts`
  - `docs/adr/0008-project-dag-orchestration-boundary.md`
  - this checklist
  - generated `index.json` and ignored `dist/**` only through Registry commands.
- External inputs and trust boundaries: plan/result/run JSON, project and path
  locators, branch/revision selectors, host/capability inventory, native IDs,
  timestamps, summaries/evidence, authorization data, and CLI arguments.
- Failure behavior:
  - Reject unknown fields, oversized or malformed content, unsafe identifiers or
    paths, duplicates, missing dependencies, cycles, illegal transitions,
    stale/conflicting results, authority-expanding claims, missing completion
    evidence, incompatible routes, locator conflicts, and silent fallback.
  - Structurally invalid results do not mutate plan state.
  - An indeterminate dispatch retains its binding/locks for reconciliation and
    is never automatically rebound or retried.
- Exit criteria: portable declarations, run-only transport fields, transition
  ownership, routing transaction, and execution-surface policy are explicit
  before implementation.

## Phase 2: Red Tests

**Status: complete**

- Observable behavior to prove, one red-green increment at a time:
  - plan initialization and strict validation;
  - duplicate IDs, missing dependencies, cycles, malformed paths/content;
  - deterministic dependency/collision/concurrency readiness;
  - safe deterministic Mermaid escaping/rendering;
  - legal transitions and evidence-gated completion;
  - untrusted result validation, reconciliation, and archive eligibility;
  - cross-project/host route compatibility, no-fallback behavior, and
    source-to-destination lineage.
- Test files: `src/project-orchestration.test.ts` and focused additions to
  `src/rudi-chief-of-staff.test.ts`.
- Red command: `./node_modules/.bin/vitest run src/project-orchestration.test.ts` (rerun the
  individual named test while each behavior is introduced).
- Expected failure: the project-plan script and contract do not yet exist, then
  each new assertion fails for the next missing behavior.
- Exit criteria: every behavior-level test is observed red for the expected
  reason before its smallest implementation.

## Phase 3: Implementation

**Status: complete**

- Implementation rules: Node built-ins only; closed schemas; deterministic
  ordering/output; atomic single-file writes; no network, dispatch, archive, or
  host side effects in the portable script.
- Files allowed to change: only the Phase 1 list unless direct evidence requires
  another narrowly related contract/test file.
- Validation and error handling:
  - Plan state owns scope, dependencies, locks, acceptance, and reconciled
    status; result payloads are evidence proposals only.
  - Run state owns attempt/native placement and observed host lifecycle.
  - Host adapters persist a binding/attempt before dispatch and revalidate it
    just in time.
- Observability: deterministic JSON reports include project/run/node/attempt
  correlation without logging secrets or raw private content.
- Exit criteria: the unchanged focused command passes without weakening tests.

## Phase 4: Green Tests And Refactor

**Status: complete**

- Green command: `./node_modules/.bin/vitest run src/project-orchestration.test.ts`.
- Refactor constraints: preserve closed-boundary validation and behavior-level
  tests; do not combine parsing, policy, state mutation, and rendering when a
  small pure boundary is clearer.
- Regression checks: `npx vitest run src/rudi-chief-of-staff.test.ts` and the
  focused orchestration suite.
- Exit criteria: focused suites remain green after any refactor.

## Phase 5: Full Verification

**Status: complete**

- Targeted tests: both Chief of Staff suites.
- Full suite: `npm test`.
- Registry gates: `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, and `npm run build`.
- JS/TS debt scan: `npm run debt:scan`.
- Package proof: `npm pack --dry-run --json`.
- Skill validation: Skill Creator `quick_validate.py` against the catalog bundle.
- Live smoke: initialize, validate, route, render, reconcile, and query archive
  eligibility in an isolated multi-project fixture.
- Cross-host proof: project the bundle into isolated temporary Codex and Claude
  roots, compare the portable payload byte-for-byte, and verify host-only
  metadata behavior without touching installed skills.
- Exit criteria: all gates pass or an explicit accepted-debt record identifies
  a nonblocking external limitation.

## Phase 6: Docs, Contracts, And Closure

**Status: complete**

- Docs/contracts: skill workflow, project-plan schema, crew/result contract,
  host adapters, orchestration-boundary ADR, UI metadata, and this execution
  record match verified behavior.
- Final files touched: the Phase 1 set only; no global skills, installed host
  state, organization database, dependency manifests, or publication state.
- Commands run and results: the execution record below contains exact red,
  green, refactor, smoke, projection, full-suite, generation, debt, build,
  validation, and package evidence.
- Independent review: a fresh-context reviewer receives the task contract,
  final diff, and verification evidence without implementation conclusions.
- Accepted debt: one test-file size advisory plus pre-existing npm audit
  findings, both described below and nonblocking for this contract change.
- Definition of Done: the portable DAG remains distinct from temporary
  subagents and visible tasks; cross-project/host routing is fail-closed and
  lineage-backed; results cannot broaden authority; archive eligibility is
  reconciliation-gated; generated Registry artifacts are canonical; all
  required verification and independent review pass.

## Execution Record

- Grill run `dag0811` resolved state authority, result ingestion, and routing
  transaction questions with isolated Questioner/Answerer/Skeptic roles.
- Red/green increments were observed for the absent script, manager
  cancellation (`Unknown result field: cancellationId`), closed nested run
  state (unexpected resolution), exact duplicate reconciliation (stale plan
  revision rejection), indeterminate retry blocking (`active_attempt` instead
  of `indeterminate_attempt`), mismatched prepared project binding (unexpected
  resolution), and each later reviewer finding. The final review-driven red
  selection was
  `./node_modules/.bin/vitest run src/project-orchestration.test.ts -t
  "retained run transport|outside the canonical|code units|inconsistent with
  dispatch|undeclared media type|immutable snapshot|whole plan|later
  reconciliation supersedes"`; all eight selected behaviors failed for their
  missing policy before implementation and passed afterward. A separate red
  test proved that a canonical-looking run in a different manager project was
  incorrectly accepted; it passed after project-root ownership enforcement.
  The independent re-review then exposed a direct `ready` to `running`
  dependency bypass; the named regression failed by resolving successfully and
  passed after the transition gate began rechecking every dependency.
  A second re-review found that one attempt could own multiple terminal
  reconciliations and make historical lineage match the wrong runtime result.
  Its regression first validated the invalid ledger, then passed after enforcing
  one terminal reconciliation per attempt and exact lineage reference/lifecycle
  matching.
- Focused implementation/refactor proof:
  `./node_modules/.bin/vitest run src/project-orchestration.test.ts
  src/rudi-chief-of-staff.test.ts` passed 61 orchestration tests plus 4 Chief
  of Staff contract tests (65 total). `node --check` also passed after the
  final refactor.
- Skill Creator metadata generation initially failed because PyYAML was absent.
  PyYAML 6.0.3 was installed only into
  `/tmp/rudi-chief-skill-tools.K9jsW8`; the canonical generator then rewrote
  `agents/openai.yaml`, and `quick_validate.py` reported `Skill is valid!`.
- Final repository gates:
  - `npm test`: 21 files and 229 tests passed.
  - `npm run validate`: 152 catalog packages passed.
  - `npm run indexes:sync`: canonical `index.json` and ignored `dist/**`
    regenerated; final catalog hash root begins `7f530cb4b0cadf7c` across 785
    catalog files.
  - `npm run indexes:check`: current.
  - `npm run catalog:clean:check`: zero cleanup targets.
  - `npm run build`: validation and compilation passed.
  - `npm run debt:scan`: zero errors, one accepted warning described below.
  - `npm pack --dry-run --json --cache /tmp/rudi-chief-npm-cache`: passed;
    package size 2,229,460 bytes, unpacked size 10,181,560 bytes, 959 entries,
    shasum `20b85a6d2c624fda90256022da07c71fef475368`.
  - `node --check catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs`
    and `git diff --check`: passed.
- Final sample smoke at `/tmp/rudi-project-dag-smoke.B6I7eM` initialized and
  validated a manager plan, reconciled and accepted a source-host result,
  transitioned the producer to `done`, validated digest-backed lineage, and
  selected `destination-node` only on `project-destination` / `host-destination`.
  Archive reporting correctly kept the non-desktop source attempt ineligible.
- Final isolated projection roots:
  `/tmp/rudi-codex-projection-final.7YFvZT` and
  `/tmp/rudi-claude-projection-final.ogXIgY`. `SKILL.md`, `references/**`, and
  `scripts/**` compared byte-for-byte; only Codex received
  `agents/openai.yaml`; both projections passed `quick_validate.py`.
- Fresh-context Claude review initially returned `REVISE`. The implementation
  then added explicit resolved starting-state bindings, reconcile-only running
  and cancellation edges, latest-attempt result enforcement, capability-first
  host filtering, symlinked-ancestor rejection, and negative/positive tests for
  desktop authorization and dispatched cancellation. A later fresh-context
  Codex review also returned `REVISE`, identifying lifecycle/result mismatch,
  revision-unstable reconciliation and lineage, incomplete canonical layout
  ownership, media-type gaps, locale-dependent ordering, and stale evidence
  documentation. The revised contract now closes the lifecycle matrix, stores
  immutable evidence-contract snapshots, binds lineage to exact accepted plan
  revisions, validates deliverable and handoff media, owns plan/run paths under
  one manager project, sorts by code units, and covers all six findings in the
  63-test focused suite. Independent re-review then found the direct transition
  dependency bypass described above; the red-green fix raised the final focused
  proof to 64 tests. The next review found and closed exact lineage/runtime
  matching; the focused proof is now 65 tests. The independent reviewer then
  returned `PASS`: exact lineage matches the named reconciliation and attempt
  lifecycle, duplicate terminal reconciliations are rejected, the regression
  covers the prior failure, and no adjacent blocker remains.
- Accepted debt: the architecture debt scan warns that
  `src/project-orchestration.test.ts` is 2,457 lines versus the 800-line
  advisory. It is test-only, cohesive around one CLI contract, and has no
  production runtime effect; splitting it is deferred to avoid obscuring the
  review trace during this contract landing. Dependency installation also
  reported eight existing npm audit findings (1 moderate, 6 high, 1 critical);
  no dependency versions were changed and automatic audit fixes were outside
  scope.
