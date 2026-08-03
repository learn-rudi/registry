import { artifactPath, loadProject, readJson, writeJson } from '../lib/files.js';

const STYLES = new Set(['modern', 'classic', 'minimal', 'cinematic']);
const POSITIONS = new Set(['bottom-left', 'bottom', 'bottom-right']);

function normalizeNumber(rawValue, fallback, label, validator) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || !validator(value)) {
    throw new Error(`Invalid ${label}: ${rawValue}`);
  }
  return value;
}

function normalizeString(rawValue, fallback, label) {
  const value = String(rawValue || fallback).trim();
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function normalizeOptionalString(rawValue, fallback) {
  return String(rawValue ?? fallback).trim();
}

function normalizeOptionalNumber(rawValue, label, validator) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return undefined;
  }

  return normalizeNumber(rawValue, undefined, label, validator);
}

export function buildLowerThird(options = {}) {
  const title = normalizeString(options.title, null, 'Lower-third title');
  const subtitle = normalizeOptionalString(options.subtitle, '');
  const style = normalizeString(options.style, 'modern', 'Lower-third style');
  const position = normalizeString(options.position, 'bottom-left', 'Lower-third position');
  const offsetY = normalizeOptionalNumber(options.offsetY, 'lower-third vertical offset', (value) => value >= 0);

  if (!STYLES.has(style)) {
    throw new Error(`Unknown lower-third style: ${style}`);
  }
  if (!POSITIONS.has(position)) {
    throw new Error(`Unknown lower-third position: ${position}`);
  }

  return {
    title,
    subtitle,
    at: normalizeNumber(options.at, 0, 'lower-third start time', (value) => value >= 0),
    duration: normalizeNumber(options.duration, 5, 'lower-third duration', (value) => value > 0),
    style,
    position,
    ...(offsetY === undefined ? {} : { offsetY })
  };
}

export async function addLowerThirdRun(runDir, options = {}) {
  const { project } = await loadProject(runDir);
  const compositionPath = artifactPath(runDir, project, 'composition');
  const composition = await readJson(compositionPath);
  const lowerThird = buildLowerThird(options);

  const timeline = composition.timeline || {};
  const lowerThirds = Array.isArray(timeline.lowerThirds) ? timeline.lowerThirds : [];
  const nextComposition = {
    ...composition,
    timeline: {
      ...timeline,
      lowerThirds: [
        ...lowerThirds,
        lowerThird
      ]
    }
  };

  await writeJson(compositionPath, nextComposition);

  return {
    outputPath: compositionPath,
    lowerThird,
    lowerThirdCount: nextComposition.timeline.lowerThirds.length
  };
}
