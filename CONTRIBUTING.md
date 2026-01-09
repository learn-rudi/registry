# Contributing to RUDI Registry

Thank you for your interest in contributing to the RUDI Registry.

## Getting Started

### Prerequisites

- Node.js 18 or later
- [RUDI CLI](https://github.com/learn-rudi/cli) installed

### Setup

```bash
git clone https://github.com/learn-rudi/registry.git
cd registry
npm install
```

## Adding a Stack

1. Create a folder: `catalog/stacks/{stack-id}/`
2. Add `manifest.json` with required fields
3. Add MCP server code in `node/src/` or `python/src/`
4. Add entry to `index.json`
5. Test locally with `rudi install {stack-id} --local`
6. Submit a pull request

### Stack Manifest Requirements

Required fields:
- `id` - Unique identifier (lowercase, hyphens)
- `name` - Display name
- `version` - Semantic version
- `description` - Brief description
- `runtime` - `node` or `python`
- `command` - Array of command arguments

Optional fields:
- `provides.tools` - List of MCP tools
- `requires.binaries` - Binary dependencies
- `requires.secrets` - Secret requirements
- `meta` - Author, license, category, tags

### Secrets Declaration

Declare secrets in `requires.secrets`:

```json
{
  "requires": {
    "secrets": [
      {
        "name": "API_KEY",
        "label": "API Key",
        "required": true,
        "description": "Get yours at https://example.com/api-keys"
      }
    ]
  }
}
```

Never hardcode secrets in stack code.

## Adding a Binary

1. Create `catalog/binaries/{binary-id}.json`
2. Include upstream URLs for each platform
3. Add entry to `index.json`
4. Submit a pull request

### Binary Manifest Example

```json
{
  "id": "mytool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "What it does",
  "installType": "binary",
  "binary": "mytool",
  "upstream": {
    "darwin-arm64": "https://releases.example.com/mytool-macos-arm64",
    "darwin-x64": "https://releases.example.com/mytool-macos-x64",
    "linux-x64": "https://releases.example.com/mytool-linux-x64"
  }
}
```

## Adding a Prompt

1. Create `catalog/prompts/{prompt-id}.md`
2. Add YAML frontmatter with metadata
3. Add entry to `index.json`
4. Submit a pull request

### Prompt Format

```markdown
---
name: My Prompt
description: What this prompt does
category: coding
tags:
  - example
author: Your Name
---

# Prompt Title

Your system prompt content here...
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b add-my-stack`)
3. Make your changes
4. Test locally with the RUDI CLI
5. Commit with a descriptive message
6. Push to your fork
7. Open a pull request

### Commit Messages

Use clear, descriptive commit messages:

```
Add slack stack with messaging tools

- Add manifest.json with tool declarations
- Add MCP server implementation
- Update index.json
```

## Code Style

For MCP server code:

- Use TypeScript for Node.js stacks
- Use type hints for Python stacks
- Include error handling for all tools
- Follow MCP protocol specifications

## Testing

Before submitting:

1. Validate manifest structure
2. Test installation with RUDI CLI
3. Test all declared tools
4. Verify secret injection works

```bash
# Install locally
rudi install my-stack --local

# Run the stack
rudi run my-stack

# Test with Claude or another agent
rudi integrate claude
```

## Categories

When categorizing packages, use these standard categories:

**Stacks:**
- ai-generation
- ai-local
- productivity
- communication
- social-media
- data-extraction
- document-processing
- media
- deployment
- utilities

**Binaries:**
- media
- data
- devops
- utilities
- ai-ml
- version-control

**Prompts:**
- coding
- writing
- creative
- utilities
- general

## Questions

If you have questions about contributing, open a discussion on GitHub or reach out via issues.

## License

By contributing to RUDI Registry, you agree that your contributions will be licensed under the MIT License.
