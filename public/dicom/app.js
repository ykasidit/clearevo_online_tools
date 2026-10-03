// ClearEvo.com DICOM Viewer - the app shell: DOM, files, decode, paint. Decisions live in logic.js, strings in i18n.js
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools

import { zipEntries, zipData, tarEntries, JUNK_RE, looksDicom, sniffArchive, isArchiveName, cineNext, clampZoom, wlDrag, browseSteps, groupSeries, CT_PRESETS, firstNum, makeLut, normKey, seriesFromDicomdirRecords, makeResolver, edgeOrientations, makeLatestGate, rleDecodeFrame, clickToLocal, dblTapZooms, dblTapZoomToggle, wheelAction, strayPinchPoint, localScale, clampLabel, imgToScreen, exportTransform, cacheByteBudget, evictKeysByBytes, prefetchDepth } from './logic.js';
import * as jpegLossless from './lossless-min.js';
import { I18N } from './i18n.js';
import { sleep, isAbort } from './sync.js';
/** @returns {any} */
const $ = (id) => document.getElementById(id);
// App identity - the <title> is version-free (stable SERP snippet); bump APP_VERSION alone.
const APP_NAME = 'DICOM Viewer by ClearEvo.com';
const APP_VERSION = '1.8.0';
const APP_TITLE = `${APP_NAME} v${APP_VERSION}`;
$('titleText').textContent = APP_TITLE;
$('aboutVer').textContent = `v${APP_VERSION}`;
const cv = $('cv'), vp = $('viewport'), ctx = cv.getContext('2d');
const stat = (t) => { $('stat').textContent = t; };

let T = I18N.en;
// Simple (patient) vs Advanced (clinician) mode - labels + visibility only, never behavior (ADR 0001)
let mode = localStorage.getItem('ce_mode') === 'advanced' ? 'advanced' : 'simple';
function applyLang(code) {
  T = I18N[code] || I18N.en;
  document.documentElement.lang = code;
  $('lang').value = code;
  const simple = mode === 'simple';
  $('mode').replaceChildren(new Option(T.modeSimple, 'simple'), new Option(T.modeAdvanced, 'advanced'));
  $('mode').value = mode;
  const lbl = (id, t) => { const el = $(id) && $(id).querySelector('.lbl'); if (el) el.textContent = t; };
  lbl('bZip', T.open); lbl('bDir', T.folder);
  $('demoSmallBtn').textContent = T.demoSmall; $('demoCtBtn').textContent = T.demoCT; $('demoMriBtn').textContent = T.demoMRI;
  $('shareBtn').textContent = T.share; $('aboutShare').textContent = T.share;
  lbl('tWL', simple ? T.wlSimple : T.wl); lbl('tBrowse', T.browse); lbl('tPan', T.pan); lbl('tZoom', T.zoom); lbl('tMeasure', T.measure); lbl('tAngle', T.angle); lbl('bMUndo', T.undoPt);
  lbl('bCine', simple ? T.playSimple : T.cine); lbl('bInvert', T.invert); lbl('bRotate', T.rotate); lbl('bFlip', T.flip); lbl('bReset', T.reset); lbl('bCapture', simple ? T.captureSimple : T.capture); lbl('bCaptureAs', T.captureAs); lbl('bTags', T.tags);
  $('tBrowse').title = T.browseHint;
  $('sbPrivacy').textContent = T.privacy; $('sbNotDevice').textContent = T.notDevice;
  $('pngLbl').textContent = T.pngPrompt; $('pngOk').textContent = T.pngSave; $('pngCancel').textContent = T.pngCancel;
  if (!frame && !series.length) drawEmpty();
  if (curSourceLabel) setSource(source, curSourceLabel, remoteUrl);
}
$('lang') && ($('lang').innerHTML = '<option value="en">EN</option><option value="th">ไทย</option>');
function detectLang() {
  const saved = localStorage.getItem('ce_lang'); if (saved && I18N[saved]) return saved;
  // Thai only if the PRIMARY browser language is Thai - having Thai as a secondary
  // language (common in TH even with an English device) must not force Thai.
  const primary = (((navigator.languages || [])[0]) || navigator.language || 'en').toLowerCase();
  return primary.startsWith('th') ? 'th' : 'en';
}

// loading/buffering indicator (frac 0..1, or null to hide)
let bufferCb = null, source = 'local', curSourceLabel = null;
function busy(txt, frac) {
  const b = $('busy');
  if (txt == null) { b.style.display = 'none'; return; }
  b.style.display = 'flex'; $('busyTxt').textContent = txt;
  $('busyBar').style.width = frac == null ? '100%' : `${Math.round(frac * 100)}%`;
}
let remoteUrl = null;
function setSource(kind, label, url) {
  source = kind; remoteUrl = url || null; curSourceLabel = label;
  setOpenBlink(false);   // a scan is opening - stop nagging
  const b = $('srcbadge');
  b.style.display = 'block';
  if (kind === 'remote') {
    // cross-origin R2 URL: the download attribute is ignored, so open in a new
    // tab - R2 serves application/zip and the browser downloads it
    b.replaceChildren(`☁ ${label} - ${T.sourceRemote}. ${T.fastest} `);
    if (/^https?:\/\//.test(url)) {
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.style.color = '#8fd0ff'; a.textContent = T.downloadFull;
      b.append(a, ` ${T.andOpenLocally}`);
    }
  } else {
    b.textContent = `◉ ${T.sourceLocal}: ${label} (${T.sourceOnDevice})`;
  }
}

if (typeof DecompressionStream === 'undefined') stat('this browser lacks DecompressionStream - use a current Chrome/Edge/Firefox/Safari');

// inflate raw deflate, optionally stopping after maxBytes (for header scans)
async function inflateRaw(raw, maxBytes) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = []; let got = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (maxBytes && got >= maxBytes) { reader.cancel().catch(() => {}); break; }
    }
  } catch (e) { if (!maxBytes) throw e; /* truncated input is expected on header scans */ }
  const out = new Uint8Array(got);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return maxBytes ? out.subarray(0, Math.min(maxBytes, got)) : out;
}

// ---- source abstraction: zip entries or plain files ----
let items = [];        // [{name, usize, getBytes(headBytes?)}]
let series = [], cur = null, idx = 0;

// sniff the archive by magic bytes and build the {name, usize, getBytes} list.
// Only ZIP and plain TAR keep index-first streaming; gz/7z/rar are refused with
// a message that says why and what to do instead (their compression has no
// random access, so a slice can't be read without the whole archive).
async function archiveEntries(readRange, size) {
  const kind = sniffArchive(await readRange(0, Math.min(size, 264)));
  if (kind === 'zip') {
    const entries = await zipEntries(readRange, size);
    return entries.map((e) => ({ name: e.name, usize: e.usize, getBytes: (h) => zipData(readRange, e, inflateRaw, h) }));
  }
  if (kind === 'tar') {
    const entries = await tarEntries(readRange, size);
    return entries.map((e) => ({ name: e.name, usize: e.size, getBytes: (h) => readRange(e.dataOff, h ? Math.min(h, e.size) : e.size) }));
  }
  throw new Error(T.archiveRefused[kind]);
}
// what the user handed us -> the entry list. src is { files } (one archive file, or the CD's files / folder) or
// { url, label } (a whole CD streamed over HTTP Range - the CD stays on the server, we pull only the DICOMDIR index
// and the slices you look at; the same idea as reading a huge file through a tiny buffer on the Siemens SL45 KVM for
// the 2003 Bangkok bus pathfinder: index first, then read only what the current view needs).
async function listEntries(src, signal) {
  if (src.url) {
    busy(T.connecting, 0);
    const h = await fetch(src.url, { method: 'HEAD', signal });
    signal.throwIfAborted();
    if (!h.ok) throw new Error(`cannot reach the file (HTTP ${h.status})`);
    const size = +h.headers.get('content-length');
    if (!size) throw new Error('server did not report a size');
    // one range read; for big reads (the DICOMDIR index) stream and report %
    const readRange = async (off, len) => {
      const r = await fetch(src.url, { headers: { Range: `bytes=${off}-${off + len - 1}` }, signal });
      if (r.status !== 206) throw new Error(`server ignored Range request (HTTP ${r.status}) - cannot stream`);
      if (len > 1048576 && r.body && bufferCb) {
        const reader = r.body.getReader(); const chunks = []; let got = 0;
        for (;;) { const { value, done } = await reader.read(); if (done) break; chunks.push(value); got += value.length; bufferCb(got / len); }
        const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
        return out;
      }
      return new Uint8Array(await r.arrayBuffer());
    };
    busy(T.readingArchive, null);
    return archiveEntries(readRange, size);
  }
  const files = [...src.files].filter((f) => f.size > 0);
  if (files.length === 1 && isArchiveName(files[0].name)) {
    stat(T.readingArchive);
    const file = files[0];
    const readRange = async (off, len) => new Uint8Array(await file.slice(off, off + len).arrayBuffer());
    return archiveEntries(readRange, file.size);
  }
  return files.map((f) => ({ name: f.webkitRelativePath || f.name, usize: f.size, getBytes: async (b) => new Uint8Array(await (b ? f.slice(0, b) : f).arrayBuffer()) }));
}
function sourceLabel(src) {
  if (src.url) return src.label || 'remote CD';
  const files = [...src.files];
  if (files.length === 1 && isArchiveName(files[0].name)) return files[0].name;
  const root = (files[0] && files[0].webkitRelativePath || '').split('/')[0];
  return root ? `${root}/ folder` : `${files.length} files`;
}

// ---- the open lifecycle: ONE loop, one owner (house rule, 2026-10-03) ----
// Everything that follows an "open" - read the archive index, read the DICOMDIR or scan every header, list the
// series, show the biggest one, decode the previews, retry the previews that failed - is one async function run
// under one AbortController. A second open aborts the first, and every await in the chain is followed by
// signal.throwIfAborted(), so a slow first CD can never paint its series over the second one. Before 1.8 three
// generation counters guarded the same thing from three places, and the slice cache survived an open: two CDs that
// name their files alike (DICOM/IMG0001 is the norm) could show each other's slices.
let opening = null;    // the AbortController of the open in progress
async function openAny(src) {
  if (opening) opening.abort();
  const ac = new AbortController(); opening = ac;
  try { await openRun(src, ac.signal); }
  catch (e) { if (isAbort(e)) return; busy(null); stat(e.message); }
  finally { if (opening === ac) opening = null; }
}
async function openRun(src, signal) {
  stopCine();
  for (const f of cache.values()) if (f.bitmap) f.bitmap.close();
  cache.clear(); inflight.clear(); frame = null; cur = null; series = []; items = []; bannerMeta = null;
  $('serieslist').replaceChildren(); drawEmpty(); setBrowseLock(false);
  setSource(src.url ? 'remote' : 'local', sourceLabel(src), src.url);
  const all = await listEntries(src, signal);
  signal.throwIfAborted();
  // index-first: if the CD has a DICOMDIR, read that one file for the whole series/image tree; otherwise fall
  // back to reading every file's header. Refs resolve relative to the DICOMDIR's folder, so the CD may be zipped
  // at the root or wrapped in one (or more) subfolders.
  const dd = all.find((e) => /(^|\/)DICOMDIR$/i.test(e.name));
  const byName = new Map(); for (const e of all) byName.set(normKey(e.name), e);
  let metas = null;
  if (dd) {
    try { metas = await metasFromDicomdir(dd, makeResolver(byName, dd.name), signal); }
    catch (e) { if (isAbort(e)) throw e; signal.throwIfAborted(); stat(T.dicomdirUnreadable(e.message)); }
  }
  if (!metas) {
    items = all.filter((e) => !JUNK_RE.test(e.name) && e.usize < 200 * 1048576);
    metas = await scanHeaders(items, signal);
  }
  signal.throwIfAborted();
  if (!metas.length) { busy(null); stat(T.noDicom); return; }
  series = groupSeries(metas);
  busy(null);
  stat(dd ? (source === 'remote' ? T.seriesStreaming(series.length, metas.length) : T.seriesIndexed(series.length, metas.length)) : T.seriesFound(series.length, metas.length));
  if (!dd) patientBanner(metas[0]);
  renderSeriesList();
  setBrowseLock(true);
  await selectSeries(biggestSeries());   // skip 1-frame localizers/topograms - land on the real stack
  signal.throwIfAborted();
  await Promise.all([dd ? fillDescriptions(signal) : Promise.resolve(), decodePreviews(signal)]);
  signal.throwIfAborted();
  setBrowseLock(false);
  toast(T.ready); showGesture(tool);   // teach the active (default) tool once the scan is browsable
}

async function metasFromDicomdir(dd, resolve, signal) {
  busy(`${T.loadingIndex} (${(dd.usize / 1048576).toFixed(0)} MB)...`, 0);
  bufferCb = (f) => busy(`${T.loadingIndex}... ${Math.round(f * 100)}%`, f);
  let ddBytes;
  try { ddBytes = await dd.getBytes(); } finally { bufferCb = null; }
  signal.throwIfAborted();
  busy(T.parsing, null);
  const ds = dicomParser.parseDicom(ddBytes);
  const seq = ds.elements.x00041220;
  if (!seq || !seq.items) throw new Error('no directory records');
  // flatten DICOMDIR records into the plain shape the pure helper expects
  const records = seq.items.map((it) => {
    const r = it.dataSet;
    return {
      type: (r.string('x00041430') || '').trim(),
      seriesUID: r.string('x0020000e'), seriesNum: parseFloat(r.string('x00200011')),
      modality: r.string('x00080060'), fid: r.string('x00041500'), instance: parseFloat(r.string('x00200013')),
    };
  });
  const metas = seriesFromDicomdirRecords(records, resolve);
  if (!metas.length) throw new Error('no image records matched files');
  return metas;
}
// fallback without a DICOMDIR: read every file's header (4 readers over one shared queue)
async function scanHeaders(work, signal) {
  const metas = []; let done = 0; const queue = work.slice();
  async function reader() {
    for (;;) {
      const it = queue.shift();
      if (!it) return;
      let head = null;
      try { head = await it.getBytes(65536); } catch { /* an unreadable file is not an image */ }
      signal.throwIfAborted();
      if (head && looksDicom(head)) {
        const ds = parseHead(head);
        if (ds && ds.string('x0020000e')) metas.push({ ...dsMeta(ds, it.name), item: it });
      }
      stat(T.scanning(++done, work.length));
    }
  }
  await Promise.all([reader(), reader(), reader(), reader()]);
  return metas;
}
// a DICOMDIR has no series descriptions or patient line: one 64 KB header read per series fills them in
async function fillDescriptions(signal) {
  let banner = false;
  for (const s of series) {
    let ds = null;
    try { ds = parseHead(await s.instances[0].item.getBytes(65536)); } catch { /* keep the DICOMDIR's description */ }
    signal.throwIfAborted();
    if (!ds) continue;
    s.desc = ds.string('x0008103e') || s.desc;
    seriesLabel(s, T.imgCount(s.instances.length));
    if (!banner) { banner = true; patientBanner(dsMeta(ds, s.instances[0].name)); }
  }
}
function patientBanner(m) {
  bannerMeta = m;
  // patient/scan as prefix, app name + version kept as suffix (standard "Document — App" form)
  $('titleText').textContent = m.patient ? `${m.patient} — ${APP_TITLE}` : APP_TITLE;
  if (frame) render();
}
let bannerMeta = null;

// ---- browse-ready lock + transient toasts ----
let ready = true, toastTimer = 0;
function toast(msg, sticky) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1700);
}
// slice browsing is locked until every series preview (left panel) has decoded,
// so scroll input can't queue behind thumbnail decodes and then flush in one
// big unstoppable jump. W/L, pan, zoom and series-switching stay live.
function setBrowseLock(locked) { ready = !locked; const sl = $('slice'); if (sl) sl.disabled = locked; if (locked) toast(T.loadingPreviews, true); }
function biggestSeries() { return series.reduce((a, b) => (b.instances.length > a.instances.length ? b : a), series[0]); }

function dsMeta(ds, name) {
  const num = (t) => { const v = ds.string(t); return v == null ? null : parseFloat(v); };
  return {
    name, seriesUID: ds.string('x0020000e'), seriesNum: num('x00200011'), seriesDesc: ds.string('x0008103e'),
    modality: ds.string('x00080060'), instance: num('x00200013'),
    patient: ds.string('x00100010'), pid: ds.string('x00100020'), dob: ds.string('x00100030'), sex: ds.string('x00100040'),
    study: ds.string('x00081030'), studyDate: ds.string('x00080020'), institution: ds.string('x00080080'),
  };
}
function parseHead(bytes) {
  try { return dicomParser.parseDicom(bytes, { untilTag: 'x7fe00010' }); }
  catch (e) { return e && e.dataSet ? e.dataSet : null; }
}

// the series list entry's text, built from nodes: a series description comes off the CD and must never be markup
function seriesLabel(s, countText) {
  if (!s.el) return;
  const b = document.createElement('b'); b.textContent = `S${s.num ?? '?'} ${s.modality}`;
  s.el.querySelector('.lbl').replaceChildren(b, document.createElement('br'), (s.desc || '').slice(0, 40), document.createElement('br'), countText);
}
function renderSeriesList() {
  const box = $('serieslist'); box.replaceChildren();
  for (const s of series) {
    const d = document.createElement('div');
    d.className = 'ser';
    const c = document.createElement('canvas'); c.width = 48; c.height = 48;
    const lbl = document.createElement('div'); lbl.className = 'lbl';
    d.append(c, lbl);
    d.onclick = () => { void selectSeries(s); };
    s.el = d; box.appendChild(d);
    seriesLabel(s, T.imgCount(s.instances.length));
  }
}

// ---- decode one instance -> {gray canvas, meta} ----
const UNCOMPRESSED = ['1.2.840.10008.1.2', '1.2.840.10008.1.2.1', '1.2.840.10008.1.2.2'];
const JPEG_LOSSLESS = ['1.2.840.10008.1.2.4.70', '1.2.840.10008.1.2.4.57'];
const JPEG_BASELINE = ['1.2.840.10008.1.2.4.50', '1.2.840.10008.1.2.4.51'];
const JPEG_2000 = ['1.2.840.10008.1.2.4.90', '1.2.840.10008.1.2.4.91'];

// JPEG 2000: OpenJPEG WASM (MIT, Open Health Imaging Foundation), lazy-loaded
// on the first J2K slice so non-J2K CDs never pay the ~310 KB download.
let _j2kDecoder = null;
async function j2kDecode(bytes) {
  if (!_j2kDecoder) {
    if (typeof OpenJPEGWASM === 'undefined') {
      await new Promise((ok, err) => {
        const s = document.createElement('script');
        s.src = './openjpegwasm_decode.js';
        s.onload = ok; s.onerror = () => err(new Error('cannot load the JPEG 2000 decoder'));
        document.head.appendChild(s);
      });
    }
    const m = await OpenJPEGWASM({ locateFile: (f) => `./${f}` });
    _j2kDecoder = new m.J2KDecoder();
  }
  // set-buffer + decode + copy-out is synchronous, so one shared decoder is safe
  const enc = _j2kDecoder.getEncodedBuffer(bytes.length);
  enc.set(bytes);
  _j2kDecoder.decode();
  const fi = _j2kDecoder.getFrameInfo();
  return { fi, data: _j2kDecoder.getDecodedBuffer().slice() };   // copy out of the wasm heap
}

// pull one frame's worth of encapsulated bytes: use the Basic Offset Table when
// present, else assume one fragment per frame (the standard layout for RLE and
// the usual one for JPEG); for baseline JPEG without either, scan SOI markers.
function encapFrame(ds, el, f, nf, isJpeg) {
  if (nf <= 1) {
    return el.fragments && el.fragments.length
      ? dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, 0, el.fragments.length)
      : new Uint8Array(ds.byteArray.buffer, ds.byteArray.byteOffset + el.dataOffset, el.length);
  }
  if (el.basicOffsetTable && el.basicOffsetTable.length === nf) return dicomParser.readEncapsulatedImageFrame(ds, el, f);
  if (el.fragments.length === nf) return dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, f, 1);
  if (isJpeg) return dicomParser.readEncapsulatedImageFrame(ds, el, f, dicomParser.createJPEGBasicOffsetTable(ds, el));
  throw new Error(`cannot split ${nf} frames across ${el.fragments.length} fragments`);
}
async function decodeInstance(inst) {
  const bytes = await inst.item.getBytes();
  const ds = dicomParser.parseDicom(bytes);
  const ts = (ds.string('x00020010') || '1.2.840.10008.1.2').trim();
  const rows = ds.uint16('x00280010'), cols = ds.uint16('x00280011');
  const bits = ds.uint16('x00280100'), signed = ds.uint16('x00280103') === 1;
  const samples = ds.uint16('x00280002') || 1;
  const photo = (ds.string('x00280004') || 'MONOCHROME2').trim();
  const nframes = firstNum(ds.string('x00280008')) || 1;
  const f = Math.min(inst.frame || 0, nframes - 1);
  // per-frame delay for cine: FrameTime (ms), else RecommendedDisplayFrameRate
  const fps = firstNum(ds.string('x00082144'));
  const frameTime = firstNum(ds.string('x00181063')) || (fps ? 1000 / fps : null);
  const el = ds.elements.x7fe00010;
  if (!el) throw new Error('no pixel data');
  let px;
  if (UNCOMPRESSED.includes(ts)) {
    const bo = ds.byteArray.buffer, frameLen = rows * cols * samples;
    const off = ds.byteArray.byteOffset + el.dataOffset + f * frameLen * (bits <= 8 ? 1 : 2);
    if (ts.endsWith('.2')) throw new Error('big-endian DICOM not supported yet');
    px = bits <= 8 ? new Uint8Array(bo, off, frameLen)
      : signed ? new Int16Array(bo, off, frameLen) : new Uint16Array(bo, off, frameLen);
  } else if (JPEG_LOSSLESS.includes(ts)) {
    const frame = encapFrame(ds, el, f, nframes, false);
    const out = new jpegLossless.Decoder().decompress(frame.buffer, frame.byteOffset, frame.length);
    px = bits <= 8 ? new Uint8Array(out) : signed ? new Int16Array(out) : new Uint16Array(out);
  } else if (JPEG_2000.includes(ts)) {
    const frame = encapFrame(ds, el, f, nframes, false);
    const { fi, data } = await j2kDecode(frame);
    px = fi.bitsPerSample <= 8 ? new Uint8Array(data.buffer)
      : fi.isSigned ? new Int16Array(data.buffer, 0, rows * cols * samples) : new Uint16Array(data.buffer, 0, rows * cols * samples);
  } else if (ts === '1.2.840.10008.1.2.5') {
    // RLE: exactly one fragment per frame (PS3.5 A.4.2)
    const frame = dicomParser.readEncapsulatedPixelDataFromFragments(ds, el, f, 1);
    const raw = rleDecodeFrame(frame, rows * cols, bits <= 8 ? 1 : 2, samples);
    px = bits <= 8 ? raw : signed ? new Int16Array(raw.buffer) : new Uint16Array(raw.buffer);
  } else if (JPEG_BASELINE.includes(ts)) {
    // ultrasound & co: standard JPEG inside - the browser decodes it natively
    const frame = encapFrame(ds, el, f, nframes, true);
    const bmp = await createImageBitmap(new Blob([frame], { type: 'image/jpeg' }));
    return { bitmap: bmp, rows: bmp.height, cols: bmp.width, samples, photo, slope: 1, icept: 0, wc0: 128, ww0: 256, ts, ds, iop: ds.string('x00200037') || null, spacing: spacingOf(ds), nframes, frameTime };
  } else {
    throw new Error(T.tsUnsupported(ts));
  }
  const slope = firstNum(ds.string('x00281053')) ?? 1;
  const icept = firstNum(ds.string('x00281052')) ?? 0;
  let wc = firstNum(ds.string('x00281050')), ww = firstNum(ds.string('x00281051'));
  if (wc == null || ww == null) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < px.length; i += 7) { const v = px[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    wc = ((mn + mx) / 2) * slope + icept; ww = Math.max(1, (mx - mn)) * slope;
  }
  return { px, rows, cols, samples, photo, slope, icept, wc0: wc, ww0: ww, ts, ds, iop: ds.string('x00200037') || null, spacing: spacingOf(ds), nframes, frameTime };
}
function spacingOf(ds) {
  const v = ds.string('x00280030') || ds.string('x00181164'); // PixelSpacing, else ImagerPixelSpacing
  if (!v) return null;
  const [r, c] = String(v).split('\\').map(parseFloat);
  return Number.isFinite(r) && Number.isFinite(c) ? { r, c } : null;
}

function paint(fr, wc, ww, invert) {
  const off = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(fr.cols, fr.rows) : document.createElement('canvas');
  off.width = fr.cols; off.height = fr.rows;
  const c2 = off.getContext('2d');
  const img = c2.createImageData(fr.cols, fr.rows);
  const d = img.data;
  if (fr.samples === 3) {
    for (let i = 0, p = 0; i < fr.px.length; i += 3, p += 4) { d[p] = fr.px[i]; d[p + 1] = fr.px[i + 1]; d[p + 2] = fr.px[i + 2]; d[p + 3] = 255; }
  } else {
    const lut = makeLut(fr.slope, fr.icept, wc, ww, invert !== (fr.photo === 'MONOCHROME1'));
    for (let i = 0, p = 0; i < fr.px.length; i++, p += 4) { const y = lut(fr.px[i]); d[p] = d[p + 1] = d[p + 2] = y; d[p + 3] = 255; }
  }
  c2.putImageData(img, 0, 0);
  return off;
}

// ---- viewer state ----
let frame = null, wc = 0, ww = 1, invert = false, zoom = 1, panX = 0, panY = 0, tool = 'browse', needWL = true;
let rot = 0, flipH = false;                    // quarter-turns CW, mirror left-right
let measure = [], measureKind = 'measure', lastTf = null, lastTap = 0;
// image px <-> screen px through the current pan/zoom/rotate/flip transform
function img2scr(p, t = lastTf) { return imgToScreen(p, t); }
function scr2img(sx, sy) {
  const t = lastTf;
  let x = sx - t.cx, y = sy - t.cy;
  for (let i = 0; i < t.rot; i++) { const nx = y; y = -x; x = nx; }   // undo 90° CW turns
  if (t.flipH) x = -x;
  return { x: x / t.base + t.cols / 2, y: y / t.base + t.rows / 2 };
}
// ---- slice cache + rolling prefetch buffer ----
// Like map-tile prefetch: keep `prefetchN` slices buffered AHEAD in the scroll
// direction (a couple behind too). Fetches run concurrently (capped) and each
// completion tops the buffer back up, so scrolling stays smooth instead of
// blocking one Range request per frame.
const cache = new Map();       // UNIQUE image id (file name) -> frame
const inflight = new Set();    // image ids currently decoding
const prefetchN = prefetchDepth(navigator.deviceMemory);   // decode-ahead depth by device class
let lastDir = 1;
const showGate = makeLatestGate();   // latest show() call wins - guards against stale-frame paints
let nameIdx = new Map();       // image id -> index in the CURRENT series
const DL_CONCURRENCY = 3;   // parallel range downloads - shared by prefetch buffer + series previews
// cache is byte-budgeted by device class - a 1.2GB CT CD must not OOM a phone
// renderer ("Aw, Snap"). Cached neighbours keep pixels + precomputed meta only;
// the full dataset (whole file bytes) stays only on the displayed slice (Tags).
const CACHE_BUDGET = cacheByteBudget(navigator.deviceMemory);
function frameBytes(f) { return (f.px ? f.px.byteLength : f.cols * f.rows * 4) + 65536; }
function cachePut(name, v) {
  cache.set(name, v);
  for (const f of cache.values()) { if (f !== frame && f.ds) { delete f.ds; } }
  const sizeOf = (k) => { const f = cache.get(k); return f ? frameBytes(f) : 0; };
  for (const k of evictKeysByBytes([...cache.keys()], (n) => (nameIdx.has(n) ? nameIdx.get(n) : null), idx, sizeOf, CACHE_BUDGET)) {
    const f = cache.get(k);
    if (f !== frame) { if (f && f.bitmap) { f.bitmap.close(); } cache.delete(k); }
  }
  drawBufBar();
}
// decode instance i of the current series, keyed by its unique id (safe against
// series switches - a stale completion just caches under its own id, never the
// wrong slot)
function decodeIntoCache(i) {
  const inst = cur.instances[i], name = inst.name;
  if (cache.has(name) || inflight.has(name)) return;
  inflight.add(name);
  void prefetchOne(inst, name);
}
async function prefetchOne(inst, name) {
  try { const f = await decodeInstance(inst); cachePut(name, f); }
  catch { /* a failed prefetch is simply decoded again when shown */ }
  finally { inflight.delete(name); ensurePrefetch(); }
}
function ensurePrefetch() {
  if (!cur) return;
  const n = cur.instances.length;
  for (let k = 1; k <= prefetchN && inflight.size < DL_CONCURRENCY; k++) {
    const j = idx + k * lastDir; if (j >= 0 && j < n) decodeIntoCache(j);
  }
  const b = idx - lastDir; if (inflight.size < DL_CONCURRENCY && b >= 0 && b < n) decodeIntoCache(b);
}

async function selectSeries(s) {
  stopCine();
  // land mid-stack: slice 1 of a thin-slice reformat is the edge of the volume (near-empty)
  const start = Math.floor((s.instances.length - 1) / 2);
  cur = s; idx = start; inflight.clear(); zoom = 1; panX = panY = 0; rot = 0; flipH = false; $('bFlip').classList.remove('on'); invert = false; needWL = true; lastDir = 1;
  nameIdx = new Map(s.instances.map((it, i) => [it.name, i]));
  series.forEach((x) => x.el && x.el.classList.toggle('on', x === s));
  $('slice').max = s.instances.length - 1; $('slice').value = start;
  await show(start);
}
async function show(i) {
  if (!cur) return;
  const n = cur.instances.length;
  if (i < 0 || i > n - 1) toast(`${i < 0 ? T.startReached : T.endReached} · ${n} ${n === 1 ? T.frame : T.frames} · S${cur.num ?? '?'}${cur.desc ? ' ' + cur.desc.slice(0, 22) : ''}`);
  const target = Math.max(0, Math.min(n - 1, i));
  if (target !== idx) lastDir = target > idx ? 1 : -1;
  idx = target;
  measure = [];
  const token = showGate.next();                       // this call supersedes any in-flight show()
  const inst = cur.instances[idx], name = inst.name;
  $('slice').value = idx; $('sliceLbl').textContent = `${idx + 1}/${n}`;
  try {
    let fr = cache.get(name);
    if (!fr) {
      if (source === 'remote') busy(`${T.buffering} ${idx + 1}/${n}...`, null);
      fr = await decodeInstance(inst);
      // a newer show() (or a series switch, which is one) has started - never paint a stale/far-away frame
      if (!showGate.isCurrent(token)) return;
      cachePut(name, fr);
    }
    if (!showGate.isCurrent(token)) return;             // a newer show() is already the current frame
    busy(null);
    frame = fr;
    // a single multi-frame file (ultrasound/angio clip): expand its frames into
    // virtual instances so the slider, browse drag and cine all just work.
    // ponytail: only the 1-file-series case; a series mixing several multi-frame
    // files still shows each file's frame 1 - expand per-file if that ever shows up.
    if ((fr.nframes || 1) > 1 && cur.instances.length === 1 && !cur.expanded) {
      const inst0 = cur.instances[0];
      cur.instances = Array.from({ length: fr.nframes }, (_, k) => ({ ...inst0, name: `${inst0.name}#${k}`, frame: k }));
      cur.expanded = true;
      cur.frameTimeMs = fr.frameTime || null;
      nameIdx = new Map(cur.instances.map((it, k) => [it.name, k]));
      cachePut(cur.instances[0].name, fr);
      $('slice').max = fr.nframes - 1;
      $('sliceLbl').textContent = `1/${fr.nframes}`;
      seriesLabel(cur, T.framesCount(fr.nframes));
    }
    if (needWL) { wc = fr.wc0; ww = fr.ww0; needWL = false; }
    if (presetSel.value !== '0') { const p = CT_PRESETS[+presetSel.value]; wc = p.wc; ww = p.ww; }
    render();
    ensurePrefetch();
  } catch (e) { if (!showGate.isCurrent(token)) return; busy(null); stat(T.cannotDisplay(e.message)); }
}
// buffered-span indicator under the slice slider (green where cached)
function drawBufBar() {
  const c = $('bufbar'); if (!c || !cur) return;
  const n = cur.instances.length, w = c.clientWidth || 300, h = 4;
  if (c.width !== w) c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#2e5c2e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5fd15f';
  for (let i = 0; i < n; i++) if (cache.has(cur.instances[i].name)) g.fillRect((i / n) * w, 0, Math.max(1, w / n), h);
  g.fillStyle = '#ffdf60'; const x = (idx / n) * w; g.fillRect(x - 1, 0, 2, h); // current position
}
// size the canvas backing store to device pixels (sharp on hi-DPI / retina and
// after A-/A+ zoom), then work in CSS pixels via the DPR transform
function fitCanvas() {
  const dpr = (window.devicePixelRatio || 1) * ((document.body.style.zoom && parseFloat(document.body.style.zoom) / 100) || 1);
  const w = vp.clientWidth, h = vp.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
function drawEmpty() {
  const { w, h } = fitCanvas();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  $('emptyTxt').textContent = T.emptyHint;
  $('emptyWhy').textContent = T.why;
  $('empty').style.display = 'flex';
}
// measure/angle markers + value label, shared by the screen render and PNG export
function drawMeasureOverlay(g, t, w, h) {
  if (!measure.length) { return; }
  g.strokeStyle = '#00e5ff'; g.fillStyle = '#00e5ff'; g.lineWidth = 1.5; g.font = '12px Tahoma';
  const P = measure.map((p) => img2scr(p, t));
  for (const [x, y] of P) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.stroke(); }
  const sp = frame.spacing;
  if (measureKind === 'measure' && P.length === 2) {
    g.beginPath(); g.moveTo(P[0][0], P[0][1]); g.lineTo(P[1][0], P[1][1]); g.stroke();
    const dxi = measure[1].x - measure[0].x, dyi = measure[1].y - measure[0].y;
    const label = sp ? `${Math.hypot(dxi * sp.c, dyi * sp.r).toFixed(1)} mm`
                     : `${Math.hypot(dxi, dyi).toFixed(0)} px (no pixel spacing)`;
    const lp = clampLabel((P[0][0] + P[1][0]) / 2 + 6, (P[0][1] + P[1][1]) / 2 - 6, w, h);
    g.fillText(label, lp.x, lp.y);
  } else if (measureKind === 'angle' && P.length >= 2) {
    g.beginPath(); g.moveTo(P[1][0], P[1][1]); g.lineTo(P[0][0], P[0][1]); g.stroke();
    if (P.length === 3) {
      g.beginPath(); g.moveTo(P[1][0], P[1][1]); g.lineTo(P[2][0], P[2][1]); g.stroke();
      // physical angle at the middle point (pixel spacing corrects non-square pixels)
      const v = (i) => [(measure[i].x - measure[1].x) * (sp ? sp.c : 1), (measure[i].y - measure[1].y) * (sp ? sp.r : 1)];
      const [ax, ay] = v(0), [bx, by] = v(2);
      const deg = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)))) * 180 / Math.PI;
      const la = clampLabel(P[1][0] + 8, P[1][1] - 8, w, h, 50);
      g.fillText(`${deg.toFixed(1)}°`, la.x, la.y);
    }
  }
}
function render() {
  const { w, h } = fitCanvas();
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  if (!frame) { drawEmpty(); return; }
  $('empty').style.display = 'none';
  const off = frame.bitmap ?? paint(frame, wc, ww, invert);
  // fit against the rotated footprint (90/270 swap width/height)
  const fw = rot % 2 ? frame.rows : frame.cols, fh = rot % 2 ? frame.cols : frame.rows;
  const base = Math.min(w / fw, h / fh) * zoom;
  const dw = frame.cols * base, dh = frame.rows * base;
  const cx = w / 2 + panX, cy = h / 2 + panY;
  lastTf = { base, cx, cy, rot, flipH, cols: frame.cols, rows: frame.rows };
  ctx.imageSmoothingEnabled = frame.bitmap ? true : base < 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot * Math.PI / 2);
  if (flipH) ctx.scale(-1, 1);
  ctx.drawImage(off, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  drawMeasureOverlay(ctx, lastTf, w, h);
  const p = bannerMeta || {};
  $('ovTL').textContent = [p.patient, p.pid && `ID: ${p.pid}`, p.dob && `DOB: ${p.dob}`, p.sex].filter(Boolean).join('\n');
  $('ovTR').textContent = [p.institution, p.study, p.studyDate].filter(Boolean).join('\n');
  $('ovBL').textContent = `S${cur.num ?? '?'} ${cur.modality} ${cur.desc}\nimg ${idx + 1}/${cur.instances.length}  ${frame.cols}x${frame.rows}`;
  $('ovBR').textContent = frame.bitmap ? `zoom ${(zoom * 100).toFixed(0)}%` : `WL ${Math.round(wc)} / WW ${Math.round(ww)}\nzoom ${(zoom * 100).toFixed(0)}%`;
  const rotTxt = `${rot ? ` · rot ${rot * 90}°` : ''}${flipH ? ' · mirrored' : ''}`;
  $('wlz').textContent = (frame.bitmap ? `zoom ${(zoom * 100).toFixed(0)}%` : `WL ${Math.round(wc)} · WW ${Math.round(ww)} · zoom ${(zoom * 100).toFixed(0)}%`) + rotTxt;
  let eo = null;
  // anatomical edge markers are only valid unrotated/unmirrored - hide rather than mislabel
  if (!rot && !flipH) try { if (frame.iop) eo = edgeOrientations(frame.iop.split('\\').map(parseFloat)); } catch {}
  $('edgeT').textContent = eo ? eo.top : ''; $('edgeB').textContent = eo ? eo.bottom : '';
  $('edgeL').textContent = eo ? eo.left : ''; $('edgeR').textContent = eo ? eo.right : '';
  drawBufBar();
}

// series previews, decoded after the stack is on screen: DL_CONCURRENCY readers over one queue, then the ones
// that failed (a 5G<->wifi switch dropped their fetch) retried with backoff; the open's signal ends it all
async function drawThumb(s) {
  try {
    const fr = await decodeInstance(s.instances[Math.floor(s.instances.length / 2)]);
    if (!s.el || !s.el.isConnected) return true;   // series list was replaced; nothing to draw
    s.el.querySelector('canvas').getContext('2d').drawImage(paint(fr, fr.wc0, fr.ww0, false), 0, 0, 48, 48);
    return true;
  } catch { return false; }
}
async function decodePreviews(signal) {
  const queue = series.slice(); const failed = []; const total = queue.length; let k = 0;
  async function worker() {
    for (;;) {
      const s = queue.shift();
      if (!s) return;
      const ok = await drawThumb(s);
      signal.throwIfAborted();
      if (!ok) failed.push(s);
      toast(`${T.loadingPreviews} ${++k}/${total}`, true);
    }
  }
  await Promise.all(Array.from({ length: DL_CONCURRENCY }, worker));
  for (let attempt = 1; attempt <= 4 && failed.length; attempt++) {
    await sleep(1500 * attempt, signal);
    const batch = failed.splice(0);
    const oks = await Promise.all(batch.map((s) => drawThumb(s)));
    signal.throwIfAborted();
    oks.forEach((ok, i) => { if (!ok) failed.push(batch[i]); });
  }
}

// ---- input wiring ----
const presetSel = $('preset');
presetSel.replaceChildren(...CT_PRESETS.map((p, i) => new Option(p.label, String(i))));
presetSel.onchange = () => { const p = CT_PRESETS[+presetSel.value]; if (p.wc != null) { wc = p.wc; ww = p.ww; } else if (frame) { wc = frame.wc0; ww = frame.ww0; } render(); };
$('bZip').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
  i.onchange = () => { if (i.files.length) void openAny({ files: i.files }); }; i.click(); };
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) void openAny({ files: e.dataTransfer.files }); });
$('bDir').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.webkitdirectory = true;
  i.onchange = () => { if (i.files.length) void openAny({ files: i.files }); }; i.click(); };
// demo scans: download the whole zip, then the user opens it locally - streaming
// buffer pauses felt slow and put people off, and a 1.2 GB download on wifi/5G is
// quick. The URL path (HTTP Range streaming) is kept for the #load=/#cap= dev hooks.
const DEMOS = {
  small: { url: '/dicom-demo/scds_ct_small_demo.zip' },
  ct: { url: '/dicom-demo/scds_ct_demo.zip' },
  mri: { url: '/dicom-demo/scds_mri_demo.zip' },
};
function downloadDemo(key) {
  const a = document.createElement('a');
  a.href = DEMOS[key].url; a.download = ''; a.click();     // same-origin (worker proxies R2), so download works
  toast(T.demoDl, true);
}
$('demoSmallBtn').onclick = () => downloadDemo('small');
$('demoCtBtn').onclick = () => downloadDemo('ct');
$('demoMriBtn').onclick = () => downloadDemo('mri');
// share: native sheet on phones (LINE/WhatsApp etc.), copy-link on desktop. No tracking.
async function shareTool() {
  const url = 'https://www.clearevo.com/dicom/';
  if (navigator.share) { try { await navigator.share({ title: APP_NAME, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(url); toast(T.shareCopied); } catch { toast(`${T.shareManual} ${url}`, true); }
}
$('shareBtn').onclick = () => { void shareTool(); };
$('aboutShare').onclick = () => { void shareTool(); };
// blink the open buttons until a scan is opened - the one action the start page needs
function setOpenBlink(on) { for (const id of ['bZip', 'bDir']) $(id).classList.toggle('blinkOpen', on); }
setOpenBlink(true);
const TOOLS = [['tBrowse', 'browse'], ['tWL', 'wl'], ['tPan', 'pan'], ['tZoom', 'zoom'], ['tMeasure', 'measure'], ['tAngle', 'angle']];
// animated gesture hint: a finger acting out the tool's drag over the viewport for a few seconds
const GESTURES = { browse: ['gestV', () => T.gBrowse], wl: ['gestCross', () => (mode === 'simple' ? T.gWLSimple : T.gWL)], pan: ['gestCross', () => T.gPan], zoom: ['gestV', () => T.gZoom], measure: ['gestTap', () => T.gMeasure], angle: ['gestTap', () => T.gAngle] };
let gestTimer = 0;
function showGesture(t) {
  const g = GESTURES[t]; if (!g) return;
  $('gesture').style.display = 'flex';
  $('gestIcon').style.animation = `${g[0]} 1.5s ease-in-out infinite`;
  $('gestTxt').textContent = g[1]();
  clearTimeout(gestTimer);
  gestTimer = setTimeout(hideGesture, 3200);
}
function hideGesture() { $('gesture').style.display = 'none'; $('gestIcon').style.animation = ''; }
for (const [id, t] of TOOLS) {
  $(id).onclick = () => { tool = t; for (const [id2, t2] of TOOLS) $(id2).classList.toggle('on', t2 === tool); showGesture(t); };
}
$('bMUndo').onclick = () => { if (measure.length) { measure.pop(); render(); } };
async function showTags() {
  const el = $('tags');
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  if (!frame || !cur) return;
  // cached slices are stripped of their dataset (memory) - re-decode on demand
  const shown = frame;
  let ds = frame.ds;
  if (!ds) { try { ds = (await decodeInstance(cur.instances[idx])).ds; } catch { return; } }
  if (frame !== shown) return;                        // the user moved on while the slice was re-read
  const rows = [];
  for (const k of Object.keys(ds.elements).sort()) {
    const e = ds.elements[k];
    let v = '';
    if (e.length < 200 && !e.items && k !== 'x7fe00010') { try { v = ds.string(k) ?? ''; } catch {} }
    rows.push(`(${k.slice(1, 5)},${k.slice(5)}) ${e.vr || '  '} len=${String(e.length).padStart(7)}  ${v}`);
  }
  el.textContent = rows.join('\n');
  el.style.display = 'block';
}
$('bTags').onclick = () => { void showTags(); };
$('bReset').onclick = () => { zoom = 1; panX = panY = 0; rot = 0; flipH = false; $('bFlip').classList.remove('on'); if (frame) { wc = frame.wc0; ww = frame.ww0; } presetSel.value = '0'; render(); };
$('bRotate').onclick = () => { rot = (rot + 1) % 4; render(); };
$('bFlip').onclick = () => { flipH = !flipH; $('bFlip').classList.toggle('on', flipH); render(); };
// snapshot: save the current windowed slice as a native-resolution PNG.
// Toast the file name on success (on phones the save is otherwise silent).
function defaultPngName() {
  const nm = ((bannerMeta && bannerMeta.patient) || 'image').replace(/[^\w-]+/g, '_');
  return `${nm}_S${cur ? cur.num : 0}_${idx + 1}`;
}
function capturePng(name) {
  try {
    const off = frame.bitmap ?? paint(frame, wc, ww, invert);
    // native resolution, but what the clinician sees: rotation/flip + measurements
    const t = exportTransform(frame.cols, frame.rows, rot, flipH);
    const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
    const g = c.getContext('2d');
    g.translate(t.cx, t.cy); g.rotate(rot * Math.PI / 2);
    if (flipH) { g.scale(-1, 1); }
    g.drawImage(off, -frame.cols / 2, -frame.rows / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    drawMeasureOverlay(g, t, t.w, t.h);
    const fn = `${String(name).replace(/\.png$/i, '').replace(/[^\w.-]+/g, '_') || 'image'}.png`;
    const a = document.createElement('a'); a.href = c.toDataURL('image/png');
    a.download = fn; a.click();
    toast(`${fn} ${T.pngSaved}`);
  } catch (e) { toast(T.pngFail + e.message); }
}
$('bCapture').onclick = () => { if (frame) capturePng(defaultPngName()); };
// "PNG as…" asks for the name in a dialog of the page, never the browser prompt box (house rule); Enter saves, Escape cancels
function closePngDlg() { $('pngDlg').style.display = 'none'; }
$('bCaptureAs').onclick = () => {
  if (!frame) return;
  $('pngName').value = defaultPngName(); $('pngDlg').style.display = 'flex'; $('pngName').focus(); $('pngName').select();
};
$('pngOk').onclick = () => { const name = $('pngName').value.trim(); closePngDlg(); if (name && frame) capturePng(name); };
$('pngCancel').onclick = closePngDlg;
$('pngName').onkeydown = (e) => { if (e.key === 'Enter') $('pngOk').click(); if (e.key === 'Escape') closePngDlg(); };
$('pngDlg').onclick = (e) => { if (e.target === $('pngDlg')) closePngDlg(); };
// cine loop through the series - button toggles play <-> pause (icon + label)
// cine is a lifecycle: one loop under one AbortController (house rule); Stop aborts it, a series switch too
let cine = null;
async function cineRun(signal) {
  try {
    for (;;) {
      await sleep(cur.frameTimeMs || 110, signal);
      if (signal.aborted) return;
      await show(cineNext(idx, cur.instances.length));
    }
  } catch (e) { if (!isAbort(e)) throw e; }
}
const CINE_PLAY = '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>';
const CINE_PAUSE = '<rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none"/>';
function setCineUI(playing) {
  const btn = $('bCine');
  btn.querySelector('svg').innerHTML = playing ? CINE_PAUSE : CINE_PLAY;
  btn.querySelector('.lbl').textContent = playing ? T.pause : (mode === 'simple' ? T.playSimple : T.cine);
  btn.classList.toggle('on', playing);
}
function stopCine() { if (cine) { cine.abort(); cine = null; } setCineUI(false); }
$('bCine').onclick = () => {
  if (cine) { stopCine(); return; }
  if (!ready || !cur || cur.instances.length < 2) return;
  cine = new AbortController();
  void cineRun(cine.signal);
  setCineUI(true);
};
$('tBrowse').classList.add('on');   // Browse (slice scroll) active by default - what phone users want first
$('bInvert').onclick = () => { invert = !invert; render(); };
$('bAbout').onclick = () => { $('about').style.display = 'flex'; };
$('aboutClose').onclick = () => { $('about').style.display = 'none'; };
$('about').onclick = (e) => { if (e.target === $('about')) $('about').style.display = 'none'; };
$('bPrev').onclick = () => { if (ready) void show(idx - 1); };
$('bNext').onclick = () => { if (ready) void show(idx + 1); };
$('slice').oninput = () => { if (ready) void show(+$('slice').value); };
vp.addEventListener('wheel', (e) => {
  e.preventDefault();
  const a = wheelAction(e.ctrlKey, e.deltaY, zoom);
  if (a.zoom !== undefined) { if (frame) { zoom = a.zoom; render(); } }
  else if (ready) void show(idx + a.step);
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('about').style.display = 'none'; $('tags').style.display = 'none'; closePngDlg(); }
  if (e.ctrlKey || e.metaKey) {   // Ctrl +/- zooms the image (not the browser)
    if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom = clampZoom(zoom * 1.2); render(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom = clampZoom(zoom / 1.2); render(); }
    else if (e.key === '0') { e.preventDefault(); zoom = 1; panX = panY = 0; render(); }
    return;
  }
  if (!ready) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') void show(idx + 1);
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') void show(idx - 1);
});
window.addEventListener('resize', render);

// pointer: mouse drag + touch (1-finger tool, 2-finger pinch zoom / pan)
const pts = new Map();
let pinchD = 0, browseAcc = 0;
vp.addEventListener('pointerdown', (e) => {
  // don't capture the pointer for overlay controls (demo buttons etc.) - capture
  // steals the pointerup and the button never gets its click.
  if (/** @type {HTMLElement} */ (e.target).closest('button, select, a, input')) return;
  hideGesture();   // user is doing the gesture - get the demo out of the way
  vp.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0 });
  if (pts.size === 2) {
    const [a, b] = [...pts.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    if (strayPinchPoint(tool, pts.size, measure.length)) { measure.pop(); render(); }
  }
  if ((tool === 'measure' || tool === 'angle') && frame && lastTf && pts.size === 1) {
    const r = vp.getBoundingClientRect();
    const cap = tool === 'angle' ? 3 : 2;
    if (measureKind !== tool || measure.length >= cap) measure = [];
    measureKind = tool;
    const lp = clickToLocal(e.clientX, e.clientY, r, vp.clientWidth, vp.clientHeight);
    measure.push(scr2img(lp.x, lp.y)); render();
  }
  // double-tap: photo-app zoom toggle
  const now = performance.now();
  if (pts.size === 1 && dblTapZooms(tool, now - lastTap)) { zoom = dblTapZoomToggle(zoom); if (zoom === 1) { panX = panY = 0; } render(); }
  lastTap = now;
});
vp.addEventListener('pointerup', (e) => { pts.delete(e.pointerId); browseAcc = 0; });
vp.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); browseAcc = 0; });
vp.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const k = localScale(vp.getBoundingClientRect(), vp.clientWidth);
  const dx = (e.clientX - p.x) * k, dy = (e.clientY - p.y) * k;
  if (pts.size === 2) {
    p.x = e.clientX; p.y = e.clientY;
    const [a2, b2] = [...pts.values()];
    const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
    if (pinchD) zoom = clampZoom(zoom * (d2 / pinchD));
    pinchD = d2;
    panX += dx / 2; panY += dy / 2;
    render();
    return;
  }
  p.x = e.clientX; p.y = e.clientY;
  if (tool === 'wl' && frame && !frame.bitmap) { ({ wc, ww } = wlDrag(wc, ww, dx, dy)); render(); }
  else if (tool === 'pan') { panX += dx; panY += dy; render(); }
  else if (tool === 'zoom') { zoom = clampZoom(zoom * (1 - dy / 150)); render(); }
  else if (tool === 'browse' && cur && ready) {
    // Browse always scrolls slices, even when zoomed in (pan is on the Pan tool /
    // two fingers) - otherwise picking Browse while zoomed just panned the image.
    const step = Math.max(24, vp.clientHeight / Math.max(1, cur.instances.length));
    const r = browseSteps(browseAcc, Math.abs(dx) > Math.abs(dy) ? dx : dy, step);
    browseAcc = r.acc;
    if (r.steps) void show(idx + r.steps);
  }
});
// keep clicks/drags on the source badge (the "download full CD" link) from being
// captured by the viewport's pointer handlers (which would scroll instead of click)
['pointerdown', 'pointerup', 'pointermove', 'click'].forEach((ev) => $('srcbadge').addEventListener(ev, (e) => e.stopPropagation()));
$('lang').onchange = () => { localStorage.setItem('ce_lang', $('lang').value); applyLang($('lang').value); };
function applyMode(m) {
  mode = m; localStorage.setItem('ce_mode', m);
  document.body.classList.toggle('simple', m === 'simple');
  if (m === 'simple') { if (tool === 'pan') $('tBrowse').click(); $('tags').style.display = 'none'; }
  applyLang($('lang').value);
}
$('mode').onchange = () => applyMode($('mode').value);
applyLang(detectLang());
applyMode(mode);
drawEmpty();
// test/demo hook: #load=<same-origin zip url>
if (location.hash.startsWith('#load=')) {
  const u = location.hash.slice(6);
  void openAny({ url: u, label: u.split('/').pop() });
}
// dev screenshot hook: #cap=<url>||<seriesIdx>||<sliceIdx> - load, pick series, show slice
async function capHook() {
  const [u, si, ii] = decodeURIComponent(location.hash.slice(5)).split('||');
  await openAny({ url: u, label: u.split('/').pop() });
  if (series[+si]) await selectSeries(series[+si]);
  await show(+ii);
  if (frame) $('srcbadge').style.display = 'none';
}
if (location.hash.startsWith('#cap=')) void capHook();
