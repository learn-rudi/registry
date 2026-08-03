# Image Generator

Multi-provider image generation for RUDI content workflows. API-backed and
browser-backed providers remain inside one canonical image-generation stack.
The stack exposes:

- `generate_image` - generate one image with Gemini, OpenAI, or Replicate
- `compare_providers` - run the same prompt across multiple provider/model specs
- `list_models` - inspect active defaults, aliases, and reference support
- `midjourney_session_status` - check the dedicated browser profile login
- `midjourney_login` - open that profile for user-controlled sign-in
- `midjourney_generate` - submit one idempotent prompt and export four images
- `midjourney_export_job` - export selected variations from an existing job

See `READINESS_AUDIT.md` for the full schema, API, safety, and registry
readiness checklist. See `API_CONTRACT.md` for the MCP request, response, and
error contract.

## Install

```bash
rudi install image-generator
```

After setting or changing provider secrets, restart the RUDI router or sidecar
so the MCP process receives the updated environment.

Midjourney additionally requires Chromium. RUDI installs the declared Chromium
binary when supported. For a Playwright-managed fallback, run:

```bash
python -m playwright install chromium
```

## Providers

At least one provider key is required before generation:

```bash
rudi secrets set GEMINI_API_KEY "<key>"
rudi secrets set OPENAI_API_KEY "<key>"
rudi secrets set REPLICATE_API_TOKEN "<token>"
```

The default models are:

- Gemini sketch: `gemini-3.1-flash-image`
- Gemini photoreal: `gemini-3-pro-image`
- OpenAI sketch/photoreal/edit: `gpt-image-2`
- Replicate sketch: `black-forest-labs/flux-schnell`
- Replicate photoreal: `black-forest-labs/flux-1.1-pro`
- Replicate edit: `black-forest-labs/flux-2-max`

Gemini defaults were updated to the GA image model IDs on 2026-07-09 after
Google deprecated the preview IDs. The previous
`gemini-3.1-flash-image-preview` and `gemini-3-pro-image-preview` models remain
listed for explicit compatibility only.

Replicate is beta/model-specific in this stack. It remains available for
open-source hosted image workflows, but agents should prefer Gemini or OpenAI
unless the user asks for Replicate, open-source models, or a Replicate-specific
model. Use `list_models` to inspect Replicate aliases, reference-capable models,
and `release_status` before generation.

Seedream is available through Replicate aliases:

- `seedream-4` -> `bytedance/seedream-4`
- `seedream-4.5` -> `bytedance/seedream-4.5`

These aliases use the existing `REPLICATE_API_TOKEN`; no separate BytePlus key
is needed for the Replicate route. Treat both as beta until live-smoked in the
target account because Replicate model schemas are model-specific.

Older or deprecated models remain available by passing an explicit `model`
value, for example `gpt-image-1.5`, or by setting the provider override
environment variables.

Optional model override environment variables are supported for advanced users:
`GEMINI_MODEL_SKETCH`, `GEMINI_MODEL_PHOTOREAL`, `OPENAI_MODEL_SKETCH`,
`OPENAI_MODEL_PHOTOREAL`, `OPENAI_MODEL_EDIT`, `REPLICATE_MODEL_SKETCH`,
`REPLICATE_MODEL_PHOTOREAL`, and `REPLICATE_MODEL_EDIT`.

Historical live smoke baseline on 2026-05-17:

- Gemini `sketch` resolved to `gemini-3.1-flash-image-preview` and generated a square image.
- OpenAI `sketch` resolved to `gpt-image-2` and generated a 9:16 story image.
- Replicate is exposed as beta/model-specific until its aliases are live-smoked.

The current Gemini GA defaults still need a live smoke in the target account
after `GEMINI_API_KEY` is available to the router environment.

## Midjourney Browser Provider

Midjourney uses a dedicated profile under local RUDI state. It does not inspect,
copy, or reuse the user's normal Chrome cookies. Sign in once by calling
`midjourney_login`; the tool opens a visible browser and waits while the user
completes Midjourney's own login flow. Credentials and browser storage are never
returned through MCP or written to the registry.

Every generation requires a `request_id`. A successful replay returns the same
job and artifact metadata without submitting another paid job. If a browser
failure occurs after submission but before a job ID is known, replay fails with
`idempotency_in_doubt` instead of risking a duplicate charge.

The v1 browser surface intentionally excludes arbitrary navigation and
selectors, likes, follows, deletes, edits, uploads, billing, and account
management. Midjourney UI controls are matched exactly and fail closed on drift.

## Content Formats

Use the optional `format` field to request provider-native social asset shapes:

- `square` - 1:1 feed image
- `portrait` - 2:3 vertical feed image
- `story` - 9:16 story or short-form vertical image
- `landscape` - 3:2 landscape preview or thumbnail image

OpenAI `story` output is supported with `gpt-image-2`. Older OpenAI image
models return `unsupported_combo` for `format: "story"`; use Gemini, Replicate,
or OpenAI `portrait` for those legacy model calls.

## Safety Contract

Prompts are literal strings. The stack does not read prompt files.

Reference images must be local PNG, JPEG, or WebP files under 50 MB. Output
paths must be inside `~/.rudi/outputs`, and existing files are not overwritten.

Midjourney downloads are written to new job-scoped directories under
`~/.rudi/outputs/midjourney`. The stack verifies source URL, variation index,
file boundary, regular-file status, image signature, byte limit, and SHA-256
before returning an artifact.

## Outputs and Handoffs

`generate_image` returns the exact `out_path` written under `~/.rudi/outputs`.
When `out_path` is omitted, the stack creates a filename like
`image-<timestamp>-<nonce>.<detected-format>`.

`compare_providers` returns `gallery_path`, `out_dir`, and per-provider result
entries. The gallery is for human review; downstream stacks should use the
returned image file paths and metadata rather than guessing filenames.

Returned metadata includes `provider`, resolved `model`, `asset_format`,
`aspect_ratio`, byte count, detected `image_format`, and elapsed milliseconds.

## Examples

Generate with the default OpenAI model:

```json
{
  "provider": "openai",
  "prompt": "A clean square product image for a post about launching a local AI content suite. Modern desk, laptop, generated image thumbnails, bright natural light.",
  "model": "photoreal",
  "format": "square"
}
```

Compare providers:

```json
{
  "prompt": "Editorial social graphic about planning a week of content. Bright workspace, image moodboard, clean brand-safe composition.",
  "format": "portrait",
  "specs": ["gemini:sketch", "openai:photoreal", "replicate:flux-2"]
}
```

Generate a story asset with Gemini:

```json
{
  "provider": "gemini",
  "prompt": "A vertical story image for a social post about turning one article into a week of content. Clean mobile-first composition with room for headline text.",
  "model": "photoreal",
  "format": "story"
}
```

Generate a landscape thumbnail with Replicate:

```json
{
  "provider": "replicate",
  "prompt": "A landscape thumbnail for a video about building a local AI content suite. Clear focal point, high contrast, no text.",
  "model": "flux-2",
  "format": "landscape"
}
```

Generate a text-free Seedream background through Replicate:

```json
{
  "provider": "replicate",
  "prompt": "Text-free abstract AfroTech conference background, pure black base, deep teal organic forms, neon lime and periwinkle data-light accents, subtle grain, generous negative space for headline overlays, no words, no logos, no watermarks.",
  "model": "seedream-4",
  "format": "square"
}
```

Generate a blog-header style image:

```json
{
  "provider": "openai",
  "prompt": "A polished editorial image for a blog post about multi-provider AI image generation. Modern workspace, image grid, subtle brand-safe color.",
  "model": "photoreal",
  "format": "landscape"
}
```

Inspect configured models:

```json
{
  "provider": "gemini"
}
```

`list_models` also reports `secret_status.configured` for each provider without
making provider API calls.

Sign in to Midjourney's dedicated browser profile:

```json
{
  "timeout_seconds": 300
}
```

Generate and export all four Midjourney variations:

```json
{
  "request_id": "campaign-greenhouse-20260803-001",
  "prompt": "A tiny glass greenhouse glowing in a misty pine forest at dawn.",
  "aspect_ratio": "16:9",
  "timeout_seconds": 300,
  "show_browser": false
}
```

Export two variations from an existing job:

```json
{
  "job_id": "7f86d4ed-d706-448a-9dfa-56be726abad4",
  "indexes": [0, 2]
}
```

## Troubleshooting

- `missing_secret`: set the provider key with `rudi secrets set ...` and restart
  the router or sidecar.
- `unsupported_combo`: call `list_models` and choose a model whose `references`
  capability matches the request.
- `validation`: check prompt length, local reference paths, output location, and
  the maximum of eight `compare_providers` specs.
- `provider_error` or `timeout`: the stack reached the provider but the provider
  call failed or exceeded 120 seconds.
- `authentication_required`: call `midjourney_login` and complete sign-in in
  the dedicated browser window.
- `browser_dependency`: install Chromium or a Playwright-managed Chromium.
- `ui_drift`: Midjourney changed a required control; do not retry blindly.
- `idempotency_conflict`: reuse the request ID only with the exact same prompt
  and aspect-ratio request.
- `idempotency_in_doubt`: inspect the Midjourney Create page before deciding
  whether to use a new request ID; the stack will not risk duplicate submission.
- `download_failed`: the job was unavailable, incomplete, or failed artifact
  validation.
