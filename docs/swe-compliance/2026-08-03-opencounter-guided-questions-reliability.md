# OpenCounter Guided Questions Reliability — SWE Compliance Checklist

Status: **Complete**

## Phase 0: Baseline And Manual Lookup

- Status: **Complete**
- Scope: repair the canonical Registry OpenCounter stack so a catalog-bound
  Cincinnati Zoning run returns a resumable provider checkpoint and can proceed
  through the provider's guided questions without losing a created project.
- Files inspected before editing:
  - `AGENTS.md`
  - `catalog/stacks/opencounter/src/core.mjs`
  - `catalog/stacks/opencounter/src/index.mjs`
  - `catalog/stacks/opencounter/src/playwright-driver.mjs`
  - `catalog/stacks/opencounter/src/encrypted-state-store.mjs`
  - `catalog/stacks/opencounter/test/*.test.mjs`
  - installed stack at `~/.rudi/stacks/opencounter` for read-only drift comparison
- Relevant SWE manual sections:
  - Master Doctrine Appendix C, behavior-level red-green-refactor and boundary tests
  - Master Doctrine Appendix D, reproduce and localize before modification
  - Backend Standard, application lifecycle, configuration validation, resource
    cleanup, dependency timeouts, and diagnostic errors
  - Infrastructure Standard, readiness distinct from process liveness
- Current-state evidence:
  - the public catalog check succeeds with 126 entries and tenant version 307;
  - installed stack `0.2.0` is stale relative to canonical source `0.3.0`;
  - one read-only installed-stack call exits the stack process;
  - `rudi check stack:opencounter --json` reports package readiness and all eight
    installed-stack unit tests pass;
  - the RUDI launch agent is loaded, while daemon reachability reports
    `not_running`;
  - canonical source tests cannot load Playwright before package-local dependency
    installation; and
  - inspection shows browser state is saved only after all post-project start
    steps finish, so a later timeout can discard a known provider reference.
- Risks and invariants:
  - no blind redispatch after an anonymous project may have been created;
  - persist resumable browser state immediately after provider-reference capture;
  - return bounded checkpoint or indeterminate evidence with the known reference;
  - provider HTML, JSON, URLs, and browser state remain untrusted and bounded;
  - no application, payment, upload, account, terms acceptance, or staff message;
  - preserve unrelated dirty Registry work.
- Exit criteria: baseline and first incorrect state are recorded. **Met.**

## Phase 1: Scope Lock

- Status: **Complete**
- In scope:
  - exact provider-use fingerprint validation;
  - durable checkpointing immediately after project creation;
  - bounded post-creation failure results that preserve the provider reference;
  - guided-question continuation from the same encrypted anonymous state;
  - package/version/index documentation needed to ship the fix;
  - one explicitly authorized anonymous 880 Ridgeway Zoning smoke.
- Non-goals:
  - general-purpose browser control;
  - automatic retries after indeterminate effects;
  - Business, Residential, or Special Events automation expansion;
  - Service Desk production enablement or public deployment;
  - any permit or application submission.
- Expected files touched:
  - `catalog/stacks/opencounter/src/playwright-driver.mjs`
  - `catalog/stacks/opencounter/test/playwright-driver.test.mjs`
  - `catalog/stacks/opencounter/src/core.mjs` and its test only if result-contract
    containment is required
  - `catalog/stacks/opencounter/README.md`
  - package and manifest version files plus generated `index.json` if behavior is
    released as a new patch version
  - this proof ledger
- External inputs and trust boundaries: provider search JSON, rendered DOM,
  redirects, address choices, requester answers, browser storage state,
  provider timeouts, MCP arguments, and RUDI configuration.
- Failure behavior:
  - pre-project drift fails without project creation;
  - post-project failure saves state and returns `indeterminate` with the known
    reference and bounded provider route;
  - missing, expired, or invalid resume state becomes a bounded tool failure and
    never terminates the MCP server;
  - continuation never changes the provider reference.
- Exit criteria: interfaces, mutation boundary, and non-goals are explicit.
  **Met.**

## Phase 2: Red Tests

- Status: **Complete**
- Observable behavior to prove:
  - the real provider fingerprint shape validates exactly once;
  - state is saved as soon as the provider reference exists;
  - a timeout after project creation returns resumable indeterminate evidence;
  - the same project can resume through address and subsequent questions.
- Test files: `catalog/stacks/opencounter/test/playwright-driver.test.mjs` and,
  only if required, `test/core.test.mjs`.
- Red command: `npm test --prefix catalog/stacks/opencounter`.
- Expected failure: provider fingerprint rejects the valid response and the
  post-project failure path either throws without saving state or loses the
  provider reference.
- Red evidence:
  - `node --test test/playwright-driver.test.mjs` first failed because
    `runResumableStart` did not exist, proving there was no post-project durable
    checkpoint boundary.
  - the next unchanged targeted command failed with
    `opencounter_resume_state_missing` and a rejected-promise warning, proving
    missing anonymous state escaped instead of returning bounded evidence.
  - after the live provider rendered address matches as suggestion text rather
    than radio controls, the next targeted command failed because the new
    `waitForAddressOptions` behavior did not exist. This reproduced the stale
    radio-count dependency without creating another provider project.
  - the exact recovery service test failed because no catalog-bound same-project
    reconciler existed; the encrypted-state test then failed because state had
    no project/input binding API.
  - live read-only DOM evidence showed current use radios carry the bare provider
    slug and descriptive label text. The next targeted test failed because the
    exact selector/label helpers did not exist.
  - the one-address-option fixture failed the generic minimum-two-options rule,
    reproducing the live post-mutation response-validation failure.
  - an invalid post-reconciliation question escaped as an MCP error until the
    final containment test required bounded `indeterminate` evidence.
  - the completed live summary exposed `Overlay Districts` as the parsed zoning
    value until a focused test required the value immediately following the
    exact `Zoning District` heading.
- Exit criteria: each behavior fails for its intended missing implementation.
  **Met.**

## Phase 3: Implementation

- Status: **Complete**
- Implementation rules: smallest change per red test; no dependency additions;
  exact schemas; bounded timeouts; encrypted state only; browser cleanup in all
  paths; no automatic redispatch.
- Files allowed: the Phase 1 file list only.
- Validation and error handling:
  - validate provider reference and route before returning them;
  - preserve pre-effect versus post-effect failure distinction;
  - do not expose raw browser storage or unrestricted DOM.
- Observability: result status and bounded failure class/route/reference must
  identify the failed boundary without secrets.
- Implemented behavior:
  - save encrypted browser state immediately when the provider project URL is
    first observed;
  - save the final checkpoint state again on successful start;
  - contain post-project exceptions as `indeterminate` with the same validated
    provider reference and safe same-origin project route;
  - contain missing, expired, and invalid resume state before browser launch;
  - wait for the exact Cincinnati address suggestion text the current provider
    renders, without depending on unrelated radio-button counts;
  - expose a catalog- and digest-bound low-level same-project Zoning recovery
    primitive without registering or enabling a Service Desk reconciler;
  - encrypt new state envelopes with AEAD associated data bound to the exact
    project reference and normalized provider-input digest, while migrating the
    one legacy smoke session only after proving its same-project route;
  - use the provider's current bare-slug radio identity and descriptive label;
  - admit one exact address match as a requester confirmation checkpoint; and
  - contain invalid post-reconciliation output as `indeterminate` rather than
    terminating the MCP call after a possible provider mutation;
  - retain no-retry behavior.
- Exit criteria: unchanged red tests pass with no weakened assertions. **Met.**

## Phase 4: Green Tests And Refactor

- Status: **Complete**
- Green command: same stack-local test command used for red.
- Refactor constraints: only after green and only within the OpenCounter stack.
- Regression checks: catalog-bound start, checkpoint/continue, encryption,
  export, delayed redirects, and missing-state containment.
- Green evidence:
  - `node --test test/playwright-driver.test.mjs`: 10 tests, 0 failures.
  - package `npm test`: 21 tests, 0 failures.
- Exit criteria: affected tests remain green after cleanup. **Met.**

## Phase 5: Full Verification

- Status: **Complete**
- Targeted tests: OpenCounter package suite.
- Full suite: Registry `npm test`.
- Build and catalog gates: `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and
  `npm pack --dry-run --json`.
- JS/MJS debt scan: architecture-aware scanner when a local policy exists;
  otherwise scoped structural fallback.
- Live smoke:
  1. install the verified source package locally;
  2. confirm exact packaged `Multi-family dwelling` identity;
  3. start one anonymous Zoning project for 880 Ridgeway Avenue;
  4. capture the provider reference and first question checkpoint;
  5. answer only the exact address and requester-authorized four-family facts;
  6. continue on the same project until a result or a genuinely requester-owned
     unanswered question is returned;
  7. confirm no prohibited external action occurred.
- Verification evidence:
  - Registry `npm test`: 18 files and 152 tests passed.
  - `npm run indexes:sync`, `npm run indexes:check`, `npm run validate`,
    `npm run catalog:clean:check`, and `npm run build`: passed.
  - `npm pack --dry-run --json`: passed; the existing Registry-wide
    `.npmignore` warning remains non-blocking.
  - scoped JS/MJS debt scan: zero findings after correcting the command to use
    the Registry's configured check set rather than its nonexistent
    `pr-review` profile.
  - installed local package: `stack:opencounter` version `0.4.0`; the installed
    MCP tool list contains `opencounter_reconcile_zoning_start`.
  - exactly one anonymous provider project was created:
    `opencounter:project:2819756`.
  - the first exact recovery call failed before provider mutation on the stale
    prefixed radio selector; a read-only inspection established the current
    bare-slug provider identity.
  - the corrected one-shot call selected the exact catalog-bound
    `Multi-family dwelling` use on that same project. Its response validator
    rejected a transient single-address checkpoint after mutation, so the
    recovery dispatch was not repeated.
  - a subsequent read-only result call authoritatively returned
    `needs_requester_input` for the same project with four required provider
    questions;
  - the requester answered all four questions `No`; one continuation on the
    same project selected the exact `880 Ridgeway Avenue, Cincinnati, Ohio
    45229` address and completed without retry;
  - final provider status: `completed`; classification: `Permitted with
    Limitations`; parcel: `006000030018`; Zoning District: `Residential Mixed
    (1-3 family units) (RMX)`; Land Use Code: `Multi-family dwelling`; Overlay:
    `Avondale`; and
  - the installed post-fix read-only result returned that exact district rather
    than the adjacent `Overlay Districts` heading.
  - no replacement project, application, payment, upload, account, terms
    acceptance, staff message, or permit submission occurred.
- Exit criteria: source and installed runtime prove the same bounded behavior
  through a final provider result on the same project. **Met.**

## Phase 6: Docs, Contracts, And Closure

- Status: **Complete**
- Docs: update the stack README and this ledger with commands, live project
  reference, statuses, provider result or checkpoint, and mutation boundary.
- Accepted debt: none unless explicitly recorded with impact and next owner.
- Definition of Done:
  - deterministic regression tests pass;
  - the complete Registry verification is green or unrelated baseline failures
    are named precisely;
  - the verified stack is installed locally;
  - the 880 Ridgeway flow returns and resumes guided questions on one project;
  - no blind retry or prohibited provider action occurs;
  - Service Desk/BuildCincy production remains disabled until separately
    authorized.
- Closure evidence:
  - the Grill With Docs Loop accepted the forward Owner-authorized
    Operation-specific reconciliation design after questioner, answerer,
    skeptic, docs-writer, and reviewer passes;
  - the accepted Service Desk docs keep the low-level Registry primitive
    non-authoritative and the lifecycle reconciler migration-gated;
  - final Registry tests, build, validation, indexes, catalog hygiene, package
    dry-run, whitespace check, and scoped debt scan are green; and
  - no changes were committed, pushed, or deployed.
