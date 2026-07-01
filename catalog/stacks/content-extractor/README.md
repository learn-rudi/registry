# Content Extractor

RUDI MCP stack for extracting useful text from URLs.

## Tools

| Tool | Purpose |
| --- | --- |
| `extract_youtube` | Extract YouTube metadata and transcript when captions are available. |
| `extract_reddit` | Extract a Reddit post, top comments, and bounded threaded replies. |
| `extract_tiktok` | Extract TikTok captions/transcript when available. |
| `extract_article` | Extract clean article text with Readability and markdown output. |
| `extract_links` | Extract and categorize page links as markdown, JSON, or CSV. |

## Install

```bash
rudi install stack:content-extractor
rudi integrate claude
```

Installed stacks run from `~/.rudi/stacks/content-extractor`.

## Local Development

```bash
npm install
npm test
npm run build
npx tsx src/index.ts links https://example.com
```

The MCP server runs on stdio:

```bash
npx tsx src/index.ts --mcp
```

## Notes

- YouTube transcript extraction is most reliable with `SUPA_DATA_API`
  configured. Without it, the stack falls back to public no-key methods that
  may return video metadata with `hasTranscript: false` when YouTube blocks or
  changes caption access.
- Reddit uses old Reddit HTML as the primary no-credential path for direct post
  extraction, then falls back to public JSON and optional OAuth if configured.
  Browser login and Reddit API credentials are not required for the primary
  path. By default, Reddit output includes top-level comments plus direct
  replies (`max_depth: 2`); use `max_depth: 1` for only top-level comments.
- TikTok extraction depends on TikTok page data and captions being available.
  Videos without public captions return metadata with `hasTranscript: false`;
  challenged or removed TikTok pages can fail before metadata is available.
- URL arguments are validated as HTTP(S) URLs before network requests.
