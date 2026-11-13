/* Deck 03 — 01 UNRAVEL · 02 STARWORDS · 03 TRACKER · 04 DIFFUSE */
import { TAU, clamp, hash01, hexToRgb, noteName, rgba, type Rect } from '../../draw';
import { getSheetImage } from '../../imageGrid';
import { ProgressivePainter } from '../../paint/ProgressivePainter';
import { TrackerView } from '../TrackerView';
import { card, footer, label, mixHex, noImage, sans, vnoise, type Module } from '../kit';

/* ───────── 01 UNRAVEL ───────── */
export function createUnravel(): Module {
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink } = p.palette;
      let inner = card(m, 'UNRAVEL');
      // ~6 s on the clean side + ~3.5 s to unravel across the left side
      const all = S.spans.filter((s) => S.clock - s.t1 < 10.5);
      const step = Math.max(1, Math.ceil(all.length / 120)); // thin out very dense passages, keeping old and new
      const visible = all.filter((_, i) => i % step === 0 || i >= all.length - 40);
      inner = footer(m, inner, [
        ['PART', S.section],
        ['SOUNDING', S.noteNames(f.activeNotes)],
        ['THREADS', String(visible.length * 5)],
      ]);
      const r = inner;
      const div = r.x + r.w * 0.36;
      const right = r.x + r.w;
      const ROWS = 8;
      const rowH = r.h / ROWS;
      const speedR = (right - div) / 6; // px per second on the clean side
      ctx.strokeStyle = rgba(ink, 0.4);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      ctx.moveTo(div, r.y);
      ctx.lineTo(div, r.y + r.h);
      ctx.stroke();
      const xOf = (t: number) => right - (S.clock - t) * speedR;
      for (const s of visible) {
        const row = clamp(Math.floor(((s.m - 36) / 60) * ROWS), 0, ROWS - 1);
        const y = r.y + (row + 0.5) * rowH + (((s.m % 3) - 1) * rowH) / 5;
        const x0 = xOf(s.t0);
        const x1 = s.open ? right : xOf(s.t1);
        const seed = Math.floor(s.t0 * 1000) % 100000;
        // clean side
        if (x1 > div) {
          const a = Math.max(x0, div);
          ctx.strokeStyle = rgba(ink, 0.72);
          ctx.lineWidth = Math.max(1.5, 3.4 * u);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(a, y);
          ctx.lineTo(x1, y);
          ctx.stroke();
          ctx.fillStyle = rgba(ink, 0.85);
          for (const kx of [x0, x1]) {
            if (kx < div || kx > right) continue;
            ctx.beginPath();
            ctx.arc(kx, y, 5 * u, 0, TAU);
            ctx.fill();
          }
        }
        // unravelled side: hair-like strands that loosen with distance past the divider
        if (x0 < div) {
          const far = Math.max(r.x, div - (div - x0) * 0.75);
          const span = div - r.x;
          for (let k = 0; k < 5; k++) {
            ctx.strokeStyle = rgba(ink, 0.42);
            ctx.lineWidth = Math.max(0.6, 0.9 * u);
            ctx.beginPath();
            for (let x = div; x >= far; x -= 7 * u) {
              const d = (div - x) / span;
              const amp = Math.pow(d, 1.25) * rowH * 1.7 + d * 4 * u;
              const yy = y + (vnoise(x * 0.012 + k * 7.1, seed + k) - 0.5) * 2 * amp + (vnoise(x * 0.05 + p.time * 0.3, seed + 31 + k) - 0.5) * amp * 0.5;
              if (x === div) ctx.moveTo(x, yy);
              else ctx.lineTo(x, yy);
            }
            ctx.stroke();
          }
          // brush tip fanning at the divider
          ctx.strokeStyle = rgba(ink, 0.5);
          ctx.lineWidth = Math.max(0.6, 0.8 * u);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            ctx.moveTo(div + 6 * u, y);
            ctx.lineTo(div - (18 + hash01(seed, k) * 26) * u, y + (hash01(seed, k, 2) - 0.5) * 22 * u);
          }
          ctx.stroke();
        }
      }
      if (!visible.length) label(ctx, 'THREADS APPEAR WHEN NOTES SOUND', div + (right - div) / 2, r.y + r.h / 2, 10 * u, rgba(ink, 0.4), 'center', 600);
    },
  };
}

/* ───────── 02 STARWORDS ───────── */
const WORDS = ['maybe', 'the', 'light', 'fell', 'in', 'echo', 'drift', 'under', 'glass', 'slow', 'north', 'we', 'hold', 'static', 'bloom', 'after', 'tide', 'still', 'near', 'gold'];

export function createStarwords(): Module {
  let tex: HTMLCanvasElement | null = null;
  const words: { s: string; x: number; y: number; life: number }[] = [];
  let seen = 0;
  let count = 0;
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink, bg, accent } = p.palette;
      let inner = card(m, 'STARWORDS');
      inner = footer(m, inner, [
        ['WORDS', `${words.length} / 14`],
        ['PART', S.section],
        ['HEAT', `${Math.round(clamp(f.rms * 2.4) * 100)} %`],
      ]);
      const r = inner;
      // grainy ink mist (regenerated each frame = living film grain)
      const texel = Math.max(3 * u, r.w / 150, r.h / 220);
      const W = Math.max(40, Math.round(r.w / texel));
      const H = Math.max(40, Math.round(r.h / texel));
      if (!tex) tex = document.createElement('canvas');
      if (tex.width !== W || tex.height !== H) {
        tex.width = W;
        tex.height = H;
      }
      const g = tex.getContext('2d');
      if (g) {
        const im = g.createImageData(W, H);
        const [ir, ig, ib] = hexToRgb(ink);
        const [tr, tg, tb] = hexToRgb(mixHex(accent, bg, 0.7));
        const cx = 0.5 + (vnoise(p.time * 0.15, 3) - 0.5) * 0.2;
        const cy = 0.58 + (vnoise(p.time * 0.12, 4) - 0.5) * 0.12;
        const rx = 0.36 + f.bass * 0.1 + f.beat * 0.05;
        const ry = 0.3 + f.bass * 0.08;
        for (let y = 0; y < H; y++) {
          const ny = y / H;
          for (let x = 0; x < W; x++) {
            const nx = x / W;
            const dx = (nx - cx) / rx;
            const dy = (ny - cy) / ry;
            const blob = Math.exp(-(dx * dx + dy * dy) * 1.3);
            const top = clamp(1 - ny * 1.6) * 0.35;
            const n = Math.random();
            const a = clamp(blob * (0.45 + 0.55 * n) * 0.95 + top * n * 0.5);
            const i = (y * W + x) * 4;
            const t = clamp(blob * 1.3);
            im.data[i] = tr + (ir - tr) * t;
            im.data[i + 1] = tg + (ig - tg) * t;
            im.data[i + 2] = tb + (ib - tb) * t;
            im.data[i + 3] = a * 235;
          }
        }
        g.putImageData(im, 0, 0);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tex, r.x, r.y, r.w, r.h);
      // crosshairs
      ctx.strokeStyle = rgba(ink, 0.35);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const x = r.x + hash01(k, 41) * r.w;
        const y = r.y + hash01(k, 42) * r.h;
        ctx.moveTo(x - 4 * u, y);
        ctx.lineTo(x + 4 * u, y);
        ctx.moveTo(x, y - 4 * u);
        ctx.lineTo(x, y + 4 * u);
      }
      ctx.stroke();
      // beat-triggered words
      for (const h of S.hitsSince(seen)) {
        seen = h.id;
        if (h.kind === 'hat' || (h.kind === 'note' && hash01(h.id, 1) < 0.7)) continue;
        if (words.length >= 14) words.shift();
        const s = h.kind === 'kick' && hash01(h.id, 2) < 0.3 ? 'kick' : h.kind === 'snare' && hash01(h.id, 3) < 0.3 ? 'snare' : WORDS[(count++ * 7 + h.id) % WORDS.length];
        words.push({ s, x: 0.42 + (hash01(h.id, 4) - 0.5) * 0.3, y: 0.14 + (count % 8) * 0.065, life: 4 });
      }
      for (let i = words.length - 1; i >= 0; i--) {
        const w = words[i];
        w.life -= p.dt;
        w.y -= p.dt * 0.006;
        if (w.life <= 0) {
          words.splice(i, 1);
          continue;
        }
        const a = clamp(w.life / 1.5);
        const x = r.x + w.x * r.w;
        const y = r.y + w.y * r.h;
        ctx.fillStyle = rgba(ink, a);
        // ✦ marker
        const s = 5 * u;
        ctx.beginPath();
        ctx.moveTo(x, y - s);
        ctx.quadraticCurveTo(x, y, x + s, y);
        ctx.quadraticCurveTo(x, y, x, y + s);
        ctx.quadraticCurveTo(x, y, x - s, y);
        ctx.quadraticCurveTo(x, y, x, y - s);
        ctx.fill();
        sans(ctx, w.s, x + 9 * u, y + 5 * u, 15 * u, rgba(ink, a), 'left', 500);
      }
    },
  };
}

/* ───────── 03 TRACKER ───────── */
export function createTracker(): Module {
  const view = new TrackerView();
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      let inner = card(m, 'TRACKER');
      inner = footer(m, inner, [
        ['MODE', 'Picture'],
        ['TARGETS', String(view.count)],
        ['LEAD', `${Math.round(S.leadHz)} Hz`],
        ['BASS', S.bassNote >= 0 ? noteName(S.bassNote) : '—'],
      ]);
      const img = getSheetImage();
      if (!img) return noImage(m, inner);
      view.draw(ctx, inner, img, f, p, { key: S.key, fit: 'cover' });
    },
  };
}

/* ───────── 04 DIFFUSE ───────── */
export function createDiffuse(): Module {
  const painter = new ProgressivePainter('charcoal');
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      let inner = card(m, 'DIFFUSE');
      inner = footer(m, inner, [
        ['INK', `${Math.round(painter.progress * 100)} %`],
        ['BAR', String(S.bar + 1)],
        ['OPEN', `${Math.round((1 - painter.progress) * 100)} %`],
        ['PART', S.section],
      ]);
      const img = getSheetImage();
      if (!img) return noImage(m, inner);
      painter.setImage(img);
      const a = img.width / img.height;
      let w = inner.w;
      let h = w / a;
      if (h > inner.h) {
        h = inner.h;
        w = h * a;
      }
      const r: Rect = { x: inner.x + (inner.w - w) / 2, y: inner.y + (inner.h - h) / 2, w, h };
      painter.draw(ctx, r, f, p, { distortion: p.sheet?.distortion ?? 0.55, redraw: p.sheet?.redraw ?? 0, invert: p.sheet?.invert ?? false });
    },
  };
}
