# Codex Task Management V1 — SWE Compliance Record

Status: complete — source implemented and verified; uncommitted and inactive

## Phase 0: Baseline And Manual Lookup

- Scope: add an explicit-invocation `$codex-tasks` skill and deterministic
  command validator for Codex Desktop task, project, and sidebar-section
  management.
- Files inspected before editing: repository `AGENTS.md`, `package.json`,
  catalog discovery and compiler code, the RUDI Chief-of-Staff skill and tests,
  the locally installed Codex project-task archiver, and the existing Codex
  Desktop orchestration research package.
- Relevant SWE manual sections: Engineering Operating Manual Index,
  Engineering Quick Reference, Testing Doctrine, Agent Co-Pilot Operating
  Standard, Security Engineering Standard trust-boundary guidance, Build Order
  Phase 5, and Horizontal Engineering and Codebase Stewardship Standard.
- Current-state commands: `git status -sb`, targeted `rg`, `git log`, and
  direct file inspection in the registry and business repositories.
- Horizontal-pattern scan: the local `codex-project-task-archiver` owns deep
  completion auditing and exact-set archival; `rudi-chief-of-staff` owns
  durable multi-task orchestration. They are semantically adjacent but do not
  own the same lifecycle as this direct command surface.
- Horizontal disposition: standardize the shared identity, fail-closed
  resolution, authority, and read-back contract while keeping the three
  implementations separate. Timing outcome: resolve in this change through
  compatible written contracts; do not modify the existing skills.
- Risks and invariants: task titles and section names are untrusted and
  non-unique; one primary target is required; native IDs are mutation
  authority; unsupported or ambiguous commands fail closed; no broad or
  inferred mutation; every successful mutation is read back; review never
  silently selects a specialist workflow.
- Initial risk tier and rationale: medium because the skill directs
  user-visible task creation, messages, sidebar metadata, and archival, even
  though the validator itself performs no native mutation.
- Exit criteria: current behavior and overlap boundaries are recorded, and no
  unrelated dirty path is selected for editing.

## Phase 1: Scope Lock

- In scope: closed V1 verb grammar; target and destination selectors; option
  validation; mutation-risk classification; task-ID normalization; skill
  instructions; explicit-only UI policy; focused tests; registry package
  generation; research updates.
- Non-goals: App Server client or MCP implementation, saved-project creation or
  rename, bulk archival, scheduling, direct Codex state-file/database editing,
  sidebar mutations during verification, installation or activation, changes
  to existing archiver or Chief-of-Staff skills, and admin-Mac synchronization.
- Expected files touched:
  - `catalog/skills/codex-tasks/SKILL.md`
  - `catalog/skills/codex-tasks/agents/openai.yaml`
  - `catalog/skills/codex-tasks/references/task-command-contract.md`
  - `catalog/skills/codex-tasks/scripts/validate-task-command.mjs`
  - `src/codex-tasks.test.ts`
  - `index.json` through the generated-index command only
  - this compliance record
  - the existing business research package
- External inputs and trust boundaries: user command tokens, task titles,
  section names, project paths, native tool results, and stored task content
  are untrusted until validated and resolved.
- Failure behavior to define: unknown verb/key, malformed token, duplicate key,
  missing/extra selector, incompatible selector, invalid enum, ambiguous live
  match, incomplete listing, unavailable native capability, partial mutation,
  and failed read-back.
- Authorized external actions: none. Local source edits and verification only.
- Commit strategy and authorization: two conceptual slices—(1) skill,
  validator, and tests; (2) generated index and research/compliance docs.
  Commits and publication are not authorized.
- Horizontal-obligation disposition: no follow-up consolidation obligation.
  Reassess only if another general Codex task-control surface is introduced or
  native capability contracts diverge.
- Review and approval gates: targeted red-green tests, full registry gates,
  changed-file debt scan, smoke examples, and an independent read-only review.
- Exit criteria: the contract and allowed paths are fixed before behavior is
  implemented.

## Phase 2: Red Tests

- Observable behavior to prove: the validator rejects unsupported verbs,
  malformed or ambiguous target contracts, and incompatible options while
  normalizing valid commands into one stable envelope.
- Test file: `src/codex-tasks.test.ts`.
- Red command: `npx vitest run src/codex-tasks.test.ts`.
- Initial expected failure: the unsupported `dance` verb was accepted.
- Subsequent behavior reds covered exact task-URI normalization, relative cwd
  rejection, rename mutation classification, the verb/action matrix, explicit
  review routing, enum and path validation, malformed and oversized inputs,
  exact capability binding, literal section-deletion confirmation, package
  structure, and mutation read-back.
- Post-green security red: `__proto__` was absorbed by a normal object instead
  of being rejected as an unknown untrusted key.
- Independent-review reds: empty argv inferred `help`; fork accepted
  `model`/`thinking` without a prompt and did not bind a supplied prompt to
  `send_message_to_thread`.
- Exit result: each test failed for its intended observable behavior rather
  than an import, syntax, or environment error.

## Phase 3: Implementation

- Implementation rules: no new dependencies; pure deterministic validation;
  exact known-key allowlists; size limits; stable JSON output; nonzero exit on
  invalid input; no native task or sidebar side effects in the script.
- Files allowed to change: only the Phase 1 paths.
- Validation and error-handling requirements: validate at the CLI boundary,
  reject unknown/duplicate/empty values, enforce verb-specific selectors and
  options, and produce actionable errors without echoing secrets.
- Observability requirements: normalized output includes schema version, verb,
  target, options, execution class, reasoning class, and read-back requirement.
- Security hardening: key storage uses null-prototype maps; no command defaults
  to a verb; fork model/thinking overrides require and configure an explicit
  child-task follow-up prompt.
- Exit result: all focused behavior tests pass without weakened assertions.

## Phase 4: Green Tests And Refactor

- Green command: `npx vitest run src/codex-tasks.test.ts`.
- Refactor constraints: preserve the tested command envelope and error model;
  keep parsing, validation, and rendering explicit.
- Regression checks: rerun the focused command after any refactor.
- Commit checkpoint: record the verified slice but do not commit without
  separate authorization.
- Result: 43 tests passed after final logic, review, documentation-fixture, and
  security changes.
- Exit result: focused tests remained green after final cleanup.

## Phase 5: Full Verification

- Targeted tests: `npx vitest run src/codex-tasks.test.ts`.
- Full suite: `npm test`.
- Build/typecheck/catalog gates: `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and
  `npm pack --dry-run --json`.
- JS/TS debt scan: run the packaged `swe_debt_scan` against the new test file
  and validator.
- Live smoke checks: run representative valid and invalid validator commands;
  do not invoke native mutations.
- Independent review: fresh-context review against the approved contract,
  applicable instructions, diff, and proof commands.
- Risk-tier approval: user approval is represented by the explicit
  `$set-goal-and-execute` invocation for local implementation; publication and
  activation remain separate.
- Results:
  - `npm test`: 29 files and 296 tests passed on the final run. An earlier run
    under concurrent repository activity timed out one unrelated
    `stack-verification` case; that exact test passed alone, and two later full
    runs passed.
  - `npm run validate`: 158 packages passed, 0 failed.
  - `npm run indexes:sync` and `npm run indexes:check`: generated indexes
    synchronized and current at 158 packages and 71 skills.
  - `npm run catalog:clean:check`: 0 cleanup targets.
  - `npm run build`: validation and compilation passed.
  - `npm pack --dry-run --json`: all four `codex-tasks` bundle files are in the
    package.
  - `node --check` and representative valid/invalid CLI smoke commands passed.
  - `swe_debt_scan` with the validator and test declared as entrypoints: 0
    errors, 0 warnings, and 0 informational findings.
  - Skill quick validation through an ephemeral PyYAML environment: `Skill is
    valid!`; no repository dependency was added.
  - `git diff --check`: passed.
- Exit result: required checks pass and all deterministic in-scope findings are
  resolved.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: task command contract, skill entrypoint,
  orchestration research README/Foundation, and an impact-map record.
- Final task-owned files:
  - `catalog/skills/codex-tasks/SKILL.md`
  - `catalog/skills/codex-tasks/agents/openai.yaml`
  - `catalog/skills/codex-tasks/references/task-command-contract.md`
  - `catalog/skills/codex-tasks/scripts/validate-task-command.mjs`
  - `src/codex-tasks.test.ts`
  - `docs/swe-compliance/2026-09-02-codex-task-management.md`
  - generated `index.json`, whose pre-existing unrelated edits were preserved
  - `research-and-intelligence/codex-desktop-orchestration/README.md`,
    `FOUNDATION.md`, and `IMPACT-MAP.md` in the RUDI business repository
- Commands and results are recorded in Phase 5.
- Evidence artifacts: this record, test output, catalog validation, package
  listing, debt scan, and independent-review verdict.
- Independent-review result: pass on Standards, Spec, and Proof, with no
  remaining P0-P3 findings. Interim findings for implicit empty-input help,
  fork follow-up routing, and workstation/account-shaped public fixtures were
  fixed and reverified.
- Commit ledger and publication status: planned slices remain uncommitted;
  push, PR, merge, release, installation, activation, and admin synchronization
  are not authorized.
- Horizontal obligations opened, closed, or accepted: none. The existing
  project-task archiver and RUDI Chief-of-Staff retain their narrower and
  higher-level ownership boundaries respectively.
- Final verdict: complete for local source implementation and verification.
  Commit, push, PR, release, installation, activation, scheduling, live sidebar
  mutation, and admin-Mac synchronization remain unperformed and unauthorized.
- Accepted debt: none identified at scope lock.
- Proof gaps: native sidebar mutations are intentionally excluded from smoke
  verification.
- Definition of Done: met. The canonical skill package, validator, generated
  index, tests, and research documentation agree; all proportionate checks and
  independent review pass; unrelated work remains preserved.
