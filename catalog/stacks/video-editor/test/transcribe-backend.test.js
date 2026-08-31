import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cloneDefaultArtifacts, cloneDefaultSettings } from '../src/config/defaults.js';
import { transcribeRun } from '../src/operations/transcribe.js';

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source);
  await chmod(filePath, 0o755);
}

test('structured runs honor an explicit whisper.cpp engine and retain schema v1', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-transcribe-backend-'));
  const priorEnv = { ...process.env };
  try {
    const runDir = path.join(tempDir, 'run');
    const fakeBinDir = path.join(tempDir, 'bin');
    const sourcePath = path.join(runDir, 'source.wav');
    const modelPath = path.join(tempDir, 'ggml-large-v3-turbo.bin');
    const vadModelPath = path.join(tempDir, 'ggml-silero-v6.2.0.bin');
    const whisperArgsPath = path.join(tempDir, 'whisper-args.json');
    const fakeWhisperCpp = path.join(fakeBinDir, 'whisper-cli');
    const fakePythonWhisper = path.join(fakeBinDir, 'whisper');
    await mkdir(runDir, { recursive: true });
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(sourcePath, 'audio fixture');
    await writeFile(modelPath, 'model fixture');
    await writeFile(vadModelPath, 'vad fixture');
    await writeExecutable(fakePythonWhisper, `#!/bin/sh
echo 'python fallback invoked' >&2
exit 9
`);
    await writeExecutable(fakeWhisperCpp, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.writeFileSync(process.env.WRAPPER_TEST_ARGS, JSON.stringify(args));
const outputBase = args[args.indexOf('-of') + 1];
const includeTokens = args.includes('-ojf');
fs.writeFileSync(outputBase + '.json', JSON.stringify({
  transcription: [{
    offsets: { from: 0, to: 1200 },
    text: ' Architect test',
    tokens: includeTokens
      ? [{ text: ' Architect', offsets: { from: 0, to: 1200 }, p: 0.99 }]
      : []
  }]
}));
`);

    const settings = cloneDefaultSettings();
    settings.transcription = {
      ...settings.transcription,
      engine: 'whisper.cpp',
      model: 'large-v3-turbo',
      wordTimestamps: false,
      vad: true,
      initialPrompt: 'Architect, Lauren Tudor, Brandon Hoff, RUDI'
    };
    await writeFile(path.join(runDir, 'project.json'), `${JSON.stringify({
      schemaVersion: 1,
      slug: 'backend-test',
      sourcePath,
      sourceLink: 'source.wav',
      createdAt: '2026-08-31T12:00:00.000Z',
      artifacts: cloneDefaultArtifacts(),
      settings
    }, null, 2)}\n`);

    process.env.HOME = tempDir;
    process.env.PATH = `${fakeBinDir}:${priorEnv.PATH}`;
    process.env.WHISPER_ENGINE = 'whisper.cpp';
    delete process.env.WHISPER_CPP_BIN;
    delete process.env.AUDIO_TOOLS_WHISPER;
    process.env.WHISPER_CPP_MODEL = modelPath;
    process.env.WHISPER_CPP_VAD_MODEL = vadModelPath;
    process.env.WRAPPER_TEST_ARGS = whisperArgsPath;
    delete process.env.WHISPER_CMD;

    const result = await transcribeRun(runDir, 'source');
    assert.equal(result.transcript.schemaVersion, 1);
    assert.deepEqual(
      Object.keys(result.transcript.model).sort(),
      ['command', 'language', 'model', 'wordTimestamps']
    );
    assert.equal(result.transcript.model.model, 'large-v3-turbo');
    assert.equal(result.transcript.model.wordTimestamps, false);
    assert.equal(result.transcript.text, 'Architect test');
    assert.equal(result.transcript.words.length, 0);
    const provenance = JSON.parse(await readFile(
      path.join(runDir, 'transcript-source.provenance.json'),
      'utf8'
    ));
    assert.equal(provenance.schemaVersion, 1);
    assert.equal(provenance.engine, 'whisper.cpp');
    assert.equal(provenance.model, 'large-v3-turbo');
    assert.equal(provenance.wordTimestamps, false);
    assert.equal(provenance.vad, true);
    assert.equal(provenance.initialPrompt, true);
    const whisperArgs = JSON.parse(await readFile(whisperArgsPath, 'utf8'));
    assert.equal(whisperArgs.includes('--vad'), true);
    assert.equal(whisperArgs.includes('--prompt'), true);
  } finally {
    process.env = priorEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('malformed Whisper JSON fails before writing a transcript artifact', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-transcribe-invalid-'));
  const priorEnv = { ...process.env };
  try {
    const runDir = path.join(tempDir, 'run');
    const sourcePath = path.join(runDir, 'source.wav');
    const fakeWhisper = path.join(tempDir, 'whisper');
    await mkdir(runDir, { recursive: true });
    await writeFile(sourcePath, 'audio fixture');
    await writeExecutable(fakeWhisper, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const mediaPath = args[0];
const outputDir = args[args.indexOf('--output_dir') + 1];
const outputPath = path.join(outputDir, path.basename(mediaPath, path.extname(mediaPath)) + '.json');
fs.writeFileSync(outputPath, '{}');
`);

    const settings = cloneDefaultSettings();
    settings.transcription = {
      ...settings.transcription,
      engine: 'python',
      model: 'medium',
      wordTimestamps: false,
      vad: false
    };
    await writeFile(path.join(runDir, 'project.json'), `${JSON.stringify({
      schemaVersion: 1,
      slug: 'invalid-output-test',
      sourcePath,
      sourceLink: 'source.wav',
      createdAt: '2026-08-31T12:00:00.000Z',
      artifacts: cloneDefaultArtifacts(),
      settings
    }, null, 2)}\n`);

    process.env.HOME = tempDir;
    process.env.WHISPER_ENGINE = 'python';
    process.env.WHISPER_CMD = fakeWhisper;

    await assert.rejects(
      () => transcribeRun(runDir, 'source'),
      /Whisper JSON is malformed/
    );
    await assert.rejects(
      () => access(path.join(runDir, 'transcript-source.json')),
      { code: 'ENOENT' }
    );
  } finally {
    process.env = priorEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('transcribe options reject physical model paths', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-transcribe-model-'));
  const priorEnv = { ...process.env };
  try {
    const runDir = path.join(tempDir, 'run');
    const sourcePath = path.join(runDir, 'source.wav');
    const physicalModelPath = path.join(tempDir, 'ggml-large-v3-turbo.bin');
    const fakeWhisper = path.join(tempDir, 'whisper');
    await mkdir(runDir, { recursive: true });
    await writeFile(sourcePath, 'audio fixture');
    await writeFile(physicalModelPath, 'model fixture');
    await writeExecutable(fakeWhisper, `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const mediaPath = args[0];
const outputDir = args[args.indexOf('--output_dir') + 1];
const outputPath = path.join(outputDir, path.basename(mediaPath, path.extname(mediaPath)) + '.json');
fs.writeFileSync(outputPath, JSON.stringify({ text: '', language: 'en', segments: [] }));
`);

    const settings = cloneDefaultSettings();
    settings.transcription = {
      ...settings.transcription,
      engine: 'python',
      model: 'medium',
      wordTimestamps: false,
      vad: false
    };
    await writeFile(path.join(runDir, 'project.json'), `${JSON.stringify({
      schemaVersion: 1,
      slug: 'physical-model-test',
      sourcePath,
      sourceLink: 'source.wav',
      createdAt: '2026-08-31T12:00:00.000Z',
      artifacts: cloneDefaultArtifacts(),
      settings
    }, null, 2)}\n`);

    process.env.HOME = tempDir;
    process.env.WHISPER_ENGINE = 'python';
    process.env.WHISPER_CMD = fakeWhisper;

    await assert.rejects(
      () => transcribeRun(runDir, 'source', { model: physicalModelPath }),
      /logical model ID/
    );
    await assert.rejects(
      () => access(path.join(runDir, 'transcript-source.json')),
      { code: 'ENOENT' }
    );
  } finally {
    process.env = priorEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('auto engine falls back when whisper.cpp prerequisites are unusable', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-transcribe-auto-'));
  const priorEnv = { ...process.env };
  try {
    const runDir = path.join(tempDir, 'run');
    const sourcePath = path.join(runDir, 'source.wav');
    const physicalModelPath = path.join(tempDir, 'ggml-large-v3-turbo.bin');
    const unusableCppPath = path.join(tempDir, 'not-an-executable');
    const fakeWhisper = path.join(tempDir, 'whisper');
    await mkdir(runDir, { recursive: true });
    await mkdir(unusableCppPath);
    await writeFile(sourcePath, 'audio fixture');
    await writeFile(physicalModelPath, 'model fixture');
    await writeExecutable(fakeWhisper, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const mediaPath = args[0];
const outputDir = args[args.indexOf('--output_dir') + 1];
const outputPath = path.join(outputDir, path.basename(mediaPath, path.extname(mediaPath)) + '.json');
fs.writeFileSync(outputPath, JSON.stringify({ text: '', language: 'en', segments: [] }));
`);

    const settings = cloneDefaultSettings();
    settings.transcription = {
      ...settings.transcription,
      engine: 'auto',
      model: 'large-v3-turbo',
      wordTimestamps: false,
      vad: false
    };
    await writeFile(path.join(runDir, 'project.json'), `${JSON.stringify({
      schemaVersion: 1,
      slug: 'auto-fallback-test',
      sourcePath,
      sourceLink: 'source.wav',
      createdAt: '2026-08-31T12:00:00.000Z',
      artifacts: cloneDefaultArtifacts(),
      settings
    }, null, 2)}\n`);

    process.env.HOME = tempDir;
    process.env.PATH = '/usr/bin:/bin';
    delete process.env.WHISPER_ENGINE;
    process.env.WHISPER_CMD = fakeWhisper;
    process.env.WHISPER_CPP_BIN = unusableCppPath;
    process.env.WHISPER_CPP_MODEL = physicalModelPath;
    delete process.env.AUDIO_TOOLS_WHISPER;

    const result = await transcribeRun(runDir, 'source');
    assert.equal(result.provenance.engine, 'custom');
    assert.equal(result.provenance.model, 'large-v3-turbo');
    assert.equal(result.provenance.backendModel, 'turbo');
    assert.equal(result.transcript.schemaVersion, 1);
  } finally {
    process.env = priorEnv;
    await rm(tempDir, { recursive: true, force: true });
  }
});
