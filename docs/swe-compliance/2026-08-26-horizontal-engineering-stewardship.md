# Horizontal Engineering And Codebase Stewardship

Status: complete; published, installed, and verified on both Macs

## Phase 0: Baseline And Manual Lookup

- Scope: Add a canonical horizontal-engineering standard, a bundled review
  skill, and narrow detection/disposition hooks in the SWE checklist.
- Files inspected before editing: repository `AGENTS.md`, SWE manual index,
  Agent Co-Pilot Operating Standard, SWE checklist, Repo Steward skill and
  manifest, manual loader/tests, Registry package tests, and generated index
  workflow.
- Relevant SWE manual sections: Engineering Operating Manual Index, Master
  Engineering Doctrine simplicity and review guidance, Testing Doctrine, and
  Agent Co-Pilot Operating Standard.
- Current-state commands: `git status -sb`, targeted `rg`, `git diff`,
  `swe_manual_list`, `swe_manual_read`, and `swe_manual_search`.
- Horizontal-pattern scan: the governance mechanism spans the manual,
  per-change checklist, repository-level review skill, and Git integration
  workflow. The first three require one explicit contract; Repo Steward remains
  intentionally separate because it owns repository state rather than
  architectural disposition.
- Baseline finding: the installed 11-document manual returns no matches for
  `duplication`, `consolidation`, `shared library`, or `technical debt`.
- Pending baseline preserved: four post-PR commits on
  `feat/swe-canonical-manual`; source changes for commit strategy are applied
  without committing, while stale generated-index changes are excluded.
- Risks and invariants:
  - A per-change checklist detects and records horizontal obligations; it does
    not silently widen feature scope.
  - A repeated pattern triggers review, not automatic extraction.
  - The horizontal skill owns architectural coherence; Repo Steward continues
    to own Git/worktree integration state.
  - Installed copies and generated indexes are never hand-edited.
  - Commit, push, PR, merge, release, install, and admin-Mac update were not
    authorized at initial scope lock; the user later authorized that lifecycle
    explicitly, as recorded in Phase 6.
- Initial risk tier and rationale: Medium, because this changes durable
  engineering policy and agent behavior but not production runtime behavior.
- Exit criteria: exact source, test, generated, and rollout boundaries are
  identified and the baseline is preserved in an isolated worktree.

## Phase 1: Scope Lock

- In scope:
  - Add manual document 12 and register it in list/read/search surfaces.
  - Add `skill:horizontal-engineering-review` as a portable bundled skill.
  - Add checklist hooks in baseline, scope lock, and closure.
  - Update quick reference, manual index, stack README/manifest, tests, and
    generated Registry index.
  - Preserve pending commit-strategy additions already made to the manual and
    checklist.
- Non-goals:
  - No receipt-library or application-code consolidation.
  - No Repo Steward implementation or skill changes.
  - No new MCP stack, scripts, dependencies, scheduler, or persistent ledger.
  - No root `AGENTS.md` expansion or historical-plan rewrites.
- Expected files touched:
  - `catalog/skills/horizontal-engineering-review/SKILL.md`
  - `catalog/skills/horizontal-engineering-review/agents/openai.yaml`
  - `catalog/skills/swe-compliance-checklist.md`
  - `catalog/stacks/swe-engineering/README.md`
  - `catalog/stacks/swe-engineering/manifest.json`
  - `catalog/stacks/swe-engineering/src/core.js`
  - `catalog/stacks/swe-engineering/src/manual/02-Engineering-Quick-Reference.txt`
  - `catalog/stacks/swe-engineering/src/manual/10-Engineering-Operating-Manual-Index.md`
  - `catalog/stacks/swe-engineering/src/manual/12-Horizontal-Engineering-and-Codebase-Stewardship-Standard.md`
  - `catalog/stacks/swe-engineering/test/core.test.js`
  - `catalog/stacks/swe-engineering/test/package-contract.test.js`
  - `src/portable-agentic-workflow-skills.test.ts`
  - generated `index.json`
  - this checklist
- Preserved pending files also present in the diff:
  - `catalog/stacks/swe-engineering/src/manual/01-Master-Engineering-Doctrine.txt`
  - `catalog/stacks/swe-engineering/src/manual/11-Agent-Copilot-Operating-Standard.md`
- External inputs and trust boundaries: repository paths, Git refs, generated
  catalog metadata, and skill/manual content are validated before packaging.
- Failure behavior: unknown manual ids remain rejected; invalid skill metadata
  or catalog relationships fail validation; unproven consolidation remains a
  recorded obligation rather than an automatic refactor.
- Authorized external actions: the initial implementation authorized only
  `git fetch`; the user's publication follow-up authorizes the task-owned
  commit, feature-branch push, pull request, accepted merge, canonical
  update/install, native skill sync, and admin-Mac parity verification.
- Commit strategy and authorization: intended slices are (1) preserved pending
  commit-policy baseline, (2) red contracts, (3) manual/runtime registration,
  (4) skill/checklist/package integration, and (5) generated index plus proof.
  The initial implementation left all slices uncommitted. The user's
  publication follow-up authorizes packaging the reconciled result as a
  task-owned feature commit after the publication gates pass.
- Horizontal-obligation disposition: resolve in this change by standardizing
  the horizontal-governance contract across the manual, checklist, and review
  skill. Retain Repo Steward as an intentional separate implementation boundary;
  no additional consolidation obligation is opened.
- Review and approval gates: full Registry gates, targeted stack tests, skill
  validation, JS/TS debt scan, smoke proof, and independent read-only review.
- Exit criteria: no path outside the locked set changes without raising scope.

## Phase 2: Red Tests

- Observable behavior to prove:
  - Manual list/read/search exposes document 12.
  - The stack package includes 12 portable manual documents.
  - The SWE stack relates the checklist and horizontal review skill.
  - The Registry publishes the bundled skill and updated versions.
- Test files to edit:
  - `catalog/stacks/swe-engineering/test/core.test.js`
  - `catalog/stacks/swe-engineering/test/package-contract.test.js`
  - `src/portable-agentic-workflow-skills.test.ts`
- Red commands:
  - `npm test` from `catalog/stacks/swe-engineering`
  - `npm test -- src/portable-agentic-workflow-skills.test.ts` from repo root
- Expected failure: document 12, the bundled skill, updated related-skill
  contract, and regenerated package metadata do not exist yet.
- Exit criteria: each command fails for the expected missing behavior rather
  than setup, import, or environment errors.

## Phase 3: Implementation

- Implementation rules: make the smallest portable change; keep policy in the
  manual, per-change hooks in the checklist, and repository-wide execution in
  the new skill.
- Files allowed to change: only the locked files in Phase 1 plus generated
  `index.json`.
- Validation and error-handling requirements: retain explicit manual allowlist
  and traversal rejection; keep catalog dependency ids valid; avoid absolute
  paths and host-specific invocation syntax in shipped artifacts.
- Observability requirements: the skill output records evidence, disposition,
  owner, trigger, verification, and remaining obligations.
- Exit criteria: implementation satisfies the red contracts without modifying
  Repo Steward or adding runtime dependencies.

## Phase 4: Green Tests And Refactor

- Green commands: rerun both Phase 2 commands unchanged.
- Refactor constraints: remove scaffold placeholders and duplicated guidance;
  do not broaden the new skill into Git fleet management or scheduling.
- Regression checks: manual traversal rejection, all existing stack tests, and
  portable skill contracts remain green.
- Commit checkpoint: initially held without commit authority; the user later
  authorized the publication lifecycle after reviewing the completed local
  evidence.
- Exit criteria: targeted tests pass after only in-scope cleanup.

## Phase 5: Full Verification

- Targeted tests: stack tests and portable workflow skill tests.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run build`.
- JS/TS debt scan: `swe_debt_scan` on edited JS/TS files, followed by the
  repository `npm run debt:scan` gate when practical.
- Generated metadata: `npm run indexes:sync`, `npm run indexes:check`.
- Packaging and hygiene: `npm run catalog:clean:check`,
  `npm pack --dry-run --json`.
- Live smoke checks: invoke source list/read/search functions for document 12
  and run the skill validator.
- Independent review: fresh-context read-only review of task contract, diff,
  and verification evidence.
- Risk-tier approval: Medium; unresolved policy ambiguity requires a human
  decision, while deterministic in-scope defects are corrected directly.
- Exit criteria: all required gates pass or residual risk is explicitly
  recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: manual index, quick reference, stack README,
  manifest relationships, checklist fields, skill instructions, and generated
  Registry index.
- Final files touched:
  - New horizontal standard, review skill, OpenAI skill metadata, and this
    checklist.
  - Updated SWE checklist, stack README/manifest/runtime registration, quick
    reference, manual index, stack contract tests, portable-skill tests, and
    generated `index.json`.
  - Preserved pending commit-policy changes in manual documents 01 and 11.
- Commands run and results:
  - Red: stack tests produced four expected missing-document/package failures;
    the portable-skill test exposed the missing skill and stale generated
    contract.
  - Green: stack tests passed 6/6 and portable-skill tests passed 9/9 without
    weakening the red contracts.
  - Full regression: 28 test files and 251 tests passed.
  - Registry validation passed 155/155 packages; build, index sync/check,
    catalog hygiene, `git diff --check`, and package dry-run passed.
  - Package proof includes the standard, skill, and `agents/openai.yaml`.
  - Repository and targeted JS/TS debt scans reported zero findings.
  - Source smoke proved 12 listed documents plus document-12 read/search; the
    OpenAI metadata parsed successfully.
  - Publication-only verification passed: changed-stack preparation, seven
    release-artifact hashes, and public readiness with zero errors or warnings
    across 155 referenced packages.
  - Pull-request CI passed Test/Build/Verify plus Ubuntu, macOS, and Windows
    validation. Post-merge `main` CI repeated those gates and passed the release
    job.
  - Installed smoke on both Macs listed 12 manuals and returned four matches for
    `consolidation obligation` from the installed SWE stack.
- Evidence artifacts: this checklist, red/green output, skill validation,
  debt-scan output, package dry-run output, smoke output, and independent
  review result.
- Independent-review result: no blocking findings. The reviewer identified a
  timing-versus-disposition ambiguity and missing consumption of existing
  obligations; both were corrected, and targeted plus full tests were rerun.
- Dogfood assessment: the new horizontal review skill was applied from source
  in Assess mode before publication. It confirmed the standardize-contract
  disposition across the manual, checklist, and review skill; retained Repo
  Steward as a separate Git-lifecycle boundary; and opened no new obligation.
- Horizontal-obligation closure: the policy gap is closed by standardizing one
  contract across the manual, checklist, and review skill. No additional
  obligation remains open. Repo Steward remains an intentional separate
  boundary and should be reassessed only if architectural disposition and Git
  lifecycle handling begin to duplicate one another.
- Commit ledger and publication status:
  - Dependency PR #45 merged the preserved pending commit-policy baseline as
    `42aa9f4` after all required CI checks passed.
  - Task commit `02a8a0f` (`feat(swe-engineering): add horizontal stewardship
    review`) was pushed on the task branch and merged through PR #46 as
    `996057d`; no direct-to-main push occurred.
  - PR run `33007805228` passed all four validation jobs. Post-merge run
    `33007893508` passed Test/Build/Verify, all platform validation, and Release.
  - The primary clean task worktree and the admin clean integration worktree
    both resolved accepted source revision `996057d` before installation.
  - Both Macs now install `stack:swe-engineering@0.4.0`,
    `skill:swe-compliance-checklist@1.3.0`, and
    `skill:horizontal-engineering-review@1.0.0`.
  - Native Codex synchronization updated 36 wrappers on the primary Mac and 91
    on the admin Mac, including the new horizontal review wrapper.
  - Source-to-RUDI-install SHA-256 parity matched on both Macs: horizontal
    `SKILL.md` `803463f52d09bd91bc3e444abaffb9e9f9dfcccda9f9e1dee9bb63d3fd6652db`,
    `agents/openai.yaml`
    `29960ac9ed69b966edf1ba135448df37e17d3c3c7a9644da113985d63fd19501`,
    SWE checklist
    `42267dced1bba94b458d87e9523a798f347781aec98cff78b0ab0f3293513905`,
    and manual document 12
    `f370130d571da90932eb3ad0d1e1b4da1c9cd962e6c87d868ba13643f38bd335`.
- Final verdict: approved, published, installed, and smoke-verified on both
  workstation roles with no open horizontal obligation.
- Accepted debt:
  - Existing dependency audits reported one moderate, six high, and one
    critical advisory at the Registry root and one high advisory in the stack;
    this task changes no dependencies and did not run destructive audit fixes.
  - The generic skill-creator validator rejects Registry-specific frontmatter
    extensions; the canonical Registry validator accepts the package, and an
    existing bundled skill uses the same extension fields.
  - The admin stack update warned that its current pnpm requires a newer Node,
    then successfully used the CLI's npm fallback. Exact installed payload
    hashes and the installed manual smoke passed afterward.
  - The admin full router refresh reported nine unrelated configuration-health
    failures from missing optional secrets and one Supabase timeout. The SWE
    stack itself indexed all four tools with no error or missing secret.
  - The primary canonical Registry checkout retains unrelated Repo Steward work
    and the admin canonical checkout retains unrelated Brave Search work. Both
    were preserved untouched; clean accepted worktrees supplied installation.
- Proof gaps: already-running Codex processes must restart before discovering
  newly synchronized native skill wrappers. Bundle presence, metadata, version,
  hash parity, and RUDI installation are otherwise proven.
- Definition of Done: source and generated contracts agree, required checks
  pass, no blocking review finding remains, both machines use accepted payloads,
  the installed manual works, and the horizontal obligation is closed.
