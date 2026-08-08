# Host Adapters

Use the current host's native capabilities as the source of truth. Tool names,
agent identifiers, concurrency limits, persistence, and visibility differ by
host. Discover what is available instead of inventing an operation.

## Codex

- Use native collaboration capabilities to create bounded workers, inspect
  their status, send follow-ups, wait for updates, interrupt work, and collect
  final results.
- Record the returned agent target or canonical task name in `agent_ref`.
- Treat Codex's parent/child thread graph and desktop task UI as the visibility
  layer. A thread deep link is useful for human navigation but is not the task
  contract or the agent messaging protocol.
- Keep the root thread as manager. Give each writer the absolute worktree path
  in its assignment because worker processes may share the same filesystem.
- Respect the host's concurrency limit. Queue ready tasks and retain capacity
  for review or rework.

## Claude

- Use the current Claude host's native task, subagent, or team capabilities
  when they are available and authorized.
- Record the task or agent handle returned by the host in `agent_ref` and use
  the host's supported status, messaging, and cancellation controls.
- Pass the same crew and worktree contracts used by Codex. Do not assume a
  Claude worker inherits the manager's full conversation or automatically
  sees another worker's results.
- If the current Claude surface cannot expose or steer workers, reduce the
  crew to the capabilities actually available or use sequential fallback.

## Other native hosts

- Map the workflow to four capability classes: dispatch, observe, communicate,
  and stop.
- Prefer host-owned agent execution. Use RUDI for tools, secrets, stack access,
  and normalized capability discovery rather than treating RUDI as the default
  agent runner.
- Use cross-provider groups only when the user explicitly requests that
  execution model and the host exposes it safely.

## Sequential fallback

When the host lacks native delegation or safe isolation:

1. keep the same task graph and contracts;
2. execute one ready assignment at a time in the initiating session;
3. preserve worktree isolation when it still protects user work;
4. report that parallel crew execution is unavailable;
5. do not launch unsupervised terminal processes and claim they are managed
   agents.

The fallback preserves correctness and auditability while giving up parallel
execution.
