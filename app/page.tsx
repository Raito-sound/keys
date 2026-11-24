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
type Language = 'en' | 'ja';
const DEFAULT: Patch = {
  instrument: 'piano',
  volume: 0.7,
  reverb: 0.2,
  tone: 0.55,
  velocity: 0.72,
};
const CHORD_DETAILS_JA: Record<string, string> = {
  major: 'メジャー',
  minor: 'マイナー',
  'dominant 7th': 'ドミナント7th',
  'major 7th': 'メジャー7th',
  'minor 7th': 'マイナー7th',
  'suspended 2nd': 'サス2',
  'suspended 4th': 'サス4',
  diminished: 'ディミニッシュ',
  augmented: 'オーギュメント',
  'major 6th': 'メジャー6th',
  'minor 6th': 'マイナー6th',
  'diminished 7th': 'ディミニッシュ7th',
  'half-diminished': 'ハーフディミニッシュ',
  'added 9th': 'アド9',
  'dominant 9th': 'ドミナント9th',
  'minor 9th': 'マイナー9th',
  'open fifth': '5度',
};
function japaneseChordDetail(detail: string) {
  if (detail === 'Play a note or a chord')
    return '音またはコードを弾いてください';
  const [quality, inversion] = detail.split(' · ');
  const translated =
    CHORD_DETAILS_JA[quality] ?? quality.replace(/^(\d+) notes$/, '$1音');
  return inversion ? `${translated} · 転回形` : translated;
}
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
  const [language, setLanguage] = useState<Language>('en');
  const [languageReady, setLanguageReady] = useState(false);
  const tr = (english: string, japanese: string) =>
    language === 'ja' ? japanese : english;
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
    [sampleState, setSampleState] = useState<'loading' | 'ready' | 'error'>(
      'loading',
    ),
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
      setMessage(
        tr(
          'Enable audio to reconnect after the update.',
          '更新後に再接続するには、音を有効にしてください。',
        ),
      );
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
          tr(
            'Take saved in this browser. Export MIDI or WAV to keep it.',
            'テイクをブラウザに保存しました。残すにはMIDIまたはWAVへ書き出してください。',
          ),
        );
        try {
          localStorage.setItem('keys.take', JSON.stringify(result));
        } catch {
          setMessage(
            tr(
              'Browser storage unavailable. Export your take to keep it.',
              'ブラウザへ保存できません。残すにはテイクを書き出してください。',
            ),
          );
        }
      } else
        setMessage(
          tr(
            'No notes recorded. Your previous take is still here.',
            '音が録音されませんでした。前のテイクはそのまま残っています。',
          ),
        );
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
    setMessage(
      sampleState === 'ready'
        ? tr('Enabling audio…', '音声を有効にしています…')
        : tr('Finishing piano setup…', 'ピアノ音源の準備を完了しています…'),
    );
    try {
      await audio.start(setProgress);
      setSampleState('ready');
      setAudioState('ready');
      setMessage(
        tr(
          'Ready. Play the letter keys, or touch the piano.',
          '準備完了。英字キーまたは画面の鍵盤で演奏できます。',
        ),
      );
    } catch (e) {
      setSampleState('error');
      setAudioState('error');
      setMessage(
        e instanceof Error
          ? e.message
          : tr(
              'Audio could not start. Please retry.',
              '音声を開始できませんでした。もう一度お試しください。',
            ),
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
    setMessage(
      tr(
        'Recording · up to 90 seconds. Click Stop when you are done.',
        '録音中 · 最大90秒。終わったら停止を押してください。',
      ),
    );
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
    setMessage(tr('Playing your take.', 'テイクを再生しています。'));
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
    setMessage(tr('All notes off.', 'すべての音を停止しました。'));
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
    queueMicrotask(() => {
      const requested = new URLSearchParams(window.location.search).get('lang');
      let nextLanguage: Language | undefined =
        requested === 'ja' || requested === 'en' ? requested : undefined;
      if (!nextLanguage) {
        try {
          const saved = localStorage.getItem('keys.language');
          if (saved === 'ja' || saved === 'en') nextLanguage = saved;
        } catch {
          /* storage is optional */
        }
      }
      if (!nextLanguage && navigator.language.toLowerCase().startsWith('ja'))
        nextLanguage = 'ja';
      setLanguage(nextLanguage ?? 'en');
      setLanguageReady(true);
    });
  }, []);
  useEffect(() => {
    if (!languageReady) return;
    document.documentElement.lang = language;
    document.title =
      language === 'ja'
        ? 'KEYS｜無料ブラウザピアノ・オルガン、録音とWAV保存'
        : 'KEYS — Online Piano & Organ with Recording | Raito Studio Tools';
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    if (description)
      description.content =
        language === 'ja'
          ? 'PCキーボードやタッチで弾ける無料ブラウザピアノ。メトロノームで練習し、最大90秒の演奏を録音してMIDI・WAVで保存できます。登録不要。'
          : 'Play piano and organ in your browser for free. Practice with a metronome, record short musical ideas and export MIDI or WAV. No installation required.';
    const url = new URL(window.location.href);
    if (language === 'ja') url.searchParams.set('lang', 'ja');
    else url.searchParams.delete('lang');
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
    try {
      localStorage.setItem('keys.language', language);
    } catch {
      /* storage is optional */
    }
  }, [language, languageReady]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('keys.theme', dark ? 'dark' : 'light');
    } catch {}
  }, [dark]);
  useEffect(() => {
    let active = true;
    void audio
      .preload((value) => {
        if (active) setProgress(value);
      })
      .then(() => {
        if (active) setSampleState('ready');
      })
      .catch(() => {
        if (active) setSampleState('error');
      });
    return () => {
      active = false;
    };
  }, [audio]);
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
    chordDetail =
      language === 'ja' ? japaneseChordDetail(chord.detail) : chord.detail,
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
    setMessage(
      tr('Rendering your take as WAV…', 'テイクをWAVに書き出しています…'),
    );
    try {
      await audio.start();
      const data = await audio.exportWav(take);
      saveFile(data, 'audio/wav', 'keys-take.wav');
      setMessage(
        tr(
          'WAV exported · stereo, 44.1 kHz, 16-bit.',
          'WAVを書き出しました · ステレオ、44.1 kHz、16-bit。',
        ),
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : tr('Could not export audio.', '音声を書き出せませんでした。'),
      );
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
        tr(
          'Fullscreen is unavailable here. Expand the browser panel instead.',
          'ここでは全画面表示を使えません。ブラウザの表示領域を広げてください。',
        ),
      );
    }
  };
  return (
    <div className="keys-app">
      <header className="appbar">
        <a
          className="studio-brand"
          href={
            language === 'ja'
              ? 'https://raito.studio/ja/'
              : 'https://raito.studio/'
          }
          aria-label={tr('Raito Studio home', 'Raito Studio ホーム')}
        >
          <span className="studio-mark" aria-hidden="true" />
          <span className="studio-wordmark">
            <strong>Raito</strong> Studio Tools
          </span>
        </a>
        <nav className="studio-nav" aria-label="Raito Studio apps">
          <a href="https://tally.raito.studio/">TALLY</a>
          <a href="https://carve.raito.studio/">CARVE</a>
          <a href="https://keys.raito.studio/" aria-current="page">
            KEYS
          </a>
          <a href="https://pitch.raito.studio/">PITCH</a>
        </nav>
        <div className="appbar-right">
          <div className="language-switch" aria-label={tr('Language', '言語')}>
            <button
              type="button"
              aria-pressed={language === 'en'}
              onClick={() => setLanguage('en')}
            >
              EN
            </button>
            <button
              type="button"
              aria-pressed={language === 'ja'}
              onClick={() => setLanguage('ja')}
            >
              日本語
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              fullscreen
                ? tr('Exit fullscreen', '全画面表示を終了')
                : tr('Enter fullscreen', '全画面表示')
            }
            title={tr('Fullscreen', '全画面表示')}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
          </Button>
          <span
            className={`audio-led ${audioState === 'ready' ? 'ready' : ''}`}
            aria-hidden="true"
          />
          <span className="audio-label">
            {audioState === 'ready'
              ? tr('AUDIO READY', '音声 準備完了')
              : tr('LOCAL INSTRUMENT', '端末内で動作')}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              dark
                ? tr('Use light theme', 'ライト表示にする')
                : tr('Use dark theme', 'ダーク表示にする')
            }
            onClick={() => setDark(!dark)}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr(
              'Help and keyboard shortcuts',
              'ヘルプとキーボード操作',
            )}
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
        <section
          className="instrument panel"
          aria-label={tr('Keyboard instrument', '鍵盤楽器')}
        >
          <div className="panel-bar">
            <span>
              <Keyboard size={16} /> {tr('INSTRUMENT', '楽器')}
            </span>
            <span>{tr('29 KEYS · POLYPHONIC', '29鍵 · ポリフォニック')}</span>
          </div>
          {audioState !== 'ready' && (
            <div className="audio-gate" aria-live="polite">
              <div className="audio-gate-card">
                <span className="eyebrow">
                  {tr('FREE BROWSER INSTRUMENT', '無料ブラウザピアノ')}
                </span>
                <strong>KEYS START!</strong>
                <p>
                  {sampleState === 'loading'
                    ? tr(
                        `Preparing the piano · ${Math.round(progress * 100)}%`,
                        `ピアノ音源を準備中 · ${Math.round(progress * 100)}%`,
                      )
                    : sampleState === 'error'
                      ? tr(
                          'The piano could not finish loading.',
                          'ピアノ音源を読み込めませんでした。',
                        )
                      : tr('The piano is ready.', 'ピアノの準備ができました。')}
                </p>
                <progress max="1" value={progress}>
                  {Math.round(progress * 100)}%
                </progress>
                <Button onClick={enable} disabled={audioState === 'loading'}>
                  <Play />
                  {audioState === 'loading'
                    ? tr('STARTING…', '開始しています…')
                    : sampleState === 'error'
                      ? tr('RETRY & START', '再試行してはじめる')
                      : tr('START PLAYING', '演奏をはじめる')}
                </Button>
                <small>
                  {tr(
                    'One click is required by your browser before sound can play.',
                    'ブラウザの仕様により、音を出す前に初回だけクリックが必要です。',
                  )}
                </small>
              </div>
            </div>
          )}
          <div className="instrument-controls">
            <fieldset
              className="sound-picker"
              aria-label={tr('Instrument sound', '楽器の音色')}
            >
              <Button
                variant={patch.instrument === 'piano' ? 'default' : 'ghost'}
                aria-pressed={patch.instrument === 'piano'}
                disabled={busy}
                onClick={() => {
                  releaseAll();
                  setPatch({ ...patch, instrument: 'piano' });
                }}
              >
                <Piano /> {tr('Grand piano', 'グランドピアノ')}
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
                <Waves /> {tr('Tonewheel organ', 'トーンホイールオルガン')}
              </Button>
            </fieldset>
            <div className="sound-controls">
              <Control
                disabled={busy}
                label={tr('VOLUME', '音量')}
                value={patch.volume}
                onChange={(v) => setPatch({ ...patch, volume: v })}
              />
              <Control
                disabled={busy}
                label={tr('TONE', '音色')}
                value={patch.tone}
                onChange={(v) => setPatch({ ...patch, tone: v })}
              />
              <Control
                disabled={busy}
                label={tr('ROOM', '残響')}
                value={patch.reverb}
                onChange={(v) => setPatch({ ...patch, reverb: v })}
              />
            </div>
          </div>
          <div className="performance">
            <div className="chord-readout">
              <span className="eyebrow">{tr('NOW PLAYING', '演奏中')}</span>
              <div className="chord-name">{chord.name}</div>
              <span className="chord-detail">{chordDetail}</span>
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
                aria-label={tr('Live audio waveform', '演奏中の音声波形')}
              />
              <div className="readout-bottom">
                <span>
                  {patch.instrument === 'piano'
                    ? 'SALAMANDER GRAND'
                    : 'ADDITIVE TONEWHEEL'}
                </span>
                <span>
                  {activeMidi.length.toString().padStart(2, '0')}{' '}
                  {tr('ACTIVE NOTES', '発音中')}
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
                      aria-label={tr(
                        `${noteName(base + k.offset)}${transpose ? `, sounds ${noteName(base + k.offset + transpose)}` : ''}, computer keys ${labelsForOffset(k.offset).join(' or ')}`,
                        `${noteName(base + k.offset)}${transpose ? `、実際の音 ${noteName(base + k.offset + transpose)}` : ''}、PCキー ${labelsForOffset(k.offset).join(' または ')}`,
                      )}
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
              <kbd>SPACE</kbd> {tr('Hold to sustain', '押してサステイン')}{' '}
              <i>·</i> <kbd>←</kbd>
              <kbd>→</kbd> {tr('Octave', 'オクターブ')}
            </span>
            <Button variant="ghost" className="panic" onClick={panic}>
              <Square size={12} /> {tr('All notes off', 'すべての音を停止')}{' '}
              <kbd>ESC</kbd>
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
                <SlidersHorizontal size={16} />{' '}
                {tr('PLAY SETTINGS', '演奏設定')}
              </h3>
              <span>01</span>
            </div>
            <div className="settings-body">
              <div className="setting-row">
                <div>
                  <b>{tr('Transpose', '移調')}</b>
                  <small>
                    {tr('Semitones · output pitch', '半音単位 · 出力音程')}
                  </small>
                </div>
                <div className="stepper">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tr('Transpose down one semitone', '半音下げる')}
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
                    aria-label={tr('Transpose up one semitone', '半音上げる')}
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
                    aria-label={tr('Reset transpose', '移調をリセット')}
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
                  <b>{tr('Octave', 'オクターブ')}</b>
                  <small>
                    {tr('Computer keyboard starts at', 'PCキーボードの開始音')}
                  </small>
                </div>
                <div className="stepper">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tr('Lower octave', 'オクターブを下げる')}
                    disabled={busy || base <= 24}
                    onClick={() => octave(-1)}
                  >
                    <Minus />
                  </Button>
                  <output>{noteName(base)}</output>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tr('Higher octave', 'オクターブを上げる')}
                    disabled={busy || base >= 72}
                    onClick={() => octave(1)}
                  >
                    <Plus />
                  </Button>
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <b>{tr('Sustain', 'サステイン')}</b>
                  <small>
                    {pedal
                      ? tr(
                          'Space pedal is down',
                          'スペースキーのペダルを押しています',
                        )
                      : tr(
                          'Keep notes ringing after release',
                          'キーを離したあとも音を伸ばします',
                        )}
                  </small>
                </div>
                <Switch
                  aria-label={tr('Latch sustain pedal', 'サステインを固定')}
                  checked={sustain}
                  onCheckedChange={(v) => {
                    current.current.sustain = v;
                    setSustain(v);
                    releasePedal(v, current.current.pedal);
                  }}
                />
              </div>
              <Control
                label={tr('TOUCH / VELOCITY', 'タッチ / 強さ')}
                value={patch.velocity}
                onChange={(v) =>
                  setPatch({ ...patch, velocity: Math.max(0.05, v) })
                }
              />
              <p className="micro-note">
                {tr(
                  'Computer keys have fixed velocity. Adjust touch here.',
                  'PCキーの強さは一定です。ここで調整できます。',
                )}
              </p>
            </div>
          </section>
          <section className="panel metronome" aria-labelledby="metro-title">
            <div className="panel-bar">
              <h3 id="metro-title">
                <span className="metro-icon">♩</span>{' '}
                {tr('METRONOME', 'メトロノーム')}
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
                    aria-label={tr(
                      'Tempo in beats per minute',
                      '1分あたりの拍数',
                    )}
                    value={bpm}
                    onChange={(e) =>
                      setBpm(clamp(Number(e.target.value) || 30, 30, 240))
                    }
                  />
                  <span>BPM</span>
                </label>
                <Button variant="outline" onClick={tap}>
                  {tr('Tap tempo', 'タップでテンポ設定')}
                </Button>
              </div>
              <div
                className="beats"
                aria-label={tr(
                  `Beat ${beat + 1} of ${beats}`,
                  `${beats}拍中の${beat + 1}拍目`,
                )}
              >
                {Array.from({ length: beats }, (_, i) => (
                  <span key={i} className={metro && beat === i ? 'lit' : ''}>
                    {i + 1}
                  </span>
                ))}
              </div>
              <div className="metro-options">
                <label htmlFor="beats-per-bar">
                  {tr('BEATS', '拍子')}
                  <NativeSelect
                    id="beats-per-bar"
                    aria-label={tr('Beats per bar', '1小節の拍数')}
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
                  {tr('DIVISION', '細分化')}
                  <NativeSelect
                    id="beat-division"
                    aria-label={tr(
                      'Metronome subdivision',
                      'メトロノームの細分化',
                    )}
                    value={subdivision}
                    onChange={(e) => setSubdivision(Number(e.target.value))}
                  >
                    <option value={1}>{tr('Quarter', '4分音符')}</option>
                    <option value={2}>{tr('Eighth', '8分音符')}</option>
                    <option value={3}>{tr('Triplet', '3連符')}</option>
                    <option value={4}>{tr('Sixteenth', '16分音符')}</option>
                  </NativeSelect>
                </label>
                <Button
                  className="metro-start"
                  variant={metro ? 'default' : 'outline'}
                  onClick={toggleMetro}
                  disabled={audioState !== 'ready'}
                >
                  {metro ? <Square /> : <Play />}
                  {metro ? tr('Stop', '停止') : tr('Start', '開始')}
                </Button>
              </div>
              <Control
                label={tr('CLICK LEVEL', 'クリック音量')}
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
                <Circle size={14} /> {tr('IDEA RECORDER', 'アイデア録音')}
              </h3>
              <CollapsibleTrigger
                render={<Button variant="ghost" className="recorder-toggle" />}
              >
                {transport !== 'idle'
                  ? transport === 'recording'
                    ? tr('RECORDING', '録音中')
                    : tr('PLAYING', '再生中')
                  : take
                    ? tr('TAKE READY', 'テイクあり')
                    : tr('Open recorder', 'レコーダーを開く')}{' '}
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
                      ? tr(`COUNT IN · ${counting}`, `カウント · ${counting}`)
                      : transport === 'recording'
                        ? tr('● RECORDING', '● 録音中')
                        : transport === 'playing'
                          ? tr('▶ PLAYING', '▶ 再生中')
                          : take
                            ? tr('TAKE 01', 'テイク 01')
                            : tr('NO TAKE YET', 'テイクなし')}
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
                      ? tr(
                          `${take.notes.length} recorded notes`,
                          `録音済み ${take.notes.length}音`,
                        )
                      : tr(
                          'Your recorded notes will appear here',
                          '録音した音がここに表示されます',
                        )
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
                    <p>
                      {tr(
                        'Catch a melody. Keep an idea.',
                        'メロディーを録音して、アイデアを残す。',
                      )}
                    </p>
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
                    {transport === 'recording' || counting
                      ? tr('Stop', '停止')
                      : tr('Record', '録音')}
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={tr(
                      'Play recorded take',
                      '録音したテイクを再生',
                    )}
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
                    aria-label={tr(
                      'Stop recording and playback',
                      '録音と再生を停止',
                    )}
                    onClick={stop}
                    disabled={!busy}
                  >
                    <Square />
                  </Button>
                  <Button
                    variant={loop ? 'secondary' : 'ghost'}
                    aria-label={tr('Loop playback', 'ループ再生')}
                    aria-pressed={loop}
                    onClick={() => setLoop(!loop)}
                  >
                    <Repeat2 />
                  </Button>
                  <label htmlFor="count-in" className="count-in">
                    {tr('Count-in', 'カウントイン')}{' '}
                    <Switch
                      id="count-in"
                      aria-label={tr(
                        'One bar count-in before recording',
                        '録音前に1小節カウントする',
                      )}
                      checked={countIn}
                      disabled={busy}
                      onCheckedChange={setCountIn}
                    />
                  </label>
                </div>
                <div className="export-row">
                  <span>
                    {take
                      ? `${take.notes.length}${tr(' notes', '音')} · ${
                          take.patch.instrument === 'piano'
                            ? tr('piano', 'ピアノ')
                            : tr('organ', 'オルガン')
                        }`
                      : tr('Recorded on this device', 'この端末内に録音')}
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
                    {exporting ? tr('Rendering…', '書き出し中…') : 'WAV'}
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <footer className="session-footer">
          <output aria-live="polite">
            {message === 'Your keyboard is an instrument.'
              ? tr(
                  'Your keyboard is an instrument.',
                  'PCキーボードが、楽器になります。',
                )
              : message}
          </output>
          <span>{tr('NO ACCOUNT. JUST PLAY.', '登録不要。すぐ演奏。')}</span>
        </footer>
      </main>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="help-dialog">
          <DialogTitle>
            {tr('Make yourself at home.', 'KEYSの弾き方')}
          </DialogTitle>
          <DialogDescription>
            {tr(
              'KEYS · a browser instrument by Raito / Lisa Records.',
              'KEYS · 来兎 / Lisa Recordsによるブラウザ楽器。',
            )}
          </DialogDescription>
          <div className="help-copy">
            <h4>{tr('Two rows, one piano', '2段のPCキーでピアノを弾く')}</h4>
            <p>
              {language === 'ja' ? (
                <>
                  下段の白鍵は <b>Z X C V B N M , . /</b>、上段の白鍵は{' '}
                  <b>Q W E R T Y U I O P</b> です。その上の英字・数字キーが
                  黒鍵になります。複数のキーを押すと和音を弾けます。下段は
                  カンマ、ピリオド、スラッシュ、アンダースコアまで続き、その間の
                  黒鍵はLとセミコロンです。この6音はQ、2、W、3、E、Rと
                  重なります。
                </>
              ) : (
                <>
                  Play <b>Z X C V B N M , . /</b> for the lower white keys and{' '}
                  <b>Q W E R T Y U I O P</b> for the upper keys. The letters and
                  numbers above them play the black keys. Hold several keys for
                  chords. The lower row continues through comma, period and
                  slash and underscore; L and semicolon play the black keys
                  between them. These six keys overlap Q, 2, W, 3, E and R.
                </>
              )}
            </p>
            <p>
              {language === 'ja' ? (
                <>
                  <kbd>Space</kbd> はサステインペダル、<kbd>←</kbd> /{' '}
                  <kbd>→</kbd> はオクターブ移動、<kbd>Esc</kbd> は全音停止です。
                  日本語入力がキーを受け取らないよう、英語入力に切り替えてください。
                </>
              ) : (
                <>
                  <kbd>Space</kbd> is your sustain pedal. <kbd>←</kbd> /{' '}
                  <kbd>→</kbd> shift octaves. <kbd>Esc</kbd> stops all notes.
                  Use an English input source; Japanese IME composition can
                  intercept keys.
                </>
              )}
            </p>
            <h4>{tr('Capture a take', 'テイクを録音する')}</h4>
            <p>
              {tr(
                'Record up to 90 seconds. A new completed take replaces the previous one. MIDI exports notes and timing; WAV exports the recorded sound and room effect. The metronome is not included.',
                '最大90秒まで録音できます。新しいテイクを録り終えると、前のテイクは置き換わります。MIDIには音とタイミング、WAVには録音した音色と残響を書き出します。メトロノーム音は含まれません。',
              )}
            </p>
            <h4>
              {tr(
                'A note about computer keyboards',
                'PCキーボードの同時押しについて',
              )}
            </h4>
            <p>
              {tr(
                'Some keyboards cannot report certain simultaneous key combinations. Try another voicing or an external keyboard if notes are missing. You can also use the on-screen keys with touch.',
                'PCキーボードによっては、特定のキーを同時に認識できません。音が抜ける場合は和音の押さえ方を変えるか、別のPCキーボードをお試しください。画面の鍵盤はタッチでも演奏できます。',
              )}
            </p>
            <h4>{tr('Sound & credits', '音源とクレジット')}</h4>
            <p>
              {tr('Grand piano samples:', 'グランドピアノ音源:')}{' '}
              <a
                href="https://github.com/Tonejs/audio/tree/master/salamander"
                target="_blank"
                rel="noreferrer"
              >
                Salamander Grand Piano by Alexander Holm
              </a>
              , {tr('provided via Tone.js', 'Tone.jsを通じて使用')},{' '}
              <a
                href="https://creativecommons.org/licenses/by/3.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 3.0
              </a>
              .{' '}
              {tr(
                'Pitch, envelope and tone are adjusted during playback. Organ synthesis and interface: KEYS.',
                '再生時に音程、エンベロープ、音色を調整しています。オルガン合成とインターフェース: KEYS。',
              )}
            </p>
            <p>
              {tr(
                'Your performance stays in this browser. Export a file before clearing browsing data. Piano samples are bundled with the app; no microphone access is used.',
                '演奏・録音データはこのブラウザ内に留まり、サーバーへ送信しません。ブラウザデータを消す前にファイルへ書き出してください。ピアノ音源はアプリに同梱され、マイクは使用しません。',
              )}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
