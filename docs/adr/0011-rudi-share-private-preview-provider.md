# ADR 0011: RUDI Share Tailnet-Private Preview Provider

## Status

Accepted

## Context

ADR 0003 established RUDI Share as a static-artifact publication product with a
portable local adapter and a remote Anyone-with-the-link service. Its V0 access
model is intentionally public to anyone holding the bearer URL. That remains
the correct contract for sharing outside a private network, but it is too broad
for quickly opening a local prototype on a user's own phone or another device
already governed by the user's tailnet.

The existing manual prototype combines a project-specific local server and a
Tailscale Serve route. Repeating that shell setup per project creates port,
process, artifact, and revocation drift. It also makes it easy to serve a source
repository, collide with another route, or use a public transport accidentally.
The workstation already has an independently configured HTTPS 443 prototype
route whose ownership is outside this change.

The stack must add private preview without fragmenting the product or breaking
the four-tool public MCP contract. Cloud credentials must not prevent a local
private provider from starting, and a private failure must never silently fall
back to public publication.

## Decision

RUDI Share gains two explicit access/provider pairs behind the existing
`rudi_share_preflight`, `rudi_share_publish`, `rudi_share_get`, and
`rudi_share_unpublish` tools:

- `anyone_with_link` / `rudi_share_service` is the existing remote provider.
  Omitted mode fields continue to select it for backward compatibility. It
  still requires the exact Anyone-with-the-link warning and positive
  `confirm_publication` before remote mutation.
- `tailnet_private` / `tailscale_serve` is a local private-preview provider.
  It requires a prepared static `artifact_path` and positive
  `confirm_tailnet_access` after the user authorizes exposing that artifact to
  devices allowed by current tailnet policy.

Tailscale is a southbound implementation provider, not the user-facing product.
The operator presents RUDI Share access choices. The private provider discovers
and checks the local Tailscale CLI only when called. The remote API URL and token
remain declared for configuration discovery but are optional at stack startup
and are required lazily only by the public provider.

The private provider validates the complete prepared static artifact with the
same denylist, credential screening, file-count, byte, path, symlink, and root
index rules used for remote packaging. Screening reads use no-follow file
descriptors where the platform exposes that flag, an opened/pinned root
identity, and pre/post descriptor/path identity checks on every platform; path
substitution or in-place mutation fails closed. The provider then
materializes an immutable copy under RUDI-owned state and serves only that copy
from a managed HTTP process bound to `127.0.0.1`. The process receives a minimal
allowlisted environment. Source repositories, package files, `.env` files, Git
metadata, databases, logs, caches, and arbitrary application servers are never
hosted.

Mutable state and materialized artifacts live below
`~/.rudi/state/rudi-share`, with the root injectable in tests. State writes are
bounded, validated, locked, and atomic. The 128 newest fully cleaned revoked
receipts remain available for idempotent status/revoke retries; only older
receipts with completed route, host, and artifact cleanup are compacted.
Unresolved ownership is retained or the state write fails closed. Each
idempotency key maps to a stable private preview ID. Active
records preserve artifact provenance, host identity, loopback target, HTTPS
port, owner URL, health, failure code, and timestamps.

Each private preview receives its own root-mounted HTTPS Serve endpoint and
loopback port. Allocation excludes both live Serve routes and non-revoked
persisted previews. Live background, foreground, service, and Funnel-owned
ports are all reserved during allocation. The managed HTTPS range begins at
8443. Port 443 is a hard reserved boundary: the provider never selects, creates,
changes, or revokes it. Root mounting preserves ordinary root-relative static
assets and SPA fallback without project rewriting.

The adapter may run only Tailscale status and Serve commands. It never invokes
Funnel, changes ACLs, resets configuration, or supplies an automatic approval
flag. A Serve-approval requirement is returned as a stable stopping condition;
the stack does not approve a policy change.

Publication is complete only after the loopback health endpoint matches the
expected preview ID, artifact hash, and process ID and the tailnet HTTPS URL
passes the same check. A new host remains parent-supervised over IPC and exits
if the parent disconnects before activation. The parent persists a `starting`
ownership journal before acknowledging activation or attempting the Serve
mutation. A crash or incomplete cleanup transitions that record to
`cleanup_required`, preserves the exact host/route/artifact receipt, and
requires supported status/unpublish reconciliation rather than replaying a
false publication result. Idempotent publication retries refresh the same host,
tailnet identity, and HTTPS health evidence used by status before replaying the
active result. Tailnet status refreshes the current device DNS identity before
every HTTPS health request, and health checks never follow redirects.

Revocation compares the saved HTTPS port, root handler count, and proxy target
with live Serve status and independently attempts exact managed-host shutdown.
It removes only the matching endpoint and stops a process only when its
loopback health identity matches; a route mismatch therefore cannot prevent
the separately proven host from being stopped. Missing routes and dead
processes are idempotent. Process stop requires verified PID exit rather than a
single failed health request. Route, host, and artifact outcomes are persisted
separately; incomplete work remains `cleanup_required` with the exact supported
unpublish retry. The materialized snapshot is removed only after the matching
host is stopped, and deletion failure remains durable and retryable.

## Consequences

Users can ask RUDI Share for a private mobile preview without repository hosting,
manual server commands, port selection, or Serve lifecycle work. Multiple
projects can remain active without sharing a port or artifact root. The URL is
observable and revocable but remains subject to the tailnet's existing device
and ACL policy; RUDI Share neither broadens nor approves that policy.

Anyone-with-the-link behavior, confirmation language, remote upload paths, and
tool names remain compatible. Existing consumers that omit access/provider
continue to use the cloud service. Tailnet-only startup no longer depends on
cloud credentials, while an attempted public call without them returns a stable
provider-configuration error.

The private lifecycle is deliberately local and static. It does not add a cloud
API feature, dynamic app hosting, persistent public deployment, ACL management,
or a general-purpose process supervisor. A future third Share transport or a
second independent implementation of this lifecycle triggers a horizontal
contract review rather than automatic duplication.
