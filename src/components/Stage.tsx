import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { engine } from '../audio/AudioEngine';
import { DECKS, VIS_BY_ID, type RenderParams, type VisualizerId, type VisualizerInstance } from '../visualizers';
import type { SheetPainter, SheetParams } from '../visualizers/SheetPaint';
import { ASPECTS, type Aspect, type Palette } from '../utils/themes';
import type { Mode } from './ControlPanel';
import { fmtTime } from './ui';
import { useEngine } from './useEngine';

export interface RenderState {
  mode: Mode;
  viz: VisualizerId;
  deck: number;
  palette: Palette;
  stroke: number;
  detail: number;
  sensitivity: number;
  smoothing: number;
  sheet: SheetParams;
}

/** Minimum long-side resolution of the backing store, so PNG/video exports stay crisp. */
const MIN_LONG_SIDE = 1920;

function RecBadge({ since }: { since: number }) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 bg-[#FF2A2A] px-2 py-1 text-[11px] font-bold tracking-[0.2em] text-white">
      <span className="h-2 w-2 animate-pulse bg-white" />
      REC {fmtTime((now - since) / 1000)}
    </div>
  );
}

export function Stage({
  aspect,
  canvasRef,
  stateRef,
  painter,
  recording,
  recStart,
  label,
  status,
  deck,
  onDeck,
  showDecks,
}: {
  aspect: Aspect;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  stateRef: RefObject<RenderState>;
  painter: SheetPainter;
  recording: boolean;
  recStart: number;
  label: string;
  status: string;
  deck: number;
  onDeck: (d: number) => void;
  showDecks: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [res, setRes] = useState({ w: 0, h: 0 });
  const st = useEngine(300);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const [aw, ah] = ASPECTS[aspect];
  const ratio = aw / ah;
  let cw = box.w;
  let ch = cw / ratio;
  if (ch > box.h) {
    ch = box.h;
    cw = ch * ratio;
  }
  cw = Math.max(0, Math.floor(cw));
  ch = Math.max(0, Math.floor(ch));

  // backing store: devicePixelRatio scaled, but never below MIN_LONG_SIDE on the long side
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !cw || !ch) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(3, Math.max(dpr, MIN_LONG_SIDE / Math.max(cw, ch)));
    const W = Math.round(cw * scale);
    const H = Math.round(ch * scale);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    setRes({ w: W, h: H });
  }, [cw, ch, canvasRef]);

  // render loop
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    let frames = 0;
    let frameNo = 0;
    let fpsT = t0;
    const instances = new Map<VisualizerId, VisualizerInstance>();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      frames++;
      if (now - fpsT > 500) {
        if (fpsRef.current) fpsRef.current.textContent = String(Math.round((frames * 1000) / (now - fpsT))).padStart(2, '0');
        frames = 0;
        fpsT = now;
      }
      const s = stateRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      engine.sensitivity = s.sensitivity;
      engine.smoothing = s.smoothing;
      const f = engine.update(dt);
      const w = canvas.width;
      const h = canvas.height;
      if (!w || !h) return;
      const p: RenderParams = {
        palette: s.palette,
        stroke: s.stroke,
        detail: s.detail,
        time: (now - t0) / 1000,
        dt,
        unit: Math.min(w, h) / 1000,
        frame: ++frameNo,
        deck: s.deck,
        sheet: s.sheet,
      };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.fillStyle = s.palette.bg;
      ctx.fillRect(0, 0, w, h);
      if (s.mode === 'visualizer') {
        let inst = instances.get(s.viz);
        if (!inst) {
          inst = VIS_BY_ID[s.viz].create();
          instances.set(s.viz, inst);
        }
        inst.draw(ctx, w, h, f, p);
      } else {
        painter.draw(ctx, w, h, f, p, s.sheet);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, stateRef, painter]);

  return (
    <div className="relative flex min-h-[55vh] min-w-0 flex-1 flex-col p-6 pb-7 pt-7 lg:min-h-0">
      {/* technical labels around the frame */}
      <div className="pointer-events-none absolute left-6 right-6 top-2 flex justify-between text-[9px] tracking-[0.2em] opacity-60">
        <span>
          OUT_{res.w}×{res.h} · {aspect}
        </span>
        <span>{label}</span>
      </div>
      {showDecks && (
        <div className="absolute left-1/2 top-[3px] z-20 flex -translate-x-1/2 border border-ink bg-bg text-[9px] tracking-[0.16em]">
          {DECKS.map((d) => (
            <button
              type="button"
              key={d.id}
              title={d.name}
              onClick={() => onDeck(d.id)}
              className={`px-2 py-[1px] ${d.id > 1 ? 'border-l border-ink' : ''} ${deck === d.id ? 'bg-ink text-bg' : 'hover:bg-ink/10'}`}
            >
              DECK {String(d.id).padStart(2, '0')}
            </button>
          ))}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-6 right-6 flex justify-between text-[9px] tracking-[0.2em] opacity-60">
        <span className={status ? 'text-accent opacity-100' : ''}>{status || 'REC_60FPS · CANVAS_2D · WEB_AUDIO'}</span>
        <span>
          FPS <span ref={fpsRef}>--</span>
        </span>
      </div>

      <div ref={areaRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative border border-ink" style={{ width: cw, height: ch }}>
          <canvas ref={canvasRef} className="block h-full w-full" />
          {/* frame ticks */}
          <span className="absolute -left-[5px] -top-[5px] h-[9px] w-[9px] border border-ink bg-bg" />
          <span className="absolute -right-[5px] -top-[5px] h-[9px] w-[9px] border border-ink bg-bg" />
          <span className="absolute -bottom-[5px] -left-[5px] h-[9px] w-[9px] border border-ink bg-bg" />
          <span className="absolute -bottom-[5px] -right-[5px] h-[9px] w-[9px] border border-ink bg-bg" />
          {recording && <RecBadge since={recStart} />}
          {st.source === 'none' && !recording && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="border border-ink bg-bg px-3 py-2 text-[10px] tracking-[0.2em]">
                NO_SIGNAL — <span className="text-accent">LOAD AUDIO</span> · DROP A FILE · OR PRESS <span className="text-accent">TEST SIGNAL</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
