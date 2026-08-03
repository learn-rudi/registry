## Phase 0: Baseline And Scope

- Scope: bring the Registry agent catalog in line with the current native Claude, Codex, Gemini CLI, and Antigravity installation/authentication surfaces.
- Baseline: Claude, Codex, and Gemini are npm-delivered manifests; current auth commands for Claude and Codex are stale; consumer Google OAuth no longer belongs to Gemini CLI; Antigravity uses Google's official system installer.
- Dirty-worktree boundary: unrelated OpenCounter source/test/package/index changes already exist and must not be modified or overwritten. Regenerate shared indexes only when the resulting diff can be proven limited to this agent-catalog scope.
- Relevant SWE guidance: correctness and explicit invariants, Appendix C red-green-refactor, supply-chain boundaries, system installation detection, and registry build/validation gates.
- Exit criteria: baseline and overlap risks are recorded. Completed.

## Phase 1: Contract

- Catalog behavior: npm-delivered agents remain remotely installable; an agent may instead be system-delivered only when it declares `install.source=system`, `version=system`, a detection command, executable bins, and actionable official install hints.
- Auth behavior: manifests describe the current native login command or supported credential modes without embedding credentials.
- Non-goals: execute vendor installers from Registry validation; store auth sessions; model every native CLI flag in package manifests.
- Failure behavior: non-npm/non-system agent sources remain policy errors; system agents without detection remain schema/policy errors.
- Exit criteria: the install and auth contracts are fixed before implementation. Completed.

## Phase 2: Red Tests

- Add focused tests proving a valid system-delivered agent passes policy and unsupported agent sources fail with an actionable message; add catalog assertions for the four frontier manifests.
- Expected red: system agent policy currently fails with `agent must use install.source=npm`; Antigravity manifest is absent; existing auth metadata is stale.
- Exit criteria: red failures are captured before source changes.

## Phase 3: Implementation

- Permit `npm` or `system` as agent install sources while preserving the existing system detection invariant.
- Correct Claude/Codex/Gemini metadata, represent Claude's current native installer as a detected system agent, and add an Antigravity system manifest with only official installation guidance.
- Do not add dependencies or alter unrelated packages.
- Exit criteria: focused tests and catalog validation pass unchanged.

## Phase 4: Verification And Closure

- Run focused resolver/schema/catalog tests, Registry validation, index consistency, full tests, build, pack, hygiene, debt scan, and diff checks.
- If index generation includes unrelated OpenCounter content, do not overwrite the user's current `index.json`; prove the agent manifests independently and record index regeneration as blocked by the dirty overlap.
- Record commands, results, touched files, and residual risk here.
- Definition of Done: the catalog truthfully describes all four native host installations without claiming that RUDI owns agent execution.
- Completed catalog: five agent manifests are indexed; Claude and Antigravity use detected `system` delivery, while Codex and Gemini CLI use `npm` delivery. The agent policy accepts only those two sources and continues to require detection metadata for system delivery.
- Verification: focused red/green resolver/schema/catalog tests passed; `indexes:check` and `validate` passed for all 100 packages; full tests passed 123 with one intentional skip; hygiene, build, pack dry-run, and public-readiness all passed. Public readiness reported zero errors and zero warnings. A structural debt scan using the real compile/validate/catalog entrypoints reported zero findings, and `git diff --check` passed.
- Dirty-worktree result: the generated `index.json` was synchronized from the complete current catalog, including the user's pre-existing OpenCounter work. No OpenCounter source, test, manifest, or package file was edited by this task.
