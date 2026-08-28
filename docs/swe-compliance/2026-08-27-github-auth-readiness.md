## Phase 0: Baseline And Manual Lookup

- Scope: correct `stack:github` authentication/readiness semantics and permission diagnostics.
- Files to inspect before editing: GitHub stack core, MCP registration, tests, manifest, package metadata, operator skill, and generated registry index.
- Relevant SWE manual sections: Security F2-F4/F13, Testing Doctrine, Agent Co-Pilot Standard, Horizontal Engineering Standard.
- Current state: token presence is reported as authentication; `/user` is not called; no auth-status MCP tool exists; PR writes return provider 403 for the configured fine-grained PAT.
- Horizontal-pattern scan: secret presence is already owned by RUDI; provider verification remains stack-owned. Do not add a third generic secret-store implementation.
- Risks and invariants: never expose token bytes; verified identity is not proof of endpoint authorization; provider failures remain bounded and actionable.
- Initial risk tier: High, because this is an authentication/authorization boundary.
- Exit criteria: baseline reproduced, exact scope locked, fresh worktree based on current `origin/main`.

## Phase 1: Scope Lock

- In scope: provider-verified `github_auth_status`, safe missing/invalid-token behavior, permission hints on GitHub 403 responses, tool/skill/manifest/version alignment, generated index.
- Non-goals: automatic token replacement, generic `rudi check` lifecycle redesign, credential copying, destructive GitHub operations, merge.
- Expected files touched: `catalog/stacks/github/{src/core.ts,src/github-api.ts,src/index.ts,tests/core.test.mjs,tests/mcp.test.mjs,manifest.json,package.json,package-lock.json}`, `catalog/skills/github.md`, `index.json`, and this checklist. `src/github-api.ts` was added after the Registry no-growth gate required the transport/auth boundary to be extracted from the 2,618-line `core.ts`.
- External inputs and trust boundaries: `GITHUB_TOKEN`, optional API base URL, GitHub `/user` and REST error responses.
- Failure behavior: missing token returns a safe unverified status; provider 401/403 is redacted and identifies the permission requirement when evidence is available.
- Authorized external actions: user authorized end-to-end implementation, feature-branch publication, local activation, and provider-permission correction. Merge is not authorized.
- Commit strategy: behavior/test slice first; catalog metadata/index slice after full green.
- Horizontal disposition: standardize the GitHub provider-status contract inside the existing stack; no generic lifecycle expansion.
- Exit criteria: contract and commit boundaries recorded before tests.

## Phase 2: Red Tests

- Observable behavior: token presence alone is not authentication; valid `/user`
  response returns a verified standard or Enterprise Managed User login; MCP
  exposes auth status; 403 errors surface safe permission guidance; unsafe API
  base URLs never echo embedded credentials.
- Test files: `tests/core.test.mjs`, `tests/mcp.test.mjs`.
- Red command: `npm run build && node --test --test-name-pattern='auth status|permission guidance' tests/core.test.mjs` and `npm run build && node --test tests/mcp.test.mjs`.
- Expected failure: missing async provider verification/tool/permission metadata.
  Independent review added two further red cases: a provider-valid login with
  an underscore was rejected, and credentials in a custom API URL were echoed.
- Exit criteria: each red failure is behavioral, not setup-related.

## Phase 3: Implementation

- Implement the smallest provider-verification and error-normalization change; add no dependencies.
- Validate all provider payload fields before returning them and never return auth headers or token-derived values.
- Keep `/user` identity proof distinct from endpoint permission proof.
- Exit criteria: red commands pass unchanged.

## Phase 4: Green Tests And Refactor

- Green command: exact Phase 2 commands and the full stack suite passed 21/21
  after the review findings were fixed.
- Refactor constraints: only after green; retain one request/error boundary.
- Commit checkpoint: stage task-owned stack/test paths only after focused and full stack green.
- Exit criteria: focused and full stack tests green with no token leakage.

## Phase 5: Full Verification

- Targeted complete: stack tests 21/21 and `npm run stacks:verify -- --stack
  stack:github` passed, including the no-growth architecture gate after the API
  boundary was extracted from `core.ts`.
- Full suite complete: Registry `npm test` passed 29 files and 252 tests.
- Build/contracts complete: 155 manifests validated, registry indexes current,
  build passed, catalog hygiene ended with 0 removable targets, `git diff
  --check` passed, and package dry-run produced `@rudi/github-stack@1.0.1`
  with 15 files.
- JS/TS debt: the packaged scanner exited 0 but reported zero graph files for
  this nested stack even with an explicit graph root; record this tooling gap.
  The repository-owned stack verification/no-growth debt gate passed.
- Live smoke: install/index on Admin Mac, call auth status, verify login `rudijetson`, and prove PR write only after provider permission is authorized.
- Independent review: review found the Enterprise Managed User format defect,
  unsafe API URL echoing, provider-reflected login risk, the missing-token launch
  gate, and two standard-update delivery defects: stale compiled output and
  stale persisted secret requirements. Stack-owned findings were reproduced red
  and fixed here; the delivery findings were reproduced red and fixed in the
  paired CLI 1.10.23 worktree. One final post-fix CLI review remains before commit.
- Exit criteria: no blocking finding and runtime readback matches source.

## Phase 6: Docs, Contracts, And Closure

- Update operator skill and generated index; record commands/results, commit ledger, PR URL, activation state, primary-Mac reconciliation, accepted debt, and proof gaps here.
- Worktree closeout: create a non-mutating closeout receipt before cleanup eligibility is considered.
- Definition of Done: all required gates, independent review, live identity and permission proof, publication readback, and paired-Mac reconciliation complete.
