# Brave Search

`stack:brave-search` is RUDI's read-only Brave Web Search API provider adapter.
It exposes one MCP tool and keeps the provider credential inside RUDI's
secret-mediated stack boundary.

## Tool

### `brave_web_search`

Inputs:

- `query` (required): 1-400 characters and at most 50 words.
- `count`: integer from 1 through 20; default `10`.
- `freshness`: optional `pd`, `pw`, `pm`, `py`, or an inclusive
  `YYYY-MM-DDtoYYYY-MM-DD` range.
- `timeout_seconds`: `0.1` through `25`; default `10`. The ceiling reserves
  time inside the RUDI router's 30-second delegated-call boundary.

The output includes the normalized provider identity, query, requested count,
freshness, retrieval timestamp, skipped-result count, and rows containing URL,
title, snippet, rank, and optional publication metadata.

## Ownership Boundary

This stack owns provider authentication, request validation, bounded HTTP
transport, transient retry behavior, safe errors, and response normalization.
It does not write files or own query plans, capture manifests, editorial
provenance, annotations, clustering, promotion, or publication.

Brave's terms vary by plan. A caller that persists API results must separately
confirm that its subscription includes the necessary storage rights.

## Secret

Configure `BRAVE_SEARCH_API_KEY` through RUDI secret state. Do not export the
key into product configuration, include it in commands, or print its value.

## Failure Behavior

- Invalid arguments fail before any provider request.
- HTTP 401, 402, 403, and 422 fail without retry and include safe guidance.
- HTTP 429, 502, 503, 504, and network/timeout failures receive at most three
  attempts with bounded exponential backoff inside one end-to-end timeout
  budget.
- Malformed, non-object, oversized, or structurally invalid responses fail
  rather than being represented as successful empty results. Response bytes
  are counted while streaming and the body is canceled above 2 MB.
- Provider response bodies and secret values are not included in errors.

## Verification

```bash
npm test
```

From the registry root:

```bash
npm run stacks:verify -- --stack stack:brave-search --prepare
```
