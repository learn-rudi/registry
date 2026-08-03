import assert from 'assert/strict';
import { buildAssDocument } from '../src/operations/render-captions.js';

const ass = buildAssDocument(
  {
    cues: [
      {
        at: 0,
        duration: 1.5,
        text: 'Caption safe area'
      }
    ]
  },
  {
    width: 1080,
    height: 1920
  },
  {
    marginBottomRatio: 0.22,
    marginHorizontalRatio: 0.08
  }
);

assert.match(ass, /Style: Default,Arial,54,/);
assert.match(ass, /,86,86,422,1/);
assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.50,Default/);

console.log('render captions tests passed');
