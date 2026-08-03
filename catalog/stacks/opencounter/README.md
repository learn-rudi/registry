# OpenCounter Cincinnati Guidance

Guarded headless-browser MCP boundary for the four public Cincinnati portal
families: zoning, business permits and fee estimates, special events, and
residential guidance.

The four workflow identifiers are exact registered entry profiles. Current
automated page-contract and live proof coverage is zoning; enable the other
three for production only after adding their versioned fixtures and supervised
provider smoke evidence.

The stack uses a fresh isolated browser context for every call. Because the
provider binds anonymous projects to a session, the adapter stores an
AES-256-GCM encrypted, 24-hour envelope containing bounded browser state, the
normalized requested address, and the immutable active checkpoint outside
Service Desk, and resumes it by an opaque project reference. It does not expose arbitrary
navigation or selectors and has no tools for sign-in, account creation, terms
acceptance, uploads, staff messages, application submission, or payment. The
one download capability runs after requester-triggered successful completion or
through the explicit recovery export tool. It dismisses only the provider's
exact optional `Skip for now` save modal and writes the provider PDF to a
bounded, content-addressed local RUDI artifact.

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
opencounter_reconcile_zoning_start
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

`opencounter_reconcile_zoning_start` is a separately versioned, low-level
same-project recovery primitive. It requires the exact normalized Zoning input
digest, revalidates the packaged catalog entry and live provider fingerprint,
cryptographically binds the encrypted session to that input and project, and
refuses a changed use, address, route, or reference. It never opens the provider
root or creates a replacement project and never supplies requester-owned guided
answers. A successful call returns the current bounded checkpoint or completed
result; a post-mutation uncertainty returns `indeterminate` and must never be
redispatched. This tool does not itself register or authorize a Service Desk
reconciler; Service Desk lifecycle use remains disabled until its separate
Owner command, durable fence, evidence, migration, and atomic transition
contract are implemented.

The packaged catalog is release configuration with tenant version `307` and
catalog-core SHA-256
`0fa60c5b7588d51676961de779f2757ed0fb99f58d8cd257ced313a941c26bf0`.
The stack validates the complete closed object and canonical digest at startup.

A successful anonymous guidance result is informational and remains subject
to final City staff review. A missing or expired state envelope, ambiguous
control, unexpected route, or provider UI drift fails closed rather than
starting a replacement project or choosing a nearby control.

Each requester checkpoint returns `checkpoint.checkpointSha256`. Continuation
must send that exact digest and answers for the active required questions. The
stack verifies the digest, question IDs, and single-select option values before
browser dispatch. On a same-project retry it inspects current provider values:
matching committed answers are not clicked again, while conflicting values fail
loudly without being overwritten. A blank resumed address field with a pending
`Select this address` transition is reconstructed from the encrypted exact
address checkpoint; it is never silently omitted.

Every MCP call returns the same bounded result in both JSON text content and
`structuredContent`, so a caller reading either channel receives the provider
reference, checkpoint digest, and exact address options.

Completed continuation returns `providerPdf` with validated artifact metadata
and the City summary source URL. Summary results also include
`evaluationScope: "selected_opencounter_land_use"` and the exact
`landUseCode`. This scope is important: OpenCounter's selected catalog use is
not automatically equivalent to a separately named zoning-code building form.
If independent code evidence conflicts with the OpenCounter classification,
downstream products must report conflicting City guidance and require City
Zoning staff confirmation rather than silently choosing either conclusion.
The downloaded PDF is preserved exactly as issued by OpenCounter. The current
provider template can repeat the Project Details questionnaire on a later page;
the adapter does not rewrite or normalize City-issued PDF content.

The adapter persists encrypted anonymous browser state as soon as the provider
exposes a project reference, before it waits for later use, location, or guided
question controls. A dependency timeout or UI failure after that boundary
returns bounded `indeterminate` evidence with the same project reference and
safe provider route. It never starts a replacement project automatically.
Missing, expired, or invalid resume state likewise returns bounded
`indeterminate` evidence for continuation, result reads, and reconciliation
instead of launching a browser without resumable state.
