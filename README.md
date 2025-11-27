# Prompt Stack Community Registry

The official repository of tools and prompts for [Prompt Stack](https://github.com/prompt-stack/studio).

## Installation

Install tools directly from this registry:

```bash
# From Prompt Stack Studio
Settings > Tools > Browse Registry

# Or via CLI (coming soon)
prompt-stack install github:prompt-stack/registry/tools/official/reddit-extractor
```

## Structure

```
registry/
  registry.json          # Master index of all tools and prompts
  tools/
    official/            # Maintained by Prompt Stack team
      reddit-extractor/
      deploy-vercel/
      ...
    community/           # Community contributions
      your-tool/
  prompts/
    official/            # Official prompt templates
    community/           # Community prompts
```

## Contributing a Tool

### 1. Fork this repository

### 2. Create your tool folder

```
tools/community/your-tool-name/
  tool.json           # Required: Tool manifest
  entrypoint.py       # Your main script (or .js, .sh)
  README.md           # Documentation
```

### 3. Define your tool.json

```json
{
  "id": "your-tool-name",
  "name": "Your Tool Name",
  "version": "1.0.0",
  "description": "What your tool does",
  "author": "Your Name",
  "license": "MIT",
  "runtime": "python",
  "entrypoint": "entrypoint.py",
  "inputs": [
    {
      "name": "input_name",
      "type": "string",
      "description": "Description of the input",
      "required": true
    }
  ],
  "outputs": [
    {
      "name": "output_name",
      "type": "string",
      "description": "What gets returned"
    }
  ],
  "secrets": [
    {
      "key": "YOUR_API_KEY",
      "label": "Your Service API Key",
      "description": "Get this from your-service.com/settings",
      "helpUrl": "https://your-service.com/settings",
      "required": true
    }
  ],
  "dependencies": {
    "python": ["requests", "beautifulsoup4"]
  },
  "tags": ["tag1", "tag2"],
  "category": "data-extraction"
}
```

### 4. Submit a Pull Request

- Ensure your tool works locally first
- Include a README with usage examples
- Never commit API keys or secrets

## Secret Management

**Tools declare WHAT secrets they need. Users provide VALUES locally.**

Your `tool.json` defines secret requirements:
```json
"secrets": [
  {
    "key": "TWITTER_API_KEY",
    "label": "Twitter API Key",
    "description": "Create at developer.twitter.com",
    "helpUrl": "https://developer.twitter.com/en/portal/dashboard",
    "required": true
  }
]
```

Users configure these in Prompt Stack:
- **Settings > Cloud & Secrets** in the app
- Stored encrypted at `~/Library/Application Support/Prompt Stack/secrets.json`
- Never committed to git

## Tool Categories

| Category | Description |
|----------|-------------|
| `data-extraction` | Scraping, API fetching, data collection |
| `deployment` | Deploy apps to cloud platforms |
| `database` | Database creation and management |
| `source-control` | Git, GitHub, version control |
| `content-extraction` | Extract content from videos, docs, etc. |
| `document-processing` | PDF, Word, file conversion |
| `frontend` | React, Vue, frontend scaffolding |
| `ai-tools` | LLM wrappers, embeddings, AI utilities |
| `utilities` | General purpose helpers |

## Contributing a Prompt

Prompts are markdown files with optional frontmatter:

```
prompts/community/your-prompt/
  prompt.md           # The prompt content
  metadata.json       # Optional: extra metadata
```

### prompt.md format

```markdown
---
name: Code Reviewer
description: Strict TypeScript code reviewer
author: Your Name
tags: [typescript, code-review]
category: coding
---

You are a strict TypeScript code reviewer. When reviewing code:

1. Check for type safety issues
2. Look for potential null/undefined errors
3. Suggest improvements for readability
...
```

## License

MIT - See individual tools for their specific licenses.
