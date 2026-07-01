---
name: RUDI SWE Issue Loop
description: Create and execute a GitHub issue and PR ledger for RUDI or Codex engineering work using the SWE checklist skill, including issue creation, phase-gated checklists, branches, commits, pull requests, CI verification, merges, and branch cleanup.
version: 1.0.0
category: coding
icon: 🔁
tags: [rudi, github, swe, issues, pull-requests, ci, checklist]
---

# RUDI SWE Issue Loop

## Purpose

Run engineering work as a durable issue ledger instead of a one-off chat. Each issue gets an explicit SWE checklist, a scoped branch, proof commands, a linked PR, and closure notes that survive outside the current agent thread.

Use this skill as the orchestration layer. Delegate SWE phase content to `swe-compliance-checklist`; do not copy the SWE Operating Manual into this skill.

## Required Companion Skill

Before creating a checklist or executing a fix, load and follow `swe-compliance-checklist`.

If that skill is unavailable, stop and say the SWE checklist skill is missing. Do not silently fall back to an informal checklist unless the user explicitly permits a temporary fallback.

## Capability Discovery

Prefer available structured tools first, then local CLIs:

- Use the GitHub app/MCP when available for repo, issue, PR, and review metadata.
- Use `gh` when the GitHub app cannot perform a required action.
- Use RUDI only for local capability discovery, stack tools, secrets-mediated integrations, daemon/router health, artifacts, or package/index operations.
- Never print secrets, tokens, connection strings, private keys, or credential values.

Discover state instead of assuming:

```bash
git status -sb
git remote -v
gh repo view --json nameWithOwner,visibility,defaultBranchRef
rudi list stacks --json
rudi daemon status --json
```

Only run RUDI commands that are relevant to the issue. Do not treat RUDI as the agent runner unless the user explicitly asks for that.

## Safety Rules

Confirm before:

- creating public issues that disclose private implementation details
- changing repo visibility
- deleting remote branches outside the issue branch
- running destructive commands or production writes
- touching secrets, tokens, or live publishing credentials

Preserve user work:

- Read `git status -sb` before edits.
- Do not revert unrelated local changes.
- If the worktree is dirty, isolate the issue branch without losing user changes. Use a narrow stash only when needed and label it clearly.
- Keep generated artifacts, personal workflow files, and content inventory changes out of code fixes unless they are explicitly in scope.

## Issue Creation

For each distinct defect or remediation item, create one GitHub issue in the repo that owns the fix. Use private repos for private org implementation details unless the user explicitly chooses public.

Issue body shape:

```markdown
## Summary

## Evidence

## Affected Area

## Invariants

## SWE Checklist

- [ ] Phase 0: Baseline and manual lookup
- [ ] Phase 1: Scope lock
- [ ] Phase 2: Red tests
- [ ] Phase 3: Implementation
- [ ] Phase 4: Green tests and refactor
- [ ] Phase 5: Full verification
- [ ] Phase 6: Docs, contracts, and closure

## Acceptance Criteria

## Notes / Out Of Scope
```

Immediately create or link the full SWE checklist file required by `swe-compliance-checklist`, usually under the repo's established docs/compliance folder. Comment on the issue with the checklist path.

## Execution Loop

For each issue, complete the loop before moving to the next issue unless the user asks for parallel triage.

1. Sync local main/default branch with the remote.
2. Create a branch named `fix/<issue-number>-<short-slug>` or `chore/<issue-number>-<short-slug>`.
3. Run Phase 0 and Phase 1 from `swe-compliance-checklist`; update the issue with scope, risks, and intended files.
4. Add one behavior-level red test when automated testing is practical. Run it and record the failing command and expected failure.
5. Implement the smallest scoped fix that can pass the test.
6. Run the unchanged red command and record the green result.
7. Refactor only while relevant tests remain green.
8. Run Phase 5 verification: targeted tests, relevant full suite, build/typecheck/lint, JS/TS debt scan when applicable, and live smoke checks when applicable.
9. Update docs/contracts/checklists only when behavior or usage changed.
10. Commit with an issue reference, for example `Fix YouTube token readiness (#6)` or include `Refs #6` in the body.
11. Push the branch and open a PR that includes `Fixes #<issue>`, the SWE checklist link, commands run, accepted debt, and smoke evidence.
12. Wait for required CI/review state. If checks fail, use the failing logs as the next issue-loop input and continue on the same branch unless the failure is unrelated.
13. Merge only when the issue acceptance criteria and Definition of Done are satisfied.
14. Delete the remote and local issue branch after merge when branch cleanup is in scope.
15. Pull the updated default branch locally and confirm final repo state.

## PR Body Shape

```markdown
## Summary

## Issue

Fixes #<issue-number>

## SWE Checklist

<path or link>

## Proof

- Red:
- Green:
- Build/typecheck/lint:
- Debt scan:
- Smoke:

## Accepted Debt

## Branch Cleanup
```

## Goal Mode

When the user says to "loop through all issues until green" or similar, define the goal as:

> Resolve each scoped GitHub issue through the SWE checklist, PR, CI, merge, and branch cleanup until every issue is closed or explicitly blocked with recorded residual risk.

Continue issue by issue. Do not mark the goal complete until all scoped issues are closed, merged, or intentionally deferred with a documented reason.

## Final Report

Finish with:

- issues created or resolved
- PRs opened or merged
- branches deleted
- local repo states
- commands that prove green
- accepted debt or blockers
