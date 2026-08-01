# RUDI Share Stack

RUDI Share is the MCP adapter for publishing a locally prepared static web app to a revocable URL. Viewers do not need an account. The URL is a bearer capability: **Anyone with the link** can open and forward it.

## Supported Projects

- Vanilla HTML/CSS/JavaScript with a root `index.html`
- Vite projects with a supported lockfile and build script
- React projects built with Vite

The remote service accepts static files only. It does not run source builds, SSR, APIs, functions, databases, WebSockets, or arbitrary server processes.

## Configuration

The MCP process requires:

- `RUDI_SHARE_API_URL`: RUDI Share control-plane URL
- `RUDI_SHARE_TOKEN`: RUDI-issued publisher token with at least 32 bytes

The publisher token is sent only to the control API. A signed upload URL is scoped to one upload, expires after ten minutes, and is never combined with the publisher token.

## Tools

| Tool | Purpose |
| --- | --- |
| `rudi_share_preflight` | Detect vanilla, Vite, or React-Vite and return the local artifact/build contract. |
| `rudi_share_publish` | After explicit approval, publish an artifact directly or create a portable signed upload session. |
| `rudi_share_get` | Read owner-visible status and the public URL. |
| `rudi_share_unpublish` | After explicit approval, immediately revoke the public URL. |

Passing `artifact_path` to `rudi_share_publish` uses the same-filesystem convenience path. Omitting it returns an upload session so the caller can create a USTAR archive in its own shell and stream it directly to the signed endpoint. The signed URL must not be logged, persisted, or shown to the user.

## Local Development

```bash
npm ci
npm test
npm run build
RUDI_SHARE_API_URL=http://127.0.0.1:8787 \
RUDI_SHARE_TOKEN=replace-with-a-32-byte-development-token \
  npm run dev
```

The stack performs no cloud source build. Artifact files are bounded, deterministically packed, and screened locally; the service independently validates the complete tar before atomic publication.
