/*
 * A0 — INSTRUMENT_DECK
 * A dashboard of technical instrument panels in the style of minimalist music-analysis
 * hardware: waveform/loudness strip, scope, spectrum, vectorscope, bar clock, piano roll
 * with detected notes, receding note highway, note pads, "most played note" graph and key.
 * The layout adapts to portrait (9:16), square-ish (1:1, 4:5) and landscape (16:9).
 */
import type { AudioFeatures } from '../audio/AudioEngine';
import type { VisualizerInstance } from './types';
import { LogBands, TAU, clamp, hash01, hueShift, noteName, rgba, text, type Rect } from './draw';

type PanelId = 'strip' | 'scope' | 'spectrum' | 'vector' | 'dial' | 'roll' | 'highway' | 'pads' | 'graph' | 'legend' | 'progress';
type Box = [number, number, number, number];
interface Layout {
  W: number;
  H: number;
  p: Record<PanelId, Box>;
}

const PORTRAIT: Layout = {
  W: 1080,
  H: 1920,
  p: {
    strip: [36, 70, 476, 100],
    scope: [36, 200, 140, 170],
    spectrum: [205, 200, 140, 170],
    vector: [373, 200, 140, 170],
    dial: [560, 40, 490, 360],
    roll: [42, 425, 996, 565],
    highway: [98, 1050, 884, 320],
    pads: [98, 1390, 884, 128],
    graph: [430, 1545, 610, 270],
    legend: [40, 1700, 380, 130],
    progress: [36, 1850, 1008, 40],
  },
};

const SQUARE: Layout = {
  W: 1000,
  H: 1000,
  p: {
    strip: [30, 30, 450, 80],
    scope: [30, 128, 140, 122],
    spectrum: [185, 128, 140, 122],
    vector: [340, 128, 140, 122],
    dial: [500, 15, 470, 250],
    roll: [30, 275, 940, 305],
    highway: [30, 600, 560, 300],
    pads: [610, 600, 360, 140],
    graph: [610, 748, 360, 120],
    legend: [610, 872, 360, 80],
    progress: [30, 955, 940, 30],
  },
};

const LANDSCAPE: Layout = {
  W: 1920,
  H: 1080,
  p: {
    strip: [40, 40, 580, 110],
    scope: [40, 175, 185, 170],
    spectrum: [237, 175, 185, 170],
    vector: [435, 175, 185, 170],
    dial: [40, 360, 580, 410],
    legend: [60, 805, 560, 150],
    roll: [660, 40, 600, 920],
    highway: [1300, 40, 580, 450],
    pads: [1300, 510, 580, 150],
    graph: [1300, 680, 580, 280],
    progress: [40, 1000, 1840, 40],
  },
};

const ROLL_LO = 36; // C2
const ROLL_HI = 96; // C7
const PAGE = 16; // beats per piano-roll page (4 bars of 4)
const DEFAULT_PADS = [64, 67, 72, 74, 76, 79, 83, 84, 29, 41, 45, 48, 52, 53, 57, 60];
const BLACK = new Set([1, 3, 6, 8, 10]);

const fmt = (s: number): string => {
  if (!Number.isFinite(s)) return 'LIVE';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

interface NoteEvent {
  m: number;
  t0: number;
  t1: number;
  open: boolean;
}

export function createInstrumentDeck(): VisualizerInstance {
  let rollBeat = 0;
  const events: NoteEvent[] = [];
  const sounded = new Float32Array(128);
  const trans = new Map<number, number>();
  const recent: number[] = [];
  let lastOnset = -1;
  let prevActive = new Set<number>();
  let score = 0;
  let combo = 0;
  const lanes: { lane: number; z: number; m: number }[] = [];
  const parts: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  const loudHist = new Float32Array(240);
  let lhPos = 0;
  let lhAcc = 0;
  const songLoud = new Float32Array(300);
  const barLoud = new Float32Array(96);
  const prevWave = new Float32Array(2048);
  let pwTimer = 0;
  const spBands = new LogBands();
  const spPeaks = new Float32Array(12);
  let loudAvg = 0;

  /* ───────── state update ───────── */
  function update(f: AudioFeatures, dt: number): void {
    if (!f.active) return;
    const bpm = f.bpm || 120;
    rollBeat += (dt * bpm) / 60;
    if (f.bpm > 0) {
      let diff = f.beatPhase - (rollBeat - Math.floor(rollBeat));
      if (diff > 0.5) diff -= 1;
      if (diff < -0.5) diff += 1;
      rollBeat += diff * 0.08;
    }

    const act = new Set(f.activeNotes);
    for (const m of act) {
      if (prevActive.has(m)) continue;
      // onset
      events.push({ m, t0: rollBeat, t1: rollBeat, open: true });
      if (lastOnset >= 0 && lastOnset !== m) {
        const k = lastOnset * 128 + m;
        trans.set(k, (trans.get(k) ?? 0) + 1);
      }
      lastOnset = m;
      recent.push(m);
      if (recent.length > 16) recent.shift();
      const half = rollBeat * 2 - Math.floor(rollBeat * 2);
      const onBeat = Math.min(half, 1 - half) < 0.22;
      combo = onBeat ? combo + 1 : 0;
      score += 10 * (1 + Math.floor(combo / 10));
      lanes.push({ lane: m % 12, z: 0, m });
      if (lanes.length > 160) lanes.shift();
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI;
        const sp = 0.05 + Math.random() * 0.25;
        parts.push({ x: ((m % 12) + 0.5) / 12, y: 0, vx: Math.cos(a) * sp * 0.4, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.8 });
      }
      if (parts.length > 600) parts.splice(0, parts.length - 600);
    }
    for (const e of events) {
      if (!e.open) continue;
      if (act.has(e.m)) e.t1 = rollBeat;
      else e.open = false;
    }
    while (events.length && (events[0].t1 < rollBeat - PAGE || events.length > 2500)) events.shift();
    for (const m of act) sounded[m] += dt;
    prevActive = act;

    lhAcc += dt;
    while (lhAcc >= 1 / 30) {
      lhAcc -= 1 / 30;
      loudHist[lhPos] = f.rms;
      lhPos = (lhPos + 1) % loudHist.length;
    }
    loudAvg += (f.rms - loudAvg) * (1 - Math.exp(-dt * 0.5));
    if (Number.isFinite(f.duration) && f.duration > 0) {
      const b = Math.min(songLoud.length - 1, Math.floor((f.time / f.duration) * songLoud.length));
      songLoud[b] = Math.max(songLoud[b] * 0.98, f.rms);
    }
    const bi = Math.floor((((rollBeat % 4) + 4) % 4 / 4) * barLoud.length);
    barLoud[bi] = Math.min(1, f.rms * 0.8 + f.beat * 0.5);
    pwTimer += dt;
    if (pwTimer > 0.12) {
      pwTimer = 0;
      prevWave.set(f.waveform.subarray(0, prevWave.length));
    }
  }

  function animate(dt: number): void {
    for (let i = lanes.length - 1; i >= 0; i--) {
      lanes[i].z += dt * 0.28;
      if (lanes[i].z > 1) lanes.splice(i, 1);
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy -= 0.25 * dt;
      q.life -= dt;
      if (q.life <= 0 || q.y < -0.1) parts.splice(i, 1);
    }
  }

  return {
    draw(ctx, w, h, f, p) {
      update(f, p.dt);
      animate(p.dt);

      const ratio = h / w;
      const L = ratio >= 1.3 ? PORTRAIT : ratio >= 0.85 ? SQUARE : LANDSCAPE;
      const sx = w / L.W;
      const sy = h / L.H;
      const R = (id: PanelId): Rect => {
        const [x, y, bw, bh] = L.p[id];
        return { x: x * sx, y: y * sy, w: bw * sx, h: bh * sy };
      };
      const u = p.unit;
      const fs = 15 * u;
      const { ink, accent, bg } = p.palette;
      const acc2 = hueShift(accent, -32);
      const line = rgba(ink, 0.38);
      const faint = rgba(ink, 0.12);
      const lw = Math.max(1, p.stroke * u * 0.9);

      const label = (s: string, x: number, y: number, size = fs, color = rgba(ink, 0.8), align: CanvasTextAlign = 'left', weight = 500) => {
        ctx.letterSpacing = `${size * 0.12}px`;
        text(ctx, s, x, y, size, color, align, 'alphabetic', weight);
        ctx.letterSpacing = '0px';
      };
      const frame = (r: Rect, color = line) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      };
      const clip = (r: Rect, fn: () => void) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        fn();
        ctx.restore();
      };

      /* ── WAVEFORM / LOUDNESS strip ── */
      {
        const r = R('strip');
        frame(r);
        const tabH = Math.min(r.h * 0.34, 30 * u);
        const tw = r.w * 0.38;
        label('WAVEFORM', r.x + 10 * u, r.y + tabH * 0.75, fs * 0.95, rgba(ink, 0.6));
        label('LOUDNESS S', r.x + tw + 10 * u, r.y + tabH * 0.75, fs * 0.95, accent);
        ctx.fillStyle = faint;
        ctx.fillRect(r.x, r.y + tabH, r.w, Math.max(1, u));
        ctx.fillStyle = accent;
        ctx.fillRect(r.x + tw, r.y + tabH - 2 * u, r.w * 0.36, 2 * u);
        ctx.fillStyle = line;
        ctx.fillRect(r.x + tw, r.y, Math.max(1, u), tabH);
        const c: Rect = { x: r.x + 6 * u, y: r.y + tabH + 6 * u, w: r.w - 12 * u, h: r.h - tabH - 12 * u };
        const mid = c.y + c.h * 0.6;
        const bars = Math.max(30, Math.floor(c.w / (4 * u)));
        const bw = c.w / bars;
        const hasSong = !!f.overview && Number.isFinite(f.duration) && f.duration > 0;
        const prog = hasSong ? clamp(f.time / f.duration) : 1;
        ctx.fillStyle = rgba(ink, 0.45);
        for (let i = 0; i < bars; i++) {
          const v = hasSong && f.overview ? f.overview[Math.floor((i / bars) * f.overview.length)] : loudHist[(lhPos + Math.floor((i / bars) * loudHist.length)) % loudHist.length] * 1.4;
          const hh = Math.max(u, clamp(v) * c.h * 0.32);
          ctx.fillRect(c.x + i * bw, mid - hh, Math.max(1, bw * 0.55), hh * 2);
        }
        // loudness curve
        ctx.strokeStyle = accent;
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        const N = hasSong ? songLoud.length : loudHist.length;
        let started = false;
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1);
          if (hasSong && t > prog) break;
          const v = hasSong ? songLoud[i] : loudHist[(lhPos + i) % loudHist.length];
          const x = c.x + t * c.w;
          const y = c.y + c.h * 0.95 - clamp(v * 1.6) * c.h * 0.8;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // playhead
        const px = c.x + prog * c.w;
        ctx.fillStyle = accent;
        ctx.fillRect(px - lw, r.y + tabH, lw * 2, r.h - tabH);
        ctx.fillStyle = ink;
        ctx.fillRect(px - 10 * u, mid - 3 * u, 6 * u, 6 * u);
        ctx.setLineDash([3 * u, 3 * u]);
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath();
        ctx.moveTo(Math.max(c.x, px - 40 * u), mid);
        ctx.lineTo(px - 10 * u, mid);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* ── SCOPE ── */
      {
        const r = R('scope');
        frame(r);
        label('SCOPE', r.x + 8 * u, r.y + 22 * u, fs * 0.95, rgba(ink, 0.7));
        clip(r, () => {
          ctx.strokeStyle = faint;
          ctx.lineWidth = Math.max(1, u * 0.8);
          ctx.beginPath();
          for (let i = 1; i < 4; i++) {
            ctx.moveTo(r.x + (i * r.w) / 4, r.y);
            ctx.lineTo(r.x + (i * r.w) / 4, r.y + r.h);
            ctx.moveTo(r.x, r.y + (i * r.h) / 4);
            ctx.lineTo(r.x + r.w, r.y + (i * r.h) / 4);
          }
          ctx.stroke();
          const wf = f.waveform;
          let trig = 0;
          for (let i = 1; i < 1024; i++) {
            if (wf[i - 1] < 0 && wf[i] >= 0) {
              trig = i;
              break;
            }
          }
          const span = 320;
          const cy = r.y + r.h * 0.58;
          const amp = (r.h * 0.3) / Math.max(0.12, f.peak);
          const trace = (src: Float32Array, off: number, color: string, width: number) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.beginPath();
            for (let i = 0; i <= span; i += 3) {
              const x = r.x + (i / span) * r.w;
              const y = cy - src[off + i] * amp;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          };
          trace(prevWave, 0, rgba(ink, 0.45), Math.max(1, lw * 0.8));
          trace(wf, trig, accent, lw * 1.5);
        });
      }

      /* ── SPECTRUM ── */
      {
        const r = R('spectrum');
        frame(r);
        label('SPECTRUM', r.x + 8 * u, r.y + 22 * u, fs * 0.95, rgba(ink, 0.7));
        const v = spBands.compute(f.spectrum, f.binHz, 12, 50, 9000, 'max');
        let maxI = 0;
        for (let i = 0; i < 12; i++) {
          if (v[i] > v[maxI]) maxI = i;
          spPeaks[i] = Math.max(v[i], spPeaks[i] - p.dt * 0.35);
        }
        const pad = 8 * u;
        const bw = (r.w - pad * 2) / 12;
        const base = r.y + r.h - 4 * u;
        const H = r.h * 0.62;
        for (let i = 0; i < 12; i++) {
          const x = r.x + pad + i * bw;
          const hh = Math.max(2 * u, v[i] * H);
          ctx.fillStyle = i === maxI && v[i] > 0.05 ? accent : ink;
          ctx.fillRect(x, base - hh, bw * 0.72, hh);
          ctx.fillStyle = accent;
          ctx.fillRect(x, base - spPeaks[i] * H - 8 * u, bw * 0.72, 3 * u);
          if (i % 2 === 0) ctx.fillRect(x, base - spPeaks[i] * H - 15 * u, bw * 0.72, 2 * u);
        }
      }

      /* ── VECTOR ── */
      {
        const r = R('vector');
        frame(r);
        label('VECTOR', r.x + 8 * u, r.y + 22 * u, fs * 0.95, rgba(ink, 0.7));
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h * 0.58;
        const rad = Math.min(r.w, r.h) * 0.3;
        ctx.strokeStyle = rgba(ink, 0.45);
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.moveTo(cx + rad * 0.45, cy);
        ctx.arc(cx, cy, rad * 0.45, 0, TAU);
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 4;
          ctx.moveTo(cx - Math.cos(a) * rad * 1.25, cy - Math.sin(a) * rad * 1.25);
          ctx.lineTo(cx + Math.cos(a) * rad * 1.25, cy + Math.sin(a) * rad * 1.25);
        }
        ctx.stroke();
        const wf = f.waveform;
        const d = 18;
        ctx.fillStyle = accent;
        const s = (rad * 0.6) / Math.max(0.12, f.peak);
        const dot = Math.max(1.5, 2.2 * u);
        for (let i = 0; i < 900; i += 3) {
          const a = wf[i];
          const b = wf[i + d];
          const x = cx + ((a - b) / Math.SQRT2) * s;
          const y = cy - ((a + b) / Math.SQRT2) * s;
          ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
        }
        ctx.fillStyle = rgba(ink, 0.85);
        ctx.beginPath();
        ctx.arc(cx, cy, rad * 0.05 + f.rms * rad * 0.25, 0, TAU);
        ctx.fill();
      }

      /* ── BAR clock ── */
      {
        const r = R('dial');
        const cx = r.x + r.w * 0.55;
        const cy = r.y + r.h * 0.5;
        const rad = Math.min(r.w * 0.4, r.h * 0.33);
        const barPos = ((rollBeat % 4) + 4) % 4;
        const beatIdx = Math.floor(barPos);
        const barNo = (Math.floor(rollBeat / 4) % 4) + 1;
        ctx.fillStyle = accent;
        ctx.fillRect(r.x + 8 * u, r.y + 18 * u, 16 * u, 16 * u);
        label('CH 1', r.x + 34 * u, r.y + 32 * u, fs * 1.05, ink, 'left', 700);
        // rings + ticks
        ctx.strokeStyle = rgba(ink, 0.4);
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, TAU);
        ctx.moveTo(cx + rad * 0.24, cy);
        ctx.arc(cx, cy, rad * 0.24, 0, TAU);
        for (let i = 0; i < 16; i++) {
          if (i % 4 === 0) continue;
          const a = (i / 16) * TAU - Math.PI / 2;
          ctx.moveTo(cx + Math.cos(a) * rad * 1.1, cy + Math.sin(a) * rad * 1.1);
          ctx.lineTo(cx + Math.cos(a) * rad * 1.17, cy + Math.sin(a) * rad * 1.17);
        }
        ctx.stroke();
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw * 1.4;
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const a = (q / 4) * TAU - Math.PI / 2;
          const co = Math.cos(a);
          const si = Math.sin(a);
          ctx.moveTo(cx + co * rad * 1.1, cy + si * rad * 1.1);
          ctx.lineTo(cx + co * rad * 1.28, cy + si * rad * 1.28);
          const lr = rad * 1.45;
          label(String(q + 1), cx + co * lr, cy + si * lr + fs * 0.4, fs * 1.15, q === beatIdx ? accent : ink, 'center', 700);
        }
        ctx.stroke();
        // loudness trail along the bar
        const ang = (barPos / 4) * TAU - Math.PI / 2;
        const tr = rad * 0.72;
        const n = Math.floor((barPos / 4) * barLoud.length);
        for (let i = 0; i <= n; i++) {
          const a = (i / barLoud.length) * TAU - Math.PI / 2;
          const th = (3 + barLoud[i] * 16) * u;
          const age = (n - i) / barLoud.length;
          ctx.fillStyle = rgba(accent, 0.45 + 0.5 * (1 - age));
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * tr, cy + Math.sin(a) * tr, th, 0, TAU);
          ctx.fill();
          if (hash01(i, 5) < barLoud[i]) {
            const rr = tr + (hash01(i, 6) - 0.5) * th * 3;
            ctx.fillStyle = rgba(accent, 0.3);
            ctx.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 * u, 2 * u);
          }
        }
        // hand
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw * 1.6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * rad * 0.24, cy + Math.sin(ang) * rad * 0.24);
        ctx.lineTo(cx + Math.cos(ang) * rad * 1.05, cy + Math.sin(ang) * rad * 1.05);
        ctx.stroke();
        label('BAR', cx, cy - rad * 0.04, fs * 0.8, rgba(ink, 0.7), 'center');
        label(String(barNo), cx, cy + rad * 0.17, fs * 1.3, ink, 'center', 700);
      }

      /* ── PIANO ROLL ── */
      {
        const r = R('roll');
        const gut = 48 * u;
        const head = 26 * u;
        const gx = r.x + gut;
        const gw = r.w - gut;
        const top = r.y + head;
        const gh = r.h - head;
        const rows = ROLL_HI - ROLL_LO + 1;
        const rowH = gh / rows;
        const yOf = (m: number) => top + (ROLL_HI - m) * rowH;
        ctx.fillStyle = rgba(ink, 0.06);
        for (let m = ROLL_LO; m <= ROLL_HI; m++) if (BLACK.has(m % 12)) ctx.fillRect(gx, yOf(m), gw, rowH);
        ctx.strokeStyle = faint;
        ctx.lineWidth = Math.max(1, u * 0.7);
        ctx.beginPath();
        for (let m = ROLL_LO; m <= ROLL_HI + 1; m++) {
          const y = yOf(m - 1);
          ctx.moveTo(gx, y);
          ctx.lineTo(gx + gw, y);
        }
        for (let b = 1; b < PAGE; b++) {
          if (b % 4 === 0) continue;
          const x = gx + (b / PAGE) * gw;
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + gh);
        }
        ctx.stroke();
        ctx.strokeStyle = line;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let m = ROLL_LO; m <= ROLL_HI; m += 12) {
          const y = yOf(m) + rowH;
          ctx.moveTo(r.x, y);
          ctx.lineTo(r.x + r.w, y);
          label(`C${Math.floor(m / 12) - 1}`, r.x + 8 * u, y - 5 * u, fs * 0.9, rgba(ink, 0.6));
        }
        for (let bar = 0; bar <= 4; bar++) {
          const x = gx + (bar / 4) * gw;
          ctx.moveTo(x, r.y);
          ctx.lineTo(x, r.y + r.h);
          if (bar < 4) label(String(bar + 1), x + 10 * u, r.y + head * 0.75, fs * 0.95, rgba(ink, 0.7));
        }
        ctx.moveTo(r.x, top);
        ctx.lineTo(r.x + r.w, top);
        ctx.stroke();
        frame(r, rgba(ink, 0.55));

        const page = Math.floor(rollBeat / PAGE);
        for (const e of events) {
          if (e.m < ROLL_LO || e.m > ROLL_HI) continue;
          const x0n = ((e.t0 % PAGE) + PAGE) % PAGE / PAGE;
          const len = Math.min(1 - x0n, (e.t1 - e.t0) / PAGE);
          const cur = Math.floor(e.t0 / PAGE) === page;
          const lvl = f.noteLevel[e.m];
          ctx.fillStyle = e.open ? accent : cur ? rgba(accent, 0.55 + lvl * 0.4) : rgba(accent, 0.28);
          ctx.fillRect(gx + x0n * gw, yOf(e.m) + rowH * 0.12, Math.max(6 * u, len * gw), Math.max(2 * u, rowH * 0.76));
        }
        // live note "ghost" ticks at the playhead
        const phx = gx + ((((rollBeat % PAGE) + PAGE) % PAGE) / PAGE) * gw;
        ctx.fillStyle = rgba(accent, 0.5);
        for (const m of f.activeNotes) {
          if (m < ROLL_LO || m > ROLL_HI) continue;
          for (let k = 1; k <= 6; k++) ctx.fillRect(phx - k * 7 * u, yOf(m) + rowH * 0.3, 3 * u, Math.max(1.5 * u, rowH * 0.4));
        }
        ctx.fillStyle = ink;
        ctx.fillRect(phx - lw * 1.2, r.y - 10 * u, lw * 2.4, r.h + 20 * u);
      }

      /* ── NOTE HIGHWAY ── */
      {
        const r = R('highway');
        frame(r, rgba(ink, 0.45));
        const vpx = r.x + r.w / 2;
        const vpy = r.y + r.h * 0.12;
        const hitY = r.y + r.h * 0.84;
        const left = r.x + r.w * 0.08;
        const right = r.x + r.w * 0.9;
        const laneW = (right - left) / 12;
        const K = 4;
        const persp = (z: number) => (1 - 1 / (1 + z * K)) / (1 - 1 / (1 + K));
        const at = (laneX: number, z: number): [number, number] => {
          const t = persp(z);
          return [laneX + (vpx - laneX) * t, hitY + (vpy - hitY) * t];
        };
        clip(r, () => {
          // beams for sounding pitch classes
          for (let pc = 0; pc < 12; pc++) {
            const c = f.chroma[pc];
            if (c < 0.25) continue;
            const x0 = left + pc * laneW;
            const [ax, ay] = at(x0, 0.75);
            const [bx] = at(x0 + laneW, 0.75);
            const grad = ctx.createLinearGradient(0, hitY, 0, ay);
            grad.addColorStop(0, rgba(pc % 2 ? acc2 : accent, 0.35 * c));
            grad.addColorStop(1, rgba(accent, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(x0, hitY);
            ctx.lineTo(x0 + laneW, hitY);
            ctx.lineTo(bx, ay);
            ctx.lineTo(ax, ay);
            ctx.closePath();
            ctx.fill();
          }
          // lane lines
          ctx.strokeStyle = rgba(accent, 0.45);
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          for (let i = 0; i <= 12; i++) {
            const x = left + i * laneW;
            const [ex, ey] = at(x, 1);
            ctx.moveTo(x - (vpx - x) * 0.08, hitY + (hitY - ey) * 0.08);
            ctx.lineTo(ex, ey);
          }
          ctx.stroke();
          ctx.strokeStyle = rgba(ink, 0.3);
          ctx.beginPath();
          const [hlx, hly] = at(left, 0.35);
          const [hrx] = at(right, 0.35);
          ctx.moveTo(hlx, hly);
          ctx.lineTo(hrx, hly);
          ctx.moveTo(left - laneW * 0.4, hitY);
          ctx.lineTo(right + laneW * 0.4, hitY);
          ctx.stroke();
          // receding notes
          for (const n of lanes) {
            const x0 = left + n.lane * laneW;
            const [ax, ay] = at(x0 + laneW * 0.15, n.z);
            const [bx] = at(x0 + laneW * 0.85, n.z);
            const s = 1 - persp(n.z) * 0.85;
            ctx.fillStyle = Math.floor(n.m / 12) % 2 ? accent : acc2;
            ctx.fillRect(ax, ay - 3 * u * s, bx - ax, Math.max(1.5, 6 * u * s));
            ctx.fillStyle = rgba(ink, 0.35);
            ctx.fillRect(ax, ay + 3 * u * s, bx - ax, Math.max(1, 1.5 * u * s));
          }
          // particles
          ctx.fillStyle = rgba(ink, 0.35);
          for (const q of parts) {
            const x = left + q.x * (right - left);
            const y = hitY - q.y * r.h;
            const sz = 2.4 * u;
            ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
          }
        });
        // hit circles + labels
        const active = new Set(f.activeNotes.map((m) => m % 12));
        for (let pc = 0; pc < 12; pc++) {
          const x = left + (pc + 0.5) * laneW;
          const on = active.has(pc);
          const rr = laneW * 0.28;
          ctx.strokeStyle = on ? (pc % 2 ? acc2 : accent) : rgba(ink, 0.55);
          ctx.lineWidth = on ? lw * 2.4 : Math.max(1, u * 1.2);
          ctx.beginPath();
          ctx.arc(x, hitY, rr, 0, TAU);
          ctx.stroke();
          if (on) {
            ctx.fillStyle = rgba(accent, 0.25);
            ctx.fill();
          }
        }
        let stack = 0;
        for (const m of f.activeNotes) {
          const x = left + ((m % 12) + 0.5) * laneW;
          label(noteName(m), x, hitY - laneW * 0.45 - (stack % 3) * fs * 0.95, fs * 0.8, ink, 'center', 700);
          stack++;
        }
        label(`SCORE ${String(score).padStart(7, '0')}`, r.x + 18 * u, r.y + 30 * u, fs * 1.15, ink, 'left', 700);
        label(`${combo} COMBO ×${1 + Math.floor(combo / 10)}`, r.x + r.w - 26 * u, r.y + 30 * u, fs, accent, 'right', 700);
        const section = loudAvg < 0.08 ? 'INTRO' : loudAvg < 0.2 ? 'VERSE' : loudAvg < 0.32 ? 'CHORUS' : 'DROP';
        label(f.active ? section : 'STANDBY', r.x + 18 * u, r.y + r.h - 10 * u, fs * 0.8, rgba(ink, 0.7));
        label(f.bpm ? `${Math.round(f.bpm)} BPM` : '--- BPM', r.x + r.w - 26 * u, r.y + r.h - 10 * u, fs * 0.8, rgba(ink, 0.7), 'right');
        // side meter
        const mx = r.x + r.w - 12 * u;
        const my0 = r.y + r.h * 0.2;
        const mh = r.h * 0.58;
        ctx.fillStyle = rgba(ink, 0.15);
        ctx.fillRect(mx, my0, 5 * u, mh);
        ctx.fillStyle = rgba(ink, 0.7);
        const lv = clamp(f.rms * 1.8);
        ctx.fillRect(mx, my0 + mh * (1 - lv), 5 * u, mh * lv);
      }

      /* ── PADS ── */
      {
        const r = R('pads');
        const top: number[] = [];
        for (let m = 0; m < 128; m++) if (sounded[m] > 0.05) top.push(m);
        top.sort((a, b) => sounded[b] - sounded[a]);
        const chosen = top.slice(0, 16);
        for (const d of DEFAULT_PADS) if (chosen.length < 16 && !chosen.includes(d)) chosen.push(d);
        chosen.sort((a, b) => a - b);
        const cols = r.w / r.h > 4 ? 8 : 4;
        const rowsN = 16 / cols;
        // highest notes on the top row
        const ordered: number[] = [];
        for (let row = 0; row < rowsN; row++) {
          const slice = chosen.slice(16 - (row + 1) * cols, 16 - row * cols);
          ordered.push(...slice);
        }
        const gap = 8 * u;
        const pw = (r.w - gap * (cols - 1)) / cols;
        const ph = (r.h - gap * (rowsN - 1)) / rowsN;
        const act = new Set(f.activeNotes);
        ordered.forEach((m, i) => {
          const c = i % cols;
          const row = Math.floor(i / cols);
          const x = r.x + c * (pw + gap);
          const y = r.y + row * (ph + gap);
          const lvl = f.noteLevel[m];
          const on = act.has(m);
          const col = m % 3 === 1 ? acc2 : accent;
          ctx.fillStyle = on ? col : lvl > 0.12 ? rgba(col, 0.25 + lvl * 0.5) : rgba(bg, 1);
          ctx.fillRect(x, y, pw, ph);
          ctx.fillStyle = rgba(ink, 0.12);
          ctx.fillRect(x, y + ph - 3 * u, pw, 3 * u);
          ctx.strokeStyle = rgba(ink, 0.5);
          ctx.lineWidth = Math.max(1, u * 1.1);
          ctx.strokeRect(x, y, pw, ph);
          label(noteName(m), x + pw / 2, y + ph / 2 + fs * 0.32, fs * 0.85, on ? bg : ink, 'center', 700);
        });
      }

      /* ── MOST PLAYED graph ── */
      {
        const r = R('graph');
        const nodes: number[] = [];
        for (let m = 0; m < 128; m++) if (sounded[m] > 0.05) nodes.push(m);
        nodes.sort((a, b) => sounded[b] - sounded[a]);
        const top = nodes.slice(0, 12);
        const total = top.reduce((s, m) => s + sounded[m], 0) || 1;
        const pos = (m: number): [number, number] => [
          r.x + r.w * (0.06 + 0.88 * ((m % 12) / 11)),
          r.y + r.h * (0.12 + 0.76 * hash01(m, 3)),
        ];
        // transitions between top notes
        ctx.lineWidth = Math.max(1, u);
        for (const a of top) {
          for (const b of top) {
            const c = trans.get(a * 128 + b);
            if (!c) continue;
            const [x1, y1] = pos(a);
            const [x2, y2] = pos(b);
            ctx.strokeStyle = rgba(accent, Math.min(0.5, 0.08 + c * 0.04));
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
        // path of the last notes
        if (recent.length > 1) {
          ctx.strokeStyle = rgba(accent, 0.7);
          ctx.lineWidth = lw * 1.3;
          ctx.beginPath();
          recent.forEach((m, i) => {
            const [x, y] = pos(m);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          const [lx, ly] = pos(recent[recent.length - 1]);
          ctx.fillStyle = ink;
          ctx.beginPath();
          ctx.arc(lx, ly, 3.5 * u, 0, TAU);
          ctx.fill();
        }
        // ghost nodes when nothing was heard yet
        const list = top.length ? top : [55, 62, 67, 71, 74, 79];
        list.forEach((m, i) => {
          const [x, y] = pos(m);
          const share = top.length ? sounded[m] / total : 0.08;
          const rr = (5 + Math.sqrt(share) * 26) * u;
          ctx.strokeStyle = top.length ? ink : rgba(ink, 0.3);
          ctx.lineWidth = Math.max(1, (i === 0 && top.length ? 2 : 1.2) * u);
          ctx.beginPath();
          ctx.arc(x, y, rr, 0, TAU);
          ctx.stroke();
          if (f.activeNotes.includes(m)) {
            ctx.fillStyle = rgba(accent, 0.5);
            ctx.fill();
          }
        });
        if (top.length) {
          const best = top[0];
          const [x, y] = pos(best);
          const rr = (5 + Math.sqrt(sounded[best] / total) * 26) * u;
          ctx.strokeStyle = ink;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.arc(x, y, rr + 5 * u, 0, TAU);
          ctx.stroke();
          const tx = x + rr + 14 * u;
          const flip = tx + 200 * u > r.x + r.w;
          const ax = flip ? x - rr - 12 * u : tx;
          const yl = Math.min(y, r.y + r.h - fs * 1.2);
          label(flip ? 'MOST PLAYED →' : '← MOST PLAYED', ax, yl - 2 * u, fs * 0.95, rgba(ink, 0.75), flip ? 'right' : 'left');
          label(`NOTE, ${noteName(best)}`, ax, yl + fs, fs * 0.95, rgba(ink, 0.75), flip ? 'right' : 'left');
        }
      }

      /* ── KEY ── */
      {
        const r = R('legend');
        const lh = Math.min(fs * 1.35, r.h / 4);
        const s = Math.min(fs * 0.85, lh * 0.8, r.w / 27);
        label('KEY', r.x, r.y + lh * 0.8, s * 1.15, ink, 'left', 700);
        const rows: [string, (x: number, y: number) => void][] = [
          ['A note, as large as it has sounded long', (x, y) => {
            ctx.fillStyle = acc2;
            ctx.beginPath();
            ctx.arc(x, y, s * 0.4, 0, TAU);
            ctx.fill();
          }],
          ['Path of the last notes played', (x, y) => {
            ctx.fillStyle = accent;
            ctx.fillRect(x - s * 0.45, y - u, s * 0.9, 2 * u);
          }],
          ['Transition heard between two notes', (x, y) => {
            ctx.fillStyle = rgba(accent, 0.35);
            ctx.fillRect(x - s * 0.45, y - u * 0.5, s * 0.9, u);
          }],
        ];
        rows.forEach(([t, icon], i) => {
          const y = r.y + lh * (i + 1.8);
          icon(r.x + s * 0.45, y - s * 0.32);
          label(t, r.x + s * 1.3, y, s, rgba(ink, 0.8));
        });
      }

      /* ── progress ── */
      {
        const r = R('progress');
        const y = r.y + r.h / 2;
        const lineW = r.w * 0.38;
        ctx.fillStyle = rgba(ink, 0.35);
        ctx.fillRect(r.x, y, lineW, Math.max(1, u));
        const prog = Number.isFinite(f.duration) && f.duration > 0 ? clamp(f.time / f.duration) : 0;
        ctx.fillStyle = ink;
        ctx.fillRect(r.x, y - u, lineW * prog, 3 * u);
        label(`${fmt(f.time)} / ${fmt(f.duration)}`, r.x + lineW + 22 * u, y + fs * 0.35, fs * 0.95, rgba(ink, 0.75));
        label('IRIS//VIZ', r.x + r.w, y + fs * 0.35, fs * 0.95, ink, 'right', 700);
      }
    },
  };
}
