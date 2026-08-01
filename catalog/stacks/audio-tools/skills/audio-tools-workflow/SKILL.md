---
name: audio-tools-workflow
description: Use the RUDI audio-tools stack to transcribe, enrich, index, and query speech from local audio/video files, direct media URLs, supported video-page URLs, or base64 media input. Trigger when the user asks to process audio, video-linked speech, voice memos, meeting recordings, interviews, podcasts, clips, transcripts, transcript search, transcript enrichment, or audio-derived notes with the audio-tools stack.
---

# Audio Tools Workflow

Use the local `audio-tools` MCP stack for speech-to-text workflows. The stack provides `audio_transcribe`, `audio_enrich`, `audio_sync`, `audio_stats`, and `audio_query`.

## Workflow

1. Identify the source shape:
   - local file path: pass `file`
   - HTTP(S) direct media or supported video page: pass `url`
   - base64 media: pass `data` and `filename`
2. Call `audio_transcribe` first. It writes JSON and Markdown outputs under `~/.rudi/output/audio-tools/transcripts/YYYY/MM/DD/`.
3. Preserve the returned transcript JSON path. Use it for enrichment and indexing.
4. Call `audio_enrich` only when the user needs metadata such as title, summary, tags, topics, people, sentiment, keywords, or action items.
5. Call `audio_sync` after transcription or enrichment when query/search/index results matter.
6. Use `audio_stats` for a quick collection overview.
7. Use `audio_query` for focused analysis across the SQLite transcript index.

## Guardrails

- Treat transcripts as private user data.
- Do not include credentials, API keys, or raw secret values in prompts, outputs, config files, or stack packages.
- Only pass HTTP(S) URLs to URL input. The stack rejects other URL schemes.
- Prefer read-only `SELECT` queries with `audio_query`. Do not run destructive SQL unless the user explicitly asks for database modification.
- If enrichment fails because no prompt template is configured, report that transcription completed and name the missing configuration requirement.
- If a private source requires authorization, use the host connector to obtain the source file or URL before invoking the stack.
- If `audio_transcribe` reports a missing binary or Whisper model, treat that as a runtime provisioning issue in the MCP/plugin environment. Do not assume a successful manual shell command means the MCP server can see the same dependency.

## Useful Files

- Connector hints: `connectors/host-provided.json`
- Environment and secret requirements: `secrets/required.json`
- MCP launch contracts: `mcp/servers.json`
- Transcript JSON schema: `outputs/schemas/transcript-record.schema.json`
- Query examples: `references/query-examples.md`
