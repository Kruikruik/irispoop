/* Building blocks shared by the deck modules: cards, footers, colour mixing, noise. */
import type { AudioFeatures } from '../../audio/AudioEngine';
import type { RenderParams } from '../types';
import { FONT, clamp, hash01, hexToRgb, rgba, type Rect } from '../draw';
import type { DeckState } from './DeckState';

export interface ModuleCtx {
  ctx: CanvasRenderingContext2D;
  r: Rect;
  f: AudioFeatures;
  p: RenderParams;
  S: DeckState;
  num: string;
}

export interface Module {
  draw(m: ModuleCtx): void;
}

export const mixHex = (a: string, b: string, t: number): string => {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t)).toString(16).padStart(2, '0')).join('');
};

export const isDark = (hex: string): boolean => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
};

/** Monospace label with letter spacing. */
export function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  weight = 500,
  spacing = 0.12,
  baseline: CanvasTextBaseline = 'alphabetic',
): void {
  ctx.font = `${weight} ${Math.max(6, size)}px ${FONT}`;
  ctx.letterSpacing = `${size * spacing}px`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(s, x, y);
  ctx.letterSpacing = '0px';
}

/** Sans-serif text (captions, floating words). */
export function sans(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 500): void {
  ctx.font = `${weight} ${Math.max(6, size)}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

/** Card background + "01 TITLE" header. Returns the inner content rect. */
export function card(m: ModuleCtx, title: string, opts: { fill?: boolean; pad?: number } = {}): Rect {
  const { ctx, r, p } = m;
  const u = p.unit;
  const { bg, ink, accent } = p.palette;
  if (opts.fill !== false) {
    ctx.fillStyle = mixHex(bg, ink, isDark(bg) ? 0.05 : 0.035);
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 9 * u);
    ctx.fill();
  }
  const pad = opts.pad ?? 18 * u;
  const fs = 12.5 * u;
  label(ctx, m.num, r.x + pad, r.y + pad + fs * 0.6, fs, accent, 'left', 700, 0.12);
  ctx.font = `700 ${fs}px ${FONT}`;
  ctx.letterSpacing = `${fs * 0.12}px`;
  const nw = ctx.measureText(m.num + '  ').width;
  ctx.letterSpacing = '0px';
  label(ctx, title, r.x + pad + nw, r.y + pad + fs * 0.6, fs, ink, 'left', 700, 0.22);
  return { x: r.x + pad, y: r.y + pad + fs * 1.9, w: r.w - pad * 2, h: r.h - pad * 2 - fs * 1.9 };
}

/** Telemetry footer (small caps labels + values) at the bottom of a content rect. Returns the rect above it. */
export function footer(m: ModuleCtx, inner: Rect, items: [string, string][]): Rect {
  const { ctx, p } = m;
  const u = p.unit;
  const { ink } = p.palette;
  const ls = 9.5 * u;
  const vs = 14 * u;
  const h = ls + vs + 12 * u;
  const y0 = inner.y + inner.h - h;
  let x = inner.x;
  const colW = Math.min(inner.w / Math.max(1, items.length), 150 * u);
  for (const [k, v] of items) {
    label(ctx, k, x, y0 + ls + 4 * u, ls, rgba(ink, 0.5), 'left', 500, 0.14);
    label(ctx, v, x, y0 + ls + vs + 8 * u, vs, ink, 'left', 500, 0.02);
    x += colW;
  }
  return { x: inner.x, y: inner.y, w: inner.w, h: inner.h - h - 6 * u };
}

/** Smooth 1-D value noise in 0..1. */
export function vnoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Smooth 2-D value noise in 0..1. */
export function vnoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash01(xi, yi, seed);
  const b = hash01(xi + 1, yi, seed);
  const c = hash01(xi, yi + 1, seed);
  const d = hash01(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export const fmtClock = (s: number): string => {
  if (!Number.isFinite(s)) return 'LIVE';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** Pastel lane colour derived from the accent (used by the arcade / ribbons). */
export const LANE_HUES = [0, 300, 40, 160, 200, 260, 90, 330, 20, 180, 230, 120];

/** Draws an image cover-fitted into a rect. */
export function drawCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, r: Rect): { sx: number; sy: number; sw: number; sh: number } {
  const ia = img.width / img.height;
  const ra = r.w / r.h;
  let sw = img.width;
  let sh = img.height;
  if (ia > ra) sw = sh * ra;
  else sh = sw / ra;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
  return { sx, sy, sw, sh };
}

export function noImage(m: ModuleCtx, r: Rect): void {
  const { ctx, p } = m;
  const u = p.unit;
  ctx.strokeStyle = rgba(p.palette.ink, 0.3);
  ctx.setLineDash([4 * u, 4 * u]);
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.setLineDash([]);
  label(ctx, 'NO IMAGE', r.x + r.w / 2, r.y + r.h / 2 - 6 * u, 12 * u, rgba(p.palette.ink, 0.6), 'center', 700);
  label(ctx, 'UPLOAD ONE IN SHEET PAINT', r.x + r.w / 2, r.y + r.h / 2 + 12 * u, 9 * u, rgba(p.palette.ink, 0.45), 'center');
}
