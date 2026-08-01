# Video Generator Development Workflow

Version: `0.1.0`

This document is the working checklist for building and evolving the
`video-generator` stack. It follows the SWE Operating Manual build order:

```text
Schema -> Operations -> APIs -> Provider Runtime -> Agents/Automation
```

For this MCP stack, "schema" means the tool contract and normalized field
model, not a database schema.

## Phase 0: Pre-Development Discovery

Goal: prove the provider landscape and installation assumptions before changing
the runtime behavior.

- [x] Keep video generation as a separate stack from `image-generator`.
- [x] Confirm the first tool contract before provider implementation.
- [x] Reuse existing RUDI secret names where possible.
- [x] Treat `GEMINI_API_KEY` as canonical for Gemini/Veo.
- [x] Use one Gemini secret name for this stack: `GEMINI_API_KEY`.
- [x] Keep OpenAI/Sora as legacy optional, not default.
- [x] Treat Replicate models as beta/model-specific adapters.
- [x] Treat fal models as beta hosted endpoints with explicit mode mappings.
- [x] Run one live Gemini/Veo smoke test with a configured paid key.
- [x] Confirm which Replicate video model should be production default after
  live tests: Seedance Fast is the best default beta candidate so far.

Provider sources checked on 2026-05-17 and 2026-05-18:

- Gemini/Veo: https://ai.google.dev/gemini-api/docs/video
- OpenAI/Sora: https://platform.openai.com/docs/guides/video-generation
- OpenAI model catalog: https://developers.openai.com/api/docs/models/all
- Replicate official models: https://replicate.com/docs/topics/models/official-models
- Seedance on Replicate: https://replicate.com/bytedance/seedance-1-pro/api
- fal video generation API: https://fal.ai/docs/model-api-reference/video-generation-api/overview
- fal Seedance 2.0 Fast: https://fal.ai/docs/model-api-reference/video-generation-api/bytedance-seedance-2.0-fast

Provider onboarding lives in `PROVIDER_ONBOARDING.md`. Live test commands live
in `LIVE_SMOKE_TESTS.md`.

Current interpretation:

- Gemini/Veo is the default provider because it exposes a documented
  long-running video generation API.
- OpenAI still exposes Videos API docs for Sora, but the current model catalog
  marks Sora 2 and Sora 2 Pro as deprecated/legacy. Keep it optional and do not
  promote it without a new provider decision.
- Replicate gives access to several hosted video models, including Seedance and
  MiniMax/Hailuo. Their schemas differ, so each adapter must be explicit.
- fal hosts current Seedance 2.0 endpoints with queue semantics. Endpoint ids
  are mode-specific, so the adapter maps normalized modes explicitly.

## Phase 1: Contract Schema

Goal: define the normalized MCP schema before any provider-specific logic.

Canonical file:

- `API_CONTRACT.md`

Required tools:

- `list_video_models`
- `generate_video`
- `get_video_job`

Contract checklist:

- [x] Every request field is normalized and provider-portable.
- [x] `server.py` schemas use `additionalProperties: false`.
- [x] `provider` is constrained to known providers.
- [x] `format` is constrained to stack-owned content formats.
- [x] `duration_seconds` is constrained before provider dispatch.
- [x] `mode` is constrained to normalized input modes before provider dispatch.
- [x] `references` are local files only.
- [x] `input_image` and `end_image` are local image files only.
- [x] `source_video` is a local MP4/WebM file only.
- [x] Output paths must resolve under `~/.rudi/outputs`.
- [x] Every tool returns the stable `{ "ok": boolean }` envelope.
- [x] Errors use machine-readable `error_kind`.
- [x] Async jobs expose status through `get_video_job`.

Exit criteria:

- [x] Contract examples match `server.py` schemas.
- [x] `tests/test_mcp_stdio.py` verifies tool names over stdio.
- [x] Negative schema paths are covered in `tests/test_tools.py`.

## Phase 2: Operation Logic

Goal: make the domain operations explicit before adding provider details.

Operations:

- `list_video_models`: build static metadata and secret readiness without API calls.
- `generate_video`: validate, resolve model, submit job, poll, download, validate,
  write output, return stable metadata.
- `get_video_job`: fetch job state, return pending state or download completed
  video.

Operation checklist:

- [x] Input validation lives in `src/validation.py`.
- [x] Model resolution lives in `src/model_registry.py`.
- [x] Defaults and beta/current labels live in `src/model_config.py`.
- [x] Provider construction and secret lookup live in `src/provider_runtime.py`.
- [x] Polling lives in `src/jobs.py`.
- [x] Output path and byte validation live in `src/outputs.py`.
- [x] Output provenance metadata sidecars live in `src/outputs.py`.
- [x] Public orchestration lives in `src/tools.py`.
- [x] Provider SDK behavior lives only in `src/renderer/*_client.py`.

Failure behavior checklist:

- [x] Missing provider secrets return `missing_secret`.
- [x] Unsupported model/reference/duration combos return `unsupported_combo`.
- [x] Unsupported model/mode combos return `unsupported_combo`.
- [x] Unsupported source-image aspect ratios return `unsupported_combo` before
  provider dispatch for models that follow source image shape.
- [x] Provider job timeout returns `timeout` with `job_id` when available.
- [x] Failed provider jobs return `provider_error`.
- [x] Invalid output paths return `validation`.
- [x] Gemini extension sources without required sidecar metadata return
  structured validation/unsupported-combo errors before a useful provider call.
- [x] Invalid video bytes return `provider_error`.
- [x] Failed writes return `write_failed`.

Exit criteria:

- [x] Each provider has a fake-client unit test for submit, pending, completed,
  failed, and timeout flows.
- [x] Live provider tests are clearly separated from default unit tests.

## Phase 3: API Boundary

Goal: keep the MCP boundary thin and stable.

Boundary rules:

- [x] `src/server.py` defines tool schemas.
- [x] `src/server.py` dispatches only to `tools.py`.
- [x] `src/server.py` redacts configured secret values from unexpected errors.
- [x] `src/server.py` does not import provider clients directly.
- [x] `src/server.py` does not contain provider SDK request logic.

Schema evolution rules:

- [x] Additive optional fields require contract docs and tests.
- [ ] Required field changes require a version note in `API_CONTRACT.md`.
- [x] Response shape changes require snapshot-style test updates.
- [ ] New providers must appear in `model_config.py`, `renderer/providers.py`,
  manifests, docs, and tests in the same change.

Exit criteria:

- [x] MCP stdio smoke passes after every schema change.
- [x] `API_CONTRACT.md`, `server.py`, and tests agree.

## Phase 4: Provider Runtime

Goal: keep provider complexity isolated.

Provider checklist:

- [x] Gemini/Veo adapter exists in `src/renderer/gemini_client.py`.
- [x] Replicate beta adapter exists in `src/renderer/replicate_client.py`.
- [x] OpenAI legacy adapter exists in `src/renderer/openai_client.py`.
- [x] fal beta adapter exists in `src/renderer/fal_client.py`.
- [x] Provider selection lives in `src/renderer/providers.py`.
- [x] Provider model metadata does not live in provider clients.
- [x] Gemini input modes are explicitly mapped: text, image, interpolate,
  references, and extend.
- [x] Live Gemini smoke test validates real output download.
- [x] Live Gemini image/reference/interpolation/extension smokes validate real outputs.
- [x] Live Replicate smoke test validates the selected beta default.
- [x] Live fal Seedance 2.0 Fast text smoke succeeds.
- [x] Live fal Seedance 2.0 Fast image smoke succeeds.
- [x] Live fal Seedance 2.0 Fast interpolation smoke succeeds.
- [x] Live fal Seedance 2.0 Fast reference smoke succeeds.
- [ ] Live OpenAI smoke test is optional and gated because Sora is legacy/deprecated.

Provider promotion rules:

- A model can be marked `current` only after live generation, output validation,
  and at least one failed-job path are tested.
- A model stays `beta_hosted` if its API schema is model-specific or hosted by a
  marketplace rather than a stable provider-level video API.
- A model stays `preview` if the provider labels the API/model as preview.
- A model stays `legacy` or `legacy_deprecated` if the provider catalog marks
  it legacy or deprecated, even if an API guide still exists.

## Phase 5: Installation and Release

Goal: make the stack installable without leaking secrets or relying on local
state.

Install files:

- `manifest.json`
- `requirements.txt`
- `README.md`
- `API_CONTRACT.md`
- `READINESS_AUDIT.md`
- `PROVIDER_ONBOARDING.md`
- `LIVE_SMOKE_TESTS.md`
- `DEBT_GUARDRAILS.md`

Release checklist:

- [x] Stack manifests expose exactly the three initial tools.
- [x] Runtime is Python.
- [x] Secrets are optional in manifests because any one provider can be used.
- [x] Registry source `index.json` includes `stack:video-generator`.
- [x] Catalog stack README lists `video-generator`.
- [ ] Build/compile registry release artifacts when preparing a release.
- [ ] Install through RUDI and call `list_video_models`.
- [x] Configure Gemini key through RUDI secrets and run one live generation.

## Phase 6: Verification

Default verification:

```bash
python -m compileall -q src tests
python -m unittest discover -s tests -v
npm run validate
```

Current default verification status:

- [x] Python compile passes.
- [x] Unit and MCP stdio tests pass.
- [x] Registry v2 manifest validation passes.
- [x] Live smoke runner refuses paid calls without `--confirm-cost`.
- [x] Gemini/Veo text-to-video live smoke succeeds from source with RUDI
  `GEMINI_API_KEY` injected.
- [x] Gemini/Veo image, references, interpolation, landscape, and extension
  live smokes succeed with validated MP4 outputs.
- [x] Replicate Seedance Fast text and image live smokes succeed with validated
  MP4 outputs.
- [x] Replicate Seedance Pro, Kling v2.1, and MiniMax Video-01 live smokes
  succeed in their supported modes.
- [x] Replicate source-image aspect ratio validation rejects mismatched
  image-to-video requests before provider dispatch.
- [x] fal Seedance 2.0 adapter unit tests cover endpoint and payload mappings.
- [x] fal Seedance 2.0 text smoke reaches fal with configured `FAL_KEY`.
- [x] fal Seedance 2.0 Fast text-to-video live smoke succeeds with validated
  MP4 output.
- [x] fal Seedance 2.0 Fast image-to-video live smoke succeeds with validated
  MP4 output.
- [x] fal Seedance 2.0 Fast interpolation live smoke succeeds with validated
  MP4 output.
- [x] fal Seedance 2.0 Fast reference live smoke succeeds with validated MP4
  output.

Live verification, only with real credentials:

```bash
rudi secrets set GEMINI_API_KEY "<key>"
rudi install video-generator
rudi mcp video-generator
```

Expected live smoke:

- `list_video_models` returns `ok: true`.
- `generate_video` writes one MP4 under `~/.rudi/outputs`.
- `get_video_job` can inspect a pending or completed job.
- Existing output files are not overwritten.
- Secret values never appear in error responses.

## Phase 7: Iteration Rules

Use small, adjacent-layer iterations:

- Contract changes must update validation, tests, and docs in the same change.
- Provider changes must not alter the MCP schema unless the normalized contract
  genuinely needs a new concept.
- New provider-specific fields must be translated from normalized fields inside
  the provider adapter, not exposed directly.
- Do not add a new dependency without documenting why the existing provider SDK
  or standard library cannot cover the need.
- Do not copy code from `image-generator`; extract only the pattern and re-write
  video-specific logic in this stack.
