---
name: "Sports Stats Operator"
description: "Extract and query sports statistics from Basketball Reference, ESPN, and other sports sites"
version: 1.0.1
category: "data"
tags:
  - rudi
  - operator
  - sports-stats
  - capability:analyze
  - domain:sports
requires:
  stacks:
    - stack:sports-stats
---

# Sports Stats Operator

Use this skill as the host-native operating layer for `stack:sports-stats`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Extract and query sports statistics from Basketball Reference, ESPN, and other sports sites

Use the stack when the request needs these capabilities. Do not substitute
invented results when the stack, a required secret, or a supporting service is
unavailable.

## Task Routing And Verification

The current tools are `extract_nba_stats`, `save_nba_splits` and `query_nba_db`.
Verify the live schema’s supported provider, league, seasons and statistic fields;
do not promise universal sports-site coverage. Resolve the exact player/team and
season, retain source and retrieval dates, and distinguish missing splits from zero.
Before saving, inspect existing records and the tool’s duplicate handling; query
back saved rows and compare counts and totals with the extracted source.

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

- `extract_nba_stats`
- `save_nba_splits`
- `query_nba_db`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:sports-stats`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
