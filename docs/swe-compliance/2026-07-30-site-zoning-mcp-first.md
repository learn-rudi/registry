# Site Zoning Envelope Review MCP-First Update

Status: **Implemented and verified**

## Scope

- Add an explicit MCP-first execution branch for hosts without a local Pre Dev
  Intel checkout.
- Preserve the existing repo-native CLI workflow as a separate fallback.
- Fix the MCP stop boundary at zoning/envelope unless the user expands scope.
- Preserve tool provenance and avoid claiming that MCP results created local
  repo artifacts.

## Files

- `catalog/skills/site-zoning-envelope-review.md`
- `index.json`
- this compliance record

## Boundaries

- Use only the existing allowlisted `stack:dwellow-mcp` tool names.
- Pass one confirmed address or parcel key consistently.
- Treat ambiguity, unconfirmed frontage, stale evidence, and provider warnings
  as explicit stop/provisional conditions.
- `refresh_site_conditions` is conditional, idempotency-keyed producer work.
- Site Planner, building fit, site-plan generation, community fit, and finance
  remain outside the default skill boundary.

## Verification

- `npm run validate:v2` — 87 catalog packages passed.
- `npm run build` — validation and compilation passed.
- `npm test` — 109 tests passed across 12 files.
- `git diff --check` — passed.

The first clean-worktree test invocation ran concurrently with the build and
therefore raced on generated `dist/` files; the nested
`catalog/stacks/social-media-publisher` dependencies were also absent. After
installing that package's locked dependencies, the sequential full test run
passed without product-code changes.

## Exit Criteria

- Catalog metadata and skill frontmatter both report version `1.1.0`.
- Registry validation, tests, and build pass.
- The installed Codex and Claude skill copies on the always-on Mac are
  identical to the reviewed MCP-first procedure.
