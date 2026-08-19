# Dwellow Live-Contract Publication Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: recover and publish the follower-only Dwellow README, package scripts, deterministic contract assertions, and explicitly gated live-contract verifier.
- Recovery base: Registry PR #34 (`fix/27-midjourney-login-lifecycle`). Exact follower state is preserved at checkpoint `635989a7d941271450c92f5ead292ab139fd0fdc`.
- Files read: package metadata, README, contract tests, live-contract test, manifest, implementation entrypoint, Registry validation/verifier code, and applicable repository instructions.
- Invariants: default tests require no live database; live tests skip safely unless explicitly enabled; no database mutation; no secret/database URL/private row appears in source, logs, or proof.
- Exit criteria: the recovered live test demonstrates its intended skip or contract failure on the unchanged base.

## Phase 1: Scope Lock

- In scope: `catalog/stacks/dwellow-mcp/{README.md,package.json,test/contract.test.mjs,test/live-contract.test.mjs}`, this checklist, and generated `index.json`.
- Non-goals: runtime behavior changes, dependency additions, credential installation, production database writes, fixture changes, or unrelated Registry cleanup.
- Failure behavior: absent opt-in or database URL skips explicitly; enabled malformed/unavailable live dependencies fail without printing connection details.
- Exit criteria: only the listed paths change and no live mutation surface is added.

## Phase 2: Red Or Gated Baseline

- Command: run the recovered `live-contract.test.mjs` against the unchanged base.
- Expected result: explicit safe skip when live prerequisites are absent, or a contract failure attributable to missing recovered package metadata—not an environment crash or network write.
- Exit criteria: baseline outcome and reason are recorded.

## Phase 3: Implementation Recovery

- Restore the four checkpoint paths without modifying runtime source or dependencies.
- Validate package JSON and exact test gating at the process boundary.
- Exit criteria: default contract tests and the opt-in test contract are deterministic.

## Phase 4: Green Tests And Refactor

- Run the package default suite, the live test without opt-in, and changed-stack verification.
- No refactor is planned; any necessary fix must remain test/documentation-only.
- Exit criteria: default tests pass and live behavior skips safely when prerequisites are absent.

## Phase 5: Full Verification

- Run Registry tests, validation, build, index sync/check, clean-worktree catalog hygiene, package dry-run, dependency audit, JSON/whitespace/secret checks, and applicable JS debt scan.
- Do not enable a live production database or mutate external state.
- Exit criteria: all applicable gates pass or a precise blocker is recorded.

## Phase 6: Docs And Closure

- Record exact commands/results, accepted skips, changed paths, PR, and CI state.
- Definition of Done: default verification remains dependency-free, live verification is explicit and safe, documentation matches scripts, and no sensitive or mutable external state is touched.

## Execution Record

- Status: publication verification in progress on 2026-08-19 ET.
- Gated baseline: the recovered live-contract test run against the unchanged base passed its parser case and explicitly skipped the hosted comparison because `DWELLOW_MCP_LIVE_TEST` was absent (one pass, one skip).
- Default green: `npm run verify` passed syntax and both deterministic contract tests while safely skipping the hosted case (two pass, one skip).
- Live read-only green: `npm run verify:live` called only public MCP `tools/list`; both parser and exact 19-tool manifest comparison passed in 383 ms. No business tool, credential, database URL, or mutation was involved.
- Changed-stack verification: passed via the package-owned verify script (one package passed, zero failed).
- Registry gates: 28 test files / 245 tests passed; 152/152 catalog packages validated; build/compile passed.
- JS debt scan: zero findings for the two edited test modules. Production runtime source is unchanged.
- Safety/dependencies: JSON and whitespace checks passed; no risky filename or secret-pattern addition was found; production npm audit reported zero vulnerabilities.
