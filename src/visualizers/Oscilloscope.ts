import type { VisualizerInstance } from './types';
import { TAU, rgba, text } from './draw';

/** A2 — scope graticule, triggered waveform, polar waveform ring + delay-embedded Lissajous phase plot. */
export function createOscilloscope(): VisualizerInstance {
  let spin = 0;
  return {
    draw(ctx, w, h, f, p) {
      const u = p.unit;
      const { ink, accent } = p.palette;
      const lw = Math.max(1, p.stroke * u * 1.3);
      const fs = 13 * u;
      const m = 54 * u;
      const ax = m;
      const ay = m + 30 * u;
      const aw = w - 2 * m;
      const ah = h - 2 * m - 60 * u;
      const wf = f.waveform;
      const n = wf.length;

      // ── graticule
      const div = 10;
      const cell = aw / div;
      const vdiv = Math.max(2, Math.round(ah / cell));
      const cellY = ah / vdiv;
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeStyle = rgba(ink, 0.08);
      ctx.beginPath();
      for (let i = 0; i <= div; i++) {
        ctx.moveTo(ax + i * cell, ay);
        ctx.lineTo(ax + i * cell, ay + ah);
      }
      for (let j = 0; j <= vdiv; j++) {
        ctx.moveTo(ax, ay + j * cellY);
        ctx.lineTo(ax + aw, ay + j * cellY);
      }
      ctx.stroke();
      // centre axes with minor ticks
      const mx = ax + aw / 2;
      const my = ay + ah / 2;
      ctx.strokeStyle = rgba(ink, 0.3);
      ctx.beginPath();
      ctx.moveTo(ax, my);
      ctx.lineTo(ax + aw, my);
      ctx.moveTo(mx, ay);
      ctx.lineTo(mx, ay + ah);
      const tk = 4 * u;
      for (let x = ax; x <= ax + aw + 0.5; x += cell / 5) {
        ctx.moveTo(x, my - tk);
        ctx.lineTo(x, my + tk);
      }
      for (let y = ay; y <= ay + ah + 0.5; y += cellY / 5) {
        ctx.moveTo(mx - tk, y);
        ctx.lineTo(mx + tk, y);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba(ink, 0.5);
      ctx.lineWidth = lw;
      ctx.strokeRect(ax, ay, aw, ah);

      // ── trigger: first rising zero crossing in the first half
      let trig = 0;
      for (let i = 1; i < n / 2; i++) {
        if (wf[i - 1] < 0 && wf[i] >= 0) {
          trig = i;
          break;
        }
      }

      // ── circular geometry
      const cx = mx;
      const cy = ay + ah * 0.42;
      const R = Math.min(aw, ah) * 0.3;
      spin += p.dt * (0.12 + f.mid * 0.6);

      // reference circles
      ctx.strokeStyle = rgba(ink, 0.35);
      ctx.lineWidth = Math.max(1, u);
      ctx.setLineDash([6 * u, 6 * u]);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.78, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, R * (0.42 + f.bass * 0.12), 0, TAU);
      ctx.stroke();

      // polar waveform ring
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const P = 360;
      for (let k = 0; k <= P; k++) {
        const s = wf[(trig + (k % P) * 2) % n];
        const ang = (k / P) * TAU + spin - Math.PI / 2;
        const r = R * (0.78 + s * 0.6);
        const x = cx + Math.cos(ang) * r;
        const y = cy + Math.sin(ang) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Lissajous phase portrait: x = s[t], y = s[t + d]
      const d = Math.round(8 + p.detail * 48);
      ctx.strokeStyle = accent;
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      const amp = R * 0.62;
      for (let i = 0; i < n - d; i += 2) {
        const x = cx + wf[i] * amp * 1.1;
        const y = cy - wf[i + d] * amp * 1.1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // crosshair + radial ticks
      ctx.strokeStyle = rgba(ink, 0.6);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      ctx.moveTo(cx - R * 1.12, cy);
      ctx.lineTo(cx - R * 0.95, cy);
      ctx.moveTo(cx + R * 0.95, cy);
      ctx.lineTo(cx + R * 1.12, cy);
      ctx.moveTo(cx, cy - R * 1.12);
      ctx.lineTo(cx, cy - R * 0.95);
      ctx.moveTo(cx, cy + R * 0.95);
      ctx.lineTo(cx, cy + R * 1.12);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const r0 = R * 1.18;
        const r1 = r0 + (i % 6 === 0 ? 10 : 4) * u;
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();

      // ── time-domain strip
      const sy = ay + ah * 0.86;
      const sa = ah * 0.1;
      ctx.strokeStyle = rgba(ink, 0.25);
      ctx.beginPath();
      ctx.moveTo(ax, sy);
      ctx.lineTo(ax + aw, sy);
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const span = n / 2;
      const step = Math.max(1, Math.floor(span / Math.max(200, aw / (2 * u))));
      for (let i = 0; i < span; i += step) {
        const x = ax + (i / span) * aw;
        const y = sy - wf[trig + i] * sa * 1.6;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // trigger marker
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(ax - 2 * u, sy - 6 * u);
      ctx.lineTo(ax + 8 * u, sy);
      ctx.lineTo(ax - 2 * u, sy + 6 * u);
      ctx.fill();

      // ── readouts
      const msDiv = ((span / (f.binHz * 2048)) * 1000) / div;
      text(ctx, 'CH1 // GEOMETRIC OSCILLOSCOPE', ax, m + fs, fs, ink, 'left', 'alphabetic', 700);
      text(ctx, `TIME/DIV ${msDiv.toFixed(2)}MS · TRIG ↑ 0.00V · PHASE Δ${d}`, ax, m + fs * 2.4, fs * 0.85, rgba(ink, 0.55));
      text(ctx, `RMS ${f.rms.toFixed(2)}`, ax + aw, m + fs, fs, ink, 'right', 'alphabetic', 700);
      text(ctx, `PK ${f.peakDb.toFixed(1)} DB`, ax + aw, m + fs * 2.4, fs * 0.85, f.peakDb > -3 ? accent : rgba(ink, 0.55), 'right');
      text(ctx, 'X: S(T)   Y: S(T+Δ)', ax, h - m + 4 * u, fs * 0.8, rgba(ink, 0.55));
      text(ctx, '2048 SMP', ax + aw, h - m + 4 * u, fs * 0.8, rgba(ink, 0.55), 'right');
    },
  };
}
