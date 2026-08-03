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
- Aspect Ratio, Stylization, Weirdness, Variety, model version, SD/HD, Raw, and
  GPU speed are validated as structured fields and appended as deterministic
  per-prompt parameters. Persistent account settings are not mutated.
- Image Prompts, Style References, and one Omni Reference accept only validated
  local files from bounded RUDI input/output roots. Their roles, weights, and
  content digests participate in request idempotency.
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
  handling. The first single-file implementation also exceeded the package's
  architecture budget, so it was split into facade, browser, contract, and
  service modules; prepared verification then passed the architecture gate.
- Visible-browser default red command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest tests.test_midjourney.MidjourneyServiceTest.test_session_status_uses_visible_browser_by_default`
  - Initially failed because the service passed `show_browser=False`; passed
    after making visible Chromium the default across the service, MCP schema,
    and documentation.
- Structured-settings red command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest tests.test_midjourney.MidjourneyServiceTest.test_generate_appends_validated_image_settings_in_stable_order tests.test_mcp_stdio.ImageGeneratorMcpStdioTest.test_list_tools_and_list_models_over_stdio`
  - Failed because the service rejected the new fields and the MCP schema did
    not expose them; passed after adding bounded validation, deterministic
    prompt assembly, duplicate-parameter rejection, and exact schemas.
- Reference-input red command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest tests.test_midjourney.MidjourneyServiceTest.test_generate_validates_and_passes_typed_local_references tests.test_mcp_stdio.ImageGeneratorMcpStdioTest.test_list_tools_and_list_models_over_stdio`
  - Failed because the service rejected all reference fields and the MCP schema
    did not expose them; passed after adding file/reference validation, service
    and driver contracts, browser upload composition, and exact schemas.

## Reference Upload Threat Model

Assets at risk are local image confidentiality, Midjourney account privacy, and
paid GPU submissions. The new trust boundary is an MCP caller choosing a local
file that the browser will transmit to Midjourney.

- Arbitrary-file exfiltration is mitigated by allowing only
  `~/.rudi/inputs/midjourney` and `~/.rudi/outputs`; arbitrary URLs, traversal,
  and paths outside those roots are rejected.
- Symlink and special-file attacks are mitigated with canonical boundary checks,
  `O_NOFOLLOW` where available, and regular-file verification.
- Malformed or oversized uploads are rejected by content signature, matching
  extension, and Midjourney's 10 MB maximum before browser interaction.
- Time-of-check/time-of-use changes are detected by re-hashing immediately
  before upload. Reference roles, weights, sizes, types, and SHA-256 digests are
  included in the request fingerprint.
- Provider URL substitution is constrained to exact HTTPS URLs on
  `cdn.midjourney.com`; ambiguous new uploads fail closed.
- All uploads must resolve before the paid prompt is submitted. A partial upload
  can remain in the user's private uploads library, which is an accepted and
  documented provider-side artifact; no automatic deletion is attempted.
- Midjourney may expose prompt/reference details with non-Stealth creations.
  Callers are responsible for staging only images they are authorized to send.

Start Frame is excluded from this image contract because it creates a video and
has a separate parameter, cost, and failure model.
- Package regression command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python -m unittest discover -s tests -p 'test_*.py'`
  - Passed 38 tests after the structured-settings and reference-input extensions.
- Package verification command:
  `/Users/hoff/.rudi/stacks/image-generator/venv/bin/python verify.py`
  - Passed 38 tests and verified all seven declared MCP tools.

## Verification Status

- `npm run validate`: passed; 104 catalog packages validated.
- `npm test`: passed; 18 test files and 152 tests.
- `npm run stacks:verify -- --stack stack:image-generator --prepare`: passed;
  38 package tests and all seven declared MCP tools verified in a prepared
  environment.
- `npm run indexes:sync` and `npm run indexes:check`: passed; the generated
  index contains 104 packages and is current.
- `npm run catalog:clean:check`: passed with zero generated catalog targets.
- `npm run build`: passed, including validation and compilation.
- `npm pack --dry-run --json`: passed; produced a 765-entry package containing
  all seven Midjourney source/test files.
- `git diff --check`: passed.
- JS/TS debt scan: not applicable. The task changed Python, JSON, Markdown, and
  the generated `index.json`, but no JS/TS source.

## Live-Smoke Boundary

The existing logged-in Chrome session used to inspect Midjourney cannot be
copied into the stack: browser cookies are intentionally inaccessible and the
stack must use a portable dedicated profile. A first isolated headless smoke
reached Midjourney's Cloudflare `Just a moment...` challenge. The adapter now
classifies that state as `browser_challenge` and opens visible Chromium by
default. A second isolated visible smoke successfully acquired Chromium,
navigated to Midjourney, and returned `{"authenticated": false}` without making
a paid request.

A full live generation/export smoke still requires one user-controlled
`midjourney_login` call in the stack's dedicated profile and explicit
authorization to spend a Midjourney generation. Current selectors are backed by
direct inspection of the Create/job pages, offline driver-contract tests, and
the non-billable visible-browser smoke.

The live account's Add Images panel and unique `image/*` file input were
inspected without uploading a file. A reference-upload smoke was not performed:
uploads persist in Midjourney's library, and the dedicated stack profile still
requires its own login. The browser upload algorithm is therefore covered by
the inspected UI contract, pure prompt-composition tests, fail-closed runtime
checks, and prepared package verification, but not a provider-side upload.
