# Canonical Unversioned Catalog Cleanup

## Phase 0: Baseline And Manual Lookup

- Scope: remove version suffixes/directories and obsolete compatibility artifacts so the registry has one canonical v2 contract at clean, unversioned paths; archive or remove confirmed junk and superseded material.
- Files to inspect before editing: catalog discovery/compiler/sync/compatibility code and tests, all canonical and generated manifests, root indexes, package/release configuration, registry/CLI documentation, old CLI registry download behavior, and ignored cleanup candidates.
- Relevant SWE manual sections: API Standard E2, E4, E9, and E10; Infrastructure Standard packaging, reproducibility, deployment, and rollback guidance; Master Doctrine Appendix C.
- Current-state commands: package-object inventory and hash; v1/v2 package coverage; `git status --short`; `npm test`; `npm run build`; catalog size/artifact inventory; old-client source-path trace.
- Risks and invariants: preserve all unrelated dirty-worktree changes; do not change any of the 97 package objects, IDs, dependencies, tool lists, checksums, or stack source; preserve readability of existing installed manifests; do not delete the ignored video intake file until it has been archived outside the repository.
- Exit criteria: the pre-migration normalized package snapshot is saved outside the repository, all destructive targets are exact, and compatibility impact is explicit.

## Phase 1: Scope Lock

- In scope: make root `index.json` the v2 index; make stack `manifest.json` and unversioned agent/binary/runtime JSON canonical v2 source; remove `index.v2.json`, `manifest.v2.json`, `/v2/` metadata directories, generated v1 metadata, remote v1 fallback, legacy projection code, completed migration code, stale generated code, Finder metadata, and superseded root documentation; archive the ignored video and historical documents.
- Non-goals: stack source/features, MCP tools, schema semantics, package versions, secrets, installed user state, unrelated CLI commands, or dependency changes.
- Expected files touched: registry catalog metadata paths; `src/catalog.ts`, `src/compile.ts`, `src/index-sync.ts`, `src/catalog-artifacts.ts`, relevant tests/scripts/docs/configuration; focused CLI registry-client source/tests/docs and generated bundle.
- External inputs and trust boundaries: catalog JSON/Markdown, remote registry JSON, installed manifests, downloaded archives, and the filesystem archive target.
- Failure behavior to define: registry discovery rejects legacy/version-suffixed source; root index must be schema v2; current CLI rejects remote v1 indexes clearly; archive copy must be byte-verified before source removal.
- Exit criteria: one canonical unversioned path per package type and one root v2 index are documented before moving files.

## Phase 2: Red Tests

- Observable behavior to prove: catalog discovery loads only clean unversioned canonical manifests; generated root index is v2 and current; version-suffixed catalog metadata is forbidden; CLI defaults to root `index.json`, loads canonical stack `manifest.json`, and rejects a remote v1 index without fallback; normalized package snapshots are identical before/after.
- Test files to add or edit: focused registry catalog/compiler/index-sync tests and registry-client contract/index/manifest/download tests.
- Red command: run the smallest affected test file after changing its expectation and before implementation.
- Expected failure: current discovery/default URLs still require `manifest.v2.json`, `/v2/`, and `index.v2.json`; compatibility generator still emits v1.
- Exit criteria: each behavior-bearing slice has an observed expected red failure.

## Phase 3: Implementation

- Implementation rules: mechanical moves first; compiler/discovery boundary second; CLI consumer third; no schema or package payload edits; use exact file lists and preserve unrelated changes.
- Files allowed to change: Phase 1 scope only.
- Validation and error-handling requirements: validate schema version, canonical IDs, one source per ID, clean path rules, snapshot equivalence, archive checksum, and absence of legacy/versioned paths.
- Observability requirements: compiler/sync report the canonical package count; CLI errors identify unsupported registry schema without silently downgrading.
- Exit criteria: unchanged red commands pass with one unversioned source layout.

## Phase 4: Green Tests And Refactor

- Green command: rerun all Phase 2 commands unchanged.
- Refactor constraints: delete compatibility code only after clean-layout tests pass; do not weaken installed-manifest compatibility.
- Regression checks: registry catalog/compiler/schema/readiness tests and CLI registry-client/core tests.
- Exit criteria: focused tests are green and pre/post normalized package snapshots are byte-equivalent.

## Phase 5: Full Verification

- Targeted tests: catalog, compiler, sync, schema, public readiness, registry-client, resolver, installer, and installed-manifest behavior.
- Full suite: registry `npm test`; CLI `npm test`.
- Build/typecheck/lint: registry and CLI production builds, root-index drift check, package dry run, and CLI version smoke.
- JS/TS debt scan: run the registry fallback scanner and CLI repo policy runner over edited code.
- Live smoke checks: isolated local-registry search/install for representative stack, runtime, binary, flat skill, and bundled skill using the clean layout; no real user RUDI home mutation.
- Exit criteria: all checks pass or an explicit residual gap is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: root/stack contributor docs, schema paths, agent instructions, migration records, and compatibility policy.
- Final files touched: record at closure.
- Commands run and results: record red/green, snapshot equivalence, cleanup/archive checksums and sizes, tests, builds, validators, pack audit, debt scans, and smoke tests.
- Accepted debt: existing installed v1 manifest readability only; no remote v1 registry layout or generated catalog duplication.
- Definition of Done: one unversioned canonical v2 source per package, one root v2 index, zero `/v2/` metadata directories or `manifest.v2.json` files, archived valuable runtime data, removed reproducible junk, unchanged package semantics, current CLI verified end to end, and docs matching reality.

## Execution Record

- Status: complete on 2026-08-01.
- Baseline and rollback:
  - Saved the normalized 97-package baseline and layout backups under
    `/tmp/rudi-registry-layout-cleanup.hmV3j4` before destructive work.
  - Baseline package hash:
    `479f615c6aa9a85982621ae67ad37b46dc7afbf659893fab57926949207de279`.
  - All 97 baseline package objects are unchanged after migration. The final
    index contains 99 packages because the concurrent canonical additions
    `binary:pdftotext` and `stack:municode` were preserved.
- Red/green record:
  - Registry red: `npx vitest run src/catalog.test.ts src/index-sync.test.ts`
    failed because discovery required version-suffixed metadata and sync wrote
    compatibility output.
  - Registry green: the same focused tests passed after canonical discovery and
    root-index sync were implemented.
  - Public-readiness red: the new schema-v2 root-index fixture reported zero
    references; it passed after keyed package references and canonical source
    paths were implemented.
- Cleanup performed:
  - Migrated 42 stack manifests, 4 agent manifests, 26 binary manifests, 5
    runtime manifests, and the root index to their unversioned canonical paths.
  - Removed legacy projection/migration code and scripts:
    `src/legacy-compat.ts`, `src/legacy-compat.test.ts`, `src/migrate.ts`,
    `scripts/build-tarballs.sh`, and `scripts/update-manifests.sh`.
  - Removed 21 Finder metadata files, 16 stale ignored stack `dist` outputs, and
    `dist/index.legacy.json` (38 reproducible files; 310,019 bytes).
  - Archived the ignored 202,344,376-byte video at
    `$RUDI_HOME/archive/registry/2026-08-01/video-editor/intake-2026-06-05-3ed1a4fa/working.mp4`, verified SHA-256
    `f02e471d74747b4769b010cb9a808b73d1405978a864fbed8b22589188e5c473`,
    then removed the source copy.
  - Moved superseded root documents into `docs/archive/`, the active skills
    checklist into `docs/roadmaps/`, and the unsupported workflow draft into
    `docs/proposals/`; removed `catalog/workflows` from the publish/readiness
    contract.
  - Final catalog size is 7,932 KiB, down from 205,932 KiB before cleanup.
- Contract and implementation:
  - `index.json` is the only root index and requires schema version 2.
  - Stack `manifest.json` and unversioned agent/binary/runtime JSON are the only
    package metadata sources. Discovery rejects version-suffixed metadata.
  - Compiler, sync, release workflow, documentation, contributor instructions,
    package allowlist, and stack contract tests now use the canonical layout.
  - Remote v1 registry compatibility is intentionally removed. Existing local
    installed-manifest readability remains a CLI boundary.
- Verification:
  - `npm test`: 118 passed; one optional live social-media test skipped.
  - Content-extractor contract: 5 passed.
  - `npm run indexes:sync`, `npm run indexes:check`,
    `npm run catalog:clean:check`, and `npm run build`: passed for 99 packages.
  - Worktree-inclusive public readiness: 0 errors, 0 warnings, 99 referenced.
  - `npm pack --dry-run --json`: 644 files, 6,592,581 unpacked bytes, zero
    obsolete metadata/workflow paths.
  - Structural debt scan over edited registry source: 0 findings.
  - Filesystem audit: zero `/v2/` metadata directories, `manifest.v2.json`
    files, or root `index.v2.json`.
- Known gaps: no live GitHub release/download was performed; the skipped
  provider-dependent social-media test remains optional. Verification used an
  isolated RUDI home and did not mutate installed user state.
