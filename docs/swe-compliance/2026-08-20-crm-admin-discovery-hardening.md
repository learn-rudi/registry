# CRM Admin Discovery Hardening

## Phase 0: Baseline And Manual Lookup

- Status: Complete.
- Scope: repair the exact known historical CRM migration-ledger checksums; add a least-privilege, privacy-minimized, replay-safe discovery ingestion boundary; and add bounded Gmail and Calendar discovery pages.
- Files inspected before editing: repository `AGENTS.md`; Registry and stack package metadata; CRM migrations `0001` through `0004`, migration runner, schemas, MCP server, contact contract, and tests; Google Workspace Gmail/Calendar helpers, server, manifests, and tests; the prior CRM and Gmail compliance records.
- Relevant SWE manual sections: Master Doctrine Appendix A (database migrations, transactions, and data integrity), Appendix C (behavior-level red-green-refactor), API Standard E7/E11 (idempotency and pagination), and Security Standard F2/F4/F11/F13 (authorization, trust boundaries, least privilege, and agent authority).
- Current-state proof: migrations `0001` through `0004` have the four canonical SHA-256 hashes supplied in the acceptance contract. Repository history contains only the two explicitly allowlisted historical variants, caused by the pre-trim final newline in `0001` and `0002`. Unknown migration path/checksum drift currently fails closed.
- Risks and invariants: migrations `0001` through `0004` remain byte-for-byte unchanged; no ledger row is rewritten; only the two exact historical checksum pairs are accepted; discovery cannot expose promotion/classification/candidate tools or direct table DML; stored discovery data contains no message/event content or raw provider objects; people and person-email rows are unchanged by discovery finalization.
- Exit criteria: baseline hashes, historical provenance, active branch/worktree, and test entrypoints are recorded before implementation.

## Phase 1: Scope Lock

- Status: Complete.
- In scope: `catalog/stacks/google-workspace/**`, `catalog/stacks/rudi-crm/**`, `catalog/skills/rudi-crm.md`, this compliance record, and generated `index.json`.
- Non-goals: changing migrations `0001` through `0004`; private-dump rehearsal; live Google/CRM calls; role provisioning; account changes; installation, deployment, commit, push, PR, or admin-host changes.
- Expected files touched: CRM additive migration `0005`, package/manifest/lockfile, README, schemas/contracts/server/migration runner, focused tests; Google Workspace package/manifest/lockfile, README, Gmail/Calendar discovery helpers/server/tests; CRM operator skill; generated index; this record.
- External inputs and trust boundaries: migration ledger rows, PostgreSQL URLs, MCP arguments, provider page tokens, Google message/event metadata, email/display-name parsing, run/page keys, page order, timestamps, and database role/session identity.
- Failure behavior: reject unknown migration filename/checksum drift; reject missing or mismatched account/calendar/window scope, malformed or content-bearing observations, unordered pages, inconsistent replay, excessive pages/records, missing finalize pages/counts, and discovery-profile requests for non-discovery tools.
- Stable tool contract:
  - `gmail_discovery_page` returns only source/account/window plus normalized `from`/`to`/`cc` observations with scoped SHA-256 resource keys.
  - `calendar_discovery_page` returns only source/account/calendar/window plus normalized organizer/attendee observations and optional scoped recurrence keys.
  - `rudi_crm_record_discovery_page` records one source/account-scoped page and returns exactly `{accepted, replayed}`.
  - `rudi_crm_finalize_discovery_run` validates the expected page/record set, applies only the allowlisted deterministic noise heuristic, proves CRM people/email counts are unchanged, records a count-only audit, and returns exactly `{finalized, replayed}`.
- Role contract: `rudi_crm_discovery` and `rudi_crm_promotion` are proposed group-role names only. Human-reviewed provisioning and grants remain deployment-gated. The package revokes PUBLIC access and does not create or auto-grant roles.
- Exit criteria: shared interfaces are fixed before producers/consumers are edited.

## Phase 2: Red Tests

- Status: Complete.
- Slice 1: exact historical migration checksum allowlist and unknown drift rejection.
- Slice 2: Gmail and Calendar discovery tools enforce exact scope, bounds, deterministic minimal output, privacy exclusions, and recurrence identity.
- Slice 3: discovery-only MCP profile exposes only status plus page/finalize and cannot expose candidate, classification, heuristic, promotion, or raw-SQL operations.
- Slice 4: PostgreSQL 17 bootstrap enables RLS, revokes PUBLIC access, hardens controlled SECURITY DEFINER functions, and proves negative privileges.
- Slice 5: page insert/retry/failure replay is account/source scoped and idempotent.
- Slice 6: finalize verifies expected pages/counts and privacy/structure/no-promotion invariants, runs only deterministic noise heuristics, emits count-only audit, and leaves `people`/`person_emails` unchanged.
- Red command: the narrow unchanged test command for each slice and its expected failure are recorded in the execution record.
- Exit criteria: every behavior-bearing slice has a demonstrated expected red before its smallest green implementation.

## Phase 3: Implementation

- Status: Complete.
- Implementation rules: additive SQL only; closed JSON schema; source/account/calendar-scoped SHA-256 keys; page numbers 1 through 500; zero through 500 observations per page; fixed `pg_catalog, public` search paths; explicit caller/application attribution; no PUBLIC grants; no automatic role creation or privilege promotion.
- Files allowed to change: only the Phase 1 allowlist.
- Validation and error handling: all untrusted fields are bounded and validated at both MCP and SQL boundaries; unknown fields/content keys fail closed; replay with different content fails; finalize failure leaves the run open and checkpoint advancement remains adapter-owned.
- Observability: count-only run audit with session user and application name; no addresses, names, content, tokens, URLs, raw payloads, or provider responses in audit metadata.
- Exit criteria: each implementation slice passes its unchanged red command before refactoring.

## Phase 4: Green Tests And Refactor

- Status: Complete.
- Green commands: the same focused commands used for each red slice.
- Refactor constraints: only remove duplication or isolate contracts while all affected focused tests remain green; do not broaden the tool/data surface.
- Regression checks: both stack builds/tests and migration hash proof after every SQL-related refactor.
- Exit criteria: all focused tests remain green after any refactor.

## Phase 5: Full Verification

- Status: Complete.
- Targeted tests: CRM contract/MCP/package/migration/security suites; Google Gmail/Calendar suites; both stack builds.
- Full suite: Registry `npm test` and stack verification as applicable.
- Build/typecheck/lint: Registry `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, and `npm run build`.
- JS/TS debt scan: repository policy scan scoped to edited TypeScript/JavaScript neighborhoods; errors block closure.
- Database smoke: isolated PostgreSQL 17 clean bootstrap, idempotent replay, historical-variant ledger rehearsal reconstructed from Git history only, negative privilege checks, privacy/replay/finalize behavior. The actual private dump remains a separate gated node.
- Packaging: `npm pack --dry-run --json`, package-lock consistency, migration hash check, credential/content scan, and `git diff --check`.
- Live smoke checks: not run; this node explicitly prohibits live account/database/runtime calls.
- Exit criteria: every applicable gate passes or a precise residual gap is recorded.

## Phase 6: Docs, Contracts, And Closure

- Status: Complete.
- Docs/API contracts: CRM and Google Workspace READMEs/manifests, CRM operator skill, role provisioning boundary, tool names/shapes, and this execution record.
- Final files touched: recorded at closure.
- Commands run and results: recorded at closure with exact red/green and PostgreSQL evidence.
- Accepted debt: private-dump rehearsal, deployment-time group-role provisioning/grants, and authenticated Google provider smoke remain separately gated.
- Definition of Done: exact historical compatibility is narrow and fail-closed; discovery is privacy-minimized, bounded, idempotent, and unable to promote; PUBLIC/ACL/RLS and controlled-function boundaries have negative tests; package/server/manifest/index metadata agree; all required gates pass; migrations `0001` through `0004` retain canonical hashes.

## Execution Record

- Status: Complete for this source-only node. The private-dump rehearsal, deployment role grants, and authenticated provider smoke remain separately gated.

### Red-Green-Refactor Proof

Each green command was the unchanged focused command used for its red. Refactoring was followed by the same focused suite and then the full stack suite.

| Behavior | Red proof | Green/refactor command |
| --- | --- | --- |
| Exact historical migration checksum allowlist | Missing `assertCompatibleMigrationChecksum` export | `npm run build && node --test --test-name-pattern='migration ledger accepts only canonical or exact historical checksums' tests/migrate.test.mjs` |
| Unknown ledger path rejection | Missing `assertKnownMigrationLedgerEntries` export | `npm run build && node --test --test-name-pattern='unknown migration ledger entries fail closed' tests/migrate.test.mjs` |
| Gmail minimal discovery normalization | `normalizeGmailDiscoveryPage is not a function` | `npm run test:gmail` |
| Gmail MCP surface | `gmail_discovery_page must be exposed` | `npm run test:gmail` |
| Calendar minimal discovery normalization | Missing normalization function | `npm run test:calendar` |
| Calendar MCP surface | `calendar_discovery_page must be exposed` | `npm run test:calendar` |
| Closed CRM discovery schemas | Missing discovery schema exports | `npm run build && node --test --test-name-pattern='discovery run schemas are closed' tests/contract.test.mjs` |
| Discovery-only MCP profile | Red exposed the operator surface and omitted the two discovery functions | `npm run build && node --test --test-name-pattern='discovery MCP profile exposes' tests/mcp.test.mjs` |
| Additive security migration packaging | Missing `0005_discovery_security_boundary.sql` | `node --test --test-name-pattern='package ships additive least-privilege' tests/package-contract.test.mjs` |
| PostgreSQL security boundary | First execution failed on undeclared `digest(bytea, unknown)`; implementation switched to core `sha256(bytea)` without adding `pgcrypto` | `RUDI_CRM_DISCOVERY_SECURITY_TESTS=1 RUDI_CRM_TEST_ADMIN_URL=postgresql://127.0.0.1:55437/postgres node --test tests/discovery-security.test.mjs` |
| Gmail lower-bound rounding | A provider item just before the millisecond window caused the whole page to fail | `npm run test:gmail` |
| Calendar overlap/zero-observation page | An overlapping event beginning before `window_start` caused the whole page to fail | `npm run test:calendar` |
| Duplicate participants and canonical ordering | Duplicate To/attendee entries produced duplicate observations | `npm run test:gmail` and `npm run test:calendar` |
| Conservative Gmail provider query bounds | With `window_end=2026-01-02T00:00:00.500Z`, the focused mocked-adapter assertion expected `before:1767312001` but received `before:1767312000` | `node --import tsx --input-type=module -e '<mock runGmailDiscoveryPage; assert after:1767225599, before:1767312001, and exact-start observation>'` |
| Inclusive Gmail provider query start | With an observation exactly at `window_start`, the focused mocked-adapter assertion expected `after:1767225599` but received exclusive `after:1767225600` | Same unchanged mocked-adapter command after widening the query by one second and retaining exact normalization |
| Quoted display-name commas | The focused normalizer assertion for `"Doe, Jane" <jane@example.com>` failed with `to[0].address must be a valid email address` because the list used naive comma splitting | `node --import tsx --input-type=module -e '<normalize quoted-comma provider page and assert the two closed observations>'` |
| Empty address-list components fail closed | Independent review found leading, repeated, and trailing separators were silently dropped; the focused assertion reported `Missing expected exception` | `node --import tsx --input-type=module -e '<assert three malformed lists reject and the intentionally empty whole header remains empty>'` |

Exact post-review focused commands, each run red and then unchanged green:

```sh
node --import tsx --input-type=module -e 'import assert from "node:assert/strict"; import { runGmailDiscoveryPage } from "./src/gmail-search.ts"; let listed; const gmail={users:{getProfile:async()=>({data:{emailAddress:"owner@example.com"}}),messages:{list:async(args)=>{listed=args;return {data:{messages:[]}}},get:async()=>{throw new Error("unexpected")}}}}; await runGmailDiscoveryPage(gmail,{account:"owner@example.com",window_start:"2026-01-01T00:00:00Z",window_end:"2026-01-02T00:00:00.500Z"}); assert.match(listed.q,/before:1767312001(?: |$)/);'

node --import tsx --input-type=module -e 'import assert from "node:assert/strict"; import { runGmailDiscoveryPage } from "./src/gmail-search.ts"; let listed; const gmail={users:{getProfile:async()=>({data:{emailAddress:"owner@example.com"}}),messages:{list:async(args)=>{listed=args;return {data:{messages:[{id:"exact-start"}]}}},get:async()=>({data:{id:"exact-start",internalDate:"1767225600000",payload:{headers:[{name:"From",value:"Person <person@example.com>"}]}}})}}}; const response=await runGmailDiscoveryPage(gmail,{account:"owner@example.com",window_start:"2026-01-01T00:00:00Z",window_end:"2026-01-02T00:00:00.500Z"}); const page=JSON.parse(response.content[0].text); assert.match(listed.q,/after:1767225599 /); assert.equal(page.observations[0].observed_at,"2026-01-01T00:00:00.000Z");'

node --import tsx --input-type=module -e 'import assert from "node:assert/strict"; import { normalizeGmailDiscoveryPage } from "./src/gmail.ts"; const page=normalizeGmailDiscoveryPage({messages:[{id:"quoted",internalDate:"1767225600000",payload:{headers:[{name:"To",value:"\"Doe, Jane\" <jane@example.com>, Operations <ops@example.com>"}]}}]},{account:"owner@example.com",window_start:"2026-01-01T00:00:00Z",window_end:"2026-01-02T00:00:00Z",max_records:500}); assert.deepEqual(page.observations.map(({address,display_name})=>({address,display_name})),[{address:"jane@example.com",display_name:"Doe, Jane"},{address:"ops@example.com",display_name:"Operations"}]);'

node --import tsx --input-type=module -e 'import assert from "node:assert/strict"; import { normalizeGmailDiscoveryPage } from "./src/gmail.ts"; const normalize=(value)=>normalizeGmailDiscoveryPage({messages:[{id:"empty",internalDate:"1767225600000",payload:{headers:[{name:"From",value}]}}]},{account:"owner@example.com",window_start:"2026-01-01T00:00:00Z",window_end:"2026-01-02T00:00:00Z",max_records:500}); for (const value of [", Person <person@example.com>","Person <person@example.com>,, Other <other@example.com>","Person <person@example.com>,"]) assert.throws(()=>normalize(value),/empty address/); assert.deepEqual(normalize("").observations,[]);'
```

The final normalizers filter out-of-window provider rows while preserving the next-page token, deduplicate exact normalized tuples, and sort exactly by `(observed_at, resource_key, address_role, address)`. The Gmail provider query widens conservatively to `max(0, floor(window_start_ms / 1000) - 1)` through `ceil(window_end_ms / 1000)` and then applies the exact `[window_start, window_end)` post-filter. Its bounded address splitter caps input at 20,000 characters and 100 addresses, preserves commas inside quoted strings or angle brackets, supports quoted local parts, and rejects unterminated quotes and unmatched/nested angle brackets.

### PostgreSQL 17 Proof

- Engine: isolated Homebrew PostgreSQL 17.7 cluster at `/tmp/rudi-crm-pg17.SbyJOd/data`, loopback port `55437`; no private source dump or live database was used.
- Full gated CRM command: `RUDI_CRM_BOOTSTRAP_TESTS=1 RUDI_CRM_DISCOVERY_SECURITY_TESTS=1 RUDI_CRM_TEST_ADMIN_URL=postgresql://127.0.0.1:55437/postgres npm test`.
- Result: 25 tests, 21 passed, 0 failed, 4 skipped only because the separate legacy `RUDI_CRM_LIVE_TESTS` gate was not enabled.
- Clean bootstrap and second idempotent migration pass succeeded.
- Repository-history rehearsal reconstructed the two allowlisted historical migration bytes from Git revision `f7ada8214192ef048feae2bc84efe5c131713b13`, confirmed their exact SHA-256 values, installed them, upgraded through current `0003` to `0005`, and confirmed the old ledger values remained untouched. An injected unknown ledger path failed closed.
- The negative privilege test proved direct table select/insert, promotion, and classification were denied to a temporary function-only discovery role while page recording/finalization remained available. It also proved RLS enabled, no PUBLIC schema/relation/function ACL, fixed safe search paths for controlled SECURITY DEFINER functions, exact replay after finalize, mismatch/new-page rejection, account-scope isolation, incomplete-finalize rejection, cutoff equality acceptance, privacy rejection, count-only audit attribution, and same-count `people`/`person_emails` mutation detection through complete ordered row snapshots.
- The temporary role and database were dropped by the test. The isolated cluster was stopped and its temporary directory removed at closure.

### Full Gate Results

- Google Workspace deterministic suites: `test:auth`, `test:drive`, `test:gmail`, `test:calendar`, `test:slides`, `test:tasks`, `test:state`, and `npm run build` passed.
- Google Workspace `npm run verify` passed and verified the live stdio schema surface of 71 tools without making provider calls.
- CRM full isolated suite passed as recorded above; CRM manifest exposes 22 tools.
- Post-review Gmail regression: the complete deterministic Gmail behavior test, including the mocked adapter and new quoted/angle-comma/malformed-quote cases, passed through a dependency-free transformed invocation that omitted only the unchanged MCP client schema smoke. The normal `npm run test:gmail` command could not be rerun after required catalog cleanup removed stack `node_modules`, because this node prohibits installation; its full pre-cleanup run and `npm run verify` were green before these corrections.
- The independent read-only review found the empty-component fail-open behavior above. It was reproduced red, fixed, and covered along with exact-window-end exclusion, epoch query clamping, angle-bracket structure, 100/101-address limits, and the 20,000-character bound; follow-up review found no remaining actionable issue.
- Post-review Registry `npm test`: 28 files, 245 passed, 0 failed.
- Registry `npm run validate`: 152 packages passed.
- `npm run indexes:sync` regenerated `index.json`; final `npm run indexes:check` reported 152 packages and current indexes.
- `npm run catalog:clean && npm run catalog:clean:check` removed only generated stack `dist`/`node_modules` directories; final dry run planned 0 targets.
- Registry `npm run build` passed.
- Post-review `npm pack --dry-run --json`: `@rudi/registry@2.0.0`, 965 files, package size 2,275,417 bytes, unpacked size 10,399,243 bytes; the existing `.npmignore` warnings remain unchanged.
- Repository-policy JS/TS debt scans for the edited Google Workspace and CRM graphs reported 0 errors, 0 warnings, and 0 informational findings.
- `git diff --check` passed.

### Migration Integrity

Current migration SHA-256 values after all work:

- `0001_engagement_crm.sql`: `c14fbb3eff18f7bc1a02c65915cfe8dd593c7edb73080547bdbc5fff494edc7e`
- `0002_contact_discovery_promotion.sql`: `c50c0ed11d2142f84f291b98eae40e95e03cae9f856adb3dd2605d7fa61446b3`
- `0003_contact_candidate_noise.sql`: `fe04c8a031bb45b9cf46c6510db29692450e29b549889ec7136c70c5db3478de`
- `0004_contact_address_classification.sql`: `1e41c3c291cb813cfdf08719521a2e5620496ca513d6747d213c4c5003c7dd38`

Only the exact historical `0001` checksum `b02f4570ee6133cea7d4303cd698cc49a6f30010f87dfcd2b6331cbdfe07bc2d` and `0002` checksum `a80fbe135f53da9ea79f48c3f0168ea005b5f38b71f339cd6d7702776f51c624` are compatible alternatives, and only when the current source bytes equal the canonical hashes above.

### Known Gaps And Accepted External Gates

- The actual private-source-dump rehearsal remains a separate gated node and was not accessed or transferred.
- Stable group-role provisioning/grants remain a deployment-gated human choice; source defines no automatic role creation or grants.
- Authenticated Google provider smoke was not run because this node prohibits live account calls. The legacy Google `node test.cjs` entrypoint attempted OAuth and stopped on missing `GOOGLE_CREDENTIALS`; deterministic mocked suites and stdio schema verification are the applicable source gates.
- Existing install-time audit output remains: Registry dependencies reported 1 moderate, 6 high, and 1 critical finding; Google Workspace dependencies reported 5 moderate findings. No dependency version or dependency graph was changed, and no out-of-scope audit fix was applied.
