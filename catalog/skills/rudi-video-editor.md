---
name: RUDI Video Editor
description: Use RUDI video editing stack tools to inspect, trim, remove silence, caption, render, and verify edited video from a user prompt. Use when the user asks to edit a clip, tighten a video, add captions, create rough cuts, apply overlays, produce thumbnails, resize media, or run video QA through RUDI.
version: 1.0.0
category: creative
tags: [rudi, video, editing, captions, ffmpeg, rendering, qa]
requires:
  stacks:
    - stack:video-editor
---

# RUDI Video Editor

Use this skill as the slash-callable workflow layer for `stack:video-editor`.
The stack provides the tools; this skill translates the user's editing request
into a concrete edit plan, stack calls, and output verification.

## Workflow

1. Confirm the source media path or locate the likely source file in the current
   workspace when the user has clearly referenced an attached or nearby clip.
2. Inspect the media before changing it. Use `video_info`, `video_frames`,
   `video_probe_run`, or equivalent stack tools to establish duration, format,
   dimensions, audio presence, and any obvious quality constraints.
3. Convert the user's prompt into explicit edits: cuts, silence removal, pacing,
   captions, overlays, lower thirds, resize/aspect ratio, compression, thumbnail,
   or QA review.
4. Prefer the structured run pipeline for multi-step edits that need durable
   artifacts: initialize, probe, normalize, transcribe, detect silence, audit
   cuts, plan, render, caption, QA, and review.
5. Use direct tools for simple one-step edits such as trim, speed, resize,
   compress, concat, thumbnail, frame extraction, or audio extraction.
6. Keep source media unchanged. Write derived files to the stack's run/output
   location or an explicit user-requested destination.
7. Verify every rendered output exists, has nonzero size, and can be probed or
   QA-checked before reporting completion.

## Tool Selection

- Tighten pacing: use silence detection/removal, transcript clustering, cut
  audit, rough render, QA, and review tools.
- Add captions: transcribe or reuse an existing transcript, generate caption
  cues, render captions onto the locked cut, then QA the caption pass.
- Clip from a long source: use transcript/topic clip tools when the selection is
  content-based; use trim when the user gives exact time ranges.
- Add visual layers: use lower-third, overlay, template render, or caption render
  tools depending on whether the request is a nameplate, receipt/card overlay,
  template composition, or subtitle pass.
- Prepare for publishing: resize/compress only after the edit is locked, then
  use related publish-copy or social-publishing skills when the user asks for
  platform copy or upload packaging.

## Output Contract

Return a concise edit report with:

- source media path
- requested edit intent
- tools or pipeline phases used
- output video path
- QA or probe result
- any unresolved review notes or user decisions needed

Do not claim an edit is complete until the rendered file has been verified.
