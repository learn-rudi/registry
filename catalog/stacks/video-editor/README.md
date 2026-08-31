# RUDI Video Editor Stack

Consolidated local video editing stack for silence cutting, transcript clipping, rough-cut planning, captions, rendering, and QA.

This stack replaces the separate `silence-cutter`, `video-editor`, and `video-agent` public surfaces. `video-agent` is the base because it already owns the structured run pipeline; the older tools are represented here as direct operations.

## Capability Catalog

The full menu of current video-editor capabilities lives in
[docs/VIDEO_EDITOR_CAPABILITIES.md](docs/VIDEO_EDITOR_CAPABILITIES.md).
Use it as the starting point when deciding what kind of edit, QA pass, overlay,
captioning, motion graphic, delivery variant, or publish-prep step a recording
needs.

## Formal Processes

The canonical process layer lives in
[docs/processes/PROCESS_MAP.md](docs/processes/PROCESS_MAP.md):
VP-0 intake & triage, VP-1 understand, VP-2 baseline edit, plus human gates
and pointers for enhancements, motion, Export, Publish Prep, posting, and
Retirement. After Final Render Approval, VP-6 Export creates a byte-identical
Delivery Output of the canonical approved parent before VP-5 Publish Prep.
Retirement is a separate later cleanup decision. Every source
enters VP-0; only keeper, production-intended sources continue through the
rest of the **baseline pass** (VP-0 → VP-2). Intake is manual for now: Brandon
points at the video by path.

When this README and a process SOP disagree, the SOP wins; report the
mismatch and fix the stale doc.

## Story Workflow Boundary

For project-specific story work, follow the owning content repository's story
pipeline; do not hard-code an external checkout path in this public stack.

This stack is the technical edit workspace. It owns run-local artifacts such as
`project.json`, `composition.json`, normalized media, transcripts, captions,
QA, review files, and render caches under `runs/<slug>/`. The story topic folder
owns durable content: source takes, human-readable transcripts, scripts, edit
notes, promoted review drafts, Delivery Outputs, copy, and publish files.

`promote` is the current copy-only legacy primitive. Use it for selected
reviewable drafts when the workflow calls for a copy, but do not call it
delivery-complete. After Final Render Approval, Export a byte-identical Delivery
Output of the canonical approved parent to the routed story or ad hoc
destination, verify the hash, and write `<media-basename>.output.json`. Do not
treat the stack run directory as the canonical story archive.

## Motion Animation Book

Reusable motion graphics live in [docs/MOTION_ANIMATION_BOOK.md](docs/MOTION_ANIMATION_BOOK.md).
The book is the catalog for animation patterns such as speaker PIP shrink,
proof-card reveals, waveform timing strips, QA check grids, code-plan panels,
and pipeline ladders.

The operating process for applying those patterns to a real short lives in
[docs/MOTION_MAP_PROCESS.md](docs/MOTION_MAP_PROCESS.md).
Use it as the default SOP for transcript-specific motion proofs. V1 is the
source-order VP-2 baseline and receives baseline approval. V2 is an optional
Sequence Optimization outside VP-2; when used, it must separately declare and
audit order/removal intent, verify the render against an Expected Transcript in
that declared order, and receive its own approval. The motion decision uses the
approved selected base (V1 or V2). If the gate says yes, create V3 selected
base + motion graphics: select the proof source, write `runs/<slug>/motion-map.md`, stage media under
`composer/public/media/<run-slug>/`, create a dedicated composition, render,
generate QA frames, patch timing/layout from evidence, and hand off the proof
artifacts. If the gate says no, promote the selected approved base without
motion.

Sequence Optimization does not change the approval status of the source-order
V1 baseline, but V1 approval does not approve V2. Each V2 order or timing change
invalidates V2 evidence and approval and must repeat its own exact-plan audit,
declared-order verification, and explicit approval before the motion decision.

Motion graphics are transcript-driven. Before adding graphics to a production
short, create a motion map from the approved selected edit's Expected
Transcript and source mapping: source time, edit time, transcript anchor,
viewer job, primitive, data/copy, layout, hold time, and visual risks. The
animation book defines the graphics budget by video length and the frame-review
loop for fixing issues such as clipped chart paths, over-loud axes, PIP/card
collisions, and low-contrast text over real video.

Motion QA is part of the render loop. After timing changes, render the full MP4,
verify media properties with `ffprobe`, regenerate the contact sheet from the
motion-map beat times, and inspect focused stills for title, PIP shrink/dock,
row reveals, workflow/chart reveals, dense table holds, late step reveals, and
the closing expansion. Update the motion map when a timing fix becomes part of
the proof. Do not promote a motion proof from stale QA frames.

Current learned rules: use the no-caption approved selected render as the
preferred motion-proof source, create a new composition per proof, reuse the same QA frame
times after every rerender, and make reveal timing satisfy the documented QA
expectation before calling a frame fixed.

The default publishing format for Hoff Digital short-form remains vertical
`1080x1920` / 9:16. Landscape motion proofs are allowed for demos, LinkedIn
posts, and animation-stage exploration, but production short-form animations
need a vertical-safe layout before promotion.

## Educational Video Workflow

The baseline process for lesson-style videos lives in
[docs/EDUCATIONAL_VIDEO_WORKFLOW.md](docs/EDUCATIONAL_VIDEO_WORKFLOW.md).
Use it when a recording needs a source-order spoken-word baseline, paired
mobile/landscape renders, and—only after baseline approval—enhancements such as
lower thirds, faint background music, captions, key-term overlays, chapter
labels, title cards, end cards, thumbnails, and publish packaging.

## Publish Prep

VP-5 Publish Prep consumes the Delivery Output created after Final Render
Approval, never a run-local render. Approved parents are not edited in place
for platform upload limits. Before Cloudinary upload or social posting, run the
publish prep process in
[docs/PUBLISH_PREP_PROCESS.md](docs/PUBLISH_PREP_PROCESS.md).

Publish prep writes `publish/publish-prep.json` in the canonical story folder.
It records the selected variant, source final, upload asset, media properties,
hashes, thumbnail, hosted URLs when available, and platform readiness. If the
selected final is too large for the host, create a named `*-social-upload.mp4`
derivative that preserves the edit, dimensions, duration, and frame rate while
lowering bitrate. Treat that derivative as a delivery asset, not as a new V1,
V2, V3, or motion pass. Before hosting or upload, it must complete its own
Delivery Output sidecar, derivative QA/provenance, and invariant checks.
`publish-prep.json` is not a substitute for its output sidecar.

Phase 1 is manual and legacy-tolerant. Existing finals without output sidecars
are legacy/provisional. Report that gap; do not silently call them conforming or
claim the current tools enforce the contract.

Direct live posting remains approval-gated. Prep and dry-runs can be automated;
public posts, scheduled posts, and TikTok direct posts require explicit platform
and timing approval.

## Downloads Intake

`~/Downloads` is treated as an inbox, not a durable media archive.

For Hoff Digital/RUDI story work, move the source video into the story folder
first:

```text
<topic>/videos/source/shortform-take-N.mov
```

Then initialize the stack from that story-owned path. Keep the original
Downloads filename/path in the topic README for traceability, but the Downloads
file should be gone once processing begins.

Direct stack ingestion from Downloads is only for ad hoc/non-story processing.
When used that way, the run-local `source.<ext>` file becomes the processing
input, and selected finished renders still need to be promoted to an external
delivery or story folder by the legacy copy primitive, then completed manually
as Delivery Outputs under the Export contract.

## Terminology

Canonical domain terms live in [CONTEXT.md](CONTEXT.md).
Use `inspect` for source-understanding evidence, `probe` for metadata-only
checks, `qa` for verification evidence, and `review` for render handoffs.
`watch` remains reserved for human watch/listen review and `watch-downloads`.

## Inspect V1 Contract

The accepted v1 design for video inspection is documented in
[docs/adr/0001-run-local-video-inspection.md](docs/adr/0001-run-local-video-inspection.md).

`inspect` is the accepted canonical source-understanding command, but the
command and its artifacts are **not implemented today**. VP-1 currently uses a
manual `ffprobe` plus representative-frame fallback and records only the
evidence actually created.

The accepted target will operate on an existing run, or a local media file that
is first initialized into a run, then write diagnostic evidence under the run's
`qa/` directory:

```text
runs/<slug>/qa/
  inspect.json
  inspect.md
  frames/
    source_*.jpg
```

When implemented, `inspect` will not fetch URLs in v1, invoke external AI services by default,
mutate `composition.json`, advance run state, or replace human watch/listen
review. Default frame sampling is conservative and deterministic: representative
timestamped frames, with optional count and timestamp controls when more
coverage is needed. Native captions may help inspection, but the word-timed
source transcript remains authoritative for transcript-safe cut decisions.

## Direct Commands

```bash
npm run cli -- info video.mp4
npm run cli -- trim video.mp4 60 120 trimmed.mp4
npm run cli -- audio video.mp4 audio.mp3
npm run cli -- concat merged.mp4 part-1.mp4 part-2.mp4
npm run cli -- clips video.mp4 transcript.txt ./clips
npm run cli -- topic-clips video.mp4 transcript.txt "AI,education" ./topic-clips
npm run cli -- slides webinar.mp4 ./slides 5
npm run cli -- cut-silence video.mp4 edited.mp4 --preset aggressive
npm run cli -- cut-silence-batch ./edited video-1.mp4 video-2.mp4 --threshold -28
npm run cli -- first-pass ~/Downloads/take.mov --silence-duration 1.5
npm run cli -- watch-downloads ~/Downloads --silence-duration 1.5 --stable-seconds 10
npm run cli -- silence-presets
npm run cli -- lower-third movie-2026-05-08-1229 "Jane Smith" "Founder" 12 5 cinematic bottom-left
npm run cli -- apply-overlays ./overlay-request.json
```

Lower-third styles: `modern`, `classic`, `minimal`, `cinematic`.

Silence options:

```bash
--preset aggressive|moderate|conservative
--threshold -30
--duration 0.5
--padding 0.12
--min-keep-duration 0.25
```

## Downloads First Pass

Naming: `first-pass` always means this disposable rough-cut path. The
universal keeper pipeline is the **baseline pass**
(see [docs/processes/PROCESS_MAP.md](docs/processes/PROCESS_MAP.md)).

For ad hoc raw phone videos that land in Downloads and do not yet belong to a
story, the stack can watch Downloads and create a rough pass:

```bash
npm run cli -- watch-downloads ~/Downloads --silence-duration 1.5 --stable-seconds 10
```

The watcher polls the folder, waits until a candidate video file has stopped
changing, then processes one file at a time:

1. copy the source into a unique `runs/<slug>/` folder
2. normalize to `working.mp4`
3. detect and remove silences at or above the configured duration
4. render `renders/rough-v1.mp4`
5. run media QA and write `review.md`
6. remove the original Downloads file after the run-local source copy is
   committed and size-checked

For story work, prefer the story workflow boundary above: file the source under
`videos/source/` first, then run `init` from the story-owned source path.

Defaults are tuned for a fast first version, not a locked transcript-safe edit:
silences of `1.5s` or longer are cut, render transcript evidence is skipped,
and non-Downloads source files are archived after successful processing unless
disabled. Use this for disposable rough intake, not for final silence cleanup.
Useful options:

```bash
--silence-duration 2      # only cut longer pauses
--threshold -30           # ffmpeg silencedetect dB threshold
--padding 0.12            # keep this much sound around each cut
--no-move-source          # leave the original in Downloads
--transcribe              # slower; adds post-render transcript evidence
--once                    # scan once and exit
--retry-failed            # retry files recorded as failed in watcher state
--state-path ./state.json # override watcher state file
```

For a single file without leaving a watcher running:

```bash
npm run cli -- first-pass ~/Downloads/take.mov --silence-duration 1.5
```

## Transcript-Safe Silence Cleanup

Use this path whenever the edit is meant to preserve spoken wording. Raw silence
detection produces candidates only. Editorial intent selects an exact
source-order plan and declares every accepted complete-word removal; transcript
timing then decides whether that exact plan is safe.

The accepted target sequence is conceptual because current commands cannot
enforce it:

```text
declare intent and exact proposed plan -> audit that exact plan -> compile it
-> render with plan/render identity -> render-bound transcript comparison
-> render-bound diagnostic review -> explicit human approval
```

The currently available CLI sequence in the Commands section uses
`cut-audit -> plan`. That is a legacy, nonconforming sequence: the planner can
substitute another planning surface after audit, and singleton evidence lacks
required revision identity. Running those commands is useful diagnostic work
but is not transcript-safe proof under the accepted contract.

Before rendering, inspect `cut-audit.json`. Mechanical cuts may remove
non-speech but must not bisect or clip words; editorial cuts may remove only
complete words or phrases declared in edit intent. The exact audited plan must
be compiled into `composition.json`, with no different planning surface
substituted. After rendering, compare render-specific Output Transcript
evidence against the Expected Transcript: the corrected source transcript in
source order minus accepted Editorial Removals. Any unexplained omission,
clipped word, or duplication requires another audit/render/compare loop. Risk
percentages prioritize human listening but do not accept differences; apparent
ASR noise must be listened to and dispositioned.

`apply-overlays` accepts the `video_apply_overlays` request contract:

```json
{
  "video_path": "/path/to/source.mov",
  "format": "story",
  "overlays": [
    {
      "image_path": "/path/to/card.png",
      "start": 8,
      "end": 16,
      "transition": "fade",
      "show_pip": true
    }
  ],
  "presenter_pip": {
    "enabled": true,
    "shape": "circle",
    "size": 260,
    "position": "top-right",
    "margin": 56,
    "show": "during_overlays",
    "crop": {
      "x": 0,
      "y": 120,
      "width": 720,
      "height": 720
    }
  },
  "output_path": "/path/to/source-overlays.mp4"
}
```

## Pipeline Commands

Use the current run pipeline when an edit needs inspectable diagnostic
artifacts. Its legacy command inventory lives in the Commands section below;
that sequence does not enforce or prove the accepted exact-plan contract.

## Companion Skills

Use the registry skill `skill:shortform-your-words-script` before this stack when a story starts from an inbox note, voice memo, rough idea, article reaction, or other text-first source. The skill creates:

- `scripts/script-short.md` for editorial review, hook scoring, beat labels, cuts, and production notes
- `scripts/script-short-teleprompter.txt` for shooting, with plain prose formatted for a teleprompter

After the take is shot, file it in `videos/source/shortform-take-N.mov` and use this stack for transcription, corrections, captions, overlays, grading, render, and QA.

`init` is a workflow, not a single file write. It validates `ffprobe`/`ffmpeg`, stages the run in a temporary directory, imports the source media, writes schema-validated `project.json`, probes the media, writes `about.md`, and then commits the run folder. If the source came from `~/Downloads`, the Downloads original is removed after the committed run-local source is verified. By default it fails if the run already exists. Use `--refresh` to re-run probe/about on an existing run, or `--force` to replace an existing run from the source video.

## Layout

```text
video-editor/
  assets/          # Reusable generated/static assets for compositions
  composer/        # Remotion app and render runner
  runs/            # Per-video run folders
  schemas/         # JSON data contracts
  src/             # CLI and deterministic operations
```

## Consolidated Sources

- `media-tools/video-agent/`: structured run pipeline, schemas, captions, rendering, QA, and review loop.
- `media-tools/video-editor/`: transcript clips, topic clips, trim, audio extraction, and concat commands.
- `media-tools/silence-cutter-master/`: silence-cut presets, threshold/duration/padding controls, and batch processing surface.
- `media-tools/premiere-lower-thirds/`: lower-third concept, now implemented as Remotion overlays instead of CEP/ExtendScript.
- `media-tools/slide-extractor/`: presentation slide frame extraction, now exposed as the `slides` command.

Runtime media, generated renders, temp segments, and old local run data are intentionally not part of this stack.

## Baseline Pass Steps

(Formerly titled "First Pass" — that name now refers only to the disposable
Downloads path above. This section is the step-level expansion of the baseline
pass defined in
[docs/processes/](docs/processes/PROCESS_MAP.md):
steps 1–4 ≈ VP-0, 5–7 ≈ VP-1, 8–14 ≈ VP-2, and step 15 begins VP-3.)

The accepted target for a single talking-head workflow is:

1. Route source ownership; file story-owned media in its canonical topic before
   initialization, then register the source once.
2. Record disposition separately as keeper, disposable, or reference. Only a
   keeper continues.
3. Probe media and record technical orientation as `horizontal`, `vertical`, or
   `square`; label source/delivery variants separately.
4. Normalize the keeper source into predictable working media.
5. Create an identified Source Transcript revision whose ASR text and word
   timings remain immutable within that revision; retranscription creates a new
   revision in the accepted contract.
6. Bind non-editorial transcript corrections to that revision and derive the
   Corrected Source Transcript without rewriting it.
7. Detect silence and cluster phrases as evidence and candidates, not as an
   automatically selected edit plan.
8. Declare editorial intent, including every proposed complete spoken-word
   removal with source span, text, reason, and decision.
9. Audit that exact proposed plan for word safety and declared-removal coverage.
10. Compile the exact current audited plan into the composition and render a
    plain spoken-word baseline with plan/render identity.
11. Transcribe the exact render and compare it with the Expected Transcript,
    allowing zero unexplained omissions and looping until verified.
12. Probe media and sample frames for visual QA.
13. Generate diagnostic review artifacts tied to the exact render and plan.
14. Obtain explicit human watch/listen approval for that verified identity;
    timing changes invalidate approval and reopen VP-2.
15. Only then generate captions or add titles, lower thirds, chips, music,
    motion, or other enhancements.

The current commands below expose many of these operations, but they do not yet
enforce a universal `intake.json`, standard `edit-intent.json`, exact
audit-to-plan lineage, revision-bound verification evidence, or explicit
approval identity.

## Commands

Run from this directory. This is the current legacy CLI sequence, not proof of
the accepted exact-plan contract: `cut-audit` runs before `plan`, the planner
may substitute a different surface, and source/output transcript evidence uses
singleton files without required revision identity.

### Transcription engine

Structured runs default to the logical `large-v3-turbo` model. With `engine:
"auto"`, the stack uses `whisper.cpp` when both `whisper-cli` and
`~/.rudi/models/whisper/ggml-large-v3-turbo.bin` are available; otherwise it
falls back to Python Whisper and records that engine in transcript metadata.
Use `--engine whisper.cpp` to fail closed when the accelerated prerequisites
are missing.

Meeting transcripts should use VAD and omit word timestamps. Editing
transcripts should request DTW/full JSON for word timing. `whisper.cpp` 1.8.x
reports DTW token offsets against the VAD-compressed timeline, so the wrapper
automatically suppresses VAD when word timestamps are enabled. Segment
timestamps and ordinary meeting transcripts remain VAD-enabled.

```bash
# Fast meeting transcript with glossary guidance.
npm run cli -- transcribe my-run source large-v3-turbo \
  --engine whisper.cpp --word-timestamps false --vad true \
  --initial-prompt "Client Name, participant names, product names"

# Editing transcript with source-aligned word timestamps.
npm run cli -- transcribe my-run source large-v3-turbo \
  --engine whisper.cpp --word-timestamps true --vad true
```

On an M3 Pro, a 27:18 H.264/AAC screen recording completed in 53.8 seconds in
meeting mode. A representative five-minute WAV completed in 13.9 seconds with
VAD and 18.9 seconds with source-aligned DTW word timestamps. Treat these as
local benchmark evidence, not a cross-machine performance guarantee.

```bash
npm run cli -- init "/path/to/source.mov" movie-2026-05-08-1229
npm run cli -- init movie-2026-05-08-1229 --refresh
npm run cli -- probe movie-2026-05-08-1229
npm run cli -- normalize movie-2026-05-08-1229
npm run cli -- transcribe movie-2026-05-08-1229 source
# Review transcript-source.json and write transcript-corrections.json if needed.
npm run cli -- cluster movie-2026-05-08-1229
npm run cli -- silence movie-2026-05-08-1229
npm run cli -- cut-audit movie-2026-05-08-1229
npm run cli -- plan movie-2026-05-08-1229
npm run cli -- render-rough movie-2026-05-08-1229 rough-v1.mp4
npm run cli -- transcribe movie-2026-05-08-1229 output rough-v1.mp4
npm run cli -- cut-audit movie-2026-05-08-1229
npm run cli -- qa movie-2026-05-08-1229 rough-v1.mp4
npm run cli -- review movie-2026-05-08-1229 rough-v1.mp4
npm run cli -- captions movie-2026-05-08-1229
npm run cli -- render-captions movie-2026-05-08-1229 rough-v1.mp4 rough-v1-captions.mp4
npm run cli -- grade-source movie-2026-05-08-1229 talking-head
```

Render from the composer:

```bash
cd composer
npm run render -- movie-2026-05-08-1229 rough-v1.mp4
```

Render safety:

- Keep `settings.render.concurrency` at `1` unless you have already proved a
  higher value works for the current source. The Remotion runner clamps unsafe
  values and reduces concurrency for large media so multiple Chrome tabs do not
  overload the local static server.
- `composer/public/media/` is a regenerable cache. The render runner prunes
  stale run folders before linking the active run's media. Set
  `RUDI_VIDEO_RENDER_PRUNE_PUBLIC_MEDIA=0` only when intentionally debugging the
  public cache.

Use the FFmpeg rough renderer for long plain cuts. Use `render-captions` for long caption-only passes. Use `grade-source` before Remotion when the source image needs exposure, contrast, saturation, vibrance, sharpening, or LUT treatment while preserving clean captions/cards. Use Remotion once the pass needs text overlays, punch-ins, or other frame-level visual layers.

Current run artifact shape (artifacts vary by commands actually run):

```text
runs/<slug>/
  source.mov        # or source.<original extension>
  project.json
  probe.json
  working.mp4
  silence.json
  transcript-source.json   # current singleton; retranscription can overwrite
  transcript-output.json   # current singleton; not guaranteed render-bound
  transcript-corrections.json
  transcript-clusters.json
  captions.json
  captions.ass
  cut-audit.json
  composition.json
  review.json
  review.md
  renders/
  qa/
    frames/          # present only when frame evidence was generated manually
      source_*.jpg
  cut-review.md
```

The target `intake.json` and `edit-intent.json` contracts and revision-bound
verification evidence are not part of every current run. Likewise, the
accepted `qa/inspect.json` and `qa/inspect.md` artifacts do not exist unless an
operator created equivalent evidence manually; there is no `inspect` command
yet. Source Transcript immutability is per identified revision in the accepted
contract; the current singleton does not retain prior revisions.

## Design Rule

The agent should edit structured JSON and React composition code, then render and inspect outputs. It should not rely on opaque timeline state.

Human review is part of the loop. Automated QA can prove basic media properties, but pacing, cut timing, splice sound, and delivery framing need a watched pass before effects are layered on top.

Transcript timing supports intent and cut safety, then caption mapping after an
exact cut is approved. The accepted target loop is:

```text
immutable source transcript -> corrections overlay -> corrected source transcript
-> candidates -> declared editorial intent -> audit exact proposed plan
-> compile exact audited plan -> render with identity -> output transcript
-> expected-transcript comparison -> diagnostic review -> explicit human approval
-> enhancements
```

`transcript-clusters.json` and `silence.json` are candidate evidence, not the
accepted plan. Editorial intent must select the plan, `cut-audit.json` must
validate that exact revision, and `composition.json` must compile it without
substitution. `review.json` and `review.md` are diagnostic handoffs, not human
approval. `captions.json` maps corrected transcript timing from source time
into cut-timeline time after approval, so captions stay aligned after splices.
For long caption-only passes, `render-captions` writes `captions.ass` and burns
it onto an accepted render with FFmpeg/libass. The composer applies a short
audio crossfade at every splice to reduce clicks even when language timing is
safe.

Current enforcement differs from that accepted contract: planner behavior can
prefer transcript clusters over audited ranges, and transcript, audit, and
review files are singleton artifacts without guaranteed plan/render revision
identity. Their presence, including `state: "reviewed"`, is not proof of a
verified or approved baseline.

`review.json` is diagnostic today. The planner does not consume it. The planned
closed loop is an explicit `review-actions.json` layer: review proposes tiered
edit actions, a human or agent accepts them, and only accepted actions mutate
the next `composition.json`. That action acceptance is not the human baseline
Approval gate.

## Run History

Early validated runs (May 2026 vertical slice) are archived in
[docs/archive/2026-05-first-runs-vertical-slice.md](docs/archive/2026-05-first-runs-vertical-slice.md);
those run folders no longer exist. Current work lives under `runs/` and is
logged in [CHANGELOG.md](CHANGELOG.md).
