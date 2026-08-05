import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------- doctor ----------
import { createDoctor, doctorReply, reflect, GREETING } from '../public/doctor/logic.js';

test('doctor: reflection swaps person', () => {
  assert.equal(reflect('i am sad about my job'), 'you are sad about your job');
});
test('doctor: keyword rules and reflected capture', () => {
  const s = createDoctor();
  assert.match(doctorReply('I am lonely', s), /you are lonely/i);
  assert.match(doctorReply('I dreamt of the sea', s), /dream/i);
  assert.match(doctorReply('goodbye', s), /secretary will send you a bill/);
});
test('doctor: fallbacks rotate, no immediate repeat', () => {
  const s = createDoctor();
  const a = doctorReply('xyzzy plugh', s);
  const b = doctorReply('xyzzy plugh', s);
  assert.notEqual(a, b);
});
test('doctor: greeting is the doctor.el text', () => {
  assert.match(GREETING, /I am the psychotherapist/);
  assert.match(GREETING, /type RET twice/);
});

// ---------- calc ----------
import { createCalc, pressDigit, enter, op, undo, render } from '../public/calc/logic.js';

function type(s, str) { for (const c of str) pressDigit(c, s); }
test('calc: RPN 3 RET 4 + = 7, trail records it', () => {
  const s = createCalc();
  type(s, '3'); enter(s); type(s, '4'); op('+', s);
  assert.deepEqual(s.stack, [7]);
  assert.match(s.trail.join('\n'), /\+ {4,}7/);
});
test('calc: RET on empty entry duplicates, TAB swaps', () => {
  const s = createCalc();
  type(s, '5'); enter(s); enter(s);
  assert.deepEqual(s.stack, [5, 5]);
  type(s, '2'); enter(s); op('TAB', s);
  assert.deepEqual(s.stack, [5, 2, 5]);
});
test('calc: unary ops and undo', () => {
  const s = createCalc();
  type(s, '9'); op('Q', s);
  assert.deepEqual(s.stack, [3]);
  assert.equal(undo(s), null);
  assert.deepEqual(s.stack, [9]);
  const s2 = createCalc();
  assert.match(undo(s2), /No further undo/);
});
test('calc: render looks like the *Calculator* buffer', () => {
  const s = createCalc();
  type(s, '3'); enter(s); type(s, '4'); enter(s);
  assert.equal(render(s), '2:  3\n1:  4\n    .');
});

// ---------- isearch ----------
import { createSearch, findAll, extend, repeat, echoLine } from '../public/isearch/logic.js';

test('isearch: smart case folding', () => {
  assert.equal(findAll('Foo foo FOO', 'foo').length, 3);
  assert.equal(findAll('Foo foo FOO', 'Foo').length, 1);
});
test('isearch: fail then repeat wraps like emacs', () => {
  const text = 'aba aba';
  const s = createSearch();
  const m = extend(s, text, 'aba');
  assert.equal(s.cur, 0);
  repeat(s, m, 1);
  assert.equal(s.cur, 4);
  repeat(s, m, 1);              // past last -> failing
  assert.equal(s.failing, true);
  assert.match(echoLine(s), /^Failing I-search: aba/);
  repeat(s, m, 1);              // repeat after fail -> wrap
  assert.equal(s.cur, 0);
  assert.equal(s.wrapped, true);
  assert.match(echoLine(s), /^Wrapped I-search: aba/);
});
test('isearch: backward prompt wording', () => {
  const s = createSearch();
  s.active = true; s.dir = -1; s.query = 'q';
  assert.equal(echoLine(s), 'I-search backward: q');
});

// ---------- hex ----------
import { parseHexBytes, parseBitString, searchBytes, searchBits, rowData, createEdit, setByte } from '../public/hex/logic.js';

test('hex: parseHexBytes accepts separators, rejects junk', () => {
  assert.deepEqual([...parseHexBytes('DE AD-be,ef')], [0xde, 0xad, 0xbe, 0xef]);
  assert.deepEqual([...parseHexBytes('0x01 0x02')], [1, 2]);
  assert.equal(parseHexBytes('xyz'), null);
  assert.equal(parseHexBytes('abc'), null); // odd length
});
test('hex: searchBytes finds and wraps', () => {
  const hay = new Uint8Array([1, 2, 3, 4, 1, 2, 3]);
  const needle = new Uint8Array([2, 3]);
  assert.equal(searchBytes(hay, needle, 0), 1);
  assert.equal(searchBytes(hay, needle, 2), 5);
  assert.equal(searchBytes(hay, needle, 6), 1); // wrap
});
test('hex: searchBits matches across octet boundaries', () => {
  // 0x0F 0xF0 = 00001111 11110000 -> 11111111 starts at bit 4 of byte 0
  const hay = new Uint8Array([0x0f, 0xf0]);
  const r = searchBits(hay, parseBitString('1111 1111'));
  assert.deepEqual(r, { byte: 0, bit: 4 });
  // byte-aligned still works
  assert.deepEqual(searchBits(new Uint8Array([0xff]), '11111111'), { byte: 0, bit: 0 });
  assert.equal(searchBits(new Uint8Array([0x00, 0x00]), '11111111'), null);
});
test('hex: edit model tracks modifications', () => {
  const ed = createEdit(new Uint8Array([0, 0, 0]));
  assert.equal(setByte(ed, 1, 0xab), true);
  assert.equal(ed.bytes[1], 0xab);
  assert.deepEqual([...ed.modified], [1]);
  assert.equal(setByte(ed, 99, 1), false);
});
test('hex: rowData formats a row', () => {
  const r = rowData(new Uint8Array([0x41, 0x00, 0x7f]), 0);
  assert.deepEqual(r.hex, ['41', '00', '7F']);
  assert.equal(r.ascii, 'A..');
  assert.equal(r.off, '00000000');
});
import { parseNumber, numFits, autoNumType, numToBytes, bitsToNumber } from '../public/hex/logic.js';
test('hex: number search parse/type/encode', () => {
  assert.equal(parseNumber('0x1F4'), 500n);
  assert.equal(parseNumber('-42'), -42n);
  assert.equal(parseNumber('12a'), null);
  assert.equal(autoNumType(200n), 'u8');
  assert.equal(autoNumType(-1n), 'i8');
  assert.equal(autoNumType(70000n), 'u32');
  assert.equal(autoNumType(1n << 64n), null);
  assert.equal(numFits(256n, 'u8'), false);
  assert.equal(numFits(-1n, 'u16'), false);
  assert.deepEqual([...numToBytes(500n, 'u16', true)], [0xF4, 0x01]);
  assert.deepEqual([...numToBytes(500n, 'u16', false)], [0x01, 0xF4]);
  assert.deepEqual([...numToBytes(-2n, 'i16', false)], [0xFF, 0xFE]);
  assert.equal(bitsToNumber('101100111'), 359n);
});

// ---------- geo ----------
import { sizeCheck as geoSize, buildArgs as geoArgs, outName as geoOut, shpHint } from '../public/geo/logic.js';
test('geo: size check, args, names', () => {
  assert.equal(geoSize(1048576), null);
  assert.ok(geoSize(150 * 1048576).warn);
  assert.match(geoSize(400 * 1048576), /limit/);
  assert.deepEqual(geoArgs('GPX', ' EPSG:4326 '), ['-f', 'GPX', '-t_srs', 'EPSG:4326']);
  assert.deepEqual(geoArgs('KML', ''), ['-f', 'KML']);
  assert.equal(geoOut('track.shp', 'geojson'), 'track.geojson');
  assert.match(shpHint(['a.SHP']), /dbf/);
  assert.equal(shpHint(['a.shp', 'a.dbf']), null);
});

// ---------- qr ----------
import { wifiEscape, wifiPayload, buildPayload, capacityCheck } from '../public/qr/logic.js';
test('qr: payloads and capacity', () => {
  assert.equal(wifiEscape('a;b:c"d\\e,f'), 'a\\;b\\:c\\"d\\\\e\\,f');
  assert.equal(wifiPayload('MyNet', 'p;w', 'WPA', false), 'WIFI:T:WPA;S:MyNet;P:p\\;w;;');
  assert.equal(wifiPayload('Open', '', 'nopass', true), 'WIFI:T:nopass;S:Open;H:true;;');
  assert.match(buildPayload('vcard', { name: 'A B', phone: '1', email: 'a@b.c', org: '' }), /BEGIN:VCARD[\s\S]*TEL:1/);
  assert.equal(buildPayload('tel', { text: ' 123 ' }), 'tel:123');
  assert.equal(capacityCheck('x'.repeat(100), 'M'), null);
  assert.match(capacityCheck('x'.repeat(3000), 'M'), /max/);
});

// ---------- audio ----------
import { sizeCheck as auSize, buildArgs as auArgs, outName as auOut, OUT_FORMATS as AU } from '../public/audio/logic.js';
test('audio: size check, args, names', () => {
  assert.equal(auSize(1048576), null);
  assert.ok(auSize(200 * 1048576).warn);
  assert.match(auSize(600 * 1048576), /limited/);
  assert.match(auSize(300 * 1048576, 1), /working memory/);
  const mp3 = AU.find((f) => f.ext === 'mp3');
  assert.deepEqual(auArgs('in.mp4', mp3, 'out.mp3'), ['-i', 'in.mp4', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', 'out.mp3']);
  assert.equal(auOut('video.mp4', 'mp3'), 'video.mp3');
  assert.equal(auOut('song.mp3', 'mp3'), 'song_converted.mp3');
});

import { kmzExtractKml } from '../public/geo/logic.js';
import zlib from 'node:zlib';
function makeZip(entries) { // [{name, data(Buffer), method}]
  const parts = [], cd = [];
  let off = 0;
  for (const e of entries) {
    const stored = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(e.method, 8);
    lh.writeUInt32LE(stored.length, 18); lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(e.name.length, 26);
    parts.push(lh, Buffer.from(e.name), stored);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(e.method, 10);
    c.writeUInt32LE(stored.length, 20); c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(e.name.length, 28); c.writeUInt32LE(off, 42);
    cd.push(Buffer.concat([c, Buffer.from(e.name)]));
    off += 30 + e.name.length + stored.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts.flat(), cdBuf, eocd]));
}
const nodeInflate = async (u8, maxBytes) => { const out = new Uint8Array(zlib.inflateRawSync(u8)); return maxBytes ? out.subarray(0, maxBytes) : out; };
test('geo: kmz extraction, stored and deflated', async () => {
  const kml = Buffer.from('<kml>hello</kml>');
  const zStored = makeZip([{ name: 'img.png', data: Buffer.from('x'), method: 0 }, { name: 'doc.kml', data: kml, method: 0 }]);
  assert.equal(Buffer.from(await kmzExtractKml(zStored, nodeInflate)).toString(), '<kml>hello</kml>');
  const zDeflate = makeZip([{ name: 'doc.KML', data: kml, method: 8 }]);
  assert.equal(Buffer.from(await kmzExtractKml(zDeflate, nodeInflate)).toString(), '<kml>hello</kml>');
  await assert.rejects(() => kmzExtractKml(new Uint8Array([1, 2, 3]), nodeInflate), /not a valid/);
  await assert.rejects(() => kmzExtractKml(makeZip([{ name: 'a.txt', data: kml, method: 0 }]), nodeInflate), /no \.kml/);
});

// ---------- dicom ----------
import { zipEntries, zipData, tarEntries, JUNK_RE as DJUNK, looksDicom, groupSeries, firstNum, makeLut, makeLatestGate } from '../public/dicom/logic.js';

test('dicom: latest-gate discards a stale async decode (rapid slider drag)', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const gate = makeLatestGate();
  const painted = [];
  // show A starts first but decodes slower; show B starts right after but faster.
  // Only the latest call (B) may paint; the stale earlier result (A) is dropped.
  const runA = (async () => { const t = gate.next(); await sleep(40); if (gate.isCurrent(t)) painted.push('A'); })();
  const runB = (async () => { const t = gate.next(); await sleep(5); if (gate.isCurrent(t)) painted.push('B'); })();
  await Promise.all([runA, runB]);
  assert.deepEqual(painted, ['B']);
  // token invariants: only the most recent next() is current
  const g = makeLatestGate();
  const a = g.next(); const b = g.next();
  assert.equal(g.isCurrent(a), false);
  assert.equal(g.isCurrent(b), true);
  assert.equal(g.isCurrent(g.next()), true);
});
test('dicom: zip range-reader entries + extract', async () => {
  const kml = Buffer.from('x'.repeat(500));
  const z = makeZip([{ name: 'DICOM/A1', data: kml, method: 8 }, { name: 'AUTORUN.INF', data: Buffer.from('y'), method: 0 }]);
  const readRange = async (off, len) => z.subarray(off, off + len);
  const es = await zipEntries(readRange, z.length);
  assert.equal(es.length, 2);
  const dicom = es.find((e) => e.name === 'DICOM/A1');
  const all = await zipData(readRange, dicom, nodeInflate);
  assert.equal(all.length, 500);
  const head = await zipData(readRange, dicom, nodeInflate, 100);
  assert.equal(head.length, 100);
});
test('dicom: tar indexes contiguous files via range reads', async () => {
  const enc = new TextEncoder();
  const mkTar = (files) => {
    const blocks = [];
    for (const f of files) {
      const h = new Uint8Array(512);
      h.set(enc.encode(f.name), 0);
      h.set(enc.encode(f.data.length.toString(8).padStart(11, '0')), 124);
      h[156] = 0x30;                                  // typeflag '0' = file
      h.set(enc.encode('ustar\0'), 257);
      blocks.push(h);
      const d = new Uint8Array(Math.ceil(f.data.length / 512) * 512);
      d.set(f.data, 0); blocks.push(d);
    }
    blocks.push(new Uint8Array(512));                 // end-of-archive zero block
    const total = blocks.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const b of blocks) { out.set(b, o); o += b.length; }
    return out;
  };
  const buf = mkTar([{ name: 'DICOMDIR', data: enc.encode('HELLO') }, { name: 'IMG/0001.dcm', data: enc.encode('DICOMDATA!') }]);
  const readRange = async (off, len) => buf.subarray(off, off + len);
  const es = await tarEntries(readRange, buf.length);
  assert.equal(es.length, 2);
  assert.equal(es[0].name, 'DICOMDIR');
  assert.equal(es[1].name, 'IMG/0001.dcm');
  const got = await readRange(es[1].dataOff, es[1].size);   // one range read = exactly that file
  assert.equal(new TextDecoder().decode(got), 'DICOMDATA!');
});
test('dicom: junk filter, magic, grouping, lut', () => {
  assert.ok(DJUNK.test('Autorun/Autorun.exe'));
  assert.ok(DJUNK.test('VIEWER/VIEWDIRT.HLP'));
  assert.ok(DJUNK.test('DICOMDIR'));
  assert.ok(!DJUNK.test('DICOM/68DB8FC0'));
  const b = new Uint8Array(200); b.set([0x44, 0x49, 0x43, 0x4d], 128);
  assert.ok(looksDicom(b));
  assert.ok(!looksDicom(new Uint8Array(200)));
  const s = groupSeries([
    { seriesUID: 'b', seriesNum: 2, instance: 2, name: 'x2' },
    { seriesUID: 'b', seriesNum: 2, instance: 1, name: 'x1' },
    { seriesUID: 'a', seriesNum: 1, instance: 5, name: 'y' }]);
  assert.equal(s[0].uid, 'a');
  assert.equal(s[1].instances[0].instance, 1);
  assert.equal(firstNum('40\\80'), 40);
  assert.equal(firstNum(''), null);
  const lut = makeLut(1, -1024, 40, 400, false); // CT soft tissue
  assert.equal(lut(1064), 128);   // HU 40 = center
  assert.equal(lut(0), 0);        // air clamps low
  assert.equal(lut(4000), 255);   // bone clamps high
});

import { normKey, seriesFromDicomdirRecords, makeResolver } from '../public/dicom/logic.js';
test('dicom: normKey + DICOMDIR record walk (pure, index-first)', () => {
  assert.equal(normKey('DICOM\\68DB8FC0'), 'DICOM/68DB8FC0');
  assert.equal(normKey('/dicom/img'), 'DICOM/IMG');
  // synthetic DICOMDIR: 2 series, images referenced by file id, some missing
  const items = { 'DICOM/A1': { name: 'DICOM/A1' }, 'DICOM/A2': { name: 'DICOM/A2' }, 'DICOM/B1': { name: 'DICOM/B1' } };
  const records = [
    { type: 'PATIENT' }, { type: 'STUDY' },
    { type: 'SERIES', seriesUID: 's1', seriesNum: 2, modality: 'CT' },
    { type: 'IMAGE', fid: 'DICOM\\A2', instance: 2 },
    { type: 'IMAGE', fid: 'DICOM\\A1', instance: 1 },
    { type: 'IMAGE', fid: 'DICOM\\MISSING', instance: 3 }, // file not present -> skipped
    { type: 'SERIES', seriesUID: 's2', seriesNum: 1, modality: 'MR' },
    { type: 'IMAGE', fid: 'DICOM\\B1', instance: 1 },
  ];
  const metas = seriesFromDicomdirRecords(records, (k) => items[k]);
  assert.equal(metas.length, 3);                       // MISSING dropped, no per-file read needed
  const series = groupSeries(metas);
  assert.equal(series.length, 2);
  assert.equal(series[0].uid, 's2');                   // sorted by series number (1 before 2)
  assert.equal(series[1].instances[0].instance, 1);    // images sorted by instance within series
  assert.equal(series[1].instances[0].name, 'DICOM/A1');
  assert.equal(seriesFromDicomdirRecords([{ type: 'IMAGE', fid: 'X' }], () => undefined).length, 0); // image before any series
});

test('dicom: DICOMDIR resolver handles root and wrapped-subdir zips', () => {
  const records = [{ type: 'SERIES', seriesUID: 's', seriesNum: 1, modality: 'CT' }, { type: 'IMAGE', fid: 'DICOM\\A1', instance: 1 }];
  // byName is keyed by normKey(name), exactly as the app builds it
  const mk = (names) => new Map(names.map((n) => [normKey(n), { name: n }]));
  // case 1: CD zipped at root - DICOMDIR at top
  let metas = seriesFromDicomdirRecords(records, makeResolver(mk(['DICOM/A1', 'DICOMDIR']), 'DICOMDIR'));
  assert.equal(metas.length, 1);
  assert.equal(metas[0].name, 'DICOM/A1');
  // case 2: user wrapped the CD in a folder - files under MYCD/, DICOMDIR at MYCD/DICOMDIR
  metas = seriesFromDicomdirRecords(records, makeResolver(mk(['MYCD/DICOM/A1', 'MYCD/DICOMDIR']), 'MYCD/DICOMDIR'));
  assert.equal(metas.length, 1);
  assert.equal(metas[0].name, 'MYCD/DICOM/A1');
  // case 3: nested deeper still resolves
  metas = seriesFromDicomdirRecords(records, makeResolver(mk(['a/b/DICOM/A1']), 'a/b/DICOMDIR'));
  assert.equal(metas.length, 1);
});

// ---------- dicom: real HTTP Range streaming integration ----------
// spins a minimal range-capable static server (any range server works -
// caddy, rust static-web-server, python RangeHTTPServer; we inline one so
// the test needs no external dependency) and drives the SAME zip index
// reader the viewer uses over real HTTP Range requests.
import http from 'node:http';
import os from 'node:os';
import { writeFileSync, createReadStream, statSync, unlinkSync } from 'node:fs';
test('dicom: zip index + slice read over real HTTP Range (streaming)', async () => {
  // 24 uncompressed 'slices' of 40KB each ~= a small CD; we open the index + 3
  const N = 24, SZ = 40000, payloads = {};
  const spec = [{ name: 'AUTORUN.INF', data: Buffer.from('x'), method: 0 }];
  for (let i = 0; i < N; i++) { const nm = `DICOM/IMG${i}`; payloads[nm] = Buffer.alloc(SZ, 65 + (i % 26)); spec.push({ name: nm, data: payloads[nm], method: 0 }); }
  const zip = makeZip(spec);
  const tmp = os.tmpdir() + '/dcm_stream_' + process.pid + '.zip';
  writeFileSync(tmp, zip);
  let served206 = 0, servedBytes = 0;
  const server = http.createServer((req, res) => {
    const st = statSync(tmp);
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = +m[1], end = m[2] ? +m[2] : st.size - 1;
      served206++; servedBytes += end - start + 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(tmp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(tmp).pipe(res);
    }
  });
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/cd.zip`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const size = +head.headers.get('content-length');
    assert.equal(size, zip.length);
    const readRange = async (off, len) => {
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
      assert.equal(r.status, 206, 'server must answer Range with 206');
      return new Uint8Array(await r.arrayBuffer());
    };
    // index the archive over HTTP, then read each entry's bytes - same path as the viewer
    const entries = await zipEntries(readRange, size);
    const dicom = entries.filter((e) => /^DICOM\//.test(e.name));
    assert.equal(dicom.length, N);
    const afterIndex = servedBytes;
    // open only 3 'slices' (first, middle, last) - like scrolling a few images
    for (const e of [dicom[0], dicom[12], dicom[N - 1]]) {
      const bytes = await zipData(readRange, e, nodeInflate);
      assert.equal(Buffer.from(bytes).toString(), payloads[e.name].toString());
    }
    assert.ok(served206 >= 4, 'used Range requests (206)');
    assert.ok(afterIndex < size / 2, `index read ${afterIndex}B stayed small vs ${size}B`);
    assert.ok(servedBytes < size, `streamed ${servedBytes}B < full ${size}B (never downloaded whole)`);
  } finally {
    await new Promise((r) => server.close(r));
    unlinkSync(tmp);
  }
});

import { evictKeys } from '../public/dicom/logic.js';
test('dicom: cache eviction keeps current window, drops farthest/other-series', () => {
  // keys are unique image ids; indexOf maps to position in CURRENT series (null = other series)
  const cur = { A:0, B:1, C:2, D:3, E:4 };
  const other = { X:null, Y:null };
  const indexOf = (k) => (k in cur ? cur[k] : null);
  // over cap by 2 at idx=2: farthest (A d=2, E d=2) should go before near ones; current (C) never
  let ev = evictKeys(['A','B','C','D','E'], indexOf, 2, 3);
  assert.equal(ev.length, 2);
  assert.ok(!ev.includes('C'));                 // never evict the current slice
  assert.deepEqual(ev.sort(), ['A','E']);       // the two farthest
  // other-series keys (index null -> Infinity distance) are evicted first
  const idxOf2 = (k) => (k in cur ? cur[k] : (k in other ? other[k] : null));
  ev = evictKeys(['A','B','X','Y'], idxOf2, 1, 2);
  assert.deepEqual(ev.sort(), ['X','Y']);       // both cross-series dropped, current-series A/B kept
  assert.deepEqual(evictKeys(['A','B'], indexOf, 1, 5), []); // under cap: nothing
});
test('dicom: DICOMDIR-resolved instances have unique ids (safe cache key)', () => {
  const records = [
    { type: 'SERIES', seriesUID: 's1', seriesNum: 1, modality: 'CT' },
    { type: 'IMAGE', fid: 'DICOM\\A', instance: 1 }, { type: 'IMAGE', fid: 'DICOM\\B', instance: 2 },
    { type: 'SERIES', seriesUID: 's2', seriesNum: 2, modality: 'CT' },
    { type: 'IMAGE', fid: 'DICOM\\C', instance: 1 },
  ];
  const items = new Map([['DICOM/A',{name:'DICOM/A'}],['DICOM/B',{name:'DICOM/B'}],['DICOM/C',{name:'DICOM/C'}]]);
  const metas = seriesFromDicomdirRecords(records, makeResolver(items, 'DICOMDIR'));
  const names = metas.map((m) => m.name);
  assert.equal(new Set(names).size, names.length);  // all image ids unique across series -> no cross-series cache collision
});

import { orientationString, edgeOrientations } from '../public/dicom/logic.js';
test('dicom: anatomical orientation markers from ImageOrientationPatient', () => {
  // axial (rows L->R as +x Left, cols A->P as +y Posterior): top=A bottom=P left=R right=L
  assert.deepEqual(edgeOrientations([1, 0, 0, 0, 1, 0]), { right: 'L', left: 'R', bottom: 'P', top: 'A' });
  // coronal (+x Left, +z Head down? cols toward Feet): top=H bottom=F left=R right=L
  assert.deepEqual(edgeOrientations([1, 0, 0, 0, 0, -1]), { right: 'L', left: 'R', bottom: 'F', top: 'H' });
  // sagittal (+y Posterior, +z Head): rows A->P, cols H->F
  assert.deepEqual(edgeOrientations([0, 1, 0, 0, 0, -1]), { right: 'P', left: 'A', bottom: 'F', top: 'H' });
  assert.equal(orientationString(0.71, 0, 0.71), 'LH');   // oblique -> two letters, dominant first
  assert.equal(edgeOrientations(null), null);
});

import { packbits, rleDecodeFrame } from '../public/dicom/logic.js';

test('dicom rle: packbits literal, run, noop, truncation safety', () => {
  const out = new Uint8Array(8);
  // literal 3 bytes [1,2,3], run of 4x9, noop, run of 1x7
  const n = packbits(Uint8Array.from([2, 1, 2, 3, 0x100 - 3, 9, 0x80, 0, 7]), out);
  assert.equal(n, 8);
  assert.deepEqual([...out], [1, 2, 3, 9, 9, 9, 9, 7]);
  const small = new Uint8Array(2);                       // output cap respected
  assert.equal(packbits(Uint8Array.from([3, 1, 2, 3, 4]), small), 2);
});

test('dicom rle: 16-bit frame round-trip (MSB-first planes -> LE bytes)', () => {
  // 2x2 signed pixels incl. negative HU values
  const px = Int16Array.from([-1000, -1, 0, 3071]);
  const msb = new Uint8Array(4), lsb = new Uint8Array(4);
  px.forEach((v, i) => { msb[i] = (v >> 8) & 255; lsb[i] = v & 255; });
  const enc = (plane) => { const b = [plane.length - 1, ...plane]; return b; };  // one literal packet
  const seg0 = enc(msb), seg1 = enc(lsb);
  const header = new Uint8Array(64), dvh = new DataView(header.buffer);
  dvh.setUint32(0, 2, true); dvh.setUint32(4, 64, true); dvh.setUint32(8, 64 + seg0.length, true);
  const frame = Uint8Array.from([...header, ...seg0, ...seg1]);
  const out = rleDecodeFrame(frame, 4, 2, 1);
  assert.deepEqual([...new Int16Array(out.buffer)], [...px]);
});

test('dicom rle: rgb 8-bit planes interleave to RGBRGB', () => {
  const R = [10, 11], G = [20, 21], B = [30, 31];
  const seg = (p) => [p.length - 1, ...p];
  const s = [seg(R), seg(G), seg(B)];
  const header = new Uint8Array(64), dv = new DataView(header.buffer);
  dv.setUint32(0, 3, true);
  let off = 64; s.forEach((x, i) => { dv.setUint32(4 + i * 4, off, true); off += x.length; });
  const frame = Uint8Array.from([...header, ...s.flat()]);
  assert.deepEqual([...rleDecodeFrame(frame, 2, 1, 3)], [10, 20, 30, 11, 21, 31]);
});

import { clickToLocal, dblTapZooms } from '../public/dicom/logic.js';
test('dicom: measure click maps to local px under A-/A+ body zoom', () => {
  // 150% zoom: rect is 1.5x the local size - a click at the visual center of the
  // viewport must map to the local center, not 1.5x past it (the reported bug)
  const rect = { left: 300, top: 150, width: 900, height: 600 };   // visual (zoomed)
  assert.deepEqual(clickToLocal(300 + 450, 150 + 300, rect, 600, 400), { x: 300, y: 200 });
  // 100% zoom: identity with (clientX - left, clientY - top)
  assert.deepEqual(clickToLocal(310, 160, { left: 300, top: 150, width: 600, height: 400 }, 600, 400), { x: 10, y: 10 });
});
test('dicom: double-tap zoom suppressed while placing measure/angle points', () => {
  assert.equal(dblTapZooms('browse', 200), true);    // normal photo-app double-tap
  assert.equal(dblTapZooms('measure', 200), false);  // two quick ruler points must not zoom
  assert.equal(dblTapZooms('angle', 200), false);
  assert.equal(dblTapZooms('browse', 400), false);   // too slow - not a double-tap
});

import { dblTapZoomToggle } from '../public/dicom/logic.js';
test('dicom: double-tap zoom toggles 1x <-> 2.5x (no separate reset handler to fight it)', () => {
  assert.equal(dblTapZoomToggle(1), 2.5);     // zoom in
  assert.equal(dblTapZoomToggle(2.5), 1);     // second double-tap returns to fit
  assert.equal(dblTapZoomToggle(1.04), 2.5);  // just-off-fit still counts as fit
});

import { wheelAction } from '../public/dicom/logic.js';
test('dicom: ctrl+wheel (trackpad pinch) zooms, plain wheel scrolls slices', () => {
  assert.deepEqual(wheelAction(false, 120, 1), { step: 1 });
  assert.deepEqual(wheelAction(false, -120, 1), { step: -1 });
  assert.ok(Math.abs(wheelAction(true, -100, 1).zoom - 1.1) < 1e-9);   // pinch out = zoom in
  assert.ok(Math.abs(wheelAction(true, 100, 1.1).zoom - 1) < 1e-9);    // pinch in = zoom out
  assert.equal(wheelAction(true, -100, 12).zoom, 12);                  // clamped
  assert.equal(wheelAction(true, 100, 0.2).zoom, 0.2);
});

import { strayPinchPoint } from '../public/dicom/logic.js';
test('dicom: pinch during measure/angle pops the stray first-finger point', () => {
  assert.equal(strayPinchPoint('measure', 2, 1), true);   // finger 2 joins after point placed
  assert.equal(strayPinchPoint('angle', 2, 2), true);
  assert.equal(strayPinchPoint('measure', 2, 0), false);  // nothing placed - nothing to pop
  assert.equal(strayPinchPoint('browse', 2, 1), false);   // pinch on other tools untouched
  assert.equal(strayPinchPoint('measure', 1, 1), false);  // single finger - a real point
});

import { localScale } from '../public/dicom/logic.js';
test('dicom: drag delta scale undoes A-/A+ body zoom', () => {
  assert.equal(localScale({ width: 900 }, 600), 600 / 900);  // 150% zoom - drags were 1.5x too fast
  assert.equal(localScale({ width: 600 }, 600), 1);          // 100% - identity
  assert.equal(localScale({ width: 0 }, 600), 1);            // degenerate rect - no NaN/Infinity
});

import { clampLabel } from '../public/dicom/logic.js';
test('dicom: measurement label clamped inside the canvas', () => {
  assert.deepEqual(clampLabel(100, 100, 800, 600), { x: 100, y: 100 });   // interior untouched
  assert.deepEqual(clampLabel(790, 100, 800, 600), { x: 720, y: 100 });   // right edge pulled in
  assert.deepEqual(clampLabel(100, 2, 800, 600), { x: 100, y: 14 });      // top edge pushed down
  assert.deepEqual(clampLabel(-20, 700, 800, 600), { x: 2, y: 596 });     // left/bottom corners
});
