# Stacks

MCP (Model Context Protocol) servers that extend Claude with tools for external services.

## Structure

Each stack is a folder containing:

```
{stack-id}/
├── manifest.json     # Required: Stack metadata
├── node/             # Node.js MCP server (if runtime: node)
│   └── src/
│       └── index.ts
└── python/           # Python MCP server (if runtime: python)
    └── src/
        └── server.py
```

## manifest.json

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `"slack"`) |
| `name` | string | Display name (e.g., `"Slack"`) |
| `version` | string | Semver version (e.g., `"1.0.0"`) |
| `description` | string | Short description |
| `mcp` | object | MCP server configuration |
| `mcp.runtime` | string | `"node"` or `"python"` |
| `mcp.command` | string | Command to run (e.g., `"npx"`) |
| `mcp.args` | string[] | Command arguments |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `secrets` | array | Required API keys/credentials |
| `secrets[].key` | string | Environment variable name |
| `secrets[].label` | string | Display label in UI |
| `secrets[].description` | string | Help text |
| `secrets[].helpUrl` | string | Link to get the credential |
| `secrets[].required` | boolean | Whether secret is required |
| `tools` | string[] | List of MCP tool names provided |
| `tags` | string[] | Search tags |
| `category` | string | Category for grouping |
| `icon` | string | Emoji icon |
| `author` | string | Author name |
| `license` | string | License identifier |
| `runtimes` | string[] | Available runtimes (if multiple) |

### Example

```json
{
  "id": "slack",
  "name": "Slack",
  "version": "1.0.0",
  "description": "Send messages, search channels, upload files",
  "author": "Prompt Stack",
  "license": "MIT",
  "mcp": {
    "runtime": "node",
    "command": "npx",
    "args": ["tsx", "node/src/index.ts"]
  },
  "secrets": [
    {
      "key": "SLACK_BOT_TOKEN",
      "label": "Slack Bot Token",
      "description": "Bot token from your Slack App (xoxb-...)",
      "helpUrl": "https://api.slack.com/apps",
      "required": true
    }
  ],
  "tools": [
    "slack_send_message",
    "slack_list_channels",
    "slack_read_channel",
    "slack_search",
    "slack_upload_file"
  ],
  "tags": ["slack", "messaging", "chat"],
  "category": "communication",
  "icon": "💬"
}
```

## Adding a New Stack

1. Create folder: `catalog/stacks/{your-stack-id}/`
2. Add `manifest.json` with required fields
3. Add MCP server code in `node/` or `python/`
4. Add entry to `index.json` under `packages.stacks.official`:

```json
{
  "id": "stack:your-stack-id",
  "name": "Your Stack Name",
  "version": "1.0.0",
  "description": "What it does",
  "path": "catalog/stacks/your-stack-id",
  "runtime": "runtime:node",
  "category": "productivity",
  "tags": ["tag1", "tag2"],
  "requires": {
    "secrets": ["YOUR_API_KEY"]
  }
}
```

5. Push to main branch

## Current Stacks

| Stack | Description | Secrets Required |
|-------|-------------|------------------|
| `google-workspace` | Gmail, Sheets, Docs, Drive, Calendar | `GOOGLE_CREDENTIALS` |
| `notion-workspace` | Pages, databases, search | `NOTION_API_KEY` |
| `slack` | Messages, channels, files | `SLACK_BOT_TOKEN` |
| `zoho-mail` | Email via Zoho | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` |
| `google-ai` | Gemini, Imagen, Veo | `GOOGLE_AI_API_KEY` |
| `openai` | DALL-E, Whisper, TTS, Sora | `OPENAI_API_KEY` |
| `social-media` | Twitter, LinkedIn, Facebook, Instagram | (platform-specific) |
| `content-extractor` | YouTube, Reddit, TikTok, Articles | (optional) |
| `video-editor` | ffmpeg-based video editing | - |
| `web-export` | HTML to PNG/PDF | - |
| `ms-office` | Read Word/Excel documents | - |

## Installation

```bash
pstack install stack:slack
pstack install stack:notion-workspace
```

Installed to: `~/.prompt-stack/stacks/{stack-id}/`
