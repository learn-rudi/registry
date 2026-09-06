---
name: "Data Analysis Operator"
description: "Analyze data with Python, pandas, numpy, and matplotlib. Generate charts and insights."
version: 1.0.1
category: "data"
tags:
  - rudi
  - operator
  - data-analysis
  - capability:analyze
requires:
  stacks:
    - stack:data-analysis
---

# Data Analysis Operator

Use this skill as the host-native operating layer for `stack:data-analysis`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Analyze data with Python, pandas, numpy, and matplotlib. Generate charts and insights.

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Task Routing And Verification

Load the accepted local CSV, Excel or JSON source with the matching `data_load_*`
tool, then use `data_describe` to inspect columns, types, row counts, missing values,
duplicates, units and date coverage. Resolve ambiguous measures before calculating.
Use `data_query` for selection, `data_transform` for explicit derived fields, and
`data_aggregate` for grouped measures. Retain the original input and record exclusions.

Use `data_chart` only after checking the underlying aggregation, labels and units.
Use `data_export` for requested deliverables and verify the returned artifact exists,
has the expected rows/columns and agrees with the computed totals. Distinguish
observed data, assumptions and interpretations; do not imply causal evidence from
correlation or silently treat missing values as zero.

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

- `data_load_csv`
- `data_load_excel`
- `data_load_json`
- `data_describe`
- `data_query`
- `data_transform`
- `data_aggregate`
- `data_chart`
- `data_export`
- `data_list`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:data-analysis`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
