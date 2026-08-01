# Run-Local Video Inspection

The stack will use `inspect` as the canonical source-understanding command for
video-editor v1. `inspect` is diagnostic: it targets an existing run, or a local
file that is first initialized into a run, and writes inspect evidence under the
run's `qa/` directory without mutating `composition.json`, advancing run state,
or replacing human watch/listen review.

`inspect` v1 will stay local/run-first rather than accepting URLs directly.
Direct URL intake would require a downloader/cache/security contract and a
`yt-dlp` dependency that the stack does not currently declare. URL support can
be added later as an explicit intake feature.

Default inspection will be conservative and deterministic: `ffprobe` metadata
plus representative timestamped frames, with optional count and timestamp
controls. Native captions may inform inspection, but word-timed source
transcripts remain authoritative for transcript-safe edit planning.
