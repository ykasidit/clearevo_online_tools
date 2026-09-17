// BatRay by ClearEvo.com - tests (batray_tv.mjs)
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
//
// Show on TV end to end in the browser: the page draws its picture, encodes it
// with WebCodecs, muxes fMP4 and uploads an init segment plus media segments.
// The relay is stubbed inside the page (uploads are captured), the encoder is
// real (VP9 here: the open-source Chromium build has no H.264; phones do), and
// the captured stream is handed to ffmpeg to prove a player decodes it.
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
// A full ffmpeg (with the mov demuxer and a VP9 decoder) is needed for the decode
// check; Playwright's bundled one has neither. `pip install imageio-ffmpeg` provides one.
const FFMPEG = process.env.FFMPEG || (() => { try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim(); } catch { return 'ffmpeg'; } })();

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); }
  else if (d.method) events.push(d);
};
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// The relay, faked inside the page: uploads are kept as base64 so the test can rebuild the stream.
const FAKE = `
  window.__tvUploads = []; window.__tvCalls = [];
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes('/batray/api/tv')) return realFetch(url, init);
    const method = (init.method || 'GET').toUpperCase();
    window.__tvCalls.push(method + ' ' + u.replace(/^https?:\\/\\/[^/]+/, ''));
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'POST') return ok({ tv: 'fakeTvId0000000000000', token: 'tok' });
    if (method === 'PUT') { const bytes = init.body instanceof Uint8Array ? init.body : new Uint8Array(await new Response(init.body).arrayBuffer()); const m = u.match(/\\/tv\\/[^/]+\\/(.+?)\\?/); window.__tvUploads.push({ path: m ? m[1] : u, dur: (u.match(/dur=([\\d.]+)/) || [])[1], b64: b64(bytes), len: bytes.length }); return ok({ ok: true, head: window.__tvUploads.length }); }
    if (method === 'DELETE') return ok({ ok: true });
    if (u.includes('/status')) return ok({ head: window.__tvUploads.length - 1, segs: Math.max(0, window.__tvUploads.length - 1), hits: 3, pullAgeS: 2 });
    return ok({});
  };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.navigate', { url: `${BASE}/batray/?test` });
await sleep(2000);

let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 400)}`}`); if (!cond) fails++; };

await evalJs(`document.getElementById('demoBtn').click(); 1`);
await sleep(2500);
// the panel and its honesty text
await evalJs(`document.getElementById('tv').click(); 1`);
const panel = await evalJs(`({ shown: !document.getElementById('tvPanel').hidden, warn: document.querySelector('#tvPanel .tvnote.warn').textContent, privacy: document.querySelector('[data-i18n=privacy]').textContent })`);
check('the TV panel opens and says the picture is not encrypted', panel.shown && /Not encrypted/.test(panel.warn) && /Show on TV/.test(panel.privacy), panel);

// start a small VP9 stream: 640x360, 2 fps, 2 s segments
const url = await evalJs(`window.__batrayTest.startTv({ res: '640x360', codecs: ['vp09.00.10.08'], fps: 2, segS: 2 })`);
check('the stream starts and yields a playlist link', /\/batray\/api\/tv\/fakeTvId0000000000000\/index\.m3u8$/.test(url), url);
await sleep(9500);
let s = await evalJs(`JSON.stringify(window.__batrayTest.tvState())`); s = JSON.parse(s);
const ups = await evalJs(`window.__tvUploads.map((u) => ({ path: u.path, dur: u.dur, len: u.len }))`);
check('an init segment and at least three media segments were uploaded within 9.5 s', ups[0] && ups[0].path === 'init.mp4' && ups.filter((u) => u.path.startsWith('seg/')).length >= 3, ups);
check('media segments carry their duration and are numbered from 0', ups.filter((u) => u.path.startsWith('seg/')).every((u, i) => u.path === `seg/${i}` && Math.abs(+u.dur - 2) < 0.6), ups);
check('the state counts segments and shows the fake TV pull', s.live && s.segs >= 3 && s.codec === 'vp09.00.10.08' && s.hits === 3 && s.pullAgeS === 2 && !s.error, s);
const ui = await evalJs(`({ stat: document.getElementById('tvStat').textContent, note: !document.getElementById('tvNote').hidden, link: document.getElementById('tvLink').textContent, videoSrc: document.getElementById('tvVideo').getAttribute('src') })`);
check('status line, status-bar note and video source are set', /segments/.test(ui.stat) && ui.note && ui.link === url && ui.videoSrc === url, ui);

// stop: the last fragment is flushed and the relay is told
await evalJs(`window.__batrayTest.stopTv()`);
const after = await evalJs(`({ calls: window.__tvCalls.filter((c) => c.startsWith('DELETE')).length, note: document.getElementById('tvNote').hidden, live: document.getElementById('tvLive').hidden })`);
check('stop deletes the stream and hides the notes', after.calls === 1 && after.note && after.live, after);

// rebuild the stream from the uploads and let ffmpeg decode it
const dir = mkdtempSync(join(tmpdir(), 'batray-tv-'));
const all = await evalJs(`window.__tvUploads.map((u) => u.b64)`);
const bufs = all.map((b) => Buffer.from(b, 'base64'));
const file = join(dir, 'stream.mp4');
writeFileSync(file, Buffer.concat(bufs));
const ff = spawnSync(FFMPEG, ['-hide_banner', '-v', 'info', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
const ffout = String(ff.stdout || '') + String(ff.stderr || '');   // ffmpeg reports on stderr
let frames = -1;
const m = [...ffout.matchAll(/frame=\s*(\d+)/g)].pop();
frames = m ? +m[1] : -1;
const segs = ups.filter((u) => u.path.startsWith('seg/')).length;
check(`ffmpeg decodes the rebuilt stream (init + ${segs} segments) as VP9 video with about ${segs * 4} frames`, /Video: vp9/.test(ffout) && frames >= segs * 4 - 2, { frames, tail: ffout.split('\n').filter((l) => /Video|frame=|Error|error/.test(l)).slice(-4) });

// the TV picture itself at 1080p, saved for a look
const png = await evalJs(`window.__batrayTest.tvFrame(1920, 1080)`);
const out = process.env.TV_FRAME_PNG || join(dir, 'tv_frame_1080.png');
writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
check('a 1080p TV frame renders (saved to ' + out + ')', png.length > 20000, png.length);

const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', errors.length === 0, errors);
console.log(fails ? `batray tv test: ${fails} FAILED` : 'batray tv test ok');
process.exit(fails ? 1 : 0);
