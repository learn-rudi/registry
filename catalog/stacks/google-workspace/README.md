# Google Workspace RUDI Stack

RUDI MCP stack for Gmail, Google Drive, Google Docs, Google Sheets, Google Slides, Google Calendar, and Google Tasks workflows.

This stack owns Google Workspace OAuth, account selection, and direct Workspace API calls. Other stacks should call this stack for Gmail or Drive access instead of handling Google OAuth themselves.

## Tools

- Account tools: `account_list`, `account_switch`, `account_current`
- Gmail tools: profile, ordered history/cursor reads, search, get, send, draft, reply, forward, labels, archive, trash, batch operations, and attachments
- Sheets tools: read, write, append, create
- Docs tools: read, create, insert image
- Slides tools: get presentation, get slide, get thumbnail, raw batch update
- Drive tools: list, upload, update, create folder, move, download, make public, delete
- Calendar tools: list, create, quick add, delete
- Tasks tools: list task lists, list tasks, create, update, complete, delete

## Requirements

- Node.js 20+
- RUDI installed and integrated with your agent
- A Google Cloud OAuth client for the Google account or Workspace tenant
- Enabled Google APIs for the tools you plan to use: Gmail, Drive, Docs, Sheets, Slides, Calendar, and Tasks

## OAuth Credentials

The stack reads OAuth client credentials from the RUDI secret `GOOGLE_CREDENTIALS`.

`GOOGLE_CREDENTIALS` may be either:

- the full `credentials.json` content from Google Cloud, or
- an absolute path to a local `credentials.json` file

The credentials JSON must contain either an `installed` or `web` OAuth client with `client_id` and `client_secret`.

Do not paste OAuth client secrets, refresh tokens, access tokens, or connection strings into agent messages, logs, docs, or committed files.

Do not copy credentials or tokens into `~/.rudi/stacks/google-workspace/`; installed stack source may be replaced during reinstall or update. Use `rudi secrets set GOOGLE_CREDENTIALS` for OAuth client credentials and let `rudi auth` write per-account tokens under RUDI state.

## RUDI Setup

Install and configure the stack:

```bash
rudi install stack:google-workspace
rudi secrets set GOOGLE_CREDENTIALS
rudi auth google-workspace user@example.com
rudi index stack:google-workspace --json
rudi integrate codex
```

Restart or reload the agent after integration.

## OAuth Callback

The auth helper starts a local callback server and opens a browser.

Default callback:

```text
http://localhost:3456/callback
```

If that port is occupied, the helper tries the next free port through `3465`. Register the callback URI your OAuth client will use in Google Cloud. For web clients, add every fallback URI you expect to allow.

The account argument is an identity boundary, not just a local label. During consent, select the exact Google user passed to `rudi auth`. Before saving a token, the helper retrieves the authenticated Gmail profile and verifies that its primary email address matches the requested account. A mismatch is rejected without overwriting the account's existing token.

Each account must have its own real directory beneath the stack's `accounts` state directory. Account-directory symlinks and linked token files are rejected so one mailbox cannot redirect or share another mailbox's credentials.

The requested scopes are:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/tasks`

## State

Tokens and account state are stored outside the installed stack:

```text
~/.rudi/state/stacks/google-workspace/
```

Per-account tokens live at:

```text
~/.rudi/state/stacks/google-workspace/accounts/<account-email>/token.json
```

State files are written with private file permissions where the filesystem supports POSIX modes. Legacy token/account files from older installed stack directories are migrated into this state directory when the stack starts.

## Agent Guidance

Use `account_current` before acting when account context matters. Use `account_switch` or pass the tool's account argument when working across multiple Google accounts.

`gmail_send` resolves the authenticated Gmail profile and renders that primary mailbox as the RFC 2822 `From` header. It does not silently inherit a different default Send-As alias.

Ask for explicit user confirmation before sending email, sending a draft, deleting messages, deleting Drive files, making Drive files public, creating/deleting calendar events, applying Slides batch updates, or creating/updating/completing/deleting tasks.

### My Drive and Shared Drives

Drive tools accept an optional `account`. Always pass the exact configured
account when account identity matters; do not rely on a previously selected
global account for cross-account workflows.

Omitting `drive_id` preserves My Drive behavior. To target one Google Shared
Drive, pass its opaque `drive_id` together with the exact `account`. The stack
automatically applies Google's Shared Drive flags and validates returned file
metadata against that Drive. `corpora: allDrives` also requires an explicit
`account`.
`drive_list` also accepts:

- `corpora`: `user`, `drive`, `domain`, or `allDrives`; `drive` requires
  `drive_id`, and supplying `drive_id` requires the `drive` corpus
- `page_token`: the continuation token from the previous result
- `max_results`: an integer from 1 through 1000, defaulting to 20

`drive_list` keeps its legacy file-array text result and also returns structured
content with `files`, `nextPageToken`, and `incompleteSearch`. Follow
`nextPageToken` until it is absent. An empty page is not proof that a search is
complete when a continuation token is present.

Uploads and folder creation support explicit exact-parent collision policies:

- My Drive defaults to `create_new` for compatibility.
- An explicitly selected Shared Drive defaults to `fail`.
- Uploads may use `reuse_if_same`, which reuses exactly one matching name only
  when its provider SHA-256 matches the local file.
- Folder creation may use `reuse`, which reuses exactly one matching folder.
- Multiple exact matches always fail as ambiguous.

Drive names are not unique. For deterministic workflows, scope discovery to an
exact parent, escape Google Drive query literals, and retain the returned file
ID. Successful writes return structured Google Drive provider references rather
than only display links.

`drive_download` supports stored blob files, writes through a temporary file,
and returns the byte count and locally calculated SHA-256. Native Google Docs,
Sheets, Slides, folders, and shortcuts require a separate export contract.

Shared Drive permission changes and permanent deletion are intentionally not
supported by `drive_make_public` or `drive_delete` in this release. The delete
tool permanently deletes; it does not move a file to trash.

If a tool reports that authentication is missing, run:

```bash
rudi auth google-workspace user@example.com
```

Then rebuild the router cache:

```bash
rudi index stack:google-workspace --json
```

## Local Development

From this stack directory:

```bash
npm install
npm run build
npm run test:auth
npm run test:drive
npm run test:gmail
npm run test:calendar
npm run test:slides
npm run test:tasks
npm run test:state
```

Run the MCP server directly:

```bash
npx tsx src/index.ts
```
