# Admin Operational Skill Promotion

## Phase 0: Baseline And Manual Lookup

- Status: complete.
- Scope: promote release-ready RUDI workflow skills from the dirty RUDI Mac development checkout into a clean, reviewable registry branch, then deploy the accepted release to Admin Mac as the canonical live node.
- Files inspected before editing: registry `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, package scripts, current worktrees and branches, the existing Chief of Staff commit, the portable-workflow compliance record, and the five revised skill diffs.
- Relevant SWE manual sections: Master Doctrine Appendix C; Infrastructure Standard H1, H3-H5, H9, and H10.
- Current-state commands: `git status --short --branch`, `git worktree list --porcelain`, `git diff --name-status origin/main...HEAD`, Admin registry/package parity checks, router status, and RUDI Compute health.
- Risks and invariants:
  - The dirty RUDI Mac registry is development state and must remain untouched.
  - Admin's registry checkout stays clean and advances only to a verified commit.
  - `index.json` is regenerated; the dirty development index is never copied.
  - `~/.rudi` is derived runtime state, not registry source.
  - Secrets and mutable stack state are never copied between machines.
  - An operator skill may not be promoted ahead of the stack contract it describes.
- Initial risk tier and rationale: medium for portable workflow publication and Admin deployment; stack-coupled revisions retain their existing package-specific risk classification and gates.
- Exit criteria: release units, dependencies, rollback boundary, and proof commands are explicit.

## Phase 1: Scope Lock

- Status: complete for the portable-skills release unit.
- In scope for the first release unit:
  - `skill:rudi-chief-of-staff`
  - `skill:rudi-context-gardener`
  - `skill:rudi-decision-canvas`
  - `skill:rudi-swe-issue-loop@1.1.0`
  - `skill:swe-compliance-checklist@1.1.0`
  - focused tests, prior compliance evidence, and generated registry artifacts.
- Deferred to their complete stack release units:
  - Image Generator operator guidance with `stack:image-generator` login-lifecycle changes.
  - OpenCounter operator guidance with the OpenCounter and Dwellow contract changes.
  - RUDI CRM operator guidance with the additive CRM migration and stack changes.
- Non-goals: copying all dirty registry changes, copying secrets or runtime state, changing unrelated Google Workspace work, deleting user worktrees, or making optional integrations appear configured.
- Expected files touched: the five skill packages above, two focused test files, two compliance records, and generated `index.json`/`dist` artifacts.
- External inputs and trust boundaries: dirty-worktree files, Git history and remote state, generated package index, Admin SSH boundary, Admin local registry root, agent wrapper destinations, and live router/Compute status.
- Failure behavior: stop before publication on scope drift or failed gates; stop before Admin deployment if its checkout is dirty or not fast-forwardable; preserve the previous release commit for rollback; leave optional integrations explicitly configuration-gated.
- Authorized external actions: create a scoped branch/worktree, commit, push, open and merge the registry pull request, fast-forward Admin, install/update packages, regenerate agent wrappers and router cache, and perform read-only operational verification.
- Review and approval gates: exact staged-diff audit, required registry checks, GitHub CI, manager review, Admin preflight, and post-deploy smoke checks.
- Exit criteria: the staged release contains only the declared first-unit files and generated artifacts.

## Phase 2: Red Tests

- Status: satisfied by the originating implementation records; no new behavior is authored during promotion.
- Observable behavior to prove: bundled skill discovery, portable scripts, host-neutral workflow contracts, and safe Codex/Claude projection.
- Red commands and expected failures are preserved in:
  - `docs/swe-compliance/2026-08-08-portable-agentic-workflow-skills.md`
  - `src/rudi-chief-of-staff.test.ts`
- Promotion-specific proof: run the focused tests unchanged in the clean worktree before staging.
- Exit criteria: focused tests pass against the exact isolated release contents.

## Phase 3: Implementation

- Status: complete for the portable-skills release unit.
- Implementation rules: reuse the existing Chief commit; transfer only task-owned portable-workflow files; regenerate indexes through repository scripts; add no dependencies; do not modify stack packages in this release unit.
- Files allowed to change: the Phase 1 first-unit paths and canonical generated artifacts only.
- Validation and error-handling requirements: registry schema validation, package discovery, duplicate-ID rejection, output escaping/overwrite protection, and host-projection parity remain enforced by tests.
- Observability requirements: commit SHA, GitHub checks, Admin installed versions, wrapper counts, router status, and Compute health are recorded.
- Exit criteria: the isolated diff matches scope and all generated artifacts are current.

## Phase 4: Green Tests And Refactor

- Status: complete for the portable-skills release unit.

- Green commands: focused Chief and portable-workflow tests, followed by the unchanged full registry suite.
- CI exposed a pre-existing clean-checkout defect in `src/compile.test.ts`: the suite read ignored `dist/index*.json` before generating them. The local pre-publication run had hidden the defect because a prior build populated `dist/`.
- Red evidence: GitHub Actions run `31286320122`, job `93175717129`, failed four compiler tests with `ENOENT` for `dist/index.json` and `dist/index.darwin-arm64.json`.
- Smallest fix: a file-level `beforeAll` invokes the existing compiler helper so the compiler test owns its generated prerequisites.
- Clean-state green: with the previous `dist/` moved aside, `npx vitest run src/compile.test.ts` passed 22/22.
- The next CI run (`31286505896`, job `93176214542`) passed tests, build, provenance, and public-readiness checks, then exposed a second pre-existing determinism defect: `indexes:check` rebuilt with GitHub's synthetic pull-request merge timestamp instead of the committed canonical index timestamp.
- Red evidence for the workflow contract: `npx vitest run src/quality-gates.test.ts` failed because neither build job configured `SOURCE_DATE_EPOCH`.
- Smallest provenance fix: both the validation and release jobs validate `index.json.generatedAt` and export it as `SOURCE_DATE_EPOCH` before compilation. This preserves the release-authored timestamp while all catalog content still undergoes exact regeneration and comparison.
- Provenance green: the quality-gate test passed 2/2 and `indexes:check` passed when driven by the committed index timestamp.
- Refactor constraints: no production refactor was made; the repair is isolated to test setup.
- Regression checks: catalog discovery, index consistency, package dry-run, and native skill projection.
- Exit criteria: focused and regression checks remain green after index generation.

## Phase 5: Full Verification

- Status: complete.

- Targeted tests: `npx vitest run src/rudi-chief-of-staff.test.ts src/portable-agentic-workflow-skills.test.ts`.
- Full suite: `npm test`.
- Build/typecheck/lint: `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run stacks:verify -- --changed-from origin/main --prepare`, `npm run build`, `npm run release:verify`, and `npm pack --dry-run --json`.
- JS/TS debt scan: `npm run debt:scan`.
- Live smoke checks: install/update the five skills from Admin's clean local registry, force-sync Codex and Claude wrappers, verify canonical package/version parity, rebuild router cache, and verify daemon and RUDI Compute health.
- Independent review: manager performs a fresh diff/evidence pass; CI provides an additional clean-environment check. No subagent review is available because delegation was not authorized.
- Risk-tier approval: the user explicitly authorized execution and Admin deployment in this goal.
- Exit criteria: every applicable gate passes or an exact pre-existing/non-blocking exception is recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: this promotion record only; package-specific records remain authoritative for their implementations.
- Final files touched: the scoped release files recorded by pull request 19, the two CI-hardening changes exposed by clean GitHub runners, generated `index.json`, and this closure record.
- Commands run and results: pre-publication and post-deployment proof are recorded below.
- Evidence artifacts: release commit/PR, CI result, Admin parity output, router/daemon state, Compute health/schedule output, and rollback commit.
- Independent-review result: exact staged-diff audit found no out-of-scope catalog or stack changes; GitHub validated the release on Ubuntu, macOS, and Windows.
- Final verdict: approved and deployed. Admin is operationally current with the accepted registry release.
- Accepted debt:
  - Nine installed stacks remain configuration-gated rather than falsely configured: CAGIS, Document QA, Google AI, Hamilton County Auditor, Neon, RUDI Share, Slack, SQLite, and Vercel.
  - `stack:supabase-mcp` remains installed but its hosted OAuth discovery timed out after 20 seconds during indexing.
  - The non-canonical legacy `stack:zoho-calendar@1.0.0` remains installed; it was not removed during a skills release.
  - `rudi status` and `rudi agent hosts` disagree about Claude binary discovery; the dedicated host preflight reports Claude installed, authenticated, router-configured, and skill-synchronized.
  - `rudi check` does not accept `skill:*`; skill proof therefore uses registry/installed-version parity plus native-wrapper existence.
  - Admin's existing `RUDI/system` checkout has unrelated user changes, so the updater is installed machine-locally with a recorded hash instead of modifying that dirty repository.
- Proof gaps: no secret-dependent smoke was attempted for configuration-gated stacks, and no machine-local secrets were copied. The three development-only operator revisions for Image Generator, OpenCounter, and RUDI CRM remain held with their complete stack release units and are not Admin drift from accepted `main`.
- Definition of Done: Admin's clean registry and derived RUDI/Codex/Claude skill state match the approved release; optional integration gates are truthful; the RUDI Mac dirty worktree remains intact; rollback is possible from the previous commit.

## Pre-Publication Evidence

- Focused green: `npx vitest run src/rudi-chief-of-staff.test.ts src/portable-agentic-workflow-skills.test.ts` passed 10/10.
- Full registry suite: `npm test` passed 167/167 across 20 files.
- Schema validation: `npm run validate` passed 152/152 catalog packages.
- Index generation/check: `npm run indexes:sync` and `npm run indexes:check` passed with 67 skills and 48 stacks.
- Catalog hygiene: `npm run catalog:clean:check` planned zero removals.
- Stack verification: no changed stacks required verification for this release unit.
- Structural debt scan: zero errors, warnings, or informational findings.
- Build and provenance: `npm run build` and `npm run release:verify` passed; seven generated release artifact hashes verified.
- Package smoke: `npm pack --dry-run --json` passed with 956 entries and an unpacked size of 10,052,006 bytes.
- Dependency audit signal: `npm ci` reported eight pre-existing toolchain findings (one moderate, six high, one critical). No dependency manifest or lockfile changed in this release, and automatic dependency mutation is outside the scoped promotion.

## Publication And Admin Deployment Evidence

- Pull request: `learnrudi/registry#19`, merged as `94047185b3be0c75d5f3702046bfe0735df1cd1a`.
- Pull-request CI: run `31286653312` passed Test/Build/Verify and manifest validation on Ubuntu, macOS, and Windows.
- Main release CI: run `31286698248` passed Test/Build/Verify, all cross-platform validation, and the release artifact job.
- Admin registry: clean `main`, fast-forwarded from rollback commit `f73276b6a74fc985390ba4749978f4c8b33344bc` to the merge commit.
- Package parity: 67/67 canonical skills and 48/48 canonical stacks installed with zero version mismatches; 87 total skills and 49 total stacks include intentional local/legacy packages.
- Promoted versions: Chief of Staff, Context Gardener, and Decision Canvas at `1.0.0`; RUDI SWE Issue Loop and SWE Compliance Checklist at `1.1.0`.
- Native projection: Codex and Claude each contain all 87 installed skill wrappers with zero missing wrapper files.
- Durable update path: `/Users/admin/.local/bin/rudi-registry-update`, exposed through `/Users/admin/.rudi/bins/rudi-registry-update`, SHA-256 `b0af91a814e1a6217e389b2c164e9736c7619e4f24515add5d7fb02dbd3488af`. Check and apply smokes both passed at zero commits behind and zero pending package actions.
- Router and daemon: daemon healthy/ready; 49 stacks indexed, 39 active, 10 truthfully gated, and 443 tools available. One verified-empty orphan directory was removed.
- RUDI Compute: LaunchAgent running with last exit code zero; database integrity `ok`, schema version 2, six registered services, one enabled four-job `editorial-daily` schedule, and current five-minute heartbeat deliveries returning HTTP 200.
- Historical signal: 13 of 14 recorded Compute jobs succeeded; the one dead Editorial Health job predates this deployment and is not an active controller failure.
