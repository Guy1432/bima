/**
 * Sound effects synthesised with WebAudio - no audio files, no licensing, works offline.
 * Played only by the "master" stage (the projector window), so the sound comes out of the
 * venue speakers connected to the projector computer.
 */

export type FxKind = "confetti" | "hearts" | "drumroll" | "applause" | "tada" | "correct" | "wrong" | "fireworks";

let ctx: AudioContext | null = null;
function ac() {
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

let reverbBuf: AudioBuffer | null = null;
function roomImpulse() {
  const a = ac();
  if (reverbBuf) return reverbBuf;
  const len = Math.floor(a.sampleRate * 1.6);
  const b = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return (reverbBuf = b);
}

/** The currently playing effect's bus - a new effect fades the old one out (one at a time). */
let currentBus: GainNode | null = null;

export function stopSfx() {
  const a = ctx;
  if (!a || !currentBus) return;
  const g = currentBus;
  g.gain.cancelScheduledValues(a.currentTime);
  g.gain.setValueAtTime(g.gain.value, a.currentTime);
  g.gain.linearRampToValueAtTime(0, a.currentTime + 0.08);
  setTimeout(() => g.disconnect(), 150);
  currentBus = null;
}

function out(vol: number, wet = 0.22) {
  const a = ac();
  stopSfx();
  const bus = a.createGain();
  bus.gain.value = 1;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  bus.connect(comp).connect(a.destination);

  const input = a.createGain();
  input.gain.value = vol;
  input.connect(bus); // dry
  const verb = a.createConvolver();
  verb.buffer = roomImpulse();
  const wg = a.createGain();
  wg.gain.value = wet;
  input.connect(verb).connect(wg).connect(bus); // wet
  currentBus = bus;
  return input;
}

let noiseCache: AudioBuffer | null = null;
function noise() {
  const a = ac();
  if (noiseCache) return noiseCache;
  const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return (noiseCache = b);
}

function noiseHit(dest: AudioNode, t: number, dur: number, gain: number, freq: number, q = 0.8, type: BiquadFilterType = "bandpass") {
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noise();
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(dest: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine", endFreq?: number) {
  const a = ac();
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Snare: drum body (two pitched partials) + snare wires (filtered noise). */
function snare(dest: AudioNode, t: number, gain: number) {
  const a = ac();
  // body
  for (const [f, g] of [[185, 0.5], [330, 0.28]] as const) {
    const o = a.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f * 1.25, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const e = a.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain * g, t + 0.002);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(e).connect(dest);
    o.start(t);
    o.stop(t + 0.15);
  }
  // wires
  const src = a.createBufferSource();
  src.buffer = noise();
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  const pk = a.createBiquadFilter();
  pk.type = "peaking";
  pk.frequency.value = 4800;
  pk.gain.value = 6;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 10000;
  const e = a.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(gain * 0.75, t + 0.0015);
  e.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  src.connect(hp).connect(pk).connect(lp).connect(e).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + 0.2);
}

/** Crash cymbal: inharmonic metallic partials (classic 808-style) + bright noise, long decay. */
function crash(dest: AudioNode, t: number, gain: number) {
  const a = ac();
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 9000;
  bp.Q.value = 0.6;
  const hp = a.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5500;
  const e = a.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.004);
  e.gain.exponentialRampToValueAtTime(gain * 0.12, t + 0.35);
  e.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
  bp.connect(hp).connect(e).connect(dest);
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = a.createOscillator();
    o.type = "square";
    o.frequency.value = f * 1.7;
    o.connect(bp);
    o.start(t);
    o.stop(t + 2.7);
  }
  noiseHit(dest, t, 2.4, gain * 0.5, 7500, 0.4, "highpass");
}

/** Kick: pitch-dropping sine + a click for attack. */
function kick(dest: AudioNode, t: number, gain: number) {
  tone(dest, t, 150, 0.5, gain, "sine", 42);
  noiseHit(dest, t, 0.015, gain * 0.4, 3000, 1);
}

function tom(dest: AudioNode, t: number, freq: number, gain: number) {
  tone(dest, t, freq * 1.4, 0.35, gain, "sine", freq);
  noiseHit(dest, t, 0.05, gain * 0.25, 1200, 1);
}

/**
 * Drum roll: a real buzz-roll feel - alternating sticking with human timing & velocity,
 * a sustained "wash" that swells underneath, accelerating into a tom fill and a
 * kick + accented snare + crash finish.
 */
function drumroll(vol: number) {
  const a = ac();
  const d = out(vol, 0.28);
  const t0 = a.currentTime + 0.04;
  const len = 2.05;

  // sustained snare wash (fills the gaps like a real press roll)
  const wash = a.createBufferSource();
  wash.buffer = noise();
  wash.loop = true;
  const wbp = a.createBiquadFilter();
  wbp.type = "bandpass";
  wbp.frequency.value = 3800;
  wbp.Q.value = 0.7;
  const wg = a.createGain();
  wg.gain.setValueAtTime(0.0001, t0);
  wg.gain.exponentialRampToValueAtTime(0.035, t0 + 0.2);
  wg.gain.exponentialRampToValueAtTime(0.16, t0 + len);
  wg.gain.exponentialRampToValueAtTime(0.0001, t0 + len + 0.05);
  wash.connect(wbp).connect(wg).connect(d);
  wash.start(t0);
  wash.stop(t0 + len + 0.1);

  let t = 0;
  let hand = 0;
  while (t < len - 0.22) {
    const p = t / len;
    const vel = (0.16 + p * p * 0.62) * (hand % 2 ? 0.86 : 1) * (0.9 + Math.random() * 0.2);
    snare(d, t0 + t, vel);
    hand++;
    const rate = 15 + p * 13; // hits per second
    t += 1 / rate + (Math.random() - 0.5) * 0.004;
  }
  // tom fill
  const fill = t0 + len - 0.22;
  tom(d, fill, 220, 0.55);
  tom(d, fill + 0.07, 165, 0.6);
  tom(d, fill + 0.14, 120, 0.65);
  // the hit
  const hit = t0 + len;
  kick(d, hit, 1.1);
  snare(d, hit, 1);
  crash(d, hit, 0.95);
}

/** Applause: ~1400 individual synthesised claps with a natural swell and fade. */
function applause(vol: number) {
  const a = ac();
  const dur = 3.6;
  const sr = a.sampleRate;
  const buf = a.createBuffer(2, Math.floor(sr * dur), sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const claps = 900;
    for (let c = 0; c < claps; c++) {
      const tt = Math.random() * dur;
      const env = Math.min(1, tt / 0.35) * Math.min(1, (dur - tt) / 1.4); // swell + tail
      const amp = (0.25 + Math.random() * 0.75) * env;
      const start = Math.floor(tt * sr);
      const L = Math.floor(sr * (0.006 + Math.random() * 0.01));
      for (let i = 0; i < L && start + i < d.length; i++) d[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (L / 4));
    }
    for (let i = 0; i < d.length; i++) d[i] *= 0.35;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1600;
  bp.Q.value = 0.5;
  src.connect(bp).connect(out(vol));
  src.start();
}

/** "Ta-daaa!" - two brassy chord hits with a little vibrato. */
function tada(vol: number) {
  const a = ac();
  const d = out(vol * 0.55);
  const t0 = a.currentTime + 0.03;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2600;
  lp.connect(d);
  const chord = (t: number, notes: number[], dur: number) => {
    for (const f of notes) {
      for (const det of [-6, 6]) {
        const o = a.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = det;
        const vib = a.createOscillator();
        vib.frequency.value = 5.5;
        const vg = a.createGain();
        vg.gain.value = dur > 0.5 ? 6 : 0;
        vib.connect(vg).connect(o.detune);
        const g = a.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
        g.gain.setValueAtTime(0.16, t + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(lp);
        o.start(t);
        vib.start(t);
        o.stop(t + dur + 0.05);
        vib.stop(t + dur + 0.05);
      }
    }
  };
  chord(t0, [392, 494, 587], 0.16); // G
  chord(t0 + 0.2, [523.25, 659.25, 783.99, 1046.5], 1.5); // C major
  crash(d, t0 + 0.2, 0.35);
}

function correct(vol: number) {
  const d = out(vol * 0.7);
  const t = ac().currentTime + 0.02;
  tone(d, t, 1318.5, 0.5, 0.5);
  tone(d, t, 2637, 0.3, 0.12);
  tone(d, t + 0.13, 1760, 0.9, 0.55);
  tone(d, t + 0.13, 3520, 0.5, 0.1);
}

function wrong(vol: number) {
  const a = ac();
  const d = out(vol * 0.5);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  lp.connect(d);
  const t = a.currentTime + 0.02;
  tone(lp, t, 155, 0.28, 0.6, "square");
  tone(lp, t + 0.3, 110, 0.55, 0.6, "square");
}

function popper(vol: number) {
  const d = out(vol);
  const t = ac().currentTime + 0.02;
  noiseHit(d, t, 0.09, 0.9, 1400, 0.9);
  kick(d, t, 0.4);
  tone(d, t + 0.05, 900, 0.5, 0.07, "sine", 2400);
}

function chime(vol: number) {
  const d = out(vol * 0.6);
  const t = ac().currentTime + 0.02;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(d, t + i * 0.09, f, 1.1, 0.25));
}

function fireworks(vol: number) {
  const d = out(vol);
  const t0 = ac().currentTime + 0.02;
  for (let i = 0; i < 5; i++) {
    const t = t0 + i * 0.42 + Math.random() * 0.1;
    tone(d, t, 400, 0.45, 0.05, "sine", 1600); // whistle up
    noiseHit(d, t + 0.45, 0.6, 0.6, 900, 0.4); // boom
    kick(d, t + 0.45, 0.5);
    for (let k = 0; k < 8; k++) noiseHit(d, t + 0.55 + Math.random() * 0.6, 0.04, 0.12, 5000, 1); // crackle
  }
}

export function playSfx(kind: FxKind, vol = 0.8) {
  try {
    switch (kind) {
      case "drumroll":
        return drumroll(vol);
      case "applause":
        return applause(vol);
      case "tada":
        return tada(vol);
      case "correct":
        return correct(vol);
      case "wrong":
        return wrong(vol);
      case "confetti":
        return popper(vol);
      case "hearts":
        return chime(vol);
      case "fireworks":
        return fireworks(vol);
    }
  } catch {
    /* audio not available - visuals still play */
  }
}

export const FX_DURATION: Record<FxKind, number> = {
  confetti: 4000,
  hearts: 4000,
  drumroll: 3400,
  applause: 3800,
  tada: 2600,
  correct: 1900,
  wrong: 1700,
  fireworks: 3600,
};
