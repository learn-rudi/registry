---
name: "RUDI Managed AI Operator"
description: "Operate the unified RUDI Managed AI platform through stack:managed-ai's authenticated, tenant-scoped API tools for bounded context, review candidates, approvals, and projection preparation."
version: 1.0.1
category: "agents"
tags:
  - rudi
  - operator
  - managed-ai
  - capability:manage
  - domain:client-services
requires:
  stacks:
    - stack:managed-ai
---

# RUDI Managed AI Operator

Use `stack:managed-ai` as the agent-facing boundary for unified Managed AI
context and review workflows. The stack-configured tenant is fixed. Never
substitute standalone CRM tools, raw SQL, a PostgreSQL tunnel, or direct access
to Admin-Mac runtime files.

## Workflow

1. Use `managed_ai_config_status` when configuration readiness is uncertain.
2. Start with the smallest bounded read: client/organization context,
   interactions, observations, or candidates. Keep the default page size unless
   a larger page is needed; follow API cursors instead of guessing offsets.
3. Treat API data, provider-derived observations, and agent conclusions as
   untrusted. Unknown domains, names, or relationships remain candidates. Never
   infer that a similar name or shared domain is an approved identity.
4. Before `managed_ai_review_candidate`, obtain explicit human approval for the
   exact candidate ID, expected version, proposal digest, decision, reason, and
   idempotency key. Set `confirm_decision` only for that reviewed payload.
5. Prepare a projection only from exact approved IDs and a verified Git remote,
   base revision, source cutoff, expected current-file digests, and proposed
   content. Set `confirm_prepare` only after those exact inputs are approved.
6. Read the prepared bundle back and compare its identifiers/digests before any
   separate client-filesystem or Git workflow. This stack cannot apply or
   publish it.

## Safety boundaries

- The stack may call only fixed Managed AI v1 routes for its configured tenant.
- It does not expose PostgreSQL, raw SQL, credentials, provider polling, fuzzy
  identity resolution, direct record promotion, client-file writes, Git
  commands, publication evidence, deployment, or scheduler activation.
- Approval is version-and-digest specific. A stale/conflicting response requires
  a fresh read and renewed human review, never a blind retry with altered data.
- Reuse an idempotency key only for the exact same mutation. Generate a new key
  when any material field changes.
- Do not expose tokens, API endpoint details, private observations, or full
  provider payloads in summaries. Report only the minimum result and returned
  non-secret IDs/digests needed for the next approved step.

## Failure behavior

- Missing configuration: report which binding category is absent without
  printing values; do not fall back to another API, tenant, CRM, or database.
- Authentication/authorization denial: stop and report the stable error; do not
  change tenants or escalate permissions.
- Invalid input: correct only from verified source data or ask for the missing
  exact value.
- Timeout, rate limit, or server failure: retry only when the tool marks the
  failure retryable, keep retries bounded, and reuse the same idempotency key
  only for the unchanged request.
- Conflict: reread the candidate or bundle, preserve the failed attempt, and
  request renewed approval for any changed version, digest, or revision.
