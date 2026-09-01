---
name: rudi-decision-frontier
description: Resolve the exact product, architecture, workflow, or delivery decisions that separate an ambiguous initiative from execution-ready work, then promote an approved decision snapshot into proposed Chief-of-Staff plan nodes. Use when important choices, stakeholder knowledge, feasibility evidence, or scope boundaries are still unresolved; do not use for a small task whose contract is already stable or to dispatch implementation.
---

# RUDI Decision Frontier

Turn ambiguity into an accepted task contract without creating a second
orchestrator. Discovery may use conversation and temporary artifacts; durable
promotion belongs to the Chief-of-Staff plan.

Read [the frontier contract](references/frontier-contract.md) before authoring
durable frontier state or promotion input.

## Select The Mode

- **Conversational:** use for a bounded decision that can finish in the current
  exchange. Return the decision record and task contract without creating
  durable state unless the user asks.
- **Durable:** use for resumable, dependent, high-risk, or multi-project work.
  Compose with `rudi-chief-of-staff`; its `plan.json` remains authoritative.

## Workflow

1. State the initiative objective, current reality, non-goals, constraints, and
   what would count as execution-ready.
2. Build an unresolved-area backlog. Phrase every area as a decision whose
   answer could change scope, architecture, risk, order, or acceptance.
3. Separate facts, assumptions, recommendations, and human decisions. A
   recommendation is never approval.
4. Choose the smallest evidence probe for each area:
   - `grill-with-docs-loop` for repository-evident domain or architecture
     questions;
   - `rudi-stakeholder-questionnaire` for knowledge held by another person;
   - `rudi-decision-canvas` when options need visual comparison and feedback;
   - `rudi-prototype` for one feasibility or interaction uncertainty;
   - `rudi-diagnose` for unexplained observed behavior.
5. Record a decision only when its evidence and owner are clear. Preserve
   `unknown`, rejected, deferred, and out-of-scope outcomes explicitly. In
   durable state, set each new area's and decision's
   `introducedAtFrontierRevision` to the revision where it first appears and
   preserve that value through later edits.
6. Close the frontier only when every required area is resolved, explicitly
   deferred with approval, or accepted as out of scope.
7. Run `map-change-impact` against the accepted choices. Convert the result
   into proposed task contracts with objective, allowed scope, dependencies,
   acceptance criteria, verification, deliverables, risk, and authority gates.
8. In durable mode, use the Chief-of-Staff `promote` operation. Bind the exact
   plan revision, frontier revision, every terminal area and decision ID with
   its exact digest, human promotion approval, and separate implementation
   authorization.
9. After promotion, let ordinary dependency, readiness, resource, review, and
   dispatch gates operate. Promotion does not make a node ready or running.

## Promotion Readiness

Before promotion, confirm all of the following:

- the initiative objective is stable enough to test;
- no required unresolved area remains open;
- every decision record is terminal and every resolved area points to an
  accepted decision;
- accepted deferrals and out-of-scope areas have explicit approval evidence;
- the impact map reflects the accepted choices and current repository state;
- task nodes begin as `proposed` with no reconciliation history;
- human promotion approval and implementation authorization are both present
  and distinct; and
- publish, deploy, destructive, secret, and external-system permissions remain
  separate unless the user granted them explicitly.

## Authority Boundaries

- This skill owns discovery method and promotion readiness, not orchestration.
- `rudi-chief-of-staff` owns the durable DAG and accepted evidence.
- Workers and artifacts propose evidence; only the manager accepts decisions
  and mutates the plan.
- A Decision Canvas recommendation, prototype verdict, questionnaire response,
  GitHub issue, or passing test is evidence, not human approval by itself.
- Promotion creates proposed nodes only. It never dispatches work, creates
  issues, commits, publishes, deploys, or calls external systems.
- When approval or implementation authority is missing, return the frontier and
  stop at the decision boundary.

## Host Adaptation

Use the current host's planning, artifact-preview, and repository-inspection
capabilities. Keep host task IDs, agent IDs, local paths, and invocation syntax
out of portable decision records. If durable project-plan tooling is
unavailable, return a validated conversational task contract and state that
promotion remains pending; do not invent another ledger.

## Output

Return:

- initiative objective and readiness definition;
- unresolved areas with status and evidence gap;
- decision records, recommendations, approval evidence, and revision;
- probes performed and artifacts produced;
- final impact map and proposed node contracts;
- promotion receipt or exact reason promotion is blocked; and
- authority granted, withheld, or still required.
