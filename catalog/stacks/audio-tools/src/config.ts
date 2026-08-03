/**
 * Stack configuration — paths to tools and output directories.
 * Reads from AUDIO_TOOLS_CONFIG env var or uses sensible defaults.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface AudioConfig {
  output_dir: string;
  db_path: string;
  tools: {
    ffmpeg: string;
    ffprobe: string;
    whisper: string;
    whisper_model: string;
    yt_dlp: string;
  };
  audio_extensions: string[];
  agent: {
    name: string;
    model: string;
    command: string[];
    prompt_template: string;
  };
}

let _config: AudioConfig | null = null;

export function resolveAudioConfig(env: NodeJS.ProcessEnv = process.env, home = homedir()): AudioConfig {
  const outputRoot = env.RUDI_OUTPUT_DIR || join(home, ".rudi", "outputs");
  const outputDir = env.AUDIO_TOOLS_OUTPUT_DIR || join(outputRoot, "audio-tools", "transcripts");
  const dbPath = env.AUDIO_TOOLS_DB_PATH || join(outputRoot, "audio-tools", "audio.db");

  return {
    output_dir: outputDir,
    db_path: dbPath,
    tools: {
      ffmpeg: env.AUDIO_TOOLS_FFMPEG || env.FFMPEG_BIN || "ffmpeg",
      ffprobe: env.AUDIO_TOOLS_FFPROBE || env.FFPROBE_BIN || "ffprobe",
      whisper: env.AUDIO_TOOLS_WHISPER || env.WHISPER_BIN || "whisper-cli",
      whisper_model: env.AUDIO_TOOLS_WHISPER_MODEL || env.WHISPER_MODEL || join(home, ".rudi", "models", "whisper", "ggml-base.en.bin"),
      yt_dlp: env.AUDIO_TOOLS_YTDLP || env.YT_DLP_BIN || "yt-dlp",
    },
    audio_extensions: [".m4a", ".wav", ".mp3", ".caf", ".ogg", ".flac", ".aac", ".opus", ".mp4", ".mov", ".mkv", ".webm"],
    agent: {
      name: env.AUDIO_TOOLS_AGENT_NAME || "enricher",
      model: env.AUDIO_TOOLS_AGENT_MODEL || "claude-sonnet-4-20250514",
      command: ["claude", "-p", "{prompt}", "--model", "{model}", "--output-format", "json"],
      prompt_template: "",
    },
  };
}

export function resetConfigForTests(): void {
  _config = null;
}

export function getConfig(): AudioConfig {
  if (_config) return _config;

  const defaults = resolveAudioConfig();

  // Try loading from env-specified config file
  const configPath = process.env.AUDIO_TOOLS_CONFIG;
  let resolved: AudioConfig;
  if (configPath && existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    resolved = { ...defaults, ...raw, tools: { ...defaults.tools, ...raw.tools } };
  } else {
    resolved = defaults;
  }

  const promptPath = process.env.AUDIO_TOOLS_PROMPT_TEMPLATE || join(homedir(), ".rudi", "audio-tools", "agents", "enricher", "prompt.md");
  if (existsSync(promptPath)) {
    resolved.agent.prompt_template = readFileSync(promptPath, "utf-8");
  }

  _config = resolved;
  return resolved;
}
