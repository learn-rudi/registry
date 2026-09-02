# Registry hosted-stack surface contract

Status: Phase 5 independent-review remediation; package release remains gated.

## Phase 0: Baseline And Manual Lookup

- Baseline: clean GitHub-main worktree at `c480d84`.
- Inspect: package schema, resolver/effective policy, compiler/index generator,
  schema tests, Registry docs, and candidate first-party stack manifests/code.
- Risk: High because an incorrect default can expose code in a credentialed
  internet-facing runtime.

## Phase 1: Scope Lock

- Add stack `surface` and tool override contracts with an exported resolver.
- Missing/unclassified always resolves `local-only`; a mixed stack's omitted
  tool also resolves `local-only`; overrides cannot name undeclared tools or
  elevate an explicitly local-only stack.
- Explicitly classify only the reviewed first-party SWE manual tools as the
  initial cloud-hosted slice; keep the filesystem/process debt scanner local.
- Add package exports needed by the statically pinned Cloud adapter.
- Non-goals: Dwellow edits, bulk-classifying the catalog, dynamic hosting,
  third-party approval, or signing-system invention.
- Commits/push/PR are authorized; npm package publication is a later release
  gate after merge/review.

## Phase 2: Red Tests

- Missing surface -> local-only; mixed omitted tool -> local-only; approved
  manual tools -> cloud-hosted; debt scan -> local-only; invalid overrides and
  undeclared names fail validation/effective policy.
- Independent review later supplied an additional red reproduction: the
  exported resolver returned `cloud-hosted` for prohibited overrides on both
  unclassified and explicit `local-only` stacks. Direct resolver regression
  cases now protect that boundary.

## Phase 3: Implementation

- Schema and runtime resolver must agree. Generated `index.json` changes only
  through `npm run indexes:sync`.

## Phase 4: Green Tests And Refactor

- Rerun focused schema/surface tests unchanged; inspect generated diff; keep
  contract and initial manifest/package export as reviewable slices.

## Phase 5: Full Verification

- `npm test`
- `npm run validate`
- `npm run indexes:sync`
- `npm run indexes:check`
- `npm run catalog:clean:check`
- `npm run build`
- `npm pack --dry-run --json`
- focused `swe_debt_scan`
- independent Standards/Spec/Proof review

Verified on 2026-09-01 after implementation:

- `npm test`: 281/281 passed after review remediation.
- `npm run build`: 167/167 manifests validated and compiled.
- `npm run indexes:sync` followed by `npm run indexes:check`: generated root
  index, platform indexes, catalog hash tree, and release metadata current.
- `npm run catalog:clean:check`: zero targets.
- `npm run stacks:verify -- --stack stack:swe-engineering`: 9/9 package tests
  passed after review remediation.
- root and nested `npm audit --omit=dev`: zero vulnerabilities after pinning
  `@modelcontextprotocol/sdk` 1.30.0 and its reviewed lock tree.
- nested `npm pack --dry-run`: 20 intended package files only; no tests,
  dependency directory, or generated runtime state.
- repository debt scan: zero findings; `git diff --check`: clean.
- Reverified review corrections: the exported resolver now owns
  no-elevation validation, hosted listing removes `manualRoot`, the hosted
  import slice excludes the local process scanner, and the package declares
  Node 20 to match its locked dependency floor.

## Phase 6: Docs, Contracts, And Closure

- Record generated sources, commands/results, commits/PR, package release
  status, accepted debt, and worktree closeout receipt.
- Current release status: not published. Merge and npm publication remain
  separate human-controlled gates; Cloud activation cannot proceed until the
  reviewed package commit and immutable release are available.
