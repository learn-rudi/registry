## Phase 0: Baseline And Manual Lookup

- Scope: `learnrudi/registry#6`, YouTube auth readiness and token error handling for `catalog/stacks/social-media-publisher`.
- Files inspected before editing: `AGENTS.md`, `src/index.ts`, `src/adapters/youtube-channel.js`, existing YouTube/readiness tests, README, credential docs.
- Relevant SWE manual sections: Appendix C testing discipline, Appendix D debugging discipline, Appendix E API error contracts, Appendix F security/secrets handling.
- Current-state commands: `git status -sb`; targeted red command listed in Phase 2.
- Risks and invariants: no secret values in output; readiness validation must not publish media; direct publishing must keep working.
- Exit criteria: issue branch created from `origin/main`; failure boundary localized to credential loading, readiness validation, and YouTube OAuth error mapping.

## Phase 1: Scope Lock

- In scope: YouTube stack env refresh, OAuth token error mapping, opt-in validated readiness, docs/tests for those behaviors.
- Non-goals: Instagram timeout flow, content matrix semantics, new platforms, secret storage redesign.
- Expected files touched: `src/index.ts`, `src/adapters/youtube-channel.js`, YouTube/readiness tests, README, credential docs.
- External inputs and trust boundaries: stack env file, OAuth token endpoint response, YouTube API response, MCP tool args.
- Failure behavior to define: missing config, revoked/expired refresh token, retryable OAuth/API dependency failure.
- Exit criteria: implementation constrained to issue #6 acceptance criteria.

## Phase 2: Red Tests

- Observable behavior to prove: OAuth `invalid_grant` maps to actionable auth error; validated readiness checks YouTube without publishing; stack env updates are visible after module startup.
- Test files added/edited: `test/adapters/youtube-channel.test.js`, `test/index.test.ts`.
- Red command: `npm test -- --test-name-pattern 'youtube|YouTube|socialCheckPublishReady'`.
- Expected failure: new tests failed because readiness did not validate auth/reload env and OAuth errors mapped to `youtube_auth_check_failed`.
- Exit criteria: failures matched the investigated behavior.

## Phase 3: Implementation

- Implementation rules: minimal changes, preserve existing lightweight readiness behavior, opt into live auth validation with `validateAuth`.
- Files allowed to change: files listed in Phase 1 only.
- Validation and error-handling requirements: stable auth error code/message/retryability; no secrets in responses; live check performs token refresh/channel lookup only.
- Observability requirements: readiness response includes `auth.checked`, `auth.ok`, and structured failure metadata.
- Exit criteria: unchanged red command passes.

## Phase 4: Green Tests And Refactor

- Green command: `npm test -- --test-name-pattern 'youtube|YouTube|socialCheckPublishReady'`.
- Refactor constraints: no unrelated publishing or adapter redesign.
- Regression checks: existing YouTube dry-run and direct upload confirmation tests included in targeted command.
- Exit criteria: targeted command passes.

## Phase 5: Full Verification

- Targeted tests: `npm test -- --test-name-pattern 'youtube|YouTube|socialCheckPublishReady'` passed.
- Full suite: package `npm test` passed; registry root `npm test` passed.
- Build/typecheck/lint: package `npm run build` passed; registry `npm run validate:v2` passed.
- JS/TS debt scan, if applicable: structural fallback scan passed with 0 findings for edited source files.
- Live smoke checks: non-publishing YouTube validated readiness passed with `auth.ok=true`; output redacted channel identifiers.
- Exit criteria: all local verification commands passed.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README and credential setup docs describe `validateAuth`.
- Final files touched: `src/index.ts`, `src/adapters/youtube-channel.js`, readiness/YouTube tests, README, credential setup docs, this compliance record.
- Commands run and results: targeted tests, full package tests, package build, registry validation, registry tests, debt scan, diff check, and live validated readiness smoke all passed.
- Accepted debt: no known blocking debt. The live smoke intentionally validates auth only and does not test media upload.
- Definition of Done: PR references `#6`, tests/build/debt scan pass, docs match behavior.
