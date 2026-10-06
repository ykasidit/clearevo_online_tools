// BatRay by ClearEvo.com - tests (batray_tabs.mjs): one store per tab - tabs store at once, a reopened reader adopts, Browse sees all
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
// Owner decision 2026-10-06: "remove this history lock, store per tab id; re-download per tab is fine, the same for
// debug logs; Browse can list and delete for all; keep only the settings global". Real tabs of one browser, opened and
// closed over CDP: the old store (one pool for every tab, before 0.9.77) and its global keys go to the first reader;
// a second reader tab stores at the same time in a store of its own; Browse lists the other tab's store as open and
// will not delete it; the first tab closes and a new reader tab takes its store over (rows, last-run record); a viewer
// tab gets a store of its own; a closed tab's store is deleted from Browse; every tab's debug log is listed.
const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 700)}`}`); if (!cond) fails++; };
const STUB = `window.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); } send() {} close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); } };`;

/** One tab over CDP. */
class Tab {
  static async attach(target) {
    const t = new Tab(); t.target = target; t.events = [];
    t.ws = new WebSocket(target.webSocketDebuggerUrl); t.id = 0; t.pending = new Map();
    t.ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && t.pending.has(d.id)) { const { ok, err } = t.pending.get(d.id); t.pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } else if (d.method) t.events.push(d); };
    await new Promise((ok) => { t.ws.onopen = ok; });
    await t.send('Runtime.enable'); await t.send('Page.enable');
    await t.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
    return t;
  }
  static async open(url) {
    const target = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
    const t = await Tab.attach(target); await t.go(url); return t;
  }
  send(method, params = {}) { return new Promise((ok, err) => { const i = ++this.id; this.pending.set(i, { ok, err }); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async go(url, wait = 3000) { await this.send('Page.navigate', { url }); await sleep(wait); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; }
  logs(re) { return this.eval(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`); }
  async close() { try { this.ws.close(); } catch { /* gone */ } await fetch(`http://127.0.0.1:${CDP}/json/close/${this.target.id}`); await sleep(1500); }
  thrown() { return this.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); }
}
const day = new Date().toISOString().slice(0, 10);
const seed = (tab, p, n) => tab.eval(`window.__batrayTest.histSeed(Array.from({ length: ${n} }, (_, i) => ({ t: Date.now() - (${n} - i) * 3000, p: '${p}', soc: 60, v: 52.1, i: -3, w: -156 })))`);
const rowsOf = (tab) => tab.eval(`window.__batrayTest.histInfo('${day}').then((i) => i.rows)`);
const tabOf = (tab) => tab.eval('window.__batrayTest.tab()');

const first = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
const A = await Tab.attach(first);

// ---- 1. a phone that ran 0.9.76: one shared pool and global keys; the first reader page takes them ----
await A.go(`${BASE}/batray/README.md`, 800);
await A.eval(`(async () => {
  const root = await navigator.storage.getDirectory(); await root.getDirectoryHandle('batray-history-db', { create: true });
  localStorage.setItem('batray_share_name', 'oldyard');
  localStorage.setItem('batray_lastrun', JSON.stringify({ sid: 'old001', at: Date.now() - 600000, clean: true, state: 'reader connected, sharing on', browser: 'chrome 141' }));
  localStorage.setItem('batray_lang', 'en');
  return 1;
})()`);
await A.go(`${BASE}/batray/?test`);
const ta = await tabOf(A);
check('the first reader page takes the store from before 0.9.77', ta.id === 'legacy' && ta.how === 'legacy', ta);
const moved = await A.eval(`({ name: localStorage.getItem(window.__batrayTest.tabKey('share_name')), oldName: localStorage.getItem('batray_share_name'), oldRun: localStorage.getItem('batray_lastrun'), lang: localStorage.getItem('batray_lang') })`);
check('...with its state: the share name moves into the tab, the global keys go, settings stay global', moved.name === 'oldyard' && moved.oldName === null && moved.oldRun === null && moved.lang === 'en', moved);
check('...and the last run before the update is reported', (await A.logs("/previous session old001/")).length === 1, await A.logs('/previous session|first start/'));
check('the log names the tab choice', (await A.logs('/^.{14}tab: store legacy \\(reader\\) - takes over the store from before 0.9.77/')).length === 1, await A.logs('/tab: /'));
check('A seeds 5 rows into its store', (await seed(A, 'n11', 5)) === 5 && (await rowsOf(A)) === 5);
const sidA = await A.eval('window.__batrayTest.logState().sid');

// ---- 2. a second reader tab while A is open: no lock, no grey card - a store of its own, both storing ----
const B = await Tab.open(`${BASE}/batray/?test`);
const tb = await tabOf(B);
check('B is a new tab with its own store (A is open)', tb.how === 'new' && tb.id !== 'legacy' && /^[a-z0-9]{8}$/.test(tb.id), tb);
const bh = await B.eval('({ backend: window.__batrayTest.histState().backend, off: window.__batrayTest.histOffState().off })');
check('B stores in SQLite too, its History card is not greyed', bh.backend === 'opfs' && !bh.off, bh);
check('B and A store at the same time, each into its own day file', (await seed(B, 'm-00', 3)) === 3 && (await rowsOf(B)) === 3 && (await rowsOf(A)) === 5);
check('A keeps storing after B started', (await seed(A, 'n11', 2)) === 2 && (await rowsOf(A)) === 7);
await B.eval(`void window.__batrayTest.openBrowse('hist'); 1`); await sleep(800);
let br = await B.eval('window.__batrayTest.browseState().items');
const legacyRow = br.find((i) => i.id === 'store:legacy');
check('Browse in B lists A\'s store as open in another tab, without Delete', legacyRow && !legacyRow.del && /open in another tab/.test(legacyRow.name) && /from before 0\.9\.77/.test(legacyRow.name), br);
await B.eval(`document.getElementById('sheetBack') ? document.getElementById('sheetBack').click() : null; 1`); await sleep(300);

// ---- 3. logs: each tab its own; Browse lists them all ----
await B.eval(`document.getElementById('logKeep').checked || document.getElementById('logKeep').click(); 1`); await sleep(300);
await B.eval('window.__batrayTest.flushLog()'); await sleep(500);
await A.eval(`document.getElementById('logKeep').checked || document.getElementById('logKeep').click(); 1`); await sleep(300);
await A.eval('window.__batrayTest.flushLog()'); await sleep(500);
await A.eval(`void window.__batrayTest.openBrowse('log'); 1`); await sleep(800);
br = await A.eval('window.__batrayTest.browseState().items');
const bLog = br.find((i) => i.id.startsWith(`${tb.id}/log-`)), aLog = br.find((i) => i.id.startsWith('legacy/log-'));
check('Browse logs in A lists B\'s session file (another tab, open: no Delete) and its own (this session, live)', bLog && !bLog.del && /another tab, open/.test(bLog.name) && aLog && /this session, live/.test(aLog.name), br.map((i) => [i.id, i.name, i.del]));
await A.eval(`document.getElementById('sheetBack') ? document.getElementById('sheetBack').click() : null; 1`); await sleep(300);

// ---- 4. A closes (Chrome killed it, say); a new reader tab takes its store over ----
await A.close();
const C = await Tab.open(`${BASE}/batray/?test`);
const tc = await tabOf(C);
check('C, a new tab, takes over the closed reader store (A\'s), not B\'s open one', tc.id === 'legacy' && /closed reader tab/.test(tc.why), tc);
check('...with A\'s rows', (await rowsOf(C)) === 7);
check('...and A\'s last-run record (the run before, in this store)', (await C.logs(`/previous session ${sidA}/`)).length === 1, await C.logs('/previous session|first start/'));

// ---- 5. a viewer tab: a store of its own (never a reader's), re-downloaded from its reader ----
const KEY = 'qOZe1xrVxvTfYHUobOqjmg';
const V = await Tab.open(`${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test#k=${KEY}`);
const tv = await tabOf(V);
check('a viewer tab gets a store of its own', tv.how === 'new' && tv.role === 'viewer' && tv.id !== tb.id && tv.id !== 'legacy', tv);
check('...and stores', (await V.eval('window.__batrayTest.histState().backend')) === 'opfs');
await V.close();

// ---- 6. Browse deletes a closed tab's store ----
await B.eval(`void window.__batrayTest.openBrowse('hist'); 1`); await sleep(800);
br = await B.eval('window.__batrayTest.browseState().items');
const vRow = br.find((i) => i.id === `store:${tv.id}`);
check('Browse in B lists the closed viewer tab\'s store with Delete', vRow && vRow.del && /a viewer tab/.test(vRow.name) && /closed, last used/.test(vRow.name), br.map((i) => [i.id, i.name, i.del]));
await B.eval(`window.__batrayTest.browseDelete('store:${tv.id}')`); await sleep(800);
const left = await B.eval(`(async () => ({ stores: (await window.__batrayTest.hasStores()).map((s) => s.id), meta: localStorage.getItem('batrayTab:${tv.id}') }))()`);
check('...Delete removes its files and its tab record', !left.stores.includes(tv.id) && left.meta === null && left.stores.includes(tb.id) && left.stores.includes('legacy'), left);
await B.eval(`document.getElementById('sheetBack') ? document.getElementById('sheetBack').click() : null; 1`); await sleep(300);

// ---- 7. a reload keeps the tab's store ----
await B.go(`${BASE}/batray/?test&n=2`);
const tb2 = await tabOf(B);
check('a reload of B keeps B\'s store and rows', tb2.id === tb.id && tb2.how === 'same' && (await rowsOf(B)) === 3, tb2);

const thrown = [...B.thrown(), ...C.thrown()];
check('no page exceptions', thrown.length === 0, thrown);
console.log(fails ? 'BATRAY TABS TEST FAILED' : 'batray tabs test ok');
process.exit(fails ? 1 : 0);
