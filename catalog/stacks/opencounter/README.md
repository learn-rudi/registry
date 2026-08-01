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
acceptance, uploads, downloads, staff messages, application submission, or
payment.

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

The exact MCP surface is:

```text
opencounter_start_guidance
opencounter_continue_guidance
opencounter_get_guidance_result
opencounter_reconcile_guidance
```

A successful anonymous guidance result is informational and remains subject
to final City staff review. A missing or expired state envelope, ambiguous
control, unexpected route, or provider UI drift fails closed rather than
starting a replacement project or choosing a nearby control.
