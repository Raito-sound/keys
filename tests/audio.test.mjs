import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(
  new URL('../lib/audio.ts', import.meta.url),
  'utf8',
);
const code = ts
  .transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  .outputText.replace(
    "'./music'",
    JSON.stringify(new URL('../lib/music.ts', import.meta.url).href),
  );
const { KeyboardAudio } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);
class Param {
  value = 0;
  events = [];
  setValueAtTime(v, t) {
    this.events.push(['set', v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.events.push(['linear', v, t]);
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(['exponential', v, t]);
  }
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
class Node {
  gain = new Param();
  frequency = new Param();
  Q = new Param();
  playbackRate = new Param();
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  stops = [];
  connect() {}
  disconnect() {}
  start(t) {
    this.startTime = t;
  }
  stop(t) {
    this.stops.push(t);
  }
  setPeriodicWave() {}
}
class Context {
  currentTime = 1;
  sampleRate = 8000;
  destination = new Node();
  state = 'running';
  resumeCount = 0;
  createGain() {
    return new Node();
  }
  createConvolver() {
    return new Node();
  }
  createDynamicsCompressor() {
    return new Node();
  }
  createAnalyser() {
    return new Node();
  }
  createBiquadFilter() {
    return new Node();
  }
  createBufferSource() {
    return new Node();
  }
  createOscillator() {
    return new Node();
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(c, l) {
    return { getChannelData: () => new Float32Array(l) };
  }
  async resume() {
    this.resumeCount++;
  }
  async close() {}
  async decodeAudioData() {
    return {};
  }
}
test('polyphonic voices have independent release and future notes are cancellable', async () => {
  const priorContext = globalThis.AudioContext,
    priorFetch = globalThis.fetch;
  globalThis.AudioContext = Context;
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(1),
  });
  try {
    const engine = new KeyboardAudio();
    await engine.preload();
    assert.equal(engine.context.resumeCount, 0);
    await engine.start();
    assert.equal(engine.context.resumeCount, 1);
    assert.equal(engine.buffers.size, 30);
    engine.noteOn('c', 60, 0.8);
    engine.noteOn('e', 64, 0.8);
    engine.noteOn('g', 67, 0.8);
    assert.equal(engine.voices.size, 3);
    engine.noteOn('same-c', 60, 0.8);
    engine.noteOff('same-c');
    assert.ok(
      engine.voices.has('c'),
      'releasing an overlapping input must leave the other C sounding',
    );
    engine.noteOff('e');
    assert.deepEqual([...engine.voices.keys()], ['c', 'g']);
    engine.noteOn('future', 72, 0.8, 5);
    const future = engine.voices.get('future');
    engine.noteOff('future', 6);
    assert.ok(
      engine.voices.has('future'),
      'scheduled release must remain cancellable',
    );
    engine.panic();
    assert.equal(engine.voices.size, 0);
    assert.equal(
      future.source.stops.at(-1),
      1,
      'panic cancels a note before its future onset',
    );
  } finally {
    globalThis.AudioContext = priorContext;
    globalThis.fetch = priorFetch;
  }
});
