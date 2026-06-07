// ════════════════════════════════════════════════════════════════════════
//  REALM — audio.js
//  Fully procedural Web Audio. No audio files. All methods are safe no-ops
//  before start() is called from a user gesture.
// ════════════════════════════════════════════════════════════════════════

import { FLIGHT, clamp } from './constants.js';

// ── Shared tuning ──────────────────────────────────────────────────────
const PAD_VOICES = [
  { freq: 55.0,   detune:   0, type: 'sine'     },
  { freq: 55.0,   detune:  +7, type: 'triangle' },
  { freq: 82.4,   detune:  -5, type: 'sine'     },
  { freq: 110.0,  detune: +12, type: 'triangle' },
  { freq: 164.8,  detune:  -3, type: 'sine'     },
];

const WIND_NOISE_FREQ_LOW   = 180;   // Hz — highpass (keeps low rumble out)
const WIND_NOISE_FREQ_HIGH  = 900;   // Hz — lowpass ceiling
const WIND_GAIN_MIN         = 0.02;
const WIND_GAIN_MAX         = 0.22;
const WIND_LP_MIN           = 300;
const WIND_LP_MAX           = 1800;

const PAD_MASTER_GAIN = 0.14;
const WIND_MASTER_GAIN = 1.0;

// ── Pentatonic scale for mote chimes (A minor pentatonic, 4 octaves) ──
const MOTE_FREQS = [
  220, 261.6, 329.6, 392, 440,
  523.2, 659.2, 784, 880, 1046.5,
];

// ── Fifths for finale swell ──
const FINALE_FREQS = [55, 82.4, 110, 164.8, 220, 329.6, 440, 659.2];

// ── Helper: create a short-lived gain ramp ──────────────────────────
function rampGain(gainNode, ac, startVal, peakVal, peakTime, endVal, endTime) {
  gainNode.gain.cancelScheduledValues(ac.currentTime);
  gainNode.gain.setValueAtTime(startVal, ac.currentTime);
  gainNode.gain.linearRampToValueAtTime(peakVal, ac.currentTime + peakTime);
  gainNode.gain.exponentialRampToValueAtTime(
    Math.max(endVal, 0.0001),
    ac.currentTime + endTime
  );
}

// ── Helper: white noise buffer (1s, mono) ──────────────────────────
function makeNoiseBuffer(ac, seconds = 1) {
  const len = Math.ceil(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ── Helper: safeConnect — connect A→B, returns B ──
function conn(a, b) { a.connect(b); return b; }

// ══════════════════════════════════════════════════════════════════════
export function makeAudio() {
  // All state is null until start() is called.
  let ac = null;           // AudioContext
  let masterGain = null;   // final destination node
  let muffleLP   = null;   // lowpass for critical-energy
  let muffled    = false;

  // Pad
  let padGain    = null;
  let padOscs    = [];     // { osc, gain }
  let padLfoOsc  = null;
  let padLfoGain = null;
  let padLP      = null;

  // Wind
  let windGain   = null;
  let windLP     = null;
  let windHP     = null;
  let windSrc    = null;   // BufferSourceNode (looping noise)
  let windTargetGain = WIND_GAIN_MIN;
  let windTargetLP   = WIND_LP_MIN;

  // Fire crackle
  let crackleGain = null;
  let crackleNodes = [];   // [{src, am, amGain}]
  let crackleActive = false;

  // Tracking
  let started = false;
  let _zone   = 0;

  // ── safe guard ──────────────────────────────────────────────────
  function ready() { return started && ac !== null; }

  // ── start ───────────────────────────────────────────────────────
  function start() {
    if (started) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn('Realm audio: AudioContext unavailable', e);
      return;
    }
    started = true;

    // Master chain: masterGain → muffleLP → destination
    masterGain = ac.createGain();
    masterGain.gain.setValueAtTime(0.72, ac.currentTime);

    muffleLP = ac.createBiquadFilter();
    muffleLP.type = 'lowpass';
    muffleLP.frequency.setValueAtTime(20000, ac.currentTime);
    muffleLP.Q.setValueAtTime(0.7, ac.currentTime);

    masterGain.connect(muffleLP);
    muffleLP.connect(ac.destination);

    _startPad();
    _startWind();
  }

  // ── Ambient pad ─────────────────────────────────────────────────
  function _startPad() {
    padGain = ac.createGain();
    padGain.gain.setValueAtTime(PAD_MASTER_GAIN, ac.currentTime);

    padLP = ac.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.setValueAtTime(800, ac.currentTime);
    padLP.Q.setValueAtTime(1.2, ac.currentTime);

    padGain.connect(padLP);
    padLP.connect(masterGain);

    // Slow LFO modulates the LP cutoff (0.07 Hz, ±300 Hz depth)
    padLfoOsc = ac.createOscillator();
    padLfoOsc.type = 'sine';
    padLfoOsc.frequency.setValueAtTime(0.07, ac.currentTime);
    padLfoGain = ac.createGain();
    padLfoGain.gain.setValueAtTime(300, ac.currentTime);
    padLfoOsc.connect(padLfoGain);
    padLfoGain.connect(padLP.frequency);
    padLfoOsc.start();

    for (const v of PAD_VOICES) {
      const osc = ac.createOscillator();
      osc.type = v.type;
      osc.frequency.setValueAtTime(v.freq, ac.currentTime);
      osc.detune.setValueAtTime(v.detune, ac.currentTime);

      const g = ac.createGain();
      g.gain.setValueAtTime(1 / PAD_VOICES.length, ac.currentTime);

      osc.connect(g);
      g.connect(padGain);
      osc.start();
      padOscs.push({ osc, gain: g });
    }
  }

  // ── Wind ────────────────────────────────────────────────────────
  function _startWind() {
    const noiseBuf = makeNoiseBuffer(ac, 2);

    windSrc = ac.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;

    windHP = ac.createBiquadFilter();
    windHP.type = 'highpass';
    windHP.frequency.setValueAtTime(WIND_NOISE_FREQ_LOW, ac.currentTime);

    windLP = ac.createBiquadFilter();
    windLP.type = 'lowpass';
    windLP.frequency.setValueAtTime(WIND_LP_MIN, ac.currentTime);

    windGain = ac.createGain();
    windGain.gain.setValueAtTime(WIND_GAIN_MIN * WIND_MASTER_GAIN, ac.currentTime);

    windSrc.connect(windHP);
    windHP.connect(windLP);
    windLP.connect(windGain);
    windGain.connect(masterGain);
    windSrc.start();
  }

  // ── setSpeed ────────────────────────────────────────────────────
  function setSpeed(n) {
    if (!ready()) return;
    // n = speedNorm 0..1
    const t = clamp(n, 0, 1);
    windTargetGain = WIND_GAIN_MIN + t * (WIND_GAIN_MAX - WIND_GAIN_MIN);
    windTargetLP   = WIND_LP_MIN   + t * (WIND_LP_MAX - WIND_LP_MIN);
  }

  // ── setZone ─────────────────────────────────────────────────────
  function setZone(i) {
    if (!ready()) return;
    _zone = clamp(i, 0, 2);
    // Zone 2 (aurora) is quieter and more spacious — dim pad slightly
    const padVol = _zone === 2 ? 0.09 : PAD_MASTER_GAIN;
    padGain.gain.linearRampToValueAtTime(padVol, ac.currentTime + 2.5);
  }

  // ── setMuffle ───────────────────────────────────────────────────
  function setMuffle(on) {
    if (!ready()) return;
    if (on === muffled) return;
    muffled = on;
    const freq = on ? 420 : 20000;
    muffleLP.frequency.linearRampToValueAtTime(freq, ac.currentTime + 0.4);
    // Ominous slight gain reduction too
    masterGain.gain.linearRampToValueAtTime(on ? 0.45 : 0.72, ac.currentTime + 0.4);
  }

  // ── ring ────────────────────────────────────────────────────────
  function ring(perfect) {
    if (!ready()) return;
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.connect(masterGain);

    // Sub thump
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(perfect ? 100 : 75, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    const subG = ac.createGain();
    subG.gain.setValueAtTime(0, now);
    subG.gain.linearRampToValueAtTime(perfect ? 0.38 : 0.24, now + 0.005);
    subG.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    sub.connect(subG); subG.connect(gain);
    sub.start(now); sub.stop(now + 0.28);

    // Bright sweep-up: two detuned sines
    const freqs = perfect
      ? [880, 1320, 1760]
      : [660, 990, 1320];
    const detunes = [0, 7, -5];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqs[i] * 0.4, now);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * (perfect ? 2.2 : 1.8), now + 0.22);
      osc.detune.setValueAtTime(detunes[i], now);
      const og = ac.createGain();
      og.gain.setValueAtTime(0, now);
      og.gain.linearRampToValueAtTime(perfect ? 0.12 : 0.08, now + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, now + (perfect ? 1.1 : 0.7));
      osc.connect(og); og.connect(gain);
      osc.start(now); osc.stop(now + (perfect ? 1.2 : 0.8));
    }

    // Noise burst for the "whoosh" texture
    const nbuf = makeNoiseBuffer(ac, 0.3);
    const nsrc = ac.createBufferSource();
    nsrc.buffer = nbuf;
    const nfilt = ac.createBiquadFilter();
    nfilt.type = 'bandpass';
    nfilt.frequency.setValueAtTime(3200, now);
    nfilt.Q.setValueAtTime(0.6, now);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0, now);
    ng.gain.linearRampToValueAtTime(perfect ? 0.18 : 0.10, now + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    nsrc.connect(nfilt); nfilt.connect(ng); ng.connect(gain);
    nsrc.start(now); nsrc.stop(now + 0.32);

    gain.gain.setValueAtTime(1, now);
    gain.gain.setValueAtTime(0.0001, now + (perfect ? 1.3 : 0.9));
  }

  // ── mote ────────────────────────────────────────────────────────
  // FM bell: carrier + modulator ratio 2.756, fast mod-index decay, ~1.1s ring
  function mote(pitchMult) {
    if (!ready()) return;
    const now = ac.currentTime;
    const pm = pitchMult ?? 1.0;
    const freqIdx = Math.floor(Math.random() * MOTE_FREQS.length);
    const carrierFreq = MOTE_FREQS[freqIdx] * pm;
    const modFreq     = carrierFreq * 2.756;
    const modIndex    = 6.0; // index at peak (bright)

    const carrier  = ac.createOscillator();
    carrier.type   = 'sine';
    carrier.frequency.setValueAtTime(carrierFreq, now);

    const modulator  = ac.createOscillator();
    modulator.type   = 'sine';
    modulator.frequency.setValueAtTime(modFreq, now);

    const modGain = ac.createGain();
    modGain.gain.setValueAtTime(modIndex * modFreq, now);
    modGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18); // fast index decay → bell tail

    modulator.connect(modGain);
    modGain.connect(carrier.frequency);

    const outGain = ac.createGain();
    outGain.gain.setValueAtTime(0, now);
    outGain.gain.linearRampToValueAtTime(0.14, now + 0.004);
    outGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

    carrier.connect(outGain);
    outGain.connect(masterGain);

    carrier.start(now);
    modulator.start(now);
    carrier.stop(now + 1.2);
    modulator.stop(now + 1.2);
  }

  // ── shatter ─────────────────────────────────────────────────────
  function shatter() {
    if (!ready()) return;
    const now = ac.currentTime;

    // Noise burst — two bands
    for (const [freq, q, gain, dur] of [
      [2800, 2.0, 0.28, 0.18],
      [400,  1.2, 0.34, 0.30],
    ]) {
      const nbuf = makeNoiseBuffer(ac, 0.4);
      const src  = ac.createBufferSource();
      src.buffer = nbuf;
      const filt = ac.createBiquadFilter();
      filt.type  = 'bandpass';
      filt.frequency.setValueAtTime(freq, now);
      filt.Q.setValueAtTime(q, now);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filt); filt.connect(g); g.connect(masterGain);
      src.start(now); src.stop(now + dur + 0.02);
    }

    // Low thump
    const thump = ac.createOscillator();
    thump.type  = 'sine';
    thump.frequency.setValueAtTime(80, now);
    thump.frequency.exponentialRampToValueAtTime(28, now + 0.14);
    const tg = ac.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.linearRampToValueAtTime(0.55, now + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
    thump.connect(tg); tg.connect(masterGain);
    thump.start(now); thump.stop(now + 0.22);

    // Crystal shard tinkle — a few short detuned sines
    const tinkleFreqs = [1320, 1760, 2200, 2640];
    for (const f of tinkleFreqs) {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f + (Math.random() - 0.5) * 120, now);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.0001, now);
      g2.gain.linearRampToValueAtTime(0.06, now + 0.003);
      g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.12 + Math.random() * 0.08);
      o.connect(g2); g2.connect(masterGain);
      o.start(now); o.stop(now + 0.25);
    }
  }

  // ── fireOn / fireOff ─────────────────────────────────────────────
  // Two noise bands with fast random AM
  function fireOn() {
    if (!ready() || crackleActive) return;
    crackleActive = true;
    const now = ac.currentTime;

    crackleGain = ac.createGain();
    crackleGain.gain.setValueAtTime(0, now);
    crackleGain.gain.linearRampToValueAtTime(0.18, now + 0.08);
    crackleGain.connect(masterGain);

    crackleNodes = [];

    for (const [hpFreq, lpFreq, vol] of [
      [1200, 4000, 0.6],
      [300,  900,  0.4],
    ]) {
      const nbuf = makeNoiseBuffer(ac, 2);
      const src  = ac.createBufferSource();
      src.buffer = nbuf;
      src.loop   = true;

      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(hpFreq, now);

      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpFreq, now);

      // Fast AM modulator (random-ish rate)
      const amOsc = ac.createOscillator();
      amOsc.type = 'sine';
      amOsc.frequency.setValueAtTime(18 + Math.random() * 22, now);
      const amGain = ac.createGain();
      amGain.gain.setValueAtTime(0.4, now);
      amOsc.connect(amGain);

      const bandGain = ac.createGain();
      bandGain.gain.setValueAtTime(vol, now);

      // Build: src → hp → lp → bandGain → crackleGain
      // AM: amGain modulates bandGain.gain
      amGain.connect(bandGain.gain);

      src.connect(hp); hp.connect(lp); lp.connect(bandGain);
      bandGain.connect(crackleGain);

      src.start(now);
      amOsc.start(now);

      crackleNodes.push({ src, amOsc, amGain });
    }
  }

  function fireOff() {
    if (!ready() || !crackleActive) return;
    crackleActive = false;
    const now = ac.currentTime;
    crackleGain.gain.cancelScheduledValues(now);
    crackleGain.gain.setValueAtTime(crackleGain.gain.value, now);
    crackleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    const fadeTime = now + 0.18;
    for (const { src, amOsc } of crackleNodes) {
      try { src.stop(fadeTime); } catch (_) { /* already stopped */ }
      try { amOsc.stop(fadeTime); } catch (_) { /* already stopped */ }
    }
    crackleNodes = [];
  }

  // ── boost ───────────────────────────────────────────────────────
  function boost(on) {
    if (!ready()) return;
    const now = ac.currentTime;
    if (on) {
      // Short rising whoosh
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(60, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.3);
      const filt = ac.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(400, now);
      filt.frequency.linearRampToValueAtTime(1200, now + 0.3);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
      osc.connect(filt); filt.connect(g); g.connect(masterGain);
      osc.start(now); osc.stop(now + 0.38);
    } else {
      // Soft dying-off noise tail
      const nbuf = makeNoiseBuffer(ac, 0.4);
      const src  = ac.createBufferSource();
      src.buffer = nbuf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(600, now);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.10, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      src.connect(lp); lp.connect(g); g.connect(masterGain);
      src.start(now); src.stop(now + 0.28);
    }
  }

  // ── finale ──────────────────────────────────────────────────────
  // Ascending stacked-fifths swell over ~5s + noise sweep
  function finale() {
    if (!ready()) return;
    const now = ac.currentTime;
    const duration = 5.0;

    // Stacked fifths — each voice enters staggered, swells, holds, then fades at end
    for (let i = 0; i < FINALE_FREQS.length; i++) {
      const delay   = i * 0.45;
      const startT  = now + delay;
      const peakT   = startT + 0.6;
      const holdT   = now + duration - 0.8;
      const endT    = now + duration + 0.5;

      const osc = ac.createOscillator();
      osc.type  = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(FINALE_FREQS[i], startT);
      // Gentle vibrato
      const vibOsc  = ac.createOscillator();
      vibOsc.type   = 'sine';
      vibOsc.frequency.setValueAtTime(4.8, startT);
      const vibGain = ac.createGain();
      vibGain.gain.setValueAtTime(FINALE_FREQS[i] * 0.008, startT);
      vibOsc.connect(vibGain);
      vibGain.connect(osc.frequency);

      const vol = 0.06 - i * 0.004;
      const g   = ac.createGain();
      g.gain.setValueAtTime(0.0001, startT);
      g.gain.linearRampToValueAtTime(Math.max(vol, 0.01), peakT);
      // Hold
      g.gain.setValueAtTime(Math.max(vol, 0.01), holdT);
      g.gain.exponentialRampToValueAtTime(0.0001, endT);

      osc.connect(g); g.connect(masterGain);
      vibOsc.connect(vibGain);

      osc.start(startT);
      vibOsc.start(startT);
      osc.stop(endT + 0.1);
      vibOsc.stop(endT + 0.1);
    }

    // Ascending noise sweep — like wind becoming music
    const nbuf = makeNoiseBuffer(ac, duration + 1);
    const src  = ac.createBufferSource();
    src.buffer = nbuf;

    const sweep = ac.createBiquadFilter();
    sweep.type  = 'bandpass';
    sweep.frequency.setValueAtTime(200, now);
    sweep.frequency.exponentialRampToValueAtTime(6000, now + duration);
    sweep.Q.setValueAtTime(2.0, now);

    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.linearRampToValueAtTime(0.16, now + 0.3);
    ng.gain.setValueAtTime(0.16, now + duration - 0.5);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.6);

    src.connect(sweep); sweep.connect(ng); ng.connect(masterGain);
    src.start(now); src.stop(now + duration + 0.8);

    // Master swell up then graceful fade
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(1.0, now + 1.5);
    masterGain.gain.setValueAtTime(1.0, now + duration - 0.5);
    masterGain.gain.exponentialRampToValueAtTime(0.18, now + duration + 1.5);
  }

  // ── suspend / resume ────────────────────────────────────────────
  function suspend() {
    if (!ready()) return;
    ac.suspend().catch(() => {});
  }

  function resume() {
    if (!ready()) return;
    ac.resume().catch(() => {});
  }

  // ── dispose ─────────────────────────────────────────────────────
  function dispose() {
    if (!ac) return;
    try {
      for (const { osc } of padOscs) osc.disconnect();
      padLfoOsc?.disconnect();
      windSrc?.disconnect();
      for (const { src, amOsc } of crackleNodes) {
        try { src.stop(); } catch (_) {}
        try { amOsc.stop(); } catch (_) {}
      }
      ac.close().catch(() => {});
    } catch (_) {}
    ac = null;
    started = false;
  }

  // ── per-frame smooth ─────────────────────────────────────────────
  // Called by game.js via setSpeed; wind params drift toward targets.
  // We also expose an update() if game.js wants to drive us each tick,
  // but the contract doesn't require it — setSpeed is called from game.js.
  // We implement smooth wind interpolation inside setSpeed for simplicity;
  // use AudioParam exponential curves instead of a JS update loop.

  // Smoothly ramp AudioParams toward targets — called each time setSpeed fires.
  // (We do NOT add ourselves to the per-frame update loop; setSpeed is enough.)
  function _applyWindTargets() {
    if (!ready()) return;
    const ramp = 0.18; // seconds
    windGain.gain.linearRampToValueAtTime(
      windTargetGain * WIND_MASTER_GAIN,
      ac.currentTime + ramp
    );
    windLP.frequency.linearRampToValueAtTime(windTargetLP, ac.currentTime + ramp);
  }

  // Override setSpeed to also apply
  const _setSpeedRaw = setSpeed;
  function setSpeedSmooth(n) {
    _setSpeedRaw(n);
    _applyWindTargets();
  }

  return {
    start,
    setSpeed: setSpeedSmooth,
    setZone,
    setMuffle,
    ring,
    mote,
    shatter,
    fireOn,
    fireOff,
    boost,
    finale,
    suspend,
    resume,
    dispose,
  };
}
