/*
 * INSTRUMENT_DECK host: Deck 01 (classic studio, the original dashboard) + four poster decks built
 * from modules, each with its own layout for portrait (9:16), square-ish (1:1, 4:5) and landscape (16:9).
 */
import type { RenderParams, VisualizerInstance } from '../types';
import { createInstrumentDeck } from '../InstrumentDeck';
import type { Rect } from '../draw';
import { DeckState } from './DeckState';
import type { Module, ModuleCtx } from './kit';
import { createForm } from './modules/form';
import { createGlyph, createRoots } from './modules/glyphRoots';
import { createDiffuse, createStarwords, createTracker, createUnravel } from './modules/unravel';
import { createArcade, createStars, createTelemetry, createTrajectory } from './modules/telemetry';
import { createAura, createMeters, createSheetCard, createSignals } from './modules/studio';

export type ModuleId =
  | 'form' | 'glyph' | 'roots' | 'unravel' | 'starwords' | 'tracker' | 'diffuse'
  | 'telemetry' | 'trajectory' | 'arcade' | 'stars' | 'aura' | 'signals' | 'meters' | 'sheet';

export const MODULES: { id: ModuleId; label: string; create: () => Module }[] = [
  { id: 'form', label: 'FORM', create: createForm },
  { id: 'glyph', label: 'GLYPH', create: createGlyph },
  { id: 'roots', label: 'ROOTS', create: createRoots },
  { id: 'unravel', label: 'UNRAVEL', create: createUnravel },
  { id: 'starwords', label: 'STARWORDS', create: createStarwords },
  { id: 'tracker', label: 'TRACKER', create: createTracker },
  { id: 'diffuse', label: 'DIFFUSE', create: createDiffuse },
  { id: 'telemetry', label: 'TELEMETRY', create: createTelemetry },
  { id: 'trajectory', label: 'TRAJECTORY', create: createTrajectory },
  { id: 'arcade', label: 'ARCADE', create: createArcade },
  { id: 'stars', label: 'STARS', create: createStars },
  { id: 'aura', label: 'AURA', create: createAura },
  { id: 'signals', label: 'SIGNALS', create: createSignals },
  { id: 'meters', label: 'METERS', create: createMeters },
  { id: 'sheet', label: 'SHEET', create: createSheetCard },
];

type Box = [number, number, number, number];
interface Card {
  m: ModuleId;
  num: string;
  P: Box; // portrait 1080×1920
  S: Box; // square 1000×1000
  L: Box; // landscape 1920×1080
}

export const DECKS: { id: number; name: string; cards: Card[] }[] = [
  { id: 1, name: 'CLASSIC STUDIO', cards: [] },
  {
    id: 2,
    name: 'FORM & GLYPH',
    cards: [
      { m: 'form', num: '01', P: [30, 30, 1020, 1130], S: [20, 20, 960, 570], L: [30, 30, 1140, 1020] },
      { m: 'glyph', num: '02', P: [30, 1190, 500, 700], S: [20, 610, 470, 370], L: [1200, 30, 690, 500] },
      { m: 'roots', num: '03', P: [550, 1190, 500, 700], S: [510, 610, 470, 370], L: [1200, 550, 690, 500] },
    ],
  },
  {
    id: 3,
    name: 'UNRAVEL & DIFFUSE',
    cards: [
      { m: 'unravel', num: '01', P: [30, 30, 1020, 760], S: [20, 20, 960, 420], L: [30, 30, 1860, 480] },
      { m: 'starwords', num: '02', P: [30, 820, 500, 1070], S: [20, 460, 470, 520], L: [30, 540, 600, 510] },
      { m: 'tracker', num: '03', P: [550, 820, 500, 520], S: [510, 460, 470, 250], L: [660, 540, 600, 510] },
      { m: 'diffuse', num: '04', P: [550, 1370, 500, 520], S: [510, 730, 470, 250], L: [1290, 540, 600, 510] },
    ],
  },
  {
    id: 4,
    name: 'TELEMETRY & TRAJECTORY',
    cards: [
      { m: 'telemetry', num: '00', P: [30, 30, 1020, 560], S: [20, 20, 960, 330], L: [30, 30, 1240, 420] },
      { m: 'form', num: '01', P: [30, 610, 500, 560], S: [20, 365, 470, 300], L: [30, 470, 610, 580] },
      { m: 'trajectory', num: '02', P: [550, 610, 500, 560], S: [510, 365, 470, 300], L: [660, 470, 610, 580] },
      { m: 'arcade', num: '05', P: [30, 1190, 500, 700], S: [20, 680, 470, 300], L: [1290, 30, 600, 620] },
      { m: 'stars', num: '06', P: [550, 1190, 500, 700], S: [510, 680, 470, 300], L: [1290, 670, 600, 380] },
    ],
  },
  {
    id: 5,
    name: 'WATERCOLOR STUDIO',
    cards: [
      { m: 'aura', num: '02', P: [30, 30, 1020, 700], S: [20, 20, 470, 470], L: [30, 30, 610, 520] },
      { m: 'signals', num: '03', P: [30, 750, 500, 520], S: [20, 505, 470, 240], L: [30, 565, 610, 240] },
      { m: 'meters', num: '04', P: [30, 1290, 500, 600], S: [20, 760, 470, 220], L: [30, 820, 610, 230] },
      { m: 'sheet', num: '01', P: [550, 750, 500, 1140], S: [510, 20, 470, 960], L: [670, 30, 1220, 1020] },
    ],
  },
];

/** One musical analysis shared by every deck and module view, so switching keeps the song's history. */
const shared = new DeckState();

let frameNo = 0;
/** Unique frame id per drawn frame (shared state updates once even with several modules). */
export const nextFrame = (): number => ++frameNo;

export function createDeckHost(): VisualizerInstance {
  const classic = createInstrumentDeck();
  const state = shared;
  const mods = new Map<string, Module>();
  return {
    draw(ctx, w, h, f, p) {
      const frame = p.frame ?? nextFrame();
      state.update(f, p.dt, frame);
      const deck = DECKS.find((d) => d.id === (p.deck ?? 1)) ?? DECKS[0];
      if (deck.id === 1) {
        classic.draw(ctx, w, h, f, p);
        return;
      }
      const ratio = h / w;
      const k: 'P' | 'S' | 'L' = ratio >= 1.3 ? 'P' : ratio >= 0.85 ? 'S' : 'L';
      const [W, H] = k === 'P' ? [1080, 1920] : k === 'S' ? [1000, 1000] : [1920, 1080];
      const sx = w / W;
      const sy = h / H;
      for (const c of deck.cards) {
        const key = `${deck.id}:${c.m}:${c.num}`;
        let mod = mods.get(key);
        if (!mod) {
          mod = MODULES.find((x) => x.id === c.m)!.create();
          mods.set(key, mod);
        }
        const [x, y, bw, bh] = c[k];
        const r: Rect = { x: x * sx, y: y * sy, w: bw * sx, h: bh * sy };
        const m: ModuleCtx = { ctx, r, f, p: { ...p, frame }, S: state, num: c.num };
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        ctx.clip();
        mod.draw(m);
        ctx.restore();
      }
    },
  };
}

/** A single module filling the canvas (MODULES list in the panel). */
export function createModuleView(id: ModuleId): VisualizerInstance {
  const state = shared;
  const mod = MODULES.find((x) => x.id === id)!.create();
  return {
    draw(ctx, w, h, f, p: RenderParams) {
      const frame = p.frame ?? nextFrame();
      state.update(f, p.dt, frame);
      const pad = Math.min(w, h) * 0.03;
      mod.draw({ ctx, r: { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 }, f, p: { ...p, frame }, S: state, num: '01' });
    },
  };
}
