// BatRay by ClearEvo.com - tests (longrun_fable_worker.mjs): what grows in the history worker with the stored days
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
// Long-run review round 3 (Fable, 2026-11-05). The year simulation's history worker grew ~0.7 MB per stored day
// (22.8 -> 89.8 MB over days 30..120 on 44594ac) with the listing and info() already cached. Probes on 9351/8101
// pinned it down (numbers in the review report):
//   - a stored day file costs nothing while closed: 40 one-row files inserted ten at a time with the databases idle-
//     closed in between: 10.2 -> 10.5 MB; deleting every file: 10.5 MB (the sahpool slots are not the cost);
//   - an OPEN past-day database costs ~0.25 MB of wasm heap (a connection) plus its page cache (up to 512 KB), and the
//     wasm heap never shrinks: 120 days inserted back to back (every connection open) 10.2 -> 89.6 MB, idle-closing
//     them afterwards gives nothing back, and 20 more full walks over the closed files add nothing (open + close reuse
//     the freed heap: no fragmentation);
//   - so the growth is CONNECTIONS KEPT OPEN: history-worker.js closeIdle() closes a past day only after 60 s unused,
//     and visit() on a database that is ALREADY open refreshes usedAt and leaves it open. A periodic walk over the
//     stored days - refreshSpan() in app.js runs hist.span(label, now - 24 h, undefined) = EVERY day file every 5 s
//     while the trend card waits (the first 30 s, a pack with no reading for a day), the 'all' / 7 d chart query - keeps
//     every database some other op opened (insert into a past day: a viewer's received files, the first flush after
//     midnight, the simulation's seeding; rows() for a viewer transfer) alive for good.
//   L-F9  a periodic walk must not pin open connections: the 60 s idle close must still close them
//   L-F11 (measured, not asserted) what a viewer's transfer of 100 past-day files costs now that every past-day
//         write rewrites dayinfo-<store>.json (round-2 fix for L-F8)
// Run against a Chrome started with --remote-debugging-port=$CDP --enable-blink-features=ForceEagerMeasureMemory
// (so performance.measureUserAgentSpecificMemory answers at once) and serve.py on $PORT (own ports 9351 / 8101):
//   google-chrome --headless=new --disable-gpu --remote-debugging-port=9351 --window-size=1200,800 --enable-blink-features=ForceEagerMeasureMemory --user-data-dir=$(mktemp -d) about:blank &
//   python3 test/browser/serve.py 8101 public &
//   PORT=8101 CDP=9351 node test/browser/longrun_fable_worker.mjs
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
const evalJs = async (expr, ms = 90000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => { setTimeout(() => rej(new Error(`eval timed out after ${ms / 1000} s: ` + expr.slice(0, 120))), ms); })]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const T00 = Date.now();
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} [${Math.round((Date.now() - T00) / 1000)}s] ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 900)}`}`); if (!cond) fails++; };

await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3500);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
const today = new Date().toISOString().slice(0, 10);
const can = await evalJs(`typeof performance.measureUserAgentSpecificMemory === 'function' && window.crossOriginIsolated`);
check('setup: the page is cross-origin isolated and can measure its own memory (serve.py headers)', can === true, can);

// ---- L-F9: two rounds of 30 past days opened by inserts; between them a 70 s walk (a query over the stored days every
// 5 s: the same visit() the waiting trend card's span makes) beside the 10 s flush (insert into today, which runs closeIdle). If the idle close still works
// under the walk, round A's connections are closed before round B opens its own and B reuses A's heap: B adds
// little. If the walk pins them, B adds as much as A did. ----
const r = await evalJs(`(async () => {
  const T = window.__batrayTest; T.histTimeouts({ insert: 60000, days: 60000, info: 60000, query: 60000, rows: 60000, span: 60000 });
  const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const measure = async () => { const m = await performance.measureUserAgentSpecificMemory(); let w = 0; for (const b of m.breakdown) if (b.attribution.some((a) => /Worker/.test(a.scope))) w += b.bytes; return Math.round(w / 1048576 * 10) / 10; };
  const base = Date.parse('${today}T00:00:00Z') - 200 * 86400e3;
  const dayOf = (d) => new Date(base + d * 86400e3).toISOString().slice(0, 10);
  const mk = (from, i) => ({ id: i + 1, t: from + i * 15000, p: 'n11', soc: 50, v: 52.1, i: 12, w: 620, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: [3300, 3301, 3302, 3303, 3300, 3301, 3302, 3303, 3300, 3301, 3302, 3303, 3300, 3301, 3302, 3303] });
  const seed = async (from, to) => { for (let d = from; d < to; d++) { const t0 = base + d * 86400e3, rows = []; for (let i = 0; i < 5760; i++) rows.push(mk(t0, i)); await T.histInsert(dayOf(d), rows); } };
  // the walk the waiting trend card makes (refreshSpan -> hist.span over every stored day, every 5 s) beside the flush
  const walk = async (ms) => { const end = performance.now() + ms; let spans = 0, inserts = 0, k = 0; while (performance.now() < end) { await T.histInsert('${today}', [{ ...mk(Date.now(), 0), id: null, t: Date.now() + k++ }]); inserts++; for (let s = 0; s < 2; s++) { await T.histQuery({ p: 'n11', from: Date.now() - 86400e3, to: Date.now(), stepMs: 3600e3, days: Array.from({ length: 60 }, (_, d) => dayOf(d)) }).catch(() => 0); spans++; await wait(5000); } } return { spans, inserts }; };
  const m0 = await measure();
  await seed(0, 30); const mA = await measure();                                 // thirty past-day connections open (the inserts opened them)
  const wA = await walk(70000); const mAw = await measure();                     // 70 s: the idle close had its 60 s - unless the walk kept touching them
  await seed(30, 60); const mB = await measure();                                // thirty more
  const wB = await walk(70000); const mBw = await measure();
  // the control: 70 s of the flush alone (inserts into today, no walk) - the idle close gets its chance - then a third
  // batch of thirty: it must reuse the heap of the sixty closed connections
  const idle = async (ms) => { const end = performance.now() + ms; let k = 0; while (performance.now() < end) { await T.histInsert('${today}', [{ ...mk(Date.now(), 0), id: null, t: Date.now() + 1000 + k++ }]); await wait(10000); } };
  await idle(70000); const mBi = await measure();
  await seed(60, 90); const mC = await measure();
  return { m0, mA, mAw, mB, mBw, mBi, mC, dA: Math.round((mA - m0) * 10) / 10, dB: Math.round((mB - mAw) * 10) / 10, dC: Math.round((mC - mBi) * 10) / 10, wA, wB, stats: T.histStats().slice(0, 300) };
})()`, 400000);
console.log(`L-F9 numbers: worker ${r.m0} MB -> round A (30 past days inserted) ${r.mA} -> after a 70 s walk ${r.mAw} -> round B (30 more) ${r.mB} -> after a 70 s walk ${r.mBw} MB -> 70 s of the flush alone ${r.mBi} -> round C (30 more) ${r.mC} MB; walks ${JSON.stringify(r.wA)} / ${JSON.stringify(r.wB)}`);
// Round 3 (851663c) closes a past day after every op whoever opened it, so a batch of past-day inserts leaves no open
// connection to pin: each batch must add next to nothing, with or without the walk. On 44594ac batch A added 12.6 MB
// (thirty open connections) and batch B 21.8 MB under the walk (the first thirty pinned, thirty more opened).
const CAP = 3;
check(`L-F9: thirty past days inserted add under ${CAP} MB of lasting worker memory - their connections do not stay open after the op (added ${r.dA} MB)`, r.dA < CAP, r);
check(`L-F9: a periodic walk over the stored days (the trend card's span every 5 s, a wide chart query) beside the flush pins no past-day connection: thirty more past days add under ${CAP} MB (added ${r.dB} MB)`, r.dB < CAP, r);
check(`L-F9 control: without the walk, thirty more past days add under ${CAP} MB too (added ${r.dC} MB)`, r.dC < CAP, r);

// ---- L-F11 (measured): a viewer's transfer into past days, now that a past day is opened and closed per op (round 3)
// and every write to a cached past day rewrites the day facts file (round 2): 100 new past-day files of 2000 rows (open
// + insert + close; nothing cached, nothing to forget), a listing (caches their facts), 100 more files of 2000 rows into
// those days (open + insert + close + forget -> facts file rewritten), against 100 inserts of 2000 rows into today ----
const x = await evalJs(`(async () => {
  const T = window.__batrayTest;
  const base = Date.parse('${today}T00:00:00Z') - 400 * 86400e3;
  const dayOf = (d) => new Date(base + d * 86400e3).toISOString().slice(0, 10);
  const mk = (from, i) => ({ id: i + 1, t: from + i * 40000, p: 'r1', soc: 50, v: 52.1, i: 12, w: 620 });
  const time = async (fn) => { const t0 = performance.now(); await fn(); return Math.round(performance.now() - t0); };
  const newFiles = await time(async () => { for (let d = 0; d < 100; d++) { const from = base + d * 86400e3, rows = []; for (let i = 0; i < 2000; i++) rows.push(mk(from, i)); await T.histInsert(dayOf(d), rows); } });
  await T.histList();                                                            // the 100 days are past days: their facts are cached and saved
  const known = await time(async () => { for (let d = 0; d < 100; d++) { const from = base + d * 86400e3 + 2000 * 40000, rows = []; for (let i = 0; i < 2000; i++) rows.push({ ...mk(from, i), id: 2001 + i }); await T.histInsert(dayOf(d), rows); } });
  const todayMs = await time(async () => { for (let d = 0; d < 100; d++) { const from = Date.parse('${today}T00:00:00Z') + d * 600e3, rows = []; for (let i = 0; i < 2000; i++) rows.push({ ...mk(from, i), id: 100000 + d * 2000 + i, t: from + i * 100 }); await T.histInsert('${today}', rows); } });
  const written = new Set(Array.from({ length: 100 }, (_, d) => dayOf(d)));
  const facts = await (async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('batray-history'); const f = await (await d.getFileHandle('dayinfo-' + T.tab().id + '.json')).getFile(); const keys = Object.keys(JSON.parse(await f.text())); return { bytes: f.size, days: keys.length, writtenStillCached: keys.filter((k) => written.has(k)).length }; } catch (e) { return { error: e.message }; } })();
  const relisted = (await T.histList()).filter((x) => written.has(x.day)).map((x) => x.rows);
  return { newFiles, known, todayMs, reopen: Math.round((newFiles - todayMs) / 100), reopenAndFacts: Math.round((known - todayMs) / 100), facts, relisted: { n: relisted.length, all4000: relisted.every((n) => n === 4000) } };
})()`, 300000);
console.log(`L-F11 numbers: 100 new past-day files of 2000 rows ${x.newFiles} ms, 100 more files into those (now cached) days ${x.known} ms, 100 inserts into today ${x.todayMs} ms -> open+close of a past day ~${x.reopen} ms per file, plus the facts-file rewrite ~${x.reopenAndFacts - x.reopen} ms per file; facts file ${JSON.stringify(x.facts)}`);
check('L-F11: a received past-day file costs under 50 ms of worker time beyond its insert (open + close + the facts-file rewrite) on this machine - a 100-file transfer well under 5 s extra', x.reopenAndFacts < 50, x);
check('L-F11: every written past day was forgotten from the facts file by its own write (none of the 100 stays cached with its old count), and the next listing counts them again (4000 rows each)', x.facts.writtenStillCached === 0 && x.relisted.n === 100 && x.relisted.all4000, { facts: x.facts, relisted: x.relisted });
await evalJs('window.__batrayTest.clearHistory()').catch(() => 0); await sleep(500);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'LONGRUN FABLE WORKER TEST FAILED' : 'longrun fable worker test ok');
process.exit(fails ? 1 : 0);
