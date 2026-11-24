# KEYS — Play / Practice / Capture

Free browser piano and organ by Raito / Lisa-Rec K.K., using the light/dark visual language of TALLY and CARVE. The interface supports English and Japanese and is published at [keys.raito.studio](https://keys.raito.studio/).

## Run

Requires Node 22.13 or later (development here uses Node 24).

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 18768
```

Open http://localhost:18768 and click **Start playing**. Piano samples begin loading automatically; the first click is still required by browser audio policies. Use an English keyboard input source when playing with letter keys.

## Features

- 29 piano notes spanning C3–E5 by default, with 36 physical key-code bindings and up to 64 audio voices. Lower-row continuation `, L . ; / _` overlaps upper-row `Q 2 W 3 E R`, with independent note releases. The Japanese `IntlRo` key and US-layout `Shift` + `-` both cover `_`.
- Compact viewport-oriented layout, optional fullscreen button, and a collapsible recorder beneath the play settings and metronome.
- Sampled grand piano and additive tonewheel-style organ.
- Touch/mouse piano keyboard with pointer capture, glissando and multi-touch.
- Independent note releases, sustain latch/Shift or Space pedal, octave shift and ±12-semitone transpose.
- Chord labels, sounding-note names and a live waveform.
- Volume, tone, room reverb and fixed keyboard velocity.
- Sound, instrument, octave and tempo settings persist on the current device.
- If piano samples fail to load, the synthesized organ remains available immediately.
- Web Audio-clock metronome: 30–240 BPM, tap tempo, 2–7 beats, quarter/eighth/triplet/sixteenth divisions and click level.
- Up to 90-second takes, optional one-bar count-in, looped playback, browser-local take persistence.
- Standard MIDI file export and stereo 44.1 kHz / 16-bit PCM WAV rendering. Exports omit the metronome. Sustain is captured as note duration.
- Esc/blur/hidden-tab cleanup prevents stuck voices. The metronome and count-in are cancelled by the panic action.

A completed new take replaces the previous take. Export files to keep multiple ideas. Instrument/room/tone/volume are fixed while recording or playing, and exported using the take's captured patch; note velocities are captured individually.

## Audio attribution

The 30 bundled MP3 samples (about 1.92 MB) are from **Salamander Grand Piano**, by **Alexander Holm**, distributed via the [Tone.js audio repository](https://github.com/Tonejs/audio/tree/master/salamander), under [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/). The original README/license is retained at `public/audio/piano/LICENSE.txt`. Source MP3 files are unmodified; playback adjusts pitch, envelope, tone and room effect. These are a single sample layer with velocity-controlled gain, not the original full multi-velocity library.

Organ synthesis and reverb use Web Audio. No microphone, account, uploaded performance data or audio synthesis service is used. Google Fonts supplies Chakra Petch and IBM Plex Mono; system-font fallbacks remain usable if unavailable.

## Validation

```sh
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Tests cover polyphonic release/cancellation, note mapping, chord identification, MIDI timing/polyphony, WAV encoding, restored-take validation and agent-setting input validation. Audio lifecycle tests use a mock AudioContext: they do not claim audible quality or hardware keyboard rollover validation. Source lint is scoped to authored app/lib/tests; unused generated component-catalog files have upstream lint errors.

App and sample HTTP endpoints were verified locally. The optional `document.modelContext` tools (`read_keys_state`, `configure_keys`) are feature-detected and cleaned up on unmount. No supported live WebMCP validation surface was available, so actual browser registration has not been verified.

## Current limitations

Play-test piano release/reverb, organ level, chord voicings, loop transitions and exports in the intended browsers. Keyboard rollover is limited by hardware; MIDI controller input is not implemented. Chord recognition is a practical label for common exact pitch-class sets, not harmonic analysis. PC keys do not report touch velocity. Touch users can scroll the keyboard horizontally to reach the upper notes.

The app is deployed through OpenAI Sites and served on the custom domain `keys.raito.studio`.
