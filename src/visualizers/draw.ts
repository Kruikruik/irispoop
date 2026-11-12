/* Shared drawing helpers for every canvas renderer. */

export const FONT = '"JetBrains Mono", "Space Mono", ui-monospace, monospace';
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbaCache = new Map<string, string>();
/** Colour with alpha, cached (renderers call this many times per frame). */
export function rgba(hex: string, a: number): string {
  const q = Math.round(clamp(a) * 100);
  const key = hex + q;
  let v = rgbaCache.get(key);
  if (!v) {
    const [r, g, b] = hexToRgb(hex);
    v = `rgba(${r},${g},${b},${q / 100})`;
    if (rgbaCache.size > 2000) rgbaCache.clear();
    rgbaCache.set(key, v);
  }
  return v;
}

export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  baseline: CanvasTextBaseline = 'alphabetic',
  weight = 500,
): void {
  ctx.font = `${weight} ${Math.max(6, size)}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

/** Largest rect of a given aspect ratio that fits inside (w,h) minus a margin, centred. */
export function fitRect(w: number, h: number, aspect: number, margin: number): Rect {
  const aw = Math.max(1, w - margin * 2);
  const ah = Math.max(1, h - margin * 2);
  let rw = aw;
  let rh = rw / aspect;
  if (rh > ah) {
    rh = ah;
    rw = rh * aspect;
  }
  return { x: (w - rw) / 2, y: (h - rh) / 2, w: rw, h: rh };
}

/** Deterministic 0..1 hash of up to three integers. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** L-shaped corner brackets around a rectangle. */
export function cornerMarks(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  len: number,
  color: string,
  lw: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  const { x, y, w, h } = r;
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
}

/** Registration crosshair: circle + cross. */
export function regMark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r * 1.7, y);
  ctx.lineTo(x + r * 1.7, y);
  ctx.moveTo(x, y - r * 1.7);
  ctx.lineTo(x, y + r * 1.7);
}

/** Groups FFT bins into log-spaced bands (with interpolation for narrow low bands). */
export class LogBands {
  private out = new Float32Array(0);

  compute(
    spec: Float32Array,
    binHz: number,
    count: number,
    fMin = 20,
    fMax = 16000,
    mode: 'max' | 'avg' = 'max',
  ): Float32Array {
    if (this.out.length !== count) this.out = new Float32Array(count);
    const n = spec.length;
    const ratio = fMax / fMin;
    for (let i = 0; i < count; i++) {
      const f0 = fMin * Math.pow(ratio, i / count);
      const f1 = fMin * Math.pow(ratio, (i + 1) / count);
      let b0 = Math.floor(f0 / binHz);
      let b1 = Math.floor(f1 / binHz);
      if (b0 >= n - 1) b0 = n - 2;
      if (b1 >= n) b1 = n - 1;
      if (b1 <= b0) {
        // narrower than one bin → interpolate at the band centre
        const pos = Math.sqrt(f0 * f1) / binHz;
        const p0 = Math.min(n - 2, Math.floor(pos));
        const t = pos - p0;
        this.out[i] = spec[p0] * (1 - t) + spec[p0 + 1] * t;
        continue;
      }
      let acc = 0;
      for (let b = b0; b <= b1; b++) {
        const v = spec[b];
        if (mode === 'max') {
          if (v > acc) acc = v;
        } else acc += v;
      }
      this.out[i] = mode === 'max' ? acc : acc / (b1 - b0 + 1);
    }
    return this.out;
  }
}

/** Expanding circular wave fronts (spawned on beats). Distances are normalised 0..~1.5. */
export class RippleField {
  private list: { r: number; s: number; v: number }[] = [];

  spawn(strength: number, speed: number): void {
    this.list.push({ r: 0, s: strength, v: speed });
    if (this.list.length > 10) this.list.shift();
  }

  update(dt: number): void {
    const k = Math.exp(-dt * 1.3);
    for (const x of this.list) {
      x.r += x.v * dt;
      x.s *= k;
    }
    this.list = this.list.filter((x) => x.s > 0.03 && x.r < 2);
  }

  at(d: number, width: number): number {
    let s = 0;
    for (const x of this.list) {
      const k = (d - x.r) / width;
      if (k > -4 && k < 4) s += x.s * Math.exp(-k * k);
    }
    return s;
  }

  get count(): number {
    return this.list.length;
  }
}

export const pad = (n: number, len = 3): string => String(Math.round(n)).padStart(len, '0');

const hueCache = new Map<string, string>();
/** Rotates the hue of a hex colour (used to derive a secondary accent, e.g. blue → teal). */
export function hueShift(hex: string, deg: number): string {
  const key = hex + deg;
  const hit = hueCache.get(key);
  if (hit) return hit;
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const out = '#' + [r1, g1, b1].map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255).toString(16).padStart(2, '0')).join('');
  hueCache.set(key, out);
  return out;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (m: number): string => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
