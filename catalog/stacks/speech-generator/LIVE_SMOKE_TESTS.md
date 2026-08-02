# Speech Generator Live Smoke Tests

Run these checks after installation and after adding or rotating provider keys.
Live generation can consume paid provider credits; run only the provider you
intend to validate.

## 1. Credential-free checks

1. Run `list_speech_models` with `{}`.
2. Confirm all three providers are present.
3. Confirm each configured key reports `secret_status.configured: true`.
4. Run `list_speech_voices` for `openai` and `gemini`; both should return static voices without remote calls.

## 2. ElevenLabs inventory

After setting `ELEVENLABS_API_KEY`, call:

```json
{
  "provider": "elevenlabs",
  "page_size": 10
}
```

Confirm at least one voice record returns. For the live generation check, select
a voice ID returned by the authenticated provider inventory for which the
tester independently confirmed voice-use authorization for the planned
smoke-test use. Here, `voice-use authorization` means the tester's independently
established set of consents, licenses, contractual permissions, and other rights
required for the selected voice and planned generation and downstream use.

Provider authentication, inventory visibility, `provider_reported_is_owner`,
and successful provider generation may evidence provider-side technical access
or entitlement, but none establishes voice-use authorization by itself. Hold
the generation check while voice-use authorization remains unresolved. This v1
stack does not collect, verify, persist, or enforce an attestation of voice-use
authorization. A missing/invalid key should return a structured
`missing_secret` or `provider_error`; it must never echo the key.

## 3. Minimal live generation

Use a short sentence and omit `out_path` so the stack chooses a safe unique path.

OpenAI:

```json
{
  "provider": "openai",
  "text": "RUDI speech generation is ready.",
  "voice": "marin",
  "format": "mp3"
}
```

ElevenLabs:

```json
{
  "provider": "elevenlabs",
  "text": "RUDI speech generation is ready.",
  "voice": "confirmed-inventory-voice-id",
  "format": "mp3"
}
```

Gemini:

```json
{
  "provider": "gemini",
  "text": "RUDI speech generation is ready.",
  "voice": "Kore",
  "format": "wav"
}
```

For each enabled provider, verify:

- `ok` is true.
- `provider`, `model`, `voice`, and `format` match the request/defaults.
- `out_path` is beneath `~/.rudi/outputs/speech-generator`.
- The file exists, is non-empty, and plays as speech.
- `provider_request_id` is present when the provider supplies one.
- No existing file was overwritten.
- The playback/publishing surface discloses AI-generated speech as required.

## 4. Negative checks

- Request `format: "mp3"` from Gemini and confirm `unsupported_combo` before a provider call.
- Omit the ElevenLabs voice and confirm `validation` before a provider call.
- Request an output outside `~/.rudi/outputs/speech-generator` and confirm `validation`.
- Repeat a request with an existing explicit `out_path` and confirm it is not overwritten.
