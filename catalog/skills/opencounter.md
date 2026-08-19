---
name: "OpenCounter Cincinnati Guidance Operator"
description: "Assess Cincinnati project ideas from authoritative site evidence and an observed OpenCounter questionnaire, then use guarded live OpenCounter guidance only for explicitly authorized confirmation or recovery."
version: 1.0.0
category: "government-services"
tags:
  - rudi
  - operator
  - opencounter
requires:
  stacks:
    - stack:dwellow-mcp
    - stack:opencounter
---

# OpenCounter Cincinnati Guidance Operator

Use this skill as the host-native operating layer for `stack:opencounter`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Provider-free Cincinnati project assessment from authoritative Dwellow/site-engine evidence and the private observed OpenCounter questionnaire, with guarded headless-browser guidance for bounded confirmation, business permits and fees, special events, and residential permitting.

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Workflow

1. Identify the user's requested outcome, inputs, constraints, and whether the
   action changes external state.
2. For an address-plus-project-idea assessment, resolve the target first with
   Dwellow `lookup_location`. If it returns multiple plausible locations, stop
   and report every candidate; never choose by rank. Use the exact returned
   parcel/rollup/zoning evidence and call `get_zoning_rules` for that exact base
   code. Collect boundary, frontage, conditions, and envelope evidence only
   when physical feasibility is requested; stop at the site-envelope boundary.
3. Inspect the active MCP tool schema before calling a tool. The runtime schema
   is authoritative for parameter names, required fields, and enums.
4. Call `opencounter_assess_project` with a stable assessment key, exact private
   questionnaire digest, normalized site-resolution evidence, the requester's
   project idea, and only provenance-bearing answers. Treat lexical catalog-use
   candidates as untrusted suggestions and obtain requester confirmation before
   resubmitting a `confirmedCatalogEntryId`.
5. Start with discovery, inspection, validation, preview, or dry-run tools when
   the stack provides them.
6. Use the fewest tool calls that can complete the request. Reuse returned IDs
   and paths instead of guessing them.
7. A provider preview from `opencounter_assess_project` is not authorization.
   Before a destructive, irreversible, public, paid, or externally visible
   action, obtain the user's confirmation unless they already authorized that
   exact action.
8. Validate tool results before using them as inputs to another call. Stop on
   malformed results, explicit errors, missing required data, or partial
   completion that makes the next action unsafe.
9. Verify mutations with a read-back, status, inspection, or artifact check
   when the stack supports one.
10. Report what was attempted, what succeeded, what failed, and any output IDs,
   URLs, or paths the user needs.

## Stack Tools

- `opencounter_assess_project`
- `opencounter_get_zoning_use_catalog`
- `opencounter_start_zoning_guidance`
- `opencounter_reconcile_zoning_start`
- `opencounter_start_guidance`
- `opencounter_continue_guidance`
- `opencounter_export_guidance`
- `opencounter_get_guidance_result`
- `opencounter_reconcile_guidance`

Supporting `stack:dwellow-mcp` tools for the evidence-first path:

- `lookup_location`
- `get_zoning_rules`
- `get_site_boundary`
- `build_frontage_workspace`
- `get_site_conditions`
- `run_site_envelope`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:opencounter`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
- Missing questionnaire state: report the exact required questionnaire digest
  or private-state configuration; do not fall back to an unversioned or newest
  file.
- Ambiguous site or use mapping: return candidates and wait for requester or
  evidence confirmation; do not auto-select.
