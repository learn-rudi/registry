# Site Planner Stack

`stack:site-planner` is a narrow RUDI MCP adapter for the local-first Site
Planner application. It invokes Site Planner's existing versioned JSON CLI
rather than copying planning logic into the stack.

## Boundary

- The Site Planner checkout, Git commit, Node executable, workspace root, and
  artifact root come from owner-only local configuration.
- Tool callers cannot supply paths, executables, or revisions.
- Every operation verifies that the configured checkout is clean and exactly
  matches the configured commit.
- Inspect, generate, optimize, and preview are read-only Site Planner
  operations.
- Fork and apply require a short-lived HMAC authorization bound to the exact
  request plus durable Service Desk Approval Decision and Operation IDs.
- Site Planner produces spatial planning concepts. It does not establish
  zoning, entitlement, parking, finance, or underwriting facts.

## Configuration

Create this owner-only file:

```text
~/.rudi/state/stacks/site-planner/config.json
```

Its versioned shape is:

```json
{
  "schemaVersion": 1,
  "sitePlannerRoot": "<absolute-pinned-site-planner-checkout>",
  "workspaceRoot": "<absolute-private-site-planner-workspace>",
  "artifactRoot": "<absolute-private-adapter-artifact-root>",
  "nodePath": "<absolute-node-22-executable>",
  "gitPath": "/usr/bin/git",
  "expectedCommit": "<40-character-lowercase-git-commit>",
  "commandTimeoutMs": 120000,
  "maxOutputBytes": 50331648
}
```

The checkout, workspace, and artifact roots must already exist, must not be
symbolic links, and must remain separate. The workspace and artifacts must not
be inside the source checkout.

`SITE_PLANNER_STACK_CONFIG` may select a different absolute owner-managed
configuration file for testing. It is runtime configuration, never a tool
argument.

## Write Authorization

Configure RUDI secret `SITE_PLANNER_WRITE_HMAC_V1` as exactly 32 random bytes
encoded in 43 unpadded base64url characters.

Service Desk derives a request-bound authorization only after its durable
approval guard passes. The authorization binds:

- schema and HMAC key version;
- Approval Decision ID;
- approved Service Desk Operation ID;
- canonical expiry;
- SHA-256 digest of the complete Site Planner request; and
- HMAC-SHA-256 signature.

The maximum accepted grant lifetime is one hour. The raw HMAC key is never a
tool argument, artifact field, or log value. Runtime tool permission does not
substitute for this Service Desk authorization.

## Tools

- `site_planner_config_status`
- `site_planner_inspect_concept`
- `site_planner_generate_lot_plan`
- `site_planner_optimize_lot_plan`
- `site_planner_preview_concept_commands`
- `site_planner_fork_concept`
- `site_planner_apply_concept_commands`

Each operation returns the validated Site Planner result plus a private
artifact reference. Artifacts include request/result digests and the verified
Site Planner commit, but never the write signature or HMAC key.

## Verification

```bash
npm ci
npm test
```
