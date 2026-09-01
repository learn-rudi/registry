---
name: "Dwellow MCP Operator"
description: "Operate Dwellow MCP through RUDI's stack tools when a user asks for work supported by stack:dwellow-mcp. Bridge to the hosted Dwellow real-estate development feasibility MCP server."
version: 1.1.0
category: "real-estate"
tags:
  - rudi
  - operator
  - dwellow-mcp
requires:
  stacks:
    - stack:dwellow-mcp
---

# Dwellow MCP Operator

Use this skill as the host-native operating layer for `stack:dwellow-mcp`.
Translate the user's intent into the smallest safe sequence of stack tool calls,
then verify and report the result.

## When To Use

Bridge to the hosted Dwellow real-estate development feasibility MCP server.

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

- `lookup_location`
- `search_locations`
- `list_concept_archetypes`
- `get_concept_archetype`
- `get_zoning_rules`
- `find_candidate_sites`
- `run_legal_fit`
- `run_dimensional_fit`
- `run_community_fit`
- `run_financial_fit`
- `run_development_feasibility`
- `get_site_boundary`
- `build_frontage_workspace`
- `get_site_conditions`
- `refresh_site_conditions`
- `run_site_envelope`
- `run_building_fit`
- `generate_site_plan`
- `get_site_visual_context`
- `get_feasibility_status`
- `build_feasibility_package`

Use only tools that are actually available in the active RUDI router. If the
installed stack exposes a different tool set than this catalog version, report
the mismatch and use the live tool schema only when doing so remains within the
user's request.

`list_concept_archetypes` and `get_concept_archetype` are read-only Concept
surfaces. They expose only archetype ID/label, use class, unit/story counts,
massing form, typology, tags, and `plausible_for_exploration` authority. Treat
unit/story counts as reusable archetype identity, not verified site yield. Stop
on any unexpected private catalog, area/dimension, approval, zoning-fit,
financial-fit, or source-provenance field; do not use a private plan-catalog API
as a substitute. These two tools support early exploration only and do not
authorize any legal, dimensional, building, site-plan, or financial-fit tool.

## Failure Behavior

- Missing stack or tools: stop and ask the user to install, index, or integrate
  `stack:dwellow-mcp`; do not simulate a successful tool call.
- Missing credentials or authorization: name the required setup without
  printing secret values.
- Invalid input: explain the rejected field or constraint and request only the
  information needed to continue.
- Tool or dependency failure: preserve successful prior work, avoid blind
  retries of mutations, and report a safe retry or recovery step.
- Partial completion: distinguish completed actions from pending or failed
  actions so the user can recover without duplicating side effects.
