export const PITCHES = [
  'C',
  'C♯',
  'D',
  'E♭',
  'E',
  'F',
  'F♯',
  'G',
  'A♭',
  'A',
  'B♭',
  'B',
];
export const KEY_CODES = [
  'KeyZ',
  'KeyS',
  'KeyX',
  'KeyD',
  'KeyC',
  'KeyV',
  'KeyG',
  'KeyB',
  'KeyH',
  'KeyN',
  'KeyJ',
  'KeyM',
  'KeyQ',
  'Digit2',
  'KeyW',
  'Digit3',
  'KeyE',
  'KeyR',
  'Digit5',
  'KeyT',
  'Digit6',
  'KeyY',
  'Digit7',
  'KeyU',
  'KeyI',
  'Digit9',
  'KeyO',
  'Digit0',
  'KeyP',
];
export const KEY_LABELS = [
  'Z',
  'S',
  'X',
  'D',
  'C',
  'V',
  'G',
  'B',
  'H',
  'N',
  'J',
  'M',
  'Q',
  '2',
  'W',
  '3',
  'E',
  'R',
  '5',
  'T',
  '6',
  'Y',
  '7',
  'U',
  'I',
  '9',
  'O',
  '0',
  'P',
];
// Lower-row continuation overlaps the upper row, with independent note ownership.
export const LOWER_CONTINUATION = [
  { code: 'Comma', label: ',', offset: 12 },
  { code: 'KeyL', label: 'L', offset: 13 },
  { code: 'Period', label: '.', offset: 14 },
  { code: 'Semicolon', label: ';', offset: 15 },
  { code: 'Slash', label: '/', offset: 16 },
];
export const KEY_OFFSETS: Readonly<Record<string, number>> = Object.fromEntries(
  [
    ...KEY_CODES.map((code, offset) => [code, offset]),
    ...LOWER_CONTINUATION.map(({ code, offset }) => [code, offset]),
  ],
);
export function labelsForOffset(offset: number): string[] {
  return [
    KEY_LABELS[offset],
    ...LOWER_CONTINUATION.filter((k) => k.offset === offset).map(
      (k) => k.label,
    ),
  ];
}
export const isBlack = (midi: number) =>
  [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
export const noteName = (midi: number) =>
  `${PITCHES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
export type Patch = {
  instrument: 'piano' | 'organ';
  volume: number;
  reverb: number;
  tone: number;
  velocity: number;
};
export type RecordedNote = {
  id: string;
  midi: number;
  time: number;
  duration: number;
  velocity: number;
};
export type Take = {
  version: 1;
  notes: RecordedNote[];
  duration: number;
  bpm: number;
  patch: Patch;
};
const CHORDS: [string, string, number[]][] = [
  ['', 'major', [0, 4, 7]],
  ['m', 'minor', [0, 3, 7]],
  ['7', 'dominant 7th', [0, 4, 7, 10]],
  ['maj7', 'major 7th', [0, 4, 7, 11]],
  ['m7', 'minor 7th', [0, 3, 7, 10]],
  ['sus2', 'suspended 2nd', [0, 2, 7]],
  ['sus4', 'suspended 4th', [0, 5, 7]],
  ['dim', 'diminished', [0, 3, 6]],
  ['aug', 'augmented', [0, 4, 8]],
  ['6', 'major 6th', [0, 4, 7, 9]],
  ['m6', 'minor 6th', [0, 3, 7, 9]],
  ['dim7', 'diminished 7th', [0, 3, 6, 9]],
  ['m7♭5', 'half-diminished', [0, 3, 6, 10]],
  ['add9', 'added 9th', [0, 2, 4, 7]],
  ['9', 'dominant 9th', [0, 2, 4, 7, 10]],
  ['m9', 'minor 9th', [0, 2, 3, 7, 10]],
  ['5', 'open fifth', [0, 7]],
];
export function identifyChord(notes: number[]): {
  name: string;
  detail: string;
} {
  const sorted = [...new Set(notes)].sort((a, b) => a - b);
  if (!sorted.length) return { name: '—', detail: 'Play a note or a chord' };
  if (sorted.length === 1)
    return {
      name: noteName(sorted[0]),
      detail: `${frequency(sorted[0]).toFixed(1)} Hz`,
    };
  const pcs = [...new Set(sorted.map((n) => n % 12))];
  for (const root of pcs) {
    const intervals = pcs
      .map((n) => (n - root + 12) % 12)
      .sort((a, b) => a - b);
    const match = CHORDS.find((c) => c[2].join(',') === intervals.join(','));
    if (match)
      return {
        name:
          PITCHES[root] +
          match[0] +
          (sorted[0] % 12 !== root ? '/' + PITCHES[sorted[0] % 12] : ''),
        detail: match[1] + (sorted[0] % 12 !== root ? ' · inversion' : ''),
      };
  }
  return {
    name: pcs.map((n) => PITCHES[n]).join(' · '),
    detail: `${sorted.length} notes`,
  };
}
export function validTake(value: unknown): value is Take {
  const t = value as Take;
  return (
    !!t &&
    t.version === 1 &&
    Number.isFinite(t.duration) &&
    t.duration > 0 &&
    t.duration <= 91 &&
    Number.isFinite(t.bpm) &&
    t.bpm >= 30 &&
    t.bpm <= 240 &&
    Array.isArray(t.notes) &&
    t.notes.length <= 20000 &&
    t.notes.every(
      (n) =>
        Number.isInteger(n.midi) &&
        n.midi >= 0 &&
        n.midi <= 127 &&
        Number.isFinite(n.time) &&
        n.time >= 0 &&
        Number.isFinite(n.duration) &&
        n.duration >= 0 &&
        n.time + n.duration <= t.duration + 0.05 &&
        n.velocity >= 0 &&
        n.velocity <= 1,
    ) &&
    !!t.patch &&
    ['piano', 'organ'].includes(t.patch.instrument) &&
    ['volume', 'reverb', 'tone', 'velocity'].every(
      (k) =>
        Number.isFinite(t.patch[k as keyof Patch]) &&
        Number(t.patch[k as keyof Patch]) >= 0 &&
        Number(t.patch[k as keyof Patch]) <= 1,
    )
  );
}
function variableLength(n: number): number[] {
  let v = n >>> 0;
  const bytes = [v & 127];
  while ((v >>>= 7) > 0) bytes.unshift((v & 127) | 128);
  return bytes;
}
export function makeMidi(take: Take): Uint8Array {
  const ppq = 480,
    ticks = (s: number) => Math.round(((s * take.bpm) / 60) * ppq);
  const events = take.notes
    .flatMap((n) => [
      {
        t: ticks(n.time),
        data: [0x90, n.midi, Math.max(1, Math.round(n.velocity * 127))],
      },
      { t: ticks(n.time + n.duration), data: [0x80, n.midi, 0] },
    ])
    .sort((a, b) => a.t - b.t || a.data[0] - b.data[0]);
  const tempo = Math.round(60000000 / take.bpm);
  const data = [
    0,
    0xff,
    0x51,
    3,
    (tempo >> 16) & 255,
    (tempo >> 8) & 255,
    tempo & 255,
    0,
    0xc0,
    take.patch.instrument === 'organ' ? 16 : 0,
  ];
  let last = 0;
  for (const e of events) {
    data.push(...variableLength(e.t - last), ...e.data);
    last = e.t;
  }
  data.push(
    ...variableLength(Math.max(0, ticks(take.duration) - last)),
    0xff,
    0x2f,
    0,
  );
  const length = data.length;
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    (length >>> 24) & 255,
    (length >>> 16) & 255,
    (length >>> 8) & 255,
    length & 255,
    ...data,
  ]);
}
export function wavBytes(
  channels: Float32Array[],
  sampleRate: number,
): ArrayBuffer {
  const frames = channels[0].length,
    count = channels.length;
  const buffer = new ArrayBuffer(44 + frames * count * 2),
    view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, buffer.byteLength - 44, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++) {
      const v = clamp(channels[c][i], -1, 1);
      view.setInt16(
        44 + (i * count + c) * 2,
        Math.round(v * (v < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}
