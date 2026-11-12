import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { engine } from '../audio/AudioEngine';
import { fmtTime } from './ui';
import { useEngine } from './useEngine';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
}

/** Interactive waveform / progress bar with drag-to-seek. */
function Scrubber() {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = cvs.current;
      const el = wrap.current;
      if (!c || !el) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(el.clientWidth * dpr);
      const H = Math.round(el.clientHeight * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const g = c.getContext('2d');
      if (!g) return;
      const ink = cssVar('--c-ink');
      const accent = cssVar('--c-accent');
      g.clearRect(0, 0, W, H);
      const mid = H / 2;
      const src = engine.source;
      const dur = engine.duration;
      const prog = src === 'file' && dur > 0 ? engine.currentTime / dur : 0;
      g.font = `${10 * dpr}px "JetBrains Mono", monospace`;
      g.textBaseline = 'top';

      if (src === 'file' && engine.overview) {
        const ov = engine.overview;
        const bars = Math.floor(W / (3 * dpr));
        const bw = W / bars;
        for (let i = 0; i < bars; i++) {
          const v = ov[Math.floor((i / bars) * ov.length)];
          const hh = Math.max(dpr, v * (H * 0.42));
          g.fillStyle = i / bars < prog ? accent : ink;
          g.globalAlpha = i / bars < prog ? 1 : 0.35;
          g.fillRect(i * bw, mid - hh, Math.max(1, bw - dpr), hh * 2);
        }
        g.globalAlpha = 1;
      } else if (src === 'test') {
        const wf = engine.features.waveform;
        g.strokeStyle = accent;
        g.lineWidth = dpr;
        g.beginPath();
        for (let x = 0; x < W; x += dpr) {
          const v = wf[Math.floor((x / W) * wf.length)];
          const y = mid - v * H * 0.4;
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.fillStyle = ink;
        g.globalAlpha = 0.6;
        g.fillText('LIVE // TEST SIGNAL — NO TIMELINE', 6 * dpr, 4 * dpr);
        g.globalAlpha = 1;
      } else {
        g.strokeStyle = ink;
        g.globalAlpha = 0.35;
        g.setLineDash([4 * dpr, 4 * dpr]);
        g.beginPath();
        g.moveTo(0, mid);
        g.lineTo(W, mid);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = ink;
        g.fillText(src === 'file' ? 'DECODING WAVEFORM…' : 'NO_MEDIA', 6 * dpr, 4 * dpr);
        g.globalAlpha = 1;
      }

      if (src === 'file' && dur > 0) {
        const x = prog * W;
        g.fillStyle = accent;
        g.fillRect(Math.round(x - dpr), 0, 2 * dpr, H);
        g.beginPath();
        g.moveTo(x - 5 * dpr, 0);
        g.lineTo(x + 5 * dpr, 0);
        g.lineTo(x, 6 * dpr);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seekAt = (clientX: number) => {
    const el = wrap.current;
    if (!el || engine.source !== 'file' || !engine.duration) return;
    const r = el.getBoundingClientRect();
    engine.seek(((clientX - r.left) / r.width) * engine.duration);
  };

  return (
    <div
      ref={wrap}
      className="relative h-full min-h-10 w-full cursor-pointer touch-none"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && seekAt(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <canvas ref={cvs} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function PeakLeds({ peak }: { peak: number }) {
  const n = 14;
  const lit = Math.round(Math.min(1, peak) * n);
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-1.5 ${i < lit ? (i >= n - 3 ? 'bg-accent' : 'bg-ink') : 'bg-ink/10'}`}
        />
      ))}
    </div>
  );
}

export function Transport({
  onExport,
  onRecord,
  recording,
  recFormat,
}: {
  onExport: () => void;
  onRecord: () => void;
  recording: boolean;
  recFormat: string;
}) {
  const st = useEngine(100);
  const [vol, setVol] = useState(engine.getVolume());
  const hasSrc = st.source !== 'none';

  return (
    <footer className="flex min-h-16 flex-wrap items-stretch border-t border-ink text-[10px] tracking-[0.16em]">
      <button
        type="button"
        disabled={!hasSrc}
        onClick={() => engine.toggle()}
        className="grid w-16 place-items-center border-r border-ink hover:bg-ink hover:text-bg disabled:opacity-30"
        title="Play / Pause (Space)"
      >
        {st.playing ? (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <rect x="3" y="2" width="4" height="14" />
            <rect x="11" y="2" width="4" height="14" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
            <path d="M4 2 L16 9 L4 16 Z" />
          </svg>
        )}
      </button>

      <div className="relative min-w-[200px] flex-1 border-r border-ink px-2 py-2">
        <Scrubber />
      </div>

      <div className="flex w-36 flex-col justify-center border-r border-ink px-3">
        <span className="opacity-50">TIME</span>
        <span className="text-[13px] tabular-nums tracking-normal">
          {fmtTime(st.time)} <span className="opacity-40">/</span> {st.source === 'test' ? 'LIVE' : fmtTime(st.duration)}
        </span>
      </div>

      <label className="flex w-40 flex-col justify-center gap-1 border-r border-ink px-3">
        <span className="flex justify-between">
          <span className="opacity-50">VOL</span>
          <span className="text-accent tabular-nums">{Math.round(vol * 100)}</span>
        </span>
        <input
          type="range"
          className="hw-range w-full"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          style={{ '--pct': `${vol * 100}%` } as CSSProperties}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVol(v);
            engine.setVolume(v);
          }}
        />
      </label>

      <div className="flex w-44 flex-col justify-center gap-1 border-r border-ink px-3">
        <span className="flex justify-between">
          <span className="opacity-50">BPM_EST</span>
          <span className="text-[12px] tabular-nums tracking-normal">{st.bpm ? st.bpm.toFixed(1) : '---.-'}</span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <PeakLeds peak={st.peak} />
          <span className={`tabular-nums ${st.peakDb > -3 ? 'text-accent' : ''}`}>{st.peakDb <= -95 ? '-INF' : st.peakDb.toFixed(1)}</span>
        </span>
      </div>

      <button type="button" onClick={onExport} className="w-32 border-r border-ink px-3 hover:bg-ink hover:text-bg">
        ⬒ EXPORT PNG
      </button>
      <button
        type="button"
        onClick={onRecord}
        className={`flex w-40 flex-col items-center justify-center px-3 ${recording ? 'bg-[#FF2A2A] text-white' : 'hover:bg-ink hover:text-bg'}`}
      >
        <span>{recording ? '■ STOP REC' : '● RECORD VIDEO'}</span>
        <span className="text-[8px] opacity-60">REC_60FPS · {recFormat}</span>
      </button>
    </footer>
  );
}
