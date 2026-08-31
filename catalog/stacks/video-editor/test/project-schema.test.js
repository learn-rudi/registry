import assert from 'assert/strict';
import { validateProject } from '../src/lib/project-schema.js';

const minimalProject = {
  schemaVersion: 1,
  slug: 'schema-test',
  sourcePath: '/tmp/source.mp4',
  sourceLink: 'source.mp4',
  createdAt: '2026-05-24T12:00:00.000Z',
  artifacts: {
    probe: 'probe.json',
    working: 'working.mp4',
    silence: 'silence.json',
    transcriptSource: 'transcript-source.json',
    transcriptOutput: 'transcript-output.json',
    transcriptCorrections: 'transcript-corrections.json',
    transcriptClusters: 'transcript-clusters.json',
    cutAudit: 'cut-audit.json',
    composition: 'composition.json',
    review: 'review.json',
    reviewMarkdown: 'review.md',
    renders: 'renders',
    qa: 'qa'
  },
  settings: {
    fps: 30,
    audioSampleRate: 48000,
    audioChannels: 2,
    silence: {
      thresholdDb: -30,
      minDuration: 0.5,
      padding: 0.12,
      minKeepDuration: 0.25
    },
    transcription: {
      model: 'tiny',
      language: 'en',
      wordTimestamps: true,
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
      concurrency: 1,
      timeoutMs: 120000
    }
  }
};

const normalized = await validateProject(minimalProject, 'minimalProject');
assert.equal(normalized.artifacts.insights, 'insights.json');
assert.equal(normalized.artifacts.narration, 'narration.json');
assert.equal(normalized.settings.silence.speedupInsteadOfCut, false);
assert.equal(normalized.settings.render.timeoutMs, 120000);
assert.equal(normalized.settings.chapters.titleSource, 'ollama');
assert.equal(normalized.settings.insights.provider, 'deepseek');

await assert.rejects(
  () => validateProject({
    ...minimalProject,
    settings: {
      ...minimalProject.settings,
      unsafeExtra: true
    }
  }, 'extraSettingProject'),
  /unsafeExtra.*not allowed/s
);

await assert.rejects(
  () => validateProject({
    ...minimalProject,
    settings: {
      ...minimalProject.settings,
      silence: {
        ...minimalProject.settings.silence,
        minDuration: 0
      }
    }
  }, 'invalidSilenceProject'),
  /minDuration.*must be > 0/s
);

await assert.rejects(
  () => validateProject({
    ...minimalProject,
    settings: {
      ...minimalProject.settings,
      transcription: {
        ...minimalProject.settings.transcription,
        model: '/tmp/ggml-large-v3-turbo.bin'
      }
    }
  }, 'pathModelProject'),
  /model.*must match/s
);

console.log('project schema tests passed');
