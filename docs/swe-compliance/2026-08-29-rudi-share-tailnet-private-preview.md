# RUDI Share Tailnet-Private Preview Compliance Ledger

Objective: extend `stack:rudi-share` with a backward-compatible,
tailnet-private static preview access mode while preserving the existing
Anyone-with-the-link provider and the four existing MCP tool names.

Current verdict: **PR GREEN AT CODE HEAD — PR #54 is linked to public issue
#52. Code head `06141b8` passed Test/Build/Verify plus Ubuntu, macOS, and Windows
validation after the repository-compliant module split. Independent review has
no open blocker/high/medium finding. Final evidence-only CI, merge, and worktree
closeout remain phase-gated.**

## Phase 0: Baseline And Manual Lookup — Complete

- [x] At issue-loop continuation, `get_goal` reported no active goal;
  `create_goal` then succeeded with the exact opening objective before the
  final review-remediation edits in this run.
- [x] Read `/Users/hoff/RUDI/AGENTS.md` and the registry `AGENTS.md`, then used
  the `map-change-impact` and `swe-compliance-checklist` skills.
- [x] Loaded the SWE manual index plus the Agent Co-Pilot, testing, API error,
  security boundary, infrastructure lifecycle, and horizontal-engineering
  standards.
- [x] Fetched `origin/main` read-only and created
  `/Users/hoff/RUDI/worktrees/registry/rudi-share-tailnet-private-preview-20260829`
  on `codex/rudi-share-tailnet-private-preview-20260829` from then-current
  `origin/main` revision `e7a84e2bd006d27db6d9db29e0e23684ab65613d`.
- [x] The dirty primary checkout remained on
  `codex/google-workspace-account-isolation`; none of its repo-steward changes
  were edited, cleaned, stashed, or incorporated.
- [x] Baseline RUDI Share: 6 tests passed and TypeScript build passed.
- [x] Tailscale CLI `1.98.9` was online. Existing Serve HTTPS 443 was inspected
  only through safe hashes/port summaries and never changed.
- [x] Risk tier: **High**, because this manages persistent routes, detached
  processes, local state, and a network exposure boundary.

## Phase 1: Scope Lock And Change-Impact Map — Complete

- [x] In scope: explicit `tailnet_private` / `tailscale_serve`; lazy public
  provider configuration; screened artifact materialization; loopback host;
  managed Serve/status/revoke; durable lifecycle state; same four MCP tools;
  docs, skill, ADR, tests, and generated index.
- [x] Non-goals: project stack, Funnel, ACL/policy changes, source-tree hosting,
  arbitrary servers, cloud Share API changes, CLI changes, commits, pushes,
  PRs, releases, admin-Mac deployment, or unrelated repositories.
- [x] Discovery changed the initial map only as follows:
  - ADR `0010` was already occupied, so this decision is ADR `0011`.
  - CLI optional-secret activation already supports `required: false`; no CLI
    edit was needed.
  - No dependency or package-script change was needed; package files and locks
    remain unchanged.
- [x] Trust boundaries: MCP JSON, filesystem paths/content, persisted JSON,
  child IPC/PIDs, Tailscale executable/status, and loopback/tailnet HTTP.
- [x] Invariants: no Funnel/ACL/auto-approval; no 443 mutation; loopback only;
  validated snapshot only; exact live route/host ownership; atomic bounded
  state below injected root or `~/.rudi/state/rudi-share`.
- [x] Horizontal disposition: **standardize the existing four-tool contract,
  no shared-runtime obligation**. Public and private providers retain separate
  implementations because their trust/deployment boundaries differ. Reassess
  if a third Share transport or second independent static-host lifecycle
  appears.

## Phase 2: Behavior-Level Red Tests — Complete

Each implementation behavior was introduced with an unchanged red/green
focused command. Representative expected red failures:

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Artifact snapshot | missing `materializeStaticArtifact` export | immutable screened copy and matching manifest |
| Loopback static host | missing host export | root assets, SPA fallback, HEAD/GET, traversal/symlink rejection |
| Private authorization | private call used public gate | tailnet-specific confirmation blocks all effects |
| Publish lifecycle | missing private service | non-443 URL, provenance, health, state |
| Get/revoke | methods missing | refreshed health and exact route/host revoke |
| Partial mutation | route remained after failed verification | exact cleanup attempted and receipt returned |
| Artifact error | generic code instead of `MISSING_INDEX` | precise code, no host/route effect |
| Multiple previews | collision risk | persisted and live routes both reserved |
| Stale state lock | `PREVIEW_STATE_BUSY` | dead-owner lock safely recovered |
| Foreground/Funnel/service routes | only port 443 detected | all relevant live ownership reserved; no Funnel command |
| Oversized artifact | unreadable large file returned `EACCES` | metadata bound returns `ARTIFACT_LIMIT_EXCEEDED` before read |
| Tampered state | arbitrary URL/negative PID accepted | invalid state rejected before fetch/signal/provider effect |
| Cleanup journal | retry reported publication / record missing | `starting` and `cleanup_required` remain revocable and never replay success |
| Child timeout/IPC | managed host function absent or false identity accepted | real late/mismatched child terminated and verified gone |
| Revoke retry | second call fabricated host cleanup | exact receipt persisted; incomplete stop retried |
| Route-mismatch revoke | provider error prevented host shutdown | route and exact host cleanup run independently; partial ownership is journaled and retryable |
| Artifact cleanup retry | stopped receipt could outlive a failed snapshot deletion | `artifactRemoved` is durable, blocks compaction, and retries after 129 later receipts |
| Stop proof | controller unavailable / health loss implied exit | PID exit required before `hostStopped: true` |
| DNS/redirect SSRF | self-attested DNS returned healthy / checker absent | fresh device DNS required and redirects refused |
| Artifact path substitution | post-`lstat` symlink replacement was copied | pinned-root, no-follow descriptor read rejects substitution |
| Windows artifact portability | missing `O_NOFOLLOW` rejected every artifact | descriptor identity/realpath validation remains active when the platform lacks the atomic flag |
| Node 20 portability test | `module.registerHooks` was unavailable on the declared runtime floor | source-capability injection runs on Node 20 without a newer loader API |
| Pre-journal parent crash | detached child survived before durable ownership | child remains IPC-supervised and exits until journal activation |
| Idempotent active replay | stale persisted `healthy` result replayed | replay refreshes host, tailnet identity, and HTTPS health |
| Revoked-state growth | 130 revoked records persisted indefinitely | newest 128 receipts retained; older revoked records compacted |
| Incomplete revoke retention | cleanup-required receipt was evicted after 128 newer revocations | only fully stopped receipts are compacted; unresolved ownership is retained or state fails closed |
| Cleanup classification | status/replay relabeled partial revocation as startup cleanup | persisted `PARTIAL_REVOCATION_CLEANUP_FAILED` remains truthful across get/replay |
| Startup artifact cleanup | deletion failure escaped raw and left `starting` state | deletion outcome is journaled and retryable through exact unpublish |
| Pre-host artifact cleanup | failed deletion left no state record | artifact-only ownership is durable with no invented route/PID ownership |
| Unowned cleanup effects | artifact-only retry called route revoke | null-host cleanup skips both Serve and process mutations |

Focused commands used `node --test --import tsx --test-name-pattern='<behavior>'
src/{artifact,private-preview}.test.ts`; the loopback/real-child cases were run
with the required local permission rather than accepting sandbox failures as
red evidence.

## Phase 3: Implementation — Complete

- [x] `artifact.ts`: pre-read encoded-size limits, descriptor-pinned pre/post
  identity and realpath validation, atomic no-follow where available, secure
  Windows fallback when it is not, and atomic screened snapshot materialization.
- [x] `preview-host.ts`: `127.0.0.1` only, managed identity health endpoint,
  static MIME/root assets/SPA fallback, no listing, traversal/symlink defense,
  GET/HEAD only.
- [x] `private-preview.ts`:
  - default `~/.rudi/state/rudi-share`, injectable roots, atomic bounded JSON,
    exact lock ownership, deterministic IDs, and multi-preview allocation;
  - managed HTTPS range `8443`–`9443`, with 443 rejected at allocation,
    creation, and revocation boundaries;
  - minimal child/Tailscale environments and no shell interpolation;
  - only status/Serve commands; foreground/service/Funnel-owned ports reserved;
  - validated child IPC identity, verified child teardown/PID exit, fresh DNS
    provenance, manual redirects, identity-bound health;
  - durable `starting`, `active`, `cleanup_required`, and `revoked` lifecycle,
    exact cleanup receipts, compaction of only fully cleaned receipts, truthful
    retry behavior, and supported reconcile via `get` / `unpublish`.
- [x] `workflow.ts` and `index.ts`: additive access/provider routing behind the
  existing tools; omitted fields default public; mode-specific confirmation;
  cloud client lazy; safe stable error envelopes.
- [x] Manifest, README, skill, ADR 0011, tests, and generated `index.json`
  describe the two providers and safety boundary.
- [x] No placeholder, arbitrary process, public fallback, Funnel, ACL, policy,
  or automatic approval path exists.

## Phase 4: Green Tests And Refactor — Complete

- [x] Latest stack command: `(cd catalog/stacks/rudi-share && npm ci && npm test
  && npm run build)` — **46/46 tests passed; TypeScript passed**.
- [x] The same **46/46 tests passed** with the installed RUDI Node `v20.10.0`,
  proving the package's declared `node >=20` floor for this suite.
- [x] Refactors ran only after focused green tests; affected focused tests and
  the full package suite were rerun.
- [x] Public confirmation/default behavior, unchanged tool names, optional cloud
  secrets, private dispatch, and safe failure cases are regression-covered.
- [x] Coherent issue-referenced commit slices:
  1. `99cc05e` — artifact/host boundary;
  2. `4bf71c7` — private lifecycle plus workflow/MCP compatibility;
  3. `7bde632` — docs/contracts/index/compliance evidence;
  4. `06141b8` — PR CI architecture remediation and refreshed proof;
  5. linked CI evidence in the following documentation-only commit.

## Phase 5: Full Verification — Complete

- [x] `npm test` — **29 files, 252 tests passed**.
- [x] `npm run validate` — **157 catalog packages passed**.
- [x] `npm run indexes:sync` — passed; only generated `index.json` is tracked.
- [x] `npm run indexes:check` — current.
- [x] `npm run build` — validation plus compile passed; catalog hash root began
  `5c9cdc6e5ff3eb2c`.
- [x] `npm pack --dry-run --json` — exit 0; `@rudi/registry@2.0.1`, 1,002
  entries, 2,368,452 packed bytes, 10,795,430 unpacked bytes. Existing
  `.npmignore` fallback warnings were non-blocking and unrelated.
- [x] `npm run catalog:clean && npm run catalog:clean:check` — the first
  sandboxed attempt could not create a tsx IPC pipe; authorized rerun removed
  only `catalog/stacks/rudi-share/{dist,node_modules}` and then reported zero
  planned targets.
- [x] Final JS/TS debt scan on 11 edited implementation/test paths, with graph
  root `catalog/stacks/rudi-share/src` and entrypoints `index.ts` and
  `preview-host.ts`: **0 errors, 0 warnings, 0 information findings**.
- [x] Final horizontal scan: no other tailnet/private-preview contract or
  Tailscale lifecycle implementation. Zoho Mail's loopback OAuth callbacks are
  a different responsibility and create no reuse obligation.
- [x] `git diff --check` — clean.

### Final Live Tailnet Smoke

- [x] Generated two-file static artifact, explicitly refused the unconfirmed
  call, then published through the real installed Tailscale CLI.
- [x] Preview `private_d72a555f90f7eed908c3` used
  `https://rudi.<redacted-tailnet>.ts.net:8443/` (non-443). The exact private
  tailnet DNS name is intentionally omitted from this public repository.
- [x] Root document, `/assets/app.js`, and SPA `/mobile/preview` all returned
  the expected content through tailnet HTTPS.
- [x] The two-file screened artifact was the only served content. Publish and
  refreshed get health were both healthy.
- [x] Revoke receipt: route revoked, host stopped, artifact removed, no stale
  process; the owner URL no longer returned success.
- [x] Serve status SHA-256 before and after was identical:
  `a517391a1c637d46ed55f0213e6096745caa632ddb9b2d93bcbe7a088d06be5f`.
  Final port-only status contained only the pre-existing TCP/Web 443 route,
  with no Funnel ports or foreground sessions.
- [x] The exact temporary smoke root was deleted. No public route was created.

### Independent Review

- [x] Fresh-context read-only reviewer inspected the full diff and initially
  found lifecycle/state/route ownership blockers. Each deterministic finding
  received a red test, implementation fix, and green regression.
- [x] Follow-up review verified foreground/Funnel/service parsing, strict state
  and DNS provenance, durable journals, child teardown/IPC ownership, exact PID
  stop proof, truthful revoke retry receipts, and artifact bounds.
- [x] Final current-byte review verified partial-revocation classification,
  startup artifact cleanup with and without process ownership, and zero
  unowned Serve/process mutations. Verdict: no open blocker, high, or medium
  finding; implementation is PR-ready.

## Phase 6: Docs, Contracts, And Closure — Complete

Exact changed paths:

- `catalog/skills/share-web-app.md`
- `catalog/stacks/rudi-share/README.md`
- `catalog/stacks/rudi-share/manifest.json`
- `catalog/stacks/rudi-share/src/artifact.test.ts`
- `catalog/stacks/rudi-share/src/artifact.ts`
- `catalog/stacks/rudi-share/src/index.ts`
- `catalog/stacks/rudi-share/src/mcp.test.ts`
- `catalog/stacks/rudi-share/src/package-contract.test.ts`
- `catalog/stacks/rudi-share/src/preview-host.test.ts` (new)
- `catalog/stacks/rudi-share/src/preview-host.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-cleanup.test.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-contract.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-host.test.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-host.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-publish.test.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-service.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview-state.test.ts` (new)
- `catalog/stacks/rudi-share/src/private-preview.ts` (new)
- `catalog/stacks/rudi-share/src/tailscale-serve.test.ts` (new)
- `catalog/stacks/rudi-share/src/tailscale-serve.ts` (new)
- `catalog/stacks/rudi-share/src/workflow.test.ts`
- `catalog/stacks/rudi-share/src/workflow.ts`
- `docs/adr/0011-rudi-share-private-preview-provider.md` (new)
- `docs/swe-compliance/2026-08-29-rudi-share-tailnet-private-preview.md` (new)
- `index.json` (generated only through `npm run indexes:sync`)

Publication status: four issue-referenced commits are pushed and public PR
[#54](https://github.com/learnrudi/registry/pull/54) is open. The CI-driven
architecture split is green; only this final evidence refresh remains
uncommitted at this proof point. No merge, registry release, package
publication, admin-Mac deployment, or unrelated-repo mutation has been
performed.

Accepted debt and proof gaps:

- A concurrently growing source file can temporarily consume more memory than
  its metadata estimate before the descriptor's post-read identity/size checks
  reject it. Prepared artifacts are expected to be quiescent during capture; a
  future chunked descriptor reader can enforce the encoded bound while reading.
- External Serve configuration can race between status inspection and mutation.
  Post-mutation ownership verification, durable journaling, and fail-closed
  cleanup receipts bound the consequence; the CLI exposes no adopted optimistic
  concurrency primitive here.
- The smoke proved a real tailnet-only HTTPS URL and mobile-style root/asset/SPA
  behavior from this tailnet device, but no physical phone browser was available
  to provide a second-device screenshot.
- Dependency audits observed during unchanged lockfile installation (registry
  13; stack 5) predate this standard-library-only change. No dependency or
  lockfile changed.
Definition of Done: **implementation proof is met; issue-loop publication,
merge, and closeout are still pending.**

## Issue-Loop Integration Addendum — In Progress

- [x] User authorized the public GitHub issue/PR lifecycle, green merge, and
  finished-worktree closeout. Registry release, installed-stack update, and
  admin-Mac deployment remain explicitly out of scope.
- [x] Created public issue
  [#52](https://github.com/learnrudi/registry/issues/52) and linked this ledger.
- [x] Renamed the isolated branch to
  `chore/52-rudi-share-tailnet-private-preview`.
- [x] Preserved the complete task diff in labeled stash
  `issue-52 pre-main-refresh preservation 2026-08-29`.
- [x] Fast-forwarded the isolated branch from
  `e7a84e2bd006d27db6d9db29e0e23684ab65613d` to current `origin/main`
  `b037be0bf5d5997c3dd541f9f1a525f581a17ba7`, then reapplied the task diff.
- [x] A later read-only fetch found `origin/main` advanced through merged PR
  #53. Preserved the final diff in a second labeled stash, fast-forwarded this
  isolated branch to `e450c3d6a8a520fa70bee739efc920bc748af4fd`, reapplied cleanly,
  and regenerated the shared index so both changes are represented.
- [x] The only overlap was generated `index.json`; retained the current-main
  generated file and deferred regeneration to `npm run indexes:sync`.
- [x] Reapplied source/docs contain no conflict markers and `git diff --check`
  is clean. The dirty primary checkout remains untouched.
- [x] Regenerated `index.json` only through `npm run indexes:sync`; 158 catalog
  packages compiled and the generated catalog root began `59573d3b23676060`.
- [x] Initial post-refresh package command `npm test && npm run build` passed
  with **35/35 tests** and TypeScript green after restoring the package's locked,
  previously cleaned dependencies with `npm ci`. The first attempt failed only
  because `catalog:clean` had intentionally removed `node_modules`; no source
  behavior test failed.
- [x] Post-refresh registry gates passed:
  - `npm test` — **29 files, 254 tests**;
  - `npm run validate` — **158 packages**;
  - `npm run indexes:check` — current;
  - `npm run catalog:clean` followed by `npm run catalog:clean:check` — removed
    exactly `rudi-share/{dist,node_modules}`, then zero targets;
  - `npm run build` — passed with catalog root `59573d3b23676060...`;
  - `npm pack --dry-run --json` — exit 0, 1,008 entries, 2,386,884 packed
    bytes, 10,893,687 unpacked bytes; existing `.npmignore` fallback warnings
    remain unrelated and non-blocking.
- [x] Fresh JS/TS debt scan on the 11 edited implementation/test paths:
  **0 errors, 0 warnings, 0 information findings**.
- [x] Fresh real-provider smoke on Tailscale CLI `1.98.9`:
  - unconfirmed tailnet publication returned `confirmation_required`;
  - preview `private_6684a0fe5cf4f0d587d5` published at
    `https://rudi.<redacted-tailnet>.ts.net:8443/`; the exact private tailnet
    DNS name is intentionally omitted from this public repository;
  - root, `/assets/app.js`, SPA `/mobile/preview`, publish health, and refreshed
    get health all passed;
  - screened artifact SHA-256
    `55d79eab39ad7e6ea0966f46c267dddbea9c56cdf2aba1a138a7ea6c0aae89bf`,
    2 files, 129 bytes;
  - exact receipt reported route revoked, host stopped, and no stale process;
    revoked status persisted and the URL no longer returned success;
  - pre/post Serve status SHA-256 was identical:
    `a517391a1c637d46ed55f0213e6096745caa632ddb9b2d93bcbe7a088d06be5f`;
    the existing HTTPS 443 configuration remained untouched;
  - the exact temporary state/artifact root and smoke harness were removed.
- [x] A first smoke-harness assertion expected transport failure after revoke;
  Tailscale instead returned a non-success response. Exact cleanup and the
  baseline Serve hash were already proven, the harness was corrected to accept
  either failure form, and the fresh run passed. This was test-harness behavior,
  not a product-code change.
- [x] Fresh-context integration review found two high and two medium
  deterministic blockers before publication:
  1. a detached child could outlive a parent crash before its ownership journal;
  2. path-based artifact reads allowed post-validation symlink/ancestor
     substitution;
  3. active idempotent replay returned persisted health without reconciliation;
  4. revoked records could grow state past the reader limit.
- [x] Each review finding received focused behavior-level proof and a scoped
  fix:
  - artifact swap command first failed with `Missing expected rejection`, then
    passed after opened-root/no-follow descriptor and pre/post identity checks;
  - ownership-journal command first returned success and reproduced an orphaned
    exact test PID, which was identity-checked and terminated; the unchanged
    command then passed after the activation handshake, and a real SIGKILL-parent
    regression proves the pre-activation child exits;
  - idempotent replay first returned `healthy` instead of `degraded`, then passed
    after factored get-style health reconciliation;
  - 130-cycle receipt retention first exceeded 128 records, then passed after
    deterministic bounded compaction and an 8 MiB state-write limit.
- [x] Follow-up review then found two additional high-severity regressions:
  1. requiring POSIX `O_NOFOLLOW` made both public and private artifact
     packaging unavailable on Windows;
  2. revoked-record compaction could discard an exact receipt whose managed
     host had not stopped.
- [x] Both newest findings received focused red/green proof:
  - the Windows-capability subprocess first failed with
    `UNSUPPORTED_ARTIFACT_ENTRY`, then passed after retaining the descriptor
    identity/realpath guard while treating unavailable `O_NOFOLLOW` as a
    platform capability rather than a publication failure; the symlink-swap
    regression remained green;
  - the 129-newer-receipt case first failed because the unresolved preview was
    absent, then passed after compaction was restricted to receipts with
    `hostStopped: true`; the 128-receipt bound remained green.
- [x] Post-fix package command: **46/46 tests passed** on Node `v25.2.1` and
  again on Node `v20.10.0`; TypeScript build passed. No dependency or lockfile
  changed; the unchanged dependency audit currently reports 2 moderate and 2
  high baseline findings.
- [x] Post-remediation real-provider smoke passed on temporary tailnet-only
  HTTPS 8443 for preview `private_29bef8dcd828b325a8bd`: root-relative asset,
  SPA fallback, publish/get health, exact route revocation, managed-host stop,
  and revoked-URL unavailability all passed. Pre/post Serve status SHA-256 was
  identical at `a517391a1c637d46ed55f0213e6096745caa632ddb9b2d93bcbe7a088d06be5f`;
  the pre-existing HTTPS 443 route remained present, and the exact temporary
  process/state/harness were absent afterward. The private DNS name is omitted.
- [x] Latest JS/TS debt scan on all 11 edited source/test paths: **0 errors, 0
  warnings, 0 information findings**.
- [x] Final lifecycle review added one high and two medium deterministic
  remediations before publication:
  - exact route revocation and exact managed-host stop now run independently;
    a route ownership error durably returns
    `PARTIAL_REVOCATION_CLEANUP_FAILED` with truthful route/host/artifact fields,
    and retry completes the same operation;
  - `artifactRemoved` is persisted independently, incomplete deletion is never
    compacted, and retry remains supported after 129 newer receipts;
  - the missing-`O_NOFOLLOW` subprocess test no longer depends on
    `module.registerHooks`, and passes on the declared Node 20 floor.
- [x] Final review reconciliation added four focused failure-path proofs:
  - partial revocation remains classified as
    `PARTIAL_REVOCATION_CLEANUP_FAILED` across get and publish replay;
  - failed screened-artifact deletion after a journaled startup is durable and
    retryable;
  - the same deletion failure before host ownership persists an artifact-only
    cleanup record with `hostPid: null`;
  - artifact-only retry performs no Tailscale revoke or process stop, so it
    cannot mutate a route or PID the preview never owned.
- [x] Final real-provider smoke after all implementation edits passed on
  tailnet-only HTTPS 8443 for preview `private_d72a555f90f7eed908c3`: explicit
  authorization, root document, root-relative asset, browser-style SPA
  fallback, publish/get health, exact route revocation, host stop, artifact
  removal, and revoked-URL unavailability all passed. The Serve status hash was
  unchanged; only the pre-existing HTTPS 443 route remained. The first harness
  run omitted a browser `Accept: text/html` header and correctly received 404
  for the SPA path; the corrected fresh run passed. No product behavior changed
  for that harness correction.
- [x] Exact smoke cleanup proof: harness absent, temporary roots zero, matching
  preview-host processes zero, and Serve ports exactly `[443]`.
- [x] Opened public PR
  [#54](https://github.com/learnrudi/registry/pull/54) with `Fixes #52`, this
  ledger, local proof, accepted debt, and exact closeout plan.
- [x] Initial PR CI: Ubuntu, macOS, and Windows validation passed. The combined
  `Test, Build & Verify` job failed only at `stacks:verify` because the new
  `private-preview.ts` (2,030 lines) and `private-preview.test.ts` (2,175 lines)
  exceeded the repository's 800-line new-module limit.
- [x] Reproduced the CI failure locally with
  `npm run stacks:verify -- --changed-from origin/main --prepare`, then split by
  responsibility into contract/state, managed-host, Tailscale-adapter, and
  lifecycle-service modules plus five focused test modules. Final implementation
  modules are 23–759 lines and test modules are 299–565 lines.
- [x] Unchanged behavior after the split: **46/46 tests passed** on Node 25 and
  Node 20.10; TypeScript passed; the exact changed-stack verifier passed; the
  refreshed 19-path JS/TS debt scan reported zero findings.
- [x] PR #54 rerun on code head `06141b8` passed all required checks:
  `Test, Build & Verify`, `Validate (ubuntu-latest)`,
  `Validate (macos-latest)`, and `Validate (windows-latest)`. The release job
  was correctly skipped for a pull request; zero checks failed or remained
  pending.
- [x] Latest current-main repository gates after PR #53 integration:
  - `npm test` — **29 files, 255 tests passed**;
  - `npm run validate` — **159 packages passed**;
  - `npm run indexes:sync` and `npm run indexes:check` — **159 packages, 845
    files**, current generated index; pre-ledger-refresh catalog root began
    `cc1cf1588302d988`;
  - `npm run catalog:clean:check` — zero targets;
  - `npm run build` — passed;
  - `npm pack --dry-run --json` — exit 0, 1,018 entries, 2,400,203 packed
    bytes, 10,957,028 unpacked bytes before this evidence-line refresh;
  - `git diff --check` — clean.
- [x] Fresh independent review recorded: no blocker/high/medium finding remains.
  Post-split review confirmed the public barrel preserves every prior export,
  all 64 top-level declarations and 31 former monolith tests remain exactly
  once, the import graph is acyclic, and child-host path resolution remains
  portable. Its non-blocking broad-import/duplicate-helper suggestion was
  applied before the CI retry.
- [x] Linked PR CI evidence recorded for the complete code-bearing head.
- [x] Create coherent issue-referenced commits, push, and open the linked PR.
- [ ] Merge the green linked PR, verify issue closure, and remove only the
  finished isolated worktree/local branch through the closeout receipt gate.
