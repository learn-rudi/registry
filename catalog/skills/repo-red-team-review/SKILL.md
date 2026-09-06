---
name: RUDI Repo Red-Team Review
description: Run RUDI evidence-backed LLM-led red-team reviews of software repositories. Use when the user asks to red-team a repo, perform an adversarial security review, map attack surfaces, threat-model implementation risks, review auth/tenant isolation/webhooks/billing/LLM tools/MCP surfaces, or run a goal-driven security pass with checklist documentation and optional subagents.
version: 1.0.1
category: code
tags:
  - rudi
  - security
  - red-team
  - threat-modeling
  - code-review
  - auth
  - webhooks
  - llm-tools
  - capability:review
---

# RUDI Repo Red-Team Review

## Purpose

Perform a grounded adversarial review of a software repository. Build repo understanding first, map attack surfaces and trust boundaries, then test abuse hypotheses with evidence.

Do not make security claims from vibes. Every finding must be tied to code, config, a command, a test, or an explicitly stated unverified assumption.

## Default Mode

Use a single lead agent by default.

Use subagents only when:
- the repo is large
- the review spans multiple independent surfaces
- high-severity findings need independent QA
- the user explicitly asks for multi-agent review

The lead agent always owns scope, checklist, final severity, final report, and goal completion.

Do not ask multiple agents to generally "red-team the repo." Give subagents bounded tasks.

## Rules Of Engagement

Before active probing, establish or infer:

- target environment: local, staging, production, or code-only
- allowed actions
- forbidden destructive actions
- whether external network calls are allowed
- whether test data may be created
- whether secrets/config files may be inspected by name only

Never print secrets, tokens, connection strings, private keys, or credential values. Read config structure, not secret values.

Avoid destructive tests, production writes, spam, real payment actions, real webhook abuse, or external side effects unless explicitly authorized.

## Goal Mode

When the user asks to run this as a goal, define the objective as:

> Produce an evidence-backed red-team review of this repo, including attack-surface map, verified findings, rejected hypotheses, completed checklist, skipped checks, residual risk, and recommended next probes.

Loop until every scoped surface is reviewed, skipped, or explicitly out of scope.

## Review Loop

For each surface:

1. Select the next highest-risk surface.
2. Read only the files needed for that surface.
3. Document entrypoints and trust boundaries.
4. Create adversarial hypotheses.
5. Verify hypotheses using code evidence, tests, commands, or explicit non-verification.
6. Record findings, rejected hypotheses, skipped checks, and open questions.
7. Update the checklist.
8. Send high-risk or uncertain findings to QA/skeptic review when subagents are available.
9. Continue until scoped surfaces are complete.

## Orientation Order

Start with repo grounding before adversarial review.

### 1. Load instructions

Look for:

- `AGENTS.md`
- repo-local `AGENTS.md`
- `CLAUDE.md`
- `CONTEXT.md`
- `README*`
- `ARCHITECTURE*`
- `CHANGELOG*`
- `.cursor/rules`
- `.github/copilot-instructions.md`
- ADR indexes or major ADRs

### 2. Check worktree state

Run:

```bash
git status --short
git branch --show-current
git log -5 --oneline
```

Use this to avoid confusing active user changes with baseline code.

### 3. Build a shallow repo map

Use a two-layer tree, excluding generated and noisy folders:

```bash
find . -maxdepth 2 -type d \
  -not -path './.git*' \
  -not -path './node_modules*' \
  -not -path './*/node_modules*' \
  -not -path './dist*' \
  -not -path './*/dist*' \
  -not -path './.next*' \
  -not -path './*/.next*' \
  -not -path './coverage*' \
  -not -path './*/coverage*' \
  | sort
```

### 4. Find manifests and configs

Search for:

```bash
rg --files \
  -g 'package.json' \
  -g 'pnpm-workspace.yaml' \
  -g 'turbo.json' \
  -g 'tsconfig*.json' \
  -g 'docker-compose*' \
  -g 'Dockerfile*' \
  -g '.env.example' \
  -g '.github/workflows/*' \
  -g 'vercel.json' \
  -g 'railway*' \
  -g 'openapi*'
```

### 5. Discover entrypoints

Look for:

- API route registries
- auth middleware
- role/permission checks
- web middleware
- webhook handlers
- MCP/tool servers
- LLM tool callers
- background jobs
- CLI commands
- upload/file handlers
- database migrations
- generated API schemas
- deployment config
- GitHub Actions

## Attack-Surface Map

Build a working table:

```markdown
| Surface | Entrypoint | Caller | Auth | Input | Sensitive Action/Data | Trust Boundary | Files |
|---------|------------|--------|------|-------|-----------------------|----------------|-------|
```

Update this table as the review progresses.

## High-Risk Review Areas

Prioritize these surfaces when present:

- authentication and session handling
- role and permission checks
- tenant/workspace/project ownership
- admin/internal routes
- public/demo routes
- billing and subscription flows
- Stripe or payment webhooks
- Clerk/Auth0/OAuth callbacks
- file upload and parsing
- SSRF-capable fetch/proxy/image routes
- database repositories and migrations
- LLM prompts, tools, agents, MCP servers
- OpenAPI/tool exposure
- CORS and allowed origins
- logging and client-log ingestion
- rate limits and abuse controls
- deployment and production fallback behavior

## Hypothesis Format

For each surface, write adversarial hypotheses like:

```markdown
- Can unauthenticated users call this?
- Can user A read or mutate user B's data?
- Can a public/demo route reach private data?
- Can webhook state be changed without signature validation?
- Can billing state be forged client-side?
- Can an LLM/tool call perform privileged backend actions?
- Can user input become SQL, path, shell, prompt, SSRF, or HTML injection?
- Can missing production env vars disable security?
- Would failures be visible in logs/metrics?
```

## Finding Ledger

Maintain a finding ledger:

```markdown
| ID | Surface | Hypothesis | Status | Evidence | Severity | Next Step |
|----|---------|------------|--------|----------|----------|-----------|
| R1 | Auth middleware | Missing auth fallback may allow access | Verified / Rejected / Needs test | file:line | High | Add regression test |
```

Statuses:

- `Verified`
- `Rejected`
- `Needs test`
- `Out of scope`
- `Skipped`

Do not report `Needs test` as a confirmed vulnerability.

## Severity Guidance

Use practical severity:

- `Critical`: likely unauthorized data access, account takeover, payment abuse, RCE, secret exposure, or cross-tenant write in realistic conditions.
- `High`: strong exploit path with meaningful data/action impact, but requiring some precondition.
- `Medium`: real weakness with limited impact, partial reachability, or meaningful defense gap.
- `Low`: hardening issue, unclear exploitability, limited metadata exposure, or weak operational signal.
- `Info`: notable design concern without demonstrated security impact.

Severity must consider reachability, environment, auth requirements, blast radius, and exploit preconditions.

## QA / Skeptic Review

Use a QA/skeptic subagent for high or critical findings when possible.

The QA agent should check:

- Does the evidence prove the claim?
- Is the code reachable?
- Is this production behavior or only local/dev behavior?
- Is auth/config being interpreted correctly?
- Is severity overstated?
- Is there a reproduction path?
- Is there a simpler benign explanation?
- Are there missing tests?

The QA agent may downgrade, reject, or request more evidence.

## Conditional Review Detail

Read [review roles and the surface checklist](references/review-checklists.md)
when assigning bounded subagents or planning the surface-specific review checks.
Complete applicable items and record evidence-backed reasons for skipped items;
do not run probes outside the rules of engagement.

## Final Report Format

Return:

```markdown
# Red-Team Review

## Scope

## Executive Summary

## Attack-Surface Map

## Verified Findings

### R1. Title
- Severity:
- Surface:
- Evidence:
- Impact:
- Reproduction or reasoning:
- Recommended fix:
- Test coverage needed:

## Rejected Hypotheses

## Skipped Checks

## Checklist

## Residual Risk

## Recommended Next Probes
```

Findings must lead with the highest severity first.

## Exit Criteria

The review is complete only when:

- every scoped surface is marked reviewed, skipped, or out of scope
- every high/critical finding has evidence or is downgraded
- skipped checks explain why they were skipped
- checklist is updated
- final report includes residual risk
- final recommendations are actionable
