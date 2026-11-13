/*
 * 01 FORM — "sound form": every hit drops a point in its frequency column (SUB · LOW · MID · HIGH · AIR);
 * points pull on each other as a metaball field whose iso-lines are drawn as a topographic map.
 * Four mini stages show the pipeline: hit points → field → merge → sound form.
 */
import { marchingSquares } from '../../contour';
import { TAU, clamp, hash01, hueShift, rgba, type Rect } from '../../draw';
import { BANDS } from '../DeckState';
import { card, footer, label, mixHex, sans, type Module, type ModuleCtx } from '../kit';

interface Pt {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  band: number;
}

const GX = 96;
const GY = 60;

export function createForm(): Module {
  const pts: Pt[] = [];
  let seen = 0;
  const field = new Float32Array(GX * GY);
  let fillCanvas: HTMLCanvasElement | null = null;
  let segs: Float32Array[] = [];

  function ingest(m: ModuleCtx): void {
    for (const h of m.S.hitsSince(seen)) {
      seen = h.id;
      const col = (h.band + 0.08 + hash01(h.id, 1) * 0.84) / 5;
      pts.push({ x: col, y: 0.14 + hash01(h.id, 2) * 0.72, vx: 0, vy: 0, s: 0.5 + h.s * 0.7, band: h.band });
    }
    if (seen === 0 && m.S.hitSeq > 0) seen = m.S.hitSeq;
    while (pts.length > 80) pts.shift();
  }

  function physics(dt: number, asp: number): void {
    const k = Math.exp(-dt / 7);
    for (const a of pts) {
      a.s *= k;
      // bands hold the form together: pull toward the column centre, gentle cohesion in y
      a.vx += ((a.band + 0.5) / 5 - a.x) * 0.06 * dt;
      a.vy += (0.5 - a.y) * 0.03 * dt;
      for (const b of pts) {
        if (a === b) continue;
        const dx = b.x - a.x;
        const dy = (b.y - a.y) * asp;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.0004 || d2 > 0.03) continue;
        a.vx += (dx / d2) * 0.00025 * b.s * dt;
        a.vy += (dy / d2) * 0.00025 * b.s * dt;
      }
      a.vx *= 0.92;
      a.vy *= 0.92;
      a.x = clamp(a.x + a.vx, 0.03, 0.97);
      a.y = clamp(a.y + a.vy, 0.08, 0.92);
    }
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i].s < 0.07) pts.splice(i, 1);
  }

  function compute(asp: number): number {
    field.fill(0);
    const sig = 0.034;
    let max = 0;
    for (const q of pts) {
      const rx = Math.ceil((sig * 3) * (GX - 1));
      const ry = Math.ceil(((sig * 3) / asp) * (GY - 1));
      const cx = Math.round(q.x * (GX - 1));
      const cy = Math.round(q.y * (GY - 1));
      for (let y = Math.max(0, cy - ry); y <= Math.min(GY - 1, cy + ry); y++) {
        const dy = (y / (GY - 1) - q.y) * asp;
        for (let x = Math.max(0, cx - rx); x <= Math.min(GX - 1, cx + rx); x++) {
          const dx = x / (GX - 1) - q.x;
          const v = q.s * Math.exp(-(dx * dx + dy * dy) / (sig * sig));
          field[y * GX + x] += v;
        }
      }
    }
    for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
    return max;
  }

  return {
    draw(m) {
      const { ctx, f, p } = m;
      const u = p.unit;
      const { ink, accent, bg } = p.palette;
      const lav = mixHex(hueShift(accent, 70), ink, 0.25);
      let inner = card(m, 'FORM');
      inner = footer(m, inner, [
        ['POINTS', String(pts.length)],
        ['CONTOURS', String(segs.filter((s) => s.length).length)],
        ['STRONGEST', BANDS[[f.subBass, f.bass, f.mid, f.treble * 0.9, f.treble * 0.6].reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0)].toLowerCase()],
        ['TEMPO', f.bpm ? String(Math.round(f.bpm)) : '---'],
      ]);

      ingest(m);
      // stage previews row
      const showPrev = inner.h > 260 * u;
      const prevH = showPrev ? Math.min(inner.h * 0.17, 90 * u) : 0;
      const plot: Rect = { x: inner.x, y: inner.y + prevH + 26 * u, w: inner.w, h: inner.h - prevH - 26 * u - 22 * u };
      const asp = plot.h / plot.w;
      physics(p.dt, asp);
      const max = compute(asp);
      const levels = 10;
      const base = 0.28;
      segs = [];
      for (let k = 0; k < levels; k++) {
        const lv = base + k * 0.17;
        segs.push(lv < max ? marchingSquares(field, GX, GY, lv) : new Float32Array(0));
      }

      // filled body (low-res alpha mask, smoothed when scaled)
      if (!fillCanvas) {
        fillCanvas = document.createElement('canvas');
        fillCanvas.width = GX;
        fillCanvas.height = GY;
      }
      const fg = fillCanvas.getContext('2d');
      if (fg) {
        const im = fg.createImageData(GX, GY);
        const fillCol = mixHex(lav, bg, 0.55);
        const fr = parseInt(fillCol.slice(1, 3), 16);
        const fgc = parseInt(fillCol.slice(3, 5), 16);
        const fb = parseInt(fillCol.slice(5, 7), 16);
        for (let i = 0; i < field.length; i++) {
          const a = clamp((field[i] - base + 0.06) / 0.12);
          im.data[i * 4] = fr;
          im.data[i * 4 + 1] = fgc;
          im.data[i * 4 + 2] = fb;
          im.data[i * 4 + 3] = a * 150;
        }
        fg.putImageData(im, 0, 0);
      }

      // header row
      label(ctx, 'SOUND FORM', plot.x + 8 * u, plot.y - 8 * u, 12 * u, ink, 'left', 700, 0.04);
      label(ctx, `♩ = ${f.bpm ? Math.round(f.bpm) : '---'}`, plot.x + plot.w - 8 * u, plot.y - 8 * u, 12 * u, ink, 'right', 500, 0.04);

      // band columns
      ctx.strokeStyle = rgba(ink, 0.3);
      ctx.lineWidth = Math.max(1, u);
      ctx.setLineDash([3 * u, 5 * u]);
      ctx.beginPath();
      for (let b = 1; b < 5; b++) {
        const x = plot.x + (b / 5) * plot.w;
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.h);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      BANDS.forEach((b, i) => label(ctx, b, plot.x + ((i + 0.5) / 5) * plot.w, plot.y + plot.h + 18 * u, 10 * u, rgba(ink, 0.6), 'center', 500, 0.16));

      // body + contours
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(fillCanvas, plot.x, plot.y, plot.w, plot.h);
      const sx = plot.w;
      const sy = plot.h;
      segs.forEach((sg, k) => {
        if (!sg.length) return;
        ctx.beginPath();
        for (let i = 0; i < sg.length; i += 4) {
          ctx.moveTo(plot.x + sg[i] * sx, plot.y + sg[i + 1] * sy);
          ctx.lineTo(plot.x + sg[i + 2] * sx, plot.y + sg[i + 3] * sy);
        }
        ctx.strokeStyle = k === 0 ? accent : rgba(lav, 0.85 - k * 0.04);
        ctx.lineWidth = k === 0 ? Math.max(1.5, 2.4 * u) : Math.max(1, 1.1 * u);
        ctx.stroke();
      });

      // dashed path through the latest points
      const last = pts.slice(-9);
      if (last.length > 1) {
        ctx.strokeStyle = rgba(ink, 0.45);
        ctx.setLineDash([4 * u, 4 * u]);
        ctx.lineWidth = Math.max(1, u);
        ctx.beginPath();
        last.forEach((q, i) => (i ? ctx.lineTo(plot.x + q.x * sx, plot.y + q.y * sy) : ctx.moveTo(plot.x + q.x * sx, plot.y + q.y * sy)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // caption
      if (plot.w > 380 * u) {
        label(ctx, 'FORM FINDING', plot.x + plot.w - 8 * u, plot.y + plot.h - 22 * u, 10.5 * u, ink, 'right', 700, 0.02);
        sans(ctx, 'Hits pull the field; the bands bind it into one shape.', plot.x + plot.w - 8 * u, plot.y + plot.h - 8 * u, 10 * u, rgba(ink, 0.6), 'right', 400);
      }

      // mini stages
      if (showPrev) {
        const names = ['Hit points', 'Field', 'Merge', 'Sound form'];
        const pw = inner.w / 4;
        names.forEach((n, i) => {
          const box: Rect = { x: inner.x + i * pw + pw * 0.15, y: inner.y, w: pw * 0.7, h: prevH - 20 * u };
          const X = (x: number) => box.x + x * box.w;
          const Y = (y: number) => box.y + y * box.h;
          ctx.fillStyle = accent;
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(1, u);
          if (i === 2) ctx.drawImage(fillCanvas!, box.x, box.y, box.w, box.h);
          if (i === 3 && segs[0].length) {
            ctx.beginPath();
            const sg = segs[0];
            for (let k = 0; k < sg.length; k += 4) {
              ctx.moveTo(X(sg[k]), Y(sg[k + 1]));
              ctx.lineTo(X(sg[k + 2]), Y(sg[k + 3]));
            }
            ctx.stroke();
          }
          for (const q of pts) {
            if (i === 3) break;
            ctx.beginPath();
            ctx.arc(X(q.x), Y(q.y), Math.max(1, 1.8 * u), 0, TAU);
            ctx.fill();
            if (i >= 1) {
              ctx.beginPath();
              ctx.arc(X(q.x), Y(q.y), (2 + q.s * 5) * u, 0, TAU);
              ctx.stroke();
            }
          }
          sans(ctx, n, box.x + box.w / 2, inner.y + prevH - 2 * u, 10 * u, rgba(ink, 0.6), 'center', 400);
        });
      }
    },
  };
}
