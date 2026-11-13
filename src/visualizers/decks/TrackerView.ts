/*
 * Beat target tracker: shows the image with technical corner brackets ([KICK] [SNARE] [HAT] + 2 free
 * targets) that lock onto high-contrast points and snap to a new point on each drum hit.
 */
import type { AudioFeatures } from '../../audio/AudioEngine';
import type { RenderParams } from '../types';
import { FONT, hash01, type Rect } from '../draw';
import { gridFor } from '../imageGrid';
import { drawCover } from './kit';

interface Target {
  name: string;
  i: number;
  x: number;
  y: number;
  snap: number;
}

export class TrackerView {
  private img: HTMLCanvasElement | null = null;
  private cands: { x: number; y: number }[] = [];
  private targets: Target[] = ['KICK', 'SNARE', 'HAT', '', ''].map((name, k) => ({ name, i: k * 3, x: 0.5, y: 0.5, snap: 0 }));
  private lastBeat = -1;
  private hits = 0;

  get count(): number {
    return this.targets.length;
  }

  private analyse(img: HTMLCanvasElement): void {
    const g = gridFor(img, 64);
    this.cands = [];
    if (!g) return;
    const score = (i: number) => g.edge[i] * (0.6 + Math.abs(g.lum[i] - 0.5));
    const pts: { x: number; y: number; s: number }[] = [];
    for (let y = 2; y < g.rows - 2; y++) {
      for (let x = 2; x < g.cols - 2; x++) {
        const i = y * g.cols + x;
        const s = score(i);
        if (s < 0.12) continue;
        let isMax = true;
        for (let dy = -3; dy <= 3 && isMax; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= g.rows || xx < 0 || xx >= g.cols || (dx === 0 && dy === 0)) continue;
            if (score(yy * g.cols + xx) > s) {
              isMax = false;
              break;
            }
          }
        }
        if (isMax) pts.push({ x: (x + 0.5) / g.cols, y: (y + 0.5) / g.rows, s });
      }
    }
    pts.sort((a, b) => b.s - a.s);
    this.cands = pts.slice(0, 18).map(({ x, y }) => ({ x, y }));
    while (this.cands.length < 6) this.cands.push({ x: 0.2 + hash01(this.cands.length, 1) * 0.6, y: 0.2 + hash01(this.cands.length, 2) * 0.6 });
    this.targets.forEach((t, k) => {
      t.i = (k * 3) % this.cands.length;
      t.x = this.cands[t.i].x;
      t.y = this.cands[t.i].y;
    });
  }

  draw(ctx: CanvasRenderingContext2D, r: Rect, img: HTMLCanvasElement, f: AudioFeatures, p: RenderParams, info: { key: string; fit: 'cover' | 'contain' }): Rect {
    if (img !== this.img) {
      this.img = img;
      this.analyse(img);
    }
    const u = p.unit;
    let area = r;
    if (info.fit === 'cover') drawCover(ctx, img, r);
    else {
      const a = img.width / img.height;
      let w = r.w;
      let h = w / a;
      if (h > r.h) {
        h = r.h;
        w = h * a;
      }
      area = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
      ctx.drawImage(img, area.x, area.y, area.w, area.h);
    }
    // cover mapping: candidate coordinates are in image space → map through the crop
    const map = (nx: number, ny: number): [number, number] => {
      if (info.fit === 'contain') return [area.x + nx * area.w, area.y + ny * area.h];
      const ia = img.width / img.height;
      const ra = r.w / r.h;
      let sx = 1;
      let sy = 1;
      if (ia > ra) sx = ra / ia;
      else sy = ia / ra;
      return [r.x + ((nx - (1 - sx) / 2) / sx) * r.w, r.y + ((ny - (1 - sy) / 2) / sy) * r.h];
    };

    const n = this.cands.length;
    const jump = (t: Target) => {
      this.hits++;
      t.i = (t.i + 1 + Math.floor(hash01(this.hits, 5) * (n - 1))) % n;
      t.snap = 1;
    };
    if (f.kick) jump(this.targets[0]);
    if (f.snareHit) jump(this.targets[1]);
    if (f.hatHit && hash01(this.hits, 7) < 0.5) jump(this.targets[2]);
    if (f.beatCount !== this.lastBeat) {
      if (this.lastBeat >= 0 && f.beatCount % 2 === 0) jump(this.targets[3 + (f.beatCount / 2) % 2]);
      this.lastBeat = f.beatCount;
    }
    const k = 1 - Math.exp(-p.dt * 12);
    for (const t of this.targets) {
      const c = this.cands[t.i] ?? { x: 0.5, y: 0.5 };
      t.x += (c.x - t.x) * k;
      t.y += (c.y - t.y) * k;
      t.snap *= Math.exp(-p.dt * 6);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    const pts = this.targets.map((t) => map(t.x, t.y));
    // connectors
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2 + (y2 - y1) * 0.25, (y1 + y2) / 2 - (x2 - x1) * 0.25, x2, y2);
    }
    ctx.stroke();

    const fs = 10.5 * u;
    const tag = (s: string, x: number, y: number, align: 'left' | 'right' = 'left') => {
      ctx.font = `600 ${fs}px ${FONT}`;
      const tw = ctx.measureText(s).width;
      const bx = align === 'left' ? x : x - tw - 8 * u;
      ctx.fillStyle = 'rgba(10,10,10,0.82)';
      ctx.fillRect(bx, y - fs - 3 * u, tw + 8 * u, fs + 7 * u);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s, bx + 4 * u, y);
    };
    const vals = [f.bass, f.mid * 0.6 + f.snare * 0.4, f.treble];
    this.targets.forEach((t, i) => {
      const [x, y] = pts[i];
      const s = (i < 3 ? 34 : 22) * u * (1 + t.snap * 0.7) * (1 + (i === 0 ? f.beat * 0.25 : 0));
      const L = s * 0.32;
      const corners: [number, number, number, number][] = [
        [x - s / 2, y - s / 2, 1, 1],
        [x + s / 2, y - s / 2, -1, 1],
        [x - s / 2, y + s / 2, 1, -1],
        [x + s / 2, y + s / 2, -1, -1],
      ];
      for (const [col, w] of [['rgba(0,0,0,0.55)', 3.2], ['#ffffff', 1.6]] as const) {
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1, w * u);
        ctx.beginPath();
        for (const [cx, cy, sx, sy] of corners) {
          ctx.moveTo(cx + sx * L, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + sy * L);
        }
        ctx.stroke();
      }
      ctx.fillStyle = i < 3 ? p.palette.accent : '#111111';
      ctx.beginPath();
      ctx.arc(x, y, 3 * u, 0, Math.PI * 2);
      ctx.fill();
      if (t.name) tag(`[${t.name}] ${vals[i].toFixed(2)}`, x + s / 2 + 4 * u, y - s / 2 + fs);
    });
    // info stack
    const ix = r.x + r.w - 6 * u;
    let iy = r.y + 18 * u;
    for (const s of ['[Mode] Picture', `[Tempo] ${f.bpm ? f.bpm.toFixed(2) : '---'} BPM`, `[Key] ${info.key}`]) {
      tag(s, ix, iy, 'right');
      iy += fs + 10 * u;
    }
    ctx.restore();
    return area;
  }
}
