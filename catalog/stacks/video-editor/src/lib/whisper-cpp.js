import { accessSync, constants, statSync } from 'fs';
import os from 'os';
import path from 'path';

const LOGICAL_MODEL_PATTERN = /^(?!.*\.bin$)[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function assertLogicalModelId(model) {
  if (typeof model !== 'string' || !LOGICAL_MODEL_PATTERN.test(model)) {
    throw new Error('model must be a logical model ID such as large-v3-turbo; physical paths belong in WHISPER_CPP_MODEL');
  }
  return model;
}

function isAccessibleFile(candidate, mode) {
  if (!candidate) return false;
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, mode);
    return true;
  } catch {
    return false;
  }
}

function resolveOnPath(executable) {
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executable))
    .find((candidate) => isAccessibleFile(candidate, constants.X_OK)) || null;
}

function homeModelPath(filename) {
  const home = os.homedir();
  return home ? path.join(home, '.rudi', 'models', 'whisper', filename) : null;
}

export function resolveWhisperCppBin() {
  const configured = process.env.WHISPER_CPP_BIN || process.env.AUDIO_TOOLS_WHISPER;
  if (configured) {
    return isAccessibleFile(configured, constants.X_OK) ? configured : null;
  }
  const candidates = [
    resolveOnPath('whisper-cli'),
    '/opt/homebrew/bin/whisper-cli',
    '/usr/local/bin/whisper-cli'
  ].filter(Boolean);
  return candidates.find((candidate) => isAccessibleFile(candidate, constants.X_OK)) || null;
}

export function resolveWhisperCppModel(model) {
  const logicalModel = assertLogicalModelId(model);
  const filename = `ggml-${logicalModel}.bin`;
  const configured = process.env.WHISPER_CPP_MODEL || process.env.AUDIO_TOOLS_WHISPER_MODEL;
  if (configured) {
    return path.basename(configured) === filename
      && isAccessibleFile(configured, constants.R_OK)
      ? configured
      : null;
  }
  const candidates = [
    homeModelPath(filename),
    path.join('/opt/homebrew/share/whisper-cpp/models', filename),
    path.join('/usr/local/share/whisper-cpp/models', filename)
  ].filter((candidate) => candidate && path.basename(candidate) === filename);
  return candidates.find((candidate) => isAccessibleFile(candidate, constants.R_OK)) || null;
}

export function resolveWhisperCppVadModel() {
  const filename = 'ggml-silero-v6.2.0.bin';
  const configured = process.env.WHISPER_CPP_VAD_MODEL
    || process.env.AUDIO_TOOLS_WHISPER_VAD_MODEL;
  if (configured) {
    return path.basename(configured) === filename
      && isAccessibleFile(configured, constants.R_OK)
      ? configured
      : null;
  }
  const candidates = [
    homeModelPath(filename),
    path.join('/opt/homebrew/share/whisper-cpp/models', filename),
    path.join('/usr/local/share/whisper-cpp/models', filename)
  ].filter((candidate) => candidate && path.basename(candidate) === filename);
  return candidates.find((candidate) => isAccessibleFile(candidate, constants.R_OK)) || null;
}

export function resolveWhisperCppDtwModel(model) {
  const logicalName = assertLogicalModelId(model)
    .replace(/^large-v([123])$/, 'large.v$1')
    .replace(/^large-v3-turbo$/, 'large.v3.turbo');
  const supported = new Set([
    'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en',
    'medium', 'medium.en', 'large.v1', 'large.v2', 'large.v3', 'large.v3.turbo'
  ]);
  if (!supported.has(logicalName)) {
    throw new Error(`Word timestamps require a supported whisper.cpp DTW model; received ${model}`);
  }
  return logicalName;
}
