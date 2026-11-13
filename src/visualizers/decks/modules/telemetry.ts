/* Deck 04 — multi-lane TELEMETRY · 02 TRAJECTORY (3D cube) · 06 STARS (scatter) · 05 ARCADE (highway + pads) */
import { TAU, clamp, hash01, hueShift, noteName, rgba, type Rect } from '../../draw';
import { HIST, RATE } from '../DeckState';
import { LANE_HUES, card, fmtClock, footer, label, mixHex, type Module } from '../kit';

/* ───────── TELEMETRY ───────── */
export function createTelemetry(): Module {
  return {
    draw(m) {
      const { ctx, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const inner = card(m, 'TELEMETRY');
      const lanes = ['HITS', 'BASS', 'LEVEL', 'PUNCH', 'BRIGHT', 'WIDTH', 'NOTES', 'TENSION'];
      const cols = [ink, accent, ink, hueShift(accent, 45), hueShift(accent, -25), hueShift(accent, -70), ink, mixHex(accent, '#ffffff', 0.25)];
      const gut = 80 * u;
      const head = 20 * u;
      const g: Rect = { x: inner.x + gut, y: inner.y + head, w: inner.w - gut, h: inner.h - head };
      const lh = g.h / lanes.length;
      const WIN = 16;
      const now = S.time;
      const start = Number.isFinite(now) ? Math.floor(now / WIN) * WIN : 0;
      const X = (t: number) => g.x + ((t - start) / WIN) * g.w;
      // grid
      ctx.strokeStyle = rgba(ink, 0.12);
      ctx.lineWidth = Math.max(1, u * 0.8);
      ctx.beginPath();
      for (let s = 0; s <= WIN; s++) {
        const x = g.x + (s / WIN) * g.w;
        ctx.moveTo(x, g.y - head * 0.2);
        ctx.lineTo(x, g.y + g.h);
        if (s < WIN && (g.w / WIN > 34 * u || s % 2 === 0)) label(ctx, fmtClock(start + s), x + 3 * u, g.y - 6 * u, 9 * u, rgba(ink, 0.6), 'left', 500, 0);
      }
      for (let l = 0; l <= lanes.length; l++) {
        ctx.moveTo(inner.x, g.y + l * lh);
        ctx.lineTo(g.x + g.w, g.y + l * lh);
      }
      ctx.stroke();
      lanes.forEach((n, i) => label(ctx, n, inner.x, g.y + (i + 0.62) * lh, 11 * u, ink, 'left', 600, 0.14));

      // collect samples of the current page, oldest → newest
      const idx: number[] = [];
      for (let a = Math.min(S.hCount, HIST) - 1; a >= 0; a--) {
        const i = S.hist(a);
        const t = S.hTime[i];
        if (t >= start - 0.01 && t <= now + 0.01) idx.push(i);
      }
      const line = (arr: Float32Array, lane: number, col: string, gaps = false) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, 1.8 * u);
        ctx.beginPath();
        let pen = false;
        for (const i of idx) {
          const v = arr[i];
          if (gaps && v < 0) {
            pen = false;
            continue;
          }
          const x = X(S.hTime[i]);
          const y = g.y + (lane + 0.85) * lh - clamp(v) * lh * 0.7;
          if (!pen) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          pen = true;
        }
        ctx.stroke();
      };
      // hits: ticks of three heights
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.beginPath();
      for (const i of idx) {
        const b = S.hHits[i];
        if (!b) continue;
        const x = X(S.hTime[i]);
        const y0 = g.y + 0.9 * lh;
        const hh = b & 1 ? 0.6 : b & 2 ? 0.42 : 0.25;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 - hh * lh);
      }
      ctx.stroke();
      line(S.hBass, 1, cols[1], true);
      line(S.hLevel, 2, cols[2]);
      line(S.hPunch, 3, cols[3]);
      line(S.hBright, 4, cols[4]);
      line(S.hWidth, 5, cols[5]);
      line(S.hTension, 7, cols[7]);
      // notes: dots
      ctx.fillStyle = ink;
      for (const i of idx) {
        const x = X(S.hTime[i]);
        for (let k = 0; k < 4; k++) {
          const nn = S.hNotes[i * 4 + k];
          if (nn < 0) continue;
          const y = g.y + 6 * lh + lh * (0.85 - clamp((nn - 36) / 60) * 0.7);
          ctx.fillRect(x - 1.4 * u, y - 1.4 * u, 2.8 * u, 2.8 * u);
        }
      }
      // playhead
      const px = X(now);
      ctx.fillStyle = accent;
      ctx.fillRect(px - u, g.y - head * 0.3, 2 * u, g.h + head * 0.3);
    },
  };
}

/* ───────── TRAJECTORY ───────── */
export function createTrajectory(): Module {
  return {
    draw(m) {
      const { ctx, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const WIN = 9;
      const n = Math.min(S.hCount, WIN * RATE);
      let changes = 0;
      let prevB = -2;
      for (let a = 0; a < n; a++) {
        const b = S.hBass[S.hist(a)];
        if (b >= 0 && Math.abs(b - prevB) > 0.01) changes++;
        prevB = b;
      }
      let inner = card(m, 'TRAJECTORY');
      inner = footer(m, inner, [
        ['WINDOW', `${WIN} s`],
        ['BASS', S.bassNote >= 0 ? noteName(S.bassNote) : '—'],
        ['BRIGHT', String(Math.round(S.bright * 100))],
        ['POINTS', String(changes)],
      ]);
      const stripH = 22 * u;
      const r: Rect = { x: inner.x + 60 * u, y: inner.y + 6 * u, w: inner.w - 70 * u, h: inner.h - stripH - 16 * u };
      const side = Math.min(r.w / 1.45, r.h / 1.25);
      const ox = r.x + (r.w - side * 1.4) / 2;
      const oy = r.y + r.h - (r.h - side * 1.2) / 2;
      // axes: X brightness → right, Y bass note → up, Z time → back (up-right)
      const P = (x: number, y: number, z: number): [number, number] => [ox + x * side + z * side * 0.4, oy - y * side - z * side * 0.24];
      const edges: [number, number, number, number, number, number][] = [];
      for (const y of [0, 1]) for (const z of [0, 1]) edges.push([0, y, z, 1, y, z]);
      for (const x of [0, 1]) for (const z of [0, 1]) edges.push([x, 0, z, x, 1, z]);
      for (const x of [0, 1]) for (const y of [0, 1]) edges.push([x, y, 0, x, y, 1]);
      ctx.strokeStyle = rgba(ink, 0.55);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      for (const [a, b, c, d, e, f2] of edges) {
        const [x1, y1] = P(a, b, c);
        const [x2, y2] = P(d, e, f2);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba(ink, 0.12);
      ctx.beginPath();
      for (let k = 1; k < 4; k++) {
        const [a1, b1] = P(k / 4, 0, 1);
        const [a2, b2] = P(k / 4, 1, 1);
        const [c1, d1] = P(0, k / 4, 1);
        const [c2, d2] = P(1, k / 4, 1);
        ctx.moveTo(a1, b1);
        ctx.lineTo(a2, b2);
        ctx.moveTo(c1, d1);
        ctx.lineTo(c2, d2);
      }
      ctx.stroke();
      // path (newest at the front face)
      const pts: [number, number, number][] = [];
      let lastB = 0.3;
      let sb = -1;
      let sx = -1;
      for (let a = n - 1; a >= 0; a--) {
        const i = S.hist(a);
        const b = S.hBass[i] >= 0 ? S.hBass[i] : lastB;
        lastB = b;
        sb = sb < 0 ? b : sb + (b - sb) * 0.18;
        sx = sx < 0 ? S.hBright[i] : sx + (S.hBright[i] - sx) * 0.18;
        pts.unshift([sx, sb, a / (WIN * RATE)]);
      }
      ctx.strokeStyle = rgba(ink, 0.12);
      ctx.beginPath();
      pts.forEach(([x, y, z], k) => {
        if (k % 6) return;
        const [a1, b1] = P(x, y, z);
        const [a2, b2] = P(x, 0, z);
        ctx.moveTo(a1, b1);
        ctx.lineTo(a2, b2);
      });
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.2, 2 * u);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y, z], k) => {
        const [a1, b1] = P(x, y, z);
        if (k) ctx.lineTo(a1, b1);
        else ctx.moveTo(a1, b1);
      });
      ctx.stroke();
      if (pts.length) {
        const [hx, hy] = P(pts[0][0], pts[0][1], 0);
        ctx.fillStyle = rgba(accent, 0.35);
        ctx.beginPath();
        ctx.arc(hx, hy, 8 * u, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(1, 1.4 * u);
        ctx.stroke();
      }
      const [lx, ly] = P(0, 0.55, 0);
      label(ctx, 'BASS NOTE', lx - 8 * u, ly, 9.5 * u, rgba(ink, 0.6), 'right', 500, 0.14);
      const [bx, by] = P(1, 0, 0.6);
      label(ctx, 'BRIGHTNESS', bx + 6 * u, by + 14 * u, 9.5 * u, rgba(ink, 0.6), 'left', 500, 0.14);
      // time strip
      const ty = inner.y + inner.h - stripH;
      const tx0 = P(0, 0, 0)[0];
      const tw = P(1, 0, 0)[0] - tx0 + side * 0.4;
      ctx.fillStyle = rgba(hueShift(accent, 60), 0.25);
      for (let a = 0; a < n; a += 2) {
        const v = S.hLevel[S.hist(a)];
        const x = tx0 + tw * (1 - a / (WIN * RATE));
        ctx.fillRect(x, ty + stripH * (1 - v) * 0.8, Math.max(1, tw / (WIN * RATE)), stripH * v * 0.8 + 2 * u);
      }
      label(ctx, 'TIME', tx0 + tw * 0.33, ty + stripH * 0.55, 9.5 * u, rgba(ink, 0.6), 'center', 500, 0.14);
      ctx.fillStyle = ink;
      ctx.fillRect(tx0 + tw * 0.55, ty - 2 * u, 2 * u, stripH + 4 * u);
    },
  };
}

/* ───────── STARS ───────── */
export function createStars(): Module {
  return {
    draw(m) {
      const { ctx, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const PAGE = 32; // beats = 8 bars
      const page = Math.floor(S.beat / PAGE);
      const pos = (S.beat - page * PAGE) / PAGE;
      const lit = S.hits.filter((h) => Math.floor(h.beat / PAGE) === page).length;
      let inner = card(m, 'STARS');
      inner = footer(m, inner, [
        ['STARS LIT', String(lit)],
        ['SKY', `bars ${page * 8 + 1}–${page * 8 + 8}`],
        ['TEMPO', `${Math.round(S.bpm)} BPM`],
      ]);
      const r: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - 16 * u };
      // horizon curve + playhead divider
      ctx.strokeStyle = rgba(ink, 0.3);
      ctx.setLineDash([3 * u, 5 * u]);
      ctx.lineWidth = Math.max(1, u);
      ctx.beginPath();
      for (let k = 0; k <= 40; k++) {
        const x = r.x + (k / 40) * r.w;
        const y = r.y + r.h * 0.56 - Math.sin((k / 40) * Math.PI) * r.h * 0.04;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = rgba(accent, 0.7);
      ctx.beginPath();
      ctx.moveTo(r.x + pos * r.w, r.y);
      ctx.lineTo(r.x + pos * r.w, r.y + r.h);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let b = 0; b < 8; b += 2) label(ctx, String(page * 8 + b + 1), r.x + (b / 8) * r.w, r.y + r.h + 13 * u, 9 * u, rgba(ink, 0.55), 'left', 500, 0);
      const yOf = (h: { kind: string; m: number; id: number }) => {
        const base = h.kind === 'kick' ? 0.82 : h.kind === 'snare' ? 0.62 : h.kind === 'hat' ? 0.18 : 1 - clamp((h.m - 36) / 60);
        return r.y + r.h * clamp(base + (hash01(h.id, 3) - 0.5) * 0.16, 0.04, 0.96);
      };
      for (const h of S.hits) {
        const hp = Math.floor(h.beat / PAGE);
        if (hp !== page && hp !== page - 1) continue;
        const bx = (h.beat - hp * PAGE) / PAGE;
        if (hp === page - 1 && bx <= pos) continue;
        const x = r.x + bx * r.w;
        const y = yOf(h);
        const cur = hp === page;
        const rad = (cur ? 2.2 + h.s * 3.5 : 1.8 + h.s * 2) * u;
        ctx.fillStyle = cur ? ink : rgba(ink, 0.28);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
        if (cur && S.beat - h.beat < 0.5) {
          ctx.strokeStyle = rgba(accent, 0.8);
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath();
          ctx.arc(x, y, rad + 6 * u, 0, TAU);
          ctx.stroke();
        }
      }
      if (S.bassNote >= 0) label(ctx, noteName(S.bassNote), r.x + pos * r.w + 8 * u, r.y + r.h * 0.9, 9 * u, rgba(ink, 0.7), 'left', 500, 0);
    },
  };
}

/* ───────── ARCADE ───────── */
export function createArcade(): Module {
  const lanes: { lane: number; z: number; m: number }[] = [];
  const parts: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink, accent, bg } = p.palette;
      const laneCol = (pc: number) => mixHex(hueShift(accent, LANE_HUES[pc]), bg, 0.15);
      let inner = card(m, 'ARCADE');
      inner = footer(m, inner, [
        ['SCORE', String(S.score)],
        ['COMBO', String(S.combo)],
        ['LANES', `Notes · ${new Set(S.topNotes(64).map((x) => x % 12)).size}`],
        ['PART', S.section],
      ]);
      for (const mm of S.onsets) {
        lanes.push({ lane: mm % 12, z: 0, m: mm });
        for (let k = 0; k < 8; k++) {
          const a = Math.random() * Math.PI;
          parts.push({ x: ((mm % 12) + 0.5) / 12, y: 0, vx: Math.cos(a) * 0.06, vy: Math.sin(a) * 0.2, life: 0.4 + Math.random() * 0.6 });
        }
      }
      while (lanes.length > 140) lanes.shift();
      while (parts.length > 300) parts.shift();
      for (let i = lanes.length - 1; i >= 0; i--) if ((lanes[i].z += p.dt * 0.3) > 1) lanes.splice(i, 1);
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.x += q.vx * p.dt;
        q.y += q.vy * p.dt;
        q.vy -= 0.3 * p.dt;
        if ((q.life -= p.dt) <= 0) parts.splice(i, 1);
      }
      const padsH = Math.min(inner.h * 0.3, 90 * u);
      const box: Rect = { x: inner.x, y: inner.y, w: inner.w, h: inner.h - padsH - 10 * u };
      ctx.strokeStyle = rgba(ink, 0.35);
      ctx.lineWidth = Math.max(1, u);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      const vpx = box.x + box.w / 2;
      const vpy = box.y + box.h * 0.1;
      const hitY = box.y + box.h * 0.82;
      const left = box.x + box.w * 0.07;
      const right = box.x + box.w * 0.93;
      const lw = (right - left) / 12;
      const persp = (z: number) => (1 - 1 / (1 + z * 4)) / 0.8;
      const at = (x: number, z: number): [number, number] => {
        const t = persp(z);
        return [x + (vpx - x) * t, hitY + (vpy - hitY) * t];
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.w, box.h);
      ctx.clip();
      for (let pc = 0; pc < 12; pc++) {
        const x0 = left + pc * lw;
        const [ax, ay] = at(x0, 1);
        const [bx] = at(x0 + lw, 1);
        ctx.fillStyle = rgba(laneCol(pc), 0.1 + f.chroma[pc] * 0.3);
        ctx.beginPath();
        ctx.moveTo(x0, hitY);
        ctx.lineTo(x0 + lw, hitY);
        ctx.lineTo(bx, ay);
        ctx.lineTo(ax, ay);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = rgba(ink, 0.25);
      ctx.beginPath();
      for (let i = 0; i <= 12; i++) {
        const [ex, ey] = at(left + i * lw, 1);
        ctx.moveTo(left + i * lw, hitY);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
      for (const n of lanes) {
        const x0 = left + n.lane * lw;
        const [ax, ay] = at(x0 + lw * 0.18, n.z);
        const [bx] = at(x0 + lw * 0.82, n.z);
        const s = 1 - persp(n.z) * 0.85;
        ctx.fillStyle = mixHex(laneCol(n.lane), ink, 0.15);
        ctx.fillRect(ax, ay - 3 * u * s, bx - ax, Math.max(1.5, 5 * u * s));
      }
      ctx.fillStyle = rgba(ink, 0.3);
      for (const q of parts) ctx.fillRect(left + q.x * (right - left), hitY - q.y * box.h, 2 * u, 2 * u);
      ctx.restore();
      const act = new Set(f.activeNotes.map((x) => x % 12));
      for (let pc = 0; pc < 12; pc++) {
        const x = left + (pc + 0.5) * lw;
        ctx.strokeStyle = act.has(pc) ? laneCol(pc) : rgba(ink, 0.45);
        ctx.lineWidth = Math.max(1, (act.has(pc) ? 2.6 : 1.1) * u);
        ctx.beginPath();
        ctx.arc(x, hitY, lw * 0.3, 0, TAU);
        ctx.stroke();
      }
      f.activeNotes.forEach((mm, k) => label(ctx, noteName(mm), left + ((mm % 12) + 0.5) * lw, hitY - lw * 0.5 - (k % 3) * 10 * u, 8.5 * u, ink, 'center', 600, 0));
      label(ctx, `SCORE ${String(S.score).padStart(7, '0')}`, box.x + 12 * u, box.y + 20 * u, 11.5 * u, ink, 'left', 700, 0.04);
      label(ctx, `${S.combo} COMBO ×${1 + Math.floor(S.combo / 10)}`, box.x + box.w - 12 * u, box.y + 20 * u, 10 * u, accent, 'right', 700, 0.04);
      label(ctx, 'TRACK', box.x + 12 * u, box.y + box.h - 8 * u, 8.5 * u, rgba(ink, 0.6), 'left', 600, 0.1);
      label(ctx, `${Math.round(S.bpm)} BPM`, box.x + box.w - 12 * u, box.y + box.h - 8 * u, 8.5 * u, rgba(ink, 0.6), 'right', 600, 0.1);
      // pads: 2 rows, most played notes
      const notes = S.topNotes(11).sort((a, b) => b - a);
      const defaults = [61, 63, 65, 68, 70, 46, 48, 49, 53, 56, 58];
      for (const d of defaults) if (notes.length < 11 && !notes.includes(d)) notes.push(d);
      const rows = [notes.slice(0, 5), notes.slice(5, 11)];
      const gap = 6 * u;
      const ph = (padsH - gap) / 2;
      rows.forEach((row, ri) => {
        const pw = (inner.w - gap * 5) / 6;
        row.forEach((mm, i) => {
          const x = inner.x + i * (pw + gap);
          const y = box.y + box.h + 10 * u + ri * (ph + gap);
          const on = f.activeNotes.includes(mm);
          const lvl = f.noteLevel[mm];
          ctx.fillStyle = on ? laneCol(mm % 12) : lvl > 0.15 ? rgba(laneCol(mm % 12), 0.3 + lvl * 0.4) : rgba(ink, 0.1);
          ctx.fillRect(x, y, pw, ph);
          ctx.strokeStyle = rgba(ink, 0.35);
          ctx.lineWidth = Math.max(1, u);
          ctx.strokeRect(x, y, pw, ph);
          label(ctx, noteName(mm), x + pw / 2, y + ph / 2 + 3.5 * u, 9.5 * u, on ? '#ffffff' : ink, 'center', 700, 0);
        });
      });
    },
  };
}
