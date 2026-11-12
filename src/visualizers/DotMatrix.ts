import type { VisualizerInstance } from './types';
import { LogBands, RippleField, TAU, rgba, text } from './draw';

/** A3 — structured dot/crosshair grid; bass hits send ripples that scale, rotate and highlight cells. */
export function createDotMatrix(): VisualizerInstance {
  const ripples = new RippleField();
  const bands = new LogBands();

  return {
    draw(ctx, w, h, f, p) {
      const u = p.unit;
      const { ink, accent } = p.palette;
      const lw = Math.max(1, p.stroke * u);
      const fs = 13 * u;
      const m = 54 * u;

      ripples.update(p.dt);
      if (f.kick) ripples.spawn(0.65 + 0.45 * f.bass, 0.85);
      if (f.snareHit) ripples.spawn(0.35, 1.35);

      const cols = Math.round(14 + p.detail * 34);
      const cell = (w - 2 * m) / cols;
      const rows = Math.max(1, Math.floor((h - 2 * m - 40 * u) / cell));
      const gx = (w - cols * cell) / 2 + cell / 2;
      const gy = (h - rows * cell) / 2 + cell / 2 + 10 * u;
      const cx = w / 2;
      const cy = gy + ((rows - 1) * cell) / 2;
      const maxD = Math.hypot((cols * cell) / 2, (rows * cell) / 2);
      const spec = bands.compute(f.spectrum, f.binHz, 32, 30, 12000, 'avg');

      // faint reference crosses between cells
      const ref = new Path2D();
      const rs = cell * 0.12;
      for (let r = 0; r <= rows; r += 2) {
        for (let c = 0; c <= cols; c += 2) {
          const x = gx - cell / 2 + c * cell;
          const y = gy - cell / 2 + r * cell;
          ref.moveTo(x - rs, y);
          ref.lineTo(x + rs, y);
          ref.moveTo(x, y - rs);
          ref.lineTo(x, y + rs);
        }
      }
      ctx.strokeStyle = rgba(ink, 0.18);
      ctx.lineWidth = Math.max(1, u);
      ctx.stroke(ref);

      const dots = new Path2D();
      const squares = new Path2D();
      const cross = new Path2D();
      const width = 0.07;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = gx + c * cell;
          const y = gy + r * cell;
          const dx = x - cx;
          const dy = y - cy;
          const d = Math.hypot(dx, dy) / maxD;
          const infl = ripples.at(d, width);
          const s = spec[Math.min(31, Math.floor(d * 32))];
          const wave = 0.5 + 0.5 * Math.sin(d * 18 - p.time * 3);
          const size = cell * (0.06 + 0.16 * s + 0.1 * wave * f.mid + 0.32 * infl + 0.08 * f.bass);
          if (infl > 0.32) {
            const arm = Math.min(cell * 0.48, size * 1.3 + cell * 0.1);
            const rot = infl * (Math.PI / 2) + Math.atan2(dy, dx);
            const co = Math.cos(rot) * arm;
            const si = Math.sin(rot) * arm;
            cross.moveTo(x - co, y - si);
            cross.lineTo(x + co, y + si);
            cross.moveTo(x + si, y - co);
            cross.lineTo(x - si, y + co);
          } else if (s > 0.72 && f.active) {
            const q = Math.min(cell * 0.4, size);
            squares.rect(x - q, y - q, q * 2, q * 2);
          } else {
            const rr = Math.min(cell * 0.45, Math.max(0.8 * u, size));
            dots.moveTo(x + rr, y);
            dots.arc(x, y, rr, 0, TAU);
          }
        }
      }
      ctx.fillStyle = ink;
      ctx.fill(dots);
      ctx.fill(squares);
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw * 1.4;
      ctx.lineCap = 'square';
      ctx.stroke(cross);
      ctx.lineCap = 'butt';

      // centre marker
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw;
      const cr = cell * (0.6 + f.beat * 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, TAU);
      ctx.stroke();

      text(ctx, 'DOT_MATRIX // RIPPLE FIELD', m, m + fs, fs, ink, 'left', 'alphabetic', 700);
      text(ctx, `GRID ${cols}×${rows} · WAVES ×${ripples.count}`, m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55));
      text(ctx, `BASS ${f.bass.toFixed(2)}`, w - m, m + fs, fs, f.beat > 0.5 ? accent : ink, 'right', 'alphabetic', 700);
      text(ctx, `MID ${f.mid.toFixed(2)}`, w - m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55), 'right');
    },
  };
}
