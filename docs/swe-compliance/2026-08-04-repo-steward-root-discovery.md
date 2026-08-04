# SWE Compliance — Repo Steward Root Discovery

Date: 2026-08-04

Status: **Verified**

## Phase 0: Baseline And Manual Lookup

- Scope: upgrade `stack:repo-steward` so a user can provide one directory path,
  persist that root locally, discover every nested Git worktree, and apply the
  existing stewardship loop to the dynamic fleet.
- Files inspected before editing:
  - Registry and global `AGENTS.md` instructions;
  - Repo Steward core, MCP transport, tests, manifest, README, and operator skill;
  - SWE manual index, Security F4/F5/F13, Backend G7/G11/G12/G13, and Testing Appendix C.
- Current state:
  - v0.1.0 accepts exact repositories through `REPO_STEWARD_CONFIG_PATH`;
  - status, leases, action transitions, verification evidence, and targeted
    operator guidance are already implemented and committed at `7ca1d06`;
  - unrelated OpenCounter, RUDI CRM, root package, generated-index, and quality-gate work remains dirty.
- Risks and invariants:
  - never follow symlinks or traverse Git metadata, dependency, virtualenv, or cache directories;
  - bound traversal depth, directories visited, repositories returned, Git output, and Git duration;
  - persist enrollment only under `RUDI_HOME`, never inside the enrolled workspace;
  - keep discovery and status read-only; only explicit policy-permitted fetch may change Git metadata;
  - never expose a tool that stages, commits, pushes, merges, resets, cleans, or mutates GitHub;
  - preserve stable repository IDs for an unchanged root and relative path;
  - keep the previous explicit-repository configuration compatible;
  - do not stage or commit unrelated Registry changes.
- Exit criteria: the user-facing path contract, traversal boundary, persistence model, and proof commands are explicit.

## Phase 1: Scope Lock

- In scope:
  - one local-state tool to enroll an absolute directory root;
  - idempotent enrollment with actor, timestamp, version, and bounded history;
  - optional external `roots` configuration alongside explicit `repositories`;
  - deterministic recursive discovery of Git worktrees represented by `.git`
    directories or files, including nested repositories;
  - automatic rediscovery on preflight, fleet scan, status, lease, and ledger operations;
  - root-policy inheritance for fetch permission and maximum traversal depth;
  - manifest, README, MCP schema, package tests, and operator-skill updates.
- Non-goals:
  - bare Git repositories, symlink traversal, filesystem watching, daemon scheduling,
    arbitrary shell discovery, automatic staging/commits/pushes, or root removal;
  - changing the GitHub stack or unrelated Registry packages.
- Expected files touched:
  - `catalog/stacks/repo-steward/{manifest.json,package.json,package-lock.json,README.md}`;
  - `catalog/stacks/repo-steward/src/{core.js,index.js}`;
  - `catalog/stacks/repo-steward/test/{core.test.js,mcp.test.js,package-contract.test.js}`;
  - `catalog/skills/rudi-repo-steward/{SKILL.md,agents/openai.yaml}`;
  - this checklist and the two Repo Steward entries in generated `index.json`.
- External inputs and trust boundaries:
  - `root_path`, `root_id`, owner, fetch policy, and depth arrive through an agent tool call and are untrusted;
  - directory entries, `.git` markers, filesystem errors, Git roots, and optional external config are untrusted;
  - root enrollment expands visibility across a filesystem subtree but grants no repository mutation authority.
- Failure behavior:
  - reject relative, missing, non-directory, duplicate-ID, overlapping-root, and out-of-bounds input;
  - skip configured traversal exclusions and symlinks deterministically;
  - return bounded discovery failures for unreadable or invalid Git candidates;
  - reject policy-changing reenrollment rather than silently widening permission;
  - write enrollment atomically under an exclusive, expiry-aware configuration lock;
  - preserve the prior enrollment document if discovery or persistence fails.
- Exit criteria: tests can express root enrollment, nested discovery, rediscovery, exclusions, and compatibility.

## Phase 2: Red Tests

- Observable behavior to prove:
  1. one enrolled root discovers its own Git worktree plus nested child worktrees;
  2. repository IDs are deterministic from root ID and relative path;
  3. symlinks, `.git`, `node_modules`, virtualenvs, and caches are not traversed;
  4. a new child repository appears on the next discovery/scan without reenrollment;
  5. enrollment persists under local state and is idempotent for the same path and policy;
  6. old explicit-repository config continues to work;
  7. the MCP and manifest expose exactly the upgraded tool surface.
- Test files: existing Repo Steward package tests.
- Red command: `node --test test/core.test.js` from the stack directory.
- Expected failure: root enrollment/discovery exports do not exist.
- Observed red:
  - `node --test test/discovery.test.js` failed because `discoverRepositories`
    and `enrollRepositoryRoot` were not exported;
  - the MCP test then failed because the live tool list lacked enrollment and discovery;
  - the package contract then failed because the manifest remained at v0.1.0.
- Exit criteria: failure is caused by missing requested behavior, not fixture setup.

## Phase 3: Implementation

- Implementation rules:
  - use Node built-ins and `execFile` only; add no dependency;
  - use iterative directory traversal, `lstat`/`Dirent` boundaries, and no symlink following;
  - validate every discovered candidate with exact realpath/Git-toplevel identity;
  - keep explicit repositories higher priority than dynamically discovered duplicates;
  - use atomic JSON replacement with mode `0600` and state directories with mode `0700`;
  - archive stale enrollment locks and previous enrollment versions.
- Files allowed to change: Phase 1 files only.
- Validation and error handling:
  - closed schemas, absolute realpaths, stable IDs, safe booleans, depth 0–32,
    at most 1,000 repositories and 100,000 visited directories;
  - sanitized bounded errors and no repository file content in results.
- Observability:
  - report root ID/path/policy, directories visited, candidates found, valid
    repositories, discovery failures, exclusions, enrollment version, and idempotency.
- Exit criteria: each focused red behavior passes with no new Git mutation capability.

## Phase 4: Green Tests And Refactor

- Green command: rerun each focused Node test unchanged.
- Refactor constraints: retain v0.1 status, lease, ledger, and security contracts.
- Regression checks: all stack tests and live in-memory MCP transport.
- Result: 11 package tests pass. The fleet scan was refactored to discover once
  per run instead of repeating the entire traversal for every child repository.
- Exit criteria: focused and package tests remain green after organization.

## Phase 5: Full Verification

- Targeted tests: stack `npm test`, package-owned verify, and generic live Node stack verifier.
- Full suite: Registry `npm test`.
- Build/typecheck/lint: Registry validate, index sync/check, build, hygiene, and pack dry run.
- JS/TS debt scan: package-local structural scan with `src/index.js` as entrypoint.
- Security proof: stack package-lock audit at moderate severity.
- Staged-tree proof: validate the exact staged commit tree independently of unrelated working-tree changes.
- Results:
  - stack `npm test`: 11 passed;
  - generic Node verifier: all 10 manifest tools matched the live MCP;
  - stack audit: 0 vulnerabilities;
  - Registry validate: 149 packages passed;
  - Registry `npm test`: 18 files and 157 tests passed;
  - index sync/check and build: passed;
  - package-local structural debt scan: 0 findings;
  - package dry run: all 12 Repo Steward stack/skill files included;
  - `git diff --check` and Node syntax checks: passed;
  - isolated staged-tree proof: all 11 stack tests, the 10-tool live MCP,
    149-package Registry validation, the selective canonical index, and the
    dependency audit passed without unrelated working-tree changes;
  - live discovery smoke against `/Users/hoff/dev/RUDI`: 46 Git worktrees from
    12,776 visited directories, 117 excluded directories, 92 skipped symlinks,
    and 0 failures in about two seconds, with temporary state and no fetch;
  - catalog hygiene remains non-zero only for the unrelated pre-existing
    `catalog/stacks/opencounter/node_modules` directory, which was not changed.
- Exit criteria: all stack-specific correctness, security, package, and Registry compilation gates pass; unrelated hygiene is isolated and reported.

## Phase 6: Docs, Contracts, And Closure

- Docs/API contracts:
  - README explains the one-path flow, discovery exclusions, stable IDs, and cadence boundary;
  - operator skill begins with path enrollment/discovery and then applies the safe stewardship loop;
  - manifest, index, and live MCP agree.
- Final files touched: record after verification.
- Commands run and results: record red, green, full suite, audit, debt, build, pack, and staged-tree proof.
- Accepted debt:
  - host scheduling remains outside the stack;
  - root removal and policy updates require a later explicit lifecycle design;
  - moved repositories receive a new relative-path-derived ID;
  - bare repositories and symlinked subtrees are excluded in v0.2.0.
  - Registry extension frontmatter (`requires`, version, category, and tags)
    remains intentionally incompatible with the generic Skill Creator checker;
    the Registry compiler and reciprocal-reference validator are authoritative
    and pass. Forward-testing with a subagent was not run because active
    collaboration instructions do not permit spawning one without an explicit
    user request.
- Definition of Done:
  - a single directory path enrolls and returns its complete bounded Git worktree fleet;
  - later child repositories appear automatically;
  - the existing stewardship loop operates on discovered repo IDs;
  - no automatic Git/GitHub mutation tool is exposed;
  - only Repo Steward files and its generated index entries are committed.
