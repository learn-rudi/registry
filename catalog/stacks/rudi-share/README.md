# RUDI Share Stack

RUDI Share publishes a locally prepared static web artifact through one of two
explicit access modes while retaining the same four MCP tools.

| Access | Provider | Viewer boundary |
| --- | --- | --- |
| **Tailnet private** | `tailscale_serve` | Devices allowed by the user's existing tailnet policy |
| **Anyone with the link** | `rudi_share_service` | Anyone who receives the forwardable bearer URL |

Omitting `access` and `provider` preserves the original Anyone-with-the-link
behavior. Public publication still requires `confirm_publication: true` after
the user approves that exact access phrase. Tailnet-private publication requires
`access: tailnet_private`, a prepared `artifact_path`, and
`confirm_tailnet_access: true` after the user approves exposing that selected
artifact to their tailnet.

Tailscale is the private mode's southbound transport, not a separate publishing
product. RUDI Share owns the loopback host, port selection, Serve setup, health,
status, and revocation lifecycle. Agents and users do not run project servers or
Serve commands manually.

## Supported Artifacts

- Vanilla HTML/CSS/JavaScript with a root `index.html`
- Vite static output with a supported lockfile and build script
- React applications built to static output with Vite

Both providers accept only a completed static artifact. RUDI Share rejects
symbolic links, source/package metadata, `.env*`, Git metadata, caches,
`node_modules`, databases, logs, source maps, private keys, likely credentials,
oversized artifacts, and artifacts without root `index.html`. It never runs
artifact code during validation. Reads use no-follow file descriptors where
the platform exposes that flag, plus opened-root containment and pre/post
descriptor/path identity checks on every platform, so a path or file changed
during screening is rejected instead of copied into the served snapshot.

SSR, APIs, functions, databases, WebSockets, cloud source builds, and arbitrary
server processes are outside the contract.

## Configuration

The stack can start with no cloud credentials. Tailnet-private mode discovers
the installed Tailscale CLI when invoked and reports a stable safe error when
Tailscale is missing, offline, or returns invalid status.

Anyone-with-the-link mode requires these values only when that provider is
called:

- `RUDI_SHARE_API_URL`: RUDI Share control-plane URL
- `RUDI_SHARE_TOKEN`: RUDI-issued publisher token with at least 32 bytes

The token is sent only to the control API. A signed upload URL is scoped to one
upload, expires after ten minutes, and is never combined with the publisher
token. Neither value is inherited by the managed private preview host.

## Tools

| Tool | Purpose |
| --- | --- |
| `rudi_share_preflight` | Detect vanilla, Vite, or React-Vite and return the artifact/build contract. |
| `rudi_share_publish` | After mode-specific approval, publish through the selected provider. |
| `rudi_share_get` | Return provider, access, URL, health/status, artifact provenance, and timestamps. |
| `rudi_share_unpublish` | After approval, immediately revoke the selected URL through its owning provider. |

`rudi_share_publish`, `rudi_share_get`, and `rudi_share_unpublish` accept the
optional machine-readable pair:

- `access`: `anyone_with_link` or `tailnet_private`
- `provider`: `rudi_share_service` or `tailscale_serve`

The pair must agree. The provider is inferred from access when omitted, and both
default to the original public provider when omitted together.

## Tailnet-Private Lifecycle

1. RUDI Share validates the entire selected static artifact before exposure.
2. It materializes an immutable screened snapshot below
   `~/.rudi/state/rudi-share/previews/<preview-id>/artifact` (or an injected
   test root). It never points the host at a source repository.
3. A managed child serves only that snapshot on `127.0.0.1`; the child receives
   a minimal allowlisted environment and no stack credentials. It remains
   parent-supervised over IPC and exits if the parent disappears before its
   exact ownership journal commits.
4. RUDI Share chooses a free loopback port and a free tailnet HTTPS port in the
   private range beginning at `8443`. HTTPS port `443` is reserved and never
   selected, overwritten, or revoked. Background, foreground, service, and
   Funnel-owned ports are all treated as occupied.
5. The adapter configures background Tailscale Serve as an HTTPS reverse proxy
   to the exact loopback target. It never invokes Funnel, changes ACLs, resets
   Serve, or passes automatic approval flags.
6. Before the child is allowed to detach or the Serve mutation begins, RUDI
   Share persists a `starting` ownership journal with the exact host, port, URL,
   and artifact identity. A crash or failed cleanup becomes `cleanup_required`
   and remains addressable through status and unpublish instead of being
   reported as published.
7. Publication succeeds only after identity-bound loopback and tailnet health
   checks. Status refreshes the current device DNS identity before an HTTPS
   health request and refuses redirects. The owner receives provider/access,
   URL, health, artifact hash/count/bytes/source path, timestamps, and the
   preview ID.
8. Revocation compares saved port/target ownership against live Serve status
   and independently attempts to stop only the matching host identity, so a
   changed route cannot keep the artifact process alive. It removes the
   materialized snapshot only after verified process exit and records
   `routeRevoked`, `hostStopped`, and `artifactRemoved` separately. Incomplete
   work remains `cleanup_required` with the exact retry receipt. State retains
   the 128 newest fully completed revoked receipts, never compacts unresolved
   ownership, and fails closed at its storage bound.

Multiple previews use distinct HTTPS and loopback ports. Each is mounted at `/`
on its own HTTPS origin/port so root-relative assets and client-side routes keep
their normal static-host behavior.

### Failure behavior

Stable failures distinguish missing/offline Tailscale, invalid status, Serve
approval required, port exhaustion/conflict, invalid state, invalid artifact,
stale process, route ownership mismatch, partial startup/revocation cleanup,
artifact cleanup failure, and failed health. Messages do not expose command
output, secrets, or matched credential material. Approval-required failures
stop; RUDI Share does not approve policy changes. Ambiguous route ownership
fails closed for that route while exact managed-host shutdown is still
attempted independently. Incomplete cleanup returns the exact owner receipt and
the supported `rudi_share_unpublish` reconciliation path.

## Anyone-With-The-Link Lifecycle

Passing `artifact_path` packages and uploads the validated artifact directly.
Omitting it returns a signed upload session so a caller on another filesystem
can create a USTAR archive and stream it to the remote service. Signed URLs must
not be logged, persisted, or shown to the user.

The remote service independently validates the complete tar before atomic
publication. Viewers need no account, and the URL remains forwardable until
explicitly unpublished.

## Local Development

```bash
npm ci
npm test
npm run build
```

To exercise the public provider locally, supply development-only cloud values
to the process. Unit tests inject temporary state roots, host controllers, and
tailnet adapters. Live private smoke tests must use a non-443 temporary endpoint
and revoke only the exact route/process they create.
