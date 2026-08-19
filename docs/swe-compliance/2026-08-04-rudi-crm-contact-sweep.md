# RUDI CRM Approval-Gated Gmail Contact Sweep

## Phase 0: Baseline And Manual Lookup

- Scope: add a controlled RUDI CRM contact-discovery pipeline that can retain Gmail address evidence, preview deduplicated contact candidates, and promote one approved candidate into a new person or an existing person's email aliases.
- Files to inspect before editing: `catalog/stacks/rudi-crm/{README.md,manifest.json,package.json}`, `src/{contract.ts,index.ts,schemas.ts}`, ordered SQL migrations, package tests, and the local RUDI CRM skill.
- Relevant SWE manual sections: Master Doctrine Appendix A (database invariants and migrations), Appendix C (red-green-refactor), API Standard contract/idempotency guidance, Backend Standard transaction guidance, and Security Standard trust-boundary guidance.
- Current-state proof: the local CRM has 53 people; discovery observations already have exact source/address idempotency and domain heuristics, but the database drops `display_name` and `raw`, its role constraint is narrower than the MCP schema, and no controlled candidate-preview or person-promotion operation exists.
- Existing-work boundary: preserve the in-progress local-PostgreSQL cutover and unrelated OpenCounter changes already present in the dirty registry worktree. Never edit the applied `0001_engagement_crm.sql` migration.
- Exit criteria: current behavior, data invariants, overlapping changes, and test entrypoints are recorded before implementation.

## Phase 1: Scope Lock And Interface Contract

- In scope: additive ordered migrations; candidate preview and domain-heuristic MCP reads/actions; an approval-only contact promotion mutation; schemas, contract, MCP surface, tests, manifest, README, generated index, local workflow guidance, installation/reindex, and a preview-only 12-month Gmail sweep for `hoff@learnrudi.com`.
- Non-goals: automatically promoting candidates, fuzzy auto-merges, mutating Gmail, committing personal CRM data, changing the applied `0001` migration, creating a general email-marketing system, or refactoring unrelated registry work.
- Candidate-preview input: bounded pagination, minimum observation count, optional offset-aware `since`, and an `include_existing` flag. Output must expose exact-email status and review signals but must not imply fuzzy matches are safe to merge.
- Promotion input: required normalized email and full name; optional existing person ID for explicit alias attachment and bounded person metadata. Exact email matches are idempotent. A new person plus primary email is atomic. A colliding email must never move between people implicitly.
- Approval invariant: discovery and preview do not create or attach a person. Only `rudi_crm_promote_contact`, called after explicit user approval, can do that.
- Trust boundaries: Gmail headers, names, addresses, message timestamps, LLM-selected candidates, MCP arguments, and database reads are untrusted until validated. Secrets and database URLs remain outside source and logs.
- Failure behavior: malformed addresses/roles/timestamps fail closed; duplicate observations replay safely; promotion collision returns or raises an actionable deterministic result; transaction failure creates neither a partial person nor a partial alias.
- Expected files touched: this checklist; additive CRM SQL migrations; `src/{schemas.ts,contract.ts,index.ts}`; focused tests; `README.md`; `manifest.json`; package version files if required; generated `index.json`; and `/Users/hoff/.codex/skills/rudi-crm/SKILL.md`.
- Exit criteria: the behavior and data contracts are represented by focused failing tests before implementation.

## Phase 2: Red-Green-Refactor Slices

1. Candidate and promotion MCP schemas reject malformed/unbounded input and expose conservative defaults.
   - Red command: build, then run the focused contract-schema test by name.
   - Green condition: the unchanged test passes with the smallest schema addition.
2. The MCP server exposes the three controlled operations and no raw SQL surface.
   - Red command: run the focused MCP contract test.
   - Green condition: declarations and dispatch use the validated schemas and explicit contract functions.
3. A clean database applies `0001` then `0002`; discovery persists display name/raw and accepts every declared address role.
   - Red command: run the isolated bootstrap/database behavior test.
   - Green condition: ordered migrations and clean validators pass without modifying `0001`.
4. Candidate preview excludes self/noise and reports exact existing-contact status; promotion is atomic, idempotent, and only attaches aliases when an existing person ID is explicitly supplied.
   - Red command: run a transaction-wrapped live contact behavior test with synthetic addresses.
   - Green condition: replay returns the same person, collisions cannot reassign an email, and rollback leaves no residue.
5. Refactor only after each focused behavior is green; rerun that slice unchanged after cleanup.

## Phase 3: Implementation Constraints

- Database: use additive DDL; enforce normalization and uniqueness at the database boundary; use a single transaction per promotion; rely on existing audit triggers/context; preserve existing observations and query compatibility.
- Candidate ranking: deterministic observation/thread counts and latest-seen ordering. Exact email is authoritative for dedupe. Similar names or organizations are review signals only.
- MCP boundary: expose only named controlled functions; retain `raw_sql_enabled: false`; use parameterized queries; return stable JSON shapes.
- Observability: return inserted/duplicate observation counts, heuristic update counts, candidate evidence counts, and promotion status without message bodies or credentials.
- Local Gmail workflow: search a bounded date range, extract only required header metadata, batch observations with stable source/message IDs, run heuristics, preview candidates, and stop before promotion.
- Exit criteria: each contract slice is implemented through its red-green-refactor gate.

## Phase 4: Full Verification

- Targeted package tests: CRM contract, MCP, package contract, migration bootstrap, live database, and live contact behavior tests.
- Full package and registry checks: CRM `npm test` and `npm run build`; registry `npm test`, `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack --dry-run --json`.
- Debt scan: run the repository's architecture-aware JS/TS scan scoped to the edited CRM TypeScript files; errors block completion, warnings are fixed if in scope or recorded.
- Live smoke: migrate the local CRM, confirm setup health and zero validator violations, install/reindex the canonical stack, verify the controlled MCP surface, and run transaction-wrapped synthetic promotion proof with rollback/no residue.
- Security/data checks: `git diff --check`; no secrets, database URLs, personal message bodies, or CRM row data in source artifacts.
- Exit criteria: every applicable gate passes or a precise pre-existing/out-of-scope failure is documented.

## Phase 5: Preview-Only Execution And Handoff

- Sweep window: 12 months ending 2026-08-04 for `hoff@learnrudi.com`, excluding spam/trash and retaining only header-level evidence necessary for contact discovery.
- Execution: record idempotent discovery evidence and an ingest batch, apply domain heuristics, then return a deduplicated candidate preview with exact existing-contact status.
- Hard stop: do not call contact promotion for any candidate until the user explicitly approves that person and whether to create a new person or attach an alias.
- Handoff: report candidate counts, filtered/noise counts where available, the approval list, exact commands/gates run, installed stack state, changed files, residual risks, and rollback/recovery notes.
- Definition of Done: the canonical stack provides a verified, installed, approval-gated discovery/promotion contract; local workflow guidance is current; and the 12-month sweep reaches candidate preview without promoting contacts.

## Execution Record

- Status: complete on 2026-08-04 ET. The requested sweep stopped at preview; no person or email alias was promoted.
- Red/green evidence:
  - Candidate/promotion schema test failed on missing exports, then passed after the bounded schemas were added.
  - MCP contract test failed on the missing controlled operations, then passed with 19 tools and no raw-SQL surface.
  - Package migration test failed until `0002_contact_discovery_promotion.sql` was packaged.
  - Live discovery failed on the old address-role constraint, then passed after `0002` was applied.
  - Boundary tests failed while invalid sources/timestamps were accepted, then passed after validation was tightened.
  - The version contract failed at 0.2.x, then passed at 0.3.0.
  - A live mixed-domain test exposed that a single no-reply address could suppress human contacts at the same domain. `0003_contact_candidate_noise.sql` fixed the candidate-level filter and repaired prior automatic classifications; the unchanged test then passed.
- Verification results:
  - CRM live suite: 16 tests passed, 0 skipped, against the local CRM database.
  - Isolated bootstrap: a clean database applied `0001`, `0002`, and `0003`; replay skipped all three with matching checksums.
  - Registry: 18 test files / 157 tests passed; build and 149-package validation passed; indexes synced and checked; clean-catalog check passed; package dry-run contained both new migrations.
  - Installed stack: version 0.3.0, 19 controlled tools, all three migrations current, setup healthy, 53 people, 366 preview candidates, and all eight validators green.
  - Router: forced reindex succeeded for `stack:rudi-crm` with 19 tools and no indexing error. The local registration uses `/opt/homebrew/bin/node dist/index.js` because the machine's bundled RUDI Node/npm launchers are currently self-referencing shell wrappers; unrelated running stacks were not changed or stopped.
  - Workspace integrity: generated indexes are current and `git diff --check` is clean outside the two already-applied migration files. Those files intentionally retain one final blank line because their bytes must remain identical to the migration-ledger and installed-stack SHA-256 checksums; removing it would create migration drift.
  - Debt scan: no structural findings in the edited CRM TypeScript files. One accepted warning remains: pre-existing `src/contract.ts` is above the configured 800-line threshold (1,246 lines); splitting that contract is separate scope.
- Preview results:
  - Gmail account: `hoff@learnrudi.com`; bounded query `after:2025/08/04 before:2026/08/05 -in:spam -in:trash`.
  - 1,363 messages scanned; 2,828 valid external header observations retained across 1,306 messages and 572 unique addresses. One malformed HubSpot routing/tracking address was rejected at validation.
  - 2,823 observations were newly inserted; five prior observations were safely replayed/enriched; 69 addresses were filtered as internal/noise/no-reply.
  - Candidate preview at two or more observations: 396 including exact matches, 366 new/non-exact candidates, and 30 exact existing-email matches excluded from the approval queue.
  - Ingest batch: `e5fbecf8-b6e9-482f-9157-1d9e91fdf688`. The batch is explicitly marked preview-only/no promotion.
  - Only header-derived contact evidence and `{mailbox: "hoff@learnrudi.com"}` were retained; no message bodies, snippets, attachments, or credentials were stored.
- Files changed for this workflow:
  - `catalog/stacks/rudi-crm/sql/migrations/{0002_contact_discovery_promotion.sql,0003_contact_candidate_noise.sql}`
  - `catalog/stacks/rudi-crm/src/{schemas.ts,contract.ts,index.ts}`
  - `catalog/stacks/rudi-crm/tests/{contract.test.mjs,mcp.test.mjs,package-contract.test.mjs,migrate.test.mjs,live-contacts.test.mjs}`
  - `catalog/stacks/rudi-crm/{README.md,manifest.json,package.json,package-lock.json}`, generated registry `index.json`, this checklist, and `/Users/hoff/.codex/skills/rudi-crm/SKILL.md`
- Recovery/idempotency: rerunning the same Gmail window replays stable observation keys instead of duplicating evidence. Because no promotion occurred, the people/email tables require no rollback.
