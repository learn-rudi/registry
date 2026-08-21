# Managed AI API Client SWE Compliance Ledger

## Phase 0: Baseline And Manual Lookup

- Scope: add a new `stack:managed-ai` Registry package that exposes the approved Managed AI HTTP API to RUDI agents without PostgreSQL access.
- Files inspected before editing: repository and workspace `AGENTS.md`, Registry manifest/package patterns, `stack:rudi-share`, the accepted stripped-baseline artifact, and Cloud foundation API contracts/routes.
- Relevant SWE manual sections: Appendix E (API contracts, auth, idempotency, bounded responses, agent interfaces), Appendix F F1-F6/F12-F13, Appendix G G1-G4/G12-G13, and Appendix C red-green-refactor.
- Current state: canonical checkout clean; GitHub `origin/main` independently resolved to `fec3fd604057be3affbde4e6baa300771745ae07`; this worktree starts at that exact revision.
- Risks and invariants: bearer tokens never enter URLs/errors/output; tenant identity is fixed by configuration; only fixed v1 paths may be called; no SQL or provider polling exists; responses and timeouts are bounded; preparation never applies files or Git changes.
- Initial risk tier: high, because this is an authenticated cross-host client and includes approval/publication-preparation mutations.
- Exit criteria: exact baseline, instructions, trust boundaries, and non-goals are recorded before behavior edits.

## Phase 1: Scope Lock

- In scope: bounded client/organization context, interactions, observations/candidates, candidate decision, publication preparation, and bundle readback through the authenticated API.
- Non-goals: PostgreSQL drivers or tunnels, database migrations, connector polling, CRM business rules, file writes, Git operations, publication evidence, deployment, live API calls, and activation.
- Expected files touched: `catalog/stacks/managed-ai/**`,
  `catalog/skills/managed-ai.md`, the narrow retained Google Workspace
  Calendar/Gmail contract files, generated `index.json`, and this ledger.
- Scope amendment: after independent review on 2026-08-20, the root coordinator
  explicitly amended Task 3 to require this exact ledger path. Keeping and
  updating this file is therefore in scope; the amendment authorizes no live,
  deployment, Git publication, or broader documentation action.
- Integration amendment: Cloud checkpoint commit 2 consumes the Registry
  `calendar_discovery_page` contract and ordered Gmail add/delete history. The
  validated Calendar behavior and Gmail deletion invariant are therefore
  ported from the preserved CRM-hardening worktree into this current-main
  implementation lineage. The removed duplicate Gmail discovery surface is not
  revived.
- External inputs: environment configuration, MCP arguments, HTTP response status/headers/body, and all returned JSON are untrusted and validated or bounded.
- Failure behavior: fail closed on missing/invalid configuration, unknown fields, invalid identifiers/digests/timestamps/paths, timeout/network failure, oversized or malformed responses, and non-2xx responses; return stable non-secret MCP errors.
- Authorized external actions: source files, generated catalog index, tests/build/package verification only.
- Review and approval gates: no live request, install, deploy, commit, push, merge, or workspace/client mutation; independent read-only review is required before ready verdict.
- Exit criteria: tests name the observable boundary behavior and allowed file set remains unchanged.

## Phase 2: Red Tests

- Observable behavior: configured tenant and bearer auth are forced onto fixed API paths; query/body bounds and digest computation are deterministic; malformed/oversized responses fail closed; MCP tools expose only approved operations and return sanitized errors.
- Test files: `catalog/stacks/managed-ai/src/client.test.ts`, `contracts.test.ts`, and `mcp.test.ts`.
- Red command: `npm test` inside `catalog/stacks/managed-ai` before implementation.
- Expected failure: missing client/contracts/server modules.
- Evidence: the first run failed only on the three expected missing modules. A
  later self-audit added a streaming-body timeout test; the unchanged test
  command failed because the timer stopped after response headers. A Git-remote
  credential test also failed against the too-permissive SSH username rule.
- Remediation red command: `npm test` after the independent review. It failed 7
  expected checks: oversized 403 and stalled 401 status preservation, missing
  endpoint DTOs, unknown/null/token response rejection, conservative content
  length/schema reconciliation, and the pre-serialization output guard.
- Provider integration red commands: after installing only the lockfile-pinned
  ignored package dependencies, `npm run test:calendar` failed because
  `normalizeCalendarDiscoveryPage` did not exist, and `npm run test:gmail`
  failed because the expected `["messageAdded", "messageDeleted"]` contract did
  not exist. The Managed AI stack response test also failed because candidate
  listing did not yet accept Cloud's exact `target` and `patch_operations`
  review fields.
- Calendar timestamp red command: `npm run test:calendar` accepted the invalid
  date `2026-02-31` through JavaScript normalization and failed the new strict
  boundary assertion. The unchanged focused command passed after Calendar
  windows and event starts adopted real RFC3339 calendar-component checks.
- Exit criteria: complete; both intended failures were observed before their fixes.

## Phase 3: Implementation

- Implementation rules: pure validation/digest helpers separate from HTTP; one fixed configured tenant; static route construction; bearer header only; no credential interpolation; `additionalProperties: false` tool schemas; no raw SQL or filesystem/Git APIs.
- Files allowed to change: Phase 1 list only.
- Validation/error handling: UUID/SHA/date/revision/enum/length/page bounds, exact publication target allowlist, abort timeout, maximum response bytes, bounded JSON structure, stable retry classification.
- Observability: non-secret correlation ID on each request and stable error code/status/retryability returned to the MCP boundary.
- Exit criteria: red tests pass with no scope expansion.
- Implementation result: complete. The HTTP timeout now covers response-body
  streaming, and Git remotes reject HTTPS userinfo and non-`git` SSH usernames.
- Remediation result: every successful endpoint is checked against a closed
  response DTO at both the HTTP and MCP serialization boundaries. The checks
  require endpoint-specific identifiers, states, replay flags, cursors, and
  digests, and reject unknown/missing/mismatched fields, null mutation success,
  bearer-token echoes, and raw-provider payload keys. Non-2xx status is
  classified before any body read, real RFC3339 calendar dates are checked
  without `Date.parse` normalization, and publication content is capped at
  5,000 Unicode code points plus 20,000 UTF-8 bytes.

## Phase 4: Green Tests And Refactor

- Green command: unchanged stack-local `npm test`.
- Refactor constraints: only deduplicate pure parsing/schema helpers; preserve fixed API operations and safety checks.
- Regression checks: stack-local build and tests after any refactor.
- Exit criteria: green remains green.
- Result: remediation green/refactor command `npm test && npm run build` passes
  23/23 stack tests and TypeScript compilation.
- Provider/client integration result: Calendar and Gmail focused tests and the
  Google Workspace TypeScript build pass. The Managed AI stack remains 23/23
  green and now validates the exact target and bounded patch-operation fields
  an approver must inspect before a decision.

## Phase 5: Full Verification

- Targeted tests: stack-local `npm test` and `npm run build`.
- Full suite: Registry `npm test`.
- Build/typecheck/lint: Registry `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, and `npm run build`.
- JS/TS debt scan: repository `npm run debt:scan` plus focused structural scan if needed.
- Live smoke checks: prohibited; all HTTP is injected in tests and no production service is contacted.
- Independent review: read-only fresh-context review against task contract, diff, and evidence.
- Risk-tier approval: source-only implementation follows Brandon's accepted stripped baseline; activation still requires separate approval.
- Exit criteria: required Registry gates and package dry-run succeed, or exact gaps are recorded.
- Results: Registry `npm test` 246/246; `npm run validate` 155/155;
  `indexes:sync` and `indexes:check` current at catalog hash root
  `01183fcf58711f32bbca8a21fbc7cac20cab5553c53520f99d6f952076bad6c7`;
  catalog clean reports zero targets after removing only the task-created
  Google Workspace and Managed AI stack `dist`/`node_modules` directories;
  Registry build passes; `npm pack --dry-run --json` exits 0 for
  `@rudi/registry@2.0.0` with 976 entries. The final dry-run shasum is recorded
  outside the package in the orchestration ledger so the packaged evidence does
  not contain a self-referential digest. Repository and focused stack debt scans
  report zero findings.
- Live smoke: intentionally not run because live API use/installation/activation
  is outside authorization.
- Independent review: a fresh-context review identified four blockers covering
  response DTOs, non-2xx body-read classification, RFC3339/content limits, and
  explicit ledger scope. All four are remediated and the full gate matrix is
  green. The current run also reconciled Cloud's exact proposal review fields
  and retained provider contracts; immutable-SHA integration review remains a
  later gate.

## Phase 6: Docs, Contracts, And Closure

- Docs: stack README, operator skill, manifest boundary/security guidance, and this ledger.
- Evidence: exact revision, diff digest, command results, file list, boundary scan, and review status are written to the orchestration artifacts directory.
- Final verdict: the independent review blockers are remediated; implementation
  and required executable gates are green and accepted for a local checkpoint.
  Installation, live use, and immutable-SHA integration acceptance remain
  separately gated.
- Accepted debt: none introduced. The Registry root's existing lock reported
  eight audit findings during `npm ci`; this task did not alter root dependencies
  or run an out-of-scope audit fix. The new stack's isolated install reported
  zero vulnerabilities. The existing Google Workspace lock reported five
  moderate findings; its dependencies were not changed and no out-of-scope
  automatic audit fix was run.
- Proof gaps: no live smoke by authorization; the remediation follow-up has not
  been committed, pushed, deployed, installed, activated, or exercised against
  a live API.
- Definition of Done: source-ready diff is reviewable, tests/gates pass, no secret/runtime/live effects occurred, and activation remains explicit.
