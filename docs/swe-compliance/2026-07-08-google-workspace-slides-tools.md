## Phase 0: Baseline And Manual Lookup

- Scope: Add native Google Slides MCP tools to the RUDI Google Workspace stack.
- Files inspected before editing: `catalog/stacks/google-workspace/src/index.ts`, `package.json`, `manifest.json`, `manifest.v2.json`, `README.md`, existing MCP tests.
- Relevant SWE manual sections: Appendix C testing doctrine, API boundary standards, security standards for credentials and external actions.
- Risks and invariants: Do not print OAuth secrets or token values; validate malformed tool inputs before auth/network calls; do not mutate live Google Slides files without explicit user confirmation.
- Exit criteria: RUDI exposes read/thumbnail Slides tools plus a raw validated `batchUpdate` wrapper.

## Phase 1: Scope Lock

- In scope: `slides_get_presentation`, `slides_get_slide`, `slides_get_thumbnail`, `slides_batch_update`, tool schemas, input validation, docs, manifests, installed stack sync.
- Non-goals: High-level slide layout helpers, creating/deleting presentations, live batch mutation smoke against a user deck.
- Expected source files touched: `src/index.ts`, `slides.test.cjs`, `package.json`, `README.md`, `manifest.json`, `manifest.v2.json`.
- External inputs and trust boundaries: MCP tool arguments are untrusted; Google API responses are returned as data; OAuth state remains in RUDI state/secrets.
- Failure behavior to define: Malformed `requests`, invalid `thumbnail_size`, missing presentation IDs, and missing slide IDs return MCP errors instead of attempting Google calls.
- Exit criteria: Scope and red test are locked before implementation.

## Phase 2: Red Tests

- Observable behavior to prove: Slides tools are listed with required schema fields and validation errors happen before auth.
- Test file added: `catalog/stacks/google-workspace/slides.test.cjs`.
- Red command: `npm run test:slides`.
- Expected failure: `slides_get_presentation must be exposed`.
- Result: Failed as expected with `AssertionError [ERR_ASSERTION]: slides_get_presentation must be exposed`.

## Phase 3: Implementation

- Implementation rules: Match existing inline MCP schema and handler style; add narrow helpers for raw object-array validation, write control validation, presentation ID normalization, and thumbnail size validation.
- Files changed: Google Workspace stack source/docs/manifests/package metadata and installed stack mirror.
- Validation and error-handling requirements: Reject non-array `requests`, empty request arrays, non-object request entries, non-object `write_control`, invalid presentation IDs, and invalid thumbnail sizes.
- Observability requirements: Return structured JSON summaries for Slides API calls; no secrets in output.
- Exit criteria: Source build passes and installed stack runtime includes the handlers.

## Phase 4: Green Tests And Refactor

- Green command: `npm run test:slides`.
- Regression checks: `npm run test:auth`, `npm run test:state`, `npm run test:tasks`, `npm run build`.
- Refactor constraints: No unrelated Gmail/Docs/Drive behavior changes.
- Result: Focused stack tests and TypeScript build passed.

## Phase 5: Full Verification

- Full suite: Registry `npm test`.
- Build/typecheck/catalog validation: Registry `npm run build`.
- RUDI index: `rudi index --json`.
- JS/TS debt scan: RUDI SWE debt scan at the Google Workspace package root with `src/index.ts` and `src/auth.ts` as explicit entrypoints; 0 findings.
- Live smoke checks: Direct installed MCP smoke with `rudi@learnrudi.com` read the user deck, read slide `g3e7fd8d1bce_0_0`, and fetched a thumbnail URL.
- Exit criteria: No blocking verification gaps.

## Phase 6: Docs, Contracts, And Closure

- Docs and contracts updated: README tools/requirements/safety guidance, `manifest.json`, `manifest.v2.json`, package test script.
- Installed local stack updated: `~/.rudi/stacks/google-workspace` source, dist, README, package, tests, and manifests synced from the catalog.
- Accepted debt: Live mutation smoke for `slides_batch_update` was intentionally skipped because it would change an external Google file; schema and validation are covered by tests.
- Definition of Done: RUDI can discover and run native Google Slides read/thumbnail tools from the installed Google Workspace MCP stack, with raw batch update available behind explicit user-confirmed use.
- Closure status: Complete for native Slides MCP support.
