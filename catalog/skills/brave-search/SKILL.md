---
name: "Brave Search Operator"
description: "Operate Brave Search through RUDI's stack tools when a user asks for current web discovery supported by stack:brave-search. Read-only provider search with RUDI-mediated credentials and explicit storage-rights boundaries."
version: 1.0.1
category: "web"
tags:
  - rudi
  - operator
  - brave
  - search
  - web-discovery
  - capability:research
  - provider:brave
requires:
  stacks:
    - stack:brave-search
---

# Brave Search Operator

Use this skill as the host-native operating layer for `stack:brave-search`.
Translate the user's research intent into the smallest safe search request and
report source-linked results without inventing unavailable evidence.

## Workflow

1. Confirm the query, requested freshness, and result count. Use the smallest
   count that can answer the request.
2. Inspect the live `brave_web_search` schema; the installed schema is
   authoritative.
3. Treat each request as a paid external action. Obtain confirmation unless the
   user has already authorized that exact search or workflow.
4. Call only the qualified Brave Search tool and validate its returned rows.
5. Preserve source URLs and distinguish provider results from conclusions or
   downstream editorial judgments.
6. Do not persist provider results unless the caller has confirmed that its
   Brave subscription includes the necessary storage rights.
7. Report the query/freshness used, what succeeded, and any bounded provider
   failure or incomplete evidence.

## Stack Tools

- `brave_web_search`

Use only tools actually available through the active RUDI router. If the stack
or tool is missing, report that it must be installed and indexed; do not
simulate a successful search.

## Failure Behavior

- Missing stack/tool: stop and request installation or indexing.
- Missing credential: name `BRAVE_SEARCH_API_KEY` without printing its value.
- Invalid input: explain the rejected field and its boundary.
- Authentication, billing, or scope failure: do not retry; report the safe
  provider guidance.
- Rate limit or dependency failure: respect the stack's bounded retries and do
  not add blind retries at the workflow layer.
- Malformed or partial results: do not represent the request as complete.
