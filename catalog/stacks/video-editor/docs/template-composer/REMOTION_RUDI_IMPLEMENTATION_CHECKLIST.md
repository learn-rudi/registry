# Remotion RUDI Implementation Checklist

Version: `0.1.0`

Purpose: define the engineering checklist for adding a Remotion-based video
composition/rendering capability to RUDI without mixing it into
`video-generator`.

This is a planning and implementation runbook for the template-composer module
inside the installable `video-editor` registry stack.

## Decision

Build Remotion as a deterministic video-composition module inside
`video-editor`.

- `video-generator`: AI provider generation with Gemini/Veo, Replicate, and
  optional Sora legacy paths.
- `video-editor` template composer: code/data/template rendering with Remotion,
  React, Chromium, and FFmpeg.

Remotion's official MCP server is useful as a development helper because it
indexes Remotion docs for coding agents. It is not the runtime contract for
RUDI rendering. RUDI should expose its own stable MCP tools and keep Remotion
implementation details behind that boundary.

## Source References

- SWE build order: `09-Build-Order-and-Engineering-System.md` from the local SWE Operating Manual.
- API standard: `05-API-Engineering-Standard.md` from the local SWE Operating Manual.
- Remotion MCP docs: `https://www.remotion.dev/docs/ai/mcp`
- Remotion docs root: `https://www.remotion.dev/docs/`

## Build Order

Follow the SWE manual sequence:

```text
Schema -> Operations -> APIs -> Rendering Runtime -> Agents/Automation
```

For this stack, "schema" means the template registry, render request contract,
render result envelope, asset policy, and output metadata format.

## Phase 0: Pre-Development Decisions

- [x] Consolidate the implementation into the registry-wide
  `catalog/stacks/video-editor/` stack.
- [ ] Keep all Remotion code out of `video-generator`.
- [ ] Keep all AI video-provider SDK code out of the `video-editor` template
  composer.
- [ ] Decide first template family:
  - [ ] `stat-card-short`
  - [ ] `playbook-story`
  - [ ] `quote-reel`
  - [ ] `lower-third-overlay`
- [ ] Decide first output formats:
  - [ ] `story` - 9:16, short-form vertical
  - [ ] `landscape` - 16:9
  - [ ] `square` - 1:1, only if there is a real use case
- [ ] Confirm Remotion licensing and production usage requirements before
  shipping commercial rendering.
- [ ] Confirm local runtime requirements: Node, Remotion, Chromium, FFmpeg, and
  fonts.

## Phase 1: Schema

### Template Registry Schema

Create one canonical template catalog. Do not duplicate template metadata in
components, docs, tests, and CLI commands.

Required fields per template:

```json
{
  "template_id": "stat-card-short",
  "label": "Stat Card Short",
  "version": "0.1.0",
  "composition_id": "StatCardShort",
  "status": "beta",
  "formats": ["story"],
  "fps": 30,
  "duration_seconds": 15,
  "data_schema": {},
  "asset_schema": {},
  "notes": "Animated stat reveal for short-form social video."
}
```

Checklist:

- [ ] `template_id` is stable, lowercase, and kebab-case.
- [ ] `composition_id` matches the Remotion registered composition.
- [ ] `version` changes when data requirements or visuals change materially.
- [ ] `formats` are constrained to stack-owned values.
- [ ] `fps` is explicit.
- [ ] `duration_seconds` is explicit or has a bounded override policy.
- [ ] `data_schema` is JSON-schema-like and enforced before render.
- [ ] `asset_schema` lists required and optional assets by logical name.
- [ ] `status` is one of `draft`, `beta`, `current`, or `deprecated`.
- [ ] Template metadata lives in one module or JSON file only.

### Render Request Schema

Initial normalized request:

```json
{
  "template_id": "stat-card-short",
  "format": "story",
  "data": {
    "eyebrow": "Labor market",
    "headline": "77% of teams are rewriting workflows",
    "stat": "77%",
    "caption": "AI adoption changes the operating model."
  },
  "assets": {
    "brand_mark": "/Users/example/.rudi/assets/rudi-mark.png"
  },
  "audio_path": "/Users/example/.rudi/assets/bed.wav",
  "out_path": "/Users/example/.rudi/outputs/rudi-stat-card.mp4"
}
```

Checklist:

- [ ] `template_id` is required.
- [ ] `format` defaults to `story`, but is validated against template support.
- [ ] `data` is a JSON object and must match the template data schema.
- [ ] `data_path` may be added later, but do not support both `data` and
  `data_path` until conflict rules are defined.
- [ ] `assets` values are local file paths only in v1.
- [ ] Remote asset URLs are rejected in v1 unless a downloader/cache policy is
  designed first.
- [ ] `audio_path` is local only and optional.
- [ ] `out_path` must resolve under `~/.rudi/outputs`.
- [ ] Existing output files are never overwritten.
- [ ] Every schema in `server.py` uses `additionalProperties: false`.
- [ ] Provider-specific or Remotion-specific flags are not exposed in the MCP
  schema until they are normalized.

### Render Job Schema

Render jobs are local async jobs, not provider jobs.

Required job fields:

- [ ] `job_id`
- [ ] `template_id`
- [ ] `status`: `queued`, `rendering`, `completed`, `failed`, `canceled`
- [ ] `progress`: integer 0-100 where available
- [ ] `out_path`
- [ ] `metadata_path`
- [ ] `created_at`
- [ ] `completed_at`
- [ ] redacted `error` object on failure

### Output Metadata Schema

Every rendered video gets a sidecar:

```json
{
  "schema": "rudi.video-editor.template-output.v1",
  "video_path": "/Users/example/.rudi/outputs/rudi-stat-card.mp4",
  "template_id": "stat-card-short",
  "template_version": "0.1.0",
  "composition_id": "StatCardShort",
  "format": "story",
  "fps": 30,
  "duration_seconds": 15,
  "input_hash": "sha256:...",
  "remotion_version": "4.x",
  "renderer": "remotion",
  "created_at": "2026-05-17T00:00:00Z"
}
```

Checklist:

- [ ] Metadata schema is versioned.
- [ ] Input hash excludes absolute local paths where possible.
- [ ] Metadata includes template version and Remotion version.
- [ ] Metadata is written only after output validation passes.
- [ ] Metadata path cannot overwrite an existing file.

## Phase 2: Operations

Initial operations:

- `video_list_templates`
- `video_render_template`
- `video_get_render_job`

Operation checklist:

- [ ] `video_list_templates` reads static metadata only.
- [ ] `video_list_templates` performs no rendering.
- [ ] `video_render_template` validates request schema before touching
  Remotion.
- [ ] `video_render_template` resolves template and format before asset checks.
- [ ] `video_render_template` validates local asset paths and byte signatures.
- [ ] `video_render_template` writes only under `~/.rudi/outputs`.
- [ ] `video_render_template` creates a local render job record before render.
- [ ] `video_render_template` can run synchronously for short renders only if
  the timeout contract is explicit.
- [ ] Long renders use job polling through `video_get_render_job`.
- [ ] `video_get_render_job` returns pending status without writing duplicate
  output.
- [ ] Completed jobs return output metadata and validated file details.
- [ ] Failed jobs return structured, redacted errors.
- [ ] Retrying with an existing output path fails before rendering.

Failure behavior:

- [ ] Invalid template id returns `validation`.
- [ ] Unsupported format/template combo returns `unsupported_combo`.
- [ ] Invalid data schema returns `validation` with field details.
- [ ] Missing asset returns `validation`.
- [ ] Invalid asset bytes return `validation`.
- [ ] Render timeout returns `timeout` with `job_id`.
- [ ] Remotion render failure returns `render_failed`.
- [ ] Output validation failure returns `render_failed`.
- [ ] File write failure returns `write_failed`.
- [ ] Unexpected exception returns `internal_error` with secret/path redaction
  where appropriate.

## Phase 3: API Boundary

Keep `src/server.ts` or equivalent as the MCP boundary only:

- [ ] Tool schemas.
- [ ] `additionalProperties: false`.
- [ ] Dispatch to orchestration module.
- [ ] Safe exception redaction.
- [ ] No Remotion rendering logic.
- [ ] No template component imports.
- [ ] No child process command construction.

Keep orchestration separate:

- [ ] `src/tools.ts` or `src/tools.js` owns public tool orchestration.
- [ ] `src/validation.ts` owns request validation.
- [ ] `src/template_registry.ts` owns template metadata.
- [ ] `src/render_jobs.ts` owns render job lifecycle.
- [ ] `src/outputs.ts` owns output paths and media validation.
- [ ] `src/remotion_runtime.ts` owns Remotion command execution.
- [ ] `remotion/Root.tsx` registers compositions only.
- [ ] `remotion/compositions/*` contains visual templates only.

Initial MCP tools:

```text
video_list_templates
video_render_template
video_get_render_job
```

Stable envelope:

```json
{
  "ok": true
}
```

Error envelope:

```json
{
  "ok": false,
  "error_kind": "validation",
  "message": "Human-readable remediation.",
  "field": "template_id"
}
```

Allowed initial `error_kind` values:

- [ ] `validation`
- [ ] `unsupported_combo`
- [ ] `render_failed`
- [ ] `timeout`
- [ ] `write_failed`
- [ ] `unknown_tool`
- [ ] `internal_error`

## Phase 4: Rendering Runtime

Remotion runtime checklist:

- [ ] Render commands are executed with argument arrays, not shell strings.
- [ ] Working directory is explicit.
- [ ] Render timeout is explicit.
- [ ] Max concurrent renders is explicit.
- [ ] Progress is captured if Remotion exposes it through the chosen API.
- [ ] Chromium cache/temp paths are controlled.
- [ ] Output codec/container is explicit.
- [ ] FFmpeg validation runs after render.
- [ ] Render logs are captured and redacted.
- [ ] Rendered MP4/WebM bytes are validated before success response.

Composition checklist:

- [ ] Every template has sample data.
- [ ] Every template has a data schema.
- [ ] Every template has supported formats listed in the registry.
- [ ] No template reads arbitrary files directly.
- [ ] Assets are passed through validated props.
- [ ] No network fetches inside compositions in v1.
- [ ] Layout is deterministic for a given input.
- [ ] Randomness requires an explicit seed.
- [ ] Text uses fit/measure logic so long words do not overflow.
- [ ] Visual frames are checked for nonblank output.
- [ ] First and last frame are checked for coherent layout.
- [ ] Fonts are bundled or explicitly declared as runtime prerequisites.

Suggested initial file layout:

```text
video-editor/
  docs/template-composer/
    REMOTION_RUDI_IMPLEMENTATION_CHECKLIST.md
    API_CONTRACT.md
    READINESS_AUDIT.md
    DEBT_GUARDRAILS.md
  src/template-composer/
  manifest.json
  package.json
  src/
    server.ts
    tools.ts
    errors.ts
    constants.ts
    validation.ts
    template_registry.ts
    render_jobs.ts
    outputs.ts
    remotion_runtime.ts
  remotion/
    Root.tsx
    compositions/
      StatCardShort.tsx
      PlaybookStory.tsx
      QuoteReel.tsx
    elements/
      Background.tsx
      HookText.tsx
      StatReveal.tsx
      LowerThird.tsx
    theme.ts
  samples/
    stat-card-short.json
  tests/
    test_tools.ts
    test_mcp_stdio.ts
    test_render_smoke.ts
```

## Phase 5: Testing and Verification

Default tests:

- [ ] Template registry snapshot test.
- [ ] Schema validation success tests.
- [ ] Schema validation negative tests.
- [ ] Unsupported format/template combo tests.
- [ ] Missing asset tests.
- [ ] Existing output path rejection test.
- [ ] MCP stdio tool listing test.
- [ ] Fake render runtime success test.
- [ ] Fake render runtime failure test.
- [ ] Job pending/completed/failed tests.
- [ ] Output metadata write/read tests.

Render smoke tests:

- [ ] Render one 2-3 second sample MP4 for each current template.
- [ ] Validate MP4/WebM container with `ffprobe`.
- [ ] Validate width/height matches requested format.
- [ ] Validate duration is within tolerance.
- [ ] Extract at least first/middle/last frames.
- [ ] Check frames are nonblank.
- [ ] Check text is visible and not clipped on mobile formats.
- [ ] Keep generated videos out of git.

Suggested commands:

```bash
npm run typecheck
npm test
npm run render:smoke
npm run validate
```

Registry validation:

```bash
cd /path/to/rudi/apps/registry
npm run validate
```

## Phase 6: Installation and Release

Registry stack checklist:

- [ ] Add `manifest.json`.
- [ ] Runtime is Node, not Python.
- [ ] Required binaries are declared if needed.
- [ ] Secrets are not required for deterministic rendering.
- [ ] Optional future AI extraction secrets are not added until that feature
  exists.
- [x] `catalog/stacks/README.md` lists `video-editor` as the owner of
  template rendering.
- [x] `index.json` does not include a separate composer stack.
- [ ] Registry validation passes.
- [ ] Install smoke runs `video_list_templates`.
- [ ] Render smoke writes one MP4 under `~/.rudi/outputs`.

## Phase 7: Agents and Automation

Do not build agent automation until the rendering API is stable.

Future agent workflows:

- [ ] `insight_html_to_video_brief`: extract stat/headline/quote candidates
  from an insight page.
- [ ] `brief_to_render_requests`: map a brief into one or more template render
  requests.
- [ ] `social_cut_batch`: render story, landscape, and lower-third variants
  from one data file.
- [ ] `publish_pack_manifest`: emit a manifest of files ready for review.

Agent rules:

- [ ] Agent-produced data is treated as untrusted input.
- [ ] Agent outputs must pass the same template data schemas.
- [ ] Agents do not bypass asset validation.
- [ ] Agents do not overwrite existing outputs.
- [ ] Batch jobs are resumable and idempotent.

## Debt Guardrails

Non-negotiable separation rules:

- [ ] No Remotion code in `video-generator`.
- [ ] No AI provider SDK code in the `video-editor` template composer.
- [ ] No template metadata duplicated in multiple files.
- [ ] No one-off templates without data schemas.
- [ ] No shell-string render commands.
- [ ] No remote asset fetches until a cache and validation policy exists.
- [ ] No silent fallback to a different template, format, or output extension.
- [ ] No generated videos, caches, or temp files committed.

Duplication checks before merge:

```bash
rg -n "video_list_templates|video_render_template|video_get_render_job|template_id|render_failed" src remotion tests
find . \( -name "node_modules" -o -name ".remotion" -o -name "out" -o -name "renders" \) -maxdepth 4 -print
```

Review checklist:

- [ ] One public render orchestration function.
- [ ] One template registry source.
- [ ] One output path policy source.
- [ ] One render job lifecycle source.
- [ ] One Remotion runtime boundary.
- [ ] Docs describe current implementation, not aspirational behavior.
- [ ] Tests cover the public contract and failure paths.

## Debt Acceptance Log

Use this table only for explicit, time-boxed debt.

| Date | Area | Accepted debt | Owner/next action |
|---|---|---|---|
| 2026-05-17 | Project shape | Start as planning docs only, not an installable stack. | Add manifests and source only when implementation begins. |
| 2026-05-17 | Automation | Insight extraction is deferred. | Build deterministic render path first. |

## First Implementation Exit Criteria

The first usable Remotion/RUDI implementation is done only when all of these
are true:

- [ ] `video_list_templates` returns at least one real template.
- [ ] `video_render_template` renders a valid MP4 under `~/.rudi/outputs`.
- [ ] `video_get_render_job` reports pending and completed render states.
- [ ] Output metadata sidecar is written and validated.
- [ ] Existing output paths are not overwritten.
- [ ] Invalid template data is rejected before render.
- [ ] Unsupported formats are rejected before render.
- [ ] Render failures return structured `render_failed` errors.
- [ ] Unit, MCP stdio, and render smoke tests pass.
- [ ] Registry validation passes after manifests are added.
- [ ] No generated assets, caches, or local output files are left in the stack.
