type Settings = {
  bpm: number;
  transpose: number;
  instrument: 'piano' | 'organ';
};
type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function validateSettings(input: unknown): Settings {
  if (!input || typeof input !== 'object')
    throw new Error('Settings must be an object.');
  const p = input as Settings;
  if (
    Object.keys(p).some(
      (k) => !['bpm', 'transpose', 'instrument'].includes(k),
    ) ||
    !Number.isInteger(p.bpm) ||
    p.bpm < 30 ||
    p.bpm > 240 ||
    !Number.isInteger(p.transpose) ||
    p.transpose < -12 ||
    p.transpose > 12 ||
    !['piano', 'organ'].includes(p.instrument)
  )
    throw new Error('Use BPM 30–240, transpose -12–12, and piano or organ.');
  return p;
}
export function registerInstrumentTools(
  read: () => object,
  configure: (settings: Settings) => Promise<object>,
) {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const register = (tool: Parameters<ModelContext['registerTool']>[0]) => {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* optional browser capability */
    }
  };
  register({
    name: 'read_keys_state',
    description:
      'Read the visible KEYS instrument settings and audio/transport status.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => read(),
  });
  register({
    name: 'configure_keys',
    description:
      'Set tempo, transpose and instrument while idle. Releases held notes. Does not enable audio, start playing or record.',
    inputSchema: {
      type: 'object',
      properties: {
        bpm: { type: 'integer', minimum: 30, maximum: 240 },
        transpose: { type: 'integer', minimum: -12, maximum: 12 },
        instrument: { type: 'string', enum: ['piano', 'organ'] },
      },
      required: ['bpm', 'transpose', 'instrument'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: (input) => configure(validateSettings(input)),
  });
  return () => lifecycle.abort();
}
