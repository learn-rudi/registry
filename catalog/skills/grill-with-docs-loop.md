---
name: Grill With Docs Loop
description: Complete a repo-first, multi-agent grill-with-docs loop for a repository. Use when the user wants agents to inspect repo docs, code, tests, fixtures, migrations, and generated artifacts; resolve unresolved contract or design questions from evidence; update CONTEXT.md and ADRs; and ask the human only for true product or domain decisions.
version: 1.0.0
category: coding
tags: [architecture, domain-modeling, glossary, adr, documentation, multi-agent, repo-analysis]
---

# Grill With Docs Loop

Run an evidence-first documentation loop that resolves a repository's open contract, terminology, and design questions with minimal human interruption.

This skill is different from `grill-with-docs`: the default mode is not an interview. Agents challenge each other first, and the human enters only when repo evidence cannot decide a real product or domain choice.

## Operating Contract

- Prefer repo evidence over asking the user.
- Ask the user one question at a time only when human judgment is required.
- Keep one orchestrator responsible for final decisions, sequencing, and merge control.
- Do not let multiple agents edit the same files concurrently.
- Use separate scout, skeptic, docs, and review roles when subagents are available.
- If subagents are unavailable, run the same roles sequentially and label each pass in your working notes.
- Stop only when the question backlog is exhausted, docs are updated, and verification passes or any remaining gap is explicitly blocked on a human decision.

## Goal Mode

When the user asks to run this as a goal, define the objective as:

> Complete the repo-first grill-with-docs loop for this repository: exhaust unresolved contract and design questions, resolve repo-evident decisions from evidence, ask the human only for true product or domain choices, update `CONTEXT.md` and relevant ADRs, and verify the resulting docs.

Keep the goal open until the backlog is exhausted and verification passes. Mark the goal blocked only when the same human-only decision blocks progress after repeated attempts to continue.

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
- recommended answer
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

Repeat this loop until the backlog is exhausted.

### 1. Scout

The scout chooses the next highest-leverage unresolved question.

Inspect only the files needed to answer that question, including relevant:

- `CONTEXT.md` and `CONTEXT-MAP.md`
- ADRs
- source code
- tests
- fixtures
- migrations
- generated artifacts
- schema or API contract files

Return:

- the question
- the recommended answer
- evidence with file paths and line references when practical
- affected domain terms
- likely doc target
- risks, migration concerns, and naming consistency concerns
- whether the answer appears repo-evident or needs human judgment

### 2. Skeptic

The skeptic challenges the scout's recommendation without editing files.

Check:

- whether the evidence actually supports the answer
- whether tests, fixtures, migrations, generated artifacts, or public contracts disagree
- whether the recommended terminology is consistent with existing names
- whether the answer would imply migration or compatibility risk
- whether the issue is really a product/domain choice rather than a repo-evident fact
- whether an ADR is justified or whether `CONTEXT.md` is enough

Return one of:

- `accept`: the recommendation is repo-evident
- `revise`: the answer needs a narrower or different formulation
- `ask-human`: repo evidence cannot decide the product/domain choice
- `skip`: the question does not require documentation

### 3. Orchestrator

The orchestrator owns the decision.

If the scout and skeptic agree and the evidence is sufficient, accept the repo-evident decision.

If evidence is incomplete, do one more targeted repo inspection before asking the user.

Ask the user only when:

- the repo supports multiple valid product/domain choices
- the code contradicts the intended product behavior and neither docs nor tests identify the desired future state
- changing terms would alter user-facing language or domain meaning
- the decision requires prioritization, risk tolerance, or business context outside the repo

Ask one concise question and wait. Include the recommended default and the evidence behind it.

### 4. Docs Writer

Only one docs writer edits files at a time.

Update the smallest set of docs that records the accepted decision:

- Use `CONTEXT.md` for domain language only.
- Use ADRs for durable design decisions that are hard to reverse, surprising without context, and the result of a real trade-off.
- Update an existing ADR when the decision clarifies or supersedes it.
- Create a new ADR only when the decision deserves independent historical context.
- Do not use docs as a scratch pad, implementation task list, or speculative roadmap.

### 5. Reviewer

The reviewer checks the diff before the next loop iteration.

Verify:

- docs answer the original question
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
- remaining blocked items, only if blocked on explicit human judgment
