# RUDI Registry Schema v2

**Status:** Final
**Date:** 2026-01-09

---

## Design Principles

1. **Single acquisition vocabulary** - `source` tells you HOW to get it
2. **Platform overrides** - `platforms` handles OS/arch differences
3. **Explicit delivery policy** - `delivery` tells you distribution model
4. **Verification required** - checksums for downloads, version pins for packages
5. **Everything is a package** - runtimes, binaries, agents share same shape

---

## Locked Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| `delivery:"bundled"` | Future only - means offline/shipped bits | Not yet implemented; all current packages are `remote` or `system` |
| Linux musl (Alpine) | Unsupported v1 | `linux-x64` implies glibc; add musl later if demand |
| Runtimes special? | No, just `kind:"runtime"` | Same install shape as binaries |
| Allow "latest"? | No for downloads, warn for npm/pip | Downloads must pin version |
| Supply chain minimum | sha256 required for downloads | Foreign binaries must verify |

### v1 Legacy Clarification

In v1, `bundled: true` meant "RUDI-managed download from our releases" (not shipped offline).
This maps to v2 `delivery: "remote"` with URLs pointing to RUDI GitHub releases.

---

## Package Types

| Type | Purpose | Location |
|------|---------|----------|
| `runtime` | Language interpreter | `catalog/runtimes/{name}.json` |
| `binary` | CLI tool | `catalog/binaries/{name}.json` |
| `agent` | AI assistant | `catalog/agents/{name}.json` |
| `stack` | MCP server | `catalog/stacks/{name}/manifest.json` |
| `skill` | Reusable skill template | `catalog/skills/{name}.md` |
| `prompt` | Legacy prompt template | `catalog/prompts/{name}.md` |

---

## Core Fields

### `id` (required)
```
runtime:node
binary:ffmpeg
binary:vercel
agent:claude
stack:video-editor
skill:grill-with-docs
```

### `kind` (required)
```json
"kind": "runtime" | "binary" | "agent" | "stack" | "skill" | "prompt"
```

### `name` (required)
Human-readable display name.
```json
"name": "FFmpeg"
"name": "Claude Code"
```

### `version` (required)
```json
"version": "7.1.0"        // pinned (required for downloads)
"version": "latest"       // npm/pip only (with warning)
"version": "system"       // system binaries
```

---

## Delivery & Installation

### `delivery` (required)

| Value | Meaning |
|-------|---------|
| `remote` | Fetched from internet at install time |
| `system` | Must exist on system or user installs via OS |
| `bundled` | (Future) Shipped with RUDI installer |

### `install` (required)

```json
"install": {
  "source": "download" | "npm" | "pip" | "system" | "catalog",
  "package": "pkg-name",           // npm/pip only
  "path": "catalog/stacks/...",    // catalog only (optional, derived from id)
  "platforms": { ... }             // download/system, or overrides
}
```

| Source | Used For | Required Fields |
|--------|----------|-----------------|
| `download` | Tarballs, zips from URLs | `platforms.{key}.url`, `platforms.{key}.checksum` |
| `npm` | npm packages | `package`, optionally `version` |
| `pip` | pip packages | `package`, optionally `version` |
| `system` | Pre-installed or OS package manager | `detect.command`, `installHints` recommended |
| `catalog` | In-repo packages (stacks, skills, prompts) | `path` (optional, derived from `id`) |

### Catalog Source

For `source: "catalog"`, the payload lives inside the registry itself:
- Installing = sync from registry cache → local install directory
- If `path` omitted, derived from `id`:
  - `stack:video-editor` → `catalog/stacks/video-editor`
  - `skill:grill-with-docs` → `catalog/skills/grill-with-docs.md`
  - `prompt:code-review` → `catalog/prompts/code-review.md`
- Integrity handled at registry-release artifact level (no per-file checksum)

Catalog source must remain portable. Do not publish generated runtime state, local account state, dependency installs, downloaded media, rendered outputs, browser profiles, or private workflow artifacts under `catalog/`. Stack state belongs under `~/.rudi/state/stacks/{stack-id}` by default, and registry checks exclude forbidden stack-local paths such as `node_modules`, `runs`, `downloads`, `tmp`, `.chrome-profiles`, `.test-rudi`, `clips`, `output`, `outputs`, and `composer/public/media`.

### Skill Markdown Packages

Skills are stored as ready-to-run, editable Markdown under `catalog/skills/{name}.md`.
During v2 validation and compile, the registry derives:

- `id`: `skill:{name}` from the Markdown filename
- `kind`: `skill`
- `delivery`: `remote`
- `install.source`: `catalog`
- `install.path`: the Markdown file path

The Markdown frontmatter must include `name` and `description`; `version` defaults to `1.0.0` when omitted. Optional `requires.stacks` entries are normalized to canonical `stack:*` package IDs and must resolve to existing v2 stack packages.

Public registry skills must avoid personal, client-specific, machine-specific, or brand-specific defaults. Consumers can edit the installed local copy or layer a private skill on top of the public one.

---

## Platform Keys

### Canonical Format
```
darwin-arm64      macOS Apple Silicon
darwin-x64        macOS Intel
linux-x64         Linux x86_64 (glibc)
linux-arm64       Linux ARM64 (glibc)
win32-x64         Windows x86_64
```

### Fallback Resolution
```
1. darwin-arm64   (exact)
2. darwin         (os only)
3. default        (fallback)
```

### Platform Object
```json
"platforms": {
  "darwin-arm64": {
    "url": "https://...",
    "checksum": { "algo": "sha256", "value": "..." },
    "extract": { "type": "zip", "strip": 0 }
  },
  "linux-x64": { ... },
  "win32-x64": { ... }
}
```

### Platform Override
A platform can override `source` (e.g., system on mac, download on win):

```json
"platforms": {
  "darwin": {
    "source": "system",
    "preinstalled": true
  },
  "win32-x64": {
    "source": "download",
    "url": "https://..."
  }
}
```

---

## Resolution (Precedence Rules)

When resolving a package for installation, the resolver MUST follow these steps:

### 1. Platform Key Resolution
```
1. Try exact match: darwin-arm64
2. Try OS only: darwin
3. Try default: default
4. If no match: error (platform unsupported)
```

### 2. Field Merge Order
```
1. Start with top-level fields: delivery, install.source, install.package
2. Find matching platform object from install.platforms
3. Merge platform fields INTO top-level (platform wins on conflict)
4. Effective config = merged result
```

### 3. Override Rules
- If platform defines `source`, it replaces top-level `install.source`
- If platform defines `delivery`, it replaces top-level `delivery`
- `url`, `checksum`, `extract` come from platform (no top-level equivalent)
- `preinstalled` is platform-only

### 4. Example Resolution

Given this manifest:
```json
{
  "delivery": "system",
  "install": {
    "source": "system",
    "platforms": {
      "darwin": { "preinstalled": true },
      "win32-x64": {
        "source": "download",
        "delivery": "remote",
        "url": "https://...",
        "checksum": {...}
      }
    }
  }
}
```

**On darwin-arm64:** effective = `{ source: "system", delivery: "system", preinstalled: true }`
**On win32-x64:** effective = `{ source: "download", delivery: "remote", url: "...", checksum: {...} }`

---

## Verification

### `checksum` (required for downloads)
```json
"checksum": { "algo": "sha256", "value": "e3b0c44..." }
```

### `detect` (required for system, optional for others)
```json
"detect": {
  "command": "ffmpeg -version",
  "expectExitCode": 0
}
```

### `installHints` (for system sources)
```json
"installHints": {
  "brew": "brew install sqlite",
  "apt": "sudo apt install sqlite3",
  "manual": "Download from https://..."
}
```

---

## Binaries

### `bins` (required for binary/runtime/agent)

**Simple:**
```json
"bins": ["ffmpeg", "ffprobe"]
```

**Mapped (when path differs):**
```json
"bins": {
  "ffmpeg": { "path": "ffmpeg-7.1/bin/ffmpeg" },
  "ffprobe": { "path": "ffmpeg-7.1/bin/ffprobe" }
}
```

---

## Authentication

```json
"auth": {
  "required": true,
  "command": "vercel login",
  "instructions": "Log in with your Vercel account"
}
```

---

## Extraction

```json
"extract": {
  "type": "zip" | "tar.gz" | "tar.xz" | "raw",
  "strip": 0,
  "subdir": "bin"
}
```

---

## Stack-Specific Fields

### `runtime`
```json
"runtime": "node" | "python" | "deno" | "bun"
```

### `requires`
```json
"requires": {
  "binaries": ["ffmpeg"],
  "stacks": ["stack:video-editor"],
  "secrets": [
    {
      "key": "OPENAI_API_KEY",
      "label": "OpenAI API Key",
      "required": true,
      "helpUrl": "https://..."
    }
  ]
}
```

Use `requires.stacks` for skill packages that need one or more stacks to perform their workflow. Stack dependencies are hard requirements; optional workflow recommendations belong under `related.skills`.

### `provides`
```json
"provides": {
  "tools": ["video_trim", "video_speed"]
}
```

### `related`
```json
"related": {
  "skills": ["skill:shortform-your-words-script"]
}
```

Use `related.skills` for companion agent workflows commonly used with a package. A stack does not provide these skills as MCP tools; it advertises them so agents and installers can discover the instruction layer that belongs with the execution layer.

### `mcp`
```json
"mcp": {
  "transport": "stdio",
  "command": "npx",
  "args": ["tsx", "src/index.ts"],
  "env": {},
  "cwd": "."
}
```

---

## Complete Examples

### Runtime (Node.js)

```json
{
  "id": "runtime:node",
  "kind": "runtime",
  "name": "Node.js",
  "version": "20.10.0",

  "delivery": "remote",
  "install": {
    "source": "download",
    "platforms": {
      "darwin-arm64": {
        "url": "https://github.com/learnrudi/registry/releases/.../node-20.10.0-darwin-arm64.tar.gz",
        "checksum": { "algo": "sha256", "value": "..." },
        "extract": { "type": "tar.gz", "strip": 1 }
      },
      "darwin-x64": { "url": "...", "checksum": {...}, "extract": {...} },
      "linux-x64": { "url": "...", "checksum": {...}, "extract": {...} },
      "win32-x64": { "url": "...", "checksum": {...}, "extract": { "type": "zip" } }
    }
  },

  "bins": ["node", "npm", "npx"],
  "detect": { "command": "node --version" }
}
```

### Binary (Download) - FFmpeg

```json
{
  "id": "binary:ffmpeg",
  "kind": "binary",
  "name": "FFmpeg",
  "version": "7.1",

  "delivery": "remote",
  "install": {
    "source": "download",
    "platforms": {
      "darwin-arm64": {
        "url": "https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip",
        "checksum": { "algo": "sha256", "value": "..." },
        "extract": { "type": "zip" }
      },
      "linux-x64": {
        "url": "https://johnvansickle.com/ffmpeg/.../ffmpeg-7.1-amd64-static.tar.xz",
        "checksum": { "algo": "sha256", "value": "..." },
        "extract": { "type": "tar.xz", "strip": 1 }
      },
      "win32-x64": {
        "url": "https://github.com/BtbN/FFmpeg-Builds/.../ffmpeg-win64-gpl.zip",
        "checksum": { "algo": "sha256", "value": "..." },
        "extract": { "type": "zip", "strip": 1 }
      }
    }
  },

  "bins": {
    "ffmpeg": { "path": "ffmpeg" },
    "ffprobe": { "path": "ffprobe" }
  },
  "detect": { "command": "ffmpeg -version" },

  "meta": { "category": "media", "tags": ["video", "audio"] }
}
```

### Binary (npm) - Vercel

```json
{
  "id": "binary:vercel",
  "kind": "binary",
  "name": "Vercel CLI",
  "version": "latest",

  "delivery": "remote",
  "install": {
    "source": "npm",
    "package": "vercel"
  },

  "bins": ["vercel", "vc"],
  "detect": { "command": "vercel --version" },

  "auth": {
    "required": true,
    "command": "vercel login"
  }
}
```

### Binary (pip) - yt-dlp

```json
{
  "id": "binary:yt-dlp",
  "kind": "binary",
  "name": "yt-dlp",
  "version": "latest",

  "delivery": "remote",
  "install": {
    "source": "pip",
    "package": "yt-dlp"
  },

  "bins": ["yt-dlp"],
  "detect": { "command": "yt-dlp --version" }
}
```

### Binary (System with Override) - SQLite

```json
{
  "id": "binary:sqlite",
  "kind": "binary",
  "name": "SQLite",
  "version": "system",

  "delivery": "system",
  "install": {
    "source": "system",
    "platforms": {
      "darwin": {
        "preinstalled": true
      },
      "linux": {
        "preinstalled": false
      },
      "win32-x64": {
        "source": "download",
        "delivery": "remote",
        "url": "https://sqlite.org/2024/sqlite-tools-win-x64-3450000.zip",
        "checksum": { "algo": "sha256", "value": "..." },
        "extract": { "type": "zip" }
      }
    }
  },

  "bins": ["sqlite3"],
  "detect": { "command": "sqlite3 --version" },

  "installHints": {
    "brew": "brew install sqlite",
    "apt": "sudo apt install sqlite3",
    "manual": "Pre-installed on macOS"
  }
}
```

### Agent - Claude

```json
{
  "id": "agent:claude",
  "kind": "agent",
  "name": "Claude Code",
  "version": "latest",

  "delivery": "remote",
  "install": {
    "source": "npm",
    "package": "@anthropic-ai/claude-code"
  },

  "bins": ["claude"],
  "detect": { "command": "claude --version" },

  "auth": {
    "required": true,
    "command": "claude login",
    "instructions": "Authenticate with your Anthropic account"
  }
}
```

### Stack - Video Editor

```json
{
  "id": "stack:video-editor",
  "kind": "stack",
  "name": "Video Editor",
  "version": "1.0.0",

  "delivery": "remote",
  "install": {
    "source": "catalog",
    "path": "catalog/stacks/video-editor"
  },

  "runtime": "node",

  "requires": {
    "binaries": ["ffmpeg"],
    "secrets": []
  },

  "provides": {
    "tools": ["video_trim", "video_speed", "video_compress"]
  },

  "related": {
    "skills": ["skill:shortform-your-words-script"]
  },

  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["tsx", "src/index.ts"]
  },

  "meta": { "category": "media", "icon": "🎬" }
}
```

### Stack - Google AI (with secrets)

```json
{
  "id": "stack:google-ai",
  "kind": "stack",
  "name": "Google AI Suite",
  "version": "1.0.0",

  "delivery": "remote",
  "install": {
    "source": "catalog",
    "path": "catalog/stacks/google-ai"
  },

  "runtime": "node",

  "requires": {
    "binaries": [],
    "secrets": [
      {
        "key": "GOOGLE_AI_API_KEY",
        "label": "Google AI API Key",
        "required": true,
        "helpUrl": "https://makersuite.google.com/app/apikey"
      }
    ]
  },

  "provides": {
    "tools": ["generate_image", "generate_video"]
  },

  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["tsx", "src/index.ts"]
  }
}
```

---

## Migration from v1

| v1 Field | v2 Field |
|----------|----------|
| `installType: "binary"` | `install.source: "download"` |
| `installType: "npm"` | `install.source: "npm"` |
| `installType: "system"` | `install.source: "system"`, `delivery: "system"` |
| `bundled: true` | `delivery: "remote"` |
| `download: {...}` | `install.platforms: {...}` |
| `downloads: {...}` | `install.platforms: {...}` |
| `npmPackage: "..."` | `install.package: "..."` |
| `checkCommand: "..."` | `detect.command: "..."` |
| `binary: "..."` | `bins: [...]` |
| `commands: [...]` | `bins: [...]` |
| (stack implicit) | `delivery: "remote"`, `install.source: "catalog"` |

### Stack Migration

v1 stacks that omit `delivery`/`install` get these defaults:
```json
"delivery": "remote",
"install": {
  "source": "catalog",
  "path": "catalog/stacks/{id}"  // derived from stack id
}
```

---

## Validation Rules

Validation applies to the **effective resolved config** (after platform merge):

### By Effective Source

| Effective Source | Required | Recommended |
|------------------|----------|-------------|
| `download` | `url`, `checksum`, pinned `version` | `extract`, `detect` |
| `npm` | `package` | `version` (warn if "latest") |
| `pip` | `package` | `version` (warn if "latest") |
| `system` | `detect.command` | `installHints`, `preinstalled` |
| `catalog` | (none, path derived from id) | explicit `path` |

### By Kind

| Kind | Required Fields |
|------|-----------------|
| `runtime` | `id`, `kind`, `name`, `version`, `delivery`, `install`, `bins` |
| `binary` | `id`, `kind`, `name`, `version`, `delivery`, `install`, `bins` |
| `agent` | `id`, `kind`, `name`, `version`, `delivery`, `install`, `bins` |
| `stack` | `id`, `kind`, `name`, `version`, `delivery`, `install`, `runtime`, `mcp`, `provides` |
| `skill` | `id`, `kind`, `name`, `version`, `delivery`, `install` |
| `prompt` | `id`, `kind`, `name`, `version`, `delivery`, `install` |

### Conditional Rules

1. **If effective `source == "download"`**: `checksum` required, `version` must be pinned (not "latest")
2. **If effective `source == "system"`**: `detect.command` required
3. **If effective `source in ("npm", "pip")`**: `package` required, warn if `version == "latest"`
4. **If effective `source == "catalog"`**: no checksum required (registry-level integrity)
5. **If `kind == "stack"`**: `runtime` and `mcp` required
6. **All packages**: `name` required (used for display)

---

## Unsupported (v1)

- `linux-*-musl` (Alpine) - document as unsupported
- `delivery: "bundled"` - future enhancement
- Custom registries - use defaults only
- Signature verification - future enhancement
