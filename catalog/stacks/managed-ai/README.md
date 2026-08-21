# RUDI Managed AI stack

`stack:managed-ai` is the thin agent-facing client for the unified Managed AI
platform. It sends bounded requests to one authenticated, tenant-scoped HTTP
API. PostgreSQL remains private to the Admin Mac; this package contains no
database driver, SQL execution surface, database tunnel, provider poller, or
business-domain matching logic.

## Configuration

The installed runtime supplies three values through RUDI secret/configuration
bindings:

- `RUDI_MANAGED_AI_API_URL`: an HTTPS origin with no embedded credentials,
  path, query, or fragment. Plain HTTP is accepted only for process-local
  loopback development.
- `RUDI_MANAGED_AI_API_TOKEN`: a scoped bearer token for a distinct agent or
  service principal. The client never places it in a URL, output, or error.
- `RUDI_MANAGED_AI_TENANT_ID`: the one UUID tenant this installed stack may
  address. Tool callers cannot override it.

Run `managed_ai_config_status` to check whether all three bindings exist. It
returns booleans only and does not disclose their values.

## Tools and API routes

| Tool | Managed AI API behavior |
| --- | --- |
| `managed_ai_get_client_context` | bounded `GET .../clients/:id/context` |
| `managed_ai_get_organization_context` | bounded `GET .../organizations/:id/context` |
| `managed_ai_list_interactions` | cursor-paginated tenant interactions |
| `managed_ai_list_observations` | privacy-minimized normalized observations for reviewers |
| `managed_ai_list_candidates` | review candidates represented by API proposals |
| `managed_ai_review_candidate` | idempotent exact-version/digest approve or reject decision |
| `managed_ai_prepare_projection` | approval-backed preparation of up to five governed client-file changes |
| `managed_ai_get_projection_bundle` | readback of one prepared bundle and approval evidence |

Collection calls are capped at 100 records. Requests use only UUID resource
identifiers, bounded filters, and fixed v1 route templates. Successful API
responses must be bounded JSON with safe nesting; malformed, oversized,
non-JSON, timed-out, redirected, or non-success responses fail closed.
Each endpoint also has a closed response contract: required identifiers,
states, replay flags, cursors, and digests are type-checked; missing or unknown
fields, invalid timestamps, bearer-token echoes, and raw-provider payload fields
are rejected before MCP serialization.

## Approval and publication boundary

Candidate review requires a human-approved exact candidate ID, version,
proposal digest, decision, reason, and idempotency key. The tool also requires
`confirm_decision: true`; this is a caller-side safety assertion and is not a
replacement for API authorization or audit.

Projection preparation accepts only these target paths:

- `workspace/contacts.md`
- `workspace/context.md`
- `workspace/interaction-log.md`
- `workspace/next-steps.md`
- `workspace/decisions.md`

Each proposed file is capped at 5,000 Unicode characters and 20,000 UTF-8
bytes. The character cap conservatively reconciles MCP JSON Schema length with
the API's byte limit.

The client computes each patch digest and the canonical bundle digest locally,
then asks the API to record a prepared run. `confirm_prepare: true` is required
for the exact approval IDs and base revision. Preparation does **not** read or
write a client checkout, apply a patch, commit, push, or report publication
evidence. Those remain separately authorized, controlled Git-history steps.

## Development verification

From this directory:

```bash
npm test
npm run build
```

Tests inject an in-memory HTTP transport and never call a live Managed AI API.
