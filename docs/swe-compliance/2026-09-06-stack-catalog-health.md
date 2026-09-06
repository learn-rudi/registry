# Stack catalog health execution

## Phase 0: Baseline and manual lookup

- Approved scope: the 2026-09-06 stack audit and explicit
  `set-goal-and-execute` invocation.
- Registry base: `7b85c9350419a0ff8d8005ee5be7abdc03665249`; CLI base:
  `89b215068ac0cba607b584b67ee347a8195d5415`. Both checkouts were clean.
- Baseline: 51 stacks, 526 declared tools, 352 registry tests pass;
  schema/public/hygiene checks pass. Seven modules in OpenCounter and RUDI CRM
  block the all-stack verification gate. The CI timestamp policy makes index
  verification pass; package data already matches.
- Standards: Master Engineering Doctrine (including Appendix C), Agent
  Co-Pilot Operating Standard, Horizontal Engineering and Codebase Stewardship
  Standard; the repository's catalog and stack verification contracts.
- Risk: medium. Shared discovery behavior and nontrivial module boundaries
  change; no authorization, secret, payment or live publishing behavior changes.

## Phase 1: Scope lock

- Align all stack categories with the accepted seven primitives and linked
  operator skills; add capability/domain/provider facets, preserving ordinary
  tags, IDs, folders, tools, dependencies and operator relationships.
- Generalize CLI facet extraction/filtering to stacks without introducing
  skill roles on stack objects. Preserve legacy catalog and installed readers.
- Reconcile Notion Workspace, RUDI Share and SWE Engineering package/server
  versions with their manifest release identity.
- Split the seven oversized OpenCounter/CRM source modules along existing
  responsibilities. Preserve public exports and behavior; do not relax the
  module-size baseline or debt checks.
- Document a reproducible local index check using the existing CI policy.
- Non-goals: rename package IDs; reorganize stack folders; retire capabilities;
  introduce a new category hierarchy; modify custom skills or live installs;
  change credentials, publish, deploy, or make external writes.
- Authorization: local implementation, verification, artifacts and docs.
  Commits, push, PR, merge, release and live activation remain separate gates.
- Planned commit slices (uncommitted): CLI facet behavior; registry metadata,
  validation and version contracts; OpenCounter responsibility splits; CRM
  responsibility split; documentation and generated artifacts.
- Horizontal disposition: standardize the shared classification contract in
  this change; consolidate facet parsing in its existing CLI owner; split
  oversized modules within their owning stack. No cross-stack abstraction is
  justified merely by similar provider or processor names.

## Phase 2: Red tests

- Prove one observable behavior at a time: stack provider/capability filters;
  invalid authored stack categories/facets; release-version agreement.
- Preserve red command/output before implementing each behavior.
- For behavior-preserving refactors, run existing focused behavior tests before
  and after extraction. The existing failing size gate supplies structural red
  evidence; do not add tests that only mirror moved implementation details.

## Phase 3: Implementation

- Keep category/facet validation at the authored-catalog boundary. Missing or
  invalid facets fail with a package/path diagnostic.
- Module extraction must retain imports, public exports, validation, locking,
  transaction order and failure behavior. Avoid new cycles and dependencies.
- Catalog metadata changes must flow through compilation, never hand-written
  generated index edits.

## Phase 4: Green tests and refactor

- Rerun each red test unchanged after its smallest implementation.
- Run affected stack tests before and after module extraction.
- Re-run module-size checks and focused debt scans on the final modules.
- Keep intended commit boundaries reviewable while work is uncommitted.

## Phase 5: Full verification

- Registry: full tests, schema/public validation, hygiene, deterministic index
  check, build, release verification and package dry run.
- CLI: focused discovery tests, full tests, build, debt and package dry run.
- Stack verification: all 51 contracts with prepared dependencies in an
  isolated copy of the exact candidate; record per-stack outcomes and MCP
  initialization/tool-list evidence. No user credentials or live home state.
- Review: independent read-only Standards, Spec and Proof assessment after
  implementation and verification; fix in-scope findings and rerun proof.
- Paired peer: inspect the admin Mac's exact repo/instruction/runtime state and
  verify the accepted candidate separately without overwriting its work.

## Phase 6: Documentation and closure

- Update catalog authoring/discovery documentation and reproduction commands.
- Evidence: `~/.rudi/outputs/stack-catalog-execution-2026-09-06/` on the machine
  that generated it. Keep logs and machine-local state out of source control.
- Record final checks, review verdicts, proof gaps, change slices and separate
  publication/activation status. Do not equate offline verification with live
  provider availability or credential readiness.
- Record worktree closeout receipts for material task checkouts, or an explicit
  owner, trigger and closing proof if the receipt service cannot record one.
- Definition of Done: all approved source behavior and classification changes
  implemented; no unresolved in-scope gate/review failures; accurate 51-stack
  verification evidence; docs/generated artifacts current; preserved work and
  explicit handoff for separately authorized publication.

## Completed implementation and verification

- All 51 stack manifests now use the seven categories, matching their primary
  operators: web 3, code 3, data 18, documents 6, media 11, communication 7,
  agents 3. Existing IDs, folders, 526 tools, dependencies, ordinary tags and
  operator/companion relationships are preserved.
- Shared authored category/facet validation rejects malformed input with the
  package ID and path. CLI search, installed list and info use shared facet
  extraction while keeping skill roles exclusive to skills.
- Notion Workspace 1.2.0, RUDI Share 0.2.0 and SWE Engineering 0.5.0 now have
  aligned manifest/package/lock/server release identities. Initialization
  probes verify all three. The separately versioned hosted-adapter interface
  constant is unchanged.
- Six OpenCounter modules and CRM's contract were split without changing
  behavior or the debt baseline. Independent comparison preserves all 282
  definitions and original exports, with no missing helpers or import cycles.
  CRM's contract is 948 lines, below its existing 1,179-line allowance; every
  new module is below 800 lines.

### Red, green and regression proof

- CLI: `node --test packages/registry-client/src/__tests__/unit/skill-facets.test.js`
  recorded failing search and installed list/info behaviors before changes,
  then four passing tests. Matching logs: `cli-facets-red/green.log` and
  `cli-installed-facets-red/green.log`.
- Registry: `npx vitest run src/catalog.test.ts` recorded category, facet,
  operator-alignment and release-version failures before implementation.
  `registry-versions-red-behavior.log` is the valid version red; the earlier
  fixture attempt incorrectly assumed every zero-dependency stack had a lock
  and is not behavioral red evidence. Final registry suite: 356 passing.
- Structural refactors use unchanged existing behavior tests before/after;
  the seven failing size checks supply structural red evidence. Independent
  reruns pass OpenCounter 125/125, CRM 13 passing with three existing live-DB
  skips, and CRM strict type checking. No behavior-test assertions were weakened.
- Full isolated stack preparation initially passed 48/51; two tests still
  referenced old flat skill paths and one asserted the old SWE package version.
  Correcting those contract references yields three passing rechecks.
  `stack-contracts-final.json` binds all 51 passing outcomes to their logs.
- The peer exposed a pre-existing Share test race: its real child could be
  killed before writing a PID file within the 100 ms deadline. The test now
  observes the real spawn return value and restores its scoped observer after
  completion. The 100 ms deadline, 1,500 ms late-readiness fixture, exact error
  and process-exit assertions remain unchanged. All 46 Share tests pass on both
  Macs; the late test-harness correction receives an independent re-review.
- MCP initialization and exact tool-list equality are proven for 49 stacks,
  covering 491 of 526 declared tools. OpenCounter uses an ephemeral test key;
  Creator Intelligence needs its package build before the MCP probe. Otter and
  Supabase require OAuth; their 35 tools remain an explicit live-service gap.
  No authorization was completed. Provider writes and live credentials were
  not used. Offline success does not establish database/provider readiness.
- Schema/public validation, source hygiene, deterministic index checks,
  registry/CLI builds, release artifact verification and npm package inspection
  pass. Focused debt scans report no unresolved in-scope findings. OpenCounter's
  documented independent discovery APIs are included as graph entrypoints;
  the first MCP-only graph's orphan reports were configuration false positives.
- CLI's final suite passes 811 tests using verified Node 20.20.2. Its default
  local fallback to Node 20.10 fails two unchanged router tests. A frozen-lockfile
  dependency refresh fixed the review finding of a stale initial bundle.
  The final bundle matches the admin Mac's fresh frozen-lockfile build exactly.

### Independent review and peer evidence

Separate fresh-context reviewers assessed catalog rules, module extractions and
CLI behavior. Final Standards, Spec and Proof verdicts all pass; the CLI bundle
finding was corrected and independently rechecked. Reports are
`review-registry.md`, `review-refactors.md`, and `review-cli.md` in the execution
evidence directory.

Admin verification uses isolated registry/CLI worktrees at the same base
revisions. It passes 356 registry tests, 811 CLI tests, both refactor contracts,
schema/public/hygiene/index/release/package checks and CLI build/debt checks.
The older peer needed `npm test -- --maxWorkers=2` to avoid unchanged compiler
tests exceeding their five-second deadlines under parallel load; assertions
and timeouts were unchanged. Original peer main checkouts remain preserved.

### Residual debt and delivery boundary

- The pre-existing hash glob includes ignored Tally archive files in the
  original checkout although npm omits them; prepared stack tests can also
  leave files outside the current artifact ignore rules. Portable release
  evidence therefore comes from a separate source-only snapshot, not the
  prepared stack checkout. No ignored files were removed. Follow-up owner:
  registry maintainer; trigger: next hash-selection change; closing proof:
  clean-source and ignored-archive-present fixtures produce identical hashes
  without local archive paths. See the registry review for evidence.
- Catalog hashes describe source, while the npm tarball has separate inclusion
  rules (ADR 0006). Seventeen example environment templates in the clean source
  hash list are absent from that npm payload. The CLI installs from local/GitHub
  catalog source and treats these templates as optional; it does not consume
  the npm tarball or hash list as its installation file list. This is an existing
  packaging caveat, not an installer failure. The portable proof records both
  inventories without asserting they are identical.
- Local implementation is complete and reviewable in the original registry and
  CLI paths on `codex/stack-catalog-health-20260906`. Durable machine-local
  reports bind the final candidate hashes, peer comparison and closeout state.
  Retain all task checkouts and uncommitted changes. Commit, PR, merge, release,
  live installation/native activation and cleanup remain separately authorized
  delivery steps.


## Publishing follow-up: CI portability

The user subsequently authorized feature-branch publication, PR merge, main
checkout synchronization on both Macs, and installed package/native-skill
updates. CLI PR #45 passed CI and merged. Registry PR #68 passed schema
validation on macOS, Linux, and Windows, plus 50 of 51 stack contracts, before
the macOS automation unit suite exposed two existing host assumptions.

The test-only correction supplies the existing `platform: "darwin"` dependency
to mocked macOS operations and scopes the reminder fixtures to Eastern time,
restoring the previous time zone afterward. All original assertions remain;
a negative test also verifies that Linux is rejected before a command runs.
No production platform guard or date behavior changes.

Red: GitHub Actions run 34043963996 reproduced the Linux/UTC failures. After
preparing the package dependencies/build, the unchanged original suite also
failed locally under UTC with a Linux-platform preload. Green: the corrected
suite passed all 20 tests under the same conditions and under the native Mac
platform. Initial local invocations without the built `dist/core.js` were
setup failures, not behavioral red evidence. The focused debt scan covered
the test file and found no warnings or errors. GitHub CI must pass again for
the exact updated PR head before merge.
