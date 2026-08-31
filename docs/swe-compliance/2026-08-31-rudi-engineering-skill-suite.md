# RUDI Engineering Skill Suite — SWE Compliance Record

## Phase 0 — Baseline and authority

- Objective: implement the approved RUDI-native engineering lifecycle by adding Decision Frontier, Diagnose, Prototype, Stakeholder Questionnaire, Code Review, and Human Runbook skills; integrate them with the existing RUDI engineering skills without creating a second orchestrator.
- Canonical repository: `https://github.com/learnrudi/registry.git`.
- Clean base: `fd9816b9b45b73a9b43520d48146aa6c782cf5b2` (`origin/main`, fetched 2026-08-31).
- Isolated worktree: `/Users/hoff/RUDI/worktrees/registry/rudi-engineering-skills-20260831` on `codex/rudi-engineering-skills-20260831`.
- Collision avoided: `/Users/hoff/RUDI/apps/platform/registry` contains unrelated Repo Steward and brand-assets changes and remains untouched.
- Canonical standards consulted: Engineering Quick Reference, Agent Co-Pilot Operating Standard, Build Order and Engineering System, Horizontal Engineering and Codebase Stewardship Standard, plus backend idempotency guidance.
- User authorization: local implementation and verification. Commit, push, pull request, merge, release, installed-skill activation, destructive work, and external-system mutations are not authorized.
- Orchestration authority: `.rudi/orchestration/plan.json`; host tasks and worker reports are non-authoritative evidence transports.
- Risk: high. This change adds durable decision/promotion semantics and must preserve schema-v1 plan validation.

## Phase 1 — Scope and contracts

### In scope

- Six portable RUDI skill packages with precise triggers, authority boundaries, workflows, failure behavior, and package metadata.
- Additive Decision Frontier state and promotion behavior in the Chief-of-Staff portable project-plan tool.
- Explicit lifecycle composition across Chief of Staff, Grill, Decision Canvas, Impact Map, SWE Issue Loop, Compliance, Context Gardener, Horizontal Review, publish, closeout, and stewardship skills.
- An ADR for the discovery-to-execution authority boundary.
- A human-readable lifecycle catalog backed by registered package IDs.
- Focused contract/state tests, generated registry index, complete registry gates, edited-file debt scan, and independent review.

### Out of scope

- A second orchestrator, automatic GitHub issue creation, background agents, autonomous deployment, secrets management outside RUDI, or automatic implementation authorization.
- Copying Matt Pocock's skills wholesale or retaining unsafe absolutes such as “always commit,” “never abort,” or unbounded implementation.
- Editing machine-local installed projections before canonical source acceptance.
- Commit, push, PR, merge, release, deployment, service restart, or admin-Mac source mutation.

### Invariants

1. `plan.json` remains the sole durable orchestration authority.
2. Discovery records cannot satisfy execution dependencies.
3. Recommendation, human approval, implementation authorization, promotion, readiness, and dispatch are distinct events.
4. Promotion is validated and idempotent; conflicting replay fails closed.
5. Plan mutations serialize and re-read under an exclusive lock; concurrent
   stale writers cannot both accept one source revision.
6. Promotion receipts bind every terminal area and decision plus the complete
   accepted source snapshot; bound outcomes are immutable.
7. Existing schema-v1 plans and commands remain compatible.
8. GitHub issues are optional projections and never completion authority when composed under Chief of Staff.
9. Every skill has one primary lifecycle responsibility and points to adjacent skills instead of duplicating them.
10. External inputs, LLM outputs, files, tool responses, and secrets are boundary-validated; secrets remain RUDI-owned.

### Failure behavior

- Invalid, stale, incomplete, overbroad, or conflicting discovery/promotion input is rejected before plan mutation.
- A failed promotion leaves the plan byte-identical.
- Duplicate replay with the same promotion ID and digest returns the existing result; the same ID with different content fails closed.
- Missing human approval or implementation authorization blocks promotion.
- Unresolved required decisions block promotion; explicitly accepted deferrals remain visible.
- Index or package drift blocks closure.
- Diagnosis-only requests remain read-only unless separate write or
  instrumentation authority is explicit.

### Commit boundaries if later authorized

1. Architecture, failing tests, and Decision Frontier state contract.
2. Six skill packages and lifecycle integrations.
3. Generated index, verification evidence, and closure documentation.

No commit is authorized by this plan.

## Phase 2 — Red proof

- Planned command: `npx vitest run src/portable-agentic-workflow-skills.test.ts src/project-orchestration-decision-frontier.test.ts src/rudi-chief-of-staff.test.ts`.
- Expected failure: the six packages and Decision Frontier promotion command/state do not exist.
- Original result: **RED as expected**, but its raw stream and exact snapshot
  were not persisted and are explicitly marked unavailable rather than claimed
  as reproducible proof.
- Reproducible baseline proof: the tracked
  `.rudi/orchestration/evidence/preimplementation-contract.test.mjs` snapshot
  was run unchanged against exact base revision
  `fd9816b9b45b73a9b43520d48146aa6c782cf5b2` and the final worktree. Base:
  exit 1, 0/7 passed, with six absent skill bundles and absent schema-v2
  Decision Frontier behavior. Final: exit 0, 7/7 passed. Exact raw outputs are
  tracked beside the test.

## Phase 3 — Smallest implementation

- Status: complete.
- Rule: implement one observable contract at a time; do not weaken failing assertions.
- Implemented sequence:
  1. schema-v2 validation for explicit open frontier state while preserving v1;
  2. revision- and decision-digest-bound promotion with exact replay idempotency;
  3. hostile-path checks for open-frontier rejection and conflicting ID reuse;
  4. six approved discovery/review/runbook skill packages;
  5. canonicalized `publish-task-changes` to close the verified-delivery gap;
  6. lifecycle role clarifications across existing RUDI skills; and
  7. generated registry package reconciliation and human-readable catalog;
  8. serialized plan mutation with in-lock re-read;
  9. complete frontier snapshot/history binding and cross-history validation;
  10. strict read-only Diagnose default; and
  11. tracked content-addressed proof artifacts.

## Phase 4 — Green and refactor proof

- Initial focused green command/result: `npx vitest run src/portable-agentic-workflow-skills.test.ts src/project-orchestration-decision-frontier.test.ts src/rudi-chief-of-staff.test.ts` passed 30/30 tests in three files.
- Review-fix red: the added hostile concurrency, history, temporal, deferral,
  and Diagnose-authority assertions failed 5/28 before their corrections.
- Final focused green: the same three-file command passed 35/35 tests.
- Refactor verification: the same focused command remained green after extracting the lifecycle catalog, renaming the Code Review reference to preserve host-neutral trigger checks, and integrating existing skills.
- Known focused-test gaps: there is no manager mutation command for incremental frontier revisions; v2 frontier state is manager-authored and whole-plan validated, while `promote` is the guarded execution conversion. Multi-promotion history is schema-validated; focused coverage now includes promotion, replay, open-frontier rejection, conflicting ID reuse, concurrent writers, pre-approval time, deferral mutation, and promotion/reconciliation revision collision.

## Phase 5 — Horizontal and documentation gates

- Bounded scan result: several existing skills participate in delivery, but only Chief of Staff owns the durable DAG. The correct disposition is **standardize contract**, not consolidate implementations.
- Reassessment trigger: any future skill that claims durable dependency satisfaction, dispatch authority, or plan state mutation outside Chief of Staff.
- ADR and lifecycle catalog: complete in `docs/adr/0012-decision-frontier-promotion-boundary.md` and `docs/rudi-engineering-skills.md`.

## Phase 6 — Full verification

- Skill package validation: seven new/canonicalized bundles passed the Skill Creator `quick_validate.py` check through an ephemeral `uv --with pyyaml` runtime. The system Python lacked PyYAML; no repository dependency was added. `uv` also reported a machine-managed `.temp` Python-key warning that did not affect validation.
- `npm test -- --reporter=dot`: passed 30 files and 274 tests.
- `npm run validate`: passed all 167 catalog packages, including 80 skills.
- `npm run indexes:sync`: passed and regenerated the canonical root index plus platform indexes and catalog hash tree.
- `npm run indexes:check`: passed; indexes are current.
- `npm run catalog:clean:check`: passed with 0 planned targets and 0 preserved targets.
- `npm run build`: passed validation and compilation.
- `npm pack --dry-run --json`: passed for `@rudi/registry@2.0.1`; 1,039 files, 2,436,645 packed bytes, and 11,100,786 unpacked bytes. NPM emitted the repository's existing `.npmignore` fallback warnings.
- Edited JS/TS debt scan: exited 0 with 0 errors and one warning. The scanner marks `catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs` unreachable from registry compiler entrypoints; it is intentionally a standalone skill executable invoked by the documented command surface and directly covered by project-orchestration tests. No fake import or task-local global-config exception was added.
- Dependency audit context: `npm ci` reported the locked repository baseline of 8 audit findings (1 moderate, 6 high, 1 critical). No dependency manifest or lockfile changed; automated audit mutation is outside scope.
- Independent Standards/Spec/Proof review: the broad pass returned revise for
  four material findings. One focused confirmation passed the three product
  fixes and required one proof correction. The stale proof claim was removed;
  exact tracked baseline red/green, review-fix red/green, registry-gate, and
  debt artifacts now back the authoritative evidence pointers.
- Plan/evidence integrity: `node .rudi/orchestration/evidence/verify-plan-evidence.mjs`
  passed after review reconciliation, resolving and SHA-256-verifying all 17
  accepted evidence records. Whole-plan validation and `git diff --check` also
  passed.

## Phase 7 — Closure

- Proof correction note: before final closure, stale task-local evidence
  locators/digests were corrected to the actual tracked artifact paths and
  SHA-256 values. Acceptance outcomes and authority claims were not expanded.
- Final changed paths: seven new/canonicalized skill bundles (Decision Frontier,
  Diagnose, Prototype, Stakeholder Questionnaire, Code Review, Human Runbook,
  and Publish Task Changes); eleven existing engineering skill contracts;
  Decision Frontier orchestration code and tests; the generated root index;
  three lifecycle/ADR/compliance documents; and the tracked orchestration plan,
  graph, and proof artifacts. No dependency manifest or lockfile changed.
- Known gaps/debt: incremental frontier state changes remain manager-authored plus whole-plan validation; a future deterministic frontier-revision command must preserve immutable promoted decision records and the single-authority contract. The standalone-script debt warning and locked dependency-audit baseline are disclosed above.
- Publication state: uncommitted and unpublished; no commit, push, pull request,
  merge, release, or deployment was authorized.
- Installed-skill state: unchanged; canonical source was implemented and
  verified without mutating machine-local installed projections.
- Admin-Mac state: unchanged; source synchronization requires an accepted integration boundary and is not inferred from local implementation authorization.
- Definition of Done: complete for the authorized local implementation and
  verification boundary. Publication, installation, and admin-peer sync remain
  separate future actions requiring authorization and an accepted integration
  boundary.
