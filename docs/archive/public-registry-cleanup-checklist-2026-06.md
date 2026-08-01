# Public Registry Cleanup Checklist

> **Status: archived historical checklist (June 2026).** For the current
> canonical layout, follow [`AGENTS.md`](../../AGENTS.md) and
> [`SCHEMA.md`](../../SCHEMA.md).

Use this as the working checklist for separating the public-facing RUDI registry
from local `.rudi` install/runtime state.

## Goal

- [ ] Public users can install stacks from immutable registry artifacts, not from local
      catalog paths.
- [ ] The registry source tree contains no secrets, account state, local runtime
      artifacts, personal paths, or machine-specific data.
- [ ] `.rudi` remains the local installed/runtime state layer.
- [x] `npm run validate:public -- --json` passes cleanly.
- [ ] A clean clone can rebuild the public index and package artifacts deterministically.

## Current Baseline

- [x] `$RUDI_HOME/stacks` no longer uses symlinks into the registry.
- [x] `rudi index --force --json` succeeds against the local `.rudi` installs.
- [x] Secret-like local files were moved out of the registry catalog.
- [x] `npm run validate:public -- --json` currently passes.
- [ ] The registry checkout still contains local state and generated artifacts.
- [ ] Public install metadata still points at catalog paths.
- [x] Runtime and binary manifests no longer contain placeholder checksums.

## P0: Remove Secrets And Account State

- [x] Remove stack `.env` files from `catalog/stacks/**`.
- [x] Remove Google Workspace account state from
      `catalog/stacks/google-workspace/accounts/**`.
- [x] Remove all `token.json`, `credentials.json`, OAuth refresh tokens, private keys,
      connection strings, and account-specific config from the registry tree.
- [x] Move any required local-only secrets/state into `.rudi`, OS keychain, or the
      existing RUDI secrets layer.
- [ ] Review example files such as `.env.example` and confirm all values are fake.
- [x] Add or tighten `.gitignore` rules for account state, tokens, credentials, and
      generated runtime state.
- [x] Add or tighten `.npmignore`/package allowlists so secrets cannot enter package
      artifacts.
- [x] Rerun the public validator and verify `secret-like-file` findings are gone.
- [ ] If any real secret was ever committed or published, rotate it.

Migration note:

- 2026-06-08: Moved 9 registry `.env` files to `$RUDI_HOME/secrets`.
- 2026-06-08: Imported missing env-var style keys into `$RUDI_HOME/secrets.json`
  without overwriting existing secrets.
- 2026-06-08: Moved Google Workspace account JSON state to
  `$RUDI_HOME/state/stacks/google-workspace/accounts`; conflicting existing
  account files were preserved under a timestamped `.rudi` migration backup.
- 2026-06-08: `npm run validate:public -- --json` no longer reports
  `secret-like-file`; the current public-readiness run reports 0 errors and 0 warnings.

Verification:

```bash
cd "$REGISTRY_ROOT"
npm run validate:public -- --json
find catalog -type f \( -name ".env" -o -name "token.json" -o -name "credentials.json" -o -name "*.pem" -o -name "*.key" \)
```

## P0: Define Public Install Artifact Contract

- [ ] Decide the canonical public install source for stacks:
      npm package artifact, GitHub release asset, registry CDN URL, or another
      immutable artifact location.
- [ ] Update stack `manifest.v2.json` files so public installs do not use
      `"source": "catalog"` for externally published stacks.
- [ ] Ensure `dist/index.json` is generated from the same artifact contract.
- [ ] Include artifact URL, artifact size, SHA-256, version, and platform constraints
      where applicable.
- [ ] Ensure installers reject missing checksums, placeholder checksums, missing
      artifacts, and mutable source references in public mode.
- [ ] Ensure failed downloads cannot create installed placeholder stacks.
- [ ] Document the difference between local development installs and public registry
      installs.

Known current examples to fix:

- [ ] `catalog/stacks/google-workspace/manifest.v2.json`
- [ ] `catalog/stacks/twilio-sms/manifest.v2.json`
- [ ] `catalog/stacks/video-editor/manifest.v2.json`
- [ ] Corresponding entries in `dist/index.json`

Verification:

```bash
cd "$REGISTRY_ROOT"
rg -n '"source": "catalog"|catalog/stacks' catalog dist/index.json index.json
npm run validate:public -- --json
```

## P0: Replace Placeholder Checksums

- [ ] Inventory every runtime and binary manifest with an all-zero SHA-256.
- [ ] Download or locate the canonical release artifact for each platform.
- [ ] Compute the real SHA-256 for each artifact.
- [ ] Update manifests with real checksums.
- [ ] Add validation that rejects all-zero, missing, malformed, or duplicated checksum
      placeholders.
- [ ] Confirm checksum verification happens during public install/download.

Current blocker count from validator:

- [x] Placeholder SHA-256 findings across binaries and runtimes are resolved.

Known manifest groups:

- [ ] `catalog/binaries/v2/*.json`
- [ ] `catalog/runtimes/v2/*.json`

Verification:

```bash
cd "$REGISTRY_ROOT"
rg -n '"sha256": "0{64}"' catalog/binaries catalog/runtimes
npm run validate:public -- --json
```

## P1: Fix Index Consistency

- [ ] Remove stale entries from `index.json`, or add the missing tracked packages.
- [ ] Ensure every index entry points to a tracked, publishable package/manifest.
- [ ] Ensure generated `dist/index.json` matches source manifests and does not keep
      stale deleted entries.
- [ ] Add CI coverage that fails when index entries reference untracked paths.

Current `index-path-untracked` findings:

- [ ] `stack:rudi-processor`
- [ ] `stack:image-generator`
- [ ] `stack:video-generator`
- [ ] `stack:social-media-publisher`
- [ ] `skill:client-engagement-intake`
- [ ] `skill:shortform-your-words-script`

Verification:

```bash
cd "$REGISTRY_ROOT"
npm run validate:public -- --json
git ls-files > /tmp/rudi-registry-tracked-files.txt
```

## P1: Clean Registry Source Tree

- [ ] Remove `node_modules` directories from `catalog/**`.
- [ ] Remove generated `dist`, `build`, `coverage`, cache, and local test-output
      directories from stack source unless they are explicitly source artifacts.
- [ ] Remove `runs`, clips, rendered videos, transcripts, logs, and working media from
      stack source.
- [ ] Remove generated image outputs from stack source unless they are intentional
      examples with reviewable provenance.
- [ ] Keep stack source small enough for normal clone, review, and CI workflows.
- [ ] Add ignore rules for generated stack-local artifacts.
- [ ] Confirm public package allowlists do not accidentally include source-local
      artifacts.

Known current hotspots:

- [ ] `catalog/stacks/video-editor/runs/**`
- [ ] `catalog/stacks/video-editor/node_modules/**`
- [ ] `catalog/stacks/video-editor/composer/node_modules/**`
- [ ] `catalog/stacks/google-workspace/node_modules/**`
- [ ] `catalog/stacks/google-workspace/dist/**`
- [ ] `catalog/stacks/google-ai/output/*.png`
- [ ] Other `catalog/stacks/**/node_modules/**`

Verification:

```bash
cd "$REGISTRY_ROOT"
find catalog -type d \( -name node_modules -o -name dist -o -name build -o -name coverage -o -name runs \)
du -sh catalog/stacks/* | sort -h | tail -n 30
npm pack --dry-run --json
```

## P1: Scrub Personal And Local Machine References

- [ ] Remove or rewrite user-home absolute paths and other local paths from public
      catalog files.
- [ ] Keep personal brand workflows in local/private skills such as
      `~/.rudi/skills/**`; public `catalog/skills/**` entries must remain generic,
      ready-to-run, and editable after install.
- [ ] Remove personal email addresses from source, docs, examples, generated outputs,
      and run artifacts unless they are intentionally public test fixtures.
- [ ] Replace local examples with fake, documented placeholders.
- [ ] Move real customer/client/personal workflow examples to private state or private
      docs.

Verification:

```bash
cd "$REGISTRY_ROOT"
rg -n '(/Users/[^/]+|/private/var|/tmp/|@gmail.com|@learnrudi|@collab)' catalog index.json src schemas package.json
```

## P1: Validate Stack Artifact Contents

- [ ] Inspect every `dist/stacks/*.tar.gz` artifact for secret-like filenames.
- [ ] Inspect every stack artifact for unexpectedly large files.
- [ ] Inspect every stack artifact for local paths and personal identifiers.
- [ ] Confirm artifact contents are exactly what the public installer needs.
- [ ] Rebuild artifacts from clean source and compare manifest/index outputs.

Verification:

```bash
cd "$REGISTRY_ROOT"
for f in dist/stacks/*.tar.gz; do
  echo "$f"
  tar -tzf "$f" | rg '(^|/)(\.env|accounts|token\.json|credentials\.json|node_modules|runs|\.DS_Store)' || true
done
```

## P2: Public Readiness Documentation

- [ ] Keep one canonical public-readiness checklist and link to it from registry docs.
- [ ] Document the registry development workflow.
- [ ] Document how local `.rudi` installs differ from public registry publishing.
- [ ] Document artifact generation and checksum generation.
- [ ] Document how to test a clean public install.
- [ ] Document what must never be committed to the registry.
- [ ] Remove or relocate `catalog/prompts` if it is not part of the public registry
      contract.

## P2: CI And Guardrails

- [ ] Run `npm run validate:public -- --json` in CI.
- [ ] Add secret scanning in CI for registry paths.
- [ ] Add artifact content scanning in CI before publish.
- [ ] Add checksum-placeholder checks in CI.
- [ ] Add stale-index checks in CI.
- [ ] Add clean-clone install smoke tests for representative stacks.
- [ ] Add package dry-run verification in CI.

Suggested CI verification bundle:

```bash
cd "$REGISTRY_ROOT"
npm run validate:public -- --json
npm pack --dry-run --json
rg -n '"sha256": "0{64}"' catalog/binaries catalog/runtimes
```

## Final Acceptance Criteria

- [x] `npm run validate:public -- --json` exits 0.
- [x] No secret-like files exist under `catalog/**`.
- [ ] No public stack install manifest points at mutable catalog source.
- [ ] No runtime or binary manifest contains a placeholder checksum.
- [ ] No `index.json` entry points to an untracked path.
- [ ] No `node_modules`, local `runs`, account state, or generated media exists in
      public source.
- [ ] `npm pack --dry-run --json` includes only intentional public registry files.
- [ ] A clean clone can build the public index and artifacts.
- [ ] A clean machine can install representative stacks from public artifacts.
- [ ] `.rudi` remains local-only runtime/install state.
