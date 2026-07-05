## Phase 0: Baseline And Manual Lookup

- Scope: make `catalog/stacks/video-editor` the canonical downloadable stack source, promote intentional installed-stack changes from `~/.rudi/stacks/video-editor`, and keep runtime artifacts out of registry package outputs.
- Files to inspect before editing: `AGENTS.md`, `CLAUDE.md`, `src/compile.ts`, `src/compile.test.ts`, `catalog/stacks/video-editor/**`, and the installed `~/.rudi/stacks/video-editor/**` tree excluding generated runtime directories.
- Relevant SWE manual sections: Build Order phases 2-3, Backend Appendix G operation boundaries, API Appendix E contract/error behavior, Infrastructure Appendix H packaging/runtime promotion, Testing Appendix C red-green-refactor.
- Current-state commands: `git status -sb`, targeted `diff -qr`, `npm run build`, `npm test`, `npm run validate:v2`, catalog hash file discovery.
- Risks and invariants: do not touch unrelated dirty registry work; do not publish local media, account state, Chrome profiles, or generated outputs; keep MCP tool manifests aligned with server behavior; installed stack must be reproducible from registry.
- Exit criteria: baseline is recorded and the first behavior gap has a red test.

## Phase 1: Scope Lock

- In scope: registry catalog hash/runtime-artifact guard, video-editor source promotion, state-root consistency, stack docs/ADR, tests, build and registry validation.
- Non-goals: rewriting the video editing pipeline, changing unrelated stacks/skills/index edits already present, deleting user media without migration or explicit proof.
- Expected files touched: `src/compile.ts`, `src/compile.test.ts`, `catalog/stacks/video-editor/**` source/docs/tests, `docs/swe-compliance/2026-07-05-video-editor-stack-e2e-cleanup.md`, and a narrow ADR/doc file if justified.
- External inputs and trust boundaries: installed stack source is untrusted until compared and filtered; runtime files are local state, not catalog payload; MCP/tool inputs remain validated by existing schemas.
- Failure behavior to define: compiler must exclude generated runtime directories even when they exist inside catalog source; run slug lookup must fail clearly when no state run exists.
- Exit criteria: promote/exclude decisions are repo-evident or escalated as human-only decisions.

## Phase 2: Red Tests

- Observable behavior to prove: catalog hash generation excludes stack runtime directories such as `runs`, `downloads`, `tmp`, `.chrome-profiles`, and `composer/public/media`.
- Test files to add or edit: `src/compile.test.ts`.
- Red command: `npm test -- src/compile.test.ts`.
- Expected failure confirmed: a fixture runtime artifact appeared in `dist/catalog.sha256.json` before the shared artifact ignore policy was added.
- Additional red command: `npm test -- src/public-readiness.test.ts`.
- Expected failure confirmed: tracked `catalog/stacks/*/runs/*` content did not produce a public-readiness error before the guard was added.
- Exit criteria: failure is confirmed before implementation.

## Phase 3: Implementation

- Implementation rules: smallest change that passes the red test; no new dependencies; preserve existing registry package discovery; promote only intentional source/doc/test files from installed stack.
- Files allowed to change: files listed in Phase 1 plus files required by the installed-stack promotion evidence.
- Validation and error-handling requirements: runtime path resolution must use explicit state roots; output/package filtering must be explicit; no silent fallback to catalog-local runs.
- Observability requirements: registry compile output should continue reporting catalog hash file count; tests should expose leaked paths clearly.
- Exit criteria: targeted red test passes unchanged.

## Phase 4: Green Tests And Refactor

- Green command: `npm test -- src/compile.test.ts`.
- Refactor constraints: no broad refactors; keep helper names and constants local to packaging policy unless reused.
- Regression checks: stack `npm run build`, stack `npm test`, registry `npm run validate:v2`.
- Final refactor: shared catalog artifact policy lives in `src/catalog-artifacts.ts` and is reused by compile, public-readiness, and package allowlist validation.
- Exit criteria: targeted and package-level verification passes.

## Phase 5: Full Verification

- Targeted tests: compile hash exclusion, video-editor tests for state layout and promoted operations.
- Full suite: relevant registry tests if feasible without disturbing unrelated dirty work.
- Build/typecheck/lint: `npm run build` in `catalog/stacks/video-editor`.
- JS/TS debt scan, if applicable: run stack debt scanner for edited JS/TS paths or structural fallback.
- Live smoke checks: MCP tool list or `node src/cli.js --help`; template list smoke; install/update smoke if local registry update is safe.
- Commands passed:
  - `npm test -- src/compile.test.ts src/public-readiness.test.ts`
  - `npm test`
  - `npm run build`
  - `npm run validate:public -- --json`
  - `npm pack --dry-run --json` package summary: 683 entries, zero forbidden runtime paths, zero stale `dist/stacks/*.tar.gz` files.
  - `(cd catalog/stacks/video-editor && npm run build)`
  - `(cd catalog/stacks/video-editor && npm test)`
  - Video-editor debt scan with `.debt-scan.json`: zero findings.
  - Composer debt scan with `composer/.debt-scan.json`: zero findings.
  - Registry structural debt scan with `src/compile.ts` and `src/public-readiness.ts` as entrypoints: zero findings.
- State migration evidence: installed stack source is approximately 670M; runtime state now lives under `~/.rudi/state/stacks/video-editor` at approximately 35G.
- Exit criteria: verification commands pass or residual risks are explicitly recorded.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: README, template-composer docs, manifests, ADR/state-boundary note.
- Final files touched:
  - Registry artifact policy and validation: `src/catalog-artifacts.ts`, `src/compile.ts`, `src/compile.test.ts`, `src/public-readiness.ts`, `src/public-readiness.test.ts`, `package.json`, `.github/workflows/registry.yml`.
  - Video-editor source and docs: `catalog/stacks/video-editor/.gitignore`, `README.md`, `composer/README.md`, `composer/scripts/render-run.mjs`, `manifest.json`, `src/cli.js`, `src/operations/cut-silence.js`, `src/operations/init.js`, `src/operations/download-intake.js`, `test/download-intake.test.js`, `test/init.test.js`.
  - Shared docs: `SCHEMA.md`, `catalog/stacks/README.md`, `docs/adr/0001-public-registry-artifact-boundary.md`.
  - Cleanup artifacts: `catalog/stacks/google-ai/.gitignore` plus removal of tracked generated PNGs under `catalog/stacks/google-ai/output/`.
- Commands run and results:
  - Initial red/green compile and public-readiness tests followed the RGR loop.
  - Full registry tests passed: 12 files, 109 tests.
  - Registry build passed: 86 catalog package files, 649 catalog hash payload files.
  - Video-editor build and tests passed: 16 JS/MJS tests and 12 TS tests.
  - Public-readiness passed: 0 errors, 0 warnings.
  - NPM package dry-run passed artifact boundary: no forbidden runtime paths and no stale stack tarballs.
- Accepted debt:
  - The repository still contains broad pre-existing dirty changes outside this cleanup, including skill removals, stack removals, and unrelated registry test edits. They were not reverted.
  - `catalog/skills/trace-feature-lineage.md` was staged because the dirty `index.json` already referenced it and public-readiness models `git ls-files` release content.
- Definition of Done: registry source is canonical, runtime artifacts are excluded, installed-stack source drift is resolved for the promoted video-editor changes, tests/build/validation pass, package dry-run proves the public boundary, and docs describe the verified behavior.
