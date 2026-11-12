import type { VisualizerInstance } from './types';
import { LogBands, clamp, pad, rgba, text } from './draw';

const BAND_NAMES = ['SUB', 'BASS', 'LO-MID', 'MID', 'HIGH'];
const DB_MARKS = [0, -6, -12, -18, -24, -36, -48, -60, -72];
const FREQ_MARKS: [number, string][] = [
  [32, '32'], [63, '63'], [125, '125'], [250, '250'], [500, '500'],
  [1000, '1K'], [2000, '2K'], [4000, '4K'], [8000, '8K'], [16000, '16K'],
];
const F_MIN = 20;
const F_MAX = 16000;

/** A1 — multi-band segmented meters with peak-hold ticks and dB scale. */
export function createFrequencyMeters(): VisualizerInstance {
  const bands = new LogBands();
  let peaks = new Float32Array(0);
  let holds = new Float32Array(0);
  const bandPeaks = new Float32Array(5);

  return {
    draw(ctx, w, h, f, p) {
      const u = p.unit;
      const { ink, accent } = p.palette;
      const m = 54 * u;
      const fs = 13 * u;
      const lw = Math.max(1, p.stroke * u);
      const faint = rgba(ink, 0.09);

      const n = Math.round(16 + p.detail * 48);
      if (peaks.length !== n) {
        peaks = new Float32Array(n);
        holds = new Float32Array(n);
      }
      const vals = bands.compute(f.spectrum, f.binHz, n, F_MIN, F_MAX, 'max');

      // ── header
      text(ctx, 'FREQ_HZ // SPECTRUM ANALYSER', m, m + fs, fs, ink, 'left', 'alphabetic', 700);
      text(ctx, `FFT 2048 · ${n} BANDS`, m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.5));
      text(ctx, `PEAK ${f.peakDb.toFixed(1)} DB`, w - m, m + fs, fs, f.peakDb > -3 ? accent : ink, 'right', 'alphabetic', 700);
      text(ctx, f.bpm ? `${f.bpm.toFixed(1)} BPM` : '--- BPM', w - m, m + fs * 2.4, fs * 0.85, rgba(ink, 0.5), 'right');

      // ── 5 horizontal band meters
      const bv = [f.subBass, f.bass, f.lowMid, f.mid, f.treble];
      const rowH = 14 * u;
      const labelW = 86 * u;
      const valW = 64 * u;
      const segs = 48;
      const meterX = m + labelW;
      const meterW = w - 2 * m - labelW - valW;
      const segW = meterW / segs;
      let y = m + fs * 3.6;
      const pFaint = new Path2D();
      const pInk = new Path2D();
      const pAcc = new Path2D();
      for (let b = 0; b < 5; b++) {
        bandPeaks[b] = Math.max(bv[b], bandPeaks[b] - p.dt * 0.4);
        const lit = Math.round(bv[b] * segs);
        const pk = Math.min(segs - 1, Math.floor(bandPeaks[b] * segs));
        for (let s = 0; s < segs; s++) {
          const x = meterX + s * segW;
          const path = s < lit ? (s >= segs * 0.85 ? pAcc : pInk) : s === pk && pk > 0 ? pAcc : pFaint;
          path.rect(x, y, segW * 0.72, rowH);
        }
        text(ctx, BAND_NAMES[b], m, y + rowH * 0.8, fs * 0.9, ink);
        text(ctx, pad(bv[b] * 100), w - m, y + rowH * 0.8, fs * 0.9, bv[b] > 0.85 ? accent : ink, 'right');
        y += rowH + 8 * u;
      }

      // ── main segmented spectrum
      const top = y + 34 * u;
      const bottom = h - m - 26 * u;
      const left = m + 52 * u;
      const right = w - m;
      const areaH = Math.max(10, bottom - top);
      const areaW = right - left;

      // dB scale + grid
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeStyle = rgba(ink, 0.12);
      ctx.beginPath();
      for (const db of DB_MARKS) {
        const yy = bottom - (1 + db / 80) * areaH;
        if (yy < top - 1) continue;
        ctx.moveTo(left, yy);
        ctx.lineTo(right, yy);
        text(ctx, db === 0 ? '0' : String(db), left - 12 * u, yy, fs * 0.8, rgba(ink, 0.6), 'right', 'middle');
      }
      ctx.stroke();
      text(ctx, 'GAIN_DB', m, top - 12 * u, fs * 0.8, rgba(ink, 0.6));

      const bw = areaW / n;
      const gap = Math.max(1, bw * 0.22);
      const S = Math.max(8, Math.round(areaH / (9 * u + (1 - p.detail) * 9 * u)));
      const segH = areaH / S;
      const sFaint = new Path2D();
      const sInk = new Path2D();
      const sAcc = new Path2D();
      const sPeak = new Path2D();
      for (let i = 0; i < n; i++) {
        const v = clamp(vals[i]);
        if (v >= peaks[i]) {
          peaks[i] = v;
          holds[i] = 0.6;
        } else {
          holds[i] -= p.dt;
          if (holds[i] <= 0) peaks[i] = Math.max(0, peaks[i] - p.dt * 0.5);
        }
        const lit = Math.round(v * S);
        const x = left + i * bw + gap / 2;
        for (let s = 0; s < S; s++) {
          const yy = bottom - (s + 1) * segH + segH * 0.15;
          const path = s < lit ? (s >= S * 0.82 ? sAcc : sInk) : sFaint;
          path.rect(x, yy, bw - gap, segH * 0.7);
        }
        if (peaks[i] > 0.01) {
          sPeak.rect(x, bottom - peaks[i] * areaH - lw, bw - gap, Math.max(2 * u, lw * 1.5));
        }
      }

      ctx.fillStyle = faint;
      ctx.fill(pFaint);
      ctx.fill(sFaint);
      ctx.fillStyle = ink;
      ctx.fill(pInk);
      ctx.fill(sInk);
      ctx.fillStyle = accent;
      ctx.fill(pAcc);
      ctx.fill(sAcc);
      ctx.fill(sPeak);

      // baseline + frequency labels
      ctx.strokeStyle = ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(left, bottom + 4 * u);
      ctx.lineTo(right, bottom + 4 * u);
      const lr = Math.log(F_MAX / F_MIN);
      for (const [hz, label] of FREQ_MARKS) {
        const x = left + (Math.log(hz / F_MIN) / lr) * areaW;
        ctx.moveTo(x, bottom + 4 * u);
        ctx.lineTo(x, bottom + 10 * u);
        text(ctx, label, x, bottom + 24 * u, fs * 0.8, rgba(ink, 0.7), 'center');
      }
      ctx.stroke();
      text(ctx, 'FREQ_HZ', left - 12 * u, bottom + 24 * u, fs * 0.8, rgba(ink, 0.6), 'right');
    },
  };
}
