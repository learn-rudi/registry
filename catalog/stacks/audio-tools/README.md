# Audio Tools Stack

RUDI MCP stack for local speech transcription, enrichment, sync, and transcript query.

## Stack Contract

This stack is a portable agent capability bundle. It includes the local MCP
runtime, tool contracts, workflow skill, connector hints, environment
requirements, output schemas, and templates needed to process audio or
video-linked speech.

```text
audio-tools/
  .claude-plugin/plugin.json
  .mcp.json
  bin/audio-tools-mcp
  manifest.json
  manifest.v2.json
  package.json
  src/
  tests/
  skills/audio-tools-workflow/
  connectors/host-provided.json
  secrets/required.json
  mcp/servers.json
  compatibility/cowork-ubuntu-22.04-arm64.json
  setup/cowork-ubuntu-22.04-arm64.md
  outputs/schemas/transcript-record.schema.json
  templates/transcript-note.md
```

The `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, and `bin/` files make
the same folder usable as a Claude Code plugin. RUDI-specific stack metadata
stays in `manifest.json` and `manifest.v2.json`.

## Requirements

- Node.js 20 or newer
- `ffmpeg` and `ffprobe`
- `whisper-cli` with a local Whisper model
- `yt-dlp` for supported video-page URLs

No API credentials are required for transcription. Enrichment uses a local agent
command and requires that command to be available on the user's machine.

Check the actual runtime before transcription:

```bash
npm run check:runtime
```

Run this from the same environment that will start the MCP server. Passing in an
interactive shell does not prove a separate plugin runtime is configured.

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
~/.rudi/output/audio-tools/transcripts
~/.rudi/output/audio-tools/audio.db
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

## Cowork Sandbox Compatibility

Cowork Ubuntu 22.04 arm64 is an ephemeral demo target after binary
provisioning. The stack uses npm/npx and does not require pnpm, yarn, Go, or
Rust.

Preinstalled Cowork runtimes:

- Node 22 with npm/npx
- Python 3.10 with pip
- Ruby 3.0.2
- Java 11
- gcc/g++ 11.4
- git 2.34

Provision before full transcription:

- `ffmpeg` and `ffprobe`
- `yt-dlp`
- `whisper-cli`
- local Whisper model file

See `setup/cowork-ubuntu-22.04-arm64.md` for setup notes. Enrichment also
requires a configured local agent command and prompt template.

Important boundary: `.stack` is a RUDI archive convention, not a Cowork-native
install/uninstall unit. Unzipping it in a Cowork shell can support a one-off
demo, but it does not make `audio_transcribe`, `audio_enrich`, or the other MCP
tools durably callable across conversations. Cowork shell state is wiped between
sessions, so durable usage requires registering the stack as an MCP server
through Cowork connector/MCP settings or running it on a persistent host.

Cowork's plugin/tool runtime can also be separate from the shell used for manual
diagnostics. Provisioning `ffmpeg` or Whisper in the shell is not enough unless
the registered MCP server process inherits the same binaries, model files, and
environment variables.

## Claude Plugin Compatibility

Claude Code plugins expect:

- `.claude-plugin/plugin.json` for plugin metadata
- `skills/` at the plugin root
- `.mcp.json` at the plugin root for MCP server definitions
- `bin/` for executable launchers added to the plugin PATH

The MCP server is launched through `bin/audio-tools-mcp`. On first run, the
launcher copies the Node project into `${CLAUDE_PLUGIN_DATA}`, runs `npm ci`,
builds the server, then starts `node dist/index.js`. This keeps installed
dependencies and build output out of the immutable plugin archive.

The plugin MCP runtime is not necessarily the same runtime as an agent's
interactive bash shell. Having `ffmpeg`, `yt-dlp`, `whisper-cli`, or a model
available in the shell does not prove those dependencies are available inside
the plugin-connected MCP runtime. `audio_transcribe` runs a dependency preflight
before conversion and reports the first missing binary or model file.

## Connectors, Secrets, and Outputs

The runtime does not require API credentials for transcription. Host-provided
connectors such as Browser or Google Drive are optional staging helpers: use
them to find, authorize, or download source media before calling the MCP tools.

Environment variable names are documented in `secrets/required.json`; that file
must never contain secret values.

Primary outputs are:

- transcript JSON: `~/.rudi/output/audio-tools/transcripts/YYYY/MM/DD/<filename>.json`
- transcript Markdown: `~/.rudi/output/audio-tools/transcripts/YYYY/MM/DD/<filename>.md`
- SQLite index: `~/.rudi/output/audio-tools/audio.db`

The JSON output contract lives at `outputs/schemas/transcript-record.schema.json`.

## Packaging

Package the stack source-first as `audio-tools.stack`, excluding local runtime
state with `.stackignore`.

```bash
zip -r audio-tools.stack audio-tools -x@audio-tools/.stackignore
```

For Claude Code plugin testing, the same contents can be zipped with a `.zip`
extension and loaded with `claude --plugin-dir ./audio-tools-plugin.zip`.

Do not package `node_modules/`, `dist/`, `.env`, transcript outputs, databases,
or local caches.

## Install

```bash
rudi install stack:audio-tools
rudi index --json
```
