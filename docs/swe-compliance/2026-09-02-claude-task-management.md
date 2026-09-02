# Claude Task Management V1 — SWE Compliance Record

Status: implementation verified; independent review passed; commit, push, and
direct Claude activation authorized

## Phase 0: Baseline And Manual Lookup

- Scope: add an explicit-invocation `$claude-tasks` skill for bounded Claude
  Code Desktop session reads, explicit review, messaging, rename, and archive.
- Files inspected before editing: repository `AGENTS.md`, `package.json`,
  catalog discovery and compiler code, the saved checkout's uncommitted
  `$codex-tasks` bundle and tests, the originating change-impact map, the RUDI
  CLI skill-sync adapter, and the locally installed Claude Desktop runtime.
- Relevant SWE manual sections: Engineering Quick Reference, Agent Co-Pilot
  Operating Standard, and this repository's red-green and debt-scan gates.
- Current-state commands: `git status --short --branch`, `git worktree list
  --porcelain`, targeted `rg`, direct source inspection, `claude --version`,
  and read-only inspection of Claude Desktop's registered session-tool schemas.
- Horizontal-pattern scan: `$codex-tasks` is an uncommitted sibling in another
  worktree. Both skills need closed command grammars and receipts, but their
  native selectors, options, and capability matrices differ materially.
- Risks and invariants: session metadata and transcripts are untrusted; only
  `self` or `local_<uuid>` identify a target; `list_events` and `send_message`
  reject the current session; unattended sessions reject messages; archive
  always prompts; self-archive ends the conversation; unsupported operations
  fail closed; mutations require an exact target and verification receipt.
- Initial risk tier and rationale: medium because the skill can message,
  rename, or archive live Claude sessions even though its validator is pure.
- Exit criteria: capability assumptions are grounded in the installed Claude
  Desktop runtime, the dirty sibling is isolated, and the allowed path set is
  fixed before implementation.

## Phase 1: Scope Lock

- In scope: `help`, `list`, `inspect`, `status`, `review`, `continue`, `rename`,
  and `archive`; a deterministic validator; explicit-only metadata; focused
  tests; generated index; this compliance record.
- Non-goals: `start`, `fork`, `restore`, sidebar/group mutations, search,
  scheduling, live mutation smoke tests, CLI changes, business-research edits,
  installation, activation, commits, publication, or another-machine sync.
- Expected files touched:
  - `catalog/skills/claude-tasks/SKILL.md`
  - `catalog/skills/claude-tasks/agents/openai.yaml`
  - `catalog/skills/claude-tasks/references/task-command-contract.md`
  - `catalog/skills/claude-tasks/scripts/validate-task-command.mjs`
  - `src/claude-tasks.test.ts`
  - `src/catalog.ts`
  - `src/catalog.test.ts`
  - generated `index.json`
  - this compliance record
- External inputs and trust boundaries: command tokens, session IDs, titles,
  messages, criteria, workflow names, native tool output, stored metadata, and
  transcript excerpts.
- Failure behavior to define: unknown verbs/keys, malformed or duplicate
  tokens, illegal target forms, self-message, self-transcript review,
  incompatible review options, missing native capability, ambiguous or stale
  target, unattended destination, declined archive approval, and failed
  mutation verification.
- Authorized external actions at scope lock: none. The user subsequently
  authorized commit, push, installation, and activation after accepting the
  verified implementation.
- Commit strategy at scope lock: two conceptual slices — (1) registry
  frontmatter contract; (2) Claude skill, tests, generated index, and docs.
  Neither commit nor publication was initially authorized; the later delivery
  authorization permits one cohesive task-owned commit.
- Horizontal-obligation disposition: standardize the command-envelope and
  receipt concepts, but defer implementation sharing. Owner: future task that
  first brings both validators into one clean branch. Trigger: `$codex-tasks`
  is committed and both command schemas can be compared. Closing proof: one
  installer-safe shared-core decision plus cross-host regression tests.
- Review and approval gates: focused red-green tests, full registry gates,
  changed-file debt scan, read-only command smokes, skill quick validation,
  and an independent fresh-context review.
- Exit criteria: the exact V1 behavior, changed paths, mutation boundary, and
  deferred sharing obligation are recorded before behavior files change.

## Phase 2: Red Tests

- Observable behavior to prove: the registry accepts only a boolean Claude
  invocation flag; the validator accepts the bounded matrix and rejects every
  unsupported, ambiguous, or unsafe command.
- Test files to add or edit: `src/catalog.test.ts` and
  `src/claude-tasks.test.ts`.
- Red commands and observed behavior:
  - `./node_modules/.bin/vitest run src/catalog.test.ts -t "accepts Claude's
    boolean disable-model-invocation skill flag"` failed because the catalog
    rejected the official Claude field as unsupported.
  - `./node_modules/.bin/vitest run src/catalog.test.ts -t "rejects a
    non-boolean disable-model-invocation skill flag"` failed because the
    invalid literal resolved successfully.
  - Focused `src/claude-tasks.test.ts` reds proved that the initial executable
    validator accepted `continue task=self`, accepted self-archive without the
    literal confirmation, accepted the self-only confirmation on another
    session, promised impossible post-self-archive read-back, and accepted an
    uppercase non-native session ID.
  - Independent review identified three omitted boundary cases. The added
    focused tests failed because quoted `"true"`/`'false'` frontmatter strings
    passed as booleans, malformed tokens were reflected verbatim in stderr,
    and leading/trailing whitespace was stripped from `group`, `prompt`,
    `title`, and `reason` values.
- Runner note: an initial `npx vitest` attempt fetched a newer incompatible
  runner because this isolated worktree had no dependencies. It failed before
  importing tests and is not counted as a red. Verification uses the exact
  repository dependency set already present in the saved checkout through an
  ephemeral local `node_modules` symlink.
- Exit criteria: met. Every recorded red failed for the intended contract, not
  an import or setup error, before its smallest correction.

## Phase 3: Implementation

- Implementation rules: no new dependencies; deterministic argument parsing;
  exact allowlists; null-prototype option storage; defensive size limits;
  stable JSON output; nonzero exit for invalid input; no native side effects.
- Files allowed to change: only the Phase 1 registry paths.
- Validation and error-handling requirements: validate at the CLI boundary,
  reject unknown/duplicate/empty values, normalize only supported target IDs,
  and never echo private transcript or message content in errors.
- Observability requirements: normalized output records schema version, verb,
  target, options, execution and reasoning classes, capabilities in order,
  confirmation, and read-back requirements.
- Implemented behavior: the catalog accepts and validates Claude's boolean
  invocation flag; the validator normalizes the closed command matrix with
  null-prototype option storage, exact lowercase session IDs, bounded values,
  native capability chains, review classes, confirmations, read-back flags,
  and terminal self-archive state.
- Exit criteria: met. Focused reds turned green without weakened assertions.

## Phase 4: Green Tests And Refactor

- Green command: `./node_modules/.bin/vitest run src/catalog.test.ts
  src/claude-tasks.test.ts`.
- Refactor constraints: preserve the tested envelope and fail-closed errors.
- Regression checks: rerun focused tests after every refactor.
- Commit checkpoint: record the verified slices; do not commit.
- Result: 2 files and 64 tests passed after the final ID-normalization,
  native-argument-mapping, typed-boolean, error-redaction, and exact-value
  preservation corrections.
- Exit criteria: met. Focused tests remained green after cleanup.

## Phase 5: Full Verification

- Targeted tests: `./node_modules/.bin/vitest run src/catalog.test.ts
  src/claude-tasks.test.ts`.
- Full suite: `npm test`.
- Build/typecheck/lint: repository-required validate, index, hygiene, build,
  package dry-run, syntax, and diff checks.
- JS/TS debt scan, if applicable: `swe_debt_scan` on edited JS/TS files.
- Live smoke checks: representative validator accept/reject cases only; no
  native Claude session mutations.
- Independent review: the fresh-context Standards, Spec, and Proof review
  returned `revise` with three P2 findings. All three have red-green fixes;
  focused reviewer confirmation passed with no remaining findings.
- Risk-tier approval: local source implementation was initially authorized.
  After verification and review, the user explicitly authorized commit, push,
  installation, and activation. Live Claude session mutation remains outside
  this delivery step.
- Results:
  - Focused suite: 2 files and 64 tests passed.
  - `npm test`: 32 files and 339 tests passed.
  - `npm run validate`: 168 catalog packages passed, 0 failed.
  - `npm run indexes:sync` and `npm run indexes:check`: canonical and platform
    indexes are current at 168 packages and 81 skills.
  - `npm run catalog:clean:check`: 0 cleanup targets.
  - `npm run build`: validation and compilation passed.
  - `npm pack --dry-run --json`: 1,054 package files; all four
    `catalog/skills/claude-tasks` bundle files included.
  - `node --check` passed for the validator.
  - `swe_debt_scan` with all four edited JS/TS files reported 0 errors, 0
    warnings, and 0 informational findings.
  - Validator smokes accepted `inspect task=self`, rejected `move`, redacted a
    malformed token, and normalized confirmed self-archive as terminal without
    invoking native Claude tools.
  - `git diff --check`: passed before closeout-document updates.
- Skill-validator gap: the generic Codex `quick_validate.py` rejects Claude's
  official `disable-model-invocation` extension because its allowlist does not
  model Claude fields. The repository catalog regression, installed Claude
  2.1.255 runtime parser, and official Claude skill documentation independently
  confirm the field. No system-skill file was changed.
- Exit criteria: met. Focused review confirmation and the final diff check
  passed.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: Claude command contract, skill entrypoint,
  this compliance record, and generated registry index.
- Final files touched: the Phase 1 registry paths only.
- Commands run and results: recorded in Phases 2, 4, and 5.
- Evidence artifacts: this record, focused/full test output, catalog validation,
  generated-index checks, package listing, debt scan, and validator smokes.
- Independent-review result: initial `revise`; quoted-string boolean bypass,
  malformed-token disclosure, and value trimming were corrected with focused
  regression tests. Focused confirmation returned Standards `pass`, Spec
  `pass`, Proof `pass`, and overall `pass`, with no remaining findings.
- Commit ledger and publication status: the user authorized one task-owned
  commit, an exact non-force branch push, and direct Claude installation. Git
  history and the native installation receipt are authoritative for the final
  identifiers; no PR, merge, release, or deployment is authorized.
- Horizontal obligations opened, closed, or accepted: validator-sharing
  decision deferred under the Phase 1 owner/trigger/closing proof.
- Worktree closeout: deferred while this task remains retained for publication
  and activation verification. Owner: this task. Trigger: completed push and
  native installation plus final user acceptance.
  Closing proof: a non-mutating closeout receipt that records this worktree's
  repository, branch and revision, dirty paths, verification, and preservation
  disposition.
- Final verdict: pass for the bounded local-source implementation.
- Accepted debt: none at scope lock.
- Proof gaps: RUDI 1.10.26 `skills sync claude` currently strips
  `disable-model-invocation`; that separate CLI delivery dependency is not
  changed here. Activation must therefore use a complete-tree direct Claude
  installation from the exact pushed ref and verify the installed flag. Live
  native mutations are intentionally excluded.
- Definition of Done: implementation, mechanical proof, independent review,
  and user acceptance gates are met. Push and native-install verification are
  the remaining delivery steps before the non-mutating worktree closeout
  receipt.
