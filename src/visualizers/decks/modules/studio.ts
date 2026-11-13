/* Deck 05 — AURA watercolor brush · SIGNALS icon matrix · METERS (waveform / scope / spectrum / vector) · SHEET */
import { LogBands, TAU, clamp, rgba, type Rect } from '../../draw';
import { getSheetImage } from '../../imageGrid';
import { SheetPainter, isProgressive, type SheetParams } from '../../SheetPaint';
import { card, isDark, label, mixHex, noImage, vnoise, vnoise2, type Module } from '../kit';

/* ───────── AURA: soft watercolor ring + smoky tendrils ───────── */
export function createAura(): Module {
  let c: HTMLCanvasElement | null = null;
  const parts: { x: number; y: number; vx: number; vy: number; life: number; w: number }[] = [];
  return {
    draw(m) {
      const { ctx, f, p } = m;
      const u = p.unit;
      const { bg, ink, accent } = p.palette;
      const inner = card(m, 'AURA');
      const sc = 0.5; // half-resolution buffer: the blur hides it and it is 4× cheaper
      const W = Math.max(1, Math.round(inner.w * sc));
      const H = Math.max(1, Math.round(inner.h * sc));
      const uu = u * sc;
      if (!c) c = document.createElement('canvas');
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const g = c.getContext('2d');
      if (!g) return;
      const paper = mixHex(bg, ink, isDark(bg) ? 0.05 : 0.035);
      // slow dissolve back to paper → long soft trails
      g.globalAlpha = 0.045;
      g.fillStyle = paper;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      const cx = W * 0.5 + (vnoise(p.time * 0.1, 1) - 0.5) * W * 0.05;
      const cy = H * 0.5;
      const R = Math.min(W, H) * 0.22 * (1 + f.bass * 0.3 + f.beat * 0.12);
      const pigment = mixHex(accent, ink, 0.1);
      // translucent rings
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = rgba(pigment, 0.05 + f.rms * 0.08);
        g.lineWidth = (3 + k * 1.4) * uu * (1 + f.subBass);
        g.beginPath();
        for (let a = 0; a <= 64; a++) {
          const ang = (a / 64) * TAU;
          const rr = R * (0.86 + k * 0.035 + (vnoise2(Math.cos(ang) * 2 + k, Math.sin(ang) * 2 + p.time * 0.4, k) - 0.5) * 0.18);
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          if (a) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R);
      grad.addColorStop(0, rgba(pigment, 0.035 + f.mid * 0.04));
      grad.addColorStop(1, rgba(pigment, 0));
      g.fillStyle = grad;
      g.fillRect(cx - R, cy - R, R * 2, R * 2);
      // tendrils
      const spawn = Math.floor(1 + f.rms * 14 + f.beat * 22);
      for (let i = 0; i < spawn; i++) {
        const a = Math.random() * TAU;
        parts.push({ x: cx + Math.cos(a) * R * 0.9, y: cy + Math.sin(a) * R * 0.9, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, life: 1 + Math.random() * 1.5, w: (1 + Math.random() * 3) * uu });
      }
      while (parts.length > 500) parts.shift();
      g.lineCap = 'round';
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        const ang = vnoise2(q.x * 0.006, q.y * 0.006 + p.time * 0.2, 7) * TAU * 2;
        q.vx += Math.cos(ang) * 60 * p.dt * (1 + f.treble);
        q.vy += Math.sin(ang) * 60 * p.dt * (1 + f.treble);
        q.vx *= 0.97;
        q.vy *= 0.97;
        const nx = q.x + q.vx * p.dt * uu * 1.5;
        const ny = q.y + q.vy * p.dt * uu * 1.5;
        g.strokeStyle = rgba(pigment, 0.1 * clamp(q.life));
        g.lineWidth = q.w;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(nx, ny);
        g.stroke();
        q.x = nx;
        q.y = ny;
        if ((q.life -= p.dt) <= 0) parts.splice(i, 1);
      }
      // one soft blur when compositing gives the wet, feathered watercolor edge
      ctx.save();
      ctx.filter = `blur(${Math.max(0.8, 1.6 * u)}px)`;
      ctx.drawImage(c, inner.x, inner.y, inner.w, inner.h);
      ctx.restore();
    },
  };
}

/* ───────── SIGNALS: 15 parameters with geometric indicators ───────── */
export function createSignals(): Module {
  const bands = new LogBands();
  return {
    draw(m) {
      const { ctx, f, p, S } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const inner = card(m, 'SIGNALS');
      const sp = bands.compute(f.spectrum, f.binHz, 4, 2000, 16000, 'avg');
      const pitch = f.activeNotes.length ? clamp((f.activeNotes[0] - 36) / 60) : 0;
      const items: [string, number, string][] = [
        ['SUB', f.subBass, 'arc'],
        ['KICK', f.beat, 'tri'],
        ['BASS', f.bass, 'glow'],
        ['LOW MIDS', f.lowMid, 'disc'],
        ['MIDS', f.mid, 'dot'],
        ['HIGH MIDS', sp[0] * 1.4, 'ring-s'],
        ['PRESENCE', sp[1] * 1.6, 'bar'],
        ['AIR', sp[3] * 2, 'ring'],
        ['SNARE', f.snare, 'glow-big'],
        ['HATS', f.hat, 'glow'],
        ['WIDTH', f.width, 'dashed'],
        ['LOUDNESS', clamp(f.rms * 2), 'glow'],
        ['PITCH', pitch, 'glow'],
        ['DENSITY', clamp(f.activeNotes.length / 4), 'bar'],
        ['BRIGHTNESS', S.bright, 'glow'],
      ];
      const cols = 5;
      const rows = 3;
      const cw = inner.w / cols;
      const ch = inner.h / rows;
      items.forEach(([name, raw, kind], i) => {
        const v = clamp(raw);
        const cx = inner.x + (i % cols + 0.5) * cw;
        const cy = inner.y + (Math.floor(i / cols) + 0.4) * ch;
        const s = Math.min(cw, ch) * 0.3;
        if (v > 0.05) {
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * (1.2 + v));
          gr.addColorStop(0, rgba(accent, v * 0.5));
          gr.addColorStop(1, rgba(accent, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(cx - s * 2.2, cy - s * 2.2, s * 4.4, s * 4.4);
        }
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = Math.max(1, 2.6 * u);
        ctx.beginPath();
        switch (kind) {
          case 'arc':
            ctx.arc(cx, cy + s * 0.3, s * 0.6, Math.PI + (1 - v) * 0.9, -((1 - v) * 0.9));
            ctx.stroke();
            break;
          case 'tri': {
            const hh = s * (0.5 + v);
            const gr = ctx.createLinearGradient(0, cy - hh / 2, 0, cy + hh / 2);
            gr.addColorStop(0, ink);
            gr.addColorStop(1, accent);
            ctx.fillStyle = gr;
            ctx.moveTo(cx, cy - hh / 2);
            ctx.lineTo(cx + s * 0.28, cy + hh / 2);
            ctx.lineTo(cx - s * 0.28, cy + hh / 2);
            ctx.fill();
            break;
          }
          case 'disc':
            ctx.arc(cx, cy, s * (0.2 + v * 0.3), 0, TAU);
            ctx.fill();
            break;
          case 'dot':
            ctx.fillStyle = accent;
            ctx.arc(cx, cy, s * 0.1, 0, TAU);
            ctx.fill();
            break;
          case 'ring-s':
            ctx.arc(cx, cy + s * 0.3, s * 0.16, 0, TAU);
            ctx.stroke();
            break;
          case 'bar':
            ctx.fillRect(cx - 1.6 * u, cy - s * (0.15 + v * 0.45), 3.2 * u, s * (0.3 + v * 0.9));
            break;
          case 'ring':
            ctx.arc(cx, cy, s * (0.25 + v * 0.25), 0, TAU);
            ctx.stroke();
            break;
          case 'dashed':
            ctx.setLineDash([2 * u, 3 * u]);
            ctx.lineWidth = Math.max(1, 1.4 * u);
            ctx.arc(cx, cy, s * (0.25 + v * 0.3), 0, TAU);
            ctx.stroke();
            ctx.setLineDash([]);
            break;
          case 'glow-big':
            ctx.fillStyle = rgba(accent, 0.25 + v * 0.5);
            ctx.arc(cx, cy, s * (0.25 + v * 0.35), 0, TAU);
            ctx.fill();
            break;
          default:
            break;
        }
        label(ctx, name, cx, cy + s * 1.25, 8.5 * u, v > 0.55 ? ink : rgba(ink, 0.45), 'center', v > 0.55 ? 700 : 500, 0.1);
      });
    },
  };
}

/* ───────── METERS: waveform/loudness + scope / spectrum / vector ───────── */
export function createMeters(): Module {
  const bands = new LogBands();
  const peaks = new Float32Array(12);
  const hist = new Float32Array(160);
  let hp = 0;
  let acc = 0;
  return {
    draw(m) {
      const { ctx, f, p } = m;
      const u = p.unit;
      const { ink, accent } = p.palette;
      const inner = card(m, 'METERS');
      const lw = Math.max(1, u);
      acc += p.dt;
      while (acc > 1 / 20) {
        acc -= 1 / 20;
        hist[hp] = f.rms;
        hp = (hp + 1) % hist.length;
      }
      const stripH = inner.h * 0.36;
      const strip: Rect = { x: inner.x, y: inner.y, w: inner.w, h: stripH };
      ctx.strokeStyle = rgba(ink, 0.45);
      ctx.lineWidth = lw;
      ctx.strokeRect(strip.x, strip.y, strip.w, strip.h);
      label(ctx, 'WAVEFORM', strip.x + 8 * u, strip.y + 15 * u, 9.5 * u, rgba(ink, 0.7), 'left', 500, 0.12);
      label(ctx, 'LOUDNESS S', strip.x + strip.w * 0.38, strip.y + 15 * u, 9.5 * u, accent, 'left', 500, 0.12);
      const hasSong = !!f.overview && Number.isFinite(f.duration) && f.duration > 0;
      const prog = hasSong ? clamp(f.time / f.duration) : 1;
      const bars = Math.floor(strip.w / (4 * u));
      const mid = strip.y + strip.h * 0.62;
      for (let i = 0; i < bars; i++) {
        const t = i / bars;
        const v = hasSong && f.overview ? f.overview[Math.floor(t * f.overview.length)] : hist[(hp + Math.floor(t * hist.length)) % hist.length] * 1.5;
        const hh = Math.max(u, clamp(v) * strip.h * 0.28);
        ctx.fillStyle = t <= prog ? ink : rgba(ink, 0.3);
        ctx.fillRect(strip.x + 2 * u + i * (strip.w - 4 * u) / bars, mid - hh, Math.max(1, 2 * u), hh * 2);
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const x = strip.x + (i / (hist.length - 1)) * strip.w * prog;
        const y = mid - clamp(hist[(hp + i) % hist.length] * 1.4) * strip.h * 0.3;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(strip.x + prog * strip.w - u, strip.y, 1.5 * u, strip.h);
      // three small panels
      const gap = 10 * u;
      const pw = (inner.w - gap * 2) / 3;
      const py = strip.y + strip.h + gap;
      const ph = inner.h - stripH - gap;
      const wf = f.waveform;
      ['SCOPE', 'SPECTRUM', 'VECTOR'].forEach((name, k) => {
        const r: Rect = { x: inner.x + k * (pw + gap), y: py, w: pw, h: ph };
        ctx.strokeStyle = rgba(ink, 0.45);
        ctx.lineWidth = lw;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        label(ctx, name, r.x + 6 * u, r.y + 14 * u, 9 * u, rgba(ink, 0.7), 'left', 500, 0.12);
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.w, r.h);
        ctx.clip();
        if (k === 0) {
          let sq = 0;
          for (let i = 0; i < 512; i++) sq += wf[i] * wf[i];
          const gn = 0.3 / Math.max(0.02, Math.sqrt(sq / 512));
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(1, 1.3 * u);
          ctx.beginPath();
          for (let i = 0; i < 300; i += 2) {
            const x = r.x + (i / 300) * r.w;
            const y = r.y + r.h * 0.58 - Math.tanh(wf[i] * gn) * r.h * 0.35;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          }
          ctx.stroke();
        } else if (k === 1) {
          const v = bands.compute(f.spectrum, f.binHz, 12, 50, 9000, 'max');
          const bw = (r.w - 10 * u) / 12;
          for (let i = 0; i < 12; i++) {
            peaks[i] = Math.max(v[i], peaks[i] - p.dt * 0.35);
            const hh = Math.max(2 * u, v[i] * r.h * 0.6);
            ctx.fillStyle = ink;
            ctx.fillRect(r.x + 5 * u + i * bw, r.y + r.h - 3 * u - hh, bw * 0.7, hh);
            ctx.fillStyle = accent;
            ctx.fillRect(r.x + 5 * u + i * bw, r.y + r.h - 3 * u - peaks[i] * r.h * 0.6 - 6 * u, bw * 0.7, 2 * u);
          }
        } else {
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h * 0.58;
          const rad = Math.min(r.w, r.h) * 0.3;
          ctx.strokeStyle = rgba(ink, 0.45);
          ctx.beginPath();
          ctx.arc(cx, cy, rad, 0, TAU);
          ctx.moveTo(cx - rad, cy - rad);
          ctx.lineTo(cx + rad, cy + rad);
          ctx.moveTo(cx + rad, cy - rad);
          ctx.lineTo(cx - rad, cy + rad);
          ctx.stroke();
          let sq = 0;
          for (let i = 0; i < 600; i++) sq += wf[i] * wf[i];
          const gn = 0.4 / Math.max(0.02, Math.sqrt(sq / 600));
          ctx.fillStyle = ink;
          for (let i = 0; i < 600; i += 3) {
            const a = Math.tanh(wf[i] * gn);
            const b = Math.tanh(wf[i + 16] * gn);
            ctx.fillRect(cx + ((a - b) / Math.SQRT2) * rad * 0.7, cy - ((a + b) / Math.SQRT2) * rad * 0.7, 1.6 * u, 1.6 * u);
          }
        }
        ctx.restore();
      });
    },
  };
}

/* ───────── SHEET: progressive painting of the uploaded picture ───────── */
export function createSheetCard(): Module {
  const painter = new SheetPainter();
  return {
    draw(m) {
      const { ctx, f, p } = m;
      const inner = card(m, 'SHEET');
      const img = getSheetImage();
      if (!img) return noImage(m, inner);
      painter.setImage(img);
      const base: SheetParams = p.sheet ?? { style: 'impasto', threshold: 0.5, invert: false, distortion: 0.55, redraw: 0 };
      const sp: SheetParams = isProgressive(base.style) || base.style === 'brush' ? base : { ...base, style: 'impasto' };
      ctx.save();
      ctx.beginPath();
      ctx.rect(inner.x, inner.y, inner.w, inner.h);
      ctx.clip();
      ctx.translate(inner.x, inner.y);
      painter.draw(ctx, inner.w, inner.h, f, p, sp, { bare: true });
      ctx.restore();
    },
  };
}
