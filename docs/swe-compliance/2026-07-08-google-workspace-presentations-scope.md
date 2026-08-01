## Phase 0: Baseline And Manual Lookup

- Scope: Add Google Slides presentations OAuth scope to the RUDI Google Workspace stack auth contract.
- Files to inspect before editing: `catalog/stacks/google-workspace/src/auth.ts`, `README.md`, generated installed stack auth files, existing tests.
- Relevant SWE manual sections: Appendix C testing doctrine, core boundary/security principles.
- Current-state commands: `rg "SCOPES|presentations|GOOGLE_CREDENTIALS" catalog/stacks/google-workspace --glob '!node_modules/**'`.
- Risks and invariants: Do not print or commit OAuth secrets or tokens; keep RUDI state under `~/.rudi/state`; update installed runtime copy for immediate local auth.
- Exit criteria: Source and installed auth helpers request `https://www.googleapis.com/auth/presentations`.

## Phase 1: Scope Lock

- In scope: OAuth scope list, README scope documentation, focused source test, installed local stack sync, re-auth smoke verification.
- Non-goals: Implementing full RUDI Slides MCP tools, changing Gmail/Drive restricted scopes, changing Google Cloud configuration.
- Expected files touched: `auth.test.cjs`, `src/auth.ts`, `README.md`, generated `dist/auth.js`, this checklist; installed stack mirrors for immediate use.
- External inputs and trust boundaries: Google OAuth credentials and tokens remain private local state/secrets.
- Failure behavior to define: If auth fails, stop and report the Google OAuth error without printing secret values.
- Exit criteria: Scope/test plan is locked before implementation.

## Phase 2: Red Tests

- Observable behavior to prove: RUDI Google Workspace auth contract includes the Google Slides presentations scope.
- Test files to add or edit: `catalog/stacks/google-workspace/auth.test.cjs`.
- Red command: `node auth.test.cjs`.
- Expected failure: `auth must request the Google Slides presentations scope`.
- Exit criteria: Red failure observed before source patch.
- Result: Failed as expected with `AssertionError [ERR_ASSERTION]: auth must request the Google Slides presentations scope`.

## Phase 3: Implementation

- Implementation rules: Smallest change; add only the missing scope; update docs and generated installed runtime.
- Files allowed to change: Google Workspace stack auth source/docs/test/build output and installed mirror.
- Validation and error-handling requirements: Preserve existing OAuth validation and token write behavior.
- Observability requirements: Verify token metadata by scope names only, never token values.
- Exit criteria: Source and installed files include the presentations scope.

## Phase 4: Green Tests And Refactor

- Green command: `node auth.test.cjs`.
- Refactor constraints: No unrelated auth refactor.
- Regression checks: `npm run build`.
- Exit criteria: Targeted test and build pass.
- Result: `npm run test:auth && npm run test:state && npm run test:tasks && npm run build` passed.

## Phase 5: Full Verification

- Targeted tests: `node auth.test.cjs`.
- Full suite: Relevant stack tests where practical.
- Build/typecheck/lint: `npm run build`.
- JS/TS debt scan, if applicable: Run scanner/fallback for edited JS/TS source.
- Live smoke checks: Re-auth `rudi@learnrudi.com` and verify token scope list includes presentations.
- Exit criteria: No blocking verification gaps.
- Result: Registry `npm test`, `npm run build`, RUDI debt scan, `rudi index --json`, and OAuth re-auth all passed. New token has 8 scopes including `https://www.googleapis.com/auth/presentations`.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README scope list.
- Final files touched: Record in final response.
- Commands run and results: Record red/green/build/smoke results.
- Accepted debt: RUDI Slides MCP editing tools remain a separate implementation step.
- Definition of Done: Auth contract and local token include presentations scope without exposing secrets.
- Closure status: Complete for OAuth scope update.
