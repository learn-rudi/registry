import assert from 'assert/strict';
import { buildLowerThird } from '../src/operations/lower-third.js';

assert.deepEqual(
  buildLowerThird({
    title: 'Jane Smith',
    subtitle: 'Founder',
    at: '12.5',
    duration: '4',
    style: 'minimal',
    position: 'bottom-right',
    offsetY: '180'
  }),
  {
    title: 'Jane Smith',
    subtitle: 'Founder',
    at: 12.5,
    duration: 4,
    style: 'minimal',
    position: 'bottom-right',
    offsetY: 180
  }
);

assert.deepEqual(
  buildLowerThird({
    title: 'Brandon Hoff'
  }),
  {
    title: 'Brandon Hoff',
    subtitle: '',
    at: 0,
    duration: 5,
    style: 'modern',
    position: 'bottom-left'
  }
);

assert.deepEqual(
  buildLowerThird({
    title: 'Brandon Z. Hoff',
    subtitle: 'RUDI AI Trainer',
    style: 'cinematic'
  }),
  {
    title: 'Brandon Z. Hoff',
    subtitle: 'RUDI AI Trainer',
    at: 0,
    duration: 5,
    style: 'cinematic',
    position: 'bottom-left'
  }
);

assert.throws(
  () => buildLowerThird({ title: 'Bad Style', style: 'premiere' }),
  /Unknown lower-third style/
);

assert.throws(
  () => buildLowerThird({ title: 'Bad Time', at: '-1' }),
  /Invalid lower-third start time/
);

assert.throws(
  () => buildLowerThird({ title: 'Bad Offset', offsetY: '-1' }),
  /Invalid lower-third vertical offset/
);

console.log('lower-third tests passed');
