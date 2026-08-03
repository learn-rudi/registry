#!/usr/bin/env node

import path from 'path';
import { resolveRunDir } from './lib/files.js';
import { captionsRun } from './operations/captions.js';
import {
  concatenateVideos,
  createTopicClips,
  createTranscriptClips,
  extractAudio,
  getVideoInfo,
  trimVideo
} from './operations/clips.js';
import { auditCutsRun } from './operations/cut-audit.js';
import { cutSilence, cutSilenceBatch } from './operations/cut-silence.js';
import { processFirstPass, watchDownloads } from './operations/download-intake.js';
import { clusterTranscriptRun } from './operations/cluster.js';
import { aboutRun } from './operations/about.js';
import { gradeRenderRun, gradeSourceRun, listGradePresets } from './operations/grade.js';
import { initRun } from './operations/init.js';
import { addLowerThirdRun } from './operations/lower-third.js';
import { normalizeRun } from './operations/normalize.js';
import { planCompositionRun } from './operations/plan.js';
import { probeRun } from './operations/probe.js';
import { qaRun } from './operations/qa.js';
import { renderCaptionsRun } from './operations/render-captions.js';
import { renderRoughRun } from './operations/render-rough.js';
import { reviewRun } from './operations/review.js';
import { chaptersRun } from './operations/chapters.js';
import { insightsRun } from './operations/insights.js';
import { overlayPlanRun } from './operations/overlay-plan.js';
import { applyOverlayPlanRun } from './operations/apply-overlay-plan.js';
import { applyOverlaysFromArg } from './operations/apply-overlays.js';
import { promoteRun } from './operations/promote.js';
import { narrateRun } from './operations/narrate.js';
import { narrateVisionRun } from './operations/narrate-vision.js';
import { detectSilenceRun } from './operations/silence.js';
import { listSilencePresets } from './operations/silence-options.js';
import { extractSlides } from './operations/slides.js';
import { transcribeRun } from './operations/transcribe.js';

function parseCommandArgs(rawArgs) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    const next = rawArgs[index + 1];
    if (next === undefined) {
      throw new Error(`Missing value for option: ${arg}`);
    }

    if (arg === '--preset' || arg === '-p') {
      options.preset = next;
    } else if (arg === '--threshold' || arg === '-t') {
      options.thresholdDb = next;
    } else if (arg === '--duration' || arg === '-d') {
      options.minDuration = next;
    } else if (arg === '--padding') {
      options.padding = next;
    } else if (arg === '--min-keep-duration') {
      options.minKeepDuration = next;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }

    index += 1;
  }

  return { positionals, options };
}

function parseInitArgs(rawArgs) {
  const positionals = [];
  const options = { mode: 'create' };

  for (const arg of rawArgs) {
    if (arg === '--refresh') {
      if (options.mode === 'force') {
        throw new Error('Use only one init mode: --refresh or --force');
      }
      options.mode = 'refresh';
      continue;
    }

    if (arg === '--force') {
      if (options.mode === 'refresh') {
        throw new Error('Use only one init mode: --refresh or --force');
      }
      options.mode = 'force';
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown init option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length > 2) {
    throw new Error('Usage: init <source-video> [run-slug] [--refresh|--force]');
  }

  return {
    sourceArg: positionals[0],
    slugArg: positionals[1],
    options
  };
}

function parsePromoteArgs(rawArgs) {
  const positionals = [];
  const options = {
    force: false,
    outputName: null
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--output-name') {
      const next = rawArgs[index + 1];
      if (!next) {
        throw new Error('Missing value for --output-name');
      }
      options.outputName = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown promote option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length !== 3) {
    throw new Error('Usage: promote <run> <render-name.mp4> <destination-dir> [--output-name name.mp4] [--force]');
  }

  return {
    runArg: positionals[0],
    renderName: positionals[1],
    destinationDir: positionals[2],
    options
  };
}

function parseDownloadIntakeArgs(rawArgs, command) {
  const positionals = [];
  const options = {};
  const optionNames = new Map([
    ['--silence-duration', 'silenceDuration'],
    ['--threshold', 'thresholdDb'],
    ['-t', 'thresholdDb'],
    ['--duration', 'silenceDuration'],
    ['-d', 'silenceDuration'],
    ['--padding', 'padding'],
    ['--min-keep-duration', 'minKeepDuration'],
    ['--output', 'renderName'],
    ['--render-name', 'renderName'],
    ['--slug', 'slug'],
    ['--archive-dir', 'archiveDir'],
    ['--stable-seconds', 'stableSeconds'],
    ['--poll-seconds', 'pollSeconds'],
    ['--state-path', 'statePath'],
    ['--stale-job-seconds', 'staleJobSeconds']
  ]);
  const flags = new Map([
    ['--force', ['force', true]],
    ['--move-source', ['moveSource', true]],
    ['--no-move-source', ['moveSource', false]],
    ['--transcribe', ['transcribe', true]],
    ['--no-transcribe', ['transcribe', false]],
    ['--once', ['once', true]],
    ['--retry-failed', ['retryFailed', true]],
    ['--dry-run', ['dryRun', true]]
  ]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    if (flags.has(arg)) {
      const [name, value] = flags.get(arg);
      options[name] = value;
      continue;
    }

    const name = optionNames.get(arg);
    if (!name) {
      throw new Error(`Unknown ${command} option: ${arg}`);
    }

    const next = rawArgs[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }
    options[name] = next;
    index += 1;
  }

  return { positionals, options };
}

function printHelp() {
  console.log(`
RUDI Video Editor Stack

Usage:
  node src/cli.js <command> [args]

Commands:
  info <video>                    Probe one video directly with ffprobe
  trim <video> <start> <end> <output>
                                  Trim a video by seconds
  audio <video> <output>          Extract audio from a video
  concat <output> <input...>      Concatenate videos
  clips <video> <transcript> <output-dir>
                                  Create clips from timestamped transcript segments
  topic-clips <video> <transcript> <keywords> <output-dir>
                                  Create clips for comma-separated transcript keywords
  slides <video> [output-dir] [interval-seconds]
                                  Extract presentation slide frames from a video
  cut-silence <source-video> [output.mp4] [run-slug] [options]
                                  One-shot silence cut using the run pipeline
  cut-silence-batch <output-dir> <video...> [options]
                                  Silence-cut multiple videos
  first-pass <source-video> [options]
                                  Fast rough intake; transcript safety is post-render evidence only
  watch-downloads [downloads-dir] [options]
                                  Poll a Downloads folder and first-pass each stable new video
  silence-presets                 List silence-cut presets
  lower-third <run> <title> [subtitle] [at] [duration] [style] [position] [offsetY]
                                  Add a Remotion lower-third overlay to a run
                                  styles: modern, classic, minimal, cinematic
  apply-overlays <request.json|json>
                                  Apply full-screen image overlays to an existing video

Pipeline commands:
  init <source-video> [run-slug] [--refresh|--force]
                                  Create, refresh, or replace a run folder
  probe <run>                     Save ffprobe metadata to probe.json
  normalize <run>                 Create working.mp4 with stable fps/audio
  transcribe <run> source [model]  Whisper source/working media to transcript-source.json
  transcribe <run> output <render> [model]
                                  Whisper rendered media to transcript-output.json
  cluster <run>                    Build transcript phrase clusters for planning
  silence <run>                   Detect silences and write silence.json
  cut-audit <run>                 Audit cut safety and write cut-audit.json
  plan <run>                      Copy silence keep ranges into composition.json
  render-rough <run> [output.mp4]  Render plain rough cut from composition with FFmpeg
  render-captions <run> <input.mp4> [output.mp4]
                                  Burn captions onto an existing rough render with FFmpeg
  grade-source <run> [preset] [output-media.mp4]
                                  Grade run working media and point composition at the graded source
  grade-render <run> <input.mp4> [output.mp4] [preset]
                                  Grade an existing render in the run renders directory
  grade-presets                   List available color grade presets
  captions <run>                  Generate caption cues from transcript clusters
  qa <run> [render-name]          Probe render and sample QA frames
  review <run> [render-name]      Write review.json and review.md from current artifacts
  promote <run> <render> <destination-dir> [--output-name name.mp4] [--force]
                                  Copy a render from the run into a delivery folder

Examples:
  node src/cli.js info video.mp4
  node src/cli.js trim video.mp4 60 120 trimmed.mp4
  node src/cli.js audio video.mp4 audio.mp3
  node src/cli.js clips video.mp4 transcript.txt ./clips
  node src/cli.js topic-clips video.mp4 transcript.txt "AI,education" ./topic-clips
  node src/cli.js slides webinar.mp4 ./slides 5
  node src/cli.js cut-silence video.mp4 edited.mp4 --preset aggressive
  node src/cli.js cut-silence-batch ./edited video-1.mp4 video-2.mp4 --threshold -28
  node src/cli.js first-pass ~/Downloads/take.mov --silence-duration 1.5
  node src/cli.js watch-downloads ~/Downloads --silence-duration 1.5 --stable-seconds 10
  node src/cli.js lower-third movie-2026-05-08-1229 "Jane Smith" "Founder" 12 5 cinematic bottom-left
  node src/cli.js apply-overlays ./overlay-request.json
  node src/cli.js init "/path/to/video.mov" movie-2026-05-08-1229
  node src/cli.js init movie-2026-05-08-1229 --refresh
  node src/cli.js probe movie-2026-05-08-1229
  node src/cli.js normalize movie-2026-05-08-1229
  node src/cli.js transcribe movie-2026-05-08-1229 source
  # Review transcript-source.json and write transcript-corrections.json if needed.
  node src/cli.js cluster movie-2026-05-08-1229
  node src/cli.js silence movie-2026-05-08-1229
  node src/cli.js cut-audit movie-2026-05-08-1229
  node src/cli.js plan movie-2026-05-08-1229
  node src/cli.js render-rough movie-2026-05-08-1229 rough-v1.mp4
  node src/cli.js transcribe movie-2026-05-08-1229 output rough-v1.mp4
  node src/cli.js cut-audit movie-2026-05-08-1229
  node src/cli.js qa movie-2026-05-08-1229 rough-v1.mp4
  node src/cli.js review movie-2026-05-08-1229 rough-v1.mp4
  node src/cli.js render-captions movie-2026-05-08-1229 rough-v1.mp4 rough-v1-captions.mp4
  node src/cli.js grade-source movie-2026-05-08-1229 talking-head
  node src/cli.js grade-render movie-2026-05-08-1229 rough-v1-captions.mp4 rough-v1-captions-graded.mp4 talking-head
  node src/cli.js captions movie-2026-05-08-1229
  node src/cli.js promote movie-2026-05-08-1229 rough-v1.mp4 /path/to/topic/videos/renders/drafts --output-name rough-v1.mp4
`);
}

async function requireRun(runArg) {
  return resolveRunDir(runArg);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'info') {
    const result = await getVideoInfo(args[0]);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'trim') {
    const startTime = Number.parseFloat(args[1]);
    const endTime = Number.parseFloat(args[2]);
    const outputPath = await trimVideo(args[0], startTime, endTime, args[3]);
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  if (command === 'audio') {
    const outputPath = await extractAudio(args[0], args[1]);
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  if (command === 'concat') {
    const outputPath = await concatenateVideos(args.slice(1), args[0]);
    console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
    return;
  }

  if (command === 'clips') {
    const result = await createTranscriptClips(args[0], args[1], args[2]);
    console.log(JSON.stringify({
      totalClips: result.totalClips,
      summaryFiles: result.summaryFiles
    }, null, 2));
    return;
  }

  if (command === 'topic-clips') {
    const keywords = String(args[2] || '')
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    const result = await createTopicClips(args[0], args[1], keywords, args[3]);
    console.log(JSON.stringify({
      totalClips: result.totalClips,
      keywords: result.keywords,
      summaryFiles: result.summaryFiles
    }, null, 2));
    return;
  }

  if (command === 'slides') {
    const result = await extractSlides(args[0], {
      outputDir: args[1],
      intervalSeconds: args[2]
    });
    console.log(JSON.stringify({
      outputDir: path.relative(process.cwd(), result.outputDir),
      intervalSeconds: result.intervalSeconds,
      fps: result.fps,
      width: result.width,
      extracted: result.extracted,
      kept: result.kept,
      removed: result.removed,
      dedupe: result.dedupe
    }, null, 2));
    return;
  }

  if (command === 'cut-silence') {
    const { positionals, options } = parseCommandArgs(args);
    const result = await cutSilence(positionals[0], {
      ...options,
      outputPath: positionals[1],
      slug: positionals[2]
    });
    console.log(JSON.stringify({
      runDir: path.relative(process.cwd(), result.runDir),
      outputPath: path.relative(process.cwd(), result.outputPath),
      keepRangeCount: result.keepRangeCount,
      timelineDuration: result.timelineDuration,
      silenceSettings: result.silenceSettings,
      intake: result.intake
    }, null, 2));
    return;
  }

  if (command === 'cut-silence-batch') {
    const { positionals, options } = parseCommandArgs(args);
    const result = await cutSilenceBatch(positionals.slice(1), positionals[0], options);
    console.log(JSON.stringify({
      outputDir: path.relative(process.cwd(), result.outputDir),
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      results: result.results.map((item) => ({
        ...item,
        outputPath: item.outputPath ? path.relative(process.cwd(), item.outputPath) : undefined,
        runDir: item.runDir ? path.relative(process.cwd(), item.runDir) : undefined
      }))
    }, null, 2));
    return;
  }

  if (command === 'first-pass') {
    const { positionals, options } = parseDownloadIntakeArgs(args, command);
    if (positionals.length !== 1) {
      throw new Error('Usage: first-pass <source-video> [--silence-duration seconds] [--no-move-source]');
    }

    const result = await processFirstPass(positionals[0], options);
    console.log(JSON.stringify({
      run: result.runSlug,
      runDir: path.relative(process.cwd(), result.runDir),
      renderPath: path.relative(process.cwd(), result.renderPath),
      reviewPath: path.relative(process.cwd(), result.reviewPath),
      archivedSourcePath: result.archivedSourcePath,
      silence: result.silence,
      plan: result.plan,
      review: result.review
    }, null, 2));
    return;
  }

  if (command === 'watch-downloads') {
    const { positionals, options } = parseDownloadIntakeArgs(args, command);
    if (positionals.length > 1) {
      throw new Error('Usage: watch-downloads [downloads-dir] [options]');
    }

    const result = await watchDownloads({
      ...options,
      watchDir: positionals[0],
      onEvent: (event) => {
        const printable = { ...event };
        if (printable.result) {
          printable.result = {
            run: event.result.runSlug,
            renderPath: path.relative(process.cwd(), event.result.renderPath),
            reviewPath: path.relative(process.cwd(), event.result.reviewPath),
            archivedSourcePath: event.result.archivedSourcePath
          };
        }
        console.log(JSON.stringify(printable));
      }
    });

    if (result) {
      console.log(JSON.stringify({
        watchDir: result.watchDir,
        statePath: path.relative(process.cwd(), result.statePath),
        candidateCount: result.candidateCount,
        processedCount: result.processed.length,
        skipped: result.skipped
      }, null, 2));
    }
    return;
  }

  if (command === 'silence-presets') {
    console.log(JSON.stringify(listSilencePresets(), null, 2));
    return;
  }

  if (command === 'grade-presets') {
    console.log(JSON.stringify(listGradePresets(), null, 2));
    return;
  }

  if (command === 'lower-third') {
    const runDir = await requireRun(args[0]);
    const result = await addLowerThirdRun(runDir, {
      title: args[1],
      subtitle: args[2] || '',
      at: args[3],
      duration: args[4],
      style: args[5],
      position: args[6],
      offsetY: args[7]
    });
    console.log(`Updated ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      lowerThird: result.lowerThird,
      lowerThirdCount: result.lowerThirdCount
    }, null, 2));
    return;
  }

  if (command === 'apply-overlays' || command === 'video_apply_overlays') {
    const result = await applyOverlaysFromArg(args[0]);
    console.log(JSON.stringify({
      outputPath: result.outputPath,
      duration: result.duration,
      format: result.format,
      width: result.width,
      height: result.height,
      overlayCount: result.overlayCount,
      overlays: result.overlays,
      ffmpegLog: result.ffmpegLog
    }, null, 2));
    return;
  }

  if (command === 'init') {
    const { sourceArg, slugArg, options } = parseInitArgs(args);
    const result = await initRun(sourceArg, slugArg, options);
    const rel = path.relative(process.cwd(), result.runDir);
    console.log(`Initialized run: ${rel}`);
    if (result.about?.technical) {
      const t = result.about.technical;
      const v = t.video;
      const fps = v?.fps ? `${v.fps.toFixed(0)}fps` : '';
      const dims = v ? `${v.width}×${v.height}` : '';
      const orient = v?.orientation ? ` (${v.orientation})` : '';
      const dur = `${Math.floor(t.duration / 60)}:${String(Math.floor(t.duration % 60)).padStart(2, '0')}`;
      console.log(`Probed: ${v?.codec || '?'} ${dims}${orient} ${fps}, ${dur}`);
      console.log(`Wrote ${path.relative(process.cwd(), result.about.aboutPath)}`);
    }
    if (result.intake?.movedFromDownloads) {
      console.log(`Moved Downloads source into ${path.relative(process.cwd(), result.intake.sourcePath)}`);
    }
    console.log(`\nnext:  node src/cli.js transcribe ${result.project.slug} source`);
    return;
  }

  if (command === 'about') {
    const runDir = await requireRun(args[0]);
    const result = await aboutRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.aboutPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), result.metaPath)}`);
    console.log(`Stage: ${result.stage}`);
    return;
  }

  if (command === 'probe') {
    const runDir = await requireRun(args[0]);
    const result = await probeRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify(result.summary, null, 2));
    return;
  }

  if (command === 'normalize') {
    const runDir = await requireRun(args[0]);
    const result = await normalizeRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    return;
  }

  if (command === 'transcribe') {
    const runDir = await requireRun(args[0]);
    const target = args[1] || 'source';
    const result = await transcribeRun(runDir, target, {
      renderName: target === 'output' ? args[2] : null,
      model: target === 'output' ? args[3] : args[2]
    });
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      kind: result.transcript.kind,
      media: result.transcript.media,
      model: result.transcript.model.model,
      duration: result.transcript.stats.duration,
      wordCount: result.transcript.stats.wordCount,
      wordsPerSecond: result.transcript.stats.wordsPerSecond
    }, null, 2));
    return;
  }

  if (command === 'cluster') {
    const runDir = await requireRun(args[0]);
    const result = await clusterTranscriptRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify(result.clusters.stats, null, 2));
    return;
  }

  if (command === 'silence') {
    const runDir = await requireRun(args[0]);
    const result = await detectSilenceRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify(result.analysis.stats, null, 2));
    return;
  }

  if (command === 'cut-audit') {
    const runDir = await requireRun(args[0]);
    const result = await auditCutsRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify(result.audit.summary, null, 2));
    return;
  }

  if (command === 'narrate') {
    const runDir = await requireRun(args[0]);
    const result = await narrateRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      labelCount: result.labelCount,
      labels: result.labels
    }, null, 2));
    return;
  }

  if (command === 'narrate-vision') {
    const runDir = await requireRun(args[0]);
    const result = await narrateVisionRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      labelCount: result.labelCount,
      labels: result.labels
    }, null, 2));
    return;
  }

  if (command === 'chapters') {
    const runDir = await requireRun(args[0]);
    const result = await chaptersRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      chapterCount: result.chapterCount,
      chapters: result.chapters
    }, null, 2));
    return;
  }

  if (command === 'insights') {
    const runDir = await requireRun(args[0]);
    const result = await insightsRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      insightCount: result.insightCount,
      insights: result.insights
    }, null, 2));
    return;
  }

  if (command === 'overlay-plan') {
    const runDir = await requireRun(args[0]);
    const result = await overlayPlanRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      sectionCount: result.sectionCount,
      statCardCount: result.statCardCount,
      detectedStats: result.detectedStats
    }, null, 2));
    console.log('\nNext: edit overlay-plan.yaml (labels, tags, bodies), then run `apply-overlay-plan`.');
    return;
  }

  if (command === 'apply-overlay-plan') {
    const runDir = await requireRun(args[0]);
    const result = await applyOverlayPlanRun(runDir);
    console.log(`Updated ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      chapterCount: result.chapterCount,
      insightCount: result.insightCount,
      sectionsSkippedEmpty: result.sectionsSkippedEmpty
    }, null, 2));
    return;
  }

  if (command === 'promote') {
    const parsed = parsePromoteArgs(args);
    const runDir = await requireRun(parsed.runArg);
    const result = await promoteRun(runDir, parsed.renderName, parsed.destinationDir, {
      force: parsed.options.force,
      outputName: parsed.options.outputName
    });
    console.log(`Copied ${path.relative(process.cwd(), result.sourcePath)}`);
    console.log(`    → ${result.destPath}`);
    console.log(JSON.stringify({
      bytes: result.bytes,
      finalName: result.finalName
    }, null, 2));
    return;
  }

  if (command === 'plan') {
    const runDir = await requireRun(args[0]);
    const result = await planCompositionRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      source: result.source,
      keepRangeCount: result.keepRangeCount,
      sourceDuration: result.sourceDuration,
      timelineDuration: result.timelineDuration
    }, null, 2));
    return;
  }

  if (command === 'render-rough') {
    const runDir = await requireRun(args[0]);
    const result = await renderRoughRun(runDir, args[1]);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      renderer: result.renderer,
      keepRangeCount: result.keepRangeCount,
      timelineDuration: result.timelineDuration,
      evidenceRefreshed: result.evidenceRefreshed
    }, null, 2));
    return;
  }

  if (command === 'render-captions') {
    const runDir = await requireRun(args[0]);
    const result = await renderCaptionsRun(runDir, args[1], args[2]);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), result.assPath)}`);
    console.log(JSON.stringify({
      renderer: result.renderer,
      input: result.inputName,
      output: result.outputName,
      cueCount: result.cueCount,
      duration: result.duration,
      evidenceRefreshed: result.evidenceRefreshed
    }, null, 2));
    return;
  }

  if (command === 'grade-source' || command === 'grade') {
    const runDir = await requireRun(args[0]);
    const result = await gradeSourceRun(runDir, {
      preset: args[1],
      outputName: args[2]
    });
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(`Updated ${path.relative(process.cwd(), result.compositionPath)}`);
    console.log(JSON.stringify({
      preset: result.preset,
      source: result.outputName,
      filter: result.filter
    }, null, 2));
    return;
  }

  if (command === 'grade-render') {
    const runDir = await requireRun(args[0]);
    const presets = listGradePresets();
    const outputArg = args[2] && presets[args[2]] && !args[3] ? null : args[2];
    const presetArg = args[2] && presets[args[2]] && !args[3] ? args[2] : args[3];
    const result = await gradeRenderRun(runDir, args[1], outputArg, {
      preset: presetArg
    });
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(JSON.stringify({
      preset: result.preset,
      input: result.inputName,
      output: result.outputName,
      filter: result.filter
    }, null, 2));
    return;
  }

  if (command === 'captions') {
    const runDir = await requireRun(args[0]);
    const result = await captionsRun(runDir);
    console.log(`Wrote ${path.relative(process.cwd(), result.outputPath)}`);
    console.log(`Updated ${path.relative(process.cwd(), result.compositionPath)}`);
    console.log(JSON.stringify(result.captions.stats, null, 2));
    return;
  }

  if (command === 'qa') {
    const runDir = await requireRun(args[0]);
    const result = await qaRun(runDir, args[1]);
    console.log(`Wrote ${path.relative(process.cwd(), result.reportPath)}`);
    console.log(JSON.stringify({
      render: result.report.render,
      duration: result.report.summary.duration,
      video: result.report.summary.video,
      audio: result.report.summary.audio,
      frames: result.report.frames
    }, null, 2));
    return;
  }

  if (command === 'review') {
    const runDir = await requireRun(args[0]);
    const result = await reviewRun(runDir, args[1]);
    console.log(`Wrote ${path.relative(process.cwd(), result.reviewPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), result.markdownPath)}`);
    console.log(JSON.stringify({
      run: result.review.run,
      render: result.review.render,
      overallRisk: result.review.overallRisk,
      findingCount: result.review.findings.length,
      nextStep: result.review.nextStep
    }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
