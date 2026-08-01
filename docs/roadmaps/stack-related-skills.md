# Stack-Related Skills Checklist

> **Status: active product roadmap.** This is planning material, not a catalog
> package or an implementation contract.

Purpose: capture the product and engineering work needed to make RUDI stacks feel like complete capability bundles: tools plus runtimes plus binaries plus connectors plus editable agent workflows.

## Product Thesis

A stack should be the 80% prebuilt capability bundle.

Users should get:

- runtime setup
- required binaries
- MCP or CLI tools
- connector and secret requirements
- schemas, templates, and examples
- companion skills that tell an agent how to use the stack well

Users should then customize the last 20%:

- edit the installed skills
- add their own stack-related skills
- tune workflows to their voice, team, brand, or process

Generic registry skills should therefore come ready to go, but remain editable
after install. The public default is the portable 80%; private/local skill
overlays hold personal voice, brand defaults, client paths, and approval rules.

The goal is that a non-technical user can work with an agent and say what they want done. The agent should use the stack to execute and the related skills to follow the right workflow.

## Vocabulary

- **Stack**: executable capability layer. Includes runtime, binaries, MCP server, CLI commands, schemas, connectors, and secret requirements.
- **Skill**: editable agent instruction layer. Explains how to think through and perform a workflow.
- **Stack-related skill**: a skill designed to use, feed, or guide a specific stack.
- **`provides.tools`**: MCP tools a stack exposes directly.
- **`related.skills`**: companion agent workflows commonly used with a package. These are not MCP tools.
- **`requires.stacks`**: dependency from a skill or workflow to the stack it needs.

## Current Concrete Example

Video stack:

```text
stack:video-editor
  tools:
    transcribe, captions, overlays, grading, render, QA
  related.skills:
    skill:shortform-your-words-script
```

Related skill:

```text
skill:shortform-your-words-script
  requires.stacks:
    stack:video-editor
```

Meaning:

- If a story starts from text, use the skill first to create the script and teleprompter.
- After the take is shot, use the video-editor stack to transcribe, correct, caption, overlay, grade, render, and QA.

Text-first flow:

1. Move or copy the inbox item into a new `0-pending` topic folder.
2. Save the author's raw thought as `source/raw.md`.
3. Use `skill:shortform-your-words-script` to create:
   - `scripts/script-short.md`
   - `scripts/script-short-teleprompter.txt`
4. Shoot the video from the teleprompter file.
5. File the take as `videos/source/shortform-take-N.mov`.
6. Then run the video-editor stack.

Dense-image overlay rule:

- Use full-screen overlays by default for reports, prompts, charts, study excerpts, screenshots, and anything people may screenshot.
- Treat these as 3-6 second source receipts or prompt cards.
- Use partial overlays only for quick proof or light visual context while the creator stays visible.

## Current State

- [x] Registry has top-level skills under `catalog/skills/{skill-id}.md`.
- [x] CLI installs skills into `~/.rudi/skills`.
- [x] CLI installs stacks into `~/.rudi/stacks`.
- [x] CLI already supports skills requiring stacks with `requires.stacks`.
- [x] Added `skill:shortform-your-words-script` as a registry skill.
- [x] Added `related.skills` to the v2 package schema.
- [x] Added `related.skills` type support in `src/resolver.ts`.
- [x] Added schema test coverage for `related.skills`.
- [x] Added `related.skills` docs in `SCHEMA.md`.
- [x] Added `requires.stacks` to the v2 package schema.
- [x] V2 validation derives skill packages from `catalog/skills/*.md` frontmatter.
- [x] V2 compile includes skills in generated `dist/index*.json`.
- [x] Registry validation enforces `related.skills` and `requires.stacks` referential integrity.
- [x] Added `skill:shortform-your-words-script` to `stack:video-editor` manifest.
- [x] Added matching `related.skills` entry to `index.json`.
- [x] Linked the skill from the video-editor README.
- [ ] CLI installer does not yet auto-install or offer stack-related skills when installing a stack.
- [ ] CLI list/info/status commands do not yet surface `related.skills` as a first-class relationship.
- [ ] Agent integration does not yet auto-load installed related skills when a stack is active.

## Files Already Touched

Registry schema and docs:

- `schemas/package.schema.json`
- `src/resolver.ts`
- `src/catalog.ts`
- `src/catalog.test.ts`
- `src/compile.ts`
- `src/validate.ts`
- `src/schema.test.ts`
- `src/compile.test.ts`
- `SCHEMA.md`

Video editor relationship:

- `catalog/stacks/video-editor/manifest.json`
- `catalog/stacks/video-editor/README.md`

Skill package:

- `catalog/skills/shortform-your-words-script.md`

Index:

- `index.json`

Personal Codex skill copy:

- `$CODEX_HOME/skills/shortform-your-words-script/SKILL.md`
- `$CODEX_HOME/skills/shortform-your-words-script/agents/openai.yaml`

## Verified So Far

- [x] `npm run validate` passes in `apps/registry`.
- [x] `npx vitest run src/schema.test.ts` passes.
- [x] `npm run test` passes.
- [x] `npm run compile` passes.
- [x] Fallback debt scan for edited registry TS files has no findings when run with registry script entrypoints.
- [x] `npm run validate:public -- --json` passes with 0 errors and 0 warnings.

## Design Decision

Use:

```json
"related": {
  "skills": ["skill:shortform-your-words-script"]
}
```

Do not use:

```json
"provides": {
  "skills": ["skill:shortform-your-words-script"]
}
```

Reason:

- The stack provides tools it can expose and run.
- The skill is a companion workflow, not an MCP tool.
- Keeping it under `related.skills` lets installers and agents discover the workflow layer without confusing execution capabilities with instruction files.

## Implementation Checklist

### 1. Registry Schema

- [x] Add top-level `related` field to `schemas/package.schema.json`.
- [x] Add `Related` schema definition.
- [x] Support `related.skills` as an array of `skill:*` package IDs.
- [x] Reject non-skill IDs in `related.skills`.
- [x] Keep `related` strict with `additionalProperties: false`.
- [x] Support `requires.stacks` as an array of `stack:*` package IDs.
- [ ] Consider future fields:
  - `related.workflows`
  - `related.stacks`
  - `related.prompts` only if prompt compatibility remains needed
  - `related.examples`

### 2. Registry Types

- [x] Add `Related` interface in `src/resolver.ts`.
- [x] Add `related?: Related` to `Package`.
- [x] Add `requires.stacks` to `Package`.
- [ ] If more registry package types are split into separate TS packages, propagate the type there too.
- [ ] Check CLI manifest validators for whether they need explicit `related` support.

### 3. Stack Manifest

- [x] Add `related.skills` to `catalog/stacks/video-editor/manifest.json`.
- [ ] Audit other stacks for obvious related-skill candidates.
- [ ] Do not add skills to `provides`.
- [ ] Keep each related skill as a standalone registry skill so users can install and edit it.

### 4. Skill Package

- [x] Add `catalog/skills/shortform-your-words-script.md`.
- [x] Include frontmatter with name, description, version, category, icon, tags, and `requires.stacks`.
- [x] Document the author-voice rule.
- [x] Require both `scripts/script-short.md` and `scripts/script-short-teleprompter.txt`.
- [x] Define teleprompter formatting rules.
- [x] Define shortform vs longform decision guidance.
- [ ] Add more video-editor-related skills later:
  - `source-overlay-card`
  - `caption-style-rules`
  - `shortform-render-qa`
  - `video-color-grade`
  - `prompt-card-overlay`

### 5. Registry Index

- [x] Add `skill:shortform-your-words-script` to `index.json`.
- [x] Add `related.skills` to the `stack:video-editor` entry in `index.json`.
- [ ] Decide whether `index.json` should be hand-maintained, generated from v2 manifests, or both.
- [x] Generated `dist/index*.json` includes registry skills and preserves `related`.
- [x] Add a test that `related.skills` IDs resolve to existing registry skills.
- [x] Add a test that skill `requires.stacks` IDs resolve to existing registry stacks.

### 6. CLI Installer Behavior

Current state:

- `rudi install skill:<id>` installs into `~/.rudi/skills/<id>.md`.
- `rudi install stack:<id>` installs into `~/.rudi/stacks/<id>/`.
- Installing a skill can resolve and install required stacks.
- Installing a stack does not yet resolve or offer related skills.

Needed:

- [ ] Teach dependency resolver about `related.skills`.
- [ ] Decide whether `related.skills` are installed automatically or offered interactively.
- [ ] Recommended behavior:
  - default: install required dependencies automatically
  - default: offer related skills with a yes/no prompt
  - `--with-related-skills`: install all related skills without prompting
  - `--no-related-skills`: skip related skills
  - `--json`: report related skills and planned action without interactive text
- [ ] When installing a stack, show:
  - stack tools
  - binaries/runtimes/secrets
  - related skills
  - install location for editable skills
- [ ] Ensure stack install output says related skills are editable in `~/.rudi/skills`.
- [ ] If a related skill already exists locally, do not overwrite unless `--force` or explicit confirmation.
- [ ] Preserve user-edited skills by default.

### 7. CLI List / Info / Status

- [ ] `rudi info stack:video-editor` should show related skills.
- [ ] `rudi list stacks` can show a compact related-skill count.
- [ ] `rudi list skills` already shows `requires.stacks`; keep that.
- [ ] `rudi status --json` should include installed stacks and installed related skills.
- [ ] `rudi check stack:video-editor` should optionally report missing related skills as non-blocking recommendations.

### 8. Editable Skill Customization

Needed user flow:

```text
rudi install stack:video-editor --with-related-skills
  -> installs stack into ~/.rudi/stacks/video-editor
  -> installs skill into ~/.rudi/skills/shortform-your-words-script.md

user edits:
  ~/.rudi/skills/shortform-your-words-script.md
```

Checklist:

- [ ] Ensure installed skills are plain Markdown and easy to edit.
- [ ] Make it clear edits are local user customizations.
- [ ] Add a way to compare local skill vs registry version.
- [ ] Add a way to reset a skill to registry version.
- [ ] Add a way to fork or duplicate a skill into a user-specific variant.
- [ ] Avoid overwriting local edits during stack upgrades.

### 9. Agent Discovery

Goal: any agent can use the stack and its related skills.

Needed:

- [ ] Define how RUDI exposes installed skills to Codex, Claude, Gemini, and other agents.
- [ ] Ensure router or instruction generation can include:
  - installed stack tools
  - installed related skills
  - stack-specific workflow hints
- [ ] For a stack-selected task, agents should discover related skills before inventing a workflow.
- [ ] Add an instruction generation path:
  - `rudi instructions codex`
  - `rudi instructions claude`
  - equivalent for other agents
- [ ] Decide whether related skills are always included or only included when the user names the stack/task.

### 10. Stack Upgrade Behavior

- [ ] Define how stack upgrades treat related skills.
- [ ] Do not overwrite user-edited local skill files by default.
- [ ] Track local skill source version if possible.
- [ ] Show upgrade notes:
  - new related skills available
  - old related skills removed from registry
  - local skills differ from registry version
- [ ] Consider a local metadata file:

```json
{
  "id": "skill:shortform-your-words-script",
  "sourceVersion": "1.0.0",
  "installedFrom": "stack:video-editor",
  "localEdits": true
}
```

### 11. Validation And Tests

Registry:

- [x] Schema accepts `related.skills`.
- [x] Schema test covers `related.skills`.
- [x] V2 validation passes.
- [x] Full registry tests pass.
- [x] Add invalid schema test for `related.skills` with a non-skill ID.
- [x] Add referential integrity test: each `related.skills` entry exists in catalog/index.
- [x] Add compile regression check that `related` is preserved in generated dist indexes.

CLI:

- [ ] Add unit tests for dependency resolution of stack-related skills.
- [ ] Add install test for stack with related skill.
- [ ] Add `--with-related-skills` test.
- [ ] Add `--no-related-skills` test.
- [ ] Add protection test for local skill edits.

Public readiness:

- [x] Commit or otherwise track newly referenced catalog skill paths.
- [x] Resolve existing checksum-placeholder failures.
- [ ] Remove or ignore secret-like files from publishable catalog.
- [ ] Decide whether root `index.json` remains hand-maintained or is generated from v2 catalog packages. It currently has fewer skills than `dist/index.json`.
- [x] Re-run `npm run validate:public -- --json`.

### 12. Documentation

- [x] Document `related.skills` in `SCHEMA.md`.
- [x] Link `skill:shortform-your-words-script` from the video-editor README.
- [x] Update `README.md` package model with stack-related skills.
- [ ] Update `CONTRIBUTING.md` with how to add a stack-related skill.
- [ ] Update `STACK_TEMPLATE.md` with optional `related.skills`.
- [ ] Update CLI docs:
  - installing stacks with related skills
  - editing installed skills
  - resetting installed skills
- [ ] Add one worked example:
  - install video-editor
  - customize shortform skill
  - create script
  - shoot take
  - render with video-editor

### 13. Product UX

- [ ] On stack install, show "This stack includes companion skills."
- [ ] Make related skills feel optional but recommended.
- [ ] Explain that skills are editable.
- [ ] Avoid technical language first. Use user-facing language:
  - "workflow"
  - "style guide"
  - "agent instructions"
  - "editable playbook"
- [ ] Include "how to talk to the agent" examples for each stack.
- [ ] Consider a generated local stack guide:

```text
~/.rudi/stacks/video-editor/GETTING_STARTED.md
```

This could list installed tools, related skills, example prompts, and customization paths.

## Open Questions

- Should stack-related skills install automatically by default, or only with confirmation?
- Should `related.skills` be non-blocking recommendations, or should some skills be required?
- Do we need both `requires.skills` and `related.skills`?
- Should a stack have a default primary skill?
- Should related skills be exposed in MCP router metadata?
- Should agents receive related skills through generated instructions or through MCP resource discovery?
- Should local user-edited skills live only in `~/.rudi/skills`, or should stack-specific variants live under `~/.rudi/stacks/<stack>/skills`?
- How should skill versioning work when a user edits the file?
- How does RUDI detect and preserve user edits during update?

## Recommended Next Build Order

1. Update CLI resolver to surface stack `related.skills`.
2. Decide whether stack install offers or auto-installs related skills.
3. Add install flags:
   - `--with-related-skills`
   - `--no-related-skills`
4. Add installer prompt for related skills.
5. Add local-edit protection for installed skills.
6. Add `rudi info stack:<id>` display for related skills.
7. Add agent instruction generation that includes installed stack-related skills.
8. Update `STACK_TEMPLATE.md` and `CONTRIBUTING.md`.
9. Re-run public readiness after tracked files and pre-existing blockers are handled.

## Commands To Re-Run

From `$REGISTRY_ROOT`:

```bash
npm run validate
npx vitest run src/schema.test.ts
npm run test
npm run compile
npm run validate:public
```

Debt scan fallback for edited registry TS files:

```bash
node "$DEV_HELP_ROOT/agent-debt-scan.js" \
  --repo "$REGISTRY_ROOT" \
  --entrypoint src/compile.ts \
  --entrypoint src/validate.ts \
  --entrypoint src/public-readiness.ts \
  --files src/catalog.ts,src/compile.ts,src/validate.ts,src/resolver.ts,src/public-readiness.ts \
  --json
```

## Known Current Caveats

- The registry worktree has many unrelated dirty and untracked files. Do not revert unrelated changes.
- The public-readiness check now passes; keep the staged catalog package additions with the schema/index changes.
- The video-editor stack still has unrelated unstaged local work in this checkout; do not revert it as part of this registry cleanup.
- Generated `dist/` files may change when running `npm run compile`; decide whether this repo tracks them before committing.

## Success Definition

This is complete when:

- Installing a stack can also install or offer its related skills.
- Related skills land in an editable local skill directory.
- User edits are preserved during updates.
- Agents can discover stack tools and stack-related skills together.
- Registry schema, CLI behavior, docs, and tests all describe the same model.
- A non-technical user can install a stack, customize the workflow skill, and ask an agent to use the stack without knowing the underlying binaries, MCP details, or render commands.
