const EDITING_TARGET_SELECTOR =
  'textarea,select,input:not([type="range"]),[contenteditable="true"],[role="dialog"]';
const SLIDER_TARGET_SELECTOR = 'input[type="range"],[role="slider"]';

const SLIDER_NAVIGATION_CODES = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);
const PEDAL_CODES = new Set(['ShiftLeft', 'ShiftRight', 'Space']);

type ClosestTarget = Pick<HTMLElement, 'closest'>;

export function shouldIgnoreInstrumentKey(code: string, target: ClosestTarget) {
  if (target.closest(EDITING_TARGET_SELECTOR)) return true;
  return Boolean(
    target.closest(SLIDER_TARGET_SELECTOR) && SLIDER_NAVIGATION_CODES.has(code),
  );
}

export function isPedalCode(code: string) {
  return PEDAL_CODES.has(code);
}
