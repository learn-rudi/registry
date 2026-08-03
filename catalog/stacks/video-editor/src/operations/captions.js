import path from 'path';
import {
  artifactPath,
  loadProject,
  pathExists,
  readJson,
  writeJson
} from '../lib/files.js';
import {
  applyTranscriptCorrections,
  loadTranscriptCorrections
} from '../lib/transcript-corrections.js';
import { roundTime } from '../lib/format.js';

const DEFAULT_CAPTIONS_ARTIFACT = 'captions.json';
const SAME_CUE_GAP_SEC = 0.75;
const MAX_WORDS_PER_CUE = 7;
const MIN_CUE_DURATION_SEC = 0.75;
const MAX_CUE_DURATION_SEC = 3.2;
const CUE_OVERLAP_GUARD_SEC = 0.04;

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function cleanCaptionText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

function endsSentence(text) {
  return /[.!?]$/.test(String(text || '').trim());
}

function sourceRangesWithTimeline(keepRanges) {
  let cursor = 0;
  return keepRanges.map((range) => {
    const mapped = {
      start: Number(range.start),
      end: Number(range.end),
      timelineStart: cursor
    };
    cursor += Math.max(0, mapped.end - mapped.start);
    return mapped;
  });
}

function findContainingRange(ranges, start, end) {
  const epsilon = 0.02;
  return ranges.find((range) => (
    start >= range.start - epsilon && end <= range.end + epsilon
  ));
}

function mapSourceTime(range, sourceTime) {
  return range.timelineStart + (sourceTime - range.start);
}

function readTranscriptWords(transcript) {
  if (Array.isArray(transcript?.words) && transcript.words.length > 0) {
    return transcript.words;
  }

  if (!Array.isArray(transcript?.segments)) {
    return [];
  }

  return transcript.segments.flatMap((segment) => (
    Array.isArray(segment.words) ? segment.words : []
  ));
}

function normalizeTranscriptWords(transcript) {
  return readTranscriptWords(transcript)
    .map((word, index) => ({
      id: index + 1,
      text: cleanCaptionText(word.text || word.word || ''),
      start: Number(word.start),
      end: Number(word.end)
    }))
    .filter((word) => (
      word.text
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.end > word.start
    ));
}

function clusterToPhrase(cluster, corrections) {
  const rawText = cluster.rawText || cluster.text || '';
  const text = cleanCaptionText(applyTranscriptCorrections(rawText, corrections));

  return {
    id: cluster.id,
    sourceStart: Number(cluster.start),
    sourceEnd: Number(cluster.end),
    text,
    wordCount: wordCount(text)
  };
}

function shouldMergePhrase(current, phrase) {
  if (!current) return false;
  const gap = phrase.sourceStart - current.sourceEnd;
  return gap >= 0
    && gap <= SAME_CUE_GAP_SEC
    && current.wordCount + phrase.wordCount <= MAX_WORDS_PER_CUE;
}

function groupPhrases(phrases) {
  const groups = [];

  for (const phrase of phrases) {
    const current = groups[groups.length - 1];
    if (shouldMergePhrase(current, phrase)) {
      current.sourceEnd = Math.max(current.sourceEnd, phrase.sourceEnd);
      current.text = cleanCaptionText(`${current.text} ${phrase.text}`);
      current.wordCount += phrase.wordCount;
      current.clusterIds.push(phrase.id);
      continue;
    }

    groups.push({
      sourceStart: phrase.sourceStart,
      sourceEnd: phrase.sourceEnd,
      text: phrase.text,
      wordCount: phrase.wordCount,
      clusterIds: [phrase.id]
    });
  }

  return groups;
}

function buildCaptionCue(group, range) {
  const at = mapSourceTime(range, group.sourceStart);
  const naturalDuration = group.sourceEnd - group.sourceStart;
  const rangeEndOnTimeline = mapSourceTime(range, range.end);
  const duration = Math.min(
    Math.max(MIN_CUE_DURATION_SEC, Math.min(MAX_CUE_DURATION_SEC, naturalDuration)),
    Math.max(MIN_CUE_DURATION_SEC, rangeEndOnTimeline - at)
  );

  return {
    at: roundTime(Math.max(0, at)),
    duration: roundTime(duration),
    text: group.text,
    sourceStart: roundTime(group.sourceStart),
    sourceEnd: roundTime(group.sourceEnd),
    clusterIds: group.clusterIds
  };
}

function shouldStartNewWordCue(current, word, range) {
  if (!current) {
    return false;
  }

  if (current.range !== range) {
    return true;
  }

  const gap = word.start - current.sourceEnd;
  const nextDuration = word.end - current.sourceStart;

  return (
    gap > SAME_CUE_GAP_SEC
    || current.words.length >= MAX_WORDS_PER_CUE
    || (nextDuration > MAX_CUE_DURATION_SEC && current.words.length >= 3)
    || (endsSentence(current.words[current.words.length - 1]?.text) && current.words.length >= 3)
  );
}

function startWordCue(word, range) {
  return {
    range,
    sourceStart: word.start,
    sourceEnd: word.end,
    words: [word]
  };
}

function appendWordCue(current, word) {
  current.sourceEnd = Math.max(current.sourceEnd, word.end);
  current.words.push(word);
}

function constrainCueDurations(cues) {
  return cues.map((cue, index) => {
    const next = cues[index + 1];
    if (!next) {
      return cue;
    }

    const maxDuration = roundTime(next.at - cue.at - CUE_OVERLAP_GUARD_SEC);
    if (maxDuration <= 0) {
      return {
        ...cue,
        duration: roundTime(Math.max(0.1, cue.duration))
      };
    }

    return {
      ...cue,
      duration: roundTime(Math.min(cue.duration, maxDuration))
    };
  });
}

function buildWordCaptionCue(group, corrections) {
  const at = mapSourceTime(group.range, group.sourceStart);
  const rangeEndOnTimeline = mapSourceTime(group.range, group.range.end);
  const rawText = group.words.map((word) => word.text).join(' ');
  const text = cleanCaptionText(applyTranscriptCorrections(rawText, corrections));
  const naturalDuration = group.sourceEnd - group.sourceStart;
  const duration = Math.min(
    Math.max(MIN_CUE_DURATION_SEC, Math.min(MAX_CUE_DURATION_SEC, naturalDuration)),
    Math.max(0.1, rangeEndOnTimeline - at)
  );

  return {
    at: roundTime(Math.max(0, at)),
    duration: roundTime(duration),
    text,
    sourceStart: roundTime(group.sourceStart),
    sourceEnd: roundTime(group.sourceEnd),
    wordIds: group.words.map((word) => word.id)
  };
}

function buildWordCaptionCues({ composition, sourceTranscript, corrections }) {
  const ranges = sourceRangesWithTimeline(composition.timeline.keepRanges || []);
  const words = normalizeTranscriptWords(sourceTranscript);
  const skipped = [];
  const groups = [];
  let current = null;

  for (const word of words) {
    const range = findContainingRange(ranges, word.start, word.end);
    if (!range) {
      skipped.push({
        text: word.text,
        sourceStart: roundTime(word.start),
        sourceEnd: roundTime(word.end),
        reason: 'word is not fully inside a kept range'
      });
      continue;
    }

    if (shouldStartNewWordCue(current, word, range)) {
      groups.push(current);
      current = startWordCue(word, range);
      continue;
    }

    if (!current) {
      current = startWordCue(word, range);
      continue;
    }

    appendWordCue(current, word);
  }

  if (current) {
    groups.push(current);
  }

  const cues = constrainCueDurations(
    groups
      .map((group) => buildWordCaptionCue(group, corrections))
      .filter((cue) => cue.text)
  );

  return { cues, skipped };
}

function buildClusterCaptionCues({ project, composition, clusters, correctionsDocument, captionCorrections }) {
  const ranges = sourceRangesWithTimeline(composition.timeline.keepRanges || []);
  const phrases = (clusters.clusters || [])
    .map((cluster) => clusterToPhrase(cluster, captionCorrections))
    .filter((phrase) => (
      phrase.text
      && Number.isFinite(phrase.sourceStart)
      && Number.isFinite(phrase.sourceEnd)
      && phrase.sourceEnd > phrase.sourceStart
    ));

  const cues = [];
  const skipped = [];

  for (const group of groupPhrases(phrases)) {
    const range = findContainingRange(ranges, group.sourceStart, group.sourceEnd);
    if (!range) {
      skipped.push({
        text: group.text,
        sourceStart: roundTime(group.sourceStart),
        sourceEnd: roundTime(group.sourceEnd),
        reason: 'phrase is not fully inside a kept range'
      });
      continue;
    }

    cues.push(buildCaptionCue(group, range));
  }

  return { cues, skipped };
}

function buildCaptionDocument({ project, composition, clusters, sourceTranscript, correctionsDocument }) {
  const captionCorrections = [
    ...correctionsDocument.replacements,
    ...correctionsDocument.captionReplacements
  ];
  const wordCaptionResult = buildWordCaptionCues({
    composition,
    sourceTranscript,
    corrections: captionCorrections
  });
  const hasWordCues = wordCaptionResult.cues.length > 0;
  const captionResult = hasWordCues
    ? wordCaptionResult
    : buildClusterCaptionCues({
      project,
      composition,
      clusters,
      correctionsDocument,
      captionCorrections
    });

  return {
    schemaVersion: 1,
    source: {
      mode: hasWordCues ? 'words' : 'clusters',
      transcriptSource: project.artifacts.transcriptSource,
      transcriptClusters: project.artifacts.transcriptClusters,
      composition: project.artifacts.composition,
      corrections: correctionsDocument.path
    },
    settings: {
      sameCueGapSec: SAME_CUE_GAP_SEC,
      maxWordsPerCue: MAX_WORDS_PER_CUE,
      minCueDurationSec: MIN_CUE_DURATION_SEC,
      maxCueDurationSec: MAX_CUE_DURATION_SEC
    },
    stats: {
      cueCount: captionResult.cues.length,
      skippedCount: captionResult.skipped.length,
      replacementCount: correctionsDocument.replacements.length,
      captionReplacementCount: correctionsDocument.captionReplacements.length
    },
    cues: captionResult.cues,
    skipped: captionResult.skipped
  };
}

export async function captionsRun(runDir) {
  const { project } = await loadProject(runDir);
  const compositionPath = artifactPath(runDir, project, 'composition');
  const clustersPath = artifactPath(runDir, project, 'transcriptClusters');
  const sourceTranscriptPath = artifactPath(runDir, project, 'transcriptSource');
  const captionsArtifact = project.artifacts.captions || DEFAULT_CAPTIONS_ARTIFACT;
  const captionsPath = path.join(runDir, captionsArtifact);

  if (!(await pathExists(clustersPath))) {
    throw new Error('Transcript clusters are required before captions. Run `cluster` first.');
  }

  const composition = await readJson(compositionPath);
  const clusters = await readJson(clustersPath);
  const sourceTranscript = await pathExists(sourceTranscriptPath)
    ? await readJson(sourceTranscriptPath)
    : null;
  const correctionsDocument = await loadTranscriptCorrections(runDir, project);
  const captions = buildCaptionDocument({
    project,
    composition,
    clusters,
    sourceTranscript,
    correctionsDocument
  });

  const nextComposition = {
    ...composition,
    timeline: {
      ...composition.timeline,
      captions: {
        ...composition.timeline.captions,
        enabled: true,
        source: captionsArtifact,
        style: composition.timeline.captions?.style || 'lower-readable',
        cues: captions.cues
      }
    }
  };

  await writeJson(captionsPath, captions);
  await writeJson(compositionPath, nextComposition);

  return {
    outputPath: captionsPath,
    compositionPath,
    captions
  };
}
