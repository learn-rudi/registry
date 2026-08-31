# RUDI Engineering Skills

RUDI's engineering suite is a lifecycle, not a bag of overlapping prompts. Each
skill owns one primary responsibility and composes with adjacent skills through
explicit artifacts, evidence, and authority gates.

## Lifecycle

| Phase | Primary skill | Owns | Does not own |
|---|---|---|---|
| Start | `skill:set-goal-and-execute` | Durable objective, continuation, and completion posture | Engineering task decomposition or publication |
| Discover | `skill:rudi-decision-frontier` | Unresolved areas, decision evidence, promotion readiness | Durable execution DAG or dispatch |
| Interrogate | `skill:grill-with-docs-loop` | Repo-evident domain and architecture questions with adversarial checking | Human product decisions or plan mutation |
| Compare | `skill:rudi-decision-canvas` | Visual options, structured feedback, and task-contract input | Approval or implementation authority |
| Ask | `skill:rudi-stakeholder-questionnaire` | Missing stakeholder knowledge and response evidence | Answers the stakeholder did not provide |
| Experiment | `skill:rudi-prototype` | One disposable feasibility or interaction experiment | Production implementation or proof |
| Diagnose | `skill:rudi-diagnose` | Reproduction, first incorrect state, and falsifiable root-cause evidence | Unrequested fixes or broad refactors |
| Trace | `skill:trace-feature-lineage` | End-to-end feature/data lineage through implementation and runtime boundaries | Scope approval or implementation |
| Scope | `skill:map-change-impact` | Exact paths, ordered actions, risks, and proof plan | Edits in a mapping-only request |
| Coordinate | `skill:rudi-chief-of-staff` | Authoritative DAG, promotion receipts, routing, resources, handoffs, and acceptance | Git lifecycle or specialized phase logic |
| Govern | `skill:swe-compliance-checklist` | Phase gates, red/green proof, debt, docs, review, and Definition of Done | Cross-project orchestration |
| Project to GitHub | `skill:rudi-swe-issue-loop` | Issue/PR delivery ledger and CI loop | Parent-plan dependency satisfaction in composed mode |
| Review change | `skill:rudi-code-review` | Independent Standards, Spec, and Proof verdicts | Edits or repository-wide consolidation by default |
| Review coherence | `skill:horizontal-engineering-review` | Semantic duplication, seam quality, and consolidation dispositions | Ordinary single-change review or Git cleanup |
| Red-team | `skill:repo-red-team-review` | Adversarial repository risk review | Normal implementation acceptance |
| Curate context | `skill:rudi-context-gardener` | Durable instruction placement and progressive disclosure | Runtime tools or live operational state |
| Publish | `skill:publish-task-changes` | Task-owned stage/commit and separately authorized push/PR | Merge, deploy, or cleanup without explicit authority |
| Close worktree | `skill:rudi-worktree-closeout` | Non-mutating disposition and closeout receipt | Cleanup or deletion |
| Steward fleet | `skill:rudi-repo-steward` | Repository identity, leases, status truth, and continuous fleet stewardship | Product or architecture decisions |

## Core Compositions

### Ambiguous initiative

`set-goal-and-execute` → `rudi-decision-frontier` → evidence probes →
`map-change-impact` → guarded Chief-of-Staff promotion.

### Behavior-bearing change

Chief task node → `swe-compliance-checklist` → red/green implementation →
`rudi-code-review` → focused confirmation → accepted evidence.

### GitHub delivery

Accepted task contract → `rudi-swe-issue-loop` in standalone or composed mode →
CI/review evidence → `publish-task-changes` at the explicitly requested endpoint.

### Repository closure

Accepted integration → `rudi-worktree-closeout` receipt → Repo Steward lifecycle
state. Archive eligibility and cleanup approval are not proof of cleanup.

## Authority Model

1. Conversation and discovery artifacts propose evidence.
2. Human decisions approve consequential choices.
3. Decision Frontier promotion creates proposed nodes only.
4. Chief of Staff alone owns durable execution dependencies and acceptance.
5. SWE Compliance proves implementation; Code Review independently checks
   Standards, Spec, and Proof.
6. Git operations, publication, deployment, external writes, and cleanup remain
   separate explicit authority gates.

## Selection Guide

- If the task is already precise, skip Decision Frontier and start with impact
  mapping or the appropriate implementation workflow.
- If the cause is unknown, diagnose before editing.
- If one uncertainty is expensive to debate but cheap to test, prototype it.
- If another person owns missing knowledge, send a questionnaire rather than
  guessing.
- If alternatives are hard to compare in prose, use Decision Canvas.
- If work is dependent, resumable, cross-project, or multi-agent, use Chief of
  Staff; do not create a second orchestrator.
- If work changes behavior, use SWE Compliance and independent Code Review.
- If several changes expose repeated mechanisms, run Horizontal Engineering
  Review without silently widening the current feature.
- If the user has not asked to publish, stop after verified local delivery.
