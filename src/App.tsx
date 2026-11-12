import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { engine } from './audio/AudioEngine';
import { ControlPanel, type Mode, type Tuning } from './components/ControlPanel';
import { Stage, type RenderState } from './components/Stage';
import { TopBar } from './components/TopBar';
import { Transport } from './components/Transport';
import { VIS_BY_ID, type VisualizerId } from './visualizers';
import { SHEET_STYLES, SheetPainter, type SheetImage, type SheetParams } from './visualizers/SheetPaint';
import { VideoRecorder, canRecord, downloadBlob, exportPNG, pickMime } from './utils/Exporter';
import { fileToSheetImage, isAudioFile, isImageFile, makeDefaultImages } from './utils/images';
import { THEMES, type Aspect, type Palette } from './utils/themes';

export default function App() {
  const [aspect, setAspect] = useState<Aspect>('16:9');
  const [palette, setPalette] = useState<Palette>({ bg: THEMES[0].bg, ink: THEMES[0].ink, accent: THEMES[0].accent });
  const [mode, setMode] = useState<Mode>('visualizer');
  const [viz, setViz] = useState<VisualizerId>('deck');
  const [tuning, setTuning] = useState<Tuning>({ gainDb: 0, smoothing: 0.6, stroke: 1.5, detail: 0.5, invertInk: false });
  const [sheet, setSheet] = useState<SheetParams>({ style: 'halftone', threshold: 0.5, invert: false, distortion: 0.55, redraw: 0 });
  const [images, setImages] = useState<SheetImage[]>(() => makeDefaultImages());
  const [imageId, setImageId] = useState<string>(() => 'default-orbital');
  const [recording, setRecording] = useState(false);
  const [recStart, setRecStart] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');

  const painter = useMemo(() => new SheetPainter(), []);
  const recorder = useMemo(() => new VideoRecorder(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effective = useMemo<Palette>(
    () => (tuning.invertInk ? { bg: palette.ink, ink: palette.bg, accent: palette.accent } : palette),
    [palette, tuning.invertInk],
  );

  // everything the render loop needs, read every frame without restarting the loop
  const stateRef = useRef<RenderState>({
    mode, viz, palette: effective, stroke: tuning.stroke, detail: tuning.detail,
    sensitivity: 1, smoothing: tuning.smoothing, sheet,
  });
  stateRef.current = {
    mode,
    viz,
    palette: effective,
    stroke: tuning.stroke,
    detail: tuning.detail,
    sensitivity: Math.pow(10, tuning.gainDb / 20),
    smoothing: tuning.smoothing,
    sheet,
  };

  // the whole UI follows the palette
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--c-bg', effective.bg);
    r.setProperty('--c-ink', effective.ink);
    r.setProperty('--c-accent', effective.accent);
  }, [effective]);

  useEffect(() => {
    painter.setImage(images.find((i) => i.id === imageId)?.canvas ?? null);
  }, [images, imageId, painter]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 3500);
  }, []);

  const loadAudio = useCallback(
    (file: File) => {
      flash(`LOADING ${file.name.toUpperCase()}`);
      void engine.loadFile(file).catch(() => flash('ERROR // UNSUPPORTED AUDIO FILE'));
    },
    [flash],
  );

  const loadImage = useCallback(
    async (file: File) => {
      try {
        const img = await fileToSheetImage(file);
        setImages((prev) => [...prev.filter((p) => p.id.startsWith('default')), img]);
        setImageId(img.id);
        setMode('sheet');
        flash(`IMAGE LOADED // ${img.name}`);
      } catch {
        flash('ERROR // COULD NOT DECODE IMAGE');
      }
    },
    [flash],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (isAudioFile(file)) loadAudio(file);
      else if (isImageFile(file)) void loadImage(file);
      else flash('UNSUPPORTED FILE // DROP MP3 · WAV · FLAC · OGG OR AN IMAGE');
    },
    [loadAudio, loadImage, flash],
  );

  // drag & drop anywhere on the page
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) handleFile(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [handleFile]);

  const doExport = useCallback(async () => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      await exportPNG(c);
      flash(`PNG EXPORTED // ${c.width}×${c.height}`);
    } catch {
      flash('ERROR // PNG EXPORT FAILED');
    }
  }, [flash]);

  const stopRecording = useCallback(async () => {
    const res = await recorder.stop();
    setRecording(false);
    if (res) {
      downloadBlob(res.blob, res.name);
      flash(`VIDEO SAVED // ${res.name}`);
    }
  }, [recorder, flash]);

  const toggleRecord = useCallback(async () => {
    if (recorder.recording) {
      await stopRecording();
      return;
    }
    const c = canvasRef.current;
    if (!c) return;
    if (!canRecord()) {
      flash('ERROR // MEDIARECORDER NOT SUPPORTED IN THIS BROWSER');
      return;
    }
    if (engine.source === 'none') flash('NO AUDIO // RECORDING VISUALS ONLY');
    else if (!engine.playing) await engine.play();
    try {
      recorder.start(c, engine.recordStream, 60);
      setRecording(true);
      setRecStart(performance.now());
    } catch {
      flash('ERROR // COULD NOT START RECORDING');
    }
  }, [recorder, stopRecording, flash]);

  // auto-stop the recording when the track ends
  useEffect(() => {
    const onEnded = () => {
      if (recorder.recording) void stopRecording();
    };
    engine.audio.addEventListener('ended', onEnded);
    return () => engine.audio.removeEventListener('ended', onEnded);
  }, [recorder, stopRecording]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (engine.source !== 'none') engine.toggle();
      } else if (e.key === 'p' || e.key === 'P') {
        void doExport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doExport]);

  const label =
    mode === 'visualizer'
      ? `VISUALIZER // ${VIS_BY_ID[viz].code} ${VIS_BY_ID[viz].label}`
      : `SHEET_MODE // ${SHEET_STYLES.find((s) => s.id === sheet.style)?.label ?? ''}`;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg font-mono text-ink">
      <TopBar aspect={aspect} onAspect={setAspect} onAudioFile={loadAudio} locked={recording} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <Stage
          aspect={aspect}
          canvasRef={canvasRef}
          stateRef={stateRef}
          painter={painter}
          recording={recording}
          recStart={recStart}
          label={label}
          status={status}
        />
        <ControlPanel
          palette={palette}
          onPalette={setPalette}
          mode={mode}
          onMode={setMode}
          viz={viz}
          onViz={setViz}
          tuning={tuning}
          onTuning={setTuning}
          sheet={sheet}
          onSheet={setSheet}
          images={images}
          imageId={imageId}
          onSelectImage={setImageId}
          onUploadImage={(f) => void loadImage(f)}
        />
      </div>
      <Transport onExport={() => void doExport()} onRecord={() => void toggleRecord()} recording={recording} recFormat={pickMime().ext.toUpperCase()} />

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-bg/80">
          <div className="border-2 border-dashed border-accent px-10 py-8 text-center text-[12px] tracking-[0.25em]">
            <div className="text-accent">DROP_FILE</div>
            <div className="mt-2 opacity-70">AUDIO → PLAY · IMAGE → SHEET PAINT</div>
          </div>
        </div>
      )}
    </div>
  );
}
