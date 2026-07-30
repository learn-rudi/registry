# Site Planner RUDI Stack — SWE Compliance Plan

Status: **Implementation and always-on-Mac verification complete**

## Phase 0: Baseline And Manual Lookup

- Scope:
  - Add a portable `stack:site-planner` MCP adapter in the RUDI Registry.
  - Pin runtime execution to one configured, clean Site Planner Git revision.
  - Keep the Site Planner workspace and adapter artifact roots fixed in trusted
    local configuration rather than agent-controlled tool arguments.
- Files to inspect before editing:
  - Registry `AGENTS.md`, manifests, catalog tests, and package validators.
  - Site Planner `AGENTS.md`, agent-operation contract, CLI adapter, schemas,
    examples, and tests at commit `96a6a29ed1f458ff1d29605a337fe9c803029973`.
- Relevant SWE manual sections:
  - Master Doctrine Appendix C (behavior-level red-green-refactor).
  - Security Appendix F5, F6, and F13 (boundaries, secrets, agent authority).
  - Backend Appendix G2-G5, G7, G9, and G12-G13.
  - Infrastructure Appendix H1, H6, H9, and H10.
- Current-state commands:
  - `git status --short --branch`
  - `npm test -- --run src/site-planner-stack.test.ts`
  - `npm run validate:v2`
- Risks and invariants:
  - Agent input never supplies a filesystem root, executable, command, or Git
    revision.
  - The adapter executes only the allowlisted Site Planner CLI.
  - The configured checkout must match the exact expected commit and be clean.
  - Write operations require a bounded HMAC authorization produced by the
    Service Desk approval boundary; runtime tool permission alone is
    insufficient.
  - Site Planner remains jurisdiction-neutral and makes no zoning,
    entitlement, parking, or underwriting claims.
- Exit criteria:
  - Baseline contracts and runtime paths are verified.
  - The expected files and behaviors below are scope-locked before code changes.

## Phase 1: Scope Lock

- In scope:
  - Tools for configuration status, inspect, generate, optimize, preview, fork,
    and apply.
  - Fixed-root execution through the existing Site Planner JSON CLI.
  - Bounded private result artifacts with commit and request provenance.
  - HMAC-bound authorization for `forkConcept` and `applyConceptCommands`.
  - Registry catalog metadata, package tests, and an always-on-Mac install.
- Non-goals:
  - No Site Planner engine changes.
  - No zoning, legal-fit, frontage, finance, or entitlement logic.
  - No unrestricted command execution or caller-selected paths.
  - No browser control, active-session discovery, cloud tenancy, or direct
    email behavior.
- Expected files touched:
  - `catalog/stacks/site-planner/README.md`
  - `catalog/stacks/site-planner/manifest.json`
  - `catalog/stacks/site-planner/manifest.v2.json`
  - `catalog/stacks/site-planner/package.json`
  - `catalog/stacks/site-planner/package-lock.json`
  - `catalog/stacks/site-planner/src/core.js`
  - `catalog/stacks/site-planner/src/index.js`
  - `catalog/stacks/site-planner/test/core.test.mjs`
  - `catalog/stacks/site-planner/test/mcp.test.mjs`
  - `src/site-planner-stack.test.ts`
  - `index.json`
  - this plan
- External inputs and trust boundaries:
  - MCP tool arguments, stack configuration JSON, filesystem state, Git output,
    Site Planner CLI output, clocks, and write-authorization signatures are all
    untrusted until validated.
- Failure behavior to define:
  - Invalid config, wrong/dirty revision, missing Node/CLI, malformed or
    oversized request/result, timeout, nonzero CLI exit, mismatched operation,
    expired or invalid write authorization, artifact conflict, and MCP error.
- Exit criteria:
  - Interfaces are documented before implementation and all non-goals remain
    outside the change.

## Phase 2: Red Tests

- Observable behavior to prove:
  1. Configuration validation refuses agent-controlled roots and refuses a
     checkout that is not the configured clean commit.
  2. A read operation invokes only the configured Site Planner CLI with the
     fixed workspace root, validates the result, and writes bounded provenance.
  3. Fork/apply fail closed without a valid, unexpired, request-bound Service
     Desk HMAC authorization.
  4. The MCP server exposes only the seven registered tools and returns
     structured JSON/error content.
- Test files to add:
  - `catalog/stacks/site-planner/test/core.test.mjs`
  - `catalog/stacks/site-planner/test/mcp.test.mjs`
  - `src/site-planner-stack.test.ts`
- Red commands:
  - `npm test --prefix catalog/stacks/site-planner`
  - `npm test -- --run src/site-planner-stack.test.ts`
- Expected failure:
  - The package, adapter functions, manifests, and catalog entry do not exist.
- Exit criteria:
  - Each behavior fails for the expected missing implementation before code is
    added.

Evidence:

- `node --test test/core.test.mjs` failed with `ERR_MODULE_NOT_FOUND` before
  `src/core.js` existed.
- The bounded-result regression failed because result hashing incorrectly used
  the 1 MiB request limit; the unchanged test passed after separating the
  configured result bound.
- `node --test test/mcp.test.mjs` timed out before `src/index.js` existed.
- `npm test -- --run src/site-planner-stack.test.ts` failed while the manifests
  and catalog entry were absent.
- The installed RUDI runtime exposed a packaging mismatch: the adapter package
  declared Node `>=22.18` even though RUDI correctly launches portable adapters
  on its bundled Node 20 and the adapter separately invokes Site Planner with
  configured Node 22. A catalog assertion failed on `>=22.18` before the
  adapter engine range was corrected to `>=20.10`.

## Phase 3: Implementation

- Implementation rules:
  - Use the MCP SDK already standard in Registry stacks.
  - Invoke the existing Site Planner CLI; do not copy engine logic.
  - Use exact-key validation, byte/depth/count bounds, absolute fixed roots,
    minimal child environment, explicit timeout, and bounded buffers.
  - Persist private artifacts atomically with request/result digests and commit
    provenance; never log full private Concept data.
- Files allowed to change:
  - Only the files listed in Phase 1.
- Validation and error-handling requirements:
  - Unknown fields and operation mismatches fail closed.
  - Write grants bind operation, request digest, approval Decision, approved
    Operation, expiry, and HMAC key version.
  - CLI and artifact failures return safe messages without absolute paths,
    stack traces, secrets, write signatures, or Concept payloads.
- Observability requirements:
  - Status exposes safe readiness facts and deployed commit.
  - Result manifests record tool, operation, request/result digests, Site
    Planner commit, timestamp, and safe approval identifiers for writes.
- Exit criteria:
  - The focused red commands pass with the smallest coherent adapter.

## Phase 4: Green Tests And Refactor

- Green commands:
  - Rerun the unchanged focused commands from Phase 2.
- Refactor constraints:
  - Preserve fixed-root, exact-commit, write-authorization, timeout, and
    artifact invariants.
- Regression checks:
  - Stack unit and MCP tests.
  - Registry stack-package test.
- Exit criteria:
  - Focused behavior remains green after cleanup.

Evidence:

- `npm test --prefix catalog/stacks/site-planner`: 6 tests passed.
- `npm test -- --run src/site-planner-stack.test.ts`: 1 test passed.
- `node --check src/core.js` and `node --check src/index.js`: passed.
- Refactor verification reran the unchanged stack tests successfully.

## Phase 5: Full Verification

- Targeted tests:
  - `npm test --prefix catalog/stacks/site-planner`
  - `npm test -- --run src/site-planner-stack.test.ts`
- Full suite:
  - `npm test`
- Build/typecheck/lint:
  - The stack is runtime JavaScript and has no separate compilation step.
  - `npm run validate:v2`
  - `npm run build`
- JS/TS debt scan:
  - Run the repository debt scanner against only the new stack, its catalog
    test, and the touched Registry index neighborhood.
- Live smoke checks:
  - Install the stack on the always-on Mac.
  - Configure the exact Site Planner commit, Node 22 executable, fixed Dwellow
    workspace, and private artifact root.
  - Rebuild the RUDI tool index and verify all seven tools register.
  - Execute configuration status and one synthetic read-only Site Planner
    operation.
  - Prove a write operation rejects a missing/invalid approval grant.
- Exit criteria:
  - All checks pass and the remote stack is registered against the pinned
    verified Site Planner checkout.

Local evidence:

- `npm test`: 13 files and 110 tests passed. The clean worktree first required
  `npm ci --ignore-scripts` in the existing `social-media-publisher` fixture so
  its MCP process could resolve its declared SDK.
- `npm run build`: validation passed for all 88 catalog packages and compilation
  completed.
- `npm audit --json` in `catalog/stacks/site-planner`: 0 vulnerabilities.
- Structural debt scan with `src/index.js` as the adapter entrypoint: 0
  findings.
- Structural debt scan for `src/site-planner-stack.test.ts`: 0 findings.
- `git diff --check`: passed.
- A bounded credential/private-key and workstation-path scan of the touched
  files returned no matches.

Remote evidence:

- Installed from reviewed Registry commit
  `86c164f5bca19506b7c3c8a4030fb0ea41aaa733` through RUDI's local-registry
  install path.
- Preserved the prior four-tool pilot stack, its RUDI registration, and tool
  index in an owner-only recovery directory before replacement.
- Configured the exact Site Planner commit, Node `v22.23.2`, fixed owner-only
  workspace, and separate private artifact root.
- RUDI registered and indexed all seven tools without stack failures.
- `site_planner_config_status` returned ready at the expected commit and Node
  version.
- `site_planner_inspect_concept` successfully inspected the existing synthetic
  nine-parcel Concept revision 1 and wrote bounded provenance artifacts.
- `site_planner_fork_concept` without a write authorization failed closed with
  a structured `invalid_arguments` response and created no revision.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
  - Stack README, manifests, Registry index, and this ledger.
- Final files touched:
  - Record the exact list from Git before commit.
- Commands run and results:
  - Record red, green, build, validation, debt, and remote smoke commands.
- Accepted debt:
  - No public cloud tenancy or generalized approval service in this change.
  - The pilot remains a single-owner local runtime.
- Definition of Done:
  - The adapter is committed and pushed as a reviewable Registry change.
  - The exact adapter revision is installed and indexed on the always-on Mac.
  - Fixed-root and write-authorization failure paths are proven.
  - Docs and manifests match the verified runtime.

Current closure state:

- Stack README, manifests, Registry index, package tests, and compliance ledger
  match the locally verified runtime.
- Draft PR `learnrudi/registry#16` contains the reviewable change.
- Fresh Registry CI passed validate/compile and the macOS, Ubuntu, and Windows
  validation jobs.
- The exact reviewed stack is installed, configured, indexed, and smoke-tested
  on the always-on Mac.
