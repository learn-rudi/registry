# Editorial Markup Stack

Build reviewable inline editorial markup artifacts from normalized text or an explicit edit model.

This stack owns deterministic behavior:

- validate edit models, change IDs, statuses, and clean-export readiness;
- render self-contained static or interactive HTML;
- export clean text only after changes are resolved, unless the caller explicitly allows pending changes;
- run Playwright QA for controls, accept/reject flows, desktop/tablet/mobile screenshots, body overflow, and expected scroll containers.

Editorial judgment remains in `skill:inline-editorial-markup`. Media, URLs, and other non-text sources should be normalized by extraction or transcription stacks before this stack runs.

`editorial_markup_build` accepts:

- `edit_model` for visible changes and notes;
- `source_text` for small inline normalized source;
- `source_path` for local UTF-8 text, Markdown, or HTML source files;
- `source_manifest` for multiple sections, each with `source_text` or `source_path`.

## Tools

- `editorial_markup_validate_model`
- `editorial_markup_build`
- `editorial_markup_qa`
- `editorial_markup_export_clean`

Proposal generation is intentionally not exposed as a stack tool yet. Agent or LLM output is untrusted and must pass `editorial_markup_validate_model` before rendering.

## Limits

- Direct `source_text`: 200,000 characters.
- Single-artifact edit model: 250 changes.
- Above 100,000 source characters, callers should prefer sectioned or multi-artifact review.

## Runtime Note

This stack depends on Playwright for QA screenshots and browser smoke tests. A fresh install may need a Chromium browser download before `editorial_markup_qa` can run.

## Development

```bash
npm install
npm test
```
