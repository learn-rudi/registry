# OpenCounter Frontier Stability Contract

## Phase 0: Baseline And Manual Lookup

- Scope: make the documented finite-frontier and two-sweep stability rule an
  executable, provider-free evidence contract.
- Files inspected before editing: the eight-phase source specification,
  OpenCounter README and question reference, scenario-wave planner and
  authorization validator, schema-v3 questionnaire/validation modules,
  adaptive-zoning planner, tests, private Scenario Wave 1 preview, and current
  worktree.
- Relevant SWE guidance: Appendix C behavior-level red-green-refactor; Backend
  G2/G3/G4 explicit business rules, lifecycle, and isolated side effects; Build
  Order Phase 2 explicit operation inputs, outputs, invariants, and failures.
- Current evidence: Phase 2 has an exact 126/126 freeze; Scenario Wave 1 has an
  unexecuted, authorization-required 20-run preview; adaptive zoning has an
  unexecuted provisional 12-candidate preview. Documentation defines
  `branch_frontier_stable_for_manifest(M)`, but no source module can validate
  `M`, one sweep, or the two-sweep claim.
- Risks and invariants: no provider calls; no manufactured authorization; no
  address or parcel data in public fixtures; a cap, partial sweep, novelty, or
  reused authorization/execution evidence must never earn stability.
- Exit criteria: the gap is reproducible in a focused red test and the intended
  contract is bounded enough to implement without provider execution.

## Phase 1: Scope Lock

- In scope: content-addressed finite manifest validation; exact catalog,
  provider, context, finite answer-vocabulary, provenance, cell, limit,
  validity, and source-snapshot bindings; one separately authorized sweep
  report; two-sweep stability evaluation; restrictive private persistence;
  focused synthetic tests and package docs.
- Non-goals: generating a real post-Wave-1 manifest before Wave 1 exists,
  approving or dispatching projects, selecting addresses, determining zoning,
  claiming actual stability, or changing the MCP surface.
- Expected files touched: `src/discovery-frontier-stability.mjs`, its focused
  test, README/question reference, and this record.
- External inputs and trust boundaries: catalog, timestamps, fingerprints,
  fixture/snapshot digests, answer rules, frontier cells, authorization records,
  cell evidence, novelty signatures, and persisted JSON are untrusted and must
  validate exactly.
- Failure behavior: reject extra/missing fields, catalog/provider drift,
  unscoped entries or contexts, open free text, unproven answer rules,
  incomplete vocabulary/cell coverage, excessive caps/depth, expired manifests,
  duplicate or reused authorization/evidence, missing cells, and digest
  tampering.
- Exit criteria: interfaces and claim semantics are documented before source is
  added.

## Phase 2: Red Tests

- Observable behavior: two independently executed, separately authorized,
  complete zero-novelty sweeps of one exact manifest earn only
  `branch_frontier_stable_for_manifest`; one sweep, novelty, incomplete work,
  cap exhaustion, or evidence reuse does not.
- Test file: `test/discovery-frontier-stability.test.mjs`.
- Red command: `node --test test/discovery-frontier-stability.test.mjs`.
- Expected failure: the frontier-stability module does not exist.
- Result: red failed with `ERR_MODULE_NOT_FOUND` for the exact planned module.
- A second red run failed because three sweeps could exceed the manifest total
  volume, and review also exposed that later repeats could erase earlier
  novelty under the same manifest.
- Exit criteria: met.

## Phase 3: Implementation

- Implementation rules: pure builders and strict validators first; persistence
  is isolated; all IDs and digests derive from canonical payloads; no network or
  provider dependency.
- Files allowed to change: the scoped files listed above.
- Validation and error handling: every record is closed, every collection is
  bounded and duplicate-free, cross-links are exact, and all incomplete states
  fail closed to a non-stable status.
- Observability: reports retain raw cell, novelty, authorization, completeness,
  and streak counts rather than only a boolean.
- Implemented strict manifest, sweep, and stability builders/validators plus an
  atomic private artifact store. Aggregate reports retain distinct
  authorization IDs, preview hashes, execution-evidence digests, and provider
  references for independent-sweep auditing.
- Novelty is sticky for the manifest and forces `manifest_version_required`;
  authorized project totals beyond the manifest cap are rejected.
- Exit criteria: met; the unchanged focused command passes 3/3.

## Phase 4: Green Tests And Refactor

- Green command: unchanged focused test.
- Refactor constraints: no behavior changes without a new red case; reuse local
  validation/persistence patterns without widening the public MCP surface.
- Regression checks: scenario-wave, adaptive-zoning, questionnaire, preliminary
  guidance, and validation-maintenance tests.
- Focused result: 3/3 green after both red-green cycles.
- Connected result: the nine-file discovery/guidance set passes 28/28.
- Exit criteria: met.

## Phase 5: Full Verification

- Targeted tests: focused frontier suite and connected discovery/guidance set.
- Full suite: OpenCounter package and registry tests.
- Build/typecheck/lint: registry validate, index sync/check, build, catalog
  hygiene, package dry-runs, syntax and diff checks.
- JS/TS debt scan: edited source/test neighborhood with findings classified.
- Live smoke: provider-free only; a real manifest is intentionally impossible
  until the authorized Wave 1 evidence exists.
- Results: full OpenCounter 124/124; registry 157/157; validation 149/149;
  index sync/check, clean hygiene, and build green. Root and OpenCounter package
  dry-runs pass with 942 and 69 files; the OpenCounter package contains both
  frontier source and test. Syntax, trailing-whitespace, and `git diff --check`
  checks are clean.
- Debt scan: zero errors and one expected orphan warning for the coordinator-only
  module. It intentionally is not part of the MCP entrypoint because evaluating
  private evidence must not be exposed as a provider-dispatch operation.
- Live limitation: no real manifest, sweep, or stability report was created;
  actual post-Wave-1 frontier evidence does not exist yet.
- Exit criteria: met for every provider-free gate.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts: document manifest/sweep/stability meanings and the
  exact boundary between evidence and authorization.
- Final files touched: frontier source/test, OpenCounter README/question
  reference, generated registry index, and this compliance record.
- Commands and results: recorded in Phases 2, 4, and 5.
- Accepted debt: the single intentional coordinator-only reachability warning.
- Definition of Done: the stack can reject false stability claims and is ready
  to evaluate actual post-Wave-1 sweeps without having claimed or executed one.
- Result: provider-free Definition of Done met. The overall eight-phase goal is
  not complete and remains dependent on explicit Wave 1 authorization and its
  resulting empirical evidence.
