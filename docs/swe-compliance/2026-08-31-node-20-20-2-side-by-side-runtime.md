# Node.js 20.20.2 Side-by-Side Runtime Delivery

Status: Registry local engineering and independent review gates passed

## Phase 0: Baseline And Manual Lookup

- Scope: add and deliver a distinct Registry package for a RUDI-managed Node.js
  20.20.2 runtime, preserving the existing `runtime:node` 20.10.0 package and
  install root, then use the new exact runtime identity as the basis for the
  separately verified Managed AI Gate 4 delivery chain.
- Governing preparation evidence:
  `/Users/admin/.rudi/organizations/learnrudi/artifacts/task-contracts/managed-ai-gate4a-runtime-rebaseline-candidate13-intake-preparation-20260831`.
- User authorization: on 2026-08-31 the user directed the lead engineer to loop
  through the previously enumerated controlled gates to end-to-end completion.
  The sequence remains fail-closed and evidence-gated; retained evidence and
  unrelated user work are never cleanup targets.
- Files inspected before editing: global and Registry `AGENTS.md`, the existing
  Node runtime manifest, runtime catalog tests, schemas/compiler/index workflow,
  CLI runtime path and verified-download behavior, the sealed preparation
  package, and current Registry/Compute/Cloud/Service Desk Git and runtime state.
- Relevant SWE manual sections: Engineering Operating Manual Index,
  Engineering Quick Reference, Infrastructure And Deployment Engineering
  Standard, Agent Co-Pilot Operating Standard, and Horizontal Engineering And
  Codebase Stewardship Standard.
- Current-state commands: `git status -sb`, `git rev-parse`, `git worktree list
  --porcelain`, `git ls-remote origin refs/heads/main`, bounded `rg`, direct
  source inspection, and official Node release checksum readback.
- Baseline: clean isolated worktree
  `/Users/admin/RUDI/worktrees/registry/node-20-20-2-side-by-side-20260831` on
  `codex/node-20-20-2-side-by-side-20260831`, based on `origin/main`
  `2fd559a7d8308a854838a24f0e2b60e0af93f2d0`.
- Horizontal-pattern scan: Registry owns portable runtime archive provenance;
  CLI owns deterministic ID-to-install-root mapping and verified extraction;
  Service Desk owns build/native-addon provenance; Cloud owns execution-time
  absolute-path/hash validation; Compute owns service bindings. The disposition
  is `standardize contract`, not consolidate implementation. Machine paths are
  deployment provenance, not portable Registry constraints.
- Risks and invariants:
  - `/Users/admin/.rudi/runtimes/node` remains Node.js 20.10.0 and unchanged;
  - `runtime:node` remains the generic shared identity and is not replaced;
  - the new identity is `runtime:node-20-20-2`, resolving to the distinct
    install root `/Users/admin/.rudi/runtimes/node-20-20-2`;
  - official archive hashes are not installed-binary or header hashes;
  - generated `index.json` is changed only by `npm run indexes:sync`;
  - source, publication, install, artifact, Compute, and activation identities
    remain independently observable even under the end-to-end authorization;
  - all five user-owned Compute editorial TOML modifications remain untouched;
  - any identity mismatch stops later gates without substitution or cleanup.
- Initial risk tier: High. The Registry source change is reversible and narrow,
  but it begins an authorized runtime/deployment chain with native artifacts and
  service activation risk.
- Exit criteria: clean isolation, exact base/instructions/authority recorded,
  portable archive contract verified, rollback and later-gate blockers explicit.

## Phase 1: Scope Lock

- In scope:
  - add `runtime:node-20-20-2` with the four platform archives already supported
    by `runtime:node`;
  - add a focused contract that proves the side-by-side identity, exact release
    checksums, extraction layout, executable map, and preservation of
    `runtime:node` 20.10.0;
  - regenerate and verify Registry outputs;
  - run focused/full tests, build, package, debt, and independent review gates;
  - publish through a feature branch and merge only after green checks;
  - perform exact public-index readback before any installation.
- Non-goals for this Registry slice: change CLI production code or shims;
  overwrite any installed runtime; build Service Desk/Cloud; edit Compute;
  activate a service; migrate data; modify credentials; or clean retained
  evidence/worktrees.
- Expected files touched:
  - `catalog/runtimes/node-20-20-2.json`;
  - `src/runtime-catalog-contract.test.ts`;
  - generator-owned `index.json` and `dist/**` outputs if the generator updates
    tracked release artifacts;
  - this compliance record.
- External inputs and trust boundaries: Node's official SHASUMS, Git refs,
  Registry source/index output, downloaded archives, GitHub checks, public raw
  index, CLI install readback, runtime filesystem bytes, and reviewer output.
- Failure behavior: wrong/missing catalog identity, checksum, URL, extraction,
  bin path, generated index, test, build, review, CI, or public readback stops
  publication/install; a destination collision or runtime mismatch stops and
  preserves evidence without touching the shared runtime.
- Authorized external actions: the user's end-to-end clearance covers the
  previously enumerated feature-branch commit, push, PR, green merge, Registry
  publication, distinct runtime installation, immutable artifact rebuild,
  disabled Compute install/smoke, and bounded activation/E2E validation. Direct
  pushes to main, destructive cleanup, credential disclosure, database writes,
  or overwriting retained/user-owned state remain out of scope.
- Commit strategy: one green Registry behavior commit containing the focused
  test, runtime source, generated outputs, and contemporaneous compliance
  evidence; a later evidence-only commit may record review/publication results
  if required. Stage only task-owned paths and inspect the staged diff.
- Horizontal obligation: resolve now by standardizing the exact runtime identity
  contract across the later evidence chain. No shared library or broad runtime
  refactor is introduced.
- Review gates: red/green proof, full Registry gates, debt scan, diff/secret
  review, fresh independent read-only review, GitHub checks, merged-main/public
  readback, isolated install/reproducibility, and worktree closeout.
- Exit criteria: only locked paths are modified and every later effect consumes
  exact evidence from the immediately preceding gate.

## Phase 2: Red Tests

- Observable behavior: Registry exposes a distinct Node.js 20.20.2 runtime with
  exact official archive provenance for all four supported platforms while the
  shared `runtime:node` remains version 20.10.0.
- Test file: `src/runtime-catalog-contract.test.ts`.
- Red command: `npx vitest run src/runtime-catalog-contract.test.ts`.
- Expected failure: the new canonical runtime manifest does not exist.
- Observed result: 1/2 tests failed exactly because
  `catalog/runtimes/node-20-20-2.json` was absent (`ENOENT`); the existing
  Python runtime contract passed and the test environment/imports succeeded.
- Exit criteria: the focused test fails for the absent side-by-side package, not
  for setup, import, dependency, or environment failure.

## Phase 3: Implementation

- Implementation rules: add one portable catalog source using official release
  archive URLs/checksums and the established Node extraction/bin contract; do
  not change the shared Node manifest or generic CLI behavior.
- Files allowed to change: the paths locked in Phase 1 only.
- Boundary validation: schema validation, checksum format, exact version/ID,
  four platform keys, `strip: 1`, and required `node`/`npm`/`npx` paths.
- Failure behavior: all invalid or incomplete manifest states fail generation or
  the focused contract before publication.
- Observability: record source/index hashes, tests, build/package results, Git
  lineage, public readback, installed runtime identity, and later handoff hashes.
- Implemented: one new catalog source with official Node v20.20.2 archive
  checksums for Darwin arm64/x64 and Linux arm64/x64, the existing single-root
  extraction contract, and the standard `node`/`npm`/`npx` executable map. The
  shared `catalog/runtimes/node.json` remains byte-unchanged.
- Exit criteria: unchanged focused red command passes without weakening tests.

## Phase 4: Green Tests And Refactor

- Green command: rerun `npx vitest run src/runtime-catalog-contract.test.ts`.
- Refactor constraints: no schema change, dependency update, CLI edit, alias,
  shim, fallback, or unrelated cleanup.
- Regression checks: runtime contract, schema/compiler/index tests, and
  `git diff --check`.
- Commit checkpoint: only after all Phase 5 local gates and independent review.
- Observed result: the unchanged command passed 2/2. The focused catalog,
  schema, and index regression run passed 42/42. No refactor was required.
- Exit criteria: focused behavior and generated output are green.

## Phase 5: Full Verification

- Targeted tests: runtime catalog contract plus catalog/schema/index tests.
- Full suite: `npm test`.
- Build and catalog gates: `npm run validate`, `npm run indexes:sync`, `npm run
  indexes:check`, `npm run catalog:clean:check`, `npm run build`, `npm run
  release:verify`, and `npm pack --dry-run --json`.
- JS/TS debt: RUDI `swe_debt_scan` on the edited TypeScript test and repository
  `npm run debt:scan`.
- Live proof after publication: public-index resolution, isolated side-by-side
  install, exact archive/binary/header/npm/root identity capture, independent
  second extraction or install reproduction, and proof the shared runtime hash
  remains unchanged.
- Independent review: fresh read-only review of instructions, task contract,
  diff, tests, generated output, provenance, rollback, and no-overwrite behavior.
- Risk approval: the user's end-to-end clearance is recorded; failures remain
  fail-closed rather than repaired live.
- Results:
  - focused red: 1 expected failure and 1 pass;
  - focused green: 2/2 pass;
  - targeted catalog/schema/index tests: 42/42 pass;
  - full Registry suite: 29 files and 256/256 tests pass;
  - `npm run validate`: 160/160 packages pass;
  - `npm run indexes:sync` and `npm run indexes:check`: 160 packages, six
    runtimes, 845 catalog files, generated root `f7f91a20606e193e...`;
  - `npm run catalog:clean:check`: zero planned targets;
  - `npm run build` and `npm run release:verify`: pass, including seven release
    artifact hashes;
  - `npm pack --dry-run --json`: 1,020 entries and
    `catalog/runtimes/node-20-20-2.json` is included;
  - RUDI edited-file and repository debt scans: zero findings;
  - `npm run validate:public`: zero errors and zero warnings after staging only
    the four task-owned paths;
  - `git diff --check`: pass;
  - dependency install reported eight findings on the unchanged lockfile (one
    moderate, six high, one critical). No dependency source changed and no
    audit fix was attempted; this is disclosed pre-existing debt.
- Exit criteria: all required checks pass with no unresolved blocking finding.

## Phase 6: Docs, Contracts, And Closure

- Docs/contracts: this compliance record and the new canonical runtime manifest;
  no unrelated documentation.
- Final files touched: `catalog/runtimes/node-20-20-2.json`,
  `src/runtime-catalog-contract.test.ts`, generated `index.json`, and this
  compliance record.
- Commands/results: pending.
- Evidence artifacts: commit/PR/merge/public readback, exact runtime observation,
  immutable Managed AI handoff, Compute change, disabled/E2E receipts, and
  non-mutating worktree closeouts.
- Independent-review result: fresh read-only PASS with no P0, P1, or P2
  findings. The reviewer verified live GitHub/base lineage, all official Node
  release checksums, exact catalog/index parity, generated output, shared Node
  source preservation, distinct CLI install-root behavior, and absence of
  secrets or machine paths. An informational test-hardening suggestion was
  accepted by asserting the exact four-platform key set; the final delta is
  independently confirmed safe to commit with no new P0, P1, or P2 findings.
- Commit/publication status: not yet committed, pushed, reviewed, or published.
- Horizontal obligations: runtime identity standardization open until the full
  exact-hash artifact-to-executing-byte chain passes.
- Final verdict: active.
- Accepted debt: unchanged dependency-audit findings disclosed above; none
  introduced or accepted by the runtime catalog change.
- Proof gaps: independent review, commit, GitHub checks/merge/public readback,
  runtime install/reproduction, artifact rebuild/handoff, Compute delivery,
  E2E proof, peer alignment, and closeout remain pending.
- Definition of Done: public Registry identity is verified; distinct runtime is
  reproducibly installed; exact pinned artifacts are rebuilt/revalidated and
  reviewed; accepted Compute bindings are published and installed disabled;
  bounded smoke/E2E and rollback pass without external side effects; required
  peers are aligned; evidence and worktree closeouts are durable.
