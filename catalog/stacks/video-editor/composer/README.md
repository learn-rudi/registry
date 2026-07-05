# Composer

Remotion app for rendering `~/.rudi/state/stacks/video-editor/runs/<slug>/composition.json`.

## Render

```bash
npm install
npm run render -- movie-2026-05-08-1229 rough-v1.mp4
```

The render script:

1. Reads the run's `project.json`, `probe.json`, and `composition.json`.
2. Symlinks the run's `working.mp4` into `public/media/<slug>/working.mp4`.
3. Writes `render-props.json` into the run folder.
4. Runs `remotion render` and writes into the run's `renders/` folder.

Slug lookup uses `RUDI_VIDEO_EDITOR_STATE_DIR` when set, otherwise `RUDI_HOME`,
and finally `~/.rudi/state/stacks/video-editor`. Passing an absolute run path
still works for ad hoc local debugging.

Current renderer support:

- source video playback from `working.mp4`
- keep-range cuts from `composition.json`
- text overlays
- punch-in zooms
