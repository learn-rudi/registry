## Phase 0: Baseline And Manual Lookup

Status: Complete.

- Scope: Repair `stack:image-generator` Midjourney authentication so a human can complete login without an MCP request remaining open.
- Files to inspect before editing: `catalog/stacks/image-generator/src/midjourney_browser.py`, `src/midjourney_service.py`, `src/server.py`, `tests/test_midjourney.py`, `tests/test_mcp_stdio.py`, `API_CONTRACT.md`, `README.md`, `manifest.json`, and the generated `index.json` package entry.
- Relevant SWE manual sections: Master Doctrine Appendix C (testing), Appendix D (debugging), API Standard contract/error rules, Backend Standard process/resource lifecycle, and Security Standard trust boundaries, authentication, isolation, and security testing.
- Current-state commands: `git status --short`; `python -m unittest tests.test_midjourney`; live `midjourney_session_status`; live `midjourney_login`.
- Risks and invariants: credentials and browser storage never cross MCP; callers cannot provide URLs, profile paths, cookies, or selectors; the dedicated profile remains mode `0700`; browser automation is serialized; no paid generation occurs during login testing; no browser is launched with `--no-sandbox` or `--enable-automation`; local debugging is bound to loopback only.
- Exit criteria: baseline tests are green and the observed timeout/challenge boundary is recorded.

## Phase 1: Scope Lock

Status: Complete.

- In scope: make `midjourney_login` a bounded launcher for a visible, dedicated, reusable browser profile; return a pending-authentication result immediately; allow later status/generate/export calls to attach safely to that browser; preserve stable structured errors.
- Non-goals: arbitrary Midjourney navigation, normal Chrome profile reuse, credential capture, challenge bypass, generation selector changes, provider/model changes, or unrelated registry cleanup.
- Expected files touched: Midjourney driver/service/tests, MCP description/schema tests, API contract, README, manifest version, this checklist, and generated index artifacts required by registry gates.
- External inputs and trust boundaries: MCP arguments, `RUDI_HOME`, configured Chromium executable, dedicated profile state, local DevTools endpoint, Midjourney page state, and detached browser process state.
- Failure behavior to define: missing browser, browser startup timeout, malformed/stale DevTools state, profile contention, unauthenticated session, challenge, and MCP cancellation after launcher response.
- Exit criteria: request/response shape and process ownership rules are explicit before implementation.

## Phase 2: Red Tests

Status: Complete.

- Observable behavior to prove: login returns a pending-authentication contract without waiting for human completion; browser launch uses a dedicated profile and loopback debugging without disabling Chromium sandboxing or enabling automation flags.
- Test files to add or edit: `catalog/stacks/image-generator/tests/test_midjourney.py` and, if the public schema changes, `tests/test_mcp_stdio.py`.
- Red command: run one named unittest for each next observable behavior.
- Expected failure: the current service requires `authenticated: true` from a blocking driver login, and the current driver has no bounded detached launcher contract.
- Exit criteria: each test fails for the expected old behavior before implementation.

## Phase 3: Implementation

Status: Complete.

- Implementation rules: smallest compatible change; no new dependency; subprocess argument vector only (no shell); fixed Midjourney URL; loopback-only DevTools; strict bounded startup wait; deterministic cleanup; no credentials or browser state returned.
- Files allowed to change: the files named in Phase 1 only.
- Validation and error-handling requirements: retain exact-key validation; keep timeout bounds; validate DevTools port data before connection; redact underlying browser exceptions behind stable `ToolError` kinds.
- Observability requirements: return whether a login browser was newly started or already available, the pending-authentication state, and an actionable next step without returning PID, port, cookies, URLs, or page contents.
- Exit criteria: unchanged red commands pass with the new behavior.

## Phase 4: Green Tests And Refactor

Status: Complete.

- Green command: rerun each named red command unchanged, then the full Midjourney test module.
- Refactor constraints: refactor only after green; keep login launching, CDP attachment, page lifecycle, and service response shaping separated enough to test.
- Regression checks: existing generation idempotency, reference validation, export validation, exact input contracts, and MCP tool schema remain green.
- Exit criteria: targeted and Midjourney regression tests pass after any refactor.

## Phase 5: Full Verification

Status: In progress. Automated gates and launcher smoke checks pass; final
authenticated-session proof is waiting for the user to finish sign-in and close
the dedicated browser.

- Targeted tests: `python -m unittest tests.test_midjourney` and `python -m unittest tests.test_mcp_stdio`.
- Full suite: repository `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack --dry-run --json`.
- JS/TS debt scan, if applicable: not required unless this change edits JS/TS; otherwise use the repo debt runner/policy.
- Live smoke checks: install or sync the changed image-generator stack, call login and confirm the MCP response returns before host timeout, let the user authenticate in the visible dedicated profile, call session status, and only then resume the already-authorized greenhouse generation.
- Exit criteria: required gates pass and live authentication succeeds, or the precise external blocker and residual risk are recorded.

## Phase 6: Docs, Contracts, And Closure

Status: In progress.

- Docs or API contracts to update: login request/response semantics, two-step operator flow, security/process behavior, troubleshooting, and package version.
- Final files touched: record from `git diff --name-only` limited to the locked scope plus generated registry artifacts.
- Commands run and results: record red, green, full verification, install/index, and live smoke commands.
- Accepted debt: document any host-dependent Chrome/CDP behavior, manual verification requirement, or untested platform variance.
- Definition of Done: no blocking login call; no `--no-sandbox` browser; reusable authenticated dedicated profile; deterministic tests and registry gates green; docs match behavior; paid generation occurs at most once under the original request ID.

### Verification Evidence

- Baseline: `python -m unittest tests.test_midjourney` passed 13 tests before edits.
- Red service contract: `test_login_returns_pending_authentication_when_browser_is_ready` failed because the old service required `authenticated: true`; the unchanged command passed after the pending-authentication response was implemented.
- Red secure command: `test_login_browser_command_uses_dedicated_sandboxed_profile` failed because no direct login launcher existed; it passed after the fixed argument vector was added.
- Red detached launch: `test_login_launches_detached_browser_without_waiting_for_authentication` failed because login still used blocking Playwright; it passed after the detached browser launcher was implemented.
- Red sandbox option: `test_automated_browser_context_enables_chromium_sandbox` failed because the option did not exist; it passed after `chromium_sandbox: true` was wired into persistent Playwright contexts.
- Red cross-process reuse: `test_login_reuses_active_dedicated_profile_browser` failed because an active Chrome profile was relaunched; it passed after validated `SingletonLock`/`SingletonSocket` detection was added.
- Targeted regression: `python -m unittest discover -s tests -p 'test_*.py'` passed 42 tests.
- Sandboxed local smoke: a Playwright persistent context with `chromium_sandbox: true` opened and closed `about:blank` successfully.
- Repository suite: system-path `npm test` passed 157 tests. The first unsanitized run exposed self-referential local RUDI runtime shims; rerunning with system Node/Python isolated the repository and passed.
- Registry gates: `npm run validate` passed 149 packages; `indexes:sync` and `indexes:check` passed; `npm run build` passed; `npm pack --dry-run --json` passed with 948 entries.
- Install smoke: local registry update installed `stack:image-generator@0.5.0`, and installed browser/service sources byte-match the catalog sources.
- Live launcher: login returned a pending-authentication response in under one second and left a dedicated Chrome process running without `--no-sandbox`, `--disable-setuid-sandbox`, or `--enable-automation`.
- Live contention: while the manual browser remained open, installed `midjourney_session_status` returned `browser_busy` in under two seconds with instructions to finish sign-in and close the window.
- Catalog hygiene: image-generator Python caches created by tests were removed. The global clean check remains red only for pre-existing `google-workspace/{dist,node_modules}` and `rudi-crm/{dist,node_modules}` artifacts, which were left untouched because they belong to unrelated work.
- JS/TS debt scan: not applicable; no JavaScript or TypeScript files were edited for this fix.

### Accepted Debt And Remaining Proof

- The final provider authentication and greenhouse generation smoke cannot run until the user completes Midjourney sign-in and closes the dedicated browser.
- Active-profile detection has a deterministic POSIX regression test and a macOS live smoke. Windows falls back to the in-process detached-browser handle and still needs a platform smoke before claiming equivalent cross-process detection.
- `timeout_seconds` remains accepted and validated for backward compatibility even though manual sign-in now occurs after the MCP response.

## 2026-08-19 Follower Publication Recovery

- Recovery base: Registry PR #33 (`fix/26-rudi-crm-contact-discovery`). The exact pre-reconciliation follower state remains preserved at checkpoint `635989a7d941271450c92f5ead292ab139fd0fdc`.
- Reconstructed red: the recovered sandbox-command test failed against the unchanged base because `login_browser_command` did not exist in `midjourney_browser.py`.
- Green: the recovered package suite passed all 42 tests under its isolated declared dependency environment, both normally and with `RUDI_VERIFY_OFFLINE=1`.
- Changed-stack gate red/green: the first Registry verification correctly forced offline mode and exposed two launcher tests that mocked process/browser boundaries but not the driver's online guard. Those tests now mock only `_require_online`; the unchanged 42-test suite remains green and Registry changed-stack verification passes with all seven MCP tools.
- Publication boundary: no provider login, paid generation, cookie/profile inspection, or host installation was performed. The prior launcher smoke evidence above remains the authoritative host-dependent proof; final authenticated-session and Windows cross-process smoke remain accepted debt.
