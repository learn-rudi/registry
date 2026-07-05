import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { initRun } from '../src/operations/init.js';
import { runsRoot } from '../src/lib/files.js';

const execFileAsync = promisify(execFile);

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createTinyVideo(outputPath) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=160x90:rate=15',
    '-t', '0.2',
    '-pix_fmt', 'yuv420p',
    outputPath
  ]);
}

test('init keeps a Downloads source by default after import succeeds', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rudi-video-init-'));
  const downloadsDir = path.join(tempRoot, 'Downloads');
  const slug = `downloads-intake-keep-${process.pid}-${Date.now()}`;
  const runDir = path.join(runsRoot, slug);
  const previousDownloadsDir = process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR;

  await fs.mkdir(downloadsDir, { recursive: true });
  const sourcePath = path.join(downloadsDir, 'phone-take.mov');
  await createTinyVideo(sourcePath);

  process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = downloadsDir;

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

  await fs.mkdir(downloadsDir, { recursive: true });
  const sourcePath = path.join(downloadsDir, 'phone-take.mov');
  await createTinyVideo(sourcePath);

  process.env.RUDI_VIDEO_EDITOR_DOWNLOADS_DIR = downloadsDir;

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
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
