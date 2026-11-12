/*
 * Built-in synthetic test signal: a 120 BPM loop (kick / snare / hats / bass / pad / blips)
 * synthesised live with Web Audio so every visualizer can be previewed without a file.
 */

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// Am – F – C – G   (bass note, chord notes)
const PROG: [number, number[]][] = [
  [45, [57, 60, 64]],
  [41, [53, 57, 60]],
  [48, [55, 60, 64]],
  [43, [55, 59, 62]],
];

export class TestSignal {
  readonly bpm = 120;
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly noise: AudioBuffer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  private startedAt = 0;
  private acc = 0;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.75;
    this.out.connect(dest);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Seconds of signal played (pauses excluded). */
  get elapsed(): number {
    return this.running ? this.acc + this.ctx.currentTime - this.startedAt : this.acc;
  }

  start(): void {
    if (this.running) return;
    this.startedAt = this.ctx.currentTime;
    this.next = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    this.acc += this.ctx.currentTime - this.startedAt;
    clearInterval(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.stop();
    this.acc = 0;
    this.step = 0;
  }

  private tick(): void {
    const sixteenth = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.next);
      this.next += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(s: number, t: number): void {
    const bar = Math.floor(s / 16) % 4;
    const st = s % 16;
    const [root, chord] = PROG[bar];
    if (st % 4 === 0 || s === 62) this.kick(t);
    if (st === 4 || st === 12) this.snare(t);
    if (st % 2 === 0) this.hat(t, st % 4 === 2, 1);
    else if (bar >= 2) this.hat(t, false, 0.5);
    if ([0, 3, 6, 8, 11, 14].includes(st)) this.bass(t, root + (st === 14 ? 12 : 0));
    if (st === 0) this.pad(t, chord, (60 / this.bpm) * 4);
    if ([2, 7, 10, 15].includes(st)) this.blip(t, chord[(st >> 2) % 3] + 12);
  }

  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out);
    return g;
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur);
    return n;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    o.connect(this.env(t, 0.95, 0.003, 0.38));
    o.start(t);
    o.stop(t + 0.5);
  }

  private snare(t: number): void {
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    bp.connect(this.env(t, 0.5, 0.002, 0.18));
    this.noiseSrc(t, 0.25).connect(bp);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, t);
    o.connect(this.env(t, 0.25, 0.002, 0.09));
    o.start(t);
    o.stop(t + 0.15);
  }

  private hat(t: number, open: boolean, level: number): void {
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    hp.connect(this.env(t, (open ? 0.16 : 0.11) * level, 0.001, open ? 0.22 : 0.045));
    this.noiseSrc(t, open ? 0.3 : 0.08).connect(hp);
  }

  private bass(t: number, midi: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = midiHz(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.2);
    o.connect(lp);
    lp.connect(this.env(t, 0.3, 0.005, 0.2));
    o.start(t);
    o.stop(t + 0.3);
  }

  private pad(t: number, notes: number[], dur: number): void {
    for (const m of notes) {
      for (const det of [-5, 5]) {
        const o = this.ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.4);
        g.gain.setValueAtTime(0.035, t + dur - 0.3);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g);
        g.connect(this.out);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private blip(t: number, midi: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = midiHz(midi);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    o.connect(lp);
    lp.connect(this.env(t, 0.06, 0.003, 0.14));
    o.start(t);
    o.stop(t + 0.2);
  }
}
