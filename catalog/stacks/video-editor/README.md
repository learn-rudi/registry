# RUDI Video Editor Stack

Consolidated local video editing stack for silence cutting, transcript clipping, rough-cut planning, captions, rendering, and QA.

This stack replaces the separate `silence-cutter`, `video-editor`, and `video-agent` public surfaces. `video-agent` is the base because it already owns the structured run pipeline; the older tools are represented here as direct operations.

## Source, Install, And State

The registry source at `catalog/stacks/video-editor` is the canonical
downloadable package. A local install lives at `~/.rudi/stacks/video-editor` and
can be replaced by `rudi update stack:video-editor`.

Runtime media and generated artifacts do not belong in either source tree.
Pipeline runs live under `~/.rudi/state/stacks/video-editor/runs`, template
composer jobs and bundles live under
`~/.rudi/state/stacks/video-editor/template-composer`, and final template
delivery renders default to `~/.rudi/outputs`.

Private story workflows, account-specific browser automation, platform posting
state, and brand-specific production notes should live in local `.rudi` state or
private skills. The public stack should stay generic and reproducible.

## Direct Commands

```bash
npm run start -- info video.mp4
npm run start -- trim video.mp4 60 120 trimmed.mp4
npm run start -- audio video.mp4 audio.mp3
npm run start -- concat merged.mp4 part-1.mp4 part-2.mp4
npm run start -- clips video.mp4 transcript.txt ./clips
npm run start -- topic-clips video.mp4 transcript.txt "AI,education" ./topic-clips
npm run start -- slides webinar.mp4 ./slides 5
npm run start -- cut-silence video.mp4 edited.mp4 --preset aggressive
npm run start -- cut-silence-batch ./edited video-1.mp4 video-2.mp4 --threshold -28
npm run cli -- first-pass ~/Downloads/take.mov --silence-duration 1.5
npm run cli -- watch-downloads ~/Downloads --silence-duration 1.5 --stable-seconds 10
npm run start -- silence-presets
npm run start -- lower-third movie-2026-05-08-1229 "Jane Smith" "Founder" 12 5 modern bottom-left
npm run start -- apply-overlays ./overlay-request.json
```

Silence options:

```bash
--preset aggressive|moderate|conservative
--threshold -30
--duration 0.5
--padding 0.12
--min-keep-duration 0.25
```

## Downloads First Pass

Use `first-pass` or `watch-downloads` for ad hoc local videos that land in a
Downloads-style inbox and need a quick reviewable rough cut. The workflow waits
for stable files, initializes a state-root run, normalizes media, detects long
silences, renders `rough-v1.mp4`, runs QA, and writes review artifacts.

By default the original source file is left in place. Add `--move-source` only
when you want the stack to archive the source after the run-local copy is
committed and size-checked.

Useful options:

```bash
--silence-duration 2      # only cut longer pauses
--threshold -30           # ffmpeg silencedetect dB threshold
--padding 0.12            # keep this much sound around each cut
--move-source             # archive/remove the original after verified import
--transcribe              # slower, but refresh transcript-based audit evidence
--once                    # scan once and exit
--retry-failed            # retry files recorded as failed in watcher state
--state-path ./state.json # override watcher state file
```

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

Use the run pipeline when an edit needs inspectable artifacts:

```bash
npm run start -- init "/path/to/source.mov" movie-2026-05-08-1229
npm run start -- probe movie-2026-05-08-1229
npm run start -- normalize movie-2026-05-08-1229
npm run start -- transcribe movie-2026-05-08-1229 source
npm run start -- cluster movie-2026-05-08-1229
npm run start -- silence movie-2026-05-08-1229
npm run start -- cut-audit movie-2026-05-08-1229
npm run start -- plan movie-2026-05-08-1229
npm run start -- render-rough movie-2026-05-08-1229 rough-v1.mp4
npm run start -- captions movie-2026-05-08-1229
npm run start -- render-captions movie-2026-05-08-1229 rough-v1.mp4 rough-v1-captions.mp4
npm run start -- grade-source movie-2026-05-08-1229 talking-head
npm run start -- qa movie-2026-05-08-1229 rough-v1.mp4
npm run start -- review movie-2026-05-08-1229 rough-v1.mp4
```

## Companion Skills

Use the registry skill `skill:shortform-your-words-script` before this stack when a story starts from an inbox note, voice memo, rough idea, article reaction, or other text-first source. The skill creates:

- `scripts/script-short.md` for editorial review, hook scoring, beat labels, cuts, and production notes
- `scripts/script-short-teleprompter.txt` for shooting, with plain prose formatted for a teleprompter

After the take is shot, file it in `videos/source/shortform-take-N.mov` and use this stack for transcription, corrections, captions, overlays, grading, render, and QA.

`init` is a workflow, not a single file write. It validates `ffprobe`/`ffmpeg`, stages the run in a temporary directory, writes schema-validated `project.json`, probes the media, writes `about.md`, and then commits the run folder. By default it fails if the run already exists. Use `--refresh` to re-run probe/about on an existing run, or `--force` to replace an existing run from the source video.

## Layout

```text
video-editor/
  assets/          # Reusable generated/static assets for compositions
  composer/        # Remotion app and render runner
  schemas/         # JSON data contracts
  src/             # CLI and deterministic operations

~/.rudi/state/stacks/video-editor/
  runs/            # Per-video run folders, renders, temp media, and project state
```

## Consolidated Sources

- `media-tools/video-agent/`: structured run pipeline, schemas, captions, rendering, QA, and review loop.
- `media-tools/video-editor/`: transcript clips, topic clips, trim, audio extraction, and concat commands.
- `media-tools/silence-cutter-master/`: silence-cut presets, threshold/duration/padding controls, and batch processing surface.
- `media-tools/premiere-lower-thirds/`: lower-third concept, now implemented as Remotion overlays instead of CEP/ExtendScript.
- `media-tools/slide-extractor/`: presentation slide frame extraction, now exposed as the `slides` command.

Runtime media, generated renders, temp segments, and local run data are intentionally not part of the installed stack source. `RUDI_VIDEO_EDITOR_STATE_DIR` can override the stack state root for tests or local development. Slug lookup is state-root only. During `rudi update stack:video-editor`, legacy install-local `runs/` data is migrated into the state root before installed source is replaced.

Default paths after install:

- Pipeline runs and run-local renders: `~/.rudi/state/stacks/video-editor/runs/<slug>/`
- Template composer job and bundle state: `~/.rudi/state/stacks/video-editor/template-composer/`
- Template-rendered delivery MP4s: `~/.rudi/outputs/`

Set `RUDI_VIDEO_EDITOR_OUTPUT_DIR` to choose a different delivery-output root for `video_render_template`. Explicit `out_path` values must stay inside that output root and must end in `.mp4`.

## Install Or Update

Published registry update:

```bash
rudi update stack:video-editor
```

Local registry development update:

```bash
USE_LOCAL_REGISTRY=true RUDI_REGISTRY_ROOT=/path/to/rudi/apps/registry \
  rudi update stack:video-editor
```

## First Pass

The initial target is a single talking-head video workflow:

1. Initialize a run folder from a raw source video.
2. Probe exact media metadata with `ffprobe`.
3. Normalize the source into predictable working media.
4. Transcribe the source into word-level timing.
5. Cluster the source transcript into phrase-level keep ranges.
6. Detect silence and produce candidate keep ranges.
7. Audit proposed cuts for density and transcript safety.
8. Use transcript clusters or audit artifacts to drive a composition.
9. Render plain rough cuts with FFmpeg, or use Remotion/FFmpeg subtitles when the pass needs visual layers.
10. Transcribe the output and refresh the audit.
11. Probe media and sample frames for quick visual QA.
12. Generate an agent review report from the artifacts.
13. Watch the rough render and record cut notes before caption/effects work.
14. Generate caption cues from the locked cut and render a separate caption pass.

## Commands

Run from this directory:

```bash
npm run start -- init "/path/to/source.mov" movie-2026-05-08-1229
npm run start -- init movie-2026-05-08-1229 --refresh
npm run start -- probe movie-2026-05-08-1229
npm run start -- normalize movie-2026-05-08-1229
npm run start -- transcribe movie-2026-05-08-1229 source
npm run start -- cluster movie-2026-05-08-1229
npm run start -- silence movie-2026-05-08-1229
npm run start -- cut-audit movie-2026-05-08-1229
npm run start -- plan movie-2026-05-08-1229
npm run start -- render-rough movie-2026-05-08-1229 rough-v1.mp4
npm run start -- captions movie-2026-05-08-1229
npm run start -- render-captions movie-2026-05-08-1229 rough-v1.mp4 rough-v1-captions.mp4
npm run start -- grade-source movie-2026-05-08-1229 talking-head
npm run start -- transcribe movie-2026-05-08-1229 output rough-v4.mp4
npm run start -- qa movie-2026-05-08-1229 rough-v1.mp4
npm run start -- review movie-2026-05-08-1229 rough-v1.mp4
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

Generated run shape:

```text
~/.rudi/state/stacks/video-editor/runs/<slug>/
  source.mov
  project.json
  probe.json
  working.mp4
  silence.json
  transcript-source.json
  transcript-output.json
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
  cut-review.md
```

## Design Rule

The agent should edit structured JSON and React composition code, then render and inspect outputs. It should not rely on opaque timeline state.

Human review is part of the loop. Automated QA can prove basic media properties, but pacing, cut timing, splice sound, and delivery framing need a watched pass before effects are layered on top.

Transcript timing is used as the first planning surface, then as the audit layer, then as the caption source after a cut is approved. The intended loop is:

```text
source transcript -> run-local corrections -> transcript clusters -> silence candidates -> cut-audit -> plan -> optional grade-source -> render -> output transcript -> cut-audit -> review -> human watch/listen -> captions -> caption render
```

`transcript-clusters.json` is the preferred planning surface for v1 because it preserves phrases first. It uses media duration, not only the final Whisper word timestamp, so the last phrase can keep tail padding. `cut-audit.json` records per-splice risk, the chosen resolution action (`adjust`, `shorten`, or `skip`), structural cut density, required-phrase checks, and correction-aware rendered-output transcript differences. `review.json` and `review.md` turn those artifacts into a handoff: removed ranges, risks, and the next adjustment. `captions.json` maps corrected transcript timing from source time into cut-timeline time, so captions stay aligned after splices. For long caption-only passes, `render-captions` writes `captions.ass` and burns it onto an accepted render with FFmpeg/libass. The composer applies a short audio crossfade at every splice to reduce clicks even when the language timing is safe.

`review.json` is diagnostic today. The planner does not consume it. The planned closed loop is an explicit `review-actions.json` layer: review proposes tiered actions, a human or agent approves them, and only approved actions mutate the next `composition.json`.

## Current Vertical Slice

The public vertical slice is the generic run contract: initialize a local run,
normalize media, transcribe source audio, create transcript-cluster and silence
candidate plans, audit cut density and transcript safety, render a rough cut,
then produce review artifacts before caption or layout-heavy passes. Real run
folders, source media, transcripts, rendered outputs, and personal QA notes stay
under local `.rudi` state and must not be committed to the registry.
