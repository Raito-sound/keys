import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, serializeSettings } from '../lib/settings.ts';

const settings = {
  patch: {
    instrument: 'organ',
    volume: 0.62,
    reverb: 0.3,
    tone: 0.7,
    velocity: 0.8,
  },
  base: 60,
  bpm: 132,
};

test('sound, octave and tempo settings survive a round trip', () => {
  assert.deepEqual(parseSettings(serializeSettings(settings)), {
    version: 1,
    ...settings,
  });
});

test('corrupt and unsupported settings fall back safely', () => {
  for (const raw of [
    null,
    '',
    '{',
    JSON.stringify({ version: 2, ...settings }),
    JSON.stringify({ version: 1, ...settings, bpm: 999 }),
    JSON.stringify({ version: 1, ...settings, base: 50 }),
    JSON.stringify({
      version: 1,
      ...settings,
      patch: { ...settings.patch, volume: Number.NaN },
    }),
  ])
    assert.equal(parseSettings(raw), null);
});
