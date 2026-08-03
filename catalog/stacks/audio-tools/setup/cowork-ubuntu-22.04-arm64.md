# Cowork Ubuntu 22.04 arm64 Setup

Cowork provides Node 22, npm/npx, Python 3.10, pip, gcc/g++ 11.4, Java 11,
Ruby 3.0.2, and git. It does not provide pnpm, yarn, Go, Rust, or cargo by
default.

This setup is for one-off sandbox demos. Cowork shell state is session-scoped:
packages installed with apt/npm/pip, built binaries, `node_modules`, downloaded
models, and environment variables do not persist as callable tools across
conversations. Files written to a user-visible folder can persist, but those
files do not register `audio_transcribe` or the other MCP tools by themselves.

`.stack` is a RUDI archive convention, not a Cowork-native install/uninstall
unit. Durable Cowork usage requires registering a persistent MCP server through
Cowork connector/MCP settings, or hosting the stack somewhere persistent and
connecting Cowork to it.

Cowork may run MCP/plugin tools in a runtime separate from the interactive bash
sandbox. A successful manual `ffmpeg` conversion in bash proves the media file
is healthy, but it does not prove `audio_transcribe` can see the same binary or
model from its plugin runtime. Provision dependencies in the actual MCP server
environment or pass explicit `AUDIO_TOOLS_*` paths into that server.

## Install Node Dependencies

Use npm:

```bash
npm install
npm run build
npm test
```

## Provision Media Binaries

`ffmpeg` provides both `ffmpeg` and `ffprobe` on Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

Install `yt-dlp` with pip:

```bash
python3 -m pip install --break-system-packages yt-dlp
```

## Provision Whisper

Actual transcription requires a `whisper-cli`-compatible binary and a local
Whisper model file. Provide these through the RUDI binary/model cache or install
them in the sandbox, then set:

```bash
export AUDIO_TOOLS_WHISPER=/path/to/whisper-cli
export AUDIO_TOOLS_WHISPER_MODEL=/path/to/ggml-base.en.bin
```

If the binary is on `PATH` as `whisper-cli` and the model is at
`~/.rudi/models/whisper/ggml-base.en.bin`, no override is needed.

## Enrichment

Transcription does not require API credentials. Enrichment calls a local agent
command configured by `AUDIO_TOOLS_AGENT_*` and requires a prompt template.

```bash
export AUDIO_TOOLS_PROMPT_TEMPLATE=/path/to/prompt.md
```

If the configured agent command is unavailable, `audio_transcribe`,
`audio_sync`, `audio_stats`, and `audio_query` can still work; `audio_enrich`
will fail until enrichment is configured.

## Durable Path

For always-available tools, do not rely on this sandbox bootstrap. Use one of
these paths instead:

1. Run `audio-tools` on a persistent machine and register it as an MCP server in
   Cowork connector/MCP settings.
2. Install the stack through RUDI on a persistent host with
   `rudi install stack:audio-tools`, then expose the MCP server to the agent.
3. Publish a host-supported connector/plugin format if Cowork adds a native
   install/uninstall surface for third-party packages.
