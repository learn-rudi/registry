# Bootstrap `@learnrudi/swe-engineering-stack@0.2.0` With Provenance

Status: executed successfully on 2026-09-02; immutable public package and
provenance independently verified, authenticated npm control-plane state
operator-attested, bootstrap credentials revoked.
Authoring this runbook did not itself authorize any external action; the
execution used separately recorded action-time approvals.

## Scope And Authority

- Operator: an npm `@learnrudi` organization owner or admin with first-package
  publish authority and a GitHub administrator for `learnrudi/registry`.
- Exact systems: public npm registry, npm scope `@learnrudi`, public GitHub repository
  `learnrudi/registry`, branch `main`, workflow
  `bootstrap-swe-engineering-stack.yml`, and GitHub environment
  `npm-bootstrap`.
- Outcome: publish exactly `@learnrudi/swe-engineering-stack@0.2.0` once from the
  reviewed package tree with npm provenance, verify the immutable registry
  artifact, configure the normal trusted publisher, then revoke the bootstrap
  credential.
- Expected duration: 20–30 minutes after source merge and explicit release
  approval.
- Risk: high. The first public publish permanently consumes version `0.2.0` and
  establishes the package name. A bad artifact cannot be replaced at the same
  version.
- Authorized actions: none merely because this file exists.
- Actions requiring separate confirmation: source merge, npm authentication,
  `@learnrudi` organization or scope changes, token creation, GitHub environment or
  secret changes, bootstrap dispatch, package publication, trusted-publisher
  configuration, token revocation, deprecation, or unpublish.

## Preconditions

- [x] The package-identity correction PR is accepted and merged through
  repository policy; its exact reviewed head, merge record, and the dispatched
  `main` SHA are recorded.
- [x] The merged package tree at
  `catalog/stacks/swe-engineering` is
  `a20da20c28a138c8ab537c367fa98b380f16ece1`.
- [x] The source repository and package are public, and `package.json` points to
  `git+https://github.com/learnrudi/registry.git`.
- [x] `@learnrudi/swe-engineering-stack` returned npm `E404` immediately before
  the successful first publication.
- [x] The human operator has interactively authenticated to npm without sharing
  credentials in chat, shell history, screenshots, logs, or tracked files.
- [x] The human operator read the authenticated npm organization members page
  and attested that verified username `bzhoff` is the `learnrudi` owner. This
  replaced the literal `npm org ls` command because authentication was held in
  the user-controlled browser, not copied into the shell; the private role is
  not independently reproducible without authenticated npm access.
  If the check had not proved `owner` or `admin`, the release would have
  stopped. Do not create the organization, claim the scope, rename the package,
  or publish under another scope without a new decision and source review.
- [x] The human operator attested that the separately approved granular npm
  token used the shortest available expiration covering the release window,
  granted **Packages and scopes → Read and write** to the `@learnrudi` scope
  only, granted no **Organizations** permission, and had **Bypass 2FA** enabled
  for the noninteractive direct publish. Its value existed only as the GitHub
  environment secret `NPM_BOOTSTRAP_TOKEN` and was revoked immediately
  afterward; no credential-bearing proof artifact was retained.
- [x] The GitHub environment `npm-bootstrap` is restricted to `main`, requires
  reviewer `rudijetson`, permits the explicitly authorized solo self-review
  mode, disallows administrator bypass, and exposes no unrelated secrets.
- [x] The operator reviewed npm's immutable-record notice because
  provenance enters a public transparency log.

Pre-publication source-readiness evidence:

- both GitHub repositories involved in package publication are public;
- anonymous npm metadata shows `@learnrudi/swe-engineering-stack` absent;
- the authenticated npm profile shows the `learnrudi` organization, while the
  exact owner/admin role remains an interactive pre-publication checkpoint;
- the pinned GitHub bootstrap runtime (`ubuntu-24.04`, Node `24.19.0`, npm
  `11.17.0`) packs exactly 20 files with integrity
  `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`
  and shasum `5b6fd58434ed3ccead4770365c7efd58c33622f3`.

## Procedure

### 1. Verify npm identity and `@learnrudi` authority

- Mutation: interactive login only; following checks are read-only.
- Retry: login is repeatable; organization creation or membership changes are
  outside this runbook.
- Action:

  ```bash
  npm login --auth-type=web --registry=https://registry.npmjs.org
  npm whoami --registry=https://registry.npmjs.org
  npm org ls learnrudi <verified-npm-username> --json --registry=https://registry.npmjs.org
  ```

- Expected result: the username is the intended release operator and the final
  command reports `owner` or `admin` for that same user.
- Checkpoint: record only the username and role, never credential values.
- If different: stop. Do not create or rename a scope, change membership, or
  substitute another scope without a separately ratified package-identity change.

### 2. Verify the accepted source without checking it out

- Mutation: read-only remote inspection.
- Retry: idempotent.
- Action, from a validated clean Registry checkout (replace the angle-bracketed
  path only after inspecting it):

  ```bash
  cd <validated-clean-registry-checkout>
  git status --short --branch
  git fetch origin refs/heads/main:refs/remotes/origin/main
  gh pr view 63 \
    --repo learnrudi/registry \
    --json state,mergedAt,headRefOid,mergeCommit
  gh pr view 65 \
    --repo learnrudi/registry \
    --json state,mergedAt,headRefOid,mergeCommit
  git rev-parse refs/remotes/origin/main
  git rev-parse refs/remotes/origin/main:catalog/stacks/swe-engineering
  git diff --exit-code <reviewed-pr-head>..refs/remotes/origin/main -- \
    .github/workflows/bootstrap-swe-engineering-stack.yml \
    .github/workflows/publish-swe-engineering-stack.yml \
    catalog/stacks/swe-engineering \
    docs/runbooks/npm-swe-engineering-stack-bootstrap.md \
    src/swe-engineering-publish-workflow.test.ts
  git diff --check <reviewed-pr-head>..refs/remotes/origin/main -- \
    .github/workflows/bootstrap-swe-engineering-stack.yml \
    .github/workflows/publish-swe-engineering-stack.yml \
    catalog/stacks/swe-engineering \
    docs/runbooks/npm-swe-engineering-stack-bootstrap.md \
    src/swe-engineering-publish-workflow.test.ts
  ```

- Expected result: both PR states are `MERGED`; PR #63 is the package-identity
  correction reviewed at exact head
  `538a4927c47d5191ede73d1e91658e8036b1c982` and merged as
  `5f8820ebc1ab216ecaea6b4ec9577d85d5f4ff3e`; PR #65 is the bootstrap-runtime
  correction reviewed at exact head
  `608a590c78b19624f8ab502da1d3c71fd97958bb` and merged as
  `4ce2d9b3daaab419e33a43f413011db66f02ea24`. Use the PR #65 head as
  `<reviewed-pr-head>` for the bounded diff. The checkout remains clean;
  accepted `main` has no content difference from that final reviewed head in
  either release workflow, the package, its workflow contract test, or this
  runbook; the package tree is
  `a20da20c28a138c8ab537c367fa98b380f16ece1`; and the diff check is clean.
- Checkpoint: retain the full `main` SHA as `<accepted-main-sha>`.
- If different: stop and require a fresh package diff, tests, and review.

### 3. Verify the package is still absent for the authenticated publisher

- Mutation: read-only npm query.
- Retry: idempotent before publication.
- Action:

  ```bash
  npm view @learnrudi/swe-engineering-stack name version --json --registry=https://registry.npmjs.org
  ```

- Expected result: npm returns `E404` while using the verified interactive npm
  session. An anonymous `E404` is insufficient because it can hide a private
  package.
- Checkpoint: if metadata exists, this one-time workflow is no longer eligible.
- If different: stop and audit ownership, versions, repository metadata,
  integrity, and attestations. Never attempt to overwrite a published version.

### 4. Configure the protected bootstrap boundary

- Mutation: reversible npm token, GitHub permission, and secret configuration.
- Retry: idempotent while values and restrictions are unchanged.
- Action:
  1. In the verified operator's npm settings, create a **Granular Access
     Token** with the shortest expiration that covers this release window.
  2. Set **Packages and scopes** to **Read and write**, select only the `@learnrudi`
     scope, leave **Organizations** at **No access**, and enable **Bypass 2FA**.
     Organization permission manages organization settings and does not grant
     package publication. A noninteractive direct publish requires a write
     token that can satisfy npm's publishing 2FA rule.
  3. In `learnrudi/registry`, open **Settings → Environments** and create or
     inspect the exact environment `npm-bootstrap`.
  4. Restrict deployment branches to `main`, require reviewer `rudijetson`,
     leave **Prevent self-review** disabled for the explicitly authorized solo
     review mode, and deselect **Allow administrators to bypass configured
     protection rules**.
  5. Add the token as the environment secret `NPM_BOOTSTRAP_TOKEN`. Do not use
     a repository-wide or organization-wide secret, and never persist the
     token in shell history, a file, chat, or an approval record.
- Expected result: only the `npm-bootstrap` job on `main` can request the exact
  `@learnrudi` package-scope token; reviewer `rudijetson` must approve it, and
  administrators cannot bypass the review.
- Checkpoint: inspect the token expiration, Packages and scopes selection,
  Organizations setting, Bypass 2FA setting, environment name, branch rule,
  reviewer, authorized solo-review setting, disabled administrator bypass, secret name,
  and absence of unrelated secrets. Never reveal the value.
- If different: stop and correct the environment before dispatch.

### 5. Confirm the irreversible publication

- Mutation: none; this is the final authorization checkpoint.
- Retry: not applicable.
- Action: the release owner records explicit approval for this exact tuple:

  ```text
  learnrudi/registry
  <accepted-main-sha>
  package tree a20da20c28a138c8ab537c367fa98b380f16ece1
  @learnrudi/swe-engineering-stack@0.2.0
  workflow bootstrap-swe-engineering-stack.yml
  environment npm-bootstrap
  ```

- Expected result: approval names the exact repository, SHA, package, version,
  workflow, environment, and one-time publish operation.
- If different: stop. Approval for a merge, token, environment, or another
  version is not publication approval.

### 6. Dispatch the one-time bootstrap workflow

- Mutation: externally visible and irreversible if the publish step succeeds.
- Retry: unsafe to repeat unless npm still returns `E404`, the first run did not
  reach a successful publish, and the exact same SHA/tree remain approved.
- Action:

  ```bash
  gh workflow run bootstrap-swe-engineering-stack.yml \
    --repo learnrudi/registry \
    --ref main \
    -f accepted_sha=<accepted-main-sha> \
    -f confirmation='bootstrap @learnrudi/swe-engineering-stack@0.2.0'
  ```

- Expected result: the no-secret `verify` job passes; the `bootstrap` job pauses
  for the environment reviewer; after approval it publishes once with
  provenance.
- Checkpoint:

  ```bash
  gh run list \
    --repo learnrudi/registry \
    --workflow bootstrap-swe-engineering-stack.yml \
    --limit 3
  gh run watch <bootstrap-run-id> --repo learnrudi/registry --exit-status
  ```

- If different: do not blindly rerun. First repeat Step 3 and inspect the failed
  job without printing secrets. If the version exists, proceed to verification;
  if it remains absent, correct only the identified cause and obtain renewed
  dispatch approval.

### 7. Verify the immutable npm artifact and provenance

- Mutation: local temporary verification files only; npm registry operations
  are read-only.
- Retry: idempotent after registry propagation.
- Action:

  ```bash
  npm view @learnrudi/swe-engineering-stack@0.2.0 \
    name version repository dist.integrity dist.shasum dist.attestations \
    --json \
    --registry=https://registry.npmjs.org

  verification_dir="$(mktemp -d)"
  npm install \
    --prefix "$verification_dir" \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    --save-exact \
    --registry=https://registry.npmjs.org \
    @learnrudi/swe-engineering-stack@0.2.0
  (
    cd "$verification_dir"
    npm audit signatures --registry=https://registry.npmjs.org
    npm audit signatures \
      --registry=https://registry.npmjs.org \
      --json \
      > npm-audit-signatures.json
    attestations_url="$(npm view \
      @learnrudi/swe-engineering-stack@0.2.0 \
      dist.attestations.url \
      --registry=https://registry.npmjs.org)"
    curl --fail --silent --show-error \
      "$attestations_url" \
      --output npm-attestations.json
    jq -e '
      [.attestations[].predicateType] as $types
      | ($types | index("https://github.com/npm/attestation/tree/main/specs/publish/v0.1")) != null
      and ($types | index("https://slsa.dev/provenance/v1")) != null
    ' npm-attestations.json >/dev/null
    shasum -a 256 npm-audit-signatures.json npm-attestations.json
  )
  ```

  Then open the `0.2.0` provenance details on npm and inspect all five links:
  **Build Environment**, **Build Summary**, **Source Commit**, **Build File**,
  and **Public Ledger**. Retain the temporary directory until the release
  evidence has been accepted; deleting it is a separate cleanup action.

- Expected result:
  - exact name and version;
  - repository `git+https://github.com/learnrudi/registry.git` with directory
    `catalog/stacks/swe-engineering`;
  - integrity
    `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`;
  - shasum `5b6fd58434ed3ccead4770365c7efd58c33622f3`;
  - an attestations URL and SLSA provenance predicate;
  - both signature-audit commands exit successfully after a lifecycle-disabled
    isolated install, the retained audit JSON has empty `invalid` and `missing`
    arrays, and the separately retained public attestation response contains
    both required predicates for the exact package subject;
  - npm's provenance details show GitHub Actions, the exact bootstrap workflow
    run, source commit `<accepted-main-sha>`, build file
    `.github/workflows/bootstrap-swe-engineering-stack.yml`, and a public-ledger
    entry, with no missing-source or invalid-provenance warning.
- Checkpoint: retain the workflow run URL, accepted SHA, package tree, npm
  integrity, shasum, attestations URL, signature-audit result, provenance link
  details, public-ledger reference, and publication time.
- If different: stop all Cloud consumption. Do not unpublish automatically or
  publish another build as `0.2.0`.

### 8. Configure the normal trusted publisher

- Mutation: reversible npm package-security configuration.
- Retry: idempotent while the exact identity is unchanged.
- Action: in npm package settings for
  `@learnrudi/swe-engineering-stack`, configure GitHub Actions trusted publishing:
  - organization: `learnrudi`;
  - repository: `registry`;
  - workflow filename: `publish-swe-engineering-stack.yml`;
  - environment: blank, matching the reviewed normal workflow;
  - allowed action: `npm publish` only.
- Expected result: the package displays that exact trusted-publisher identity.
- Checkpoint: independently re-read every case-sensitive field. npm does not
  validate the identity until a later publish attempt, and immutable `0.2.0`
  must not be used as that test.
- If different: remove or correct the configuration before any future version.

### 9. Revoke bootstrap authority

- Mutation: credential revocation and GitHub secret removal.
- Retry: token revocation is one-time; confirming absence is idempotent.
- Action:
  1. Delete `NPM_BOOTSTRAP_TOKEN` from the `npm-bootstrap` environment.
  2. Revoke the matching granular token in npm.
  3. Keep the environment and completed workflow run as audit evidence unless a
     separate cleanup decision says otherwise.
  4. After the trusted publisher is verified on a later distinct release,
     select npm's strongest compatible publishing-access policy that disallows
     traditional tokens.
- Expected result: the bootstrap job has no usable long-lived credential and
  cannot repeat because the package now exists.
- Checkpoint: confirm the environment secret is absent and the npm token is
  revoked without displaying either value.
- If different: stop future releases and treat the remaining credential as a
  security incident requiring immediate revocation.

## Recovery And Rollback

- Before publication: stop safely; no npm package state exists.
- Failed workflow with npm `E404`: preserve the run, diagnose the exact failing
  step, and require renewed approval before a same-SHA retry.
- Package exists with correct metadata: do not rerun; finish verification and
  credential revocation even if GitHub reported a late failure.
- Package exists with incorrect metadata, integrity, or provenance: block Cloud
  consumption and all further publication. The safe recovery is a separately
  reviewed deprecation or forward version, not an automatic unpublish or reuse
  of `0.2.0`.
- Suspected credential exposure: revoke the npm token immediately, remove the
  environment secret, retain audit evidence, and stop the release.
- Scope ownership mismatch: stop. Organization creation, package renaming, or
  moving to another scope requires an explicit product decision and fresh source
  changes across Registry, Cloud, and System.

## Final Verification

- Observable outcome: exact public package `0.2.0` exists with the reviewed
  integrity and provenance; the normal trusted publisher is configured; the
  bootstrap token and environment secret no longer exist.
- Verification method: npm metadata and attestations, GitHub workflow run,
  environment inspection, token revocation confirmation, and retained approval
  record.
- Evidence retained: accepted SHA, package tree, workflow run URL, npm
  integrity/shasum/attestations URL, signature/attestation result hashes,
  operator identity and role, approval reference, deviations, and
  token-revocation time. The compact non-secret public evidence receipt is
  `docs/swe-compliance/2026-09-02-swe-engineering-stack-release-evidence.json`.
  Never retain the token.

## Completion Record

- Executed by and time: npm owner `bzhoff` with the Codex operator on
  2026-09-02, from first dispatch at `16:59Z` through final credential-absence
  verification by `17:41Z`.
- Accepted source: package-identity PR #63 head `538a492` merged as `5f8820e`,
  bootstrap-runtime PR #65 head `608a590` merged as `4ce2d9b`; accepted
  `learnrudi/registry` main
  `4ce2d9b3daaab419e33a43f413011db66f02ea24`; package tree
  `a20da20c28a138c8ab537c367fa98b380f16ece1`.
- Safe failed attempt: run `33658257989` stopped in the no-secret verify job
  before credential access because a floating npm pack runtime did not
  reproduce the locally reviewed compressed bytes. Registry PR #65 pinned
  Ubuntu `24.04`, Node `24.19.0`, npm `11.17.0`, and the reproduced digest.
- Successful publication: run `33659462566` published public
  `@learnrudi/swe-engineering-stack@0.2.0` with integrity
  `sha512-6pyA3PyFiwojA4Y2MBc/OKWiK8p/0mK7eiPlGmdICEeQLnAmgz+dydJcTxBX58Wkbm1n5pMwNT673lC0VQT9cw==`
  and shasum `5b6fd58434ed3ccead4770365c7efd58c33622f3`.
- Provenance: npm exposes a SLSA v1 attestation whose builder, repository,
  source commit, bootstrap workflow, and invocation bind that exact run.
  Browser provenance links point to GitHub Actions, source commit `4ce2d9b`,
  `.github/workflows/bootstrap-swe-engineering-stack.yml`, run
  `33659462566`, and transparency-log entry `2688217956`.
- Signature verification: isolated lifecycle-disabled install succeeded;
  `npm audit signatures` reported 96 verified registry signatures and ten
  verified attestations with no missing or invalid signatures. The durable
  non-secret evidence receipt records the exact empty audit result and hash,
  public attestation endpoint and response hash, both predicate types, package
  subject digest, and public-ledger index.
- Trusted publisher: the authenticated npm UI was operator-attested as
  recording GitHub Actions identity `learnrudi/registry`, workflow
  `publish-swe-engineering-stack.yml`, blank environment, and allowed action
  `npm publish` only. npm does not expose that package-security record to
  unauthenticated independent readback.
- Revocation: removal of npm token `RUDI SWE stack bootstrap` was
  operator-attested from the authenticated token page; GitHub environment
  `npm-bootstrap` independently lists no `NPM_BOOTSTRAP_TOKEN` secret. The
  protected environment and completed workflow runs remain as audit evidence.
- Deviations or skipped steps: solo review mode was explicitly authorized; npm
  owner authority was re-read from the authenticated organization members UI
  rather than by exporting browser authentication to the shell. The owner,
  trusted-publisher, and npm-token-absence statements are deliberately labeled
  operator-attested because they are not independently reproducible without
  authenticated npm control-plane access. No credential value or authenticated
  screenshot was retained in source, logs, chat, or local temporary storage.
- Remaining gates: Cloud PR #19 merged exact reviewed head
  `a88f3945780cfc7afc59698d6eb36b15a741612d` to `main` as
  `9fc89fb606f0ad53a7e944b84577b654f2577664` after exact dependencies,
  lock integrity, Node 20 tests, audit, hosted container proof, and independent
  review passed. Provider setup, migration, deployment, DNS attachment, live
  smoke, and rollback proof remain.
