# Cross-Host Skill Catalog Parity

## Phase 0: Baseline And Manual Lookup

- Scope: publish the accepted canonical packages for `map-change-impact`,
  `grill-with-docs-loop`, and `swe-compliance-checklist`, then align the
  canonical RUDI installs on the primary and admin Macs.
- Files inspected before editing: repository instructions, catalog compiler and
  tests, generated index, current catalog entries, installed candidate payloads,
  registry publication rules, and CLI install/update behavior.
- Relevant SWE manual sections: Testing Doctrine behavior-first tests and the
  infrastructure requirement for post-publication verification.
- Current-state commands: `git status --short --branch`, targeted `rg`, catalog
  and installed-skill version queries, remote checkout inspection, and SHA-256
  comparisons.
- Risks and invariants:
  - GitHub registry source is canonical; installed copies never self-promote.
  - Keep one unversioned catalog source per skill and regenerate `index.json`.
  - Preserve `map-change-impact` as a bundle so `agents/openai.yaml` ships.
  - Preserve grill and SWE as flat skills to avoid install-path migration.
  - Verify canonical `~/.rudi/skills` payload bytes on both Macs; native host
    wrappers are projections and are not expected to be byte-identical.
  - Do not synchronize secrets, caches, databases, logs, or unrelated RUDI
    state between machines.
- Initial risk tier and rationale: Medium, because this changes public registry
  packages and cross-host installed behavior but is reversible through Git and
  package reinstall.
- Exit criteria: exact source payloads, generated outputs, publication endpoint,
  install targets, and verification commands are known.

## Phase 1: Scope Lock

- In scope:
  - Add bundled `skill:map-change-impact` at version 1.0.0.
  - Promote flat `skill:grill-with-docs-loop` from 2.0.0 to 2.1.0.
  - Retain flat `skill:swe-compliance-checklist` at 1.1.0.
  - Add one focused package-contract test and regenerate registry indexes.
  - Commit and push the accepted registry update to GitHub.
  - Fast-forward the admin source checkout and install/update all three skills
    on both Macs.
- Non-goals: legacy `pdf`, `pptx`, or `xlsx` publication; CLI behavior changes;
  stack updates; native-wrapper byte parity; npm registry release; unrelated
  catalog normalization.
- Expected files touched:
  - `catalog/skills/map-change-impact/SKILL.md`
  - `catalog/skills/map-change-impact/agents/openai.yaml`
  - `catalog/skills/grill-with-docs-loop.md`
  - `src/portable-agentic-workflow-skills.test.ts`
  - generated `index.json` and `dist/**` only through canonical commands
  - this checklist
- External inputs and trust boundaries: local installed candidate Markdown/YAML,
  GitHub transport, registry downloads, and remote SSH command results.
- Failure behavior: stop before publication on validation failure; preserve a
  successful local commit if push fails; preserve either Mac's existing install
  if a package update fails; never substitute a partial bundle.
- Authorized external actions: task-owned Git commit and GitHub push, admin
  `git pull --ff-only`, and package install/update plus native skill sync on both
  Macs.
- Review and approval gates: the user explicitly accepted all three packages;
  require focused red/green proof, full registry gates, and fresh-context review
  before publication.
- Exit criteria: no unrelated file or package is included.

## Phase 2: Red Tests

- Observable behavior to prove: the generated public index exposes map 1.0.0 as
  a complete bundle, grill 2.1.0 as a flat package, and SWE 1.1.0 as a flat
  package.
- Test file: `src/portable-agentic-workflow-skills.test.ts`.
- Red command:
  `npx vitest run src/portable-agentic-workflow-skills.test.ts`.
- Expected failure: map is missing from the index and grill remains 2.0.0.
- Exit criteria: the focused test fails for those expected contract gaps.

## Phase 3: Implementation

- Copy the accepted map bundle source and companion metadata into the canonical
  catalog.
- Replace only the canonical grill flat file with the accepted 2.1.0 payload.
- Leave the accepted SWE 1.1.0 catalog source unchanged.
- Run `npm run indexes:sync`; never hand-edit generated indexes.
- Files allowed to change: only the Phase 1 task-owned path list plus generator
  outputs proven necessary by the canonical commands.
- Validation and failure behavior: preserve valid YAML frontmatter, supported
  bundle structure, portable paths, and host-neutral instructions.
- Observability: record red/green output, generated index deltas, full gate
  results, Git commit/revision, and cross-host content hashes.
- Exit criteria: the unchanged focused test passes.

## Phase 4: Green Tests And Refactor

- Green command:
  `npx vitest run src/portable-agentic-workflow-skills.test.ts`.
- Refactor constraints: no unrelated catalog restructuring or dependency change.
- Regression checks: catalog discovery tests and generated index checks.
- Exit criteria: focused and adjacent tests remain green.

## Phase 5: Full Verification

- Targeted tests: portable workflow and catalog discovery tests.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run build`.
- Required registry gates: `npm run indexes:check`,
  `npm run catalog:clean:check`, `npm pack --dry-run --json`.
- JS/TS debt scan: run the configured registry debt scan because a TypeScript
  test changes.
- Live smoke checks: inspect compiled package metadata, update/install from the
  published registry, sync native skills, and compare canonical payload hashes
  on both Macs.
- Independent review: fresh read-only agent review of intent, diff, and evidence
  before publication.
- Risk-tier approval: user authorization covers publication and cross-host
  installation; no merge, destructive cleanup, or secret movement is allowed.
- Exit criteria: all gates pass or the work stops with an explicit proof gap.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: this execution checklist only; no ADR is
  warranted because the existing registry source-of-truth contract is applied,
  not changed.
- Final files touched: record after generation and review.
- Commands run and results: record after each gate.
- Evidence artifacts: Git commit/revision, test output, package dry-run, and
  source/install hashes from both Macs.
- Independent-review result: pending.
- Final verdict: pending.
- Accepted debt: none planned.
- Proof gaps: none accepted in advance.
- Definition of Done: GitHub main contains the accepted packages; both source
  checkouts are at that revision; both canonical RUDI installs contain map
  1.0.0, grill 2.1.0, and SWE 1.1.0 with matching payload hashes; native skills
  have been resynchronized; all required registry gates pass.

## Execution Record

- Grill decision loop `skill-parity-20260820` Q01:
  - Questioner: `/root/grill_parity_q01_questioner`
  - Answerer: `/root/grill_parity_q01_answerer`
  - Skeptic: `/root/grill_parity_q01_skeptic`
  - Verdict: accept; no remaining human decision after the user's explicit
    package acceptance.
- Environment correction: the first test invocation could not load Vitest
  because the clean checkout had no `node_modules`. `npm ci` installed the
  locked dependency tree without changing package manifests or lockfiles.
- Red: `npx vitest run src/portable-agentic-workflow-skills.test.ts` failed 1/8
  at the new cross-host baseline assertion because `skill:map-change-impact`
  was absent from `index.json`.
- Green: the unchanged focused command passed 8/8 after adding the accepted map
  bundle, promoting grill 2.1.0, and running `npm run indexes:sync`.
- Skill validation: `quick_validate.py catalog/skills/map-change-impact`
  reported `Skill is valid!` using the system Python environment with PyYAML.
- Adjacent tests: portable workflow and catalog discovery passed 17/17.
- Full registry suite: `npm test` passed 246/246 across 28 test files.
- Validation and build: `npm run validate` and `npm run build` passed with 153
  packages, including 68 skills.
- Generated indexes: `npm run indexes:check` reported current generated output.
- Catalog hygiene: `npm run catalog:clean:check` identified one pre-existing
  ignored `catalog/stacks/rudi-share/dist` reproducible artifact. It is outside
  task scope and was not removed; the package dry-run proved it is excluded.
- Debt scan: the configured focused JS/TS scan reported zero errors, warnings,
  or informational findings for the changed TypeScript test.
- Package smoke: `npm pack --dry-run --json` included the grill, SWE, map
  `SKILL.md`, and map `agents/openai.yaml` payloads and excluded
  `rudi-share/dist`.
- Public readiness: `npm run validate:public -- --json` passed after task-only
  staging with zero errors, zero warnings, and 153 referenced packages.
- Independent review: `/root/skill_registry_parity_review` reported no blocking
  findings and confirmed that the diff meets the task contract without secrets,
  path leakage, package-shape drift, or generated-index errors.
- Dependency audit note: `npm ci` reported eight findings in the existing locked
  dependency tree (one moderate, six high, one critical). No dependency file
  changed in this task; remediation is separate dependency-maintenance scope.
