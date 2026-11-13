/* Shared iso-contour helpers (marching squares on a scalar grid). */

export function boxBlur(src: Float32Array, cols: number, rows: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= cols) continue;
          s += src[yy * cols + xx];
          n++;
        }
      }
      out[y * cols + x] = s / n;
    }
  }
  return out;
}

/** Marching squares → flat segment list [x1,y1,x2,y2,...] in normalised 0..1 coords. */
export function marchingSquares(field: Float32Array, cols: number, rows: number, level: number): Float32Array {
  const out: number[] = [];
  const sx = 1 / (cols - 1);
  const sy = 1 / (rows - 1);
  const t = (p: number, q: number) => {
    const d = q - p;
    return d === 0 ? 0.5 : (level - p) / d;
  };
  const seg = (x1: number, y1: number, x2: number, y2: number) => out.push(x1 * sx, y1 * sy, x2 * sx, y2 * sy);
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i = y * cols + x;
      const a = field[i];
      const b = field[i + 1];
      const c = field[i + cols + 1];
      const d = field[i + cols];
      let idx = 0;
      if (a >= level) idx |= 8;
      if (b >= level) idx |= 4;
      if (c >= level) idx |= 2;
      if (d >= level) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const tx = x + t(a, b), ty = y; // top
      const rx = x + 1, ry = y + t(b, c); // right
      const bx = x + t(d, c), by = y + 1; // bottom
      const lx = x, ly = y + t(a, d); // left
      switch (idx) {
        case 1: case 14: seg(lx, ly, bx, by); break;
        case 2: case 13: seg(bx, by, rx, ry); break;
        case 3: case 12: seg(lx, ly, rx, ry); break;
        case 4: case 11: seg(tx, ty, rx, ry); break;
        case 6: case 9: seg(tx, ty, bx, by); break;
        case 7: case 8: seg(lx, ly, tx, ty); break;
        case 5: seg(lx, ly, bx, by); seg(tx, ty, rx, ry); break;
        case 10: seg(lx, ly, tx, ty); seg(bx, by, rx, ry); break;
      }
    }
  }
  return new Float32Array(out);
}
