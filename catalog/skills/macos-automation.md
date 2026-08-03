---
name: "macOS Automation Operator"
description: "Operate macOS Automation through RUDI's stack tools when a user asks for work supported by stack:macos-automation. Guarded macOS automation tools for apps, Finder, Reminders, Shortcuts, notifications, and System Events permission checks."
version: 1.0.0
category: "local-automation"
tags:
  - rudi
  - operator
  - macos-automation
requires:
  stacks:
    - stack:macos-automation
---

# macOS Automation Operator

Use this skill as the host-native operating layer for `stack:macos-automation`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Guarded macOS automation tools for apps, Finder, Reminders, Shortcuts, notifications, and System Events permission checks.

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

- `macos_status`
- `macos_automation_inventory`
- `macos_automation_dashboard`
- `macos_check_accessibility`
- `macos_get_frontmost_app`
- `macos_list_windows`
- `macos_open_url`
- `macos_open_app`
- `macos_focus_app`
- `macos_show_notification`
- `macos_list_shortcuts`
- `macos_run_shortcut`
- `macos_create_reminder`
- `macos_get_selected_finder_items`
- `macos_reveal_in_finder`
- `macos_keep_awake_start`
- `macos_keep_awake_status`
- `macos_keep_awake_stop`
- `macos_install_launch_agent`
- `macos_list_launch_agents`
- `macos_remove_launch_agent`
- `macos_run_launch_agent_now`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:macos-automation`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
