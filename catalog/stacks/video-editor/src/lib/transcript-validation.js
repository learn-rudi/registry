import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateJsonSchema } from './json-schema.js';

const stackRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const transcriptSchemaPath = path.join(stackRoot, 'schemas', 'transcript.schema.json');
const provenanceSchemaPath = path.join(stackRoot, 'schemas', 'transcript-provenance.schema.json');
let transcriptSchema = null;
let provenanceSchema = null;

async function loadSchema(schemaPath, cachedSchema) {
  if (cachedSchema) return cachedSchema;
  return JSON.parse(await fs.readFile(schemaPath, 'utf8'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(label, message) {
  throw new Error(`${label} is malformed: ${message}`);
}

function validateRange(start, end, label, previousStart = null) {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    fail(label, 'start and end must be finite numbers');
  }
  if (start < 0 || end < 0) {
    fail(label, 'start and end must be non-negative');
  }
  if (end < start) {
    fail(label, 'end must be greater than or equal to start');
  }
  if (previousStart !== null && start < previousStart) {
    fail(label, 'timestamps must be monotonic');
  }
}

function validateRawWord(word, label, previousStart) {
  if (!isObject(word)) {
    fail(label, 'word must be an object');
  }
  const text = String(word.text || word.word || '').trim();
  if (!text) {
    fail(label, 'word text must be non-empty');
  }
  const start = Number(word.start);
  const end = Number(word.end);
  validateRange(start, end, label, previousStart);
  if (word.probability !== undefined) {
    const probability = Number(word.probability);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      fail(label, 'probability must be between 0 and 1');
    }
  }
  return start;
}

function validateOffsets(offsets, label, previousStart = null) {
  if (!isObject(offsets)) {
    fail(label, 'offsets must be an object');
  }
  const start = Number(offsets.from);
  const end = Number(offsets.to);
  validateRange(start, end, label, previousStart);
  return { start, end };
}

function isSpecialToken(text) {
  return /^\[[^\]]+\]$/.test(text.trim());
}

export function validateWhisperCppOutput(raw, options = {}) {
  const label = options.label || 'whisper.cpp JSON';
  const wordTimestamps = options.wordTimestamps === true;
  if (!isObject(raw)) {
    fail(label, 'root must be an object');
  }
  if (!Array.isArray(raw.transcription)) {
    fail(label, 'transcription is required and must be an array');
  }

  let previousSegmentStart = null;
  raw.transcription.forEach((segment, segmentIndex) => {
    const segmentLabel = `${label}.transcription[${segmentIndex}]`;
    if (!isObject(segment)) {
      fail(segmentLabel, 'entry must be an object');
    }
    if (typeof segment.text !== 'string') {
      fail(segmentLabel, 'text must be a string');
    }
    const segmentOffsets = validateOffsets(
      segment.offsets,
      segmentLabel,
      previousSegmentStart
    );
    previousSegmentStart = segmentOffsets.start;

    if (wordTimestamps && !Array.isArray(segment.tokens)) {
      fail(segmentLabel, 'tokens must be an array when word timestamps are requested');
    }
    if (segment.tokens !== undefined && !Array.isArray(segment.tokens)) {
      fail(segmentLabel, 'tokens must be an array when present');
    }

    let previousTokenStart = null;
    for (const [tokenIndex, token] of (segment.tokens || []).entries()) {
      const tokenLabel = `${segmentLabel}.tokens[${tokenIndex}]`;
      if (!isObject(token) || typeof token.text !== 'string') {
        fail(tokenLabel, 'token must be an object with string text');
      }
      if (token.p !== undefined) {
        const probability = Number(token.p);
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
          fail(tokenLabel, 'probability must be between 0 and 1');
        }
      }
      if (isSpecialToken(token.text) || !token.text.trim()) {
        continue;
      }
      const tokenOffsets = validateOffsets(token.offsets, tokenLabel, previousTokenStart);
      if (tokenOffsets.start < segmentOffsets.start || tokenOffsets.end > segmentOffsets.end) {
        fail(tokenLabel, 'token offsets must be inside the segment offsets');
      }
      previousTokenStart = tokenOffsets.start;
    }
  });
}

export function validateWhisperOutput(raw, options = {}) {
  const label = options.label || 'Whisper JSON';
  const wordTimestamps = options.wordTimestamps === true;
  if (!isObject(raw)) {
    fail(label, 'root must be an object');
  }
  if (typeof raw.text !== 'string') {
    fail(label, 'text is required and must be a string');
  }
  if (!Array.isArray(raw.segments)) {
    fail(label, 'segments is required and must be an array');
  }
  if (raw.language !== undefined && typeof raw.language !== 'string') {
    fail(label, 'language must be a string when present');
  }

  let previousSegmentStart = null;
  raw.segments.forEach((segment, segmentIndex) => {
    const segmentLabel = `${label}.segments[${segmentIndex}]`;
    if (!isObject(segment)) {
      fail(segmentLabel, 'segment must be an object');
    }
    if (typeof segment.text !== 'string') {
      fail(segmentLabel, 'text must be a string');
    }
    const start = Number(segment.start);
    const end = Number(segment.end);
    validateRange(start, end, segmentLabel, previousSegmentStart);
    previousSegmentStart = start;

    if (wordTimestamps && !Array.isArray(segment.words)) {
      fail(segmentLabel, 'words must be an array when word timestamps are requested');
    }
    if (segment.words !== undefined && !Array.isArray(segment.words)) {
      fail(segmentLabel, 'words must be an array when present');
    }

    let previousWordStart = null;
    for (const [wordIndex, word] of (segment.words || []).entries()) {
      previousWordStart = validateRawWord(
        word,
        `${segmentLabel}.words[${wordIndex}]`,
        previousWordStart
      );
    }
  });
}

export function transcriptProvenancePath(outputPath) {
  const extension = path.extname(outputPath);
  return path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath, extension)}.provenance${extension || '.json'}`
  );
}

function roundTime(value) {
  return Number(value.toFixed(3));
}

function expectedStats(transcript) {
  const duration = Math.max(
    0,
    ...transcript.segments.map((segment) => segment.end),
    ...transcript.words.map((word) => word.end)
  );
  return {
    duration: roundTime(duration),
    segmentCount: transcript.segments.length,
    wordCount: transcript.words.length,
    wordsPerSecond: duration > 0 ? roundTime(transcript.words.length / duration) : 0
  };
}

export async function validateTranscript(transcript, label = 'transcript') {
  transcriptSchema = await loadSchema(transcriptSchemaPath, transcriptSchema);
  validateJsonSchema(transcript, transcriptSchema, label);

  let previousSegmentStart = null;
  let previousWordStart = null;
  const flattenedWords = [];
  transcript.segments.forEach((segment, segmentIndex) => {
    validateRange(
      segment.start,
      segment.end,
      `${label}.segments[${segmentIndex}]`,
      previousSegmentStart
    );
    previousSegmentStart = segment.start;
    for (const [wordIndex, word] of segment.words.entries()) {
      previousWordStart = validateRawWord(
        word,
        `${label}.segments[${segmentIndex}].words[${wordIndex}]`,
        previousWordStart
      );
      flattenedWords.push(word);
    }
  });

  if (JSON.stringify(flattenedWords) !== JSON.stringify(transcript.words)) {
    fail(label, 'flat words must exactly match segment words in timeline order');
  }
  if (JSON.stringify(expectedStats(transcript)) !== JSON.stringify(transcript.stats)) {
    fail(label, 'stats must match the normalized transcript timeline');
  }
  return transcript;
}

export async function validateTranscriptProvenance(provenance, label = 'transcript provenance') {
  provenanceSchema = await loadSchema(provenanceSchemaPath, provenanceSchema);
  validateJsonSchema(provenance, provenanceSchema, label);
  return provenance;
}
