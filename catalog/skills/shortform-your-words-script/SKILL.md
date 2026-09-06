---
name: Shortform Your-Words Script
description: Create short-form video scripts and teleprompter files from raw thoughts, voice memo transcripts, inbox notes, rough drafts, article reactions, or recorded takes while preserving the original author's voice and words
version: 1.0.1
category: documents
icon: 🎬
tags:
  - video
  - shortform
  - script
  - teleprompter
  - creator-voice
  - captions
  - capability:write
  - domain:content-production
---

## Optional stack use

Drafting from supplied text and writing these files does not require a stack.
Use `stack:video-editor` only when the request also needs source transcription,
render inspection, or video editing. Use `stack:cloudinary` for an authorized
media upload and `stack:social-media-publisher` for authorized validation or
publication. Discover and verify the relevant stack before those operations;
missing optional tools do not block a text-only draft. Preparing files never
implies permission to upload or publish.

Create shootable short-form scripts from an author's raw thoughts while preserving the author's original voice.

## Core Rule

Preserve the author's thinking and phrasing. The body should use as much of the author's original wording as possible, cut and resequenced for short-form clarity. Do not polish the body into generic prose.

Short-form does not mean "under one minute." Optimize for engagement, clarity, and poignancy. Default to 60-180 seconds unless the user gives a target. If the idea needs more detail, flag it as a long-form or YouTube candidate instead of crushing it.

## Output Contract

Always produce two files when writing into a RUDI story topic:

| File | Purpose |
|---|---|
| `scripts/script-short.md` | Editorial script: hook score, beat structure, author-word notes, cuts, production notes |
| `scripts/script-short-teleprompter.txt` | Shoot file: plain prose, sentence per line, blank lines between beats, no markdown |

If no topic folder exists yet and the user only asks for a draft, return both artifacts in the response and recommend a topic path.

## Text-First Story Flow

When the source starts as an inbox note, rough thought, article reaction, or voice memo text, the video does not start in the video-editor stack yet. First create the story assets:

1. Move or copy the inbox item into a new `0-pending` topic folder.
2. Save the author's raw thought as `source/raw.md`.
3. Create `scripts/script-short.md`.
4. Create `scripts/script-short-teleprompter.txt`.
5. The creator shoots the take from the teleprompter.
6. File the take as `videos/source/shortform-take-N.mov`.
7. Then use the video-editor stack for transcription, transcript corrections, captions, overlays, grading, render, and QA.

Do not initialize a video-editor run before the source video exists.

## Source Priority

Use the strongest available source in this order:

1. `transcripts/shortform-take-N-raw.md` from a recorded take
2. User voice memo or inbox note
3. User-authored rough draft
4. External article, PDF, or image only as context for facts and overlays

For external sources, verify claims when practical. Do not let the external author's article voice replace the user's voice unless the user explicitly asks for a summary script of that source.

## Workflow

1. Identify the topic, audience, point of view, and emotional stance.
2. Extract the strongest author claims, analogies, examples, and exact phrases.
3. Choose a hook archetype using the hook rubric: mirror, sledgehammer, insider, expert, lab rat, or crystal ball.
4. Author the hook if needed. Score it against the 5 checks and 3 auto-fails. Ship only 5/5.
5. Build 3-5 body beats from the author's original words. Cut filler and false starts. Keep the author's order unless a stronger short-form sequence is obvious.
6. Author only the CTA by default. Add a promise or recap only if it improves shootability.
7. Create the teleprompter file from the final spoken lines only.
8. Add production notes for title overlays, screenshot cards, source overlays, prompt cards, and any fact-check concerns.

## Image And Source Overlay Rules

Use full-screen overlays by default for dense images that people may screenshot:

- reports
- charts
- tables
- prompts
- study excerpts
- screenshots with readable text

Treat these as 3-6 second source receipts or prompt cards. Keep them inside the same vertical safe-area discipline as the rest of the shortform video.

Use partial overlays only for quick proof or visual context:

- headline
- logo
- app screenshot
- small reference image
- visual proof while the creator stays visible

For dense source material, full-screen is the default because a partial overlay usually makes the text too small and competes with the speaker.

## Allowed Cleanup

- Drop filler: "you know", "like", "right", repeated "I think"
- Drop false starts and duplicated phrases
- Fix transcription mistakes and obvious misheard names
- Split long sentences into shorter teleprompter lines without changing meaning
- Resequence beats when the better short-form order is clear
- Author hook and CTA

## Not Allowed

- Rephrase the body into a new voice
- Substitute cleaner synonyms for the author's phrasing
- Add claims, examples, or connectors the author did not give
- Make the body sound like a polished essay
- Promise a lead magnet that does not exist
- Use em dashes in spoken lines

## Script-Short.md Structure

Use this structure:

```markdown
# script-short - <slug>

> Shortform video script. Body preserves the author's original words.
> Source: <source path or description>
> Drafted: <date>

## Hook (authored, 5/5)

> "<hook>"

| # | Check | Result | Reason |
|---|---|---|---|
| 1 | Trigger fired | pass/fail | <reason> |
| 2 | Contrast | pass/fail | <reason> |
| 3 | Archetype | pass/fail | <reason> |
| 4 | Specific | pass/fail | <reason> |
| 5 | Sounds natural | pass/fail | <reason> |

## Full Script (~X sec)

**HOOK** (authored)
> "<hook>"

**BODY** (your words, lightly cleaned and cut)

**Beat 1 - <label>**
> "<author line>"
> "<author line>"

**Beat 2 - <label>**
> "<author line>"

**CTA** (authored)
> "<CTA>"

## What Changed

- Kept: <key original phrases>
- Cut: <filler, tangents, repetition>
- Authored: hook and CTA

## Production Notes

- Title overlay: <viewer-facing title>
- Image/source overlay: <if useful>
- Lead magnet: <exists / missing / not needed>
```

## Teleprompter Format

The teleprompter file is plain text only:

```text
Hook sentence one.
Hook sentence two.

Body sentence one.
Body sentence two.

Next beat sentence one.
Next beat sentence two.

CTA sentence one.
CTA sentence two.
```

Rules:
- One sentence per line
- Blank line between beats
- No markdown, labels, quotes, bullets, annotations, or tables
- Keep spoken punctuation simple
- Keep the author's natural cadence even if it is less polished

## Shortform vs Longform

Use shortform when the idea has one central tension and can land in a few beats.

Use longform when the idea requires:
- historical setup
- multiple cases or sources
- careful caveats
- a tutorial walkthrough
- more than one major thesis

If the shortform would lose the point by being too compressed, say so and propose a longform sibling rather than forcing a thin short.
