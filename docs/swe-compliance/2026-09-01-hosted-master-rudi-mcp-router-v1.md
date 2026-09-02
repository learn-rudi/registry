# Registry hosted-stack surface contract

Status: Phase 5 package release and provenance verified; normal trusted
publisher configured and bootstrap credentials revoked.

## Phase 0: Baseline And Manual Lookup

- Baseline: clean GitHub-main worktree at `c480d84`.
- Inspect: package schema, resolver/effective policy, compiler/index generator,
  schema tests, Registry docs, and candidate first-party stack manifests/code.
- Risk: High because an incorrect default can expose code in a credentialed
  internet-facing runtime.
- First-package baseline: official npm metadata returned `E404` for
  `@learnrudi/swe-engineering-stack`; `learnrudi/registry` is public, so
  GitHub-hosted provenance is supported. The authenticated npm profile shows
  the `learnrudi` organization; exact owner/admin authority remained a human
  preflight gate rather than an inferred fact.
- Relevant manual controls: Appendix F CI/CD and secrets isolation, Appendix H
  artifact traceability, the agent red-green/review standard, and the
  human-runbook checkpoint contract.

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
- Add a package-specific, manual, main-only trusted-publishing workflow for
  `@learnrudi/swe-engineering-stack`; initial npm package creation, trust
  configuration, and publication remain later release gates.
- Prepare a separate one-time bootstrap workflow and human runbook because npm
  cannot configure trusted publishing before the package exists. Source-only
  workflow/runbook changes are authorized; npm login, scope or organization
  changes, GitHub environment/secret changes, workflow dispatch, and
  publication are not.
- Bootstrap risk tier: High. The workflow accepts one immutable public version
  and a short-lived release credential. Its invariant is exact repository,
  branch, accepted SHA, reviewed package tree, package name/version,
  authenticated absent registry state, protected environment, exact 20-file
  artifact digests, and provenance.
- Horizontal disposition: retain two explicit workflows. The normal path is
  tokenless OIDC for later releases; the bootstrap path is a one-time
  token-authenticated provenance exception. Their duplicated inline checks are
  security-reviewable and must not be generalized into a shared executable
  while either privileged job is active. Reassess after bootstrap credential
  revocation; no third semantic release path is accepted.

### 2026-09-02 npm namespace correction

- Scope lock: RUDI remains the product name and “Responsible Use of Digital
  Intelligence”; `learnrudi` is the controlled npm distribution organization.
  The package contract is therefore `@learnrudi/swe-engineering-stack@0.2.0`.
- This correction changes only the package identity and its coordinated
  Registry, Cloud, and System references. It does not authorize publication,
  workflow dispatch, token creation, deployment, or DNS changes.
- Red proof: `npm test -- src/swe-engineering-publish-workflow.test.ts` failed
  2/3 because the package and both release workflows still named the
  unavailable `@rudi` scope.
- The renamed 20-file package has reviewed tree
  `a20da20c28a138c8ab537c367fa98b380f16ece1`, integrity
  `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`,
  and shasum `5b6fd58434ed3ccead4770365c7efd58c33622f3`
  under the pinned GitHub bootstrap runtime.

## Phase 2: Red Tests

- Missing surface -> local-only; mixed omitted tool -> local-only; approved
  manual tools -> cloud-hosted; debt scan -> local-only; invalid overrides and
  undeclared names fail validation/effective policy.
- Independent review later supplied an additional red reproduction: the
  exported resolver returned `cloud-hosted` for prohibited overrides on both
  unclassified and explicit `local-only` stacks. Direct resolver regression
  cases now protect that boundary.
- Release-workflow contract red, Node `v20.20.2`:
  `npm test -- --run src/swe-engineering-publish-workflow.test.ts` -> one
  failed test because
  `.github/workflows/publish-swe-engineering-stack.yml` did not exist. The
  failure established the missing package publication path before
  implementation.
- Trusted-publishing runtime-helper red, Node `v20.20.2`: the same focused test
  failed to import `scripts/validate-publish-runtime.mjs` before the helper was
  added. Its behavior cases include the lower-major trap (`10.6.2`), both npm
  `11.5.1` boundary sides, later supported versions, and malformed input.
- Independent release-path review found that the helper accepted boundary
  prereleases such as `11.5.1-rc.1` as meeting the stable floor. Cross-repo
  review also exposed job-wide OIDC permission while install/tests executed.
  New contract cases for prerelease rejection, split permissions, a code-free
  publish job, and fresh same-SHA checkout all failed before remediation.
- Bootstrap-workflow red: `npm test --
  src/swe-engineering-publish-workflow.test.ts` ran three cases and failed only
  because `.github/workflows/bootstrap-swe-engineering-stack.yml` did not yet
  exist. The unchanged command passed 3/3 after implementation.
- Independent bootstrap review found that anonymous npm `E404` can conceal an
  existing private package and that mutable npm packaging behavior could change
  bytes after review. The strengthened unchanged contract failed 1/3 on the
  missing authenticated credential-step lookup before remediation; added
  digest assertions also require both jobs to match the reviewed integrity and
  shasum before any publication attempt.

## Phase 3: Implementation

- Schema and runtime resolver must agree. Generated `index.json` changes only
  through `npm run indexes:sync`.
- The package release path uses exact manual version input, immutable action
  pins, the npm trusted-publishing runtime floor, registry immutability checks,
  package-local install/test/audit, and an exact packed-file allowlist. It
  contains no npm token fallback.
- Verification and publication are separate jobs. The verification job has no
  OIDC permission and runs install, tests, audit, and a pack allowlist check.
  Only its dependent publish job receives `id-token: write`; that job uses a
  fresh same-SHA credential-free checkout, installs no dependencies, executes
  no repository helper or tests, repacks with lifecycle scripts disabled, and
  rechecks registry immutability plus the allowlist before publishing. The
  publish command pins `https://registry.npmjs.org` at command-line precedence.
- The separate bootstrap workflow is hard-coded to exact version `0.2.0` and
  reviewed package tree `a20da20c28a138c8ab537c367fa98b380f16ece1`.
  Its no-secret verification job validates repository/main/SHA/confirmation,
  requires the package name itself to be absent, runs install/test/audit, and
  checks the exact pack allowlist. Only the dependent `npm-bootstrap`
  environment job receives `id-token: write`; only its final publish step
  receives `NPM_BOOTSTRAP_TOKEN`. That job uses a fresh same-SHA checkout,
  executes no dependency or repository code, repacks with lifecycle scripts
  disabled, requires the exact reviewed integrity and shasum, repeats the
  identity/allowlist checks, and performs an authenticated package-name absence
  check immediately before publishing with `--provenance` and a
  command-line-pinned registry.
- The human runbook requires interactive npm identity and `@learnrudi`
  owner/admin proof, a main-only reviewed GitHub environment with the explicitly
  authorized solo self-review mode and admin bypass disabled, a shortest-lived
  `@learnrudi`-only package-write token with no
  organization permission, immediate pre-publish confirmation, cryptographic
  signature/provenance verification, trusted-publisher configuration, token
  removal/revocation, and fail-closed recovery. The authenticated browser
  operator later attested that npm identified `bzhoff` as the organization
  owner; that private control-plane claim is not independently reproducible
  without authenticated npm access.

## Phase 4: Green Tests And Refactor

- Rerun focused schema/surface tests unchanged; inspect generated diff; keep
  contract and initial manifest/package export as reviewable slices.
- Release-workflow contract green, Node `v20.20.2`: the exact red command now
  passes 3/3, including the normal trusted-publishing runtime/permission cases
  and the isolated bootstrap credential boundary. The bootstrap workflow YAML
  parses successfully and all 13 embedded run scripts pass `bash -n`.

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

Verified on 2026-09-01 and the 2026-09-02 bootstrap-source continuation:

- `npm test`: 284/284 passed after bootstrap-workflow contract coverage.
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
- Exact package workflow replay: `npm ci --ignore-scripts`, 9/9 package tests,
  and `npm audit --omit=dev --audit-level=moderate` all passed; the audit found
  zero vulnerabilities. The 20-file dry-run exactly matches the workflow
  allowlist.
- The exact replay also passed under clean Node `v24.20.0` with npm `11.6.2`.
  Stable npm `11.5.1` is accepted while its `alpha` and `rc` prereleases fail
  closed. The final permission contract proves the verification job lacks
  `id-token: write`, the publish job depends on verification, and the publish
  job contains no install, test, audit, or repository runtime-helper command.
- `npm run release:verify`, `npm run validate:public -- --json`,
  `npm run stacks:verify -- --changed-from origin/main --prepare`, repository
  debt scan, root pack, and `git diff --check` all passed. Both action
  references are immutable 40-character pins. `actionlint` was unavailable;
  YAML parsing and embedded-shell syntax checks are the local static proof.
- Regenerating indexes after the package metadata change produced no semantic
  index diff. Replaying the repository workflow's deterministic
  `SOURCE_DATE_EPOCH` check passed with the tracked timestamp, avoiding an
  unrelated timestamp-only change. The nested lockfile is byte-unchanged.
- repository debt scan: zero findings; `git diff --check`: clean.
- Bootstrap-source replay: the focused workflow contract passed 3/3; Ruby YAML
  parsing plus `bash -n` passed all 13 run blocks; `npm run validate` and
  `npm run build` passed 167/167; the deterministic
  `SOURCE_DATE_EPOCH=1788308464 npm run indexes:check` passed without semantic
  index drift; catalog hygiene, release provenance, public-readiness, and the
  nine-test SWE stack verification passed. The edited TypeScript debt scan
  reported zero findings.
- The first bootstrap attempt stopped safely before credential access because
  the local review runtime and the GitHub release runtime produced different
  compressed tarball bytes from the same package tree and exact 20-file
  allowlist. The bootstrap workflow now pins Node `24.19.0`; its observed
  GitHub pack has integrity
  `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`
  and shasum `5b6fd58434ed3ccead4770365c7efd58c33622f3`.
  A generated 45 MB nested `node_modules` verification artifact was moved
  intact to machine-local RUDI temporary storage rather than deleted without
  cleanup confirmation; the repository hygiene gate then passed with zero
  targets.
- Independent bootstrap-source review passed Standards, Spec, and Proof with
  no P0–P3 findings. The separately authorized live release then supplied the
  npm provenance and immutable artifact evidence recorded below; the normal
  OIDC workflow first applies to a later distinct version.
- Reverified review corrections: the exported resolver now owns
  no-elevation validation, hosted listing removes `manualRoot`, the hosted
  import slice excludes the local process scanner, and the package declares
  Node 20 to match its locked dependency floor.

## Phase 6: Docs, Contracts, And Closure

- Record generated sources, commands/results, commits/PR, package release
  status, accepted debt, and worktree closeout receipt.
- Human runbook:
  `docs/runbooks/npm-swe-engineering-stack-bootstrap.md`; executed and closed
  with immutable package, provenance, trusted-publisher, and revocation
  evidence.
- Registry main `4ce2d9b3daaab419e33a43f413011db66f02ea24` and package
  tree `a20da20c28a138c8ab537c367fa98b380f16ece1` published public
  `@learnrudi/swe-engineering-stack@0.2.0` in successful bootstrap run
  `33659462566`. The exact registry integrity is
  `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`
  and the shasum is `5b6fd58434ed3ccead4770365c7efd58c33622f3`.
- npm's attestation endpoint exposes both the npm publish predicate and SLSA
  provenance v1; the latter binds GitHub-hosted builder, repository
  `learnrudi/registry`, source commit `4ce2d9b`, bootstrap workflow, and run
  `33659462566`. Isolated signature audit reported 96 verified registry
  signatures, ten verified attestations, and no missing or invalid signatures.
  The compact public evidence receipt
  `docs/swe-compliance/2026-09-02-swe-engineering-stack-release-evidence.json`
  records the exact audit-result hash, public attestation-response hash,
  predicates, package subject, and public-ledger index.
- The authenticated npm UI was operator-attested as trusting GitHub Actions
  identity `learnrudi/registry`, workflow
  `publish-swe-engineering-stack.yml`, blank environment, and `npm publish`
  only. The normal workflow remains OIDC-only and has no token fallback; its
  first eligible use is a later distinct version. This npm package-security
  control is not exposed to unauthenticated independent readback.
- Absence of the one-time npm token `RUDI SWE stack bootstrap` was
  operator-attested from the authenticated npm token page. GitHub environment
  secret `npm-bootstrap/NPM_BOOTSTRAP_TOKEN` is independently absent. The
  protected environment and completed runs remain as audit evidence.
- Final package-release verdict is `pass`. Cloud PR #19 exact dependencies,
  lock integrity, Node 20 application proof, container scan/SBOM/provenance,
  disabled-route smoke, and independent review passed at exact head
  `a88f3945780cfc7afc59698d6eb36b15a741612d`; that head merged to Cloud
  `main` as `9fc89fb606f0ad53a7e944b84577b654f2577664`. Provider setup, migration,
  deployment, DNS, live smoke, and rollback remain separate gates.
