# Repo Steward

Repo Steward is a local MCP stack for safely observing a configured fleet of
Git repositories and coordinating continuous-improvement work. It reports
repository state, optionally fetches remote metadata when repository policy
allows it, grants one bounded worker lease per repository, and records a
durable action and verification ledger.

The stack never stages, commits, pushes, merges, resets, or cleans. GitHub
issues and pull requests are also outside this stack; use `stack:github` under
the related operator skill when those actions are authorized.

## Configuration

Set `REPO_STEWARD_CONFIG_PATH` to an absolute path containing the exact
repository allowlist:

```bash
export REPO_STEWARD_CONFIG_PATH=/workspace/config/repo-steward.json
```

```json
{
  "schemaVersion": 1,
  "repositories": [
    {
      "id": "primary-app",
      "path": "/workspace/primary-app",
      "fetchAllowed": false
    }
  ]
}
```

Each path must resolve to the exact Git top-level directory. Symlink aliases,
nested directories, duplicate IDs, duplicate paths, unknown fields, and
unconfigured repositories are rejected. `fetchAllowed` defaults to `false`.

Local state is written beneath `$RUDI_HOME/state/repo-steward`. No credentials
or repository contents are copied into the ledger. Remote URLs are returned
without embedded credentials, and token-like text in summaries is redacted.

## Tools

- `repo_steward_preflight` validates configuration, Git availability, and the
  local state directory.
- `repo_steward_scan_fleet` scans every configured repository and can perform
  an explicit policy-permitted `git fetch --prune` first.
- `repo_steward_get_status` returns one repository's branch, upstream,
  divergence, worktree classifications, and safe remote identity.
- `repo_steward_acquire_lease` grants one time-bounded worker lease for a
  repository.
- `repo_steward_release_lease` releases the matching lease token.
- `repo_steward_list_actions` reads the local improvement-action ledger.
- `repo_steward_record_action` creates or transitions a versioned action while
  the caller holds the repository lease.
- `repo_steward_record_verification` appends test or inspection evidence while
  the caller holds the repository lease.

## Action lifecycle

Actions begin as `proposed`, then move through explicit states such as
`approved`, `running`, `blocked`, `completed`, or `cancelled`. Updates require
the current action version, preventing one worker from silently overwriting
another. Completion requires at least one passing verification record.

Repo Steward supplies coordination and evidence, not autonomous authority. A
host agent or scheduler decides when to run the workflow. The operator must
inspect repository instructions and diffs, protect unknown user changes, run
the repository's own verification, and obtain any approval required for Git or
GitHub mutations.

## Verification

```bash
npm test
```
