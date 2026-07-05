import assert from 'node:assert/strict';
import path from 'node:path';
import {
  buildArchivePath,
  isCandidateVideoPath,
  isStableCandidate,
  normalizeFirstPassOptions
} from '../src/operations/download-intake.js';

assert.equal(isCandidateVideoPath('/tmp/Downloads/take.mov'), true);
assert.equal(isCandidateVideoPath('/tmp/Downloads/take.MP4'), true);
assert.equal(isCandidateVideoPath('/tmp/Downloads/.take.mov'), false);
assert.equal(isCandidateVideoPath('/tmp/Downloads/take.mov.crdownload'), false);
assert.equal(isCandidateVideoPath('/tmp/Downloads/take.txt'), false);

assert.equal(
  isStableCandidate(
    { size: 1024, mtimeMs: 1000, firstSeenAt: 10_000, stableSince: 12_000 },
    { size: 1024, mtimeMs: 1000 },
    { now: 18_001, stableMs: 6000 }
  ),
  true
);

assert.equal(
  isStableCandidate(
    { size: 1024, mtimeMs: 1000, firstSeenAt: 10_000, stableSince: 12_000 },
    { size: 2048, mtimeMs: 1000 },
    { now: 18_001, stableMs: 6000 }
  ),
  false
);

assert.deepEqual(
  normalizeFirstPassOptions({
    silenceDuration: '1.5',
    thresholdDb: '-32',
    padding: '0.18',
    moveSource: false
  }).silence,
  {
    minDuration: 1.5,
    thresholdDb: -32,
    padding: 0.18
  }
);

assert.equal(normalizeFirstPassOptions({}).moveSource, false);
assert.equal(normalizeFirstPassOptions({ moveSource: true }).moveSource, true);

assert.throws(
  () => normalizeFirstPassOptions({ silenceDuration: '0' }),
  /Invalid silence duration/
);

assert.throws(
  () => normalizeFirstPassOptions({ stableSeconds: '-1' }),
  /Invalid stable seconds/
);

assert.equal(
  buildArchivePath('/tmp/Downloads/Take 1.mov', {
    archiveDir: '/tmp/Downloads/rudi-video-intake/processed',
    runSlug: 'take-1'
  }),
  path.join('/tmp/Downloads/rudi-video-intake/processed', 'take-1.mov')
);

console.log('download intake tests passed');
