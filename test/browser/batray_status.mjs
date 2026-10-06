// BatRay by ClearEvo.com - tests (batray_status.mjs): the reader status over the real page, the viewer's offline box, the boot trail
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
// Owner ask 2026-10-06 ("ensure logs have the last state; show the viewer when the reader was last seen and how").
// The relay is a fake WebSocket in the page: the reader's sent messages are kept in window.__wsSent, and the viewer
// test pushes what the room would send (a status with `gone`, a retained status envelope encrypted with the link key).
// The boot trail is tested by blocking the app module itself - the blank tab of 2026-10-05.
const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 700)}`}`); if (!cond) fails++; };
const logs = (re) => evalJs(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`);

// the room: POST /room answers at once; every WebSocket is a fake that opens and records what is sent
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => {
    const url = String(u);
    if (url.endsWith('/batray/api/room') && (i.method || 'GET').toUpperCase() === 'POST') return new Response(JSON.stringify({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return rf(u, i);
  };
  window.__wsSent = []; window.__wsAll = [];
  window.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; window.__wsAll.push(this); setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); }
    send(s) { window.__wsSent.push(JSON.parse(s)); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
    push(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
  };` });

// ---- 1. the reader sends its status when a share starts, and as last words ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
const st = await evalJs('window.__batrayTest.statusState()');
check('the reader builds its status at start and logs it (no share yet: nothing sent)', st.last && st.last.why === 'start' && !st.sent, st);
let lines = await logs('/^\\S+\\s+status: why=start/');
check('the start status is in the log with the phone facts', lines.length === 1 && /hist=\S+ log=\S+ chrome \d+ \S+ missing=\S+ wake=\S+ share=off net=online/.test(lines[0]), lines);
await evalJs(`localStorage.removeItem('batray_share_last'); document.getElementById('share').click(); 1`); await sleep(300);
await evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(1500);
const decryptAll = `(async () => {
  const L = await import('/batray/live-logic.js');
  const link = window.__batrayTest.pubLink(); const k = new URL(link).hash.replace('#k=', '');
  const key = await L.importKey(k);
  const out = [];
  for (const m of window.__wsSent.filter((x) => x.type === 'd' && x.slot === 'status')) out.push(await L.decrypt(key, Uint8Array.from(atob(m.b), (c) => c.charCodeAt(0))));
  return out;
})()`;
let sent = await evalJs(decryptAll);
check('sharing: one status envelope in the retained slot "status" once the socket is up, encrypted, why=online and sharing on', sent.length === 1 && sent[0].k === 'status' && sent[0].v.why === 'online' && sent[0].v.sharing === true && sent[0].p.id === '*', sent.map((e) => e.v && e.v.why));
await evalJs(`document.dispatchEvent(new Event('freeze')); 1`); await sleep(400);
await evalJs(`document.dispatchEvent(new Event('resume')); 1`); await sleep(400);
sent = await evalJs(decryptAll);
check('last words: a freeze and a resume each send one at once', sent.map((e) => e.v.why).join(',') === 'online,freeze,resume', sent.map((e) => e.v.why));
lines = await logs('/status: why=(freeze|resume)/');
check('...and each is in the log', lines.length === 2, lines);
await evalJs(`window.__batrayTest.statusTick('tick'); 1`); await sleep(300);
check('a minute tick with nothing changed sends nothing more', (await evalJs(decryptAll)).length === 3, null);
const rec = await evalJs(`(() => { window.__batrayTest.memTick(); return JSON.parse(localStorage.getItem('batray_lastrun')); })()`);
check('the last-run record carries the last status', rec && rec.status && rec.status.why === 'tick' && rec.status.sharing === true, rec && rec.status);

// ---- 2. the next start logs that status ----
await send('Page.navigate', { url: `${BASE}/batray/?test&n=2` }); await sleep(2500);
lines = await logs('/its last status \\(\\d+ s before this start\\): why=/');
check('the next start logs the previous run\'s last status', lines.length === 1, lines);

// ---- 3. the boot trail: a load whose app module never ran (the blank tab) ----
await send('Network.setBlockedURLs', { urls: ['*app.js*'] });
await send('Page.navigate', { url: `${BASE}/batray/?test&n=3` }); await sleep(13500);
const fail = await evalJs(`({ shown: !document.getElementById('bootFail').hidden, txt: document.getElementById('bootFail').textContent, boot: JSON.parse(localStorage.getItem('batray_boot')) })`);
check('a page whose module never runs shows "BatRay did not start" after 12 s and records its stages', fail.shown && /did not start/.test(fail.txt) && fail.boot.st.map((x) => x[0]).join(',').startsWith('html') && fail.boot.st.some((x) => x[0] === 'stuck'), fail);
check('...with the failed script in the record', !!(fail.boot.err && /app\.js/.test(fail.boot.err)), fail.boot);
await send('Network.setBlockedURLs', { urls: [] });
await send('Page.navigate', { url: `${BASE}/batray/?test&n=4` }); await sleep(2500);
lines = await logs('/PREVIOUS PAGE LOAD|its error|module never ran/');
check('the next start names it: never finished starting, its error, the module never ran', lines.length === 3 && /NEVER FINISHED STARTING/.test(lines[0]) && /app\.js/.test(lines[1]), lines);
await send('Page.navigate', { url: `${BASE}/batray/?test&n=5` }); await sleep(2500);
check('a normal start after a normal start says nothing about it', (await logs('/PREVIOUS PAGE LOAD/')).length === 0);
const b = await evalJs(`JSON.parse(localStorage.getItem('batray_boot')).st.map((x) => x[0])`);
check('a normal load reaches html, module, ready', b.join(',') === 'html,module,ready', b);

// ---- 4. Browse: every stored log file can be uploaded ----
await evalJs(`window.__batrayTest.flushLog(); 1`); await sleep(600);
void evalJs(`window.__batrayTest.openBrowse('log'); 1`); await sleep(800);
const items = await evalJs(`[...document.querySelectorAll('#sheetItems .item')].map((i) => ({ up: !!i.querySelector('[data-up]'), del: !!i.querySelector('[data-del]') }))`);
check('Browse logs: each file has Upload and Delete', items.length > 0 && items.every((i) => i.up && i.del), items);
await evalJs(`document.querySelector('#sheetItems [data-up]').click(); 1`); await sleep(500);
const up = await evalJs(`({ kind: window.__batrayTest.uiState().sheet && window.__batrayTest.uiState().sheet.kind })`);
check('Upload on a file asks first (the upload warning sheet)', up.kind === 'upload', up);
await evalJs(`document.querySelector('#sheetActs [data-act="cancel"]') ? document.querySelector('#sheetActs [data-act="cancel"]').click() : document.getElementById('sheetBack').click(); 1`); await sleep(300);

// ---- 5. the viewer: the reader away, what the room kept, what the relay saw ----
const KEY = 'qOZe1xrVxvTfYHUobOqjmg';
await send('Page.navigate', { url: `${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test&n=6#k=${KEY}` }); await sleep(2500);
await evalJs(`(async () => {
  const L = await import('/batray/live-logic.js');
  const key = await L.importKey('${KEY}');
  const sock = window.__wsAll[window.__wsAll.length - 1];
  const now = Date.now(), at = now - 3 * 3600_000 - 5 * 60_000;
  const v = { why: 'hidden', t: at, up: 86400, ver: '0.9.71', sid: 'r1d2', vis: false, bat: { pct: 34, chg: false }, mem: { used: 31, limit: 4096, pct: 1 }, sto: { used: 26, quota: 60000 }, hist: { backend: 'opfs', days: 5, rows: 8174, pend: 0, fails: 0 }, log: { on: true, files: 4, kb: 5323 }, br: 'chrome 154', os: 'android', miss: [], wake: true, sharing: true, net: { on: true, type: 'wifi' }, packs: [{ name: 'm-00', conn: true, at: at - 2000, soc: 78, v: 52.1, a: -5.6 }], prev: { clean: true, at: at - 86400_000 } };
  const b = await L.encrypt(key, { k: 'status', p: { id: '*', name: '*' }, t: at, v });
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  sock.push({ type: 'status', viewers: 1, live: false, gone: { ago: 3 * 3600_000, code: 1006, reason: '' } });
  sock.push({ type: 'd', b: btoa(s), ago: 3 * 3600_000 + 5 * 60_000 });
  return 1;
})()`);
await sleep(2500);
const box = await evalJs(`({ shown: !document.getElementById('readerOff').hidden, txt: document.getElementById('readerOff').innerText, rs: window.__batrayTest.readerState() })`);
check('the viewer shows the reader offline box: since when (3 h ago), how (screen off then quiet), the last reading, the phone', box.shown && /Reader offline since \d{4}-\d\d-\d\d \d\d:\d\d \(3 h( \d+ min)? ago\)/.test(box.txt) && /screen went off/.test(box.txt) && /m-00 78 % · 52\.1 V · -5\.6 A/.test(box.txt) && /phone battery 34 %, not charging/.test(box.txt), box);
check('the relay\'s word on the socket end is kept (code 1006)', box.rs.gone && box.rs.gone.code === 1006 && box.rs.reader === false, box.rs);
lines = await logs('/reader status \\(kept by the room|reader offline box|reader socket ended/');
check('the viewer log has the reader\'s status, the box text and the relay\'s close record', lines.length >= 3, lines);
await evalJs(`document.getElementById('readerOff').click(); 1`); await sleep(400);
const sh = await evalJs(`({ kind: window.__batrayTest.uiState().sheet && window.__batrayTest.uiState().sheet.kind, rows: [...document.querySelectorAll('#sheetRows .k')].map((e) => e.textContent) })`);
check('tapping the box opens the Reader phone sheet with every fact', sh.kind === 'reader' && ['Last status', 'm-00', 'Phone battery', 'Browser', 'History store', 'Page memory', 'Storage used', 'Debug log', 'Missing features', 'Page', 'Network', 'Page running for', 'The run before', 'Version', 'Connection close code'].every((k) => sh.rows.includes(k)), sh);
await evalJs(`document.querySelector('#sheetActs [data-act="ok"]').click(); 1`); await sleep(300);
check('More has a Reader phone button on the viewer', await evalJs(`!document.getElementById('readerPhone').hidden`));
for (const [w, h] of [[500, 900], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); await sleep(500);
  const r = await evalJs(`(() => { const b = document.getElementById('readerOff').getBoundingClientRect(); return { w: b.width, right: b.right, vw: innerWidth, h: b.height }; })()`);
  check(`${w}px: the box fits the width`, r.w > 0 && r.right <= r.vw && r.h > 30, r);
}
await send('Emulation.clearDeviceMetricsOverride');

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).filter((t) => !/app\.js/.test(t));
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY STATUS TEST FAILED' : 'batray status test ok');
process.exit(fails ? 1 : 0);
