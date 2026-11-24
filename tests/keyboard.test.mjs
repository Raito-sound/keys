import test from 'node:test';
import assert from 'node:assert/strict';
import { isPedalCode, shouldIgnoreInstrumentKey } from '../lib/keyboard.ts';

function target({ editing = false, slider = false } = {}) {
  return {
    closest(selector) {
      if (selector.includes('input:not') && editing) return this;
      if (selector.includes('input[type="range"]') && slider) return this;
      return null;
    },
  };
}

test('piano keys keep working after a slider receives focus', () => {
  const slider = target({ slider: true });
  for (const code of [
    'KeyZ',
    'KeyQ',
    'Digit2',
    'Minus',
    'ShiftLeft',
    'ShiftRight',
    'Space',
    'Escape',
  ])
    assert.equal(shouldIgnoreInstrumentKey(code, slider), false, code);
});

test('both Shift keys and Space operate the momentary sustain pedal', () => {
  assert.equal(isPedalCode('ShiftLeft'), true);
  assert.equal(isPedalCode('ShiftRight'), true);
  assert.equal(isPedalCode('Space'), true);
  assert.equal(isPedalCode('KeyZ'), false);
});

test('slider navigation and editable controls retain their keyboard input', () => {
  const slider = target({ slider: true });
  for (const code of [
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'Home',
    'End',
    'PageDown',
    'PageUp',
  ])
    assert.equal(shouldIgnoreInstrumentKey(code, slider), true, code);

  const editing = target({ editing: true });
  for (const code of ['KeyZ', 'Digit2', 'Space', 'ArrowLeft'])
    assert.equal(shouldIgnoreInstrumentKey(code, editing), true, code);
});
