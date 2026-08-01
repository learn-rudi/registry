# ADR 0002: Agent Hosts Capability Boundary

## Status

Accepted

## Context

Local workflows need a shared way to invoke DeepSeek, Claude Code, or Codex in
headless mode. Service Desk already proved provider-specific adapters, but those
adapters do not own Service Request state and should not become the only route
through which other agents can access the same execution hosts.

RUDI owns installed tools, secrets, packages, the tool index, and MCP routing.
Agent hosts own live model execution. Service Desk owns its durable domain state,
approval decisions, attempts, scheduling, and recovery.

## Decision

The Registry provides one `stack:agent-hosts` MCP capability gateway with three
tools: list, probe, and synchronous invoke. Its provider fleet is fixed and
selection is explicit. RUDI installs, indexes, routes, and injects the optional
DeepSeek secret; Claude Code, Codex, and DeepSeek perform model execution.

The gateway owns no canonical workflow records. It does not expose legacy RUDI
run-group or child-spawn surfaces and does not make RUDI an agent runner. A
stateful caller such as Service Desk must persist and govern its own attempt
before calling the stack and must validate the returned model output at its own
trust boundary.

V0 accepts only caller-asserted synthetic nonprivate prompts. It exposes no raw
RUDI tools to invoked models, supports no default or fallback provider, accepts
no arbitrary model/working-directory/environment/flag inputs, performs no
automatic retries, and permits only one in-flight invocation per provider per
stack server process.

## Consequences

Any agent with RUDI router access can discover and explicitly call the governed
fleet. Calls can consume DeepSeek credits or Claude/Codex subscription limits,
so callers must choose providers intentionally and handle `busy`, rate limit,
timeout, and provider failures without blind retries.

Service Desk provider-specific code may remain temporarily as proven reference
and local smoke coverage, but future Service Desk workflow wiring should depend
on a contracted RUDI Agent Host gateway instead of creating another execution
authority. That migration must preserve the Service Desk lifecycle contract,
including persisting an Execution Attempt before external dispatch and never
automatically retrying an indeterminate effect.
