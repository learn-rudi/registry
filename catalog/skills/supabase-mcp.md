---
name: "Supabase MCP Operator"
description: "Operate Supabase MCP through RUDI's stack tools when a user asks for work supported by stack:supabase-mcp. Connect agents to Supabase's hosted OAuth MCP server for database, project, Edge Functions, docs, and development tools."
version: 1.0.0
category: "data"
tags:
  - rudi
  - operator
  - supabase-mcp
requires:
  stacks:
    - stack:supabase-mcp
---

# Supabase MCP Operator

Use this skill as the host-native operating layer for `stack:supabase-mcp`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Connect agents to Supabase's hosted OAuth MCP server for database, project, Edge Functions, docs, and development tools.

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

## Stack Tools

- `list_tables`
- `list_extensions`
- `list_migrations`
- `apply_migration`
- `execute_sql`
- `get_logs`
- `get_advisors`
- `get_project_url`
- `get_publishable_keys`
- `generate_typescript_types`
- `list_edge_functions`
- `get_edge_function`
- `deploy_edge_function`
- `list_projects`
- `get_project`
- `create_project`
- `pause_project`
- `restore_project`
- `list_organizations`
- `get_organization`
- `get_cost`
- `confirm_cost`
- `search_docs`
- `create_branch`
- `list_branches`
- `delete_branch`
- `merge_branch`
- `reset_branch`
- `rebase_branch`
- `list_storage_buckets`
- `get_storage_config`
- `update_storage_config`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:supabase-mcp`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
