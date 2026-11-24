import { clamp, frequency, wavBytes } from './music';
import type { Patch, Take } from './music';
type Voice = {
  source: AudioScheduledSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  level: number;
  ended: boolean;
  started: number;
};
export const SAMPLE_MIDI = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
const FILE_NAMES = [
  'C',
  'Cs',
  'D',
  'Ds',
  'E',
  'F',
  'Fs',
  'G',
  'Gs',
  'A',
  'As',
  'B',
];
function room(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(
    2,
    Math.floor(ctx.sampleRate * 1.8),
    ctx.sampleRate,
  );
  let seed = 937;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] =
        ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
    }
  }
  return buffer;
}
function graph(ctx: BaseAudioContext, patch: Patch) {
  const input = ctx.createGain(),
    dry = ctx.createGain(),
    wet = ctx.createGain(),
    convolver = ctx.createConvolver(),
    master = ctx.createGain(),
    limiter = ctx.createDynamicsCompressor(),
    analyser = ctx.createAnalyser();
  input.connect(dry);
  dry.connect(master);
  input.connect(convolver);
  convolver.connect(wet);
  wet.connect(master);
  convolver.buffer = room(ctx);
  dry.gain.value = 1 - patch.reverb * 0.2;
  wet.gain.value = patch.reverb * 0.55;
  master.gain.value = patch.volume * 0.65;
  limiter.threshold.value = -6;
  limiter.knee.value = 10;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter);
  limiter.connect(analyser);
  analyser.connect(ctx.destination);
  analyser.fftSize = 256;
  return { input, dry, wet, convolver, master, limiter, analyser };
}
function createVoice(
  ctx: BaseAudioContext,
  input: AudioNode,
  buffers: Map<number, AudioBuffer>,
  midi: number,
  velocity: number,
  patch: Patch,
  time: number,
): Voice {
  const gain = ctx.createGain(),
    filter = ctx.createBiquadFilter();
  let source: AudioBufferSourceNode | OscillatorNode;
  filter.type = 'lowpass';
  filter.frequency.value =
    patch.instrument === 'piano'
      ? 1800 + patch.tone * 14000
      : 900 + patch.tone * 9000;
  filter.Q.value = 0.3;
  if (patch.instrument === 'piano') {
    const nearest = [...buffers.keys()].reduce(
      (a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a),
      60,
    );
    const buffer = buffers.get(nearest);
    if (!buffer) throw new Error('Piano samples are not ready.');
    const sample = ctx.createBufferSource();
    sample.buffer = buffer;
    sample.playbackRate.value = 2 ** ((midi - nearest) / 12);
    source = sample;
  } else {
    const osc = ctx.createOscillator();
    const real = new Float32Array(9),
      imag = new Float32Array([0, 1, 0.68, 0.48, 0.25, 0.15, 0.11, 0.08, 0.05]);
    osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    osc.frequency.value = frequency(midi);
    source = osc;
  }
  const level =
    Math.pow(clamp(velocity, 0.05, 1), 1.45) *
    (patch.instrument === 'piano' ? 0.8 : 0.16);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(level, time + 0.006);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(input);
  source.start(time);
  const voice: Voice = {
    source,
    gain,
    filter,
    level,
    ended: false,
    started: time,
  };
  source.onended = () => {
    voice.ended = true;
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  return voice;
}
function releaseVoice(voice: Voice, time: number, release = 0.18) {
  if (voice.ended) return;
  const t = Math.max(time, voice.started + 0.008);
  voice.gain.gain.cancelScheduledValues(t);
  voice.gain.gain.setValueAtTime(voice.level, t);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + release);
  try {
    voice.source.stop(t + release + 0.015);
  } catch {
    /* already ended */
  }
}
export class KeyboardAudio {
  context: AudioContext | null = null;
  buffers = new Map<number, AudioBuffer>();
  voices = new Map<string, Voice>();
  patch: Patch = {
    instrument: 'piano',
    volume: 0.7,
    reverb: 0.2,
    tone: 0.55,
    velocity: 0.72,
  };
  private clicks = new Set<OscillatorNode>();
  private network: ReturnType<typeof graph> | null = null;
  private loading: Promise<void> | null = null;
  get time() {
    return this.context?.currentTime ?? 0;
  }
  get analyser() {
    return this.network?.analyser ?? null;
  }
  private ensureContext() {
    if (this.context?.state === 'closed') this.context = null;
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.network = graph(this.context, this.patch);
    }
    return this.context;
  }
  async preload(onProgress: (n: number) => void = () => {}) {
    const context = this.ensureContext();
    if (this.buffers.size === SAMPLE_MIDI.length) return;
    if (!this.loading) {
      this.loading = (async () => {
        let index = 0,
          loaded = this.buffers.size;
        const worker = async () => {
          while (index < SAMPLE_MIDI.length) {
            const midi = SAMPLE_MIDI[index++];
            if (this.buffers.has(midi)) continue;
            const name = FILE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
            const response = await fetch(`/audio/piano/${name}.mp3`);
            if (!response.ok)
              throw new Error(`Could not load ${name}. Please retry.`);
            const data = await response.arrayBuffer();
            this.buffers.set(midi, await context.decodeAudioData(data));
            onProgress(++loaded / SAMPLE_MIDI.length);
          }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
      })().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }
  async start(onProgress: (n: number) => void = () => {}) {
    const context = this.ensureContext();
    const resumed = context.resume();
    await Promise.all([resumed, this.preload(onProgress)]);
  }
  setPatch(patch: Patch) {
    this.patch = { ...patch };
    const c = this.context,
      g = this.network;
    if (!c || !g) return;
    g.master.gain.setTargetAtTime(patch.volume * 0.65, c.currentTime, 0.02);
    g.wet.gain.setTargetAtTime(patch.reverb * 0.55, c.currentTime, 0.03);
    g.dry.gain.setTargetAtTime(1 - patch.reverb * 0.2, c.currentTime, 0.03);
  }
  noteOn(
    id: string,
    midi: number,
    velocity: number,
    at = this.time,
    patch = this.patch,
  ) {
    if (!this.context || !this.network) return;
    this.noteOff(id);
    for (const [key, voice] of this.voices)
      if (voice.ended) this.voices.delete(key);
    if (this.voices.size >= 64) this.noteOff(this.voices.keys().next().value!);
    this.voices.set(
      id,
      createVoice(
        this.context,
        this.network.input,
        this.buffers,
        midi,
        velocity,
        patch,
        at,
      ),
    );
  }
  noteOff(id: string, at = this.time, quick = false) {
    const voice = this.voices.get(id);
    if (voice) {
      if (quick && voice.started > at) {
        try {
          voice.source.stop(at);
        } catch {}
      } else releaseVoice(voice, at, quick ? 0.03 : 0.2);
      if (at <= this.time) this.voices.delete(id);
    }
  }
  panic() {
    for (const id of this.voices.keys()) this.noteOff(id, this.time, true);
    for (const osc of this.clicks) {
      try {
        osc.stop();
      } catch {}
    }
    this.clicks.clear();
  }
  click(time: number, accent: boolean, volume = 0.35) {
    const c = this.context,
      g = this.network;
    if (!c || !g) return;
    const osc = c.createOscillator(),
      amp = c.createGain();
    osc.frequency.value = accent ? 1400 : 950;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(volume * 0.15, time + 0.001);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(amp);
    amp.connect(g.master);
    this.clicks.add(osc);
    osc.start(time);
    osc.stop(time + 0.05);
    osc.onended = () => {
      this.clicks.delete(osc);
      osc.disconnect();
      amp.disconnect();
    };
  }
  async exportWav(take: Take) {
    const ctx = new OfflineAudioContext(
      2,
      Math.ceil((take.duration + 2.1) * 44100),
      44100,
    );
    const g = graph(ctx, take.patch);
    for (const n of take.notes) {
      const v = createVoice(
        ctx,
        g.input,
        this.buffers,
        n.midi,
        n.velocity,
        take.patch,
        n.time,
      );
      releaseVoice(v, n.time + n.duration, 0.2);
    }
    const rendered = await ctx.startRendering();
    return wavBytes(
      [rendered.getChannelData(0), rendered.getChannelData(1)],
      rendered.sampleRate,
    );
  }
  dispose() {
    this.panic();
    void this.context?.close();
  }
}
