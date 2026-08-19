# RUDI CRM Address Classification And Confirmed Contact Promotion

## Phase 0: Baseline And Manual Lookup

- Scope: promote the specifically user-confirmed people and aliases from the Gmail discovery queue, then add an address-level classification model so a domain can map to an organization while each mailbox is independently classified.
- Files to inspect before editing: repo and global `AGENTS.md`; CRM migrations, schemas, contract, MCP declarations, tests, package metadata, README, generated index, and local CRM skill.
- Relevant SWE manual sections: Database Appendix A (schema, additive migrations, integrity), Testing Appendix C (behavior-first red/green), API Standard E2/E3/E7/E9/E12 (validated contracts, errors, idempotency, agent clarity), Backend G2-G5 (explicit operations and transactions), Security F5/F13 (untrusted agent input and auditable human approval).
- Current-state commands: `git status -sb`; CRM package tests/build; live setup status; people/candidate counts; validator views; registry validation/index gates.
- Current state: 67 CRM people and 351 unpromoted candidates after the first approved batch. The queue mixes humans, aliases, shared mailboxes, marketing, notifications, automated systems, and unknown addresses. Domain-level decisions cannot safely classify individual addresses.
- Existing-work boundary: preserve unrelated OpenCounter edits, the prior contact-sweep record, generated-index work, and the checksum-identical applied `0001`/`0002` migrations. Use a new ordered migration only.
- Risks and invariants: exact normalized email remains the identity key; classification never merges people or promotes a contact; organization/domain and address kind are separate facts; user-confirmed aliases require an explicit existing person ID; retries are idempotent; raw email-derived input is untrusted.
- Exit criteria: baseline, mutation authority, interfaces, failure behavior, and verification entrypoints are recorded.

## Phase 1: Scope Lock

- In scope: promote the exact people named in the preceding approval; attach the explicitly confirmed Asilah Howell, Vince Terry, Rufael Berhanu, and Davette Shorter aliases when exact reviewed targets exist; add persisted address classifications and deterministic suggestions; expose controlled classify/filter tools; update tests, package metadata, docs, local workflow, install/index state, and live classifications for obvious non-person addresses.
- Non-goals: bulk-promoting every person-shaped address, assigning unverified titles, treating every recipient of a distribution email as a relationship, domain-wide suppression, fuzzy automatic merges, Gmail mutation, or refactoring the oversized CRM contract.
- Expected files touched: this checklist; `catalog/stacks/rudi-crm/sql/migrations/0004_contact_address_classification.sql`; CRM `src/{schemas.ts,contract.ts,index.ts}`; focused tests; package metadata/README; generated `index.json`; and `/Users/hoff/.codex/skills/rudi-crm/SKILL.md`.
- External inputs and trust boundaries: candidate email/name/domain/role evidence, agent classifications, existing-person IDs, category/reason/source arguments, database rows, and RUDI secrets are validated before use. No secret or message body enters source, logs, or classifications.
- Interface contract: categories are `person`, `shared_inbox`, `marketing`, `notification`, `automated`, and `unknown`. Manual classification overrides deterministic suggestion. Candidate listing exposes both suggestion and effective classification and supports bounded filtering without changing existing default pagination behavior.
- Failure behavior: malformed emails/categories fail closed; classification replay is idempotent; reclassification is explicit and audited; an alias collision stops rather than moving an address; partial independent promotions are read back and reported; classification never creates a person.
- Exit criteria: focused behavior tests fail for the missing schema/tool/migration before implementation.

## Phase 2: Red Tests

- Observable behavior to prove: schemas constrain categories and email; MCP exposes classification; a clean database applies `0004`; address classification upserts/replays/reclassifies; deterministic generic-mailbox suggestions do not classify a person solely from domain; candidate filters return the requested effective category; invalid inputs and alias collisions fail safely.
- Test files to add or edit: CRM contract-schema, MCP, package-contract/migration, and live-contact tests.
- Red command: build the unchanged package, then run the focused test name/file for each next behavior slice.
- Expected failure: missing schema export/tool/migration/function/view columns or behavior—not syntax, fixture, or environment failure.
- Exit criteria: each behavior has a recorded expected red failure before its smallest implementation.

## Phase 3: Implementation

- Implementation rules: additive `0004`; normalized email primary key; database check constraints; parameterized queries; bounded list filters; explicit audit context; stable JSON results; no raw SQL MCP; no dependency additions.
- Files allowed to change: only the Phase 1 files, plus generated build/index artifacts required by existing scripts.
- Validation and error-handling requirements: Zod validates tool ingress; database constraints defend persistence; exact-email collisions remain authoritative; unknown organization/title remains null rather than inferred.
- Observability requirements: classification returns created/updated/unchanged status, previous/current category, normalized email, source, and timestamp without exposing secrets or message content.
- Exit criteria: red tests pass with the smallest behavior-bearing changes.

## Phase 4: Green Tests And Refactor

- Green command: rerun every red command unchanged, followed by CRM package tests and live tests.
- Refactor constraints: refactor only while focused tests remain green; do not split unrelated contract code or alter applied migrations.
- Regression checks: promotion remains atomic/idempotent; existing candidate default behavior remains compatible; exact existing-email filtering and all eight validators remain green.
- Exit criteria: focused and regression suites pass after any cleanup.

## Phase 5: Full Verification

- Targeted tests: schema/contract, MCP, package contract, isolated migrations, and live address-classification/promotion behavior.
- Full suite: CRM `npm test` with live database enabled; registry `npm test` and required validation gates.
- Build/typecheck/lint: CRM build; registry validate/build; index sync/check; catalog clean check; package dry-run.
- JS/TS debt scan: architecture-aware scan scoped to edited CRM TypeScript files; blocking errors fixed, other findings recorded.
- Live smoke checks: apply `0004`; install canonical stack; verify tool count and schemas; classify/reclassify a transaction-wrapped synthetic address; classify approved real data; confirm people/candidate counts and validators; force RUDI reindex.
- Exit criteria: all applicable gates pass or a precise pre-existing/out-of-scope exception is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: CRM README, manifest/tool descriptions, local CRM skill classification workflow, this execution record, and generated registry index.
- Final files touched: record exact files after verification.
- Commands run and results: record red/green, full tests, build, indexes, pack, debt scan, migration, install/reindex, and live smoke evidence.
- Accepted debt: record only verified out-of-scope findings, including the pre-existing contract-size warning if it remains.
- Definition of Done: confirmed people and aliases are promoted and read back; address classification is additive, controlled, tested, installed, and documented; obvious non-person addresses are categorized without suppressing people at the same domain; validators remain green.

## Execution Record

- Status: complete on 2026-08-04 ET.
- Red/green evidence:
  - Schema slice: the focused contract test failed because `ClassifyContactAddressInput` was not exported, then passed unchanged after the constrained category/source/email schemas were added.
  - MCP slice: the live contract test failed because `rudi_crm_classify_contact_address` was absent, then passed unchanged with the new tool and candidate-category filter schema.
  - Package slice: the package test failed because `0004_contact_address_classification.sql` did not exist, then passed after the additive migration was added.
  - Live behavior slice: the transaction-wrapped test failed because `suggested_address_category` was absent from the live candidate view, then passed unchanged after migration.
  - Clean-bootstrap verification first caught an invalid attempt to insert new columns into the middle of a PostgreSQL view contract. The columns were appended for backward compatibility; a clean database then applied and replayed all four migrations.
- Live promotions/classifications:
  - Created 12 approved people: Asilah Howell, Richard Tracchio, Vince Terry, Eboni Williams, David Rice, Kyle Gibbs, Christina Bange, Korri Jackson, Terez Hubble-Brownfield, Jeff Chamot, Antony Seppi, and Tracey Ward.
  - Attached four reviewed aliases: Asilah Howell's Avanade address, Vince Terry's AOL address, Rufael Berhanu's `refed.org` address, and Davette Shorter's Gmail address.
  - Read-back and validation confirmed 79 CRM people and 335 remaining candidates.
  - Persisted 31 user-confirmed person-address classifications and 28 user-confirmed non-person classifications. The remaining queue currently filters to 15 shared inboxes, 4 marketing addresses, 11 notifications, 4 automated addresses, and 301 unknown addresses; counts include six additional conservative heuristic suggestions.
  - `info@cintrifuse.com` is `shared_inbox` while `evan@cintrifuse.com` remains a person identity, proving mailbox category is independent of domain/organization.
- Verification:
  - CRM: 18 tests passed, including live classification/promotion/finance behavior and a clean idempotent bootstrap; build passed.
  - Registry: 18 files / 157 tests passed; 149-package validation and build passed; indexes synced and checked.
  - Package: dry run contained 943 entries, included `0004`, and was approximately 2.18 MB.
  - Installed stack: version 0.4.0, 20 tools, all four migration checksums current, setup healthy, 79 people, 335 candidates, category-filtered reads correct, classification replay `unchanged`, and all eight validators green.
  - Router: forced reindex succeeded for `stack:rudi-crm` with 20 tools and no error. The local launch remains pinned to `/opt/homebrew/bin/node dist/index.js` because the bundled RUDI Node/npm wrappers are self-referencing on this machine.
  - Integrity: canonical and installed `0004` SHA-256 are both `1e41c3c291cb813cfdf08719521a2e5620496ca513d6747d213c4c5003c7dd38`. `git diff --check` is clean outside the checksum-preserving final blank lines in applied `0001`/`0002`.
- Files changed:
  - `catalog/stacks/rudi-crm/sql/migrations/0004_contact_address_classification.sql`
  - `catalog/stacks/rudi-crm/src/{schemas.ts,contract.ts,index.ts}`
  - `catalog/stacks/rudi-crm/tests/{contract.test.mjs,mcp.test.mjs,package-contract.test.mjs,migrate.test.mjs,live-contacts.test.mjs}`
  - `catalog/stacks/rudi-crm/{README.md,manifest.json,package.json,package-lock.json}`
  - generated registry `index.json`, this checklist, and `/Users/hoff/.codex/skills/rudi-crm/SKILL.md`
- Accepted debt/exceptions:
  - Structural debt scan reported zero findings. The pre-existing oversized `src/contract.ts` warning remains (1,275 lines versus the 800-line advisory); splitting it is separate scope.
  - The CRM catalog subtree is clean. The repository-wide clean check reports only `catalog/stacks/opencounter/node_modules`, which belongs to unrelated in-progress OpenCounter work and was deliberately preserved.
  - CRM `dist` and `node_modules` were moved recoverably to `/tmp/rudi-crm-clean.OdZSVm` for the catalog-clean proof; no source or CRM data was removed.

## 2026-08-19 Follower Publication Recovery

- Recovery base: green Registry PR #31 (`fix/25-gmail-header-tools`). Exact follower state remains preserved at checkpoint `635989a7d941271450c92f5ead292ab139fd0fdc`.
- Reconstructed red: the recovered `tests/contract.test.mjs` run against the unchanged base failed because `ClassifyContactAddressInput` was not exported from `dist/schemas.js`.
- Green: the recovered package built successfully and its default suite passed 14 tests with five explicitly gated live/bootstrap tests skipped.
- Architecture red/green: the first changed-stack verification failed because `src/contract.ts` grew from the 1,179-line baseline to 1,292 lines. Contact/discovery database operations were moved behind `createContactContract` in the focused `src/contact-contract.ts` module; the main contract is now 1,162 lines, the new module is 160 lines, the unchanged package tests remain green, and the changed-stack verifier passes.
- Historical migration boundary: follower-only trailing blank-line restorations for already-applied `0001` and `0002` were excluded from this publication. Current `main` intentionally changed those bytes in `382de3d`; silently changing them again would violate migration immutability. The two variants and their hashes are recorded in issue #32, and the exact follower bytes remain in checkpoint `635989a`.
- Live proof: the 2026-08-04 transaction-wrapped and installed-stack evidence above remains the authoritative live execution record for the recovered implementation. This publication pass does not repeat CRM mutations because no database URL is present in the isolated worktree and no new live write was authorized.
