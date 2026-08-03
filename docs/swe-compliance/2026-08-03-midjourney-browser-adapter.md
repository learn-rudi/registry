# Midjourney Browser Adapter Compliance Record

## Scope

Add bounded Midjourney browser generation and export to the canonical
`stack:image-generator` package. This follows ADR 0004 instead of introducing a
second image-generation stack.

Task-owned source is limited to:

- `catalog/stacks/image-generator/**`
- this compliance record
- the generated `index.json` entry produced by `npm run indexes:sync`

The repository had extensive unrelated changes before this task. They are not
part of this scope and must remain intact.

## Contract and Invariants

- Browser state belongs to a dedicated local RUDI profile; no cookie, token,
  password, or browser-storage value crosses MCP.
- The adapter accepts no caller-provided URLs, selectors, profile paths, or
  cookie data.
- Generation requires a caller-provided request ID and persists an explicit
  `pending -> submitted -> complete` state machine.
- A replay with different generation input fails with
  `idempotency_conflict`.
- A pending submission with no known provider job ID fails with
  `idempotency_in_doubt`; it is never blindly resubmitted.
- Browser controls are exact and fail closed on missing, duplicate, or drifted
  prompt/download controls.
- Exports accept only a UUID job ID and unique indexes 0-3, write under the
  RUDI outputs boundary, and validate regular-file status, size, signature,
  digest, source URL, and metadata before returning.
- `RUDI_VERIFY_OFFLINE=1` disables all live browser calls. Package verification
  uses a fake driver and no provider credentials or paid requests.

## Red-Green-Refactor Evidence

- Red command: `python3 -m unittest tests.test_midjourney`
  - Failed because `midjourney.py` did not exist.
- Green command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest tests.test_midjourney tests.test_mcp_stdio`
  - Passed 9 tests after implementing the service, idempotency store, driver
    boundary, exact MCP schemas, and dispatch.
- Refactor verification: the same command passed after adding stale-lock
  recovery, safe Playwright initialization cleanup, and transient auth-state
  handling.
- Package regression command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
  - Passed 33 tests.
- Package verification command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python verify.py`
  - Passed 33 tests and verified all seven declared MCP tools.

## Verification Status

- `npm run validate`: passed; 104 catalog packages validated.
- Remaining required gates: root tests, index sync/check, catalog hygiene,
  build, dry-run pack, changed-stack prepared verification, and diff check.
- JS/TS debt scan: no task-owned JS/TS source is planned. `index.json` is
  generated; if task-owned JS/TS is added, run the repository debt policy.

## Live-Smoke Boundary

The existing logged-in Chrome session used to inspect Midjourney cannot be
copied into the stack: browser cookies are intentionally inaccessible and the
stack must use a portable dedicated profile. A live stack smoke therefore
requires one user-controlled `midjourney_login` call in that dedicated browser
profile. No additional paid generation will be submitted without explicit user
authorization. Until that smoke is completed, the browser selectors are backed
by direct inspection of the current Midjourney Create/job pages and offline
driver-contract tests, not by an end-to-end run from the packaged profile.
