import { useCallback, useEffect, useRef, useState } from 'react';

interface Version {
  sha: string;
  short: string;
  date: string;
  message: string;
}
interface Progress {
  state: 'running' | 'done' | 'error';
  step: string;
  log: string[];
  started: number;
  error: string | null;
  target: Version | null;
}
interface Status {
  served: 'vite' | 'updater';
  mode: string;
  local: Version | null;
  remote: Version | null;
  remoteError?: string | null;
  available: boolean;
  progress: Progress | null;
}

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STEPS: Record<string, string> = {
  start: 'START',
  stop: 'STOPPING SITE',
  check: 'CHECKING GITHUB',
  download: 'DOWNLOADING',
  extract: 'EXTRACTING',
  copy: 'COPYING FILES',
  install: 'NPM INSTALL',
  build: 'BUILDING',
  done: 'RESTARTING',
  error: 'ERROR',
};

/** Top-bar button: shows the installed version, checks GitHub, installs updates in one click. */
export function UpdateButton() {
  const [st, setSt] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prevStarted = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async (refresh = false): Promise<Status | null> => {
    if (!document.querySelector('meta[name="iris-updater"]')) return null;
    try {
      const r = await fetch(`/__update/status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!r.ok) return null;
      const j = (await r.json()) as Status;
      setSt(j);
      return j;
    } catch {
      return null;
    }
  }, []);

  // initial check + every 30 min
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  // close the panel on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!busy && wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open, busy]);

  // follow the update until the new version is served, then reload
  useEffect(() => {
    if (!busy) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const j = await load();
      const p = j?.progress;
      if (j && p && p.started > prevStarted.current) {
        if (p.state === 'error' && j.served === 'vite') {
          setBusy(false);
          setError(p.error ?? 'update failed');
          return;
        }
        if (p.state === 'done' && j.served === 'vite' && j.local?.sha === p.target?.sha) {
          setTimeout(() => window.location.reload(), 600);
          return;
        }
      }
      setTimeout(() => void tick(), 1000);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [busy, load]);

  if (!st) return null; // no updater endpoint (static hosting): hide the button

  const install = async () => {
    setError('');
    prevStarted.current = st.progress?.started ?? 0;
    try {
      const r = await fetch('/__update/run', { method: 'POST' });
      if (!r.ok && r.status !== 409) throw new Error(`HTTP ${r.status}`);
      setBusy(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const avail = st.available;
  const p = st.progress;
  const running = busy || st.served === 'updater';
  const log = p?.log?.slice(-9) ?? [];

  return (
    <div ref={wrap} className="relative flex items-stretch border-l border-ink">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load(true);
        }}
        className={`flex items-center gap-2 px-4 ${avail || running ? 'bg-accent text-bg' : 'hover:bg-ink hover:text-bg'}`}
        title="Check GitHub for a new version"
      >
        <span className={running ? 'inline-block animate-spin' : ''}>⟳</span>
        {running ? 'UPDATING…' : avail ? 'UPDATE AVAILABLE' : `V·${st.local?.short ?? 'DEV'}`}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-px w-[min(420px,95vw)] border border-ink bg-bg text-[10px] tracking-[0.14em] shadow-[6px_6px_0_0_var(--c-ink)]">
          <div className="flex h-7 items-center justify-between border-b border-ink px-3">
            <span>
              <span className="text-accent">UPD</span> / GITHUB · KRUIKRUIK/IRISPOOP
            </span>
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => !running && setOpen(false)}>
              ✕
            </button>
          </div>
          <div className="space-y-2 p-3">
            <div className="grid grid-cols-[86px_1fr] gap-x-2 gap-y-1">
              <span className="opacity-50">INSTALLED</span>
              <span className="truncate">
                {st.local ? `${st.local.short} · ${fmtDate(st.local.date)}` : 'UNKNOWN (V1)'}
                {st.local?.message && <span className="block truncate opacity-60 normal-case tracking-normal">{st.local.message}</span>}
              </span>
              <span className="opacity-50">LATEST</span>
              <span className="truncate">
                {st.remote ? `${st.remote.short} · ${fmtDate(st.remote.date)}` : st.remoteError ? 'GITHUB UNREACHABLE' : '…'}
                {st.remote?.message && <span className="block truncate opacity-60 normal-case tracking-normal">{st.remote.message}</span>}
              </span>
            </div>

            {running || (p && p.state === 'error') ? (
              <div className="border border-ink/40">
                <div className="flex justify-between border-b border-ink/30 px-2 py-1">
                  <span className={p?.state === 'error' ? 'text-[#FF2A2A]' : 'text-accent'}>{STEPS[p?.step ?? 'start'] ?? p?.step}</span>
                  <span className="opacity-60">{running ? 'DO NOT CLOSE THIS TAB' : ''}</span>
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap px-2 py-1 text-[9px] leading-snug tracking-normal opacity-80">{log.join('\n') || '…'}</pre>
              </div>
            ) : null}

            {error && <div className="text-[#FF2A2A]">ERROR // {error}</div>}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={running || !avail}
                onClick={() => void install()}
                className="h-8 flex-1 border border-accent bg-accent px-3 text-bg disabled:border-ink/30 disabled:bg-transparent disabled:text-ink disabled:opacity-40"
              >
                {running ? 'UPDATING…' : avail ? '↓ INSTALL UPDATE' : '✓ UP TO DATE'}
              </button>
              <button
                type="button"
                disabled={running}
                onClick={() => void load(true)}
                className="h-8 border border-ink px-3 hover:bg-ink hover:text-bg disabled:opacity-40"
              >
                CHECK
              </button>
            </div>
            {!running && avail && (
              <div className="opacity-50 normal-case tracking-normal">
                The site restarts by itself (≈1–2 min), then this page reloads.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
