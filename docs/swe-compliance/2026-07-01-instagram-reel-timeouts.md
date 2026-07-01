## Phase 0: Baseline And Manual Lookup

- Scope: `learnrudi/registry#7`, timeout-safe Instagram Reel publishing for `catalog/stacks/social-media-publisher`.
- Files inspected before editing: `AGENTS.md`, `src/adapters/instagram-profile.js`, `src/index.ts`, Instagram adapter tests, README, credential docs, manifests.
- Relevant SWE manual sections: Appendix C testing discipline, Appendix D debugging discipline, Appendix E API/status contracts, Appendix F secrets handling.
- Current-state commands: `git status -sb`; targeted red command listed in Phase 2.
- Risks and invariants: no duplicate Reels by default; status checks must not create/publish media; publish requires an existing finished container; tokens must not be printed.
- Exit criteria: failure localized to the one-call create/wait/publish flow and missing staged tool surface.

## Phase 1: Scope Lock

- In scope: staged Reel container creation, container status lookup, existing-container publish, tests, manifests, docs.
- Non-goals: Meta auth redesign, Instagram image/carousel redesign, queue worker redesign, UI work.
- Expected files touched: Instagram adapter, publisher MCP entrypoint, manifests, tests, README, credential docs, this compliance record.
- External inputs and trust boundaries: MCP args, Instagram account config, Meta container/status/publish API responses.
- Failure behavior to define: unfinished container, terminal failed container, status API failure, publish API failure, missing confirmation.
- Exit criteria: implementation constrained to issue #7 acceptance criteria.

## Phase 2: Red Tests

- Observable behavior to prove: create-container does not poll/publish; status check does not create/publish; publish refuses unfinished containers; exported dry-run helper exists.
- Test files added/edited: `test/adapters/instagram-profile.test.js`, `test/index.test.ts`.
- Red command: `npm test -- --test-name-pattern 'instagram|Instagram|instagramReelCreateContainer'`.
- Expected failure: new tests failed because staged adapter methods and exported helper were missing.
- Exit criteria: failures matched the investigated timeout/unknown-state behavior.

## Phase 3: Implementation

- Implementation rules: keep existing one-call publish path; add explicit staged tools; require confirmation for live create and publish.
- Files allowed to change: files listed in Phase 1 only.
- Validation and error-handling requirements: validate Reel payload before create; publish only `FINISHED` containers; return structured container status.
- Observability requirements: responses include container id, status code, finished/terminal flags, and next-step guidance.
- Exit criteria: unchanged red command passes.

## Phase 4: Green Tests And Refactor

- Green command: `npm test -- --test-name-pattern 'instagram|Instagram|instagramReelCreateContainer'`.
- Refactor constraints: no unrelated platform changes.
- Regression checks: existing Instagram validation tests included in targeted command.
- Exit criteria: targeted command passes.

## Phase 5: Full Verification

- Targeted tests: `npm test -- --test-name-pattern 'instagram|Instagram|instagramReelCreateContainer'` passed, 16/16.
- Full stack suite: `npm test` in `catalog/stacks/social-media-publisher` passed, 63/63.
- Stack build/typecheck: `npm run build` in `catalog/stacks/social-media-publisher` passed.
- Registry catalog validation: `npm run validate:v2` passed, 89/89.
- Registry root suite: `npm test` at repo root passed, 103/103.
- JS/TS debt scan: `node /Users/hoff/dev/dev-help/agent-debt-scan.js --repo /Users/hoff/dev/RUDI/apps/registry/catalog/stacks/social-media-publisher --graph-root src --files src/index.ts,src/adapters/instagram-profile.js,test/index.test.ts,test/adapters/instagram-profile.test.js --json` passed with 0 findings.
- Whitespace check: `git diff --check` passed.
- Live smoke checks: not run automatically because live container creation/publish would touch Meta state.
- Exit criteria: local verification passed; only live Meta container smoke remains intentionally manual.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README, credential setup docs, manifests/tool schemas.
- Final files touched: Instagram adapter, publisher MCP entrypoint, `manifest.json`, `manifest.v2.json`, Instagram adapter tests, publisher entrypoint tests, README, credential setup docs, and this compliance record.
- Commands run and results: listed in Phase 5.
- Accepted debt: no known blocking debt. Live Meta smoke is deferred because it would create or publish remote platform state.
- Definition of Done: PR references `#7`, tests/build/debt scan pass, docs match behavior.
