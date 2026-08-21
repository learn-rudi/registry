---
name: Grill With Docs Loop
description: Resolve repo domain questions with isolated agents, update CONTEXT.md and ADRs, and preserve reviewable audit trails
version: 2.1.0
category: coding
tags: [architecture, domain-modeling, glossary, adr, documentation, multi-agent, repo-analysis]
---

# Grill With Docs Loop

Run an evidence-first documentation loop that resolves a repository's open contract, terminology, and design questions with minimal human interruption.

This skill is different from `grill-with-docs`: the default mode is not an interview. Spawned subagents grill each other first — one poses each question, a second answers it cold from repo evidence, a third independently tries to refute the answer — and the human enters only when repo evidence cannot decide a real product or domain choice.

## Operating Contract

- Prefer repo evidence over asking the user.
- Ask the user one question at a time only when human judgment is required.
- Keep the main session as the orchestrator, responsible for final decisions, sequencing, and merge control. Never delegate orchestration.
- Spawn a fresh, non-fork subagent for every questioner, answerer, and skeptic role. Use a fresh docs writer and reviewer for every edit batch. Never reuse an agent for another role, question, or edit batch. Do not roleplay these roles inside the main context: a context that reviews its own reasoning will agree with itself.
- Enforce information isolation through the active host's runtime adapter. Give every investigative role only the inputs listed in its role definition. Never forward one agent's reasoning or evidence trail to the agent whose job is to check it independently.
- Do not let multiple agents edit the same files concurrently. Only the docs writer edits files.
- Degraded mode: only if the runtime truly has no subagent capability may the roles run sequentially in one context. Label each pass in working notes and state in the final report that the loop ran degraded and why.
- Stop only when the question backlog is exhausted, docs are updated, and verification passes or any remaining gap is explicitly blocked on a human decision.

## Goal Mode

When the user asks to run this as a goal, define the objective as:

> Complete the repo-first grill-with-docs loop for this repository: exhaust unresolved contract and design questions, resolve repo-evident decisions from evidence, ask the human only for true product or domain choices, update `CONTEXT.md` and relevant ADRs, and verify the resulting docs.

Keep the goal open until the backlog is exhausted and verification passes. Mark the goal blocked only when the same human-only decision blocks progress after repeated attempts to continue.

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

## Run Identity And Reviewability

Create a short run ID and stable question IDs before the first role is spawned. Label workers as `grill-<run-id>-qNN-<role>` when the host permits it.

Keep the normal decision ledger in memory or task notes. For every question, record:

- question ID and text
- role labels and native agent, thread, or session identifiers when available
- answerer's bare claim and classification
- skeptic verdict
- accepted decision and evidence paths
- documentation target and verification result

When the user asks for a reviewable, auditable, resumable, or cross-chat run, enable **reviewable mode**. Persist a concise audit bundle under `~/.rudi/outputs/grill-with-docs-loop/<run-id>/` containing:

- `audit.md` with the run summary and question index
- one `qNN.md` per question with role reports, evidence references, verdict, and final decision
- `diff.md` or an equivalent final documentation diff

Record agent-produced reports and tool evidence, not hidden chain-of-thought. Do not write the audit bundle into the repository or commit it unless the user explicitly asks. In the final response, provide the audit path and explain how to inspect any native agent threads or sessions.

## Efficiency Controls

- Discover, deduplicate, and prioritize the backlog once before starting the adversarial loop. Merge questions only when they represent the same decision; do not merge merely related decisions.
- Do not run the full Answerer/Skeptic pair for cosmetic edits or questions already resolved by an authoritative current source. Record why such an item was skipped.
- Reuse the shallow repo map and decision-ledger summaries, but never reuse an investigative agent or give the skeptic the answerer's evidence trail.
- Prefer faster or lower-cost models for bounded question discovery and straightforward documentation formatting when the host supports role-level model selection. Use stronger reasoning for ambiguous Answerer and Skeptic work.
- Adjudicate every substantive question independently. After acceptance, batch only compatible documentation changes that target the same files and do not depend on unresolved decisions.
- Run one fresh docs writer and one fresh reviewer per compatible edit batch. Use a separate batch for high-risk decisions, public-contract changes, or edits that could obscure which decision caused a problem.

## Start State

First, load the repo context needed to avoid guessing:

1. Read active instructions such as `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, or `.github/copilot-instructions.md`.
2. Check worktree state with `git status --short` so user changes are not confused with agent edits.
3. Locate domain docs:
   - `CONTEXT-MAP.md`
   - root or context-local `CONTEXT.md`
   - `docs/adr/`
   - architecture docs, design docs, generated schemas, fixtures, migrations, and tests
4. Build a shallow map of relevant source, test, fixture, migration, and generated-artifact paths.
5. Create a working decision ledger in memory or task notes. Do not commit a ledger file unless the user asks for one.

## Backlog

Treat the backlog as every unresolved question that prevents `CONTEXT.md` and ADRs from accurately explaining the repo's domain language and durable design decisions.

Find backlog items from:

- explicit user questions
- TODOs, FIXME notes, or "grill me" notes in docs
- contradictions between `CONTEXT.md`, ADRs, README files, tests, migrations, generated artifacts, and implementation
- overloaded or inconsistent names for the same domain concept
- architectural choices that are visible in code but not explained in ADRs
- stale ADRs contradicted by current repo behavior

Each backlog item should have:

- question
- recommended answer, left empty until an Answerer supplies it
- evidence
- counterargument or risk
- decision status: `repo-evident`, `needs-human`, `accepted`, `blocked`, or `resolved`
- doc target: `CONTEXT.md`, existing ADR, new ADR, or no doc change

## Evidence Hierarchy

Prefer evidence in this order:

1. Active repo instructions and explicit user constraints.
2. Accepted ADRs and current context docs.
3. Tests, fixtures, migrations, generated schemas, and public contracts.
4. Implementation at system boundaries and domain boundaries.
5. README, planning docs, and historical notes.
6. Commit history only when present-day files do not explain why a decision exists.

When sources conflict, prefer current behavior for "what is true" and ADRs or user input for "why it should be true." Surface the conflict before editing docs.

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

## CONTEXT.md Rules

`CONTEXT.md` is a glossary and context-language guide. Keep it free of implementation details.

Use this shape:

```markdown
# {Context Name}

{One or two sentences describing what this context is and why it exists.}

## Language

**Order**:
A customer request for goods or services.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Rules:

- Pick one canonical term when multiple words exist for the same concept.
- Put rejected synonyms under `_Avoid_`.
- Define what a term is, not implementation details or lifecycle steps.
- Keep definitions to one or two sentences.
- Include only terms specific to this repo's domain.
- Split by subheading only when natural clusters emerge.

For multi-context repos, use `CONTEXT-MAP.md` to point to context-local glossaries and describe relationships between contexts.

## ADR Rules

Create or update ADRs sparingly.

An ADR is justified only when all three are true:

1. The decision is hard to reverse.
2. The decision would be surprising without context.
3. The decision reflects a real trade-off among plausible options.

ADRs live in `docs/adr/` unless the repo already uses a different ADR location. Use sequential numbering such as `0001-short-slug.md`.

Use this minimal shape:

```markdown
# {Short Decision Title}

{One to three sentences explaining the context, decision, and why.}
```

Optional sections such as `Status`, `Considered Options`, and `Consequences` are allowed only when they add durable value.

## Verification

After each docs edit, run the smallest useful checks for the touched files.

Examples:

- inspect the diff with `git diff --check`
- search for old or conflicting terms with `rg`
- run Markdown lint or docs validation when the repo provides it
- run tests or schema validation when the docs describe public contracts, generated artifacts, migrations, or behavior-bearing decisions

Before stopping, provide:

- resolved decisions
- docs changed
- human questions asked, if any
- verification commands and results
- which roles ran as spawned subagents; if degraded sequential mode was used, say so and explain why
- role labels and native agent, thread, or session identifiers when available
- reviewable-mode audit path, when enabled
- remaining blocked items, only if blocked on explicit human judgment
