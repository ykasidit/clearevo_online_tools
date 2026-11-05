// BatRay by ClearEvo.com - tests (longrun_opus_upload.mjs)
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
// Long-run review (opus) L-O7, from the owner's viewer log (0.9.82): "log upload: cancelled by the user (156303 of
// 156303 B sent)" - and the relay had stored it. Once every byte has gone, the upload is the server's: a Cancel
// then aborts only our wait for the answer, so the app says "cancelled", never shows the id, and the person sends it
// again. The longer a reader runs with the debug log on, the bigger the session file (up to 4 MB is sent) and the
// longer that silent wait at 100 %. Run with Chrome on CDP 9341 and serve.py on 8091 (see the runner in the report).
const PORT = 8091, CDP = 9341;
const BASE = `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 600)}`}`); if (!cond) fails++; };

// The relay as the log showed it: every byte arrives (progress 100 %), the server stores the log, its answer is slow.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__stored = 0;
  window.XMLHttpRequest = function () {
    const x = { upload: {}, status: 0, responseText: '', aborted: false };
    x.open = (m, u) => { x.url = String(u); };
    x.setRequestHeader = () => {};
    x.abort = () => { x.aborted = true; if (x.onabort) x.onabort(); };
    x.send = (body) => {
      const total = body.byteLength || body.length;
      setTimeout(() => {
        if (x.upload.onprogress) x.upload.onprogress({ loaded: total, total, lengthComputable: true });
        window.__stored++;                                                   // the relay has it now, whatever the page does next
        setTimeout(() => { if (x.aborted) return; x.status = 200; x.responseText = JSON.stringify({ id: 'StoredLogId00000000000', key: 'logs/x' }); if (x.onload) x.onload(); }, 4000);
      }, 200);
    };
    return x;
  };
` });
await send('Page.navigate', { url: `${BASE}/batray/?test&lr=1` }); await sleep(3000);
await evalJs(`window.__batrayTest.setLogKeep(true); 1`); await sleep(300);
await evalJs(`document.getElementById('upload2').click(); 1`); await sleep(300);
await evalJs(`document.querySelector('#sheetActs [data-act=ok]').click(); 1`); await sleep(800);
const mid = await evalJs(`({ lead: document.getElementById('sheetLead').textContent, stored: window.__stored })`);
await evalJs(`document.querySelector('#sheetActs [data-act=cancel]').click(); 1`);       // the person gives up on a sheet stuck at 100 %
await sleep(5000);
const end = await evalJs(`({ toast: document.getElementById('toast').textContent, idShown: !document.getElementById('uploadId').hidden, idTxt: document.getElementById('uploadId').textContent, stored: window.__stored, line: window.__batrayTest.logLines().filter((l) => /log upload/.test(l)).slice(-2) })`);
check('L-O7: a log the relay already has (every byte sent) is never reported as "cancelled" - the app keeps the answer (the id) or says it may have arrived', mid.stored === 1 && end.stored === 1 && !/cancelled/i.test(end.toast) && (end.idShown || /may have|arrived|sent/i.test(end.toast)), { mid, end });
ws.close();
process.exit(fails ? 1 : 0);
