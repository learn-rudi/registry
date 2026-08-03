# Registry Control-Plane Consolidation

## Objective

Consolidate the RUDI registry into a thin, deterministic, policy-driven control
plane. The registry owns package contracts, discovery, validation, index
generation, publication policy, and provenance. Individual stacks own their
runtime behavior and verification. The CLI remains the installer and local
lifecycle consumer, and native agents continue to own normal execution.

This plan preserves the canonical schema-v2 layout: `index.json`, unversioned
catalog metadata, and `catalog/stacks/{id}/manifest.json`. It does not introduce
version-suffixed paths or parallel catalog trees.

## Phase 0: Baseline And Manual Lookup

- Scope: establish the current compiler, schema, catalog, CI, package-test,
  release, and documentation boundaries before changing behavior.
- Files to inspect before editing: `AGENTS.md`, `README.md`, `SCHEMA.md`,
  `SECURITY.md`, `schemas/package.schema.json`, `src/catalog.ts`,
  `src/resolver.ts`, `src/compile.ts`, `src/validate.ts`,
  `src/public-readiness.ts`, `src/catalog-hygiene.ts`, `vitest.config.ts`,
  `package.json`, `.github/workflows/registry.yml`, stack manifests and package
  scripts, existing ADRs, and prior SWE compliance records.
- Relevant SWE manual sections: Master Doctrine review dimensions and scoring
  rubric; Appendix C testing discipline and red-green-refactor; Security
  Standard F5, F7, and F8; Infrastructure Standard packaging, artifact
  integrity, CI/CD, and post-release verification; Build Order schema and phase
  gates.
- Current-state commands: `git status -sb`; catalog/package inventory; root and
  stack test-script inventory; `npm test`; `npm run validate`;
  `npm run validate:public -- --json`; `npm run indexes:check`;
  `npm run catalog:clean:check`; source/module size inventory; workflow and
  release inspection.
- Risks and invariants: the worktree contains substantial unrelated in-progress
  package work that must be preserved; canonical package IDs, install behavior,
  MCP tool names, and CLI compatibility must not drift; no real user `.rudi`
  state may be mutated by verification; catalog code and files are untrusted
  publication inputs; generated indexes must remain deterministic.
- Baseline evidence: the registry currently contains 101 packages, including 44
  stacks and 436 declared tools; root tests pass 124 tests with one optional
  skip; root Vitest only includes `src/**/*.test.ts`; stack-local suites are not
  part of that command; 20 of 35 stack `package.json` files define a test script;
  current CI validates and compiles but does not run `npm test`, the documented
  build gate, package dry-run, or a debt scan.
- Exit criteria: baseline and dirty-worktree boundaries are recorded; the
  implementation question backlog is explicit; no behavior-bearing code has
  changed.

## Phase 1: Scope Lock

- In scope:
  - mandatory GitHub CI for root tests, build, generated-index checks, public
    readiness, catalog hygiene, package dry-run, and architecture-aware JS/TS
    debt scanning;
  - a discoverable changed-stack verification contract for Node and Python
    stacks, followed by a full-catalog scheduled verification path;
  - explicit public package maturity, support, and deprecation semantics that
    the CLI can consume without guessing;
  - a generic registry kernel with package-specific behavior tests colocated
    with their packages or expressed as reusable catalog contracts;
  - a publication boundary that excludes retired legacy packages while
    preserving canonical unversioned paths for supported packages;
  - standard stack anatomy and debt policies for oversized MCP boundary modules;
  - a provenance design for immutable release artifacts and verifiable catalog
    roots.
- Non-goals:
  - no new stack capabilities or MCP tool renames;
  - no mass refactor of all 44 stacks in one change;
  - no immediate multi-repository split;
  - no replacement of the CLI installer or native agent execution;
  - no dependency additions without a separately justified need;
  - no version-suffixed manifest/index paths or `catalog/v2`/legacy catalog
    hierarchy.
- Expected files touched:
  - quality foundation: `.github/workflows/registry.yml`, `package.json`, a
    focused root verification/debt policy and tests, and contributor docs;
  - package contracts: `schemas/package.schema.json`, resolver/catalog types and
    tests, `SCHEMA.md`, an ADR, representative fixtures/manifests, and the CLI
    consumer only when the published contract is accepted;
  - kernel cleanup: package-specific root tests and their destination stack test
    suites, with no behavior changes;
  - stack decomposition: only one explicitly selected stack per follow-up plan.
- External inputs and trust boundaries: catalog JSON and Markdown, package
  scripts, stack source, generated indexes, downloaded artifacts, GitHub Actions
  inputs, dependency locks, environment variables, secrets declarations, and
  CLI-consumed registry responses.
- Failure behavior to define: CI fails closed on invalid/unverified public
  packages; changed-stack discovery cannot silently skip a changed official
  stack; unsupported verification layouts report package and reason;
  deprecated packages carry deterministic replacement/sunset behavior; release
  provenance failure prevents promotion without corrupting existing releases.
- Grill-with-docs decision backlog:
  1. What is the smallest durable per-stack verification contract that covers
     Node and Python without publishing arbitrary CI implementation detail?
  2. Which maturity/support/deprecation fields belong in the public schema, and
     which are repository-only policy?
  3. When does a legacy package leave the published catalog versus remain
     installable with a warning?
  4. Which package-specific root tests are true public registry contracts and
     which must move into stack-local suites?
  5. What provenance mechanism can be adopted incrementally without claiming
     guarantees the CLI does not yet verify?
- Exit criteria: repo-evident decisions are recorded in the smallest justified
  ADR/context docs; true product choices are asked one at a time; the first
  implementation slice has exact interfaces, files, tests, and rollback.

## Phase 2: Red Tests

- Observable behavior to prove, one slice at a time:
  - the quality workflow cannot omit root tests, build, index drift, public
    readiness, hygiene, package contents, or debt scanning;
  - changed official stacks are discovered deterministically and an unsupported
    or missing verification contract fails with package-scoped diagnostics;
  - maturity/deprecation metadata accepts the chosen valid states and rejects
    contradictory or incomplete combinations;
  - package-specific contract tests remain green after colocation and the root
    kernel suite contains no package-name knowledge;
  - publication artifacts carry the accepted provenance metadata and fail
    clearly when it is absent or inconsistent.
- Test files to add or edit: focused root tests for verification discovery and
  schema/policy behavior; invalid fixtures for contradictory metadata; affected
  stack-local behavior suites; deterministic release tests for provenance.
- Red command: record the smallest exact test command for each next behavior in
  the execution record before implementation.
- Expected failure: the next contract or gate is missing, permissive, or reports
  insufficient package context. A red result caused by unrelated dirty-worktree
  changes does not satisfy this phase.
- Exit criteria: each behavior-bearing slice has one observed, expected red
  failure before its implementation.

## Phase 3: Implementation

- Implementation rules: schema before consumer behavior; generic policy before
  package-specific exceptions; one concern per change; preserve canonical
  unversioned paths; keep the compiler incapable of importing or executing stack
  runtime code; avoid shell-string execution for verification; do not weaken a
  gate merely to accommodate an existing noncompliant package.
- Files allowed to change: only the files locked for the active slice in Phase 1.
  Any newly discovered cross-repository consumer change requires a checklist
  update before editing.
- Validation and error-handling requirements: validate unknown fields, enums,
  package IDs, path containment, verification discovery, deprecation
  replacement references, sunset format, deterministic ordering, and release
  metadata. Errors identify package ID and source path without exposing secrets.
- Observability requirements: CI and local verification output name the package,
  phase, command class, result, and actionable failure reason; generated release
  metadata remains traceable to a commit and catalog root.
- Exit criteria: the unchanged red command passes with the smallest
  implementation and no unrelated file changes.

## Phase 4: Green Tests And Refactor

- Green command: rerun each Phase 2 command unchanged and record the result.
- Refactor constraints: refactor only after green; preserve public package and
  CLI behavior; split helpers by responsibility rather than arbitrary line
  count; keep MCP entry points thin and domain logic local to stacks.
- Regression checks: affected schema, resolver, compiler, readiness, release,
  workflow, and stack-local tests after every refactor.
- Exit criteria: focused suites remain green, generated artifacts remain
  deterministic, and `git diff --check` passes.

## Phase 5: Full Verification

- Targeted tests: active-slice red/green command plus schema, catalog, resolver,
  compiler, public-readiness, hygiene, release, and affected stack suites.
- Full suite: registry root tests and the full discoverable official-stack suite;
  scheduled/live-provider tests remain separately classified and cannot silently
  replace deterministic verification.
- Build/typecheck/lint: `npm run build`; `npm run indexes:check`;
  `npm run catalog:clean:check`; `npm pack --dry-run --json`; language-specific
  syntax/type/build checks declared by affected stacks.
- JS/TS debt scan, if applicable: run the repository debt runner or targeted
  shared scanner on every edited JS/TS neighborhood; errors block closure,
  warnings are fixed when in scope or recorded as accepted debt.
- Live smoke checks: isolated MCP initialize/list-tools for representative Node
  and Python stacks; isolated local-registry CLI search/install for representative
  package tiers when the CLI contract changes; no real credentials or user state.
- Security/release checks: dependency audit appropriate to the lockfiles,
  secret-like file scan, artifact hash/provenance verification, and inspection of
  the exact package/release contents.
- Exit criteria: all required gates pass or a concrete, bounded residual gap is
  documented with impact and follow-up.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: `README.md`, `CONTRIBUTING.md`, `SCHEMA.md`,
  `SECURITY.md`, relevant ADRs, package-author verification guidance, lifecycle
  and deprecation policy, release/provenance runbook, and CLI documentation only
  for accepted public-contract changes.
- Final files touched: record per implementation slice and again at goal closure.
- Commands run and results: record every red, green, refactor, full-suite, build,
  index, hygiene, pack, debt, smoke, and provenance command.
- Accepted debt: must be explicit, bounded, owned, and incapable of weakening a
  stable/public package guarantee. Existing noncompliant packages receive a
  migration status; they do not receive silent permanent exemptions.
- Definition of Done:
  - mandatory CI enforces the documented root gates and changed-stack checks;
  - every supported public stack has a deterministic verification contract;
  - maturity and deprecation semantics are schema-validated and consumable by
    the CLI;
  - registry core contains only generic catalog behavior;
  - retired legacy packages are outside the publication boundary or governed by
    an explicit sunset contract;
  - selected oversized boundaries are decomposed under focused follow-up plans;
  - release integrity and provenance guarantees are documented, generated, and
    verified to the exact level implemented;
  - all verification passes and remaining debt is recorded.

## Execution Record

- 2026-08-02: goal created and baseline inspection completed without modifying
  existing user work. The worktree began dirty with concurrent agent catalog,
  speech-generation, city-provider, output-path, and stack changes.
- 2026-08-02: targeted manual guidance loaded from Appendix C, Security F5/F7/F8,
  infrastructure artifact/CI guidance, and build-order phase gates.
- 2026-08-02: repo-first grill-with-docs loop required because verification,
  maturity, deprecation, legacy publication, and provenance choices affect public
  contracts and cannot be safely collapsed into one implementation assumption.
- 2026-08-02: Grill questioner, answerer, and skeptic converged that stack
  verification must be language-neutral, non-interactive, offline, and
  stack-owned, while CI runner details remain registry-owned. The unresolved
  human choice is whether the executable verification entrypoint is a public
  manifest field or a repository-only publication convention; the recommended
  default is repository-only. No ADR was written before that decision.
- 2026-08-02 quality-foundation scope: `.github/workflows/registry.yml`,
  `package.json`, `.debt-scan.json`, `src/quality-gates.test.ts`, `README.md`,
  `CONTRIBUTING.md`, and this execution record. Existing catalog, resolver,
  schema, agent, city-provider, and generated-index changes remain user-owned.
- Red: `npx vitest run src/quality-gates.test.ts` failed because the registry
  workflow did not run `npm test` and lacked the other mandatory quality gates.
- Green: the unchanged command passed after CI gained explicit root test, build,
  public-readiness, index-drift, catalog-hygiene, debt-scan, and package-content
  steps. Workflow path filters now include the workflow, debt policy, scripts,
  lockfile, and Vitest configuration so quality-policy changes cannot bypass CI.
- Debt policy: `npm run debt:scan` executes the bundled deterministic SWE debt
  scanner against the registry kernel (`src`) with entrypoint reachability,
  orphan, shim, boundary, deprecated/canonical import, and large-file checks.
  Result: 20 files scanned and zero error, warning, or info findings.
- Full quality-foundation verification:
  - `npm test`: 18 files passed; 125 tests passed and one optional live test was
    skipped.
  - `npm run build`: 101 packages validated and base plus five platform indexes,
    catalog hashes, and release metadata compiled successfully.
  - `npm run catalog:clean`: removed exactly two reproducible Speech Generator
    Python cache directories; the follow-up dry-run found zero targets.
  - `npm run indexes:sync && npm run indexes:check`: refreshed only generated
    metadata after proving the root and compiled indexes contained identical 101
    package objects; the follow-up drift check passed.
  - `npm pack --dry-run --json`: passed with 670 entries, 1,533,214 packed bytes,
    and 6,827,156 unpacked bytes.
  - `npm run validate:public -- --json`: the implementation is valid but the
    current dirty worktree still has one deliberate gate failure: the concurrent
    `catalog/agents/antigravity.json` source is untracked while `index.json`
    references it. This plan does not stage or alter that user-owned work.
- 2026-08-02 stack-verification contract:
  - Red/green slices: `npx vitest run src/stack-verification.test.ts` proved
    Node `scripts.verify`, Python `verify.py`, package-scoped missing-contract
    errors, deterministic changed-stack selection, argv-only execution,
    locked Node preparation, isolated Python preparation, and secret-free
    child environments one behavior at a time. `src/verify-stacks.test.ts`
    similarly proved explicit CLI selection modes.
  - `npm run stacks:verify -- --all --json` established the migration baseline:
    all 44 stacks initially lacked the new contract. This is an explicit audit,
    not a silent exemption list.
  - CI now runs changed-stack verification with full Git history and
    `--prepare` on pull requests and pushes. Node dependency preparation uses
    `npm ci --ignore-scripts` and fails when dependencies lack a lockfile;
    Python preparation uses a temporary virtual environment. Verification
    processes receive no parent tokens/provider secrets and use isolated user
    state with bytecode writes disabled.
  - Local implementation proof: Audio Tools passed its TypeScript build and
    five offline behavior tests after lockfile preparation. The guarded catalog
    cleaner then removed only its generated `dist` and `node_modules`.
  - Hosted-bridge proof: Otter and Supabase now own offline package-local
    contract tests for their pinned `mcp-remote` adapters. Their package-specific
    root tests were removed, reducing registry-kernel knowledge of individual
    stacks. Both stack contracts pass without contacting either provider.
  - Python proof: Speech Generator gained `verify.py`; isolated verification
    ran 14 tests including stdio MCP initialization/tool discovery. The first
    run exposed a real macOS `/var` versus `/private/var` default-output path
    bug; resolving the default path consistently changed the existing test from
    red to green. The guarded cleaner removed exactly three bytecode-cache
    directories written before suppression was added.
- 2026-08-02 lifecycle grill round two: isolated questioner, answerer, and
  skeptic agreed that a top-level lifecycle contract can roll out additively in
  schema v2, omission must mean unclassified, and retired packages should leave
  the publication index. They also agreed that exact vocabulary, classification
  of the 101 current packages, install/update enforcement, and retirement grace
  policy are human product decisions. No lifecycle schema or package labels
  were added before that decision.
- 2026-08-02 release-provenance slice:
  - Red: the focused compile test failed because `dist/release.json` had no
    source or artifact provenance. Green: release metadata now records canonical
    repository/revision context, the catalog root, and SHA-256 values for all
    seven generated artifacts.
  - Red: `src/release-provenance.test.ts` initially had no verifier. Green:
    `npm run release:verify` validates exact file/hash membership, rejects path
    traversal and malformed revisions/hashes, and fails on tampering. Both the
    quality and release jobs run the verifier after build.
  - The corrected debt policy now sees 31 registry-kernel files and seven real
    entrypoints (including catalog hygiene and the new verification commands),
    with zero error, warning, or info findings.
- 2026-08-02 no-growth architecture ratchet:
  - Red: `npx vitest run src/stack-debt.test.ts` showed that the repository had
    no enforceable boundary for newly oversized stack modules or growth in an
    existing oversized module. Green: `.stack-debt-baseline.json` records the
    current 13 modules above the 800-line threshold, and changed-stack
    verification now fails on either baseline growth or a new oversized source
    module. The baseline can shrink as modules are split but cannot be raised as
    a routine bypass.
  - This is a containment gate, not a claim that existing large lifecycle
    modules have already been decomposed. Each recorded module remains explicit
    migration debt requiring its own behavior-preserving follow-up.
- 2026-08-02 verification hardening:
  - Red: the focused missing-contract test received a raw Python `ENOENT` with
    no package context. Green: missing `verify.py` now reports the canonical
    package and required repository contract.
  - Red: a two-second Python verification passed despite a 50ms requested
    timeout. Green: all default preparation and verification subprocesses now
    have a positive validated timeout (ten minutes by default), receive
    `SIGTERM` on expiry, and are force-killed if needed.
- 2026-08-02 release-envelope hardening:
  - Red: a self-consistent `release.json` could omit a generated platform index
    from both its file list and hash map and still verify. Green: compiler and
    verifier now share one canonical seven-artifact set; the verifier also
    requires matching catalog roots and rejects symlinks and other non-regular
    artifacts before hashing.
  - Focused verification: `npx vitest run src/release-provenance.test.ts
    src/stack-verification.test.ts src/stack-debt.test.ts
    src/quality-gates.test.ts` passed 16 tests. `npm run build`, `npm run
    release:verify`, `npm run indexes:check`, `npm run catalog:clean:check`, and
    `git diff --check` passed after the refactor.
  - The documentation grill revised ADRs 0005 and 0006 to state the exact
    limits: offline execution is a package policy rather than an OS network
    sandbox, Python dependency ranges are not hash-locked, Deno/Bun verification
    is not yet implemented, and release provenance is an unsigned consistency
    envelope rather than proof of origin or tamper prevention.
  - The isolated documentation reviewer returned `PASS` after the revisions;
    its focused re-review passed 36 tests across four files and `git diff
    --check`.
- Latest cross-slice verification:
  - `npm test`: 20 files passed; 140 tests passed and one optional live test was
    skipped.
  - `npm run debt:scan`: 33 registry-kernel files and seven entrypoints scanned;
    zero error, warning, or info findings.
  - The actual-catalog module audit checked all 44 stacks against the no-growth
    baseline and reported zero architecture issues.
  - `npm pack --dry-run --json`: passed with 673 entries. `npm run
    validate:public -- --json` continues to fail only for the pre-existing
    user-owned untracked `catalog/agents/antigravity.json` file referenced by
    the concurrently regenerated index; no gate was weakened to hide it.
- 2026-08-02 registry-kernel package isolation:
  - Red: `src/registry-kernel-boundary.test.ts` found five named stack contract
    suites in the root `src` tree. Green: Audio/Cloudinary, RUDI CRM, RUDI
    Share, Social Media Publisher, and SWE Engineering now own those assertions
    in their package directories; the root test rejects future named
    `*-stack.test.ts` suites. Existing Otter and Supabase bridge tests had
    already moved package-local in the earlier slice.
  - The six newly colocated contracts passed 82 tests with one optional live
    database test skipped. The guarded cleaner removed nine exact reproducible
    build/dependency targets after the focused run.
  - Red: the generic boundary audit found 14 Node packages whose existing test
    suites were not reachable through `scripts.verify`. Green: all 14 expose
    the repository contract. Editorial Markup and Web Export use the optional
    package-owned `verify:prepare` hook to install Chromium; Web Export's test
    glob was also corrected so its nine tests actually execute. All 14 package
    contracts passed, and the guarded cleaner then removed 21 exact
    reproducible targets.
- 2026-08-02 generic live-contract migration:
  - Red/green helper tests established order-insensitive exact tool-set
    comparison for stdio Node and Python MCP implementations. The helpers use
    the manifest command/cwd with containment checks, bounded output and
    response waits, no shell-string execution, and no provider secrets.
  - Fourteen Node stacks without prior tests now build or import and then prove
    their live MCP tool surface. Verification exposed and fixed concrete
    package defects: stale Notion tool declarations, a Slack entrypoint path,
    eager Tally credential lookup, missing package-local TypeScript configs in
    OpenAI and Sports Stats, unsafe OpenAI transcription response assumptions,
    and unvalidated Sports Stats tool arguments. All 36 Node stack packages
    with local implementations passed their package-owned contracts.
  - Seven Python stacks now expose `verify.py`. The Python helper runs real
    `unittest` discovery when test files exist and fails closed on zero tests or
    failures; preparation accepts either a root requirements file or exactly
    one immediate runtime-directory requirements file.
  - Live Python verification exposed and fixed macOS output-root
    canonicalization in Image Generator and Video Generator (25 and 35 tests),
    incompatible unbounded MCP 2.0 resolution in Whisper and Data Analysis,
    Data Analysis's eager Matplotlib startup cost, and a RUDI Processor test
    script that previously yielded zero runner-visible tests. Document
    Processor and all other Python tool surfaces also passed. All seven Python
    stacks are green under isolated preparation.
  - Catalog contract audit: 43 of 44 stacks have verified repository
    entrypoints. `stack:stripe` is the sole exception: it declares
    `node dist/index.js` but contains neither an implementation nor a package
    verification contract. No package-specific exemption or fabricated
    implementation was added; publication/removal is tied to the unresolved
    lifecycle decision.
- 2026-08-02 current full registry gates:
  - `npm test`: 18 root test files and 140 tests passed.
  - `npm run indexes:sync && npm run indexes:check`: regenerated the canonical
    base index, five platform indexes, catalog root, and release envelope for
    101 packages/653 catalog files; the drift check passed.
  - `npm run validate` and `npm run build`: all 101 catalog package sources
    validated and compilation passed.
  - `npm run release:verify`: all seven required release artifacts matched the
    unsigned consistency envelope. `npm run debt:scan`: 31 registry-kernel
    files, seven entrypoints, and zero error/warning/info findings.
  - `npm run catalog:clean`: after a dry-run identified only reproducible
    outputs from focused stack verification, removed exactly 29 generated
    `dist`, `node_modules`, and Python cache targets; the follow-up check found
    zero targets.
  - `npm pack --dry-run --json`: passed with 690 entries, 1,627,694 packed
    bytes, and 7,239,926 unpacked bytes. `git diff --check` passed.
  - `npm run validate:public -- --json` has one external dirty-worktree gate:
    `catalog/agents/antigravity.json` is user-owned and untracked while the
    generated index references it. The gate was intentionally left strict.
- 2026-08-02 documentation-skeptic hardening:
  - The requested Grill reviewer returned `REVISE` after finding that generic
    live helpers created a second HOME, zero-test failure relied on interpreter
    exit behavior, and requirements discovery accepted arbitrary child
    directories. Focused red verification reported five expected failures.
  - Green: the runner marks its isolated session; both generic helpers validate
    and reuse that exact HOME/RUDI_HOME through package preparation, tests, and
    the live MCP, while direct helper invocation still self-isolates. Python
    discovery now counts the suite explicitly and fails on zero cases.
    Requirements candidates are restricted to root `requirements.txt` or
    `python/requirements.txt`, both together are rejected, and unrelated child
    requirements are ignored.
  - `npx vitest run src/stack-verification.test.ts
    src/node-stack-contract.test.ts src/python-stack-contract.test.ts`: 19 tests
    passed. Real isolated `--prepare` verification also passed Data Analysis
    (10 live tools) and Google AI (build plus two live tools). The guarded
    cleaner removed exactly their two reproducible Node outputs afterward.
  - The same isolated reviewer returned `PASS` after the corrections; its
    four-file focused suite passed 20 tests and `git diff --check` passed.
  - Post-review root verification: `npm test` passed 145 tests across 18 files;
    index drift, the seven-artifact release envelope, zero-finding debt scan,
    zero-target catalog hygiene check, and `git diff --check` also passed.
- 2026-08-02 first oversized-boundary decomposition:
  - Scope was locked to Content Extractor because its 1,231-line entrypoint had
    strong offline behavior tests and clean platform seams. No manifest tool,
    CLI argument, public API export, or provider behavior was intentionally
    changed.
  - Red: `npm run stacks:verify -- --stack stack:content-extractor --prepare`
    ran 20 package tests; the new package-local module-boundary test failed only
    because `src/index.ts` had 1,231 lines.
  - Green: Reddit fetching/parsing/formatting now lives in `src/reddit.ts`, and
    shared HTTP/platform URL validation lives in `src/url-policy.ts`.
    `src/index.ts` is 749 lines, `src/reddit.ts` is 571, and
    `src/url-policy.ts` is 39; each remains below the package's 800-line limit.
  - Unchanged verification passed all 20 package tests and `npm run build`.
    Generic live stdio initialization confirmed the same five manifest tools.
    The obsolete Content Extractor entry was removed from the no-growth debt
    baseline rather than retained or raised.
- 2026-08-02 lifecycle and retirement contract:
  - The accepted additive schema-v2 shape is an optional top-level `lifecycle`
    object with required `maturity` (`experimental` or `stable`) and `support`
    (`supported`, `maintenance`, or `unsupported`) values. Omission means
    unclassified. `unsupported` packages require deterministic deprecation
    guidance; optional replacement IDs must resolve to another published
    package, dates must be ISO calendar dates, and `removalAfter` cannot precede
    `announcedAt`. Dates are informational and never trigger wall-clock removal.
  - Red: `npx vitest run src/schema.test.ts src/resolver.test.ts
    src/catalog.test.ts src/stack-verification.test.ts` produced five expected
    failures for the absent schema/policy/reference rules and Stripe's missing
    implementation contract. Green: the unchanged command passed 87 tests.
    Generated-index tests also prove lifecycle metadata survives compilation and
    that retired Stripe is absent.
  - `stack:stripe` was physically retired from the canonical catalog because it
    advertised ten tools and `node dist/index.js` but contained no implementation,
    package, tests, or verification contract. Its tracked manifest and example
    environment file remain recoverable through Git. Retirement means removal
    from the canonical source and index, not a hidden state or versioned catalog
    path. ADR 0007 records the complete contract and supersedes the lifecycle
    ambiguity in ADRs 0005 and 0006.
  - Content Extractor is the first explicitly classified package
    (`stable`/`supported`); all other omitted lifecycle values remain visibly
    unclassified rather than receiving speculative mass labels.
- 2026-08-02 CLI lifecycle consumer and execution-ownership audit:
  - The registry client validates lifecycle metadata at its untrusted response
    boundary. `rudi search`, `rudi list`, and `rudi info` visibly render maturity,
    support, and deprecation/replacement guidance. The CLI README now discovers
    the current catalog dynamically instead of retaining a stale hardcoded list
    that included Stripe.
  - Red: the focused CLI command
    `node --test packages/registry-client/src/__tests__/unit/registry-contract.test.js
    src/__tests__/unit/package-lifecycle.test.js` failed because malformed
    lifecycle data was accepted and the formatter did not exist. Green: the
    unchanged command passed seven tests. An isolated local-registry smoke search
    displayed `Lifecycle: stable · supported` without writing real user state.
  - CLI help and routing distinguish Core, Advanced, Internal, and Retired
    surfaces. Retired execution names return migration notices and cannot reach
    runtime code. The daemon and package boundary tests prove the normal runtime
    does not import `packages/db`; that package remains physically isolated only
    for Studio compatibility until coordinated deletion. The Agent Host retains
    only native-provider launch, bounded reconnect/event pointers, workspace
    lifecycle, and group pointers; native Codex, Claude, Gemini, and other hosts
    remain the owners of execution and authoritative transcripts.
  - Final CLI verification: `pnpm test` passed all 609 tests; `pnpm build`
    passed; the targeted architecture-aware scan examined the five edited JS
    files against a 252-file graph with zero findings; and
    `npm pack --dry-run --json` passed with the intended six publish entries.
- 2026-08-02 complete stack and post-clean verification:
  - `npm run stacks:verify -- --all --prepare` passed all 43 published stacks
    (36 Node and seven Python) in isolated HOME/RUDI_HOME sessions with narrow,
    secret-free environments, bounded subprocesses, locked Node preparation,
    and real package-owned verification. No published stack lacks a contract.
  - The guarded hygiene dry-run identified exactly 61 generated dependency,
    build, browser, bytecode, and empty-run targets created by verification.
    `npm run catalog:clean` removed those reproducible artifacts only; the
    immediate and final dry-runs both reported zero remaining targets.
- 2026-08-02 final closure audit:
  - `npm test`: 18 files and 152 tests passed. `npm run build` validated and
    compiled 100 packages (43 stacks), the base index, five platform indexes,
    the 653-file catalog hash tree, and the release envelope.
  - `npm run indexes:check` passed; `npm run release:verify` matched all seven
    required artifact hashes; `npm run debt:scan` inspected 31 kernel files and
    seven entrypoints with zero findings; `npm pack --dry-run --json` passed with
    691 entries; and `git diff --check` passed in both registry and CLI.
  - One bounded external worktree condition remains visible:
    `npm run validate:public -- --json` correctly rejects the user-owned,
    untracked `catalog/agents/antigravity.json` while the generated index
    references it (one error, zero warnings). The source must be intentionally
    committed or removed by its owner before publication; no validation rule was
    weakened and this consolidation did not alter that concurrent work.
  - Workflow-level mandatory gates are implemented. Repository administration
    must still add registry check `Test, Build & Verify` and CLI check `quality`
    to the `main` ruleset/branch protection to make bypass impossible at the
    GitHub merge boundary; that external setting is not safely writable from
    this dirty local workspace.
- 2026-08-03 restored-package integration:
  - The later `restore local registry updates` commit supplied a real Stripe
    implementation, package metadata, and guarded dry-run behavior that were
    absent when the placeholder was retired. Stripe was therefore republished
    only after gaining the standard offline package verification contract.
  - The same integration added Agent Hosts, Dwellow, and Site Planner. Their
    existing package tests or static hosted-bridge evidence are now reachable
    through `scripts.verify`; package-specific root test knowledge remains
    outside the registry kernel.
  - Restored Site Planner, Stripe, and Zoho implementations enter the
    architecture ratchet at their exact integrated line counts. This records
    pre-existing imported debt without permitting another line of growth; each
    boundary still requires a behavior-preserving decomposition. Content
    Extractor's restored GitHub, batch/browser, and link responsibilities were
    split into focused modules so every package source remains below the
    existing 800-line package boundary.
  - The restored branch also predates the ratchet for bounded additions to
    Google Workspace, Social Media Publisher, and Video Editor. Their exact
    integrated sizes are frozen in the baseline with no growth allowance; this
    records the imported state and does not classify the modules as decomposed.
    Image Generator's Midjourney validation, service, and browser concerns were
    instead separated into focused modules, leaving every source module below
    the 800-line boundary.
  - Agent Hosts moved from the restored `@modelcontextprotocol/sdk@1.0.0` pin
    to the non-major `1.30.0` security fix after `npm audit` reported
    GHSA-w48q-cv73-mx4w. Its npm integrity lock is the repository verification
    authority; the redundant pnpm lock was removed to prevent lock drift.
  - Historical package counts and the original retirement audit above describe
    the state at the time those gates were first established. The regenerated
    canonical index and final verification record are authoritative for the
    integrated repository state.
