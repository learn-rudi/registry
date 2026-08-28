# Repo Steward

Repo Steward is a local MCP stack for turning one directory path into a safely
observed fleet of nested Git worktrees. It discovers repositories again on
every stewardship run, reports their state, optionally fetches remote metadata
when root policy allows it, grants one bounded worker lease per repository,
and records a durable action and verification ledger.
It also records immutable, versioned worktree-closeout receipts with task and
agent lineage, validation evidence, preservation requirements, disposition,
and fail-closed cleanup eligibility.

The stack never stages, commits, pushes, merges, resets, or cleans. GitHub
issues and pull requests are also outside this stack; use `stack:github` under
the related operator skill when those actions are authorized.
Closeout approval states record authority only; the stack never deletes,
archives, moves, prunes, retires, or attests cleanup of a worktree.

## One-path flow

A user can say:

> Steward every Git repository under `/workspace/RUDI`.

The operator calls `repo_steward_enroll_root` once with that absolute path.
Enrollment is stored beneath `$RUDI_HOME/state/repo-steward`, and the response
immediately identifies the root worktree and every nested worktree. Later
preflight, discovery, fleet, status, lease, and ledger calls rediscover the
subtree, so repositories created by other agents appear automatically.

Discovery is deterministic and bounded. It does not follow symlinks or descend
into `.git`, `node_modules`, `.venv`, `venv`, `.cache`, `.rudi`, Python cache,
pytest, mypy, or tox directories. The default maximum depth is 12 and the hard
maximum is 32. At most 100,000 directories and 1,000 repositories are accepted
per root discovery.

Repository IDs remain stable while the root ID and relative path remain the
same. The root worktree is `<root-id>--root`; a child such as `apps/registry`
is `<root-id>--apps--registry`.

## Optional external configuration

Local enrollment is the normal user path. Deployments can also set
`REPO_STEWARD_CONFIG_PATH` to an absolute JSON file containing explicit
repositories, discovery roots, or both:

```bash
export REPO_STEWARD_CONFIG_PATH=/workspace/config/repo-steward.json
```

```json
{
  "schemaVersion": 1,
  "roots": [
    {
      "id": "rudi",
      "path": "/workspace/RUDI",
      "fetchAllowed": false,
      "maxDepth": 12
    }
  ],
  "repositories": [
    {
      "id": "primary-app",
      "path": "/workspace/primary-app",
      "fetchAllowed": false
    }
  ]
}
```

Explicit repository paths must resolve to exact Git top-level directories.
Root paths must be real directories and cannot overlap another configured or
enrolled root. Duplicate IDs, duplicate paths, unknown fields, and
unconfigured repositories are rejected. `fetchAllowed` defaults to `false`.

Local state is written beneath `$RUDI_HOME/state/repo-steward`. No credentials
or repository contents are copied into the ledger. Remote URLs are returned
without embedded credentials, and token-like text in summaries is redacted.

## Tools

- `repo_steward_preflight` validates configuration, Git availability, and the
  local state directory.
- `repo_steward_enroll_root` persistently enrolls one absolute directory path
  and immediately returns its discovered Git worktrees.
- `repo_steward_discover_repositories` rediscovers configured roots without
  reading repository file contents or changing Git state.
- `repo_steward_scan_fleet` scans every configured repository and can perform
  an explicit policy-permitted `git fetch --prune` first.
- `repo_steward_get_status` returns one repository's branch, upstream,
  divergence, worktree classifications, and safe remote identity.
- `repo_steward_acquire_lease` grants one time-bounded worker lease for a
  repository.
- `repo_steward_release_lease` releases the matching lease token.
- `repo_steward_list_actions` reads the local improvement-action ledger.
- `repo_steward_list_closeouts` reads active closeout receipt projections.
- `repo_steward_record_action` creates or transitions a versioned action while
  the caller holds the repository lease.
- `repo_steward_record_closeout` creates or transitions an immutable,
  versioned closeout receipt while the caller holds the repository lease.
- `repo_steward_record_verification` appends test or inspection evidence while
  the caller holds the repository lease.

## Action lifecycle

Actions begin as `proposed`, then move through explicit states such as
`approved`, `running`, `blocked`, `completed`, or `cancelled`. Updates require
the current action version, preventing one worker from silently overwriting
another. Completion requires at least one passing verification record.

Repo Steward supplies discovery, coordination, and evidence, not autonomous
authority. A host agent or scheduler decides when to run the workflow. The
operator must inspect repository instructions and diffs, protect unknown user
changes, separate coherent work, run repository verification, and obtain any
approval required for Git or GitHub mutations. That agent may make targeted
commits; the stack itself never guesses what should be committed.

## Worktree closeout lifecycle

Closeout receipts move through evidence-backed states: `observed`,
`classified`, `preservation_required`, `retained`, `archive_eligible`,
`cleanup_pending_approval`, `cleanup_approved`, and `blocked`. Dirty,
conflicted, untracked, ahead-only, unaccepted, unvalidated, or explicitly
preserved evidence blocks archive eligibility. `cleanup_approved` requires an
exact approval reference but records no cleanup side effect. Each version is
immutable and the active projection advances only with the current version and
repository lease.

## Verification

```bash
npm test
```
