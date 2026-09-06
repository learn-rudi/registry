---
name: Reddit Saved Link Enrichment
description: Enrich Reddit rows from a saved-links database by extracting posts and comment discussion, drafting a concise database note, and preparing a full page body before any explicit Notion write.
version: 1.0.1
category: data
tags:
  - reddit
  - notion
  - saved-links
  - enrichment
  - research
  - comments
  - capability:extract
requires:
  stacks:
    - stack:content-extractor
    - stack:notion-workspace
---

# Reddit Saved Link Enrichment

## Core Rule

Extract source material first, summarize second, write to Notion last. Put the concise preview in the database `Note` property and the full enrichment in the Notion page body. Include comment-derived signal in both; do not put raw long comment dumps into the database row unless the user explicitly asks for raw capture.

Default to the top 25 top-level comments. Use 5 for smoke tests, 50 for manual deep review, and never exceed the extractor hard cap without changing code and tests intentionally.

## Configuration Inputs

Resolve the saved-links database and extractor configuration from the user, workspace docs, or live tool schema before writing:

- Saved-links database ID or database name.
- URL property, usually `URL` or `Link`.
- Preview-note property, usually `Note`, `Summary`, or `Description`.
- Optional fields such as `Name`, `Source`, `Status`, `Category`, and `Subcategory`.
- Optional authenticated Reddit extraction path, such as a browser CDP endpoint, when public Reddit JSON is blocked.

Treat configured values as untrusted until the database schema and extractor result are read back.

## Workflow

1. Query Notion deterministically for candidate rows.
   - Prefer Notion database tools when available.
   - Query the Saved Links database by properties, not semantic search.
   - For Reddit work, target `Source = Reddit` and an inbox-like status unless the user gives a specific row.
   - Read row `URL`; do not infer the URL from the title.

2. Extract with `stack:content-extractor`.
   - Use `max_comments=25` by default.
   - Use the logged-in browser fallback when public Reddit JSON is blocked.
   - Confirm extraction succeeded and inspect sanitized metadata: title, author, subreddit, total comments, extracted comments, retrieval method, content length.
   - If unauthenticated extraction fails with `provider_blocked`, do not call that a user-visible failure until the authenticated browser path has also been tried.

3. Summarize for Notion.
   - Use the Notion note format below before drafting the Note.
   - Draft the page body with `Source`, `TL;DR`, `Comment-thread highlights`, `Relevance`, and `Action items`.
   - Ignore AutoModerator/rules comments unless they materially affect the post.
   - Summarize the linked post/topic separately from Reddit discussion signals.
   - Always include a `Reddit discussion` section that distills the strongest recurring viewpoints, disagreements, practical implications, and any useful links from comments.
   - Keep raw top-comment text in the local extraction artifact or an optional Notion child page, not in the main database row by default.
   - Keep the Note concise enough for a database row; do not exceed a few short paragraphs plus bullets unless asked.

4. Choose Notion fields.
   - `Name`: extracted Reddit title, cleaned only for readability.
   - `Source`: `Reddit`.
   - `Status`: use the project’s agreed enriched/reviewed status. If unknown, propose one and ask before writing.
   - `Category` and `Subcategory`: use existing taxonomy when it fits. Leave unchanged or propose values when unsure.

5. Reconcile the exact page before an authorized write.
   - Read current row properties and page body with the live Notion tools.
   - Identify an enrichment by its canonical Reddit URL/post ID and a clearly labeled enrichment heading. Keep the proposed content locally until the requested write is authorized.
   - If that enrichment already exists and matches, skip the write. If the previous run updated only properties, append only the missing body; if the body exists, update only missing properties.
   - If an existing enrichment differs, show the proposed change and target its exact blocks only when the live tools support a safe update. Otherwise report that an explicit replacement decision is needed; do not append a second full enrichment.
   - Use `notion_update_row` for changed properties and `notion_append_content` only for a verified absent enrichment section. Preserve unrelated page content.
   - After any timeout or partial failure, read back properties and body before retrying. Never assume the write failed just because the response was lost.
   - Verify both row properties and the single matching enrichment body after writing. Never print tokens, cookies, browser storage or secrets.

## Notion Note Format

Database preview note:

- Keep it short enough to scan in a table.
- Include the core post claim, the strongest comment-thread signal, and why it is worth saving.
- Do not paste raw comments into the database row.

Full page body:

```markdown
## Source

- URL: <reddit-url>
- Subreddit: <subreddit>
- Author: <author if available>
- Extracted comments: <count>

## TL;DR

<2-4 bullets summarizing the post and linked topic.>

## Reddit Discussion

<Bullets grouping recurring viewpoints, disagreements, practical implications, and useful links from comments.>

## Relevance

<Why this is useful for the user's research, content, workflow, or decision.>

## Action Items

- <follow-up, archive, share, or no action>
```

## Extraction Commands

Prefer an installed extractor or MCP tool for Reddit extraction. If working from a source checkout instead, use that project’s documented Reddit extractor command with a user-provided Reddit URL, an output artifact path outside the registry, and `max_comments=25`.

## Failure Handling

- If authenticated browser extraction is configured but unavailable, ask the user to start that browser session or use the extractor’s documented fallback.
- If extraction succeeds but comments are sparse, say how many comments were extracted versus total comments.
- If the browser-context request fails but page fallback succeeds, keep going and mention `retrievalMethod = "browser_session"`.
- If both fail, mark the row only after confirmation with a clear failure note and retry guidance.

## Validation

For extractor code changes, run the extractor project’s targeted Reddit tests and syntax checks.

For enrichment-only Notion work, validate by reading back the proposed or updated row instead of rerunning all extractor tests.
