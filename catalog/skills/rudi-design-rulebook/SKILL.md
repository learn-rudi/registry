---
name: RUDI Design Rulebook
description: Audit or build an interface, slide deck, or web page against a two-part rulebook. Part one is twenty visual and copy tells that mark a design as machine-generated, such as gradient hero text, Lucide icon sprinkles, glass cards, em dashes, and the Space Grotesk plus Instrument Serif pairing. Part two is twenty-one reconciled UX principles (Hick, Fitts, Jakob, Miller, Doherty, Von Restorff, peak-end, Zeigarnik, Tesler, Postel, and more) turned into checkable rules. Use when a user asks whether something looks AI-generated or vibe-coded, wants a design, deck, landing page, or app screen reviewed for generic patterns, asks which UX principles to apply, or wants a new build to avoid default AI aesthetics.
version: 1.0.1
category: web
icon: 📐
tags:
  - design
  - ux
  - ui
  - audit
  - slides
  - landing-page
  - html
  - css
  - copy
  - anti-pattern
  - laws-of-ux
  - capability:review
---

# RUDI Design Rulebook

Two lists, one judgment. The first list names the patterns that make a page,
deck, or app read as machine-generated. The second list turns the source's UX
laws and reconciled practical principles into checks for the person using the
layout. Neither list is a score card. Every item is a question about whether a
choice carries function.

The operating rule: **a pattern stays when it does a job and goes when it is
decoration.** A scrim gradient that keeps text legible over a photograph does a
job. A purple-to-blue gradient behind a headline does not.

## Included resources

- `references/generic-ui-tells.md`: the twenty tells, each with the rule, why
  it reads as generated, how to detect it, and the fix.
- `references/laws-of-ux.md`: the twenty-one reconciled principles, each with the rule, the
  mechanism, where it applies, a check question, and the fix.
- `scripts/audit-ui-tells.mjs`: deterministic scanner for the tells that can
  be found in HTML, CSS, JS, and copy files. It reports evidence with a
  severity, not verdicts.

Resolve all relative paths from the directory containing this `SKILL.md`.

## Modes

### Audit an existing design

1. Confirm the target: a directory, a set of files, or a rendered page. If the
   target is only a live URL, save its HTML and CSS locally first or inspect it
   with the host's browser tooling and record what you saw.
2. Run the scanner:

   ```bash
   node <skill-dir>/scripts/audit-ui-tells.mjs --root <path> --format markdown
   ```

   Use `--format json` when another step consumes the result. Use
   `--fail-on strong` in a build or CI step to block on unambiguous tells.
   Use `--ignore <dir,dir>` to add directories to the default skip list.
   Directory scans skip dependency lockfiles. A single em dash does not fire;
   repeated em dashes in one prose file are strong. Actual Lucide use is a
   review finding because the rendered context determines whether it is filler.
3. Walk the manual tells the scanner cannot see. Uniform spacing, untouched
   component-library defaults, icon-box trios, and a badge above the headline
   need a look at the rendered page. Use `references/generic-ui-tells.md`.
4. Walk the laws. For each screen or slide, answer the check questions in
   `references/laws-of-ux.md`. Record only the misses, each with the change
   that would fix it.
5. Report using the format below. Keep scanner findings separate from your
   own judgment. Never present a heuristic hit as a confirmed defect.

### Build a new design

1. Read both references before choosing type, color, or layout.
2. Choose a typeface pairing and a palette that are not on the tells list.
   Decide the primary action, the chunking, and the progress signal before
   styling anything.
3. Apply the ten working rules below while building.
4. Run the scanner on the output before delivery. Resolve every strong finding
   by fixing it or documenting the functional job that justifies keeping it.
5. State any tell you kept on purpose and the job it does.

## Ten working rules

Condensed from the laws for day-to-day use. The full set with mechanisms is in
the reference.

1. One idea per slide, one primary action per screen.
2. Chunk to three to five items. Group by proximity and shared shape first; use
   a boundary or connector only when the relationship would otherwise be unclear.
3. Essentials first, memorable last.
4. Familiar patterns over clever ones.
5. Big targets, placed close to where the hand already is.
6. Show progress with counters, section markers, or numbered steps.
7. Nothing slower than a blink. Interactions respond under 400 ms.
8. Simple by default, complexity on request.
9. Prevent errors, then forgive them.
10. Give every flow a length.

## Report format

```markdown
## Design rulebook audit: <target>

### Scanner findings
| Tell | Severity | File:line | Evidence | Fix |
|---|---|---|---|---|

### Manual findings
- <tell or law>: <what was observed>. Fix: <recommended change>.

### Kept on purpose
- <pattern>: <the job it does>.

### Laws review
- <law> on <screen or slide>: <the miss>. Fix: <recommended change>.
```

## Boundaries

- The scanner is heuristic. `strong` means the pattern is unambiguous in the
  source. `review` means a person must look at the rendered result.
- Do not rewrite copy, remove components, or change a design system without
  the user's approval. Report first.
- Carry no brand, client, or project defaults in this skill. A project's own
  design system wins over this rulebook where they conflict, and the conflict
  belongs in the report.
- The contrast check reads hex colors declared in the same CSS rule. It does
  not replace a rendered accessibility check.
- The copy checks read English. Treat buzzword hits in other languages or in
  quoted source material as noise.
- Strong findings are source-level evidence of the named pattern, not proof
  that a design is bad. Review findings always require rendered context.

## Sources

The tells list is adapted from [a short video by @millee.md on
TikTok](https://www.tiktok.com/t/ZP8c22okY/). The laws list is adapted from [a
short video by @adam_ha_yes on
TikTok](https://www.tiktok.com/t/ZP8cYccuT/). The supplied extraction and
screenshot establish the source inventory. The reference files record the
Inter caption correction, the duplicated Postel overlay label, and the drift
between the spoken goal-gradient rule and the overlay's Pareto principle.
Operational mechanisms and fixes are the rulebook's transparent interpretation
of that source material.
