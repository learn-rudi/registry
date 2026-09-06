---
name: Shortform Social Publish Package
description: Generate platform-ready social publishing packages for short-form story folders, including Instagram Reels captions, Facebook captions, YouTube Shorts metadata, TikTok manual captions, media URL placeholders, and publish checklists before using social-media-publisher.
version: 1.0.1
category: communication
tags:
  - video
  - shortform
  - social-media
  - publishing
  - captions
  - youtube
  - instagram
  - tiktok
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

# Shortform Social Publish Package

## Purpose

Create the per-platform `publish/` files that sit between a short-form story folder,
`stack:cloudinary`, and the `social-media-publisher` stack. This skill prepares
files; it does not post.

## Source Priority

Read the strongest available source in this order:

1. `copy/short-form-post-copy.md`
2. `publish/linkedin/post*.md` when Facebook needs a more prose-native caption
3. `transcripts/shortform-take-N.md`
4. `transcripts/shortform-take-N-raw.md`
5. `scripts/script-short.md`
6. `source/raw.md`

Do not invent claims, resources, or lead magnets. If a CTA names a resource,
verify that the file exists in `copy/` or mark it as missing in `publish/checklist.md`.

## Output Contract

Create or update these files under the story's `publish/` directory.

For current two-final stories, use variant subfolders:

```text
publish/
  source-order/
    instagram-caption.txt
    facebook-caption.txt
    youtube-shorts-title.txt
    youtube-shorts-description.txt
    youtube-shorts-tags.txt
    youtube-shorts-metadata.json
    tiktok-caption.txt
    media-urls.json
  optimized/
    instagram-caption.txt
    facebook-caption.txt
    youtube-shorts-title.txt
    youtube-shorts-description.txt
    youtube-shorts-tags.txt
    youtube-shorts-metadata.json
    tiktok-caption.txt
    media-urls.json
  checklist.md
  post-log.json
```

Root-level platform files are legacy single-render compatibility files only:

```text
publish/
  instagram-caption.txt
  facebook-caption.txt
  youtube-shorts-title.txt
  youtube-shorts-description.txt
  youtube-shorts-tags.txt
  youtube-shorts-metadata.json
  tiktok-caption.txt
  media-urls.json
  checklist.md
```

If `publish/linkedin/` exists, leave it intact. It is a separate LinkedIn package.

## Platform Rules

For two-final stories, apply these file names inside each variant directory, for
example `publish/source-order/instagram-caption.txt` and
`publish/optimized/instagram-caption.txt`.

### Instagram Reels

File: `publish/<variant>/instagram-caption.txt`

- Use the short description, one CTA, and 3-5 lowercase hashtags.
- Keep under 2,200 characters.
- Prefer the same CTA as TikTok unless it implies automated DMs.
- Mention link-in-bio only when the route exists.

### Facebook Video

File: `publish/<variant>/facebook-caption.txt`

- Use a cleaner, slightly more conversational caption than Instagram.
- Use 0-3 hashtags.
- A discussion question is usually better than a lead-magnet CTA.
- If a related LinkedIn post exists, use `synthetic-cadence-editor` principles:
  actor, mechanism, consequence, and no unsupported abstractions.

### YouTube Shorts

Files:

- `publish/<variant>/youtube-shorts-title.txt`
- `publish/<variant>/youtube-shorts-description.txt`
- `publish/<variant>/youtube-shorts-tags.txt`
- `publish/<variant>/youtube-shorts-metadata.json`

Rules:

- Title must be under 100 characters.
- Description must be under 5,000 characters.
- Include `#Shorts` in the description.
- Tags are comma-separated keywords without `#`.
- Keep tag string under 500 characters.
- Metadata JSON should include:
  - `privacy`: normally `private` for review, unless user asks for public
  - `categoryId`: `"22"`
  - `madeForKids`: `false`
  - `targets.youtube`: `"configured-channel"`

### TikTok

File: `publish/<variant>/tiktok-caption.txt`

- Prepare the manual caption or inbox-upload caption.
- Keep concise.
- Captions are not sent by TikTok `video.upload`; the creator completes captioning
  inside TikTok after inbox upload.
- Do not claim direct posting unless the user explicitly confirms the TikTok app
  is approved for direct public posting.

### Media URLs

File: `publish/<variant>/media-urls.json`

Use placeholders until the final MP4 is hosted. Prefer `stack:cloudinary` for
short-form video hosting:

```json
{
  "local_video_path": "videos/renders/final/example-final.mp4",
  "cloudinary_folder": "",
  "cloudinary_public_id": "",
  "public_video_url": "",
  "thumbnail_url": "",
  "notes": "Instagram, Facebook, YouTube, LinkedIn, and X media posts require public HTTPS media. TikTok inbox upload can use a local file."
}
```

For two-final stories, write one media URL file per variant:

- `publish/source-order/media-urls.json` points to
  `videos/renders/final/<slug>-source-order-final.mp4`
- `publish/optimized/media-urls.json` points to
  `videos/renders/final/<slug>-optimized-final.mp4`

Do not choose one canonical render when both variants exist. They are separate
posts.

## Checklist Rules

File: `publish/checklist.md`

Include:

- Source-order final render path exists.
- Optimized final render path exists.
- Public HTTPS video URL is still needed or is present.
- Instagram target: configured profile.
- Facebook target: configured page or profile.
- YouTube target: configured channel.
- TikTok status: manual or inbox-upload/manual-finish.
- CTA resource exists or missing.
- Dry-run required before live publishing.
- Live publishing requires explicit user approval.
- Source-order and optimized variants have separate scheduled/post statuses.

## Validation

Before finishing:

- Verify all output files exist.
- Verify hosted video URLs use HTTPS before social validation.
- Verify title length and tag length.
- Verify no file promises a resource that does not exist.
- Verify hashtags are platform-appropriate.
- Do not print secrets, tokens, or page access tokens.
