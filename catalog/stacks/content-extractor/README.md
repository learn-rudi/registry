# Content Extractor

RUDI MCP stack for extracting useful text from URLs.

## Tools

| Tool | Purpose |
| --- | --- |
| `extract_youtube` | Extract YouTube metadata and transcript when captions are available. |
| `extract_reddit` | Extract a Reddit post, top comments, and bounded threaded replies. |
| `extract_tiktok` | Extract TikTok captions/transcript when available. |
| `extract_article` | Extract clean article text with Readability and markdown output. |
| `extract_github` | Extract GitHub repositories, files, gists, and releases; binary release assets are classified without download. |
| `extract_links` | Extract and categorize page links as markdown, JSON, or CSV. |
| `extract_batch` | Extract URL arrays, metadata items, or CSV rows into deduped per-link artifact folders, a manifest, a CSV report, and JSONL results. |

## Install

```bash
rudi install stack:content-extractor
rudi integrate claude
```

Installed stacks run from `~/.rudi/stacks/content-extractor`.
The stack declares `playwright` and `tesseract` binaries so RUDI-managed installs
can provide the browser CLI and OCR classifier used by optional screenshot
fallback. Local development can also set `RUDI_PLAYWRIGHT_BIN` /
`PLAYWRIGHT_BIN` and `RUDI_TESSERACT_BIN` / `TESSERACT_BIN` to existing
binaries.

## Local Development

```bash
npm install
npm test
npm run build
npx tsx src/index.ts links https://example.com
npx tsx src/index.ts https://github.com/openai/openai-node
```

To compare capture providers for a difficult URL:

```bash
npm run build
node scripts/browser-provider-probe.mjs \
  --url https://openai.com/index/introducing-genebench-pro \
  --expected-text "Introducing GeneBench-Pro"
```

The probe writes `probe_report.json` plus per-provider screenshots where a
provider can capture an image. The default providers are non-interactive:
`fetch`, `rudi_playwright`, `playwright_chromium_cli`, and
`playwright_chrome_channel`. Add `user_chrome_osascript` explicitly when the
probe should drive the local macOS Chrome app.

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
- GitHub repository extraction uses the GitHub API for metadata and raw content
  for README/file bodies. Set `GITHUB_TOKEN` in the environment when higher
  GitHub API rate limits are needed; it is optional and not declared as a
  required stack secret.
- Batch extraction accepts `urls`, `items`, or `csv_path`. It validates URLs,
  deduplicates normalized URLs before fetching, and records per-row duplicates
  in `batch_report.csv`.
- Batch outputs include `links/<item-id>/source.json`, `result.json`,
  `content.md` when content exists, and `error.json` when extraction fails.
  Blocked/rate-limited fetches are classified as `blocked`, `rate_limited`, or
  `fetch_failed` instead of being collapsed into generic `error`.
- Batch extraction can opt into Playwright browser screenshot fallback with
  `browser_fallback: true`. For selected failure statuses, the stack writes
  `links/<item-id>/page.png` and records `originalStatus`, `browserFallback`,
  and `screenshot_path` in artifacts and reports. If Tesseract is available, the
  stack writes `links/<item-id>/browser_text.txt` and classifies the capture:
  `browser_captured` for content-bearing screenshots, `browser_blocked` for
  bot/security/login walls, `browser_empty` for screenshots with no readable
  text, `browser_not_found` for visible not-found pages, or
  `browser_unclassified` when classification is unavailable or inconclusive.
  This captures what a browser saw; it does not bypass bot protections.
- URL arguments are validated as HTTP(S) URLs before network requests.
