import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_CODES,
  KEY_LABELS,
  KEY_OFFSETS,
  labelsForOffset,
  identifyChord,
  noteName,
  frequency,
  makeMidi,
  wavBytes,
  validTake,
} from '../lib/music.ts';
import { validateSettings } from '../lib/webmcp.ts';
const patch = {
  instrument: 'piano',
  volume: 0.7,
  reverb: 0.2,
  tone: 0.55,
  velocity: 0.72,
};
const take = {
  version: 1,
  patch,
  bpm: 120,
  duration: 2,
  notes: [
    { id: 'a', midi: 60, time: 0, duration: 1, velocity: 0.8 },
    { id: 'b', midi: 64, time: 0.25, duration: 1.5, velocity: 0.6 },
    { id: 'c', midi: 67, time: 0.5, duration: 0.5, velocity: 0.7 },
  ],
};
test('physical key mapping preserves two chromatic rows without duplicate bindings', () => {
  assert.equal(KEY_CODES.length, 29);
  assert.equal(new Set(KEY_CODES).size, 29);
  assert.equal(KEY_LABELS.length, 29);
  assert.equal(KEY_CODES[12], 'KeyQ');
  assert.equal(noteName(48 + KEY_CODES.indexOf('KeyQ')), 'C4');
  assert.equal(frequency(69), 440);
});
test('recognizes major, minor, seventh, inversions and octave doubles', () => {
  assert.equal(identifyChord([60, 64, 67, 72]).name, 'C');
  assert.equal(identifyChord([64, 67, 72]).name, 'C/E');
  assert.equal(identifyChord([57, 60, 64]).name, 'Am');
  assert.equal(identifyChord([60, 64, 67, 70]).name, 'C7');
  assert.equal(identifyChord([]).name, '—');
  assert.equal(identifyChord([69]).name, 'A4');
});
test('MIDI preserves polyphony, timing, velocity and end-of-track duration', () => {
  const bytes = makeMidi(take);
  const v = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'MThd');
  assert.equal(v.getUint16(12), 480);
  assert.equal(v.getUint32(18), bytes.length - 22);
  let p = 22,
    tick = 0;
  const events = [];
  const vl = () => {
    let n = 0,
      b;
    do {
      b = bytes[p++];
      n = (n << 7) | (b & 127);
    } while (b & 128);
    return n;
  };
  while (p < bytes.length) {
    tick += vl();
    const status = bytes[p++];
    if (status === 255) {
      const type = bytes[p++],
        length = vl();
      if (type === 47) events.push({ end: tick });
      p += length;
    } else if (status === 192) {
      p++;
    } else {
      events.push({ tick, status, note: bytes[p++], velocity: bytes[p++] });
    }
  }
  assert.deepEqual(
    events
      .filter((e) => e.status === 144)
      .map((e) => [e.tick, e.note, e.velocity]),
    [
      [0, 60, 102],
      [240, 64, 76],
      [480, 67, 89],
    ],
  );
  assert.deepEqual(
    events.filter((e) => e.status === 128).map((e) => [e.tick, e.note]),
    [
      [960, 60],
      [960, 67],
      [1680, 64],
    ],
  );
  assert.deepEqual(events.at(-1), { end: 1920 });
});
test('WAV header and interleaved PCM are standard stereo 16-bit', () => {
  const data = wavBytes(
    [new Float32Array([-1, 0, 1]), new Float32Array([1, 0.5, -1])],
    44100,
  );
  const view = new DataView(data);
  assert.equal(data.byteLength, 56);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(40, true), 12);
  assert.equal(view.getInt16(44, true), -32768);
  assert.equal(view.getInt16(46, true), 32767);
  assert.equal(view.getInt16(50, true), 16384);
});
test('restored takes reject corrupt timing, unbounded clips and invalid patches', () => {
  assert.ok(validTake(take));
  assert.equal(validTake({ ...take, duration: 10000 }), false);
  assert.equal(
    validTake({ ...take, notes: [{ ...take.notes[0], midi: 200 }] }),
    false,
  );
  assert.equal(
    validTake({ ...take, notes: [{ ...take.notes[0], duration: 99 }] }),
    false,
  );
  assert.equal(validTake({ ...take, patch: { ...patch, volume: NaN } }), false);
});
test('agent settings validation rejects unsupported actions before state mutation', () => {
  assert.deepEqual(
    validateSettings({ bpm: 100, transpose: -3, instrument: 'organ' }),
    { bpm: 100, transpose: -3, instrument: 'organ' },
  );
  for (const input of [
    null,
    { bpm: 0, transpose: 0, instrument: 'piano' },
    { bpm: 100, transpose: 13, instrument: 'piano' },
    { bpm: 100, transpose: 0, instrument: 'piano', record: true },
  ])
    assert.throws(() => validateSettings(input));
});

test('lower-row continuation overlaps the upper octave without shifting either row', () => {
  for (const [lower, upper] of [
    ['Comma', 'KeyQ'],
    ['KeyL', 'Digit2'],
    ['Period', 'KeyW'],
    ['Semicolon', 'Digit3'],
    ['Slash', 'KeyE'],
  ]) {
    assert.equal(KEY_OFFSETS[lower], KEY_OFFSETS[upper]);
  }
  assert.equal(KEY_OFFSETS.KeyZ, 0);
  assert.equal(KEY_OFFSETS.KeyM, 11);
  assert.equal(KEY_OFFSETS.Comma, 12);
  assert.deepEqual(labelsForOffset(12), ['Q', ',']);
  assert.equal(KEY_OFFSETS.KeyP, 28);
});
