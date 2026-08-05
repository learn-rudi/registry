## Phase 0: Baseline And Manual Lookup

- Status: Complete.
- Scope: Generalize the deterministic OpenCounter question-discovery ledger from
  the 18-run Permanent Residential calibration to one first-pass job for every
  catalog entry, then execute the provider work only after the exact location is
  confirmed.
- Files inspected before editing: the OpenCounter catalog and loader, discovery
  planner, ledger state machine, durable store, question graph, tests, README,
  question reference, manifest, and live MCP tool schemas.
- Relevant SWE manual sections: Master Doctrine Appendix C (behavior-level
  red-green-refactor), Backend G3/G4/G7 (state machines, side effects, bounded
  jobs), and API E7/E9 (mutation idempotency and contract testing).
- Current-state commands: `git status -sb`, focused `rg`/`sed` reads, live
  `opencounter_get_zoning_use_catalog`, and the read-only three-agent audit.
- Risks and invariants: exactly 126 unique catalog entries; one confirmed
  location fixture; exact 126-project authorization; maximum provider
  concurrency two; persist mutation intent before dispatch; never replace an
  uncertain start; stop on catalog/tenant drift or an unapproved answer.
- Exit criteria: packaged and live catalog identity agree, current hard-coded
  residential constraints are identified, and no provider project is created.

## Phase 1: Scope Lock

- Status: Complete.
- In scope: a digest-bound catalog-wide campaign definition, one versioned
  location fixture, exactly 126 stable queued jobs, durable validation, guarded
  dispatch envelopes, same-project recovery, result read-back evidence, tests,
  and matching docs.
- Non-goals: exhaustive answer-branch traversal, invented scenario facts,
  feasibility or buildability analysis, PDF collection, provider UI changes,
  and storing a real address in the public registry.
- Expected files touched:
  - `catalog/stacks/opencounter/catalog/zoning-question-discovery-first-pass.json`
  - `catalog/stacks/opencounter/src/discovery-plan.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger-schema.mjs`
  - `catalog/stacks/opencounter/src/discovery-question-graph.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger-store.mjs` only if dispatch
    persistence requires a store operation
  - `catalog/stacks/opencounter/test/discovery-ledger.test.mjs`
  - OpenCounter README and question reference
  - this compliance record and generated `index.json`
- External inputs and trust boundaries: catalog JSON, campaign JSON, location
  fixture, authorization record, live MCP results, checkpoint questions and
  answers, provider references, timestamps, and durable ledger JSON.
- Failure behavior: reject wrong volume/location/catalog shape; keep unknown
  questions at `needs_input`; known pre-effect failures become `failed`;
  ambiguous post-intent failures become `indeterminate`; recover only the same
  provider project; stop the campaign on tenant or catalog drift.
- Exit criteria: interfaces and allowed files are explicit before behavior code
  changes.

## Phase 2: Red Tests

- Status: Complete.
- Observable behavior to prove: a closed all-catalog definition plus one
  confirmed location and exact authorization produces 126 stable unique queued
  jobs covering every catalog entry and all seven categories.
- Test file: `catalog/stacks/opencounter/test/discovery-ledger.test.mjs`.
- Red command: `node --test test/discovery-ledger.test.mjs` from the OpenCounter
  package.
- Expected failure: the catalog-wide planner/export does not exist or the
  durable schema rejects 126 non-residential jobs.
- Observed red evidence: the planner module was initially missing; subsequent
  focused tests exposed schema-v2 rejection, a v1-only lease assumption,
  missing location auto-answer and verification operations, incorrect
  reconcile-start dispatch, missing dispatch mapping, unsupported provider
  `not_found`, and incorrect continuation-answer provenance.
- Exit criteria: the new behavior test fails for that expected reason.

## Phase 3: Implementation

- Status: Complete.
- Implementation rules: flatten direct and grouped entries by provider display
  order; validate exact catalog identity and count; bind every job hash to the
  full location fixture, empty-answer baseline scenario, campaign, catalog, and
  authorization; do not place a real location in the public definition.
- Files allowed to change: only the Phase 1 list.
- Validation and error handling: closed object shapes, bounded strings and
  arrays, exact digests, exact authorization volume, unique entry/order checks,
  explicit state transitions, and fail-closed provider result handling.
- Observability: retain evidence events, queue/status/error summary, provider
  references, checkpoint digests, and normalized question graph coverage.
- Implemented behavior: catalog-wide planning, schema-v1 compatibility and
  schema-v2 validation, durable leasing and mutation intent, exact MCP dispatch
  envelopes, read-back verification, address-only auto-advance, same-project
  reconciliation, fail-closed provider results, and v2 graph coverage.
- Exit criteria: the unchanged red command passes without weakening the test.

## Phase 4: Green Tests And Refactor

- Status: Complete.
- Green command: `node --test test/discovery-campaign-recovery.test.mjs
  test/discovery-reconciliation.test.mjs test/discovery-ledger.test.mjs
  test/discovery-controller.test.mjs` (27 passed, 0 failed).
- Refactor constraints: preserve ledger state-machine behavior and avoid
  unrelated OpenCounter changes.
- Regression checks: concurrency, lease expiry, checkpoint validation, answer
  provenance, indeterminate recovery, durable tamper detection, graph
  deduplication, and summaries.
- Refactor evidence: input/result validation was extracted to
  `src/discovery-ledger-inputs.mjs`; the oversized ledger test was split into
  focused recovery suites; all 27 focused tests remained green.
- Exit criteria: targeted tests remain green after naming and duplication
  cleanup.

## Phase 5: Full Verification

- Status: In progress. All deterministic gates are complete; the live smoke and
  provider crawl require the confirmed Cincinnati street address.
- Targeted tests: OpenCounter discovery-ledger test file.
- Full suite: OpenCounter package tests, then registry `npm test`.
- Build and catalog gates: `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and
  `npm pack --dry-run --json`.
- JS/TS debt scan: registry runner scoped to edited OpenCounter JS files.
- Live smoke checks: read back the live catalog; after location confirmation,
  start at most two leased jobs, persist/check their provider references and
  checkpoints, then expand only while the invariants hold.
- Results: focused discovery tests 27/27; OpenCounter package tests 60/60;
  registry tests 157/157; validation passed for 147 packages; index sync and
  check, catalog hygiene, build, pack dry-run, diff check, and the scoped
  architecture debt scan all passed. The live catalog matched 126 entries,
  tenant ID 71, tenant version 307, and the pinned catalog digest.
- Packaging proof: the root npm allowlist now includes `.mjs` and `.cjs` stack
  modules; the dry-run pack explicitly contains the first-pass definition,
  planner, controller, dispatcher and their tests. A registry quality-gate test
  protects this ESM packaging contract.
- External blocker: no provider project has been created because no confirmed
  Cincinnati address was supplied. Inventing or substituting an address would
  violate the campaign's location invariant.
- Exit criteria: all automated gates pass and the live run has auditable ledger
  evidence or a precisely recorded external blocker.

## Phase 6: Docs, Contracts, And Closure

- Status: In progress. Contracts and operating documentation are updated; live
  crawl coverage remains pending the address.
- Docs or contracts: document that 126 projects are the first question layer,
  not exhaustive branch coverage; distinguish zoning permissibility discovery
  from later feasibility analysis; document the one-location input and stop
  conditions.
- Final implementation files: campaign definition, planner, ledger schema,
  ledger input validators, ledger state machine, durable store, dispatch
  mapper, controller, question graph, and focused ledger/controller/
  reconciliation tests under `catalog/stacks/opencounter/`.
- Final documentation and generated files: OpenCounter README, catalog question
  reference, this compliance record, and generated `index.json`.
- Commands run and results: all commands and results recorded in Phase 5 passed.
- Accepted debt: the live 126-project crawl and observed question graph are not
  populated until a confirmed address is provided; substantive first-pass
  answers are intentionally absent; any later fresh-project answer branches
  require separate authorization.
- Definition of Done: all 126 use codes have a durable first-pass status and
  every successfully reached substantive provider question is represented in
  the observed question graph; no unknown answer is invented and no uncertain
  project is replaced.
