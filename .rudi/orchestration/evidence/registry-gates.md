# Registry gate receipt

- Worktree diff SHA-256 before evidence-only closeout edits: `9d9cc219f67516a50af536c135b1f33aa26f58e3104356bfe11367d943bcbc8e`
- Root index SHA-256: `231d18fdc3c6b0c38f701c4279c86390ce038ed0d7ecc0ba822fefc9bc27a892`

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
catalog hash files: 865
Registry indexes synchronized.

npm run indexes:check
Exit 0
Found 167 package(s)
skill: 80
catalog hash files: 865
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
