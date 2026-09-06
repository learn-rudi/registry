---
name: "SQLite Operator"
description: "Query and manage the exact local SQLite database selected by the user, with schema inspection and verified results."
version: 1.0.1
category: "data"
tags:
  - rudi
  - operator
  - sqlite
  - capability:manage
requires:
  stacks:
    - stack:sqlite
---

# SQLite Operator

Use this skill as the host-native operating layer for `stack:sqlite`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Query and manage the exact local SQLite database selected by the user, with schema inspection and verified results.

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Task Routing And Verification

Resolve the exact user-supplied database scope and verify that the stack’s configured
`SQLITE_DB_PATH` points to that database before queries. Do not substitute a default
application database. Inspect tables and schema before selecting columns, bound
read result sizes, and use the live SQL tool contract. For an authorized write,
preview the affected rows, preserve a recovery path, and read back the affected
records. If the configured database cannot be verified, stop before running SQL.

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

- `sqlite_query`
- `sqlite_execute`
- `sqlite_list_tables`
- `sqlite_describe_table`
- `sqlite_schema`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:sqlite`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
