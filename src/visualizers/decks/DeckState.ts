/*
 * Musical state shared by every module of a deck, updated once per frame:
 * beat clock, hits (kick/snare/hat/note onsets), note statistics, key, section,
 * score/combo and a 20 Hz telemetry history (level, punch, brightness, width, tension, bass note, notes).
 */
import type { AudioFeatures } from '../../audio/AudioEngine';
import { NOTE_MAX, NOTE_MIN } from '../../audio/AudioEngine';
import { clamp, noteName } from '../draw';

export type HitKind = 'kick' | 'snare' | 'hat' | 'note';
export interface Hit {
  id: number;
  t: number; // DeckState clock (s)
  beat: number;
  kind: HitKind;
  band: number; // 0 SUB · 1 LOW · 2 MID · 3 HIGH · 4 AIR
  s: number; // strength 0..1
  m: number; // MIDI note for notes, -1 otherwise
}
export interface NoteSpan {
  m: number;
  t0: number;
  t1: number;
  open: boolean;
}

export const BANDS = ['SUB', 'LOW', 'MID', 'HIGH', 'AIR'];
export const RATE = 20;
export const HIST = RATE * 24;

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class DeckState {
  clock = 0;
  beat = 0;
  bpm = 120;
  time = 0;
  hits: Hit[] = [];
  hitSeq = 0;
  spans: NoteSpan[] = [];
  sounded = new Float32Array(128);
  trans = new Map<number, number>();
  recent: number[] = [];
  onsets: number[] = [];
  score = 0;
  combo = 0;
  loudAvg = 0;
  bright = 0;
  punch = 0;
  tension = 0;
  bassNote = -1;
  leadHz = 0;
  key = '—';
  kickSteps = new Uint8Array(16);
  lastBarSteps = new Uint8Array(16);
  step = 0;
  bar = 0;
  // history (ring buffers, 20 Hz)
  hPos = 0;
  hCount = 0;
  hTime = new Float32Array(HIST);
  hLevel = new Float32Array(HIST);
  hPunch = new Float32Array(HIST);
  hBright = new Float32Array(HIST);
  hWidth = new Float32Array(HIST);
  hTension = new Float32Array(HIST);
  hBass = new Float32Array(HIST);
  hHits = new Uint8Array(HIST); // bit0 kick, bit1 snare, bit2 hat
  hNotes = new Int16Array(HIST * 4);

  private prev = new Set<number>();
  private hAcc = 0;
  private hitBits = 0;
  private chromaAcc = new Float32Array(12);
  private keyTimer = 0;
  private bassHold = 0;
  private lastFrame = -1;

  get section(): string {
    const a = this.loudAvg;
    return a < 0.06 ? 'Intro' : a < 0.16 ? 'Verse' : a < 0.28 ? 'Chorus' : 'Drop';
  }

  mostPlayed(): number {
    let best = -1;
    let v = 0;
    for (let m = 0; m < 128; m++) {
      if (this.sounded[m] > v) {
        v = this.sounded[m];
        best = m;
      }
    }
    return best;
  }

  topNotes(n: number): number[] {
    const out: number[] = [];
    for (let m = 0; m < 128; m++) if (this.sounded[m] > 0.05) out.push(m);
    out.sort((a, b) => this.sounded[b] - this.sounded[a]);
    return out.slice(0, n);
  }

  private addHit(kind: HitKind, band: number, s: number, m = -1): void {
    this.hits.push({ id: ++this.hitSeq, t: this.clock, beat: this.beat, kind, band, s: clamp(s), m });
    if (this.hits.length > 400) this.hits.splice(0, this.hits.length - 400);
  }

  /** Call once per frame (guarded: several modules may share one state). */
  update(f: AudioFeatures, dt: number, frame: number): void {
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.onsets = [];
    this.time = f.time;
    if (!f.active) return;
    this.clock += dt;

    // beat clock, phase-locked to the engine
    this.bpm = f.bpm || this.bpm || 120;
    this.beat += (dt * this.bpm) / 60;
    if (f.bpm > 0) {
      let diff = f.beatPhase - (this.beat - Math.floor(this.beat));
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      this.beat += diff * 0.08;
    }
    const bar = Math.floor(this.beat / 4);
    if (bar !== this.bar) {
      this.lastBarSteps.set(this.kickSteps);
      this.kickSteps.fill(0);
      this.bar = bar;
    }
    this.step = Math.floor((((this.beat % 4) + 4) % 4) * 4) % 16;

    // spectral descriptors
    const sp = f.spectrum;
    let num = 0;
    let den = 0;
    let lg = 0;
    let ar = 0;
    let n = 0;
    let peakI = 1;
    for (let i = 2; i < sp.length; i++) {
      const v = sp[i] + 1e-4;
      num += v * i * f.binHz;
      den += v;
      if (sp[i] > sp[peakI]) peakI = i;
      const hz = i * f.binHz;
      if (hz > 200 && hz < 6000) {
        lg += Math.log(v);
        ar += v;
        n++;
      }
    }
    const centroid = num / Math.max(1e-6, den);
    const bTarget = clamp(Math.log2(Math.max(1, centroid) / 250) / Math.log2(7000 / 250));
    this.bright += (bTarget - this.bright) * (1 - Math.exp(-dt * 4));
    const flat = n ? Math.exp(lg / n) / Math.max(1e-6, ar / n) : 0;
    this.tension += (clamp(flat * 1.6 + f.treble * 0.3) - this.tension) * (1 - Math.exp(-dt * 3));
    let pk = 0;
    let sq = 0;
    for (let i = 0; i < f.waveform.length; i++) {
      const a = Math.abs(f.waveform[i]);
      if (a > pk) pk = a;
      sq += f.waveform[i] * f.waveform[i];
    }
    const crest = pk / Math.max(1e-4, Math.sqrt(sq / f.waveform.length));
    this.punch += (clamp((crest - 1.4) / 4 + f.beat * 0.4) - this.punch) * (1 - Math.exp(-dt * 6));
    this.leadHz = peakI * f.binHz;
    this.loudAvg += (f.rms - this.loudAvg) * (1 - Math.exp(-dt * 0.5));

    // hits
    if (f.kick) {
      this.addHit('kick', f.subBass > f.bass ? 0 : 1, 0.5 + f.bass * 0.5);
      this.kickSteps[this.step] = 1;
      this.hitBits |= 1;
    }
    if (f.snareHit) {
      this.addHit('snare', 2 + (f.treble > f.mid ? 1 : 0), 0.4 + f.mid * 0.6);
      this.hitBits |= 2;
    }
    if (f.hatHit) {
      this.addHit('hat', 4, 0.3 + f.treble * 0.7);
      this.hitBits |= 4;
    }

    // note spans / onsets / stats
    const act = new Set(f.activeNotes);
    for (const m of act) {
      if (this.prev.has(m)) continue;
      this.onsets.push(m);
      this.spans.push({ m, t0: this.clock, t1: this.clock, open: true });
      const band = m < 43 ? 0 : m < 55 ? 1 : m < 67 ? 2 : m < 79 ? 3 : 4;
      this.addHit('note', band, 0.3 + f.noteLevel[m] * 0.7, m);
      const last = this.recent[this.recent.length - 1];
      if (last !== undefined && last !== m) this.trans.set(last * 128 + m, (this.trans.get(last * 128 + m) ?? 0) + 1);
      this.recent.push(m);
      if (this.recent.length > 24) this.recent.shift();
      const half = this.beat * 2 - Math.floor(this.beat * 2);
      this.combo = Math.min(half, 1 - half) < 0.22 ? this.combo + 1 : 0;
      this.score += 10 * (1 + Math.floor(this.combo / 10));
    }
    for (const s of this.spans) {
      if (!s.open) continue;
      if (act.has(s.m)) s.t1 = this.clock;
      else s.open = false;
    }
    while (this.spans.length && (this.spans[0].t1 < this.clock - 30 || this.spans.length > 1500)) this.spans.shift();
    for (const m of act) this.sounded[m] += dt;
    this.prev = act;

    // bass note (lowest sounding note below C4, held briefly)
    let low = -1;
    for (const m of f.activeNotes) if (m < 60 && (low < 0 || m < low)) low = m;
    if (low < 0) {
      let best = 0;
      for (let m = NOTE_MIN; m < 56; m++) {
        if (f.noteLevel[m] > 0.35 && f.noteLevel[m] > best) {
          best = f.noteLevel[m];
          low = m;
        }
      }
    }
    if (low >= 0) {
      this.bassNote = low;
      this.bassHold = 0.6;
    } else if ((this.bassHold -= dt) <= 0) this.bassNote = -1;

    // key estimate (Krumhansl profiles on slowly accumulated chroma)
    for (let i = 0; i < 12; i++) this.chromaAcc[i] = this.chromaAcc[i] * Math.exp(-dt / 20) + f.chroma[i] * dt;
    if ((this.keyTimer += dt) > 1) {
      this.keyTimer = 0;
      let best = -Infinity;
      for (let t = 0; t < 12; t++) {
        for (const [prof, name] of [[MAJOR, 'major'], [MINOR, 'minor']] as const) {
          let s = 0;
          for (let i = 0; i < 12; i++) s += this.chromaAcc[(i + t) % 12] * prof[i];
          if (s > best) {
            best = s;
            this.key = `${PC[t]} ${name}`;
          }
        }
      }
    }

    // 20 Hz history
    this.hAcc += dt;
    while (this.hAcc >= 1 / RATE) {
      this.hAcc -= 1 / RATE;
      const i = this.hPos;
      this.hTime[i] = f.time;
      this.hLevel[i] = clamp(f.rms * 1.6);
      this.hPunch[i] = this.punch;
      this.hBright[i] = this.bright;
      this.hWidth[i] = f.width;
      this.hTension[i] = this.tension;
      this.hBass[i] = this.bassNote < 0 ? -1 : clamp((this.bassNote - NOTE_MIN) / (60 - NOTE_MIN));
      this.hHits[i] = this.hitBits;
      this.hitBits = 0;
      for (let k = 0; k < 4; k++) this.hNotes[i * 4 + k] = f.activeNotes[k] ?? -1;
      this.hPos = (i + 1) % HIST;
      this.hCount = Math.min(HIST, this.hCount + 1);
    }
  }

  /** Iterates history samples oldest → newest (k = 0 is the oldest). */
  hist(age: number): number {
    // index of the sample `age` steps before the newest
    return (this.hPos - 1 - age + HIST * 2) % HIST;
  }

  noteNames(list: number[]): string {
    return list.length ? list.slice(0, 4).map(noteName).join(' ') : '—';
  }

  hitsSince(id: number): Hit[] {
    const out: Hit[] = [];
    for (let i = this.hits.length - 1; i >= 0 && this.hits[i].id > id; i--) out.push(this.hits[i]);
    return out.reverse();
  }
}

export { NOTE_MAX };
