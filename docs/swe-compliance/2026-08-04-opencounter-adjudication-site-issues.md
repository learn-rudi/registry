# OpenCounter Adjudication And Deterministic Site-Issue Logging

## Phase 0: Baseline And Manual Lookup

- Scope: resolve the requester-approved zero-project SF-20 adjudication and add deterministic logging for OpenCounter site/provider incidents.
- Files to inspect before editing: Scenario-Wave residual identity/module/tests, discovery controller and tests, ledger failure schema, zoning-drift detection, package docs, and the private completed source/residual ledgers.
- Relevant SWE manual sections: Master Doctrine Appendix C (testing and red-green-refactor), Backend Standard G3 (state machines), G4 (side effects), G7 (job observability), and G8 (idempotent event records).
- Current-state commands: `git status --short`, focused Scenario-Wave tests, OpenCounter package tests, registry tests, validation, and debt scan.
- Risks and invariants: no provider project may be created; approval must bind adjudication preview `d586f08a1cf12eca1bce3a4caac784babfdb2108df19e24e8e43c66113570fa8`; issue events must be immutable, idempotent, bounded, private, and content-addressed; no arbitrary provider HTML, secrets, or decrypted session state may enter logs.
- Exit criteria: baseline and relevant contracts are understood, unrelated dirty worktree changes are preserved, and exact test commands are identified.

## Phase 1: Scope Lock

- In scope: adjudication resolution/completion artifact; closed issue-event schema; private atomic issue store; deterministic incident snapshot; automatic unknown-dispatch logging when an issue store is configured; backfill of known ledger errors, zoning drift, and the airport read-back race.
- Non-goals: public MCP surface changes, new provider starts, new dependencies, broad ledger-schema migration, generalized telemetry backend, or unrelated refactoring.
- Expected files touched: `catalog/stacks/opencounter/src/discovery-scenario-residual*.mjs`, a new `discovery-site-issue-journal.mjs`, discovery controller/tests, focused Scenario-Wave/site-issue tests, OpenCounter docs, this checklist, and generated `index.json` only through `indexes:sync`.
- External inputs and trust boundaries: requester approval, private ledgers/artifacts, provider error classifications, provider references, timestamps, and recovery events are untrusted until validated.
- Failure behavior to define: reject wrong approval digest/volume, incomplete residuals, duplicate/conflicting event identities, recovery without a matching detection, unbounded fields, symlinks, malformed ledgers, and snapshot/source mismatches.
- Exit criteria: interfaces and identity fields are explicit before implementation.

## Phase 2: Red Tests

- Observable behavior to prove: exact approval yields a zero-project resolved adjudication and scoped completion claim; issue events deduplicate by content identity, preserve repeated distinct attempts, fold into deterministic open/recovered/adjudicated incidents, and reject invalid ordering or tampering; configured controller failures write one issue event.
- Test files to add or edit: `test/discovery-scenario-wave.test.mjs`, new `test/discovery-site-issue-journal.test.mjs`, and `test/discovery-controller.test.mjs`.
- Red commands: `node --test test/discovery-scenario-wave.test.mjs`; `node --test test/discovery-site-issue-journal.test.mjs`; `node --test test/discovery-controller.test.mjs`.
- Expected failure: missing adjudication-resolution exports, missing issue-journal module, and missing optional controller issue-store behavior.
- Exit criteria: each new behavior fails for its expected missing implementation.

## Phase 3: Implementation

- Implementation rules: use closed enums and exact keys; canonical JSON hashing; content-addressed IDs; atomic private files with `0700` directories and `0600` files; no raw provider response bodies; optional issue logging must preserve existing controller compatibility.
- Files allowed to change: only the files listed in Phase 1.
- Validation and error-handling requirements: validate all paths, IDs, timestamps, references, event transitions, approval binding, ledger ancestry, and snapshot digests; fail closed on contradictions.
- Observability requirements: detection and recovery are distinct immutable events with a stable incident key and source-event key; snapshots sort and fold deterministically and report counts by status/category/code.
- Exit criteria: smallest implementation passes the unchanged red commands.

## Phase 4: Green Tests And Refactor

- Green commands: rerun each Phase 2 command unchanged.
- Refactor constraints: no schema broadening, no dependency addition, and no unrelated cleanup.
- Regression checks: `npm test` in the OpenCounter package and exact private-artifact read-back.
- Exit criteria: focused and package tests are green after any refactor.

## Phase 5: Full Verification

- Targeted tests: Scenario-Wave adjudication, issue journal, controller failure logging.
- Full suite: OpenCounter `npm test` and registry `npm test` with the stable system npm path.
- Build/typecheck/lint: registry validate, indexes sync/check, catalog clean check, build, package dry run, syntax checks, and `git diff --check` scoped to OpenCounter.
- JS/TS debt scan: registry `.debt-scan.json`, CI profile, edited OpenCounter JS/MJS files.
- Live smoke checks: write/read the authorized adjudication and completion artifacts; backfill known private incidents; validate snapshot digest and private permissions; no provider MCP mutation.
- Exit criteria: all blocking gates pass and live artifacts read back exactly.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: OpenCounter README and catalog question reference with issue taxonomy, determinism guarantees, recovery semantics, and claim limitations.
- Final files touched: record after implementation.
- Commands run and results: record red, green, full verification, debt, and smoke commands.
- Accepted debt: record any unclassified historical generic errors or provider timing behavior that cannot be reconstructed exactly.
- Definition of Done: approved adjudication is immutable and verified; Wave 1 completion claim is scoped correctly; every known live incident is represented; future configured dispatch failures log automatically; all verification gates pass; no provider project was created.

## Execution Record

- Phase 0 / scope lock: complete. Existing unrelated Google Workspace and RUDI CRM changes were left untouched.
- Adjudication red: `node --test test/discovery-scenario-wave.test.mjs` failed because `resolveScenarioWaveAdjudication` was not exported.
- Adjudication green: the same command passed 10/10 after the exact zero-project approval binding and completion-claim implementation.
- Issue-journal red: `node --test test/discovery-site-issue-journal.test.mjs` failed because the module did not exist.
- Issue-journal green: the same command passed 2/2, including identity-tamper and timestamp validation.
- Controller red: the focused classified-failure test failed before a journal event digest was returned.
- Controller green: `node --test test/discovery-controller.test.mjs` passed 11/11, including exact persisted-error identity and terminal recovery closure.
- Approved adjudication resolution: `24a391b775af87b202c4257b87deeeb839ca3be9cb99744280126052e0db5821`; scoped completion claim: `f083121b45a476d3fc302bbc839028421a944ad034c04e463eb695c1758fc557`.
- Live issue backfill: snapshot `313cd666fdaca6a72b8f3a5bb306a09df5c86972c3fd6d3217a22a2ddebceb9b`, 48 incidents / 96 lifecycle events, 47 recovered, one adjudicated, zero open. Read-back matched exactly and files were mode `0600`.
- Explicit incidents: the SF-2/SF-20 drive-box zoning-context drift was adjudicated at the approved resolution; the airport checkpoint read-back conflict was recovered by exact checkpoint replay. All 46 persisted ledger errors were represented and resolved against their terminal verification.
- Accepted historical limitation: 41 immutable errors use `provider_dispatch_unusable`; they cannot be narrowed to timeout versus another unusable response from ledger evidence alone and therefore retain the broader combined category.
- Provider side effects for this change: zero new provider projects and no provider MCP mutation.
- Full OpenCounter suite: `npm test` passed 134/134. Final controller assertion rerun passed 11/11.
- Registry suite: `npm test` passed 157/157; `npm run validate` passed all 149 packages; `npm run indexes:sync` and `npm run indexes:check` passed; `npm run build` passed; `npm pack --dry-run --json` succeeded with existing `.gitignore` fallback warnings.
- Debt scan: CI profile over the edited OpenCounter JS/MJS neighborhood reported zero errors, warnings, or informational findings.
- Syntax and whitespace: all three new modules and the private residual runner passed `node --check`; scoped `git diff --check` and trailing-whitespace checks passed.
- Repository-wide exceptions preserved: `catalog:clean:check` reports unrelated pre-existing `catalog/stacks/google-workspace/dist` and `node_modules`; global `git diff --check` reports unrelated blank EOF lines in RUDI CRM migrations `0001` and `0002`. OpenCounter-scoped checks pass, and those user-owned changes were not modified.
- Final tracked implementation/docs: `src/discovery-scenario-residual-identity.mjs`, `src/discovery-scenario-residual.mjs`, `src/discovery-site-issue-journal.mjs`, `src/discovery-controller.mjs`, the Scenario-Wave/controller/site-journal tests, `README.md`, `CATALOG-QUESTION-REFERENCE.md`, this checklist, and the generated registry index verification. Earlier in-scope ledger and provider-driver changes remain covered by the 134-test package run.
- Private operational integration: `scenario-wave-residual-runner.mjs` now configures the issue journal and accepts the closed failure code while preserving legacy raw-request input; site-issue events/snapshot and the approved adjudication artifacts remain private RUDI state.
- Closure status: complete for the approved zero-project adjudication and deterministic issue logging. The larger discovery goal remains active; any next provider-backed fictional-scenario wave requires a new exact preview and separate volume-bound approval.
- Next provider-free boundary prepared after closure: common-fictional alternate-answer Wave 2 preview `5aa58574a585316aae1b259d275b6ab4ce7cf2f0d0c460301f88d885b91248a1`, 20 scenarios / maximum 20 provider projects / concurrency two, with all 48 substantive question IDs represented and the nine verified site or mixed facts unchanged. The private preview read-back digest matched and is mode `0600`; it is not authorization and no Wave 2 ledger or provider project was created.

## Wave 2 Durable-Ledger Unblock

### Phase 0-1: Baseline And Scope Lock

- Trigger: the approved preview passed the Scenario-Wave builder but durable initialization failed with `opencounter_discovery_scenario_campaign_invalid` before any provider call.
- Root cause: schema-v6 validation closed `campaignId` to Wave 1 even though the same validated 20-job/version-3 contract generated the Wave 2 preview.
- Relevant doctrine: Appendix C7A red-green-refactor, authorization validation, and explicit state-machine invariants.
- In scope: permit exactly the existing Wave 1 ID and the approved common-fictional Wave 2 ID under the unchanged schema-v6 shape; add a behavior test; document the closed campaign-ID set.
- Non-goals: arbitrary campaign IDs, volume/concurrency changes, schema-version changes, provider implementation changes, or a new project start before ledger read-back.
- Expected files: `src/discovery-ledger-schema.mjs`, `test/discovery-scenario-wave.test.mjs`, README/catalog contract text, and this checklist.
- Exit criteria: the exact approved Wave 2 ledger initializes and reads back; unknown campaign IDs still fail; focused/full tests and debt checks pass.

### Phase 2-6: Proof Record

- Campaign-ID red: `node --test --test-name-pattern="admits only the closed common-fictional Wave 2 campaign identity" test/discovery-scenario-wave.test.mjs` failed with `opencounter_discovery_scenario_campaign_invalid`.
- Campaign-ID green: the unchanged command passed after admitting only Wave 1 and `cincinnati-zoning-common-fictional-branch-wave-2`; the test also proves an arbitrary campaign ID remains rejected.
- Recovery-transition red: `node --test --test-name-pattern="promotes an uncertain scenario continuation when readback proves completion" test/discovery-scenario-wave.test.mjs` failed with `opencounter_discovery_verification_checkpoint_mismatch` after the intended unknown-effect continuation and same-project reconciliation sequence.
- Recovery-transition green: the unchanged command passed after adding the closed scenario-only verified-advancement transition; the full Scenario-Wave file passed 12/12.
- Live ledger smoke: `ocdl_f6c610bd212ba83408d20e1d0087efb7fdcd49d124806b6d09997744af83822a` read back with exact preview `5aa58574a585316aae1b259d275b6ab4ce7cf2f0d0c460301f88d885b91248a1`, 20 queued jobs, zero provider references, maximum 20 projects, and concurrency two before dispatch.
- Live bounded execution: seven unique provider projects started; six reached completed plus verified through same-project reconciliation, one remains ledger-indeterminate after an indeterminate reconciliation, and no duplicate project start was issued.
- New-start fence: 13 jobs remain never-started because verified job `ocdj_4236be826cc6544fd6932aa78beda77704bda8404897b42dc4ef04a90efade3c` returned SF-20 against its frozen source zoning context and triggered the existing zoning-context drift invariant.
- Deterministic issue snapshot: `4c1a2229020a54cb1d60d3e181cd069f985e2c9e7cdc4a3c8b687b0da9bb59f8`; 63 incidents total, 57 recovered, one adjudicated, and five open. The current indeterminate provider state and verified zoning-context drift are explicit open incidents.
- Provider-side-effect count: seven unique starts, within the approved maximum of 20; maximum observed mutation concurrency remained two.
- Final verification: OpenCounter passed 136/136; registry passed 157/157; registry validation passed 149/149; registry build passed; CI-profile debt scan reported zero findings; scoped `git diff --check` and all edited/private-runner syntax checks passed.

## Wave 2 Residual Authorization Boundary

- Indeterminate-recovery red: the focused uncertain-continuation test failed with `opencounter_discovery_verification_state_invalid` for an authoritative completed readback following an indeterminate same-project reconciliation.
- Graph-lineage red: after the transition was added, the same focused test failed with `opencounter_discovery_answer_path_invalid` because the indeterminate observation separated the approved checkpoint from the terminal readback.
- Recovery green: the unchanged focused command passed after validating the persisted scenario answer basis and tracing answers through their content-bound `answerPath` checkpoint; the live project `opencounter:project:2821175` then completed by readback only, with no provider mutation.
- Wave 2 residual red: `node --test --test-name-pattern="plans a closed Wave 2 residual after every started project is verified" test/discovery-scenario-wave.test.mjs` failed first with `opencounter_scenario_residual_source_invalid`, then with `opencounter_discovery_scenario_residual_campaign_invalid` when durable validation remained Wave-1-only.
- Wave 2 residual green: the unchanged focused command passed after adding a closed source-to-residual campaign mapping for Wave 1 and Wave 2; the full Scenario-Wave file passed 13/13.
- Exact provider-free preview: `dcb74a922d6d9ddca02a566ec27bd785cb9f41453898b4a44d9da4bca8ac9008`, maximum 13 projects, concurrency two, seven consumed projects, 13 remaining projects, and the verified drive-box drift location excluded.
- Bound drift packet: `4d5dc031a8ae0bff501f45948fd95af5b470aeec2394476f30bf31ccbd55eed4`, reusing the immutable official CAGIS SF-20 parcel-intersection evidence while binding it to the Wave 2 source job and current source-ledger snapshot.
- External-effect boundary satisfied: the requester approved exact preview `dcb74a922d6d9ddca02a566ec27bd785cb9f41453898b4a44d9da4bca8ac9008`, maximum 13 projects, and concurrency two before residual-ledger creation or provider dispatch.

## Wave 2 Residual Execution And Final Adjudication Boundary

- Durable residual ledger: `ocdl_4deeacc83548f61a33aa428bf7fba820152ba14fbbf82c9b7effac5b2ae8e616` read back with schema 7, exact approved preview, 13 queued jobs, zero provider references, maximum 13 projects, and concurrency two before dispatch.
- Live bounded execution: exactly 13 unique provider projects were started; all 13 reached completed plus independently verified state; zero jobs remain queued, active, failed, indeterminate, or awaiting input.
- Provider behavior: 12 continuation calls timed out after mutation intent was persisted. Every timeout was recorded as `provider_request_timeout`, and every affected project recovered through its original provider reference. No replacement project was created.
- Residual outcome: all 13 terminal results are durable and verified; 36 unique provider question IDs and 39 observed question transitions were recorded; the residual ledger reports zero zoning-context drifts.
- Deterministic issue closure: snapshot `fdd5b1460cea00dea49d6e9a7582a93c381f1d9bd223277fe1ea496eeb226deb` contains all 12 residual timeout incidents as recovered. Its one remaining global open incident is the parent Wave 2 SF-2/SF-20 zoning-context drift, which is deliberately pending explicit adjudication.
- Provider-free final adjudication preview: `6509e5a5344f1af6e6c0ee717771279d2b2bacf7e1d0e1274e1a66d3f9474df3`; it covers 20 logical scenarios, proposes the scoped `scenario_wave_1_complete` outcome, excludes `answer_branch_complete`, binds the single verified SF-20 disposition, and authorizes zero provider projects.
- Next authorization boundary: the final adjudication preview is not a resolution. Explicit requester approval of exact digest `6509e5a5344f1af6e6c0ee717771279d2b2bacf7e1d0e1274e1a66d3f9474df3` is required before writing the zero-project adjudication resolution and completion claim.
- Full-suite compatibility red: the first post-execution OpenCounter package run exposed `TypeError: job.answerPath is not iterable` in legacy questionnaire fixtures whose pre-schema jobs omit `answerPath`.
- Compatibility green: the graph builder now treats a missing legacy `answerPath` as an empty lineage and preserves the prior adjacent-observation fallback; the focused questionnaire plus Scenario-Wave run passed 15/15 and the full OpenCounter package passed 137/137.
- Final registry gates: validation passed 149/149 packages; indexes sync/check passed; build passed; package dry-run passed; the CI-profile debt scan reported zero findings; scoped `git diff --check` passed.
- Registry test exception: 154/157 tests passed, while all three unrelated `python-stack-contract.test.ts` cases hit their five-second timeout on both the full and focused rerun. A diagnostic run with a 30-second timeout hung beyond 60 seconds and was stopped; no Python infrastructure or test timeout was changed.
- Catalog hygiene exception: after the temporary OpenCounter test dependencies were moved to Trash, the clean check reports only the two pre-existing Google Workspace `dist` and `node_modules` artifacts.
- Final adjudication approval and resolution: requester approval bound exact preview `6509e5a5344f1af6e6c0ee717771279d2b2bacf7e1d0e1274e1a66d3f9474df3` at zero provider projects. Resolution `55e25bf74c26d068a61636ca3d4978cb794e7f550a802f6ec1435f5fa480408b` and completion claim `5c8a282a97dd5cc1edf30ac69630dcfce46b21ffb9433729541c788bad89ace0` read back exactly from private mode-`0600` artifacts.
- Resolution smoke red: the first idempotent operator attempt wrote the immutable resolution and issue-resolution event, then failed snapshot construction with `opencounter_site_issue_snapshot_time_invalid` because the requested resolution timestamp was one second ahead of the runner clock.
- Resolution smoke green: snapshot time is now explicitly ordered after the persisted resolution time. The idempotent rerun reused the existing resolution and lifecycle event, wrote snapshot `e039db24b30391a3688c8f516540aa73642f6c5427a8b6312c631c6060379e9e`, and verified two adjudicated, 73 recovered, and zero open incidents.
- Next provider-free Phase 4 boundary: ready adaptive-zoning preview `0e0f10cad42c50a814de12a0fccd8d78bdc32c3a147d5f5828d9365e50e17c2b` is bound to the actual completion claim, frozen questionnaire/portfolio evidence, six selected uses, 12 use-zone candidates, a tightened maximum of 12 provider projects, and concurrency two. `authorizationGranted` remains false; no adaptive provider project or ledger has been created.

## Adaptive Zoning Initial-Observation Execution

- Exact requester authorization: adaptive preview `0e0f10cad42c50a814de12a0fccd8d78bdc32c3a147d5f5828d9365e50e17c2b`, maximum 12 provider projects, and concurrency two.
- Campaign-contract red: `node --test test/discovery-adaptive-campaign.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for the missing adaptive campaign module.
- Campaign-contract green: the unchanged command passed after adding schema-v8 authorization binding, full 37-zone portfolio validation, stable candidate/job identities, zero initial provider references, private ledger read-back, and concurrency-two enforcement.
- Durable pre-provider ledger: `ocdl_9e6f6ae5010d918c193c406d58052db5caded92eb195f9e6ef9122144e0a81a4` read back with 12 queued jobs, zero provider references, exact completion claim `5c8a282a97dd5cc1edf30ac69630dcfce46b21ffb9433729541c788bad89ace0`, exact adaptive preview, and concurrency two.
- Targeted-start red: the initial attempt to select a never-started job through the recovery-affinity route failed closed with `opencounter_discovery_job_affinity_invalid`; no provider call was made and ledger state was unchanged.
- Targeted-start test red: the adaptive test failed with `targetedStore.leaseStartJob is not a function`.
- Targeted-start green: the unchanged test passed after adding a schema-v8-only exact start selector that rejects prior start-dispatch evidence, provider references, pending mutations, non-start actions, and non-queued jobs. The global recovery-first scheduler remains unchanged.
- Live bounded execution: exactly 12 unique provider projects were created, each job contains exactly one `start_dispatch_started` event, every project received a matching independent read-back, no project was replaced or reconciled, and no continuation was dispatched.
- Initial states: six projects exposed address-only checkpoints and have only the verified provider address match queued locally; six exposed substantive questions and remain `needs_input`. The ledger has zero active, failed, indeterminate, or completed jobs, zero supplied answers, zero errors, and zero zoning-context drifts.
- Observed substantive families: multi-family begins with `modification_existing_use`; single-family begins with `more_than_2_rooming_units`; two-family begins with `adding_units`. No substantive answer was submitted.
- Deterministic site-issue audit: the campaign ledger has zero issue-journal events. Every provider start and read-back matched the bounded contract; the targeted-start affinity block is recorded here as an operator/control-path issue rather than a provider-site incident.
- Next provider-free authorization boundary: continuation preview `3e6cc58e87c1a2e96f5cf7e1c27a31a7d78ec76eb5562869c593b0e5b5f43fca` binds source-ledger snapshot `f3534bd733d26e126f0aa9a24194b0b492c3fc5069d8ed322768acc80413376a`, authorizes zero new projects, plans at most 12 same-project continuations at concurrency two, and marks all proposal answers as explicitly synthetic/non-real. It contains six verified address-only continuations and six common-fictional scenario continuations; `authorizationGranted` remains false.
- Final verification: the full OpenCounter package passed 138/138 after temporarily resolving Playwright from the previously trashed dependency directory; the temporary symlink was removed and package `node_modules` remains absent. Registry validation passed 149/149, registry build and index check passed, all edited/private modules passed syntax checks, and scoped `git diff --check` passed.
- Verification environment note: the first full package attempt passed 113 tests before the two Playwright-import test files failed because the cleaned package had no local dependency directory. This was an environment/load failure, not a behavior failure; the unchanged full command passed after the temporary dependency resolution.
- Debt scan: the repository CI-profile invocation reported zero findings for its configured `src` graph. A second OpenCounter-specific graph scan reported only the package's intentional non-public operational modules as orphans and the pre-existing oversized `discovery-ledger-schema.mjs` / `discovery-ledger.mjs` modules; no errors were reported and no unrelated extraction refactor was attempted.
- Catalog hygiene remains unchanged: the check reports only the two pre-existing Google Workspace `dist` and `node_modules` targets. The OpenCounter package has no `node_modules` target.

## Adaptive Continuation Closure And Verification Boundary

- Exact requester authorization: continuation preview `3e6cc58e87c1a2e96f5cf7e1c27a31a7d78ec76eb5562869c593b0e5b5f43fca`, authorization `7ce91cff55b34337d4c1dc84afe87792b4ab65b5eff90a3c0649d5f8c699af4b`, maximum 12 same-project continuations, concurrency two, and zero new provider projects.
- Live bounded continuation: all 12 jobs completed and were independently verified on their original provider references. The campaign issued 12 continuations and nine same-project reconciliations; no replacement project was created.
- Provider behavior: nine continuation calls timed out after mutation intent was persisted. Each timeout was recorded as `provider_request_timeout`, and each affected project recovered through authoritative read-back of the original project.
- Terminal outcomes: six Prohibited, five Permitted, and one Permitted with Limitations. All 12 terminal zoning districts matched their frozen target base-zone contexts; zero zoning-context drifts remain.
- Deterministic issue closure: snapshot `5a5dbfad5881cc34cb4d15b72b7b75f53c4312c474574b5bb61149b7bb49d084` contains the campaign's nine timeout incidents as recovered. The global journal reads 82 recovered, two adjudicated, and zero open incidents.
- Content-addressed execution assessment: `d3970bd2f6f14567a505aff1aed07c89328eccdc23f0b2763c0e9733c3c60640`, written and read back from private mode-`0600` state. It binds the adaptive preview, continuation preview and authorization, final ledger snapshot, master questionnaire, and site-issue snapshot.
- Novelty result: zero new provider question IDs and zero new substantive question signatures; 12 new use/zone context associations, 12 new terminal-outcome associations, and 24 new answered transition shapes/context associations. The correct status is `adaptive_observation_complete_with_novelty`, not a zero-novelty sweep; the stability streak remains zero of two and no saturation claim exists.
- Verification manifest: `1cf51ea7ecfb2f0cbd9e6d304470cb6365c5a6b3772d60e75cda4c2900cb56b7` finitely binds the same 12 cells, exact verified location fixtures, baseline question signatures/outcomes, and exact answer vectors. It permits at most 12 fresh projects per sweep, concurrency two, and 24 total projects across the two independently authorized verification sweeps required for stability.
- Next exact authorization boundary: sweep-1 preview `3744b7a2befefc1e0ead691529950fc8c582f12e57059211e10fccbdc94602d4` proposes 12 fresh provider projects and 12 exact continuations: six verified-address-only cells and six common-fictional scenario cells. `authorizationGranted` remains false, no verification ledger exists, and no new provider project was created while preparing the manifest or preview.
- Private-runner proof: the runner passed `node --check`; assessment/manifest/preview content digests read back exactly; all three artifacts are mode `0600`. The first manifest attempt failed closed before artifact creation because provider-confirmed full addresses differed from abbreviated start-fixture addresses; the corrected manifest binds both forms explicitly.

## Adaptive Verification Sweep 1 Execution And Sweep 2 Boundary

- Exact requester authorization: Sweep 1 preview `3744b7a2befefc1e0ead691529950fc8c582f12e57059211e10fccbdc94602d4`, authorization `4a71efc7942ec9ddf96c31519f93c93971ae9a8613e2f61e08d44cb2b86200ed`, maximum 12 fresh provider projects, maximum 12 exact continuations, and concurrency two.
- Durable verification ledger: `ocdl_85947cedd40fefe4c600dc84aac503e206cff77a0c47821161703ee231c2dc05` read back before provider dispatch with 12 queued jobs and zero provider references. Execution used exactly 12 unique provider references; each job has one start-dispatch event, all 12 reached terminal plus independent verification, and no replacement project was created.
- Provider behavior: the provider repeatedly oscillated between checkpoint, indeterminate, and terminal views and frequently timed out after continuation intent was persisted. The final ledger records 16 exact failures, zero failed/indeterminate/queued jobs, 18 observed question/transition nodes, and zero zoning-context drifts.
- Stale-checkpoint red/green: the focused adaptive recovery test first observed `failed` instead of `indeterminate` for `opencounter_checkpoint_state_missing`; the unchanged focused command passed after the schema-v8-only transition recorded the dispatch effect as `none` while requiring same-project reconciliation.
- Reconciliation-retry red/green: the focused test failed with `opencounter_discovery_reconciliation_retry_invalid` because the validator recognized the module-reload retry but a later guard admitted only the HTML-access retry. The unchanged test passed after both closed retry reasons were admitted for the same persisted continuation reconciliation.
- Readback recovery red/green: schema-v8 authoritative readback initially failed with `opencounter_discovery_verification_checkpoint_mismatch` after an unchanged reconciliation. The focused test passed after adding two closed paths: verified address-only completion from the bound location fixture, and an explicit approval-bound multi-question completion that validates the exact checkpoint, exact manifest answers, requester authorization basis, and provider reference.
- Provider-state oscillation handling: an unverified terminal observation contradicted by authoritative checkpoint readback is reverted to the exact prior checkpoint; the terminal observation becomes indeterminate and its answer lineage is removed. A later authoritative terminal readback may close only through preserved uncertain-action lineage or the exact approval-bound recovery path.
- Issue-journal idempotency red/green: repeated detections/resolutions with the same stable incident initially wrote distinct lifecycle roots. The focused journal test failed on different artifact paths, then passed after store-level incident/lifecycle idempotency reused the canonical event while rejecting payload conflicts.
- Journal repair: repair artifact `dc55f6602dee1f7f20ea3ca1464b5f61ce5396fed9020a2eb6a409809642149b` superseded three duplicate lifecycle events with identical stable payloads. The original files were moved, not deleted, into private `site-issues/superseded-events`; the repair is recoverable and content-addressed.
- Deterministic issue closure: snapshot `2c79f65445bb4e15ffa0f3118bf6bfea8bdc5b9aa7ebded1b763cab90058343c` reports 113 recovered, two adjudicated, and zero open incidents globally. Sweep 1 contributed 31 recovered incidents, including provider timeouts, indeterminate readbacks, one stale checkpoint, one state oscillation, and the explicitly logged runner dispatch-envelope defect.
- Sweep 1 assessment: `669afa4e2af474558273c8e3671a31da6d6937bddbe7a11159aca339d4cd1445` read back exactly with 12/12 verified projects, zero question-set mismatches, zero exact-answer-vector mismatches, and zero terminal-outcome mismatches. Status is `sweep_complete_zero_novelty`; the stability streak is one of the required two and no saturation claim exists.
- Next provider-free authorization boundary: Sweep 2 preview `ba5e7d178439c3692ef1ca63f8e979a4436311a414b6fa4b7c9ff4af1e5e0c8f` proposes the same 12 finite cells as 12 fresh projects plus 12 exact continuations at concurrency two. It is the final permitted 12-project tranche under the 24-project verification cap, is valid through `2026-08-12T16:39:00.000Z`, and remains `authorizationGranted: false`.
- Change-specific verification: the focused adaptive-campaign plus site-journal tests passed 5/5, and the full OpenCounter package passed 140/140. All edited production modules and the private runner passed `node --check`; the scoped `git diff --check` passed; registry validation passed 149/149; index consistency, build, and package dry run passed.
- Repository-wide exceptions preserved: the registry suite passed 154/157, with only the same three Python stack-contract cases exceeding their fixed five-second timeout; no OpenCounter test failed. `catalog:clean:check` continues to report only the unrelated pre-existing Google Workspace `dist` and `node_modules` targets, which were not removed or modified.
- Debt scan: the configured registry CI profile reported zero findings for its scoped graph. The OpenCounter-specific structural scan reported zero errors and four accepted warnings: three intentionally non-public operational modules plus the pre-existing oversized `discovery-ledger.mjs`; no live-campaign extraction refactor was attempted.

## Adaptive Verification Sweep 2 Execution And Stability Closure

- Exact requester authorization: Sweep 2 preview `ba5e7d178439c3692ef1ca63f8e979a4436311a414b6fa4b7c9ff4af1e5e0c8f`, authorization `2712c2da8c5e62d3c84dedafd6a4b3a8bd370c5c962533eca80a855839dcee81`, maximum 12 fresh projects, 12 unique logical continuations, and concurrency two. Binding `85c338dc52a7150e82c43f250212b655ff354d2fb5908c9586c9cd1ad007806b` linked the authorization to ledger `ocdl_52fcd20ecbdcd56a0a811da0f609d592235eb7f9fbf53cc4c6b5d52238f54afb` before provider dispatch.
- Sweep-2 authorization red/green: the exact provider-free authorization command first failed with `adaptive_verification_authorization_preview_invalid` because the private runner admitted only ordinal one. The unchanged command passed after ordinal two was admitted only with the canonical prior zero-novelty assessment, prior preview, manifest, prior 12-project ledger snapshot, expiration, and volume limits validated. The initialized ledger read back with 12 queued jobs, zero references, and zero start events.
- Live bounded execution: exactly 12 unique provider projects were created, every job contains exactly one start event, all 12 reached completed plus independent verification, no replacement project was created, maximum mutation concurrency remained two, and the final ledger reports zero queued, active, failed, indeterminate, or needs-input jobs.
- Provider behavior: 12 logical answer vectors produced 13 continuation dispatch attempts. The sole extra attempt repeated the exact project-`2821592` address vector only after same-project reconciliation plus independent readback proved the first attempt had not advanced. The final assessment records `continuationRecoveryRetryCount: 1` and `verifiedNoAdvanceBeforeEveryRetry: true`; no blind answer retry occurred.
- Recovery evidence: the final ledger contains 12 recorded provider failures, 12 reconciliation dispatches, 18 observed questions, 18 observed transitions, and zero zoning-context drifts. Six outcomes were Prohibited, five Permitted, and one Permitted with Limitations.
- Control-path correction: two bounded `indeterminate` reconciliation results were initially classified through the generic unusable-result path, retaining their prior checkpoint. No provider result was invented or discarded. Successful terminal readback triggered the closed HTML-access/module-reload reconciliation retry, the actual bounded terminal result was recorded, and each project was independently verified.
- Deterministic issue closure: snapshot `099042bf1e3059d0a6883bfec42e7cd6b39e915b18d28aad7a958e3dc5d6c77b` reports 133 recovered, two adjudicated, and zero open incidents globally. Sweep 2 contributed 20 incidents, all recovered.
- Sweep-2 assessment red/green: the exact assessment command first failed with `adaptive_verification_assessment_source_invalid` because the assessor admitted only ordinal one. The unchanged provider-free command passed after validating the prior assessment/preview lineage and computing the scoped two-sweep claim.
- Final content-addressed assessment: `dff31c737f693b3d1e395027f997c93d3660e1ecfb2d3dfd7114689b1e5c8bec` reports zero provider-question-set mismatches, zero exact-answer-vector mismatches, and zero terminal-outcome mismatches. The stability streak is two of two and its claim is deliberately scoped to the exact 12-cell manifest, comparison dimensions, answer vectors, and observed outcomes; it is not a claim that the live provider is operationally reliable or immutable.
- Verification gates: the full OpenCounter package passed 140/140; the registry suite passed 157/157; validation passed 149/149; index consistency, build, package dry run, private-runner syntax, and scoped `git diff --check` passed. The OpenCounter dependency symlink used for the test run was removed and package `node_modules` remains absent.
- Debt and hygiene: the registry-configured debt scan reported zero findings. The OpenCounter structural scan reported zero errors and three accepted warnings for intentionally non-public operational modules. `catalog:clean:check` continues to report only the unrelated pre-existing Google Workspace `dist` and `node_modules` targets; they were not modified.
- Closure boundary: provider-heavy adaptive questionnaire crawling is complete for this finite verification manifest. Subsequent work should consume the versioned questionnaire and stability evidence in the service-agent decision flow, use OpenCounter only for bounded validation or case-specific confirmation, and keep physical-feasibility analysis a separately sourced layer.

## Master Questionnaire Extension And Provider-Free Service Replay

- Scope: provider-free Phase 5/6 consumption only. No provider project, continuation, reconciliation, browser session, or City call was created or dispatched.
- Baseline preserved: questionnaire schema v3 remains the exact 126-observation first-pass artifact. The extended schema v5 binds that immutable freeze, seven supplemental scenario/adaptive ledger snapshots, adaptive assessment `dff31c737f693b3d1e395027f997c93d3660e1ecfb2d3dfd7114689b1e5c8bec`, and site-issue snapshot `099042bf1e3059d0a6883bfec42e7cd6b39e915b18d28aad7a958e3dc5d6c77b`.
- Extension red/green: the new questionnaire test first failed with `3 !== 4` because supplemental evidence was ignored. It passed after adding the explicit extended contract, separate baseline/supplemental/total counts, exact source-snapshot binding, rejection of unresolved supplemental jobs, and deterministic identities derived from ledger snapshot plus source job ID for repeated verification cells.
- Recovery-lineage red/green: real construction failed with `opencounter_master_questionnaire_answer_path_invalid` because recovery observations may answer a non-adjacent persisted checkpoint. A focused test reproduced that pattern, then passed after transition evidence adopted the same `answerPath` lineage rule as the question graph.
- Context-evidence red/green: the service test failed because one aggregated answer transition mixed classifications from unrelated catalog uses and zoning contexts. Schema v5 now retains an exact context tuple for every transition: catalog use, category, expected/observed zone, overlays, fixture, scenario, timestamps, counts, and terminal classification. The test proves the same answer may be Permitted for one use and Prohibited for another without cross-contamination.
- Address-only red/green: the focused service test returned `needs_project_input` for a verified path that terminated immediately after the provider address selection. It passed after exact context-granular address-terminal evidence could be seeded from the already-resolved local site evidence; a street/address match, catalog use, zoning context, and evidence references are all required.
- Historical schema preservation: an intermediate content-addressed schema-v4 questionnaire remains valid and readable. The context-granular contract was assigned schema/library v5 rather than redefining v4.
- Final questionnaire: `89795163d79060e4b1d23d8dde5c3bde093801e079bb1cbf27a407e3086a6dc1`, private mode `0600`, 126 baseline plus 76 supplemental verified observations, 202 total observations, 93 canonical question signatures, 51 provider-question families, 116 unique outgoing transitions, and 378 exact transition-context evidence records. All seven supplemental ledger snapshots are content-addressed, private mode `0600`, and read back exactly.
- Coverage interpretation: the supplemental evidence introduced no new canonical question signature or provider-question family; it increased unique outgoing transitions from 40 to 116, aggregate transition observations from 146 to 452, and repeatedly observed questions from 62 to 88 while retaining all 37 observed zoning codes. This supports finite observed-path reuse, not branch exhaustiveness or a normative legal conclusion.
- Exact provider-free replay: all 76 verified supplemental projects navigated to `preliminary_result`; all 76 classifications matched their independently verified terminal result: 50 likely prohibited, 17 likely permitted, and nine permitted with limitations. Every result still reports `observed_library_not_exhaustive`, recommends confirmation only, and grants no provider authorization.
- Final verification: focused questionnaire/preliminary/maintenance tests passed 8/8; the full OpenCounter package passed 141/141; the registry suite passed 157/157; registry validation passed 149/149; index consistency, build, package dry run, production-module syntax, and scoped `git diff --check` passed.
- Dependency hygiene: the full package run temporarily resolved Playwright from the existing Studio dependency tree; the exact symlink was removed by the command trap and the OpenCounter package has no `node_modules` target afterward.
- Debt scan: the configured registry CI profile reported zero findings for its scoped graph. The OpenCounter structural fallback reported zero errors and two expected orphan warnings because the questionnaire and preliminary decision modules are private operational modules rather than public stack entrypoints.
- Catalog hygiene exception preserved: the dry-run still reports only the unrelated pre-existing `catalog/stacks/google-workspace/dist` and `catalog/stacks/google-workspace/node_modules` targets. They were not modified or removed.

## Physical Feasibility Evidence Binding

- Scope: harden the separate Phase 7 legal-versus-physical boundary; do not run a live site, infer site facts, or merge OpenCounter permission with buildability.
- Skill boundary: the site zoning/envelope workflow establishes parcel truth, frontage, zoning, and the net legal envelope through `site-envelope.json`. Parking, building fit, utilities, existing-building, and other physical domains remain separate evidence producers unless explicitly continued.
- Evidence-binding red: the focused combined-assessment test failed with `opencounter_combined_assessment_evidence_invalid` after each domain and evidence artifact gained explicit domain declarations. The prior schema could mark a domain `pass` without any domain-specific evidence.
- Evidence-binding green: the unchanged focused command passed 3/3 after schema v2 required every domain to cite at least one content-addressed artifact that declares support for that domain. Finding evidence must also be included in the parent domain's evidence set.
- Compatibility: the builder emits schema v2. The validator still accepts and digest-verifies legacy schema-v1 artifacts, proven by a round-trip compatibility fixture; existing artifacts are not silently reinterpreted.
- Remaining boundary: this contract validates provenance and fail-closed classification mechanics. It does not itself calculate frontage, setbacks, a legal envelope, parking fit, utilities, topography, flood/environment, or existing-building constraints; those values must come from their actual evidence systems.
- Final verification: focused physical/combined tests passed 3/3; the full OpenCounter package passed 141/141; the registry suite passed 157/157; registry validation passed 149/149; indexes sync/check, build, package dry run, production-module syntax, scoped `git diff --check`, and temporary dependency cleanup passed.
- Debt and hygiene: the configured registry scan reported zero findings. The OpenCounter fallback reported zero errors and three expected private-module orphan warnings for the master questionnaire, preliminary guidance, and combined assessment modules. Catalog hygiene still reports only the two unrelated Google Workspace build/dependency targets.

## Known-Project Validation And Maintenance Proof

- Honest baseline: the first unchanged 76-case report showed classification accuracy `1.0` but question recall `0.248366` (76 true positives, 230 false negatives). No novel question was present; the decision artifact retained only the terminal source question and hid successfully traversed intermediate questions.
- Traversal red/green: the focused extended-questionnaire test failed because `predictedQuestionIds` was absent. It passed after each per-use assessment retained every visited requester question plus locally resolved address-question evidence, and the report scorer included that exact set while remaining backward-compatible with older decisions.
- Address/checkpoint diagnosis: the unchanged live replay initially remained at `0.248366` because an address-only terminal observation suppressed project questions that had appeared in the same provider checkpoint. A diagnostic full-service restaurant case proved nine observed questions but only one predicted address question.
- Address/checkpoint correction: generic roots remain suppressed by exact address-only evidence, but project questions observed in the same fixture-and-scenario context are retained. The diagnostic case then returned eight project questions plus the resolved address step, matching all nine observed questions.
- Final known-project report: `cda2a975abcdf5a20c054706c05b7c03148d81aec119b82c9417bef27d716a34`, private mode `0600`, 146,849 bytes, and exact read-back. All 76 cases matched; classification accuracy, question precision, and question recall are `1.0`; 306 question instances are true positives; false positives, false negatives, and novel-question cases are zero.
- Claim boundary: these metrics prove deterministic replay against the 76 verified supplemental provider projects and questionnaire `89795163d79060e4b1d23d8dde5c3bde093801e079bb1cbf27a407e3086a6dc1`. They do not establish future branch exhaustiveness, normative legal accuracy, or live-provider reliability.
- Maintenance behavior: questionnaire comparison remains provider-free, reports exact affected catalog entries, grants no authorization, and only recommends bounded reruns when catalog, tenant, or evidence changes are detected.
- Final verification: the latest full OpenCounter package passed 141/141; the registry suite passed 157/157; validation/build, index sync/check, package dry run, all four production-module syntax checks, and scoped `git diff --check` passed. The configured registry debt scan reported zero findings. The OpenCounter structural fallback reported zero errors, four expected orphan warnings for private operational modules, and one informational shared-import heuristic. `catalog:clean:check` continues to report only the unrelated pre-existing Google Workspace `dist` and `node_modules` targets; neither was modified or removed.

## 2026-08-19 Follower Publication Recovery

- This historical adjudication/discovery release is published together with the provider-free assessment boundary recorded in `2026-08-05-opencounter-assess-project.md` because the recovered modules share exact questionnaire, ledger, residual-identity, and site-issue contracts.
- Publication verification passed all 148 package tests in both normal and forced-offline modes. No live provider action was run; the prior bounded execution evidence above remains historical proof, not a newly repeated mutation.
- The exact architecture blocker, structural warnings, recovery base, and draft-review boundary are recorded in the assessment checklist's follower-publication section.
