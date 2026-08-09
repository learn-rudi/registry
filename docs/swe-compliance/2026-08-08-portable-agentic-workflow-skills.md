# Portable Agentic Workflow Skills

## Phase 0: Baseline And Manual Lookup

- Scope: strengthen the existing RUDI delivery workflow and add portable Context Gardener and Decision Canvas skill bundles that project cleanly into Codex and Claude.
- Files inspected before editing: registry instructions, schema and package docs, current SWE workflow skills, Repo Steward operator and manifest, CLI native-skill projection code and tests, and Appendix C of the SWE Operating Manual.
- Relevant doctrine: explicit boundaries, failure behavior, evidence-backed completion, and Appendix C red-green-refactor.
- Current-state commands: `git status --short`, registry skill discovery tests, CLI skill-sync tests, and registry validation/build commands.
- Risks and invariants:
  - Preserve unrelated dirty registry work and generated-index changes.
  - Keep `SKILL.md` instructions host-neutral; host-specific metadata remains a projection concern.
  - Do not add a stack unless the workflow exposes executable MCP tools or owns persistent operational state.
  - Scripts accept untrusted paths and JSON, validate inputs, avoid network access, and never inspect secret files.
  - Codex and Claude projections receive the same workflow body and bundled resources.
- Exit criteria: current package and projection boundaries are understood and the intended files are locked.

## Phase 1: Scope Lock

- In scope:
  - Add `skill:rudi-context-gardener` as a portable bundle with deterministic instruction-file auditing.
  - Add `skill:rudi-decision-canvas` as a portable bundle with deterministic standalone HTML generation and verification.
  - Add risk tiers, fresh-context review, evidence bundles, and host-neutral language to the existing SWE delivery loop.
  - Add focused behavior tests and verify Codex and Claude native projections.
- Non-goals: a new MCP stack, agent runner, scheduler, worktree manager, automatic PR merge, deployment, or changes to native host executables.
- Expected files touched:
  - `catalog/skills/rudi-context-gardener/**`
  - `catalog/skills/rudi-decision-canvas/**`
  - `catalog/skills/rudi-swe-issue-loop.md`
  - `catalog/skills/swe-compliance-checklist.md`
  - `src/portable-agentic-workflow-skills.test.ts`
  - generated `index.json` and `dist/**` only through canonical generation
  - this checklist
- External inputs and trust boundaries: user-provided repository roots, instruction Markdown, decision-spec JSON, output paths, and exported feedback JSON.
- Failure behavior: reject invalid paths, unsupported flags, malformed specifications, unsafe identifiers/colors, duplicate option IDs, missing decisions, and accidental output overwrite.
- Exit criteria: no unrelated implementation or catalog package is modified.

## Phase 2: Red Tests

- Observable behaviors:
  - Context Gardener reports instruction inventory, duplicate blocks, large always-loaded files, host-specific signals, and conditional-workflow candidates without traversing ignored or symlinked directories.
  - Decision Canvas rejects invalid specs, safely escapes content, creates a self-contained interactive artifact, and verifies its embedded contract.
  - Both skill bundles are discoverable and contain portable `SKILL.md`, scripts, and references.
- Test file: `src/portable-agentic-workflow-skills.test.ts`.
- Red command: `npx vitest run src/portable-agentic-workflow-skills.test.ts`.
- Expected failure: imports and skill resources do not exist yet.
- Exit criteria: the focused test fails because the requested behavior is absent.

## Phase 3: Implementation

- Implement only the behavior required by the focused tests.
- Use Node built-ins only; add no dependencies.
- Keep generated HTML self-contained and network-free.
- Keep heuristic audit findings explicitly advisory rather than claiming semantic certainty.
- Exit criteria: the unchanged red command passes.

## Phase 4: Green Tests And Refactor

- Green command: `npx vitest run src/portable-agentic-workflow-skills.test.ts`.
- Refactor constraints: retain behavior-level tests and rerun them unchanged.
- Regression checks: registry catalog discovery and CLI native skill-sync tests.
- Exit criteria: focused and adjacent tests remain green.

## Phase 5: Full Verification

- Targeted tests: portable workflow skill test, catalog discovery test, CLI skill-sync test.
- Full suite: `npm test`.
- Build/typecheck/lint: registry `npm run build` plus required registry verification commands.
- JS/TS debt scan: `npm run debt:scan` after editing TypeScript or JavaScript.
- Live smoke checks: generate and verify a sample decision canvas; audit a controlled instruction fixture; sync installed payloads into isolated Codex and Claude roots and compare portable files.
- Exit criteria: all applicable checks pass or an explicit residual-risk record explains a gap.

## Phase 6: Docs, Contracts, And Closure

- Regenerate the canonical index without discarding unrelated catalog changes.
- Record exact commands and results, files changed, host projection evidence, accepted debt, and known gaps.
- Definition of Done: both new skills are portable registry packages, scripts behave as tested, delivery workflow instructions include risk and evidence gates, and Codex/Claude projections are equivalent where their contracts overlap.

## Execution Record

- Red: `npx vitest run src/portable-agentic-workflow-skills.test.ts`
  failed with four expected failures because the scripts were absent and both
  skills still contained scaffold placeholders.
- Green: the unchanged focused command passed 7/7 after implementation and
  workflow-contract coverage.
- Refactor verification: the focused command remained green after correcting
  embedded schema normalization, optional selections, and external-resource
  verification.
- Skill validation: both bundled skills passed `quick_validate.py` using a
  temporary PyYAML target outside project dependencies.
- Adjacent projection test: CLI `skills-sync.test.js` passed 9/9.
- Full registry suite: `npm test` passed 164/164 across 19 files.
- Build: `npm run build` validated and compiled 151 packages.
- Index: `npm run indexes:sync` and `npm run indexes:check` passed; comparison
  with the pre-task index found exactly four changed package entries:
  `skill:rudi-context-gardener`, `skill:rudi-decision-canvas`,
  `skill:rudi-swe-issue-loop`, and `skill:swe-compliance-checklist`.
- Release: `npm run release:verify` verified seven SHA-256 artifacts.
- Stack verification: no changed stacks required verification.
- Debt scan: zero errors, warnings, or informational findings.
- Package smoke: `npm pack --dry-run --json` passed and included both complete
  bundles.
- Context Gardener live smoke: scanned 33 real workspace instruction files,
  2,295 lines, and 92,842 bytes without truncation.
- Decision Canvas live smoke: generated and verified a two-option standalone
  artifact; every structural/security check passed and visual inspection found
  clear hierarchy, readable cards, and visible decision feedback controls.
- Cross-host smoke: all four changed skills projected into isolated Codex and
  Claude roots. Portable file lists and contents were byte-equivalent; only
  Codex received its expected generated `agents/openai.yaml` metadata.

## Known Gaps And External State

- `npm run validate:public -- --json` reports the two new bundle directories as
  untracked. This gate can pass only after those files are staged or committed;
  the staging area was intentionally left unchanged because publication was
  not requested.
- `npm run catalog:clean:check` is blocked by pre-existing ignored
  `catalog/stacks/google-workspace/dist` and `node_modules` directories. They
  are unrelated to this task and were not removed.
- A separate fresh-context agent review was not run because the active task did
  not authorize subagent delegation. Focused behavior tests, the full suite,
  deterministic host-projection comparison, and visual inspection provide the
  current review evidence.
- Final verdict: ready for human review and staging; no code or skill-contract
  blocker remains in the scoped change.
