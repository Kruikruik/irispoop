/* 02 GLYPH — dot-matrix spectrum with glow columns + kick step strip · 03 ROOTS — harmonic constellation. */
import { LogBands, TAU, clamp, hash01, hueShift, noteName, rgba, type Rect } from '../../draw';
import { card, footer, label, mixHex, sans, type Module } from '../kit';

export function createGlyph(): Module {
  const bands = new LogBands();
  const v = new Float32Array(24);
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      let inner = card(m, 'GLYPH');
      inner = footer(m, inner, [
        ['GRID', '24 × 16'],
        ['STEP', `${String(S.step + 1).padStart(2, '0')} / 16`],
        ['BASS', S.bassNote >= 0 ? noteName(S.bassNote) : '—'],
      ]);
      const stripH = 26 * u;
      const g: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - stripH - 6 * u };
      const COLS = 24;
      const ROWS = 16;
      const cw = g.w / COLS;
      const rh = g.h / ROWS;
      const sp = bands.compute(f.spectrum, f.binHz, COLS, 40, 14000, 'max');
      for (let c = 0; c < COLS; c++) v[c] += (sp[c] - v[c]) * (1 - Math.exp(-p.dt * (sp[c] > v[c] ? 20 : 4)));
      const hues = [accent, hueShift(accent, -50), hueShift(accent, 40)];
      // glow columns + translucent bars
      for (let c = 0; c < COLS; c++) {
        const x = g.x + c * cw;
        if (v[c] > 0.25) {
          const col = hues[c % 3];
          const grad = ctx.createLinearGradient(0, g.y, 0, g.y + g.h);
          grad.addColorStop(0, rgba(col, 0));
          grad.addColorStop(0.55, rgba(col, v[c] * 0.35));
          grad.addColorStop(1, rgba(col, v[c] * 0.15));
          ctx.fillStyle = grad;
          ctx.fillRect(x - cw * 0.6, g.y, cw * 2.2, g.h);
        }
        const bh = v[c] * g.h * 0.85;
        ctx.fillStyle = rgba(ink, 0.07 + v[c] * 0.08);
        ctx.fillRect(x + cw * 0.12, g.y + g.h - bh, cw * 0.76, bh);
      }
      // glyph dots
      const faint = new Path2D();
      const bright = new Path2D();
      const d = Math.max(1.2, 2.2 * u);
      for (let c = 0; c < COLS; c++) {
        for (let r = 0; r < ROWS; r++) {
          const x = g.x + (c + 0.5) * cw;
          const y = g.y + (r + 0.5) * rh;
          const thr = (ROWS - r) / ROWS;
          const on = v[c] > thr;
          const path = on ? bright : faint;
          const kind = on ? (v[c] - thr > 0.25 ? 2 : v[c] - thr > 0.1 ? 1 : 3) : 0;
          if (kind === 0) path.rect(x - d / 2, y - d / 2, d, d);
          else if (kind === 1) {
            path.rect(x - d / 2, y - d * 1.4, d, d);
            path.rect(x - d / 2, y + d * 0.4, d, d);
          } else if (kind === 2) {
            path.rect(x - d * 2, y - d * 1.2, d * 4, d * 0.8);
            path.rect(x - d * 2, y + d * 0.4, d * 4, d * 0.8);
          } else path.rect(x - d * 2, y - d * 0.4, d * 4, d * 0.8);
        }
      }
      ctx.fillStyle = rgba(ink, 0.32);
      ctx.fill(faint);
      ctx.fillStyle = ink;
      ctx.fill(bright);
      // step strip: X = kick on that 16th of the bar
      const fs = 15 * u;
      ctx.font = `700 ${fs}px "JetBrains Mono", monospace`;
      const chW = ctx.measureText('X').width * 1.25;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const n = Math.max(16, Math.floor(g.w / chW));
      const y = g.y + g.h + stripH * 0.8;
      for (let i = 0; i < n; i++) {
        const st = i % 16;
        const hit = st <= S.step ? S.kickSteps[st] : S.lastBarSteps[st];
        const cur = st === S.step && Math.floor(i / 16) === 0;
        const x = g.x + i * chW;
        if (cur) {
          ctx.fillStyle = accent;
          ctx.fillRect(x - 1 * u, y - fs, chW - 1 * u, fs * 1.25);
        }
        ctx.fillStyle = cur ? p.palette.bg : rgba(accent, hit ? 1 : 0.55);
        ctx.fillText(hit ? 'X' : '0', x + chW * 0.1, y);
      }
    },
  };
}

export function createRoots(): Module {
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const snareC = hueShift(accent, -45);
      const hatC = mixHex(hueShift(accent, 60), '#ffffff', 0.25);
      const mp = S.mostPlayed();
      let inner = card(m, 'ROOTS');
      inner = footer(m, inner, [
        ['NOTES', String(S.topNotes(128).length)],
        ['MOST PLAYED', mp >= 0 ? noteName(mp) : '—'],
        ['NOW', S.noteNames(f.activeNotes.slice(0, 2))],
        ['HITS', String(S.hitSeq)],
      ]);
      const nodes = S.topNotes(30);
      const showKey = inner.h > 220 * u;
      const plot: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h };
      const cx = plot.x + plot.w * 0.56;
      const cy = plot.y + plot.h * (showKey ? 0.36 : 0.5);
      const R = Math.min(plot.w * 0.42, plot.h * (showKey ? 0.34 : 0.46));
      const pos = (mm: number): [number, number] => {
        const fifth = ((mm % 12) * 7) % 12;
        const a = (fifth / 12) * TAU + (hash01(mm, 3) - 0.5) * 0.5;
        const rr = R * (0.25 + clamp((mm - 30) / 66) * 0.75) * (0.85 + hash01(mm, 4) * 0.3);
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85];
      };
      const total = nodes.reduce((s, x) => s + S.sounded[x], 0) || 1;
      // transitions
      ctx.lineWidth = Math.max(1, u);
      for (const a of nodes) {
        for (const b of nodes) {
          const c = S.trans.get(a * 128 + b);
          if (!c) continue;
          const [x1, y1] = pos(a);
          const [x2, y2] = pos(b);
          ctx.strokeStyle = rgba(accent, Math.min(0.55, 0.1 + c * 0.05));
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      // hits of the last bars: small dots near nodes
      ctx.fillStyle = ink;
      for (const h of S.hits) {
        if (S.clock - h.t > 8 || !nodes.length) continue;
        const nm = h.m >= 0 ? h.m : nodes[Math.floor(hash01(h.id, 9) * nodes.length)];
        const [x, y] = pos(nm);
        const a = hash01(h.id, 10) * TAU;
        const d = (8 + hash01(h.id, 11) * 30) * u;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(1, 1.8 * u), 0, TAU);
        ctx.fill();
      }
      // rays on kick / snare / hat
      for (const h of S.hits) {
        const age = S.clock - h.t;
        if (age > 0.45 || h.kind === 'note' || nodes.length < 2) continue;
        const from = S.bassNote >= 0 ? S.bassNote : nodes[0];
        const to = nodes[Math.floor(hash01(h.id, 12) * nodes.length)];
        const [x1, y1] = pos(from);
        const [x2, y2] = pos(to);
        const k = 1 - age / 0.45;
        ctx.strokeStyle = rgba(h.kind === 'kick' ? accent : h.kind === 'snare' ? snareC : hatC, k);
        ctx.lineWidth = Math.max(1, (h.kind === 'kick' ? 3.2 : 2) * u * k);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2 + (x2 - x1) * 0.3, y2 + (y2 - y1) * 0.3);
        ctx.stroke();
      }
      // nodes
      for (const n of nodes) {
        const [x, y] = pos(n);
        const r = (3 + Math.sqrt(S.sounded[n] / total) * 26) * u;
        ctx.fillStyle = rgba(accent, 0.85);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (f.activeNotes.includes(n)) {
          ctx.strokeStyle = ink;
          ctx.lineWidth = Math.max(1, 1.5 * u);
          ctx.beginPath();
          ctx.arc(x, y, r + 5 * u, 0, TAU);
          ctx.stroke();
        }
      }
      if (mp >= 0) {
        const [x, y] = pos(mp);
        const r = (3 + Math.sqrt(S.sounded[mp] / total) * 26) * u + 6 * u;
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, 1.4 * u);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        const tx = x - r - 10 * u;
        ctx.beginPath();
        ctx.moveTo(tx, y);
        ctx.lineTo(tx - 22 * u, y);
        ctx.stroke();
        label(ctx, 'MOST PLAYED', tx - 26 * u, y - 3 * u, 10 * u, ink, 'right', 600, 0.06);
        label(ctx, `NOTE, ${noteName(mp)}`, tx - 26 * u, y + 10 * u, 10 * u, ink, 'right', 600, 0.06);
      }
      if (!nodes.length) label(ctx, 'WAITING FOR NOTES…', cx, cy, 11 * u, rgba(ink, 0.45), 'center', 600);
      // key
      if (showKey) {
        let y = plot.y + plot.h - 5 * 15 * u - 18 * u;
        sans(ctx, 'KEY', plot.x, y, 12 * u, ink, 'left', 700);
        const rows: [string, (x: number, yy: number) => void][] = [
          ['A note, sized by how long it sounded', (x, yy) => { ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, yy, 5 * u, 0, TAU); ctx.fill(); }],
          ['A hit of the last bars', (x, yy) => { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, yy, 2 * u, 0, TAU); ctx.fill(); }],
          ['Kick, and the tune’s path', (x, yy) => { ctx.fillStyle = accent; ctx.fillRect(x - 7 * u, yy - u, 14 * u, 2.4 * u); }],
          ['Snare', (x, yy) => { ctx.fillStyle = snareC; ctx.fillRect(x - 7 * u, yy - u, 14 * u, 2.4 * u); }],
          ['Hat', (x, yy) => { ctx.fillStyle = hatC; ctx.fillRect(x - 7 * u, yy - u, 14 * u, 2.4 * u); }],
        ];
        for (const [t, icon] of rows) {
          y += 15 * u;
          icon(plot.x + 7 * u, y - 4 * u);
          sans(ctx, t, plot.x + 22 * u, y, 10.5 * u, rgba(ink, 0.85), 'left', 400);
        }
      }
    },
  };
}
