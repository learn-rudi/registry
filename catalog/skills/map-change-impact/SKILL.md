---
name: Map Change Impact
description: Map the exact repository paths a proposed feature, fix, refactor, migration, or remediation will affect and print the ordered actions, risks, dependencies, and verification needed before implementation. Use when a user asks what file paths will be impacted, what needs to change, what has already been implemented, what remains to do, what the blast radius is, or wants an implementation-ready change map without starting the edits.
version: 1.1.1
category: code
tags:
  - rudi
  - impact-analysis
  - scope
  - repository
  - planning
  - verification
  - capability:review
---

# Map Change Impact

Produce a concise, evidence-backed answer to: **What file paths will be impacted, and what actions need to be taken?** Make the result easy to print, scan, and hand to an implementer.

## Operating rules

- Keep the investigation read-only unless the user explicitly asks to implement. If the user asks for both mapping and implementation, print the initial map before editing and update it when discovery changes the scope.
- Follow active repository instructions and explicit user constraints first.
- Inspect the actual repository. Do not infer a path from naming alone; verify it through imports, callers, routes, schemas, manifests, generators, tests, or documentation.
- Check the dirty worktree before planning changes. Preserve unrelated user work and call out overlap with a proposed path.
- Distinguish code that is already implemented, code that must change, new files, generated artifacts, and inspect-only or out-of-scope files.
- Identify each generated file's source of truth and regeneration command. Do not recommend hand-editing generated output unless repository instructions require it.
- Keep secrets and private data out of commands and output.
- Prefer the smallest complete blast radius. Do not replace evidence with a speculative repository tree dump.

## Evidence levels

Label every path with one of these levels:

- **Confirmed**: Direct code, configuration, test, generated-file, or runtime wiring proves the impact.
- **Likely**: Repository structure strongly suggests impact, but a dependency or decision remains unverified.
- **Conditional**: The path changes only if a named product, architecture, migration, or compatibility choice is selected.

Never present Likely or Conditional paths as committed scope.

## Workflow

1. **Frame the outcome**
   - Restate the requested behavior, current implementation state, non-goals, and relevant constraints.
   - Record assumptions only when they let the investigation continue safely.

2. **Orient in the repository**
   - Resolve the repository root and read applicable instruction files.
   - Inspect version-control status, package manifests, build commands, and relevant documentation.
   - Start with `rg --files` and targeted `rg` searches; use slower or broader discovery only when necessary.

3. **Trace the blast radius**
   - Start from the observable entry point: page, command, route, API, job, schema, component, or failing behavior.
   - Trace contracts and types, implementation, consumers, persistence, configuration, tests, documentation, and generated artifacts.
   - Follow the reverse path for callers and downstream consumers so shared-contract changes are not missed.
   - Inspect adjacent or legacy implementations, but mark them out of scope when they are not actually wired.

4. **Classify exact paths**
   - Use the actions `Inspect`, `Modify`, `Add`, `Delete`, or `Regenerate`.
   - Print exact file paths when they can be resolved. Use a directory or glob only for genuinely unresolved or repeated outputs, and explain why.
   - Use clickable local-file links when the host supports them; otherwise use repository-relative paths consistently.
   - Group required changes first. List generated, Conditional, inspect-only, already-correct, and out-of-scope paths separately when they materially clarify the plan.

5. **Order the work**
   - Sequence prerequisite decisions before contracts, contracts before implementations, implementations before consumers, and behavior before tests, generated output, documentation, and final verification.
   - Name dependencies, collision points, migrations, compatibility steps, and decisions that could add or remove paths.

6. **Define proof**
   - Derive verification commands from repository scripts and instructions rather than guessing.
   - Include focused tests, full relevant tests, validation, build or type checks, generated-index checks, debt scans, and smoke checks in proportion to risk.
   - State what each command proves and any gap that remains unverified.

## Decision-bound mapping

When composed with `rudi-decision-frontier`, bind the map to the accepted
decision IDs and frontier revision it represents. Do not merge mutually
exclusive options into one committed blast radius. Map unresolved alternatives
as Conditional paths, explain which decision activates each path, and rerun the
map after the frontier closes. The final map becomes promotion evidence; it
does not itself authorize implementation.

## Optional composition

- Use a feature-location skill for a narrow entry-point search when available.
- Use a feature-lineage skill when the impact crosses multiple runtime or data layers.
- Use an engineering-compliance checklist only when the user wants the map converted into an executable, phase-gated implementation plan.

Keep this skill usable on its own when those helpers are unavailable.

## Required output

Use this structure unless the user requests another format:

```markdown
# Change-impact map

## Requested outcome

- Change:
- Current implementation state:
- Scope and non-goals:
- Overall confidence:

## Impacted paths

| Priority | Path | Action | Why | Evidence | Risk |
|----------|------|--------|-----|----------|------|
| P0 | `path/to/file` | Modify | Observable behavior or contract affected | Confirmed | Medium |

## Ordered actions

1. **Action name** — exact work, dependencies, and completion condition.
2. **Action name** — exact work, dependencies, and completion condition.

## Verification plan

| Check | Command or method | What it proves |
|-------|-------------------|----------------|

## Assumptions and open questions

- Assumption, evidence gap, or decision that could change the path list.

## Already implemented or unchanged

- Paths inspected that need no edit, when relevant.

## Out of scope

- Adjacent files or systems deliberately excluded and why.
```

Omit empty optional sections, but always include impacted paths, ordered actions, verification, and assumptions. If no file can be named with confidence, say what was searched, why the path remains unresolved, and the next read-only step needed.

## Stop condition

Stop when the required and Conditional paths are separated, the work is ordered, generated artifacts and dirty-worktree collisions are accounted for, and every material action has a verification method. Do not begin implementation from a planning-only request.
