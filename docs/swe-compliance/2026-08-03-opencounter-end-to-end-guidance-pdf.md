# OpenCounter End-to-End Guidance And PDF — SWE Compliance Checklist

Status: **Complete**

## Phase 0: Baseline And Manual Lookup

- Status: **Complete**
- Scope: repair the canonical Registry OpenCounter stack so one anonymous
  Cincinnati guidance project preserves its exact address checkpoint, resumes
  without replaying provider-committed answers, completes deterministically,
  and returns the provider PDF artifact.
- Files inspected before editing:
  - `AGENTS.md`
  - `catalog/stacks/opencounter/src/core.mjs`
  - `catalog/stacks/opencounter/src/playwright-driver.mjs`
  - `catalog/stacks/opencounter/src/encrypted-state-store.mjs`
  - `catalog/stacks/opencounter/src/index.mjs`
  - `catalog/stacks/opencounter/test/*.test.mjs`
  - `catalog/stacks/opencounter/README.md`
  - the prior guided-question reliability ledger
- Relevant SWE manual sections:
  - Master Doctrine Appendix C, behavior-level red-green-refactor and boundary
    tests;
  - Master Doctrine Appendix D, state-over-code debugging and first-incorrect-
    state localization;
  - API Standard E7 and E12, mutating-operation idempotency and machine-readable
    retry/failure semantics;
  - Security Standard F5 and F6, untrusted provider/browser state and encrypted
    session material; and
  - Backend Standard G3 and G4, explicit state transitions and partial external
    side-effect failure.
- Current-state commands:
  - `git status --short`
  - targeted source/test inspection with `rg` and `sed`
  - prior live DOM and PDF evidence from project `2819848`
- First incorrect states:
  - the public continuation input requires `checkpointSha256`, but completed
    checkpoint output does not return a digest and the driver does not validate
    it against persisted active checkpoint state;
  - provider radio clicks persist immediately, while retries click the same
    answers again because current checked values are ignored;
  - a blank resumed address control is filtered out, losing the still-required
    `Select this address` transition; and
  - PDF export registers a download wait while an optional save modal intercepts
    the click, then the pending download rejection masks the click failure.
- Risks and invariants:
  - never create a replacement project after a known provider reference exists;
  - never replay an already-matching provider answer;
  - reject stale or unknown checkpoint/answer identities before mutation;
  - preserve normalized requested address and immutable active checkpoint only
    in encrypted bounded state;
  - never log or persist plaintext browser session secrets outside that store;
  - keep optional account creation, sign-in, applications, payment, uploads,
    staff messages, and terms acceptance out of scope; and
  - preserve unrelated dirty Registry work.
- Exit criteria: expected and observed behavior, failure boundary, and relevant
  doctrine are recorded. **Met.**

## Phase 1: Scope Lock

- Status: **Complete**
- In scope:
  - canonical checkpoint hashing returned to callers and bound to the encrypted
    active checkpoint;
  - normalized requested-address and exact provider-match recovery;
  - continuation validation against the exact active question IDs/options;
  - current-value inspection so matching committed answers are not replayed and
    conflicting provider state fails loudly;
  - precise disabled-Next diagnostics instead of a generic selector timeout;
  - optional save-modal dismissal and bounded, non-masking PDF download;
  - completed-flow PDF artifact handoff;
  - provider-use scope metadata sufficient for BuildCincy to report that
    OpenCounter evaluated its selected catalog label, not a different zoning-
    code building form; and
  - package/version/index/README changes required to ship verified behavior.
- Non-goals:
  - changing Cincinnati zoning conclusions;
  - inventing a missing OpenCounter `Multi-plex: Small` catalog entry;
  - general browser automation, account creation, sign-in, application or permit
    submission, payment, uploads, staff messages, or deployment;
  - silent fallbacks when provider state is incomplete or contradictory; and
  - unrelated Registry refactors.
- Expected files touched:
  - `catalog/stacks/opencounter/src/core.mjs`
  - `catalog/stacks/opencounter/src/playwright-driver.mjs`
  - `catalog/stacks/opencounter/src/encrypted-state-store.mjs`
  - their focused test files
  - `catalog/stacks/opencounter/src/index.mjs`
  - `catalog/stacks/opencounter/README.md`
  - package/manifest version files and generated `index.json`
  - this ledger
- External inputs and trust boundaries: MCP inputs, provider DOM and URLs,
  checked control values, address suggestions, provider PUT side effects,
  encrypted browser/session state, modal state, download events and bytes.
- Failure behavior:
  - stale or mismatched checkpoints reject before browser dispatch;
  - already-matching provider values are observed, not re-clicked;
  - conflicting provider values return a named hard failure without overwriting;
  - unresolved address state remains an explicit address checkpoint or a named
    indeterminate state, never a four-question-only fallback;
  - blocked navigation reports the unresolved transition;
  - PDF click failures remain the surfaced cause and cannot be replaced by an
    orphaned download-promise rejection.
- Exit criteria: interfaces, mutation boundary, non-goals, allowed files, and
  user-visible behavior are explicit. **Met.**

## Phase 2: Red Tests

- Status: **Complete**
- Observable behavior to prove, one test at a time:
  1. checkpoint output contains a canonical digest and stale continuation is
     rejected before driver/browser dispatch;
  2. encrypted state preserves requested address and active checkpoint;
  3. blank resumed address with `Select this address` remains an address
     checkpoint;
  4. already-checked matching answers are not clicked again, while conflicts
     fail loudly;
  5. export dismisses only exact `Skip for now`, downloads through the stable
     PDF control, and preserves click failures; and
  6. completed continuation returns the persisted provider PDF artifact and
     selected provider-use scope.
- Test files: focused OpenCounter package tests only.
- Red command: `node --test <focused-test-file>` from the stack package.
- Observed red evidence, introduced and resolved one behavior at a time:
  - missing canonical checkpoint-hash export;
  - missing encrypted `loadSession` and guidance-state fields;
  - stale checkpoint dispatched to the browser instead of rejecting first;
  - blank resumed address omitted from the active checkpoint;
  - a matching checked answer clicked a second time;
  - hidden `Select this address` control clicked as though actionable;
  - disabled Next diagnosed before an asynchronous provider save settled;
  - result reads visited location state before the authoritative summary;
  - save modal interception masked the PDF click/download failure;
  - completed continuation omitted the provider PDF artifact;
  - result output omitted selected-use scope and land-use code;
  - text and `structuredContent` did not carry the same bounded result; and
  - the provider's prohibited sentence was not normalized to `Prohibited`.
- Every red failed for the named missing behavior rather than fixture or
  dependency setup, and the unchanged assertion passed after its minimal fix.
- Exit criteria: every new behavior has visible red evidence before its minimal
  implementation. **Met.**

## Phase 3: Implementation

- Status: **Complete**
- Implementation rules: smallest change per red test; no dependencies; exact
  schemas; bounded state and timeouts; no blind provider retry.
- Files allowed to change: Phase 1 list only.
- Validation and error handling: validate active digest, question IDs and option
  values before browser mutation; inspect provider current values; preserve the
  original click/download error; validate returned artifact metadata and PDF
  bytes through the existing artifact store.
- Observability: named bounded failure classes must identify stale checkpoint,
  missing address checkpoint, provider-state conflict, blocked navigation, modal
  drift, and download failure without exposing session data.
- Implemented:
  - canonical checkpoint SHA-256 creation, output, encrypted persistence, and
    pre-browser continuation validation;
  - exact normalized address and immutable active-question recovery in version
    3 encrypted state, with version 1 and 2 migration compatibility;
  - current provider-value inspection that skips matching committed answers and
    rejects conflicting values;
  - bounded provider-save wait and named disabled-navigation diagnostics;
  - authoritative summary-first result reads;
  - exact optional-save-modal dismissal and non-masking download registration;
  - automatic completed-flow PDF persistence and explicit recovery export;
  - identical JSON text and `structuredContent` MCP responses;
  - summary output with normalized classification,
    `evaluationScope: selected_opencounter_land_use`, and exact `landUseCode`;
  - package/manifest version `0.5.0`, contract descriptions, README, lockfile,
    and Registry index updates; and
  - extracted navigation, summary/export, and zoning-provider-contract modules
    so the browser driver stays below the repository large-file threshold.
- Exit criteria: unchanged focused tests pass without weakened assertions.
  **Met.**

## Phase 4: Green Tests And Refactor

- Status: **Complete**
- Green command: each unchanged focused red command, followed by the stack
  package suite.
- Refactor constraints: only after green; keep driver/state/core boundaries
  explicit; no unrelated cleanup.
- Regression checks: start, reconciliation, continuation, result read, export,
  encrypted state migration, artifact persistence, and provider summary parsing.
- Green evidence:
  - focused tests passed after each minimal implementation;
  - final stack command `npm test` passed 33 of 33 tests;
  - `npm audit --omit=dev` reported zero vulnerabilities; and
  - after splitting summary/export coverage from the browser-state tests, the
    scoped architecture-aware debt scan reported zero error, warning, or info
    findings across 15 graph files.
- Exit criteria: affected tests stay green after scoped cleanup. **Met.**

## Phase 5: Full Verification

- Status: **Complete**
- Targeted tests: `npm test` in `catalog/stacks/opencounter`.
- Full suite: Registry `npm test`.
- Build/typecheck/lint: Registry validation, indexes, catalog hygiene, build, and
  package dry-run gates from `AGENTS.md`.
- JS/TS debt scan: scoped Registry policy scan for edited JS/MJS files.
- Live smoke checks:
  1. install the verified source stack locally without editing installed files;
  2. create at most one explicitly bounded anonymous Zoning project;
  3. confirm exact address through the returned active checkpoint;
  4. answer one guided checkpoint and prove a same-project retry does not replay
     matching provider values;
  5. reach the City summary or a genuine requester-owned checkpoint;
  6. automatically persist and return the provider PDF when completed; and
  7. verify no prohibited external action occurred.
- Deterministic verification:
  - OpenCounter stack: 33 tests passed; dependency audit: zero vulnerabilities;
  - Registry: 18 test files and 156 tests passed;
  - Registry validation: 147 packages passed;
  - Registry build, compile, generated-index check, package dry-run, and
    `git diff --check`: passed;
  - clean-room catalog-hygiene check on the exact working tree with reproducible
    artifacts excluded: zero targets; and
  - the shared-checkout hygiene command reports only unrelated runtime artifacts
    in other stacks. They were preserved rather than deleting other active work;
    the OpenCounter package contains no runtime artifact directory.
- Bounded live evidence:
  - installed the verified canonical Registry stack locally as version `0.5.0`;
  - created exactly one anonymous Zoning project,
    `opencounter:project:2819953`, for `4818 Stewart Avenue, Cincinnati, Ohio
    45227` and selected catalog use `Multi-family dwelling`;
  - start returned the exact address and four guided questions in both response
    channels with checkpoint SHA-256
    `ffbd21f13234fa067715aa2bb168b22908c963543667b5c875f7b125c743b29e`;
  - the four requester answers were `No / No / No / No`;
  - after an initial bounded disabled-Navigation failure, same-project
    reconciliation proved no complete answer set had been committed; the fixed
    continuation later observed and skipped the one provider-committed matching
    `No`, supplied only the missing values, and did not create a second project;
  - the project reached the City summary and the encrypted active checkpoint was
    cleared;
  - final installed result read returned `completed` in text and structured
    output with `classification: Prohibited`, `T3 Neighborhood (T3N)`, parcel
    `003600010091`, `evaluationScope: selected_opencounter_land_use`, and
    `landUseCode: Multi-family dwelling`; and
  - final installed export returned `exported` in text and structured output and
    persisted the official 384,296-byte, three-page PDF with SHA-256
    `34ee050d9b15a833c89fe43b62b267d1e030a912a8f78221f832ed5255544f3f`.
- PDF verification: rendered and visually inspected all three final pages. Text,
  map, hierarchy, pagination, and City result are legible and unclipped; the PDF
  is tagged, unencrypted, Letter-sized, PDF 1.4, and contains no form fields.
- Prohibited external actions: no account creation, sign-in, terms acceptance,
  application or permit submission, payment, upload, or staff message occurred.
- Exit criteria: deterministic gates and bounded live evidence prove the same
  packaged behavior with no duplicate project. **Met.**

## Phase 6: Docs, Contracts, And Closure

- Status: **Complete**
- Docs or API contracts to update: stack README, MCP tool descriptions/schema,
  manifest safety boundary, and this proof ledger.
- Final files touched:
  - `catalog/stacks/opencounter/README.md`
  - `catalog/stacks/opencounter/manifest.json`
  - `catalog/stacks/opencounter/package.json`
  - `catalog/stacks/opencounter/package-lock.json`
  - `catalog/stacks/opencounter/src/core.mjs`
  - `catalog/stacks/opencounter/src/encrypted-state-store.mjs`
  - `catalog/stacks/opencounter/src/guidance-navigation.mjs`
  - `catalog/stacks/opencounter/src/index.mjs`
  - `catalog/stacks/opencounter/src/playwright-driver.mjs`
  - `catalog/stacks/opencounter/src/summary-export.mjs`
  - `catalog/stacks/opencounter/src/zoning-provider-contract.mjs`
  - `catalog/stacks/opencounter/test/core.test.mjs`
  - `catalog/stacks/opencounter/test/encrypted-state-store.test.mjs`
  - `catalog/stacks/opencounter/test/playwright-driver.test.mjs`
  - `catalog/stacks/opencounter/test/guidance-summary-export.test.mjs`
  - generated `index.json`; and
  - this proof ledger.
- Accepted external debt:
  - OpenCounter's official PDF repeats the exact Address/four-question Project
    Details block on page 3. A separate single-pass completed project produced
    the same duplication, proving it is provider template/data behavior rather
    than connector answer replay. The connector preserves City-issued bytes;
    OpenCounter owns any template correction.
  - OpenCounter classifies its selected `Multi-family dwelling` catalog use as
    prohibited in T3N, while separate Form-Based Code evidence appears to permit
    a four-unit `Multi-plex: Small`. This is a City catalog/code interpretation
    conflict, not a connector fallback. BuildCincy must report the conflict and
    require City Zoning staff confirmation.
- No commit, push, release, or deployment was performed.
- Definition of Done:
  - checkpoint identity is returned, persisted, and enforced;
  - exact address cannot disappear from a resumed checkpoint;
  - retries cannot duplicate provider answer writes;
  - completed guidance returns a validated local provider PDF artifact;
  - code-vs-provider-use scope is explicit so downstream guidance can surface a
    conflict instead of silently choosing one conclusion;
  - all required gates pass; and
  - no commit, push, or deployment occurs without separate authorization.

Definition of Done: **Met.**
