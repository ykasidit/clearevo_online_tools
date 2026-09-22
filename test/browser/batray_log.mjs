// BatRay by ClearEvo.com - tests (batray_log.mjs)
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
// The debug log must carry everything needed to debug from the log alone, and
// Upload log must ask first, then send header + lines to the relay.
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 500)}`}`); if (!cond) fails++; };

await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__logPosts = [];
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => {
    const url = String(u); const ok = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/batray/api/log')) { window.__logPosts.push({ method: i.method, headers: i.headers, body: String(i.body) }); return ok({ id: 'TestLogId0000000000000', key: 'logs/x' }); }
    if (url.endsWith('/batray/api/room')) return ok({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' });
    if (url.includes('/batray/api/room/')) return ok({ viewers: 0, live: false });
    if (url.includes('/batray/api/sfu') || url.includes('/batray/api/turn')) return ok({ error: 'no sfu in this test' }, 500);
    return rf(u, i);
  };
  // the log upload is an XMLHttpRequest (progress + abort): a fake that reports 50 % after 150 ms and finishes at 400 ms,
  // or waits for window.__release when window.__holdUpload is set (the Cancel test)
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = { upload: {}, status: 0, responseText: '', _h: {}, aborted: false };
    x.open = (m, u) => { x.method = m; x.url = String(u); };
    x.setRequestHeader = (k, v) => { x._h[k] = v; };
    x.abort = () => { x.aborted = true; window.__aborted = (window.__aborted || 0) + 1; x.onabort && x.onabort(); };
    x.send = (body) => {
      if (!x.url.endsWith('/batray/api/log')) throw new Error('unexpected xhr ' + x.url);
      const text = new TextDecoder().decode(body); const total = body.byteLength || body.length;
      const run = () => {
        if (x.aborted) return;
        x.upload.onprogress && x.upload.onprogress({ loaded: Math.floor(total / 2), total, lengthComputable: true });
        setTimeout(() => {
          if (x.aborted) return;
          x.upload.onprogress && x.upload.onprogress({ loaded: total, total, lengthComputable: true });
          window.__logPosts.push({ method: x.method, headers: x._h, body: text });
          x.status = 200; x.responseText = JSON.stringify({ id: 'TestLogId0000000000000', key: 'logs/x' }); x.onload && x.onload();
        }, 250);
      };
      if (window.__holdUpload) window.__release = run; else setTimeout(run, 150);
    };
    return x;
  };
` });
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);

const head = await evalJs(`window.__batrayTest.logHeaderLines()`);
check('header: version, mode, ua, platform, screen, net, lang, features, settings', head.length === 8 && /^BatRay v\d+\.\d+\.\d+ · \d{4}-\d{2}-\d{2}T.* · tz .* · reader · page /.test(head[0]) && /^ua: /.test(head[1]) && /^platform: .*cores/.test(head[2]) && /^screen: \d+x\d+ @/.test(head[3]) && /^net: online=/.test(head[4]) && /^lang: ui=/.test(head[5]) && /^features: secure=yes bluetooth=(yes|no) .*wakeLock=.*notifications=.*webCodecs=.*hls=.*remotePlayback=.*storage=yes/.test(head[6]) && /^settings: autoReconnect=.*cutoff=\d+%/.test(head[7]), head);
let lines = await evalJs(`window.__batrayTest.logLines()`);
check('the header lines open the log itself, followed by async facts', lines.slice(0, 8).every((l, i) => l.slice(14).startsWith(head[i].slice(0, 8))) && lines.some((l) => /codecs: avc1\.42E01E=(yes|no)/.test(l)), { first: lines.slice(0, 8).map((l) => l.slice(14, 30)), heads: head.map((h) => h.slice(0, 8)), async: lines.filter((l) => /codecs|battery|availability/.test(l)) });

// errors reach the log: a thrown error, a rejected promise, console.error
await evalJs(`setTimeout(() => { throw new Error('boom thrown'); }, 0); Promise.reject(new Error('boom rejected')); console.error('boom console', { a: 1 }); 1`);
await sleep(300);
lines = await evalJs(`window.__batrayTest.logLines()`);
check('thrown errors, unhandled rejections and console.error land in the log with a stack', lines.some((l) => /ERROR .*boom thrown @ [\s\S]*at /.test(l)) && lines.some((l) => /UNHANDLED boom rejected/.test(l)) && lines.some((l) => /console\.error: boom console \{"a":1\}/.test(l)), lines.filter((l) => /boom/.test(l)));

// status changes are logged once, countdown digits collapsed
await evalJs(`document.getElementById('demoBtn').click(); 1`); await sleep(1500);
lines = await evalJs(`window.__batrayTest.logLines()`);
check('status changes and the demo start are logged', lines.some((l) => /status: DEMO/.test(l)) && lines.filter((l) => /status: /.test(l)).length >= 2, lines.filter((l) => /status:/.test(l)).slice(-3));

// upload: declined at the warning -> nothing sent
await evalJs(`document.getElementById('upload').click(); 1`); await sleep(300);
const warn = await evalJs(`({ shown: !document.getElementById('sheet').hidden, lead: document.getElementById('sheetLead').textContent, ok: !!document.querySelector('#sheetActs [data-act=ok]') })`);
check('the upload warning is a bottom sheet carrying the full wording, not a confirm()', warn.shown && /90 days/.test(warn.lead) && warn.ok, warn);
await evalJs(`document.querySelector('#sheetActs [data-act=cancel]').click(); 1`); await sleep(300);
let posts = await evalJs(`window.__logPosts.length`);
check('declining the warning sends nothing', posts === 0 && (await evalJs(`window.__batrayTest.logLines().some((l) => /log upload: declined/.test(l))`)), posts);
// accepted -> header + --- + lines, id shown
await evalJs(`document.getElementById('upload2').click(); 1`); await sleep(200);
await evalJs(`document.querySelector('#sheetActs [data-act=ok]').click(); 1`); await sleep(250);
const mid = await evalJs(`({ open: !document.getElementById('sheet').hidden, title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, bar: document.getElementById('sheetBar').style.width, progShown: !document.getElementById('sheetProg').hidden, cancel: !!document.querySelector('#sheetActs [data-act=cancel]') })`);
check('while it uploads, a sheet shows the percent, the bytes and a Cancel button', mid.open && mid.title === 'Upload log' && /Uploading… (49|50) % \(\d+ of \d+ KB\)/.test(mid.lead) && /^(49|50)%$/.test(mid.bar) && mid.progShown && mid.cancel, mid);
await sleep(500);
const after = await evalJs(`({ open: !document.getElementById('sheet').hidden, sheet: window.__batrayTest.uiState().sheet })`);
check('the sheet closes itself when the upload completes', !after.open && !after.sheet, after);
const post = await evalJs(`window.__logPosts[0] ? { method: window.__logPosts[0].method, ct: window.__logPosts[0].headers['Content-Type'], head: window.__logPosts[0].body.slice(0, 40), hasSep: window.__logPosts[0].body.includes('\\n---\\n'), hasBoom: window.__logPosts[0].body.includes('boom thrown'), len: window.__logPosts[0].body.length } : null`);
const ui = await evalJs(`({ idTxt: document.getElementById('uploadId').textContent, shown: !document.getElementById('uploadId').hidden, toast: document.getElementById('toast').textContent })`);
check('accepting uploads header + separator + log as text/plain and shows the id', post && post.method === 'POST' && /text\/plain/.test(post.ct) && /^BatRay v/.test(post.head) && post.hasSep && post.hasBoom && post.len > 1000, post);
check('the id is shown in the Debug card and the toast', /TestLogId0000000000000/.test(ui.idTxt) && ui.shown && /TestLogId0000000000000/.test(ui.toast), ui);
// cancel: the request is aborted, nothing is posted, the toast says so
await evalJs(`window.__holdUpload = true; document.getElementById('upload2').click(); 1`); await sleep(200);
await evalJs(`document.querySelector('#sheetActs [data-act=ok]').click(); 1`); await sleep(250);
const holding = await evalJs(`({ open: !document.getElementById('sheet').hidden, lead: document.getElementById('sheetLead').textContent, posts: window.__logPosts.length })`);
await evalJs(`document.querySelector('#sheetActs [data-act=cancel]').click(); 1`); await sleep(300);
const canc = await evalJs(`({ aborted: window.__aborted, posts: window.__logPosts.length, open: !document.getElementById('sheet').hidden, toast: document.getElementById('toast').textContent, logged: window.__batrayTest.logLines().some((l) => /log upload: cancelled by the user/.test(l)), btn: document.getElementById('upload2').disabled })`);
check('Cancel aborts the upload in flight: nothing posted, a toast says so, the button is usable again', holding.open && /connecting|0 %/.test(holding.lead) && canc.aborted === 1 && canc.posts === holding.posts && !canc.open && /cancelled/i.test(canc.toast) && canc.logged && !canc.btn, { holding, canc });
await evalJs(`window.__holdUpload = false; 1`);

// --- share setup: name prefill, the last-link option, and what Start saves ---
await evalJs(`localStorage.removeItem('batray_share_last'); localStorage.removeItem('batray_share_name'); document.getElementById('share').click(); 1`); await sleep(300);
let sp = await evalJs(`({ shown: !document.getElementById('sharePanel').hidden, name: document.getElementById('shareName').value, reuseDisabled: document.getElementById('shareReuse').disabled, reuseChecked: document.getElementById('shareReuse').checked, info: document.getElementById('shareReuseInfo').textContent })`);
check('Share opens the setup: a cat name for the demo, last-link option greyed when nothing is saved', sp.shown && /^[A-Z][a-z]+$/.test(sp.name) && sp.reuseDisabled && !sp.reuseChecked && /none saved/.test(sp.info), sp);
await evalJs(`document.getElementById('shareName').value = 'Home bank'; document.getElementById('shareGo').click(); 1`); await sleep(2500);
sp = await evalJs(`({ panelHidden: document.getElementById('sharePanel').hidden, qrName: document.getElementById('qrName').textContent, savedName: localStorage.getItem('batray_share_name'), saved: JSON.parse(localStorage.getItem('batray_share_last') || 'null'), logged: window.__batrayTest.logLines().filter((l) => /share: name|live share room/.test(l)) })`);
check('Start sharing saves the name and the link, shows the name above the QR', sp.panelHidden && sp.qrName === 'Home bank' && sp.savedName === 'Home bank' && sp.saved && sp.saved.room === 'testroom0000000000000A' && sp.saved.pub === 'testpub00000000000000A' && /^[A-Za-z0-9_-]{22}$/.test(sp.saved.key) && sp.logged.some((l) => /new room/.test(l)) && sp.logged.some((l) => /created/.test(l)), sp);
const sb = await evalJs(`({ on: document.getElementById('share').classList.contains('on'), phase: window.__batrayTest.shareState().phase, title: document.getElementById('share').title })`);
check('the Share button is sunk while sharing and says a press stops it', sb.on && sb.phase === 'on' && /press again to stop/.test(sb.title), sb);
await evalJs(`document.getElementById('share').click(); 1`); await sleep(800);
const sb2 = await evalJs(`({ on: document.getElementById('share').classList.contains('on'), phase: window.__batrayTest.shareState().phase, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent, chipHidden: document.getElementById('liveChip').hidden })`);
check('pressing the sunk Share button stops sharing with a toast and lifts the button', !sb2.on && sb2.phase === 'off' && /Sharing stopped/.test(sb2.toast) && sb2.chipHidden, sb2);
await evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
sp = await evalJs(`({ name: document.getElementById('shareName').value, reuseDisabled: document.getElementById('shareReuse').disabled, reuseChecked: document.getElementById('shareReuse').checked, info: document.getElementById('shareReuseInfo').textContent })`);
check('next time: the saved name is prefilled and "use the last share link" is on by default', sp.name === 'Home bank' && !sp.reuseDisabled && sp.reuseChecked && /saved/.test(sp.info), sp);
await evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(2500);
sp = await evalJs(`({ logged: window.__batrayTest.logLines().filter((l) => /reusing room|reused/.test(l)), saved: JSON.parse(localStorage.getItem('batray_share_last') || 'null') })`);
check('...and Start reuses the earlier room and key', sp.logged.length >= 2 && sp.saved.room === 'testroom0000000000000A', sp);
await evalJs(`document.getElementById('liveStop').click(); 1`); await sleep(500);

const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).filter((t) => !/boom/.test(t));
check('no page exceptions besides the deliberate ones', errors.length === 0, errors);
console.log(fails ? `batray log test: ${fails} FAILED` : 'batray log test ok');
process.exit(fails ? 1 : 0);
