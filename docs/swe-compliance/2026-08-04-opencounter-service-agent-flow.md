# OpenCounter Preliminary Service-Agent Flow

## Phase 0: Baseline And Manual Lookup

- Scope: add a provider-free, evidence-bound decision flow that consumes the
  packaged catalog and schema-v3 master questionnaire.
- Relevant standards: schema before agents, boundary validation, explicit
  failure behavior, and behavior-level red-green-refactor.
- Invariants: the flow never resolves parcels, invents a use mapping, invents
  an answer, calls OpenCounter, or converts missing observations into zoning
  rules. OpenCounter execution remains separately preview-bound and authorized.
- Exit criteria: every preliminary classification names the exact catalog use,
  questionnaire digest, site evidence, answers, and observed transition path.

## Phase 1: Scope Lock

- Inputs: plain-language idea and address, separately resolved parcel/zoning
  evidence, one or more evidence-backed candidate catalog uses, and
  provenance-bearing requester/site answers.
- Outputs: next local workflow stage, only currently relevant observed
  questions, per-use preliminary assessments, combined classification, and a
  non-executing provider-confirmation recommendation with exact reasons.
- Non-goals: NLP implementation, geocoding, parcel lookup, normative zoning
  rules, physical feasibility, City staff contact, or provider mutation.
- Expected files: one source module, one behavior test, README/reference docs,
  and this record.
- Failure behavior: reject stale catalog/questionnaire bindings, schemas before
  transition-level use provenance, unknown catalog uses/questions/options,
  duplicate answers, ungrounded use mappings/answers, malformed site evidence,
  and unsupported classifications.

## Phase 2: Red Tests

- First behavior: unresolved input stops at local site resolution; resolved
  input with no use stops at use mapping; an exact use/context/answer path can
  return only an explicitly preliminary observed classification.
- The test must also prove that a missing or mismatched transition cannot be
  treated as permission and that no provider call exists in the interface.
- Red command: `node --test test/preliminary-guidance.test.mjs` from the
  OpenCounter package.
- Red result: failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created
  `src/preliminary-guidance.mjs`, as expected.

## Phase 3: Implementation

- Implement the smallest deterministic pure function after the behavior test
  fails for the missing module.
- Validate every external object before evaluation and content-address the
  result for auditability.

## Phase 4: Verification And Closure

- Run the unchanged behavior test, questionnaire/source regressions, the full
  OpenCounter suite, registry gates, and the JS/TS debt scan.
- Document limitations and exact provider-escalation boundary.
- Do not mark the overall eight-phase goal complete; adaptive zoning,
  feasibility, empirical validation, and the unapproved branch wave remain.
- Green result: the unchanged behavior test passes (`3/3`). The combined
  questionnaire, freeze, scenario-readiness, scenario-wave, and service-flow
  regression command passes (`17/17`).
- Implemented boundary: `evaluatePreliminaryGuidance` is deterministic and
  provider-free; every result is content-addressed, and every provider
  recommendation explicitly carries `authorizationGranted: false`.
- Full verification: OpenCounter `npm test` passes (`118/118`) after installing
  its existing lockfile dependencies for the run; registry `npm test` passes
  (`157/157`); validation passes all 149 packages; index sync/check, build,
  catalog hygiene, and package dry-run pass. The reproducible OpenCounter
  `node_modules` verification artifact was removed afterward by the catalog
  hygiene command.
- Debt scan: structural fallback reports four warnings and no errors. The
  questionnaire, preliminary evaluator, combined-assessment, and
  validation/maintenance modules are direct-import orchestration libraries and
  intentionally are not reachable from the MCP server entrypoint; exposing
  them as provider tools is outside this provider-free phase.
