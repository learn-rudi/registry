---
name: "Notion Workspace Operator"
description: "Search, create, and manage Notion pages and databases"
version: 1.0.1
category: "documents"
tags:
  - rudi
  - operator
  - notion-workspace
  - capability:manage
  - provider:notion
requires:
  stacks:
    - stack:notion-workspace
---

# Notion Workspace Operator

Use this skill as the host-native operating layer for `stack:notion-workspace`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Search, create, and manage Notion pages and databases

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Task Routing And Verification

Discover the exact workspace page or database, then read its current content and
`notion_get_database_schema` before choosing property names or types. Reuse returned
page/database IDs. Preview requested field and body changes against existing content;
check for an existing matching section before appending. After authorized writes,
read back both properties and body blocks. Preserve unrelated notes and distinguish
a missing database from an access failure.

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

- `notion_search`
- `notion_get_page`
- `notion_get_page_content`
- `notion_create_page`
- `notion_append_content`
- `notion_delete_page`
- `notion_list_databases`
- `notion_query_database`
- `notion_create_database`
- `notion_add_database_row`
- `notion_db_list`
- `notion_db_add`
- `notion_db_remove`
- `notion_batch_add_rows`
- `notion_update_row`
- `notion_get_database_schema`
- `notion_search_all_databases`
- `notion_duplicate_page`
- `notion_add_block`
- `notion_move_page`
- `notion_update_page_properties`
- `notion_get_page_tree`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:notion-workspace`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
