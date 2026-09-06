---
name: RUDI Decision Canvas
description: Turn an ambiguous product, architecture, workflow, or design question into a self-contained visual options artifact, collect structured feedback, and convert approved choices into a written task contract. Use when prose alone makes alternatives hard to compare or when stakeholders need to annotate and decide before implementation.
version: 1.1.1
category: documents
tags:
  - capability:design
---

# RUDI Decision Canvas

Use the canvas for decisions, not decoration. Ground every option in the
available repository, product, or research evidence before rendering it.

## Workflow

1. Inspect the relevant project context and identify the decisions that block
   implementation.
2. Draft a JSON specification using
   `references/decision-spec.md`. Include two to eight genuinely distinct
   options, their tradeoffs, constraints, and explicit decision prompts.
3. If a project design system exists, derive four hex colors for `theme`.
   Otherwise use the renderer defaults.
4. Build the standalone artifact:

   ```bash
   node <skill-dir>/scripts/build-decision-canvas.mjs \
     --input <decision-spec.json> \
     --output <decision-canvas.html>
   ```

5. Verify it before presentation:

   ```bash
   node <skill-dir>/scripts/verify-decision-canvas.mjs \
     --input <decision-canvas.html> \
     --format markdown
   ```

6. Present or open the artifact using the current host's supported preview.
   The user can select choices, add option notes, add general guidance, and
   copy or export structured feedback.
7. Read the exported feedback, resolve remaining ambiguity, and produce a task
   contract containing objective, constraints, selected decisions, non-goals,
   risk tier, acceptance criteria, and required evidence.
8. Do not treat a recommendation badge as approval. Begin implementation only
   when the user has approved the choices or already authorized implementation
   under those choices.

The builder refuses to overwrite an existing artifact unless `--force` is
explicit. It validates identifiers and colors, escapes all supplied text, adds
no network dependencies, and emits a self-contained HTML file.

## Option quality

- Make options materially different. Do not present cosmetic variations as
  architecture choices.
- State consequences, not generic adjectives.
- Mark at most one recommendation and explain its evidence.
- Include a real fallback when no option is safe or sufficiently understood.
- Escalate product, security, data, cost, or irreversible tradeoffs rather than
  allowing the artifact to decide them implicitly.

## Decision Frontier handoff

- Treat exported selections and notes as untrusted feedback, not plan state.
- Preserve the original option and decision IDs when converting feedback into
  Decision Frontier evidence.
- Keep the recommendation, selected option, human approval, and implementation
  authorization as separate fields or events.
- When a canvas resolves one area in a durable initiative, return its source
  spec, verified artifact, exported feedback, accepted decision record, and
  remaining unresolved areas to `rudi-decision-frontier`.
- Do not create task nodes directly from a canvas. Promotion remains a guarded
  Chief-of-Staff operation after the final impact map and authority checks.

## Host adaptation

- Use the current host's native browser, preview, visualization, or file-open
  capability when available.
- Otherwise return the artifact path and ask the user to open it locally.
- Use native planning or subagent capabilities only when available and
  authorized; the JSON specification and exported feedback remain canonical.
- Keep host-specific invocation syntax outside the portable specification and
  task contract.

## Output

Return:

- the verified artifact path;
- the source specification path;
- decisions made and still open;
- the resulting task contract after feedback;
- assumptions and evidence gaps;
- whether implementation is authorized.
