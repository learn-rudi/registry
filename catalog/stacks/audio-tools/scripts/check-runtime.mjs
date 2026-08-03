#!/usr/bin/env node
import { accessSync, constants, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function lookupCommand(command) {
  try {
    if (command.includes("/")) {
      accessSync(command, constants.X_OK);
      return { ok: true, resolved: command };
    }
    if (process.platform === "win32") {
      const out = execFileSync("where", [command], { timeout: 10_000 }).toString().trim();
      return { ok: true, resolved: out.split(/\r?\n/)[0] };
    }
    const out = execFileSync("sh", ["-c", "command -v -- \"$1\"", "sh", command], { timeout: 10_000 }).toString().trim();
    return { ok: Boolean(out), resolved: out };
  } catch (error) {
    return { ok: false, resolved: null };
  }
}

const outputRoot = process.env.RUDI_OUTPUT_DIR || join(homedir(), ".rudi", "output");
const checks = [
  {
    id: "ffmpeg",
    kind: "binary",
    value: process.env.AUDIO_TOOLS_FFMPEG || process.env.FFMPEG_BIN || "ffmpeg",
  },
  {
    id: "ffprobe",
    kind: "binary",
    value: process.env.AUDIO_TOOLS_FFPROBE || process.env.FFPROBE_BIN || "ffprobe",
  },
  {
    id: "yt-dlp",
    kind: "binary",
    value: process.env.AUDIO_TOOLS_YTDLP || process.env.YT_DLP_BIN || "yt-dlp",
  },
  {
    id: "whisper-cli",
    kind: "binary",
    value: process.env.AUDIO_TOOLS_WHISPER || process.env.WHISPER_BIN || "whisper-cli",
  },
  {
    id: "whisper-model",
    kind: "file",
    value: process.env.AUDIO_TOOLS_WHISPER_MODEL || process.env.WHISPER_MODEL || join(homedir(), ".rudi", "models", "whisper", "ggml-base.en.bin"),
  },
  {
    id: "output-dir",
    kind: "path",
    value: process.env.AUDIO_TOOLS_OUTPUT_DIR || join(outputRoot, "audio-tools", "transcripts"),
  },
  {
    id: "db-path",
    kind: "path",
    value: process.env.AUDIO_TOOLS_DB_PATH || join(outputRoot, "audio-tools", "audio.db"),
  },
];

const results = checks.map((check) => {
  if (check.kind === "binary") {
    const found = lookupCommand(check.value);
    return { ...check, ok: found.ok, resolved: found.resolved };
  }
  if (check.kind === "file") {
    return { ...check, ok: existsSync(check.value), resolved: check.value };
  }
  return { ...check, ok: true, resolved: check.value };
});

const json = process.argv.includes("--json");
if (json) {
  console.log(JSON.stringify({ ok: results.every((item) => item.ok), checks: results }, null, 2));
} else {
  console.log("Audio Tools runtime check");
  console.log("=========================");
  for (const result of results) {
    const status = result.ok ? "ok" : "missing";
    console.log(`${status.padEnd(7)} ${result.id.padEnd(14)} ${result.resolved || result.value}`);
  }
}

const missing = results.filter((item) => !item.ok);
if (missing.length) {
  console.error("");
  console.error("Missing runtime requirements. Provision these in the actual MCP/plugin runtime, not only in an interactive shell:");
  for (const item of missing) {
    console.error(`- ${item.id}: ${item.value}`);
  }
  process.exit(1);
}
