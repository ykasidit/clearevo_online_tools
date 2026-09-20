// BatRay by ClearEvo.com - tests (batray_ui.mjs): UI_GUIDELINES.md on the real page - targets, sheets, Back, tabs, low power
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
// Reader (demo) at phone width: every visible control is at least 48 px tall,
// the battery / chips / cells tiles open bottom sheets with a plain sentence,
// Back and tap-outside close them, language and keep-awake are sheets, no
// <select> anywhere, low power drops the decorative motion. Viewer: the bottom
// tab bar, Now / History / More, Back returns to Now once.
const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
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
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 600)}`}`); if (!cond) fails++; };

// ---- Reader at phone width, on the demo ----
await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/batray/?test&demo` }); await sleep(3000);
const audit = await evalJs(`(() => {
  const small = [];
  for (const el of document.querySelectorAll('button, .linkbtn, .pchip, summary, .optbtn')) {
    if (el.closest('.title-bar-controls')) continue;                       // A- / A+ / About: 40 px in the fixed title bar (UI_GUIDELINES.md exception)
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;   // hidden
    if (r.height < 48) small.push(\`\${el.id || el.className || el.tagName}:\${Math.round(r.height)}\`);
  }
  return { small, selects: document.querySelectorAll('select').length, sheetHidden: document.getElementById('sheet').hidden };
})()`);
check('every visible control on the reader is at least 48 px tall, and there is no <select>', audit.small.length === 0 && audit.selects === 0 && audit.sheetHidden, audit);

const tw = await evalJs(`({ shown: getComputedStyle(document.getElementById('trendWait')).display !== 'none', txt: document.getElementById('trendWaitTxt').textContent, w: document.getElementById('trendWaitBar').style.width })`);
check('the trend placeholder counts the seconds collected with a bar', tw.shown && /\d+ s of 30 s/.test(tw.txt) && parseInt(tw.w, 10) > 0, tw);
await evalJs(`document.getElementById('gBatt').dispatchEvent(new Event('click', { bubbles: true })); 1`); await sleep(250);
let sh = await evalJs(`({ shown: !document.getElementById('sheet').hidden, title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, rows: document.querySelectorAll('#sheetRows .k').length, state: history.state, ui: window.__batrayTest.uiState() })`);
check('tapping the battery opens a sheet: plain sentence with the time to go, technical rows below, a history entry', sh.shown && sh.title === 'Battery' && /% full\./.test(sh.lead) && sh.rows >= 3 && sh.state && sh.state.sheet === 'soc' && sh.ui.sheet && sh.ui.sheet.kind === 'soc', sh);
await evalJs(`history.back(); 1`); await sleep(400);
sh = await evalJs(`({ shown: !document.getElementById('sheet').hidden, ui: window.__batrayTest.uiState(), log: window.__batrayTest.logLines().filter((l) => /ui: back/.test(l)).slice(-1) })`);
check('the Back button closes the sheet (a messenger habit)', !sh.shown && sh.ui.sheet === null && /back -> close-sheet/.test(sh.log[0] || ''), sh);
await evalJs(`document.getElementById('strip').click(); 1`); await sleep(250);
sh = await evalJs(`({ title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, tone: document.getElementById('sheetLead').className })`);
check('the chips open the BMS status sheet with a verdict in plain words', sh.title === 'BMS status' && /alarm/.test(sh.lead) && /lead (ok|watch|act)/.test(sh.tone), sh);
await evalJs(`document.getElementById('sheetBack').click(); 1`); await sleep(400);
sh = await evalJs(`({ shown: !document.getElementById('sheet').hidden, state: history.state })`);
check('tapping outside closes it and takes its history entry back', !sh.shown && !(sh.state && sh.state.sheet), sh);
await evalJs(`document.getElementById('cellsStat').click(); 1`); await sleep(250);
sh = await evalJs(`({ title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, rows: [...document.querySelectorAll('#sheetRows .k')].map((e) => e.textContent) })`);
check('the cell line opens the cells sheet naming the lowest and highest cell', sh.title === 'Cells' && /mV apart/.test(sh.lead) && sh.rows.includes('lowest cell') && sh.rows.includes('highest cell'), sh);
await evalJs(`window.__batrayTest.closeSheet(null, 'test'); 1`); await sleep(300);

// language and keep-awake are sheets with big buttons
await evalJs(`document.getElementById('langBtn').click(); 1`); await sleep(250);
sh = await evalJs(`({ opts: [...document.querySelectorAll('#sheetOpts [data-opt]')].map((b) => [b.dataset.opt, b.classList.contains('on')]) })`);
check('the language sheet lists EN and ไทย and marks the current one', sh.opts.length === 2 && sh.opts[0][0] === 'en' && sh.opts[0][1] === true, sh);
await evalJs(`document.querySelector('#sheetOpts [data-opt="th"]').click(); 1`); await sleep(400);
sh = await evalJs(`({ lang: document.documentElement.lang, lbl: document.getElementById('langLbl').textContent, tab: document.querySelector('[data-tab-btn=now] span').textContent, saved: localStorage.getItem('batray_lang'), sheetHidden: document.getElementById('sheet').hidden })`);
check('picking ไทย switches the page and is remembered', sh.lang === 'th' && sh.lbl === 'TH' && sh.tab === 'ตอนนี้' && sh.saved === 'th' && sh.sheetHidden, sh);
await evalJs(`document.getElementById('langBtn').click(); 1`); await sleep(200); await evalJs(`document.querySelector('#sheetOpts [data-opt="en"]').click(); 1`); await sleep(300);
await evalJs(`document.getElementById('keepAwake').click(); 1`); await sleep(200);
sh = await evalJs(`({ opts: [...document.querySelectorAll('#sheetOpts [data-opt]')].map((b) => b.dataset.opt), lead: document.getElementById('sheetLead').textContent })`);
check('keep-awake is a three-way sheet with its explanation', sh.opts.join(',') === 'auto,always,never' && /silent/.test(sh.lead), sh);
await evalJs(`document.querySelector('#sheetOpts [data-opt="always"]').click(); 1`); await sleep(300);
sh = await evalJs(`({ v: document.getElementById('keepAwake').dataset.value, txt: document.getElementById('keepAwake').textContent, mode: window.__batrayTest.wakeState().mode })`);
check('...and the choice shows on the button and in the state', sh.v === 'always' && sh.txt === 'always' && sh.mode === 'always', sh);
await window_reset();
async function window_reset() { await evalJs(`window.__batrayTest.setKeepAwake('auto'); 1`); }

// low power: no decorative motion
await evalJs(`document.getElementById('lowPower').click(); 1`); await sleep(200);
sh = await evalJs(`({ cls: document.body.classList.contains('lowpower'), saved: localStorage.getItem('batray_lowpower'), anim: getComputedStyle(document.getElementById('fDash')).animationName, ui: window.__batrayTest.uiState().lowPower })`);
check('low power stops the flow animation and is remembered', sh.cls && sh.saved === '1' && sh.anim === 'none' && sh.ui === true, sh);
await evalJs(`document.getElementById('lowPower').click(); 1`); await sleep(100);

// ---- Viewer at phone width: bottom tabs and Back ----
await evalJs(`localStorage.removeItem('batray_lang'); 1`);
await send('Page.navigate', { url: `${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test#k=AbCdEfGhIjKlMnOpQrStUv` }); await sleep(2500);
let vw = await evalJs(`({ tabs: !document.getElementById('tabs').hidden, tab: document.body.dataset.tab, role: window.__batrayTest.uiState().role, view: document.body.classList.contains('view'), small: [...document.querySelectorAll('[data-tab-btn]')].filter((b) => b.getBoundingClientRect().height < 48).length })`);
check('the viewer shows the bottom tab bar on Now, with 48 px tabs', vw.tabs && vw.tab === 'now' && vw.role === 'viewer' && vw.view && vw.small === 0, vw);
const top = await evalJs(`({ btNote: getComputedStyle(document.getElementById('btNote')).display, rows: document.querySelector('.toolbar').getBoundingClientRect().height, packBar: document.getElementById('packBar').hidden, tbrowScrolls: getComputedStyle(document.querySelector('.tbrow')).overflowX })`);
check('the viewer top is compact: no Bluetooth note, one scrolling icon row, no pack bar for a lone pack', top.btNote === 'none' && top.rows < 90 && top.packBar && top.tbrowScrolls === 'auto', top);
await evalJs(`document.getElementById('viewTxt').click(); 1`); await sleep(250);
const lv = await evalJs(`({ title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, chip: document.getElementById('viewTxt').textContent })`);
check('tapping the live chip opens a sheet with its full text', lv.title === 'Live link' && lv.lead === lv.chip && lv.lead.length > 5, lv);
await evalJs(`window.__batrayTest.closeSheet(null, 'test'); 1`); await sleep(300);
await evalJs(`document.querySelector('[data-tab-btn=history]').click(); 1`); await sleep(200);
await evalJs(`document.querySelector('[data-tab-btn=more]').click(); 1`); await sleep(200);
vw = await evalJs(`({ tab: document.body.dataset.tab, state: history.state, on: document.querySelector('[data-tab-btn].on').dataset.tabBtn, flowHidden: getComputedStyle(document.getElementById('flowCard')).display === 'none', notesShown: getComputedStyle(document.getElementById('notesCard')).display !== 'none' })`);
check('History then More: the More tab shows the detail cards and hides the picture, one history entry', vw.tab === 'more' && vw.state && vw.state.tab === 'more' && vw.on === 'more' && vw.flowHidden && vw.notesShown, vw);
await evalJs(`history.back(); 1`); await sleep(400);
vw = await evalJs(`({ tab: document.body.dataset.tab, on: document.querySelector('[data-tab-btn].on').dataset.tabBtn, flowShown: getComputedStyle(document.getElementById('flowCard')).display !== 'none' })`);
check('Back returns to Now once', vw.tab === 'now' && vw.on === 'now', vw);
await evalJs(`document.querySelector('[data-tab-btn=history]').click(); 1`); await sleep(200);
const hw = await evalJs(`({ waitShown: getComputedStyle(document.getElementById('trendWait')).display !== 'none', txt: document.getElementById('trendWaitTxt').textContent, cardHidden: document.getElementById('trendCard').hidden })`);
check('History never shows blank: without readings it says the trend starts once they arrive', hw.waitShown && /once readings arrive/.test(hw.txt) && hw.cardHidden, hw);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY UI TEST FAILED' : 'batray ui test ok');
process.exit(fails ? 1 : 0);
