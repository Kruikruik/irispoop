import { useEffect, useState } from 'react';
import { engine, type SourceKind } from '../audio/AudioEngine';

export interface EngineSnapshot {
  playing: boolean;
  source: SourceKind;
  name: string;
  time: number;
  duration: number;
  bpm: number;
  peak: number;
  peakDb: number;
}

function read(): EngineSnapshot {
  return {
    playing: engine.playing,
    source: engine.source,
    name: engine.source === 'test' ? engine.testName : engine.fileName,
    time: engine.currentTime,
    duration: engine.duration,
    bpm: engine.features.bpm,
    peak: engine.features.peak,
    peakDb: engine.features.peakDb,
  };
}

/** Polls the engine ~10×/s and on every transport event. */
export function useEngine(intervalMs = 100): EngineSnapshot {
  const [snap, setSnap] = useState<EngineSnapshot>(read);
  useEffect(() => {
    const upd = () => setSnap(read());
    const id = setInterval(upd, intervalMs);
    const unsub = engine.subscribe(upd);
    return () => {
      clearInterval(id);
      unsub();
    };
  }, [intervalMs]);
  return snap;
}
