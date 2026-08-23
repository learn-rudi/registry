# ADR 0010: External Agent CLI Ownership

Date: 2026-08-23

Status: Accepted

## Context

The original RUDI Lite/Studio appliance model allowed agent packages to be
delivered through RUDI's bundled Node runtime. Current RUDI architecture uses
provider-native Agent Hosts while RUDI supplies local tools, secrets mediation,
MCP routing, and RUDI-owned Node/Python execution for stacks.

Allowing both npm-delivered and system-delivered `agent:*` records makes the
registry advertise an installation responsibility the RUDI runtime no longer
owns.

The catalog also retained `agent:copilot`, but the current CLI has no Copilot
Agent Host adapter, launch contract, readiness inspector, or MCP integration.
Keeping that entry would advertise a runnable RUDI capability that does not
exist.

## Decision

Every registry package with `kind: "agent"` is external, detection-only
metadata:

- `version` is `system`;
- `delivery` is `system`;
- `install.source` is `system`;
- executable detection and vendor-supported installation guidance are
  required;
- npm, pip, download, catalog, and native-installer delivery are rejected for
  agents.

These entries describe supported host prerequisites and authentication. They
do not authorize the CLI to install, update, wrap, or redistribute a provider
CLI.

The supported catalog is exactly `agent:antigravity`, `agent:claude`,
`agent:codex`, and `agent:gemini`. The unsupported legacy `agent:copilot` entry
is removed. This is an intentional breaking inventory change: Copilot remains
vendor software, but RUDI does not catalog it as an Agent Host until a governed
adapter and readiness contract exist.

## Consequences

- Registry validation prevents a future agent catalog entry from reintroducing
  the bundled-runtime model.
- RUDI runtimes and binary/tool packages remain installable and independently
  managed.
- A missing host is resolved through provider guidance, not a RUDI package
  fallback.
- Existing machine-local agent artifacts are migration state and are not
  changed by this catalog decision.
- Registry searches and generated manifests no longer return
  `agent:copilot`.

## Invariants

- Agent execution and authentication remain provider-owned.
- RUDI owns its tools, MCP stacks, router, and supporting language runtimes.
- Every requested provider is explicit; the registry never substitutes one
  Agent Host for another.
