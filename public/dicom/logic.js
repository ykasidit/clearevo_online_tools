// DICOM CD viewer logic. Pure, tested. All archive access goes through
// readRange(offset, length) -> Promise<Uint8Array>, so the browser uses
// File.slice and node tests use fs.read - the CD is never loaded whole.

// ---- ZIP (classic, not ZIP64 - DICOM CDs are < 4GB by definition) ----

export async function zipEntries(readRange, fileSize) {
  const tailLen = Math.min(fileSize, 128 * 1024);
  const tail = await readRange(fileSize - tailLen, tailLen);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory)');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error('ZIP64 archive - not supported yet (file over 4GB?)');
  const cd = await readRange(cdOff, cdSize);
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder();
  const out = [];
  let off = 0;
  for (let n = 0; n < count; n++) {
    if (cdv.getUint32(off, true) !== 0x02014b50) throw new Error('bad ZIP central directory');
    const method = cdv.getUint16(off + 10, true);
    const csize = cdv.getUint32(off + 20, true);
    const usize = cdv.getUint32(off + 24, true);
    const nameLen = cdv.getUint16(off + 28, true);
    const extraLen = cdv.getUint16(off + 30, true);
    const cmtLen = cdv.getUint16(off + 32, true);
    const lho = cdv.getUint32(off + 42, true);
    const name = dec.decode(cd.subarray(off + 46, off + 46 + nameLen));
    if (usize > 0) out.push({ name, method, csize, usize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// read one entry; headBytes limits BOTH the compressed read and the inflate -
// header scans touch only the first ~64KB of each slice
export async function zipData(readRange, entry, inflateRaw, headBytes) {
  const lh = await readRange(entry.lho, 30);
  const dv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
  if (dv.getUint32(0, true) !== 0x04034b50) throw new Error('bad ZIP local header');
  const dataOff = entry.lho + 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
  const want = headBytes ? Math.min(entry.csize, Math.max(headBytes * 2, 65536)) : entry.csize;
  const raw = await readRange(dataOff, want);
  if (entry.method === 0) return headBytes ? raw.subarray(0, headBytes) : raw;
  if (entry.method !== 8) throw new Error(`unsupported ZIP compression method ${entry.method}`);
  return inflateRaw(raw, headBytes);
}

// ---- TAR (uncompressed USTAR / GNU) ----
// Files are stored contiguously and uncompressed, so - exactly like ZIP - we can
// index by scanning only the 512-byte headers through readRange, then pull any
// one file's bytes with a single range read. gzip/7z/rar can't do this (one
// shared compression stream / solid blocks), which is why only plain .tar keeps
// the index-first streaming that lets a gigabyte CD open on a phone.
// ponytail: no GNU long-name ('L') or PAX ('x') header support - DICOM tar names
// are short; add it only if a real CD needs it.
export async function tarEntries(readRange, fileSize) {
  const dec = new TextDecoder();
  const out = [];
  let off = 0;
  while (off + 512 <= fileSize) {
    const hdr = await readRange(off, 512);
    if (hdr.every((b) => b === 0)) break;                 // zero block = end of archive
    let name = dec.decode(hdr.subarray(0, 100)).replace(/\0.*$/, '');
    const prefix = dec.decode(hdr.subarray(345, 500)).replace(/\0.*$/, '');
    if (prefix) name = prefix + '/' + name;
    const size = parseInt(dec.decode(hdr.subarray(124, 136)).replace(/[^0-7]/g, ''), 8) || 0;
    const type = String.fromCharCode(hdr[156]);
    const dataOff = off + 512;
    if (name && (type === '0' || type === '\0' || type === '') && size > 0) out.push({ name, size, dataOff });
    off = dataOff + Math.ceil(size / 512) * 512;
  }
  if (!out.length) throw new Error('empty or unsupported TAR archive');
  return out;
}

// ---- DICOM helpers ----

// CD junk that is definitely not image data
export const JUNK_RE = /(^|\/)(autorun|viewer|readme|dicomdir$)|\.(exe|dll|bmp|png|jpg|ini|inf|hlp|html?|txt|xml|ico|pdf|css|js)$/i;

export function looksDicom(bytes) {
  return bytes.length > 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4d;
}

// group scanned per-file metadata into sorted series
export function groupSeries(items) {
  const by = new Map();
  for (const it of items) {
    const k = it.seriesUID || 'unknown';
    if (!by.has(k)) by.set(k, { uid: k, num: it.seriesNum ?? 9999, desc: it.seriesDesc || '(no description)', modality: it.modality || '', instances: [] });
    by.get(k).instances.push(it);
  }
  const series = [...by.values()];
  for (const s of series) s.instances.sort((a, b) => (a.instance ?? 1e9) - (b.instance ?? 1e9) || a.name.localeCompare(b.name));
  series.sort((a, b) => a.num - b.num);
  return series;
}

// standard named CT window presets radiologists know by name (WW/WL in HU)
export const CT_PRESETS = [
  { label: 'Default (from file)', wc: null, ww: null },
  { label: 'Soft Tissue (400/40)', wc: 40, ww: 400 },
  { label: 'Lung (1500/-600)', wc: -600, ww: 1500 },
  { label: 'Bone (1800/400)', wc: 400, ww: 1800 },
  { label: 'Brain (80/40)', wc: 40, ww: 80 },
  { label: 'Mediastinum (350/50)', wc: 50, ww: 350 },
  { label: 'Abdomen (400/40)', wc: 40, ww: 400 },
  { label: 'Angio (600/300)', wc: 300, ww: 600 },
];

// first number of a possibly multi-valued DICOM decimal string like "40\\80"
export function firstNum(s) {
  if (s == null || s === '') return null;
  const v = parseFloat(String(s).split('\\')[0]);
  return Number.isFinite(v) ? v : null;
}

// normalize a DICOMDIR Referenced File ID / zip path to one comparable key
export function normKey(name) { return name.replace(/\\/g, '/').replace(/^\//, '').toUpperCase(); }

// DICOMDIR file references are relative to the DICOMDIR's own folder. A CD
// zipped at the root has DICOMDIR at top ('' prefix); a CD the user wrapped in
// a subfolder has e.g. 'MYCD/DICOMDIR', so its 'DICOM\\x' refs resolve to
// 'MYCD/DICOM/X'. Try the prefixed path first, then the bare one.
export function makeResolver(byName, dicomdirName) {
  const prefix = normKey(dicomdirName).replace(/DICOMDIR$/, '');
  return (fidKey) => byName.get(prefix + fidKey) || byName.get(fidKey);
}

// build per-image metadata from DICOMDIR directory records (pure).
// records: [{type:'SERIES'|'IMAGE'|..., seriesUID, seriesNum, modality, fid, instance}]
// resolve: (normKey) -> source item, or undefined if that file isn't present.
export function seriesFromDicomdirRecords(records, resolve) {
  const metas = []; let curS = null;
  for (const r of records) {
    if (r.type === 'SERIES') curS = r;
    else if (r.type === 'IMAGE' && curS && r.fid) {
      const item = resolve(normKey(r.fid));
      if (!item) continue;
      metas.push({ name: item.name, item, seriesUID: curS.seriesUID || 'unknown',
        seriesNum: curS.seriesNum, modality: curS.modality || '', seriesDesc: '', instance: r.instance });
    }
  }
  return metas;
}

// which cache keys to evict to get under `cap`. The slice cache is keyed by each
// image's UNIQUE file id (not by slice index) so a late prefetch from a previous
// series can never overwrite the current series' slot. Eviction drops the keys
// farthest from the current slice first (and other-series keys, index null,
// first of all), but never the current slice.
export function evictKeys(keys, indexOf, curIdx, cap) {
  if (keys.length <= cap) return [];
  const scored = keys.map((k) => {
    const i = indexOf(k);
    return { k, d: i == null ? Infinity : Math.abs(i - curIdx) };
  });
  scored.sort((a, b) => b.d - a.d); // farthest / other-series first
  return scored.slice(0, keys.length - cap).filter((s) => s.d > 0).map((s) => s.k);
}

// anatomical direction a cosine vector points to, in DICOM patient (LPS) coords:
// +x=Left/-x=Right, +y=Posterior/-y=Anterior, +z=Head(sup)/-z=Feet(inf).
// returns 1-3 dominant-axis letters (e.g. 'A', 'RL' for oblique) - the edge
// markers every clinical viewer draws.
export function orientationString(x, y, z) {
  const axes = [
    { l: x < 0 ? 'R' : 'L', m: Math.abs(x) },
    { l: y < 0 ? 'A' : 'P', m: Math.abs(y) },
    { l: z < 0 ? 'F' : 'H', m: Math.abs(z) },
  ].sort((a, b) => b.m - a.m);
  return axes.filter((a) => a.m > 0.25).map((a) => a.l).join('');
}
// ImageOrientationPatient (6 values) -> screen-edge labels, or null
export function edgeOrientations(iop) {
  if (!iop || iop.length < 6) return null;
  const [rx, ry, rz, cx, cy, cz] = iop;               // row cosines, col cosines
  return {
    right: orientationString(rx, ry, rz), left: orientationString(-rx, -ry, -rz),
    bottom: orientationString(cx, cy, cz), top: orientationString(-cx, -cy, -cz),
  };
}

// "latest call wins" gate. Rapid slider drags / scrolls fire many async show()
// calls; a slower earlier decode can resolve AFTER a later one and paint a stale
// frame. next() stamps a call and returns its token; isCurrent(token) is true
// only for the most recent call, so a superseded call can bail before painting.
export function makeLatestGate() {
  let seq = 0;
  return { next: () => ++seq, isCurrent: (t) => t === seq };
}

// map stored pixel values to 0..255 through rescale + window
export function makeLut(slope, intercept, wc, ww, invert) {
  const w = Math.max(1, ww);
  const lo = wc - w / 2, hi = wc + w / 2;
  return (v) => {
    const m = v * slope + intercept;
    let y = m <= lo ? 0 : m >= hi ? 255 : Math.round(((m - lo) / w) * 255);
    return invert ? 255 - y : y;
  };
}

// ---- DICOM RLE (transfer syntax 1.2.840.10008.1.2.5, PS3.5 Annex G) ----
// PackBits: n>=0 -> copy n+1 literal bytes; -127<=n<=-1 -> repeat next byte 1-n
// times; -128 -> no-op. Decodes into out (fixed length) - stops when full.
export function packbits(src, out) {
  let i = 0, o = 0;
  while (i < src.length && o < out.length) {
    const n = src[i] < 128 ? src[i] : src[i] - 256;
    i++;
    if (n >= 0) { for (let k = 0; k <= n && i < src.length && o < out.length; k++) out[o++] = src[i++]; }
    else if (n !== -128) { const b = src[i++]; for (let k = 0; k < 1 - n && o < out.length; k++) out[o++] = b; }
  }
  return o;
}
// one RLE frame -> interleaved little-endian sample bytes.
// Header: 16 uint32 LE (count + up to 15 segment offsets). Segments are byte
// planes MSB-first per sample; samples (e.g. R,G,B) come as consecutive planes.
export function rleDecodeFrame(bytes, pixelCount, bytesPerSample, samples) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nseg = dv.getUint32(0, true);
  if (nseg !== bytesPerSample * samples) throw new Error(`RLE: ${nseg} segments for ${bytesPerSample * samples} planes`);
  const offs = [];
  for (let i = 1; i <= nseg; i++) offs.push(dv.getUint32(i * 4, true));
  offs.push(bytes.length);
  const out = new Uint8Array(pixelCount * bytesPerSample * samples);
  const plane = new Uint8Array(pixelCount);
  for (let s = 0; s < samples; s++) {
    for (let b = 0; b < bytesPerSample; b++) {
      const seg = s * bytesPerSample + b;
      const got = packbits(bytes.subarray(offs[seg], offs[seg + 1]), plane);
      if (got < pixelCount) throw new Error(`RLE: segment ${seg} short (${got}/${pixelCount})`);
      const lePos = bytesPerSample - 1 - b;                  // MSB-first plane -> LE byte slot
      for (let i = 0; i < pixelCount; i++) out[(i * samples + s) * bytesPerSample + lePos] = plane[i];
    }
  }
  return out;
}

// ---- pointer mapping (viewer) ----
// click -> viewport-local px. getBoundingClientRect() is in visual px, which the
// A-/A+ body zoom scales; clientWidth/Height stay in local px. The ratio undoes
// any such scaling - at 100% zoom it is exactly (clientX - left, clientY - top).
export function clickToLocal(clientX, clientY, rect, clientW, clientH) {
  return { x: (clientX - rect.left) * (clientW / rect.width), y: (clientY - rect.top) * (clientH / rect.height) };
}

// double-tap zoom must not fire while placing measure/angle points - the second
// quick tap would zoom the image and move the just-placed markers off the clicks
export function dblTapZooms(tool, msSinceLastTap) {
  return msSinceLastTap < 320 && tool !== 'measure' && tool !== 'angle';
}
