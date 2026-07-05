import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {spawn} from 'child_process';
import {fileURLToPath} from 'url';

const composerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicMediaRoot = path.join(composerRoot, 'public', 'media');

const DEFAULT_RENDER_CONCURRENCY = 1;
const MAX_RENDER_CONCURRENCY = 3;
const LARGE_MEDIA_BYTES = 150 * 1024 * 1024;
const VERY_LARGE_MEDIA_BYTES = 500 * 1024 * 1024;

const runArg = process.argv[2];
const outputName = process.argv[3] || 'rough-v1.mp4';

if (!runArg) {
  console.error('Usage: npm run render -- <run-slug-or-path> [output-name.mp4]');
  process.exit(1);
}

function envPath(name) {
  const value = process.env[name];
  return value && value.trim() ? path.resolve(value) : null;
}

function resolveRudiHome() {
  const configuredHome = envPath('RUDI_HOME');
  if (configuredHome) {
    return configuredHome;
  }

  const homeDir = os.homedir();
  if (!homeDir) {
    throw new Error('Unable to resolve RUDI home: HOME is not set');
  }

  return path.join(homeDir, '.rudi');
}

const stateRoot = envPath('RUDI_VIDEO_EDITOR_STATE_DIR') ||
  path.join(resolveRudiHome(), 'state', 'stacks', 'video-editor');
const runsRoot = path.join(stateRoot, 'runs');

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), {recursive: true});
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function resolveRunMediaPath(runDir, mediaFile) {
  return path.isAbsolute(mediaFile) ? mediaFile : path.join(runDir, mediaFile);
}

async function resolveRunDir(arg) {
  const direct = path.resolve(arg);
  if (await pathExists(direct)) {
    return direct;
  }

  const bySlug = path.join(runsRoot, arg);
  if (await pathExists(bySlug)) {
    return bySlug;
  }

  throw new Error(`Run not found: ${arg}`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: composerRoot,
      stdio: 'inherit'
    });

    child.on('error', (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: composerRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`${command} failed to start: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${stderr}`));
    });
  });
}

function parseRate(rate) {
  if (!rate || rate === '0/0') return null;
  const [num, den] = rate.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return num / den;
}

function summarizeProbe(probe) {
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number.parseFloat(probe.format?.duration || video?.duration || '0');

  return {
    duration,
    video: video ? {
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      rFrameRate: parseRate(video.r_frame_rate),
      avgFrameRate: parseRate(video.avg_frame_rate),
      frames: video.nb_frames ? Number.parseInt(video.nb_frames, 10) : null,
      startTime: Number.parseFloat(video.start_time || '0')
    } : null,
    audio: audio ? {
      codec: audio.codec_name,
      sampleRate: audio.sample_rate ? Number.parseInt(audio.sample_rate, 10) : null,
      channels: audio.channels || null,
      startTime: Number.parseFloat(audio.start_time || '0')
    } : null
  };
}

async function probeMedia(mediaPath) {
  const {stdout} = await runCommandCapture('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    mediaPath
  ]);
  return JSON.parse(stdout);
}

async function ensurePublicMediaLink(runDir, slug, mediaFile) {
  const target = resolveRunMediaPath(runDir, mediaFile);
  if (!(await pathExists(target))) {
    throw new Error(`Composition media not found: ${target}`);
  }

  await prunePublicMediaCache(slug);

  const mediaDir = path.join(composerRoot, 'public', 'media', slug);
  const publicName = path.basename(mediaFile);
  const publicPath = path.join(mediaDir, publicName);

  await fs.mkdir(mediaDir, {recursive: true});

  if (await pathExists(publicPath)) {
    await fs.unlink(publicPath);
  }

  try {
    await fs.link(target, publicPath);
  } catch (error) {
    if (error.code !== 'EXDEV' && error.code !== 'EPERM') {
      throw error;
    }
    await fs.copyFile(target, publicPath);
  }

  return `media/${slug}/${publicName}`;
}

async function prunePublicMediaCache(activeSlug) {
  if (process.env.RUDI_VIDEO_RENDER_PRUNE_PUBLIC_MEDIA === '0') {
    return;
  }

  if (!(await pathExists(publicMediaRoot))) {
    return;
  }

  const entries = await fs.readdir(publicMediaRoot, {withFileTypes: true});
  const removed = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === activeSlug) {
      continue;
    }

    await fs.rm(path.join(publicMediaRoot, entry.name), {
      recursive: true,
      force: true
    });
    removed.push(entry.name);
  }

  if (removed.length > 0) {
    console.log(`Pruned stale public media cache: ${removed.join(', ')}`);
  }
}

function getOutputPath(runDir, project, name) {
  const rendersDir = path.join(runDir, project.artifacts.renders);
  return path.join(rendersDir, name);
}

async function getBrowserArgs() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return ['--browser-executable', candidate];
    }
  }

  return [];
}

function normalizeConcurrency(value) {
  const parsed = Number.parseInt(String(value ?? DEFAULT_RENDER_CONCURRENCY), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_RENDER_CONCURRENCY;
  }
  return parsed;
}

async function getConcurrencyArgs(project, sourceMediaPath) {
  const requested = normalizeConcurrency(project.settings.render?.concurrency);
  let effective = Math.min(requested, MAX_RENDER_CONCURRENCY);
  let reason = effective !== requested ? `max ${MAX_RENDER_CONCURRENCY}` : null;

  try {
    const {size} = await fs.stat(sourceMediaPath);
    if (size >= VERY_LARGE_MEDIA_BYTES && effective > 1) {
      effective = 1;
      reason = `very large media (${formatMegabytes(size)})`;
    } else if (size >= LARGE_MEDIA_BYTES && effective > 2) {
      effective = 2;
      reason = `large media (${formatMegabytes(size)})`;
    }
  } catch {
    // If stat fails, keep the global cap rather than blocking the render.
  }

  if (effective !== requested) {
    console.log(`Render concurrency reduced from ${requested} to ${effective} (${reason}).`);
  }

  return ['--concurrency', String(effective)];
}

async function runVideoAgent(args) {
  const cliPath = path.join(videoAgentRoot, 'src', 'cli.js');
  await runCommand(process.execPath, [cliPath, ...args]);
}

async function ensureSilenceArtifact(runDir, project) {
  const silenceArtifact = project.artifacts.silence;
  if (!silenceArtifact) {
    return;
  }

  const silencePath = path.join(runDir, silenceArtifact);
  if (await pathExists(silencePath)) {
    return;
  }

  console.log(`Missing ${silenceArtifact}; running silence before cut-audit.`);
  await runVideoAgent(['silence', runDir]);
}

async function main() {
  const runDir = await resolveRunDir(runArg);
  const project = await readJson(path.join(runDir, 'project.json'));
  const composition = await readJson(path.join(runDir, project.artifacts.composition));
  const sourceProbe = await readJson(path.join(runDir, project.artifacts.probe));
  const sourceMediaFile = composition.source?.path || project.artifacts.working;
  const sourceMediaPath = resolveRunMediaPath(runDir, sourceMediaFile);
  const workingProbe = await probeMedia(sourceMediaPath);

  const sourceStaticFile = await ensurePublicMediaLink(
    runDir,
    project.slug,
    sourceMediaFile
  );

  const renderProps = {
    project,
    composition,
    probeSummary: summarizeProbe(workingProbe) || sourceProbe.summary,
    sourceStaticFile
  };

  const propsPath = path.join(runDir, 'render-props.json');
  const outputPath = getOutputPath(runDir, project, outputName);
  await fs.mkdir(path.dirname(outputPath), {recursive: true});
  await writeJson(propsPath, renderProps);

  const remotionBin = path.join(composerRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'remotion.cmd' : 'remotion');
  const command = await pathExists(remotionBin) ? remotionBin : 'remotion';

  const browserArgs = await getBrowserArgs();
  const concurrencyArgs = await getConcurrencyArgs(project, sourceMediaPath);

  await runCommand(command, [
    'render',
    'src/index.jsx',
    'VideoAgent',
    outputPath,
    '--props',
    propsPath,
    '--codec',
    'h264',
    '--crf',
    '18',
    '--x264-preset',
    'fast',
    '--pixel-format',
    'yuv420p',
    ...concurrencyArgs,
    ...browserArgs,
    '--overwrite'
  ]);

  if (project.settings.transcription?.autoTranscribeRenders !== false) {
    await runVideoAgent(['transcribe', runDir, 'source']);
    await runVideoAgent(['transcribe', runDir, 'output', outputName]);
    await ensureSilenceArtifact(runDir, project);
    await runVideoAgent(['cut-audit', runDir]);
  }

  console.log(`Rendered ${outputPath}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
