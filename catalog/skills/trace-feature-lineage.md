---
name: Trace Feature Lineage
description: Perform end-to-end feature and data-lineage traces across software repositories. Use when investigating where a user-visible page, command, API result, record, workflow, or behavior comes from; why data appears, is missing, stale, filtered, duplicated, or mismatched; or when planning refactors, onboarding, incident response, deprecation cleanup, architecture reviews, or test coverage for an existing feature.
version: 1.0.0
category: coding
tags: [feature-trace, data-lineage, debugging, architecture, testing, repo-analysis]
---

# Trace Feature Lineage

## Purpose

Map a user-visible capability from entry point to output across every runtime layer. When data correctness is part of the question, extend the trace into a data-lineage check that identifies how source data is created, refreshed, transformed, cached, indexed, and consumed.

The goal is to reveal the actual contract: what the feature is designed to do, what people assume it does, and where those differ.

## Operating Rules

- Follow active repo instructions, local `AGENTS.md`, and explicit user instructions first.
- Start from an observable entry point or a concrete record. If either is missing, infer candidates from the repo and ask only when multiple plausible choices would change the investigation.
- Do not infer wiring from names alone. Verify imports, callers, routes, queries, job registration, config, and runtime data access.
- Separate similar adjacent systems from the path that is actually wired.
- Treat API responses, files, database rows, job payloads, and LLM output as untrusted until validated.
- Never print secrets, tokens, connection strings, or private data values not needed for the trace.
- Prefer live data, tests, logs, and executable commands over code reading alone when the environment allows it.
- Do not edit production behavior unless the user explicitly asks for fixes. This skill primarily investigates, maps, and recommends.

## Trace Depth

Choose the shallowest depth that answers the question:

- **Quick trace**: current runtime path only.
- **Full trace**: runtime path plus producers, transformations, jobs, migrations, downstream consumers, tests, and observability.
- **Audit trace**: full trace plus historical commits, ownership, deprecation risk, failure modes, and formal test-gap report.

If the user does not specify depth, use full trace for bugs or data-quality questions and quick trace for orientation questions.

## Evidence Labels

Label important claims:

- `Confirmed by code`: file, function, route, query, schema, or test proves it.
- `Confirmed by live data`: database/API/cache/job output proves it.
- `Inferred`: likely but not directly proven.
- `Not found`: searched for expected wiring or producer and did not find it.
- `Not verified`: verification was unavailable, unsafe, or out of scope.

## Workflow

1. **Frame the investigation**
   - Identify the user-visible feature, route, page, command, API endpoint, button, report, or record.
   - Capture expected behavior, observed behavior, and any concrete example such as address, customer, order, site, tenant, job, or file.
   - Decide trace depth and whether live data access is allowed.

2. **Orient in the repo**
   - Read active instructions and check worktree state.
   - Use `rg --files`, targeted `rg`, and existing docs/tests to locate likely entry points.
   - Identify package commands only when needed for verification.

3. **Trace downstream from the entry point**
   - Follow UI routes, components, state/hooks, API clients, backend routes, validation schemas, service logic, repository/query layers, data stores, enrichment logic, background jobs, external integrations, and rendering/output.
   - Record each layer's input, output, filtering, sorting, permissions, failure behavior, and assumptions.

4. **Trace upstream to data producers**
   - Locate imports, migrations, seeders, sync jobs, rollup builders, indexing tasks, backfills, admin tools, manual artifacts, cache refreshers, and external data sources.
   - Note whether each producer is actually wired, scheduled, and responsible for the runtime data source.

5. **Check adjacent systems**
   - Search for similar names, legacy flows, alternate tables, duplicate APIs, unused components, and docs that imply a different model.
   - Explicitly mark systems that sound related but are not connected to the investigated feature.

6. **Verify with live data where allowed**
   - Query the concrete record through the same runtime path when possible.
   - Compare raw source records, transformed records, API responses, caches, and rendered output.
   - Distinguish wrong data, stale data, filtered data, missing producer wiring, and product/model mismatch.

7. **Assess tests and observability**
   - Find existing unit, integration, E2E, fixture, migration, and smoke coverage.
   - Identify missing assertions for the actual contract, important edge cases, producer freshness, and downstream consumers.
   - Check whether logs, metrics, errors, and correlation IDs would expose failures in this path.

8. **Name the actual contract and gaps**
   - State what the feature currently represents.
   - State what users or product language appear to assume it represents.
   - Identify mismatches, broken assumptions, stale docs, missing tests, and risky dependencies.

## Deliverable Shape

Use this structure unless the user asks for a different artifact:

```markdown
## Feature Purpose

- Investigated feature:
- Expected behavior:
- Observed behavior:
- Trace depth:

## Entry Points

| Layer | File/Route/Command | Evidence | Notes |
|-------|--------------------|----------|-------|

## Runtime Pathway

| Step | Component/Function | Input | Output | Assumptions |
|------|--------------------|-------|--------|-------------|

## Data Lineage

| Source/Producer | Target | Transform/Filter | Refresh Trigger | Evidence |
|-----------------|--------|------------------|-----------------|----------|

## Adjacent Systems Not Actually Wired

-

## Live Data Verification

- Record checked:
- Method:
- Result:
- Gaps:

## Actual Contract

- Current implementation contract:
- Assumed product contract:
- Mismatch:

## Tests And Observability

- Existing coverage:
- Missing coverage:
- Logs/metrics/error visibility:

## Recommended Fix Options

1. Minimal safe fix:
2. Data repair or backfill:
3. Naming/docs/product clarification:
4. Test plan:

## Open Questions

-
```

## Stop Conditions

Stop when the actual runtime path, data source, producer path, downstream consumers, and contract mismatch are known well enough to recommend a fix or state why the trace is blocked.

Escalate instead of guessing when live data is required but unavailable, the producer cannot be found after targeted searches, or the desired product contract depends on business judgment outside the repo.
