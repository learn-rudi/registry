# Google Workspace RUDI Stack

RUDI MCP stack for Gmail, Google Drive, Google Docs, Google Sheets, Google Slides, Google Calendar, and Google Tasks workflows.

This stack owns Google Workspace OAuth, account selection, and direct Workspace API calls. Other stacks should call this stack for Gmail or Drive access instead of handling Google OAuth themselves.

## Tools

- Account tools: `account_list`, `account_switch`, `account_current`
- Gmail tools: profile, ordered history/cursor reads, search, get, send, draft, reply, forward, labels, archive, trash, batch operations, and attachments
- Sheets tools: read, write, append, create
- Docs tools: read, create, insert image
- Slides tools: get presentation, get slide, get thumbnail, raw batch update
- Drive tools: list, upload, create folder, move, download, make public, delete
- Calendar tools: bounded historical organizer/attendee discovery pages, list, create, quick add, delete
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

For privacy-minimized relationship discovery, `calendar_discovery_page`
requires an exact `account`, exact `calendar_id`, inclusive `window_start`,
exclusive `window_end`, bounded page/observation sizes, and an optional
continuation token. It verifies the authenticated Gmail profile matches the
requested account and returns only the echoed scope/window plus ordered
organizer/attendee observations. Provider event IDs and recurrence IDs become
source/account/calendar-scoped SHA-256 keys; event titles, descriptions,
locations, URLs, response statuses, raw provider objects, and credentials never
cross the discovery boundary.

`gmail_send` resolves the authenticated Gmail profile and renders that primary mailbox as the RFC 2822 `From` header. It does not silently inherit a different default Send-As alias.

Ask for explicit user confirmation before sending email, sending a draft, deleting messages, deleting Drive files, making Drive files public, creating/deleting calendar events, applying Slides batch updates, or creating/updating/completing/deleting tasks.

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
