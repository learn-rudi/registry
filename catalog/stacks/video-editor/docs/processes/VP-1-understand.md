# VP-1 · Understand

Status: draft v0.1 (2026-07-10)

**Purpose:** Know what the video is — what it says and what is wrong with it —
before any edit decision is made. An identified Source Transcript revision plus
its non-editorial corrections produces the Corrected Source Transcript used
downstream.

**Trigger:** VP-0 records a keeper, production-intended disposition and the run
reaches `state: "imported"`.

**Preconditions:** VP-0 complete: run registered, probed, classified,
normalized working media present.

**Inputs:** `runs/<slug>/working.mp4`, `probe.json`.

## Procedure

1. **Inspect manually** — use `ffprobe` plus representative frame extraction
   and human visual review. The accepted `inspect` command and artifact contract
   in ADR-0001 is not implemented, so do not claim `qa/inspect.json`,
   `qa/inspect.md`, or `qa/frames/` exists unless the evidence was actually
   created by the fallback.
2. **Extract the source transcript** — word-timed transcription of the
   working media → `transcript-source.json`. In the accepted contract, identify
   this as a transcript revision and keep its ASR text and timings immutable
   within that revision. Retranscription creates a new identified revision
   rather than mutating the earlier one.
3. **Declare transcript corrections** — record non-editorial normalization for
   non-real words, misheard terms, and domain vocabulary
   (`RUDI`, `SKILL.md`, `Claude`, `ChatGPT`, product names, people, acronyms).
   Corrections go to `transcript-corrections.json`; they bind to the applicable
   Source Transcript revision, do not rewrite it, and must never encode
   editorial removal. Applying the overlay produces the Corrected Source
   Transcript view used by VP-2.
4. **Mark problem candidates** — identify, as candidates only (never as an
   edit plan):
   - head silence and tail silence (highest priority),
   - extended internal silences and dead air,
   - filler, false starts, or repetition that may be proposed for complete
     editorial removal.
   Silence detection output goes to `silence.json`; word-level candidates are
   anchored to transcript timings.

## Gate

None. This process gathers evidence and candidates; it makes no cuts and
mutates no edit plan.

## Artifacts

- manual probe/frame evidence that was actually created; `qa/inspect.json`,
  `qa/inspect.md`, and `qa/frames/` remain target artifacts for the unimplemented
  `inspect` command
- `transcript-source.json` — current singleton ASR text and timings; accepted
  contract requires identified immutable revisions
- `transcript-corrections.json` — current non-editorial normalization overlay;
  accepted contract binds it to a Source Transcript revision, from which the
  Corrected Source Transcript is derived
- `silence.json` (+ any candidate notes)
- `project.json` state advances through `transcribed` → `clustered` →
  `analyzed`; these values report artifact progress, not SOP conformance

## Done when

An identified Source Transcript revision and its correction overlay can produce
the Corrected Source Transcript, problem candidates are recorded with timings,
and an editor could state in one sentence what the video is about and what
needs cleaning.

## On failure

If transcription quality is too poor to correct confidently, stop and flag —
do not proceed to VP-2 with an untrusted baseline. Re-transcribe with a
stronger model or better audio before cut planning.

## Tooling

Stack tools: `video_transcribe_run`, `video_detect_silence`,
`video_cluster_transcript` (topic overview when useful). Until an `inspect`
tool exists, use manual `ffprobe` and frame extraction; accepted target
contract: [ADR-0001](../adr/0001-run-local-video-inspection.md).

## Enforcement gap

The current `transcribe source` path writes the singleton
`transcript-source.json`; retranscription can overwrite it. The stack does not
yet retain or identify immutable Source Transcript revisions or enforce that
corrections bind to one.
