// BatRay by ClearEvo.com - review tests (fable, round 6) F6-1: a today file whose ids start above 1 is asked for and sent again every few seconds, for ever
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
//
// 0.9.94 keeps the reader's row ids going when today's file starts over (after a store wipe: initHistoryOnce;
// after a corrupt live file: corruptDb). The renewed file then holds ids N+1..M, not 1..M. A viewer that has
// nothing of today yet (opened after the renewal, or its own store started over) is sent those rows and stores
// them - and its copy has contiguity 0 (contigId: the lowest id is above 1), which storeReceived() reads as a hole:
// it asks again at once (gap ask), the reader's transferPlan gets today's `have` with contig 0 and no row count
// (requestHistory sends `rows` for past days only, so the 0.9.90 "same rows" skip does not apply), plans the whole
// day again from id 0, the viewer stores "0 new", sees the same "hole", and - because every received file resets
// gapAsks - asks again GAP_REQ_MS later. The whole of today travels every ~5 s for the rest of the UTC day, per such
// viewer: on the reader a flush, a day listing, the rows read, gzipped, encrypted and sent each time. Before 0.9.93
// a today file always started at 1, so this could not happen; it is the price of the id fix, not yet paid for.
//
// (A live row is what starts each ask: it lands above the "hole".)
// The real viewer page over a fake relay socket; this test plays the reader: live readings with their rows, and every hist-req is answered the way the
// reader's own transferPlan (the page's history-logic module) says, with a today file of ids 101..150.
// Expected: the day is sent once; a viewer that holds exactly the reader's rows does not get them again.
// Run: CDP=9427 PORT=8412 node test/review/fable_r6_today_resend.mjs
import { openTab, FAKE_RELAY, BASE, sleep } from './fable_cdp.mjs';
import { OWNER_32S_CELL } from '../batray_frames.js';

const KEY = 'qOZe1xrVxvTfYHUobOqjmg';
const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test#k=${KEY}` }); await sleep(3500);
// the reader's side, in the page: the room says the reader is there, a hello keeps it present, hist-req is answered
await t.evalJs(`(async () => {
  const L = await import('/batray/live-logic.js'), H = await import('/batray/history-logic.js'), T = window.__batrayTest;
  const key = await L.importKey('${KEY}');
  const sock = () => window.__wsAll.filter((w) => /role=view/.test(w.url)).at(-1);
  const pub = async (env) => { const b = await L.encrypt(key, env); let s = ''; for (const x of b) s += String.fromCharCode(x); sock().push({ type: 'd', b: btoa(s) }); };
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: 101 + i, t: now - (50 - i) * 3000, p: 'n11', soc: 44, v: 52, w: -90 }));   // today's renewed file: ids go on from 101
  const gz = await T.gzipBytes(new TextEncoder().encode(JSON.stringify(rows)));
  let bin = ''; for (const x of gz) bin += String.fromCharCode(x);
  window.__resends = []; window.__asks = 0;
  const seen = new Set();
  setInterval(() => {
    for (const m of window.__wsSent) {
      if (m.type !== 'hist-req' || seen.has(m)) continue;
      seen.add(m); window.__asks++;
      const plan = H.transferPlan([{ day, rows: rows.length, maxId: 150 }], m.have);          // what the reader would send
      const item = plan.find((p) => p.day === day);
      if (!item) continue;
      window.__resends.push({ after: item.after, rows: item.rows, have: (m.have || []).find((h) => h.day === day) || null });
      const send = rows.filter((r) => r.id > item.after);
      void pub({ k: 'hist-file', p: { id: '*', name: '*' }, t: Date.now(), v: { day, after: item.after, n: 0, of: 1, b64: btoa(bin), rows: send.length, bytes: gz.length } });
    }
  }, 200);
  sock().push({ type: 'status', viewers: 1, live: true });
  // the reader's live readings go on, each with its stored row (ids 151, 152, ...), one per 3 s as the reader stores them
  const J = await import('/batray/jkbms.js'), d = J.decodeCellInfo(Uint8Array.from([${[...OWNER_32S_CELL].join(',')}]), 11);
  let id = 150;
  setInterval(() => { const at = Date.now(); void pub({ k: 'data', p: { id: 'bt-fake-1', name: 'n11' }, t: at, v: d, r: { id: ++id, t: at, p: 'n11', soc: 44, v: 52, w: -90 } }); }, 3000);
  return 1;
})()`);
await sleep(60000);
const r = await t.evalJs(`({ asks: window.__asks, resends: window.__resends, lines: window.__batrayTest.logLines().filter((l) => /history: (asked|got|receiving)/.test(l)).map((l) => l.slice(14, 150)) })`);
console.log(`in 60 s: ${r.asks} history asks, today sent ${r.resends.length} times; last lines:\n  ${r.lines.slice(-4).join('\n  ')}`);
t.check('setup: the viewer asked and was sent today (ids 101..150) at least once', r.resends.length >= 1 && r.lines.some((l) => /got .* ids 101\.\.150/.test(l)), r.lines.slice(0, 6));
// threshold: once to deliver it, and at most one more for an ask already on its way when the file landed
t.check(`F6-1: today's rows are sent once, not again and again (the viewer holds exactly the reader's 50 rows) - sent ${r.resends.length} times in 60 s`, r.resends.length <= 2, r.resends.slice(-2));
await t.done();
