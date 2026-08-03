# Agent Hosts

`stack:agent-hosts` is a governed MCP capability gateway for three existing
execution hosts:

- `deepseek-http-v1` — DeepSeek Chat Completions using the optional RUDI secret
  `DEEPSEEK_API_KEY`.
- `claude-code-cli-v1` — Claude Code print mode using the local Claude
  subscription login.
- `codex-cli-v1` — Codex CLI exec mode using the local ChatGPT subscription
  login.

RUDI owns package installation, secret injection, indexing, and MCP routing.
Claude Code, Codex, and DeepSeek remain the agent execution hosts. This stack
does not own workflow state and does not make RUDI the default agent runner.

## Tools

- `agent_host_list` lists the fixed fleet and returns `default_adapter_id: null`.
- `agent_host_probe` probes one explicit `adapter_id`, or all three when omitted.
- `agent_host_invoke` synchronously invokes one explicit adapter.

Every invoke requires `adapter_id`, `content_class`, `correlation_id`,
`invocation_id`, `output_format`, `prompt`, and `timeout_ms`. V0 accepts only
`content_class: synthetic_nonprivate`. Prompts are limited to 200,000 code
units, returned output is limited to 1 MiB, and timeout is limited to 1–25
seconds so the stack returns before the current RUDI router request ceiling.

There is no default provider, fallback, model override, arbitrary environment,
working-directory override, tool delegation, automatic retry, or async queue in
V0. One invocation per adapter may be active in each stack server process;
additional concurrent calls return `failure_class: busy`.

## Authentication and cost

Claude Code and Codex use existing local subscription authentication. Their
invocations count against the applicable subscription limits. DeepSeek uses API
credits through the RUDI-managed key. `agent_host_probe` does not invoke a model;
`agent_host_invoke` can consume credits or subscription allowance.

The router injects the declared DeepSeek key only into the stack process. Child
Claude and Codex processes receive a minimal environment that excludes provider
API keys and other arbitrary parent variables. Claude runs with no tools in
safe plan mode. Codex runs ephemeral, read-only, with user config and rules
ignored.

## State and ownership

Portable source lives in this Registry package. Local runtime state lives under
the RUDI state root at `state/stacks/agent-hosts`; it is never registry content.
Service Desk remains the canonical owner of Service Requests, approvals,
Execution Attempts, audit, scheduling, and recovery. A Service Desk workflow
must persist its own governed attempt before dispatching through this stack.
