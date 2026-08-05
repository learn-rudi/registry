# OpenCounter Master Questionnaire Base

## Phase 0: Baseline And Manual Lookup

- Scope: derive a deterministic, versioned master-questionnaire base from the
  exact 126-observation freeze without calling or mutating OpenCounter.
- Files inspected before editing: the eight-phase source specification,
  observation-freeze validator, observed-question graph, scenario-wave
  contracts, package docs, existing tests, and the registry worktree.
- Relevant SWE manual sections: build order (schema before agents), core input
  validation and versioning rules, and Appendix C red-green-refactor guidance.
- Current-state evidence: the exact freeze contains 126 verified observations,
  93 normalized question signatures, 51 provider question-ID families, and 40
  observed answer transitions. The attachment's 24/126 progress statement is
  historical and no longer authoritative.
- Risks and invariants: observed applicability is not normative applicability;
  missing transitions are unknown, not negative evidence; no address-specific
  artifact may ship in the public registry; provider execution remains gated by
  the separately approved preview digest.
- Exit criteria: scope and evidence boundaries are explicit before code changes.

## Phase 1: Scope Lock

- In scope: one schema-v3 questionnaire artifact, exact freeze/source-snapshot
  validation, canonical question and family IDs, observed applicability,
  incoming conditions, outgoing transitions, evidence timestamps and counts,
  non-exhaustive confidence, tenant/catalog version binding, and a private
  content-addressed store.
- Schema-v3 transition applicability preserves the exact catalog entries,
  zoning contexts, overlays, fixtures, and scenarios that produced every
  observed answer edge. Schema-v2 added terminal classifications; schema-v1
  artifacts remain readable for compatibility.
- Non-goals: provider execution, claiming branch completeness, inventing
  conditions or outcomes, final service-agent orchestration, UI/API exposure,
  zoning-rule inference, or physical-feasibility analysis.
- Expected files touched:
  - `catalog/stacks/opencounter/src/discovery-master-questionnaire.mjs`
  - `catalog/stacks/opencounter/test/discovery-master-questionnaire.test.mjs`
  - package README and catalog-question reference after behavior is green
  - this compliance record
- External inputs and trust boundaries: catalog JSON, freeze JSON, exact source
  ledger snapshots, destination state directory, and persisted questionnaire
  files are all validated before use.
- Failure behavior: reject catalog/freeze drift, missing or extra source
  snapshots, malformed graphs, duplicate IDs, broken family/question links,
  digest mismatch, symlinks, oversized artifacts, and non-private state paths.
- Exit criteria: interfaces and failure behavior are fixed before implementation.

## Phase 2: Red Tests

- Observable behavior: the same verified freeze produces the same versioned
  questionnaire; universal versus conditional classification is based only on
  observed provider-family coverage; an observed answer transition becomes an
  exact condition/outcome pair; absent transitions remain explicitly unknown.
- Test file: `test/discovery-master-questionnaire.test.mjs`.
- Red command: `node --test test/discovery-master-questionnaire.test.mjs` from
  the OpenCounter package.
- Expected failure: the new questionnaire module does not yet exist. Follow-up
  red tests then failed on the absent terminal-classification and
  transition-applicability fields before schema-v2 and schema-v3 were added.
- Exit criteria: the behavior-level test fails for that reason.

## Phase 3: Implementation

- Implementation rules: deterministic canonical ordering, exact input schemas,
  content addressing, no inferred facts, no dependencies, and no provider calls.
- Files allowed to change: the scoped source, test, and documentation files.
- Validation and error handling: every nested persisted shape is bounded and
  checked; all cross-links and summary counts are recomputed; filesystem state
  rejects symlinks and enforces directory `0700` and file `0600`.
- Observability: the artifact records its source freeze, source snapshot
  digests, evidence epoch, catalog/tenant identity, coverage status, and exact
  questionnaire digest.
- Exit criteria: the smallest implementation makes the unchanged red test pass.

## Phase 4: Green Tests And Refactor

- Green command: the unchanged red command.
- Refactor constraints: extract only repeated validation/canonicalization seams;
  do not alter ledger or provider state machines.
- Regression checks: observation portfolio, scenario readiness, and scenario
  wave tests.
- Result: the questionnaire test is green (`2/2`), and the combined
  questionnaire, observation-portfolio, scenario-readiness, scenario-wave,
  and preliminary-guidance regression set is green (`17/17`).
- Exit criteria: targeted and regression tests remain green.

## Phase 5: Full Verification

- Targeted tests: questionnaire behavior, tamper rejection, private persistence,
  and exact-source mismatch.
- Full suite: all OpenCounter tests and registry tests.
- Build/typecheck/lint: registry validation, index synchronization/check, catalog
  hygiene, build, and package dry-run.
- JS/TS debt scan: architecture-aware scan over edited OpenCounter modules.
- Live smoke: generated and read back schema/library-v3 artifact
  `ocmq_95c4d5d1f8d25636efc18447e478d6c56169f7c67577413535df33d2d310e38c`
  from the retained private freeze and exact snapshots. It contains 93
  canonical signatures, 51 provider-ID families, and 40 transitions; all 40
  transitions carry exact use-scoped evidence. The private file is 389,942
  bytes and read-back matched exactly.
- Exit criteria: all applicable gates are green or a precise gap is recorded.
- Result: OpenCounter `npm test` passes (`118/118`); registry `npm test` passes
  (`157/157`); validation passes 149 packages; index sync/check, catalog
  hygiene, build, and package dry-run pass. Structural debt scanning reports
  no errors and one expected orphan warning for this direct-import,
  non-MCP questionnaire library.

## Phase 6: Docs, Contracts, And Closure

- Docs: describe observed-only applicability, confidence, transition knowledge,
  privacy, version binding, and downstream service-agent limitations.
- Final files touched: record after verification.
- Commands run and results: record red, green, regression, debt, build, and smoke
  evidence after execution.
- Accepted debt: none yet; do not claim the first-pass questionnaire is complete.
- Definition of Done: a downstream service agent can consume a validated,
  evidence-bound questionnaire base without mistaking observation absence for a
  rule or using it as authorization to contact the provider.
