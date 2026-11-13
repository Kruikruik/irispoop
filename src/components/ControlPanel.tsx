import { useState } from 'react';
import type { Palette } from '../utils/themes';
import { THEMES, samePalette } from '../utils/themes';
import { DECKS, MODULE_VIEWS, VISUALIZERS, type VisualizerId } from '../visualizers';
import { SheetControls, type SheetImage, type SheetParams } from '../visualizers/SheetPaint';
import { ColorField, Section, Segmented, Slider, Toggle } from './ui';

export type Mode = 'visualizer' | 'sheet';

const SWATCHES = [
  '#FFFFFF', '#F4F3EE', '#E7ECEF', '#B8C4CC', '#6B7780', '#22303A', '#111111', '#0A192F',
  '#FF4D00', '#E63946', '#EC4899', '#8B5CF6', '#3B9BE0', '#64FFDA', '#00FF66', '#F59E0B',
];

export interface Tuning {
  gainDb: number;
  smoothing: number;
  stroke: number;
  detail: number;
  invertInk: boolean;
}

export function ControlPanel(props: {
  palette: Palette;
  onPalette: (p: Palette) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  viz: VisualizerId;
  onViz: (v: VisualizerId) => void;
  deck: number;
  onDeck: (d: number) => void;
  tuning: Tuning;
  onTuning: (t: Tuning) => void;
  sheet: SheetParams;
  onSheet: (s: SheetParams) => void;
  images: SheetImage[];
  imageId: string;
  onSelectImage: (id: string) => void;
  onUploadImage: (f: File) => void;
}) {
  const { palette, onPalette, mode, tuning, onTuning } = props;
  const [target, setTarget] = useState<keyof Palette>('accent');
  const setT = <K extends keyof Tuning>(k: K, v: Tuning[K]) => onTuning({ ...tuning, [k]: v });

  return (
    <aside className="flex w-full shrink-0 flex-col overflow-y-auto border-ink lg:w-[330px] lg:border-l">
      <Section index="01" title="PALETTE // THEME">
        <div className="grid grid-cols-1 gap-1">
          {THEMES.map((t) => {
            const active = samePalette(t, palette);
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => onPalette({ bg: t.bg, ink: t.ink, accent: t.accent })}
                className={`flex items-center gap-2 border px-2 py-1.5 text-left text-[10px] tracking-[0.16em] ${
                  active ? 'border-accent outline outline-1 outline-accent' : 'border-ink/30 hover:border-ink'
                }`}
              >
                <span className="flex border border-ink/40">
                  <span className="h-4 w-4" style={{ background: t.bg }} />
                  <span className="h-4 w-4" style={{ background: t.ink }} />
                  <span className="h-4 w-4" style={{ background: t.accent }} />
                </span>
                <span className="flex-1">{t.name}</span>
                {active && <span className="text-accent">●</span>}
              </button>
            );
          })}
        </div>
        <div className="space-y-1 pt-1">
          {(
            [
              ['bg', 'BG_HEX'],
              ['ink', 'INK_HEX'],
              ['accent', 'ACC_HEX'],
            ] as const
          ).map(([k, l]) => (
            <ColorField
              key={k}
              label={l}
              value={palette[k]}
              active={target === k}
              onActivate={() => setTarget(k)}
              onChange={(v) => onPalette({ ...palette, [k]: v })}
            />
          ))}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-[9px] tracking-[0.18em] opacity-60">
            <span>QUICK_SWATCH</span>
            <span>
              → <span className="text-accent">{target === 'bg' ? 'BG' : target === 'ink' ? 'INK' : 'ACC'}</span>
            </span>
          </div>
          <div className="grid grid-cols-8 gap-1">
            {SWATCHES.map((c) => (
              <button
                type="button"
                key={c}
                title={`${c} → ${target.toUpperCase()}`}
                aria-label={`swatch ${c}`}
                onClick={() => onPalette({ ...palette, [target]: c })}
                className={`h-6 border ${palette[target].toUpperCase() === c ? 'border-accent outline outline-1 outline-accent' : 'border-ink/40 hover:border-ink'}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section index="02" title="MODE">
        <Segmented
          options={[
            { id: 'visualizer', label: 'VISUALIZER' },
            { id: 'sheet', label: 'SHEET PAINT' },
          ]}
          value={mode}
          onChange={(m) => props.onMode(m as Mode)}
        />
        {mode === 'visualizer' ? (
          <div className="space-y-2">
            <div className="border border-ink">
              {VISUALIZERS.map((v, i) => (
                <div key={v.id}>
                  <button
                    type="button"
                    onClick={() => props.onViz(v.id)}
                    className={`flex w-full items-center gap-2 px-2 py-2 text-left text-[10px] tracking-[0.14em] ${i ? 'border-t border-ink/30' : ''} ${
                      props.viz === v.id ? 'bg-ink text-bg' : 'hover:bg-ink/10'
                    }`}
                  >
                    <span className={props.viz === v.id ? 'text-accent' : 'opacity-50'}>{v.code}</span>
                    <span className="flex-1">{v.label}</span>
                    <span className="text-[8px] opacity-60">{v.desc}</span>
                  </button>
                  {v.id === 'deck' && props.viz === 'deck' && (
                    <div className="border-t border-ink/30 bg-ink/5 py-1">
                      {DECKS.map((d) => (
                        <button
                          type="button"
                          key={d.id}
                          onClick={() => props.onDeck(d.id)}
                          className={`flex w-full items-center gap-2 py-1 pl-6 pr-2 text-left text-[9px] tracking-[0.14em] ${props.deck === d.id ? 'text-accent' : 'opacity-70 hover:opacity-100'}`}
                        >
                          <span>{props.deck === d.id ? '▶' : '·'}</span>
                          <span>DECK {String(d.id).padStart(2, '0')}</span>
                          <span className="flex-1 truncate text-right">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[9px] tracking-[0.18em] opacity-60">MODULES</div>
            <div className="grid grid-cols-3 gap-1">
              {MODULE_VIEWS.map((v) => (
                <button
                  type="button"
                  key={v.id}
                  onClick={() => props.onViz(v.id)}
                  className={`h-6 truncate border px-1 text-[8.5px] tracking-[0.12em] ${props.viz === v.id ? 'border-ink bg-ink text-bg' : 'border-ink/30 hover:border-ink'}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SheetControls
            params={props.sheet}
            onChange={props.onSheet}
            images={props.images}
            imageId={props.imageId}
            onSelectImage={props.onSelectImage}
            onUpload={props.onUploadImage}
          />
        )}
      </Section>

      <Section index="03" title="TUNING">
        <Slider
          label="GAIN_DB"
          value={tuning.gainDb}
          min={-12}
          max={18}
          step={0.5}
          format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} DB`}
          onChange={(v) => setT('gainDb', v)}
        />
        <Slider label="SMOOTHING" value={tuning.smoothing} min={0} max={0.95} onChange={(v) => setT('smoothing', v)} />
        <Slider
          label="STROKE_PX"
          value={tuning.stroke}
          min={0.5}
          max={6}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => setT('stroke', v)}
        />
        <Slider
          label="GRID_DETAIL"
          value={tuning.detail}
          min={0}
          max={1}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => setT('detail', v)}
        />
        <Toggle label="INVERT_INK" value={tuning.invertInk} onChange={(v) => setT('invertInk', v)} />
      </Section>

      <div className="mt-auto space-y-1 p-3 text-[9px] leading-relaxed tracking-[0.16em] opacity-50">
        <div>SPACE ··· PLAY / PAUSE</div>
        <div>DROP ···· AUDIO OR IMAGE ANYWHERE</div>
        <div>P ······· EXPORT PNG</div>
        <div>100% CLIENT-SIDE · NOTHING IS UPLOADED</div>
      </div>
    </aside>
  );
}
