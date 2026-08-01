# ADR 0003: RUDI Share Stack And Service Boundary

## Status

Accepted

## Context

RUDI Share lets an agent publish a locally prepared static web artifact and return a URL without turning the registry stack into a cloud application or making the cloud service responsible for building arbitrary source projects. The workflow crosses three trust and deployment boundaries: local project preparation, a portable MCP/API adapter, and a remote hosting service.

Those boundaries must work when an interactive shell and the MCP runtime do not share a filesystem. They must also isolate untrusted uploaded JavaScript from the authenticated control plane across a browser origin and cookie boundary, and keep uploaded artifacts and service state out of the public registry catalog.

## Decision

The canonical product and service name is **RUDI Share**. Its future registry packages are `stack:rudi-share` and companion `skill:share-web-app`.

The stack is the local stdio MCP/API adapter and portable executable package. It exposes the remote publishing contract. For the portable upload path, the service, through the adapter, issues a signed upload target; the agent workflow guided by the skill streams the prepared static bundle directly from the interactive shell or caller to that target. The stack may provide a same-filesystem convenience path when its runtime can read the caller's artifact directory. That convenience is not the portable contract, which never requires the MCP runtime to read a caller path or accept the artifact as base64 or MCP-sized chunks.

The skill owns the instructions and contract for project detection, local build or no-build packaging, the user-facing workflow, confirmation before publication, and post-publication verification. The agent workflow guided by the skill performs those actions. V0 accepts only a locally prepared, self-contained static artifact directory or bundle whose files can be served directly to a browser. Framework detection and supported build or no-build paths belong in the skill contract and its tests, not in the service boundary.

SSR applications, APIs, functions, databases, server processes, and cloud source builds are outside the contract.

The remote service is a separate deployable boundary in the RUDI `apps/cloud` repository, for example `apps/share-api`. It is not part of Memory Cloud domain logic. The service owns publisher and control-plane authentication and authorization, signed upload issuance and completion, publication metadata and state, object storage, artifact validation without executing uploaded code, content serving, URL management, revocation and retention, quotas, audit records, and operational concerns.

Untrusted site JavaScript is served from a dedicated content origin on a separate registrable domain and cookie boundary from the control API. Control-plane cookies are never scoped to the content domain. CORS and CSRF policy deny credentialed cross-origin access from the content domain to the control API.

The registry source/runtime-state boundary from ADR 0001 applies. Registry catalog packages contain portable stack and skill source only; uploaded artifacts, publication metadata, service state, and generated local state must not live under `catalog/`.

Neither `stack:rudi-share` nor `skill:share-web-app` is merged or added to the registry index until a callable staging API exists and consumer contract tests pass against it.

V0 viewer access uses an unlisted public link. Anyone who possesses or receives the high-entropy URL can open the share without an account, invitation, or workspace membership. The link is a bearer capability: forwarding it grants access, so product language must say "Anyone with the link" and must not describe the share as private or team-restricted. The service must support immediate owner revocation or unpublish, send `noindex` directives, and keep publisher and control-plane authentication separate from viewer access.

## Consequences

RUDI Share has a portable boundary between local preparation and remote publication: the agent workflow guided by the skill prepares the static bundle, the stack negotiates a signed upload target, the caller streams the bundle directly to that target, and the service validates, stores, and serves the files without running user build code. The MCP runtime does not need access to the caller's filesystem or relay artifact bytes through tool arguments.

The cloud deployment can evolve independently from Memory Cloud while sharing approved platform infrastructure where appropriate. The separate registrable content domain, cookie scope, and cross-origin controls limit the authority available to untrusted site code.

Unlisted-link access keeps recipient experience account-free and makes shares easy to forward. It does not provide recipient identity, membership enforcement, or confidentiality after the URL is shared; those capabilities require a later access model.

V0 supports a deliberately narrow, framework-neutral static-hosting surface. Framework support can evolve through the skill contract and tests without changing the service's static artifact boundary. Dynamic applications and cloud builds require later architecture decisions. Registry publication is also gated on an executable staging contract and integration evidence rather than documentation or package shape alone.
