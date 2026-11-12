import type { VisualizerInstance } from './types';
import { LogBands, TAU, lerp, pad, rgba, text } from './draw';

/** A4 — architectural concentric rings + radial spectrum ticks; sub-bass and snare transients drive them. */
export function createBeatRings(): VisualizerInstance {
  const bands = new LogBands();
  const shocks: { r: number; a: number }[] = [];
  let rot = 0;
  let snareAng = 0;

  return {
    draw(ctx, w, h, f, p) {
      const u = p.unit;
      const { ink, accent } = p.palette;
      const lw = Math.max(1, p.stroke * u * 1.3);
      const fs = 13 * u;
      const m = 54 * u;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) * 0.4;

      rot += p.dt * (0.05 + f.mid * 0.4);
      if (f.kick) shocks.push({ r: R * 0.1, a: 1 });
      if (f.snareHit) snareAng = Math.random() * TAU;

      const bv = [f.subBass, f.bass, f.lowMid, f.mid, f.treble];
      const N = Math.round(6 + p.detail * 14);
      const spacing = (R * 0.72) / N;

      for (let i = 0; i < N; i++) {
        const t = N > 1 ? i / (N - 1) : 0;
        const bi = t * 4;
        const b0 = Math.floor(bi);
        const b = lerp(bv[b0], bv[Math.min(4, b0 + 1)], bi - b0);
        const r = R * 0.12 + t * R * 0.72 + b * spacing * 1.1 + f.beat * (1 - t) * spacing * 1.6;
        const style = i % 4;
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw;
        ctx.globalAlpha = 1;
        if (style === 1) {
          ctx.setLineDash([spacing * 0.12 + 2 * u, spacing * 0.2 + 3 * u]);
          ctx.lineDashOffset = rot * R * (i % 2 ? 0.3 : -0.3);
        } else if (style === 2) {
          ctx.lineWidth = Math.max(1, lw * 0.5);
          ctx.globalAlpha = 0.5;
        }
        ctx.beginPath();
        if (style === 3) {
          const segs = 4;
          const off = rot * (i % 2 ? 1.4 : -1.4);
          for (let s = 0; s < segs; s++) {
            const a0 = off + (s / segs) * TAU;
            ctx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
            ctx.arc(cx, cy, r, a0, a0 + (TAU / segs) * 0.78);
          }
        } else {
          ctx.arc(cx, cy, r, 0, TAU);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        // snare flash on the second-outer ring
        if (i === N - 2 && f.snare > 0.02) {
          ctx.strokeStyle = rgba(accent, f.snare);
          ctx.lineWidth = lw * 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, TAU);
          ctx.stroke();
        }
      }

      // ── radial spectrum ticks (mirrored left/right)
      const T = Math.round(90 + p.detail * 150);
      const half = Math.ceil(T / 2) + 1;
      const spec = bands.compute(f.spectrum, f.binHz, half, 30, 14000, 'max');
      const R0 = R * 0.95;
      const tInk = new Path2D();
      const tAcc = new Path2D();
      for (let i = 0; i < T; i++) {
        const ang = (i / T) * TAU - Math.PI / 2 + rot * 0.15;
        const k = i <= T / 2 ? i : T - i;
        const v = spec[Math.min(half - 1, k)];
        const major = i % 10 === 0;
        const len = (major ? 10 : 4) * u + v * R * 0.16;
        const co = Math.cos(ang);
        const si = Math.sin(ang);
        const path = v > 0.72 ? tAcc : tInk;
        path.moveTo(cx + co * R0, cy + si * R0);
        path.lineTo(cx + co * (R0 + len), cy + si * (R0 + len));
      }
      ctx.lineWidth = Math.max(1, lw * 0.8);
      ctx.strokeStyle = ink;
      ctx.stroke(tInk);
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw * 1.2;
      ctx.stroke(tAcc);

      // cardinal degree labels
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * TAU - Math.PI / 2;
        const rr = R0 + R * 0.24;
        text(ctx, pad(q * 90) + '°', cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, fs * 0.85, rgba(ink, 0.6), 'center', 'middle');
      }

      // ── kick shockwaves
      for (let i = shocks.length - 1; i >= 0; i--) {
        const s = shocks[i];
        s.r += p.dt * R * 1.3;
        s.a *= Math.exp(-p.dt * 2.2);
        if (s.r > R * 1.3 || s.a < 0.03) {
          shocks.splice(i, 1);
          continue;
        }
        ctx.strokeStyle = rgba(accent, s.a);
        ctx.lineWidth = lw * (1 + 2 * s.a);
        ctx.beginPath();
        ctx.arc(cx, cy, s.r, 0, TAU);
        ctx.stroke();
      }

      // ── snare arc
      if (f.snare > 0.02) {
        ctx.strokeStyle = rgba(accent, f.snare);
        ctx.lineWidth = lw * 4;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.5, snareAng, snareAng + 0.7);
        ctx.stroke();
      }

      // ── centre
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const cl = R * 0.08;
      ctx.moveTo(cx - cl, cy);
      ctx.lineTo(cx + cl, cy);
      ctx.moveTo(cx, cy - cl);
      ctx.lineTo(cx, cy + cl);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.025 * (0.6 + f.beat * 1.6), 0, TAU);
      ctx.fill();

      // ── readouts
      text(ctx, 'BEAT_RINGS // CONCENTRIC', m, m + fs, fs, ink, 'left', 'alphabetic', 700);
      text(ctx, `RINGS ${N} · TICKS ${T}`, m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55));
      const names = ['SUB', 'BASS', 'LOW', 'MID', 'HIGH'];
      for (let b = 0; b < 5; b++) {
        const y = h - m - (4 - b) * fs * 1.35;
        text(ctx, `${names[b].padEnd(4, ' ')} ${bv[b].toFixed(2)}`, m, y, fs * 0.85, bv[b] > 0.8 ? accent : rgba(ink, 0.7));
      }
      text(ctx, f.bpm ? `${f.bpm.toFixed(1)} BPM` : '--- BPM', w - m, h - m, fs, ink, 'right', 'alphabetic', 700);
      text(ctx, `KICK ${f.beat.toFixed(2)}`, w - m, m + fs, fs, f.beat > 0.5 ? accent : ink, 'right', 'alphabetic', 700);
      text(ctx, `SNARE ${f.snare.toFixed(2)}`, w - m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55), 'right');
    },
  };
}
