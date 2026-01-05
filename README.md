# Prompt Stack Registry

Official registry for stacks, tools, agents, runtimes, and prompts.

## Package Types

| Type | Description | Location |
|------|-------------|----------|
| **Stack** | MCP servers with tools | `catalog/stacks/{id}/` |
| **Tool** | Standalone binaries/CLIs | `catalog/tools/{id}.json` |
| **Agent** | AI coding assistants | `catalog/agents/{id}.json` |
| **Runtime** | Language interpreters | `catalog/runtimes/{id}.json` |
| **Prompt** | System prompt templates | `catalog/prompts/{id}.md` |

## Installation

```bash
# Search for packages
pstack search whisper

# Install packages
pstack install stack:whisper
pstack install tool:ffmpeg
pstack install prompt:code-review

# List installed
pstack list
```

## Repository Structure

```
index.json                    # Package index (all metadata)

catalog/
├── stacks/                   # MCP server stacks
│   └── {stack-id}/
│       ├── manifest.json     # Stack metadata
│       └── node/src/ or python/src/
│
├── prompts/                  # Prompt templates
│   └── {prompt-id}.md        # Markdown with YAML frontmatter
│
├── tools/                    # Tool manifests
│   └── {tool-id}.json
│
├── agents/                   # Agent manifests
│   └── {agent-id}.json
│
└── runtimes/                 # Runtime manifests
    └── {runtime-id}.json
```

## Creating a Stack

1. Create folder: `catalog/stacks/{stack-id}/`

2. Add `manifest.json`:
```json
{
  "id": "my-stack",
  "name": "My Stack",
  "version": "1.0.0",
  "description": "What it does",
  "runtimes": ["node"],
  "mcp": {
    "runtime": "node",
    "command": "npx",
    "args": ["tsx", "node/src/index.ts"]
  },
  "secrets": [
    { "key": "MY_API_KEY", "label": "API Key", "required": true }
  ],
  "tools": ["my_tool_1", "my_tool_2"],
  "category": "productivity",
  "tags": ["example"]
}
```

3. Add MCP server code in `node/src/index.ts` or `python/src/server.py`

4. Add entry to `index.json` under `packages.stacks.official`

### Secrets Flow

When users install a stack with secrets:

1. `pstack install my-stack` creates `~/.prompt-stack/stacks/my-stack/.env` with placeholders
2. User edits `.env` to add their API keys
3. MCP registration reads from `.env` and injects into agent configs (Claude, Codex, Gemini)

Example `.env` created on install:
```bash
# API Key for My Stack
# Get yours: https://example.com/api-keys
MY_API_KEY=
```

## Creating a Prompt

1. Create file: `catalog/prompts/{prompt-id}.md`

2. Add YAML frontmatter + content:
```markdown
---
name: My Prompt
description: What this prompt does
category: coding
tags:
  - example
icon: "🔍"
author: Your Name
---

# Prompt Title

Your system prompt content here...
```

3. Add entry to `index.json` under `packages.prompts.official`

## Adding a Tool

Tools use install types to determine how they're installed:

| Install Type | Source | Examples |
|--------------|--------|----------|
| `binary` | Upstream URL | ffmpeg, jq |
| `npm` | npm registry | vercel, wrangler |
| `pip` | PyPI | httpie |
| `system` | User installs | docker, git |

Example tool manifest (`catalog/tools/jq.json`):
```json
{
  "id": "tool:jq",
  "name": "jq",
  "version": "1.7.1",
  "description": "JSON processor",
  "installType": "binary",
  "binary": "jq",
  "upstream": {
    "darwin-arm64": "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-macos-arm64",
    "darwin-x64": "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-macos-amd64",
    "linux-x64": "https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64"
  }
}
```

## Categories

**Stacks:** ai-generation, ai-local, productivity, communication, social-media, data-extraction, document-processing, media, deployment, utilities

**Tools:** media, data, devops, utilities, ai-ml, version-control

**Prompts:** coding, writing, creative, utilities, general

## Current Stacks

| Stack | Description | Auth |
|-------|-------------|------|
| whisper | Local audio transcription | None |
| google-workspace | Gmail, Sheets, Docs, Drive, Calendar | OAuth |
| google-ai | Gemini, Imagen, Veo | API Key |
| openai | DALL-E, Whisper, TTS, Sora | API Key |
| notion-workspace | Pages, databases, search | API Key |
| slack | Messages, channels, files | Bot Token |
| zoho-mail | Email via Zoho | OAuth |
| content-extractor | YouTube, Reddit, TikTok, articles | None |
| video-editor | ffmpeg-based editing | None |
| web-export | HTML to PNG/PDF | None |
| ms-office | Read .docx/.xlsx | None |
| social-media | Twitter, LinkedIn, Facebook, Instagram | OAuth |

## Security

**Never include API keys or secrets in the registry.** Stacks declare required secrets in `manifest.json`. When installed, a `.env` file is created at `~/.prompt-stack/stacks/<id>/.env` where users add their keys locally.

## URLs

- **Index:** `https://raw.githubusercontent.com/prompt-stack/registry/main/index.json`
- **Stacks:** `https://raw.githubusercontent.com/prompt-stack/registry/main/catalog/stacks/{id}/`

## License

MIT
