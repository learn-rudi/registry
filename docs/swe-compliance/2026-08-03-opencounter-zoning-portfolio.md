## Phase 0: Baseline And Manual Lookup

- Status: Complete.
- Scope: Revise the 126-use OpenCounter discovery campaign from one address to
  a zoning-representative address portfolio without increasing the authorized
  provider-project count.
- Files inspected before editing: current campaign definition, catalog-wide
  planner, ledger schema and transitions, durable store, controller, question
  graph, tests, README, catalog reference, and live OpenCounter/Dwellow schemas.
- Relevant SWE manual sections: Master Doctrine Appendix C7A, Backend G3/G4/G7,
  and API E7.
- Current-state evidence: Cincinnati's official zoning code and official CAGIS
  zoning layer establish the district taxonomy; Dwellow location search and
  parcel-key lookup produced 37 Cincinnati address candidates with canonical
  address, parcel, zoning, boundary hash, and evidence reference.
- Risks and invariants: exactly 126 provider projects; every catalog use once;
  all 37 selected zoning contexts represented; maximum concurrency two; no
  substantive answer invented; all real addresses remain outside the public
  registry; uncertain provider effects reconcile the same project only.
- Exit criteria: the changed sampling unit and authoritative location evidence
  are explicit before implementation.

## Phase 1: Scope Lock

- Status: Complete.
- In scope: a new schema-v3 zoning-portfolio campaign, a public definition with
  no addresses, a private versioned 37-location portfolio, deterministic
  balanced assignment of 126 use codes to those locations, zoning-context graph
  coverage, backward compatibility for schema-v1/v2 ledgers, tests, and docs.
- Non-goals: all 4,662 use-by-zone combinations, overlay-combination coverage,
  substantive project assumptions, feasibility/buildability analysis, PDF
  export, and more than 126 provider starts.
- Expected public files touched:
  - `catalog/stacks/opencounter/catalog/zoning-question-discovery-zone-portfolio-first-pass.json`
  - `catalog/stacks/opencounter/src/discovery-zoning-portfolio.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger-schema.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger.mjs`
  - `catalog/stacks/opencounter/src/discovery-question-graph.mjs`
  - `catalog/stacks/opencounter/test/discovery-zoning-portfolio.test.mjs`
  - OpenCounter README and question reference
  - this compliance record and generated `index.json`
- Private execution file: a mode-0600 portfolio beneath
  `/Users/hoff/.rudi/state/opencounter-discovery/`; it is not catalog content.
- External inputs and trust boundaries: municipal-code district taxonomy,
  CAGIS layer metadata, Dwellow search results, parcel-key fact sheets, private
  portfolio JSON, catalog JSON, authorization, OpenCounter results, and time.
- Failure behavior: reject missing/duplicate/unverified zoning contexts,
  non-Cincinnati locations, unexpected observed zoning, wrong authorization,
  catalog drift, malformed provider checkpoints, ambiguous address matches, or
  unsupported answers before any unsafe continuation.
- Exit criteria: interfaces, compatibility boundary, and allowed files are
  fixed before behavior code changes.

## Phase 2: Red Tests

- Status: Complete.
- Observable behavior: a validated 37-location portfolio plus exact 126-project
  authorization produces 126 stable jobs, covers every catalog entry once,
  assigns every zoning target at least once, binds each start to its assigned
  address, and retains zoning context in the observed question graph.
- Test file: `catalog/stacks/opencounter/test/discovery-zoning-portfolio.test.mjs`.
- Red command: `node --test test/discovery-zoning-portfolio.test.mjs`.
- Observed failures: the schema-v3 planner was initially missing; after its
  first implementation the existing validator rejected schema v3 and the
  graph attempted to read a schema-v1 property profile. Live smoke failures
  then exposed duplicate-label provider matching, street abbreviation/casing,
  unavailable-summary recovery, and a missing controlled pre-effect retry.
  Recovery tests subsequently failed because an HTTP 403 page was inspected
  as guidance state and because the ledger had no fenced way to requeue an
  already-indeterminate same-project start reconciliation after read-only
  proof that provider HTML access recovered.
- Exit criteria: the behavior test fails for that reason.

## Phase 3: Implementation

- Status: Complete.
- Implementation rules: preserve schema-v1/v2 behavior; use a distinct schema
  version and campaign identity; hash the exact portfolio and assignment; keep
  public definitions address-free; carry expected and observed zoning context
  into each job and graph observation.
- Files changed beyond the initial Phase 1 list: provider contract, Playwright
  driver, focused provider tests, address normalizer, and extracted guidance
  question observer. These became necessary after the bounded live smoke
  exposed deterministic provider-boundary defects.
- Validation and error handling: closed shapes, bounded strings/arrays, exact
  catalog and tenant identity, unique addresses/parcels/location IDs/zoning
  targets, deterministic ordering, exact zone matching including explicit
  observed suffixes, and existing fail-closed mutation handling.
- Observability: campaign portfolio digest, per-job location evidence, zoning
  context on graph nodes/edges, provider references, checkpoints, errors, and
  queue summaries, known preflight failures, same-project indeterminate state,
  and provider HTTP diagnostics.
- Implemented behavior: schema-v3 closed validation and stable identities;
  balanced 37-context assignment; zoning-aware graph nodes and edges; exact
  street matching across provider formatting; slug/path disambiguation for
  duplicate use labels; read-only summary-to-location fallback; and a one-time
  controlled retry for the proven pre-project ambiguity failure. Provider HTTP
  failures are now rejected before DOM interpretation, and one digest-bound
  same-project `reconcile_start` may be requeued after the explicit
  `provider_html_access_restored` recovery condition; replacement starts remain
  impossible.
- Exit criteria: the unchanged red command passes.

## Phase 4: Green Tests And Refactor

- Status: Complete.
- Green commands: `node --test test/discovery-zoning-portfolio.test.mjs` and
  `npm test` from the OpenCounter package.
- Refactor constraints: do not rewrite the provider adapter or alter legacy
  ledger identities.
- Regression checks: v1/v2 validation, concurrency, location answer matching,
  read-back verification, uncertain start/continuation reconciliation, durable
  round-trip, tamper rejection, graph deduplication, provider-use matching,
  address observation, and summary/location read-back.
- Results: 70/70 OpenCounter tests passed. The guidance DOM observer was
  extracted from the Playwright driver, reducing that module below the
  repository's 800-line debt threshold. The final scoped debt scan reported
  zero findings.
- Exit criteria: focused tests remain green after cleanup.

## Phase 5: Full Verification

- Status: In progress. Deterministic gates and the same-project recovery smoke
  are complete; the remaining 125 provider jobs have not been launched.
- Targeted tests: all OpenCounter discovery tests.
- Full suite: OpenCounter package tests and registry tests.
- Build/catalog gates: validate, index sync/check, catalog hygiene, build, pack
  dry-run, diff check, and scoped JS debt scan.
- Live smoke: initialize the private ledger, lease at most two jobs, dispatch
  exact provider starts, read back each result, and queue only exact address
  matches before expanding.
- Deterministic results: OpenCounter 70/70; registry 157/157; validation 147
  packages; index sync/check, catalog hygiene, build, and pack dry-run passed;
  the package contains the portfolio definition, planner, normalizers,
  observer, and focused tests; scoped debt scan found 0 issues.
- Live results: the live catalog still matched tenant 71, version 307, all 126
  entries, and the pinned digest. The private mode-0600 ledger
  `ocdl_7cb0784d5701762c7c6377c10a7037adc4687df0313b777657c6dba797771d3e`
  was initialized with 37 contexts and concurrency two. The first dispatched
  use failed in the read-only catalog preflight before project creation; its
  one controlled retry is queued after the slug-disambiguation fix. The second
  dispatch created `opencounter:project:2820051`, returned indeterminate, and
  remained bound to same-project reconciliation. Diagnostics isolated the
  initial HTML denial from the working catalog API and verified that the saved
  project and encrypted session survived. One explicit
  `provider_html_access_restored` retry re-established only that exact project,
  and authoritative read-back verified a three-question checkpoint containing
  the exact provider address match plus `home_occ` and `existing_use`. The
  requester approved that exact address match and the versioned baseline
  answers `home_occ=No` and `existing_use=No`. The continuation response was
  unusable, so it was not replayed; same-project read-only reconciliation and
  authoritative read-back verified the terminal result instead.
- Durable status after completion: 125 queued, 1 completed, 0 active,
  0 needs input, 0 indeterminate, and 0 failed. The completed observation found
  **Composting facilities** prohibited in **Institutional-Residential (IR)**,
  subject to final City staff approval. The observed graph contains three
  question signatures and three approved answer edges: provider address match,
  `home_occ=No`, and `existing_use=No`. Exactly one provider project is known
  to have been created; no replacement project was started.
- Controlled continuation: the recovered provider access then admitted the
  queued pre-effect retry for **Refuse storage areas** at the assigned **SF-20**
  context. Start and authoritative read-back agreed on one checkpoint containing
  the exact provider address match and `existing_use`; no answer was inferred.
  The requester then approved the exact address match and `existing_use=No`.
  The continuation timed out after dispatch and was not replayed; same-project
  reconciliation found the accepted answers and authoritative read-back
  verified **Permitted with Limitations** for **Refuse storage areas** in
  **Single-family Residential (20,000 sf lots) (SF-20)**, subject to final City
  staff approval. Current durable status is 124 queued, 2 completed, 0 active,
  0 needs input, 0 indeterminate, and 0 failed. The graph now contains four
  question signatures and four answer edges. Two provider projects are known
  to have been created in total, with no blind replacement start.
- Two-run worker-pool check: the requester authorized reusable baseline
  `requester-campaign-baseline-v1`, limited to an exact single address match
  against the assigned verified location plus `existing_use=No` and
  `home_occ=No`; every other required question remains a stop. Two runners then
  leased one project each at maximum concurrency two. **Cemetery incidental
  buildings and structures** completed as **Permitted** in **SF-4** after an
  uncertain continuation was reconciled and read back on the same project.
  **Parking facilities** in **SF-6** stopped at the new required question
  `accessory_use` without submitting partial answers. Current durable status is
  122 queued, 3 completed, 1 needs input, 0 active, 0 indeterminate, and 0
  failed. The graph contains seven question signatures and five answer edges.
  Four provider projects are known to have been created in total; no blind
  replacement start occurred.
- Zoning-context audit and recovery: terminal read-back revealed that two
  completed projects were evaluated in provider zoning different from their
  assigned base contexts. A full official CAGIS parcel-polygon audit then found
  16 unsafe or mixed fixtures in the original 37-location portfolio. New-start
  leasing was fenced, all eight existing projects were preserved, and all 16
  fixtures were replaced with unique City parcels whose complete polygons
  intersect only compatible base zoning (same-base suffixes allowed).
- Residual campaign: private portfolio v3 and schema-v4 residual ledger
  `ocdl_35f57b7851e3f389faf6833000b65211341d660ed1976c402929d591343c85af`
  were created for exactly the 118 catalog entries with no source
  `start_dispatch_started` evidence. The unused v2 portfolio and residual
  ledger had zero provider starts and were moved intact to the private
  `superseded/` directory. Source and residual catalog jobs have zero overlap.
- Current residual results: 16 residual start intents produced 16 provider
  projects. Eleven are completed and authoritatively read back, five stopped at
  unapproved substantive questions without partial answers, 102 remain queued,
  and none are active, failed, or indeterminate. Completed classifications now
  include `Prohibited`, `Conditional`, `Permitted`, and `Permitted with
  Limitations`. Across
  the preserved eight source projects plus the residual campaign, durable
  coverage is 126 unique catalog entries: 16 completed, 8 needs input, and 102
  queued. Twenty-four provider projects are known in total, with no blind
  replacement.
- Current observed library: the two ledgers contain 37 unique normalized
  question signatures, 20 unique answer edges, and 14 unique provider question
  IDs. Newly observed required facts include a 5,000-square-foot threshold,
  more than two rooming units, on-site incinerated material, and outdoor-storage
  screening by a six-foot privacy fence and barrier. Banks and financial
  institutions also introduced drive-through and 15,000-square-foot threshold
  questions. These remain requester-input questions.
- Drift/residual red-green evidence: the full OpenCounter package now contains
  89 passing tests. Registry tests remain 157/157; validation, index sync/check,
  catalog hygiene, build, pack dry-run, and the package-scoped structural debt
  scan pass with zero findings.
- Duplicate-label recovery: the provider's five-result label search omits the
  exact `Accessory Uses` catalog entry even though a full catalog-path query
  returns its exact slug and fingerprint. A red-green fix now propagates that
  verified full-path query into both initial UI selection and same-project
  reconciliation. The corrected package was installed; the old MCP child was
  explicitly identified and stopped so the router could reload it. Project
  `2820167` then completed as `Prohibited` in `CN-P` and passed read-back.
- Worker affinity: the first two-worker batch exposed a race in which a queued
  continuation could be leased by the other worker. No duplicate provider call
  occurred, but ownership was ambiguous. A red-green `prepareJobDispatch`
  transition now leases only the requested queued non-start job. Subsequent
  batches retained exact worker/job ownership through continuation and
  reconciliation.
- Exit criteria: all deterministic gates pass and live evidence is durable.

## Phase 6: Docs, Contracts, And Closure

- Status: In progress. Docs and contracts are complete; live coverage is not.
- Docs/contracts: distinguish 126 pairwise first-pass observations from the
  4,662-combination exhaustive matrix; explain base zones versus overlays and
  the later adaptive expansion policy.
- Final files touched: campaign definition, portfolio planner, ledger schema and
  transitions, durable store, graph builder, provider boundary normalizers and
  observer, focused tests, README, catalog reference, generated indexes, and
  this record. Real addresses and the durable ledger remain private RUDI state.
- Commands run and results: recorded in Phases 2, 4, and 5.
- Accepted debt: the 126-job campaign is pairwise base-zone sampling, not the
  4,662-project exhaustive matrix. The remaining provider volume and any
  substantive answer fixtures require explicit operational authorization;
  browser compatibility must not be treated as provider permission.
- Definition of Done: all 126 authorized projects have durable first-pass
  statuses, all 37 portfolio contexts were exercised, every observed question
  is graph-indexed with zoning context, and no unknown answer or replacement
  project was invented.

## 2026-08-04 Late-Result Recovery Addendum

### Phase 0: Baseline And Manual Lookup

- Scope: recover an original catalog-bound start result that becomes available
  only after its 15-minute worker lease expires.
- Files to inspect before editing: discovery ledger transitions, durable store,
  controller, controller/recovery tests, and this compliance record.
- Relevant SWE manual sections: Testing Appendix C, Debugging Appendix D, and
  Backend G2-G5, G7, and G9.
- Current-state evidence: two persisted start intents outlived their leases;
  encrypted session bindings prove that provider projects `2820332` and
  `2820334` belong to the two exact original provider-input digests.
- Invariants: never create a replacement project; never accept a late result
  without the original dispatch identity, expired lease identity, non-null
  provider reference, and matching durable job state.
- Exit criteria: the failure boundary and legal recovery transition are
  reproduced by a deterministic test.

### Phase 1: Scope Lock

- In scope: one explicit late-result state transition, durable-store/controller
  wiring, focused tests, installation of the verified package copy, and live
  recovery of the two surviving projects.
- Non-goals: timeout redesign, questionnaire expansion, provider retries,
  unrelated refactors, or changes to the two-project concurrency limit.
- Expected files touched: `src/discovery-ledger.mjs`,
  `src/discovery-ledger-store.mjs`, `src/discovery-controller.mjs`, focused
  discovery tests, this record, and the matching installed stack files after
  verification.
- External boundary: late OpenCounter output remains untrusted and must pass the
  existing bounded result validator before changing durable state.
- Failure behavior: reject early, mismatched, missing-reference, duplicate, or
  wrong-dispatch late results without clearing the original recovery evidence.
- Exit criteria: interfaces and guards are fixed before implementation.

### Phase 2: Red Tests

- Observable behavior: an exact result for an expired post-intent start can be
  persisted against that same job and emits a read-back request; a result before
  expiry remains illegal.
- Test file: `test/discovery-controller.test.mjs`.
- Red command: `node --test test/discovery-controller.test.mjs` from the
  OpenCounter package.
- Expected failure: the controller/store expose no late-result transition.
- Exit criteria: the new behavior-level test fails for that missing operation.

### Phase 3: Implementation

- Add a separately named late-result transition; do not weaken the ordinary
  active-lease guard.
- Reuse the existing result normalization and state-application logic.
- Record explicit late-recovery evidence and require the expired original lease,
  mutation intent, dispatch request, worker, token, and provider reference.
- Exit criteria: the red test passes with no alternative start path.

### Phase 4: Green Tests And Refactor

- Green command: unchanged Phase 2 command.
- Refactor constraint: extract only shared result-application logic required to
  keep normal and late transitions behaviorally identical.
- Regression checks: discovery ledger, controller, reconciliation, and campaign
  recovery tests.
- Exit criteria: targeted tests remain green after any extraction.

### Phase 5: Full Verification

- Targeted tests: OpenCounter package discovery tests.
- Full suite/build: repository-required test, validation, index, catalog-clean,
  build, and pack dry-run gates.
- Debt scan: package-scoped structural scan for edited JS files.
- Live smoke: bind each surviving provider project to its original digest,
  persist its result, perform provider read-back, and verify zero active or
  unintended indeterminate jobs.
- Exit criteria: deterministic gates and live durable evidence pass.

### Phase 6: Docs, Contracts, And Closure

- Update this addendum with red/green commands, final file list, live results,
  and any accepted debt.
- Definition of Done: both late results are safely recorded without replacement,
  their provider read-backs match, and the campaign can resume from its next
  authorized queued jobs.
- Status: complete for the late-result recovery change; the enclosing 126-use
  live campaign remains in progress.
- Red evidence: `node --test test/discovery-controller.test.mjs` failed 6/7 with
  `controller.recordLateDispatchResult is not a function`.
- Green evidence: the unchanged controller command passed 8/8 after the guarded
  transition and active-lease rejection test were present. The discovery
  neighborhood passed 54/54 and the full OpenCounter package passed 91/91.
- Registry evidence: `npm test` passed 157/157; `npm run validate` passed all
  147 packages; index sync/check, catalog-clean check, build, and
  `npm pack --dry-run --json` all passed.
- Live smoke: encrypted binding digests mapped provider projects `2820332` and
  `2820334` to their exact original start intents. Both expired results were
  recorded and verified without replacement. Project `2820332` stopped at the
  unapproved owner-occupied/guest-room question; approved baseline answers
  advanced `2820334` to a verified `Prohibited` result. A subsequent single
  start created `2820383`, read back its five-question checkpoint, and stopped
  at unapproved arterial-street and 15,000-square-foot facts.
- Durable campaign status after smoke: residual ledger 12 completed, 7 needs
  input, 99 queued, and zero active, failed, or indeterminate; 27 of 126 catalog
  entries now have verified first observations across source and residual
  ledgers.
- Final files for this change: discovery ledger, durable store, controller,
  controller test, OpenCounter README, installed stack copies of the three
  runtime modules, and this compliance record.
- Accepted debt: the architecture-aware scan has zero errors and one warning:
  `discovery-ledger.mjs` is 857 lines against the 800-line threshold. The module
  was already at the threshold boundary before this recovery and splitting the
  state machine during live campaign recovery would widen risk; extract its
  result-transition seam in a separate red-green change.

## 2026-08-04 Authoritative Checkpoint Expansion Addendum

### Phase 0: Baseline And Manual Lookup

- Scope: reconcile an unverified start checkpoint when immediate authoritative
  read-back returns a strict superset of the same unanswered questions.
- Evidence: project `2820422` returned address, arterial-street, and
  15,000-square-foot questions from start; read-back added `existing_use` and
  produced a different checkpoint digest. No answer was dispatched.
- Relevant doctrine: Testing Appendix C, Debugging Appendix D, and Backend
  G2-G5 state/side-effect discipline.
- Invariants: same provider project; unverified `needs_input` job; no queued
  action; every provisional question is byte-equivalent in the read-back;
  read-back adds at least one question; no answer or provider mutation.
- Exit criteria: deterministic reproduction fails because the verifier rejects
  every checkpoint digest mismatch.

### Phase 1: Scope Lock

- In scope: one guarded verification-time strict-superset reconciliation,
  focused controller coverage, documentation, installed runtime parity, and
  live recovery of project `2820422`.
- Non-goals: accepting removed or changed questions, terminal-result drift,
  answering any checkpoint, provider retries, or unrelated refactors.
- Expected files: discovery ledger, controller test, README, this record, and
  the installed ledger copy after verification.
- Failure behavior: changed, removed, reordered-with-changes, already verified,
  queued, or non-`needs_input` state continues to fail closed.

### Phase 2: Red Tests

- Observable behavior: authoritative read-back may replace one unverified
  provisional observation only when its questions are a strict unchanged
  subset of the read-back; the reconciled checkpoint is then verified.
- Test file: `test/discovery-controller.test.mjs`.
- Red command: `node --test test/discovery-controller.test.mjs`.
- Expected failure: `opencounter_discovery_verification_checkpoint_mismatch`.

### Phase 3: Implementation

- Keep ordinary exact-match verification unchanged.
- Add a narrow strict-superset guard and replace only the matching provisional
  observation/checkpoint before recording verification.
- Emit explicit `provider_read_back_checkpoint_reconciled` evidence.

### Phase 4: Green Tests And Refactor

- Rerun the unchanged red command, then all discovery tests.
- Refactor only if required to preserve identical exact-match behavior.

### Phase 5: Full Verification

- Run the full OpenCounter suite, architecture-aware debt scan, registry tests,
  validation, index sync/check, catalog hygiene, build, and pack dry-run.
- Live smoke: record project `2820422`'s four-question read-back and verify zero
  active/indeterminate jobs and no residual zoning drift.

### Phase 6: Docs, Contracts, And Closure

- Update README and this addendum with commands, live result, final files, and
  accepted debt.
- Definition of Done: project `2820422` is durably verified at the fuller
  checkpoint without any answer or replacement project, and incompatible
  mismatches still fail closed.
- Status: complete for strict-superset checkpoint reconciliation; the enclosing
  Phase 2 campaign remains in progress.
- Red evidence: `node --test test/discovery-controller.test.mjs` failed 8/9 at
  `opencounter_discovery_verification_checkpoint_mismatch`.
- Green evidence: the unchanged controller command passed 9/9. The test also
  proves that adding a question while changing an existing prompt remains
  rejected and leaves the provisional checkpoint unverified. All discovery
  tests passed 55/55.
- Live smoke: project `2820422` adopted checkpoint
  `c517b1940664b5800e51fa87d1e774900394c0debcd5255628100b570f6ddf23`
  with address, existing-use, arterial-street, and 15,000-square-foot questions;
  verification and reconciliation evidence are durable, with zero answers
  supplied and no replacement project.
- Durable status after recovery: residual ledger 12 completed, 16 needs input,
  90 queued, and zero active, failed, or indeterminate; 36 of 126 entries have
  verified first observations across source and residual ledgers.
- Final files: discovery ledger, controller test, README, installed ledger and
  README copies, and this compliance record.
- Full verification: OpenCounter passed 92/92; registry passed 157/157;
  validation passed all 147 packages; index sync/check, catalog hygiene, build,
  and pack dry-run passed.
- Debt scan: zero errors and one accepted warning. The discovery ledger is now
  892 lines against the 800-line threshold; extract verification/result
  transitions in a separate change after the live campaign is stable.

## 2026-08-04 Summary Save-Modal Recovery Addendum

### Phase 0: Baseline And Manual Lookup

- Scope: recover one already-mutated OpenCounter continuation whose summary
  route is covered by the provider's exact optional `Skip for now` save modal
  and whose completed summary intentionally omits a main `H1` and zoning
  classification heading.
- Files inspected before editing: Playwright driver, summary parser/exporter,
  discovery retry state machine, focused driver/recovery tests, README, durable
  reconciliation state, and this record.
- Relevant SWE manual sections: Testing Appendix C, Debugging Appendix D, and
  Backend G2-G5.
- Current-state evidence: project `2820523` accepted the approved address and
  `existing_use=No` continuation, then continuation, two result reads, and a
  same-project reconciliation all timed out waiting for `main h1` on the
  summary route. A read-only, exact-user-agent browser inspection proved HTTP
  200 with 11 visible `H2`-through-`H4` summary headings, including Waste
  transfer, T3E-P, parcel `023300040142`, and the exact address, but no `H1` or
  provider classification statement.
- Invariants: never replay the continuation; never create a replacement;
  dismiss only one exact visible `Skip for now` button; retain strict UI-drift
  failure for ambiguous controls; never infer a missing classification; require
  authoritative read-back afterward.
- Exit criteria: deterministic tests reproduce the modal, heading-hierarchy,
  multi-locator, and retry-fence failures before implementation.

### Phase 1: Scope Lock

- In scope: extract the existing bounded modal dismissal, apply it before
  summary parsing, accept the provider's observed bounded heading hierarchy,
  add focused regression tests, permit one same-project continuation
  reconciliation retry after read-only recovery proof, install the verified
  source, and reconcile project `2820523`.
- Non-goals: broad navigation refactors, invented zoning classification,
  automatic provider retries, timeout increases, replacement projects, or new
  substantive answers.
- Expected files touched: `src/summary-export.mjs`,
  `src/playwright-driver.mjs`, `src/discovery-ledger.mjs`, their focused tests,
  README, this record, and matching installed stack copies after verification.
- External boundary: provider HTML remains untrusted; zero or one exact button
  is accepted, more than one fails closed, and at least one attached summary
  heading is still required before bounded interpretation.
- Failure behavior: missing summary headings after modal dismissal remain a
  timeout/UI failure. Only an unchanged same-project `reconcile` containing the
  exact uncertain continuation may be retried once after explicit HTML recovery
  proof; start-reconciliation module reload behavior is unchanged.
- Exit criteria: observable behavior and file boundary are fixed before code.

### Phase 2: Red Tests

- Observable behaviors: dismiss one exact modal before parsing; read a valid
  completed summary that has `H2`-through-`H4` but no `H1`; select the first
  element before Playwright single-element wait/visibility operations; and
  requeue one unchanged same-project continuation reconciliation after HTML
  recovery.
- Test files: `test/playwright-driver.test.mjs` and
  `test/discovery-campaign-recovery.test.mjs`.
- Red commands: `node --test test/playwright-driver.test.mjs` and
  `node --test test/discovery-campaign-recovery.test.mjs`.
- Red evidence: the modal test failed 14/15 because the exact save prompt was
  still visible; the heading test failed 14/15 on the hard-coded `main h1`;
  the multi-heading test failed 14/15 because `.isVisible()` was called on the
  non-singular locator; and the recovery test failed 7/8 at the existing
  start-only retry guard.
- Exit criteria: each failure is observed at the intended missing behavior.

### Phase 3: Implementation

- Extract the existing exporter modal guard into one named helper.
- Call it before summary parsing as well as PDF export.
- Preserve exact selector, count guard, visibility check, and hidden wait.
- Treat `main h1, main h2, main h3, main h4` as the bounded provider summary
  hierarchy and use its first element for singular Playwright operations.
- Preserve `classification: null` when no provider classification heading
  exists.
- Extend only the first HTML-recovery retry to unchanged schema-v2
  continuation reconciliation; keep module-reload retry start-only.
- Add no dependencies, timeout changes, answer replay, or alternate projects.
- Exit criteria: unchanged red commands pass.

### Phase 4: Green Tests And Refactor

- Green commands: both unchanged Phase 2 commands.
- Green evidence: driver tests passed 15/15 after each selector correction;
  campaign recovery passed 8/8; the OpenCounter package passed 93/93 after the
  added recovery case.
- Refactor constraint: only deduplicate the modal guard and name the two exact
  reconciliation shapes.
- Regression checks: the full OpenCounter package test suite.
- Exit criteria: targeted and package tests remain green.

### Phase 5: Full Verification

- Run repository tests, validation, index sync/check, catalog-clean check,
  build, pack dry-run, and the architecture-aware JS debt scan.
- Live smoke: install byte-matching source, re-read/reconcile only project
  `2820523`, record the result through the existing dispatch identity, and
  verify zero active/failed/indeterminate residual jobs and zero zoning drift.
- Exit criteria: deterministic gates and live durable evidence pass.

### Phase 6: Docs, Contracts, And Closure

- Update README and this addendum with red/green commands, final files, live
  result, installed parity, and accepted debt.
- Definition of Done: project `2820523` is authoritatively resolved without
  continuation replay or replacement, the modal regression is covered, all
  required gates pass, and Phase 2 can resume.
- Live proof: a fresh `opencounter_get_guidance_result` returned completed for
  project `2820523` with address `1501 Cedar Avenue`, land use `Waste transfer`,
  parcel `023300040142`, zoning `T3E-Parking Zone (T3E-P)`, and
  `classification: null`. One guarded retry dispatched
  `opencounter_reconcile_guidance`, returned the identical bounded result, and
  received an independent matching provider read-back.
- Durable proof: job
  `ocdj_bfefa1ce3405952f5908cd3b75b3ac1222cfeef912e5f9a1da2f34e173c92c80`
  is completed with no lease or pending mutation and durable
  `same_project_reconciliation_retry_queued`, `reconcile_completed_observed`,
  and `provider_read_back_verified` evidence. Residual state is 26 completed,
  32 needs input, 60 queued, and zero active, failed, indeterminate, or zoning
  drift.
- Full verification: OpenCounter passed 93/93; registry passed 157/157;
  validation passed all 147 packages; build, index sync/check, catalog hygiene,
  and pack dry-run passed. The compiled catalog hash root is
  `31ed16070b67f627...`. Source and installed summary parser, Playwright driver,
  discovery ledger, and README have matching SHA-256 digests.
- Debt scan: zero errors and one accepted warning. `discovery-ledger.mjs` is 899
  lines against the 800-line threshold; splitting the live state machine during
  campaign recovery would widen risk, so the previously recorded extraction
  debt remains deferred to a separate red-green change.
- Final files: summary exporter, Playwright driver, discovery ledger, focused
  driver and recovery tests, README, generated registry indexes, installed
  runtime/README copies, and this compliance record.
- Status: complete for project `2820523` recovery; the enclosing Phase 2
  campaign remains in progress.

## 2026-08-04 Incomplete Summary Guard Addendum

### Phase 0: Baseline And Manual Lookup

- Scope: prevent an active questionnaire's incomplete `/apply/summary` shell
  from being interpreted as a terminal zoning result.
- Evidence: project `2820561` had a verified four-question checkpoint while its
  summary route exposed only `Project Details`; the hierarchy-only gate returned
  completed with null address, zoning, and land use.
- Relevant doctrine and invariants: Testing Appendix C, Debugging Appendix D,
  Backend G2-G5; no answer before read-back, no terminal result without semantic
  zoning evidence, and no inferred fields.
- Exit criteria: reproduce the false terminal interpretation deterministically.

### Phase 1: Scope Lock

- In scope: require Location, Zoning District, and Land Use Code headings in
  both result-read readiness and summary parsing; retain optional
  classification.
- Non-goals: new provider navigation, inferred classifications, answer changes,
  timeout changes, or replacement projects.
- Files: summary exporter, Playwright driver/test, README, installed parity,
  and this record.
- Failure behavior: incomplete summary read-back falls back to the existing
  project location/questionnaire route; direct parse fails closed.

### Phase 2: Red Tests

- Observable behavior: a visible summary containing only `Project Details`
  returns the live questionnaire checkpoint instead of a completed result.
- Red command: `node --test test/playwright-driver.test.mjs`.
- Red evidence: 14/15 passed; the new case entered `parseSummary` and failed
  because it attempted modal inspection instead of location fallback.

### Phase 3: Implementation

- Add one pure semantic heading predicate and share it across readiness and
  parsing.
- Require exact normalized Location, Zoning District, and Land Use Code
  headings; keep the existing bounded hierarchy, modal guard, and optional
  classification behavior.
- Add no dependencies or new mutations.

### Phase 4: Green Tests And Refactor

- Green command: unchanged Phase 2 command.
- Green evidence: driver tests passed 15/15.
- Refactor constraint: one shared predicate only; no navigation rewrite.

### Phase 5: Full Verification

- Run the full OpenCounter and registry suites, validation, build, index
  sync/check, catalog hygiene, pack dry-run, debt scan, and installed parity.
- Live smoke: project `2820561` returned its original four-question checkpoint
  after deployment; it was verified and stopped at unknown
  `barge_facilities` without any answer dispatch.
- Exit criteria: all deterministic gates and live proof pass.

### Phase 6: Docs, Contracts, And Closure

- README now documents the three required semantic headings and questionnaire
  fallback.
- Definition of Done: incomplete summaries cannot become terminal observations,
  live checkpoint read-back matches, no lifecycle residue remains, and all
  required gates pass.
- Full verification: OpenCounter passed 93/93; registry passed 157/157;
  validation passed all 147 packages; build, index sync/check, catalog hygiene,
  and pack dry-run passed. The final catalog hash root is
  `db74bebc8944d241...`, and source/installed parser, driver, discovery ledger,
  and README digests match.
- Debt scan: zero errors and the same accepted 899-line discovery-ledger
  warning; no new debt finding was introduced by this guard.
- Campaign proof after resumption: project `2820561` is verified needs-input at
  `barge_facilities`; projects `2820566`, `2820573`, and `2820575` are verified
  completed without continuation replay after read-only timeout recovery.
  Residual status is 29 completed, 33 needs input, 56 queued, and zero active,
  failed, indeterminate, or zoning drift.
- Status: complete; the enclosing Phase 2 campaign remains in progress.

## 2026-08-04 Portal Start-Control Render Addendum

### Phase 0: Baseline And Manual Lookup

- Scope: recover a known no-effect Zoning start that counted the exact portal
  control before the provider finished rendering it.
- Evidence: correctional-institutions dispatch
  `e5916d7f-5e50-4da6-89d3-3813d31a3aa3` failed
  `opencounter_ui_drift:start_control`; direct read-only inspection then proved
  HTTP 200, one Zoning Portal heading, and one visible Check my zoning button in
  the expected parent card. No project reference or project was created.
- Relevant doctrine: Testing Appendix C, Debugging Appendix D, Backend G2-G5.
- Invariants: exact portal/card/button names; one unique control; no retry unless
  effect is known none and provider reference is null; one project maximum.

### Phase 1: Scope Lock

- In scope: wait up to the existing 15-second UI bound for the exact start
  control, retain uniqueness validation, and admit one proof-bound no-project
  ledger retry.
- Non-goals: selector broadening, timeout increases, direct URL starts,
  replacement projects, or automatic retries.
- Files: Playwright driver/test, discovery ledger/portfolio test, README,
  installed copies, and this record.
- Failure behavior: timeout or strict-locator failure remains
  `opencounter_ui_drift:start_control` before mutation.

### Phase 2: Red Tests

- Driver behavior: a portal heading may render before its exact start button.
  `node --test test/playwright-driver.test.mjs` failed 14/15 at the immediate
  zero-count guard.
- Ledger behavior: a recorded no-effect
  `opencounter_start_control_missing` failure may be requeued once only after
  `portal_start_control_render_verified` proof.
  `node --test test/discovery-zoning-portfolio.test.mjs` failed 7/8 at the
  existing proof whitelist.

### Phase 3: Implementation

- Wait for the exact button to become visible, map wait failures to the existing
  drift code, then run the unchanged count-equals-one guard before clicking.
- Add one error/reason pair to the existing pre-effect retry whitelist; preserve
  null-reference, no-lease, original-start, pending-mutation, known-none-effect,
  and one-retry requirements.
- Add no dependencies or new provider capability.

### Phase 4: Green Tests And Refactor

- Unchanged targeted commands passed: driver 15/15; combined driver and zoning
  portfolio tests 23/23.
- No refactor beyond the bounded wait and proof-pair extension.

### Phase 5: Full Verification

- Required: full OpenCounter suite, registry suite, validation, build, index
  sync/check, catalog hygiene, pack dry-run, debt scan, installed parity, and
  live same-job smoke.
- Live exit: the failed correctional-institutions job is requeued once, creates
  at most one project, receives immediate read-back, and ends verified without
  active/failed/indeterminate residue.

### Phase 6: Docs, Contracts, And Closure

- README documents bounded start-control rendering and the exact retry proof.
- Definition of Done: deterministic gates and the live same-job recovery pass;
  no replacement or unverified observation remains.
- Status: implementation complete; live recovery and full verification in
  progress.

## 2026-08-04 Bounded Branch-Evidence Addendum

### Accepted evidence contract

- The 20-run first branch wave measures first-pass provider-question-ID
  coverage only. It may earn `scenario_wave_1_complete`, never
  `answer_branch_complete`; it does not measure normalized-signature,
  answer-value, or transition coverage and does not prove answer-branch
  completeness.
- The strongest later empirical status is
  `branch_frontier_stable_for_manifest(M)` as of a fixed observation epoch.
  `M` is private, content-addressed, requester-approved, and finitely closes
  the exact catalog identity and entries; provider identity, fingerprint, and
  version; exact verified location, context, base-zone, and overlay set; a
  finite answer vocabulary that excludes free text or enumerates every allowed
  free-text value; maximum depth; per-wave and total project caps; validity
  window; exact source-snapshot digests; and provenance for every answer rule.
- Each sweep freezes frontier `F_k`. Each cell is keyed by
  `providerQuestionId` plus normalized signature, exact source-checkpoint
  question set, full prior answer prefix, complete answer vector, catalog entry
  ID (`catalogEntryId`), and exact context key. A cell counts only after
  authoritative provider read-back proves the exact next checkpoint set or
  terminal result.
- A complete sweep covers every `F_k` cell and leaves each either at a verified
  terminal or at an explicitly approved out-of-scope boundary. It has no queued,
  active, failed, indeterminate, or unverified in-scope work; in-scope
  `needs_input` is incomplete.
- Novelty is a new question identity, option or value, transition, or in-scope
  context association. Novelty resets the stability streak and requires a new
  preview and approval. Provider, catalog, fingerprint, or context-evidence
  drift invalidates `M`.
- Stability requires two independently executed, separately authorized
  complete sweeps with the same `M` digest and frontier digest and zero novelty.
  Observations outside `M` do not reset the streak. Expanding scope versions
  `M` and restarts the proof.
- Reaching a project, wave, or depth cap yields
  `wave_complete_scope_unsaturated`, never a global exhaustive or
  answer-branch-complete claim.

### Execution gate

- Status: implementation gate green and provider execution still unauthorized.
  The exact 126-observation freeze validates against two immutable source
  snapshots. The schema-v2 readiness report matches all nine required site or
  mixed assertions, with no missing evidence and unrelated history ignored.
- Campaign version 3 closes ownership to `proposal_fact`, `site_fact`, and
  `mixed_fact`. Every proposal or mixed answer has a deterministic declaration
  that it is synthetic coverage input and not a real project fact. Site answers
  require content-addressed parcel evidence; mixed answers require both.
- The deterministic provider-free preview contains 20 scenarios, covers all 48
  first-pass substantive provider question IDs, and caps concurrency at two.
  Its exact digest is retained in private mode-`0600` runtime state.
- Targeted tests cover immutable evidence, exact readiness, proposal-declaration
  tampering, preview determinism, authorization mismatch, ledger identity, and
  signature-bound answer dispatch.
- Debt scan: no errors. The existing discovery ledger shape validator remains a
  1,084-line module, above the 800-line warning threshold. Splitting a central
  validator while the live campaign is authorization-gated would widen change
  risk, so extraction is deferred to a separate refactor with parity tests.
- Building the preview does not authorize provider mutation. The 20 projects
  remain prohibited until the requester explicitly approves the exact private
  `previewSha256` and maximum project volume.
