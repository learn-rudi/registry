#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".flac", ".mp3", ".ogg", ".wav"]);

function readOption(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function resolveWhisperCli() {
  return process.env.WHISPER_CPP_BIN
    || process.env.AUDIO_TOOLS_WHISPER
    || "/opt/homebrew/bin/whisper-cli";
}

function resolveModel(modelArg) {
  const candidates = [
    process.env.WHISPER_CPP_MODEL,
    process.env.AUDIO_TOOLS_WHISPER_MODEL,
    modelArg && modelArg.includes(path.sep) ? modelArg : null,
    path.join(process.env.HOME || "", ".rudi/models/whisper/ggml-base.en.bin"),
    "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin"
  ].filter(Boolean);

  const modelPath = candidates.find((candidate) => existsSync(candidate));
  if (!modelPath) {
    throw new Error("No whisper.cpp model found. Set WHISPER_CPP_MODEL or AUDIO_TOOLS_WHISPER_MODEL.");
  }
  return modelPath;
}

function ensureAudio(mediaPath, tempDir) {
  const ext = path.extname(mediaPath).toLowerCase();
  if (SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
    return mediaPath;
  }

  const wavPath = path.join(tempDir, "audio.wav");
  run(process.env.FFMPEG_BIN || "ffmpeg", [
    "-v", "error",
    "-y",
    "-i", mediaPath,
    "-ar", "16000",
    "-ac", "1",
    wavPath
  ]);
  return wavPath;
}

function secondsFromOffsets(offsets, key) {
  const ms = Number(offsets?.[key]);
  return Number.isFinite(ms) ? ms / 1000 : 0;
}

function isSpecialToken(text) {
  return /^\[[^\]]+\]$/.test(text.trim());
}

function isPunctuation(text) {
  return /^[.,!?;:)"']+$/.test(text.trim());
}

function normalizeWord(word) {
  const text = word.text.trim();
  if (!text) return null;

  const start = Number.isFinite(word.start) ? word.start : 0;
  let end = Number.isFinite(word.end) ? word.end : start;
  if (end <= start) {
    end = start + 0.06;
  }

  return {
    word: text,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    probability: Number.isFinite(word.probability) ? Number(word.probability.toFixed(4)) : 1
  };
}

function wordsFromTokens(tokens) {
  const words = [];
  let current = null;

  for (const token of tokens || []) {
    const text = String(token.text || "");
    if (!text.trim() || isSpecialToken(text)) continue;

    const start = secondsFromOffsets(token.offsets, "from");
    const end = secondsFromOffsets(token.offsets, "to");
    const probability = Number(token.p);
    const startsNewWord = /^\s/.test(text) || !current;

    if (isPunctuation(text) && current) {
      current.text += text.trim();
      current.end = Math.max(current.end, end);
      if (Number.isFinite(probability)) {
        current.probabilities.push(probability);
      }
      continue;
    }

    if (startsNewWord) {
      if (current) {
        const normalized = normalizeWord({
          ...current,
          probability: average(current.probabilities)
        });
        if (normalized) words.push(normalized);
      }
      current = {
        text,
        start,
        end,
        probabilities: Number.isFinite(probability) ? [probability] : []
      };
      continue;
    }

    current.text += text;
    current.end = Math.max(current.end, end);
    if (Number.isFinite(probability)) {
      current.probabilities.push(probability);
    }
  }

  if (current) {
    const normalized = normalizeWord({
      ...current,
      probability: average(current.probabilities)
    });
    if (normalized) words.push(normalized);
  }

  return words;
}

function average(values) {
  if (!values.length) return 1;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function convertJson(raw, metadata) {
  const transcription = Array.isArray(raw.transcription) ? raw.transcription : [];
  const segments = transcription.map((item, index) => {
    const start = secondsFromOffsets(item.offsets, "from");
    const end = secondsFromOffsets(item.offsets, "to");
    return {
      id: index,
      start,
      end: end > start ? end : start + 0.06,
      text: String(item.text || "").trim(),
      words: wordsFromTokens(item.tokens)
    };
  });

  return {
    text: segments.map((segment) => segment.text).filter(Boolean).join(" ").trim(),
    segments,
    language: metadata.language
  };
}

function main() {
  const args = process.argv.slice(2);
  const mediaPath = args[0];
  if (!mediaPath) {
    throw new Error("Usage: whisper-cpp-openai-wrapper.js <media> --output_dir <dir> [--model base] [--language en]");
  }

  const outputDir = readOption(args, "--output_dir");
  if (!outputDir) {
    throw new Error("--output_dir is required");
  }

  const language = readOption(args, "--language", "en");
  const modelArg = readOption(args, "--model", "base");
  const whisper = resolveWhisperCli();
  const model = resolveModel(modelArg);
  const tempDir = mkdtempSync(path.join(tmpdir(), "video-editor-whisper-cpp-"));

  try {
    const audioPath = ensureAudio(mediaPath, tempDir);
    const outputBase = path.join(tempDir, "whisper-output");
    run(whisper, [
      "-m", model,
      "-f", audioPath,
      "-l", language,
      "-oj",
      "-ojf",
      "-of", outputBase,
      "-np"
    ]);

    const raw = JSON.parse(readFileSync(`${outputBase}.json`, "utf8"));
    const converted = convertJson(raw, { language });
    const finalPath = path.join(
      outputDir,
      `${path.basename(mediaPath, path.extname(mediaPath))}.json`
    );
    writeFileSync(finalPath, `${JSON.stringify(converted, null, 2)}\n`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
