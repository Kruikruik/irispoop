import type { AudioFeatures } from '../audio/AudioEngine';
import type { Palette } from '../utils/themes';

export interface RenderParams {
  /** Effective palette (already inverted if "Invert Ink" is on). */
  palette: Palette;
  /** Stroke weight multiplier (0.5..6). */
  stroke: number;
  /** Grid density / detail 0..1. */
  detail: number;
  /** Seconds since start. */
  time: number;
  /** Frame delta in seconds. */
  dt: number;
  /** Resolution-independent unit: min(w,h)/1000 px. */
  unit: number;
}

export interface VisualizerInstance {
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: AudioFeatures, p: RenderParams): void;
}

export type VisualizerId = 'deck' | 'meters' | 'scope' | 'dots' | 'rings' | 'terrain';

export interface VisualizerDef {
  id: VisualizerId;
  code: string;
  label: string;
  desc: string;
  create: () => VisualizerInstance;
}
