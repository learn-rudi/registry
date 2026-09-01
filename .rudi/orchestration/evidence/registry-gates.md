# Registry gate receipt

- Worktree diff SHA-256 before evidence-only closeout edits: `9d9cc219f67516a50af536c135b1f33aa26f58e3104356bfe11367d943bcbc8e`
- Root index SHA-256 after integration and the promotion-history correction: `a0757970a5f53b62e6823d3665147b19fd504d2ecf63f86f54309b2776316f33`

## Focused tests

Command: `npx vitest run src/portable-agentic-workflow-skills.test.ts src/project-orchestration-decision-frontier.test.ts src/rudi-chief-of-staff.test.ts`

Result: 3 files and 37/37 tests passed, including the hostile stored-receipt
completeness regression and the portable Decision Frontier authoring-contract
regression.

## Full tests

Command: `npm test -- --reporter=dot`
Exit status: `0`

```text
> @rudi/registry@2.0.1 test
> vitest run --reporter=dot

RUN  v4.0.16 /Users/hoff/RUDI/worktrees/registry/rudi-engineering-skills-20260831

Test Files  30 passed (30)
Tests       276 passed (276)
Duration    4.04s
```

## Package and index gates

```text
npm run validate
Exit 0
Found 167 catalog package file(s)
Results: 167 passed, 0 failed

npm run indexes:sync
Exit 0
Found 167 package(s)
skill: 80
catalog hash files: 872
Registry indexes synchronized.

npm run indexes:check
Exit 0
Environment: `SOURCE_DATE_EPOCH=1788227560`, derived from committed
`index.json.generatedAt` exactly as Registry CI does.
Found 167 package(s)
skill: 80
catalog hash files: 872
Registry indexes are current.

npm run catalog:clean:check
Exit 0
Planned 0 target(s); preserved 0.

npm run build
Exit 0
Validation: 167 passed, 0 failed
Compilation: 167 packages; 80 skills

npm run release:verify
Exit 0
Verified 7 release artifact SHA-256 hashes.

npm run validate:public -- --json
Exit 0
Errors: 0; warnings: 0; referenced packages: 167.

npm run stacks:verify -- --changed-from origin/main --prepare
Exit 0
No changed stacks require verification.

node --check catalog/skills/rudi-chief-of-staff/scripts/project-plan.mjs
Exit 0
Output: <empty>

git diff --check
Exit 0
Output: <empty>
```

## Package dry run

Command: `npm pack --dry-run --json`
Exit status: `0`

```text
id: @rudi/registry@2.0.1
entryCount: 1046
packed size: 2448395 bytes
unpacked size: 11153944 bytes
```

NPM emitted the repository's existing `.npmignore` fallback warnings. No
package archive was written by the dry run.

## Main-integration rerun

- GitHub issue: `learnrudi/registry#58`
- Integration base: `origin/main` at `ec7f53968e6d2ee69155b438e29cbba7e7dc8c0d`
- Current-main delta from the original skill-suite base: video-editor Metal
  whisper.cpp transcription from PR #56.
- The only cherry-pick conflict was generated `index.json`; it was resolved by
  the required `npm run indexes:sync` command against the combined catalog.
- The initial integrated review found that stored receipts could omit part of a
  source snapshot while recomputing the subset digest. The unchanged hostile
  test failed before the correction and passed after records gained explicit
  source-revision membership semantics and receipt validation required exact
  coverage of that revision.
- Focused confirmation then found that the portable Decision Frontier authoring
  contract omitted the new introduction-revision field. The contract regression
  failed before the documentation correction and passed after the workflow and
  reference required `introducedAtFrontierRevision` for new durable records and
  documented revision-1 compatibility for older state.
- Focused tests passed 37/37 and the full suite passed 276/276 after both
  corrections. Validation, deterministic index sync/check, catalog hygiene,
  build, release provenance, public readiness, changed-stack verification,
  syntax, whitespace, package dry-run, and debt scan all passed against the
  integrated tree. The configured debt scan reported zero findings.
