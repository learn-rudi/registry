# OpenCounter Combined Legal And Physical Assessment

## Phase 0: Scope And Invariants

- Scope: define a provider-free integration contract that keeps preliminary
  legal permissibility separate from physical feasibility and combines them
  only through explicit classification rules.
- Required physical domains: development envelope; parking, access, loading,
  and circulation; utilities and infrastructure; topography, flood, and
  environmental constraints; and existing-building constraints.
- Invariants: both artifacts identify the same parcel and rollup; every
  physical finding cites retained evidence; missing domain evidence remains
  unknown; neither subsystem overwrites the other; “potentially viable” is not
  City approval, final design, constructability, finance, or underwriting.
- Non-goals: running site-engine, selecting a concept, calculating project
  economics, contacting a provider, or deciding professional-review needs.

## Phase 1: Red-Green-Refactor

- Red command: `node --test test/combined-project-assessment.test.mjs` from the
  OpenCounter package.
- Red result: expected `ERR_MODULE_NOT_FOUND` for
  `src/combined-project-assessment.mjs`.
- Green behavior: five closed evidence domains derive the physical status;
  missing domains fail validation; unknown domains yield insufficient
  information; legal and physical classifications remain separately visible;
  parcel mismatch and content tampering fail closed.
- Green result: combined-assessment and preliminary-guidance tests pass (`6/6`).

## Phase 2: Contract

- `buildPhysicalFeasibilityAssessment` creates a content-addressed assessment
  from exact evidence artifacts, measurements, domain findings, source-system
  identity, parcel identity, and observation time.
- `combineLegalAndPhysicalAssessments` validates both source artifacts and
  derives one of: potentially viable; potentially viable with conditions;
  legal conflict; physical conflict; both conflicts; or insufficient
  information.
- Remaining approvals and risks are mechanically derived from provider
  confirmation and warning/blocker findings. No new approval or risk is
  inferred from prose.

## Phase 3: Verification

- Run the focused tests, the complete OpenCounter suite, registry tests,
  validation/index/build/package gates, and structural debt scan.
- Keep this overall eight-phase goal active: a real physical assessment still
  requires a separately authorized/evidence-backed site workflow, and empirical
  validation and drift maintenance remain.
- Result: focused cross-phase regressions pass (`22/22`); the complete
  OpenCounter suite passes (`118/118`); registry tests pass (`157/157`);
  validation passes 149 packages; index sync/check, catalog hygiene, build,
  OpenCounter package dry-run, and registry package dry-run pass.
- Structural debt scanning reports no errors and four expected direct-import
  library warnings. The questionnaire, preliminary evaluator, combined
  assessment, and validation/maintenance library are deliberately not MCP
  provider tools in this phase.
