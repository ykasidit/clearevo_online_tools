// BatRay by ClearEvo.com - tests (longrun_fable_upload.mjs): a log upload survives the app's own sheets
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
// Long-run review (Fable, 2026-11-05), L-F7, from the owner's 0.9.82 viewer log "log upload: cancelled by the user
// (156303 of 156303 B sent)" - the relay had stored it. app.js uploadLog() waits on its progress sheet; openSheet()
// ends ANY open sheet as dismissed (endSheet(null)) before it shows the next one, so a sheet the app opens by itself
// while an upload runs (the Bluetooth 'stuck' sheet of a reader - see L-F3 -, the resume sheet, the compat sheet)
// counts as the person's Cancel: xhr.abort() after every byte went out, "cancelled by the user" in the log, and the
// person uploads again - against the relay's 6 uploads per address per hour.
//   google-chrome --headless=new --disable-gpu --remote-debugging-port=9351 --window-size=1200,800 --user-data-dir=$(mktemp -d) about:blank &
//   python3 test/browser/serve.py 8101 public &
//   PORT=8101 CDP=9351 node test/browser/longrun_fable_upload.mjs
const PORT = +(process.env.PORT || 8101), CDP = +(process.env.CDP || 9351);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => { setTimeout(() => rej(new Error('eval timed out after 90 s: ' + expr.slice(0, 120))), 90000); })]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const T00 = Date.now();
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} [${Math.round((Date.now() - T00) / 1000)}s] ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 900)}`}`); if (!cond) fails++; };

// an XMLHttpRequest to the log route whose body goes out at once (progress: every byte sent) and whose answer waits
// for window.__release - the relay has the log, the phone has not heard back yet
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__aborted = 0; window.__sent = 0; window.__posts = 0;
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const x = { upload: {}, status: 0, responseText: '', _h: {}, aborted: false, timeout: 0 };
    x.open = (m, u) => { x.method = m; x.url = String(u); };
    x.setRequestHeader = (k, v) => { x._h[k] = v; };
    x.abort = () => { x.aborted = true; window.__aborted++; x.onabort && x.onabort(); };
    x.send = (body) => {
      if (!x.url.endsWith('/batray/api/log')) throw new Error('unexpected xhr ' + x.url);
      const total = body.byteLength || body.length;
      setTimeout(() => {
        if (x.aborted) return;
        window.__sent = total; window.__posts++;                                       // the body is on the wire: the relay stores it whatever the phone does next
        x.upload.onprogress && x.upload.onprogress({ loaded: total, total, lengthComputable: true });
        window.__release = () => { if (x.aborted) return; x.status = 200; x.responseText = JSON.stringify({ id: 'TestLogId0000000000000', key: 'logs/x' }); x.onload && x.onload(); };
      }, 100);
    };
    return x;
  };
  void RealXHR;
` });

await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await evalJs(`document.getElementById('debugBtn').click(); 1`); await sleep(300);           // the stored log on: Upload log usable
await evalJs(`document.getElementById('upload2').click(); 1`); await sleep(300);
await evalJs(`document.querySelector('#sheetActs [data-act=ok]').click(); 1`); await sleep(600);
const inFlight = await evalJs(`({ open: !document.getElementById('sheet').hidden, kind: window.__batrayTest.uiState().sheet && window.__batrayTest.uiState().sheet.kind, lead: document.getElementById('sheetLead').textContent, sent: window.__sent, posts: window.__posts, aborted: window.__aborted })`);
check('setup: the upload is in flight with every byte sent and the relay\'s answer pending; its progress sheet is open', inFlight.open && inFlight.kind === 'uploading' && inFlight.posts === 1 && inFlight.sent > 1000 && inFlight.aborted === 0 && /100 %/.test(inFlight.lead), inFlight);

// the app opens a sheet of its own over the progress dialog: what a reader's connection loop does when it takes a
// 30 s Android connect timeout for a connect made with Bluetooth off (L-F3: `onStuck` -> openSheet('btStuck'))
await evalJs(`void window.__batrayTest.openSheet('btStuck'); 1`); await sleep(400);
const after = await evalJs(`({ aborted: window.__aborted, sent: window.__sent, kind: window.__batrayTest.uiState().sheet && window.__batrayTest.uiState().sheet.kind, toast: document.getElementById('toast').textContent, lines: window.__batrayTest.logLines().filter((l) => /log upload/.test(l)).slice(-3) })`);
check('L-F7: a sheet the app opens by itself over the upload\'s progress dialog does not cancel an upload whose bytes are already on the wire (the relay keeps it either way: "cancelled by the user (N of N B sent)" is a second copy waiting to happen)', after.aborted === 0 && !after.lines.some((l) => /cancelled by the user/.test(l)), after);
await evalJs(`window.__release && window.__release(); 1`); await sleep(400);
const done = await evalJs(`({ lines: window.__batrayTest.logLines().filter((l) => /log upload/.test(l)).slice(-3), idShown: !document.getElementById('uploadId').hidden })`);
check('L-F7: the relay\'s answer (the id) still reaches the person after that sheet', done.idShown && done.lines.some((l) => /log uploaded: id TestLogId/.test(l)), done);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'LONGRUN FABLE UPLOAD TEST FAILED' : 'longrun fable upload test ok');
process.exit(fails ? 1 : 0);
