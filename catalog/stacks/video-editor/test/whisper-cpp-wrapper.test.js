import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const stackRoot = path.resolve(import.meta.dirname, '..');
const wrapperPath = path.join(stackRoot, 'scripts', 'whisper-cpp-openai-wrapper.js');

async function createFakeWhisper(tempDir) {
  const fakePath = path.join(tempDir, 'whisper-cli');
  await writeFile(fakePath, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.writeFileSync(process.env.WRAPPER_TEST_ARGS, JSON.stringify(args));
const outputIndex = args.indexOf('-of');
const outputBase = args[outputIndex + 1];
fs.writeFileSync(outputBase + '.json', JSON.stringify({
  transcription: [{
    offsets: { from: 0, to: 1000 },
    text: ' Architect test',
    tokens: [{ text: ' Architect', offsets: { from: 0, to: 1000 }, p: 0.99 }]
  }]
}));
`);
  await chmod(fakePath, 0o755);
  return fakePath;
}

test('meeting mode uses VAD and glossary without DTW/full-token JSON', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-whisper-wrapper-'));
  try {
    const outputDir = path.join(tempDir, 'output');
    const audioPath = path.join(tempDir, 'sample.wav');
    const modelPath = path.join(tempDir, 'ggml-large-v3-turbo.bin');
    const vadModelPath = path.join(tempDir, 'ggml-silero-v6.2.0.bin');
    const argsPath = path.join(tempDir, 'args.json');
    const fakeWhisper = await createFakeWhisper(tempDir);
    await mkdir(outputDir);
    await writeFile(audioPath, 'audio fixture');
    await writeFile(modelPath, 'model fixture');
    await writeFile(vadModelPath, 'vad fixture');

    const result = spawnSync(process.execPath, [
      wrapperPath,
      audioPath,
      '--output_dir', outputDir,
      '--model', 'large-v3-turbo',
      '--language', 'en',
      '--word_timestamps', 'False',
      '--vad', 'True',
      '--initial_prompt', 'Architect, Lauren Tudor, Brandon Hoff, RUDI'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${tempDir}:${process.env.PATH}`,
        WHISPER_CPP_BIN: '',
        AUDIO_TOOLS_WHISPER: '',
        WHISPER_CPP_MODEL: modelPath,
        WHISPER_CPP_VAD_MODEL: vadModelPath,
        WRAPPER_TEST_ARGS: argsPath
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const whisperArgs = JSON.parse(await readFile(argsPath, 'utf8'));
    assert.deepEqual(
      whisperArgs.slice(0, 6),
      ['-m', modelPath, '-f', audioPath, '-l', 'en']
    );
    assert.equal(whisperArgs.includes('--vad'), true);
    assert.equal(whisperArgs.includes('--vad-model'), true);
    assert.equal(whisperArgs.includes(vadModelPath), true);
    assert.equal(whisperArgs.includes('--prompt'), true);
    assert.equal(whisperArgs.includes('Architect, Lauren Tudor, Brandon Hoff, RUDI'), true);
    assert.equal(whisperArgs.includes('-oj'), true);
    assert.equal(whisperArgs.includes('-ojf'), false);
    assert.equal(whisperArgs.includes('--dtw'), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('editing mode requests DTW and suppresses VAD because whisper.cpp misaligns token timestamps', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'video-editor-whisper-wrapper-'));
  try {
    const outputDir = path.join(tempDir, 'output');
    const audioPath = path.join(tempDir, 'sample.wav');
    const modelPath = path.join(tempDir, 'ggml-large-v3-turbo.bin');
    const vadModelPath = path.join(tempDir, 'ggml-silero-v6.2.0.bin');
    const argsPath = path.join(tempDir, 'args.json');
    const fakeWhisper = await createFakeWhisper(tempDir);
    await mkdir(outputDir);
    await writeFile(audioPath, 'audio fixture');
    await writeFile(modelPath, 'model fixture');
    await writeFile(vadModelPath, 'vad fixture');

    const result = spawnSync(process.execPath, [
      wrapperPath,
      audioPath,
      '--output_dir', outputDir,
      '--model', 'large-v3-turbo',
      '--language', 'en',
      '--word_timestamps', 'True',
      '--vad', 'True'
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WHISPER_CPP_BIN: fakeWhisper,
        WHISPER_CPP_MODEL: modelPath,
        WHISPER_CPP_VAD_MODEL: vadModelPath,
        WRAPPER_TEST_ARGS: argsPath
      }
    });

    assert.equal(result.status, 0, result.stderr);
    const whisperArgs = JSON.parse(await readFile(argsPath, 'utf8'));
    assert.equal(whisperArgs.includes('-ojf'), true);
    assert.equal(whisperArgs.includes('-oj'), false);
    assert.equal(whisperArgs.includes('--dtw'), true);
    assert.equal(whisperArgs.includes('large.v3.turbo'), true);
    assert.equal(whisperArgs.includes('--vad'), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
