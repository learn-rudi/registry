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
4. Add a primary operator skill under `catalog/skills/`. Set the manifest's
   `related.operatorSkill`, include it in `related.skills`, and declare the
   stack in the skill's `requires.stacks` frontmatter.
5. Add focused tests for the exposed behavior and the stack-local verification
   entrypoint described below.
6. Run the validation and generation gates below.
7. Test installation with an isolated RUDI home and local registry checkout.

The manifest must identify the package as `stack:{stack-id}`, use
`kind:"stack"`, declare `install.source:"catalog"`, expose real MCP tools, and
list all required binaries and secret names. See [SCHEMA.md](SCHEMA.md) for the
complete shape.

The operator skill is part of the stack contract, not an optional example. It
must tell an agent when to use the stack, use real manifest-declared tools,
validate tool results, obtain confirmation before destructive or externally
visible actions, and define verification and partial-failure behavior. Optional
cross-stack recipes remain companion entries in `related.skills`.

Lifecycle metadata is a public compatibility promise. Omit it when the package
has not been classified. Use `experimental` or `stable` for maturity and
`supported`, `maintenance`, or `unsupported` for support. Deprecation requires
an actionable message and announcement date; replacement IDs must resolve.
Dates communicate policy but never cause automatic wall-clock removal. Retire
a package by deleting its canonical catalog source and regenerating the index.
Never publish a manifest for an implementation that does not exist.

Never hardcode secrets or commit `.env`, credentials, browser profiles, user
state, downloads, rendered outputs, dependency folders, or runtime artifacts.

### Stack verification contract

Every changed official stack must expose one non-interactive, offline
verification entrypoint:

- Node stacks define a non-empty `scripts.verify` in their stack-local
  `package.json` and commit `package-lock.json` whenever dependencies exist.
- Python stacks provide `verify.py`; dependency preparation uses the
  stack-local `requirements.txt` inside a temporary virtual environment.
- Local MCP implementations verify their build/import, focused behavior, and
  manifest-declared tool surface. Hosted MCP bridges verify their pinned local
  adapter contract without contacting the provider.

Verification must not require credentials, paid calls, or live provider
access. The registry runner removes token/provider variables, supplies an
isolated home, disables Python bytecode writes, and invokes commands without a
shell at the runner boundary. Existing oversized stack source modules are also
held to the line counts in `.stack-debt-baseline.json`; they may shrink, but
growth requires decomposition rather than raising the baseline casually. Run a
selected stack or the changed set with:

```bash
npm run stacks:verify -- --stack stack:my-stack --prepare
npm run stacks:verify -- --changed-from origin/main --prepare
```

## Adding a Binary, Runtime, or Agent

Create its only manifest in the matching canonical directory:

- `catalog/binaries/{id}.json`
- `catalog/runtimes/{id}.json`
- `catalog/agents/{id}.json`

Downloaded artifacts require a pinned version, HTTPS URL, supported extraction
type, and SHA-256 checksum for every platform. System packages require
`detect.command`; npm/pip packages require `install.package`.

## Adding a Skill

Use one same-ID folder rooted at
`catalog/skills/{id}/SKILL.md`. Include portable YAML frontmatter with at least
`name` and `description`. Keep personal, client-specific, brand-specific, and
machine-specific workflow state out of public packages.

When the skill is a stack operator, add `requires.stacks` and keep the
relationship reciprocal through the stack's `related.operatorSkill` and
`related.skills` fields.

Unsupported package ideas belong under `docs/proposals/`, not `catalog/`.

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

`indexes:sync` rebuilds the single root `index.json` and generated `dist/`
artifacts. Include generated changes in the same pull request.

`debt:scan` runs the repository's deterministic architecture checks against the
registry kernel. Error findings block CI; warning findings must be fixed when in
scope or documented as accepted debt.

`release:verify` checks that every generated release artifact still matches the
SHA-256 value and source revision context recorded in `dist/release.json`.

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

Skill category, naming, facet and dependency conventions are defined in
[Skill catalog organization](docs/skill-catalog.md).
