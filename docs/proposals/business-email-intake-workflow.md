# Business Email Intake

Draft registry entry for a RUDI workflow package.

Status: draft. The current registry schema supports `runtime`, `binary`, `agent`, `stack`, `skill`, and `prompt`. It does not yet support `workflow`, so this folder documents the proposed package shape without adding it to `index.json`.

## Proposed Package

```text
workflow:business-email-intake
```

Purpose: help a user and their agent configure an always-on email watcher that logs business-relevant communication to a shared system of record.

This is not an MCP stack by itself. It composes MCP stacks, asks setup questions, creates or connects storage, performs dry runs, and can install a scheduler-backed automation instance. It should not be forced into `stack:*` unless it later exposes MCP tools of its own.

Related skill:

```text
skill:business-communication-secretary
```

The workflow is the installable/configurable process. The related skill is the agent operating procedure for keeping the communication board accurate after the workflow is installed.

## Conceptual Model

- Stack: reusable capability provider, such as `stack:google-workspace` or `stack:notion-workspace`.
- Workflow: customizable business process that uses one or more stacks.
- Automation instance: one installed, configured copy of a workflow running on a schedule or trigger.
- Source connector: an MCP stack that contributes communication signals, such as Gmail, Calendar, meeting transcripts, or call notes.
- Thread action row: one active Notion database row representing the current state of a Gmail thread, with message history logged inside the row page.

For this package:

- Workflow: `workflow:business-email-intake`
- Instance: this Mac's hourly `launchd` watcher
- Source connectors now: `stack:google-workspace`
- Optional transcript source now: `stack:otter-mcp`
- System of record now: `stack:notion-workspace`
- Outputs: Notion Company Communications database, per-row thread logs, and local Markdown communication log

## Agent-Guided Setup

The user works with an agent to instantiate the workflow. The agent should:

1. Verify required stacks are installed.
2. Verify required secrets exist without printing secret values.
3. Ask which email account or accounts to monitor.
4. Ask whether to watch the whole mailbox, inbox only, or selected labels.
5. Ask what counts as business communication.
6. Ask whether to create a new Notion database or use an existing one.
7. Verify the Notion integration can read and write the database.
8. Ask whether matching messages should auto-log or go through review first.
9. Ask whether sent replies should update prior `Needs Reply` rows to `Waiting`.
10. Ask whether calendar events should update meeting rows.
11. Ask whether multiple messages in one Gmail thread should update one action row.
12. Ask whether the agent may prepare response drafts, and where draft text should live.
13. Ask for cadence, such as 15 minutes, hourly, or daily.
14. Generate local config, rules, and scheduler files.
15. Run a dry run and show sample classifications.
16. Install the automation instance only after the dry run looks right.
17. Record health checks, pause/resume commands, and output locations.

## Depends On

Required stacks:

- `stack:google-workspace`
- `stack:notion-workspace`

Related skill:

- `skill:business-communication-secretary`

Optional source stacks:

- `stack:otter-mcp`, for Otter meeting transcripts and notes
- Other communication-source stacks, such as Slack, phone/SMS, or CRM notes, if the workflow instance is configured to watch them

Runtime:

- `runtime:node`

Secrets:

- `GOOGLE_CREDENTIALS`
- `NOTION_API_KEY`

Host capabilities:

- macOS `launchd` for the current instance
- User LaunchAgents directory
- Access to `~/.rudi/secrets.json`
- Access to Google Workspace account state managed by `stack:google-workspace`
- Notion integration access to the target database

## Source And Destination Model

The workflow should separate source systems from the operating board:

- Gmail inbound threads provide external replies, new asks, and source-of-truth message context.
- Gmail sent mail provides whether Brandon or the team has replied.
- Google Calendar provides whether scheduling threads have become real meetings.
- Otter or other transcript sources provide meeting notes, decisions, and follow-up items when configured.
- Notion is the business communication dashboard: current status, current owner, current next action, thread summary, and links back to source systems.

Do not make GitHub or local Markdown the primary operating board. GitHub is for registry/workflow docs and reviewed source changes. Local Markdown is an audit/debug trail. Notion is the user-facing coordination surface.

## Configurable Fields

Suggested workflow config:

- `gmail.query`: Gmail search query
- `gmail.sentQuery`: sent-mail query for correspondence reconciliation
- `gmail.maxResults`: maximum messages to inspect per run
- `gmail.accounts`: account selector, if multi-account support is enabled
- `calendar.enabled`: whether to reconcile meeting rows against calendar events
- `calendar.days`: number of upcoming days to inspect
- `classification.mode`: `auto-log` or `review-first`
- `classification.rulesPath`: local rules file
- `classification.excludeCategories`: promotions, social, forums, spam, trash
- `correspondence.threadUpsert`: whether one active row should represent a Gmail thread
- `correspondence.threadLog`: whether message history should append to the row page
- `correspondence.updateNeedsReplyFromSent`: whether sent replies update prior rows to `Waiting`
- `drafts.enabled`: whether the workflow can prepare response drafts
- `drafts.destination`: `notion`, `gmail-draft`, `local-file`, or `manual`
- `notion.databaseId`: target database ID
- `notion.createDatabase`: whether the setup flow should provision a database
- `outputs.localMarkdownLog`: local communication log path
- `scheduler.kind`: `launchd`, `cron`, or `manual`
- `scheduler.intervalSeconds`: cadence for scheduled instances
- `privacy.storeBodies`: whether to store full bodies, snippets, or summaries only

## Installs

The reusable workflow package should install to:

```text
~/.rudi/workflows/business-email-intake/
```

An installed automation instance can live at:

```text
~/.rudi/automations/business-email-intake/
```

Expected instance layout:

```text
business-email-intake/
├── README.md
├── config.json
├── business-communication-intake-rules.md
├── communication-log.md
├── bin/
│   ├── business-email-intake.mjs
│   └── run-business-email-intake.sh
├── logs/
└── state/
```

macOS scheduler for the current instance:

```text
~/Library/LaunchAgents/com.learnrudi.business-email-intake.plist
```

LaunchAgent settings:

- `RunAtLoad`: true
- `StartInterval`: 3600
- Working directory: `~/.rudi/automations/business-email-intake`
- Program: `~/.rudi/automations/business-email-intake/bin/run-business-email-intake.sh`

## Required Notion Shape

Default database name:

```text
Company Communications
```

Configured per-instance database ID:

```text
<notion_database_id>
```

Expected properties:

- `Thread` title
- `Category` select
- `Companies` rich text
- `Contacts` rich text
- `Status` select
- `Waiting On` select: `Me`, `Them`, or `None`
- `Last Direction` select: `Inbound`, `Outbound`, `Calendar`, or `Manual`
- `Last From` rich text
- `Last Activity` date
- `Due Date` date
- `Last Inbound At` date
- `Last Outbound At` date
- `Last Calendar At` date
- `Last Message ID` rich text
- `Thread ID` rich text
- `Gmail Thread URL` url
- `Thread Summary` rich text
- `Last Response Summary` rich text
- `Next Action` rich text
- `Sensitivity` select
- `Drive URL` url
- `Priority` select, optional/hidden from main views
- `Owner` people or text, optional/hidden from main views

The recommended workflow shape is one active row per Gmail `Thread ID`. Message-level history belongs in the row page body and local audit log, not in duplicate database rows. Avoid carrying old inbox-style fields such as `Channel`, `Sender`, `Source URL`, `Storage URL`, `GitHub Path`, and `Reviewed` in the main database unless a specific deployment needs them.

Recommended views:

- `Action View`: critical active queue columns only.
- `Needs Reply`: filtered to `Needs Reply`.
- `Waiting`: filtered to `Waiting`.
- `Thread Review`: fuller row-review/audit layout.
- `Status Board`: board grouped by `Status`.
- `System Audit`: visible system fields for watcher debugging.
- `Ignored / Duplicates`: rows intentionally retired to `Ignore`.

Duplicate cleanup should be non-destructive. When multiple active rows share one `Thread ID`, the workflow should keep the newest row as canonical, append a consolidation note to that row page, and mark older rows `Ignore` rather than deleting them.

## Security Rules

- Do not store secret values in registry files.
- Do not print OAuth credentials, Notion tokens, or connection strings.
- Do not mutate email without explicit user approval.
- Prefer summaries over full message bodies for shared outputs.
- Keep scheduler logs local unless scrubbed.
- Store only secret names in manifests.

## Health Checks

Dry run:

```bash
~/.rudi/automations/business-email-intake/bin/run-business-email-intake.sh --dry-run
```

LaunchAgent status:

```bash
launchctl print gui/$(id -u)/com.learnrudi.business-email-intake
```

Recent watcher log:

```bash
tail -n 80 ~/.rudi/automations/business-email-intake/logs/business-email-intake.log
```

State file:

```bash
cat ~/.rudi/automations/business-email-intake/state/business-email-intake-state.json
```

Otter MCP verification:

```bash
~/.rudi/bins/rudi-router
```

Then call `stack:otter-mcp.get_user_info` through the router. On June 24, 2026, the installed stack was verified through the RUDI router with tools `search`, `fetch`, and `get_user_info`. The direct command `rudi run stack:otter-mcp` currently fails before OAuth because the hosted MCP URL is resolved as a local path; the router path works and should be used by agents and automation.

## Proposed Registry Schema Extension

A workflow package needs fields that stacks do not currently model:

```json
{
  "id": "workflow:business-email-intake",
  "kind": "workflow",
  "name": "Business Email Intake",
  "version": "0.1.0",
  "description": "Configure an email watcher that logs business-relevant communication to Notion.",
  "delivery": "catalog",
  "install": {
    "source": "catalog",
    "path": "catalog/workflows/business-email-intake"
  },
  "dependsOn": [
    "runtime:node",
    "stack:google-workspace",
    "stack:notion-workspace"
  ],
  "optionalDependsOn": [
    "stack:otter-mcp"
  ],
  "related": {
    "skills": [
      "skill:business-communication-secretary"
    ]
  },
  "requires": {
    "secrets": [
      "GOOGLE_CREDENTIALS",
      "NOTION_API_KEY"
    ],
    "hostCapabilities": [
      "launchd"
    ]
  },
  "configurable": true,
  "runModes": [
    "dry-run",
    "manual",
    "scheduled"
  ],
  "scheduler": {
    "supportedKinds": [
      "launchd",
      "cron",
      "manual"
    ],
    "defaultKind": "launchd",
    "defaultIntervalSeconds": 3600
  },
  "operations": {
    "dryRun": "bin/run-business-email-intake.sh --dry-run",
    "runOnce": "bin/run-business-email-intake.sh",
    "status": "launchctl print gui/$(id -u)/com.learnrudi.business-email-intake"
  }
}
```

## Open Design Questions

- Should the package kind be `workflow` or should `workflow` be a subtype of a broader `blueprint` kind?
- Should scheduler install/uninstall hooks be part of the workflow package or implemented by the RUDI CLI?
- Should Notion database schemas be declared as provisionable templates?
- Should workflows support multiple named instances, such as one per email account?
- Should state use local SQLite instead of Markdown dedupe once this graduates from draft?
