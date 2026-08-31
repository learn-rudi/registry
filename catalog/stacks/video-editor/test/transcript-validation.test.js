import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTranscript } from '../src/lib/transcript-validation.js';

function validTranscript() {
  const word = { text: 'Architect', start: 0, end: 1, probability: 0.99 };
  return {
    schemaVersion: 1,
    kind: 'source',
    media: { path: 'source.wav', target: 'source' },
    model: {
      command: 'whisper',
      model: 'large-v3-turbo',
      language: 'en',
      wordTimestamps: true
    },
    language: 'en',
    text: 'Architect',
    segments: [{ id: 0, start: 0, end: 1, text: 'Architect', words: [{ ...word }] }],
    words: [{ ...word }],
    stats: { duration: 1, segmentCount: 1, wordCount: 1, wordsPerSecond: 1 }
  };
}

test('normalized transcript validation enforces the original strict schema-v1 shape', async () => {
  await validateTranscript(validTranscript());

  const incompatible = validTranscript();
  incompatible.model.engine = 'whisper.cpp';
  await assert.rejects(
    () => validateTranscript(incompatible),
    /model\.engine.*not allowed/s
  );
});

test('normalized transcript validation rejects invalid relational data', async (t) => {
  const fixtures = [
    ['out-of-range probability', (value) => { value.words[0].probability = 1.5; value.segments[0].words[0].probability = 1.5; }, /probability.*<= 1/s],
    ['reversed segment time', (value) => { value.segments[0].start = 2; }, /end must be greater than or equal to start/],
    ['flat word mismatch', (value) => { value.words[0].text = 'Mismatch'; }, /flat words must exactly match/],
    ['incorrect stats', (value) => { value.stats.wordCount = 2; }, /stats must match/]
  ];

  for (const [name, mutate, expected] of fixtures) {
    await t.test(name, async () => {
      const value = structuredClone(validTranscript());
      mutate(value);
      await assert.rejects(() => validateTranscript(value), expected);
    });
  }
});
