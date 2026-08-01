import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import {
  resolveAudioConfig,
} from "../dist/config.js";
import {
  buildUrlDownloadPlan,
  isVideoPageUrl,
  resolveInput,
} from "../dist/resolve-input.js";
import {
  preflightTranscriptionTools,
} from "../dist/transcribe.js";

test("audio default config is portable and env-overridable", () => {
  const home = "/tmp/rudi-home";
  const cfg = resolveAudioConfig(
    {
      AUDIO_TOOLS_FFMPEG: "/custom/ffmpeg",
      AUDIO_TOOLS_FFPROBE: "/custom/ffprobe",
      AUDIO_TOOLS_WHISPER: "/custom/whisper-cli",
      AUDIO_TOOLS_WHISPER_MODEL: "/custom/model.bin",
    },
    home
  );

  assert.equal(cfg.output_dir, "/tmp/rudi-home/.rudi/output/audio-tools/transcripts");
  assert.equal(cfg.db_path, "/tmp/rudi-home/.rudi/output/audio-tools/audio.db");
  assert.equal(cfg.tools.ffmpeg, "/custom/ffmpeg");
  assert.equal(cfg.tools.ffprobe, "/custom/ffprobe");
  assert.equal(cfg.tools.whisper, "/custom/whisper-cli");
  assert.equal(cfg.tools.whisper_model, "/custom/model.bin");
  assert.equal(JSON.stringify(resolveAudioConfig({}, home)).includes("/Users/hoff"), false);
  assert.equal(JSON.stringify(resolveAudioConfig({}, home)).includes("/opt/homebrew"), false);
});

test("resolveInput writes base64 audio input to a temporary file", async () => {
  const input = await resolveInput({
    data: Buffer.from("fake audio bytes").toString("base64"),
    filename: "sample.m4a",
  });

  try {
    assert.equal(input.filename, "sample.m4a");
    assert.equal(existsSync(input.path), true);
    assert.equal(readFileSync(input.path, "utf8"), "fake audio bytes");
  } finally {
    input.cleanup();
    rmSync(join(tmpdir(), "audio-tools"), { recursive: true, force: true });
  }
});

test("resolveInput sanitizes base64 filenames into the temp directory", async () => {
  const input = await resolveInput({
    data: Buffer.from("fake audio bytes").toString("base64"),
    filename: "../../outside/secret.wav",
  });

  try {
    const audioTmp = join(tmpdir(), "audio-tools");
    assert.equal(input.filename, "secret.wav");
    assert.equal(relative(audioTmp, input.path).startsWith(".."), false);
    assert.equal(existsSync(input.path), true);
  } finally {
    input.cleanup();
    rmSync(join(tmpdir(), "audio-tools"), { recursive: true, force: true });
  }
});

test("resolveInput rejects non-http URL schemes before download", async () => {
  await assert.rejects(
    () => resolveInput({ url: "file:///etc/passwd" }),
    /url must use http or https/
  );
});

test("video page URLs are planned through yt-dlp audio extraction", () => {
  const youtube = "https://www.youtube.com/watch?v=abcdefghijk";
  const tiktok = "https://www.tiktok.com/@user/video/6718335390845095173";

  assert.equal(isVideoPageUrl(youtube), true);
  assert.equal(isVideoPageUrl(tiktok), true);
  assert.equal(isVideoPageUrl("https://example.com/audio.mp3"), false);

  const plan = buildUrlDownloadPlan(youtube, "/tmp/audio-tools", "clip");
  assert.equal(plan.mode, "yt-dlp");
  assert.equal(plan.command, "yt-dlp");
  assert.ok(plan.args.includes("-x"));
  assert.ok(plan.args.includes("--audio-format"));
  assert.ok(plan.args.includes("m4a"));
  assert.ok(plan.args.includes(youtube));
  assert.match(plan.outputTemplate, /clip-%\(id\)s\.\%\(ext\)s$/);
});

test("transcription preflight reports missing runtime binaries clearly", () => {
  assert.throws(
    () => preflightTranscriptionTools({
      ffmpeg: "/definitely/missing/ffmpeg",
      ffprobe: "/definitely/missing/ffprobe",
      whisper: "/definitely/missing/whisper-cli",
      whisper_model: "/definitely/missing/model.bin",
    }),
    /ffmpeg is not available in this runtime/
  );
});

test("transcription preflight reports missing Whisper model clearly", () => {
  assert.throws(
    () => preflightTranscriptionTools({
      ffmpeg: process.execPath,
      ffprobe: process.execPath,
      whisper: process.execPath,
      whisper_model: "/definitely/missing/model.bin",
    }),
    /Whisper model not found/
  );
});
