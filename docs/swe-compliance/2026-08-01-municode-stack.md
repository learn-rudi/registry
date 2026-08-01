# Municode Provider Stack SWE Compliance Checklist

Status: Implemented and verified; unrelated full-suite migration failures recorded

## Phase 0: Baseline And Manual Lookup

- Scope: add one generic, read-only RUDI MCP stack for bounded access to
  published Municode code libraries, with Cincinnati, Ohio as the first
  reviewed jurisdiction profile.
- Files to inspect before editing:
  - `AGENTS.md`
  - `SCHEMA.md`
  - `catalog/stacks/cagis/**`
  - `catalog/stacks/opencounter/**`
  - `<private-source-root>/zoning/scripts/municode-api-extract.mjs`
  - `<private-source-root>/zoning/sources/municode/cincinnati/**`
- Relevant SWE manual sections:
  - Master Engineering Doctrine Appendix C, especially C7A
  - API Engineering Standard E2, E3, E6, E9, E10, E11, and E12
  - Security Engineering Standard F5, F7, F9, F12, and F13
- Current-state commands:
  - `rudi search municode --json` returned no package.
  - `git status --short` recorded the pre-existing dirty registry worktree.
  - targeted source searches confirmed a tested Municode acquisition pipeline
    in Pre Dev Intel but no RUDI stack.
- Risks and invariants:
  - Municode input and output are untrusted external data.
  - The stack must never accept an arbitrary origin or act as an unrestricted
    HTTP fetcher.
  - Every call is read-only and must remain bound to a reviewed jurisdiction
    profile and exact Municode/Azure origins.
  - Collection and content responses must be bounded.
  - Provider text is evidence, not a model-authored zoning interpretation.
  - Existing user changes in the registry and Pre Dev Intel worktrees must be
    preserved.
- Exit criteria: current implementation, contracts, tests, and repository state
  are understood before any behavior-bearing edit.

## Phase 1: Scope Lock

- In scope:
  - `stack:municode` with Cincinnati as its first profile;
  - publication metadata lookup;
  - bounded child-section listing;
  - bounded section-content lookup for HTML-backed and PDF-backed content;
  - exact provider provenance and stable schema/version fields;
  - registry manifests, package metadata, documentation, tests, and indexes.
- Non-goals:
  - arbitrary URL fetching or arbitrary Municode endpoint access;
  - browser automation, search, email, export, notification, or mutation tools;
  - legal conclusions or parcel-to-zone assignment;
  - replacing Dwellow's normalized `get_zoning_rules` interpretation;
  - changing Pre Dev Intel runtime synchronization in this pass;
  - adding a Service Desk Operation before its prerequisite-reference contract
    can carry a validated zoning code.
- Expected files touched:
  - `catalog/stacks/municode/manifest.json`
  - `catalog/stacks/municode/package.json`
  - `catalog/stacks/municode/package-lock.json`
  - `catalog/stacks/municode/README.md`
  - `catalog/stacks/municode/src/core.js`
  - `catalog/stacks/municode/src/index.js`
  - `catalog/stacks/municode/test/core.test.js`
  - `catalog/binaries/pdftotext.json`
  - generated compatibility manifest and registry indexes
  - this checklist
- External inputs and trust boundaries:
  - MCP tool arguments;
  - configured jurisdiction profile metadata;
  - Municode REST JSON;
  - Municode HTML content;
  - Municode-hosted PDF bytes and `pdftotext` output;
  - dependency HTTP failures, timeouts, and oversized responses.
- Failure behavior to define:
  - reject unknown jurisdictions and unknown fields;
  - reject invalid node identifiers and out-of-profile nodes;
  - reject redirects or source URLs outside exact allowlisted origins;
  - classify HTTP and invalid-payload failures without leaking raw bodies;
  - reject oversized collections, JSON, PDFs, and rendered text;
  - fail closed when PDF extraction is unavailable or empty.
- Exit criteria: the public schemas, result envelopes, origin restrictions, and
  failure behavior are fixed before implementation.

## Phase 2: Red Tests

- Observable behavior to prove:
  - a configured Cincinnati profile resolves its current publication using only
    exact allowlisted Municode endpoints and returns bounded provenance;
  - unknown jurisdictions and unapproved nodes fail before any network call;
  - section reads normalize HTML content without exposing raw markup;
  - PDF-backed sections use only the canonical Municode code-content blob
    origin and fail closed when extraction fails;
  - oversized and malformed dependency responses are rejected.
- Test files to add or edit:
  - `catalog/stacks/municode/test/core.test.mjs`
- Red command:
  - `npm test --prefix catalog/stacks/municode`
- Expected failure:
  - test import fails because `src/core.mjs` does not exist yet.
- Exit criteria: one focused behavior test fails for the expected missing
  implementation reason before production code is added.

## Phase 3: Implementation

- Implementation rules:
  - use explicit result types represented by versioned JSON fields;
  - keep the provider transport dependency-injectable for deterministic tests;
  - enforce a closed jurisdiction registry and exact origin allowlist;
  - keep response sizes, timeouts, pagination, and text lengths bounded;
  - return source identity, publication identity, node identity, retrieval time,
    source URL, and content hash;
  - add no runtime dependencies beyond the existing MCP SDK and declared
    system PDF-text binary.
- Files allowed to change: only the files listed in Phase 1 plus mechanically
  generated indexes and compatibility manifests.
- Validation and error-handling requirements:
  - reject unknown fields at the MCP schema;
  - repeat validation in core code;
  - do not place raw dependency bodies in errors;
  - no retry inside the stack; callers control retries under their workflow
    contract.
- Observability requirements:
  - results include `retrievedAt`, publication identity, source URL, and SHA-256;
  - stderr may report bounded operational errors, while stdout remains MCP-only.
- Exit criteria: the red test passes with the smallest complete implementation.

## Phase 4: Green Tests And Refactor

- Green command:
  - `npm test --prefix catalog/stacks/municode`
- Refactor constraints:
  - preserve behavior-level tests and public schemas;
  - extract shared validation only when it simplifies the boundary.
- Regression checks:
  - rerun the unchanged stack test suite after refactor.
- Exit criteria: all focused tests remain green.

## Phase 5: Full Verification

- Targeted tests:
  - Municode stack package tests.
- Full suite:
  - registry `npm test`.
- Build/typecheck/lint:
  - `npm run build`
  - `npm run indexes:sync`
  - `npm run indexes:check`
  - `npm run validate:public`
  - `npm run catalog:clean:check`
- JS/TS debt scan, if applicable:
  - no repo policy exists; run structural fallback checks against the edited
    stack JavaScript files.
- Live smoke checks:
  - one read-only Cincinnati publication lookup and one bounded section lookup
    may be run against the anonymous public provider after deterministic tests
    are green; no file refresh or external mutation is authorized.
- Exit criteria: deterministic checks pass and any skipped live proof is
  recorded with its residual risk.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update:
  - stack README with tool schemas, boundaries, failure behavior, and examples;
  - v2 manifest plus generated compatibility metadata and indexes;
  - this checklist with exact proof results and accepted debt.
- Final files touched: record after verification.
- Commands run and results: record red, green, refactor, full-suite, build,
  index, public-readiness, debt, and smoke evidence.
- Accepted debt:
  - Pre Dev Intel continues to own its existing acquisition scripts until a
    separately reviewed consumer migration removes duplicated provider
    transport.
  - Service Desk does not call the new stack until its durable Operation and
    prerequisite-reference contracts carry a validated zoning code.
- Definition of Done:
  - the stack is discoverable in generated registry indexes;
  - focused and registry-wide checks pass;
  - exact origin and jurisdiction restrictions are tested;
  - provider responses are bounded and provenance-bearing;
  - documentation matches verified behavior;
  - no existing user changes are overwritten.

## Execution Record

- Scope outcome:
  - added generic `stack:municode` with Cincinnati, Ohio as the first reviewed
    jurisdiction profile;
  - added `binary:pdftotext` as the explicit Poppler dependency for PDF-backed
    municipal-code content;
  - generated registry indexes now contain both package IDs;
  - did not change Service Desk's durable Operation contract because the
    current CAGIS prerequisite reference does not retain a validated zoning
    code for a downstream Municode Operation.
- Red/green evidence:
  - `npm test --prefix catalog/stacks/municode` first failed with
    `ERR_MODULE_NOT_FOUND` for the absent core implementation, then passed the
    publication behavior;
  - the unchanged command next failed because `listCodeSections` did not exist,
    then passed bounded section pagination;
  - the unchanged command next failed because `getCodeSection` did not exist,
    then passed HTML-backed section normalization and provenance;
  - the unchanged command next failed with `unsupported_content_type` for a
    PDF-backed section, then passed canonical-origin PDF extraction;
  - the unchanged command next exposed the wrong `invalid_provider_response`
    classification for missing caller input, then passed with stable
    `invalid_input` behavior;
  - final focused result: 7 tests passed, 0 failed.
- Refactor verification:
  - changed the new executable and test suffixes from `.mjs` to `.js` after
    `npm pack --dry-run --json` proved the root publication allowlist omitted
    `.mjs` files;
  - reran the unchanged focused suite: 7 passed, 0 failed;
  - final pack proof includes all seven Municode package files plus
    `catalog/binaries/pdftotext.json`.
- Deterministic verification:
  - `npm run build`: passed; 99 catalog packages validated and compiled;
  - `npm run indexes:check`: passed; generated indexes are current;
  - `npm run validate:public -- --json`: 0 errors and 0 warnings;
  - `npm run catalog:clean:check`: zero cleanup targets;
  - `node --check` for `src/core.js` and `src/index.js`: passed;
  - structural fallback debt scan for the two edited JavaScript files:
    0 errors, 0 warnings, and 0 informational findings.
- Live read-only smoke:
  - resolved Cincinnati's current Municode publication as job `496340`,
    `Supplement 48 Update 3`;
  - retrieved HTML-backed Chapter 1403 as 15,533 normalized characters with a
    stable SHA-256 digest;
  - retrieved PDF-backed Section 1703-2 as 93,538 normalized characters through
    the canonical Municode blob origin and local `pdftotext`, also with a stable
    SHA-256 digest;
  - all three live results reported `succeeded`; no provider or local source
    state was mutated.
- Full-suite gap:
  - root `npm test` completed with 110 passing tests, one optional skip, and
    eight failures in pre-existing stack-package tests that still open removed
    `manifest.v2.json` paths during the concurrent canonical-manifest migration;
  - the failing files are unrelated to Municode, while catalog, schema,
    compiler, index-sync, public-readiness, hygiene, and all Municode tests
    passed. No unrelated migration tests were edited in this change.
- Final implementation files:
  - `catalog/stacks/municode/manifest.json`
  - `catalog/stacks/municode/package.json`
  - `catalog/stacks/municode/package-lock.json`
  - `catalog/stacks/municode/README.md`
  - `catalog/stacks/municode/src/core.js`
  - `catalog/stacks/municode/src/index.js`
  - `catalog/stacks/municode/test/core.test.js`
  - `catalog/binaries/pdftotext.json`
  - generated `index.json`
  - this checklist
- Accepted debt:
  - Pre Dev Intel retains its existing Municode acquisition transport until a
    separate consumer-migration change establishes the RUDI stack as its one
    provider boundary;
  - Service Desk integration remains gated on a versioned Operation and
    prerequisite-reference change that preserves the validated CAGIS zoning
    code;
  - the unrelated root-test migration failures remain owned by the active
    registry canonical-manifest migration.
