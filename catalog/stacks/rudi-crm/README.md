# RUDI CRM Stack

Controlled MCP interface for RUDI CRM engagement memory.

This stack is the product-facing contract. Source connectors read Gmail,
Calendar, Otter, Drive, Plaid, Slack, and other systems, then pass normalized
payloads into this stack. The stack writes only through the CRM database
functions and reads only through stable CRM views/queries.

## Boundary

- No raw SQL tool.
- No direct table mutation from agents.
- Mutating tools are idempotency-keyed or batch-audited by the database layer.
- Database credentials stay in RUDI secrets as `RUDI_CRM_DATABASE_URL`.

## Setup

This stack is designed to run against the RUDI engagement CRM Postgres project.
Get the Postgres connection string from your database provider or Supabase
dashboard via **Connect**.
For a long-lived local MCP server, prefer the direct connection string when your
network supports it:

```text
postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require
```

If the machine is on an IPv4-only network, use Supabase's Shared Pooler session
mode connection string from the same Connect panel.

Store the value in RUDI secrets, never in source files:

```bash
rudi secrets set RUDI_CRM_DATABASE_URL "<connection-string>"
rudi index --json
rudi integrate codex
```

Restart the agent host after integration so the MCP router reloads the stack.

## Tools

- `rudi_crm_config_status`
- `rudi_crm_setup_status`
- `rudi_crm_record_discovery_observations`
- `rudi_crm_log_ingest_batch`
- `rudi_crm_upsert_interaction`
- `rudi_crm_record_finance_event`
- `rudi_crm_run_validators`
- `rudi_crm_list_people`
- `rudi_crm_list_organizations`
- `rudi_crm_list_engagements`
- `rudi_crm_get_activity_feed`
- `rudi_crm_get_attention_brief`
- `rudi_crm_list_triage_queue`
- `rudi_crm_get_unknown_discovery_domains`
- `rudi_crm_get_engagement_context`
- `rudi_crm_get_latest_correspondence`

## Database Function SQL

The finance write contract is versioned in `sql/record_finance_event.sql`.
Apply it to the CRM Postgres project before exposing
`rudi_crm_record_finance_event`.

## Live Regression Test

The default test suite does not mutate the CRM database. To run the finance
write contract regression against a real database, provide
`RUDI_CRM_DATABASE_URL` and opt in explicitly:

```bash
npm run test:live
```

The live test wraps its probes in a transaction and rolls back before exit.
