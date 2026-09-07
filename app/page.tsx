'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Piano,
  Waves,
  Circle,
  Play,
  Square,
  Download,
  Repeat2,
  Minus,
  Plus,
  Moon,
  Sun,
  CircleHelp,
  Volume2,
  SlidersHorizontal,
  Keyboard,
  RotateCcw,
  Maximize,
  Minimize,
  ChevronDown,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { KeyboardAudio } from '@/lib/audio';
import { registerInstrumentTools } from '@/lib/webmcp';
import {
  KEY_CODES,
  KEY_OFFSETS,
  labelsForOffset,
  KEY_LABELS,
  isBlack,
  noteName,
  identifyChord,
  clamp,
  formatTime,
  makeMidi,
  validTake,
} from '@/lib/music';
import type { Patch, Take, RecordedNote } from '@/lib/music';

type LiveNote = {
  midi: number;
  offset: number;
  velocity: number;
  released: boolean;
  start: number;
};
const DEFAULT: Patch = {
  instrument: 'piano',
  volume: 0.7,
  reverb: 0.2,
  tone: 0.55,
  velocity: 0.72,
};
function saveFile(data: BlobPart, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function Control({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="slider-field">
      <span>
        {label}
        <output>{Math.round(value * 100)}</output>
      </span>
      <Slider
        disabled={disabled}
        aria-label={label}
        value={[value * 100]}
        min={0}
        max={100}
        step={1}
        onValueChange={(v) =>
          onChange(Number(Array.isArray(v) ? v[0] : v) / 100)
        }
      />
    </div>
  );
}
export default function Keys() {
  const [audio] = useState(() => new KeyboardAudio());
  const [patch, setPatch] = useState<Patch>(DEFAULT),
    [base, setBase] = useState(48),
    [transpose, setTranspose] = useState(0),
    [dark, setDark] = useState(false),
    [help, setHelp] = useState(false),
    [recorderOpen, setRecorderOpen] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const [audioState, setAudioState] = useState<
      'off' | 'loading' | 'ready' | 'error'
    >('off'),
    [progress, setProgress] = useState(0),
    [message, setMessage] = useState('Your keyboard is an instrument.'),
    [sustain, setSustain] = useState(false),
    [pedal, setPedal] = useState(false);
  const [live, setLive] = useState<LiveNote[]>([]),
    [playNotes, setPlayNotes] = useState<number[]>([]),
    [transport, setTransport] = useState<'idle' | 'recording' | 'playing'>(
      'idle',
    ),
    [elapsed, setElapsed] = useState(0),
    [take, setTake] = useState<Take | null>(null),
    [loop, setLoop] = useState(false),
    [exporting, setExporting] = useState(false);
  const [bpm, setBpm] = useState(100),
    [beats, setBeats] = useState(4),
    [subdivision, setSubdivision] = useState(1),
    [metro, setMetro] = useState(false),
    [beat, setBeat] = useState(-1),
    [clickVolume, setClickVolume] = useState(0.45),
    [countIn, setCountIn] = useState(false),
    [counting, setCounting] = useState(0);
  const sources = useRef(new Map<string, string>()),
    voices = useRef(new Map<string, LiveNote>()),
    serial = useRef(0),
    pressed = useRef(new Set<string>()),
    recordStart = useRef(0),
    recording = useRef(false),
    captured = useRef<RecordedNote[]>([]),
    snapshot = useRef({ patch: DEFAULT, bpm: 100 }),
    playTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    countTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    metroTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    metroVisual = useRef<ReturnType<typeof setTimeout>[]>([]),
    tapTimes = useRef<number[]>([]),
    canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({
    base,
    transpose,
    patch,
    sustain,
    pedal,
    loop,
    bpm,
    beats,
    subdivision,
    clickVolume,
    audioState,
    help,
    transport,
  });
  useLayoutEffect(() => {
    current.current = {
      base,
      transpose,
      patch,
      sustain,
      pedal,
      loop,
      bpm,
      beats,
      subdivision,
      clickVolume,
      audioState,
      help,
      transport,
    };
  });
  const actions = useRef({
    press: (_source: string, _offset: number) => {},
    release: (_source: string) => {},
    pedal: (_down: boolean) => {},
    panic: () => {},
    octave: (_delta: number) => {},
    metronome: () => {},
    record: () => {},
  });
  const sync = () => setLive([...voices.current.values()]);
  const finishVoice = (id: string) => {
    const n = voices.current.get(id);
    if (!n) return;
    audio.noteOff(id);
    if (recording.current)
      captured.current.push({
        id,
        midi: n.midi,
        velocity: n.velocity,
        time: Math.max(0, n.start - recordStart.current),
        duration: Math.max(0.01, audio.time - n.start),
      });
    voices.current.delete(id);
  };
  const release = (source: string) => {
    const id = sources.current.get(source);
    if (!id) return;
    sources.current.delete(source);
    const n = voices.current.get(id);
    if (!n) return;
    if (current.current.sustain || current.current.pedal) n.released = true;
    else finishVoice(id);
    sync();
  };
  const press = (source: string, offset: number) => {
    if (
      current.current.audioState !== 'ready' ||
      current.current.help ||
      countTimer.current
    )
      return;
    if (sources.current.has(source)) return;
    if (audio.context?.state === 'closed') {
      setAudioState('off');
      setMessage('Enable audio to reconnect after the update.');
      return;
    }
    if (audio.context?.state === 'suspended') void audio.context.resume();
    const midi = current.current.base + offset + current.current.transpose;
    const id = `live-${serial.current++}`;
    const n = {
      midi,
      offset,
      velocity: current.current.patch.velocity,
      released: false,
      start: audio.time,
    };
    sources.current.set(source, id);
    voices.current.set(id, n);
    audio.noteOn(id, midi, n.velocity);
    sync();
  };
  const releasePedal = (latched: boolean, space: boolean) => {
    if (!latched && !space) {
      for (const [id, n] of voices.current) if (n.released) finishVoice(id);
      sync();
    }
  };
  const releaseAll = () => {
    for (const id of voices.current.keys()) finishVoice(id);
    sources.current.clear();
    pressed.current.clear();
    setPedal(false);
    current.current.pedal = false;
    sync();
  };
  const stop = () => {
    if (countTimer.current) {
      clearTimeout(countTimer.current);
      countTimer.current = null;
      setCounting(0);
    }
    if (playTimer.current) {
      clearInterval(playTimer.current);
      playTimer.current = null;
    }
    if (recording.current) {
      releaseAll();
      const duration = Math.min(
        90.5,
        Math.max(0.1, audio.time - recordStart.current),
      );
      recording.current = false;
      const result: Take = {
        version: 1,
        notes: captured.current
          .filter((n) => n.time < duration)
          .map((n) => ({
            ...n,
            duration: Math.min(n.duration, duration - n.time),
          }))
          .sort((a, b) => a.time - b.time),
        duration,
        bpm: snapshot.current.bpm,
        patch: { ...snapshot.current.patch },
      };
      if (result.notes.length) {
        setTake(result);
        setMessage(
          'Take saved in this browser. Export MIDI or WAV to keep it.',
        );
        try {
          localStorage.setItem('keys.take', JSON.stringify(result));
        } catch {
          setMessage(
            'Browser storage unavailable. Export your take to keep it.',
          );
        }
      } else setMessage('No notes recorded. Your previous take is still here.');
    }
    audio.panic();
    audio.setPatch(current.current.patch);
    releaseAll();
    setTransport('idle');
    setPlayNotes([]);
    setElapsed(0);
  };
  async function enable() {
    if (audioState === 'loading') return;
    setAudioState('loading');
    setMessage('Loading the piano…');
    try {
      await audio.start(setProgress);
      setAudioState('ready');
      setMessage('Ready. Play the letter keys, or touch the piano.');
    } catch (e) {
      setAudioState('error');
      setMessage(
        e instanceof Error ? e.message : 'Audio could not start. Please retry.',
      );
    }
  }
  const beginRecord = () => {
    releaseAll();
    snapshot.current = {
      patch: { ...current.current.patch },
      bpm: current.current.bpm,
    };
    captured.current = [];
    recordStart.current = audio.time;
    recording.current = true;
    setElapsed(0);
    setTransport('recording');
    setMessage('Recording · up to 90 seconds. Click Stop when you are done.');
  };
  function record() {
    if (recording.current || countTimer.current) {
      stop();
      return;
    }
    if (current.current.audioState !== 'ready') return;
    stop();
    if (countIn) {
      const resumeMetro = metro;
      setMetro(false);
      const c = current.current;
      const t = audio.time + 0.06;
      const span = 60 / c.bpm;
      setCounting(c.beats);
      for (let b = 0; b < c.beats; b++)
        audio.click(t + b * span, b === 0, c.clickVolume);
      const tick = () => {
        const left = c.beats - Math.floor(Math.max(0, audio.time - t) / span);
        if (left <= 0) {
          countTimer.current = null;
          setCounting(0);
          setMetro(resumeMetro);
          beginRecord();
        } else {
          setCounting(left);
          countTimer.current = setTimeout(tick, 30);
        }
      };
      countTimer.current = setTimeout(tick, 30);
    } else beginRecord();
  }
  function play() {
    if (transport === 'playing') {
      stop();
      return;
    }
    if (!take || audioState !== 'ready') return;
    stop();
    audio.setPatch(take.patch);
    const start = audio.time + 0.06;
    let cycle = 0,
      index = 0,
      lastLoop = current.current.loop,
      endTime = lastLoop ? Infinity : start + take.duration;
    setTransport('playing');
    setMessage('Playing your take.');
    const schedule = () => {
      const now = audio.time,
        wantsLoop = current.current.loop;
      if (lastLoop !== wantsLoop) {
        endTime = wantsLoop
          ? Infinity
          : start +
            (Math.floor(Math.max(0, now - start) / take.duration) + 1) *
              take.duration;
        lastLoop = wantsLoop;
      }
      if (now >= endTime) {
        stop();
        return;
      }
      while (true) {
        if (index >= take.notes.length) {
          if (!wantsLoop) break;
          cycle++;
          index = 0;
        }
        const n = take.notes[index];
        if (!n) break;
        const time = start + cycle * take.duration + n.time;
        if (time >= now + 0.1 || time >= endTime) break;
        const id = `play-${cycle}-${index}`;
        audio.noteOn(id, n.midi, n.velocity, Math.max(now, time), take.patch);
        audio.noteOff(id, Math.max(now + 0.01, time + n.duration));
        index++;
      }
      const position = Math.max(0, now - start) % take.duration;
      setElapsed(position);
      setPlayNotes(
        take.notes
          .filter((n) => n.time <= position && n.time + n.duration > position)
          .map((n) => n.midi),
      );
    };
    schedule();
    playTimer.current = setInterval(schedule, 25);
  }

  function toggleMetro() {
    if (audioState !== 'ready') return;
    setMetro((v) => !v);
  }
  const octave = (delta: number) => {
    if (current.current.transport !== 'idle' || countTimer.current) return;
    releaseAll();
    setBase((v) => clamp(v + delta * 12, 24, 72));
  };
  const panic = () => {
    stop();
    setSustain(false);
    setPedal(false);
    setMetro(false);
    audio.setPatch(current.current.patch);
    setMessage('All notes off.');
  };
  useLayoutEffect(() => {
    actions.current = {
      press,
      release,
      pedal: (down) => {
        current.current.pedal = down;
        setPedal(down);
        releasePedal(current.current.sustain, down);
      },
      panic,
      octave,
      metronome: toggleMetro,
      record,
    };
  });
  useEffect(() => {
    audio.setPatch(patch);
  }, [audio, patch]);
  useEffect(
    () =>
      registerInstrumentTools(
        () => ({
          bpm: current.current.bpm,
          transpose: current.current.transpose,
          instrument: current.current.patch.instrument,
          audio: current.current.audioState,
          transport: current.current.transport,
        }),
        async (settings) => {
          if (current.current.transport !== 'idle' || countTimer.current)
            throw new Error(
              'Stop recording or playback before changing settings.',
            );
          actions.current.panic();
          setBpm(settings.bpm);
          setTranspose(settings.transpose);
          setPatch((p) => ({ ...p, instrument: settings.instrument }));
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return {
            bpm: current.current.bpm,
            transpose: current.current.transpose,
            instrument: current.current.patch.instrument,
          };
        },
      ),
    [],
  );
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem('keys.take') || 'null');
        if (validTake(saved)) {
          saved.notes.sort((a, b) => a.time - b.time);
          setTake(saved);
        }
        setDark(localStorage.getItem('keys.theme') === 'dark');
      } catch {
        /* storage is optional */
      }
    });
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('keys.theme', dark ? 'dark' : 'light');
    } catch {}
  }, [dark]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.isComposing)
        return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[role="slider"],[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (e.code === 'Escape') {
        actions.current.panic();
        return;
      }
      if (e.code === 'Space') {
        if (target.closest('button')) return;
        e.preventDefault();
        actions.current.pedal(true);
        return;
      }
      const offset = KEY_OFFSETS[e.code];
      if (offset !== undefined) {
        e.preventDefault();
        pressed.current.add(e.code);
        actions.current.press('key-' + e.code, offset);
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        actions.current.octave(e.code === 'ArrowLeft' ? -1 : 1);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        actions.current.pedal(false);
      }
      if (pressed.current.has(e.code)) {
        pressed.current.delete(e.code);
        actions.current.release('key-' + e.code);
      }
    };
    const blur = () => actions.current.panic();
    const hidden = () => {
      if (document.hidden) blur();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      if (playTimer.current) clearInterval(playTimer.current);
      if (countTimer.current) clearTimeout(countTimer.current);
      audio.dispose();
    };
  }, [audio]);
  useEffect(() => {
    if (transport !== 'recording') return;
    const timer = setInterval(() => {
      const seconds = audio.time - recordStart.current;
      setElapsed(seconds);
      if (seconds >= 90) actions.current.record();
    }, 50);
    return () => clearInterval(timer);
  }, [transport, audio]);
  useEffect(() => {
    if (!metro || !audio.context) return;
    let next = audio.time + 0.06,
      step = 0;
    const tick = () => {
      const c = current.current;
      while (next < audio.time + 0.1) {
        const beatIndex = Math.floor(step / c.subdivision) % c.beats;
        const isBeat = step % c.subdivision === 0;
        audio.click(
          next,
          isBeat && beatIndex === 0,
          isBeat ? c.clickVolume : c.clickVolume * 0.45,
        );
        if (isBeat) {
          const delay = Math.max(0, (next - audio.time) * 1000);
          const timer = setTimeout(() => setBeat(beatIndex), delay);
          metroVisual.current.push(timer);
        }
        next += 60 / c.bpm / c.subdivision;
        step++;
      }
      metroVisual.current = metroVisual.current.slice(-16);
    };
    tick();
    metroTimer.current = setInterval(tick, 25);
    return () => {
      if (metroTimer.current) clearInterval(metroTimer.current);
      for (const timer of metroVisual.current) clearTimeout(timer);
      metroVisual.current = [];
    };
  }, [metro, audio, beats, subdivision]);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const el = canvas.current,
        ctx = el?.getContext('2d'),
        analyser = audio.analyser;
      if (el && ctx) {
        const width = el.width,
          height = el.height;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = dark ? '#8aa6cc' : '#3c5a82';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        const values = new Uint8Array(256);
        if (analyser) analyser.getByteTimeDomainData(values);
        else values.fill(128);
        for (let i = 0; i < values.length; i++) {
          const x = (i / (values.length - 1)) * width,
            y = height / 2 + ((values[i] - 128) / 128) * height * 0.46;
          if (!i) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [audio, dark]);
  const activeMidi = [
      ...new Set([...live.map((n) => n.midi), ...playNotes]),
    ].sort((a, b) => a - b),
    chord = identifyChord(activeMidi),
    busy = transport !== 'idle' || counting > 0;
  let whiteIndex = 0;
  const pianoKeys = KEY_CODES.map((code, offset) => {
    const black = isBlack(base + offset);
    const position = black ? whiteIndex - 0.31 : whiteIndex++;
    return { code, offset, black, position };
  });
  const tap = () => {
    const now = performance.now();
    tapTimes.current = tapTimes.current.filter((t) => now - t < 3000).slice(-5);
    tapTimes.current.push(now);
    if (tapTimes.current.length > 1) {
      const a = tapTimes.current;
      setBpm(
        clamp(
          Math.round(60000 / ((a[a.length - 1] - a[0]) / (a.length - 1))),
          30,
          240,
        ),
      );
    }
  };
  const handlePointer = (e: React.PointerEvent, offset: number) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    press('pointer-' + e.pointerId, offset);
  };
  const movePointer = (e: React.PointerEvent) => {
    if (!e.buttons && e.pointerType === 'mouse') return;
    const source = 'pointer-' + e.pointerId;
    if (!sources.current.has(source)) return;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-note-offset]');
    if (target) {
      const offset = Number(target.dataset.noteOffset);
      const currentId = sources.current.get(source);
      if (voices.current.get(currentId!)?.offset !== offset) {
        release(source);
        press(source, offset);
      }
    }
  };
  async function exportWav() {
    if (!take) return;
    setExporting(true);
    setMessage('Rendering your take as WAV…');
    try {
      await audio.start();
      const data = await audio.exportWav(take);
      saveFile(data, 'audio/wav', 'keys-take.wav');
      setMessage('WAV exported · stereo, 44.1 kHz, 16-bit.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not export audio.');
    } finally {
      setExporting(false);
    }
  }
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setMessage(
        'Fullscreen is unavailable here. Expand the browser panel instead.',
      );
    }
  };
  return (
    <div className="keys-app">
      <header className="appbar">
<a className="studio-brand" href="https://raito.studio/" aria-label="Raito Studio home"><span className="studio-mark" aria-hidden="true"></span><span className="studio-wordmark"><strong>Raito</strong> Studio Tools</span></a><nav className="studio-nav" aria-label="Raito Studio apps"><a href="https://tally.raito.studio/" title="Write and analyze text, character counts and lyrics.">TALLY</a><a href="https://carve.raito.studio/" title="Trim, edit and export audio in your browser.">CARVE</a><a href="https://keys.raito.studio/" aria-current="page" title="Play piano and organ, practice and record ideas.">KEYS</a><a href="https://raito-pitch.raito853161.chatgpt.site/" title="Tune guitar, bass and other instruments.">PITCH</a></nav>
        <div className="appbar-right">
          <Button
            variant="ghost"
            size="icon"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title="Fullscreen"
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          <span
            className={`audio-led ${audioState === 'ready' ? 'ready' : ''}`}
            aria-hidden="true"
          />
          <span className="audio-label">
            {audioState === 'ready' ? 'AUDIO READY' : 'LOCAL INSTRUMENT'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={dark ? 'Use light theme' : 'Use dark theme'}
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Help and keyboard shortcuts"
            onClick={() => {
              panic();
              setHelp(true);
            }}
          >
            <CircleHelp />
          </Button>
        </div>
      </header>
      <main className="workspace">
        <section className="instrument panel" aria-label="Keyboard instrument">
          <div className="panel-bar">
            <span>
              <Keyboard size={16} /> INSTRUMENT
            </span>
            <span>29 KEYS · POLYPHONIC</span>
          </div>
          {audioState !== 'ready' && (
            <div className="enable-audio">
              <div>
                <b>
                  {audioState === 'loading'
                    ? `Loading piano · ${Math.round(progress * 100)}%`
                    : 'Ready when you are.'}
                </b>
                <span>
                  {audioState === 'loading'
                    ? 'Preparing the keys…'
                    : 'Enable audio once, then play with your computer keyboard.'}
                </span>
              </div>
              <Button onClick={enable} disabled={audioState === 'loading'}>
                <Volume2 />
                {audioState === 'error'
                  ? 'Retry audio'
                  : audioState === 'loading'
                    ? 'Loading…'
                    : 'Enable audio'}
              </Button>
            </div>
          )}
          <div className="instrument-controls">
            <fieldset className="sound-picker" aria-label="Instrument sound">
              <Button
                variant={patch.instrument === 'piano' ? 'default' : 'ghost'}
                aria-pressed={patch.instrument === 'piano'}
                disabled={busy}
                onClick={() => {
                  releaseAll();
                  setPatch({ ...patch, instrument: 'piano' });
                }}
              >
                <Piano /> Grand piano
              </Button>
              <Button
                variant={patch.instrument === 'organ' ? 'default' : 'ghost'}
                aria-pressed={patch.instrument === 'organ'}
                disabled={busy}
                onClick={() => {
                  releaseAll();
                  setPatch({ ...patch, instrument: 'organ' });
                }}
              >
                <Waves /> Tonewheel organ
              </Button>
            </fieldset>
            <div className="sound-controls">
              <Control
                disabled={busy}
                label="VOLUME"
                value={patch.volume}
                onChange={(v) => setPatch({ ...patch, volume: v })}
              />
              <Control
                disabled={busy}
                label="TONE"
                value={patch.tone}
                onChange={(v) => setPatch({ ...patch, tone: v })}
              />
              <Control
                disabled={busy}
                label="ROOM"
                value={patch.reverb}
                onChange={(v) => setPatch({ ...patch, reverb: v })}
              />
            </div>
          </div>
          <div className="performance">
            <div className="chord-readout">
              <span className="eyebrow">NOW PLAYING</span>
              <div className="chord-name">{chord.name}</div>
              <span className="chord-detail">{chord.detail}</span>
            </div>
            <div className="note-readout">
              <div className="notes">
                {activeMidi.length ? (
                  activeMidi.map((n) => <span key={n}>{noteName(n)}</span>)
                ) : (
                  <span className="notes-empty">
                    Z X C V B N M &nbsp; / &nbsp; Q W E R T Y U
                  </span>
                )}
              </div>
              <canvas
                ref={canvas}
                width={460}
                height={64}
                aria-label="Live audio waveform"
              />
              <div className="readout-bottom">
                <span>
                  {patch.instrument === 'piano'
                    ? 'SALAMANDER GRAND'
                    : 'ADDITIVE TONEWHEEL'}
                </span>
                <span>
                  {activeMidi.length.toString().padStart(2, '0')} ACTIVE NOTES
                </span>
              </div>
            </div>
          </div>
          <div className="keyboard-scroll">
            <div className="keyboard-bed">
              <div
                className="keyboard"
                style={{ '--white-count': whiteIndex } as React.CSSProperties}
              >
                {pianoKeys.map((k) => {
                  const held =
                    live.some((n) => n.offset === k.offset && !n.released) ||
                    playNotes.includes(base + k.offset + transpose);
                  const ringing = live.some(
                    (n) => n.offset === k.offset && n.released,
                  );
                  return (
                    <button
                      key={k.code}
                      className={`piano-key ${k.black ? 'black' : 'white'} ${held ? 'held' : ''} ${ringing ? 'sustained' : ''}`}
                      style={{
                        left: `${(k.position / whiteIndex) * 100}%`,
                        width: `${((k.black ? 0.62 : 1) / whiteIndex) * 100}%`,
                      }}
                      data-note-offset={k.offset}
                      aria-label={`${noteName(base + k.offset)}${transpose ? `, sounds ${noteName(base + k.offset + transpose)}` : ''}, computer keys ${labelsForOffset(k.offset).join(' or ')}`}
                      aria-pressed={held}
                      onPointerDown={(e) => handlePointer(e, k.offset)}
                      onPointerMove={movePointer}
                      onPointerUp={(e) => release('pointer-' + e.pointerId)}
                      onPointerCancel={(e) => release('pointer-' + e.pointerId)}
                      onLostPointerCapture={(e) =>
                        release('pointer-' + e.pointerId)
                      }
                      onKeyDown={(e) => {
                        if (e.code === 'Enter' || e.code === 'Space') {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!e.repeat)
                            press('accessible-' + k.offset, k.offset);
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.code === 'Enter' || e.code === 'Space') {
                          e.preventDefault();
                          e.stopPropagation();
                          release('accessible-' + k.offset);
                        }
                      }}
                      onBlur={() => release('accessible-' + k.offset)}
                    >
                      <span className="note-name">
                        {noteName(base + k.offset)}
                      </span>
                      <kbd>
                        {KEY_LABELS[k.offset]}
                        {labelsForOffset(k.offset)
                          .slice(1)
                          .map((label) => (
                            <small key={label}>{label}</small>
                          ))}
                      </kbd>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="keyboard-footer">
            <span>
              <kbd>SPACE</kbd> Hold to sustain <i>·</i> <kbd>←</kbd>
              <kbd>→</kbd> Octave
            </span>
            <Button variant="ghost" className="panic" onClick={panic}>
              <Square size={12} /> All notes off <kbd>ESC</kbd>
            </Button>
          </div>
        </section>
        <div className="utility-grid">
          <section
            className="panel play-settings"
            aria-labelledby="performance-title"
          >
            <div className="panel-bar">
              <h3 id="performance-title">
                <SlidersHorizontal size={16} /> PLAY SETTINGS
              </h3>
              <span>01</span>
            </div>
            <div className="settings-body">
              <div className="setting-row">
                <div>
                  <b>Transpose</b>
                  <small>Semitones · output pitch</small>
                </div>
                <div className="stepper">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Transpose down one semitone"
                    disabled={busy || transpose <= -12}
                    onClick={() => {
                      releaseAll();
                      setTranspose(transpose - 1);
                    }}
                  >
                    <Minus />
                  </Button>
                  <output>
                    {transpose > 0 ? '+' : ''}
                    {transpose}
                  </output>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Transpose up one semitone"
                    disabled={busy || transpose >= 12}
                    onClick={() => {
                      releaseAll();
                      setTranspose(transpose + 1);
                    }}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Reset transpose"
                    disabled={busy || !transpose}
                    onClick={() => {
                      releaseAll();
                      setTranspose(0);
                    }}
                  >
                    <RotateCcw size={13} />
                  </Button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <b>Octave</b>
                  <small>Computer keyboard starts at</small>
                </div>
                <div className="stepper">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Lower octave"
                    disabled={busy || base <= 24}
                    onClick={() => octave(-1)}
                  >
                    <Minus />
                  </Button>
                  <output>{noteName(base)}</output>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Higher octave"
                    disabled={busy || base >= 72}
                    onClick={() => octave(1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <b>Sustain</b>
                  <small>
                    {pedal
                      ? 'Space pedal is down'
                      : 'Keep notes ringing after release'}
                  </small>
                </div>
                <Switch
                  aria-label="Latch sustain pedal"
                  checked={sustain}
                  onCheckedChange={(v) => {
                    current.current.sustain = v;
                    setSustain(v);
                    releasePedal(v, current.current.pedal);
                  }}
                />
              </div>
              <Control
                label="TOUCH / VELOCITY"
                value={patch.velocity}
                onChange={(v) =>
                  setPatch({ ...patch, velocity: Math.max(0.05, v) })
                }
              />
              <p className="micro-note">
                Computer keys have fixed velocity. Adjust touch here.
              </p>
            </div>
          </section>
          <section className="panel metronome" aria-labelledby="metro-title">
            <div className="panel-bar">
              <h3 id="metro-title">
                <span className="metro-icon">♩</span> METRONOME
              </h3>
              <span>02</span>
            </div>
            <div className="metro-body">
              <div className="tempo-row">
                <label className="tempo">
                  <input
                    type="number"
                    min="30"
                    max="240"
                    aria-label="Tempo in beats per minute"
                    value={bpm}
                    onChange={(e) =>
                      setBpm(clamp(Number(e.target.value) || 30, 30, 240))
                    }
                  />
                  <span>BPM</span>
                </label>
                <Button variant="outline" onClick={tap}>
                  Tap tempo
                </Button>
              </div>
              <div
                className="beats"
                aria-label={`Beat ${beat + 1} of ${beats}`}
              >
                {Array.from({ length: beats }, (_, i) => (
                  <span key={i} className={metro && beat === i ? 'lit' : ''}>
                    {i + 1}
                  </span>
                ))}
              </div>
              <div className="metro-options">
                <label htmlFor="beats-per-bar">
                  BEATS
                  <NativeSelect
                    id="beats-per-bar"
                    aria-label="Beats per bar"
                    value={beats}
                    onChange={(e) => setBeats(Number(e.target.value))}
                  >
                    {[2, 3, 4, 5, 6, 7].map((v) => (
                      <option key={v} value={v}>
                        {v} / 4
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label htmlFor="beat-division">
                  DIVISION
                  <NativeSelect
                    id="beat-division"
                    aria-label="Metronome subdivision"
                    value={subdivision}
                    onChange={(e) => setSubdivision(Number(e.target.value))}
                  >
                    <option value={1}>Quarter</option>
                    <option value={2}>Eighth</option>
                    <option value={3}>Triplet</option>
                    <option value={4}>Sixteenth</option>
                  </NativeSelect>
                </label>
                <Button
                  className="metro-start"
                  variant={metro ? 'default' : 'outline'}
                  onClick={toggleMetro}
                  disabled={audioState !== 'ready'}
                >
                  {metro ? <Square /> : <Play />}
                  {metro ? 'Stop' : 'Start'}
                </Button>
              </div>
              <Control
                label="CLICK LEVEL"
                value={clickVolume}
                onChange={setClickVolume}
              />
            </div>
          </section>
          <Collapsible
            className="panel recorder"
            open={recorderOpen}
            onOpenChange={setRecorderOpen}
          >
            <div className="panel-bar">
              <h3 id="recorder-title">
                <Circle size={14} /> IDEA RECORDER
              </h3>
              <CollapsibleTrigger
                render={<Button variant="ghost" className="recorder-toggle" />}
              >
                {transport !== 'idle'
                  ? transport.toUpperCase()
                  : take
                    ? 'TAKE READY'
                    : 'Open recorder'}{' '}
                <ChevronDown className={recorderOpen ? 'expanded' : ''} />
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="recorder-body">
                <div className="record-display">
                  <span
                    className={`record-state ${transport === 'recording' ? 'recording' : ''}`}
                  >
                    {counting
                      ? `COUNT IN · ${counting}`
                      : transport === 'recording'
                        ? '● RECORDING'
                        : transport === 'playing'
                          ? '▶ PLAYING'
                          : take
                            ? 'TAKE 01'
                            : 'NO TAKE YET'}
                  </span>
                  <time>
                    {formatTime(busy ? elapsed : (take?.duration ?? 0))}
                    <small>
                      .
                      {Math.floor(
                        ((busy ? elapsed : (take?.duration ?? 0)) % 1) * 10,
                      )}
                    </small>
                  </time>
                </div>
                <div
                  className="piano-roll"
                  aria-label={
                    take
                      ? `${take.notes.length} recorded notes`
                      : 'Your recorded notes will appear here'
                  }
                >
                  {take ? (
                    <svg
                      viewBox="0 0 400 58"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {take.notes.map((n, i) => (
                        <rect
                          key={i}
                          x={(n.time / take.duration) * 400}
                          y={48 - ((n.midi % 36) / 36) * 44}
                          width={Math.max(
                            1,
                            (n.duration / take.duration) * 400,
                          )}
                          height="3"
                          rx="1"
                        />
                      ))}
                      {transport === 'playing' && (
                        <line
                          x1={(elapsed / take.duration) * 400}
                          x2={(elapsed / take.duration) * 400}
                          y1="0"
                          y2="58"
                        />
                      )}
                    </svg>
                  ) : (
                    <p>Catch a melody. Keep an idea.</p>
                  )}
                </div>
                <div className="transport-buttons">
                  <Button
                    className="record-button"
                    variant={
                      transport === 'recording' ? 'destructive' : 'outline'
                    }
                    onClick={record}
                    disabled={audioState !== 'ready' || exporting}
                  >
                    <Circle size={13} />
                    {transport === 'recording' || counting ? 'Stop' : 'Record'}
                  </Button>
                  <Button
                    variant="outline"
                    aria-label="Play recorded take"
                    onClick={play}
                    disabled={
                      !take ||
                      audioState !== 'ready' ||
                      transport === 'recording' ||
                      !!counting ||
                      exporting
                    }
                  >
                    {transport === 'playing' ? <Square /> : <Play />}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label="Stop recording and playback"
                    onClick={stop}
                    disabled={!busy}
                  >
                    <Square />
                  </Button>
                  <Button
                    variant={loop ? 'secondary' : 'ghost'}
                    aria-label="Loop playback"
                    aria-pressed={loop}
                    onClick={() => setLoop(!loop)}
                  >
                    <Repeat2 />
                  </Button>
                  <label htmlFor="count-in" className="count-in">
                    Count-in{' '}
                    <Switch
                      id="count-in"
                      aria-label="One bar count-in before recording"
                      checked={countIn}
                      disabled={busy}
                      onCheckedChange={setCountIn}
                    />
                  </label>
                </div>
                <div className="export-row">
                  <span>
                    {take
                      ? `${take.notes.length} notes · ${take.patch.instrument}`
                      : 'Recorded on this device'}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={!take || busy || exporting}
                    onClick={() => {
                      if (take)
                        saveFile(
                          makeMidi(take).buffer as ArrayBuffer,
                          'audio/midi',
                          'keys-take.mid',
                        );
                    }}
                  >
                    <Download size={13} /> MIDI
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!take || busy || exporting}
                    onClick={exportWav}
                  >
                    <Download size={13} />
                    {exporting ? 'Rendering…' : 'WAV'}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <footer className="session-footer">
          <output aria-live="polite">{message}</output>
          <span>NO ACCOUNT. JUST PLAY.</span>
        </footer>
      </main>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog">
          <DialogTitle>Make yourself at home.</DialogTitle>
          <DialogDescription>
            KEYS · a browser instrument by Raito / Lisa Records.
          </DialogDescription>
          <div className="help-copy">
            <h4>Two rows, one piano</h4>
            <p>
              Play <b>Z X C V B N M , . /</b> for the lower white keys and{' '}
              <b>Q W E R T Y U I O P</b> for the upper keys. The letters and
              numbers above them play the black keys. Hold several keys for
              chords. The lower row continues through comma, period and slash; L
              and semicolon play the black keys between them. These five keys
              overlap Q, 2, W, 3 and E.
            </p>
            <p>
              <kbd>Space</kbd> is your sustain pedal. <kbd>←</kbd> /{' '}
              <kbd>→</kbd> shift octaves. <kbd>Esc</kbd> stops all notes. Use an
              English input source; Japanese IME composition can intercept keys.
            </p>
            <h4>Capture a take</h4>
            <p>
              Record up to 90 seconds. A new completed take replaces the
              previous one. MIDI exports notes and timing; WAV exports the
              recorded sound and room effect. The metronome is not included.
            </p>
            <h4>A note about computer keyboards</h4>
            <p>
              Some keyboards cannot report certain simultaneous key
              combinations. Try another voicing or an external keyboard if notes
              are missing. You can also use the on-screen keys with touch.
            </p>
            <h4>Sound &amp; credits</h4>
            <p>
              Grand piano samples:{' '}
              <a
                href="https://github.com/Tonejs/audio/tree/master/salamander"
                target="_blank"
                rel="noreferrer"
              >
                Salamander Grand Piano by Alexander Holm
              </a>
              , provided via Tone.js,{' '}
              <a
                href="https://creativecommons.org/licenses/by/3.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 3.0
              </a>
              . Pitch, envelope and tone are adjusted during playback. Organ
              synthesis and interface: KEYS.
            </p>
            <p>
              Your performance stays in this browser. Export a file before
              clearing browsing data. Piano samples are bundled with the app; no
              microphone access is used.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
