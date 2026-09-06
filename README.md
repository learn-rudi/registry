# RUDI Registry

Official registry of MCP stacks, binaries, agents, runtimes, and skills for the
RUDI CLI. The catalog uses schema version 2 with unversioned canonical paths.

## Package Types

| Type | Description | Canonical source |
|------|-------------|------------------|
| Stack | MCP servers with tools | `catalog/stacks/{id}/manifest.json` |
| Binary | Standalone binaries and CLIs | `catalog/binaries/{id}.json` |
| Agent | AI coding assistants | `catalog/agents/{id}.json` |
| Runtime | Language interpreters | `catalog/runtimes/{id}.json` |
| Skill | Reusable agent workflows | `catalog/skills/{id}/SKILL.md` |

`index.json` is the single generated package index. Do not add parallel
version-suffixed files or directories; the schema version belongs inside the
document, not in its path.

## Usage

```bash
rudi search whisper
rudi install whisper
rudi install ffmpeg
rudi list
```

## Repository Structure

```text
index.json                    # Generated schema-v2 package index
catalog/
├── stacks/{id}/
│   ├── manifest.json         # Canonical stack metadata
│   └── src/, node/, python/  # Stack implementation
├── skills/                   # Same-ID skill folders
├── binaries/{id}.json        # Canonical binary metadata
├── agents/{id}.json          # Canonical agent metadata
└── runtimes/{id}.json        # Canonical runtime metadata
dist/                         # Generated indexes, hashes, and release metadata
```

Edit catalog manifests and skill sources by hand, then regenerate the index:

```bash
npm run indexes:sync
npm run indexes:check
```

## Creating a Stack

1. Create `catalog/stacks/{stack-id}/`.
2. Add `catalog/stacks/{stack-id}/manifest.json`.
3. Add the MCP implementation and focused tests.
4. Run the required checks below.

Minimal manifest:

```json
{
  "id": "stack:my-stack",
  "kind": "stack",
  "name": "My Stack",
  "version": "1.0.0",
  "lifecycle": {
    "maturity": "experimental",
    "support": "supported"
  },
  "delivery": "remote",
  "install": {
    "source": "catalog",
    "path": "catalog/stacks/my-stack"
  },
  "runtime": "node",
  "surface": "local-only",
  "requires": {
    "binaries": [],
    "secrets": [
      { "key": "MY_API_KEY", "label": "API key", "required": true }
    ]
  },
  "provides": { "tools": ["my_tool"] },
  "related": {
    "operatorSkill": "skill:my-stack",
    "skills": ["skill:my-stack"]
  },
  "mcp": {
    "transport": "stdio",
    "command": "node",
    "args": ["src/index.js"]
  },
  "meta": {
    "description": "What the stack does",
    "author": "Your Name",
    "license": "MIT",
    "category": "data",
    "tags": ["example", "capability:query"]
  }
}
```

Every stack must have one primary operator skill. Add its standalone catalog
skill, declare the stack in that skill's `requires.stacks`, set
`related.operatorSkill`, and include the same ID in `related.skills`. Additional
`related.skills` entries are optional companion workflows. `provides.tools` is
only for MCP tools exposed by the stack.

Stacks share the seven primitive categories and capability/domain/provider tags
with their primary operators. See [Stack catalog organization](docs/stack-catalog.md)
for naming, discovery, verification and reproducible index checks.

`surface` classifies hosted eligibility as `local-only`, `cloud-hosted`, or
`both`; omission fails closed to `local-only`. A `both` stack uses exact
`toolSurfaces` overrides to opt individual tools into hosted execution. See
[SCHEMA.md](SCHEMA.md#surface-and-toolsurfaces) for the no-elevation and
allowlist rules.

`lifecycle` is optional and omission means unclassified. Do not claim
`stable` or `supported` without evidence. Deprecated packages carry an
announcement date and migration message; retired packages are removed from the
canonical catalog rather than left as installable placeholders. See
[SCHEMA.md](SCHEMA.md#package-lifecycle).

## Creating a Skill

Author each skill in `catalog/skills/{skill-id}/SKILL.md`. Legacy flat files
remain readable for compatibility. Bundles may include `scripts/`,
`references/`, and `assets/`. Catalog packages must be portable: personal paths,
client state, account data, and brand-specific defaults belong in local/private
skills or `~/.rudi` state.

An operator skill translates user intent into actual stack tool calls. It must
name its required stack in frontmatter, use the live MCP tool schema as the
parameter authority, define mutation confirmation and failure behavior, and
verify externally visible changes when the stack supports a read-back.

## Adding a Binary, Runtime, or Agent

Create one JSON manifest in the matching unversioned directory. Downloaded
artifacts require a pinned version, HTTPS URL, supported extraction type, and a
SHA-256 checksum for every platform. See [SCHEMA.md](SCHEMA.md) for the complete
contract.

## Discovering Inventory

Do not maintain a hardcoded package list in documentation. Generate the current
inventory from the canonical index:

```bash
node -e "const i=require('./index.json'); console.log(Object.keys(i.packages).join('\\n'))"
```

## Required Checks

```bash
npm test
npm run validate
npm run indexes:sync
npm run indexes:check
npm run catalog:clean:check
npm run stacks:verify -- --changed-from origin/main --prepare
npm run debt:scan
npm run build
npm run release:verify
npm pack --dry-run --json
```

## URLs

- Index: `https://raw.githubusercontent.com/learnrudi/registry/main/index.json`
- Catalog stacks: `https://raw.githubusercontent.com/learnrudi/registry/main/catalog/stacks/{id}/`
- Binary releases: `https://github.com/learnrudi/registry/releases/download/{tag}/{name}`

## Security

Never commit API keys, credentials, tokens, account state, downloaded media, or
runtime output. Stacks declare secret names in `manifest.json`; secret values are
stored locally through RUDI and are never part of the registry.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution and isolated-install
guidance.

## License

MIT

Skill category, naming, facet and dependency conventions are defined in
[Skill catalog organization](docs/skill-catalog.md).
