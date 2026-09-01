# Decision Frontier Contract

## Durable Terms

- **Unresolved area:** a question that can materially change execution.
- **Decision record:** a proposed, accepted, rejected, or superseded resolution.
- **Decision frontier:** the current boundary between resolved and unresolved
  initiative knowledge.
- **Promotion:** guarded conversion of one accepted frontier snapshot into
  proposed execution nodes.

## Schema-v2 State

A schema-v2 Chief-of-Staff plan adds `decisionFrontier` while preserving the
existing node, handoff, resource, review, and run contracts.

Each area records `id`, `question`, `status`, `resolution`, `decisionIds`,
`approvalRef`, `decidedAt`, and `introducedAtFrontierRevision`. Valid statuses
are `open`, `resolved`, `accepted_deferral`, and `out_of_scope`.

Each decision records `id`, `question`, `recommendation`, `resolution`,
`status`, `approvalRef`, `decidedAt`, and `introducedAtFrontierRevision`. A
`proposed` recommendation has no approval or resolution. Terminal decisions
preserve the human approval reference and canonical UTC timestamp.

Set `introducedAtFrontierRevision` to the positive integer frontier revision
where the record first appears, and preserve that value through later edits.
For compatibility with schema-v2 plans created before this field existed, a
missing `introducedAtFrontierRevision` is treated as revision 1. New or edited
durable state should always write the field explicitly.

## Promotion Input

Promotion input is untrusted. It must bind:

- `projectId`, `runId`, and a unique `promotionId`;
- current expected plan and frontier revisions;
- every terminal area outcome and decision record, using lowercase SHA-256
  digests of the exact stored records;
- a promotion approval reference;
- a distinct implementation authorization reference;
- a canonical UTC promotion timestamp; and
- one or more complete nodes beginning in `proposed` with empty reconciliation
  history.

The operation serializes plan writers, re-reads current state while holding the
lock, and validates the entire candidate before replacing the source file. The
receipt includes the complete source-snapshot digest. Exact replay returns the
existing receipt. Reusing a promotion ID with different input or racing a stale
revision fails closed without state loss.

## Non-Authority

Promotion is not readiness, dispatch, issue creation, commit authority,
publication, deployment, destructive approval, secret access, or external
system consent. Those remain ordinary downstream gates.
