/*
 * Real-time Web Audio engine.
 *
 *   <audio> ─► MediaElementSource ─┐
 *   TestSignal ────────────────────┴► bus ─┬► analyser (fft 2048, smoothed) ─► volume ─► speakers
 *                                          ├► detector (fft 2048, raw)  → onset / BPM detection
 *                                          └► MediaStreamDestination    → video recording (pre-volume)
 */
import { TestSignal } from './TestSignal';

export interface AudioFeatures {
  /** Normalised 0..1 band energies (sensitivity applied, smoothed). */
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  treble: number;
  rms: number;
  /** Kick pulse: jumps to 1 on a kick and decays smoothly. */
  beat: number;
  kick: boolean;
  /** Snare / mid transient pulse. */
  snare: number;
  snareHit: boolean;
  /** Hi-hat / treble transient pulse. */
  hat: number;
  hatHit: boolean;
  /** Held linear peak 0..1 and in dBFS. */
  peak: number;
  peakDb: number;
  /** Estimated tempo (0 while unknown). */
  bpm: number;
  /** Per-bin 0..1 magnitudes (sensitivity + slight treble tilt applied). */
  spectrum: Float32Array<ArrayBuffer>;
  /** Time-domain samples -1..1. */
  waveform: Float32Array<ArrayBuffer>;
  binHz: number;
  active: boolean;
  /** Per-MIDI-note salience 0..1 (index = MIDI number), from a high-resolution pitch FFT. */
  noteLevel: Float32Array<ArrayBuffer>;
  /** MIDI numbers currently detected as sounding (strongest first, max 4). */
  activeNotes: number[];
  /** 12-bin pitch-class energy 0..1 (C..B). */
  chroma: Float32Array<ArrayBuffer>;
  /** Beat clock: phase inside the current beat (0..1) and running beat counter. */
  beatPhase: number;
  beatCount: number;
  /** Transport position (seconds) and duration (Infinity for the live test signal). */
  time: number;
  duration: number;
  /** Whole-file peak overview (null for the live test signal). */
  overview: Float32Array | null;
  /** Stereo width 0 (mono) .. 1 (wide), from side/mid energy. */
  width: number;
}

export type SourceKind = 'none' | 'file' | 'test';

const FFT = 2048;
const PITCH_FFT = 8192;
export const NOTE_MIN = 28; // E1
export const NOTE_MAX = 100; // E7
const ENV_RATE = 50; // onset envelope sample rate (Hz) for tempo autocorrelation
const ENV_LEN = ENV_RATE * 6;

interface Onset {
  ema: number;
  last: number;
  refractory: number;
  k: number;
  floor: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function computeOverview(buf: AudioBuffer, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const chans: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
  const len = buf.length;
  const per = len / buckets;
  const stride = Math.max(1, Math.floor(per / 400));
  let max = 0;
  for (let b = 0; b < buckets; b++) {
    const s0 = Math.floor(b * per);
    const s1 = Math.min(len, Math.floor((b + 1) * per));
    let m = 0;
    for (const ch of chans) {
      for (let i = s0; i < s1; i += stride) {
        const v = Math.abs(ch[i]);
        if (v > m) m = v;
      }
    }
    out[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < buckets; b++) out[b] /= max;
  return out;
}

export class AudioEngine {
  readonly audio: HTMLAudioElement;
  readonly features: AudioFeatures;
  ctx: AudioContext | null = null;
  source: SourceKind = 'none';
  fileName = '';
  /** Normalised peak overview of the loaded file (for the scrub bar). */
  overview: Float32Array | null = null;
  /** Gain/sensitivity multiplier applied to all features. */
  sensitivity = 1;
  /** 0..0.95 — higher = smoother, slower visuals. */
  smoothing = 0.6;

  private bus: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private detector: AnalyserNode | null = null;
  private output: GainNode | null = null;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private test: TestSignal | null = null;
  private objectUrl: string | null = null;
  private hasFile = false;
  private volume = 0.85;
  private bytes = new Uint8Array(FFT / 2);
  private det = new Uint8Array(FFT / 2);
  private detPrev = new Float32Array(FFT / 2);
  private kickO: Onset = { ema: 0.02, last: 0, refractory: 0.22, k: 1.9, floor: 0.035 };
  private snareO: Onset = { ema: 0.02, last: 0, refractory: 0.12, k: 2.0, floor: 0.03 };
  private hatO: Onset = { ema: 0.02, last: 0, refractory: 0.07, k: 2.0, floor: 0.025 };
  private pitch: AnalyserNode | null = null;
  private anL: AnalyserNode | null = null;
  private anR: AnalyserNode | null = null;
  private bufL = new Float32Array(1024);
  private bufR = new Float32Array(1024);
  private pitchDb = new Float32Array(PITCH_FFT / 2);
  private noteRaw = new Float32Array(128);
  private noteOnTime = new Float32Array(128);
  private env = new Float32Array(ENV_LEN);
  private envPos = 0;
  private envAcc = 0;
  private envMax = 0;
  private tempoTimer = 0;
  private listeners = new Set<() => void>();
  private loadToken = 0;

  constructor() {
    this.features = {
      subBass: 0, bass: 0, lowMid: 0, mid: 0, treble: 0, rms: 0,
      beat: 0, kick: false, snare: 0, snareHit: false, hat: 0, hatHit: false,
      peak: 0, peakDb: -96, bpm: 0,
      spectrum: new Float32Array(FFT / 2),
      waveform: new Float32Array(FFT),
      binHz: 48000 / FFT,
      active: false,
      noteLevel: new Float32Array(128),
      activeNotes: [],
      chroma: new Float32Array(12),
      beatPhase: 0,
      beatCount: 0,
      time: 0,
      duration: 0,
      overview: null,
      width: 0,
    };
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'emptied']) {
      a.addEventListener(ev, () => this.emit());
    }
    this.audio = a;
  }

  /* ───────────── subscription ───────────── */

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }

  /* ───────────── graph ───────────── */

  /** Creates the AudioContext lazily (must happen after a user gesture). */
  private ensure(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const bus = ctx.createGain();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT;
    analyser.minDecibels = -95;
    analyser.maxDecibels = -15;
    analyser.smoothingTimeConstant = 0.55;
    const detector = ctx.createAnalyser();
    detector.fftSize = FFT;
    detector.minDecibels = -95;
    detector.maxDecibels = -15;
    detector.smoothingTimeConstant = 0;
    const output = ctx.createGain();
    output.gain.value = this.volume;
    const recDest = ctx.createMediaStreamDestination();
    const pitch = ctx.createAnalyser();
    pitch.fftSize = PITCH_FFT;
    pitch.minDecibels = -100;
    pitch.maxDecibels = -10;
    pitch.smoothingTimeConstant = 0.5;

    bus.connect(analyser);
    analyser.connect(output);
    output.connect(ctx.destination);
    bus.connect(detector);
    bus.connect(recDest);
    bus.connect(pitch);
    const split = ctx.createChannelSplitter(2);
    const anL = ctx.createAnalyser();
    const anR = ctx.createAnalyser();
    anL.fftSize = anR.fftSize = 1024;
    bus.connect(split);
    split.connect(anL, 0);
    split.connect(anR, 1);
    this.anL = anL;
    this.anR = anR;

    const media = ctx.createMediaElementSource(this.audio);
    media.connect(bus);

    this.ctx = ctx;
    this.bus = bus;
    this.analyser = analyser;
    this.detector = detector;
    this.output = output;
    this.recDest = recDest;
    this.pitch = pitch;
    this.features.binHz = ctx.sampleRate / FFT;
    return ctx;
  }

  /** Audio stream (music only, independent of the monitor volume) for MediaRecorder. */
  get recordStream(): MediaStream | null {
    return this.recDest?.stream ?? null;
  }

  /* ───────────── sources ───────────── */

  async loadFile(file: File): Promise<void> {
    const ctx = this.ensure();
    this.test?.reset();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.audio.src = this.objectUrl;
    this.hasFile = true;
    this.source = 'file';
    this.fileName = file.name;
    this.overview = null;
    this.resetDetection();
    this.emit();
    const token = ++this.loadToken;
    try {
      await this.audio.play();
    } catch {
      /* autoplay refused: the user can press play */
    }
    try {
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      if (token !== this.loadToken) return;
      this.overview = computeOverview(buf, 1200);
      this.emit();
    } catch {
      /* overview is optional (some codecs decode in <audio> but not in decodeAudioData) */
    }
  }

  startTest(): void {
    const ctx = this.ensure();
    this.audio.pause();
    if (!this.test && this.bus) this.test = new TestSignal(ctx, this.bus);
    this.test?.reset();
    this.test?.start();
    this.source = 'test';
    this.resetDetection();
    this.emit();
  }

  /** Leaves test mode, returning to the loaded file (paused) if there is one. */
  exitTest(): void {
    this.test?.reset();
    this.source = this.hasFile ? 'file' : 'none';
    this.resetDetection();
    this.emit();
  }

  get testName(): string {
    return `TEST_SIGNAL // ${this.test?.bpm ?? 120} BPM`;
  }

  /* ───────────── transport ───────────── */

  get playing(): boolean {
    if (this.source === 'test') return !!this.test?.running;
    return this.source === 'file' && !this.audio.paused;
  }

  async play(): Promise<void> {
    this.ensure();
    if (this.source === 'test') {
      this.test?.start();
      this.emit();
    } else if (this.source === 'file') {
      try {
        await this.audio.play();
      } catch {
        /* ignore */
      }
    }
  }

  pause(): void {
    if (this.source === 'test') {
      this.test?.stop();
      this.emit();
    } else this.audio.pause();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else void this.play();
  }

  get currentTime(): number {
    if (this.source === 'test') return this.test?.elapsed ?? 0;
    return this.audio.currentTime || 0;
  }

  get duration(): number {
    if (this.source === 'test') return Infinity;
    const d = this.audio.duration;
    return Number.isFinite(d) ? d : 0;
  }

  seek(t: number): void {
    if (this.source !== 'file' || !this.duration) return;
    this.audio.currentTime = Math.max(0, Math.min(this.duration - 0.01, t));
    this.emit();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.output && this.ctx) this.output.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  getVolume(): number {
    return this.volume;
  }

  /* ───────────── analysis ───────────── */

  private resetDetection(): void {
    this.env.fill(0);
    this.envPos = 0;
    this.envAcc = 0;
    this.envMax = 0;
    this.tempoTimer = 0;
    this.features.bpm = 0;
    this.features.beatPhase = 0;
    this.features.beatCount = 0;
    this.features.noteLevel.fill(0);
    this.features.chroma.fill(0);
    this.features.activeNotes = [];
    for (const o of [this.kickO, this.snareO, this.hatO]) {
      o.ema = 0.02;
      o.last = 0;
    }
    this.detPrev.fill(0);
  }

  private onset(o: Onset, v: number, now: number, dt: number, floorScale: number): boolean {
    const thr = o.ema * o.k + o.floor * floorScale;
    const hit = v > thr && now - o.last > o.refractory;
    o.ema += (v - o.ema) * (1 - Math.exp(-dt * 3));
    if (hit) o.last = now;
    return hit;
  }

  /** Call once per animation frame. Returns the (mutated, shared) feature object. */
  update(dt: number): AudioFeatures {
    const f = this.features;
    f.kick = f.snareHit = f.hatHit = false;

    if (!this.ctx || !this.analyser || !this.detector || !this.playing) {
      const d = Math.exp(-dt * 4);
      f.subBass *= d; f.bass *= d; f.lowMid *= d; f.mid *= d; f.treble *= d; f.rms *= d;
      f.beat *= Math.exp(-dt * 7); f.snare *= Math.exp(-dt * 9); f.hat *= Math.exp(-dt * 12);
      for (let i = 0; i < f.spectrum.length; i++) f.spectrum[i] *= d;
      for (let i = 0; i < f.waveform.length; i++) f.waveform[i] *= d;
      f.peak *= d;
      f.peakDb = 20 * Math.log10(Math.max(f.peak, 1e-5));
      for (let i = 0; i < 128; i++) f.noteLevel[i] *= d;
      for (let i = 0; i < 12; i++) f.chroma[i] *= d;
      f.activeNotes = [];
      f.width *= d;
      f.active = false;
      f.time = this.currentTime;
      f.duration = this.duration;
      f.overview = this.source === 'file' ? this.overview : null;
      return f;
    }

    f.active = true;
    const sens = this.sensitivity;
    const an = this.analyser;
    an.smoothingTimeConstant = Math.min(0.95, Math.max(0, this.smoothing * 0.92));
    an.getByteFrequencyData(this.bytes);
    an.getFloatTimeDomainData(f.waveform);

    const n = this.bytes.length;
    const binHz = f.binHz;
    for (let i = 0; i < n; i++) {
      const tilt = 1 + 0.45 * Math.sqrt(i / n);
      f.spectrum[i] = clamp01((((this.bytes[i] / 255) * tilt - 0.08) / 0.85) * sens);
    }

    const band = (lo: number, hi: number): number => {
      const b0 = Math.max(1, Math.floor(lo / binHz));
      const b1 = Math.min(n - 1, Math.max(b0, Math.ceil(hi / binHz)));
      let s = 0;
      for (let i = b0; i <= b1; i++) s += this.bytes[i];
      return s / ((b1 - b0 + 1) * 255);
    };
    const shape = (raw: number, w: number): number => clamp01(((raw * w - 0.12) / 0.75) * sens);

    const att = 1 - Math.exp(-dt * 40);
    const rel = 1 - Math.exp(-dt * (14 - this.smoothing * 12));
    const sm = (prev: number, target: number): number =>
      prev + (target - prev) * (target > prev ? att : rel);

    f.subBass = sm(f.subBass, shape(band(20, 60), 1));
    f.bass = sm(f.bass, shape(band(60, 250), 1));
    f.lowMid = sm(f.lowMid, shape(band(250, 500), 1.08));
    f.mid = sm(f.mid, shape(band(500, 2000), 1.18));
    f.treble = sm(f.treble, shape(band(2000, 16000), 1.5));

    let sq = 0;
    let pk = 0;
    const wf = f.waveform;
    for (let i = 0; i < wf.length; i++) {
      const v = wf[i];
      sq += v * v;
      const a = v < 0 ? -v : v;
      if (a > pk) pk = a;
    }
    f.rms = sm(f.rms, clamp01(Math.sqrt(sq / wf.length) * 3.2 * sens));
    f.peak = Math.max(pk, f.peak - dt * 0.6);
    f.peakDb = 20 * Math.log10(Math.max(f.peak, 1e-5));

    // ── onset detection on the raw (unsmoothed) spectrum: positive spectral flux per band
    this.detector.getByteFrequencyData(this.det);
    const flux = (lo: number, hi: number): number => {
      const b0 = Math.max(1, Math.floor(lo / binHz));
      const b1 = Math.min(n - 1, Math.max(b0, Math.ceil(hi / binHz)));
      let s = 0;
      for (let i = b0; i <= b1; i++) {
        const d = this.det[i] / 255 - this.detPrev[i];
        if (d > 0) s += d;
      }
      return s / (b1 - b0 + 1);
    };
    const kf = flux(30, 150);
    const sf = flux(1500, 5000);
    const hf = flux(7000, 15000);
    for (let i = 0; i < n; i++) this.detPrev[i] = this.det[i] / 255;

    const now = this.ctx.currentTime;
    const floorScale = 1 / Math.sqrt(Math.max(0.25, sens));
    f.kick = this.onset(this.kickO, kf, now, dt, floorScale);
    f.snareHit = this.onset(this.snareO, sf, now, dt, floorScale);
    f.hatHit = this.onset(this.hatO, hf, now, dt, floorScale);

    f.beat = f.kick ? 1 : f.beat * Math.exp(-dt * 6.5);
    f.snare = f.snareHit ? 1 : f.snare * Math.exp(-dt * 9);
    f.hat = f.hatHit ? 1 : f.hat * Math.exp(-dt * 14);

    // ── tempo: autocorrelation of the onset envelope (last 6 s, 70..180 BPM, prior around 120)
    this.envMax = Math.max(this.envMax, kf + 0.5 * sf + 0.2 * hf);
    this.envAcc += dt;
    while (this.envAcc >= 1 / ENV_RATE) {
      this.envAcc -= 1 / ENV_RATE;
      this.env[this.envPos] = this.envMax;
      this.envPos = (this.envPos + 1) % ENV_LEN;
      this.envMax = 0;
    }
    this.tempoTimer += dt;
    if (this.tempoTimer > 0.5) {
      this.tempoTimer = 0;
      const est = this.estimateTempo();
      if (est) f.bpm = f.bpm && Math.abs(est - f.bpm) < 8 ? f.bpm + (est - f.bpm) * 0.35 : est;
    }

    // ── beat clock: free-running at the estimated tempo, phase-locked to kicks
    if (f.bpm > 0) {
      f.beatPhase += dt / (60 / f.bpm);
      if (f.kick) {
        if (f.beatPhase > 0.7) f.beatPhase = 1;
        else if (f.beatPhase < 0.3) f.beatPhase *= 0.5;
      }
      while (f.beatPhase >= 1) {
        f.beatPhase -= 1;
        f.beatCount++;
      }
    } else if (f.kick) {
      f.beatCount++;
      f.beatPhase = 0;
    } else f.beatPhase = Math.min(0.99, f.beatPhase + dt * 2);

    this.detectNotes(dt, now);
    if (this.anL && this.anR) {
      this.anL.getFloatTimeDomainData(this.bufL);
      this.anR.getFloatTimeDomainData(this.bufR);
      let mid = 0;
      let side = 0;
      for (let i = 0; i < this.bufL.length; i++) {
        const m = this.bufL[i] + this.bufR[i];
        const s = this.bufL[i] - this.bufR[i];
        mid += m * m;
        side += s * s;
      }
      const wv = clamp01(Math.sqrt(side / (mid + 1e-9)) * 1.6);
      f.width += (wv - f.width) * (1 - Math.exp(-dt * 4));
    }
    f.time = this.currentTime;
    f.duration = this.duration;
    f.overview = this.source === 'file' ? this.overview : null;
    return f;
  }

  private estimateTempo(): number {
    const N = ENV_LEN;
    const x = new Float32Array(N);
    let mean = 0;
    for (let i = 0; i < N; i++) {
      x[i] = this.env[(this.envPos + i) % N];
      mean += x[i];
    }
    mean /= N;
    let energy = 0;
    for (let i = 0; i < N; i++) {
      x[i] -= mean;
      energy += x[i] * x[i];
    }
    if (energy < 1e-4) return 0;
    const lagMin = Math.floor((ENV_RATE * 60) / 180);
    const lagMax = Math.ceil((ENV_RATE * 60) / 70);
    const ac = (L: number): number => {
      let s = 0;
      for (let i = L; i < N; i++) s += x[i] * x[i - L];
      return s / (N - L);
    };
    const scores: number[] = [];
    let best = -Infinity;
    let bestL = 0;
    for (let L = lagMin; L <= lagMax; L++) {
      const bpm = (ENV_RATE * 60) / L;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.55, 2));
      const sc = (ac(L) + 0.5 * ac(2 * L)) * prior;
      scores[L] = sc;
      if (sc > best) {
        best = sc;
        bestL = L;
      }
    }
    if (best <= 0 || !bestL) return 0;
    // parabolic refinement
    let lag = bestL;
    const a = scores[bestL - 1];
    const c = scores[bestL + 1];
    if (a !== undefined && c !== undefined) {
      const den = a - 2 * best + c;
      if (den < 0) lag += (0.5 * (a - c)) / den;
    }
    return (ENV_RATE * 60) / lag;
  }

  /** Harmonic-sum pitch salience on an 8192-pt FFT → per-note levels + active notes. */
  private detectNotes(dt: number, now: number): void {
    const f = this.features;
    if (!this.pitch || !this.ctx) return;
    this.pitch.getFloatFrequencyData(this.pitchDb);
    const db = this.pitchDb;
    const nb = db.length;
    const bin = this.ctx.sampleRate / PITCH_FFT;
    const mag = (hz: number): number => {
      const c = hz / bin;
      const lo = Math.max(1, Math.floor(c * 0.985));
      const hi = Math.min(nb - 1, Math.ceil(c * 1.015));
      let m = -200;
      for (let i = lo; i <= hi; i++) if (db[i] > m) m = db[i];
      return clamp01((m + 85) / 60);
    };
    const raw = this.noteRaw;
    for (let m = NOTE_MIN; m <= NOTE_MAX; m++) {
      const hz = 440 * Math.pow(2, (m - 69) / 12);
      raw[m] = mag(hz) + 0.5 * mag(hz * 2) + 0.33 * mag(hz * 3) + 0.25 * mag(hz * 4);
    }
    // contrast against the local neighbourhood + local-max picking
    const cand: { m: number; v: number }[] = [];
    const loud = f.rms > 0.02;
    const sens = this.sensitivity;
    for (let m = NOTE_MIN; m <= NOTE_MAX; m++) {
      let s = 0;
      let n = 0;
      for (let k = m - 7; k <= m + 7; k++) {
        if (k < NOTE_MIN || k > NOTE_MAX || k === m) continue;
        s += raw[k];
        n++;
      }
      const contrast = raw[m] - s / Math.max(1, n);
      const target = clamp01(contrast * 1.6 * sens);
      const k = target > f.noteLevel[m] ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 6);
      f.noteLevel[m] += (target - f.noteLevel[m]) * k;
      if (loud && contrast > 0.26 / Math.sqrt(sens) && raw[m] >= raw[m - 1] && raw[m] >= raw[m + 1]) cand.push({ m, v: contrast });
    }
    cand.sort((a, b) => b.v - a.v);
    // drop weak candidates and octave/fifth "ghosts" of a stronger lower note (harmonics)
    const strongest = cand.length ? cand[0].v : 0;
    const kept: { m: number; v: number }[] = [];
    for (const c of cand) {
      if (c.v < strongest * 0.55) break;
      const ghost = kept.some((k) => k.m < c.m && [12, 19, 24].includes(c.m - k.m));
      if (!ghost) kept.push(c);
      if (kept.length >= 4) break;
    }
    const prev = new Set(f.activeNotes);
    const next: number[] = [];
    for (const c of kept) {
      next.push(c.m);
      if (!prev.has(c.m)) this.noteOnTime[c.m] = now;
    }
    // keep very recent notes alive briefly (min 70 ms) to avoid flicker
    for (const m of prev) if (!next.includes(m) && now - this.noteOnTime[m] < 0.07) next.push(m);
    f.activeNotes = next;
    for (let i = 0; i < 12; i++) f.chroma[i] *= Math.exp(-dt * 3);
    for (let m = NOTE_MIN; m <= NOTE_MAX; m++) {
      const pc = m % 12;
      if (f.noteLevel[m] > f.chroma[pc]) f.chroma[pc] = f.noteLevel[m];
    }
  }
}

/** App-wide singleton. */
export const engine = new AudioEngine();
