# OpenCounter Question Discovery Ledger — SWE Compliance Checklist

Status: **In progress**

## Phase 0: Baseline And Manual Lookup

- Status: **Complete**
- Scope: add a deterministic, durable job ledger and a versioned 18-job
  permanent-residential pilot planner for controlled OpenCounter question
  discovery. Do not create provider projects in this change.
- Files inspected before editing:
  - `AGENTS.md`
  - `catalog/stacks/opencounter/README.md`
  - `catalog/stacks/opencounter/CATALOG-QUESTION-REFERENCE.md`
  - `catalog/stacks/opencounter/catalog/cincinnati-opencounter-zoning-use-catalog-v1.json`
  - `catalog/stacks/opencounter/src/core.mjs`
  - `catalog/stacks/opencounter/src/index.mjs`
  - `catalog/stacks/opencounter/src/encrypted-state-store.mjs`
  - `catalog/stacks/opencounter/test/*.test.mjs`
- Relevant SWE manual sections:
  - Master Doctrine Appendix C: behavior tests and red-green-refactor
  - Backend Standard G3: explicit state machines and legal transitions
  - Backend Standard G4: uncertain cross-service side effects
  - Backend Standard G7: idempotent jobs, bounded leases and observability
  - Security Standard F13: bounded agent authority, validated tool inputs and
    auditable agent actions
- Current-state evidence:
  - the packaged catalog has 126 entries and exactly six entries under
    `Residential Uses / Permanent residential`;
  - the stack preserves provider references and checkpoint hashes for one live
    project but has no durable multi-job discovery ledger;
  - no exact test addresses or provider-volume authorization were supplied for
    the proposed pilot; and
  - the worktree contains pre-existing OpenCounter reliability changes that
    must be preserved.
- Risks and invariants:
  - one stable job identity per catalog entry, property profile and scenario;
  - only the holder of an unexpired lease may change an active job;
  - persist mutation intent before a provider start or continuation;
  - an expired lease after mutation intent becomes `indeterminate`, never a
    replacement start;
  - answers must match the exact active checkpoint and allowed option values;
  - unknown questions require input and are never answered from LLM inference;
  - public catalog files contain no personal addresses or local run evidence.
- Exit criteria: baseline, trust boundaries and mutation invariants are
  recorded. **Met.**

## Phase 1: Scope Lock

- Status: **Complete**
- In scope:
  - pure pilot expansion from six catalog entries, three caller-supplied
    property profiles and one immutable baseline scenario per entry;
  - a JSON ledger with stable content-derived job IDs;
  - exclusive expiring worker leases;
  - explicit queued, active, needs-input, completed, indeterminate and failed
    transitions;
  - exact checkpoint, answers, provider reference, timestamps and error
    evidence;
  - observed-question aggregation keyed by provider question ID plus normalized
    prompt/type/options signature;
  - atomic, restrictive local persistence outside the public catalog.
- Non-goals:
  - launching any of the 18 provider projects;
  - inventing or publishing test addresses;
  - automatic answer generation;
  - automatic mutation retries;
  - PDF export;
  - a new public MCP orchestration surface or Service Desk reconciler.
- Expected files touched:
  - `catalog/stacks/opencounter/catalog/residential-question-discovery-pilot.json`
  - `catalog/stacks/opencounter/src/discovery-ledger.mjs`
  - `catalog/stacks/opencounter/src/discovery-ledger-store.mjs`
  - `catalog/stacks/opencounter/src/discovery-question-graph.mjs`
  - `catalog/stacks/opencounter/test/discovery-ledger.test.mjs`
  - `catalog/stacks/opencounter/README.md`
  - this checklist
- External inputs and trust boundaries: catalog JSON, pilot definition,
  property-profile fixtures, scenario answer rules, worker IDs, clocks, lease
  tokens, provider results and ledger files.
- Failure behavior: reject malformed inputs and illegal transitions; fail on a
  busy or invalid ledger; preserve prior durable state on write failure; convert
  an abandoned post-intent job to `indeterminate`; never infer an answer or
  silently create a duplicate job.
- Exit criteria: interfaces, state machine and non-goals are explicit. **Met.**

## Phase 2: Red Tests

- Status: **Pending**
- Observable behavior to prove:
  - the pilot expands to exactly 18 unique jobs only with three complete
    caller-supplied property profiles;
  - duplicate job identities are rejected;
  - concurrent leases never assign one job twice;
  - expired pre-intent work can be leased again, while expired post-intent work
    becomes indeterminate;
  - checkpoint answers must be exact and question graph observations dedupe on
    provider ID plus normalized signature.
- Test file: `catalog/stacks/opencounter/test/discovery-ledger.test.mjs`.
- Red command: `node --test test/discovery-ledger.test.mjs` from the OpenCounter
  package.
- Expected failure: the discovery-ledger modules and pilot definition do not
  exist.
- Exit criteria: each next observable behavior fails for the expected missing
  implementation.

## Phase 3: Implementation

- Status: **Pending**
- Implementation rules: smallest implementation per red test, no dependency
  additions, exact schemas, bounded data, immutable content-derived IDs and
  atomic local writes with restrictive permissions.
- Files allowed: only the Phase 1 file list.
- Validation and error handling: validate every external object and timestamp;
  reject unknown fields where the durable contract requires a closed shape;
  verify lease ownership/token/expiry before transitions; preserve the prior
  ledger if a write fails.
- Observability: every transition records actor, timestamp, event type and
  bounded error evidence; ledger summaries expose status counts and question
  observation counts.
- Exit criteria: unchanged red tests pass without weakened assertions.

## Phase 4: Green Tests And Refactor

- Status: **Pending**
- Green command: the unchanged targeted red command.
- Refactor constraints: only after green and only inside the new ledger
  modules/tests plus the scoped README section.
- Regression checks: full OpenCounter package suite.
- Exit criteria: targeted and package tests remain green after cleanup.

## Phase 5: Full Verification

- Status: **Pending**
- Targeted tests: discovery-ledger test file.
- Full suite: OpenCounter package tests and Registry `npm test`.
- Build/catalog gates: `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build` and
  `npm pack --dry-run --json`.
- JS/MJS debt scan: scoped Registry debt scan for the edited modules.
- Live smoke: intentionally omitted because creating 18 provider projects
  requires exact test profiles and explicit provider-volume authorization.
- Exit criteria: all deterministic gates pass and the live gap remains
  explicitly blocked rather than simulated.

## Phase 6: Docs, Contracts, And Closure

- Status: **Pending**
- Docs: document ledger location, state transitions, leasing protocol, fixture
  requirements, no-retry rule and the authorization-gated pilot command path.
- Final files touched: record after implementation.
- Commands run and results: record after verification.
- Accepted debt: provider pilot observations remain empty until authorized.
- Definition of Done: deterministic ledger and 18-job plan are proven locally;
  no provider project was created; docs distinguish a planned pilot from an
  executed observed-question library.
