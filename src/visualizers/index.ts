import type { VisualizerDef, VisualizerId } from './types';
import { createFrequencyMeters } from './FrequencyMeters';
import { createOscilloscope } from './Oscilloscope';
import { createDotMatrix } from './DotMatrix';
import { createBeatRings } from './BeatRings';
import { createTerrain } from './Terrain';
import { createInstrumentDeck } from './InstrumentDeck';

export const VISUALIZERS: VisualizerDef[] = [
  { id: 'deck', code: 'A0', label: 'INSTRUMENT_DECK', desc: 'notes · roll · highway · pads', create: createInstrumentDeck },
  { id: 'meters', code: 'A1', label: 'FREQ_METERS', desc: 'segmented bands · peak hold · dB', create: createFrequencyMeters },
  { id: 'scope', code: 'A2', label: 'OSCILLOSCOPE', desc: 'waveform · lissajous phase', create: createOscilloscope },
  { id: 'dots', code: 'A3', label: 'DOT_MATRIX', desc: 'grid ripples on bass hits', create: createDotMatrix },
  { id: 'rings', code: 'A4', label: 'BEAT_RINGS', desc: 'concentric rings · radial ticks', create: createBeatRings },
  { id: 'terrain', code: 'A5', label: 'TERRAIN', desc: 'wireframe spectral landscape', create: createTerrain },
];

export const VIS_BY_ID = Object.fromEntries(VISUALIZERS.map((v) => [v.id, v])) as Record<VisualizerId, VisualizerDef>;

export type { VisualizerDef, VisualizerId, VisualizerInstance, RenderParams } from './types';
