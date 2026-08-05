# OpenCounter Adaptive Zoning Prioritization

## Phase 0: Baseline And Manual Lookup

- Scope: derive a deterministic, provider-free prioritization preview for
  additional use-by-zone observations from the exact first-pass freeze.
- Files inspected: the eight-phase specification, schema-v3 master
  questionnaire, exact freeze validator, zoning portfolio definition and
  planner, scenario-wave authorization contract, package docs, tests, and
  current worktree.
- Relevant SWE guidance: schema before agent automation; explicit operation
  boundaries and failure behavior; Appendix C behavior-first tests.
- Current evidence: first-pass breadth is 126/126 across 37 base-zone contexts,
  but each use has only one assigned first-pass context. Scenario Wave 1 has a
  provider-free exact preview but has not been explicitly authorized or run.
- Invariants: do not infer normative zoning similarity from zone names; do not
  embed addresses; do not create projects; do not call a preview authorization;
  do not claim saturation before two independently authorized zero-novelty
  complete sweeps of a finite manifest.

## Phase 1: Scope Lock

- In scope: one public address-free sampling policy, deterministic signal
  extraction from exact ledgers/questionnaire, category-pattern comparison,
  first-pass prohibited-result prioritization, zone-stratum diversification,
  hard volume caps, content addressing, and a provisional preview.
- Non-goals: provider execution, parcel selection, site-fact approval, answer
  branching, legal interpretation of zone families, or empirical saturation.
- Expected files: policy JSON; adaptive source module; focused test; README and
  question reference; this record.
- Trust boundaries: catalog, policy, freeze, retained ledger snapshots,
  questionnaire, and timestamps are validated; every source cross-link must
  match exactly.
- Failure behavior: reject catalog/tenant drift, incomplete or duplicate zoning
  strata, missing snapshots, wrong freeze/questionnaire linkage, unknown zones,
  unsupported policy, cap overflow, and any supplied authorization field.

## Phase 2: Red Tests

- Observable behavior: same exact inputs produce the same preview; observed
  first-pass prohibited uses receive higher priority; selected zones exclude
  the use's observed context and diversify across explicit sampling strata;
  the cap is hard; stable/no-signal evidence can yield no candidates; the
  result always says authorization is required and not granted.
- Red command: `node --test test/discovery-adaptive-zoning.test.mjs`.
- Expected failure: missing adaptive-zoning module.

## Phase 3: Implementation

- Implemented a pure planner, strict standalone validator, and restrictive
  content-addressed private store. Zone-family labels are sampling strata, not
  legal equivalence claims.
- Bound policy v1 to tenant 71, tenant version 307, the exact catalog digest,
  exact 37-code/10-stratum taxonomy, fixed signal weights, a maximum of two
  zones per use, 48 total projects, and concurrency two. Caller overrides may
  only tighten volume or scoring limits.
- Source indexing ignores queued/active residual-ledger copies and accepts only
  the same `completed` and `needs_input` observation statuses used by the exact
  freeze. A retained live-ledger duplicate exposed this condition and now has a
  synthetic regression fixture.
- A preview generated before Scenario Wave 1 is explicitly provisional and
  must be regenerated after the prerequisite status is actually observed.
- No dependencies or provider calls.

## Phase 4: Verification And Closure

- Run the unchanged focused test, cross-phase regressions, full OpenCounter and
  registry suites, validation/index/build/package gates, debt scan, and a live
  provider-free smoke against the retained private freeze.
- Red: the first focused run failed because the adaptive module did not exist;
  a later store test failed on its intentionally missing export; the policy
  hardening test failed because a 49-project v1 cap was still accepted.
- Green: `node --test test/discovery-adaptive-zoning.test.mjs` passes 3/3;
  the connected eight-file discovery/guidance regression passes 25/25; the
  full OpenCounter suite passes 121/121; and the registry suite passes 157/157.
- Live provider-free smoke: preview
  `ocaz_c5cb23ada6ee6791f34c8a5953681fada1cf807accbdb37f7b61203a48a24512`
  plans 12 candidates across 6 uses. It is
  `provisional_before_scenario_wave_1`, has `authorizationGranted: false`, and
  records no saturation claim.
- Registry gates: validation passes 149/149 packages; index sync and check,
  clean catalog hygiene, and build pass. Root and OpenCounter package dry-runs
  pass with 938 and 67 files respectively; the OpenCounter package contains the
  adaptive policy, source, and test.
- Debt scan: zero errors, one expected orphan warning for the coordinator-facing
  pure module. It intentionally is not reachable from the MCP entrypoint because
  preview construction is not a public provider-dispatch tool.
- Do not mark adaptive coverage complete until separately authorized runs and
  the finite saturation contract have been executed and verified.
