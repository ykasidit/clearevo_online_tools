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
const evalGesture = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
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
const sunk = await evalJs(`({ on: document.getElementById('tv').classList.contains('on'), pressed: document.getElementById('tv').getAttribute('aria-pressed'), title: document.getElementById('tv').title, phase: window.__batrayTest.tvUiState().phase })`);
check('the Show on TV toolbar button is sunk while the stream runs and says a press stops it', sunk.on && sunk.pressed === 'true' && /press again to stop/.test(sunk.title) && sunk.phase === 'on', sunk);
await sleep(9500);
let s = await evalJs(`JSON.stringify(window.__batrayTest.tvState())`); s = JSON.parse(s);
const ups = await evalJs(`window.__tvUploads.map((u) => ({ path: u.path, dur: u.dur, len: u.len }))`);
check('an init segment and at least three media segments were uploaded within 9.5 s', ups[0] && ups[0].path === 'init.mp4' && ups.filter((u) => u.path.startsWith('seg/')).length >= 3, ups);
check('media segments carry their duration and are numbered from 0', ups.filter((u) => u.path.startsWith('seg/')).every((u, i) => u.path === `seg/${i}` && Math.abs(+u.dur - 2) < 0.6), ups);
check('the state counts segments and shows the fake TV pull', s.live && s.segs >= 3 && s.codec === 'vp09.00.10.08' && s.hits === 3 && s.pullAgeS === 2 && !s.error, s);
// collapse / expand the TV card (owner 2026-09-26): with HLS support faked, collapsing unloads the preview and
// expanding loads it again from the live playlist
const tog = await evalJs(`(async () => {
  const v = document.getElementById('tvVideo'); const p = document.getElementById('tvPanel'); const T = window.__batrayTest;
  HTMLMediaElement.prototype.canPlayType = function (t) { return /mpegurl/i.test(t) ? 'maybe' : ''; };
  T.renderTv(); const before = T.logLines().length;
  const src0 = v.getAttribute('src');
  p.open = false; await new Promise((r) => setTimeout(r, 200));
  const closed = v.getAttribute('src');
  p.open = true; await new Promise((r) => setTimeout(r, 200));
  const reopened = v.getAttribute('src');
  return { src0, closed, reopened, logs: T.logLines().slice(before).filter((l) => /tv: card/.test(l)) };
})()`);
check('collapsing the TV card unloads the preview, expanding it loads the preview again at the live edge', /index\.m3u8$/.test(tog.src0 || '') && tog.closed === null && /index\.m3u8$/.test(tog.reopened || '') && tog.logs.some((l) => /card collapsed -> unload/.test(l)) && tog.logs.some((l) => /card expanded -> load/.test(l)), tog);
const ui = await evalJs(`({ stat: document.getElementById('tvStat').textContent, note: !document.getElementById('tvNote').hidden, link: document.getElementById('tvLink').textContent, videoSrc: document.getElementById('tvVideo').getAttribute('src'), canHls: !!document.getElementById('tvVideo').canPlayType('application/vnd.apple.mpegurl'), noPreview: !document.getElementById('tvNoPreview').hidden, castRow: !document.getElementById('tvCastRow').hidden, castHint: document.getElementById('tvCastHint').textContent })`);
check('status line, status-bar note and link are set; the preview follows the browser\'s own HLS support; Cast is always offered', /segments/.test(ui.stat) && ui.note && ui.link === url && ui.castRow && /Google/.test(ui.castHint) && (ui.canHls ? ui.videoSrc === url && !ui.noPreview : ui.videoSrc === null && ui.noPreview), ui);

// Cast: a fake of Google's cast library that behaves like the Android sender
// read on 2026-09-20 - availability goes NOT_CONNECTED -> NO_DEVICES -> NOT_CONNECTED
// after init, a picker request can hang, and the receiver reports player states.
await evalJs(`
  window.__castLoads = []; window.__castReq = 0; window.__castScript = 0; window.__castNoSession = true; window.__castHang = false; window.__castMedia = null;
  const dev = { friendlyName: 'Living room TV' };
  const sess = { getCastDevice: () => dev, getMediaSession: () => window.__castMedia, loadMedia: async (req) => { window.__castLoads.push({ url: req.media.contentId, type: req.media.contentType, stream: req.media.streamType, seg: req.media.hlsSegmentFormat, vseg: req.media.hlsVideoSegmentFormat, autoplay: req.autoplay, title: req.media.metadata && req.media.metadata.title }); } };
  const listeners = {};
  const ctx = { opts: null, state: 'NOT_CONNECTED',
    setOptions(o) { this.opts = o; setTimeout(() => ctx.emit('NOT_CONNECTED'), 0); setTimeout(() => ctx.emit('NO_DEVICES_AVAILABLE'), 300); setTimeout(() => ctx.emit('NOT_CONNECTED'), 400); },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    emit(st) { this.state = st; for (const f of listeners.CAST_STATE_CHANGED || []) f({ castState: st }); },
    getCastState() { return this.state; },
    getCurrentSession: () => (window.__castNoSession ? null : sess),
    requestSession() { window.__castReq++; return window.__castHang ? new Promise(() => {}) : new Promise((ok) => setTimeout(() => { window.__castNoSession = false; ok(); }, 100)); } };
  const player = { playerState: null, isMediaLoaded: false, isConnected: true, currentTime: 0, mediaInfo: null }, pcl = {};
  function RemotePlayer() { return player; }
  function RemotePlayerController() { return { addEventListener(t, f) { (pcl[t] = pcl[t] || []).push(f); } }; }
  window.__castPlayer = (st, idle) => { player.playerState = st; player.isMediaLoaded = st !== 'IDLE'; window.__castMedia = { idleReason: idle || null }; for (const f of pcl.PLAYER_STATE_CHANGED || []) f({}); };
  window.chrome = window.chrome || {}; window.chrome.cast = { media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845', StreamType: { LIVE: 'LIVE' }, HlsSegmentFormat: { FMP4: 'fmp4' }, HlsVideoSegmentFormat: { FMP4: 'fmp4' }, MediaInfo: function (id, type) { this.contentId = id; this.contentType = type; }, GenericMediaMetadata: function () {}, LoadRequest: function (m) { this.media = m; } }, AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' } };
  const fw = { CastContext: { getInstance: () => ctx }, CastContextEventType: { CAST_STATE_CHANGED: 'CAST_STATE_CHANGED', SESSION_STATE_CHANGED: 'SESSION_STATE_CHANGED' }, CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' }, RemotePlayer, RemotePlayerController, RemotePlayerEventType: { PLAYER_STATE_CHANGED: 'PLAYER_STATE_CHANGED', IS_MEDIA_LOADED_CHANGED: 'IS_MEDIA_LOADED_CHANGED', MEDIA_INFO_CHANGED: 'MEDIA_INFO_CHANGED' } };
  // first-load path: the page appends Google's script tag; the fake stands in for it (nothing is fetched)
  const realAppend = document.head.appendChild.bind(document.head);
  document.head.appendChild = (el) => { if (el.tagName === 'SCRIPT' && /gstatic/.test(el.src)) { window.__castScript++; setTimeout(() => { window.cast = { framework: fw }; window.__onGCastApiAvailable(true); }, 50); return el; } return realAppend(el); };
  1`);
// A: the tap that loads the library waits for discovery to flip, then opens the picker and loads the playlist
await evalGesture(`document.getElementById('tvCast').click(); 1`); await sleep(1500);
const cst = await evalJs(`({ loads: window.__castLoads, req: window.__castReq, script: window.__castScript, hint: document.getElementById('tvCastHint').textContent, opts: window.cast.framework.CastContext.getInstance().opts, scripts: [...document.scripts].filter((s) => /gstatic/.test(s.src)).length, log: window.__batrayTest.logLines().filter((l) => /cast:/.test(l)).slice(-8) })`);
check('Cast loads the playlist as live HLS (fmp4) on the default media receiver and names the TV', cst.loads.length === 1 && cst.loads[0].url === url && cst.loads[0].type === 'application/x-mpegURL' && cst.loads[0].stream === 'LIVE' && cst.loads[0].seg === 'fmp4' && cst.loads[0].vseg === 'fmp4' && cst.loads[0].autoplay === true && /BatRay/.test(cst.loads[0].title) && cst.opts.receiverApplicationId === 'CC1AD845' && /Living room TV/.test(cst.hint) && cst.scripts === 0 && cst.script === 1, cst);
check('...the picker opened only after the availability flipped (NO_DEVICES seen first), one request', cst.req === 1 && cst.log.some((l) => /state NO_DEVICES_AVAILABLE/.test(l)) && cst.log.some((l) => /load accepted by "Living room TV"/.test(l)), cst.log);
// B: a request the library never settles: a second tap must not ask again (that is the invalid_parameter trap)
await evalJs(`window.__castNoSession = true; window.__castHang = true; 1`);
await evalGesture(`document.getElementById('tvCast').click(); 1`); await sleep(300);
const h1 = await evalJs(`document.getElementById('tvCastHint').textContent`);
// on the phones a later state event re-enabled the button while the request hung; same here
await evalJs(`window.cast.framework.CastContext.getInstance().emit('NOT_CONNECTED'); 1`);
await evalGesture(`document.getElementById('tvCast').click(); 1`); await sleep(300);
const b2 = await evalJs(`({ req: window.__castReq, hint: document.getElementById('tvCastHint').textContent, log: window.__batrayTest.logLines().filter((l) => /cast:/.test(l)).slice(-3) })`);
check('a pending picker request blocks a second one and says what to do', /pick your TV/.test(h1) && b2.req === 2 && /reload the page/.test(b2.hint) && b2.log.some((l) => /tap -> pending/.test(l)), { h1, ...b2 });
// C: the TV's own player state reaches the hint and the log
await evalJs(`window.__castNoSession = false; window.__castPlayer('PLAYING'); 1`); await sleep(100);
const c1 = await evalJs(`document.getElementById('tvCastHint').textContent`);
await evalJs(`window.__castPlayer('IDLE', 'ERROR'); 1`); await sleep(100);
const c2 = await evalJs(`({ hint: document.getElementById('tvCastHint').textContent, log: window.__batrayTest.logLines().filter((l) => /cast: player state/.test(l)).slice(-2) })`);
check("the receiver's player state shows under the button and an IDLE/ERROR is called out", /TV player: playing/.test(c1) && /could not play/.test(c2.hint) && c2.log.some((l) => /player=PLAYING/.test(l)) && c2.log.some((l) => /player=IDLE idle=ERROR/.test(l)), { c1, ...c2 });

// stop by pressing the sunk toolbar button: the last fragment is flushed, the relay is told, a toast says so
await evalJs(`document.getElementById('tv').click(); 1`); await sleep(700);
const after = await evalJs(`({ calls: window.__tvCalls.filter((c) => c.startsWith('DELETE')).length, note: document.getElementById('tvNote').hidden, live: document.getElementById('tvLive').hidden, on: document.getElementById('tv').classList.contains('on'), toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent, phase: window.__batrayTest.tvUiState().phase, startShown: !document.getElementById('tvStart').hidden })`);
check('pressing the sunk button stops the stream with a toast, deletes it on the relay, hides the notes and offers Start again', after.calls === 1 && after.note && after.live && !after.on && /TV stream stopped/.test(after.toast) && after.phase === 'off' && after.startShown, after);

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
