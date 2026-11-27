/*
 * Rewrites a fragmented MP4 (what Chrome's MediaRecorder produces: moov + moof/mdat pairs, no duration)
 * into a standard "fast-start" MP4: one moov with full sample tables and a real duration, then one mdat.
 * Many players (Discord, Windows, some phones, social networks) only play the first fragment of a
 * fragmented file, which is why raw recordings looked ~2 s long there.
 */

interface Box {
  type: string;
  start: number; // offset of the box header
  size: number;
  hdr: number; // header length (8 or 16)
}

interface Sample {
  offset: number;
  size: number;
  duration: number;
  sync: boolean;
  cto: number;
}

interface Track {
  id: number;
  trak: Box;
  timescale: number;
  trexDuration: number;
  trexSize: number;
  trexFlags: number;
  samples: Sample[];
  firstDecode: number;
  nextDecode: number;
  isVideo: boolean;
}

const str = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

function boxes(v: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let o = start;
  while (o + 8 <= end) {
    let size = v.getUint32(o);
    const type = str(v, o + 4);
    let hdr = 8;
    if (size === 1) {
      size = Number(v.getBigUint64(o + 8));
      hdr = 16;
    } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o, size, hdr });
    o += size;
  }
  return out;
}

const child = (v: DataView, b: Box, type: string): Box | undefined => boxes(v, b.start + b.hdr, b.start + b.size).find((x) => x.type === type);
const children = (v: DataView, b: Box, type: string): Box[] => boxes(v, b.start + b.hdr, b.start + b.size).filter((x) => x.type === type);
const path = (v: DataView, b: Box | undefined, ...types: string[]): Box | undefined => {
  let cur = b;
  for (const t of types) cur = cur && child(v, cur, t);
  return cur;
};

const isSync = (flags: number) => (flags & 0x10000) === 0;

/* ── box writers ── */
class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  push(u: Uint8Array): void {
    this.chunks.push(u);
    this.length += u.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}
function u64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(n))));
  return b;
}
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const len = 8 + parts.reduce((s, p) => s + p.length, 0);
  const w = new Writer();
  w.push(u32(len));
  w.push(new TextEncoder().encode(type));
  parts.forEach((p) => w.push(p));
  return w.bytes();
}
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, u32(((version & 0xff) << 24) | (flags & 0xffffff)), ...parts);

/** Copies a box, replacing its duration field (mvhd / tkhd / mdhd, version 0 or 1). */
function withDuration(src: Uint8Array, b: Box, duration: number): Uint8Array {
  const out = src.slice(b.start, b.start + b.size);
  const v = new DataView(out.buffer);
  const version = out[b.hdr];
  const base = b.hdr + 4; // after version/flags
  // offsets of the duration field, per box type and version
  // tkhd: creation, modification, track_ID, reserved, duration · mvhd/mdhd: creation, modification, timescale, duration
  const off = b.type === 'tkhd' ? (version === 1 ? base + 24 : base + 16) : version === 1 ? base + 20 : base + 12;
  if (version === 1) v.setBigUint64(off, BigInt(Math.max(0, Math.round(duration))));
  else v.setUint32(off, Math.min(0xffffffff, Math.max(0, Math.round(duration))));
  return out;
}

export function isFragmentedMp4(buf: ArrayBuffer): boolean {
  const v = new DataView(buf);
  return boxes(v, 0, buf.byteLength).some((b) => b.type === 'moof');
}

/** Returns a standard MP4, or throws if the input is not a fragmented MP4 we understand. */
export function defragmentMp4(buf: ArrayBuffer): ArrayBuffer {
  const src = new Uint8Array(buf);
  const v = new DataView(buf);
  const top = boxes(v, 0, buf.byteLength);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('no moov');
  const mvhd = child(v, moov, 'mvhd');
  if (!mvhd) throw new Error('no mvhd');
  const mvVersion = src[mvhd.start + mvhd.hdr];
  const movieTimescale = v.getUint32(mvhd.start + mvhd.hdr + 4 + (mvVersion === 1 ? 16 : 8));

  const tracks = new Map<number, Track>();
  for (const trak of children(v, moov, 'trak')) {
    const tkhd = child(v, trak, 'tkhd');
    const mdhd = path(v, trak, 'mdia', 'mdhd');
    const hdlr = path(v, trak, 'mdia', 'hdlr');
    if (!tkhd || !mdhd) continue;
    const tv = src[tkhd.start + tkhd.hdr];
    const id = v.getUint32(tkhd.start + tkhd.hdr + 4 + (tv === 1 ? 16 : 8));
    const mv = src[mdhd.start + mdhd.hdr];
    const timescale = v.getUint32(mdhd.start + mdhd.hdr + 4 + (mv === 1 ? 16 : 8));
    const isVideo = !!hdlr && str(v, hdlr.start + hdlr.hdr + 8) === 'vide';
    tracks.set(id, { id, trak, timescale, trexDuration: 0, trexSize: 0, trexFlags: 0, samples: [], firstDecode: -1, nextDecode: 0, isVideo });
  }
  const mvex = child(v, moov, 'mvex');
  if (mvex) {
    for (const trex of children(v, mvex, 'trex')) {
      const o = trex.start + trex.hdr + 4;
      const t = tracks.get(v.getUint32(o));
      if (!t) continue;
      t.trexDuration = v.getUint32(o + 8);
      t.trexSize = v.getUint32(o + 12);
      t.trexFlags = v.getUint32(o + 16);
    }
  }

  // walk every moof → collect samples with absolute offsets
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of children(v, moof, 'traf')) {
      const tfhd = child(v, traf, 'tfhd');
      if (!tfhd) continue;
      let o = tfhd.start + tfhd.hdr;
      const flags = v.getUint32(o) & 0xffffff;
      o += 4;
      const t = tracks.get(v.getUint32(o));
      o += 4;
      if (!t) continue;
      let base = moof.start;
      if (flags & 0x1) {
        base = Number(v.getBigUint64(o));
        o += 8;
      }
      if (flags & 0x2) o += 4;
      let defDur = t.trexDuration;
      let defSize = t.trexSize;
      let defFlags = t.trexFlags;
      if (flags & 0x8) {
        defDur = v.getUint32(o);
        o += 4;
      }
      if (flags & 0x10) {
        defSize = v.getUint32(o);
        o += 4;
      }
      if (flags & 0x20) {
        defFlags = v.getUint32(o);
        o += 4;
      }
      const tfdt = child(v, traf, 'tfdt');
      if (tfdt) {
        const ver = src[tfdt.start + tfdt.hdr];
        const dt = ver === 1 ? Number(v.getBigUint64(tfdt.start + tfdt.hdr + 4)) : v.getUint32(tfdt.start + tfdt.hdr + 4);
        if (t.firstDecode < 0) {
          t.firstDecode = dt;
          t.nextDecode = dt;
        } else if (dt > t.nextDecode && t.samples.length) {
          // gap between fragments: stretch the previous sample so timing (and A/V sync) is preserved
          t.samples[t.samples.length - 1].duration += dt - t.nextDecode;
          t.nextDecode = dt;
        }
      }
      let dataPos = base;
      for (const trun of children(v, traf, 'trun')) {
        let p = trun.start + trun.hdr;
        const ver = src[p];
        const tf = v.getUint32(p) & 0xffffff;
        p += 4;
        const count = v.getUint32(p);
        p += 4;
        if (tf & 0x1) {
          dataPos = base + v.getInt32(p);
          p += 4;
        }
        let firstFlags = -1;
        if (tf & 0x4) {
          firstFlags = v.getUint32(p);
          p += 4;
        }
        for (let i = 0; i < count; i++) {
          let dur = defDur;
          let size = defSize;
          let sf = i === 0 && firstFlags >= 0 ? firstFlags : defFlags;
          let cto = 0;
          if (tf & 0x100) {
            dur = v.getUint32(p);
            p += 4;
          }
          if (tf & 0x200) {
            size = v.getUint32(p);
            p += 4;
          }
          if (tf & 0x400) {
            sf = v.getUint32(p);
            p += 4;
          }
          if (tf & 0x800) {
            cto = ver === 1 ? v.getInt32(p) : v.getUint32(p);
            p += 4;
          }
          t.samples.push({ offset: dataPos, size, duration: dur, sync: isSync(sf), cto });
          t.nextDecode += dur;
          dataPos += size;
        }
      }
    }
  }
  const list = [...tracks.values()].filter((t) => t.samples.length);
  if (!list.length) throw new Error('no samples');

  // ── build the new moov (chunk offsets patched after we know its size) ──
  const buildMoov = (mdatDataStart: number): Uint8Array => {
    let pos = mdatDataStart;
    const traks: Uint8Array[] = [];
    let movieDur = 0;
    for (const t of list) {
      const mediaDur = t.samples.reduce((s, x) => s + x.duration, 0);
      const lead = Math.max(0, t.firstDecode);
      const tDurMovie = ((mediaDur + lead) / t.timescale) * movieTimescale;
      movieDur = Math.max(movieDur, tDurMovie);
      // stts (run-length)
      const stts: number[] = [];
      for (const s of t.samples) {
        if (stts.length && stts[stts.length - 1] === s.duration) stts[stts.length - 2]++;
        else stts.push(1, s.duration);
      }
      const sttsB = full('stts', 0, 0, u32(stts.length / 2), ...stts.map(u32));
      const hasCto = t.samples.some((s) => s.cto !== 0);
      const ctts: number[] = [];
      if (hasCto) {
        for (const s of t.samples) {
          if (ctts.length && ctts[ctts.length - 1] === s.cto) ctts[ctts.length - 2]++;
          else ctts.push(1, s.cto);
        }
      }
      const cttsB = hasCto ? full('ctts', t.samples.some((s) => s.cto < 0) ? 1 : 0, 0, u32(ctts.length / 2), ...ctts.map(u32)) : new Uint8Array(0);
      const allSync = t.samples.every((s) => s.sync);
      const syncIdx = t.samples.map((s, i) => (s.sync ? i + 1 : 0)).filter(Boolean);
      const stssB = allSync ? new Uint8Array(0) : full('stss', 0, 0, u32(syncIdx.length), ...syncIdx.map(u32));
      const stscB = full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)); // one sample per chunk
      const stszB = full('stsz', 0, 0, u32(0), u32(t.samples.length), ...t.samples.map((s) => u32(s.size)));
      const offsets: Uint8Array[] = [];
      for (const s of t.samples) {
        offsets.push(u64(pos));
        pos += s.size;
      }
      const co64B = full('co64', 0, 0, u32(t.samples.length), ...offsets);
      const stbl = path(v, t.trak, 'mdia', 'minf', 'stbl');
      const stsd = stbl && child(v, stbl, 'stsd');
      if (!stsd) throw new Error('no stsd');
      const newStbl = box('stbl', src.slice(stsd.start, stsd.start + stsd.size), sttsB, cttsB, stssB, stscB, stszB, co64B);
      // minf: keep everything but stbl
      const minf = path(v, t.trak, 'mdia', 'minf')!;
      const minfParts = boxes(v, minf.start + minf.hdr, minf.start + minf.size).map((b) => (b.type === 'stbl' ? newStbl : src.slice(b.start, b.start + b.size)));
      const mdia = child(v, t.trak, 'mdia')!;
      const mdiaParts = boxes(v, mdia.start + mdia.hdr, mdia.start + mdia.size).map((b) =>
        b.type === 'minf' ? box('minf', ...minfParts) : b.type === 'mdhd' ? withDuration(src, b, mediaDur) : src.slice(b.start, b.start + b.size),
      );
      // edit list keeps A/V sync when a track starts later than 0
      const edts =
        lead > 0
          ? box('edts', full('elst', 1, 0, u32(2), u64((lead / t.timescale) * movieTimescale), u64(2 ** 32 - 1), u32(0x00010000), u64((mediaDur / t.timescale) * movieTimescale), u64(0), u32(0x00010000)))
          : new Uint8Array(0);
      const trakParts = boxes(v, t.trak.start + t.trak.hdr, t.trak.start + t.trak.size)
        .filter((b) => b.type !== 'edts')
        .map((b) => (b.type === 'mdia' ? box('mdia', ...mdiaParts) : b.type === 'tkhd' ? withDuration(src, b, tDurMovie) : src.slice(b.start, b.start + b.size)));
      const tk = trakParts.shift()!; // tkhd first, then edts, then the rest
      traks.push(box('trak', tk, edts, ...trakParts));
    }
    return box('moov', withDuration(src, mvhd, movieDur), ...traks);
  };

  // media-time-1 (= -1) for the empty edit must be a signed 64-bit -1
  const ftyp = box('ftyp', new TextEncoder().encode('isom'), u32(0x200), new TextEncoder().encode('isomiso2avc1mp41'));
  const dataSize = list.reduce((s, t) => s + t.samples.reduce((a, x) => a + x.size, 0), 0);
  const mdatHdr = 16; // 64-bit size header
  const probe = buildMoov(0);
  const moovBytes = buildMoov(ftyp.length + probe.length + mdatHdr);
  const out = new Uint8Array(ftyp.length + moovBytes.length + mdatHdr + dataSize);
  let o = 0;
  out.set(ftyp, o);
  o += ftyp.length;
  out.set(moovBytes, o);
  o += moovBytes.length;
  const dv = new DataView(out.buffer);
  dv.setUint32(o, 1);
  out.set(new TextEncoder().encode('mdat'), o + 4);
  dv.setBigUint64(o + 8, BigInt(mdatHdr + dataSize));
  o += mdatHdr;
  for (const t of list) {
    for (const s of t.samples) {
      out.set(src.subarray(s.offset, s.offset + s.size), o);
      o += s.size;
    }
  }
  fixEmptyEdits(out);
  return out.buffer;
}

/** The empty edit's media_time must be -1 (all bits set); u64() clamps, so patch it in place. */
function fixEmptyEdits(out: Uint8Array): void {
  const v = new DataView(out.buffer);
  const scan = (start: number, end: number): void => {
    for (const b of boxes(v, start, end)) {
      if (b.type === 'elst') {
        const n = v.getUint32(b.start + b.hdr + 4);
        let p = b.start + b.hdr + 8;
        for (let i = 0; i < n; i++, p += 20) if (v.getBigUint64(p + 8) === BigInt(2 ** 32 - 1)) v.setBigInt64(p + 8, -1n);
      } else if (['moov', 'trak', 'edts'].includes(b.type)) scan(b.start + b.hdr, b.start + b.size);
    }
  };
  scan(0, out.length);
}
