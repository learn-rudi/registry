# OpenCounter Cincinnati Guidance

Guarded headless-browser MCP boundary for the four public Cincinnati portal
families: zoning, business permits and fee estimates, special events, and
residential guidance.

The four workflow identifiers are exact registered entry profiles. Current
automated page-contract and live proof coverage is zoning; enable the other
three for production only after adding their versioned fixtures and supervised
provider smoke evidence.

The stack uses a fresh isolated browser context for every call. Because the
provider binds anonymous projects to a session, the adapter stores only an
AES-256-GCM encrypted, 24-hour browser-state envelope outside Service Desk and
resumes it by an opaque project reference. It does not expose arbitrary
navigation or selectors and has no tools for sign-in, account creation, terms
acceptance, uploads, staff messages, application submission, or payment. The
one download capability is a requester-triggered export of the provider's
completed guidance PDF to a bounded, content-addressed local RUDI artifact.

Install dependencies and the pinned Chromium runtime with:

```bash
npm ci
npm run install-browser
```

`OPENCOUNTER_SESSION_ENCRYPTION_KEY` is required and must be canonical base64
for exactly 32 random bytes. `OPENCOUNTER_STATE_DIRECTORY` may specify an
absolute local state directory; otherwise the stack uses
`~/.rudi/state/opencounter`. Do not print or commit the key. Service Desk never
receives the key or decrypted browser state.

Exported PDFs are written beneath `$RUDI_HOME/artifacts/opencounter` when
`RUDI_HOME` is configured, otherwise beneath
`~/.rudi/artifacts/opencounter`. The stack verifies the `%PDF-` signature,
enforces a 25 MiB maximum, computes SHA-256, uses restrictive file permissions,
rejects non-regular downloads and symbolic-link destinations, and returns
metadata rather than PDF bytes over MCP.

The exact MCP surface is:

```text
opencounter_get_zoning_use_catalog
opencounter_start_zoning_guidance
opencounter_start_guidance
opencounter_continue_guidance
opencounter_export_guidance
opencounter_get_guidance_result
opencounter_reconcile_guidance
```

`opencounter_start_zoning_guidance` is the admitted Service Desk Zoning Check
start capability. It accepts only the fixed Cincinnati jurisdiction, packaged
catalog ID, and one exact `catalogEntryId`; the stack resolves the provider
label, slug, description, and category path internally. Before creating a
provider project, it uses the read-only public Zoning search endpoint to prove
one exact provider fingerprint. Missing, ambiguous, or drifted entries fail
closed. `opencounter_start_guidance` remains temporarily available for
compatibility and is not admitted for the revised Zoning Check.

The packaged catalog is release configuration with tenant version `307` and
catalog-core SHA-256
`0fa60c5b7588d51676961de779f2757ed0fb99f58d8cd257ced313a941c26bf0`.
The stack validates the complete closed object and canonical digest at startup.

A successful anonymous guidance result is informational and remains subject
to final City staff review. A missing or expired state envelope, ambiguous
control, unexpected route, or provider UI drift fails closed rather than
starting a replacement project or choosing a nearby control.
