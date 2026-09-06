---
name: Shortform Publish Copy
description: Create platform-ready short-form video publish copy with a viewer-facing title, SEO title, conversational description, CTA, hashtags, and platform notes
version: 1.0.1
category: communication
tags:
  - video
  - shortform
  - social-media
  - seo
  - captions
  - publishing
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

Create the human-editable publish copy bundle that sits between the
video-editor stack and the social-media-publisher stack.

Canonical story output:

`copy/short-form-post-copy.md`

Use this after a short-form render has passed QA/review and before a story moves
to `2-ready` or gets uploaded.

## Source Priority

Use the strongest available source in this order:

1. Final or preferred draft render review notes and title overlays
2. `transcripts/shortform-take-N.md`
3. `transcripts/shortform-take-N-raw.md`
4. `scripts/script-short.md`
5. `source/raw.md`

Do not invent claims, tools, results, or lead magnets that are not in the story.
If a CTA promises a resource, verify the resource exists in `copy/` or clearly
flag it as missing.

## Output Contract

Write `copy/short-form-post-copy.md` with this structure:

```markdown
# Short-Form Post Copy - <slug>

## Video Title

<short viewer-facing title>

## SEO Title

<searchable title with concrete tools, methods, or concepts>

## Short Description

<2-3 conversational sentences. Informal, specific, SEO-aware.>

## CTA

<one clear action>

## Hashtags

#topic #topic2 #topic3 #topic4 #brand

## Platform Notes

- YouTube: <how to use title/description>
- TikTok: <draft/caption note>
- Instagram: <Reels caption note>
- LinkedIn: <tone adjustment if needed>
```

## Writing Rules

- Make the description sound conversational, not like an abstract summary.
- Name concrete concepts from the video: tools, companies, methods, workflows,
  frameworks, prompts, or outputs.
- Keep the short description to 2-3 sentences.
- Include one CTA. Prefer a real deliverable or behavior: comment, follow, save,
  grab the prompt, watch the next video, or review the draft.
- Use no more than five hashtags.
- Include a brand hashtag only when the user, workspace, or local profile
  provides one. If a brand hashtag is provided, make it the final hashtag.
- Use lowercase hashtags.
- Do not use em dashes.
- Do not sound like an ad.
- Do not overpromise platform behavior. TikTok draft uploads still require
  creator review inside TikTok unless direct posting is explicitly configured.

## Platform Mapping

- YouTube Shorts: use `SEO Title` as the title and combine `Short Description`,
  `CTA`, and `Hashtags` as the description.
- TikTok: use `Short Description`, `CTA`, and `Hashtags` as the caption. Keep it
  short enough for manual review in the TikTok app.
- Instagram Reels: use `Short Description`, `CTA`, and `Hashtags`; avoid a long
  hashtag pile.
- LinkedIn: use `Short Description` plus `CTA`; hashtags can be reduced to 1-3
  if the post reads too platform-native for a full tag line.

## Validation Checklist

Before finishing, verify:

- The title matches the video, not just the topic folder name.
- The SEO title contains searchable nouns from the transcript.
- The description explains what viewers will learn or see.
- The CTA is possible with current assets.
- Hashtags are five or fewer. If a brand hashtag is provided, it is last.
- The file lives at `copy/short-form-post-copy.md`.
