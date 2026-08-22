# Google Workspace Gmail Header Tools

## Phase 0: Baseline And Manual Lookup

- Status: Complete.
- Scope: recover the follower-only bounded Gmail header-search contract on current `origin/main`.
- Files inspected: the Google Workspace manifest, README, Gmail normalization and MCP entrypoint sources, Gmail contract test, repository instructions, and SWE testing/security guidance.
- Current state: `origin/main` does not expose `gmail_search_headers`; follower checkpoint `635989a` contains the implementation and tests.
- Risks and invariants: return only message/thread identity, observation time, and From/To/Cc/Bcc; never expose subject, snippet, body, attachment, token, or credentials; validate page size, IDs, timestamp, payload shape, and pagination token.

## Phase 1: Scope Lock

- Status: Complete.
- In scope: one additive `gmail_search_headers` MCP tool, its normalizer, direct Node/tsx launch metadata, tests, documentation, generated Registry index, and this ledger.
- Non-goals: mailbox sweep orchestration, CRM writes, OAuth changes, message-body retrieval, unrelated Workspace tools, or live account mutation.
- Expected files: `catalog/stacks/google-workspace/{README.md,gmail.test.cjs,manifest.json,src/gmail.ts,src/index.ts}`, generated `index.json`, and this file.
- Failure behavior: reject malformed provider messages, unsafe timestamps, invalid query/page-size input, and malformed pagination state without returning provider internals.

## Phase 2: Red Tests

- Observable behavior: the catalog exposes `gmail_search_headers` and its normalizer strips snippet, subject, and body fields.
- Red command: run the recovered `gmail.test.cjs` against unmodified `origin/main` sources.
- Expected failure: missing `normalizeGmailHeaderSearchPage` export and missing tool contract.
- Evidence: `npm run test:gmail` against `origin/main` plus only the recovered test exited 1 at the first contract boundary because the manifest still used `npx` instead of the required direct `node --import tsx` launch. The unchanged recovered test continues to the missing header-tool assertions once that boundary is restored.
- Exit criteria: the failure is observed before validating the recovered implementation.

## Phase 3: Implementation

- Status: Recovered from follower checkpoint `635989a` without broadening scope.
- Implementation rules: fixed Gmail metadata format and header allowlist; exact bounded page-size validation; portable stdio launch through `node --import tsx`; no new dependency.
- Observability: return a deterministic page object and optional next-page token only.

## Phase 4: Green Tests And Refactor

- Status: Complete.
- Green command: `npm run test:gmail` from `catalog/stacks/google-workspace`.
- Refactor constraints: no unrelated cleanup; retain the header-only boundary and existing account selection behavior.
- Regression checks: Google Workspace build plus Registry tests.
- CI architecture red: GitHub Actions run `32220961749` failed `npm run stacks:verify -- --changed-from f60b46e... --prepare` because `src/index.ts` grew from its 3,262-line debt baseline to 3,312 lines.
- Architecture green: Gmail search tool definitions and both search handlers moved into `src/gmail-search.ts`; the entrypoint is now 3,228 lines. The unchanged stack-verification command passed, including build and a live stdio surface check for 69 tools.

## Phase 5: Full Verification

- Status: Complete.
- Targeted tests: Google Workspace Gmail contract test and build.
- Full suite: Registry `npm test`.
- Build and catalog gates: `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack --dry-run --json`.
- Debt scan: Registry CI profile scoped to the two edited TypeScript files.
- Security checks: high-confidence credential scan, generated-junk review, package-size review, JSON parse, and scoped `git diff --check`.
- Live smoke: not required for publication because it would require mailbox credentials; the deterministic mocked contract proves the privacy boundary.
- Evidence: the unchanged Gmail command passed; the stack TypeScript build passed; Registry `npm test` passed 245/245; 152/152 packages validated; index sync/check and Registry build passed; package dry-run produced 958 files at 2,243,751 bytes packed; both repository-policy and package-scoped debt scans reported zero findings; JSON, whitespace, and high-confidence credential scans passed; production dependency audit reported zero vulnerabilities.
- Post-refactor evidence: Gmail test/build, changed-stack architecture verification, Registry 245-test suite, 152-package validation, Registry build, package-scoped debt scan, and whitespace checks all passed unchanged after the CI fix.
- Generated-artifact note: package verification created only `catalog/stacks/google-workspace/{dist,node_modules}`. The hygiene dry run identified exactly those two reproducible targets. They are ignored and excluded from the commit. A second clean worktree at commit `1178d74` passed `npm run catalog:clean:check` with zero targets. That clean checkout also exposed the required post-commit canonical `generatedAt` refresh, which was applied before publication.

## Phase 6: Docs, Contracts, And Closure

- Status: Complete.
- Documentation: README and manifest list the header-only contact-discovery surface.
- Accepted debt: no authenticated mailbox smoke in this follower acceptance pass.
- Definition of Done: issue #25 has a focused PR; red lineage is recorded; focused/full tests and Registry gates pass; index is regenerated; no unrelated Registry paths are included.
