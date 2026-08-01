# Design System Extractor Bundled Skill SWE Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: publish a portable, bundled `design-system-extractor` skill that produces a design-system reference, DOCX, HTML, creative image prompts, and a provenance-aware marketing-copy library from a supplied website.
- Files inspected before editing: registry skill discovery/compiler/artifact code, legacy `index.json`, registry docs, source skill archive, and CLI installation/sync paths.
- Relevant doctrine: explicit boundaries and invariants, Appendix C red-green-refactor, dependency discipline, and failure design.
- Risks and invariants: preserve unrelated dirty-worktree changes; retain legacy flat-skill behavior; never register reference Markdown as an independent skill; keep public catalog content generic and portable; distinguish observed website copy from generated draft copy.
- Exit criteria: source archive and registry/CLI contracts understood and the bundle boundary documented.

## Phase 1: Scope Lock

- In scope: bundled skill discovery at `catalog/skills/<name>/SKILL.md`; artifact hashing and package publishing for bundled resources; legacy-index entry; portable skill instructions; extraction/build/verification scripts; example schema; registry documentation.
- Non-goals: running image generation inside the skill; publishing to Canva; changing unrelated stack behavior; bulk-copying website content without provenance.
- Expected files touched: `src/catalog.ts`, `src/catalog.test.ts`, `src/catalog-artifacts.ts`, `package.json`, `README.md`, `SCHEMA.md`, `index.json`, the new skill directory, and this checklist.
- Boundary inputs: untrusted website DOM/content and user- or model-authored JSON specifications. Scripts must validate required structure and fail with actionable messages.
- Exit criteria: no unrelated registry files are modified.

## Phase 2: Red Tests

- Observable behavior: a directory skill yields exactly one package whose install path is the bundle directory; nested reference Markdown is not misclassified as another skill.
- Red command: `npx vitest run src/catalog.test.ts`.
- Expected failure: current discovery derives skill identity from every nested Markdown file and installs only the entry file.
- Exit criteria: expected failing assertion observed before implementation.

## Phase 3: Implementation

- Implement the smallest compatible directory-skill branch while preserving flat Markdown skills.
- Include all bundle files in published artifacts and npm package contents.
- Keep `SKILL.md` host-neutral and put reusable implementation details in `scripts/` and `references/`.
- Exit criteria: unchanged red test passes and skill outputs can be generated from the example schema.

## Phase 4: Green Tests And Refactor

- Green command: rerun `npx vitest run src/catalog.test.ts` unchanged.
- Refactor only after green; rerun the targeted suite after cleanup.
- Exit criteria: no nested bundle resource becomes a package and legacy skill tests remain green.

## Phase 5: Full Verification

- Run registry tests, build/compile, v2/public validation, skill validator, HTML verifier, DOCX render check, and JS/TS debt scan.
- Run a local install smoke through the CLI after the companion installer change.
- Exit criteria: all feasible checks pass or known gaps are explicitly reported.

## Phase 6: Docs, Contracts, And Closure

- Update registry format documentation for both flat and bundled skills.
- Record red/green/full verification commands and preserve unrelated worktree state.
- Definition of Done: the catalog delivers a complete, portable skill bundle that produces the five promised user-facing artifacts.

## Execution Record

- Red: `npx vitest run src/catalog.test.ts` failed because the legacy discovery path derived the bundle package id from `SKILL.md` instead of the parent directory.
- Green: the unchanged targeted command passed all four catalog tests after bundled discovery was added.
- Skill validation: Codex's `quick_validate.py` reported `Skill is valid!` (PyYAML was installed only into `/tmp/rudi-skill-validator-deps` for the validator runtime).
- Artifact smoke: the example specification generated the creative prompt library, marketing-copy library, HTML guide, and DOCX guide. The HTML verifier passed with balanced tags and all checked values present.
- DOCX QA: the generated 10-page reference rendered successfully to PNG and PDF; all pages were visually inspected for clipping, overlap, row splits, and overflow. Header/footer text was also confirmed with `pdftotext -layout`.
- Full registry verification: `npm run build` passed with 92 packages, 701 hashed files, and 20 skills; `npm test` passed 112 tests across 13 files; `npm pack --dry-run --json` included the bundled entrypoint, scripts, and references.
- Public readiness: `npm run validate:public` reports three untracked catalog package paths. One is this new skill bundle and two are unrelated pre-existing worktree additions (`editorial-markup`); this check is expected to remain red until the intended files are staged. No files were staged by this work.
- Debt scan: the structural scan passed with zero findings when the package's real `validate`, `compile`, and `public-readiness` entrypoints were supplied.
- Worktree safety: unrelated registry changes and untracked packages were preserved without modification or cleanup.
