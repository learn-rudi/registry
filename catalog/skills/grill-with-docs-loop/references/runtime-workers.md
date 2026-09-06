# Runtime and worker protocol

## Runtime Adapters

Determine the active host before spawning roles. Preserve the isolation contract even when host terminology or controls differ.

### Codex

- Spawn each role with no inherited conversation history, using `fork_turns: "none"` or the current Codex equivalent.
- Give every role a stable task name such as `grill-q03-answerer` or `grill-q03-skeptic`.
- Record the task name and returned agent/thread identifier in the decision ledger when available.
- Tell the user that native agent threads can be inspected from the task's Subagents activity.

### Claude Code

- Use a fresh, non-fork subagent invocation for every role and omit persistent agent memory.
- Do not use `/subtask`, a conversation fork, `context: fork`, or any equivalent that inherits the parent conversation for an independently checked role.
- Give every role a stable name such as `grill-q03-answerer` or `grill-q03-skeptic`, and record the returned agent identifier when available.
- Use ordinary subagents when automatic reporting to the orchestrator is the priority. If the user explicitly requests separate reviewable sessions, use Agent View or background sessions only when the orchestrator can pass the same isolated briefs and collect final reports without leaking prohibited context.

### Other Hosts

Use fresh isolated workers with no inherited conversation history. If the host cannot provide that isolation, use degraded mode and disclose the limitation.

## Role Loop

Repeat steps 1-4 for every substantive question until the backlog is exhausted. Queue accepted decisions for documentation. Run steps 5-6 after a high-risk decision or when one or more compatible accepted decisions form a safe edit batch.

### 1. Questioner (spawned subagent)

Receives: the current backlog, a summary of the decision ledger, and the shallow repo map.

The questioner chooses the next highest-leverage unresolved question. It inspects only the files needed to confirm the question is real and unresolved, including relevant:

- `CONTEXT.md` and `CONTEXT-MAP.md`
- ADRs
- source code
- tests
- fixtures
- migrations
- generated artifacts
- schema or API contract files

Returns:

- the question, phrased so it can be answered with no further context
- affected domain terms
- likely doc target
- starting-point file paths where the answer probably lives

The questioner must not answer the question. If its report includes a recommended answer, the orchestrator discards the answer and keeps only the question.

### 2. Answerer (spawned subagent, fresh context)

Receives: the question, affected domain terms, and the questioner's starting-point paths. Nothing else.

The answerer resolves the question from repo evidence: it reads the code, tests, fixtures, migrations, generated artifacts, and contracts itself, following the evidence hierarchy.

Returns:

- the recommended answer
- evidence with file paths and line references
- risks, migration concerns, and naming consistency concerns
- whether the answer appears repo-evident or needs human judgment

### 3. Skeptic (spawned subagent, fresh context)

Receives: the question, the answerer's recommended answer as a bare claim, affected domain terms, and the claimed repo-evident or needs-human classification. It must not receive the answerer's evidence list or reasoning — the skeptic gathers its own evidence from the repo and tries to refute the claim.

Check independently against the repo:

- whether the repo actually supports the answer
- whether tests, fixtures, migrations, generated artifacts, or public contracts disagree
- whether the recommended terminology is consistent with existing names
- whether the answer would imply migration or compatibility risk
- whether the issue is really a product/domain choice rather than a repo-evident fact
- whether an ADR is justified or whether `CONTEXT.md` is enough

Return one of, each backed by the skeptic's own cited evidence:

- `accept`: the claim held up under independent verification
- `revise`: the answer needs a narrower or different formulation, with counter-evidence
- `ask-human`: repo evidence cannot decide the product/domain choice
- `skip`: the question does not require documentation

### 4. Orchestrator (main session, never delegated)

The orchestrator owns the decision. It is the only role that sees both sides: the answerer's evidence and the skeptic's verdict with its counter-evidence.

If the answerer and skeptic converge and the evidence is sufficient, accept the repo-evident decision.

If they conflict, run one more round before involving the user: spawn a fresh answerer with the skeptic's counter-evidence included in its brief, or perform one targeted repo inspection directly.

Ask the user only when:

- the repo supports multiple valid product/domain choices
- the code contradicts the intended product behavior and neither docs nor tests identify the desired future state
- changing terms would alter user-facing language or domain meaning
- the decision requires prioritization, risk tolerance, or business context outside the repo

Ask one concise question and wait. Include the recommended default and the evidence behind it.

### 5. Docs Writer (spawned subagent, fresh context)

Receives: one accepted decision, or a compatible batch of accepted decisions, with their evidence and doc targets.

Spawn with no inherited conversation history. Only one docs writer edits files at a time; the main session and every other role remain read-only while it works. Never batch decisions merely to reduce agent count when separate edits would be easier to verify.

Update the smallest set of docs that records the accepted decision:

- Use `CONTEXT.md` for domain language only.
- Use ADRs for durable design decisions that are hard to reverse, surprising without context, and the result of a real trade-off.
- Update an existing ADR when the decision clarifies or supersedes it.
- Create a new ADR only when the decision deserves independent historical context.
- Do not use docs as a scratch pad, implementation task list, or speculative roadmap.

### 6. Reviewer (spawned subagent, fresh context)

Receives: the diff, every original question represented in the edit batch, and the corresponding accepted decisions.

The reviewer checks the diff before the next loop iteration.

Verify:

- docs answer every original question represented in the edit batch
- terminology is consistent across touched docs
- `CONTEXT.md` remains a glossary, not a spec
- ADRs explain why, not just what
- no unrelated files were changed
- Markdown formatting is clean
- file names, links, and ADR numbering are correct
- verification commands are appropriate for the repo and pass when feasible

If review finds a problem, send it back to the docs writer before continuing.

