# Agent Hosts MCP Stack

This checklist governs the portable `stack:agent-hosts` package and its local
installation through the RUDI router. The stack mediates bounded synchronous
invocations of existing Agent Host runtimes; it does not own Service Desk state
and it does not turn RUDI into an agent runner.

## Phase 0: Baseline And Manual Lookup

- Status: complete.
- Scope:
  - [x] Add one Registry stack for the fixed DeepSeek, Claude Code, and Codex fleet.
  - [x] Preserve Service Desk as the canonical owner of Service Requests, approvals, attempts, scheduling, and recovery.
  - [x] Preserve Claude Code, Codex, and DeepSeek as the execution hosts.
- Files inspected before editing:
  - [x] Workspace and Registry `AGENTS.md` files.
  - [x] Current Registry and Service Desk git state.
  - [x] Existing stack manifests, package tests, MCP entrypoints, Registry compiler, and CLI installer/router code.
  - [x] Existing Service Desk Agent Host contract and provider adapters.
- Relevant SWE manual sections:
  - [x] Testing doctrine: deterministic behavior-level red/green proof.
  - [x] API standard E2, E3, E6, E8, E9, and E12: enforced schemas, stable errors, backpressure, observability, tests, and agent-readable contracts.
  - [x] Security standard F5, F6, F7, F12, and F13: trust boundaries, RUDI-managed secrets, pinned dependencies, adversarial tests, and bounded agent authority.
  - [x] Build Order Phase 5 and APIs-to-Agents/Agents-to-Production gates.
- Current-state commands:
  - [x] `git status --short`
  - [x] Registry structure, manifest, installer, router, and package-test inspection.
  - [x] Service Desk Agent Host source and contract inspection.
- Risks and invariants:
  - [x] Existing unrelated site-planner and zoning-skill changes in the Registry worktree must be preserved.
  - [x] No prompt, token, provider output, credential, or account-specific state belongs in Registry source.
  - [x] No implicit provider selection, arbitrary shell/env/model flags, inherited MCP tools, or unbounded concurrency.
  - [x] V0 accepts only caller-asserted `synthetic_nonprivate` content.
  - [x] Provider failures are returned without automatic retry.
- Exit criteria:
  - [x] Ownership, trust boundaries, package conventions, and live-install gate are mapped.

## Phase 1: Scope Lock

- Status: complete.
- In scope:
  - [x] `agent_host_list`, `agent_host_probe`, and synchronous `agent_host_invoke` tools.
  - [x] Fixed adapters `deepseek-http-v1`, `claude-code-cli-v1`, and `codex-cli-v1`.
  - [x] Strict validation, 25-second router-compatible timeout, bounded output/process termination, fixed provider configurations, and one in-flight invocation per adapter.
  - [x] Registry metadata, package tests, contract/ownership ADR, local install/index, and synthetic live smokes.
- Non-goals:
  - [x] No Service Desk worker wiring or canonical state changes.
  - [x] No async submit/status/cancel API in V0.
  - [x] No model-selected tools, RUDI router access inside child models, fallback provider, retries, arbitrary working directory, or private content.
  - [x] No deployment or restart of the installed Service Desk application.
- Expected files touched:
  - [x] `catalog/stacks/agent-hosts/**`
  - [x] `src/agent-hosts-stack.test.ts`
  - [x] `index.json` with one surgical additive stack entry.
  - [x] `docs/adr/0002-agent-hosts-capability-boundary.md`
  - [x] This checklist.
- External inputs and trust boundaries:
  - [x] MCP arguments, subprocess JSONL, HTTP responses, CLI auth state, RUDI secret output, and model output are untrusted.
  - [x] DeepSeek uses only RUDI secret `DEEPSEEK_API_KEY` at dispatch time.
  - [x] Claude and Codex use existing local subscription authentication through minimal child environments.
- Failure behavior:
  - [x] Invalid requests fail before dispatch with stable structured errors.
  - [x] Busy adapters fail closed without queueing or retrying.
  - [x] Timeouts terminate the process group and report whether termination was confirmed.
  - [x] Provider output is bounded and validated before return.
- Exit criteria:
  - [x] Contract is narrow enough to test without live provider access.

## Phase 2: Red Tests

- Status: complete.
- Observable behavior to prove:
  - [x] The fleet list is fixed and ordered, with no default provider.
  - [x] Probe accepts only an explicit known provider or the whole fixed fleet.
  - [x] Invoke validates the complete contract before dispatch and rejects concurrency with `busy`.
  - [x] Each provider uses a fixed, tool-free, bounded execution configuration.
- Test files to add or edit:
  - [x] `catalog/stacks/agent-hosts/test/core.test.js`
  - [x] Provider, process, and MCP contract tests under `catalog/stacks/agent-hosts/test/`.
  - [x] `src/agent-hosts-stack.test.ts`
- Red command:
  - [x] `node --test catalog/stacks/agent-hosts/test/core.test.js`
  - [x] Targeted process/provider/MCP test commands before each module existed.
  - [x] DeepSeek dependency-failure classification test before the classification fix.
- Expected failure:
  - [x] Core/process/provider/MCP tests initially failed on missing modules or missing methods.
  - [x] DeepSeek dependency failure initially returned `invalid_output` instead of `provider_unavailable`.
- Exit criteria:
  - [x] Observable fleet, probe, invoke, process-bound, launch-shape, and dependency-classification behavior was proved red before its smallest implementation.

## Phase 3: Implementation

- Status: complete.
- Implementation rules:
  - [x] Keep the provider fleet fixed and caller selection explicit.
  - [x] Keep runtime paths discovered from allowlisted local candidates, never caller supplied.
  - [x] Keep MCP handler thin; core/provider modules own validation and execution.
  - [x] Add no dependency beyond exact `@modelcontextprotocol/sdk@1.0.0`, with an integrity lock.
- Files allowed to change:
  - [x] Files named in Phase 1 only.
- Validation and error-handling requirements:
  - [x] Reject unknown keys, invalid enums, unsafe identifiers, empty/oversized prompts, and out-of-range timeouts.
  - [x] Never include secrets, stderr, stack traces, raw auth status, or internal paths in tool responses.
  - [x] Do not automatically retry any external dispatch.
- Observability requirements:
  - [x] Return invocation/correlation IDs and bounded provider/runtime/usage metadata.
  - [x] Keep stdout MCP-only; expected tool failures return structured codes and sanitized messages.
- Exit criteria:
  - [x] Focused tests pass with no stubs or placeholder behavior.

## Phase 4: Green Tests And Refactor

- Status: complete.
- Green command:
  - [x] Reran each unchanged red command after its smallest implementation.
- Refactor constraints:
  - [x] Refactored only while targeted tests remained green.
  - [x] Preserved unrelated Registry changes and made no Service Desk edits or deployment.
- Regression checks:
  - [x] Stack-local tests: 14 passed.
  - [x] Focused Registry package test: 1 passed.
- Exit criteria:
  - [x] Contract, provider hardening, and MCP wiring tests pass.

## Phase 5: Full Verification

- Status: complete.
- Targeted tests:
  - [x] `npm test` inside the source stack package: 14 passed.
  - [x] Installed stack `node --test test/*.test.js`: 14 passed.
  - [x] `npm test -- src/agent-hosts-stack.test.ts` in Registry: 1 passed.
- Full suite:
  - [x] Registry `npm test`: 110 passed after restoring the existing social-media-publisher package's locked test dependencies with scripts disabled.
- Build/typecheck/lint:
  - [x] `npm run validate:v2`: 88 packages passed.
  - [x] `npm run validate:public -- --json`: 0 errors and 0 warnings using a temporary git index that represented the currently untracked agent-hosts and pre-existing site-planner packages without changing the real index.
  - [x] `npm run build`: passed; all generated indexes contain 88 packages.
  - [x] `node --check` passed for every stack source module.
- JS/TS debt scan:
  - [x] Packaged SWE scan with `src/index.js` as the entrypoint: 0 findings across 9 source files.
- Live smoke checks:
  - [x] Installed twice from the local Registry source with `USE_LOCAL_REGISTRY=true`; the second install verified the final source revision and auto-indexed three tools.
  - [x] Router list returned the fixed fleet and `default_adapter_id: null`.
  - [x] Router probe returned all three providers `ready`.
  - [x] DeepSeek live invoke returned validated JSON through `deepseek-v4-flash` with 58 total tokens.
  - [x] Claude live invoke returned validated JSON through `claude-opus-5`, reporting 22 total tokens and provider cost metadata of about $0.0436; local subscription auth was used.
  - [x] Codex live invoke returned validated JSON through `codex-cli 0.145.0` with 13,098 total tokens; local ChatGPT subscription auth was used.
  - [x] Verification router shut down cleanly and no invocation child remained.
  - [x] Final installed package matches Registry source byte-for-byte outside installed `node_modules`.
- Exit criteria:
  - [x] All three providers passed through the installed stack/router.

## Phase 6: Docs, Contracts, And Closure

- Status: complete.
- Docs or API contracts to update:
  - [x] Stack README with tool schemas, limits, auth/cost behavior, state root, and ownership boundary.
  - [x] Registry ADR for capability ownership and the future Service Desk migration boundary.
- Final files touched:
  - [x] New `catalog/stacks/agent-hosts/` package, tests, manifests, README, and integrity lock.
  - [x] New focused Registry package test, ADR, and this compliance record.
  - [x] One additive `stack:agent-hosts` entry in `index.json`; pre-existing site-planner and zoning-skill work remains untouched.
- Commands run and results:
  - [x] Red, green, full-suite, build, validation, install, index, debt-scan, and live-smoke evidence is recorded above.
- Accepted debt:
  - [x] V0 is synchronous and capped at 25 seconds; async submit/status/cancel and incremental progress are deferred.
  - [x] `synthetic_nonprivate` is a caller assertion, not an automated content classifier.
  - [x] Claude Code and Codex runtime versions are exact allowlists and require a reviewed package update after CLI upgrades.
  - [x] Service Desk's proven provider-specific adapters remain until its future worker wiring migrates to a contracted RUDI gateway; no duplicate canonical state exists.
  - [x] A standalone `rudi index --json --force` printed a successful 27-stack/383-tool result but retained open indexing handles and required SIGINT; stack installation's automatic indexing exited cleanly and the cache contains the three tools.
  - [x] Normal public-readiness in this uncommitted worktree reports untracked package paths; the temporary-index check proves it passes once the intended package files are tracked.
  - [x] Restoring the unrelated social-media-publisher test environment reported its existing 7 dependency vulnerabilities; they are outside this package's dependency tree and scope.
- Definition of Done:
  - [x] Source, package, installed stack, router index, and live provider behavior agree.
  - [x] No canonical Service Desk state or raw RUDI tool authority moved into the stack.
