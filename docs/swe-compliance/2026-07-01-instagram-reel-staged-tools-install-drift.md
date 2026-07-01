## Phase 0: Baseline And Manual Lookup

- Scope: Issue #13, `social-media-publisher` staged Instagram Reel tools are present in registry source but absent from the installed local stack/router exposure.
- Files to inspect before editing:
  - `AGENTS.md`
  - `catalog/stacks/social-media-publisher/manifest.v2.json`
  - `catalog/stacks/social-media-publisher/manifest.json`
  - `catalog/stacks/social-media-publisher/src/index.ts`
  - `catalog/stacks/social-media-publisher/src/adapters/instagram-profile.js`
  - `catalog/stacks/social-media-publisher/test/index.test.ts`
  - `catalog/stacks/social-media-publisher/test/adapters/instagram-profile.test.js`
  - `catalog/stacks/social-media-publisher/docs/credential-setup.md`
  - `catalog/stacks/social-media-publisher/README.md`
  - Installed comparison files under `/Users/hoff/.rudi/stacks/social-media-publisher`
- Relevant SWE manual sections:
  - `/Users/hoff/dev/dev-help/10-Engineering-Operating-Manual-Index.md`
  - `/Users/hoff/dev/dev-help/01-Master-Engineering-Doctrine.txt`, Appendix C: Software Testing Discipline
  - `/Users/hoff/dev/dev-help/01-Master-Engineering-Doctrine.txt`, Appendix D: Debugging Discipline
- Current-state commands:
  - `git -C /Users/hoff/dev/RUDI/apps/registry status -sb` -> `## main...origin/main`
  - `git -C /Users/hoff/dev/RUDI/apps/registry pull --ff-only` -> `Already up to date.`
  - `rg -n "instagram_reel_create_container|instagram_container_status|instagram_publish_container" /Users/hoff/dev/RUDI/apps/registry/catalog/stacks/social-media-publisher` -> registry manifests/source/docs contain staged tools.
  - `rg -n "instagram_reel_create_container|instagram_container_status|instagram_publish_container" /Users/hoff/.rudi/stacks/social-media-publisher` -> installed stack lacks tool definitions and only contains adapter status error strings.
  - `rudi index --json` -> `stack:social-media-publisher` indexed with 16 tools.
  - `rudi list stacks --json` -> active installed stack path `/Users/hoff/.rudi/stacks/social-media-publisher` exposes the older 16-tool set.
- Risks and invariants:
  - Do not modify posting records or story content artifacts.
  - Do not print, inspect, or modify social publishing secrets or token values.
  - Do not perform live Instagram or Meta writes during automated verification.
  - Preserve the staged Reel invariant: create a container, poll that same container, then publish only with explicit confirmation.
- Exit criteria: Completed. Source-vs-installed drift is classified as stale installed local stack state plus missing top-level registry `index.json` tool metadata; a red regression test now covers staged tool exposure across install metadata and MCP `tools/list`.

## Phase 1: Scope Lock

- In scope:
  - Determine whether the defect is registry source, package/install payload, or router index drift.
  - Add focused regression coverage for staged Instagram tool exposure across executable definitions and manifests/package metadata.
  - Make the smallest registry change required to prevent this drift from recurring.
  - Record the local install/reindex smoke command sequence if the source package is already correct.
- Non-goals:
  - Posting record commits.
  - Live publishing or Meta container creation.
  - Secret migration, credential inspection, or account changes.
  - Broad stack refactors unrelated to tool exposure.
- Expected files touched:
  - `docs/swe-compliance/2026-07-01-instagram-reel-staged-tools-install-drift.md`
  - One or more focused tests under `catalog/stacks/social-media-publisher/test/`
  - Registry source/package metadata only if the red test proves a source/package bug.
  - `README.md` or `docs/credential-setup.md` only if verified behavior changes.
- External inputs and trust boundaries:
  - Registry manifests and stack executable source are local package inputs.
  - Installed stack files under `~/.rudi` are diagnostic/smoke inputs, not source-of-truth edits.
  - RUDI index output is runtime state and must be checked without exposing secrets.
- Failure behavior to define:
  - Tests must fail clearly when a staged Instagram tool is present in one exposure surface but absent from another.
  - Install/index smoke checks must identify whether stale local package state remains after the source fix.
- Exit criteria: Completed. Scope is limited to staged Instagram tool exposure and install/index drift prevention.

## Phase 2: Red Tests

- Observable behavior to prove: `social-media-publisher` exposes `instagram_reel_create_container`, `instagram_container_status`, and `instagram_publish_container` consistently across executable tool definitions and manifest metadata used by installation/indexing.
- Test files to add or edit:
  - `catalog/stacks/social-media-publisher/test/index.test.ts`
- Red command: `npm test -- social-media-publisher-stack`
- Expected failure: Failed because `index.json` official `stack:social-media-publisher` metadata did not include `provides.tools`, while manifests and MCP `tools/list` already exposed the staged tools.
- Exit criteria: Completed. The focused behavior-level test failed for the expected metadata drift before implementation.

## Phase 3: Implementation

- Implementation rules:
  - Prefer existing stack test patterns and local helpers.
  - Keep changes scoped to the social-media-publisher package.
  - Avoid new dependencies unless no existing parser/test utility can express the assertion.
- Files allowed to change:
  - `catalog/stacks/social-media-publisher/test/index.test.ts`
  - `catalog/stacks/social-media-publisher/src/index.ts`
  - `catalog/stacks/social-media-publisher/manifest.json`
  - `catalog/stacks/social-media-publisher/manifest.v2.json`
  - `catalog/stacks/social-media-publisher/README.md`
  - `catalog/stacks/social-media-publisher/docs/credential-setup.md`
  - This checklist file
- Validation and error-handling requirements:
  - Manifest/tool-name tests must validate all required names and report missing names explicitly.
  - Do not rely on live provider credentials for regression proof.
- Observability requirements:
  - No runtime observability changes expected unless the defect is in executable tool dispatch.
- Exit criteria: Completed. Added `provides.tools` to the `stack:social-media-publisher` entry in `index.json`.

## Phase 4: Green Tests And Refactor

- Green command: `npm test -- social-media-publisher-stack` -> passed.
- Refactor constraints:
  - Refactor only if the focused tests are green.
  - Do not rewrite the stack registry structure.
- Regression checks:
  - Targeted social-media-publisher tests.
  - Manifest validation for registry packages.
- Exit criteria: Completed. Red command passes unchanged; no refactor was needed.

## Phase 5: Full Verification

- Targeted tests:
  - `npm test -- social-media-publisher-stack` -> passed.
  - `npm test` in `catalog/stacks/social-media-publisher` -> 67 tests passed.
- Full suite:
  - `npm test` in registry root -> 106 tests passed.
- Build/typecheck/lint:
  - `npm run validate:v2` -> 103 catalog package files passed.
  - `npm run build` -> passed; validation and compile completed.
- JS/TS debt scan, if applicable:
  - No registry-root `.debt-scan.json` or `agent-debt.config.json` exists; ran fallback scanner:
    `node /Users/hoff/dev/dev-help/agent-debt-scan.js --repo /Users/hoff/dev/RUDI/apps/registry --files src/social-media-publisher-stack.test.ts --json` -> 0 findings.
- Live smoke checks:
  - `USE_LOCAL_REGISTRY=true RUDI_REGISTRY_ROOT=/Users/hoff/dev/RUDI/apps/registry rudi update stack:social-media-publisher --preserve-state` -> updated stack and rebuilt tool index.
  - `rg -n "instagram_reel_create_container|instagram_container_status|instagram_publish_container" /Users/hoff/.rudi/stacks/social-media-publisher/manifest.v2.json /Users/hoff/.rudi/stacks/social-media-publisher/manifest.json /Users/hoff/.rudi/stacks/social-media-publisher/src/index.ts` -> staged tools present in installed manifests and executable source.
  - `rudi index stack:social-media-publisher --force --json` -> indexed 1 stack, 0 failures, 19 social-media-publisher tools.
  - `rudi list stacks --json | jq '.[] | select(.id=="stack:social-media-publisher") | {id,path,toolCount:((.provides.tools // .tools) | length),tools:(.provides.tools // .tools)}'` -> 19 tools including all staged Instagram tools.
  - `jq '.byStack["stack:social-media-publisher"].tools | map(.name) | map(select(test("instagram_reel_create_container|instagram_container_status|instagram_publish_container")))' /Users/hoff/.rudi/cache/tool-index.json` -> all three staged tools present.
  - `rudi daemon status --json` -> daemon ready, healthy, tool index ready with 368 tools and 0 failures.
- Exit criteria: Completed. Tests, validation, debt scan, and non-destructive smoke checks are green.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
  - Update README or credential setup docs only if behavior/usage changed.
  - Update issue #13 with scope, proof commands, and residual risk.
- Final files touched:
  - `index.json`
  - `src/social-media-publisher-stack.test.ts`
  - `docs/swe-compliance/2026-07-01-instagram-reel-staged-tools-install-drift.md`
- Commands run and results:
  - Baseline commands from Phase 0.
  - Red: `npm test -- social-media-publisher-stack` -> failed because `index.json` omitted `provides.tools`.
  - Green: `npm test -- social-media-publisher-stack` -> passed.
  - Stack tests, full registry tests, validation/build, debt scan, and RUDI smoke commands from Phase 5 -> passed.
- Accepted debt: None.
- Definition of Done:
  - Issue #13 has a linked checklist and PR.
  - Local registry branch contains no posting artifacts.
  - Staged Instagram tools are covered by regression tests.
  - Registry validation passes.
  - RUDI install/index smoke evidence is recorded.
