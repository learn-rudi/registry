# ADR 0001: Public Registry Artifact Boundary

## Status

Accepted

## Context

Registry catalog packages are the source that users download or sync into `~/.rudi/stacks/{stack-id}`. Installed stacks also create local state: run folders, downloaded media, browser profiles, temporary files, generated renders, QA frames, and package dependencies. Those files can be large, machine-specific, account-specific, or private.

Before this decision, generated stack state could sit under `catalog/stacks/{stack-id}` or `~/.rudi/stacks/{stack-id}` and then be picked up by catalog hash generation, npm package allowlists, or release tarballs.

## Decision

The public registry payload is source plus portable docs/config only. Generated runtime state is not part of a catalog package.

- Stack runtime state belongs under `~/.rudi/state/stacks/{stack-id}` by default.
- `RUDI_HOME` and stack-specific environment variables may relocate state, but source lookup must not silently fall back to catalog-local run folders.
- Catalog hash generation, public-readiness validation, npm package allowlists, and release tarballs must all exclude generated stack artifacts.
- Forbidden public artifact paths include stack-local `node_modules`, `runs`, `downloads`, `tmp`, `.chrome-profiles`, `.test-rudi`, `clips`, `output`, `outputs`, and `composer/public/media`.
- Immutable stack tarballs under `dist/stacks/*.tar.gz` are not published unless a build step regenerates them deterministically.

## Consequences

Users can install a smaller, reproducible stack package. Local editing runs and media remain available through state roots without becoming release payload. Future stack features that need examples or fixtures must use small, explicit fixtures rather than run outputs or account-local state.

Registry checks now fail if forbidden generated artifacts are tracked under `catalog/`, if the catalog hash includes runtime paths, or if npm packaging can include generated stack artifacts.
