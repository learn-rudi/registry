# Registry v2 Canonical Migration

## Phase 0: Baseline And Manual Lookup

- Scope: remove hand-maintained v1/v2 registry drift, make v2 the canonical package contract, preserve supported CLI behavior during migration, and remove generated/runtime clutter from the public catalog safely.
- Files to inspect before editing: `index.json`, `schemas/package.schema.json`, `src/catalog.ts`, `src/compile.ts`, `src/validate.ts`, `src/public-readiness.ts`, `src/migrate.ts`, catalog manifests, registry tests, and the CLI registry-client/core consumers.
- Relevant SWE manual sections: Master Doctrine Principle 15 and Appendix C7A; API Standard E4 and E10; Infrastructure Standard H1, H4, and H5; Build Order schema/API phase gates.
- Current-state commands: `git status -sb`; `npm run validate:v2`; `npm run validate:public -- --json`; catalog package-set comparison; catalog artifact and size inventory.
- Risks and invariants: both registry and CLI worktrees contain unrelated in-progress changes; no existing work may be reverted; current CLI releases must continue reading root `index.json` and legacy `manifest.json`; package IDs and install behavior must not drift; valuable run/output state must be relocated before deletion.
- Exit criteria: dirty-worktree overlap is recorded, all cleanup targets are classified, package-set drift is captured, and no destructive cleanup has occurred.

## Phase 1: Scope Lock

- In scope: canonical v2 discovery; generated v1 compatibility metadata; package-set and semantic drift checks; deterministic catalog artifacts; safe cleanup inventory/control; CLI dual-format normalization and fallback; documentation and deprecation contract.
- Non-goals: stack feature changes, MCP tool renames, secret rotation, unrelated stack refactors, or changing user-owned installed state.
- Expected files touched: focused registry compiler/catalog/compatibility modules and tests, package scripts, schema/docs, selected manifests needed to resolve proven drift, plus the CLI files listed in its companion plan.
- External inputs and trust boundaries: catalog JSON/Markdown, root index JSON, GitHub registry responses, downloaded archives, checksums, local registry paths, environment overrides, and installed manifests are untrusted until validated.
- Failure behavior to define: unsupported schema versions fail clearly; malformed indexes/manifests identify source and package; checksum mismatch leaves no partial install; v2 fetch failure may fall back to v1 only during the documented coexistence window; cleanup refuses tracked or unclassified targets.
- Exit criteria: one canonical v2 interface and one explicit v1 compatibility projection are documented before implementation.

## Phase 2: Red Tests

- Observable behavior to prove: v2 packages compile to a complete deterministic index; a generated v1 index preserves package coverage; compatibility projection preserves install-critical fields; semantic drift is detected; forbidden catalog artifacts are rejected; the CLI accepts both wire formats.
- Test files to add or edit: focused registry compatibility/hygiene tests, existing catalog/compiler tests, and the CLI registry-client/core tests named in the companion plan.
- Red command: run the smallest new test file for each next behavior before implementation.
- Expected failure: compatibility compiler, normalized v2 CLI contract, or cleanup guard does not yet exist.
- Exit criteria: every behavior-bearing slice has an observed expected red failure recorded below.

## Phase 3: Implementation

- Implementation rules: v2 is the only hand-maintained package metadata; compatibility output is generated; adapters live at system boundaries; no new dependency without explicit justification; source changes stay separate from local artifact cleanup.
- Files allowed to change: files locked in Phase 1 plus manifest entries with demonstrated parity defects.
- Validation and error-handling requirements: validate schema version, package IDs, paths, platform keys, checksums, duplicate IDs, references, and projection completeness; never silently drop packages or unsupported fields.
- Observability requirements: CLI diagnostics expose selected registry schema/source and fallback use without logging secrets; compilers report package counts and drift with package/file context.
- Exit criteria: unchanged red commands pass with the smallest implementation.

## Phase 4: Green Tests And Refactor

- Green command: rerun each Phase 2 command unchanged.
- Refactor constraints: centralize normalization/projection only after green; preserve public behavior and unrelated worktree changes.
- Regression checks: affected registry and CLI package tests after every refactor.
- Exit criteria: all focused suites remain green and compatibility output is deterministic.

## Phase 5: Full Verification

- Targeted tests: compatibility, catalog, compiler, schema, public-readiness, registry-client, resolver, installer, and manifest-loading tests.
- Full suite: registry `npm test`; CLI relevant workspace/full tests.
- Build/typecheck/lint: registry `npm run build`; CLI build; TypeScript/syntax checks where configured; `npm pack --dry-run --json` for registry publication contents.
- JS/TS debt scan, if applicable: run the nearest repo policy runner or the shared scanner on edited JS/TS neighborhoods.
- Live smoke checks: isolated local-registry search/install for one stack, binary, runtime, flat skill, and bundled skill; v1, v2, fallback, and checksum-failure paths; no real user `.rudi` mutation.
- Exit criteria: checks pass or a concrete residual gap is documented with risk and owner.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: `README.md`, `SCHEMA.md`, public cleanup checklist, contributor workflow, CLI registry documentation, migration guide, and deprecation/sunset policy.
- Final files touched: record at closure in both repositories.
- Commands run and results: record red, green, full tests, builds, validators, pack check, debt scans, smoke tests, artifact cleanup, and size delta.
- Accepted debt: only time-bounded v1 compatibility files during the published coexistence window; no unexplained semantic drift.
- Definition of Done: one hand-maintained v2 manifest per package; generated indexes/compatibility metadata; v2-default CLI with tested v1 fallback; clean catalog source; reproducible verified artifacts; accurate docs; and removal of legacy source naming after the supported-client window permits it.

## Execution Record

- Baseline: registry v2 validation passed 95 packages; root index contained 91 package IDs; public validation reported six untracked indexed paths in the current dirty worktree; catalog occupied approximately 2.6 GB locally and contained many ignored dependency/build/runtime directories.
- Dirty-worktree boundary: preserve all pre-existing changes present when this plan was created on 2026-08-01.
- Canonical contract: `manifest.v2.json`, v2 runtime/binary/agent JSON, and skill source files are now the only hand-maintained catalog metadata. `index.v2.json` is the generated canonical index. Root `index.json` and unversioned manifests are generated compatibility artifacts marked `schemaVersion: "1"` and `generatedFrom: "registry-v2"`.
- Package parity: migrated the two proven catalog orphans (`stack:sports-stats` and `binary:pdftoppm`). Final v1 and v2 indexes contain the same 97 canonical IDs: 4 agents, 26 binaries, 5 runtimes, 20 skills, and 42 stacks.
- Determinism: compiler timestamps use `SOURCE_DATE_EPOCH`, otherwise the current Git commit time, otherwise the Unix epoch. Consecutive compiler runs produce identical logical hashes. Generated v1 `lastUpdated` now equals v2 `generatedAt`; the final value was `2026-07-10T02:23:18.000Z`.
- Drift controls: added `indexes:sync` and `indexes:check`; sync verifies package coverage, updates both root indexes, and regenerates all v1 manifests from the v2 package objects. CI now rejects stale generated files.
- Cleanup controls: added a narrow catalog hygiene allowlist for reproducible dependency/build/cache directories and empty runtime-output directories. Cleanup refuses tracked paths and preserves non-empty runtime state. The dry-run gate now fails if cleanup candidates remain.
- Cleanup executed: removed 52 reproducible or empty catalog artifact directories, including a later reappearing stack-local `node_modules`; retained non-empty or unclassified content such as `catalog/stacks/opencounter/package-lock.json`. Catalog size fell from 2,760,440 KB to 205,932 KB, reclaiming 2,554,508 KB (approximately 2.44 GiB).
- Red/green slices observed:
  - legacy projection, index sync, and catalog hygiene tests initially failed because their modules/functions did not exist, then passed after the smallest implementations;
  - compiler compatibility-output and determinism tests initially failed for missing output and changing timestamps, then passed;
  - the final metadata test failed with legacy `lastUpdated=2025-12-24T00:00:00Z`, then passed after deriving it from v2 `generatedAt`;
  - the cleanup gate test initially failed because the dry-run assertion was absent, then passed after adding the refusal boundary.
- Final registry verification (2026-08-01):
  - `npm run build`: 97/97 packages validated; base, five platform, legacy, hash-tree, and release artifacts compiled successfully.
  - `npm test`: 16/16 files passed; 120 tests passed and one optional live social-media MCP test skipped because that stack's local dependencies are intentionally not installed. Its metadata tests passed.
  - `npm run indexes:check`: both root indexes and all generated legacy manifests are current; v1/v2 coverage is exactly equal.
  - `npm run catalog:clean:check`: zero cleanup targets remain.
  - worktree-inclusive public-readiness validation (`git ls-files --cached --others --exclude-standard`): zero errors, zero warnings, 97 referenced packages.
  - `npm pack --dry-run --json`: 717 files, 1,515,675 bytes packed, 6,797,905 bytes unpacked; includes `index.v2.json`, `index.json`, and `dist/index.legacy.json`; forbidden catalog artifact list is empty.
  - architecture-aware debt scan over the edited registry source with compiler/sync/hygiene/validator entrypoints: zero findings.
- Isolated end-to-end verification: the companion CLI successfully searched and installed a v2 catalog stack, system binary, flat skill with required stacks, bundled skill, and downloaded runtime without touching the real RUDI home. Runtime archives retained `bin/node` and `bin/npm`, and checksums were enforced.
- Documentation: updated `README.md`, `CONTRIBUTING.md`, `SCHEMA.md`, `MANIFEST_SCHEMA.md`, registry workflow checks, and both SWE migration records. V1 compatibility is documented through 2026-11-01; removal requires a supported-client review and a major release.
- Final implementation files: `src/legacy-compat.ts`, `src/index-sync.ts`, `src/catalog-hygiene.ts`, `src/compile.ts`, `src/catalog.ts`, `src/catalog-artifacts.ts`, their focused tests, package scripts, generated root indexes/manifests, `catalog/stacks/sports-stats/manifest.v2.json`, and `catalog/binaries/v2/pdftoppm.json`.
- Residual verification notes:
  - normal `npm run validate:public -- --json` still reports eight `index-path-untracked` errors in this dirty worktree because intended new package sources from concurrent user work are not staged. The worktree-inclusive readiness result proves the content is valid; the standard tracked-file gate will pass once those intended files are staged/committed.
  - standalone `npx tsc --noEmit` remains blocked by the repository's pre-existing typing setup (missing Node/Ajv declarations plus existing resolver typing errors). No dependency was added. The supported `tsx` build, validators, and test suite pass.
- Accepted temporary debt: generated v1 compatibility metadata only, bounded through 2026-11-01. No unexplained package or semantic drift remains.
