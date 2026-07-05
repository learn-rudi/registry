import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  loadProject,
  makeSlug,
  pathExists,
  readJson,
  runsRoot,
  writeJson,
  writeProject
} from '../lib/files.js';
import { applySilenceOptions } from './silence-options.js';
import { auditCutsRun } from './cut-audit.js';
import { initRun } from './init.js';
import { normalizeRun } from './normalize.js';
import { planCompositionRun } from './plan.js';
import { qaRun } from './qa.js';
import { renderRoughRun } from './render-rough.js';
import { reviewRun } from './review.js';
import { detectSilenceRun } from './silence.js';

export const VIDEO_EXTENSIONS = new Set([
  '.mov',
  '.mp4',
  '.m4v',
  '.avi',
  '.mkv',
  '.webm'
]);

const INCOMPLETE_SUFFIXES = [
  '.crdownload',
  '.download',
  '.part',
  '.partial',
  '.tmp'
];
const DEFAULT_SILENCE_DURATION_SECONDS = 1.5;
const DEFAULT_STABLE_SECONDS = 10;
const DEFAULT_POLL_SECONDS = 5;
const DEFAULT_RENDER_NAME = 'rough-v1.mp4';
const DEFAULT_STATE_FILE = 'downloads-intake-state.json';

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseNumber(value, label, validator) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !validator(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parseRenderName(value) {
  const name = value || DEFAULT_RENDER_NAME;
  if (path.basename(name) !== name || !name.toLowerCase().endsWith('.mp4')) {
    throw new Error('Render output name must be an .mp4 file name');
  }
  return name;
}

function defaultDownloadsDir() {
  return path.join(os.homedir(), 'Downloads');
}

function defaultArchiveDir(sourcePath, rawArchiveDir) {
  if (rawArchiveDir) {
    return path.resolve(rawArchiveDir);
  }
  const parentDir = sourcePath ? path.dirname(path.resolve(sourcePath)) : defaultDownloadsDir();
  return path.join(parentDir, 'rudi-video-intake', 'processed');
}

function stateKeyFor(filePath, stats) {
  return [
    path.resolve(filePath),
    stats.size,
    Math.trunc(stats.mtimeMs)
  ].join('|');
}

function sanitizeError(error) {
  return String(error?.message || error || 'Unknown error').split('\n').slice(0, 6).join('\n');
}

function summarizeSourceStats(stats) {
  return {
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

export function isCandidateVideoPath(filePath) {
  const baseName = path.basename(filePath);
  const lowerName = baseName.toLowerCase();
  if (!baseName || baseName.startsWith('.')) {
    return false;
  }
  if (INCOMPLETE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) {
    return false;
  }
  return VIDEO_EXTENSIONS.has(path.extname(lowerName));
}

export function isStableCandidate(previous, stats, options) {
  if (!previous || !stats) {
    return false;
  }
  const now = Number(options.now);
  const stableMs = Number(options.stableMs);
  if (!Number.isFinite(now) || !Number.isFinite(stableMs) || stableMs < 0) {
    throw new Error('Stable candidate check requires valid now and stableMs values');
  }
  return previous.size === stats.size &&
    previous.mtimeMs === stats.mtimeMs &&
    now - previous.stableSince >= stableMs;
}

export function buildArchivePath(sourcePath, options) {
  const extension = path.extname(sourcePath).toLowerCase() || '.mov';
  const archiveDir = path.resolve(options.archiveDir);
  const baseName = options.runSlug || path.basename(sourcePath, path.extname(sourcePath));
  return path.join(archiveDir, `${baseName}${extension}`);
}

export function normalizeFirstPassOptions(rawOptions = {}) {
  const silenceDuration = parseNumber(
    rawOptions.silenceDuration ?? rawOptions.minDuration,
    'silence duration',
    (value) => value > 0
  ) ?? DEFAULT_SILENCE_DURATION_SECONDS;
  const thresholdDb = parseNumber(
    rawOptions.thresholdDb,
    'silence threshold',
    (value) => value < 0 && value >= -100
  );
  const padding = parseNumber(
    rawOptions.padding,
    'silence padding',
    (value) => value >= 0
  );
  const minKeepDuration = parseNumber(
    rawOptions.minKeepDuration,
    'minimum keep duration',
    (value) => value >= 0
  );
  const stableSeconds = parseNumber(
    rawOptions.stableSeconds,
    'stable seconds',
    (value) => value >= 0
  ) ?? DEFAULT_STABLE_SECONDS;
  const pollSeconds = parseNumber(
    rawOptions.pollSeconds,
    'poll seconds',
    (value) => value > 0
  ) ?? DEFAULT_POLL_SECONDS;
  const staleJobSeconds = parseNumber(
    rawOptions.staleJobSeconds,
    'stale job seconds',
    (value) => value > 0
  ) ?? 6 * 60 * 60;
  const silence = {
    minDuration: silenceDuration
  };

  if (thresholdDb !== null) silence.thresholdDb = thresholdDb;
  if (padding !== null) silence.padding = padding;
  if (minKeepDuration !== null) silence.minKeepDuration = minKeepDuration;

  return {
    silence,
    renderName: parseRenderName(rawOptions.renderName || rawOptions.outputName),
    slug: rawOptions.slug || null,
    mode: rawOptions.force ? 'force' : 'create',
    archiveDir: rawOptions.archiveDir ? path.resolve(rawOptions.archiveDir) : null,
    moveSource: parseBoolean(rawOptions.moveSource, false),
    transcribe: parseBoolean(rawOptions.transcribe, false),
    once: parseBoolean(rawOptions.once, false),
    retryFailed: parseBoolean(rawOptions.retryFailed, false),
    dryRun: parseBoolean(rawOptions.dryRun, false),
    stableMs: Math.round(stableSeconds * 1000),
    pollMs: Math.round(pollSeconds * 1000),
    staleJobMs: Math.round(staleJobSeconds * 1000)
  };
}

async function uniqueRunSlug(sourcePath, explicitSlug, mode = 'create') {
  const baseSlug = makeSlug(explicitSlug || sourcePath);
  if (explicitSlug && mode === 'force') {
    return baseSlug;
  }
  if (!(await pathExists(path.join(runsRoot, baseSlug)))) {
    return baseSlug;
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);
  const timestamped = `${baseSlug}-${timestamp}`;
  if (!(await pathExists(path.join(runsRoot, timestamped)))) {
    return timestamped;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${timestamped}-${index}`;
    if (!(await pathExists(path.join(runsRoot, candidate)))) {
      return candidate;
    }
  }
  throw new Error(`Unable to find a unique run slug for ${baseSlug}`);
}

async function writeIntakeStatus(runDir, status) {
  await writeJson(path.join(runDir, 'intake.json'), {
    schemaVersion: 1,
    ...status,
    updatedAt: new Date().toISOString()
  });
}

async function updateFirstPassProject(runDir, options) {
  const { project, projectPath } = await loadProject(runDir);
  const nextProject = {
    ...project,
    settings: {
      ...project.settings,
      silence: applySilenceOptions(project.settings.silence, options.silence),
      transcription: {
        ...project.settings.transcription,
        autoTranscribeRenders: options.transcribe
      }
    }
  };
  await writeProject(projectPath, nextProject);
  return nextProject;
}

async function uniquePath(candidatePath) {
  if (!(await pathExists(candidatePath))) {
    return candidatePath;
  }

  const dir = path.dirname(candidatePath);
  const extension = path.extname(candidatePath);
  const stem = path.basename(candidatePath, extension);
  for (let index = 2; index < 1000; index += 1) {
    const nextPath = path.join(dir, `${stem}-${index}${extension}`);
    if (!(await pathExists(nextPath))) {
      return nextPath;
    }
  }
  throw new Error(`Unable to find a unique archive path for ${candidatePath}`);
}

async function moveFile(sourcePath, destinationPath) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    await fs.copyFile(sourcePath, destinationPath);
    await fs.rm(sourcePath);
  }
}

async function archiveSource(sourcePath, project, options) {
  const archiveDir = defaultArchiveDir(sourcePath, options.archiveDir);
  const candidatePath = buildArchivePath(sourcePath, {
    archiveDir,
    runSlug: project.slug
  });
  const archivePath = await uniquePath(candidatePath);
  await moveFile(sourcePath, archivePath);
  return archivePath;
}

async function archiveSourceAfterInit(sourcePath, project, options, initIntake) {
  if (!options.moveSource) {
    return null;
  }

  if (initIntake?.movedFromDownloads) {
    return initIntake.sourcePath;
  }

  if (!(await pathExists(sourcePath))) {
    return null;
  }

  return archiveSource(sourcePath, project, options);
}

export async function processFirstPass(sourcePathArg, rawOptions = {}) {
  if (!sourcePathArg) {
    throw new Error('First-pass processing requires a source video path');
  }

  const sourcePath = path.resolve(sourcePathArg);
  if (!isCandidateVideoPath(sourcePath)) {
    throw new Error(`Unsupported source video file: ${sourcePath}`);
  }

  const sourceStats = await fs.stat(sourcePath);
  if (!sourceStats.isFile()) {
    throw new Error(`Source video is not a file: ${sourcePath}`);
  }

  const options = normalizeFirstPassOptions(rawOptions);
  const runSlug = await uniqueRunSlug(sourcePath, options.slug, options.mode);
  const initResult = await initRun(sourcePath, runSlug, {
    mode: options.mode,
    moveDownloadsSource: options.moveSource
  });
  const runDir = initResult.runDir;
  const project = await updateFirstPassProject(runDir, options);
  await writeIntakeStatus(runDir, {
    status: 'running',
    sourcePath,
    source: summarizeSourceStats(sourceStats),
    silence: project.settings.silence,
    renderName: options.renderName
  });

  try {
    await normalizeRun(runDir);
    const silenceResult = await detectSilenceRun(runDir);
    const auditResult = await auditCutsRun(runDir);
    const planResult = await planCompositionRun(runDir);
    const renderResult = await renderRoughRun(runDir, options.renderName);
    const qaResult = await qaRun(runDir, options.renderName);
    const reviewResult = await reviewRun(runDir, options.renderName);
    const archivedSourcePath = await archiveSourceAfterInit(
      sourcePath,
      project,
      options,
      initResult.intake
    );
    const summary = {
      runSlug: project.slug,
      runDir,
      sourcePath,
      archivedSourcePath,
      intake: initResult.intake || null,
      renderPath: renderResult.outputPath,
      qaReportPath: qaResult.reportPath,
      reviewPath: reviewResult.markdownPath,
      silence: {
        settings: project.settings.silence,
        stats: silenceResult.analysis.stats
      },
      audit: auditResult.audit.summary,
      plan: {
        source: planResult.source,
        keepRangeCount: planResult.keepRangeCount,
        timelineDuration: planResult.timelineDuration
      },
      review: {
        overallRisk: reviewResult.review.overallRisk,
        findingCount: reviewResult.review.findings.length,
        nextStep: reviewResult.review.nextStep
      }
    };

    await writeIntakeStatus(runDir, {
      status: 'succeeded',
      sourcePath,
      archivedSourcePath,
      renderName: options.renderName,
      summary
    });
    return summary;
  } catch (error) {
    await writeIntakeStatus(runDir, {
      status: 'failed',
      sourcePath,
      renderName: options.renderName,
      error: sanitizeError(error)
    }).catch(() => {});
    throw error;
  }
}

async function loadState(statePath) {
  if (!(await pathExists(statePath))) {
    return {
      schemaVersion: 1,
      jobs: {}
    };
  }
  const state = await readJson(statePath);
  return {
    schemaVersion: 1,
    jobs: state.jobs && typeof state.jobs === 'object' ? state.jobs : {}
  };
}

async function saveState(statePath, state) {
  await writeJson(statePath, {
    ...state,
    updatedAt: new Date().toISOString()
  });
}

function shouldSkipJob(job, options, now) {
  if (!job) {
    return false;
  }
  if (job.status === 'succeeded') {
    return true;
  }
  if (job.status === 'failed' && !options.retryFailed) {
    return true;
  }
  if (job.status !== 'running') {
    return false;
  }

  const updatedAt = Date.parse(job.updatedAt || job.startedAt || '');
  return Number.isFinite(updatedAt) && now - updatedAt < options.staleJobMs;
}

async function listCandidateFiles(watchDir) {
  const entries = await fs.readdir(watchDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(watchDir, entry.name))
    .filter(isCandidateVideoPath)
    .sort();
}

function updateSnapshot(previous, stats, now) {
  if (!previous || previous.size !== stats.size || previous.mtimeMs !== stats.mtimeMs) {
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      firstSeenAt: previous?.firstSeenAt || now,
      stableSince: now
    };
  }
  return previous;
}

async function scanDownloadsOnce(context) {
  const { watchDir, state, statePath, snapshots, options, emit } = context;
  const now = Date.now();
  const candidateFiles = await listCandidateFiles(watchDir);
  const processed = [];
  const skipped = [];

  for (const filePath of candidateFiles) {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      continue;
    }

    const previous = snapshots.get(filePath);
    const nextSnapshot = updateSnapshot(previous, stats, now);
    snapshots.set(filePath, nextSnapshot);

    if (!isStableCandidate(nextSnapshot, stats, { now, stableMs: options.stableMs })) {
      skipped.push({ filePath, reason: 'waiting-for-stable-file' });
      continue;
    }

    const key = stateKeyFor(filePath, stats);
    if (shouldSkipJob(state.jobs[key], options, now)) {
      skipped.push({ filePath, reason: `job-${state.jobs[key].status}` });
      continue;
    }

    if (options.dryRun) {
      processed.push({ filePath, dryRun: true });
      continue;
    }

    const startedAt = new Date().toISOString();
    state.jobs[key] = {
      status: 'running',
      sourcePath: filePath,
      source: summarizeSourceStats(stats),
      startedAt,
      updatedAt: startedAt
    };
    await saveState(statePath, state);
    emit({ type: 'started', sourcePath: filePath });

    try {
      const result = await processFirstPass(filePath, options);
      const finishedAt = new Date().toISOString();
      state.jobs[key] = {
        ...state.jobs[key],
        status: 'succeeded',
        runSlug: result.runSlug,
        runDir: result.runDir,
        renderPath: result.renderPath,
        reviewPath: result.reviewPath,
        archivedSourcePath: result.archivedSourcePath,
        finishedAt,
        updatedAt: finishedAt
      };
      await saveState(statePath, state);
      snapshots.delete(filePath);
      processed.push(result);
      emit({ type: 'succeeded', sourcePath: filePath, result });
    } catch (error) {
      const failedAt = new Date().toISOString();
      state.jobs[key] = {
        ...state.jobs[key],
        status: 'failed',
        error: sanitizeError(error),
        failedAt,
        updatedAt: failedAt
      };
      await saveState(statePath, state);
      skipped.push({ filePath, reason: 'processing-failed', error: sanitizeError(error) });
      emit({ type: 'failed', sourcePath: filePath, error: sanitizeError(error) });
    }
  }

  return {
    candidateCount: candidateFiles.length,
    processed,
    skipped
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function watchDownloads(rawOptions = {}) {
  const options = normalizeFirstPassOptions(rawOptions);
  const watchDir = path.resolve(rawOptions.watchDir || rawOptions.downloadsDir || defaultDownloadsDir());
  const statePath = path.resolve(rawOptions.statePath || path.join(runsRoot, DEFAULT_STATE_FILE));
  const emit = typeof rawOptions.onEvent === 'function' ? rawOptions.onEvent : () => {};

  if (!(await pathExists(watchDir))) {
    throw new Error(`Downloads directory not found: ${watchDir}`);
  }

  const state = await loadState(statePath);
  const snapshots = new Map();
  const startedAt = new Date().toISOString();
  emit({
    type: 'watching',
    watchDir,
    statePath,
    startedAt,
    stableMs: options.stableMs,
    pollMs: options.pollMs
  });

  do {
    const scan = await scanDownloadsOnce({
      watchDir,
      state,
      statePath,
      snapshots,
      options,
      emit
    });

    if (options.once) {
      return {
        watchDir,
        statePath,
        ...scan
      };
    }

    await sleep(options.pollMs);
  } while (true);
}
