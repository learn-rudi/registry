# `map-change-impact` Skill Publication Checklist

## Phase 0: Baseline And Manual Lookup

- Scope: recover and publish the follower-only portable `map-change-impact` skill, OpenAI interface metadata, and Registry contract test.
- Recovery base: Registry PR #36 (`test/29-dwellow-live-contract`). Exact follower state is preserved at checkpoint `635989a7d941271450c92f5ead292ab139fd0fdc`.
- Instructions read: repository guidance, `skill-creator/SKILL.md`, its `openai.yaml` reference, Registry skill validation/tests, and recovered skill/test files.
- Invariants: the skill maps proposed work rather than implementing it; it remains repository-agnostic; claims cite inspected evidence; output identifies exact paths, ordered actions, dependencies, tests, risks, and unknowns; metadata is portable and deterministic.
- Exit criteria: the recovered contract test demonstrates the absent skill on the unchanged base.

## Phase 1: Scope Lock

- In scope: `catalog/skills/map-change-impact/{SKILL.md,agents/openai.yaml}`, `src/map-change-impact.test.ts`, this checklist, and generated `index.json`.
- Non-goals: repository implementation changes, host-specific paths/defaults, external mutation, new dependencies, or unrelated Registry refactors.
- Failure behavior: report evidence gaps as unknowns; never invent paths, symbols, owners, or verification commands; do not imply authorization to implement the mapped change.
- Exit criteria: only the listed paths change.

## Phase 2: Red Test

- Run the recovered focused Registry test against the unchanged base.
- Expected failure: missing catalog skill files/package entry—not syntax, fixture, or dependency failure.
- Exit criteria: the expected red reason is recorded.

## Phase 3: Implementation Recovery

- Restore the skill, metadata, and contract test without changing their intended workflow.
- Validate YAML/frontmatter, naming, description discrimination, default prompt, portability, and absence of scaffold placeholders.
- Exit criteria: `quick_validate.py` and the focused contract test pass.

## Phase 4: Green Tests And Refactor

- Run the unchanged focused test and Registry portable-skill validation.
- Refactor only if validation exposes a concrete portability or instruction-quality defect.
- Exit criteria: skill behavior and metadata contracts are green.

## Phase 5: Full Verification

- Run Registry tests, validation, build, index sync/check, clean-worktree catalog hygiene, package dry-run, JS debt scan, and path/secret/absolute-host scans.
- Exit criteria: all applicable gates pass or a precise blocker is recorded.

## Phase 6: Docs And Closure

- Record exact proof, changed paths, PR, and CI state.
- Definition of Done: the portable skill is discoverable, validated, evidence-led, non-mutating by default, and published as a focused reviewable submission.

## Execution Record

- Status: publication verification in progress on 2026-08-19 ET.
- Red: the recovered focused test ran against the unchanged base and failed all three cases because `SKILL.md` and `agents/openai.yaml` were absent.
- Green: the unchanged focused test passed 3/3 after recovery.
- Skill validation: bundled `quick_validate.py` passed; YAML parsed; the 45-character short description is within the 25–64 character UI range; the default prompt explicitly invokes `$map-change-impact`.
- Skill-creator review: the self-contained two-file skill structure is sufficient; automatic invocation remains at its default; no placeholder directories, duplicated README, scripts, references, assets, or explicit-only policy were added.
- Registry gates: 29 test files / 248 tests passed; 153/153 packages validated; build/compile passed with 68 skills and 48 stacks.
- Portability/safety: no absolute host path, personal default, risky filename, or secret-pattern addition was found. The scoped JS debt scan reported zero findings.
