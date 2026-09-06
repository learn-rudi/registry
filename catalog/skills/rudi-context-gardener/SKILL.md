---
name: RUDI Context Gardener
description: Audit and right-size durable agent instructions across AGENTS.md, CLAUDE.md, and other repository guidance. Use when instructions feel bloated, duplicated, contradictory, stale, host-specific, or poorly divided between global guidance, repository guidance, nested guidance, skills, configuration, and executable stacks.
version: 1.1.1
category: agents
tags:
  - rudi
  - agent-context
  - instructions
  - progressive-disclosure
  - maintenance
  - capability:review
---

# RUDI Context Gardener

Audit first. Treat deterministic findings as signals for human or agent review,
not proof that guidance is wrong.

## Workflow

1. Resolve the repository or workspace root the user placed in scope.
2. Run the bundled audit without editing instructions:

   ```bash
   node <skill-dir>/scripts/audit-agent-context.mjs --root <root> --format markdown
   ```

3. Read `references/context-placement-rules.md` before recommending moves.
4. Inspect every reported duplicate, large file, host-specific reference, and
   conditional-workflow candidate in its surrounding context.
5. Classify each material instruction as:
   - keep where it is;
   - move to a narrower repository or subtree instruction file;
   - extract into a reusable skill;
   - enforce with configuration or a hook;
   - implement as a stack only when executable tools or persistent state are
     required;
   - retire because it is obsolete or contradicted by a stronger source.
6. Present the proposed moves and the invariants that must survive. Do not edit
   files when the user asked only for an audit.
7. When edits are authorized, make narrow changes, preserve the strongest
   applicable safety rule, and rerun the audit.

Use `--format json` when another tool or artifact will consume the report. The
script scans only recognized instruction files, skips symlinks and noisy build
or dependency directories, and reads no secret files.

## Judgment rules

- Keep always-applicable safety, authority, repository-boundary, and completion
  invariants in durable instructions.
- Move conditional procedures such as deployment, publishing, migration, or
  specialized testing into focused skills when they do not apply to most turns.
- Do not remove duplication blindly. A repeated rule may be intentional when a
  narrower host or subtree must remain independently usable.
- Do not claim two rules contradict each other from keyword matching alone.
  Read both rules, their scope, and their precedence.
- Prefer references to canonical manuals over copying long specialized
  standards into always-loaded context.
- Keep public registry skills portable. Put personal paths, client state, and
  machine-specific defaults in private or local overlays.

## Agent-readable instruction design

- Lead with the invariant or required outcome, then the minimum procedure.
- Prefer positive, executable instructions with checkable completion criteria;
  use prohibitions where the failure would be unsafe or authority-expanding.
- Put always-needed rules in the entry file and move examples, variants,
  templates, and detailed schemas behind direct references.
- Point to one canonical source instead of copying a standard into multiple
  contexts. State precedence when a narrower rule intentionally differs.
- Remove no-op prose that merely tells a capable agent to be careful,
  thoughtful, or high quality without defining observable behavior.
- Name triggers and non-triggers so a conditional skill is invoked for the
  right work and stays out of unrelated turns.
- Test instructions against a realistic fresh-context task. If the agent cannot
  find the rule, interpret it consistently, or prove completion, revise the
  placement or wording rather than adding more ambient prose.

## Host adaptation

- Use the current host's native instruction hierarchy and skill discovery.
- Treat `AGENTS.md` as shared repository guidance when the host supports it.
- Treat host-specific instruction files as adapters, not the canonical copy of
  a cross-host workflow.
- If the host cannot preview a generated report, return the Markdown or JSON
  artifact path and a concise summary.

## Output

Return:

- instruction files inspected;
- high-confidence duplication and placement findings;
- possible contradictions requiring semantic review;
- recommended moves with destination and rationale;
- instructions intentionally retained;
- edits made, if authorized;
- residual uncertainty and the next audit command.
