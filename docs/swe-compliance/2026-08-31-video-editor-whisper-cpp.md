## Phase 0: Baseline And Manual Lookup

- Scope: Replace the structured video transcription run's Python-only execution path with a portable whisper.cpp-first backend while preserving transcript schema version 1.
- Files inspected before editing: video-editor manifest, defaults, project/transcript schemas, structured transcribe operation, direct transcription tools, whisper.cpp compatibility wrapper, CLI/MCP adapters, tests, and README.
- Relevant SWE manual sections: Engineering Operating Manual Index; Testing Doctrine; Debugging Doctrine; Agent Co-Pilot Operating Standard; Horizontal Engineering And Codebase Stewardship Standard.
- Current-state evidence: the 27:18 client recording completed with Python Whisper `medium`, `--fp16 False`, and word timestamps after about 69 minutes; local `/opt/homebrew/bin/whisper-cli` 1.8.3 supports Metal, flash attention, VAD, full JSON, and DTW.
- Horizontal-pattern scan: three transcription mechanisms exist (`src/operations/transcribe.js`, `src/transcription-tools.ts`, and `scripts/whisper-cpp-openai-wrapper.js`). This change will standardize the structured-run contract on the existing wrapper and record direct-tool consolidation as follow-up rather than widening scope.
- Risks and invariants: keep source media unchanged; preserve schema v1; retain valid segment and word timing monotonicity; never store machine-specific model paths in portable project configuration; fail with actionable prerequisites when whisper.cpp is explicitly requested.
- Initial risk tier and rationale: Medium because the change affects a shared transcription boundary and downstream editing artifacts, but is local, reversible, and does not change secrets or production persistence.
- Exit criteria: baseline evidence captured, clean isolated worktree created from `origin/main`, relevant source/tests mapped.

## Phase 1: Scope Lock

- In scope: whisper.cpp backend selection; logical `large-v3-turbo` model resolution; Metal/flash-attention defaults; optional VAD; glossary/initial prompt; DTW/full JSON only when word timestamps are requested; unchanged schema-v1 normalization; focused docs and tests; a five-minute benchmark.
- Non-goals: diarization, translation, quantized models, model auto-download during transcription, Homebrew upgrades, direct-tool consolidation, registry publication, or client application changes.
- Expected files touched: `catalog/stacks/video-editor/scripts/whisper-cpp-openai-wrapper.js`, structured transcription operation/config/schema/CLI/MCP adapters as required, focused tests, README/CHANGELOG, and this checklist.
- External inputs and trust boundaries: media paths, model names/paths, glossary prompt, environment overrides, whisper.cpp JSON, and subprocess exit/output are untrusted and validated before use.
- Failure behavior to define: explicit engine requests fail closed with actionable missing-binary/model/VAD errors; `auto` may fall back to Python with visible provenance; malformed whisper.cpp JSON fails before writing a transcript artifact.
- Authorized external actions: the initial authorization covered official model downloads and local benchmarks. The user subsequently authorized staging, committing, pushing, opening a draft PR, and bringing the Admin Mac to the same accepted source/runtime state. Merge remains outside scope.
- Commit strategy and authorization: slice 1 committed the backend/contract/tests/docs; slice 2 adds the portability regression discovered during Admin deployment. Both remain reviewable on `codex/video-editor-whisper-cpp` and draft PR #56.
- Horizontal-obligation disposition: standardize the structured-run contract now; investigate later consolidation of direct audio tools and the compatibility wrapper behind one owned adapter.
- Review and approval gates: focused red/green tests, package suite/build, registry gates, debt scan, live benchmark, diff review, and documented independent-review gap if a fresh reviewer cannot be invoked.
- Exit criteria: behavior, file boundary, failure semantics, and publication boundary are explicit.

## Phase 2: Red Tests

- Observable behavior to prove: meeting transcription uses whisper.cpp VAD and glossary without DTW/full-token JSON; editing transcription requests DTW/full JSON, suppresses VAD to avoid whisper.cpp 1.8.x compressed-timeline token offsets, and still normalizes to schema v1.
- Test files to add or edit: focused wrapper/backend tests under `catalog/stacks/video-editor/test/`.
- Red command: `node --test test/whisper-cpp-wrapper.test.js` from the stack directory.
- Expected failure: current wrapper always emits full JSON, ignores VAD/glossary/word-timestamp intent, and structured runs select Python Whisper.
- Exit criteria: each red run fails on the intended behavioral assertion.

## Phase 3: Implementation

- Implementation rules: reuse the existing compatibility wrapper; make engine selection explicit and portable; resolve logical model names only against approved local model directories or explicit environment overrides; keep source media unchanged.
- Files allowed to change: only the scope-locked video-editor files, focused tests/docs, and generated registry index if manifest content changes.
- Validation and error-handling requirements: validate engine enum, booleans, prompt type/length, model/VAD existence, whisper.cpp JSON shape, and subprocess failure context.
- Observability requirements: transcript metadata records engine command, logical model, language, word-timestamp mode, VAD mode, and prompt presence without embedding prompt content or machine-only paths.
- Exit criteria: smallest implementation passes the unchanged red test and preserves schema v1.

## Phase 4: Green Tests And Refactor

- Green command: rerun each focused red command unchanged.
- Refactor constraints: only consolidate helpers needed to prevent wrapper/structured-run drift; do not absorb direct-tool redesign.
- Regression checks: project schema defaults, CLI/MCP tool contract, downstream transcript consumers, and wrapper conversion fixtures.
- Commit checkpoint: keep task paths isolated in this worktree and stage only the explicit video-editor/index/compliance paths after authorization.
- Exit criteria: focused tests remain green after any refactor.

## Phase 5: Full Verification

- Targeted tests: wrapper/backend, project schema, MCP tools, and transcript consumers.
- Full suite: `npm test` in `catalog/stacks/video-editor`.
- Build/typecheck/lint: `npm run build`; registry-prescribed validation/index/package gates when catalog metadata changes.
- JS/TS debt scan: scan only edited JS/TS files with the RUDI SWE debt scanner; errors block closure.
- Live smoke checks: transcribe a representative five-minute section with `large-v3-turbo` + Metal + VAD + glossary; run meeting mode without DTW and editing mode with DTW/full JSON; validate schema and timing invariants; then run a synthetic Admin Mac smoke test through PATH discovery.
- Independent review: issue-loop fresh-context review is required before merge. The first review found three blocking contract violations plus two P2 findings. Focused red-green remediation closed all five; independent re-review returned `ready to commit` with no blocking correctness, schema, portability, or contract findings.
- Risk-tier approval: user reviews benchmark and diff before any publication/default rollout.
- Exit criteria: tests/build/gates pass, benchmark evidence is reproducible, and no blocking review finding remains.

## Phase 6: Docs, Contracts, And Closure

- Docs or API contracts to update: transcription engine/model/VAD/glossary/word-timestamp behavior, runtime prerequisites, fallback semantics, and benchmark notes.
- Final files touched: record after implementation.
- Commands run and results: record exact red, green, build, debt, benchmark, and schema validation commands.
- Evidence artifacts: completed baseline transcript; five-minute benchmark transcript/log/timing; model checksums; source video checksum.
- Independent-review result: a fresh-context read-only reviewer initially returned `needs fixes before merge` and recorded three P1 plus two P2 findings on issue #57. After remediation, the same independent reviewer confirmed every finding closed and returned `ready to commit`; merge remains conditioned on green branch CI and peer runtime verification.
- Commit ledger and publication status: commit `02167984401f3e15ec62c9d8291d98cb54f81f3e` contains the backend migration; commit `95cb1a77467c7fa2dd50598a921b0afcb2d8e616` records PATH-aware Homebrew discovery after Admin validation; commit `4b1338e40e70a0b4a3925f9c4043381b602804ad` extracts the transcription parser from debt-baselined `src/cli.js`. All were pushed to `codex/video-editor-whisper-cpp`, and draft PR #56 is open. PR verification also exposed two pre-existing init tests that generated fixtures with a host `ffmpeg`; their fixture boundary is made hermetic before closure. The validated runtime files were deployed narrowly to both installed stacks; builds passed, `rudi check stack:video-editor --json` reported ready on both Macs, and the stack indexed 39 tools. The full Admin `rudi index --json` also reported 13 unrelated pre-existing stack/secret failures.
- Horizontal obligations opened, closed, or accepted: direct transcription-tool consolidation remains an explicit investigate obligation.
- Final verdict: ready to commit and publish to PR #56; merge is gated on green branch CI and peer runtime verification.
- Accepted debt: the direct `src/transcription-tools.ts` surface retains its separate backend path; transcript and provenance writes are sequential, so an exceptional second-write failure can leave a transcript without matching provenance while run state remains unadvanced; full-precision identity is enforced by canonical filename rather than content hash; raw unified validation intentionally accepts numeric coercion before strict normalized validation; dependency audits reported pre-existing findings (stack install: 12 vulnerabilities; registry install: 8 vulnerabilities), and no out-of-scope automatic dependency upgrades were applied.
- Proof gaps: benchmark quality was spot-checked against the completed Python baseline but not scored against a human reference transcript.
- Definition of Done: current client transcript delivered; hardened branch re-reviewed with no blocking findings; CI green; both installed stacks validated at the accepted revision; PR merged; issue and branch cleanup complete; both repository peers synchronized to `main`.

## Completed Evidence

- Red/green wrapper loop:
  - Red: `node --test test/whisper-cpp-wrapper.test.js` failed because the wrapper ignored VAD/glossary intent and always requested full JSON.
  - Green: meeting mode emitted VAD + prompt + ordinary JSON; editing mode emitted DTW + full JSON.
  - Second red: editing with VAD exposed source-timeline token misalignment; the focused test failed until editing mode suppressed VAD.
- Red/green structured contract loop:
  - Red: `node --test test/transcribe-backend.test.js` failed because the project schema rejected engine/VAD/glossary settings.
  - Green: explicit whisper.cpp structured runs preserved transcript schema version 1 and engine provenance.
  - MCP red/green: `node --test test/mcp-tools.test.mjs` failed on missing `engine`; it passed unchanged after CLI/MCP controls were wired.
- Admin portability red/green loop:
  - Red: `node --test test/whisper-cpp-wrapper.test.js` selected the hard-coded Apple Silicon `/opt/homebrew/bin/whisper-cli` instead of the fake PATH binary, proving Intel Homebrew discovery was missing.
  - Green: wrapper/backend tests passed with `WHISPER_CPP_BIN` and `AUDIO_TOOLS_WHISPER` unset and a fake `whisper-cli` supplied only through PATH; runtime resolution now checks PATH plus both Homebrew prefixes.
- Registry architecture red/green loop:
  - Red: PR check `Test, Build & Verify` failed because `src/cli.js` grew from its 824-line debt baseline to 889 lines.
  - Green: the transcription option parser moved to `src/transcribe-cli-args.js`, `src/cli.js` returned to exactly 824 lines, and `npm run stacks:verify -- --changed-from fd9816b9b45b73a9b43520d48146aa6c782cf5b2 --prepare` passed the full video-editor suite.
- Registry test-hermeticity red/green loop:
  - Red: the next Linux PR run reached the full stack suite but two init tests failed with `spawn ffmpeg ENOENT` because fixture creation depended on a host binary.
  - Green: `test/init.test.js` now prepends bounded fake `ffmpeg`/`ffprobe` executables and uses a synthetic source fixture; the focused init tests and the exact changed-stack verification command pass without using a host media binary.
- Independent-review remediation loop:
  - Red: `{}` from a successful Whisper process was normalized and written; malformed native offsets/probabilities were accepted; schema-v1 transcripts emitted new strict-object fields; and path-like model options reached the subprocess boundary.
  - Green: native whisper.cpp JSON, unified Whisper JSON, normalized transcript schema, relational timing, flat-word identity, and stats are validated before artifact write/state advancement; backend details moved to `transcript-*.provenance.json`; path-like models fail before execution; unusable auto prerequisites fall back to Python.
- Focused verification: 19 focused tests passed across wrapper, backend, transcript validation, and project schema surfaces.
- Stack verification: `npm test` passed 36 JS/MJS tests and 12 TS tests; `npm run build` passed.
- Registry verification: `npm test` passed 256 tests; validation passed 160 catalog packages; indexes synchronized and checked current; catalog-clean check passed after removing the task-created reproducible stack `node_modules`; root build and `npm pack --dry-run --json` passed.
- Debt scan: zero findings for the ten edited JS/TS files when the CLI, wrapper, legacy MCP adapter, and focused tests were supplied as explicit entrypoints.
- Model evidence:
  - `ggml-large-v3-turbo.bin` SHA-256 `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`.
  - `ggml-silero-v6.2.0.bin` SHA-256 `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`.
- Live benchmarks on the M3 Pro:
  - Five-minute meeting mode, Metal + VAD + glossary + no word timestamps: 13.88 seconds.
  - Five-minute editing mode, Metal + DTW/full JSON + source-aligned words: 18.85 seconds.
  - Full 27:18 meeting transcript: 53.80 seconds, compared with approximately 69 minutes for the completed Python Whisper `medium` baseline (about 77× observed speedup).
  - Hardened native-output smoke: a 5.86-second meeting fixture completed in 3.80 seconds; a 3.94-second editing fixture completed in 3.86 seconds with nine validated word records.
- Admin Mac validation:
  - Intel MacBook Pro (`MacBookPro15,1`) resolved `/usr/local/bin/whisper-cli` 1.9.2 through PATH with no binary override; the runtime loaded BLAS/CPU backends, not Metal.
  - A 20.99-second synthetic meeting recording completed in 16.99 seconds with full `large-v3-turbo`, VAD, glossary prompting, and no word timestamps; normalized output was English with one segment and zero word records as requested.
  - Admin model checksums match the primary Mac, the installed stack builds, and `rudi check stack:video-editor --json` reports healthy/ready.
- Source preservation: original and RUDI-run copy both SHA-256 `349c29393261e584adf6a807f755f054e94288f9d51a0ac3b6c18ae8bd2fad0e`.
- Client delivery: commit `88e9d08` added the transcript and extraction record; Admin Mac fast-forwarded to the same revision, and both document checksums matched the primary Mac. Admin's unrelated untracked `worktrees/` directory was preserved.

## Final File Set

- `catalog/stacks/video-editor/scripts/whisper-cpp-openai-wrapper.js`
- `catalog/stacks/video-editor/src/operations/transcribe.js`
- `catalog/stacks/video-editor/src/lib/json-schema.js`
- `catalog/stacks/video-editor/src/lib/transcript-validation.js`
- `catalog/stacks/video-editor/src/lib/whisper-cpp.js`
- `catalog/stacks/video-editor/src/cli.js`
- `catalog/stacks/video-editor/src/transcribe-cli-args.js`
- `catalog/stacks/video-editor/src/legacy-cli-tools.ts`
- `catalog/stacks/video-editor/src/config/defaults.js`
- `catalog/stacks/video-editor/schemas/project.schema.json`
- `catalog/stacks/video-editor/schemas/transcript.schema.json`
- `catalog/stacks/video-editor/schemas/transcript-provenance.schema.json`
- `catalog/stacks/video-editor/test/whisper-cpp-wrapper.test.js`
- `catalog/stacks/video-editor/test/transcribe-backend.test.js`
- `catalog/stacks/video-editor/test/transcript-validation.test.js`
- `catalog/stacks/video-editor/test/mcp-tools.test.mjs`
- `catalog/stacks/video-editor/test/init.test.js`
- `catalog/stacks/video-editor/README.md`
- `catalog/stacks/video-editor/CHANGELOG.md`
- Generated registry indexes and this compliance record.
