# ADR 0001: Public Registry Artifact Boundary

## Status

Accepted

## Context

Registry catalog packages are the source that users download or sync into `~/.rudi/stacks/{stack-id}`. Installed stacks also create local state: run folders, downloaded media, browser profiles, temporary files, generated renders, QA frames, and package dependencies. Those files can be large, machine-specific, account-specific, or private.

Before this decision, generated stack state could sit under `catalog/stacks/{stack-id}` or `~/.rudi/stacks/{stack-id}` and then be picked up by catalog hash generation, npm package allowlists, or release tarballs.

## Decision

The public registry payload is generic portable source, docs, tests, static
configuration, and explicitly synthetic fixtures only. Generated runtime state
is not part of a catalog package.

- Stack runtime state belongs under `~/.rudi/state/stacks/{stack-id}` by default.
- `RUDI_HOME` and stack-specific environment variables may relocate state, but source lookup must not silently fall back to catalog-local run folders.
- Catalog hash generation, public-readiness validation, npm package allowlists, and release tarballs must all exclude generated stack artifacts.
- Forbidden public artifact paths include stack-local `node_modules`, `runs`, `downloads`, `tmp`, `.chrome-profiles`, `.test-rudi`, `clips`, `output`, `outputs`, and `composer/public/media`.
- Immutable stack tarballs under `dist/stacks/*.tar.gz` are not published unless a build step regenerates them deterministically.
- Only generic, portable, address-free definitions, source, documentation, and tests—and explicitly synthetic fixtures—may ship publicly for OpenCounter scenario waves.
  Requester-approved previews and approvals, observation
  freezes, exact source-ledger snapshots, parcel- and fact-specific evidence,
  and generated scenario ledgers are private RUDI runtime state. Private state
  directories use mode `0700`; files use mode `0600`.
- An observation freeze is a private, content-addressed manifest. It may bind
  rather than embed full source ledgers only when the exact snapshots are
  retained immutably. The planner must canonicalize the source manifest before
  computing `evidenceSetSha256`, rehash every retained snapshot, and require
  exact no-extra/no-missing equality with the canonical source manifest.
  Planning must fail closed when a snapshot is unavailable or mismatched.
- Requester approval must bind `previewSha256` and the exact scenario ID,
  scenario version, normalized question signature, answer value, and ownership
  tuple for every rule. Approval for a site/location-derived rule must
  additionally bind the exact frozen source-ledger snapshot cryptographically
  bound by the observation freeze and fact-specific, parcel-specific evidence
  for the same parcel. Generic fixture evidence, equality with an expected
  base-zone value, and membership in the provider's displayed options are
  insufficient proof. Planning must fail closed before any provider project
  starts if any rule lacks its required proof.
- Scenario answer ownership is closed to `proposal_fact`, `site_fact`, and
  `mixed_fact`. Proposal and mixed rules must include a deterministic
  declaration bound to the campaign and policy versions, scenario and question
  signatures, and exact answer value. The declaration must identify the answer
  as an explicitly synthetic coverage fact and state that it is not a real
  project fact. Site rules require content-addressed parcel evidence; mixed
  rules require both declaration and evidence.
- A generated scenario preview is a provider-free audit artifact, not an
  approval. Provider mutation remains prohibited until the requester explicitly
  approves the exact preview digest and maximum project volume.

## Consequences

Users can install a smaller, reproducible stack package. Local editing runs and media remain available through state roots without becoming release payload. Future stack features that need examples or fixtures must use small, explicit fixtures rather than run outputs or account-local state.

Registry checks now fail if forbidden generated artifacts are tracked under `catalog/`, if the catalog hash includes runtime paths, or if npm packaging can include generated stack artifacts.
