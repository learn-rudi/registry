# RUDI CRM Stack

Controlled MCP interface for RUDI CRM engagement memory.

This stack is the product-facing contract. Source connectors read Gmail,
Calendar, Otter, Drive, Plaid, Slack, and other systems, then pass normalized
payloads into this stack. The stack writes only through the CRM database
functions and reads only through stable CRM views/queries.

## Boundary

- No raw SQL tool.
- No direct table mutation from agents.
- `RUDI_CRM_CAPABILITY_PROFILE=discovery` exposes only configuration/setup plus
  idempotent discovery page recording and finalization. It cannot list
  candidates, classify addresses, run general heuristics, or promote people.
- Mutating tools are idempotency-keyed or batch-audited by the database layer.
- Discovery and candidate preview never create CRM people. Contact promotion is
  a separate operation that requires explicit human approval.
- Exact normalized email is the automatic deduplication key. Name or
  organization similarities are review signals only and never trigger a merge.
- Organization/domain identity and mailbox category are separate: a named
  person and `info@` address may share a domain without sharing a category.
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
unchanged migrations and fails closed if an applied migration was edited. Two
repository-evidenced, pre-trim checksum variants of migrations `0001` and
`0002` are accepted without rewriting their ledger rows; every other unknown
path or checksum fails closed.

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
`sql/migrations/0004_contact_address_classification.sql` adds durable,
address-level classification, conservative local-part suggestions, audited
manual overrides, and category-filtered candidate review.
`sql/migrations/0005_discovery_security_boundary.sql` revokes PUBLIC schema,
table, sequence, and function access; enables RLS on additive discovery tables;
hardens classification/promotion function execution; and adds the closed,
account-scoped page/finalize discovery contract.
Add future changes as new ordered migration files; never rewrite an applied
migration.

## Least-privilege discovery profile

Launch the CRM subprocess with `RUDI_CRM_CAPABILITY_PROFILE=discovery` when a
source adapter is only allowed to record pages and finalize a run. The MCP
surface is then exactly:

- `rudi_crm_config_status`
- `rudi_crm_setup_status`
- `rudi_crm_record_discovery_page`
- `rudi_crm_finalize_discovery_run`

`rudi_crm_record_discovery_page` accepts schema version `1`, exact source and
account/calendar scope, lowercase SHA-256 run/page keys, a page number from 1
through 500, an explicit cutoff, and zero through 500 deterministically ordered
observations. Each observation contains only a scoped SHA-256 `resource_key`,
`observed_at`, an allowlisted role, normalized address, optional bounded display
name, and optional Calendar recurrence key. Subjects, bodies, snippets, BCC,
event content, raw provider objects, provider IDs, URLs, responses, and
credentials are rejected by the closed schema.

`rudi_crm_finalize_discovery_run` treats `expected_records` as the total closed
observation-row count, not a provider message/event count. It verifies every
page from 1 through `expected_pages`, checks both page counts and physical row
counts, validates privacy/structure/scope, applies only the built-in
deterministic no-reply local-part test, and compares SHA-256 snapshots plus row
counts for `people` and `person_emails`. Audit rows contain counts and
session/application attribution only. Exact page/finalize retries remain safe,
including a page retry after finalization; mismatched retries fail. Provider
checkpoint advancement stays in the source adapter and occurs only after a
successful finalize response.

The migration deliberately creates no PostgreSQL roles and grants no
capability. `rudi_crm_discovery` and `rudi_crm_promotion` are proposed stable
group-role names. Provisioning remains a deployment-gated human choice. If
approved, grant `rudi_crm_discovery` only `USAGE` on schema `public` and exact
`EXECUTE` on `record_discovery_page(...)` and `finalize_discovery_run(...)`;
grant classification/promotion separately to `rudi_crm_promotion`. Never grant
either role table DML, candidate views, raw SQL, or membership in the other
role.

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
4. Review `rudi_crm_list_contact_candidates`. Each row reports a suggested and
   effective address category. Deterministic suggestions use only the mailbox,
   not the whole domain; exact existing-email matches can be included for
   verification, and same-name results are review signals only.
5. When a reviewer confirms the mailbox type, call
   `rudi_crm_classify_contact_address` with `person`, `shared_inbox`,
   `marketing`, `notification`, `automated`, or `unknown`. Replays are
   idempotent, corrections are audited, and classification never creates or
   merges a person. Candidate lists may be filtered by `address_category`.
6. Stop for human approval. Only then call `rudi_crm_promote_contact` for one
   candidate. Omit `existing_person_id` to create a new person, or provide the
   reviewed person ID to attach the address as an alias. Email collisions never
   reassign an address between people.
7. Log the bounded sweep with `rudi_crm_log_ingest_batch` and run validators.

Promotion is atomic: a new person and primary email either both commit or both
roll back. Exact-email retries return the existing person instead of creating a
duplicate.

Before a provider move, create a private `pg_dump` backup and reconcile table
counts before and after restore. Backups and CRM row data belong in private
RUDI state, not this public catalog.

## Tools

- `rudi_crm_config_status`
- `rudi_crm_setup_status`
- `rudi_crm_record_discovery_page`
- `rudi_crm_finalize_discovery_run`
- `rudi_crm_record_discovery_observations`
- `rudi_crm_apply_discovery_heuristics`
- `rudi_crm_list_contact_candidates`
- `rudi_crm_classify_contact_address`
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

`rudi_crm_list_people` preserves the top-level primary `email` field and also
returns every `person_emails` row in an `emails` array. Each entry includes its
normalized address, `work` / `personal` / `alias` / `former` / `unknown` label,
primary flag, source, and verification timestamp.

## Live Regression Test

The default test suite does not mutate the CRM database. To run the finance and
contact-promotion write-contract regressions against a real database, provide
`RUDI_CRM_DATABASE_URL` and opt in explicitly:

```bash
npm run test:live
```

The live tests wrap classification, promotion, and finance probes in
transactions and roll back before exit.

The isolated bootstrap and least-privilege discovery tests create and remove
throwaway databases/roles on a separately supplied PostgreSQL 17 admin URL:

```bash
RUDI_CRM_BOOTSTRAP_TESTS=1 \
RUDI_CRM_DISCOVERY_SECURITY_TESTS=1 \
RUDI_CRM_TEST_ADMIN_URL=postgresql://127.0.0.1:55437/postgres \
npm test
```
