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
- Discovery and candidate preview never create CRM people. Contact promotion is
  a separate operation that requires explicit human approval.
- Exact normalized email is the automatic deduplication key. Name or
  organization similarities are review signals only and never trigger a merge.
- Database credentials stay in RUDI secrets as `RUDI_CRM_DATABASE_URL`.

## Local PostgreSQL (recommended)

The CRM requires PostgreSQL 17 or newer, but it does not require Supabase. For a
local-first RUDI installation, run PostgreSQL as a separate durable service and
keep the RUDI daemon focused on tool routing.

Create an empty database, apply the ordered schema migrations, and store the
same URL in RUDI secrets:

```bash
createdb rudi_crm
export RUDI_CRM_DATABASE_URL="postgresql://localhost:5432/rudi_crm"
npm run db:migrate
rudi secrets set RUDI_CRM_DATABASE_URL "$RUDI_CRM_DATABASE_URL"
rudi index --json
rudi integrate codex
```

The target database must already exist. `db:migrate` validates the URL, takes a
PostgreSQL advisory lock, applies each migration transactionally, and records
its SHA-256 checksum in `public.rudi_crm_schema_migrations`. Re-running it skips
unchanged migrations and fails closed if an applied migration was edited.

Restart the agent host after integration so the MCP router reloads the stack.
Run `rudi_crm_setup_status` before using the CRM; every required table,
function, view, and validator must be healthy.

The migrations contain schema only. CRM records and credentials are never
shipped in the registry package.

## Optional: hosted PostgreSQL/Supabase

Any PostgreSQL 17 provider can be used by changing `RUDI_CRM_DATABASE_URL`.
Transport security is controlled by the URL, not inferred from the provider
hostname. Hosted connections should explicitly include the provider's required
TLS mode, for example `sslmode=require`.

For Supabase, use the direct or Shared Pooler session-mode PostgreSQL URL from
the dashboard's **Connect** panel. After the provider-neutral migrations, apply
`sql/providers/supabase/0001_harden_data_api.sql` if the CRM will remain
service-connection-only. That optional provider policy revokes Data API access
from `anon` and `authenticated`; the core schema stays provider-neutral.

Do not expose a server-side database URL in browser code or commit it to source.

## Schema and backups

`sql/migrations/0001_engagement_crm.sql` is the canonical baseline for all 19
CRM tables, controlled write functions, read/validation views, constraints,
indexes, triggers, auditing, and row-level-security posture.
`sql/migrations/0002_contact_discovery_promotion.sql` adds header-level contact
evidence, deduplicated candidate preview, and atomic approval-gated promotion.
`sql/migrations/0003_contact_candidate_noise.sql` filters automated addresses at
the candidate level and prevents one no-reply sender from hiding human contacts
at the same domain.
Add future changes as new ordered migration files; never rewrite an applied
migration.

## Approval-gated contact discovery

The generic source workflow is:

1. Search a bounded mailbox/date window and extract only required header
   metadata: stable message/thread IDs, timestamp, address role, normalized
   address, and display name. Do not ingest message bodies for contact discovery.
2. Record observations in batches of at most 500 with
   `rudi_crm_record_discovery_observations`. Replays enrich missing metadata but
   cannot duplicate the same source/message/role/address tuple.
3. Run `rudi_crm_apply_discovery_heuristics` to classify deterministic noise and
   refresh domain signals.
4. Review `rudi_crm_list_contact_candidates`. Exact existing-email matches can
   be included for verification; same-name results are review signals only.
5. Stop for human approval. Only then call `rudi_crm_promote_contact` for one
   candidate. Omit `existing_person_id` to create a new person, or provide the
   reviewed person ID to attach the address as an alias. Email collisions never
   reassign an address between people.
6. Log the bounded sweep with `rudi_crm_log_ingest_batch` and run validators.

Promotion is atomic: a new person and primary email either both commit or both
roll back. Exact-email retries return the existing person instead of creating a
duplicate.

Before a provider move, create a private `pg_dump` backup and reconcile table
counts before and after restore. Backups and CRM row data belong in private
RUDI state, not this public catalog.

## Tools

- `rudi_crm_config_status`
- `rudi_crm_setup_status`
- `rudi_crm_record_discovery_observations`
- `rudi_crm_apply_discovery_heuristics`
- `rudi_crm_list_contact_candidates`
- `rudi_crm_promote_contact`
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

## Live Regression Test

The default test suite does not mutate the CRM database. To run the finance and
contact-promotion write-contract regressions against a real database, provide
`RUDI_CRM_DATABASE_URL` and opt in explicitly:

```bash
npm run test:live
```

The live test wraps its probes in a transaction and rolls back before exit.
