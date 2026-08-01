# RUDI Manifest Schema v2 (Platform-Aware)

> **Status: archived and superseded.** The canonical package contract is
> [`SCHEMA.md`](../../SCHEMA.md) and `schemas/package.schema.json`. Do not use the
> migration instructions in this file to create or update catalog metadata.

This document defines the enhanced manifest schema for RUDI binaries, runtimes, agents, and stacks with cross-platform support.

## Core Principle

RUDI should intelligently:
1. Use pre-installed tools when available (macOS, Linux)
2. Bundle tools when necessary (Windows, missing on Linux)
3. Fall back gracefully to system binaries
4. Provide clear agent guidance for installation decisions

## Platform Strategy Types

### 1. `system` - Rely on Pre-installed Tool
- Tool exists on platform by default
- RUDI does not bundle
- Shim falls back to system binary
- Example: `sqlite3` on macOS, `curl` on all platforms
- Agent guidance: "Skip installation, rely on system"

### 2. `bundled` - RUDI Provides Binary
- Tool may or may not be on system
- RUDI bundles for reliability/version control
- Install from GitHub releases
- Example: `ffmpeg`, `Node.js`, `Python`
- Agent guidance: "Install from RUDI release"

### 3. `package-manager` - Use System Package Manager
- Tool available via `apt`/`brew`/`choco`
- Preferred over bundling on some platforms
- Requires user action or platform package manager
- Example: `git` (could use `brew` on macOS, `apt` on Ubuntu)
- Agent guidance: "User should install via package manager"

### 4. `optional-bundled` - Use System First, Fall Back to RUDI
- Prefer system version, but bundle as fallback
- Example: `git` (system preferred, RUDI bundled if needed)
- Agent guidance: "Check for system first, install RUDI version if needed"

### 5. `external-download` - Direct External URL
- Download from external CDN/provider
- Not in RUDI releases
- Example: `ffmpeg` from evermeet.cx
- Agent guidance: "Download from official source"

## Schema Format

### Binary Manifest

```json
{
  "id": "binary:ffmpeg",
  "name": "FFmpeg",
  "version": "7.1",
  "description": "Audio/video processing toolkit",
  "category": "media",

  "platforms": {
    "darwin": {
      "strategy": "external-download",
      "preinstalled": false,
      "bins": ["ffmpeg", "ffprobe"],
      "agentGuidance": "FFmpeg is not pre-installed on macOS. Download from external CDN (evermeet.cx) for best binary support."
    },
    "linux": {
      "strategy": "bundled",
      "preinstalled": false,
      "bins": ["ffmpeg", "ffprobe"],
      "agentGuidance": "FFmpeg is not pre-installed. Install from RUDI releases for consistency."
    },
    "win32": {
      "strategy": "bundled",
      "preinstalled": false,
      "bins": ["ffmpeg.exe", "ffprobe.exe"],
      "agentGuidance": "FFmpeg is not pre-installed. Install from RUDI releases."
    }
  },

  "fallback": {
    "enabled": true,
    "platforms": ["darwin", "linux"],
    "priority": ["bundled", "system"]
  },

  "downloads": {
    "darwin-arm64": [
      {
        "url": "https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip",
        "type": "zip",
        "binary": "ffmpeg"
      }
    ]
  }
}
```

### Runtime Manifest

```json
{
  "id": "runtime:node",
  "name": "Node.js",
  "version": "20.10.0",
  "description": "JavaScript runtime for agents and stacks",

  "platforms": {
    "darwin": {
      "strategy": "bundled",
      "preinstalled": false,
      "binaries": ["node", "npm", "npx"],
      "agentGuidance": "Node.js is not pre-installed on macOS. Use RUDI's bundled version for consistency."
    },
    "linux": {
      "strategy": "bundled",
      "preinstalled": false,
      "binaries": ["node", "npm", "npx"],
      "agentGuidance": "Node.js is not pre-installed. Use RUDI's bundled version for consistency."
    },
    "win32": {
      "strategy": "bundled",
      "preinstalled": false,
      "binaries": ["node.exe", "npm.cmd", "npx.cmd"],
      "agentGuidance": "Node.js is not pre-installed on Windows. Install from RUDI releases."
    }
  },

  "download": {
    "darwin-arm64": "https://github.com/learnrudi/registry/releases/download/v1.0.0/node-20.10.0-darwin-arm64.tar.gz",
    "darwin-x64": "https://github.com/learnrudi/registry/releases/download/v1.0.0/node-20.10.0-darwin-x64.tar.gz",
    "linux-x64": "https://github.com/learnrudi/registry/releases/download/v1.0.0/node-20.10.0-linux-x64.tar.gz",
    "win32-x64": "https://github.com/learnrudi/registry/releases/download/v1.0.0/node-20.10.0-win32-x64.zip"
  }
}
```

### System Binary (Pre-installed)

```json
{
  "id": "binary:sqlite",
  "name": "SQLite",
  "version": "system",
  "description": "Embedded SQL database engine",
  "category": "database",

  "platforms": {
    "darwin": {
      "strategy": "system",
      "preinstalled": true,
      "bins": ["sqlite3"],
      "agentGuidance": "SQLite is pre-installed on macOS. No installation needed."
    },
    "linux": {
      "strategy": "package-manager",
      "preinstalled": false,
      "bins": ["sqlite3"],
      "packageManager": "apt",
      "package": "sqlite3",
      "agentGuidance": "SQLite is not pre-installed on most Linux. User should run: sudo apt install sqlite3"
    },
    "win32": {
      "strategy": "external-download",
      "preinstalled": false,
      "bins": ["sqlite3.exe"],
      "agentGuidance": "SQLite is not pre-installed on Windows. Download from official source."
    }
  }
}
```

### Agent Manifest

```json
{
  "id": "agent:claude",
  "name": "Claude Code",
  "version": "latest",
  "description": "Anthropic Claude Code CLI",

  "platforms": {
    "darwin": {
      "strategy": "npm-package",
      "preinstalled": false,
      "agentGuidance": "Install via npm on macOS using RUDI's bundled Node.js"
    },
    "linux": {
      "strategy": "npm-package",
      "preinstalled": false,
      "agentGuidance": "Install via npm on Linux using RUDI's bundled Node.js"
    },
    "win32": {
      "strategy": "npm-package",
      "preinstalled": false,
      "agentGuidance": "Install via npm on Windows using RUDI's bundled Node.js"
    }
  },

  "npmPackage": "@anthropic-ai/claude-code",
  "binary": "node_modules/.bin/claude",
  "commands": [
    { "name": "claude", "bin": "node_modules/.bin/claude" }
  ],
  "requiresAuth": true,
  "authInstructions": "Run 'claude login' to authenticate with your Anthropic account"
}
```

## Schema Fields Reference

### Top-Level Fields
- `id` (string): Package identifier (e.g., "binary:ffmpeg")
- `name` (string): Display name
- `version` (string): Version or "system"
- `description` (string): Human-readable description
- `category` (string): Category (media, database, development, etc.)

### `platforms` Object
Per-platform configuration. Keys: `darwin`, `linux`, `win32`

#### Platform-Level Fields
- `strategy` (string): One of: `system`, `bundled`, `package-manager`, `optional-bundled`, `external-download`, `npm-package`
- `preinstalled` (boolean): Whether tool comes pre-installed on platform
- `bins` (array): List of binary names on this platform
- `agentGuidance` (string): Clear instruction for AI agents on how to handle this tool
- `packageManager` (string, optional): Package manager name (apt, brew, choco)
- `package` (string, optional): Package name in package manager

### `fallback` Object (Optional)
- `enabled` (boolean): Enable fallback chain
- `platforms` (array): Which platforms support fallback
- `priority` (array): Order of strategies to try: ["bundled", "system"]

### Legacy Fields (Backwards Compatible)
- `download` (object): Platform → URL mapping (for runtimes)
- `downloads` (object): Platform → array of downloads (for binaries)
- `bundled` (boolean): Will be derived from strategy
- `installType` (string): Will be derived from strategy

## Platform Details

### macOS (darwin)
- Pre-installed: git, curl, sqlite3, python3, node (varies by version)
- Homebrew: Most development tools available
- Strategy: Prefer system/package-manager when available
- Shim fallback: System PATH search includes `/opt/homebrew/bin`

### Linux
- Pre-installed: Minimal (curl, git on most distros)
- Package managers: apt (Ubuntu/Debian), dnf (Fedora), pacman (Arch)
- Strategy: Bundle for consistency, or document package manager installation
- Shim fallback: System PATH search includes standard locations

### Windows
- Pre-installed: Almost nothing relevant
- Package managers: Chocolatey (limited), Windows Package Manager (limited)
- Strategy: Bundled for most development tools
- Special considerations: `.exe` and `.cmd` extensions, PATH handling

## Agent Decision Tree

When an AI agent encounters a manifest, it should:

1. Read `platforms[current_platform].agentGuidance`
2. Check `preinstalled` flag
3. Based on `strategy`:
   - **system**: Skip installation, verify tool exists in PATH
   - **bundled**: Install from RUDI release
   - **package-manager**: Provide installation command to user
   - **optional-bundled**: Try system first, install RUDI if not found
   - **external-download**: Download from specified URL
   - **npm-package**: Install via npm (RUDI's Node.js)

## Migration Guide

Existing manifests will continue to work. To migrate to v2:

1. Add `platforms` object with entries for darwin/linux/win32
2. Set `strategy` based on current installation method
3. Set `preinstalled` flag
4. Add `agentGuidance` strings
5. Keep legacy fields for backwards compatibility

Example migration:

```json
// Before
{
  "id": "binary:git",
  "name": "Git",
  "version": "2.40.0",
  "bundled": true,
  "download": { "darwin-arm64": "..." }
}

// After
{
  "id": "binary:git",
  "name": "Git",
  "version": "2.40.0",
  "bundled": true,
  "download": { "darwin-arm64": "..." },
  "platforms": {
    "darwin": {
      "strategy": "optional-bundled",
      "preinstalled": true,
      "bins": ["git"],
      "agentGuidance": "Git is pre-installed on macOS. RUDI can install version 2.40.0 if desired."
    },
    "linux": {
      "strategy": "package-manager",
      "preinstalled": false,
      "bins": ["git"],
      "agentGuidance": "Git is not pre-installed. Install with: sudo apt install git"
    },
    "win32": {
      "strategy": "bundled",
      "preinstalled": false,
      "bins": ["git.exe"],
      "agentGuidance": "Git is not pre-installed on Windows. Install from RUDI releases."
    }
  }
}
```

## Examples by Tool Type

### Pre-installed on macOS (No Bundling Needed)
- curl, git (usually), sqlite3, python3, node (some versions), bash, grep, sed

### Pre-installed on Linux Varies
- curl (usually), git (usually), python3 (usually)
- Varies: sqlite3, node, npm, development headers

### Never Pre-installed (Must Bundle or Download)
- ffmpeg, imagemagick, tesseract, pandoc, ffprobe, wrangler

### RUDI Always Bundles (For Consistency)
- Node.js, Python (multiple versions), Deno, Bun

### External Download (Third-party CDNs)
- ffmpeg (evermeet.cx, johnvansickle.com)

## Testing Checklist

For each manifest migration:
- [ ] macOS: Tool works with shim fallback
- [ ] Linux: Tool works with shim fallback or package manager guidance
- [ ] Windows: Tool works from RUDI release
- [ ] agentGuidance is clear and actionable
- [ ] Backwards compatible with old manifest format
