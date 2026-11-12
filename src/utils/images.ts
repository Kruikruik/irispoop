import type { SheetImage } from '../visualizers/SheetPaint';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  return [c, g];
}

export function thumbOf(src: HTMLCanvasElement, size = 160): string {
  const s = size / Math.max(src.width, src.height);
  const [c, g] = canvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)));
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

/** Default sheet A — "ORBITAL": shaded sphere, orbit ring, moon and horizon bars. */
function orbital(): HTMLCanvasElement {
  const [c, g] = canvas(1024, 1024);
  const bgGrad = g.createLinearGradient(0, 0, 0, 1024);
  bgGrad.addColorStop(0, '#fbfbfa');
  bgGrad.addColorStop(1, '#c9c9c6');
  g.fillStyle = bgGrad;
  g.fillRect(0, 0, 1024, 1024);

  // orbit (back half)
  g.save();
  g.translate(540, 470);
  g.rotate(-0.32);
  g.strokeStyle = '#2a2a2a';
  g.lineWidth = 16;
  g.beginPath();
  g.ellipse(0, 0, 430, 110, 0, Math.PI, Math.PI * 2);
  g.stroke();
  g.restore();

  // sphere
  const sg = g.createRadialGradient(440, 350, 20, 540, 470, 310);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.45, '#8d8d8d');
  sg.addColorStop(1, '#0c0c0c');
  g.fillStyle = sg;
  g.beginPath();
  g.arc(540, 470, 300, 0, Math.PI * 2);
  g.fill();

  // latitude bands on the sphere
  g.save();
  g.beginPath();
  g.arc(540, 470, 300, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 6;
  for (let i = -3; i <= 3; i++) {
    g.beginPath();
    g.ellipse(540, 470 + i * 80, 300 * Math.cos((i * 80) / 300), 26, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();

  // orbit (front half)
  g.save();
  g.translate(540, 470);
  g.rotate(-0.32);
  g.strokeStyle = '#111';
  g.lineWidth = 16;
  g.beginPath();
  g.ellipse(0, 0, 430, 110, 0, 0, Math.PI);
  g.stroke();
  g.restore();

  // moon
  const mg = g.createRadialGradient(215, 790, 6, 240, 810, 95);
  mg.addColorStop(0, '#d8d8d8');
  mg.addColorStop(1, '#151515');
  g.fillStyle = mg;
  g.beginPath();
  g.arc(240, 810, 90, 0, Math.PI * 2);
  g.fill();

  // horizon bars
  g.fillStyle = '#111';
  let y = 880;
  for (let i = 0; i < 7; i++) {
    const hh = 4 + i * 3;
    g.fillRect(0, y, 1024, hh);
    y += hh + 10 - i;
  }
  // small square + concentric target
  g.fillRect(820, 140, 90, 90);
  g.strokeStyle = '#111';
  g.lineWidth = 5;
  for (let r = 20; r <= 80; r += 20) {
    g.beginPath();
    g.arc(865, 790, r, 0, Math.PI * 2);
    g.stroke();
  }
  return c;
}

/** Default sheet B — "BAUHAUS": circle, triangle, bars and a tonal ramp. */
function bauhaus(): HTMLCanvasElement {
  const [c, g] = canvas(1280, 960);
  g.fillStyle = '#ece8de';
  g.fillRect(0, 0, 1280, 960);

  // big disc with a cut
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(420, 430, 300, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ece8de';
  g.beginPath();
  g.arc(420, 430, 150, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.fillStyle = '#7a7a7a';
  g.fillRect(270, 425, 300, 10);

  // gradient triangle
  const tg = g.createLinearGradient(760, 140, 1180, 720);
  tg.addColorStop(0, '#111');
  tg.addColorStop(1, '#d0d0d0');
  g.fillStyle = tg;
  g.beginPath();
  g.moveTo(780, 720);
  g.lineTo(1180, 720);
  g.lineTo(980, 150);
  g.closePath();
  g.fill();

  // bars of decreasing grey
  for (let i = 0; i < 8; i++) {
    const v = Math.round(20 + i * 28);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(760 + i * 48, 60, 30, 70 + i * 6);
  }

  // diagonal
  g.strokeStyle = '#111';
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(80, 900);
  g.lineTo(700, 620);
  g.stroke();

  // tonal ramp
  const rg = g.createLinearGradient(80, 0, 1200, 0);
  rg.addColorStop(0, '#000');
  rg.addColorStop(1, '#fff');
  g.fillStyle = rg;
  g.fillRect(80, 790, 1120, 70);
  g.strokeStyle = '#111';
  g.lineWidth = 4;
  g.strokeRect(80, 790, 1120, 70);

  // dots
  g.fillStyle = '#111';
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.arc(110 + i * 46, 100, 8 + i * 4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

export function makeDefaultImages(): SheetImage[] {
  const a = orbital();
  const b = bauhaus();
  return [
    { id: 'default-orbital', name: 'ORBITAL', canvas: a, thumb: thumbOf(a) },
    { id: 'default-bauhaus', name: 'BAUHAUS', canvas: b, thumb: thumbOf(b) },
  ];
}

/** Rasterises any uploaded image (JPG/PNG/WEBP/SVG) onto a canvas (≤1400 px). */
export async function fileToSheetImage(file: File): Promise<SheetImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    const w0 = img.naturalWidth || 1024;
    const h0 = img.naturalHeight || 1024;
    let s = 1400 / Math.max(w0, h0);
    if (!isSvg) s = Math.min(1, s);
    const [c, g] = canvas(Math.max(2, Math.round(w0 * s)), Math.max(2, Math.round(h0 * s)));
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    const name = file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 18) || 'UPLOAD';
    return { id: `upload-${Date.now()}`, name, canvas: c, thumb: thumbOf(c) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const isAudioFile = (f: File): boolean =>
  f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|oga|m4a|aac|opus|weba)$/i.test(f.name);

export const isImageFile = (f: File): boolean =>
  f.type.startsWith('image/') || /\.(png|jpe?g|webp|svg|gif|bmp|avif)$/i.test(f.name);
