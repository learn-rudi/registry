/**
 * Transcription pipeline: audio file → ffmpeg convert → whisper-cli → JSON + MD output.
 */

import { execFileSync } from "child_process";
import { accessSync, constants, existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { getConfig } from "./config.js";

export interface TranscriptRecord {
  id: string;
  filename: string;
  audio_path: string;
  date: string;
  time: string;
  datetime: string;
  year: string;
  month: string;
  day: string;
  duration_seconds: number;
  duration_formatted: string;
  transcript: string;
  transcribed_at: string;
  json_path: string;
}

function getDuration(filePath: string, ffprobe: string): number {
  try {
    const out = execFileSync(ffprobe, [
      "-v", "quiet", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 30_000 }).toString().trim();
    return parseFloat(out) || 0;
  } catch {
    return 0;
  }
}

function assertExecutable(command: string, label: string): void {
  try {
    if (command.includes("/")) {
      accessSync(command, constants.X_OK);
      return;
    }
    if (process.platform === "win32") {
      execFileSync("where", [command], { timeout: 10_000, stdio: "ignore" });
    } else {
      execFileSync("sh", ["-c", "command -v -- \"$1\" >/dev/null", "sh", command], { timeout: 10_000, stdio: "ignore" });
    }
  } catch (error: any) {
    throw new Error(`${label} is not available in this runtime. Set the matching AUDIO_TOOLS_* environment variable or provision ${command}.`);
  }
}

export function preflightTranscriptionTools(tools: {
  ffmpeg: string;
  ffprobe: string;
  whisper: string;
  whisper_model: string;
}): void {
  assertExecutable(tools.ffmpeg, "ffmpeg");
  assertExecutable(tools.ffprobe, "ffprobe");
  assertExecutable(tools.whisper, "whisper-cli");
  if (!existsSync(tools.whisper_model)) {
    throw new Error(`Whisper model not found: ${tools.whisper_model}. Set AUDIO_TOOLS_WHISPER_MODEL or provision the model file in this runtime.`);
  }
}

function convertToWav(inputPath: string, ffmpeg: string): string {
  const wavPath = join(tmpdir(), `audio-tools-${randomBytes(4).toString("hex")}.wav`);
  try {
    execFileSync(ffmpeg, [
      "-i", inputPath, "-ar", "16000", "-ac", "1", "-y", wavPath,
    ], { timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] });
    if (!existsSync(wavPath)) {
      throw new Error("ffmpeg did not create a WAV file");
    }
    return wavPath;
  } catch (error: any) {
    const detail = error?.stderr?.toString?.().trim();
    throw new Error(`FFmpeg conversion failed${detail ? `: ${detail}` : ""}`);
  }
}

function whisperTranscribe(wavPath: string, whisper: string, model: string): string {
  try {
    const out = execFileSync(whisper, [
      "-m", model, "-f", wavPath, "--no-timestamps",
    ], { timeout: 600_000 }).toString();

    const lines = out.trim().split("\n");
    return lines.filter(l => !l.startsWith("[") && l.trim()).join(" ").trim();
  } catch (e: any) {
    throw new Error(`Whisper failed: ${e.message}`);
  }
}

function parseDate(filename: string, filePath?: string): { year: string; month: string; day: string; time: string; dt: Date } {
  // Voice Memos: "20170105 170410-27BF90D2.m4a"
  const vm = filename.match(/^(\d{8})\s+(\d{6})/);
  if (vm) {
    const [, d, t] = vm;
    const dt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    return { year: d.slice(0, 4), month: d.slice(4, 6), day: d.slice(6, 8), time: `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`, dt };
  }

  // ISO-ish: "2024-01-15T10-30-00"
  const iso = filename.match(/^(\d{4})-(\d{2})-(\d{2})[T_](\d{2})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
    return { year: y, month: mo, day: d, time: `${h}:${mi}:${s}`, dt };
  }

  // Date anywhere: "2024-01-15"
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const [, y, mo, d] = dateMatch;
    const dt = new Date(+y, +mo - 1, +d);
    return { year: y, month: mo, day: d, time: "00:00:00", dt };
  }

  // Compact: "20240115"
  const compact = filename.match(/^(\d{8})/);
  if (compact) {
    const d = compact[1];
    const dt = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
    return { year: d.slice(0, 4), month: d.slice(4, 6), day: d.slice(6, 8), time: "00:00:00", dt };
  }

  // Fallback: now
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    year: now.getFullYear().toString(),
    month: pad(now.getMonth() + 1),
    day: pad(now.getDate()),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    dt: now,
  };
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export async function transcribe(filePath: string, filename: string): Promise<TranscriptRecord> {
  const cfg = getConfig();
  const { tools, output_dir } = cfg;

  preflightTranscriptionTools(tools);

  // 1. Get duration
  const duration = getDuration(filePath, tools.ffprobe);

  // 2. Parse date from filename
  const info = parseDate(filename, filePath);

  // 3. Convert to WAV
  const wavPath = convertToWav(filePath, tools.ffmpeg);

  // 4. Transcribe
  let transcript: string;
  try {
    transcript = whisperTranscribe(wavPath, tools.whisper, tools.whisper_model);
  } finally {
    try { unlinkSync(wavPath); } catch {}
  }

  if (!transcript) throw new Error("Whisper returned empty transcript");

  // 5. Build record
  const id = basename(filename, basename(filename).slice(basename(filename).lastIndexOf(".")));
  const stem = basename(filename).replace(/\.[^.]+$/, "");

  const record: TranscriptRecord = {
    id: stem,
    filename,
    audio_path: filePath,
    date: `${info.year}-${info.month}-${info.day}`,
    time: info.time,
    datetime: info.dt.toISOString(),
    year: info.year,
    month: info.month,
    day: info.day,
    duration_seconds: Math.round(duration * 100) / 100,
    duration_formatted: formatDuration(duration),
    transcript,
    transcribed_at: new Date().toISOString(),
    json_path: "",
  };

  // 6. Save JSON + MD in YYYY/MM/DD structure
  const dayDir = join(output_dir, info.year, info.month, info.day);
  mkdirSync(dayDir, { recursive: true });

  const jsonPath = join(dayDir, `${stem}.json`);
  writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  record.json_path = jsonPath;

  const mdPath = join(dayDir, `${stem}.md`);
  const md = [
    `# ${stem}`,
    "",
    `**Date:** ${record.date} ${record.time}`,
    `**Duration:** ${record.duration_formatted}`,
    `**Audio:** \`${filePath}\``,
    "",
    "---",
    "",
    "## Transcript",
    "",
    record.transcript,
    "",
  ].join("\n");
  writeFileSync(mdPath, md);

  return record;
}
