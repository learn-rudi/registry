# Changelog

Append-only log. Newest entries at top. Every agent doing meaningful work adds one line.

Format: `YYYY-MM-DD — <agent> — <what changed> [— <why, if non-obvious>]`

---

## 2026-08-31

- 2026-08-31 — Codex — Added a structured-run `whisper.cpp` backend with logical `large-v3-turbo` model resolution, PATH-aware Intel/Apple Silicon Homebrew discovery, Metal-friendly defaults, VAD meeting mode, glossary prompting, optional DTW word timestamps, CLI/MCP controls, engine provenance, schema-v1 compatibility, and focused red/green tests. Editing mode suppresses VAD on whisper.cpp 1.8.x because its full-JSON token offsets otherwise use the compressed VAD timeline; the transcription option parser is isolated from the debt-baselined CLI; five-minute M3 Pro benchmarks completed in 13.9s (meeting) and 18.9s (editing), and the 27:18 recording completed in 53.8s.

## 2026-07-10

- 2026-07-10 — Codex (docs) — Standardized **Final Render Approval** as the canonical prose term for the generic Approval record with machine scope `final-render`. It accepts one exact hash-identified creative final and its Final Render Plan after render-specific QA; Baseline and Sequence Optimization Approvals remain immutable upstream lineage, Mechanical Derivatives rely on their approved parent under the derivative contract and are not freshly approved, and Posting Approval remains separate.
- 2026-07-10 — Codex (docs) — Made Approval non-transitive across hash-different creative renders: exact final render + canonical Final Render Plan identity now require render-specific QA and operative Approval while baseline/Sequence Approvals remain immutable lineage. `output.schema.json` v2 records that binding and the narrow, separately QA'd bitrate/codec-only mechanical-transcode exception; Posting Approval remains platform/timing-only. Phase 1 remains manual conformance.
- 2026-07-10 — Claude (docs) — Schema strictness decision: `output.schema.json` is **full contract proof**, not an inventory manifest. Now required: `source.planRevision`, `approval.scope` + `approval.decisionRef`, `verification.qaRefs` (min 1; transcript refs stay optional — not every video has speech), `destination.resolvedPath`, `storyTopic` when story-owned, `media.kind` with kind-conditional duration/dimensions, `minLength: 1` on required strings. Verified with ajv: the hollow-but-previously-valid manifest now fails with 18 errors; a fully provenanced one passes. Two draft-07-inexpressible checks recorded as exporter obligations in VP-6: media/render hash equality and resolvedPath-contains-media. Also swept the last bare `output.json` references in VP-6 and PROCESS_MAP to "manifest sidecar".
- 2026-07-10 — Claude (docs) — Manifest naming decision: a Delivery Output is a media file plus a `<media-basename>.output.json` sidecar — the only manifest form, including inside per-output folders. Resolves the flat `renders/final/` collision where two variants (source-order + optimized) would have fought over one `output.json`. Updated VP-6, output.schema.json description, PROCESS_MAP, and CONTEXT.md terms.
- 2026-07-10 — Claude (docs) — Closed the VP-6 gap: wrote `docs/processes/VP-6-promote-retire.md` around the Delivery Output contract (Approved Render + Output Destination + output.json = Delivery Output) and added `schemas/output.schema.json`. Decisions recorded from Brandon: three-tier storage model (stack code disposable / run state cleanable / outputs durable, never auto-cleaned); Source Ownership supplies an *overrideable default* destination (ad hoc → `~/.rudi/outputs/video-editor/`, story-owned → topic `renders/final/`), overrides must record a reason; state standardizes under `~/.rudi/state/stacks/video-editor/`; existing 13 runs (~6.5 GB) retire in place. Phase 1 = manual conformance (the `promote` command copies bytes only); Phase 2 = enforced `export`/`retire` commands + configurable runs root. Added Delivery Output / Output Destination / Retirement to CONTEXT.md; PROCESS_MAP gained a Storage model section.
- 2026-07-10 — Claude (docs) — README cleanup: archived the stale "Current Vertical Slice" section to `docs/archive/2026-05-first-runs-vertical-slice.md` (its four runs no longer exist on disk); collapsed three near-identical pipeline command blocks into the single "Commands" section; removed .DS_Store noise. Flagged, not touched: `runs/` at 5.9 GB with no retention policy (VP-6 gap, needs human call) and orphaned `manifest.v2.json` (nothing in the RUDI CLI reads it).
- 2026-07-10 — Claude (docs) — Added formal process layer `docs/processes/` (PROCESS_MAP.md + VP-0 intake & triage, VP-1 understand, VP-2 baseline edit) from Brandon's dictated workflow. Fixed cross-doc incongruencies: README "First Pass" section renamed "Baseline Pass Steps" ("first-pass" now exclusively means the disposable Downloads path); CONTEXT.md gained Baseline Pass / First-Pass / Triage terms; SOPs aligned to the *implemented* `RunState` enum in `src/lib/states.js` (imported→transcribed→clustered→analyzed→planned→rendered→reviewed) instead of inventing parallel state names; all workflow docs now point to PROCESS_MAP.md with "SOP wins" as the conflict rule. Known gaps recorded: no post-`reviewed` states, no VP-3/VP-6 SOPs, no run retention policy.

---

## 2026-05-24

- 2026-05-24 — Claude (builder) — **Shipped the dedup**: extracted 5 new shared lib modules (`lib/deepseek.js`, `lib/timeline.js`, `lib/probe.js`, `lib/transcript.js`, `lib/format.js`) to absorb 7 function-level duplicates that the import-graph debt scanner doesn't see. All 17 ops now import from lib; functional E2E unchanged; all 6 test suites pass. Two duplicates kept intentionally (`operations/probe.js#summarizeProbe` is the artifact contract; `operations/review.js#formatSeconds` has a different return shape).
- 2026-05-24 — Claude (builder) — Audited function-level duplication across operations; logged 7 high-to-low severity duplicates (DeepSeek client, `mapSourceTimeToTimeline`, `summarizeProbe`, `normalizeWord`, `roundTime`, `parseFrameRate`, `formatSeconds`) in BUILD-NOTES-2026-05-24.md. Stack debt scanner reports 0 findings — it only sees graph-level issues, not function-level dup.
- 2026-05-24 — Claude (builder) — `chapters` polish: title char limit 28 → 40 (titles like "Misconceptions About Platforms" no longer truncate mid-word); short-first-chapter slivers now merge forward so the video opens on a real chapter at 0:00 instead of a 4 s sliver.
- 2026-05-24 — Claude (builder) — Default Whisper model `tiny` → `base` in `config/defaults.js`. Proper nouns survive ("Claude Code" stays "Claude Code"). +20 s on a 3 min video, well worth it.
- 2026-05-24 — Claude (builder) — `about` op now generates a DeepSeek content summary (title, topic, summary, mentions, suggested slug) when transcript exists. Cached in new `content.json` artifact, invalidates on transcript word-count change. Reads `DEEPSEEK_API_KEY` from env → rudi secrets → `.env` fallback. Fixes the prior "609 words / [object Object]" Content section into a real "what is this video" doc.
- 2026-05-24 — Claude (builder) — Validated full pipeline on a horizontal 16:9 talking-head explainer (`runs/2026-02-05-12-20-14`). Confirmed the vertical-tuned chapter/insight components scale to landscape with no positioning issues. End-to-end runtime ~8 min for a 3:33 source (Remotion render is the bottleneck).
- 2026-05-24 — Claude (builder) (with linter/codex assist) — Reframed `init.js` as a transactional workflow with `ffprobe`/`ffmpeg` dependency checks, rollback on failure, and `--refresh`/`--force` modes. Added explicit `RunState` enum + transition table in `lib/states.js`; wired state advancement through `silence`, `transcribe`, `narrate`, `narrate-vision`, `render-rough`. Centralized DEFAULT_ARTIFACTS + DEFAULT_SETTINGS in `config/defaults.js`; added `project.schema.json` + `lib/project-schema.js` for write-time validation.

## 2026-05-23

- 2026-05-23 — Claude (builder) — Added `insights` op (DeepSeek default, Claude/Ollama fallbacks) that extracts 1 premise card + 2 mid/late teaching insights; rendered via new `InsightCardLayer` (dims source, 💡 TIP tag + headline + body). See BUILD-NOTES-2026-05-23.md.
- 2026-05-23 — Claude (builder) — Added `chapters` op with research-backed sizing (8-chapter target for 90s-3min videos) and local Ollama `llama3.2:3b` for chapter titles. Composer adds `ChapterProgressBar` + `ChapterLabel` with frosted backdrops; both fade during insight cards. Chapter UI moved out of macOS menu bar zone.
- 2026-05-23 — Claude (builder) — Added `narrate-vision` op (Ollama `llava`) and lighter-weight `narrate` op (regex heuristic) producing per-silent-section labels; flows into `composition.textOverlays` via `plan.js` (suppressed when chapters present to avoid double-labeling).
- 2026-05-23 — Claude (builder) — Added variable playback speed per `keepRange` (schema `speed` field; ffmpeg `setpts/atempo` chain; Remotion `playbackRate` prop). Added `silence.speedupInsteadOfCut` flag → `silence.spedRanges`; `plan.js` carves sped around talk so talk always wins on overlap.
- 2026-05-23 — Claude (builder) — Bug fix: `src/operations/transcribe.js` was using `require()` inside ESM (broke transcribe entirely); replaced with proper imports.
- 2026-05-23 — Claude (builder) — Disabled watermark by default in `init.js` (was always-on "rough cut" placeholder). Existing runs unchanged.

## 2026-05-15

- 2026-05-16 — Codex — Folded the legacy slide-extractor behavior into the stack as the `slides` command and removed the standalone slide-extractor archive.
- 2026-05-15 — Codex — Moved lower-thirds into the Remotion composer and added the `lower-third` stack command so the old Premiere lower-thirds folder can be removed.
- 2026-05-15 — Codex — Created consolidated RUDI video-editor stack from video-agent, transcript video-editor, and silence-cutter surfaces; added direct commands, silence presets, batch cutting, manifest metadata, and focused tests.
- 2026-05-15 — Claude (builder) — Added 11 section-header overlays (top-center, 4.3s pop with 400ms fade) onto img-0065-clean/rough-v1-captions.mp4 via direct FFmpeg+libass pass; produced renders/rough-v1-final.mp4. sections.ass is hand-authored, lives in the run dir.
- 2026-05-15 — Claude (builder) — Added run img-0065-clean from human-cleaned rough-v1.mp4 (800.87s); ran transcribe + captions + render-captions, produced rough-v1-captions.mp4 with word-timed pop-on captions.
- 2026-05-15 — Claude (builder) — Ran rough-cut pipeline on img-0065-2026-05-08 (1.4GB / 21min iPhone vertical MOV), produced renders/rough-v1.mp4 via render-rough; 35.0% removed (449s of 1283s), 3.96 cuts/min cut density.

## 2026-05-09

- 2026-05-09 — Codex — Added word-timed captions, FFmpeg/libass `render-captions`, and rendered `camera-synced/rough-v2-captions.mp4`.
- 2026-05-09 — Codex — Marked `camera-synced/rough-v2.mp4` as the human-approved clean long-form pacing baseline.
- 2026-05-09 — Codex — Added word-gap transcript clustering and rendered tighter `camera-synced/rough-v2.mp4` after `rough-v1.mp4` kept too much dead space.

## 2026-05-08

- 2026-05-08 — Codex — Added FFmpeg `render-rough` for long plain cuts, processed `camera-synced`, and rendered/QA'd `rough-v1.mp4`.
- 2026-05-08 — Codex — Added the first `img-5072` effects pass with watermark control, compact top-left callouts, eased punch-ins, and rendered `rough-v2-effects.mp4`.
- 2026-05-08 — Codex — Marked `img-5072/rough-v2-captions.mp4` as the human-approved captioned baseline.
- 2026-05-08 — Codex — Added reusable `captions` op, Remotion caption layer, run-local caption corrections for `img-5072`, and rendered `rough-v2-captions.mp4`.
- 2026-05-08 — Codex — Marked `img-5072/rough-v2.mp4` as the human-approved pacing baseline for the next captions/effects phase.
- 2026-05-08 — Codex — Added `img-5072` tighter `rough-v2.mp4` comparison pass with 1.0s transcript-cluster padding and recorded the A/B pacing tradeoff in run review notes.
- 2026-05-08 — Codex — Added run `img-5072`, rendered vertical `rough-v1.mp4`, tuned sparse-demo cluster padding, and fixed Remotion render metadata to use normalized working-media dimensions for rotated iPhone sources.
- 2026-05-08 — Codex — Documented the next closed-loop design: `review-actions.json` approval layer, confidence tiers, convergence criteria, and symmetric transcript model comparisons.
- 2026-05-08 — Codex — Added `review` op with `review.json`/`review.md`, documented rough-cut learnings in `LEARNINGS.md`, and updated project artifacts/schemas for generated reviews.
- 2026-05-08 — Codex — Added second run `movie-2026-05-08-1232`, rendered `rough-v1.mp4` and `rough-v2.mp4`, increased run-local cluster padding to 500ms, and recorded transcript ambiguities around `Yeah, and`, `TikTok form`, and `hit stop`.
- 2026-05-08 — Codex — Rendered and QA'd `rough-v6.mp4`; made transcript audit correction-aware with required phrase checks, added media-duration tail padding for transcript clusters, and documented the remaining outro transcript ambiguity.
- 2026-05-08 — Codex — Added transcript phrase clustering and run-local transcript corrections; `plan` now prefers `transcript-clusters.json` over silence/audit ranges.
- 2026-05-08 — Codex — Tightened cut resolution so gaps overlapping transcript words resolve to `skip`, preventing removal of phrases like "responsible use of digital intelligence."
- 2026-05-08 — Codex — Added source/output Whisper transcription, transcript-output diffing in `cut-audit`, auto-transcribe-on-render wiring, and rendered `rough-v4.mp4` from transcript-audited ranges.
- 2026-05-08 — Codex — Rendered and QA'd `rough-v3.mp4` through the new Remotion audio-crossfade path; recorded high cut-density audit result in run review notes.
- 2026-05-08 — Codex — Added `cut-audit` contract/op with adjust-shorter-skip resolution trail, cut-density reporting, and 40ms Remotion audio crossfades.
- 2026-05-08 — Codex — Added human cut-review gate and resolution warning before transcript work.
- 2026-05-08 — Codex — Updated README and package metadata to reflect that Remotion rendering and QA now exist.
- 2026-05-08 — Codex — Added Remotion composer, render script, QA op, and rendered `rough-v2.mp4`; switched clip trimming to nested negative `Sequence` after `trimBefore` produced black frames.
- 2026-05-08 — Claude (advisor) — Added AGENTS.md and CHANGELOG.md so multi-agent work has shared orientation and an append-only audit trail.
- 2026-05-08 — Codex — Scaffolded `video-agent/` with no-deps Node CLI: `init`, `probe`, `normalize`, `silence`, `plan` ops; JSON schemas; first run `movie-2026-05-08-1229/` produced `working.mp4`, `probe.json`, `silence.json`, `composition.json`.
- 2026-05-08 — Claude (advisor) — Discovered macOS TCC blocks sandbox file reads from `~/Downloads`; recommended source files always be copied into the run folder, never referenced by external path.
