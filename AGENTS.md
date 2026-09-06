# RUDI Registry

Source of truth for stacks, runtimes, binaries, agents, and skills consumed by
the RUDI CLI.

## Canonical Layout

```text
index.json                         # Generated schema-v2 package index
catalog/
├── stacks/{id}/manifest.json      # Stack metadata and secret declarations
├── runtimes/{id}.json             # Runtime definitions
├── binaries/{id}.json             # Binary definitions
├── agents/{id}.json               # Agent definitions
└── skills/{id}/SKILL.md
```

Canonical paths are unversioned. Do not create `index.v2.json`,
`manifest.v2.json`, or catalog `/v2/` directories. Schema evolution is expressed
by each document's `schemaVersion`/shape, not parallel filenames.

## Inventory

Never maintain a hardcoded stack list. Discover the current public inventory:

```bash
node -e "const i=require('./index.json'); console.log(Object.keys(i.packages).join('\\n'))"
npm run validate
```

Public catalog source must remain generic and portable. Personal workflows,
absolute local paths, account state, run artifacts, downloaded media, and
brand-specific defaults belong in local `.rudi` state or private/local skills.

## Adding a Package

1. Add or update the one canonical catalog source.
2. Add focused behavior tests where applicable.
3. Run `npm run indexes:sync`; never hand-edit `index.json`.
4. Run the required verification gates.

For stacks, create `catalog/stacks/{id}/manifest.json` and add the implementation
under the package directory. Use schema-v2 package IDs such as `stack:slack` and
dependency IDs such as `binary:ffmpeg`.

## Required Verification

```bash
npm test
npm run validate
npm run indexes:sync
npm run indexes:check
npm run catalog:clean:check
npm run build
npm pack --dry-run --json
```

The canonical index URL is
`https://raw.githubusercontent.com/learnrudi/registry/main/index.json`.
