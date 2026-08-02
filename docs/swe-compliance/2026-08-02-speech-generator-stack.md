## Phase 0: Baseline And Manual Lookup

- Scope: add a modality-first, multi-provider `stack:speech-generator` package to the public RUDI registry and leave it installable and ready for OpenAI, ElevenLabs, or Gemini API keys.
- Files inspected before editing: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `catalog/stacks/image-generator/**`, `catalog/stacks/video-generator/**`, `catalog/stacks/openai/**`, `catalog/stacks/google-ai/**`, registry verification scripts, existing ADRs, and current worktree status.
- Relevant SWE manual sections: `10-Engineering-Operating-Manual-Index.md`; Phase 2/3 in `09-Build-Order-and-Engineering-System.md`; G1/G2 in `07-Backend-Application-Engineering-Standard.md`; Appendix C in `01-Master-Engineering-Doctrine.txt` for red-green-refactor.
- External contract sources: current official OpenAI speech-generation docs, ElevenLabs text-to-speech/list-voices API references, and Gemini TTS docs.
- Current-state commands: `git status --short`; targeted `rg`; manifest/source/test reads; official provider-document lookup.
- Risks and invariants:
  - Preserve all pre-existing dirty work, including edits in `catalog/stacks/openai`, `catalog/stacks/google-ai`, and generated `index.json`.
  - Never log or return API keys or authorization headers.
  - Treat tool arguments, provider responses, audio bytes, and output paths as untrusted.
  - Write only beneath `~/.rudi/outputs`; never overwrite an existing output.
  - Keep the provider-portable speech contract separate from transcription, realtime agents, voice cloning, and provider-suite compatibility work.
- Exit criteria: scope and trust boundaries are explicit; relevant current provider contracts are verified from primary sources.

## Phase 1: Scope Lock

- In scope:
  - Add `catalog/stacks/speech-generator/manifest.json`.
  - Add a Python MCP server with `list_speech_models`, `list_speech_voices`, and `generate_speech`.
  - Add OpenAI, ElevenLabs, and Gemini provider adapters behind one validated modality contract.
  - Add focused unit tests, MCP stdio smoke tests, API contract, README, and readiness notes.
  - Generate `index.json` only through `npm run indexes:sync`.
  - Run the repo-first Grill With Docs Loop and record the durable stack-boundary decision in the smallest justified doc target.
- Non-goals: voice cloning/design, speech-to-speech, sound effects, transcription, realtime/streaming playback, multi-speaker dialogue, automatic provider fallback, long-form chunking/stitching, removing existing provider-suite tools, or live billable generation without user-supplied keys.
- Expected files touched:
  - `catalog/stacks/speech-generator/**`
  - `docs/swe-compliance/2026-08-02-speech-generator-stack.md`
  - `docs/adr/0004-*.md` only if the grill concludes an ADR is justified
  - generated `index.json`
- External inputs and trust boundaries: MCP JSON arguments, provider/model/voice identifiers, text and instructions, environment-mediated secrets, remote API responses, base64/encoded audio, response headers, and local output paths.
- Failure behavior to define: `validation`, `missing_secret`, `unsupported_combo`, `provider_error`, `timeout`, `invalid_audio`, `write_failed`, `unknown_tool`, and redacted `internal_error`.
- Interface decisions:
  - Canonical operation is `generate_speech`; `provider` remains explicit.
  - Common text limit is 4,096 characters for the synchronous v1 contract.
  - Provider capabilities and credential readiness are discoverable without generation calls.
  - ElevenLabs voice discovery is credentialed and paginated; OpenAI and Gemini built-in voices are static.
  - Provider-specific capabilities are validated rather than silently ignored.
- Exit criteria: only the listed files and behavior are authorized for implementation.

## Phase 2: Red Tests

- Observable behavior to prove first: model discovery returns all three providers, current defaults, supported formats/controls, and secret readiness without making provider API calls.
- Test files to add or edit: `catalog/stacks/speech-generator/tests/test_tools.py`, followed incrementally by provider/validation/output tests and `tests/test_mcp_stdio.py`.
- Red command: `python -m unittest discover -s catalog/stacks/speech-generator/tests -p 'test_*.py'`.
- Expected failure: the new speech-generator modules do not exist before implementation.
- Recorded red result: the initial command failed with `ModuleNotFoundError: No module named 'tools'`. Incremental tests then failed for each missing contract slice (stable errors, secret handling, provider audio, provider adapters, runtime dispatch, voice discovery, and MCP stdio exposure) before the smallest implementation made that slice pass.
- Contract-refinement red result: after the grill, the isolated UV command failed with `KeyError: 'disclosure_policy'`, the old ElevenLabs `is_owner` result shape, malformed string ownership coerced to `true`, and a missing MCP voice-use-authorization warning. These were the expected failures for the accepted pre-v1 contract changes.
- Exit criteria: the expected red failure is captured before implementation; each added behavior test is made green without weakening the assertion.

## Phase 3: Implementation

- Implementation rules: provider-portable public tools; provider-specific adapters; stdlib HTTP with explicit timeouts; no new provider SDK dependency; small explicit operations; exact input validation; redacted failures.
- Files allowed to change: scope-locked files only.
- Validation and error-handling requirements:
  - Reject unknown fields, providers, models, voices, formats, oversized/blank text, unsupported provider-format/control combinations, unsafe output paths, mismatched extensions, and existing output files before provider dispatch.
  - Bound remote response size and verify WAV/MP3 bytes before writing.
  - Decode Gemini base64 PCM defensively and wrap it as 24 kHz, 16-bit mono WAV.
  - Require an ElevenLabs voice ID; use current built-in defaults for OpenAI and Gemini.
  - Map dependency timeouts distinctly and redact configured secrets from unexpected errors.
- Observability requirements: successful results include provider, resolved model, voice, format, bytes, elapsed milliseconds, output path, and provider request ID when available; no secret or raw authorization data.
- Exit criteria: all focused tests pass and the MCP server exposes exactly the contracted tools.

## Phase 4: Green Tests And Refactor

- Green command: unchanged unit-test discovery command from Phase 2.
- Refactor constraints: refactor only while focused tests remain green; do not alter existing OpenAI/Google provider suites.
- Regression checks: unit tests plus MCP stdio smoke test after any structural cleanup.
- Recorded green command: `PYTHONPYCACHEPREFIX=/tmp/rudi-speech-final-pyc uv run --with-requirements catalog/stacks/speech-generator/requirements.txt python -m unittest discover -s catalog/stacks/speech-generator/tests -p 'test_*.py'`.
- Recorded green result: 14 tests passed, including provider request mapping, bounded/sanitized ElevenLabs discovery, Gemini PCM-to-WAV handling, path and audio validation, missing-secret behavior, exact disclosure metadata, and MCP stdio discovery.
- Live-contract regression red command: `python3 -m unittest tests.test_providers.SpeechProviderAdaptersTest.test_gemini_adapter_wraps_returned_pcm_as_wav` after replacing the SDK-only `output_audio` fixture with the raw Interactions REST `steps[].content[]` audio shape.
- Live-contract regression red result: failed with the expected `KeyError: 'output_audio'`, reproducing the paid live request failure.
- Live-contract regression green result: the unchanged targeted command passed after the adapter selected the final inline L16 audio block from a model-output step and validated its MIME type, sample rate, and channel count.
- Exit criteria: focused tests and stdio smoke tests remain green after refactor.

## Phase 5: Full Verification

- Targeted tests: speech-generator unit and MCP stdio suites.
- Full suite: `npm test` at registry root.
- Build/typecheck/lint: `python -m compileall`; `npm run validate`; `npm run indexes:sync`; `npm run indexes:check`; `npm run catalog:clean:check`; `npm run build`.
- JS/TS debt scan, if applicable: no direct JS/TS source edit is planned; if a JS/TS file is edited, run the nearest-policy or structural fallback scan for that file.
- Packaging: `npm pack --dry-run --json` and inspect inclusion of the new package without generated output artifacts.
- Live smoke checks:
  - MCP initialize/tools-list/list-models without provider secrets.
  - Install the package through RUDI in an isolated temporary home when supported without disturbing the user's installed stack set.
  - Do not make billable provider calls without keys; confirm each provider reports actionable `missing_secret` readiness instead.
- Exit criteria: every required registry gate passes and installation/MCP discovery work without API keys.
- Recorded verification:
  - `npm test`: 17 test files passed; 124 tests passed and 1 was skipped.
  - `npm run validate`: 101 catalog packages passed, including `stack:speech-generator`.
  - `npm run indexes:sync`: passed and regenerated the canonical root/platform indexes.
  - `npm run indexes:check`: passed; indexes are current.
  - `npm run catalog:clean:check`: passed with zero planned cleanup targets after removing three generated speech-package `__pycache__` directories.
  - `npm run build`: passed.
  - `npm pack --dry-run --json`: passed with 670 total entries and 24 speech-generator files; no speech `__pycache__` or `.pyc` artifact was included.
  - `python -m compileall` through the isolated UV environment: passed.
  - `git diff --check`: passed.
  - JS/TS debt scan: not applicable because this task did not directly edit JS/TS source; `index.json` was generated by the required sync command.
  - Isolated local-registry install: `rudi install stack:speech-generator --no-related-skills --json` passed under `/tmp/rudi-speech-install.vE2q6O` with an isolated Python runtime. Dependencies installed, `rudi.json` updated, and the MCP index recorded all three tools.
  - Installed-package verification: the same 14 tests passed from the isolated installed copy, including MCP initialize/tools-list/list-models without provider secrets.
  - User-environment installation: installed `stack:speech-generator` from the local registry into `~/.rudi/stacks/speech-generator`; the RUDI secret store reports OpenAI, ElevenLabs, and Gemini configured, and the tool index contains all three contracted tools.
  - Paid OpenAI router smoke: passed with `gpt-4o-mini-tts`, `marin`, a valid non-empty 24 kHz mono MP3, and a provider request ID.
  - Paid Gemini router smoke: passed with `gemini-3.1-flash-tts-preview`, `Kore`, and a valid non-empty 24 kHz, 16-bit mono WAV after correcting the raw Interactions REST response parser.
  - ElevenLabs authenticated inventory smoke: passed and returned a paginated inventory.
  - ElevenLabs router generation smoke: passed with `eleven_multilingual_v2` and the standard premade `Bella - Professional, Bright, Warm` voice after the user confirmed authorization for the private smoke test; the result was a valid non-empty 44.1 kHz mono MP3 with a provider request ID.
  - Direct `rudi run stack:speech-generator` MCP-client wrapping is not a supported stdio verification path because that human-facing command emits status text on stdout. The indexed `~/.rudi/bins/rudi-router` path used by agent integrations initialized, listed, and invoked the installed tools successfully.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: speech-generator `README.md`, `API_CONTRACT.md`, readiness notes, this checklist, and the grill-selected ADR/context target.
- Final files touched: record after verification from `git status --short` and isolate pre-existing work from task-owned files.
- Commands run and results: record exact red, green, refactor, full-suite, validation, sync, hygiene, build, pack, install, and smoke results.
- Accepted debt: human listening review remains outside automated container/codec verification. Gemini remains a preview provider model.
- Grill With Docs result:
  - Accepted [ADR 0004](../adr/0004-generative-media-stack-boundary.md): modality-scoped generator stacks are canonical; provider suites remain compatibility/direct-provider escape hatches; transcription remains separate.
  - Defined result-level AI provenance and context-dependent downstream disclosure-policy review without implying embedded provenance or a stack-made legal determination.
  - Distinguished provider-authenticated voice access from caller-established voice-use authorization; v1 does not collect or verify a rights attestation.
  - Defined v1 validation as technical/structural and assigned semantic content/intended-use review to the caller rather than claiming an unimplemented moderation layer.
  - A fresh final questioner returned `backlog exhausted`; each accepted documentation change passed a fresh reviewer.
- Final task-owned artifacts: `catalog/stacks/speech-generator/**`, `docs/adr/0004-generative-media-stack-boundary.md`, this checklist, and the generated `index.json` entry. Pre-existing unrelated worktree changes were preserved.
- Remaining live verification: OpenAI and Gemini billable generation were completed only after the user supplied keys and funded the provider accounts. ElevenLabs authentication, inventory discovery, and generation with a user-authorized standard premade voice also passed. Human listening review remains downstream.
- Definition of Done:
  - `stack:speech-generator` is in the canonical catalog and generated index.
  - OpenAI, ElevenLabs, and Gemini adapters are implemented with no stubs.
  - Discovery and missing-secret behavior work without credentials.
  - The package installs and its MCP server starts.
  - Focused and full verification gates pass.
  - The grill backlog is exhausted and its accepted documentation change is reviewed.
  - The final report records verified generation for OpenAI, Gemini, and ElevenLabs while preserving the caller-side voice-use-authorization boundary.
