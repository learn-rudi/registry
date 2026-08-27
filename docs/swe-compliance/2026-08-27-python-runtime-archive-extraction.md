# Python Runtime Archive Extraction Repair

## Phase 0: Baseline And Manual Lookup

- Scope: correct the public `runtime:python` extraction contract for the existing signed Darwin archives.
- Files inspected before editing: `AGENTS.md`, `catalog/runtimes/python.json`, `index.json`, `schemas/package.schema.json`, `src/extract-schema.test.ts`, Registry generation scripts, and the CLI registry-client extraction implementation and tests.
- Relevant SWE manual sections: Engineering Quick Reference; Testing Doctrine; Infrastructure And Deployment Engineering Standard; Agent Co-Pilot Operating Standard; Horizontal Engineering And Codebase Stewardship Standard; RUDI Agentic Engineering Standard.
- Current-state commands: `git status --short --branch`; `git rev-parse HEAD origin/main`; archive SHA-256 and `tar -tzf` inspection for both Darwin assets; Admin and primary-Mac `rudi check runtime:python --json`.
- Horizontal-pattern scan: Node, ripgrep, pandoc, and rclone manifests already use `strip: 1` for one-root archives; the Python entry is contract drift, not a third extraction implementation.
- Risks and invariants: both published checksums and URLs remain unchanged; `bin/python3` and `bin/pip3` must exist after extraction; generated `index.json` must come only from the canonical manifest; unrelated dirty worktrees must remain untouched.
- Initial risk tier and rationale: medium, because this changes a published runtime-installation contract and must be proven on both supported Darwin architectures.
- Exit criteria: clean isolated worktree, accepted base and instructions recorded, scope and proof commands locked.

## Phase 1: Scope Lock

- In scope: add a focused catalog contract test; add `strip: 1` for `darwin-arm64` and `darwin-x64`; regenerate `index.json`; run Registry and live-install proof; publish through the authorized branch/PR/merge workflow; verify both Macs.
- Non-goals: no archive replacement, checksum or Python version change, CLI extraction change, NFL repository change, dependency update, runtime-state migration, or cleanup of unrelated worktrees.
- Expected files touched: `catalog/runtimes/python.json`, `src/runtime-catalog-contract.test.ts`, generated `index.json`, and this evidence record.
- External inputs and trust boundaries: GitHub release archives, their catalog checksums, the generated public index, RUDI cache refresh, GitHub PR/CI state, and SSH readback from the primary Mac.
- Failure behavior to define: an omitted or incorrect strip rule fails the focused test; an archive mismatch, missing runtime binary, failed gate, dirty-state collision, failed review, or failed CI stops publication or merge.
- Authorized external actions: user authorized commit, push, pull request, merge, and two-host verification by directing execution of the previously printed map.
- Commit strategy and authorization: commit 1 contains the green behavior slice (test, manifest, generated index); commit 2 records final verification and closeout evidence. Both commits and publication are authorized.
- Horizontal-obligation disposition: standardize the existing manifest contract in this change; no new shared implementation and no remaining consolidation obligation.
- Review and approval gates: red-green proof, full prescribed checks, isolated x64 and arm64 installs, independent read-only review, green GitHub CI, and exact merged-revision readback.
- Exit criteria: no scope ambiguity and no collision with existing Admin or primary-Mac dirty work.

## Phase 2: Red Tests

- Observable behavior to prove: every supported Python Darwin archive declares removal of its single leading directory before mapped runtime binaries are checked.
- Test files to add or edit: add `src/runtime-catalog-contract.test.ts`.
- Red command: `npx vitest run src/runtime-catalog-contract.test.ts`.
- Expected failure: both platform entries expose `extract.strip` as `undefined` instead of `1`.
- Exit criteria: the focused test fails only for the missing catalog behavior.

## Phase 3: Implementation

- Implementation rules: make the smallest manifest-only behavior change and regenerate outputs through repository scripts.
- Files allowed to change: the four paths named in Phase 1 only.
- Validation and error-handling requirements: preserve schema validity, URLs, checksums, version, and mapped binaries; fail closed on any generated-index drift or installation failure.
- Observability requirements: retain exact commands, exit results, archive hashes, install readbacks, CI result, and commit/merge identities in this record.
- Exit criteria: unchanged red test passes and `index.json` carries the same extract contract.

## Phase 4: Green Tests And Refactor

- Green command: `npx vitest run src/runtime-catalog-contract.test.ts`.
- Refactor constraints: no refactor is expected; do not change generic extraction code or schema.
- Regression checks: focused test plus `npm run indexes:sync` and `npm run indexes:check`.
- Commit checkpoint: stage and inspect only the test, manifest, generated index, and this record before the behavior commit.
- Exit criteria: focused behavior and generated-index checks are green.

## Phase 5: Full Verification

- Targeted tests: focused runtime catalog contract and extract-schema suite.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`; `npm run indexes:sync`; `npm run indexes:check`; `npm run catalog:clean:check`; `npm run stacks:verify -- --changed-from origin/main --prepare`; `npm run build`; `npm run release:verify`; `npm pack --dry-run --json`.
- JS/TS debt scan: `npm run debt:scan` and the RUDI `swe_debt_scan` changed-file scan.
- Live smoke checks: isolated `RUDI_HOME` install and `rudi check runtime:python` on Admin x64 and primary arm64, first against the task source and then against the merged public index.
- Independent review: fresh read-only review against the task contract, instructions, diff, and verification evidence.
- Risk-tier approval: medium-risk acceptance requires all local gates, independent review, and remote CI to be green before merge.
- Exit criteria: no unexplained blocking result or architecture-specific proof gap.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: this compliance record only; existing schema documentation already defines `strip` correctly.
- Final files touched: pending.
- Commands run and results: pending.
- Evidence artifacts: pending.
- Independent-review result: pending.
- Commit ledger and publication status: pending.
- Horizontal obligations opened, closed, or accepted: the Python manifest drift is to be closed by the verified catalog correction; no broader obligation is expected.
- Final verdict: pending.
- Accepted debt: none currently.
- Proof gaps: pending completion of implementation, review, publication, and two-host readback.
- Definition of Done: focused and full proof green; public index merged; official fresh installs succeed on x64 and arm64; both Macs report ready; closeout receipt recorded; unrelated dirty work preserved.
