import type { Patch } from './music';

export const SETTINGS_STORAGE_KEY = 'keys.settings';

export type SavedSettings = {
  version: 1;
  patch: Patch;
  base: number;
  bpm: number;
};

function finiteBetween(value: unknown, min: number, max: number) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

export function parseSettings(raw: string | null): SavedSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedSettings>;
    const patch = value.patch as Partial<Patch> | undefined;
    if (
      value.version !== 1 ||
      !patch ||
      (patch.instrument !== 'piano' && patch.instrument !== 'organ') ||
      !finiteBetween(patch.volume, 0, 1) ||
      !finiteBetween(patch.reverb, 0, 1) ||
      !finiteBetween(patch.tone, 0, 1) ||
      !finiteBetween(patch.velocity, 0.05, 1) ||
      !Number.isInteger(value.base) ||
      !finiteBetween(value.base, 24, 72) ||
      (value.base as number) % 12 !== 0 ||
      !Number.isInteger(value.bpm) ||
      !finiteBetween(value.bpm, 30, 240)
    )
      return null;
    return value as SavedSettings;
  } catch {
    return null;
  }
}

export function serializeSettings(settings: Omit<SavedSettings, 'version'>) {
  return JSON.stringify({ version: 1, ...settings } satisfies SavedSettings);
}
