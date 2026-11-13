/* Samples an image into a colour / luminance / edge grid (cached per image and resolution). */

export interface ImageGrid {
  cols: number;
  rows: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  lum: Float32Array;
  edge: Float32Array;
  angle: Float32Array;
}

const cache = new WeakMap<HTMLCanvasElement, Map<string, ImageGrid>>();
let sampler: HTMLCanvasElement | null = null;

export function sampleGrid(img: HTMLCanvasElement, cols: number, rows: number): ImageGrid | null {
  cols = Math.max(2, Math.round(cols));
  rows = Math.max(2, Math.round(rows));
  let m = cache.get(img);
  if (!m) {
    m = new Map();
    cache.set(img, m);
  }
  const key = `${cols}x${rows}`;
  const hit = m.get(key);
  if (hit) return hit;
  if (m.size > 30) m.clear();
  if (!sampler) sampler = document.createElement('canvas');
  sampler.width = cols;
  sampler.height = rows;
  const g = sampler.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, cols, rows);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, cols, rows);
  const d = g.getImageData(0, 0, cols, rows).data;
  const N = cols * rows;
  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    R[i] = d[i * 4] / 255;
    G[i] = d[i * 4 + 1] / 255;
    B[i] = d[i * 4 + 2] / 255;
    lum[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
  }
  const edge = new Float32Array(N);
  const angle = new Float32Array(N);
  const L = (x: number, y: number) => lum[Math.min(rows - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))];
  let max = 1e-6;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      const mag = Math.hypot(gx, gy);
      edge[y * cols + x] = mag;
      angle[y * cols + x] = Math.atan2(gy, gx);
      if (mag > max) max = mag;
    }
  }
  for (let i = 0; i < N; i++) edge[i] /= max;
  const grid: ImageGrid = { cols, rows, r: R, g: G, b: B, lum, edge, angle };
  m.set(key, grid);
  return grid;
}

/** Grid sized so that `cols` cells span the image width with square cells. */
export function gridFor(img: HTMLCanvasElement, cols: number): ImageGrid | null {
  return sampleGrid(img, cols, (cols * img.height) / Math.max(1, img.width));
}

/** Current sheet image, shared by Sheet Paint and the image-reactive deck modules. */
let current: HTMLCanvasElement | null = null;
export const setSheetImage = (c: HTMLCanvasElement | null): void => {
  current = c;
};
export const getSheetImage = (): HTMLCanvasElement | null => current;
