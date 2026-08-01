# VP-0 · Intake & triage

Status: draft v0.1 (2026-07-10)

**Purpose:** Give every arriving source unambiguous ownership, disposition, and
technical classification. Only keeper, production-intended sources continue
through the baseline pass.

**Trigger:** Brandon points at a video by path (current standard mode) — from
the RecordKit library, the Downloads inbox, a story folder, or anywhere else.
Automated watchers are an optional layer on top, not the default entry.

**Preconditions:** None. This is the entry point for every source.

**Inputs:** Source media path(s). RecordKit bundles may contain multiple
variants (`composite.mp4`, `composite-mobile.mp4`, `screen-share.mp4`,
`audio.m4a`).

## Procedure

1. **Route ownership** — decide whether the source is story-owned or ad hoc,
   independently of its disposition. For story-owned work, file the source in
   the canonical topic folder (`<topic>/videos/source/`) before initialization,
   then initialize once from that path. Do not initialize from Downloads and
   re-register the same source after filing it.
2. **Register** — create a run under `runs/<slug>/` and copy the source in.
   Slug convention: `<source>-<yyyy-mm-dd>-<hhmm>-<variant>`
   (e.g. `recordkit-2026-07-09-1623-mobile`). The original source file is
   never modified; Downloads originals are removed only after the run-local
   copy is committed and size-checked.
3. **Probe** — record container format (.mp4/.mov/…), codecs, dimensions,
   duration, frame rate, and stream layout to `probe.json`.
4. **Classify technically** — from the probe and bundle contents, record:
   - orientation: `horizontal` | `vertical` | `square` (from dimensions)
   - source/delivery variant labels: mobile, landscape, screen-share,
     audio-only, or another explicit label
   - format notes: anything that needs normalizing before editing
   Technical classification does not decide ownership or disposition.
5. **Normalize** — produce predictable run-local working media
   (`working.mp4`) so downstream steps never depend on source quirks.
6. **Decide disposition** — record one human decision independently of source
   ownership and technical classification:
   - `keeper` → production-intended; continue to VP-1 Understand.
   - `disposable` → exit, or optionally route to the first-pass rough-cut dead
     end; never promote that run as a transcript-verified baseline.
   - `reference` → retain for context and exit production processing.

## Gate

Source ownership and human disposition are recorded separately; technical
classification is recorded from evidence. The next route must be unambiguous.

## Artifacts

- `runs/<slug>/source.<ext>` (unmodified copy)
- `runs/<slug>/working.mp4`
- `runs/<slug>/probe.json`
- `runs/<slug>/project.json` — schema-validated run record; `state` advances
  to `imported` (see `src/lib/states.js`)
- `runs/<slug>/about.md` — generated presentation written by `init`; it is not
  the authoritative intake record
- `runs/<slug>/intake.json` — **target contract:** a standard structured record
  of original path, ownership, disposition, technical classification, and
  routing; currently written only by some watcher/first-pass paths and not
  enforced for every run

## Done when

The source is owned and registered once, the run-local copy and probe exist,
technical classification and human disposition are recorded, and the source
either exits or continues to VP-1 as a keeper.

## On failure

Record the failure in the available intake evidence or watcher state. Downloads
watcher failures are retryable with `--retry-failed`. Never delete a source
whose run-local copy has not been verified.

## Tooling

Stack tools: `video_init_run`, `video_probe_run`, `video_normalize_run`.
Intake is manual by design for now: Brandon supplies the path, the agent
registers it. Downloads automation exists (`watch-downloads` / `first-pass`
CLI, see README "Downloads First Pass") but is optional; a RecordKit watcher
may be added later once the manual flow is proven.

## Enforcement gap

The three-axis intake model and universal structured intake record are accepted
targets, not current schema guarantees. `project.json` state and generated
`about.md` do not prove that VP-0 conformed to this SOP.

Naming note: `first-pass` (the CLI command) is the disposable rough cut only.
The universal VP-0 → VP-1 → VP-2 sequence that every keeper goes through is
called the **baseline pass**.

Decision record:
[ADR-0002](../adr/0002-video-intake-separates-routing-and-disposition.md).
