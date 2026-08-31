# Registry gate receipt

- Worktree diff SHA-256 before evidence-only closeout edits: `9d9cc219f67516a50af536c135b1f33aa26f58e3104356bfe11367d943bcbc8e`
- Root index SHA-256 after integration onto current main: `0f5682874ef6bcfc721ccfa01b4ac064b5db32b6bc2fe19cf455ba50882b36b4`

## Full tests

Command: `npm test -- --reporter=dot`
Exit status: `0`

```text
> @rudi/registry@2.0.1 test
> vitest run --reporter=dot

RUN  v4.0.16 /Users/hoff/RUDI/worktrees/registry/rudi-engineering-skills-20260831

Test Files  30 passed (30)
Tests       274 passed (274)
Duration    4.39s
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
entryCount: 1039
packed size: 2436645 bytes
unpacked size: 11100786 bytes
```

NPM emitted the repository's existing `.npmignore` fallback warnings. No
package archive was written by the dry run.

## Main-integration rerun

- GitHub issue: `learnrudi/registry#58`
- Integration base: `origin/main` at `ec7f53968e6d2ee69155b438e29cbba7e7dc8c0d`
- The only cherry-pick conflict was generated `index.json`; it was resolved by
  the required `npm run indexes:sync` command against the combined catalog.
- Focused tests passed 35/35 and the full suite passed 274/274 after the
  integration.
- Validation, index sync/check, catalog hygiene, build, plan/evidence
  verification, whitespace, package dry-run, and debt gates were rerun against
  the integrated tree. The current results and any unchanged disclosed debt are
  recorded in the issue and pull request evidence ledger.
