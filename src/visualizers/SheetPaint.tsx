/*
 * SHEET PAINT — image-to-audio mode.
 * An image is sampled on an offscreen canvas (luminance + Sobel edges) and redrawn
 * every frame in one of five audio-reactive "sheet" styles.
 */
import { useRef } from 'react';
import type { AudioFeatures } from '../audio/AudioEngine';
import type { RenderParams } from './types';
import { Btn, Slider, Toggle } from '../components/ui';
import { LogBands, RippleField, TAU, clamp, cornerMarks, fitRect, hash01, regMark, rgba, text, FONT, type Rect } from './draw';

export type SheetStyle = 'halftone' | 'scanline' | 'ascii' | 'contour' | 'brush';

export const SHEET_STYLES: { id: SheetStyle; code: string; label: string; desc: string }[] = [
  { id: 'halftone', code: 'S1', label: 'HALFTONE_DOT', desc: 'darkness → dot size · bass pulse' },
  { id: 'scanline', code: 'S2', label: 'SCANLINE_WAVE', desc: 'brightness displaces lines' },
  { id: 'ascii', code: 'S3', label: 'GLYPH_ASCII', desc: 'monospace glyphs · hat flashes' },
  { id: 'contour', code: 'S4', label: 'BLUEPRINT_CONTOUR', desc: 'iso-lines · beat jitter' },
  { id: 'brush', code: 'S5', label: 'AUDIO_BRUSH', desc: 'progressive paint reveal' },
];

export interface SheetParams {
  style: SheetStyle;
  /** Contrast threshold 0..1. */
  threshold: number;
  invert: boolean;
  /** Audio distortion / pulse amount 0..1. */
  distortion: number;
  /** Incremented by the REDRAW button. */
  redraw: number;
}

export interface SheetImage {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  thumb: string;
}

interface Grid {
  cols: number;
  rows: number;
  lum: Float32Array;
  edge: Float32Array;
  angle: Float32Array;
}

const RAMP = ['·', '-', '+', '—', 'X', '0', '▪'];
const FLASH = ['X', '0', '▪', '+'];

function boxBlur(src: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          s += src[yy * cols + xx];
          n++;
        }
      }
      out[y * cols + x] = s / n;
    }
  }
  return out;
}

/** Marching squares → flat segment list [x1,y1,x2,y2,...] in normalised 0..1 coords. */
function marchingSquares(field: Float32Array, cols: number, rows: number, level: number): Float32Array {
  const out: number[] = [];
  const sx = 1 / (cols - 1);
  const sy = 1 / (rows - 1);
  const t = (p: number, q: number) => {
    const d = q - p;
    return d === 0 ? 0.5 : (level - p) / d;
  };
  const seg = (x1: number, y1: number, x2: number, y2: number) => out.push(x1 * sx, y1 * sy, x2 * sx, y2 * sy);
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i = y * cols + x;
      const a = field[i];
      const b = field[i + 1];
      const c = field[i + cols + 1];
      const d = field[i + cols];
      let idx = 0;
      if (a >= level) idx |= 8;
      if (b >= level) idx |= 4;
      if (c >= level) idx |= 2;
      if (d >= level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const tx = x + t(a, b), ty = y; // top
      const rx = x + 1, ry = y + t(b, c); // right
      const bx = x + t(d, c), by = y + 1; // bottom
      const lx = x, ly = y + t(a, d); // left
      switch (idx) {
        case 1: case 14: seg(lx, ly, bx, by); break;
        case 2: case 13: seg(bx, by, rx, ry); break;
        case 3: case 12: seg(lx, ly, rx, ry); break;
        case 4: case 11: seg(tx, ty, rx, ry); break;
        case 6: case 9: seg(tx, ty, bx, by); break;
        case 7: case 8: seg(lx, ly, tx, ty); break;
        case 5: seg(lx, ly, bx, by); seg(tx, ty, rx, ry); break;
        case 10: seg(lx, ly, tx, ty); seg(bx, by, rx, ry); break;
      }
    }
  }
  return new Float32Array(out);
}

export class SheetPainter {
  private img: HTMLCanvasElement | null = null;
  private sampler: HTMLCanvasElement | null = null;
  private grids = new Map<string, Grid>();
  private contours = new Map<string, Float32Array>();
  private ripples = new RippleField();
  private bands = new LogBands();
  // progressive brush state
  private bKey = '';
  private bOrder = new Int32Array(0);
  private bCursor = 0;
  private bBudget = 0;
  private bStrokes: number[] = [];
  private bPaint: HTMLCanvasElement | null = null;
  private bPaintKey = '';
  private bRedraw = -1;
  private bLastX = 0.5;
  private bLastY = 0.5;

  setImage(c: HTMLCanvasElement | null): void {
    if (c === this.img) return;
    this.img = c;
    this.grids.clear();
    this.contours.clear();
    this.resetBrush();
  }

  private resetBrush(): void {
    this.bKey = '';
    this.bCursor = 0;
    this.bBudget = 0;
    this.bStrokes = [];
    this.bPaintKey = '';
  }

  private grid(cols: number, rows: number): Grid | null {
    if (!this.img) return null;
    cols = Math.max(2, Math.round(cols));
    rows = Math.max(2, Math.round(rows));
    const key = `${cols}x${rows}`;
    const hit = this.grids.get(key);
    if (hit) return hit;
    if (this.grids.size > 24) this.grids.clear();
    if (!this.sampler) this.sampler = document.createElement('canvas');
    const c = this.sampler;
    c.width = cols;
    c.height = rows;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, cols, rows);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.img, 0, 0, cols, rows);
    const data = g.getImageData(0, 0, cols, rows).data;
    const N = cols * rows;
    const lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
    }
    const edge = new Float32Array(N);
    const angle = new Float32Array(N);
    let max = 1e-6;
    const L = (x: number, y: number) => lum[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
        const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
        const mag = Math.hypot(gx, gy);
        edge[y * cols + x] = mag;
        angle[y * cols + x] = Math.atan2(gy, gx);
        if (mag > max) max = mag;
      }
    }
    for (let i = 0; i < N; i++) edge[i] /= max;
    const grid: Grid = { cols, rows, lum, edge, angle };
    this.grids.set(key, grid);
    return grid;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: AudioFeatures, p: RenderParams, sp: SheetParams): void {
    const u = p.unit;
    const { ink } = p.palette;
    this.ripples.update(p.dt);
    if (f.kick) this.ripples.spawn(0.9 + f.bass * 0.4, 0.9);

    if (!this.img) {
      text(ctx, 'NO_IMAGE // UPLOAD OR PICK A DEFAULT SHEET', w / 2, h / 2, 16 * u, rgba(ink, 0.6), 'center', 'middle');
      return;
    }
    const aspect = this.img.width / Math.max(1, this.img.height);
    const margin = Math.min(w, h) * (sp.style === 'contour' ? 0.11 : 0.075);
    const rect = fitRect(w, h, aspect, margin);
    const th = sp.threshold;
    const tone = (d: number) => clamp((d - th) * 2.2 + 0.5);

    switch (sp.style) {
      case 'halftone':
        this.halftone(ctx, rect, f, p, sp, tone);
        break;
      case 'scanline':
        this.scanline(ctx, rect, f, p, sp, tone);
        break;
      case 'ascii':
        this.ascii(ctx, rect, f, p, sp, tone);
        break;
      case 'contour':
        this.contour(ctx, rect, f, p, sp);
        break;
      case 'brush':
        this.brush(ctx, rect, f, p, sp, tone);
        break;
    }

    if (sp.style !== 'contour') {
      cornerMarks(ctx, { x: rect.x - 10 * u, y: rect.y - 10 * u, w: rect.w + 20 * u, h: rect.h + 20 * u }, 16 * u, rgba(ink, 0.6), Math.max(1, u));
    }
    const meta = SHEET_STYLES.find((s) => s.id === sp.style);
    text(ctx, `SHEET_MODE // ${meta?.label ?? ''}`, rect.x - 10 * u, rect.y - 22 * u, 12 * u, ink, 'left', 'alphabetic', 700);
    text(ctx, `THR ${th.toFixed(2)} · PULSE ${sp.distortion.toFixed(2)}${sp.invert ? ' · INV' : ''}`, rect.x + rect.w + 10 * u, rect.y - 22 * u, 11 * u, rgba(ink, 0.55), 'right');
  }

  /* ───────── S1 halftone ───────── */
  private halftone(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, sp: SheetParams, tone: (d: number) => number): void {
    const cols = Math.round(30 + p.detail * 90);
    const cell = rect.w / cols;
    const rows = Math.max(2, Math.round(rect.h / cell));
    const g = this.grid(cols, rows);
    if (!g) return;
    const cellH = rect.h / g.rows;
    const dots = new Path2D();
    const sq = new Path2D();
    const D = sp.distortion;
    const maxD = Math.hypot(rect.w, rect.h) / 2;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        const i = y * g.cols + x;
        const dark = sp.invert ? g.lum[i] : 1 - g.lum[i];
        const t = tone(dark);
        if (t < 0.02) continue;
        const px = rect.x + (x + 0.5) * cell;
        const py = rect.y + (y + 0.5) * cellH;
        const dist = Math.hypot(px - cx, py - cy) / maxD;
        const infl = this.ripples.at(dist, 0.08);
        const r = Math.min(cell * 0.78, cell * 0.52 * Math.sqrt(t) * (1 + D * (f.bass * 0.35 + f.beat * 0.25 + infl * 0.9)));
        if (infl * D > 0.28 && t > 0.1) {
          const s = r * 0.85;
          sq.rect(px - s, py - s, s * 2, s * 2);
        } else {
          dots.moveTo(px + r, py);
          dots.arc(px, py, r, 0, TAU);
        }
      }
    }
    ctx.fillStyle = p.palette.ink;
    ctx.fill(dots);
    ctx.fillStyle = p.palette.accent;
    ctx.fill(sq);
  }

  /* ───────── S2 scanline wave ───────── */
  private scanline(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, sp: SheetParams, tone: (d: number) => number): void {
    const L = Math.round(20 + p.detail * 70);
    const S = Math.round(clamp((L * rect.w) / rect.h * 2.5, 40, 360));
    const g = this.grid(S, L);
    if (!g) return;
    const spacing = rect.h / g.rows;
    const spec = this.bands.compute(f.spectrum, f.binHz, 64, 40, 12000, 'max');
    const D = sp.distortion;
    const lw = Math.max(1, p.stroke * p.unit * 1.1);
    const scan = Math.floor(((p.time * 0.22) % 1) * g.rows);
    const ys = new Float32Array(g.cols);
    ctx.lineJoin = 'round';
    for (let j = 0; j < g.rows; j++) {
      const y0 = rect.y + (j + 0.5) * spacing;
      for (let i = 0; i < g.cols; i++) {
        const k = j * g.cols + i;
        const dark = sp.invert ? g.lum[k] : 1 - g.lum[k];
        const t = tone(dark);
        const v = spec[Math.min(63, Math.floor((i / g.cols) * 64))];
        const ripple = Math.sin(i * 0.32 + p.time * 7 - j * 0.6) * v * D * spacing * 1.3;
        ys[i] = y0 - t * spacing * 1.7 * (1 + f.bass * D * 0.6) + ripple;
      }
      const xAt = (i: number) => rect.x + (i / (g.cols - 1)) * rect.w;
      ctx.beginPath();
      ctx.moveTo(xAt(0), y0 + spacing);
      for (let i = 0; i < g.cols; i++) ctx.lineTo(xAt(i), ys[i]);
      ctx.lineTo(xAt(g.cols - 1), y0 + spacing);
      ctx.closePath();
      ctx.fillStyle = p.palette.bg;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(xAt(0), ys[0]);
      for (let i = 1; i < g.cols; i++) ctx.lineTo(xAt(i), ys[i]);
      const hot = j === scan || (f.beat > 0.6 && j === (scan + Math.floor(g.rows / 2)) % g.rows);
      ctx.strokeStyle = hot ? p.palette.accent : p.palette.ink;
      ctx.lineWidth = hot ? lw * 1.8 : lw;
      ctx.stroke();
    }
  }

  /* ───────── S3 glyph / ASCII ───────── */
  private ascii(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, sp: SheetParams, tone: (d: number) => number): void {
    const cols = Math.round(32 + p.detail * 80);
    const cellW = rect.w / cols;
    const cellH = cellW / 0.6;
    const rows = Math.max(2, Math.floor(rect.h / cellH));
    const g = this.grid(cols, rows);
    if (!g) return;
    const ch = rect.h / g.rows;
    const D = sp.distortion;
    const seed = Math.floor(p.time * 14);
    ctx.font = `600 ${ch * 0.92}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.palette.ink;
    const flashes: number[] = [];
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) {
        const i = y * g.cols + x;
        const dark = sp.invert ? g.lum[i] : 1 - g.lum[i];
        const t = tone(dark);
        if (t < 0.07) continue;
        const hsh = hash01(i, seed);
        if (f.hat * D > hash01(i, seed, 3) * 1.5 && t > 0.05) {
          flashes.push(i);
          continue;
        }
        const shift = D * f.treble * 2.2 * (hsh - 0.35);
        const idx = Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * RAMP.length + shift)));
        ctx.fillText(RAMP[idx], rect.x + (x + 0.5) * cellW, rect.y + (y + 0.5) * ch);
      }
    }
    ctx.fillStyle = p.palette.accent;
    for (const i of flashes) {
      const x = i % g.cols;
      const y = (i - x) / g.cols;
      ctx.fillText(FLASH[Math.floor(hash01(i, seed, 9) * FLASH.length)], rect.x + (x + 0.5) * cellW, rect.y + (y + 0.5) * ch);
    }
  }

  /* ───────── S4 blueprint contour ───────── */
  private contour(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, sp: SheetParams): void {
    const u = p.unit;
    const { ink, accent } = p.palette;
    const cols = Math.round(60 + p.detail * 120);
    const cell = rect.w / cols;
    const rows = Math.max(3, Math.round(rect.h / cell));
    const g = this.grid(cols, rows);
    if (!g) return;
    const lw0 = Math.max(1, p.stroke * u);

    // blueprint frame: outer border, graph paper, registration marks, title block
    const o: Rect = { x: rect.x - 26 * u, y: rect.y - 34 * u, w: rect.w + 52 * u, h: rect.h + 68 * u };
    ctx.strokeStyle = rgba(ink, 0.07);
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    const gs = rect.w / 16;
    for (let x = rect.x; x <= rect.x + rect.w + 0.5; x += gs) {
      ctx.moveTo(x, rect.y);
      ctx.lineTo(x, rect.y + rect.h);
    }
    for (let y = rect.y; y <= rect.y + rect.h + 0.5; y += gs) {
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
    }
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw0;
    ctx.strokeRect(o.x, o.y, o.w, o.h);
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeStyle = rgba(ink, 0.5);
    ctx.strokeRect(o.x + 6 * u, o.y + 6 * u, o.w - 12 * u, o.h - 12 * u);
    ctx.beginPath();
    for (const [x, y] of [[o.x, o.y], [o.x + o.w, o.y], [o.x, o.y + o.h], [o.x + o.w, o.y + o.h]]) regMark(ctx, x, y, 7 * u);
    ctx.strokeStyle = ink;
    ctx.stroke();

    // iso-levels around the threshold
    const levels = [-0.2, -0.1, 0, 0.1, 0.2].map((d) => clamp(sp.threshold + d, 0.04, 0.96));
    const dark = new Float32Array(g.lum.length);
    for (let i = 0; i < dark.length; i++) dark[i] = sp.invert ? g.lum[i] : 1 - g.lum[i];
    const D = sp.distortion;
    const J = cell * D * (f.beat * 1.6 + f.treble * 0.35 + 0.04);
    const seed = Math.floor(p.time * 24);
    const lw = lw0 * (1 + f.beat * D * 2.2);
    if (this.contours.size > 60) this.contours.clear();
    let blurred: Float32Array | null = null;
    levels.forEach((lv, li) => {
      const key = `${g.cols}x${g.rows}|${sp.invert ? 1 : 0}|${lv.toFixed(2)}`;
      let segs = this.contours.get(key);
      if (!segs) {
        if (!blurred) blurred = boxBlur(dark, g.cols, g.rows);
        segs = marchingSquares(blurred, g.cols, g.rows, lv);
        this.contours.set(key, segs);
      }
      const main = li === 2;
      ctx.beginPath();
      for (let s = 0; s < segs.length; s += 4) {
        for (let e = 0; e < 2; e++) {
          const nx = segs[s + e * 2];
          const ny = segs[s + e * 2 + 1];
          const qx = Math.round(nx * 4096);
          const qy = Math.round(ny * 4096);
          const jx = (hash01(qx, qy, seed) - 0.5) * 2 * J;
          const jy = (hash01(qy, qx, seed + 7) - 0.5) * 2 * J;
          const X = rect.x + nx * rect.w + jx;
          const Y = rect.y + ny * rect.h + jy;
          if (e === 0) ctx.moveTo(X, Y);
          else ctx.lineTo(X, Y);
        }
      }
      ctx.strokeStyle = main ? accent : rgba(ink, 1 - Math.abs(li - 2) * 0.25);
      ctx.lineWidth = main ? lw * 1.6 : lw;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    });

    // title block
    const tw = Math.min(260 * u, o.w * 0.45);
    const thh = 22 * u;
    const tx = o.x + o.w - tw - 6 * u;
    const ty = o.y + o.h - thh - 6 * u;
    ctx.fillStyle = p.palette.bg;
    ctx.fillRect(tx, ty, tw, thh);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, u);
    ctx.strokeRect(tx, ty, tw, thh);
    ctx.beginPath();
    ctx.moveTo(tx + tw * 0.5, ty);
    ctx.lineTo(tx + tw * 0.5, ty + thh);
    ctx.stroke();
    text(ctx, 'DWG SHEET_01', tx + 6 * u, ty + thh / 2, 10 * u, ink, 'left', 'middle', 700);
    text(ctx, `LVL ${sp.threshold.toFixed(2)} · REV A`, tx + tw * 0.5 + 6 * u, ty + thh / 2, 10 * u, accent, 'left', 'middle');
  }

  /* ───────── S5 progressive audio brush ───────── */
  private brush(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, sp: SheetParams, tone: (d: number) => number): void {
    const u = p.unit;
    const cols = Math.round(40 + p.detail * 80);
    const cell = rect.w / cols;
    const rows = Math.max(2, Math.round(rect.h / cell));
    const g = this.grid(cols, rows);
    if (!g) return;
    const N = g.cols * g.rows;

    // (re)build reveal order: a left→right sweep with jitter
    const key = `${g.cols}x${g.rows}|${sp.invert ? 1 : 0}`;
    if (key !== this.bKey || sp.redraw !== this.bRedraw) {
      this.bKey = key;
      this.bRedraw = sp.redraw;
      const keys = new Float32Array(N);
      const idx: number[] = [];
      for (let i = 0; i < N; i++) {
        const x = i % g.cols;
        const y = (i - x) / g.cols;
        keys[i] = x / g.cols + hash01(i, 7) * 0.28 + (y / g.rows) * 0.05;
        idx.push(i);
      }
      idx.sort((a, b) => keys[a] - keys[b]);
      this.bOrder = Int32Array.from(idx);
      this.bCursor = 0;
      this.bBudget = 0;
      this.bStrokes = [];
      this.bPaintKey = '';
    }

    // paint buffer sized to the sheet rect; replay strokes when size/colours change
    const pw = Math.max(1, Math.round(rect.w));
    const ph = Math.max(1, Math.round(rect.h));
    const lwBase = Math.max(1, p.stroke * u * 1.2);
    const pkey = `${pw}x${ph}|${p.palette.ink}|${p.palette.accent}|${lwBase.toFixed(2)}`;
    if (!this.bPaint) this.bPaint = document.createElement('canvas');
    const pc = this.bPaint.getContext('2d');
    if (!pc) return;
    if (pkey !== this.bPaintKey) {
      this.bPaintKey = pkey;
      this.bPaint.width = pw;
      this.bPaint.height = ph;
      pc.clearRect(0, 0, pw, ph);
      for (let s = 0; s < this.bStrokes.length; s += 6) this.paintStroke(pc, pw, ph, s, p, lwBase);
    }

    // audio-driven budget: energy + tempo pulses
    const D = sp.distortion;
    const rate = (N / 40) * (0.15 + f.rms * 1.6 + f.beat * 1.2) * (0.5 + D);
    this.bBudget = Math.min(this.bBudget + rate * p.dt, 600);
    let painted = 0;
    while (this.bBudget >= 1 && this.bCursor < this.bOrder.length && painted < 400) {
      const i = this.bOrder[this.bCursor++];
      const dark = sp.invert ? g.lum[i] : 1 - g.lum[i];
      const t = tone(dark);
      if (t < 0.06) continue;
      this.bBudget -= 1;
      painted++;
      const x = i % g.cols;
      const y = (i - x) / g.cols;
      const h1 = hash01(i, this.bRedraw, 1);
      const h2 = hash01(i, this.bRedraw, 2);
      const ang = g.edge[i] > 0.15 ? g.angle[i] + Math.PI / 2 : -0.6 + (h1 - 0.5) * 0.8;
      const sx = (x + 0.5 + (h1 - 0.5) * 0.8) / g.cols;
      const sy = (y + 0.5 + (h2 - 0.5) * 0.8) / g.rows;
      const len = ((1.4 + t * 2.2) / g.cols) * (1 + f.beat * D * 0.8);
      const wf = 0.5 + t * 2.5;
      const acc = f.beat > 0.55 && h2 < 0.35 ? 1 : 0;
      const s0 = this.bStrokes.length;
      this.bStrokes.push(sx, sy, ang, len, wf, acc);
      this.paintStroke(pc, pw, ph, s0, p, lwBase);
      this.bLastX = sx;
      this.bLastY = sy;
    }
    if (this.bCursor >= this.bOrder.length) this.bBudget = 0;

    ctx.drawImage(this.bPaint, rect.x, rect.y, rect.w, rect.h);

    // brush head + progress
    const { ink, accent } = p.palette;
    const done = this.bCursor >= this.bOrder.length;
    const prog = this.bOrder.length ? this.bCursor / this.bOrder.length : 0;
    if (!done) {
      const hx = rect.x + this.bLastX * rect.w;
      const hy = rect.y + this.bLastY * rect.h;
      const r = (8 + f.beat * 10) * u;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, 1.5 * u);
      ctx.beginPath();
      regMark(ctx, hx, hy, r);
      ctx.stroke();
    }
    const by = rect.y + rect.h + 22 * u;
    ctx.fillStyle = rgba(ink, 0.15);
    ctx.fillRect(rect.x, by, rect.w, 3 * u);
    ctx.fillStyle = accent;
    ctx.fillRect(rect.x, by, rect.w * prog, 3 * u);
    text(
      ctx,
      done ? 'PAINT 100% — COMPLETE · PRESS REDRAW' : `PAINT ${(prog * 100).toFixed(0).padStart(3, '0')}% · STROKES ${this.bStrokes.length / 6}`,
      rect.x,
      by + 18 * u,
      11 * u,
      ink,
    );
  }

  private paintStroke(pc: CanvasRenderingContext2D, pw: number, ph: number, s: number, p: RenderParams, lwBase: number): void {
    const st = this.bStrokes;
    const x = st[s] * pw;
    const y = st[s + 1] * ph;
    const a = st[s + 2];
    const len = st[s + 3] * pw;
    const wf = st[s + 4];
    const acc = st[s + 5];
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    pc.strokeStyle = acc ? p.palette.accent : p.palette.ink;
    pc.lineCap = 'round';
    pc.globalAlpha = 0.92;
    pc.lineWidth = lwBase * wf;
    pc.beginPath();
    pc.moveTo(x - dx, y - dy);
    pc.lineTo(x + dx, y + dy);
    pc.stroke();
    // bristle texture
    const off = lwBase * wf * 0.7;
    pc.globalAlpha = 0.45;
    pc.lineWidth = Math.max(0.5, lwBase * wf * 0.28);
    pc.beginPath();
    pc.moveTo(x - dx * 1.15 + nx * off, y - dy * 1.15 + ny * off);
    pc.lineTo(x + dx * 0.9 + nx * off, y + dy * 0.9 + ny * off);
    pc.moveTo(x - dx * 0.85 - nx * off, y - dy * 0.85 - ny * off);
    pc.lineTo(x + dx * 1.1 - nx * off, y + dy * 1.1 - ny * off);
    pc.stroke();
    pc.globalAlpha = 1;
  }
}

/* ───────────────────────── Sheet controls (right panel) ───────────────────────── */

export function SheetControls({
  params,
  onChange,
  images,
  imageId,
  onSelectImage,
  onUpload,
}: {
  params: SheetParams;
  onChange: (p: SheetParams) => void;
  images: SheetImage[];
  imageId: string;
  onSelectImage: (id: string) => void;
  onUpload: (f: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof SheetParams>(k: K, v: SheetParams[K]) => onChange({ ...params, [k]: v });
  return (
    <div className="space-y-3">
      <div className="text-[10px] tracking-[0.18em] opacity-60">SOURCE_IMAGE</div>
      <div className="grid grid-cols-3 gap-2">
        {images.map((img) => (
          <button
            type="button"
            key={img.id}
            title={img.name}
            onClick={() => onSelectImage(img.id)}
            className={`group relative aspect-square border ${img.id === imageId ? 'border-accent outline outline-1 outline-accent' : 'border-ink/40 hover:border-ink'}`}
          >
            <img src={img.thumb} alt={img.name} className="h-full w-full object-cover grayscale" draggable={false} />
            <span className="absolute inset-x-0 bottom-0 truncate bg-bg/85 px-1 text-left text-[8px] tracking-widest">{img.name}</span>
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = '';
        }}
      />
      <Btn className="w-full" onClick={() => fileRef.current?.click()}>
        ↑ UPLOAD IMAGE
      </Btn>

      <div className="text-[10px] tracking-[0.18em] opacity-60">SHEET_STYLE</div>
      <div className="border border-ink">
        {SHEET_STYLES.map((s, i) => (
          <button
            type="button"
            key={s.id}
            onClick={() => set('style', s.id)}
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] tracking-[0.14em] ${i ? 'border-t border-ink/30' : ''} ${
              params.style === s.id ? 'bg-ink text-bg' : 'hover:bg-ink/10'
            }`}
          >
            <span className={params.style === s.id ? 'text-accent' : 'opacity-50'}>{s.code}</span>
            <span className="flex-1">{s.label}</span>
            <span className="hidden text-[8px] opacity-60 xl:inline">{s.desc}</span>
          </button>
        ))}
      </div>
      <Btn className="w-full" variant="accent" onClick={() => set('redraw', params.redraw + 1)} title="Reset the progressive paint cycle">
        ↺ REDRAW
      </Btn>
      <Slider label="CONTRAST_THR" value={params.threshold} min={0.05} max={0.95} onChange={(v) => set('threshold', v)} />
      <Slider label="PULSE_AMT" value={params.distortion} min={0} max={1} onChange={(v) => set('distortion', v)} />
      <Toggle label="INVERT_IMAGE" value={params.invert} onChange={(v) => set('invert', v)} />
    </div>
  );
}
