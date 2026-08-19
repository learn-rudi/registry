# OpenCounter `assess_project` Phase 9 Compliance Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: expose one provider-free, evidence-bound project-assessment action through `stack:opencounter`, then prove known, ambiguous, and escalation paths.
- Files inspected before editing: `catalog/stacks/opencounter/manifest.json`, `package.json`, `src/index.mjs`, `src/core.mjs`, `src/preliminary-guidance.mjs`, `src/combined-project-assessment.mjs`, `src/discovery-master-questionnaire.mjs`, `src/zoning-catalog.mjs`, the related tests/fixtures, `catalog/skills/opencounter.md`, and the Dwellow stack manifest/runtime boundary.
- Relevant SWE manual sections: Appendix C testing and agent-assisted red-green-refactor; API Appendix E2, E3, E4, E7, E9, E10, and E12; Security Appendix F5, F10, F12, and F13; Backend Appendix G2, G3, G4, and G13; Build Order Phase 5 plus the APIs-to-Agents and Agents-to-Production gates.
- Current-state commands: `git status -sb`, scoped `rg --files`, symbol/entrypoint searches, and targeted source/manual reads.
- Risks and invariants: preserve the dirty worktree; never invent parcel, zoning, frontage, envelope, or physical facts; never dispatch OpenCounter from the assessment action; bind every legal result to an exact catalog and questionnaire; reject ambiguous sites rather than choosing by rank; keep legal and physical conclusions separate; keep response and stored artifacts bounded and content-addressed.
- Exit criteria: current public surface and private module contracts are understood; the site-resolution boundary is explicitly assigned to `stack:dwellow-mcp` and its operator workflow.

## Phase 1: Scope Lock

- In scope: one additive `opencounter_assess_project` MCP tool; deterministic project-idea mapping; exact questionnaire loading from private state; validated upstream site-resolution evidence; optional evidence-bound physical assessment; provider-free escalation recommendation; deterministic issue records; private content-addressed/idempotency-bound assessment persistence; operator workflow and documentation updates.
- Non-goals: no new OpenCounter crawl or provider project; no hidden cross-stack subprocess; no automatic selection among ambiguous parcels or catalog uses; no fabricated site or physical facts; no shell frontier, building fit, parking feasibility, site plan, concept generation, or normative City determination.
- Expected files touched: new `src/project-assessment.mjs`, `src/project-assessment-policy.mjs`, `src/project-assessment-store.mjs`, `test/project-assessment.test.mjs`, and `test/mcp-contract.test.mjs`; existing `src/core.mjs`, `src/index.mjs`, `manifest.json`, `package.json`, `package-lock.json`, `README.md`, `catalog/skills/opencounter.md`, this checklist, and generated `index.json`. Existing preliminary/combined modules may change only if a red test exposes an in-scope contract defect.
- External inputs and trust boundaries: requester address/project idea/answers; agent-supplied catalog-use confirmation; Dwellow/site-engine resolution evidence; private questionnaire artifact; optional physical-feasibility artifact; filesystem state; MCP caller payload.
- Failure behavior to define: missing/mismatched questionnaire; invalid or ambiguous site resolution; unknown/ambiguous use mapping; invalid/stale answers; unobserved questionnaire context; mismatched physical parcel; idempotency-key conflict; private-store corruption; oversized output.
- Exit criteria: request/response schemas are exact and additive; provider authorization is always false; all side effects are limited to private idempotent local assessment artifacts.

## Phase 2: Red Tests

- Observable behavior to prove: a known evidence-bound path returns local preliminary guidance without a provider dispatch; an ambiguous project returns deterministic use-confirmation candidates; an unobserved zoning context requires bounded provider confirmation without granting authorization; site issues and physical-evidence boundaries remain explicit; identical assessment retries reuse the same private artifact.
- Test files to add or edit: `catalog/stacks/opencounter/test/project-assessment.test.mjs`, with service/public wiring assertions added only where the lower-level test cannot prove the boundary.
- Red command: `node --test test/project-assessment.test.mjs` from the OpenCounter package, using the existing temporary dependency-resolution pattern when required.
- Expected failure: the project-assessment module/tool does not yet exist.
- Exit criteria: each behavior is introduced and observed red one at a time before its implementation.

## Phase 3: Implementation

- Implementation rules: pure domain orchestration separate from MCP/framework code; exact-key validation; conservative catalog mapping; stable machine-readable statuses/reasons; no blind retry or provider call; content-addressed mode-`0600` artifacts under a mode-`0700` private directory; explicit assessment-key conflict detection.
- Files allowed to change: only the Phase 1 expected files.
- Validation and error-handling requirements: validate all caller and artifact inputs before use; verify catalog/questionnaire/parcel identities; reject unknown fields; preserve stable error codes; fail closed on missing evidence, context drift, or corrupt read-back.
- Observability requirements: persist request identity, exact evidence references, legal/physical statuses, unresolved issues, next actions, provider recommendation/authorization state, and artifact digest/path without recording secrets.
- Exit criteria: the smallest implementation makes the current red behavior green without weakening the test.

## Phase 4: Green Tests And Refactor

- Green command: the unchanged focused command from Phase 2 after each behavior.
- Refactor constraints: only remove duplication or improve names after green; preserve exact schemas, error codes, artifact identities, and provider-free behavior. The coordinator, deterministic policy builders, and private persistence are split into separate modules so each new source stays below the stack verifier's 800-line module limit.
- Regression checks: preliminary-guidance, combined-assessment, core, and project-assessment focused tests.
- Exit criteria: all focused tests pass after any refactor.

## Phase 5: Full Verification

- Targeted tests: focused project-assessment plus adjacent core/preliminary/combined tests.
- Full suite: `npm test --prefix catalog/stacks/opencounter` and repository `npm test`.
- Build/typecheck/lint: production/test `node --check`, `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run build`, `npm pack --dry-run --json`, and scoped `git diff --check`.
- JS/TS debt scan: registry-configured CI scan for edited modules plus an OpenCounter structural fallback.
- Live smoke checks: exercise the MCP tool contract locally with private fixture state. A live Dwellow address lookup is read-only but must use a real target and preserve ambiguity; no live OpenCounter mutation belongs in this phase.
- Exit criteria: all relevant gates pass or a precise unrelated exception is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: stack README, manifest tool inventory/safety boundary, operator skill cross-stack sequence, package/server version, and generated registry index.
- Final files touched for this phase: `catalog/stacks/opencounter/src/project-assessment.mjs`, `src/project-assessment-policy.mjs`, `src/project-assessment-store.mjs`, `src/core.mjs`, `src/index.mjs`, `test/project-assessment.test.mjs`, `test/mcp-contract.test.mjs`, `manifest.json`, `package.json`, `package-lock.json`, `README.md`, `catalog/skills/opencounter.md`, this checklist, and generated `index.json`.
- Red/green record:
  - Known-path red: `node --test test/project-assessment.test.mjs` failed because `src/project-assessment.mjs` did not exist; the unchanged focused test then passed after the smallest evaluator/store implementation.
  - Ambiguity red: the pilot returned `needs_use_mapping` instead of the required `needs_use_confirmation`; the unchanged test passed after retaining deterministic candidates while requiring requester confirmation.
  - Escalation red: the unobserved-context pilot had no preview; the unchanged test passed after adding an exact digest-bound preview with `authorizationGranted: false` and no driver call.
  - MCP red: the contract expected `opencounter_assess_project` but the live server omitted it; the unchanged test passed after manifest/schema/handler wiring.
  - Architecture red: the first targeted stack verification reported the new coordinator at 1,110 lines. A behavior-preserving split produced coordinator/policy/store modules of 620/334/233 lines; all new modules are now below 800 and disappeared from the verifier findings.
- Verification record:
  - `node --test test/project-assessment.test.mjs`: 5/5 passed after the module split.
  - Focused project/MCP/core/preliminary/combined command: 20/20 passed. The first symlinked dependency attempt failed only because Node resolved the Trash directory by its real path; rerunning with `NODE_OPTIONS=--preserve-symlinks` used the same dependency tree and passed.
  - `NODE_OPTIONS=--preserve-symlinks npm test` in the stack: 148/148 passed; the temporary `node_modules` symlink was removed by a shell trap.
  - Repository `npm test`: 157/157 passed across 18 test files.
  - `npm run indexes:sync`, `npm run indexes:check`, and `npm run validate`: current indexes and 149/149 catalog packages valid.
  - `npm run build`: passed. `npm pack --dry-run --json`: 2,242,918-byte package, 10,350,409-byte unpacked size, 958 files.
  - Syntax checks passed for all edited OpenCounter JS modules/tests; edited JSON parsed; scoped whitespace check has no Phase 9 finding.
  - Registry configured debt scan: 0 findings. OpenCounter entrypoint-aware structural scan: 0 errors, 0 warnings, and one non-blocking heuristic info item for repeated `node:crypto` imports.
  - `npm run stacks:verify -- --stack stack:opencounter --prepare --json`: the Phase 9 modules pass the size gate, but the command remains blocked before tests by eight older oversized modules listed below.
  - `npm run catalog:clean:check`: only two unrelated pre-existing generated targets remain: `catalog/stacks/google-workspace/dist` and `catalog/stacks/google-workspace/node_modules`.
- Live read-only smoke and read-back evidence:
  - Dwellow resolved `4818 Stewart Avenue, Cincinnati, Ohio 45227` to canonical `4818 STEWART AVE, Hamilton County, OH`, rollup `8ccbfc38-88c3-432e-a9a3-e21260a1d10c`, anchor parcel `003600010091`, and base zone `T3N`; zoning rules cited `§1703-2.50`.
  - The source location result was partial because `cagis_condominium_units` was missing. The assessment preserved this deterministically as `cadastral_identity_partial`; it did not invent a cadastral answer.
  - A real-site-evidence/synthetic-project, provider-free smoke returned `needs_project_input`, four unresolved questions, no physical conclusion, and no provider authorization. Evidence refs were `dwellow:evidence_262c5077-9f43-48f7-9fe5-e0f7e4237d36` and `dwellow:evidence_245b5940-a41a-4391-8f99-a197a54f6deb`.
  - Persisted artifact `ocpa_8ad7a80a556f9e9bcd5c5b99d6a3e0cec9de4f70c162e09e5fe6ae2797723232` read back through the refactored store with the same digest, `authorizationGranted: false`, 14,509 bytes, and mode `0600`.
- Accepted debt: live OpenCounter provider reliability remains outside the local replay claim and no provider call was made. The stack verifier still reports eight pre-existing oversized modules outside Phase 9 scope: `discovery-adaptive-zoning.mjs` (834), `discovery-frontier-stability.mjs` (1,192), `discovery-ledger-schema.mjs` (1,652), `discovery-ledger.mjs` (1,351), `discovery-master-questionnaire.mjs` (1,674), `discovery-scenario-residual.mjs` (952), `playwright-driver.mjs` (822), and `preliminary-guidance.mjs` (821). These were not broadened into an unrelated refactor.
- Definition of Done: one installed-tool contract accepts a project request plus exact operational provenance, known/ambiguous/escalation pilots pass deterministically, local retries are idempotent, no provider action is authorized or dispatched, documentation matches behavior, and all required verification gates pass.

## 2026-08-19 Follower Publication Recovery

- Recovery base: Registry PR #34 (`fix/27-midjourney-login-lifecycle`). The exact pre-reconciliation follower state remains preserved at checkpoint `635989a7d941271450c92f5ead292ab139fd0fdc`.
- Reconstructed red: `node --test test/project-assessment.test.mjs` failed against the unchanged base because `src/project-assessment.mjs` did not exist.
- Green: the recovered OpenCounter package passed all 148 tests both normally and with `RUDI_VERIFY_OFFLINE=1`; no provider tool, browser, project, continuation, reconciliation, or mutation was invoked during publication.
- Architecture blocker: changed-stack verification stops before package execution on the same eight oversized modules already enumerated above. Six are edited by the recovered historical release and two are existing package debt; broad extraction is explicitly outside issue #28. The remaining new project-assessment modules stay below the 800-line threshold.
- Structural scan: zero errors. Accepted warnings are the six edited oversized modules and ten operational/test-owned modules that are intentionally outside the public MCP entrypoint graph.
- Publication status: this release must remain a draft until maintainers either approve a narrowly scoped architecture baseline or authorize a separate extraction plan. No architecture exception or policy file is changed by this recovery.
