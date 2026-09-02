# Bootstrap `@rudi/swe-engineering-stack@0.2.0` With Provenance

Status: authored and source-verified; not executed. Authoring this runbook does
not authorize merge, npm login, organization changes, token creation, GitHub
environment changes, workflow dispatch, or package publication.

## Scope And Authority

- Operator: an npm `@rudi` organization owner or admin with first-package
  publish authority and a GitHub administrator for `learnrudi/registry`.
- Exact systems: public npm registry, npm scope `@rudi`, public GitHub repository
  `learnrudi/registry`, branch `main`, workflow
  `bootstrap-swe-engineering-stack.yml`, and GitHub environment
  `npm-bootstrap`.
- Outcome: publish exactly `@rudi/swe-engineering-stack@0.2.0` once from the
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
  `@rudi` organization or scope changes, token creation, GitHub environment or
  secret changes, bootstrap dispatch, package publication, trusted-publisher
  configuration, token revocation, deprecation, or unpublish.

## Preconditions

- [ ] Draft Registry PR `learnrudi/registry#62` is accepted and merged through
  repository policy; its exact reviewed head, merge record, and the dispatched
  `main` SHA are recorded.
- [ ] The merged package tree at
  `catalog/stacks/swe-engineering` is
  `0d974929e1c954c3116e2e54ed449ade64f7fe6f`.
- [ ] The source repository and package are public, and `package.json` points to
  `git+https://github.com/learnrudi/registry.git`.
- [ ] `@rudi/swe-engineering-stack` still returns npm `E404`.
- [ ] The human operator has interactively authenticated to npm without sharing
  credentials in chat, shell history, screenshots, logs, or tracked files.
- [ ] `npm org ls rudi <verified-npm-username>` proves the authenticated
  operator is an `owner` or `admin`. If it does not, stop: do not create the
  organization, claim the scope, rename the package, or publish under another
  scope without a new decision and source review.
- [ ] A separately approved granular npm token uses the shortest available
  expiration that covers the release window, grants **Packages and scopes →
  Read and write** to the `@rudi` scope only, grants no **Organizations**
  permission, and has **Bypass 2FA** enabled for this noninteractive direct
  publish. Its value exists only as the GitHub environment secret
  `NPM_BOOTSTRAP_TOKEN` and is revoked immediately afterward.
- [ ] The GitHub environment `npm-bootstrap` is restricted to `main`, has a
  required human reviewer, prevents self-review, disallows administrator
  bypass, and exposes no unrelated secrets.
- [ ] The operator has reviewed npm's immutable-record notice because
  provenance enters a public transparency log.

Current source-readiness evidence:

- both GitHub repositories involved in package publication are public;
- anonymous npm metadata shows `@rudi/swe-engineering-stack` absent;
- local npm authentication currently returns `E401`, so scope ownership is not
  established by this worktree;
- the reviewed dry-run contains exactly 20 files with integrity
  `sha512-1SvxpASZuleQuLoWrBK/uHmtY5EKhhsdj8VxmGtsS1yyVaFYfPYoJxxA+Cip1GSt89ZuvSQyHatwk10HCcpVJA==`
  and shasum `6582c3ed1329b3876e3dd5dc5686766f76d38109`.

## Procedure

### 1. Verify npm identity and `@rudi` authority

- Mutation: interactive login only; following checks are read-only.
- Retry: login is repeatable; organization creation or membership changes are
  outside this runbook.
- Action:

  ```bash
  npm login --auth-type=web --registry=https://registry.npmjs.org
  npm whoami --registry=https://registry.npmjs.org
  npm org ls rudi <verified-npm-username> --json --registry=https://registry.npmjs.org
  ```

- Expected result: the username is the intended release operator and the final
  command reports `owner` or `admin` for that same user.
- Checkpoint: record only the username and role, never credential values.
- If different: stop. Do not create or rename a scope, change membership, or
  substitute `@learnrudi` without a separately ratified package-identity change.

### 2. Verify the accepted source without checking it out

- Mutation: read-only remote inspection.
- Retry: idempotent.
- Action, from a validated clean Registry checkout (replace the angle-bracketed
  path only after inspecting it):

  ```bash
  cd <validated-clean-registry-checkout>
  git status --short --branch
  git fetch origin refs/heads/main:refs/remotes/origin/main
  gh pr view 62 \
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

- Expected result: PR state is `MERGED`; `<reviewed-pr-head>` is the exact head
  named by the final independent review and closeout receipt; the checkout
  remains clean; `main` has no content difference from that reviewed head in
  either release workflow, the package, its workflow contract test, or this
  runbook; the package tree is
  `0d974929e1c954c3116e2e54ed449ade64f7fe6f`; and the diff check is clean.
- Checkpoint: retain the full `main` SHA as `<accepted-main-sha>`.
- If different: stop and require a fresh package diff, tests, and review.

### 3. Verify the package is still absent for the authenticated publisher

- Mutation: read-only npm query.
- Retry: idempotent before publication.
- Action:

  ```bash
  npm view @rudi/swe-engineering-stack name version --json --registry=https://registry.npmjs.org
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
  2. Set **Packages and scopes** to **Read and write**, select only the `@rudi`
     scope, leave **Organizations** at **No access**, and enable **Bypass 2FA**.
     Organization permission manages organization settings and does not grant
     package publication. A noninteractive direct publish requires a write
     token that can satisfy npm's publishing 2FA rule.
  3. In `learnrudi/registry`, open **Settings → Environments** and create or
     inspect the exact environment `npm-bootstrap`.
  4. Restrict deployment branches to `main`, require an authorized reviewer,
     enable **Prevent self-review**, and deselect **Allow administrators to
     bypass configured protection rules**.
  5. Add the token as the environment secret `NPM_BOOTSTRAP_TOKEN`. Do not use
     a repository-wide or organization-wide secret, and never persist the
     token in shell history, a file, chat, or an approval record.
- Expected result: only the `npm-bootstrap` job on `main` can request the
  exact `@rudi` package-scope token; a reviewer other than the dispatcher must
  approve it, and administrators cannot bypass the review.
- Checkpoint: inspect the token expiration, Packages and scopes selection,
  Organizations setting, Bypass 2FA setting, environment name, branch rule,
  reviewer, Prevent self-review, disabled administrator bypass, secret name,
  and absence of unrelated secrets. Never reveal the value.
- If different: stop and correct the environment before dispatch.

### 5. Confirm the irreversible publication

- Mutation: none; this is the final authorization checkpoint.
- Retry: not applicable.
- Action: the release owner records explicit approval for this exact tuple:

  ```text
  learnrudi/registry
  <accepted-main-sha>
  package tree 0d974929e1c954c3116e2e54ed449ade64f7fe6f
  @rudi/swe-engineering-stack@0.2.0
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
    -f confirmation='bootstrap @rudi/swe-engineering-stack@0.2.0'
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
  npm view @rudi/swe-engineering-stack@0.2.0 \
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
    @rudi/swe-engineering-stack@0.2.0
  (
    cd "$verification_dir"
    npm audit signatures --registry=https://registry.npmjs.org
    npm audit signatures \
      --registry=https://registry.npmjs.org \
      --json \
      --include-attestations \
      > npm-audit-signatures.json
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
    `sha512-1SvxpASZuleQuLoWrBK/uHmtY5EKhhsdj8VxmGtsS1yyVaFYfPYoJxxA+Cip1GSt89ZuvSQyHatwk10HCcpVJA==`;
  - shasum `6582c3ed1329b3876e3dd5dc5686766f76d38109`;
  - an attestations URL and SLSA provenance predicate;
  - both signature-audit commands exit successfully after a lifecycle-disabled
    isolated install, and the retained JSON contains the verified attestation
    bundle and transparency-log material;
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
  `@rudi/swe-engineering-stack`, configure GitHub Actions trusted publishing:
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
  moving to `@learnrudi` requires an explicit product decision and fresh source
  changes across Registry, Cloud, and System.

## Final Verification

- Observable outcome: exact public package `0.2.0` exists with the reviewed
  integrity and provenance; the normal trusted publisher is configured; the
  bootstrap token and environment secret no longer exist.
- Verification method: npm metadata and attestations, GitHub workflow run,
  environment inspection, token revocation confirmation, and retained approval
  record.
- Evidence retained: accepted SHA, package tree, workflow run URL, npm
  integrity/shasum/attestations URL, operator identity and role, approval
  reference, deviations, and token-revocation time. Never retain the token.

## Completion Record

- Executed by and time: not executed.
- Deviations or skipped steps: none; npm identity and `@rudi` ownership remain
  unverified because this worktree has no valid npm session.
- Remaining gates after success: CLI package trusted publishing, Cloud exact
  dependency/lock update and full image proof, source merges, provider setup,
  migration, deployment, DNS attachment, live smoke, and rollback proof.
