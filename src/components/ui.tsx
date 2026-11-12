import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { normalizeHex } from '../utils/themes';

export function Section({ index, title, right, children }: { index: string; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-ink">
      <header className="flex h-7 items-center justify-between border-b border-ink/25 px-3 text-[10px] tracking-[0.2em]">
        <span>
          <span className="text-accent">{index}</span>
          <span className="opacity-40"> / </span>
          {title}
        </span>
        {right}
      </header>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

type BtnVariant = 'default' | 'accent' | 'rec';

export function Btn({
  children,
  onClick,
  active = false,
  disabled = false,
  title,
  className = '',
  variant = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  variant?: BtnVariant;
}) {
  const base =
    'inline-flex h-8 select-none items-center justify-center gap-2 border px-3 text-[11px] uppercase tracking-[0.14em] transition-colors duration-75 disabled:pointer-events-none disabled:opacity-30';
  const look =
    variant === 'rec'
      ? 'border-[#FF2A2A] bg-[#FF2A2A] text-white hover:brightness-110'
      : variant === 'accent'
        ? active
          ? 'border-accent bg-accent text-bg'
          : 'border-accent text-accent hover:bg-accent hover:text-bg'
        : active
          ? 'border-ink bg-ink text-bg'
          : 'border-ink hover:bg-ink hover:text-bg';
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={`${base} ${look} ${className}`}>
      {children}
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
  format = (v) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[10px] tracking-[0.18em]">
        <span>{label}</span>
        <span className="text-accent tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        className="hw-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between border border-ink/40 px-2 py-1.5 text-[10px] tracking-[0.18em] hover:border-ink"
    >
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <span className={value ? 'text-accent' : 'opacity-40'}>{value ? 'ON' : 'OFF'}</span>
        <span className={`inline-block h-3 w-3 border border-ink ${value ? 'bg-accent' : ''}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex border border-ink ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      {options.map((o, i) => (
        <button
          type="button"
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`h-7 flex-1 px-2 text-[10px] tracking-[0.14em] transition-colors ${i ? 'border-l border-ink' : ''} ${
            o.id === value ? 'bg-ink text-bg' : 'hover:bg-ink/10'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Colour picker + editable hex field. */
export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => {
    const n = normalizeHex(v);
    if (n) onChange(n);
    else setDraft(value);
  };
  return (
    <div className="flex items-center gap-2 text-[10px] tracking-[0.18em]">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" className="hw-color" value={value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input
        className="h-7 min-w-0 flex-1 border border-ink/40 bg-transparent px-2 uppercase tabular-nums outline-none focus:border-accent"
        value={draft}
        spellCheck={false}
        maxLength={7}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = normalizeHex(e.target.value);
          if (n && e.target.value.replace('#', '').length === 6) onChange(n);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
    </div>
  );
}

export function Led({ on, accent = false }: { on: boolean; accent?: boolean }) {
  return <span className={`inline-block h-2 w-2 border border-ink ${on ? (accent ? 'bg-accent' : 'bg-ink') : ''}`} />;
}

export const fmtTime = (s: number): string => {
  if (!Number.isFinite(s)) return '--:--';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};
