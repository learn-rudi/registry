---
name: Share Web App
description: Publish or privately preview a local vanilla, Vite, or React-Vite static app through RUDI Share when a user asks to share, publish, host, preview, or open an app on a tailnet-connected mobile device.
version: 0.2.1
category: web
tags:
  - sharing
  - hosting
  - static-site
  - vite
  - react
  - deployment
  - capability:deploy
requires:
  stacks:
    - stack:rudi-share
---

# Share Web App

## Goal

Turn the user's prepared local static web artifact into a working RUDI Share
URL. Use **Tailnet private** for access limited by the user's existing tailnet,
or **Anyone with the link** for a forwardable public URL. Do not require a
repository, project-specific server command, manual port selection, or manual
Serve setup.

## Access Contract

Resolve access before publication:

- **Tailnet private** maps to `access: tailnet_private` and
  `provider: tailscale_serve`. The URL is available only through current
  tailnet connectivity and policy. Ask permission to expose the selected
  prepared artifact to the tailnet, then set `confirm_tailnet_access: true`.
  Keep `confirm_publication: false`. Do not call Funnel, change ACLs, approve a
  Serve policy change, choose a port, or start a project server manually.
- **Anyone with the link** maps to `access: anyone_with_link` and
  `provider: rudi_share_service`. The URL is forwardable and is not private or
  team-restricted. Use the exact phrase **Anyone with the link** before
  publication. Never set `confirm_publication: true` until the user explicitly
  approves creating that public link.

If the user asks for a mobile preview, private preview, or access only on their
devices and a tailnet is available, recommend **Tailnet private**. If the user
asks to send a link to someone outside the tailnet or explicitly requests a
public/forwardable link, use **Anyone with the link**. Ask when intent remains
ambiguous.

Never expose, print, persist, or repeat `RUDI_SHARE_TOKEN` or a signed upload URL. Do not put either value in source files, generated app files, documentation, chat output, logs, or version control.

## Workflow

1. Call `rudi_share_preflight` with the absolute project path.
2. Stop on blockers. Explain that V0 supports only vanilla HTML/CSS/JavaScript, Vite, and React-Vite static output. Do not propose cloud source builds, SSR, APIs, functions, databases, or server processes as supported.
3. For vanilla, use the returned project directory as the artifact. For Vite or React-Vite, run only the returned install and build commands in the user's project shell, then require a root `index.html` in the returned artifact directory.
4. Tell the user the detected project type and proposed access mode. Ask one of:
   - `Preview <name> as Tailnet private, exposing only this prepared static artifact to devices allowed by your current tailnet policy?`
   - `Publish <name> so Anyone with the link can open and forward it?`
5. After approval, call `rudi_share_publish` with a stable unique
   `idempotency_key`, explicit `access` and `provider`, the matching confirmation
   boolean, and the returned absolute `artifact_path`.
6. For Tailnet private, require an artifact path accessible to the stack. Do not
   create a local server, choose a port, invoke Tailscale, or configure Serve in
   the shell; RUDI Share owns that lifecycle.
7. For Anyone with the link, if the result is `upload_required`, use the
   caller's shell to create an uncompressed USTAR archive from the artifact
   directory. Exclude macOS metadata and extended attributes. Stream it directly
   to the signed target, delete the temporary archive, and never expose the URL.
8. Call `rudi_share_get` with the same `access` and `provider` until health is
   `healthy`, public status is `published`, or a stable failure is returned. Use
   bounded polling and the same operation identity.
9. Open the returned URL and verify the root page, one nested asset, and one
   client-side route when applicable. For Tailnet private, verify from a
   tailnet-connected device when possible. Treat failure as incomplete.
10. Return app name, share ID, provider, access, owner-visible URL, health/status,
    artifact hash/count/bytes, and timestamps. For public mode repeat
    **Anyone with the link**. Never return a signed upload URL.

## Project Rules

- Accept vanilla only when `index.html` exists at the project root.
- Accept Vite only when `package.json` declares Vite, includes a build script, and has exactly one supported lockfile.
- Classify Vite plus React as React-Vite.
- Run the package-manager command selected by preflight; do not substitute another package manager.
- Never upload source directories for Vite or React-Vite. Upload the completed static artifact directory only.
- Do not modify app source merely to make deployment succeed without telling the user.
- Do not publish `.env*`, repository metadata, package files, source maps, local databases, logs, cache state, private keys, or likely credentials.

## Portable Upload

Use the portable path only when the MCP runtime cannot read the caller's artifact directory. The caller shell, not the MCP server, owns packaging and upload. Use a fresh temporary file, USTAR format, no compression, and a binary `PUT` to the signed endpoint. A failed upload is not a published app; read share status and report the stable failure code.

Portable upload applies only to **Anyone with the link**. Tailnet-private
preview is a local transport and requires the stack to validate and materialize
the selected artifact on the same filesystem.

## Unpublish

When the user asks to remove or revoke a share, first identify it with
`rudi_share_get` using its access/provider. Explain that the URL will stop
working immediately. Call `rudi_share_unpublish` with the same access/provider,
a stable unique `idempotency_key`, and `confirm_unpublish: true` only after
explicit approval. Verify the URL no longer serves the app. In Tailnet private
mode, RUDI Share must remove only its exact Serve endpoint and matching managed
host; never use Serve reset or touch another route.

## Failure Handling

- Missing public-provider configuration: Tailnet private remains available.
  For Anyone with the link, report that RUDI Share cloud setup must supply the
  API URL and publisher token. Never ask the user to paste a token into chat.
- Missing or offline tailnet provider: report the stable safe code and do not
  fall back to Anyone with the link.
- Serve approval required: stop and ask the user to resolve tailnet policy or
  approval outside this workflow. Do not approve or bypass it automatically.
- Port conflict, stale process, ownership mismatch, partial startup, or failed
  health: report the provider receipt and cleanup status. For partial
  revocation, report `routeRevoked`, `hostStopped`, and `artifactRemoved`, then
  retry only the same `rudi_share_unpublish` identity. Do not issue broad
  process kills, Serve reset, or a second publication that could collide.
- Build failure: report the failing local command and do not create a share.
- Artifact rejection: report only the stable error code and safe guidance; never echo matched secret material.
- Expired signed upload: create a new idempotent publication attempt only after confirming the prior share state.
- Network or retryable service failure: retry with bounded backoff using the same idempotency key.
