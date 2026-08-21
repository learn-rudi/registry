# Google Workspace Shared Drives SWE Compliance Checklist

Task: expand `stack:google-workspace` Drive tools so authenticated callers can
safely target Google Shared Drives while preserving existing My Drive behavior.

Status: rollout complete; post-restart Codex desktop invocation remains pending

Risk tier: high. The change affects authenticated, agent-facing API contracts
and third-party write operations. Provider writes and destructive operations
require explicit safety behavior, deterministic identifiers, and bounded retry
rules.

## Phase 0: Baseline And Manual Lookup

- Scope: Drive tool schemas and handlers, deterministic behavior tests,
  operator documentation, package versioning, generated registry artifacts,
  installed-stack activation, and cross-host verification.
- Files inspected before editing:
  - `AGENTS.md`
  - `catalog/stacks/google-workspace/manifest.json`
  - `catalog/stacks/google-workspace/package.json`
  - `catalog/stacks/google-workspace/package-lock.json`
  - `catalog/stacks/google-workspace/src/index.ts`
  - `catalog/stacks/google-workspace/src/auth.ts`
  - `catalog/stacks/google-workspace/src/accountStorage.ts`
  - `catalog/stacks/google-workspace/src/authIdentity.ts`
  - `catalog/stacks/google-workspace/src/authTokenBinding.ts`
  - `catalog/stacks/google-workspace/src/gmail.ts`
  - `catalog/stacks/google-workspace/drive.test.cjs`
  - `catalog/stacks/google-workspace/README.md`
  - `catalog/skills/google-workspace.md`
  - registry index/build/release/debt scripts and schemas
  - installed primary and admin-Mac package/router state (read-only)
- Relevant SWE manual sections:
  - master doctrine Appendix C, especially C7A red-green-refactor
  - API Standard E2-E4 and E6-E12: schemas, errors, compatibility,
    idempotency, pagination, documentation, and agent interfaces
  - Security Standard F2, F3, F5, and F13: identity, authentication,
    untrusted tool arguments, bounded authority, and human gates
  - Backend Standard G2 and G4: explicit operations, side effects, retry, and
    partial-failure behavior
  - Infrastructure Standard H1-H6 and H10: traceable artifacts, rollout,
    rollback, runtime lifecycle, and post-update verification
- Current-state commands:
  - `git fetch --prune origin`
  - `git status --short --branch`
  - `git rev-parse HEAD`
  - `git rev-parse origin/main`
  - targeted `rg`/`sed` inspection of Drive schemas, handlers, tests, auth
    helpers, package metadata, index/router contracts, and docs
- Baseline:
  - clean detached worktree at `a04260241d3a22f5d2a41e453a3adcaf50ab7c58`
  - fetched `origin/main` matched the worktree revision
  - task branch created as `codex/google-workspace-shared-drives`
  - package and manifest version `1.0.2`; MCP server reports `1.0.0`
  - Drive tools lack per-call account selection and Shared Drive support
  - primary installed package is derived state and must not be edited directly
- Risks and invariants:
  - no credential, token, secret, or unrelated account inventory may be logged
  - omitting `drive_id` must retain My Drive behavior
  - Shared Drive calls must select one explicit account and drive
  - pagination must be bounded and must not lose continuation tokens
  - mutating retries must not create silent duplicates
  - returned writes must expose the durable provider file ID
  - download proof must hash the bytes that were actually written
  - permanent deletion and public-sharing expansion are not part of this
    Shared Drive release
- Initial risk tier and rationale: high because authenticated agent calls can
  create, replace, or move third-party data and an account-selection failure can
  target the wrong tenant.
- Exit criteria: source of truth, interfaces, trust boundaries, compatibility
  behavior, rollback, and proof commands are explicit before behavior code.

## Phase 1: Scope Lock

- In scope:
  - add `account` to every Drive tool and use the canonical resolver
  - add automatic Shared Drive flags to list/create/get/update operations
  - add explicit `drive_id`, `corpora`, `page_token`, and bounded page-size
    support where applicable
  - return rich file metadata and structured provider references
  - preserve legacy text payloads while adding structured MCP results
  - add explicit collision policies for uploads and folders; preserve the
    legacy create-new default in My Drive and default to fail in an explicitly
    selected Shared Drive
  - make moves a no-op when already at the exact destination
  - compute local SHA-256 during download and return it with the read-back
  - extract Drive behavior from the already-oversized `src/index.ts`
  - update public docs, operator skill, package version, and generated index
- Non-goals:
  - no OAuth scope, credential, token, or account-storage migration
  - no router/CLI or package-schema change unless a failed contract test proves
    one is required
  - no Shared Drive support for `drive_make_public` or `drive_delete`
  - no Google Drive mutation during the live smoke gate
  - no native Google Docs export/checksum contract
- Expected files touched:
  - `catalog/stacks/google-workspace/src/index.ts`
  - `catalog/stacks/google-workspace/src/drive.ts` (new)
  - `catalog/stacks/google-workspace/src/driveSchemas.ts` (new; tool contract
    definitions extracted to keep the behavior module comfortably below the
    new-module debt cap)
  - `catalog/stacks/google-workspace/src/gmail.ts` and `gmail.test.cjs`
    (shared runtime account resolver security fix required by independent
    review; the resolver is used across Google Workspace tools)
  - `catalog/stacks/google-workspace/state.test.cjs` (persisted account values
    use the same canonical email/path boundary before any account-directory
    lookup)
  - `catalog/stacks/google-workspace/drive.test.cjs`
  - `catalog/stacks/google-workspace/README.md`
  - `catalog/stacks/google-workspace/manifest.json`
  - `catalog/stacks/google-workspace/package.json`
  - `catalog/stacks/google-workspace/package-lock.json`
  - `catalog/skills/google-workspace.md`
  - `index.json` (generated)
  - this checklist
- Interface contract:
  - every Drive tool accepts optional `account`
  - every call with `drive_id` requires an explicit valid per-call `account`;
    only My Drive calls may fall back to the active account
  - list accepts `query`, `max_results`, `page_token`, `drive_id`, and
    `corpora`; `drive_id` selects `corpora=drive` unless explicitly supplied
  - list returns the legacy file-array text plus structured
    `{files,nextPageToken,incompleteSearch}`
  - ID-based read/write tools accept optional `drive_id`; a mismatch fails
    before a write
  - upload accepts optional `drive_id`, `folder_id`, and
    `collision_policy=create_new|fail|reuse_if_same`
  - folder creation accepts optional `drive_id`, `parent_id`, and
    `collision_policy=create_new|fail|reuse`
  - writes return stable provider references containing account, file ID,
    drive ID, parents, name, MIME type, links/resource key, size, timestamps,
    and provider checksums where present
  - download returns output path, byte count, and locally computed SHA-256
- External inputs and trust boundaries:
  - all MCP arguments are untrusted and validated before Google or filesystem
    calls
  - runtime account inputs use the same canonical email/path validation as the
    authentication and account-storage boundaries
  - local source/output paths are caller-selected filesystem boundaries
  - Google responses are untrusted nullable provider data and normalized
  - account and Drive identifiers are explicit and never inferred from names
- Failure behavior:
  - reject invalid page bounds/corpora/drive combinations before API calls
  - reject wrong-Drive IDs before content update or move
  - fail closed on multiple exact-name collisions
  - after ambiguous provider failures, surface the error and provider context;
    do not retry writes internally
  - clean up a partial download output on stream/hash failure when safe
- Authorized external actions:
  - implementation, local tests/build/generation, local task branch, and a
    task-only local commit are authorized
  - live Google verification is read-only
  - primary/admin installed updates occur only after code acceptance
  - push and pull-request creation require explicit user authorization
- Review and approval gates:
  - high-risk change requires a fresh-context read-only review
  - Shared Drive smoke must use the approved business account and Drive ID but
    must not print any broader account inventory
  - admin Mac changes wait for a published/accepted Git revision
- Rollback: reinstall the prior published stack version or update back to the
  previous registry commit; My Drive clients continue using the legacy text
  response throughout the additive rollout.
- Version rationale: `2.0.0`. Shared Drive inputs/results are additive, but the
  independent security review required the shared runtime `account` contract
  to accept only canonical email addresses. The earlier public schema said
  "email/name", so rejecting aliases is correctly treated as a breaking
  boundary change across all per-call-account tools rather than hidden inside
  a minor release.
- Exit criteria: scope/interface recorded and approved by execution request;
  proceed one red behavior at a time.

## Phase 2: Red Tests

- Observable behavior to prove:
  1. account selection and Shared Drive list parameters
  2. pagination envelope and legacy content compatibility
  3. invalid corpora/Drive combinations fail before provider access
  4. exact-parent escaping and collision outcomes
  5. upload provider ID and retry-safe reuse behavior
  6. pre-write Drive mismatch rejection and idempotent move
  7. download byte count and local SHA-256
- Test file: `catalog/stacks/google-workspace/drive.test.cjs`
- Red command: `npm run test:drive` after each next behavior was introduced.
- Observed red sequence:
  - missing `src/drive.ts` before list-contract extraction
  - absent Shared Drive flags, selected-account routing, and continuation data
  - missing MCP schemas and handler delegation
  - absent exact-parent escaping/pagination, collision policies, provider IDs,
    update-in-place, move no-op, and atomic download/hash behavior
  - absent canonical account rejection, explicit-account rules, persisted-state
    hardening, and implicit Shared Drive ID preflight rejection
  - schema advertised fractional `max_results` before changing it to `integer`
- Every red failed on the newly asserted missing behavior before the smallest
  corresponding implementation was added; provider-write fakes also asserted
  that validation failures occurred before side-effect methods.
- Exit criteria: the exact test fails for the expected missing behavior before
  its smallest implementation is added.

## Phase 3: Implementation

- Implementation rules:
  - extract schema and behavior to `src/drive.ts`; do not increase the accepted
    oversized-module baseline
  - use dependency injection for deterministic provider contract tests
  - derive Google Shared Drive flags centrally
  - use Node built-ins rather than adding dependencies
  - maintain legacy textual results while adding structured data
- Files allowed to change: only the Phase 1 expected list unless a test exposes
  a necessary adjacent contract; any expansion must be recorded first.
- Validation and error handling: normalize strings, bound integers, validate
  enums and cross-field invariants, check local files, normalize nullable
  provider responses, and add operation context without exposing secrets.
- Observability: return selected account/Drive and stable provider IDs in
  successful structured results; errors identify operation and safe resource
  identifiers but omit token/credential material.
- Exit criteria: every Phase 2 behavior is green with no disconnected handler
  or placeholder implementation.

## Phase 4: Green Tests And Refactor

- Green command: `npm run test:drive`
- Refactor constraints: refactor only while focused tests are green; reduce
  `src/index.ts` and keep Drive behavior isolated.
- Regression checks: all existing Google Workspace package tests plus
  TypeScript build and verifier.
- Green/refactor evidence:
  - `npm run test:drive` passed after each incremental implementation and after
    extraction/type cleanup.
  - `npm run test:gmail` passed after canonical account-resolution changes.
  - `npm run test:state` passed after invalid persisted-account rejection and
    normalized account switching were added.
  - `npm exec tsc -- --noEmit` passed after the final behavior/type refactor.
- Exit criteria: focused suite stays green after extraction and cleanup.

## Phase 5: Full Verification

- Targeted tests: `npm run test:drive`
- Full package suite: all `test:*` scripts in `package.json`
- Build/typecheck: `npm exec tsc -- --noEmit`, `npm run build`, `npm run verify`
- JS/TS debt scan: focused manual scan, root `npm run debt:scan`, and stack
  verifier debt gate
- Registry gates: `npm test`, `npm run validate`, index sync/check, clean check,
  changed-stack verification with prepare, build, release verification, and
  package dry run
- Live smoke: bounded explicit-account Shared Drive list and optional download
  of one existing blob into a temporary local directory; no provider writes
- Independent review: fresh-context review of task contract, instructions,
  task diff, commands, and smoke evidence
- Risk-tier approval: no unresolved high/medium finding before local commit or
  installed update
- Current deterministic evidence:
  - all seven package-owned `test:*` scripts passed
  - package `npm run build`, `npm run verify`, and `npm pack --dry-run --json`
    passed; verifier reported 68 MCP tools
  - focused debt scan reported zero findings across the four edited TS modules
  - registry `npm test` passed 246 tests; `npm run validate` passed 153 catalog
    packages
  - `npm run indexes:sync` and `npm run indexes:check` passed
  - `npm run stacks:verify -- --stack stack:google-workspace` passed the one
    selected stack and its 68-tool surface
  - root `npm run debt:scan`, `npm run build`, `npm run release:verify`, and
    `npm pack --dry-run --json` passed
  - staged `npm run validate:public -- --json` passed with zero errors, zero
    warnings, and 153 referenced packages
  - after explicit user confirmation, `npm run catalog:clean` removed only the
    ignored reproducible stack `dist` and `node_modules` directories; the
    isolated smoke home was moved to Trash, and the final
    `npm run catalog:clean:check` passed with zero targets
  - isolated temporary-RUDI-home installation from this local Registry resolved
    and copied `stack:google-workspace` 2.0.0; the empty isolated home then
    failed closed at the expected missing-secret gate and indexed zero tools
  - admin-Mac preflight re-read the workspace and Registry `AGENTS.md` files,
    verified the exact clean `main` checkout and expected ignored build/dependency
    directories, fetched GitHub, then fast-forwarded the clean baseline from
    `fec3fd6` to current accepted `origin/main` at `a042602`; no task branch or
    installed package was transferred before publication
- Command corrections recorded:
  - the stack has no aggregate `npm test`; the gate is the complete set of
    package-owned `test:*` scripts
  - changed-stack verification requires canonical ID `stack:google-workspace`,
    not the rejected shorthand `google-workspace`
- Exit criteria: all gates green or a proof gap is explicitly accepted.

## Phase 6: Docs, Contracts, And Closure

- Docs/API contracts: package README and operator skill describe account,
  Shared Drive, pagination, collision, provider-reference, and read-back rules.
- Final implementation files touched:
  - `catalog/skills/google-workspace.md`
  - `catalog/stacks/google-workspace/README.md`
  - `catalog/stacks/google-workspace/drive.test.cjs`
  - `catalog/stacks/google-workspace/gmail.test.cjs`
  - `catalog/stacks/google-workspace/state.test.cjs`
  - `catalog/stacks/google-workspace/manifest.json`
  - `catalog/stacks/google-workspace/package.json`
  - `catalog/stacks/google-workspace/package-lock.json`
  - `catalog/stacks/google-workspace/src/drive.ts`
  - `catalog/stacks/google-workspace/src/driveSchemas.ts`
  - `catalog/stacks/google-workspace/src/gmail.ts`
  - `catalog/stacks/google-workspace/src/index.ts`
  - generated root `index.json`
  - this compliance checklist
- Adjacent canonical CLI scope proved necessary by failed downstream exposure:
  - repository `/Users/hoff/dev/rudi/apps/platform/cli`, isolated branch
    `codex/codex-portable-rudi-tool-names`
  - `src/commands/integrate.js` and its focused Codex integration test add the
    portable router-name environment contract and the safety-preserving
    `default_tools_approval_mode="writes"` setting
  - `src/commands/shims.js` and a new focused test resolve the installed CLI
    entrypoint through its global symlink before copying the packaged router
  - tracked `dist/index.cjs` was refreshed in dedicated build commits, separate
    from each behavior-bearing source commit
- Commands run and results: append exact red/green/full/smoke evidence.
- Evidence artifacts: generated index diff, package dry-run result, installed
  version/index status, primary smoke result, independent review, and admin
  revision/version verification.
- Independent-review result: APPROVE with no blocking findings. The sole
  code-level suggestion was applied (operation-specific rejection for implicit
  Shared Drive IDs passed to My-Drive-only public/delete tools), then the
  reviewer reconfirmed APPROVE after focused tests, typecheck, and diff check.
- Final verdict: rollout approved; Codex desktop reload proof remains open.
- Accepted debt: the unchanged production dependency graph currently reports
  five moderate advisories under `npm audit --omit=dev` (direct
  `googleapis@^140` plus transitive `googleapis-common`, `gaxios`, `uuid`, and
  MCP-SDK `hono`). The available Google API remediation is a separate major
  dependency upgrade to `googleapis@176`; it is not required for the Shared
  Drive contract and is deferred to dependency-maintenance scope. Root
  production dependencies report zero advisories.
- Git evidence: implementation and its then-current compliance record were
  explicitly staged as 14 task-only paths and committed on
  `codex/google-workspace-shared-drives` as `27e4bf8`
  (`feat(google-workspace): support shared drives safely`); the worktree was
  clean immediately after commit. Primary rollout evidence was committed as
  `1321e93`, and the branch was pushed without creating or merging a PR.
- CLI Git/verification evidence:
  - six narrow local commits preserve source/test and generated-bundle
    separation on `codex/codex-portable-rudi-tool-names`: `0dc7c50`,
    `308b682`, `83709f5`, `e92e364`, `8e78fc3`, and `9bc491e`
  - the portable-name, symlink-resolution, and read-only approval tests each
    failed for the expected missing behavior before the smallest fix and then
    passed
  - the full CLI suite passed 634 tests; the repository debt runner reported
    zero findings; build and `npm pack --dry-run --json` passed; the branch is
    clean and was pushed without creating or merging a PR
- Primary installed-state evidence:
  - state-preserving local-registry update installed `stack:google-workspace`
    2.0.0 from the clean task commit
  - `rudi index --json` indexed 28 stacks and 403 tools with zero failures;
    Google Workspace contributed all 68 contracted tools
  - daemon status is healthy/ready and reports the same 28-stack, 403-tool,
    zero-failure index
  - direct router inspection found all eight Google Workspace Drive tools and
    the current list schema (`account`, `drive_id`, `page_token`, `corpora`, and
    integer `max_results`)
  - a broad post-update `rudi check` probe hung after index success and was
    bounded with Ctrl-C; direct manifest, index, daemon, MCP, and provider
    checks supplied stronger targeted evidence instead
- Primary business-storage smoke evidence (read-only provider activity):
  - exact account/Shared Drive root list returned six items with no continuation
    token, `incompleteSearch=false`, and valid scoped provider references
  - bounded read-back discovery used eight list calls, visited 20 items to a
    maximum depth of four, and selected only a downloadable blob at most 10 MiB
  - download returned 21,958 bytes; an independent local SHA-256 matched both
    the handler result and Google's provider SHA-256, and the returned provider
    reference remained scoped to the selected account and Drive
  - the temporary local download directory was removed; no Google write tool
    was called
- Codex integration evidence and gap:
  - the exact clean CLI package was installed locally, `rudi shims rebuild`
    recreated the router shim, and the packaged and generated router SHA-256
    values match
  - `rudi integrate codex` now emits the canonical stdio router entry with
    `RUDI_ROUTER_TOOL_NAMES="portable"` and
    `default_tools_approval_mode="writes"`; the latter lets annotated
    read-only tools run while preserving approval for writes
  - direct portable-router inspection exposes
    `stack_google-workspace_drive_list`; a bounded exact-account/Drive call
    succeeds without provider mutation
  - fresh Codex CLI processes now discover and attempt that portable tool,
    proving the naming/exposure repair; Codex CLI 0.147.0 then reports
    `user cancelled MCP tool call` in noninteractive `codex exec`, matching
    the open upstream noninteractive MCP-approval defect rather than a RUDI
    dispatch/provider failure
  - this already-running desktop task cannot hot-add MCP names; official Codex
    MCP setup requires a client restart, so desktop-host invocation is not
    claimed without an actual restart and new-task smoke
- Admin-Mac synchronization evidence:
  - both exact remote task revisions were fetched into clean, separately
    tracked worktrees without modifying either admin `main` checkout
  - the active admin CLI is newer at 1.10.18, so it was not downgraded; the
    synchronized branch was installed only under an isolated temporary prefix
    to generate the corrected Codex block, then the temporary prefix was moved
    to Trash
  - the active packaged and generated admin routers have the same SHA-256;
    Codex config selects portable names and `writes` approval mode
  - state-preserving Registry update installed Google Workspace 2.0.0; the
    admin's legacy launch contract still targeted `dist/index.js`, so the
    package's declared `npm run build` generated that derived artifact before
    reindexing
  - Google Workspace then indexed all 68 tools; the admin-wide index returned
    to 49 stacks, 447 tools, and the same nine unrelated pre-existing failures
  - bounded Shared Drive list exposed the complete current schema and returned
    one result with a continuation token and `incompleteSearch=false`
  - bounded read-back used eight list calls, visited 20 items to depth two,
    downloaded 21,958 bytes, matched handler/provider/independent SHA-256, and
    retained scoped provider references; the temporary output was moved to
    Trash and no Google write tool was called
- Proof gap: post-restart Codex desktop tool exposure/invocation remains
  pending; source, config, router, fresh-process discovery, direct dispatch,
  provider behavior, and both-host installed state are otherwise proven.
- Definition of Done:
  - all deterministic and repository gates pass
  - read-only Shared Drive smoke passes
  - fresh-context review has no blocking findings
  - docs and generated contracts match behavior
  - task-owned changes are audited and committed on the task branch
  - primary and admin hosts report the accepted version/index; the remaining
    desktop reload proof is tracked explicitly above
