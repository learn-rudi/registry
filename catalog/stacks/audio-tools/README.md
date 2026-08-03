# Audio Tools Stack

RUDI MCP stack for local speech transcription, enrichment, sync, and transcript query.

## Requirements

- Node.js 20 or newer
- `ffmpeg` and `ffprobe`
- `whisper-cli` with a local Whisper model
- `yt-dlp` for supported video-page URLs

No API credentials are required for transcription. Enrichment uses a local agent
command and requires that command to be available on the user's machine.

## Tools

- `audio_transcribe`: transcribes a local media file, direct media URL, supported video-page URL, or base64 media input.
- `audio_enrich`: enriches a transcript JSON file with title, summary, tags, topics, people, sentiment, and action items.
- `audio_sync`: rebuilds the SQLite database from transcript JSON files.
- `audio_stats`: returns note, tag, topic, keyword, and sentiment counts.
- `audio_query`: runs SQL against the local transcript database.

## URL Behavior

Direct media URLs are downloaded with `fetch`. Supported video-page URLs, such as
YouTube, TikTok, Instagram, Facebook, X/Twitter, and Vimeo, are processed with
`yt-dlp` and extracted to local M4A audio before transcription.

Only `http` and `https` URLs are accepted.

## Configuration

The stack defaults to user-local RUDI state:

```text
~/.rudi/outputs/audio-tools/transcripts
~/.rudi/outputs/audio-tools/audio.db
~/.rudi/models/whisper/ggml-base.en.bin
```

Environment overrides:

```text
RUDI_OUTPUT_DIR
AUDIO_TOOLS_OUTPUT_DIR
AUDIO_TOOLS_DB_PATH
AUDIO_TOOLS_FFMPEG
AUDIO_TOOLS_FFPROBE
AUDIO_TOOLS_WHISPER
AUDIO_TOOLS_WHISPER_MODEL
AUDIO_TOOLS_YTDLP
AUDIO_TOOLS_AGENT_NAME
AUDIO_TOOLS_AGENT_MODEL
AUDIO_TOOLS_PROMPT_TEMPLATE
```

`AUDIO_TOOLS_CONFIG` may point to a JSON config file. Values from that file are
merged over the portable defaults.

## Install

```bash
rudi install stack:audio-tools
rudi index --json
```
