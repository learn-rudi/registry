# Neon RUDI Stack

Guarded RUDI MCP stack for Neon platform operations.

This stack manages Neon projects, branches, connection URI retrieval, and MCP config generation. It does not replace the generic PostgreSQL stack. Use `stack:postgres` with `DATABASE_URL` for actual SQL inspection and queries.

## Boundary

- `stack:neon`: Neon platform operations, project discovery, branch creation, redacted connection URI retrieval, MCP config generation
- `stack:postgres`: SQL inspection and query execution through `DATABASE_URL`
- App repo scripts: migrations, seed data, and app-specific database lifecycle

Neon MCP should be treated as a development/testing workflow. Do not connect MCP agents freely to production databases or expose production/PII data through agent tools.

## Tools

- `neon_config_status` - Check whether `NEON_API_KEY` is configured without exposing secret values.
- `neon_list_orgs` - List Neon organizations available to the API key.
- `neon_list_projects` - List Neon projects with optional pagination, search, and org scoping.
- `neon_create_project` - Create a Neon project. Dry-run unless `confirm_create: true`.
- `neon_get_connection_string` - Retrieve a connection URI. Redacted unless `reveal: true` and `confirm_sensitive: true`.
- `neon_create_branch` - Create a Neon branch. Dry-run unless `confirm_create: true`; compute creation is opt-in with `create_compute: true`.
- `neon_list_branches` - List branches for a project.
- `neon_generate_mcp_config` - Generate a Neon managed MCP config with read-only, project-scope, and category-filter options plus a development/testing warning.
- `neon_generate_cli_workflow` - Generate a secret-safe Neon/Vercel/local CLI setup plan.

## Requirements

- Node.js 20+
- RUDI installed and integrated with your agent
- Neon account
- `NEON_API_KEY` stored in RUDI secrets
- Optional `neonctl` binary for Neon CLI workflows

## Secrets

Required:

- `NEON_API_KEY`

Optional:

- `NEON_API_BASE_URL` defaults to `https://console.neon.tech/api/v2`

Do not commit Neon API keys, database connection strings, or generated `.env.local` files.

## Local Setup

From this stack directory:

```bash
npm install
npm test
```

## RUDI Setup

After installing the stack through RUDI:

```bash
rudi secrets set NEON_API_KEY
rudi index stack:neon --json
rudi integrate codex
```

Restart or reload your agent after integration.

## Example Agent Calls

Check configuration:

```json
{
  "name": "stack:neon.neon_config_status",
  "arguments": {}
}
```

Dry-run a project create:

```json
{
  "name": "stack:neon.neon_create_project",
  "arguments": {
    "name": "architect-dev",
    "region_id": "aws-us-east-2",
    "pg_version": 17
  }
}
```

Create a development branch with a compute:

```json
{
  "name": "stack:neon.neon_create_branch",
  "arguments": {
    "project_id": "cool-rain-123456",
    "name": "feature-auth",
    "create_compute": true,
    "confirm_create": true
  }
}
```

Retrieve a redacted connection URI:

```json
{
  "name": "stack:neon.neon_get_connection_string",
  "arguments": {
    "project_id": "cool-rain-123456",
    "database_name": "neondb",
    "role_name": "app"
  }
}
```

Generate the CLI workflow for a project bootstrap:

```json
{
  "name": "stack:neon.neon_generate_cli_workflow",
  "arguments": {
    "org_id": "org-polished-dew-16323624",
    "project_name": "architect-philanthropic-collective",
    "region_id": "aws-us-east-1",
    "database_name": "architect_ops",
    "role_name": "architect_app",
    "vercel_environments": ["production", "preview"]
  }
}
```

Equivalent CLI shape:

```bash
neon orgs list
neon projects create --org-id org-polished-dew-16323624 --name architect-philanthropic-collective --region-id aws-us-east-1 --database architect_ops --role architect_app --set-context --output json
neon connection-string --pooled
vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview
```

Use the pooled connection string directly in Vercel and `.env.local`; do not paste the database password into chat.

Generate a read-only, project-scoped MCP config:

```json
{
  "name": "stack:neon.neon_generate_mcp_config",
  "arguments": {
    "auth_mode": "api_key",
    "readonly": true,
    "project_id": "cool-rain-123456",
    "categories": ["schema", "querying", "docs"]
  }
}
```
