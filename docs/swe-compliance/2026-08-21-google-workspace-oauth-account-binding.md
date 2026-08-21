## Phase 0: Baseline And Manual Lookup

- Scope: Correct the Google Workspace OAuth account-binding bug that allowed a token authorized by one Google user to be stored under another requested account name.
- Files inspected before editing: repository `AGENTS.md`; stack manifest, README, auth source, account/token loading source, existing auth tests; SWE doctrine sections on boundaries, red-green-refactor, debugging, identity, authentication, and security testing.
- Relevant SWE manual sections: Master Doctrine Principles 4 and 6; Appendix C7A and C8; Appendix D; Security Standard F2, F3, F5, and F12.
- Current-state commands: `git status --short --branch`; read-only `gmail_profile` and Drive comparison for `rudi@learnrudi.com` and `hoff@learnrudi.com`.
- Risks and invariants: credentials and tokens must never be printed; an explicit account authorization must never save a token unless Google's authenticated primary Gmail address matches the requested account; a failed or mismatched authorization must preserve the previously stored token; the Hoff account must remain untouched.
- Initial risk tier and rationale: High, because this changes authentication and persistent token state.
- Exit criteria: deterministic reproduction documented, source boundary localized, and scope locked before code changes.

## Phase 1: Scope Lock

- In scope: validate requested account email input; retrieve the authenticated Gmail profile after OAuth; reject identity mismatches before token persistence; document the invariant; patch and verify the installed stack; reauthorize only `rudi@learnrudi.com`; verify Gmail and Drive separation.
- Non-goals: rotating the shared OAuth client, widening scopes, changing Google Cloud resources, changing the Hoff token, sending email, or changing unrelated Workspace tools.
- Expected files touched: `catalog/stacks/google-workspace/src/auth.ts`, a focused auth-identity helper, `auth.test.cjs`, `README.md`, package/manifest version metadata, generated registry index, and this checklist.
- External inputs and trust boundaries: CLI account argument, Google OAuth callback, Google token response, and Gmail profile response.
- Failure behavior to define: invalid account identifiers fail before filesystem access; an authenticated identity mismatch returns an explicit error and does not overwrite token state.
- Authorized external actions: user-authorized OAuth reauthorization for `rudi@learnrudi.com`; read-only Gmail and Drive verification. No email send or Drive mutation.
- Review and approval gates: the user must personally select the RUDI Google user and grant OAuth consent; independent read-only code review is required before closure.
- Exit criteria: one behavior-level regression test is specified and exact files/non-goals are recorded.

## Phase 2: Red Tests

- Observable behavior to prove: requested `rudi@learnrudi.com` plus authenticated `hoff@learnrudi.com` is rejected; matching identity is normalized and accepted; malformed account identifiers are rejected.
- Test files to edit: `catalog/stacks/google-workspace/auth.test.cjs`.
- Red command: `node --import tsx auth.test.cjs` from the stack package directory.
- Expected failure: the new auth-identity validation module or contract does not yet exist.
- Exit criteria: test fails for the expected missing behavior.

## Phase 3: Implementation

- Implementation rules: smallest boundary fix; no token logging; validate before account-directory construction; verify Gmail primary identity before writing token; retain old token on mismatch.
- Files allowed to change: only the files listed in Phase 1 plus generated index output.
- Validation and error-handling requirements: case-insensitive exact primary-email match, valid email syntax, no control characters or path separators, explicit mismatch error.
- Observability requirements: console and browser result identify the verified account without printing tokens or OAuth codes.
- Exit criteria: unchanged red command passes without weakening assertions.

## Phase 4: Green Tests And Refactor

- Green command: `node --import tsx auth.test.cjs`.
- Refactor constraints: no unrelated auth, state, or tool changes.
- Regression checks: stack build and existing package tests.
- Exit criteria: focused test and affected test suite pass after final code shape.

## Phase 5: Full Verification

- Targeted tests: `npm run test:auth`.
- Full suite: repository-prescribed `npm test` and stack package tests where not already covered.
- Build/typecheck/lint: stack `npm run build`; registry `npm run validate`, `npm run indexes:sync`, `npm run indexes:check`, `npm run catalog:clean:check`, `npm run build`, and `npm pack --dry-run --json`.
- JS/TS debt scan: scan only edited JS/TS files with the repository runner or `~/dev/dev-help/agent-debt-scan.js` fallback.
- Live smoke checks: wrong-account OAuth attempt must be rejected if encountered; successful RUDI consent must yield `gmail_profile.emailAddress === rudi@learnrudi.com`; RUDI and Hoff Drive file IDs must differ.
- Independent review: fresh-context read-only review of task contract, instructions, diff, and verification evidence.
- Risk-tier approval: human completes OAuth identity selection and consent; no external send is performed.
- Exit criteria: no unresolved blocking finding and live read-only identity proof succeeds.

### Live Incident Discovery And Expanded Red-Green Loop

- The first verified `rudi@learnrudi.com` authorization still changed the bytes visible at the Hoff token path. Filesystem inspection proved that `accounts/rudi@learnrudi.com` was a symbolic link to `accounts/hoff@learnrudi.com`; the OAuth identity check was correct, but the two account paths shared storage.
- Expanded invariant: every direct account directory must be a real isolated directory, and an existing token path must be a regular, single-link file. Live or dangling symbolic links and hard links must fail before persistence.
- Additional red evidence:
  - `node --import tsx auth.test.cjs` failed with `ERR_MODULE_NOT_FOUND` before the account-storage isolation helper existed.
  - The token-link regression then failed because the existing writer followed a token symlink and changed its target.
  - The dangling-account regression failed because `existsSync` followed the dangling link instead of identifying the directory entry.
- Additional green evidence: direct `lstatSync` with `ENOENT`-only handling now detects live and dangling account/token symlinks; token hard links are rejected via link count; the focused auth test passes with linked targets preserved byte-for-byte.
- State repair: after validating the exact relative target and resolved destination, removed only the RUDI-to-Hoff symlink, retained the Hoff directory, created a private `0700` RUDI directory, and reauthorized Hoff and RUDI separately through the identity-verified flow.

## Phase 6: Docs, Contracts, And Closure

- Docs and contracts updated: README and manifest now define exact authenticated-primary-email binding plus dedicated, non-linked account/token storage.
- Final source files touched: stack README, manifest, package metadata/lockfile, `auth.ts`, `authIdentity.ts`, `authTokenBinding.ts`, `accountStorage.ts`, `auth.test.cjs`, generated `index.json`, and this checklist.
- Focused verification:
  - Original red command failed for the expected missing identity behavior; unchanged green command passed.
  - Expanded storage-alias red cases failed for the expected missing/link-following behaviors; final focused auth test passed.
  - `npm run build` and all seven stack test scripts passed for `google-workspace-mcp@1.0.2`.
- Registry verification:
  - `npm test`: 28 files and 246 tests passed.
  - `npm run validate`: 153 catalog packages passed.
  - `npm run indexes:sync` and `npm run indexes:check`: passed with current generated index.
  - `npm run build`: passed.
  - `npm pack --dry-run --json`: passed.
  - Targeted JS/TS debt scan: zero findings; `git diff --check`: passed.
  - `npm run catalog:clean:check`: still fails only for pre-existing `catalog/stacks/rudi-share/dist`; task-created Google Workspace build artifacts were removed.
- Live verification:
  - Installed local stack reports version `1.0.2`, indexes 68 tools, and is ready.
  - OAuth helper verified `hoff@learnrudi.com` and `rudi@learnrudi.com` independently before writing.
  - Gmail profiles returned their respective exact primary addresses, with materially different mailbox counts/history.
  - Account directories and token files are separate regular filesystem objects; token files have link count 1 and different checksums.
  - RUDI Drive returned zero files; Hoff Drive returned 20; overlapping file IDs were zero; active account was restored to RUDI.
- Independent review: initial warning and critical findings were addressed; final fresh-context review approved with no remaining blockers.
- External effects: no email sent and no Drive file mutated. The verified RUDI symlink alone was removed; its Hoff target was retained. Both mailboxes were reauthorized after isolation.
- Accepted debt: five moderate dependency audit findings and the unrelated `rudi-share/dist` hygiene artifact pre-existed this task. OAuth callback state/PKCE and atomic replacement remain separate hardening opportunities; linked storage is now rejected before write.
- Admin Mac: canonical registry checkout is clean at the same base revision. The user subsequently authorized the feature-branch commit, push, and draft-PR flow; the admin checkout and installed stack remain unchanged until the reviewed change is merged and distributed through the normal registry process.
- Final verdict: local runtime repair complete and live identity/storage separation proven. Canonical source fix is verified and approved for draft-PR publication.
- Definition of Done: local stack updated; both accounts independently authorized and verified; source publication authorized through normal Git review; no email sent.
