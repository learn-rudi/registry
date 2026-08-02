# Speech Generator

Modality-first text-to-speech generation for RUDI. The stack gives agents one
validated speech contract while keeping OpenAI, ElevenLabs, and Gemini request
details inside provider adapters.

## Tools

- `list_speech_models` — report provider models, formats, controls, and secret readiness without remote calls.
- `list_speech_voices` — list OpenAI/Gemini built-in voices locally or query an authenticated ElevenLabs voice inventory.
- `generate_speech` — synthesize one audio file beneath `~/.rudi/outputs/speech-generator`.

Voice cloning, voice design, speech-to-speech, transcription, realtime voice
agents, multi-speaker dialogue, and long-form chunk stitching are intentionally
outside this v1 stack.

## Install

```bash
rudi install stack:speech-generator
rudi index --json
```

The stack uses Python and declares only the MCP runtime package in
`requirements.txt`. Provider calls use a bounded standard-library HTTP client,
so provider SDKs are not required.

## Add a provider key

At least one provider key is required for generation. Discovery for OpenAI and
Gemini built-in voices works before keys are configured.

```bash
rudi secrets set OPENAI_API_KEY
rudi secrets set ELEVENLABS_API_KEY
rudi secrets set GEMINI_API_KEY
```

Set only the providers you plan to use. Restart the RUDI router or the host
integration after changing secrets so the stack process receives the updated
environment.

## Provider matrix

| Provider | Default model | Default voice | Default format | Important constraints |
|---|---|---|---|---|
| OpenAI | `gpt-4o-mini-tts` | `marin` | MP3 | Supports delivery instructions and speed. Older `tts-1` models have fewer voices and no instruction field. |
| ElevenLabs | `eleven_multilingual_v2` | none | MP3 | A voice ID is required; use `list_speech_voices`. Natural-language `instructions` are not silently translated. WAV 44.1 kHz may require a Pro-tier plan. |
| Gemini | `gemini-3.1-flash-tts-preview` | `Kore` | WAV | TTS is preview; output is 24 kHz, 16-bit mono PCM wrapped as WAV. Use instructions for pacing; numeric `speed` is unsupported. |

The shared synchronous contract accepts at most 4,096 text characters. This is
deliberately conservative and matches the tightest supported provider boundary.
Long-form chunking requires a separate operation with explicit continuity and
partial-failure semantics.

## Discover readiness

```json
{}
```

Call `list_speech_models` with the empty object above. The result reports each
provider's `secret_status.configured`, active defaults, supported models,
formats, and controls without sending a provider request.

List OpenAI voices:

```json
{
  "provider": "openai"
}
```

List the authenticated ElevenLabs inventory:

```json
{
  "provider": "elevenlabs",
  "page_size": 50,
  "search": "narrator"
}
```

## Generate speech

Before invoking `generate_speech`, the caller must establish voice-use
authorization: the caller's independently established set of consents,
licenses, contractual permissions, and other rights required for the selected
voice and intended generation and downstream use. Hold generation while that
authorization remains unresolved.

Provider authentication, inventory visibility, `provider_reported_is_owner`,
and successful provider generation may evidence provider-side technical access
or entitlement, but none establishes voice-use authorization by itself. This v1
stack does not collect, verify, persist, or enforce an attestation of
voice-use authorization.

OpenAI:

```json
{
  "provider": "openai",
  "text": "Today is a good day to build something useful.",
  "voice": "marin",
  "instructions": "Warm, clear, and conversational.",
  "format": "mp3"
}
```

ElevenLabs:

```json
{
  "provider": "elevenlabs",
  "text": "Today is a good day to build something useful.",
  "voice": "your-elevenlabs-voice-id",
  "model": "eleven_multilingual_v2",
  "format": "mp3"
}
```

Gemini:

```json
{
  "provider": "gemini",
  "text": "Today is a good day to build something useful.",
  "voice": "Kore",
  "instructions": "Warm, clear, and conversational.",
  "format": "wav"
}
```

Successful results include `out_path`, provider, model, voice, format, byte
count, elapsed milliseconds, and the provider request ID when one is returned.
Files are never overwritten.

## Safety and disclosure

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

Secrets are read only from the process environment and are redacted from
unexpected error details. Remote response bodies are size-bounded and are not
echoed in errors.

Generated speech results include `ai_generated: true`,
`disclosure_policy: "context_dependent"`, and
`disclosure_review_required: true`. `ai_generated` is a result-level fact, not
provenance embedded in the audio or file metadata; callers should preserve the
result metadata when storing or transferring the asset.

Before presenting, playing, communicating, or publishing the speech to humans,
the downstream surface must complete an applicable-policy review covering
the provider, intended use, audience and jurisdiction, platform rules, and
organizational policy. Hold the human-facing action while requirements remain
unresolved, then apply disclosure when the review requires it or the
organization elects it. Generation, storage, transfer, or machine-only
processing alone does not require visible disclosure under this contract.
Disclosure does not cure consent, licensing, platform, or legal restrictions.

See [API_CONTRACT.md](API_CONTRACT.md) for the stable request/error contract and
[LIVE_SMOKE_TESTS.md](LIVE_SMOKE_TESTS.md) for key-onboarding verification.
