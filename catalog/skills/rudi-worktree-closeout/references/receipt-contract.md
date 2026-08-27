# Worktree Closeout Receipt Contract

Repo Steward stores one active receipt projection plus immutable version files.
The receipt records observed evidence and authorized disposition; it never
performs Git cleanup.

## Required identity and state

- `receipt_id`, `schema_version`, `version`, `creation_fingerprint`, `state`
- `repository`: configured repository ID, absolute repository identity, and
  exact worktree path
- `git`: branch or detached state, `head`, resolved `base`, `upstream`, dirty,
  staged, unstaged, untracked, conflicted, ahead, and behind state
- `task_lineage`: task or work-unit IDs that produced or accepted the work
- `agent_lineage`: agent, host, thread, attempt, or run identifiers available
  from the execution surface

Task and agent lineage remain separate fields so coordination ownership and
execution provenance can be reconciled without conflating them.
- `acceptance_reference`: acceptance, integration, artifact, or revision
  references that make the disposition reviewable
- `validation_evidence`: `command`, `outcome`, `exit_code`, `summary`, and `at`
  records for commands or inspections
- `classification`, `disposition`, and `preservation_requirements`
- `cleanup`: `eligible`, `reasons`, and `approval_reference`; the approval
  reference is explicit authorization for the exact destructive or externally
  mutating cleanup operation and is non-null only in `cleanup_approved`
- `created_at`, `updated_at`, and append-only transition `history`

Unknown counts or missing upstream metadata must remain unknown. Do not convert
them to zero or infer synchronization.

## States

- `observed`: current worktree evidence has been captured.
- `classified`: evidence supports a disposition, but no terminal retention or
  archive decision has been recorded.
- `preservation_required`: dirty, unaccepted, conflicted, or otherwise
  material evidence must remain intact.
- `retained`: the worktree is intentionally kept for active or durable use.
- `archive_eligible`: fail-closed eligibility checks pass; no cleanup occurred.
- `cleanup_pending_approval`: an exact cleanup decision is awaiting approval.
- `cleanup_approved`: an exact approval reference is recorded; no cleanup is
  performed or verified by this state.
- `blocked`: required evidence, authority, or a safe disposition is missing.

There is intentionally no cleanup-completed state. A separately authorized
mutating workflow must perform and independently verify any cleanup, using its
own evidence contract.

## Allowed transitions

```text
observed -> classified | preservation_required | blocked
classified -> preservation_required | retained | archive_eligible | blocked
preservation_required -> classified | retained | blocked
retained -> classified | blocked
archive_eligible -> cleanup_pending_approval | retained | blocked
cleanup_pending_approval -> cleanup_approved | retained | blocked
cleanup_approved -> retained | blocked
blocked -> classified | preservation_required | retained
```

Every transition requires the current receipt version and the active repository
lease. The creation-time resolved `git.base.head` remains pinned even when its
human-readable `git.base.ref` later moves. Repeating the same create request may
be idempotent; a conflicting request for an existing ID must fail.

## Cleanup eligibility

Eligibility is false when any of these conditions is present:

- dirty, staged, unstaged, untracked, or conflicted worktree evidence;
- known commits ahead of the declared base or upstream;
- missing passing validation evidence or any failed validation;
- missing `acceptance_reference`; or
- any preservation requirement.

Eligibility is necessary but not sufficient for cleanup. `archive_eligible`
does not grant authority. `cleanup_pending_approval` requests a decision, and
`cleanup_approved` requires a recorded approval reference scoped to the exact
repository, worktree, and operation.

## Persistence invariants

- Version files are immutable and conflicting bytes for the same version are
  rejected.
- The active projection must be byte-identical to its referenced immutable
  version and advances only through a valid version transition.
- An exact semantic retry after interruption between immutable version creation
  and active projection advancement repairs the projection without replacing
  immutable evidence; other collisions fail closed.
- Receipt fields are validated again when read from local state.
- Repository contents, credentials, lease tokens, and secret values are never
  copied into the receipt.
- Redaction applies to free-text summaries before persistence.
