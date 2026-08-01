---
name: Share Web App
description: Publish a local vanilla, Vite, or React-Vite static app to a revocable RUDI Share URL when a user asks to share, publish, host, preview, or send an app to teammates without configuring GitHub, Vercel, Railway, or another hosting account.
version: 0.1.0
category: deployment
tags: [sharing, hosting, static-site, vite, react, deployment]
requires:
  stacks:
    - stack:rudi-share
---

# Share Web App

## Goal

Turn the user's local static web project into a working RUDI Share URL. The recipient opens the link without an account. Do not require GitHub, Vercel, Railway, a cloud CLI, or a repository.

## Access Contract

Use the exact phrase **Anyone with the link** before publication. The URL is forwardable and is not private or team-restricted. Never set `confirm_publication: true` until the user has explicitly approved creating that public link.

Never expose, print, persist, or repeat `RUDI_SHARE_TOKEN` or a signed upload URL. Do not put either value in source files, generated app files, documentation, chat output, logs, or version control.

## Workflow

1. Call `rudi_share_preflight` with the absolute project path.
2. Stop on blockers. Explain that V0 supports only vanilla HTML/CSS/JavaScript, Vite, and React-Vite static output. Do not propose cloud source builds, SSR, APIs, functions, databases, or server processes as supported.
3. For vanilla, use the returned project directory as the artifact. For Vite or React-Vite, run only the returned install and build commands in the user's project shell, then require a root `index.html` in the returned artifact directory.
4. Tell the user the detected project type and ask: `Publish <name> so Anyone with the link can open and forward it?`
5. After approval, call `rudi_share_publish` with a stable unique `idempotency_key`, `confirm_publication: true`, and the returned absolute `artifact_path` when the MCP process can access that filesystem.
6. If the result is `upload_required`, use the caller's shell to create an uncompressed USTAR archive from the artifact directory. Exclude macOS metadata and extended attributes. Stream the archive with `PUT`, the returned content type, and `--data-binary` directly to the returned signed URL. Delete the temporary archive immediately. Do not relay archive bytes through MCP arguments.
7. Call `rudi_share_get` until status is `published` or `failed`. Use bounded polling and respect retryable errors. Do not create a second share while the first idempotent operation is unresolved.
8. Open the public URL without publisher credentials and verify the page, nested assets, and one client-side route when applicable. Treat verification failure as incomplete publication.
9. Return the app name, share ID, public URL, status, and the phrase `Anyone with the link`. Do not return the signed upload URL.

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

## Unpublish

When the user asks to remove or revoke a share, first identify it with `rudi_share_get`. Explain that the URL will stop working immediately. Call `rudi_share_unpublish` with a stable unique `idempotency_key` and `confirm_unpublish: true` only after explicit approval, then verify the public URL no longer serves the app.

## Failure Handling

- Missing stack configuration: stop and report that RUDI Share setup must supply the API URL and RUDI-issued publisher token. Never ask the user to paste a token into chat.
- Build failure: report the failing local command and do not create a share.
- Artifact rejection: report only the stable error code and safe guidance; never echo matched secret material.
- Expired signed upload: create a new idempotent publication attempt only after confirming the prior share state.
- Network or retryable service failure: retry with bounded backoff using the same idempotency key.
