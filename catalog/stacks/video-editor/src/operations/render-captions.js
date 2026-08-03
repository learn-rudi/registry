import fs from 'fs/promises';
import path from 'path';
import {
  artifactPath,
  loadProject,
  pathExists,
  readJson
} from '../lib/files.js';
import { runCommand } from '../lib/process.js';
import { auditCutsRun } from './cut-audit.js';
import { transcribeRun } from './transcribe.js';
import { advanceRunState, RunState } from '../lib/states.js';
import { roundTime } from '../lib/format.js';
import { summarizeProbe } from '../lib/probe.js';

function normalizeMp4Name(name, fallback) {
  const outputName = name || fallback;
  if (path.basename(outputName) !== outputName) {
    throw new Error('Render name must be a file name, not a path');
  }
  if (!outputName.toLowerCase().endsWith('.mp4')) {
    throw new Error('Render name must end with .mp4');
  }
  return outputName;
}

function formatAssTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const totalCentiseconds = Math.round(safeSeconds * 100);
  const centiseconds = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

async function probeMedia(mediaPath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    mediaPath
  ], { capture: true });
  return JSON.parse(stdout);
}

function numberInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function resolveMarginPx({ dimension, defaultRatio, ratio, px }) {
  if (Number.isFinite(px) && px >= 0) {
    return Math.round(px);
  }

  if (numberInRange(ratio, 0, 0.4)) {
    return Math.round(dimension * ratio);
  }

  return Math.round(dimension * defaultRatio);
}

export function buildAssDocument(captions, dimensions, placement = {}) {
  const width = dimensions.width || 1080;
  const height = dimensions.height || 1920;
  const isVertical = height > width;
  const fontSize = Math.round(height * (isVertical ? 0.028 : 0.041));
  const marginL = resolveMarginPx({
    dimension: width,
    defaultRatio: 0.07,
    ratio: placement.marginHorizontalRatio,
    px: placement.marginHorizontalPx
  });
  const marginR = marginL;
  const marginV = resolveMarginPx({
    dimension: height,
    defaultRatio: isVertical ? 0.099 : 0.12,
    ratio: placement.marginBottomRatio,
    px: placement.marginBottomPx
  });

  const events = (captions.cues || [])
    .map((cue) => {
      const start = formatAssTime(cue.at);
      const end = formatAssTime(cue.at + cue.duration);
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${escapeAssText(cue.text)}`;
    })
    .join('\n');

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},&H00F7FBFB,&H00F7FBFB,&H00000000,&H88000000,-1,0,0,0,100,100,0,0,1,5,2,2,${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

async function maybeRefreshTranscriptEvidence(runDir, project, outputName) {
  if (project.settings.transcription?.autoTranscribeRenders === false) {
    return false;
  }

  await transcribeRun(runDir, 'output', { renderName: outputName });
  await auditCutsRun(runDir);
  return true;
}

export async function renderCaptionsRun(runDir, inputNameArg, outputNameArg) {
  const { project } = await loadProject(runDir);
  const inputName = normalizeMp4Name(inputNameArg, 'rough-v1.mp4');
  const outputName = normalizeMp4Name(outputNameArg, inputName.replace(/\.mp4$/i, '-captions.mp4'));
  const rendersDir = artifactPath(runDir, project, 'renders');
  const inputPath = path.join(rendersDir, inputName);
  const outputPath = path.join(rendersDir, outputName);
  const captionsPath = artifactPath(runDir, project, 'captions');

  if (!(await pathExists(inputPath))) {
    throw new Error(`Input render not found: ${inputPath}`);
  }
  if (!(await pathExists(captionsPath))) {
    throw new Error('Captions artifact is required before render-captions. Run `captions` first.');
  }

  const captions = await readJson(captionsPath);
  const compositionPath = artifactPath(runDir, project, 'composition');
  const composition = await pathExists(compositionPath)
    ? await readJson(compositionPath)
    : null;
  const placement = composition?.timeline?.captions?.placement || {};
  const probe = await probeMedia(inputPath);
  const summary = summarizeProbe(probe);
  if (!summary.video?.width || !summary.video?.height) {
    throw new Error(`Could not determine video dimensions for ${inputPath}`);
  }

  const assPath = path.join(runDir, 'captions.ass');
  await fs.writeFile(
    assPath,
    buildAssDocument(captions, summary.video, placement),
    'utf8'
  );

  await runCommand('ffmpeg', [
    '-hide_banner',
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', `subtitles='${escapeFilterPath(assPath)}'`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outputPath
  ]);

  const evidenceRefreshed = await maybeRefreshTranscriptEvidence(runDir, project, outputName);
  await advanceRunState(runDir, RunState.RENDERED);

  return {
    outputPath,
    assPath,
    renderer: 'ffmpeg-subtitles',
    inputName,
    outputName,
    cueCount: captions.stats?.cueCount || captions.cues?.length || 0,
    duration: summary.duration ? roundTime(summary.duration) : null,
    evidenceRefreshed
  };
}
