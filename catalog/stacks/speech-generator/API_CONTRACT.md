# Speech Generator API Contract

Version: `0.1.0`

The stack exposes a provider-portable speech-synthesis boundary. Callers choose
a provider explicitly, while provider authentication, endpoints, response
decoding, audio validation, and output policy remain inside the stack.

## Common envelope

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

Stable error kinds:

- `validation` — malformed, unknown, violating output-path policy, blank, or out-of-range input.
- `missing_secret` — the selected provider key is not configured.
- `unsupported_combo` — a provider/model/voice/format/control combination is unsupported.
- `provider_error` — the provider rejected the request or returned a malformed response.
- `timeout` — the provider call exceeded the bounded timeout.
- `invalid_audio` — returned bytes were empty, oversized, or did not match the requested audio format.
- `write_failed` — validated audio could not be safely written.
- `unknown_tool` — the MCP tool name is unsupported.
- `internal_error` — an unexpected redacted server failure.

## Shared limits and invariants

| Boundary | Value |
|---|---:|
| Text | 4,096 characters |
| Delivery instructions | 2,000 characters |
| Provider timeout | 120 seconds |
| Provider response | 50 MiB |
| ElevenLabs voice page | 1–100 voices |

- Text and instructions are literal strings; file-looking strings are not read.
- Outputs must be beneath `~/.rudi/outputs/speech-generator`.
- Explicit output extensions must match the resolved format.
- Existing files are never overwritten.
- API keys never appear in results, provider payload metadata, or error details.
- Voice cloning/design is not part of this contract.

## Validation and responsibility boundary

Speech-generator v1 enforces technical request constraints for speech generation,
supported provider/model/voice/format/control combinations, selected-provider
credential presence, output-path policy, bounded provider responses, and
format-specific structural checks on returned audio. It does not
inspect/classify/moderate semantic text/instructions, verify transcript fidelity
in audio, or decide whether content/intended use is permitted.

Before invocation, the caller must complete any review applicable to the planned
use under provider, platform, organizational, and legal rules. A provider may
accept or reject the request independently; acceptance is not evidence that the
caller’s obligations were satisfied. This is a procedural caller gate, not stack
enforcement.

## `list_speech_models`

Purpose: return static model/capability metadata and provider-secret readiness
without remote provider calls.

Request:

```json
{
  "provider": "openai"
}
```

`provider` is optional. Omit it to return `openai`, `elevenlabs`, and `gemini`.

## `list_speech_voices`

Purpose: discover voice names or IDs supported by a provider.

Request:

```json
{
  "provider": "elevenlabs",
  "page_size": 50,
  "next_page_token": "optional-token",
  "search": "optional text"
}
```

OpenAI and Gemini inventories are static and do not require keys. Search is
applied locally. ElevenLabs discovery calls `GET /v2/voices`, requires
`ELEVENLABS_API_KEY`, and returns sanitized voice records plus `has_more` and
`next_page_token`.

## `generate_speech`

Request:

```json
{
  "provider": "openai",
  "text": "Text to synthesize.",
  "model": "gpt-4o-mini-tts",
  "voice": "marin",
  "format": "mp3",
  "instructions": "Warm and conversational.",
  "speed": 1.0,
  "language_code": "en",
  "out_path": "/Users/example/.rudi/outputs/speech-generator/narration.mp3"
}
```

Fields:

| Field | Required | Behavior |
|---|---:|---|
| `provider` | yes | `openai`, `elevenlabs`, or `gemini` |
| `text` | yes | literal non-empty text, maximum 4,096 characters |
| `model` | no | defaults per provider; only listed models are accepted |
| `voice` | ElevenLabs only | built-in default for OpenAI/Gemini; ElevenLabs voice ID required |
| `format` | no | provider default if omitted; incompatible formats fail before dispatch |
| `instructions` | no | supported for `gpt-4o-mini-tts` and Gemini TTS; otherwise rejected |
| `speed` | no | OpenAI: 0.25–4.0; ElevenLabs: 0.7–1.2; Gemini: unsupported |
| `language_code` | no | currently passed only to ElevenLabs |
| `out_path` | no | non-existing matching-extension path inside the output root |

Success:

```json
{
  "ok": true,
  "out_path": "/Users/example/.rudi/outputs/speech-generator/speech-20260802-120000-a1b2c3d4.mp3",
  "provider": "openai",
  "model": "gpt-4o-mini-tts",
  "voice": "marin",
  "format": "mp3",
  "bytes": 123456,
  "ms": 1520,
  "provider_request_id": "optional-id",
  "ai_generated": true,
  "disclosure_policy": "context_dependent",
  "disclosure_review_required": true
}
```

`ai_generated` is a result-level fact only. It is not embedded provenance in
the audio bytes or file metadata, so callers should preserve this result
metadata when storing or transferring the generated asset.

`disclosure_policy: "context_dependent"` means the stack does not decide
whether a visible or audible disclosure applies. When
`disclosure_review_required` is `true`, a downstream surface must complete an
applicable-policy review before presenting, playing, communicating, or
publishing the speech to humans. The review should consider provider
requirements, the intended use, audience and jurisdiction, platform rules, and
organizational policy. The human-facing action must remain on hold while those
requirements are unresolved. Apply disclosure when the completed review
requires it or the organization elects to provide it.

Under this contract, generation, storage, transfer, and machine-only processing
do not alone require visible disclosure. Disclosure does not cure or replace
consent, licensing, platform, or legal restrictions; this contract does not
determine those obligations.

## Voice-use authorization

`voice-use authorization` is the caller's independently established set of
consents, licenses, contractual permissions, and other rights required for the
selected voice and intended generation and downstream use.

The caller must establish voice-use authorization before invoking
`generate_speech` and must hold generation while it remains unresolved.
Provider authentication, inventory visibility, `provider_reported_is_owner`,
and successful provider generation may evidence provider-side technical access
or entitlement, but none establishes voice-use authorization by itself.

This v1 contract does not collect, verify, persist, or enforce an attestation of
voice-use authorization.

## Provider boundary

### OpenAI

- Endpoint: `POST https://api.openai.com/v1/audio/speech`.
- Auth: `Authorization: Bearer $OPENAI_API_KEY`.
- The adapter passes model, input, voice, format, supported instructions, and speed.

### ElevenLabs

- Endpoint: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`.
- Auth: `xi-api-key: $ELEVENLABS_API_KEY`.
- Voice IDs are percent-encoded before URL construction.
- The adapter maps normalized MP3/WAV formats to provider format identifiers.
- Provider-specific language and speed controls are added only when validated.

### Gemini

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/interactions`.
- Auth: `x-goog-api-key: $GEMINI_API_KEY`.
- A clear TTS preamble separates delivery instructions from the literal transcript.
- Base64 audio is strictly decoded and wrapped as 24 kHz, 16-bit mono WAV.
- Gemini TTS models are preview and may require retries for transient provider failures; this synchronous v1 operation does not automatically retry billable requests.
