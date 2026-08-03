import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackRoot = fileURLToPath(new URL("../", import.meta.url));

async function collectTextFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (["dist", "node_modules", "tests"].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTextFiles(target));
    else if (entry.isFile() && entry.name !== "package-lock.json") files.push(target);
  }
  return files;
}

test("package contract declares the portable audio MCP surface", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(stackRoot, "manifest.json"), "utf8")
  );

  assert.equal(manifest.id, "stack:audio-tools");
  assert.equal(manifest.runtime, "node");
  assert.deepEqual(manifest.requires.binaries, ["ffmpeg", "ffprobe", "yt-dlp"]);
  assert.deepEqual(manifest.provides.tools, [
    "audio_transcribe",
    "audio_enrich",
    "audio_query",
    "audio_sync",
    "audio_stats",
  ]);

  const files = await collectTextFiles(stackRoot);
  const content = (await Promise.all(files.map((file) => fs.readFile(file, "utf8"))))
    .join("\n");
  assert.equal(content.includes("/Users/"), false);
  assert.equal(content.includes("/opt/homebrew"), false);
});
