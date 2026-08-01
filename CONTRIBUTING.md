# Contributing to RUDI Registry

Catalog manifests and skill sources are the hand-maintained source of truth.
`index.json` is generated from them; never edit it directly. Canonical paths are
unversioned even though the documents use schema version 2.

## Setup

Prerequisites: Node.js 20 or later and the RUDI CLI.

```bash
git clone https://github.com/learnrudi/registry.git
cd registry
npm install
```

## Adding a Stack

1. Create `catalog/stacks/{stack-id}/`.
2. Add the canonical `manifest.json`.
3. Add MCP source under `src/`, `node/`, or `python/`, following nearby package
   conventions.
4. Add focused tests for the exposed behavior.
5. Run the validation and generation gates below.
6. Test installation with an isolated RUDI home and local registry checkout.

The manifest must identify the package as `stack:{stack-id}`, use
`kind:"stack"`, declare `install.source:"catalog"`, expose real MCP tools, and
list all required binaries and secret names. See [SCHEMA.md](SCHEMA.md) for the
complete shape.

Never hardcode secrets or commit `.env`, credentials, browser profiles, user
state, downloads, rendered outputs, dependency folders, or runtime artifacts.

## Adding a Binary, Runtime, or Agent

Create its only manifest in the matching canonical directory:

- `catalog/binaries/{id}.json`
- `catalog/runtimes/{id}.json`
- `catalog/agents/{id}.json`

Downloaded artifacts require a pinned version, HTTPS URL, supported extraction
type, and SHA-256 checksum for every platform. System packages require
`detect.command`; npm/pip packages require `install.package`.

## Adding a Skill

Use either `catalog/skills/{id}.md` or a bundle rooted at
`catalog/skills/{id}/SKILL.md`. Include portable YAML frontmatter with at least
`name` and `description`. Keep personal, client-specific, brand-specific, and
machine-specific workflow state out of public packages.

Unsupported package ideas belong under `docs/proposals/`, not `catalog/`.

## Required Checks

```bash
npm test
npm run validate
npm run indexes:sync
npm run indexes:check
npm run catalog:clean:check
npm run build
npm pack --dry-run --json
```

`indexes:sync` rebuilds the single root `index.json` and generated `dist/`
artifacts. Include generated changes in the same pull request.

For local CLI smoke tests, isolate all installed state:

```bash
RUDI_HOME="$(mktemp -d)" \
USE_LOCAL_REGISTRY=true \
RUDI_REGISTRY_ROOT="$PWD" \
rudi search my-stack
```

## Pull Requests

- Keep one concern per change.
- Describe user-visible behavior, validation performed, and known gaps.
- Add or update tests for install, resolution, and failure behavior.
- Never mix catalog source with local generated/runtime state.
- Do not add packages to `index.json` manually.

By contributing, you agree that your contribution is licensed under the MIT
License.
