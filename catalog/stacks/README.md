# Registry Stacks

Each directory is an MCP capability package rooted at
`catalog/stacks/{stack-id}/` with exactly one canonical `manifest.json`.

```text
{stack-id}/
├── manifest.json       # Schema-v2 package metadata
├── package.json        # Runtime dependencies, when needed
├── src/ or node/src/   # MCP implementation
└── tests/              # Focused behavior tests, when applicable
```

The manifest uses a namespaced package ID such as `stack:slack`, declares its
catalog install path, runtime, MCP command, exposed tools, required binaries,
and secret names. Secret values and runtime state never belong in this tree.

Installed source lives under `~/.rudi/stacks/{stack-id}`. Mutable stack state,
downloads, browser profiles, render output, and run artifacts belong under
`~/.rudi/state/stacks/{stack-id}` or a documented local override.

Do not maintain a stack inventory here; read package IDs from the generated root
`index.json`. See the repository [README](../../README.md),
[contribution guide](../../CONTRIBUTING.md), and [schema](../../SCHEMA.md) for the
current contract and verification commands.
