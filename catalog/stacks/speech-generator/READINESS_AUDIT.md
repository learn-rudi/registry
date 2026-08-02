# Speech Generator Readiness Audit

## Scope

This stack provides synchronous, single-speaker, multi-provider text-to-speech
generation. It is designed to be useful before provider keys are configured and
to fail actionably at every external boundary.

## Implemented

- Modality-first tools: model discovery, voice discovery, and speech generation.
- OpenAI, ElevenLabs, and Gemini adapters using current official REST contracts.
- Explicit provider/model/voice/format/control compatibility validation.
- Static secret readiness without provider calls.
- Authenticated, paginated, sanitized ElevenLabs voice discovery.
- Bounded timeouts and 50 MiB response limits.
- Strict Gemini base64 PCM decoding and WAV wrapping.
- Audio signature validation before writes.
- Output confinement beneath `~/.rudi/outputs/speech-generator` and no overwrite behavior.
- Structured, stable, secret-safe error results.
- Unit and MCP stdio tests that require no provider credentials.

## Live verification completed

- The stack was installed from the local registry into RUDI, all three provider
  secrets were configured in the RUDI secret store, and all three MCP tools were
  indexed.
- OpenAI generated a valid MP3 through the RUDI router with
  `gpt-4o-mini-tts` and the `marin` voice.
- Gemini generated a valid 24 kHz, 16-bit mono WAV through the RUDI router with
  `gemini-3.1-flash-tts-preview` and the `Kore` voice.
- ElevenLabs authenticated successfully and returned a paginated voice
  inventory through the RUDI router.
- ElevenLabs generated a valid 44.1 kHz mono MP3 through the RUDI router with
  the standard premade `Bella - Professional, Bright, Warm` voice after the
  user confirmed authorization for the private smoke test.

## Remaining human or authorization-gated proof

- Human playback review of pronunciation, pacing, and selected voice quality
  remains a downstream review step; container, codec, duration, and non-empty
  audio validation passed automatically.

## Accepted v1 boundaries

- Common synchronous input is limited to 4,096 characters.
- No automatic retries of billable generation requests.
- No automatic provider fallback.
- No streaming, chunk stitching, multi-speaker dialogue, voice cloning/design, or realtime voice-agent support.
- Gemini supports WAV output only in this version.
- ElevenLabs WAV availability depends on the account plan.
- `voice-use authorization` is the caller's independently established set of
  consents, licenses, contractual permissions, and other rights required for
  the selected voice and intended generation and downstream use. The caller
  must establish it before invoking generation and hold generation while it is
  unresolved.
- Provider authentication, inventory visibility, `provider_reported_is_owner`,
  and successful provider generation may evidence provider-side technical
  access or entitlement, but none establishes voice-use authorization by
  itself.
- This v1 stack does not collect, verify, persist, or enforce an attestation of
  voice-use authorization.
