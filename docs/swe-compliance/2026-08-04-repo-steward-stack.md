# SWE Compliance — Repo Steward Stack

Date: 2026-08-04

Status: **Verified**

## Phase 0: Baseline And Manual Lookup

- Scope: add a portable Registry stack and reciprocal operator skill for continuous repository observation, repository-scoped leases, and a durable local action ledger.
- Files inspected before editing:
  - `AGENTS.md`, `package.json`, `SCHEMA.md`, Registry catalog/compiler/verification tests
  - `catalog/stacks/swe-engineering`, `catalog/stacks/rudi-share`, and `catalog/stacks/github`
  - SWE manual index, build order, Testing Appendix C, Security F13, and Backend G3/G7/G12/G13
- Current state:
  - Registry `main` has unrelated dirty OpenCounter, RUDI CRM, root package, generated-index, and quality-gate work.
  - Existing GitHub tools already own GitHub issues, PRs, Actions, and remote mutations.
  - No Repo Steward package exists.
- Risks and invariants:
  - Never stage, commit, reset, clean, merge, push, or mutate GitHub from the Repo Steward stack.
  - Treat repository paths, Git output, configuration, action records, and agent inputs as untrusted.
  - Deny unconfigured repositories and fetch requests not explicitly permitted by repository policy.
  - Invoke Git without a shell, with bounded execution and bounded/redacted output.
  - Keep runtime state under `RUDI_HOME`; never write stewardship state into a managed repository.
  - Enforce one active repository lease and explicit action-state transitions.
  - Do not stage or commit unrelated Registry changes.
- Exit criteria: the stack interface, policy boundary, state model, and proof commands are explicit before implementation.

## Phase 1: Scope Lock

- In scope:
  - read-only preflight, per-repository status, and fleet scan tools;
  - optional local `git fetch` only for repositories whose configuration explicitly permits it;
  - repository leases with bounded TTL;
  - a durable, repository-scoped action lifecycle and verification records;
  - a concise operator skill that composes this stack with the existing GitHub stack;
  - Registry manifest/index integration and repository-owned verification.
- Non-goals:
  - automatic staging, commits, pushes, merges, rebases, resets, cleaning, branch deletion, issue creation, PR creation, deployment, or scheduling;
  - a daemon or agent runner;
  - parsing arbitrary RUDI-private workspace files or embedding absolute/local paths in the public catalog;
  - modifying the existing GitHub stack.
- Expected files touched:
  - `catalog/stacks/repo-steward/{manifest.json,package.json,package-lock.json,README.md}`
  - `catalog/stacks/repo-steward/src/{core.js,index.js}`
  - `catalog/stacks/repo-steward/test/{core.test.js,mcp.test.js,package-contract.test.js}`
  - `catalog/skills/rudi-repo-steward/{SKILL.md,agents/openai.yaml}`
  - this checklist and generated `index.json` only through the canonical index command
- External inputs and trust boundaries:
  - `REPO_STEWARD_CONFIG_PATH` points to JSON configuration outside the package;
  - repository paths must be exact allowlisted Git worktree roots;
  - Git remotes and command output may contain credential-bearing material and must be redacted before return;
  - GitHub reads/writes remain in `stack:github` under its own credentials and confirmation rules;
  - agent-generated action summaries and verification notes are validated and length-bounded.
- Failure behavior:
  - missing/invalid configuration fails closed with a stable error;
  - an unknown repo ID or path mismatch is rejected before Git invocation;
  - disallowed fetch is rejected before network access;
  - Git timeout or failure returns bounded, redacted diagnostics without state mutation beyond a requested fetch;
  - a held lease rejects another owner; expired leases may be replaced atomically;
  - stale action versions and illegal transitions are rejected without changing the record.
- Exit criteria: tests can express the observable policy and lifecycle contracts.

## Phase 2: Red Tests

- Observable behaviors:
  1. A configured repository returns normalized branch, HEAD, upstream, ahead/behind, remote identity, and dirty classification.
  2. An unconfigured repository and a disallowed fetch fail closed.
  3. Remote credentials never appear in output.
  4. Only one bounded lease may exist for a repository.
  5. Action transitions require the active lease and expected version; verification is append-only within the action history.
  6. MCP tools match the manifest and execute preflight through transport.
- Test files: `catalog/stacks/repo-steward/test/*.test.js`.
- Red command: `node --test test/core.test.js` from the stack directory.
- Expected failure: the first behavior test cannot import the absent `src/core.js` implementation.
- Observed red sequence:
  - missing `src/core.js` for repository status;
  - missing fleet, lease, and action lifecycle exports as each behavior was added;
  - missing `src/index.js` for the MCP transport contract;
  - missing README/operator contract for package portability;
  - an unrecovered expired action lock blocking the next valid lease owner.
- Exit criteria: the red failure is caused by missing requested behavior, not invalid test setup.

## Phase 3: Implementation

- Implementation rules:
  - use Node built-ins plus the existing MCP SDK dependency;
  - separate pure validation/state rules from MCP transport;
  - use `execFile`/`spawn` argument arrays, never shell strings;
  - resolve configured repositories through `realpath` and require exact Git toplevel identity;
  - use atomic exclusive creation for leases and atomic replacement for action documents;
  - redact URL userinfo and high-confidence token patterns from every returned diagnostic.
- Files allowed to change: only Phase 1 files plus deterministic lock/index outputs.
- Validation and error handling:
  - closed schemas, bounded strings/arrays/TTL/timeouts, stable IDs, legal state transitions, optimistic action versions;
  - safe defaults: no configured repos and no fetch permission;
  - no raw secret, remote credential, file content, diff content, or Git config output in tool results.
- Observability:
  - return operation outcome, timing, repo ID, fetch disposition, normalized Git counts, lease expiry, action version, and verification history;
  - persist actor, timestamp, state transition, and sanitized summaries in action history.
- Exit criteria: each red behavior passes with the smallest complete implementation.

## Phase 4: Green Tests And Refactor

- Green command: rerun each focused `node --test` command unchanged.
- Refactor constraints: retain tool names, state transitions, safe defaults, and test assertions; do not add mutation tools.
- Regression checks: stack package tests and live in-memory MCP transport.
- Result: 8 package tests pass, including direct input-boundary rejection,
  credential redaction, expired-lock recovery, the lifecycle ledger, and live
  in-memory MCP preflight.
- Exit criteria: focused tests remain green after organization/readability refactors.

## Phase 5: Full Verification

- Targeted tests: `npm test` and `npm run verify` in `catalog/stacks/repo-steward`.
- Full suite: Registry `npm test`.
- Build/typecheck/lint: Registry `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, and `npm run build`.
- JS/TS debt scan: root architecture-aware scan limited to edited JS files.
- Package proof: `npm pack --dry-run --json`.
- Live smoke: generic Node stack verifier must launch the packaged MCP with isolated `HOME`/`RUDI_HOME` and match all manifest tools.
- Results:
  - `npm test` in the stack: 8 passed;
  - generic Node stack verifier: 8 manifest tools matched the live MCP;
  - stack `npm audit --package-lock-only --audit-level=moderate`: 0 vulnerabilities after updating the MCP SDK and its Hono adapter;
  - Registry `npm test`: 18 files and 157 tests passed;
  - `npm run validate`: 149 catalog packages passed, including both new packages;
  - `npm run indexes:sync` and `npm run indexes:check`: 149 packages current;
  - isolated staged-tree proof: 149 packages validated, the selectively staged
    canonical index was current, all 8 stack tests passed, and the live MCP
    matched all 8 manifest tools without any unrelated working-tree changes;
  - `npm run build`: passed;
  - `npm pack --dry-run --json`: all 11 Repo Steward stack/skill files included;
  - package-local structural debt scan with `src/index.js` as the entrypoint: 0 findings;
  - `git diff --check`: passed;
  - `npm run catalog:clean:check`: Repo Steward is clean; the command remains non-zero because the unrelated, pre-existing `catalog/stacks/opencounter/node_modules` directory is still present and was intentionally not changed.
- Exit criteria: all stack-specific and Registry correctness gates pass without
  personal configuration or credentials; unrelated pre-existing catalog
  hygiene is isolated and reported rather than modified.

## Phase 6: Docs, Contracts, And Closure

- Docs/API contracts:
  - stack README documents configuration schema, tools, state, safety, GitHub composition, and scheduling boundary;
  - operator skill documents observe/checkpoint/improve/publish modes and exact authorization gates;
  - manifest and generated index agree with the live MCP surface.
- Final files touched: record after verification.
- Commands run and results: record red/green, full suite, debt, index, build, package, and smoke proof.
- Accepted debt:
  - scheduling remains host-owned;
  - commits and GitHub mutations remain skill-directed through normal Git and `stack:github`;
  - V0 uses JSON files under `RUDI_HOME`, suitable for one-host stewardship rather than distributed coordination.
  - the generic Skill Creator validator does not accept Registry extension fields such as `requires`; the Registry's own compiler and reference validator are authoritative and pass the reciprocal stack contract.
- Definition of Done:
  - portable stack and skill are indexed;
  - exact allowlist/fetch/lease/action invariants are tested;
  - no mutation-capable Git or GitHub tool is exposed;
  - Registry verification passes;
  - only Repo Steward files are staged and committed.
