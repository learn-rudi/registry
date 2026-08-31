import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  artifactPath,
  loadProject,
  pathExists,
  readJson,
  writeJson
} from '../lib/files.js';
import { runCommand } from '../lib/process.js';
import { DEFAULT_SETTINGS } from '../config/defaults.js';
import { advanceRunState, RunState } from '../lib/states.js';
import { normalizeWord as normalizeWordShared } from '../lib/transcript.js';
import { roundTime } from '../lib/format.js';
import {
  transcriptProvenancePath,
  validateTranscript,
  validateTranscriptProvenance,
  validateWhisperOutput
} from '../lib/transcript-validation.js';
import {
  assertLogicalModelId,
  resolveWhisperCppBin,
  resolveWhisperCppModel,
  resolveWhisperCppVadModel
} from '../lib/whisper-cpp.js';

function normalizeWord(rawWord) {
  return normalizeWordShared(rawWord, { round: true, includeProbability: true });
}

function normalizeSegment(rawSegment) {
  const start = Number(rawSegment.start);
  const end = Number(rawSegment.end);
  const words = Array.isArray(rawSegment.words)
    ? rawSegment.words.map(normalizeWord).filter(Boolean)
    : [];

  return {
    id: Number.isInteger(rawSegment.id) ? rawSegment.id : null,
    start: Number.isFinite(start) ? roundTime(start) : 0,
    end: Number.isFinite(end) ? roundTime(end) : 0,
    text: String(rawSegment.text || '').trim(),
    words
  };
}

function summarizeTranscript(segments, words) {
  const duration = Math.max(
    0,
    ...segments.map((segment) => segment.end),
    ...words.map((word) => word.end)
  );

  return {
    duration: roundTime(duration),
    segmentCount: segments.length,
    wordCount: words.length,
    wordsPerSecond: duration > 0 ? roundTime(words.length / duration) : 0
  };
}

function normalizeWhisperOutput(raw, metadata) {
  const segments = Array.isArray(raw.segments)
    ? raw.segments.map(normalizeSegment)
    : [];
  const words = segments.flatMap((segment) => segment.words);

  return {
    schemaVersion: 1,
    kind: metadata.kind,
    media: metadata.media,
    model: metadata.model,
    language: raw.language || metadata.model.language,
    text: String(raw.text || '').trim(),
    segments,
    words,
    stats: summarizeTranscript(segments, words)
  };
}

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const whisperCppWrapper = path.join(stackRoot, 'scripts', 'whisper-cpp-openai-wrapper.js');

function resolvePythonWhisperCommand() {
  const envCommand = process.env.WHISPER_CMD;
  if (envCommand) {
    return envCommand;
  }

  // Fallback: check for whisper in the user's Python bin; the actual path varies by username/version
  const userBin = path.join(os.homedir(), 'Library', 'Python', '3.9', 'bin', 'whisper');
  if (existsSync(userBin)) {
    return userBin;
  }

  return 'whisper';
}

function resolveWhisperBackend(settings) {
  const requestedEngine = process.env.WHISPER_ENGINE || settings.engine || 'auto';
  if (!['auto', 'python', 'whisper.cpp'].includes(requestedEngine)) {
    throw new Error(`Unsupported Whisper engine: ${requestedEngine}`);
  }

  const cppBin = resolveWhisperCppBin();
  const cppModel = resolveWhisperCppModel(settings.model);
  const cppVadModel = settings.vad ? resolveWhisperCppVadModel() : null;
  const cppReady = cppBin && cppModel && (!settings.vad || cppVadModel);
  const useWhisperCpp = requestedEngine === 'whisper.cpp'
    || (requestedEngine === 'auto' && cppReady);

  if (useWhisperCpp) {
    if (!cppBin) {
      throw new Error('whisper.cpp was requested but whisper-cli was not found. Set WHISPER_CPP_BIN.');
    }
    if (!cppModel) {
      throw new Error(`whisper.cpp model not found for ${settings.model}. Set WHISPER_CPP_MODEL.`);
    }
    if (settings.vad && !cppVadModel) {
      throw new Error('whisper.cpp VAD was requested but its model was not found. Set WHISPER_CPP_VAD_MODEL.');
    }
    return {
      command: process.execPath,
      prefixArgs: [whisperCppWrapper],
      engine: 'whisper.cpp',
      model: settings.model
    };
  }

  return {
    command: resolvePythonWhisperCommand(),
    prefixArgs: [],
    engine: process.env.WHISPER_CMD ? 'custom' : 'python',
    model: settings.model === 'large-v3-turbo' ? 'turbo' : settings.model
  };
}

async function resolveMedia(runDir, project, target, renderName) {
  if (target === 'source') {
    const workingPath = artifactPath(runDir, project, 'working');
    const sourcePath = await pathExists(workingPath)
      ? workingPath
      : path.join(runDir, project.sourceLink);

    return {
      path: sourcePath,
      artifactName: 'transcriptSource',
      media: {
        path: path.relative(runDir, sourcePath),
        target: 'source'
      }
    };
  }

  if (target === 'output') {
    if (!renderName) {
      throw new Error('Usage: transcribe <run> output <render-name.mp4> [model]');
    }

    const renderPath = path.join(artifactPath(runDir, project, 'renders'), renderName);
    if (!(await pathExists(renderPath))) {
      throw new Error(`Render not found: ${renderPath}`);
    }

    return {
      path: renderPath,
      artifactName: 'transcriptOutput',
      media: {
        path: path.relative(runDir, renderPath),
        target: 'output',
        render: renderName
      }
    };
  }

  throw new Error(`Unknown transcription target: ${target}`);
}

async function readWhisperJson(outputDir, mediaPath) {
  const outputPath = path.join(
    outputDir,
    `${path.basename(mediaPath, path.extname(mediaPath))}.json`
  );

  if (!(await pathExists(outputPath))) {
    throw new Error(`Whisper did not write expected JSON output: ${outputPath}`);
  }

  return readJson(outputPath);
}

export async function transcribeRun(runDir, target = 'source', options = {}) {
  const { project } = await loadProject(runDir);
  const settings = {
    ...DEFAULT_SETTINGS.transcription,
    ...(project.settings.transcription || {})
  };
  const model = assertLogicalModelId(options.model || settings.model);
  const language = options.language || settings.language;
  const wordTimestamps = options.wordTimestamps ?? settings.wordTimestamps;
  const vad = options.vad ?? settings.vad;
  const effectiveVad = vad && !wordTimestamps;
  const initialPrompt = options.initialPrompt ?? settings.initialPrompt;
  if (typeof initialPrompt !== 'string' || initialPrompt.length > 2000) {
    throw new Error('initialPrompt must be a string of at most 2000 characters');
  }
  const media = await resolveMedia(runDir, project, target, options.renderName);
  const outputPath = artifactPath(runDir, project, media.artifactName);
  const backend = resolveWhisperBackend({
    ...settings,
    engine: options.engine ?? settings.engine,
    model,
    vad: effectiveVad
  });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-agent-whisper-'));

  try {
    const commandArgs = [
      ...backend.prefixArgs,
      media.path,
      '--model', backend.model,
      '--output_format', 'json',
      '--output_dir', tempDir,
      '--language', language,
      '--task', 'transcribe',
      '--word_timestamps', wordTimestamps ? 'True' : 'False'
    ];
    if (backend.engine === 'whisper.cpp') {
      commandArgs.push('--vad', effectiveVad ? 'True' : 'False');
    } else {
      commandArgs.push('--fp16', 'False', '--verbose', 'False');
    }
    if (initialPrompt.trim()) {
      commandArgs.push('--initial_prompt', initialPrompt.trim());
    }
    await runCommand(backend.command, commandArgs);

    const raw = await readWhisperJson(tempDir, media.path);
    validateWhisperOutput(raw, {
      label: 'Whisper JSON',
      wordTimestamps
    });
    const transcript = normalizeWhisperOutput(raw, {
      kind: target,
      media: media.media,
      model: {
        command: backend.command,
        model,
        language,
        wordTimestamps
      }
    });
    const provenancePath = transcriptProvenancePath(outputPath);
    const provenance = {
      schemaVersion: 1,
      transcript: path.relative(runDir, outputPath),
      command: backend.engine === 'whisper.cpp'
        ? 'scripts/whisper-cpp-openai-wrapper.js'
        : path.basename(backend.command),
      engine: backend.engine,
      model,
      backendModel: backend.model,
      language,
      wordTimestamps,
      vad: backend.engine === 'whisper.cpp' && effectiveVad,
      initialPrompt: Boolean(initialPrompt.trim())
    };

    await validateTranscript(transcript, 'normalized transcript');
    await validateTranscriptProvenance(provenance);
    await writeJson(outputPath, transcript);
    await writeJson(provenancePath, provenance);
    if (target === 'source') {
      await advanceRunState(runDir, RunState.TRANSCRIBED);
    }
    return {
      outputPath,
      transcript,
      provenancePath,
      provenance
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
