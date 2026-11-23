// BatRay by ClearEvo.com - review tests (fable, round 1): a small CDP client shared by the browser tests in this folder
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
// Run: chrome --headless=new --remote-debugging-port=9427 ..., python3 test/browser/serve.py 8412 public,
// then CDP=9427 PORT=8412 node test/review/<name>.mjs
export const PORT = +(process.env.PORT || 8412), CDP = +(process.env.CDP || 9427);
export const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** A fresh tab of its own (so two tests never share page state), closed by done(). */
export async function openTab() {
  // a BatRay tab a failed run left open holds the one-reader lock: this Chrome is the tests' own, close them first
  for (const o of await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()) if (o.type === 'page' && /\/batray\//.test(o.url)) await fetch(`http://127.0.0.1:${CDP}/json/close/${o.id}`).catch(() => {});
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } else if (d.method) events.push(d); };
  const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((ok) => { ws.onopen = ok; });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  let fails = 0;
  const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got === undefined ? null : got).slice(0, 700)}`}`); if (!cond) fails++; };
  const logs = (re) => evalJs(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`);
  const done = async () => { ws.close(); await fetch(`http://127.0.0.1:${CDP}/json/close/${t.id}`).catch(() => {}); console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0); };
  return { send, evalJs, check, logs, done, events };
}

/** The relay as the page sees it: POST /room answers at once, every WebSocket is a fake that opens, records what is
 *  sent (window.__wsSent) and what closed it (ws.closedWith). */
export const FAKE_RELAY = `
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => {
    const url = String(u);
    if (url.endsWith('/batray/api/log')) return new Response(JSON.stringify({ id: 'Log1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/batray/api/room') && (i.method || 'GET').toUpperCase() === 'POST') return new Response(JSON.stringify({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/batray/api/room/')) return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    return rf(u, i);
  };
  window.__wsSent = []; window.__wsAll = [];
  window.WebSocket = class {
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.closedWith = null; window.__wsAll.push(this); setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); }
    send(s) { const m = JSON.parse(s); window.__wsSent.push(m); if (m.type === 'ping') setTimeout(() => this.push({ type: 'pong' }), 5); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.closedWith = { code, reason, at: Date.now() }; if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
    push(m) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
  };`;

/** The fake Web Bluetooth device of test/browser/batray_freeze.mjs (one device "n11", id fake-1; window.__notify feeds it). */
export async function fakeBle() {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(new URL('../browser/batray_freeze.mjs', import.meta.url), 'utf8')).match(/const FAKE = `([\s\S]*?)\n`;/)[1];
}
