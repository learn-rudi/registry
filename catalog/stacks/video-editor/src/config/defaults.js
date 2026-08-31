export const DEFAULT_ARTIFACTS = {
  probe: 'probe.json',
  working: 'working.mp4',
  silence: 'silence.json',
  transcriptSource: 'transcript-source.json',
  transcriptOutput: 'transcript-output.json',
  transcriptCorrections: 'transcript-corrections.json',
  transcriptClusters: 'transcript-clusters.json',
  captions: 'captions.json',
  cutAudit: 'cut-audit.json',
  narration: 'narration.json',
  insights: 'insights.json',
  content: 'content.json',
  composition: 'composition.json',
  review: 'review.json',
  reviewMarkdown: 'review.md',
  renders: 'renders',
  qa: 'qa'
};

export const DEFAULT_SETTINGS = {
  fps: 30,
  audioSampleRate: 48000,
  audioChannels: 2,
  silence: {
    thresholdDb: -30,
    minDuration: 0.5,
    padding: 0.12,
    minKeepDuration: 0.25,
    speedupInsteadOfCut: false,
    speedupFactor: 6,
    speedupMinSec: 5
  },
  transcription: {
    engine: 'auto',
    model: 'large-v3-turbo',
    language: 'en',
    wordTimestamps: true,
    vad: true,
    initialPrompt: '',
    autoTranscribeRenders: true
  },
  cluster: {
    source: 'segments',
    paddingSec: 0.2,
    minGapToCutSec: 0.1,
    maxWordGapSec: 0.6
  },
  audit: {
    targetWordPaddingSec: 0.3,
    minimumWordPaddingSec: 0.2,
    minimumCutDurationSec: 0.25,
    maxCutsPerMinute: 8,
    maxWordsPerSecond: 4,
    maxMissingWordPercent: 5,
    minOutputWordGapSec: 0.2,
    spliceReviewWindowSec: 0.6,
    resolutionOrder: ['adjust', 'shorten', 'skip']
  },
  render: {
    audioCrossfadeSeconds: 0.04,
    concurrency: 1
  },
  narrate: {
    minSilenceSec: 5,
    contextWords: 12,
    position: 'top'
  },
  narrateVision: {
    minSilenceSec: 5,
    model: 'llava',
    host: 'http://127.0.0.1:11434',
    position: 'top',
    maxLabels: 12
  },
  chapters: {
    maxChapterSec: null,
    minChapterSec: null,
    titleSource: 'ollama',
    ollamaModel: 'llama3.2:3b',
    ollamaHost: 'http://127.0.0.1:11434'
  },
  insights: {
    maxInsights: 3,
    durationSec: 4.5,
    provider: 'deepseek',
    claudeModel: 'sonnet',
    deepseekModel: 'deepseek-chat',
    deepseekBaseUrl: 'https://api.deepseek.com/v1',
    ollamaModel: 'llama3.2:3b',
    ollamaHost: 'http://127.0.0.1:11434'
  }
};

export const SILENCE_PRESETS = {
  aggressive: {
    thresholdDb: -25,
    minDuration: 0.3,
    padding: 0.05,
    minKeepDuration: 0.2
  },
  moderate: {
    thresholdDb: -30,
    minDuration: 0.5,
    padding: 0.12,
    minKeepDuration: 0.25
  },
  conservative: {
    thresholdDb: -35,
    minDuration: 0.8,
    padding: 0.2,
    minKeepDuration: 0.3
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeJsonDefaults(defaults, overrides) {
  if (overrides === undefined) {
    return cloneJson(defaults);
  }

  if (!isPlainObject(defaults) || !isPlainObject(overrides)) {
    return cloneJson(overrides);
  }

  const merged = cloneJson(defaults);
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = mergeJsonDefaults(merged[key], value);
  }
  return merged;
}

export function cloneDefaultArtifacts() {
  return cloneJson(DEFAULT_ARTIFACTS);
}

export function cloneDefaultSettings() {
  return cloneJson(DEFAULT_SETTINGS);
}

export function mergeProjectDefaults(project) {
  const merged = { ...project };

  if (project.artifacts !== undefined) {
    merged.artifacts = mergeJsonDefaults(DEFAULT_ARTIFACTS, project.artifacts);
  }

  if (project.settings !== undefined) {
    merged.settings = mergeJsonDefaults(DEFAULT_SETTINGS, project.settings);
  }

  return merged;
}
