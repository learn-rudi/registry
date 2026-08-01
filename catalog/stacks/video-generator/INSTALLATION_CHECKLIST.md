# Video Generator Installation Checklist

Use this runbook when installing or validating `stack:video-generator` locally
or in a RUDI release.

## 1. Preflight

- [x] Confirm the stack directory exists:
  `catalog/stacks/video-generator/`
- [x] Confirm no video generation code was added under `image-generator`.
- [x] Confirm Python runtime is available.
- [x] Confirm `requirements.txt` is installable in the target RUDI runtime.
- [x] Confirm `manifest.json` exposes:
  - `list_video_models`
  - `generate_video`
  - `get_video_job`
- [x] Confirm output root is `~/.rudi/outputs`, not `~/.rudi/output`.

## 2. Secrets

Gemini/Veo:

- [x] Use `GEMINI_API_KEY`.
- [x] Do not add fallback secret names before there is a real migration need.
- [x] Do not hardcode the key in files, tests, examples, logs, or errors.

Replicate:

- [x] Use `REPLICATE_API_TOKEN`.
- [x] Treat models as beta until live tested.

fal:

- [x] Use `FAL_KEY`.
- [x] Treat hosted model endpoints as beta until live tested.
- [x] Do not add fallback secret names before there is a real migration need.

OpenAI:

- [x] Use `OPENAI_API_KEY`.
- [x] Treat Sora as legacy/deprecated, not default.
- [x] Re-check OpenAI docs before relying on Sora in production workflows.

Useful commands:

```bash
rudi secrets set GEMINI_API_KEY "<key>"
rudi secrets set REPLICATE_API_TOKEN "<token>"
rudi secrets set FAL_KEY "<key>"
rudi secrets set OPENAI_API_KEY "<key>"
```

## 3. Contract Validation

- [x] `API_CONTRACT.md` lists all request and response shapes.
- [x] Every schema in `src/server.py` has `additionalProperties: false`.
- [x] Every enum in `src/server.py` matches `src/constants.py` and
  `src/model_config.py`.
- [x] `generate_video` accepts normalized fields only:
  - `provider`
  - `prompt`
  - `model`
  - `format`
  - `duration_seconds`
  - `mode`
  - `references`
  - `input_image`
  - `end_image`
  - `source_video`
  - `out_path`
- [x] Provider-specific fields do not leak into the MCP schema.

## 4. Local Test Install

From the stack directory:

```bash
cd <registry-root>/catalog/stacks/video-generator
python -m compileall -q src tests
python -m unittest discover -s tests -v
```

From the registry root:

```bash
cd <registry-root>
npm run validate
```

Pass criteria:

- [x] Python compile passes.
- [x] Unit and stdio tests pass.
- [x] Registry v2 manifest validation passes.
- [x] No generated cache files are left in the stack.

## 5. RUDI Install Smoke

After registry installation support is available for this stack:

```bash
rudi install video-generator
rudi mcp video-generator
```

MCP smoke checklist:

- [ ] `list_video_models` returns `ok: true`.
- [ ] The selected provider reports `secret_status.configured: true`.
- [ ] Missing secrets return `missing_secret`.
- [ ] Invalid provider returns `validation`.
- [ ] Invalid output root returns `validation`.

## 6. Gemini Live Smoke

Gemini is the first production candidate.

Call shape:

```json
{
  "provider": "gemini",
  "prompt": "Short vertical product reveal video. Clean tabletop, slow dolly in, soft studio light.",
  "model": "default",
  "format": "story",
  "duration_seconds": 8,
  "references": [],
  "out_path": "<rudi-home>/outputs/video-generator-gemini-smoke.mp4"
}
```

Pass criteria:

- [x] Returns `ok: true`.
- [x] Writes an MP4 under `~/.rudi/outputs`.
- [x] Writes a `.metadata.json` sidecar for output provenance.
- [x] Response includes provider, resolved model, job id, status, bytes, format,
  and elapsed milliseconds.
- [x] Existing output path is not overwritten on repeat call.
- [x] No key material appears in stdout/stderr or returned errors.

## 6a. Gemini Input-Mode Smokes

Run these after the base text-to-video smoke passes. Keep each one as a
separate paid smoke and record outputs in `READINESS_AUDIT.md`.

- [x] `mode: image` with `input_image` writes a valid MP4.
- [x] `mode: references` with one to three references writes a valid MP4.
- [x] `mode: interpolate` with `input_image` and `end_image` writes a valid
  MP4.
- [x] `mode: extend` with `source_video` writes a valid MP4 when the source is
  a recent Veo-generated output with its metadata sidecar.
- [x] Unsupported media/mode combinations fail before provider dispatch.

## 7. Replicate Beta Smoke

Start with one model only. Do not broaden the adapter until one model is proven.

Candidate models:

- `bytedance/seedance-1-pro-fast`
- `bytedance/seedance-1-pro`
- `minimax/video-01`
- `kwaivgi/kling-v2.1`

Pass criteria:

- [x] Adapter input shape matches the tested models' current Replicate API
  schemas.
- [x] Text-to-video works where supported for Seedance Fast, Seedance Pro, and
  MiniMax Video-01.
- [x] Image-to-video works where supported for Seedance Fast and Kling v2.1.
- [x] Unsupported combos return `unsupported_combo` before provider dispatch.
- [x] Output bytes validate as MP4 or WebM.

## 7a. fal Beta Smoke

fal is a hosted model platform. Start with Seedance 2.0 Fast and run one mode at
a time.

Pass criteria:

- [x] Adapter input shape matches the current fal Seedance 2.0 endpoint schemas.
- [x] `FAL_KEY` is configured and text-to-video reaches fal.
- [x] Text-to-video works for `seedance-2-fast`.
- [x] Image-to-video works with one local first-frame image.
- [x] Interpolation works with first and last local images.
- [x] Reference-to-video works with one to three local image references.
- [x] Unsupported combos return `unsupported_combo` before provider dispatch.
- [x] Text-to-video, image-to-video, interpolation, and reference outputs
  validate as MP4.

## 8. OpenAI Legacy Smoke

OpenAI docs currently expose the Sora Videos API, but the OpenAI model catalog
marks Sora 2 models as deprecated/legacy. Do not make it the default unless
that changes and live testing proves it stable.

Pass criteria:

- [ ] `sora-2` can create a job.
- [ ] `get_video_job` can retrieve status.
- [ ] Completed jobs download MP4 bytes.
- [x] Legacy/deprecation limitations are documented in `READINESS_AUDIT.md`.

## 9. Release Gate

- [x] `DEVELOPMENT_WORKFLOW.md` phase checklist is current.
- [x] `DEBT_GUARDRAILS.md` scan checklist is complete.
- [x] `READINESS_AUDIT.md` reflects live test status.
- [x] Registry source listing includes `stack:video-generator`.
- [ ] Release artifacts are compiled intentionally when needed.
- [ ] No unrelated dirty files are included in the release commit.
