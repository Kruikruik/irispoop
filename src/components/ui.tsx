import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
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

/** Keeps only hex digits; if more than 6 were typed, the last 6 win. */
const hexDigits = (v: string): string => {
  const d = v.replace(/[^0-9a-f]/gi, '');
  return d.length > 6 ? d.slice(-6) : d;
};

/** Colour swatch (opens the system picker) + forgiving hex field. */
export function ColorField({
  label,
  value,
  onChange,
  active = false,
  onActivate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  active?: boolean;
  onActivate?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const justFocused = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = (v: string) => {
    const n = normalizeHex(hexDigits(v));
    if (n) onChange(n);
    setDraft(n ?? value);
    setEditing(false);
  };
  return (
    <div
      className={`flex items-center gap-2 border px-1 py-1 text-[10px] tracking-[0.18em] ${active ? 'border-accent' : 'border-transparent'}`}
      onPointerDown={onActivate}
    >
      <span className={`w-16 shrink-0 pl-1 ${active ? 'text-accent' : ''}`}>{label}</span>
      <label
        className="relative h-8 w-10 shrink-0 cursor-pointer border border-ink"
        style={{ background: value }}
        title="Choose a colour"
      >
        <input
          type="color"
          aria-label={`${label} picker`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={(normalizeHex(value) ?? '#000000').toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      </label>
      <input
        aria-label={label}
        className="h-8 min-w-0 flex-1 border border-ink/40 bg-transparent px-2 uppercase tabular-nums outline-none focus:border-accent"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onFocus={(e) => {
          setEditing(true);
          justFocused.current = true;
          e.target.select();
          onActivate?.();
        }}
        onMouseUp={(e) => {
          // keep the select-all from onFocus so typing replaces the whole code
          if (justFocused.current) {
            e.preventDefault();
            justFocused.current = false;
          }
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const d = hexDigits(e.target.value);
          if (d.length === 6) onChange(`#${d.toUpperCase()}`);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
            (e.target as HTMLInputElement).blur();
          }
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
