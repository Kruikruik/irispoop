/*
 * Progressive image painter: starts from a blank sheet and paints the image stroke by stroke,
 * paced by the music (energy + beats). Four pens:
 *   watercolor — translucent pigment blooms that feather and bleed on sub/kick
 *   impasto    — thick directional dabs, broad washes first, then crisp focal detail
 *   silk       — flowing multicoloured strands along brightness contours, rippling with mids/highs
 *   charcoal   — grainy monochrome stipple clouds that condense into the shadows on beats
 */
import type { AudioFeatures } from '../../audio/AudioEngine';
import type { RenderParams } from '../types';
import { clamp, hash01, hueShift, type Rect } from '../draw';
import { gridFor, type ImageGrid } from '../imageGrid';
import { vnoise2 } from '../decks/kit';

export type PaintStyle = 'watercolor' | 'impasto' | 'silk' | 'charcoal';

export const PEN_NAMES: Record<PaintStyle, string> = {
  watercolor: 'Watercolor',
  impasto: 'Impasto',
  silk: 'Silk',
  charcoal: 'Charcoal',
};

interface Pass {
  cols: number;
  cells: Int32Array;
  size: number;
}

const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0')).join('');

let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d');
  if (g) {
    const im = g.createImageData(192, 192);
    for (let i = 0; i < 192 * 192; i++) {
      const v = Math.random() * 255;
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
      im.data[i * 4 + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }
  grainTile = c;
  return c;
}

export class ProgressivePainter {
  style: PaintStyle;
  strokes = 0;
  elapsed = 0;
  private img: HTMLCanvasElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private passes: Pass[] = [];
  private passIdx = 0;
  private cursor = 0;
  private total = 1;
  private budget = 0;
  private redraw = -1;
  private planKey = '';
  private lastX = 0.5;
  private lastY = 0.5;

  constructor(style: PaintStyle) {
    this.style = style;
  }

  setImage(img: HTMLCanvasElement | null): void {
    if (img === this.img) return;
    this.img = img;
    this.reset();
  }

  setStyle(s: PaintStyle): void {
    if (s === this.style) return;
    this.style = s;
    this.reset();
  }

  reset(): void {
    this.planKey = '';
    this.strokes = 0;
    this.elapsed = 0;
    this.budget = 0;
    if (this.canvas) this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  get progress(): number {
    if (!this.planKey) return 0;
    if (this.style === 'silk' || this.style === 'charcoal') return clamp(this.strokes / this.total);
    let done = 0;
    for (let i = 0; i < this.passIdx; i++) done += this.passes[i].cells.length;
    return clamp((done + this.cursor) / this.total);
  }

  get headX(): number {
    return this.lastX;
  }
  get headY(): number {
    return this.lastY;
  }

  /* ── planning ── */
  private plan(img: HTMLCanvasElement): void {
    const passes: Pass[] = [];
    const add = (cols: number, size: number, keep: (g: ImageGrid, i: number) => boolean, seed: number) => {
      const g = gridFor(img, cols);
      if (!g) return;
      const idx: number[] = [];
      for (let i = 0; i < g.cols * g.rows; i++) if (keep(g, i)) idx.push(i);
      // shuffled order, biased so each pass sweeps loosely top → bottom
      const keyOf = (i: number) => Math.floor(i / g.cols) / g.rows + hash01(i, seed) * 0.9;
      idx.sort((a, b) => keyOf(a) - keyOf(b));
      passes.push({ cols, cells: Int32Array.from(idx), size });
    };
    if (this.style === 'impasto') {
      add(14, 1.9, () => true, 1);
      add(30, 1.5, () => true, 2);
      add(60, 1.3, (g, i) => g.edge[i] > 0.06 || hash01(i, 3) < 0.55, 3);
      add(110, 1.25, (g, i) => g.edge[i] > 0.14, 4);
      add(180, 1.2, (g, i) => g.edge[i] > 0.26, 5);
    } else if (this.style === 'watercolor') {
      add(9, 1.5, () => true, 1);
      add(20, 1.3, () => true, 2);
      add(40, 1.1, (g, i) => g.edge[i] > 0.05 || hash01(i, 3) < 0.6, 3);
      add(80, 1.0, (g, i) => g.edge[i] > 0.16, 4);
    }
    this.passes = passes;
    this.passIdx = 0;
    this.cursor = 0;
    this.total = this.style === 'silk' ? 4200 : this.style === 'charcoal' ? 7000 : Math.max(1, passes.reduce((s, q) => s + q.cells.length, 0));
  }

  /** Paints a few more strokes (paced by audio) and draws the sheet into `rect`. */
  draw(ctx: CanvasRenderingContext2D, rect: Rect, f: AudioFeatures, p: RenderParams, opts: { distortion: number; redraw: number; invert: boolean }): void {
    const img = this.img;
    if (!img) return;
    const pw = Math.max(1, Math.round(rect.w));
    const ph = Math.max(1, Math.round(rect.h));
    if (!this.canvas) this.canvas = document.createElement('canvas');
    const c = this.canvas;
    if (c.width !== pw || c.height !== ph) {
      // keep what is already painted, rescaled
      const old = document.createElement('canvas');
      old.width = c.width;
      old.height = c.height;
      old.getContext('2d')?.drawImage(c, 0, 0);
      c.width = pw;
      c.height = ph;
      if (old.width > 1) c.getContext('2d')?.drawImage(old, 0, 0, pw, ph);
    }
    const key = `${this.style}|${opts.invert ? 1 : 0}`;
    if (key !== this.planKey || opts.redraw !== this.redraw) {
      this.redraw = opts.redraw;
      this.planKey = key;
      this.plan(img);
      this.strokes = 0;
      this.elapsed = 0;
      c.getContext('2d')?.clearRect(0, 0, pw, ph);
    }
    const g = c.getContext('2d');
    if (!g) return;

    const done = this.progress >= 1;
    if (!done && f.active) this.elapsed += p.dt;
    // pace: ~90 s of average music for a full painting, faster on loud/beat-heavy passages
    const energy = 0.25 + f.rms * 2.2 + f.beat * 1.4 + f.subBass * 0.4;
    const rate = (this.total / 90) * energy * (0.5 + opts.distortion) * (f.active ? 1 : 0.15);
    this.budget = Math.min(this.budget + rate * p.dt, this.total * 0.05 + 50);
    let n = 0;
    const lw = Math.max(1, p.stroke * p.unit);
    // layered pigment darkens like real watercolor on light paper
    g.globalCompositeOperation = 'source-over';
    while (this.budget >= 1 && n < 900 && this.progress < 1) {
      this.budget -= 1;
      n++;
      if (this.style === 'silk') this.silk(g, pw, ph, img, f, p, lw, opts.invert);
      else if (this.style === 'charcoal') this.charcoal(g, pw, ph, img, f, p, opts.invert);
      else this.passStroke(g, pw, ph, f, opts.invert);
      this.strokes++;
    }
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(c, rect.x, rect.y, rect.w, rect.h);
    if (this.style === 'watercolor' || this.style === 'charcoal') {
      // paper grain
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.globalCompositeOperation = 'overlay';
      const pat = ctx.createPattern(grain(), 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }
      ctx.restore();
    }
  }

  /* ── impasto & watercolor: one stroke per planned cell ── */
  private passStroke(g: CanvasRenderingContext2D, pw: number, ph: number, f: AudioFeatures, invert: boolean): void {
    let pass = this.passes[this.passIdx];
    while (pass && this.cursor >= pass.cells.length) {
      this.passIdx++;
      this.cursor = 0;
      pass = this.passes[this.passIdx];
    }
    if (!pass || !this.img) return;
    const grid = gridFor(this.img, pass.cols);
    if (!grid) return;
    const i = pass.cells[this.cursor++];
    const x = i % grid.cols;
    const y = (i - x) / grid.cols;
    const cw = pw / grid.cols;
    const ch = ph / grid.rows;
    const h1 = hash01(i, this.passIdx * 7 + 1);
    const h2 = hash01(i, this.passIdx * 7 + 2);
    const cx = (x + 0.5 + (h1 - 0.5) * 0.7) * cw;
    const cy = (y + 0.5 + (h2 - 0.5) * 0.7) * ch;
    let r = grid.r[i];
    let gg = grid.g[i];
    let b = grid.b[i];
    if (invert) {
      r = 1 - r;
      gg = 1 - gg;
      b = 1 - b;
    }
    const jit = (h1 - 0.5) * 0.06;
    this.lastX = cx / pw;
    this.lastY = cy / ph;

    if (this.style === 'impasto') {
      const ang = grid.edge[i] > 0.06 ? grid.angle[i] + Math.PI / 2 : -0.5 + (h2 - 0.5) * 1.2;
      const len = cw * pass.size * (1 + f.beat * 0.35);
      const wid = cw * (this.passIdx < 2 ? 1.05 : 0.7) * (1 + f.bass * 0.25);
      const dx = (Math.cos(ang) * len) / 2;
      const dy = (Math.sin(ang) * len) / 2;
      g.lineCap = 'round';
      g.globalAlpha = 0.92;
      g.strokeStyle = toHex(r + jit, gg + jit, b + jit);
      g.lineWidth = wid;
      g.beginPath();
      g.moveTo(cx - dx, cy - dy);
      g.lineTo(cx + dx, cy + dy);
      g.stroke();
      // paint ridge: lighter / darker thin streaks give the impasto texture
      const nx = -Math.sin(ang) * wid * 0.22;
      const ny = Math.cos(ang) * wid * 0.22;
      g.globalAlpha = 0.35;
      g.lineWidth = wid * 0.28;
      g.strokeStyle = toHex(r + 0.12, gg + 0.12, b + 0.12);
      g.beginPath();
      g.moveTo(cx - dx * 0.8 + nx, cy - dy * 0.8 + ny);
      g.lineTo(cx + dx * 0.7 + nx, cy + dy * 0.7 + ny);
      g.stroke();
      g.strokeStyle = toHex(r - 0.12, gg - 0.12, b - 0.12);
      g.beginPath();
      g.moveTo(cx - dx * 0.7 - nx, cy - dy * 0.7 - ny);
      g.lineTo(cx + dx * 0.8 - nx, cy + dy * 0.8 - ny);
      g.stroke();
      g.globalAlpha = 1;
    } else {
      // watercolor bloom with an organic, slightly darker pooled edge
      const bleed = f.beat > 0.6 || f.subBass > 0.6 ? 1.45 : 1;
      const rad = cw * pass.size * 0.75 * bleed * (0.85 + h1 * 0.4);
      const col = toHex(r + jit, gg + jit, b + jit);
      const satellites = bleed > 1 ? 2 : 0;
      for (let k = 0; k <= satellites; k++) {
        const ox = k ? (hash01(i, k, 9) - 0.5) * rad * 1.6 : 0;
        const oy = k ? (hash01(i, k, 10) - 0.5) * rad * 1.6 : 0;
        const rr = k ? rad * 0.55 : rad;
        this.bloom(g, cx + ox, cy + oy, rr, col, k ? 0.07 : 0.16, i + k * 999);
      }
    }
  }

  private bloom(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, a: number, seed: number): void {
    g.save();
    g.beginPath();
    const V = 14;
    for (let k = 0; k <= V; k++) {
      const ang = (k / V) * Math.PI * 2;
      const rr = r * (0.82 + hash01(seed, k % V, 4) * 0.3);
      const px = x + Math.cos(ang) * rr;
      const py = y + Math.sin(ang) * rr;
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    const grad = g.createRadialGradient(x, y, r * 0.1, x, y, r);
    const hex = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
    grad.addColorStop(0, col + hex(a * 0.9));
    grad.addColorStop(0.75, col + hex(a));
    grad.addColorStop(0.95, col + hex(a * 1.7));
    grad.addColorStop(1, col + hex(a * 0.4));
    g.fillStyle = grad;
    g.fill();
    g.restore();
  }

  /* ── silk: strands following the brightness contours ── */
  private silk(g: CanvasRenderingContext2D, pw: number, ph: number, img: HTMLCanvasElement, f: AudioFeatures, p: RenderParams, lw: number, invert: boolean): void {
    const grid = gridFor(img, 90);
    if (!grid) return;
    const s = this.strokes;
    let x = hash01(s, 11) * pw;
    let y = hash01(s, 12) * ph;
    const at = (px: number, py: number) => {
      const gx = Math.min(grid.cols - 1, Math.max(0, Math.floor((px / pw) * grid.cols)));
      const gy = Math.min(grid.rows - 1, Math.max(0, Math.floor((py / ph) * grid.rows)));
      return gy * grid.cols + gx;
    };
    const i0 = at(x, y);
    let r = grid.r[i0];
    let gg = grid.g[i0];
    let b = grid.b[i0];
    if (invert) {
      r = 1 - r;
      gg = 1 - gg;
      b = 1 - b;
    }
    const base = toHex(r, gg, b);
    const tint = hueShift(base, ((s * 47) % 360) - 180);
    const col = hash01(s, 13) < 0.65 ? base : tint;
    const steps = 50 + Math.floor(hash01(s, 14) * 90);
    const stepLen = Math.max(1.5, 2.6 * p.unit);
    const ripple = (f.mid + f.treble) * 0.6;
    g.beginPath();
    g.moveTo(x, y);
    let dirSign = hash01(s, 15) < 0.5 ? 1 : -1;
    for (let k = 0; k < steps; k++) {
      const i = at(x, y);
      const noiseAng = (vnoise2(x / (pw * 0.18), y / (pw * 0.18), 16) - 0.5) * Math.PI * 2.2;
      let ang = grid.edge[i] > 0.05 ? grid.angle[i] + Math.PI / 2 : noiseAng;
      ang += Math.sin(k * 0.35 + p.time * 4 + s) * ripple * 0.5;
      x += Math.cos(ang) * stepLen * dirSign;
      y += Math.sin(ang) * stepLen * dirSign;
      if (x < 0 || y < 0 || x > pw || y > ph) break;
      if (k === 10 && hash01(s, 17) < 0.1) dirSign = -dirSign;
      g.lineTo(x, y);
    }
    g.strokeStyle = col;
    g.globalAlpha = 0.62;
    g.lineWidth = lw * (1.6 + hash01(s, 18) * 3.2) * (1 + f.beat * 0.5);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
    g.globalAlpha = 1;
    this.lastX = x / pw;
    this.lastY = y / ph;
  }

  private md = new WeakMap<ImageGrid, number>();
  private meanDark(grid: ImageGrid, invert: boolean): number {
    let m = this.md.get(grid);
    if (m === undefined) {
      m = 0;
      for (let i = 0; i < grid.lum.length; i++) m += grid.lum[i];
      m /= grid.lum.length;
      this.md.set(grid, m);
    }
    return invert ? m : 1 - m;
  }

  /* ── charcoal: stipple clouds that condense into the shadows ── */
  private charcoal(g: CanvasRenderingContext2D, pw: number, ph: number, img: HTMLCanvasElement, f: AudioFeatures, p: RenderParams, invert: boolean): void {
    const grid = gridFor(img, 80);
    if (!grid) return;
    const s = this.strokes;
    // rejection-sample a dark cell
    let idx = -1;
    let dark = 0;
    for (let k = 0; k < 12 && idx < 0; k++) {
      const i = Math.floor(hash01(s, k, 21) * grid.cols * grid.rows);
      const raw = invert ? grid.lum[i] : 1 - grid.lum[i];
      const d = clamp((raw - this.meanDark(grid, invert)) * 2.6 + 0.35);
      if (hash01(s, k, 22) < d * d * d) {
        idx = i;
        dark = d;
      }
    }
    if (idx < 0) return; // only shadows receive charcoal
    const x = idx % grid.cols;
    const y = (idx - x) / grid.cols;
    const cw = pw / grid.cols;
    const prog = this.strokes / this.total;
    const spread = cw * (3 * (1 - prog) * (1 - prog) + 0.45) * (f.beat > 0.5 ? 0.5 : 1);
    const cx = (x + 0.5) * cw;
    const cy = (y + 0.5) * (ph / grid.rows);
    g.fillStyle = p.palette.ink;
    const dot = Math.max(1, 1.4 * p.unit);
    for (let k = 0; k < 22; k++) {
      // gaussian-ish scatter (sum of uniforms)
      const gx = (hash01(s, k, 23) + hash01(s, k, 24) + hash01(s, k, 25) - 1.5) * spread;
      const gy = (hash01(s, k, 26) + hash01(s, k, 27) + hash01(s, k, 28) - 1.5) * spread;
      g.globalAlpha = (0.12 + hash01(s, k, 29) * 0.22) * (0.5 + dark * 0.7);
      g.fillRect(cx + gx, cy + gy, dot, dot);
    }
    if (s % 23 === 0) {
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, spread * 1.6);
      grad.addColorStop(0, p.palette.ink + '12');
      grad.addColorStop(1, p.palette.ink + '00');
      g.globalAlpha = 1;
      g.fillStyle = grad;
      g.fillRect(cx - spread * 1.6, cy - spread * 1.6, spread * 3.2, spread * 3.2);
    }
    g.globalAlpha = 1;
    this.lastX = cx / pw;
    this.lastY = cy / ph;
  }
}
