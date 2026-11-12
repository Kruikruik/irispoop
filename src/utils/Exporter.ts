/* PNG snapshot + synced video recording (canvas stream + Web Audio stream → MediaRecorder). */

export function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportPNG(canvas: HTMLCanvasElement, prefix = 'irisviz'): Promise<void> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG export failed');
  downloadBlob(blob, `${prefix}_${canvas.width}x${canvas.height}_${timestamp()}.png`);
}

const MIME_CANDIDATES: { mime: string; ext: string }[] = [
  { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.4D401F,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

export function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder === 'undefined') return { mime: '', ext: 'webm' };
  for (const c of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: '', ext: 'webm' };
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

export class VideoRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private ext = 'webm';
  private mime = '';
  private size = '';

  get recording(): boolean {
    return this.rec?.state === 'recording';
  }

  get format(): string {
    return this.ext.toUpperCase();
  }

  start(canvas: HTMLCanvasElement, audio: MediaStream | null, fps = 60): void {
    if (this.recording) return;
    const stream = canvas.captureStream(fps);
    audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const { mime, ext } = pickMime();
    this.mime = mime;
    this.ext = ext;
    this.size = `${canvas.width}x${canvas.height}`;
    const pixels = canvas.width * canvas.height;
    const videoBitsPerSecond = Math.round(Math.min(40_000_000, Math.max(8_000_000, pixels * fps * 0.12)));
    const opts: MediaRecorderOptions = { videoBitsPerSecond, audioBitsPerSecond: 256_000 };
    if (mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts);
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.start(250);
    this.rec = rec;
    this.stream = stream;
  }

  /** Stops and returns the finished file (or null if nothing was recording). */
  stop(): Promise<{ blob: Blob; name: string } | null> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        // stop only the canvas video track; the audio track belongs to the engine and is reused
        this.stream?.getVideoTracks().forEach((t) => t.stop());
        const blob = new Blob(this.chunks, { type: this.mime.split(';')[0] || 'video/webm' });
        this.chunks = [];
        this.rec = null;
        this.stream = null;
        resolve({ blob, name: `irisviz_${this.size}_${timestamp()}.${this.ext}` });
      };
      rec.stop();
    });
  }
}
