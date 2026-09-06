---
name: RUDI Prototype
description: Build a deliberately disposable logic, interaction, or integration prototype to answer one named uncertainty before committing to production architecture. Use when feasibility, workflow shape, UX behavior, or a provider boundary cannot be decided cheaply from existing evidence; do not use for production-ready implementation, migrations, or general feature delivery.
category: code
tags:
  - capability:prototype
version: 1.0.1
---

# RUDI Prototype

A prototype buys evidence. It is throwaway by default, scoped to one question,
and judged by what it teaches rather than how complete it looks.

Record the result with [the prototype verdict](references/prototype-verdict.md).

## Choose The Prototype Type

- **Logic:** prove an algorithm, transformation, state transition, or data
  contract with minimal fixtures.
- **Interaction:** prove a user flow, information hierarchy, or interface
  behavior without pretending the backend is complete.
- **Integration:** prove authentication shape, provider capability, latency,
  payloads, or failure behavior at one boundary.

If several questions are coupled, split them or state why one prototype is the
smallest honest experiment.

## Workflow

1. Write the single question, decision it informs, current evidence, timebox,
   success signal, failure signal, and stop condition.
2. Choose the cheapest environment that can answer it. Prefer a separate
   scratch path or isolated worktree and name every production system it must
   not touch.
3. Define the disposal plan before building. Prototype code is not a hidden
   first draft of production.
4. Use synthetic or minimized data. Avoid production secrets, personal data,
   irreversible writes, durable persistence, broad permissions, and unattended
   provider calls by default.
5. Implement only the path needed to expose the uncertainty. Mark mocked,
   simulated, hard-coded, skipped, and unsafe-for-production behavior plainly.
6. Exercise both the expected path and the failure most likely to invalidate
   the concept. Capture measurements, screenshots, payload shapes, or traces
   only when they answer the named question.
7. Stop at the timebox or as soon as the evidence decides the question. Do not
   polish unrelated surfaces.
8. Record a verdict: `discard`, `extend experiment`, `adopt concept`, or
   `inconclusive`. State what evidence supports it and what remains unknown.
9. Delete or quarantine temporary state when authorized. Preserve a small
   evidence artifact; never silently promote prototype code into production.
10. If the concept is adopted, return to Decision Frontier, map the real change
    impact, and create a production task contract with SWE compliance.

## Quality Rules

- The prototype may be rough; the experiment must be precise.
- Keep mocked behavior distinguishable from observed provider behavior.
- Never use a demo PIN, hard-coded credential, permissive CORS, disabled auth,
  or bypassed validation as a production security claim.
- Measure realistic workload shape when performance is the question.
- Record environment, dependency versions, and source revision when they could
  change the result.

## Authority Boundaries

- Authorization to prototype does not authorize production deployment,
  persistent data mutation, account creation, paid usage, secrets access,
  publication, or reuse as production code.
- Request confirmation before externally visible or billable experiments.
- Do not commit, publish, or merge prototype code unless the user explicitly
  asks to preserve it in version control.
- When cleanup is destructive or evidence may still matter, report the disposal
  candidate and request direction instead of deleting it.

## Host Adaptation

Use the current host's scratch directories, worktrees, browser previews,
visualization, test tools, or installed RUDI capabilities. Keep personal paths
and machine-specific defaults out of the portable verdict. If the required
provider or device is unavailable, build the smallest simulation that exposes
what remains unproved and label the verdict accordingly.

## Output

Return the question, type, timebox, source revision, artifact paths, real versus
mocked behavior, evidence, verdict, production implications, disposal status,
and remaining decisions.
