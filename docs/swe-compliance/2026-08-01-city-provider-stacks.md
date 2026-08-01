# Cincinnati City Provider Stacks SWE Compliance Checklist

Status: **Complete for the supervised local vertical slice**

## Phase 0: Baseline And Manual Lookup

- Status: **Complete**

- Scope: add governed, read-only MCP capability stacks for OpenCounter, CAGIS,
  and the Hamilton County Auditor without disturbing unrelated Registry work.
- Files to inspect before editing: Registry `AGENTS.md`, schema, index,
  representative TypeScript MCP stacks, validation tests, and current dirty
  state.
- Relevant SWE manual sections: API E12, Security F5/F13, Backend G4/G7, and
  Infrastructure H1/H6/H7.
- Current-state commands: `git status -sb`, `npm test`, `npm run validate:v2`,
  and focused manifest/package inspection.
- Risks and invariants:
  - Exact read-only tool allowlists and bounded schemas.
  - No secrets, browser storage, access-token URLs, or unrestricted DOM in
    results or logs.
  - OpenCounter actions are exact-origin, registered-workflow actions.
  - Provider project uncertainty is reconciled, never blindly restarted.
  - Existing dirty Registry work is preserved.
- Exit criteria:
  - [x] Baseline and stack conventions are verified.

## Phase 1: Scope Lock

- Status: **Complete**

- In scope:
  - `catalog/stacks/opencounter/`
  - `catalog/stacks/cagis/`
  - `catalog/stacks/hamilton-county-auditor/`
  - Minimal `index.json` and catalog-test changes required to register them.
- Non-goals: provider mutations, general browser automation, credentials,
  bypassing authentication or CAPTCHA, and public production claims.
- External inputs: MCP arguments, provider HTTP/HTML/JSON, browser state,
  configuration, and downstream timeouts.
- Failure behavior: invalid input, unavailable dependency, unsupported
  workflow/jurisdiction, UI drift, needs user action, and indeterminate effect.
- Exit criteria:
  - [x] Tool names and request/result contracts are fixed before code.

## Phase 2: Red Tests

- Status: **Complete**

- Observable behavior:
  - Manifests validate and tools register exactly.
  - CAGIS/Auditor calls return source-specific bounded evidence.
  - OpenCounter returns a durable checkpoint or complete result.
  - Cross-origin, unknown action, malformed provider data, and uncertain
    provider effect fail closed.
- Red evidence:
  - CAGIS and Auditor tests first failed because their stack modules were
    absent.
  - OpenCounter checkpoint/resume tests first failed because its service and
    encrypted state store were absent.
  - Reconciliation first failed because an indeterminate browser result
    discarded its known provider reference.
  - The delayed-summary regression first failed because the browser driver did
    not export or apply a route-stabilization contract.
- Exit criteria:
  - [x] Every implemented behavior has an observed expected failing test first.

## Phase 3: Implementation

- Status: **Complete**

- Rules: smallest implementation per red test, exact schemas, bounded
  timeouts/data, isolated browser context, structured errors, and safe logs.
- Files allowed: the three new stack directories plus minimal catalog
  registration and tests.
- Exit criteria:
  - [x] No placeholder tools or general-purpose browser surface exists.

## Phase 4: Green Tests And Refactor

- Status: **Complete**

- Green command: exact red command unchanged.
- Regression: stack-local tests and Registry catalog tests.
- Exit criteria:
  - [x] All affected tests pass after refactor.

## Phase 5: Full Verification

- Status: **Complete**

- Full suite: `npm test`, `npm run validate:v2`, and `npm run build`.
- JS/TS debt scan: run for each edited stack neighborhood.
- Live smoke: bounded read-only calls and one supervised anonymous OpenCounter
  workflow when local dependencies permit.
- Exit criteria:
  - [x] Full verification and authorized smoke evidence are recorded.

### Verification Evidence

- `npm test` at the Registry root: 114 tests across 14 files, 0 failures.
- `npm run validate:v2`: 95 catalog packages, including all three City
  provider stacks, 0 failures.
- `npm run build`: compiled 95 packages, all platform indexes, and the catalog
  hash tree.
- Stack-local tests: CAGIS 1, Hamilton County Auditor 1, and OpenCounter 4;
  all passed.
- JS/MJS structural debt scans for each new stack neighborhood: 0 findings.
- `validate:public` correctly reports new untracked catalog paths in the dirty
  worktree. An isolated temporary Git index containing the already-present
  referenced paths cleared every untracked-path error. One unrelated existing
  error remains because the concurrently edited `index.json` omits the tracked
  `binary:pdftoppm` entry required by `stack:document-processor`; this work did
  not rewrite that unrelated index decision. The real staging area was not
  changed.
- The existing Pre Dev Intel routes were inspected before delegation:
  `/api/cagis/parcel` accepts `address` and `include_rules`; and
  `/api/auditor/parcel` accepts exactly one `parcel_key` or
  `auditor_parcel_id` identity.
- Live anonymous headless OpenCounter project `2818706` completed and returned
  the provider summary for `414 Central Avenue, Cincinnati, Ohio 45202`:
  `Permitted with Limitations`, parcel `014500010029`, zoning district
  `Downtown Development Districts (DD)`.
- No live action signed in, created an account, uploaded or downloaded a file,
  messaged staff, submitted an application, accepted terms, or paid.

## Phase 6: Docs, Contracts, And Closure

- Status: **Complete**

- Update stack READMEs, manifests, tool descriptions, limitations, and this
  proof ledger.
- Record final files, commands, results, and accepted debt.
- Definition of Done: all three stacks are discoverable, exact, tested,
  documented, and consumable through RUDI without exposing an unrestricted
  provider or browser interface.

The supervised local Definition of Done is satisfied. Production remains
gated on documented City/OpenCounter permission, a supported provider
interface or approved browser posture, rate limits, drift monitoring, and
operator reconciliation for post-dispatch uncertainty.
