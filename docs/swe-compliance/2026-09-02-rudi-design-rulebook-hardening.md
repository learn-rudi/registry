# RUDI Design Rulebook Hardening SWE Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: harden the uncommitted `rudi-design-rulebook` bundle against the supplied source transcript, screenshot, and review findings.
- Files inspected before editing: registry instructions, bundle entrypoint, both references, scanner, focused tests, generated index, package scripts, neighboring bundled-skill tests, and repository documentation.
- Relevant SWE manual sections: Engineering Operating Manual Index, Testing Doctrine, Agent Co-Pilot Operating Standard, and Horizontal Engineering And Codebase Stewardship Standard.
- Current-state commands: `git status --short --branch`, targeted `rg`, focused Vitest, registry validation, and scanner adversarial fixtures.
- Horizontal-pattern scan: no second scanner implements this design-rulebook responsibility. Existing audit scripts have different contracts, inputs, and lifecycles. Disposition: no horizontal obligation.
- Risks and invariants: preserve unrelated Dwellow work; do not hand-edit or stage the generated index; strong scanner findings must be unambiguous; source ambiguity must remain visible; public skill content must remain portable and client-neutral.
- Initial risk tier and rationale: Medium because the scanner can gate CI and its JSON/Markdown output is a user-facing contract.
- Exit criteria: exact blast radius printed, source ambiguities resolved transparently, and no active goal conflict.

## Phase 1: Scope Lock

- In scope: reference structure and provenance, scanner classification and summary behavior, focused tests, skill instructions, and this checklist.
- Non-goals: Neyer deck edits, unrelated Dwellow changes, registry architecture, new dependencies, commits, pushes, publication, installation, deployment, or admin-Mac synchronization.
- Expected files touched: `catalog/skills/rudi-design-rulebook/SKILL.md`, both reference files, scanner script, `src/portable-agentic-workflow-skills.test.ts`, and this checklist.
- External inputs and trust boundaries: CLI paths and arguments, scanned file contents, filenames, source transcript, and screenshot-derived labels. Missing roots and invalid flags must fail with actionable diagnostics. Lockfiles and raw dependency metadata must not become design verdicts.
- Failure behavior to define: one em dash is allowed; repeated em dashes are strong; actual Lucide use is review-only; lockfiles are skipped during directory scans; Markdown summaries show the highest severity; missing roots report their cause.
- Authorized external actions: none.
- Commit strategy and authorization: two planned slices remain uncommitted: (1) scanner plus tests, (2) references, skill instructions, compliance evidence, and generated-index verification. Commit and publication are not authorized.
- Horizontal-obligation disposition: no action. The rulebook scanner is one bounded implementation, not a third semantic implementation of an existing repository contract.
- Review and approval gates: focused red-green evidence, full verification, bounded final diff review, and disclosure that an independent fresh-context review is unavailable without authority to create another task or delegate.
- Exit criteria: task paths remain isolated and every behavior change has a red-test slot.

## Phase 2: Red Tests

- Observable behavior to prove:
  1. One em dash and dependency metadata do not create strong findings; repeated prose dashes do; actual Lucide UI use is review-only.
  2. A mixed-severity tell is summarized at its highest severity.
  3. The references contain exactly 20 tells and 21 reconciled principles with explicit rule, why/mechanism, detection/check, and fix fields plus provenance notes.
  4. Missing roots return the intended diagnostic rather than merely any exit code.
- Test file to edit: `src/portable-agentic-workflow-skills.test.ts`.
- Red commands: focused Vitest runs by test name, one behavior at a time.
- Expected failure: each new assertion fails against the current implementation for its reviewed reason.
- Exit criteria: expected failures are captured before the corresponding implementation change.

## Phase 3: Implementation

- Implementation rules: smallest contract-preserving changes; no new dependency; deterministic ordering; strong means source evidence is sufficient without rendering; review means human judgment remains necessary.
- Files allowed to change: only the Phase 1 expected paths. `index.json` may be regenerated only if catalog metadata changes and must never be edited by hand.
- Validation and error-handling requirements: validate existing CLI flags, preserve nonzero failure behavior, skip generated dependency metadata during directory discovery, and keep output shapes explicit.
- Observability requirements: findings retain tell, severity, file, line, evidence, and fix; summaries expose counts and highest severity per tell.
- Exit criteria: unchanged red commands pass with minimal implementation.

## Phase 4: Green Tests And Refactor

- Green command: rerun each focused red command unchanged, followed by the complete design-rulebook describe block.
- Refactor constraints: only remove duplication or clarify naming while tests remain green.
- Regression checks: portable-skill test file and manual scanner fixtures.
- Commit checkpoint: no commit authorized; preserve the two planned slices in the final ledger.
- Exit criteria: all targeted behavior is green and reference tests fail if required fields disappear.

## Phase 5: Full Verification

- Targeted tests: focused design-rulebook Vitest block.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run build`, `npm run indexes:check`, and `npm run catalog:clean:check`.
- JS/TS debt scan: RUDI `swe_debt_scan` against the scanner and focused test file.
- Live smoke checks: JSON and Markdown scans of deterministic fixtures, plus scan of the rulebook bundle itself.
- Independent review: a bounded local Standards/Spec/Proof review was performed. It found two wording-contract issues, both corrected and reverified. A fresh-context independent review remains a proof gap because delegation or new-task creation is not authorized.
- Risk-tier approval: user review is required before any commit or publication gate.
- Exit criteria: every feasible check passes and any proof gap is explicit.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: `SKILL.md`, both references, scanner usage semantics, and this execution record.
- Final files touched: `catalog/skills/rudi-design-rulebook/SKILL.md`, both reference files, `scripts/audit-ui-tells.mjs`, `src/portable-agentic-workflow-skills.test.ts`, generated `index.json`, and this checklist.
- Commands run and results: see Execution Record below.
- Evidence artifacts: Git diff, command output, scanner JSON/Markdown output, and this checklist.
- Independent-review result: local Standards pass, Spec pass, and Proof pass after two corrections; fresh-context independence not satisfied.
- Commit ledger and publication status: planned slices remain uncommitted; push, PR, merge, publication, installation, and deployment remain unauthorized and not performed.
- Horizontal obligations opened, closed, or accepted: none expected.
- Final verdict: needs human decision only for fresh review and any commit or publication gate; local implementation is verified.
- Accepted debt: none. Three review-only self-scan hits remain in explanatory pattern names and detector constants; these are expected heuristic review evidence, not blocking debt.
- Proof gaps: no fresh-context independent review. No dedicated task worktree was created, so no worktree-closeout receipt applies.
- Definition of Done: satisfied for the authorized local implementation. Commit, push, PR, merge, publication, installation, deployment, and admin-Mac synchronization remain separate unperformed gates.

## Execution Record

- Red slice 1: `npx vitest run src/portable-agentic-workflow-skills.test.ts -t 'RUDI Design Rulebook'` failed two tests because a single em dash was strong and `package-lock.json` was scanned. The unchanged block passed after context and frequency classification were implemented.
- Red slice 2: the focused `summarizes a tell at its highest observed severity` test failed because a mixed review/strong tell summarized as review. It passed unchanged after adding explicit severity ranking.
- Red slice 3: the focused `publishes the complete sourced rulebook contract` test failed on the first missing Rule field. It passed unchanged after all 20 tells and 21 reconciled principles received the required fields and source provenance.
- Smoke-derived red slice 4: the focused self-scan test failed with eight strong findings from rule definitions and detector source. It passed after detectors were limited to rendered/style/script syntax. The integration block then caught one overcorrection for SVG turbulence embedded in JavaScript; the unchanged block passed after restoring that legitimate context.
- Final focused verification: seven design-rulebook tests passed.
- Full regression: `npm test` passed 253 tests across 28 files.
- Registry validation and build: `npm run build` passed with 157 packages and 70 skills.
- Generated artifacts: `npm run indexes:sync` regenerated `index.json` from catalog source; `npm run indexes:check` reports current. The file still contains unrelated Dwellow hunks and must not be staged wholesale.
- Catalog hygiene: `npm run catalog:clean:check` planned zero removals.
- Syntax and whitespace: `node --check .../audit-ui-tells.mjs` and `git diff --check` passed.
- Debt: targeted RUDI `swe_debt_scan` reported zero error, warning, or informational findings for the scanner and focused test file.
- Packaging: `npm pack --dry-run --json` includes `SKILL.md`, both references, the scanner, and `agents/openai.yaml`.
- Smoke: scanning the rulebook bundle reports zero strong findings and three expected review findings; scanner JSON includes highest severity by tell.
- Source contract: exact counts are 20 tell Rule/Fix pairs and 21 reconciled-principle Rule/Fix pairs. Both supplied TikTok URLs and both ambiguity resolutions are present.
- Local review: the first pass corrected the misleading blanket term "twenty-one laws" and the conflict between removing every strong finding and documenting functional exceptions. Rerun checks passed.
- Worktree safety: unrelated Dwellow paths remain modified exactly as a separate workstream. No files were staged, committed, pushed, published, installed, deployed, or synchronized to the admin Mac.
