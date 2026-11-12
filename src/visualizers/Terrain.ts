import type { VisualizerInstance } from './types';
import { LogBands, clamp, rgba, text } from './draw';

const INTERVAL = 1 / 24;

/** A5 — perspective wireframe landscape of spectrum history with hidden-line scanlines. */
export function createTerrain(): VisualizerInstance {
  const bands = new LogBands();
  let rows: Float32Array[] = [];
  let cols = 0;
  let rowsN = 0;
  let acc = 0;
  let xs = new Float32Array(0);
  let ys = new Float32Array(0);

  return {
    draw(ctx, w, h, f, p) {
      const u = p.unit;
      const { ink, accent, bg } = p.palette;
      const lw = Math.max(1, p.stroke * u * 1.1);
      const fs = 13 * u;
      const m = 54 * u;

      const C = 2 * Math.round(20 + p.detail * 28); // 40..96, even
      const R = Math.round(24 + p.detail * 36);
      if (C !== cols || R !== rowsN) {
        cols = C;
        rowsN = R;
        rows = Array.from({ length: R }, () => new Float32Array(C));
        xs = new Float32Array(C);
        ys = new Float32Array(C);
      }

      const half = C / 2;
      const spec = bands.compute(f.spectrum, f.binHz, half, 30, 14000, 'max');
      acc += p.dt;
      let pushes = 0;
      while (acc >= INTERVAL && pushes < 4) {
        acc -= INTERVAL;
        pushes++;
        const row = rows.pop() as Float32Array;
        const mid = (C - 1) / 2;
        for (let c = 0; c < C; c++) {
          const k = Math.abs(c - mid) / mid; // 0 centre (lows) → 1 edges (highs)
          const idx = Math.min(half - 1, Math.floor(k * half));
          const nb = Math.min(half - 1, idx + 1);
          const v = (spec[idx] * 2 + spec[nb]) / 3;
          row[c] = clamp(v * (1 - k * k * 0.35) + f.beat * 0.12 * (1 - k));
        }
        rows.unshift(row);
      }
      if (acc > INTERVAL) acc = 0;
      const frac = acc / INTERVAL;

      const horizon = h * 0.33;
      const groundSpan = h * 0.64;
      const vx = w / 2;

      // horizon + perspective rails (behind everything)
      ctx.strokeStyle = rgba(ink, 0.35);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      ctx.moveTo(0, horizon + groundSpan / (1 + R * 0.16));
      ctx.lineTo(w, horizon + groundSpan / (1 + R * 0.16));
      for (let i = -6; i <= 6; i++) {
        const xb = vx + (i / 6) * w * 0.8;
        ctx.moveTo(vx + (i / 6) * w * 0.08, horizon + groundSpan / (1 + R * 0.16));
        ctx.lineTo(xb, h);
      }
      ctx.stroke();

      // rows back → front, each fills bg below itself (hidden-line removal) then strokes
      for (let z = R - 1; z >= 0; z--) {
        const depth = z + frac;
        const scale = 1 / (1 + depth * 0.16);
        const gy = horizon + groundSpan * scale;
        const amp = h * 0.34 * scale;
        const spanX = w * 0.78 * scale;
        const row = rows[z];
        for (let c = 0; c < C; c++) {
          xs[c] = vx + ((c / (C - 1)) * 2 - 1) * spanX;
          ys[c] = gy - row[c] * amp;
        }
        ctx.beginPath();
        ctx.moveTo(xs[0], h + 2);
        for (let c = 0; c < C; c++) ctx.lineTo(xs[c], ys[c]);
        ctx.lineTo(xs[C - 1], h + 2);
        ctx.closePath();
        ctx.fillStyle = bg;
        ctx.fill();

        const alpha = Math.pow(clamp(1 - depth / R), 0.7);
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let c = 1; c < C; c++) ctx.lineTo(xs[c], ys[c]);
        ctx.strokeStyle = z === 0 ? accent : rgba(ink, alpha);
        ctx.lineWidth = z === 0 ? lw * 1.6 : lw * (0.45 + 0.55 * scale);
        ctx.stroke();
      }

      // readouts (drawn last, on a bg plate)
      text(ctx, 'WIREFRAME_TERRAIN // SPECTRAL HISTORY', m, m + fs, fs, ink, 'left', 'alphabetic', 700);
      text(ctx, `MESH ${C}×${R} · DEPTH ${(R * INTERVAL).toFixed(1)}S`, m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55));
      text(ctx, `HIGH ◂ LOW ▸ HIGH`, w - m, m + fs, fs, ink, 'right', 'alphabetic', 700);
      text(ctx, f.bpm ? `${f.bpm.toFixed(1)} BPM` : '--- BPM', w - m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55), 'right');
    },
  };
}
