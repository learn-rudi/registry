# Brave Search Provider Stack Compliance Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: add one read-only Brave Search provider stack and its mandatory operator skill.
- Files inspected before editing: registry `AGENTS.md`, package schema, catalog validation, representative Node stacks, stack verifier, generated-index scripts, CLI resolver/install behavior, and the editorial callers that will consume the stack.
- Relevant SWE manual sections: Engineering Operating Manual Index; Engineering Quick Reference sections I, II, IV, and V; Security Standard F6; Agent Co-Pilot Operating Standard.
- Current-state commands: `git status --short --branch`, `git rev-parse HEAD`, `rudi which brave-search`, registry catalog searches, and live host inventory checks.
- Risks and invariants: the API key remains in RUDI secret custody; tools never return or log it; the stack is read-only; every external input and provider response is bounded and validated; retries are limited to transient failures; the stack writes no editorial artifacts.
- Initial risk tier and rationale: high, because this introduces a secret-mediated external API capability with billable calls and an installable registry contract.
- Exit criteria: clean registry baseline recorded; interface, error model, and ownership boundary fixed before implementation. Status: complete.

## Phase 1: Scope Lock

- In scope: `stack:brave-search`, `skill:brave-search`, one `brave_web_search` tool, normalized web results, bounded retries, manifest/index updates, focused package tests, registry verification, and isolated install proof.
- Non-goals: editorial persistence, query plans, discovery promotion, browser search, news/image/video endpoints, pagination beyond the provider's single-request count, provider account management, or secret copying.
- Expected files touched: `catalog/stacks/brave-search/**`, `catalog/skills/brave-search.md`, this checklist, and generated `index.json`.
- External inputs and trust boundaries: MCP arguments, `BRAVE_SEARCH_API_KEY`, Brave HTTP status/body/headers, URLs, result metadata, timeouts, and retry hints.
- Failure behavior to define: invalid input rejects before HTTP; missing secret is explicit; auth/payment/scope errors fail without retry; 429 and network failures retry with bounded backoff; timeouts and malformed/oversized responses fail visibly; no partial results are represented as success.
- Authorized external actions: source edits, dependency-lock generation, deterministic tests, registry builds, isolated installs, and one non-persisting live search canary after install. Persisting a product capture remains gated on confirmed provider storage rights.
- Review and approval gates: fresh-context read-only review after verification; no commit, push, release, or primary-Mac source overwrite without separate authority.
- Exit criteria: scope and external-action boundary recorded. Status: complete.

## Phase 2: Red Tests

- Observable behavior to prove: valid input maps provider results; invalid query/count/freshness is rejected; 429 retries; 402 does not retry; malformed responses fail; MCP tool surface matches the manifest.
- Test files to add or edit: `catalog/stacks/brave-search/test/core.test.js`, `test/mcp.test.js`, and `test/package-contract.test.js`.
- Red command: `npm --prefix catalog/stacks/brave-search test` after adding the first behavior test and before its implementation.
- Expected failure: the requested client/tool behavior is not implemented.
- Observed red transitions: result mapping began with a not-implemented failure; count, query-word limit, reversed freshness, 429 retry, malformed results, timeout, invalid types, transient 503, unsafe URL handling, unknown arguments, and MCP listing each failed for the expected missing behavior before implementation. The 402 regression was added after the consolidated error path and passed immediately; that exception is not represented as a red transition.
- Exit criteria: each new behavior except the explicitly identified 402 regression had an observed behavioral red before its smallest implementation. Status: complete.

## Phase 3: Implementation

- Implementation rules: standard Node APIs plus the pinned MCP SDK; no secret output; one concern per module; provider details stay inside the stack.
- Files allowed to change: the Phase 1 registry paths only.
- Validation and error-handling requirements: query 1-400 characters and at most 50 words; count 1-20; timeout bounded at 25 seconds so the request completes within the router's 30-second call boundary; freshness format/date ordering checked; response size and structure bounded; stable error codes and retryability.
- Observability requirements: return provider, query, request count, retrieved timestamp, normalized results, and skipped-result count; errors include safe provider/status context without payload or credentials.
- Implemented boundary: `src/core.js` owns validation, bounded Brave transport, retry/error classification, and normalized output; `src/index.js` owns the single MCP stdio surface. No persistence, editorial policy, or additional endpoint family was added.
- Exit criteria: all red tests green with no scope expansion. Status: complete.

## Phase 4: Green Tests And Refactor

- Green command: unchanged focused package test command from Phase 2.
- Refactor constraints: no new endpoint families or persistence; keep transport injection for deterministic tests.
- Regression checks: package contract, live MCP list/call fixture, manifest tool alignment.
- Final focused result: `npm run stacks:verify -- --stack stack:brave-search --prepare` passed the package-owned verifier with 16 tests and exact manifest/tool alignment.
- Exit criteria: focused tests stay green after cleanup. Status: complete.

## Phase 5: Full Verification

- Targeted tests: `npm --prefix catalog/stacks/brave-search test`.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run stacks:verify -- --stack stack:brave-search --prepare`, `npm run build`, and `npm pack --dry-run --json`.
- JS/TS debt scan: RUDI `swe_debt_scan` restricted to the new JavaScript files.
- Live smoke checks: isolated-home install/router listing first; actual Admin install/read-back second; one non-persisting query only after the credential and billing gate passes.
- Independent review: required against the task contract, instructions, diff, and command evidence.
- Risk-tier approval: user authorized implementation and execution; commit/push/release and persisted result storage remain separate gates.
- Verification results: package verifier 16/16; registry suite 250/250 across 28 files; catalog validation 156/156; `indexes:check` current; `catalog:clean:check` planned zero removals after deleting the verifier-generated `node_modules`; registry build passed; dry-run pack produced `@rudi/stack-brave-search@0.1.0` with 8 files and an 8,887-byte package; restricted debt scan reported 0 errors, 0 warnings, and 0 informational findings.
- Install/read-back results: isolated install and isolated router listing exposed only `stack:brave-search.brave_web_search`; Admin install reached `installed`, `launchable`, `secrets_ready`, `mcp_ready`, and `indexed`; the product adapter found the exact qualified tool; one non-persisting count-1 live query completed with one valid normalized row. Source and installed runtime/package files are byte-identical; the installed manifest is an expected installer-enriched form whose id, version, MCP, tool, related-skill, secret-name, and boundary contracts match source.
- Fleet caveat: the full Admin router index completed with 41 stacks indexed and 9 unrelated pre-existing stack failures; `stack:brave-search` had one tool and no error.
- Exit criteria: every applicable command passes or its exact gap is recorded. Status: complete for source, package, Admin install, and non-persisting canary; primary-Mac parity remains gated on publication.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: stack README, operator skill, manifest, generated registry index, and this checklist.
- Final files touched: `catalog/stacks/brave-search/**`, `catalog/skills/brave-search.md`, generated `index.json`, and this checklist.
- Commands run and results: package tests 16/16; registry tests 250/250; validation 156/156; index/build/clean/pack checks green; debt scan clean; isolated and corrected Admin install/read-back green; two non-persisting live canaries green, including one after reinstallation.
- Evidence artifacts: test output, registry validation/build output, debt scan, isolated install/read-back, router tool listing, and safe smoke evidence.
- Independent-review result: the first fresh-context review found seven actionable boundary issues: inherited-secret leakage, per-attempt timeouts beyond the router deadline, post-buffer response-size enforcement, stale-index-only health, partial-line deadline bypass, provider over-return, and lost MCP error metadata. Each received a focused failing test and a green fix. A second review found three product-side enforcement gaps; those were fixed, and the final fresh-context review reported no actionable findings while confirming the one-tool, RUDI-secret, bounded-transport, no-persistence stack contract.
- Final verdict: implementation and Admin-Mac activation are technically ready; fleet completion needs a human publication decision, and persistent result capture needs provider-plan storage confirmation.
- Accepted debt: none accepted at scope lock.
- Proof gaps: Brave's current official FAQ requires a plan that explicitly grants storage rights, and no dashboard/order-form evidence for this key is available; persistent capture therefore remains prohibited. Primary-Mac published-registry availability is also not yet proven.
- Definition of Done: source and contracts match; tests/build/debt gates pass; Admin install is read back; no secrets exposed; review has no blocking findings; any deferred rollout gate is explicit. Source, verification, Admin activation, and independent review are complete; fleet publication and provider entitlement remain separate rollout gates.

## 2026-08-27 Upstream Rebase And Release Revalidation

- The Brave package checkpoint was rebased from the stale local Registry base
  onto current `origin/main` after 13 upstream commits. The only conflict was
  generated `index.json`; it was resolved exclusively through
  `npm run indexes:sync`, as required by the Registry contract.
- Serial package verification passed 16/16 after `--prepare`. One earlier
  parallel attempt raced two preparation processes over the same package
  `node_modules`; the authoritative serial verifier and the subsequent package
  rerun both passed.
- Current full Registry evidence: 252/252 tests across 29 files; 157/157
  catalog packages validated; index sync/check current; catalog hygiene clean
  after the repository runner removed the verifier-created Brave
  `node_modules`; build and registry package dry-run passed.
- Both the Registry CI-profile debt scan and the Brave-package scan with
  `src/index.js` plus the three test entrypoints reported zero errors, warnings,
  or informational findings.
- Rebased source branch:
  `codex/brave-search-stack-cutover-20260827`. Its single package checkpoint is
  ready for publication once the final commit includes this revalidation
  receipt.
