# OpenCounter Validation And Maintenance

## Phase 0: Scope

- Scope: provider-free empirical scoring of known project read-backs and
  deterministic drift comparison between two validated master questionnaires.
- Inputs remain evidence artifacts. The module does not fetch projects, call
  OpenCounter, authorize reruns, or treat a maintenance plan as execution.
- Metrics must expose counts as well as ratios so zero denominators and small
  samples are not misleading.
- Drift must identify exact added, removed, or changed canonical questions and
  the affected catalog-entry set. Tenant/catalog identity drift requires a full
  refresh recommendation; evidence-only changes may produce a targeted set.

## Phase 1: Red-Green-Refactor

- Red test: validation cases with exact project read-back evidence measure
  question true/false positives/negatives and classification accuracy; a changed
  terminal outcome changes the questionnaire digest and yields a targeted
  affected-use set; identical inputs yield no drift.
- Red command: `node --test test/guidance-validation-maintenance.test.mjs`.
- Expected red: missing `src/guidance-validation-maintenance.mjs`.

## Phase 2: Verification

- Run focused validation/drift tests, cross-phase regressions, full OpenCounter
  tests, registry tests and release gates, and structural debt scanning.
- The exact branch-wave preview remains separately authorization-gated; a drift
  report or rerun recommendation can never authorize provider mutation.
- Red result: failed with the expected missing-module error. The unchanged test
  is now green (`2/2`), and the focused cross-phase regression set passes
  (`22/22`).
- Full verification: OpenCounter tests pass (`118/118`), registry tests pass
  (`157/157`), validation passes 149 packages, and index sync/check, catalog
  hygiene, build, and package dry-run pass.
- Structural debt scan: no errors; four expected non-MCP direct-import library
  warnings; one informational repeated `node:crypto` import signal. Each module
  performs local content addressing, so no new hashing dependency or shared
  mutable façade was introduced.
