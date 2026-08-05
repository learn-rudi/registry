# RUDI CRM Local PostgreSQL Cutover

## Phase 0: Baseline And Manual Lookup

- Scope: migrate the installed RUDI CRM from its inactive hosted Supabase database to the already-running local PostgreSQL 17 service without losing data, then make the registry package provider-neutral.
- Files to inspect before editing: `catalog/stacks/rudi-crm/{README.md,manifest.json,package.json}`, `src/{contract.ts,index.ts,schemas.ts}`, `sql/record_finance_event.sql`, package tests, and the engagement CRM data dictionary/reconcile documentation under `business/product/engagement-crm`.
- Relevant SWE manual sections: Master Doctrine principles 2, 4, 13, 14, 15, and 17; Appendix A (database engineering); Appendix C (red-green-refactor); Infrastructure H3, H4, H5, and H8.
- Current-state commands: `git status -sb`, `rudi list stacks --json`, CRM `config_status` and `setup_status`, `pg_isready`, local database inventory, Supabase project status, and schema/backup discovery.
- Risks and invariants: preserve all existing CRM records; never commit personal CRM data or credentials; keep the MCP raw-SQL boundary closed; keep writes idempotent; all validator views must return zero rows; provider choice must not alter the MCP contract.
- Exit criteria: exact source state is recoverable, local PostgreSQL is ready, and the work boundary is documented before behavior changes.

## Phase 1: Scope Lock

- In scope: source-controlled provider-neutral schema migrations and bootstrap/verification commands; lossless private export/restore; local RUDI secret cutover; optional Supabase connection guidance; tests, docs, indexes, and verification.
- Non-goals: deleting the Supabase project; adding Supabase Auth/Storage/Realtime; exposing raw SQL; changing the 16 MCP tool interfaces; committing CRM row data; refactoring unrelated registry or OpenCounter work.
- Expected files touched: this checklist and files within `catalog/stacks/rudi-crm`; generated `index.json` only if `indexes:sync` changes it.
- External inputs and trust boundaries: `RUDI_CRM_DATABASE_URL`, SQL migration files, remote dump data, local PostgreSQL, and MCP inputs. Credentials remain in RUDI secrets; dumps remain under private local RUDI state.
- Failure behavior to define: bootstrap fails closed for missing/invalid URLs, records applied migrations transactionally, rejects checksum drift, and reports the migration filename without echoing credentials.
- Exit criteria: provider-neutral interfaces and data-preservation boundary are explicit.

## Phase 2: Red Tests

- Observable behavior to prove: the package ships the complete expected schema as ordered migrations, exposes a provider-neutral migration runner, and does not present Supabase as mandatory.
- Test files to add or edit: `catalog/stacks/rudi-crm/tests/package-contract.test.mjs` and focused migration-runner tests if a runner is required.
- Red command: `npm test -- --test-name-pattern='local PostgreSQL bootstrap'` from `catalog/stacks/rudi-crm` (or the smallest equivalent Node test command supported by the package).
- Expected failure: missing canonical migrations/bootstrap entrypoint and Supabase-first documentation.
- Exit criteria: the new behavior-level test fails for only the missing implementation.

## Phase 3: Implementation

- Implementation rules: recover exact hosted DDL before hand-authoring; keep migrations ordered and immutable; use bound SQL for metadata; keep database creation separate from schema application; introduce no new dependency unless unavoidable.
- Files allowed to change: the scope-locked files above.
- Validation and error-handling requirements: validate PostgreSQL URLs; require an existing target database; use advisory locking plus a migration ledger; apply each migration transactionally; never log the URL.
- Observability requirements: report target database/schema/version, applied/skipped migration counts, and actionable failure context without secrets.
- Exit criteria: a clean PostgreSQL database can be bootstrapped from source-controlled migrations and passes setup checks.

## Phase 4: Green Tests And Refactor

- Green command: rerun the unchanged focused red command.
- Refactor constraints: only remove duplication or clarify provider boundaries while focused tests remain green.
- Regression checks: package contract, schemas, MCP tool list, idempotency behavior, and finance live test.
- Exit criteria: focused tests remain green after any cleanup.

## Phase 5: Full Verification

- Targeted tests: CRM package tests, including live database behavior against local PostgreSQL.
- Full suite: registry `npm test`.
- Build/typecheck/lint: CRM `npm run build`; registry `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack --dry-run --json`.
- JS/TS debt scan, if applicable: repository runner scoped to edited CRM JS/TS files, with errors blocking and out-of-scope warnings recorded.
- Live smoke checks: local CRM `setup_status`, all validators, bounded list reads, and an idempotent transaction-wrapped write probe with rollback/no residue.
- Exit criteria: every required gate passes or a concrete residual gap is documented.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README local-first setup, optional Supabase provider section, backup/restore notes, and manifest secret guidance.
- Final files touched: record the exact list after implementation.
- Commands run and results: record red, green, refactor verification, full gates, data-count reconciliation, and live smoke results.
- Accepted debt: none by default; any missing canonical migration, unverified row count, or backup gap blocks completion.
- Definition of Done: local CRM is the active RUDI target, private data is preserved, hosted provider configuration is optional and isolated, the package bootstraps a clean PostgreSQL database reproducibly, validators are green, and required registry gates pass.

## Execution Record

### Completed Scope

- Status: complete on 2026-08-04.
- Local target: Homebrew PostgreSQL 17 database `rudi_crm` on `127.0.0.1:5432`.
- RUDI target: `RUDI_CRM_DATABASE_URL` now resolves from the secrets store to the local database; the installed `stack:rudi-crm` is version `0.2.0` and exposes 16 indexed MCP tools.
- Hosted source: Supabase project `engagement-crm` was restored only long enough to take and verify the migration export, then returned to `INACTIVE` after local cutover. It was not deleted.
- Private recovery artifacts: `~/.rudi/state/stacks/rudi-crm/backups/20260804-local-cutover/engagement-crm.backup` and the adjacent schema dump. The custom dump SHA-256 is `5f57d2e07175f7ad95872daa6cebae80633a230ff911d1ec482de92487b1159e`; the schema dump SHA-256 is `b09c172102d18ccc9ef0ba4f4c2f17f9e3556dc65da75bfef13a5687db367c28`.
- No CRM rows, credentials, tokens, or connection strings were added to the repository.

### Red-Green-Refactor Evidence

- Red: `node --test --test-name-pattern='provider-neutral local PostgreSQL bootstrap' tests/package-contract.test.mjs` failed with `ENOENT` for the missing canonical migration.
- Red: `npm run build && node --test --test-name-pattern='does not infer transport policy' tests/contract.test.mjs` failed because a Supabase hostname implicitly enabled TLS.
- Green: the unchanged focused tests passed after adding the canonical migration/bootstrap runner and making TLS policy explicit through `sslmode`.
- Red: the publish-boundary assertion failed because the root package omitted `.sql` files.
- Green: the unchanged assertion passed after adding `catalog/stacks/**/*.sql` to the registry package files, and `npm pack --dry-run --json` listed both CRM SQL files.
- Refactor verification: `RUDI_CRM_BOOTSTRAP_TESTS=1 RUDI_CRM_DATABASE_URL=<redacted> npm run test:live` passed all 11 CRM tests, including isolated clean-database bootstrap, idempotent reapply, finance transaction/rollback, MCP surface, and live local database behavior.

### Data Reconciliation And Live Proof

- Source and local counts matched for all 19 domain tables: users 1, actors 4, agents 3, people 53, threads 52, engagements 15, audit events 6, deliverables 8, interactions 83, next actions 8, organizations 19, person emails 59, ingest batches 4, discovery domains 66, engagement people 44, deliverable people 9, discovery observations 108, interaction participants 189, and engagement finance events 27.
- All eight validator views returned zero rows locally.
- Final bounded proof reported database `rudi_crm`, one applied schema migration, 19 organizations, 53 people, 15 engagements, 83 interactions, 27 finance events, and zero validator failures.
- Direct local MCP smoke reported setup healthy and read the expected organization data.

### Final Verification

- `npm test` at the registry root: 18 files and 157 tests passed.
- `npm run validate`: 147 catalog packages passed.
- `npm run indexes:sync`: passed; `npm run indexes:check`: current.
- `npm run build`: passed.
- `npm pack --dry-run --json`: passed with 914 entries and both `sql/migrations/0001_engagement_crm.sql` and `sql/providers/supabase/0001_harden_data_api.sql` present.
- `npm audit --omit=dev --json` in the installed CRM stack: zero vulnerabilities across 140 dependencies.
- `git diff --check`: passed.
- `npm run catalog:clean:check`: the only failure is the pre-existing, unrelated `catalog/stacks/opencounter/node_modules` reproducible artifact. It was preserved because OpenCounter work is outside this task and user-owned.
- Scoped structural debt scan: zero findings when both real entrypoints (`src/index.ts` and `src/migrate.ts`) are declared.
- Scoped size scan: one accepted pre-existing warning, `src/contract.ts` at 1,175 lines versus the 800-line threshold. Splitting the established CRM contract is a separate behavior-bearing refactor and was intentionally excluded from this provider cutover.

### Files Changed For This Cutover

- Registry boundary: `package.json`, generated `index.json`, and this checklist.
- Stack metadata/docs: `catalog/stacks/rudi-crm/{README.md,manifest.json,package.json,package-lock.json}`.
- Runtime: `catalog/stacks/rudi-crm/src/{contract.ts,index.ts,migrate.ts}`.
- Database: added `sql/migrations/0001_engagement_crm.sql`, added optional `sql/providers/supabase/0001_harden_data_api.sql`, and removed the duplicated `sql/record_finance_event.sql`.
- Tests: `tests/{contract.test.mjs,mcp.test.mjs,package-contract.test.mjs,migrate.test.mjs}`.

### Operational Handoff

- Persistence correction: the first secret-set attempt did not overwrite the existing value. The CLI reported that `--force` was required. The secret was subsequently replaced with `--force`, then read back through a metadata-only URL parse confirming host `127.0.0.1`, port `5432`, database `rudi_crm`, and `sslmode=disable` without printing credentials.
- Post-correction RUDI smoke: the active router's `setup_status` connected to database `rudi_crm` on PostgreSQL 17.7, `list_people` returned all 53 records, and `run_validators` reported zero violations across all eight validators. The current Codex task therefore does not require a restart for CRM access; other already-running agent hosts may still need one if they cache stack processes independently.
- Keep the Homebrew PostgreSQL service running and back up `rudi_crm`; daemon health and database durability are separate concerns.
- Supabase remains an optional hosted PostgreSQL provider. Its hardening SQL is isolated from the provider-neutral core migration and should be applied only when that provider is selected.
- The separately configured workspace `/Users/hoff/dev/RUDI/apps/robin` was reported missing and was not recreated or otherwise changed as part of the CRM cutover.
