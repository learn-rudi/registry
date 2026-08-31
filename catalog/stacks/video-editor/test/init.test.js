import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { initRun } from '../src/operations/init.js';
import { runsRoot } from '../src/lib/files.js';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createTinyVideo(outputPath) {
  await fs.writeFile(outputPath, 'synthetic video fixture');
}

async function installFakeMediaTools(tempRoot) {
  const binDir = path.join(tempRoot, 'bin');
  const probe = {
    streams: [
      {
        codec_type: 'video',
        codec_name: 'h264',
        width: 160,
        height: 90,
        r_frame_rate: '15/1',
        avg_frame_rate: '15/1',
        nb_frames: '3',
        start_time: '0'
      },
      {
        codec_type: 'audio',
        codec_name: 'aac',
        sample_rate: '48000',
        channels: 2,
        start_time: '0'
      }
    ],
    format: {
      duration: '0.2',
      size: '23',
      bit_rate: '920',
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2'
    }
  };

  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'ffmpeg'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
    { mode: 0o755 }
  );
  await fs.writeFile(
    path.join(binDir, 'ffprobe'),
    `#!/usr/bin/env node\nif (process.argv.includes('-version')) process.exit(0);\nprocess.stdout.write(${JSON.stringify(JSON.stringify(probe))});\n`,
    { mode: 0o755 }
  );
  return binDir;
}

test('init keeps a Downloads source by default after import succeeds', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-video-init-'));
  const downloadsDir = path.join(tempRoot, 'Downloads');
  const slug = `downloads-intake-keep-${process.pid}-${Date.now()}`;
  const runDir = path.join(runsRoot, slug);
  const previousDownloadsDir = process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR;
  const previousPath = process.env.PATH;

  await fs.mkdir(downloadsDir, { recursive: true });
  const sourcePath = path.join(downloadsDir, 'phone-take.mov');
  await createTinyVideo(sourcePath);

  process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = downloadsDir;
  process.env.PATH = `${await installFakeMediaTools(tempRoot)}${path.delimiter}${previousPath || ''}`;

  try {
    const result = await initRun(sourcePath, slug);
    const importedSource = path.join(result.runDir, result.project.sourceLink);

    assert.equal(result.runDir, runDir);
    assert.equal(await exists(importedSource), true);
    assert.equal(await exists(sourcePath), true);
    assert.equal(result.project.sourcePath, sourcePath);
    assert.deepEqual(result.intake, {
      movedFromDownloads: false,
      originalPath: sourcePath,
      sourcePath: importedSource
    });
  } finally {
    if (previousDownloadsDir === undefined) {
      delete process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR;
    } else {
      process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = previousDownloadsDir;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('init can move a Downloads source when cleanup is explicitly enabled', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-video-init-'));
  const downloadsDir = path.join(tempRoot, 'Downloads');
  const slug = `downloads-intake-move-${process.pid}-${Date.now()}`;
  const runDir = path.join(runsRoot, slug);
  const previousDownloadsDir = process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR;
  const previousPath = process.env.PATH;

  await fs.mkdir(downloadsDir, { recursive: true });
  const sourcePath = path.join(downloadsDir, 'phone-take.mov');
  await createTinyVideo(sourcePath);

  process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = downloadsDir;
  process.env.PATH = `${await installFakeMediaTools(tempRoot)}${path.delimiter}${previousPath || ''}`;

  try {
    const result = await initRun(sourcePath, slug, { moveDownloadsSource: true });
    const importedSource = path.join(result.runDir, result.project.sourceLink);

    assert.equal(result.runDir, runDir);
    assert.equal(await exists(importedSource), true);
    assert.equal(await exists(sourcePath), false);
    assert.equal(result.project.sourcePath, importedSource);
    assert.deepEqual(result.intake, {
      movedFromDownloads: true,
      originalPath: sourcePath,
      sourcePath: importedSource
    });
  } finally {
    if (previousDownloadsDir === undefined) {
      delete process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR;
    } else {
      process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = previousDownloadsDir;
    }
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
