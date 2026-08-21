---
name: "RUDI CRM Operator"
description: "Operate RUDI CRM through RUDI's stack tools when a user asks for work supported by stack:rudi-crm. Controlled MCP interface for RUDI CRM engagement memory, discovery, triage, validators, and correspondence context."
version: 1.1.0
category: "business"
tags:
  - rudi
  - operator
  - rudi-crm
requires:
  stacks:
    - stack:rudi-crm
---

# RUDI CRM Operator

Use this skill as the host-native operating layer for `stack:rudi-crm`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Controlled MCP interface for RUDI CRM engagement memory, discovery, triage, validators, and correspondence context.

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Workflow

1. Identify the user's requested outcome, inputs, constraints, and whether the
   action changes external state.
2. Inspect the active MCP tool schema before calling a tool. The runtime schema
   is authoritative for parameter names, required fields, and enums.
3. Start with discovery, inspection, validation, preview, or dry-run tools when
   the stack provides them.
4. Use the fewest tool calls that can complete the request. Reuse returned IDs
   and paths instead of guessing them.
5. Before a destructive, irreversible, public, paid, or externally visible
   action, obtain the user's confirmation unless they already authorized that
   exact action.
6. Validate tool results before using them as inputs to another call. Stop on
   malformed results, explicit errors, missing required data, or partial
   completion that makes the next action unsafe.
7. Verify mutations with a read-back, status, inspection, or artifact check
   when the stack supports one.
8. Report what was attempted, what succeeded, what failed, and any output IDs,
   URLs, or paths the user needs.

## Discovery Capability Boundary

When the active subprocess uses `RUDI_CRM_CAPABILITY_PROFILE=discovery`, its
tool surface must contain only configuration/setup plus
`rudi_crm_record_discovery_page` and `rudi_crm_finalize_discovery_run`. Stop and
report a capability mismatch if candidate listing, classification, promotion,
general heuristic, raw-SQL, or direct-table tools are visible in that profile.

Discovery schema version `1` is closed. Record only exact source/account and
optional calendar scope, lowercase 64-hex run/page keys, page number 1 through
500, cutoff, and zero through 500 observations ordered by
`(observed_at, resource_key, address_role, address)`. Observations may contain
only `resource_key`, `observed_at`, allowlisted `address_role`, normalized
`address`, optional bounded `display_name`, and optional `recurrence_key`.
Never forward provider IDs, BCC, subjects, snippets, bodies, header strings,
event summary/description/location, raw provider objects, responses, URLs, or
credentials.

Treat `expected_records` as the summed observation count, including zero-record
pages; it is not a provider message/event count. Advance the source adapter's
checkpoint only after `{finalized: true}`. Exact retries are safe, but stop on
any scope, page-key, content, expected-count, privacy, structure, or
no-promotion mismatch.

PostgreSQL group-role creation and grants are deployment-gated. The catalog
proposes `rudi_crm_discovery` for exact record/finalize function execution and
`rudi_crm_promotion` for separately approved classification/promotion. Never
create roles or broaden grants while operating this skill unless the user has
explicitly authorized that deployment action.

## Stack Tools

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

`rudi_crm_list_people` returns the primary address in `email` and every stored
address in `emails`, including each address's `work`, `personal`, `alias`,
`former`, or `unknown` label, primary flag, source, and verification timestamp.

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:rudi-crm`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
