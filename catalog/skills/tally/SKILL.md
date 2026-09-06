---
name: "Tally Forms Operator"
description: "Create, manage, and analyze Tally forms and submissions"
version: 1.0.1
category: "data"
tags:
  - rudi
  - operator
  - tally
  - capability:analyze
  - provider:tally
requires:
  stacks:
    - stack:tally
---

# Tally Forms Operator

Use this skill as the host-native operating layer for `stack:tally`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Create, manage, and analyze Tally forms and submissions

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Task Routing And Verification

Resolve the exact form ID with `tally_list_forms`/`tally_get_form`, then inspect its
fields before filtering, exporting or drafting a mutation. Match submission IDs to
that form and keep exports within the requested date/field scope. Read back a form
after an authorized create/update and verify returned field IDs. For deletion, verify
the exact target and authorization first; never retry an uncertain mutation blindly.

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

## Stack Tools

- `tally_list_forms`
- `tally_get_form`
- `tally_create_form`
- `tally_update_form`
- `tally_delete_form`
- `tally_list_fields`
- `tally_list_submissions`
- `tally_get_submission`
- `tally_filter_submissions`
- `tally_export_submissions`
- `tally_generate_prefill_url`
- `tally_get_analytics`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:tally`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
