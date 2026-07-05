import fs from 'fs/promises';
import path from 'path';
import { loadProject, writeProject } from '../lib/files.js';
import { auditCutsRun } from './cut-audit.js';
import { initRun } from './init.js';
import { normalizeRun } from './normalize.js';
import { planCompositionRun } from './plan.js';
import { probeRun } from './probe.js';
import { renderRoughRun } from './render-rough.js';
import { detectSilenceRun } from './silence.js';
import { applySilenceOptions } from './silence-options.js';

async function disableRenderTranscription(runDir) {
  const { project, projectPath } = await loadProject(runDir);
  const nextProject = {
    ...project,
    settings: {
      ...project.settings,
      transcription: {
        ...project.settings.transcription,
        autoTranscribeRenders: false
      }
    }
  };
  await writeProject(projectPath, nextProject);
}

async function updateSilenceSettings(runDir, options) {
  const { project, projectPath } = await loadProject(runDir);
  const nextProject = {
    ...project,
    settings: {
      ...project.settings,
      silence: applySilenceOptions(project.settings.silence, options)
    }
  };
  await writeProject(projectPath, nextProject);
  return nextProject.settings.silence;
}

function outputPathForSource(sourceVideo, outputDir) {
  const sourceName = path.basename(sourceVideo, path.extname(sourceVideo));
  return path.join(outputDir, `${sourceName}-silence-cut.mp4`);
}

export async function cutSilence(sourceVideo, options = {}) {
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : null;
  const renderName = outputPath ? path.basename(outputPath) : 'silence-cut.mp4';
  const init = await initRun(sourceVideo, options.slug);
  const { runDir } = init;

  const silenceSettings = await updateSilenceSettings(runDir, options);
  await disableRenderTranscription(runDir);
  await probeRun(runDir);
  await normalizeRun(runDir);
  await detectSilenceRun(runDir);
  await auditCutsRun(runDir);
  await planCompositionRun(runDir);

  const render = await renderRoughRun(runDir, renderName);
  if (outputPath && path.resolve(render.outputPath) !== outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.copyFile(render.outputPath, outputPath);
  }

  return {
    runDir,
    outputPath: outputPath || render.outputPath,
    renderPath: render.outputPath,
    keepRangeCount: render.keepRangeCount,
    timelineDuration: render.timelineDuration,
    silenceSettings,
    intake: init.intake
  };
}

export async function cutSilenceBatch(sourceVideos, outputDir, options = {}) {
  if (!Array.isArray(sourceVideos) || sourceVideos.length === 0) {
    throw new Error('Batch silence cutting requires at least one source video');
  }

  const resolvedOutputDir = path.resolve(outputDir || 'silence-cuts');
  await fs.mkdir(resolvedOutputDir, { recursive: true });

  const results = [];
  for (const sourceVideo of sourceVideos) {
    const outputPath = outputPathForSource(sourceVideo, resolvedOutputDir);
    try {
      const result = await cutSilence(sourceVideo, {
        ...options,
        outputPath
      });
      results.push({
        sourceVideo,
        success: true,
        outputPath: result.outputPath,
        runDir: result.runDir,
        keepRangeCount: result.keepRangeCount,
        timelineDuration: result.timelineDuration
      });
    } catch (error) {
      results.push({
        sourceVideo,
        success: false,
        error: error.message
      });
    }
  }

  return {
    outputDir: resolvedOutputDir,
    total: results.length,
    successful: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    results
  };
}
