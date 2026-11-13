import { useRef } from 'react';
import { engine } from '../audio/AudioEngine';
import { ASPECTS, type Aspect } from '../utils/themes';
import { Led, Segmented } from './ui';
import { UpdateButton } from './UpdateButton';
import { useEngine } from './useEngine';

export function TopBar({
  aspect,
  onAspect,
  onAudioFile,
  locked,
}: {
  aspect: Aspect;
  onAspect: (a: Aspect) => void;
  onAudioFile: (f: File) => void;
  locked: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const st = useEngine(250);
  const testOn = st.source === 'test';

  return (
    <header className="flex min-h-12 flex-wrap items-stretch border-b border-ink text-[11px] tracking-[0.14em]">
      <div className="flex items-center gap-3 border-r border-ink px-4">
        <span className="grid grid-cols-2 gap-[2px]">
          <span className="h-[7px] w-[7px] bg-accent" />
          <span className="h-[7px] w-[7px] bg-ink" />
          <span className="h-[7px] w-[7px] bg-ink" />
          <span className="h-[7px] w-[7px] border border-ink" />
        </span>
        <span className="text-[13px] font-bold tracking-[0.2em]">IRIS//VIZ</span>
        <span className="hidden opacity-40 sm:inline">VZ-01</span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onAudioFile(f);
          e.target.value = '';
        }}
      />
      <button type="button" onClick={() => fileRef.current?.click()} className="border-r border-ink px-4 hover:bg-ink hover:text-bg">
        ↑ LOAD AUDIO
      </button>
      <button
        type="button"
        onClick={() => (testOn ? engine.exitTest() : engine.startTest())}
        className={`flex items-center gap-2 border-r border-ink px-4 ${testOn ? 'bg-accent text-bg' : 'hover:bg-ink hover:text-bg'}`}
        title="Built-in 120 BPM synthetic beat"
      >
        {testOn ? '■ STOP TEST' : '∿ TEST SIGNAL'}
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-4">
        <Led on={st.playing} accent />
        <span className="opacity-50">SRC</span>
        <span className="truncate">{st.name || '— NO_SOURCE · DROP AN AUDIO FILE ANYWHERE —'}</span>
      </div>

      <UpdateButton />

      <div className="flex items-center gap-3 border-l border-ink px-4 py-2">
        <span className="opacity-50">ASPECT</span>
        <div className="w-56">
          <Segmented
            options={(Object.keys(ASPECTS) as Aspect[]).map((a) => ({ id: a, label: a }))}
            value={aspect}
            onChange={onAspect}
            disabled={locked}
          />
        </div>
      </div>
    </header>
  );
}
