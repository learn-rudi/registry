# Image Generator API Contract

Version: `0.4.0`

This stack exposes MCP tools for agent-facing content image generation. The
contract is intentionally provider-portable: callers choose a provider and a
content-oriented preset or explicit model id, while provider SDK details stay
inside the stack.

## Common Result Envelope

Every tool returns JSON text with an `ok` boolean.

Success:

```json
{
  "ok": true
}
```

Failure:

```json
{
  "ok": false,
  "error_kind": "validation",
  "message": "Human-readable remediation text."
}
```

`error_kind` is stable enough for agents to branch on. Current values:

- `validation` - malformed, missing, unsafe, or out-of-range input
- `missing_secret` - required provider credential is not configured
- `unsupported_combo` - provider/model/reference combination is not supported
- `provider_error` - provider SDK or provider response failed
- `timeout` - provider call exceeded the stack timeout
- `write_failed` - generated output could not be written safely
- `authentication_required` - the dedicated Midjourney profile is not signed in
- `browser_dependency` - Chromium or Python Playwright could not be acquired
- `browser_challenge` - Midjourney presented a browser verification challenge
- `browser_busy` - another call owns the dedicated Midjourney profile
- `ui_drift` - an exact Midjourney UI invariant no longer holds
- `idempotency_conflict` - a request ID was reused with different generation input
- `idempotency_in_doubt` - a prior browser submission may have succeeded but has no known job ID
- `upload_failed` - Midjourney rejected a validated local reference upload
- `reference_changed` - a reference file changed between validation and browser upload
- `download_failed` - exported bytes or artifact metadata failed validation
- `offline` - a Midjourney browser call was attempted during offline verification
- `unknown_tool` - MCP tool name is not supported
- `internal_error` - unexpected server failure after redaction

Validation errors include field details such as `field`, `allowed`,
`max_items`, `max_chars`, or `max_bytes` where useful.

## Shared Limits

| Limit | Value |
|---|---:|
| Prompt length | 20,000 characters |
| Reference count | 16 files |
| Reference size | 50 MB per file |
| Compare specs | 8 provider/model specs |
| Provider timeout | 120 seconds per provider call |

Prompts are always literal strings. The stack does not read prompt files.

Reference images must be local PNG, JPEG, or WebP files. URLs and data URLs are
rejected. Output paths must be under `~/.rudi/outputs`, and existing files are
not overwritten.

Content formats:

| Format | Aspect ratio | Notes |
|---|---:|---|
| `square` | `1:1` | Default feed image |
| `portrait` | `2:3` | Vertical feed image |
| `story` | `9:16` | Story or short-form vertical image |
| `landscape` | `3:2` | Landscape preview or thumbnail image |

OpenAI `story` output is supported with `gpt-image-2`. Older OpenAI image
models return `unsupported_combo` for `format: "story"`. Gemini and verified
Replicate FLUX defaults use provider-native aspect ratio controls.

## `list_models`

Purpose: return provider presets, active model ids, aliases, reference support,
and credential readiness without making provider API calls.

Request:

```json
{
  "provider": "openai"
}
```

`provider` is optional. Allowed values are `gemini`, `openai`, and
`replicate`.

Response shape:

```json
{
  "ok": true,
  "timeout_seconds": 120,
  "formats": {
    "square": {
      "aspect_ratio": "1:1",
      "description": "Square feed image."
    }
  },
  "providers": {
    "openai": {
      "secret": "OPENAI_API_KEY",
      "secret_status": {
        "env": "OPENAI_API_KEY",
        "configured": true,
        "required_for_generation": true
      },
      "default_preset": "photoreal",
      "presets": {
        "photoreal": {
          "default_model": "gpt-image-2",
          "active_model": "gpt-image-2",
          "references": {
            "supported": true,
            "max_references": 16,
            "multi_reference": true,
            "rule": "OpenAI references require GPT Image/chatgpt-image models (up to 16 refs) or dall-e-2 (one ref)."
          }
        }
      },
      "known_models": {
        "gpt-image-2": {
          "status": "current",
          "default_for": ["sketch", "photoreal", "edit"]
        },
        "gpt-image-1.5": {
          "status": "legacy",
          "default_for": []
        }
      }
    }
  }
}
```

`secret_status.configured` only checks whether the named environment variable
is present. It does not validate account access or model availability.

Replicate provider data also includes `release_status: "beta"`,
`stability: "model-specific"`, and `beta_reason`. Replicate aliases include a
`status` field so agents can distinguish stack-known beta models from unverified
alias targets.

## `generate_image`

Purpose: generate one image with one provider and write it to a local file.

Request:

```json
{
  "provider": "openai",
  "prompt": "A clean square product image for a social post.",
  "model": "photoreal",
  "format": "square",
  "references": ["/Users/example/.rudi/outputs/reference.png"],
  "out_path": "/Users/example/.rudi/outputs/post-image.png"
}
```

Fields:

| Field | Required | Notes |
|---|---:|---|
| `provider` | yes | `gemini`, `openai`, or `replicate` |
| `prompt` | yes | literal prompt text, 1 to 20,000 characters |
| `model` | no | preset or explicit model id, defaults to `photoreal` |
| `format` | no | `square`, `portrait`, `story`, or `landscape`; defaults to `square` |
| `references` | no | local PNG/JPEG/WebP image paths, maximum 16 |
| `out_path` | no | file path under `~/.rudi/outputs`; auto path if omitted |

Success response:

```json
{
  "ok": true,
  "out_path": "/Users/example/.rudi/outputs/image-20260517-120000-a1b2c3d4.png",
  "provider": "openai",
  "model": "gpt-image-2",
  "asset_format": "square",
  "aspect_ratio": "1:1",
  "bytes": 123456,
  "format": "png",
  "image_format": "png",
  "ms": 5230
}
```

Common error response:

```json
{
  "ok": false,
  "error_kind": "missing_secret",
  "message": "OPENAI_API_KEY is not set. Set it with `rudi secrets set OPENAI_API_KEY <key>` before using openai.",
  "provider": "openai",
  "secret_name": "OPENAI_API_KEY",
  "remediation": "Run `rudi secrets set OPENAI_API_KEY <key>` and restart the RUDI router."
}
```

## `compare_providers`

Purpose: run one prompt across up to eight provider/model specs and write a
local HTML gallery.

Request:

```json
{
  "prompt": "Editorial social graphic about planning a week of content.",
  "format": "portrait",
  "specs": ["gemini:sketch", "openai:photoreal", "replicate:flux-2"],
  "out_dir": "/Users/example/.rudi/outputs/compare-run"
}
```

Fields:

| Field | Required | Notes |
|---|---:|---|
| `prompt` | yes | literal prompt text, 1 to 20,000 characters |
| `specs` | yes | non-empty list of `provider:model` strings, maximum 8 |
| `format` | no | `square`, `portrait`, `story`, or `landscape`; defaults to `square` |
| `references` | no | local PNG/JPEG/WebP image paths, maximum 16 |
| `out_dir` | no | empty directory under `~/.rudi/outputs`; auto directory if omitted |

Success response:

```json
{
  "ok": true,
  "gallery_path": "/Users/example/.rudi/outputs/compare-run/index.html",
  "out_dir": "/Users/example/.rudi/outputs/compare-run",
  "asset_format": "portrait",
  "aspect_ratio": "2:3",
  "results": [
    {
      "spec": "openai:photoreal",
      "ok": true,
      "file": "01-openai-photoreal.png",
      "model": "gpt-image-2",
      "asset_format": "portrait",
      "aspect_ratio": "2:3",
      "format": "png",
      "image_format": "png",
      "ms": 5230,
      "kb": 120
    },
    {
      "spec": "gemini:edit",
      "ok": false,
      "ms": 2,
      "kb": 0,
      "error": {
        "error_kind": "unsupported_combo",
        "message": "Gemini does not define an `edit` preset. Use sketch, photoreal, or an explicit Gemini model id.",
        "provider": "gemini",
        "model": "edit"
      }
    }
  ]
}
```

Per-spec provider failures are captured in `results`; the comparison continues
and still returns `ok: true` if the gallery can be written. Request-level
validation failures, such as too many `specs`, return the common failure
envelope instead.

## Midjourney Browser Contract

Midjourney is a provider-specific browser adapter inside the canonical
image-generator stack. It uses a dedicated profile under local RUDI state; it
does not accept cookies, tokens, URLs, selectors, or profile paths from callers.
The browser surface is bounded to `https://www.midjourney.com` Create and job
detail pages.

### `midjourney_session_status`

Request: `{}`

The tool opens the Create page read-only and returns:

```json
{
  "ok": true,
  "provider": "midjourney",
  "authenticated": true,
  "profile_mode": "dedicated",
  "login_required": false
}
```

### `midjourney_login`

Request:

```json
{
  "timeout_seconds": 300
}
```

This opens visible Chromium and waits for the user to complete Midjourney's own
login flow. `timeout_seconds` is 30-600 and defaults to 180. The stack never
reads or returns credentials. Success returns `authenticated: true`.

### `midjourney_generate`

Request:

```json
{
  "request_id": "campaign-greenhouse-20260803-001",
  "prompt": "A tiny glass greenhouse glowing in a misty forest.",
  "aspect_ratio": "16:9",
  "stylization": 250,
  "weirdness": 0,
  "variety": 20,
  "model_version": "8.2",
  "resolution": "hd",
  "raw": true,
  "speed": "fast",
  "image_prompts": ["composition.png"],
  "image_weight": 1.5,
  "style_references": ["/home/user/.rudi/outputs/brand-style.png"],
  "style_weight": 250,
  "omni_reference": "character.png",
  "omni_weight": 125,
  "timeout_seconds": 300,
  "show_browser": true
}
```

| Field | Required | Notes |
|---|---:|---|
| `request_id` | yes | 8-128 safe characters; idempotency scope includes the prompt and every appended setting |
| `prompt` | yes | literal prompt, 1-6,000 characters |
| `aspect_ratio` | no | `N:N`, each side 1-99; rejected when prompt already contains `--ar` or `--aspect` |
| `stylization` | no | integer 0-1,000; appends `--stylize` |
| `weirdness` | no | integer 0-3,000; appends `--weird` |
| `variety` | no | integer 0-100; the website's Variety control maps to `--chaos` |
| `model_version` | no | safe numeric version such as `8.2`; appends `--v` |
| `resolution` | no | `sd` or `hd`; appends the matching resolution override |
| `raw` | no | when true, appends `--raw`; false or omission adds no Raw override |
| `speed` | no | `fast`, `relax`, or `turbo`; plan/model availability is enforced by Midjourney |
| `image_prompts` | no | 1-4 local PNG/JPEG/WebP paths that influence content, composition, and color |
| `style_references` | no | 1-4 local PNG/JPEG/WebP paths that influence visual style |
| `omni_reference` | no | one local PNG/JPEG/WebP path for a person, character, or object's form |
| `image_weight` | no | number 0-3; requires `image_prompts` and maps to `--iw` |
| `style_weight` | no | number 0-1,000; requires `style_references` and maps to `--sw` |
| `omni_weight` | no | number 1-1,000; requires `omni_reference` and maps to `--ow` |
| `timeout_seconds` | no | 30-600, default 180 |
| `show_browser` | no | display Chromium while the bounded workflow runs; default true because Midjourney challenges isolated headless sessions |

Settings are appended as documented Midjourney prompt parameters rather than
changing persistent account defaults. A caller may still write parameters
directly in `prompt`, but it must not also provide the corresponding structured
field; ambiguous duplicates fail validation. The prompt plus appended
parameters must remain within 6,000 characters.

Relative reference paths resolve under `~/.rudi/inputs/midjourney`. Absolute
paths are accepted only inside that directory or `~/.rudi/outputs`. Each file
must be a regular non-symlink PNG, JPEG, or WebP no larger than 10 MB, with a
matching signature and extension. Arbitrary URLs are not accepted as structured
references. Validated files are uploaded to the dedicated account's Midjourney
uploads library before prompt submission; uploads may remain in that library
even if generation later fails.

Reference roles are translated to Midjourney's Image Prompt, `--sref`, and
`--oref` semantics. Start Frame is intentionally excluded because it creates a
video rather than an image. Omni Reference is provider-limited to one image and
has model/speed compatibility rules enforced by Midjourney.

The stack persists `pending -> submitted -> complete` locally. Completed replay
returns the same job and validated artifacts with `replayed: true`. A pending
record without a job ID returns `idempotency_in_doubt` and is never resubmitted.
A submitted record with a job ID resumes export without generating again.

Success:

```json
{
  "ok": true,
  "provider": "midjourney",
  "status": "complete",
  "request_id": "campaign-greenhouse-20260803-001",
  "prompt_sha256": "<sha256>",
  "request_sha256": "<sha256 including reference roles, weights, and file digests>",
  "job_id": "7f86d4ed-d706-448a-9dfa-56be726abad4",
  "replayed": false,
  "artifacts": [
    {
      "index": 0,
      "file_name": "variation-1.png",
      "local_path": "/home/user/.rudi/outputs/midjourney/<run>/variation-1.png",
      "media_type": "image/png",
      "sha256": "<sha256>",
      "size_bytes": 123456,
      "source_url": "https://www.midjourney.com/jobs/7f86d4ed-d706-448a-9dfa-56be726abad4?index=0"
    }
  ]
}
```

The real response contains four artifacts, indexes 0-3.

### `midjourney_export_job`

Request:

```json
{
  "job_id": "7f86d4ed-d706-448a-9dfa-56be726abad4",
  "indexes": [0, 2],
  "timeout_seconds": 180,
  "show_browser": true
}
```

`job_id` must be a UUID. `indexes` defaults to all four unique values 0-3.
Each call writes into a new output directory and returns the same validated
artifact shape used by `midjourney_generate`.

## Midjourney Failure and Retry Rules

- Login, UI drift, dependency, timeout, and download failures are structured;
  browser exceptions and session data are not exposed.
- Generation retry is safe only with the same `request_id`, submitted prompt,
  reference roles, weights, and file content digests. Different input returns
  `idempotency_conflict`.
- `idempotency_in_doubt` is deliberately not auto-retried. A human must inspect
  the provider before choosing a new request ID.
- Export is safe to retry because each attempt uses a new bounded directory.
- Browser calls are disabled when `RUDI_VERIFY_OFFLINE=1`; tests use a fake
  driver and make no provider requests.
