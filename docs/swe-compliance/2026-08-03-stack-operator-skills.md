# Stack Operator Skills — SWE Compliance Checklist

Status: complete (with one accepted pre-existing CLI test-runner compatibility issue)

Goal: make the agent-facing operating layer part of every published RUDI
stack. Installing a stack must install its primary operator skill, sync an
editable native wrapper into detected Codex and Claude hosts, and let the user
invoke the skill without knowing MCP tool names.

Repositories in scope:

- `/Users/hoff/dev/RUDI/apps/registry` — package contract, catalog, validation,
  generated index, operator skills, and registry documentation.
- `/Users/hoff/dev/RUDI/apps/cli` — package resolution, install planning,
  native host synchronization, user-visible install output, and CLI tests.

## Phase 0: Baseline And Manual Lookup

- Scope:
  - Inspect the current schema-v2 `related.skills` relationship.
  - Inspect skill frontmatter parsing and catalog referential-integrity checks.
  - Inspect CLI related-skill resolution, installation, and Codex/Claude sync.
  - Inventory every published stack and its current related skills.
- Files to inspect before editing:
  - Registry: `schemas/package.schema.json`, `src/resolver.ts`, `src/catalog.ts`,
    `src/catalog.test.ts`, `src/schema.test.ts`, `src/compile.test.ts`,
    `SCHEMA.md`, `README.md`, `STACK_TEMPLATE.md`, all stack manifests, and
    existing skills that already operate stacks.
  - CLI: `packages/core/src/resolver.js`,
    `packages/core/src/__tests__/unit/resolver-related-skills.test.js`,
    `src/commands/install.js`, `src/commands/skills.js`,
    `src/commands/related-skills.js`, and their focused tests.
- Relevant SWE manual sections:
  - Master doctrine principles 2, 4, and 6: explicit invariants, boundary
    validation, and designed failure behavior.
  - Appendix C, especially C2, C5, C7, and C7A: boundary tests and
    agent-assisted red-green-refactor.
  - Build Order Phase 5: bounded agent workflows, explicit failure modes, and
    validated agent-facing contracts.
- Current-state commands:
  - `git status --short --branch` in both repositories.
  - Catalog inventory script counting stacks with related and reciprocal
    skills.
  - Focused registry and CLI test commands before editing.
- Risks and invariants:
  - Preserve unrelated dirty work in both repositories.
  - `index.json` remains generated; never hand-edit it.
  - A primary operator skill is distinct from an optional companion workflow.
  - Skills remain editable catalog packages; stacks remain executable MCP
    packages.
  - No skill may claim tools absent from its stack manifest.
- Exit criteria:
  - Current contract, missing behavior, dirty-file overlap, and proof commands
    are known before the first behavior change.

## Phase 1: Scope Lock

- In scope:
  - Extend `related` with one required `operatorSkill` for stack packages.
  - Require the operator skill to be present in `related.skills` and to declare
    the stack in `requires.stacks`.
  - Give every published stack a primary operator skill.
  - Preserve optional related workflow skills.
  - Make CLI stack installation automatically install the missing operator
    skill while preserving the existing opt-in/offer behavior for companion
    skills.
  - Sync newly installed operator skills into detected Codex and Claude native
    skill directories without overwriting existing user wrappers.
  - Surface the operator skill distinctly in CLI package information.
- Non-goals:
  - Redesign MCP transport, router indexing, secrets storage, agent execution,
    or provider authentication.
  - Add new stack tools or change stack runtime behavior.
  - Overwrite existing user-edited native skills.
  - Refactor unrelated registry lifecycle or CLI command work.
- Expected files touched:
  - Registry schema/types/catalog validator and focused tests.
  - Stack manifests and catalog operator-skill Markdown sources.
  - Generated `index.json` and generated registry distribution artifacts only
    through repository scripts.
  - Registry schema, roadmap, template, and contribution documentation.
  - CLI core resolver, install planner/presentation, related-skill formatter,
    focused tests, and relevant CLI documentation.
- External inputs and trust boundaries:
  - Registry JSON and Markdown frontmatter are untrusted package inputs.
  - Operator and related-skill IDs must be normalized and validated as
    `skill:*` package IDs.
  - Host detection and skill filesystem targets are external environment
    state; sync remains non-destructive by default.
- Failure behavior to define:
  - Registry validation rejects a missing, unknown, non-related, or
    non-reciprocal operator skill.
  - CLI resolution rejects or clearly fails malformed operator metadata rather
    than silently omitting the required operator.
  - A stack install reports operator-skill install or native-sync failures while
    preserving the successfully installed stack and giving an explicit retry.
- Exit criteria:
  - The contract is named, bounded, testable, and does not rely on array order
    or prose-only conventions.

## Phase 2: Red Tests

- Observable behavior to prove:
  1. Schema accepts `related.operatorSkill` only as a `skill:*` ID and requires
     it for stack packages.
  2. Catalog validation rejects unknown, non-related, and non-reciprocal
     operator skills.
  3. CLI resolution identifies the operator skill separately from companion
     skills.
  4. Default stack install planning always selects a missing operator skill;
     `--with-related-skills` additionally selects missing companions and
     `--no-related-skills` skips companions only.
  5. Native host sync remains non-destructive.
- Test files to add or edit:
  - Registry: `src/schema.test.ts`, `src/catalog.test.ts`, and compile regression
    coverage if needed.
  - CLI: core resolver-related-skill and install-related-skill unit tests plus
    visibility tests.
- Red command:
  - Registry: `npx vitest run src/schema.test.ts src/catalog.test.ts`.
  - CLI: focused `node --test` commands for the changed unit-test files.
- Expected failure:
  - Tests fail because `operatorSkill` is not in the schema/types, catalog
    validation does not enforce reciprocity, and the CLI treats all related
    skills as optional companions.
- Exit criteria:
  - Each next observable behavior has failed for the expected missing-contract
    reason before implementation.

## Phase 3: Implementation

- Implementation rules:
  - Make the smallest contract and installer changes that satisfy each red
    behavior.
  - Use existing `related.skills` and `requires.stacks` relationships; add only
    the primary-operator discriminator needed to make the invariant explicit.
  - Follow existing catalog and CLI naming, normalization, error, and sync
    patterns.
- Files allowed to change:
  - Only the files identified in Phase 1 plus generated index/build artifacts.
- Validation and error-handling requirements:
  - Validate package ID shape, existence, containment in `related.skills`, and
    reciprocal `requires.stacks` linkage.
  - Do not silently drop an invalid primary operator.
  - Preserve user-edited host wrappers unless force is explicit.
- Observability requirements:
  - Installer output names the operator skill separately, reports install and
    sync outcome per detected host, and prints a retry command on sync failure.
- Exit criteria:
  - Every current stack satisfies the new invariant and focused tests pass.

## Phase 4: Green Tests And Refactor

- Green command:
  - Rerun the exact focused registry and CLI red commands unchanged.
- Refactor constraints:
  - Refactor only duplication introduced by this work.
  - Do not restructure the catalog compiler, installer, or skill sync modules.
- Regression checks:
  - Existing related workflow skills still resolve and install.
  - Existing skill wrappers are not overwritten without `--force`.
  - Stack dependency order still excludes optional companion skills.
- Exit criteria:
  - Focused behavior remains green after any cleanup.

## Phase 5: Full Verification

- Targeted tests:
  - Registry focused schema/catalog/compile tests.
  - CLI core resolver, install plan, related-skill visibility, and native sync
    tests.
- Full suite:
  - Registry: `npm test` and `npm run validate`.
  - CLI: `pnpm test`.
- Build/typecheck/lint:
  - Registry required gates: `npm run indexes:sync`,
    `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and
    `npm pack --dry-run --json`.
  - CLI: `pnpm build` and `npm pack --dry-run`.
- JS/TS debt scan, if applicable:
  - Registry: `npm run debt:scan` plus focused edited-file fallback if required.
  - CLI: `node scripts/agent-debt-runner.mjs --edited <edited-js-files>`.
- Live smoke checks:
  - Use a temporary `RUDI_HOME`, local registry, and isolated host skill roots.
  - Install one representative stack without `--with-related-skills`.
  - Prove its operator skill is installed and native Codex/Claude wrappers are
    generated without touching real user skill directories.
- Exit criteria:
  - All required deterministic gates pass and the isolated install flow proves
    the user-visible contract.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
  - `SCHEMA.md`, registry README, stack template, contribution guidance, and
    stack-related-skills roadmap.
  - CLI README/help text for automatic operator skills and host invocation:
    Claude `/skill-name`; Codex `/skills` or `$skill-name`.
- Final files touched:
  - Record from `git diff --name-only` separately for registry and CLI.
- Commands run and results:
  - Record exact red, green, full-suite, build, index, debt, pack, and smoke
    commands with exit status.
- Accepted debt:
  - None by default. Any unavailable live host interaction or pre-existing
    unrelated failure must be named with impact and follow-up.
- Definition of Done:
  - Every published stack has a validated primary operator skill.
  - Stack installation automatically installs the operator skill.
  - Detected Codex and Claude hosts receive non-destructive native wrappers.
  - Explicit host invocation leads the agent to the installed stack tools.
  - Targeted and full verification pass, generated indexes are current, docs
    match behavior, and no unexplained blocking debt remains.

## Completion Evidence

### Delivered Contract

- All 47 published stacks declare `related.operatorSkill`.
- Every operator is also present in `related.skills`, resolves to a published
  skill package, and reciprocally declares the stack in `requires.stacks`.
- The catalog now contains 43 new stack-specific operator skills and reuses 4
  existing purpose-built operators:
  `inline-editorial-markup`, `share-web-app`,
  `swe-compliance-checklist`, and `rudi-video-editor`.
- Registry schema, catalog validation, compiled indexes, templates, roadmap,
  contribution guidance, and README documentation enforce and explain the
  contract.
- CLI stack installs always install the primary operator. Companion skills
  remain optional; `--with-related-skills` includes them and
  `--no-related-skills` skips companions without skipping the operator.
- Newly installed operators sync non-destructively into detected Codex and
  Claude native skill roots. Portable wrappers use the hyphen-case invocation
  name in `SKILL.md`; Codex keeps the human display title in
  `agents/openai.yaml`.
- Invocation documentation matches host behavior: Claude `/skill-name`; Codex
  `/skills` or `$skill-name`.

### Red-Green-Refactor Evidence

- Registry red cases proved the missing schema field and the missing required,
  containment, existence, and reciprocal-link validation. The unchanged green
  focused command was `npx vitest run src/schema.test.ts src/catalog.test.ts`.
- CLI red cases proved the missing operator discriminator, mandatory install
  plan, flag semantics, malformed-metadata failures, distinct presentation,
  managed instruction text, and native wrapper sync behavior.
- The skill-creator conformity audit added a final red case for human titles in
  native `name` metadata. `node --test src/__tests__/unit/skills-sync.test.js`
  failed 4 expected assertions, then passed 9/9 after wrappers emitted the
  portable hyphen-case name.
- Final CLI focused command passed 37/37 tests:
  `node --test packages/core/src/__tests__/unit/resolver-related-skills.test.js packages/core/src/__tests__/unit/installer-state-preservation.test.js src/__tests__/unit/install-related-skills.test.js src/__tests__/unit/related-skills-visibility.test.js src/__tests__/unit/skills-sync.test.js src/__tests__/unit/instructions-command.test.js`.

### Registry Verification

- `npm test`: 18 files, 156 tests passed.
- `npm run validate`: 147 package files passed.
- Operator-contract audit: 47/47 stacks valid.
- `npm run stacks:verify -- --changed-from origin/main --prepare`: 46 stacks
  passed; `stack:google-ai` was marked exit 137 only because the old stuck
  verifier parent was manually terminated during diagnosis.
- `npm run stacks:verify -- --stack stack:google-ai --prepare`: 1/1 passed with
  the corrected verifier teardown, yielding 47/47 verified stacks overall.
- `npm run indexes:sync` and `npm run indexes:check`: current for all 147
  packages.
- `npm run catalog:clean` removed 62 verifier-created reproducible artifacts;
  the final `npm run catalog:clean:check` planned 0 removals.
- `npm run build`, `npm run release:verify`, and `git diff --check`: passed.
- `npm run debt:scan`: 0 findings. The focused scripts scan with
  `scripts/verify-node-stack.mjs` as an explicit entrypoint also returned 0.
- `npm run validate:public -- --json` with a temporary Git index for the new
  untracked skill sources: 0 errors, 0 warnings, 147 referenced packages. The
  real Git index remained unstaged.
- `npm pack --dry-run --json`: 809 files, 8,483,549 unpacked bytes.

### CLI Verification

- Full in-scope remainder: 640 tests passed, 0 failed after excluding only the
  three pre-existing Node-runtime compatibility files named below.
- The three excluded files pass 6/6 under the active Node 25 runtime.
- `pnpm build`, `git diff --check`, and `npm pack --dry-run`: passed; the pack
  contains 6 files and 1,385,985 unpacked bytes.
- Edited-file debt scan: 0 findings across 13 implementation/test files.
- Isolated install with temporary `RUDI_HOME`, `CODEX_HOME`, and `CLAUDE_HOME`
  installed `stack:municode`, installed `skill:municode`, generated both native
  wrappers, preserved the manifest-declared tool, emitted `name: municode`, and
  generated Codex display metadata.
- The skill-creator `quick_validate.py` check passed for both isolated Codex and
  Claude wrappers using a temporary PyYAML environment.

### Accepted Debt And Test Gaps

- Exact `pnpm test` currently falls back from Node 25 to the bundled Node
  20.10 runtime for `better-sqlite3`. Three unrelated, pre-existing tests use
  `import.meta.dirname`, which Node 20 does not provide:
  `agent-host-boundaries.test.js`, `daemon-process-smoke.test.js`, and
  `quality-workflow-contract.test.js`. They pass 6/6 under Node 25, and the
  remaining 640 tests pass under the repository wrapper. Follow-up is either to
  update those tests to `fileURLToPath(import.meta.url)` or update the bundled
  test runtime. This does not affect operator-skill resolution, installation,
  synchronization, or packaging.
- An interactive keystroke in a live Codex or Claude session was not automated.
  Host-native discovery metadata, invocation names, filesystem placement,
  installed tool instructions, and both wrapper formats were verified in an
  isolated install instead.

### Final Change Scope

- Registry: schema/types/catalog tests and validation, all 47 stack manifests,
  43 new operator skill sources, generated index, docs, and the generic Node
  verifier teardown fix exposed by the full matrix.
- CLI: resolver, install planning/output, related-skill presentation,
  instructions, native wrapper metadata, focused tests, generated bundle, and
  README. Existing unrelated dirty work in both repositories was preserved.
