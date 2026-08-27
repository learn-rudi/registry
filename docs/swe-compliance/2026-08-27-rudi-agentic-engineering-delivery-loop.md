# RUDI Agentic Engineering Standard And Delivery Loop

Status: Gate 1 source implementation complete; uncommitted and unpublished

## Phase 0: Baseline And Manual Lookup

- Scope: formalize the RUDI Agentic Engineering Standard, define the RUDI
  Delivery Loop across the existing portable skills, and add a non-mutating
  Repo Steward worktree-closeout receipt engine.
- Files inspected before editing: repository and global `AGENTS.md`, the SWE
  manual index, Agent Co-Pilot Operating Standard, Horizontal Engineering And
  Codebase Stewardship Standard, the five existing suite skills, both stack
  manifests and package contracts, Repo Steward core/MCP/tests, Registry
  catalog compiler/tests, and generated-index workflow.
- Relevant SWE manual sections: documents 10, 11, and 12; Engineering Quick
  Reference change checklist; Appendix C red-green-refactor doctrine.
- Current-state commands: `git status --short --branch`, `git worktree list
  --porcelain`, `git ls-remote --symref origin HEAD`, targeted `rg`, and direct
  source inspection.
- Baseline: detached clean worktree
  `/Users/admin/RUDI/worktrees/registry/rudi-agentic-engineering-delivery-loop-20260827`
  at live `origin/main` `c63046abafddf33d163997c7faf2b22069140136`.
- Horizontal-pattern scan: Change Map, Delivery Coordinator, Engineering Gate,
  Coherence Review, Repo Steward, and Worktree Closeout are related lifecycle
  capabilities with distinct owners. Their common contract should be
  standardized in the umbrella manual, while implementation remains separate.
  Repo Steward owns Git-state and receipt persistence; Coherence Review owns
  architectural disposition; the Coordinator owns sequencing; Engineering
  Gate owns Definition of Done.
- Risks and invariants:
  - Existing skill package IDs remain stable; role labels do not rename IDs.
  - Closeout tools record local state and evidence but never stage, commit,
    push, merge, reset, clean, delete, archive, or remove a worktree.
  - Dirty, conflicted, untracked, unknown-lineage, or unaccepted work fails
    closed to preservation or blocked disposition.
  - Cleanup eligibility never constitutes cleanup authority.
  - Receipt versions are immutable and transitions use an expected version.
  - Machine-local receipt state is not published in Registry artifacts.
- Initial risk tier: Medium. This changes durable agent policy, package
  contracts, and local persistent state, but deliberately exposes no destructive
  repository mutation.
- Baseline dependency evidence: root and both changed-stack `npm ci` commands
  passed. Existing audit findings are 1 moderate, 6 high, and 1 critical at the
  Registry root; 1 high in SWE Engineering; 0 in Repo Steward. No audit fix is
  authorized or attempted.
- Exit criteria: baseline, authority, source-of-truth, interfaces, risks, and
  proof commands are explicit before red tests.

## Phase 1: Scope Lock

- In scope:
  - Add manual document 13 and register it in manual list/read/search.
  - Define stable package IDs and RUDI role labels as one Delivery Loop.
  - Add `skill:rudi-worktree-closeout` and its receipt contract.
  - Extend Repo Steward with lease-bound closeout record/list tools, immutable
    receipt versions, state transitions, validation evidence, preservation
    requirements, cleanup eligibility, and approval references.
  - Wire closeout handoffs into Chief of Staff, SWE Compliance Checklist, and
    Repo Steward skills.
  - Update focused tests, stack versions, package metadata, generated index,
    and documentation.
- Non-goals: commits, pushes, pull requests, merges, releases, skill install or
  synchronization, another-Mac changes, worktree cleanup/archive/deletion,
  scheduling, new agent execution surfaces, sports/NFL changes, dependency
  upgrades, or historical checklist/ADR rewrites.
- Expected source paths:
  - `catalog/stacks/swe-engineering/{manifest.json,README.md,package.json,package-lock.json}`
  - `catalog/stacks/swe-engineering/src/{core.js,manual/02-Engineering-Quick-Reference.txt,manual/10-Engineering-Operating-Manual-Index.md,manual/13-RUDI-Agentic-Engineering-Standard.md}`
  - `catalog/stacks/swe-engineering/test/{core.test.js,package-contract.test.js}`
  - `catalog/stacks/repo-steward/{manifest.json,README.md,package.json,package-lock.json}`
  - `catalog/stacks/repo-steward/src/{core.js,index.js,closeout.js,closeout-store.js}`
  - `catalog/stacks/repo-steward/test/{core.test.js,mcp.test.js,package-contract.test.js}`
  - `catalog/skills/{rudi-chief-of-staff/SKILL.md,swe-compliance-checklist.md,rudi-repo-steward/SKILL.md}`
  - `catalog/skills/rudi-worktree-closeout/{SKILL.md,references/receipt-contract.md,agents/openai.yaml}`
  - `src/{portable-agentic-workflow-skills.test.ts,rudi-chief-of-staff.test.ts}`
  - generated `index.json` and this checklist.
- External inputs and trust boundaries: tool arguments, repository IDs, Git
  refs, lineage fields, validation evidence, approval references, persisted
  JSON, filesystem paths, and Git output are untrusted and bounded before use.
- Failure behavior:
  - unknown fields, invalid IDs/refs/timestamps, illegal transitions, stale
    versions, missing leases, and conflicting receipt creation fail closed;
  - cleanup approval states require a non-empty approval reference;
  - cleanup eligibility requires a clean snapshot, passing validation, accepted
    lineage, and no preservation requirements;
  - `cleanup_approved` records authorization only; this gate exposes no state
    that claims cleanup was performed or verified.
- Authorized external actions: none. Live remote reads were used only to select
  the source revision. All writes remain inside this isolated worktree or its
  ignored dependency directories.
- Planned uncommitted slices: (1) red contracts; (2) Repo Steward engine;
  (3) manual and skills; (4) generated index and verification evidence.
  Commit and publication authority are absent.
- Horizontal obligation: standardize the shared lifecycle and receipt contract
  in this change. Keep the six capabilities as intentional separate owners.
  Disposition: standardize contract, not consolidate implementations.
- Review gates: focused red/green, both stack suites, Registry focused/full
  tests, validation/build/index/hygiene/package checks, JS debt scans, source
  smoke, and independent fresh-context read-only review.
- Exit criteria: no path or capability outside this lock changes without a new
  scope decision.

## Phase 2: Red Tests

- Observable behavior:
  - Manual list/read/search exposes the thirteenth standard.
  - Stable package IDs remain published while target role labels are explicit.
  - Repo Steward exposes non-mutating closeout record/list tools.
  - Closeout receipts capture required Git, lineage, evidence, disposition,
    preservation, eligibility, approval, and timestamp fields.
  - Illegal transitions and cleanup approvals without evidence fail closed.
- Test paths: focused stack and Registry tests listed in Phase 1.
- Red commands:
  - `npm test` in `catalog/stacks/repo-steward`
  - `npm test` in `catalog/stacks/swe-engineering`
  - `npm test -- src/portable-agentic-workflow-skills.test.ts src/rudi-chief-of-staff.test.ts`
- Expected failure: new document, package, tool names, state contract, and
  suite handoffs do not yet exist.
- Review-driven red regressions also demonstrated that the initial engine:
  accepted a tampered active projection, could not recover a completed
  immutable write whose projection update was interrupted, re-resolved a moved
  symbolic base, carried a stale cleanup approval into a later lifecycle,
  documented field names it did not emit, and masked transition-only arguments
  as an idempotent create replay. Each regression failed for that exact reason
  before its corresponding fix.
- Exit criteria: each command fails on the new behavior, not setup or imports.

## Phase 3: Implementation

- Implement the smallest source changes that satisfy one red contract at a
  time. Keep shared input validation and record-locking mechanisms single-owned.
- Validate all boundary inputs and redact failure messages that could expose
  secrets or raw remote credentials.
- Persist closeout versions beneath Repo Steward local state with atomic writes
  and immutable version records. Do not add a Git mutation tool.
- Implemented stable-ID role labels rather than package renames, the umbrella
  standard and Delivery Loop ownership matrix, lifecycle handoffs, and the new
  portable closeout operator skill.
- Implemented lease-bound `repo_steward_record_closeout` and
  `repo_steward_list_closeouts` tools. The engine observes Git only and records
  versioned receipts; no cleanup-completed state or Git mutation surface exists.
- Active projections are byte-bound to immutable versions. Interrupted
  projection advancement is recoverable only for an otherwise exact semantic
  replay, symbolic bases remain pinned to their creation commit, and every
  entry into `cleanup_approved` requires a fresh approval reference.
- Exit criteria: all focused red commands pass without weakened assertions.

## Phase 4: Green Tests And Refactor

- Green commands: rerun Phase 2 commands unchanged.
- Refactor only after green; rerun affected tests after each cleanup.
- Regression: existing action ledger, lease, discovery, fetch-policy, manual
  traversal, catalog path, and host-neutrality tests remain green.
- Green results after refactor: Repo Steward 21/21, SWE Engineering 6/6,
  focused Registry suite 16/16, and full Registry 252/252. The closeout engine
  was extracted into 725-line behavior and 109-line persistence modules;
  pre-existing `core.js` remains exactly 1,579 lines at both base and current.
- `git diff --check` passes.
- Commit checkpoint: all slices remain uncommitted.
- Exit criteria: focused suites pass and `git diff --check` is clean.

## Phase 5: Full Verification

- Targeted tests: both stack suites and the focused Registry tests.
- Full suite: root `npm test`.
- Build and contracts: `npm run validate`, `npm run stacks:verify`,
  `npm run indexes:sync`, `npm run indexes:check`,
  `npm run catalog:clean:check`, `npm run build`,
  `npm run release:verify`, and `npm pack --dry-run --json`.
- Debt: source-scoped SWE debt scan plus root `npm run debt:scan`.
- Smoke: direct manual list/read/search for document 13 and an in-memory MCP
  closeout receipt lifecycle proving no repository mutation.
- Independent review: fresh read-only context supplied the task contract,
  instructions, diff, and verification output.
- Risk approval: Gate 1 authorizes local implementation and verification only.
- Current proof results:
  - `npm test` at Registry root: 28 files and 252 tests passed.
  - `npm test` in Repo Steward: 21/21 passed.
  - `npm test` in SWE Engineering: 6/6 passed.
  - `npm run validate`: 156/156 catalog packages passed.
  - `npm run indexes:sync` and `npm run indexes:check`: 156 packages and
    821 catalog files; generated root `8444552b12cf37a6...` is current.
  - `npm run build`: passed; `npm run release:verify`: seven artifact hashes
    passed.
  - `npm pack --dry-run --json`: 994 entries; the new closeout skill and
    `closeout-store.js` are included.
  - Root `npm run debt:scan`: zero findings. Focused Repo Steward and SWE
    source scans: zero findings.
  - `npm run catalog:clean:check`: zero planned targets after moving the two
    ignored, test-only nested `node_modules` directories to a private temporary
    directory for the read-only check; both directories were immediately and
    successfully restored.
  - Independent fresh-context review: PASS with no blocking defects after the
    projection, recovery, pinned-base, approval, schema-documentation, and
    exact-replay fixes.
- Prescribed proof gap: selected `npm run stacks:verify -- --stack
  stack:repo-steward --stack stack:swe-engineering` reports that Repo Steward
  `src/core.js` has 1,579 lines and is missing from the no-growth baseline.
  The file is exactly 1,579 lines at `origin/main` and in this worktree, and
  `.stack-debt-baseline.json` predates Repo Steward. Gate 1 neither changes the
  baseline nor performs an unrelated legacy-core refactor.
- Exit criteria: all gates pass or the final verdict records the exact gap.

## Phase 6: Docs, Contracts, And Closure

- Docs/contracts: manual standard, indexes, stack READMEs/manifests, three
  skill workflows, closeout receipt contract, and this checklist.
- Final source paths match the Phase 1 scope lock, including the review-driven
  `catalog/stacks/repo-steward/src/closeout-store.js` extraction. No sports/NFL
  path changed.
- Compatibility: public package IDs remain `skill:map-change-impact`,
  `skill:rudi-chief-of-staff`, `skill:swe-compliance-checklist`,
  `skill:horizontal-engineering-review`, and `skill:rudi-repo-steward`; target
  RUDI names are human-facing roles. Only `skill:rudi-worktree-closeout` is a
  new ID, so existing prompts, catalogs, installed skills, and callers do not
  require a rename migration.
- Accepted pre-existing debt:
  - Repo Steward record locking checks the lease before work and inherits an
    unconditional lock unlink on exit. An operation that outlives its lease can
    theoretically overlap a successor. Immutable versions and expected-version
    conflicts constrain the closeout risk; lock ownership and pre-persist lease
    revalidation belong in a later approved gate.
  - The stack no-growth baseline omission described in Phase 5 prevents an
    all-green `stacks:verify` report despite no growth in legacy `core.js`.
  - The generic system skill validator rejects Registry's supported extended
    frontmatter keys; Registry's own catalog validator is the authoritative
    check and passes.
- Known future hardening, not Gate 1 requirements: require lexical ISO-8601
  timestamps rather than relying on `Date.parse`, support Git SHA-256 object
  IDs, and let a separately authorized cleanup workflow verify that an opaque
  approval reference is scoped to its exact effect.
- Worktree-closeout receipt proof gap: this implementation worktree has no
  Repo Steward closeout receipt because Gate 1 explicitly prohibited installing,
  synchronizing, or activating the newly added skill and stack surface. This
  checklist preserves the exact worktree, base, verification, review, and
  disposition evidence in the interim. Owner: Repo Steward integration gate.
  Trigger: accepted source integration followed by separately authorized local
  installation. Closing proof: read back the receipt ID, version, state, and
  preservation disposition without performing cleanup.
- Definition of Done: requested doctrine, suite relationships, compatibility,
  closeout skill, receipt engine, MCP surfaces, tests, documentation, generated
  index, packaging, and local proofs are complete. The exact pre-existing proof
  gap and debt are recorded. No placeholder, secret, destructive behavior, or
  scope expansion was found.
- Commit ledger: planned slices remain uncommitted; push, PR, merge, release,
  install, deployment, synchronization, archive, and cleanup remain not
  authorized.
- Final verdict: Gate 1 PASS for the in-scope source implementation, with the
  disclosed pre-existing stack-verifier baseline gap. Stop before commit or any
  external action pending fresh approval.

## Gate 2: Local Commit Closure

- Authority received: review the complete uncommitted Gate 1 diff and create
  one local commit only. Push, pull request, merge, release, installation,
  synchronization, worktree cleanup/archive, sports/NFL changes, and external
  actions remain prohibited.
- Staged review: all 30 paths match the Gate 1 scope; no blocking defect,
  secret, destructive surface, generated/manual drift, or unrelated path was
  found. Two extra EOF blank lines were corrected before commit.
- The generated index must be refreshed after those catalog-byte corrections,
  then staged-diff, index, and post-commit status checks must pass.
- Commit identity is reported from post-commit readback because a commit cannot
  embed its own object ID.
