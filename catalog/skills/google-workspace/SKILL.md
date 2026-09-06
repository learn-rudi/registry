---
name: "Google Workspace Tools Operator"
description: "Workflow-focused tools for Gmail, Google Sheets, Docs, Slides, Drive, Calendar, and Tasks"
version: 1.0.1
category: "communication"
tags:
  - rudi
  - operator
  - google-workspace
  - capability:manage
  - provider:google
requires:
  stacks:
    - stack:google-workspace
---

# Google Workspace Tools Operator

Use this skill as the host-native operating layer for `stack:google-workspace`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Workflow-focused tools for Gmail, Google Sheets, Docs, Slides, Drive, Calendar, and Tasks

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

- `account_list`
- `account_switch`
- `account_current`
- `gmail_profile`
- `gmail_history_list`
- `gmail_send`
- `gmail_search`
- `gmail_draft`
- `gmail_draft_list`
- `gmail_draft_get`
- `gmail_draft_update`
- `gmail_draft_delete`
- `gmail_draft_send`
- `gmail_get`
- `gmail_get_raw`
- `gmail_list_attachments`
- `gmail_get_attachment`
- `gmail_reply`
- `gmail_forward`
- `gmail_get_thread`
- `gmail_message_trash`
- `gmail_message_untrash`
- `gmail_message_delete`
- `gmail_label_list`
- `gmail_label_create`
- `gmail_label_update`
- `gmail_label_delete`
- `gmail_message_modify_labels`
- `gmail_message_archive`
- `gmail_message_mark_read`
- `gmail_message_mark_unread`
- `gmail_message_star`
- `gmail_message_unstar`
- `gmail_message_batch_get`
- `gmail_thread_batch_get`
- `gmail_message_batch_modify_labels`
- `gmail_message_batch_trash`
- `gmail_message_batch_untrash`
- `gmail_message_batch_delete`
- `sheets_read`
- `sheets_write`
- `sheets_append`
- `sheets_create`
- `docs_read`
- `docs_create`
- `docs_insert_image`
- `slides_get_presentation`
- `slides_get_slide`
- `slides_get_thumbnail`
- `slides_batch_update`
- `drive_list`
- `drive_upload`
- `drive_update`
- `drive_create_folder`
- `drive_move_file`
- `drive_download`
- `drive_make_public`
- `drive_delete`
- `calendar_list`
- `calendar_create`
- `calendar_quick_add`
- `calendar_delete`
- `tasks_tasklists_list`
- `tasks_list`
- `tasks_create`
- `tasks_update`
- `tasks_complete`
- `tasks_delete`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:google-workspace`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
