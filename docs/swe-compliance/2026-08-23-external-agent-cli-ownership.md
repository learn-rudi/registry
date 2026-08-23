# External Agent CLI Ownership Compliance Plan

This registry plan is governed jointly with the CLI plan at
`learnrudi/cli/docs/swe-compliance/2026-08-23-external-agent-cli-ownership.md`.

## Contract

- `runtime:*` packages remain RUDI-managed language runtimes.
- `agent:*` entries are external, vendor-managed prerequisites represented for
  discovery, capability metadata, authentication guidance, and Agent Host
  selection; they are not packages RUDI downloads into its runtimes.
- Every agent uses system delivery, explicit detection, and vendor installation
  guidance. Npm, pip, catalog, download, and bundled agent delivery are invalid.
- The catalog contains only the four implemented native hosts: Antigravity,
  Claude, Codex, and Gemini. The unsupported legacy Copilot record is removed
  as a deliberate breaking inventory correction.
- Generated `index.json` must match the canonical agent catalog.

## Verification

- Add red policy and catalog tests before changing manifests.
- Run `npm test`, `npm run validate`, `npm run indexes:sync`,
  `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and
  `npm pack --dry-run --json`.
- No registry publication, commit, push, or primary-Mac synchronization is
  authorized by this source change.

## Execution Record

- Authorized release versions are Registry `2.0.1` and Agent Hosts stack
  `0.1.2`; the stack patch eliminates same-version drift between the installed
  `0.1.1` and newer source content.

- `npm test`: 250 passed, 0 failed across 28 test files.
- `npm run validate`: 154 catalog packages passed, 0 failed.
- `npm run indexes:check`: current; 154 packages comprising 4 agents, 27
  binaries, 5 runtimes, 69 skills, and 49 stacks.
- `npm run catalog:clean:check`: 0 cleanup targets.
- `stack:agent-hosts` tests: 32 passed, 0 failed. Current source resolves Claude
  and Codex only from provider-owned paths and accepts their guarded current
  versions/capabilities. Agent Host children remove runner-injected RUDI
  runtime paths and relative inherited entries while preserving absolute
  provider and system paths. A package-contract regression also requires the
  MCP server version to match the installable stack version.
- `stack:swe-engineering` changed-file scan: 0 errors, 0 warnings, 0
  informational findings.
- `npm pack --dry-run --json`: passed for `@rudi/registry@2.0.1` with 985
  packaged files.
- Fresh-context review found no unresolved registry blocker after external-path
  validation, version-range guards, generated-index reconciliation, and removal
  of the unsupported Copilot entry.
- Verdict: source-ready for the separately recorded authorized release
  continuation; this source record does not itself assert live promotion.
