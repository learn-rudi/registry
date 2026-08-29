# Set Goal And Execute Registry Publication

Status: local engineering gates passed; Registry publication pending

## Phase 0: Baseline And Manual Lookup

- Scope: publish `skill:set-goal-and-execute` as a portable RUDI Registry
  package so other users can discover and install the approved goal-driven
  execution contract.
- Files inspected before editing: global and Registry `AGENTS.md`, Registry
  catalog compiler and focused tests, current portable Delivery Loop skills,
  generated-index workflow, the locally validated skill, and current Git and
  worktree state.
- Relevant SWE manual sections: Engineering Operating Manual Index,
  Engineering Quick Reference, Agent Co-Pilot Operating Standard, Horizontal
  Engineering And Codebase Stewardship Standard, and RUDI Agentic Engineering
  Standard.
- Current-state commands: `git fetch origin`, `git status -sb`, `git worktree
  list --porcelain`, `git rev-parse origin/main`, bounded `rg`, and direct
  source inspection.
- Baseline: clean isolated worktree
  `/Users/admin/RUDI/worktrees/registry/set-goal-and-execute-20260829` on
  `codex/set-goal-and-execute-registry-20260829`, based on `origin/main`
  `b037be0bf5d5997c3dd541f9f1a525f581a17ba7`.
- Horizontal-pattern scan: no existing Registry skill owns host-native durable
  goal creation or continuation. `rudi-chief-of-staff` owns multi-node
  coordination, `swe-compliance-checklist` owns engineering gates,
  `rudi-repo-steward` owns Git lifecycle state, and
  `rudi-worktree-closeout` owns non-mutating closeout evidence. The new skill
  is a front-door execution contract and must compose rather than duplicate
  those owners.
- Risks and invariants:
  - the skill must remain host-neutral and contain no machine-local paths;
  - an approved brief authorizes normal scoped implementation, not unrelated
    scope expansion;
  - commit, push, PR, merge, publication, deployment, activation, destructive
    actions, purchases, and external messages remain distinct gates;
  - an existing different unfinished goal is never falsely completed or
    blocked merely to replace it;
  - the goal is complete only when the requested outcome and proportionate
    verification are complete;
  - generated Registry indexes are generator-owned and never hand-edited.
- Initial risk tier: Medium. This adds publicly downloadable agent behavior and
  generated catalog state, but no secrets, runtime service, migration, or
  destructive capability.
- Exit criteria: exact source, authority, ownership boundaries, failure
  behavior, tests, generated outputs, and publication proof are explicit.

## Phase 1: Scope Lock

- In scope:
  - add the canonical bundled skill and Codex UI metadata;
  - add focused Registry coverage for package identity, portability,
    ownership, goal lifecycle, and authority gates;
  - regenerate public Registry indexes and release artifacts;
  - verify the package, publish a feature branch and pull request, merge after
    green checks, and verify `origin/main` plus the public raw index.
- Non-goals: changing goal-tool implementations, adding a new agent runner,
  changing other Delivery Loop skills, deploying or scheduling behavior,
  installing projections on either Mac, synchronizing workstations, deleting
  worktrees, or changing the active NFL research goal.
- Expected files touched:
  - `catalog/skills/set-goal-and-execute/SKILL.md`;
  - `catalog/skills/set-goal-and-execute/agents/openai.yaml`;
  - `src/portable-agentic-workflow-skills.test.ts`;
  - generator-owned `index.json` and `dist/**` outputs;
  - this compliance record.
- External inputs and trust boundaries: the preceding brief, active goal
  state, referenced artifacts, repository files, host tool availability, test
  output, GitHub state, and public index responses are untrusted until read
  back and validated.
- Failure behavior:
  - missing or materially ambiguous approved scope stops before mutation;
  - a matching active goal continues without duplication;
  - a different unfinished goal is preserved and surfaced rather than falsely
    terminated;
  - absence of host-native goal persistence is reported as a durability proof
    gap, not hidden behind a fake task or automation;
  - unauthorized external or destructive gates remain pending and visible;
  - failed verification prevents completion and publication.
- Authorized external actions: the user explicitly authorized Registry
  publication so others can download the skill. Under Registry GitHub policy,
  that includes a task-owned local commit, feature-branch push, pull request,
  and merge after green review/checks. Installation, cross-Mac sync,
  deployment, activation, archive, cleanup, and deletion remain unauthorized.
- Commit strategy and authorization: one coherent commit for the skill,
  focused contract, compliance evidence, and regenerated catalog outputs;
  stage task-owned paths explicitly and inspect the staged diff. Publication
  is authorized through a feature branch only; never push directly to main.
- Horizontal-obligation disposition: no new obligation. Decision: standardize
  the handoff contract by naming the existing capability owners while keeping
  implementations separate. Reassess if another skill independently claims
  host-native goal lifecycle ownership.
- Review and approval gates: focused red/green test, full Registry tests,
  validation, index, hygiene, build, package dry-run, JS/TS debt scan, diff
  review, GitHub checks, merged-main readback, public index readback, and
  non-mutating worktree closeout evidence or an explicit proof gap.
- Exit criteria: no path or external action outside this scope proceeds without
  new authority.

## Phase 2: Red Tests

- Observable behavior to prove: Registry publishes a portable
  `skill:set-goal-and-execute` version `1.0.0` bundle whose contract creates or
  continues one durable goal, executes the full approved outcome, composes the
  existing Delivery Loop owners, preserves separate authority gates, and
  exposes consistent Codex UI metadata.
- Test file: `src/portable-agentic-workflow-skills.test.ts`.
- Red command: `npm test -- src/portable-agentic-workflow-skills.test.ts`.
- Expected failure: the new package and its canonical bundle do not exist.
- Red result: the focused command ran 11 tests and failed exactly the two new
  contracts: the index entry was `undefined`, and the canonical `SKILL.md` did
  not exist. The other nine tests passed.
- Exit criteria: the focused test fails for the missing package, not for an
  environment or dependency error.

## Phase 3: Implementation

- Implementation rules: copy the validated behavior into one portable
  canonical bundle, add only Registry metadata needed for public delivery, and
  preserve the selected stable package ID.
- Files allowed to change: only the paths locked in Phase 1.
- Validation and error-handling requirements: goal conflicts, missing goal
  persistence, scope ambiguity, verification failure, and authority boundaries
  must fail visibly and conservatively.
- Observability requirements: final reporting names accomplished behavior,
  decisive proof, remaining gaps, goal state, and each relevant external gate.
- Implemented: a version `1.0.0` bundled skill with Codex UI metadata, explicit
  goal create/continue/conflict behavior, Delivery Loop composition boundaries,
  separate authority gates, conservative terminal rules, and a portable host
  fallback when durable goal state is unavailable.
- Exit criteria: the unchanged focused red command passes without weakening
  assertions.

## Phase 4: Green Tests And Refactor

- Green command: rerun the Phase 2 command unchanged.
- Refactor constraints: keep the skill self-contained and concise; add no
  scripts, dependencies, aliases, or duplicate orchestration mechanism.
- Regression checks: catalog compilation and existing portable Delivery Loop
  skill contracts remain green.
- Commit checkpoint: commit only after full verification and staged-diff
  review.
- Green result: after the package and generated index were added, the first
  rerun exposed one wording mismatch in the new skill contract. The skill was
  tightened to state the matching-active-goal invariant directly. The unchanged
  focused command then passed 11/11. A bounded review strengthened the Windows
  absolute-path portability assertion; the focused command remained 11/11 and
  the edited-file debt scan remained at zero findings.
- Exit criteria: focused tests and `git diff --check` pass.

## Phase 5: Full Verification

- Targeted tests: focused portable-agentic-workflow test.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run indexes:sync`, `npm run
  indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack
  --dry-run --json`.
- JS/TS debt scan: scan the edited focused test and run the repository debt
  profile.
- Live smoke checks: resolve the package from generated index; after merge,
  verify `origin/main` and the canonical public raw index expose the exact
  package ID and install path.
- Independent review: use available independent automated GitHub checks and a
  bounded final diff review. A fresh delegated model review is unavailable
  unless separately authorized under the active collaboration policy and will
  be recorded as a proof gap if not otherwise supplied.
- Risk-tier approval: public Registry publication is explicitly authorized;
  installation and other downstream effects are not.
- Current proof results:
  - focused red: 2 expected failures and 9 passes;
  - focused green/refactor: 11/11 passes;
  - full Registry suite: 29 files and 255/255 tests pass;
  - `npm run validate`: 159/159 packages pass;
  - `npm run indexes:sync` and `npm run indexes:check`: 159 packages, 73
    skills, and 833 catalog files; generated root begins `c1649abead520f5a`;
  - `npm run catalog:clean:check`: zero planned targets;
  - `npm run build` and `npm run release:verify`: pass, including seven release
    artifact hashes;
  - `npm pack --dry-run --json`: 1,007 entries and both skill bundle files are
    present;
  - root debt profile and edited-file SWE debt scan: zero findings;
  - `git diff --check`: pass;
  - public-readiness initially failed closed because the new indexed package
    was untracked, then passed with zero errors and zero warnings after staging
    only the two canonical package files.
- Review result: bounded staged-diff review found no skill defect, secret,
  machine-local path, destructive capability, or ownership collision. It found
  and corrected the Windows-path test weakness described in Phase 4. A fresh
  delegated model review is not authorized by the active collaboration policy;
  independent GitHub checks remain the publication review gate.
- Exit criteria: all required gates pass or publication stops with the exact
  failing boundary.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: the skill contract and this evidence record;
  no unrelated manuals or package docs.
- Final files touched: the two canonical skill bundle files, the focused
  portable-workflow contract test, generator-owned `index.json`, and this
  compliance record.
- Commands run and results: recorded in Phase 5; all local required gates pass.
- Evidence artifacts: commit, pull request, GitHub checks, merged-main package
  entry, public index entry, and worktree closeout receipt or proof gap.
- Independent-review result: bounded self-review passed after one test-strength
  correction; GitHub checks pending; fresh delegated-model review is an
  explicit proof gap under the current no-delegation policy.
- Commit ledger and publication status: one task-owned commit, feature-branch
  push, pull request, checks, merge, and public-index readback remain pending.
  The commit cannot record its own object ID; exact publication lineage will be
  reported from post-action readback.
- Horizontal obligations opened, closed, or accepted: none currently open;
  pending final review.
- Final verdict: local engineering gate PASS; public publication pending.
- Accepted debt: none identified in scope.
- Proof gaps: fresh delegated-model review is unavailable without separate
  delegation authority; GitHub checks and merged/public readback are pending.
- Definition of Done: the package is present on public Registry main, resolves
  to the canonical bundle, passes all relevant checks, is downloadable through
  the published index, and downstream install/sync/deployment gates remain
  honestly reported.
