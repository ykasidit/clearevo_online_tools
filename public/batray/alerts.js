// BatRay by ClearEvo.com - alerts delivery and settings panel
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

// Alerts: thresholds evaluated on every pack, delivered by ntfy and/or Chrome
// notifications; plus the gateway watchdog that lives on the relay (it is the
// only party that can notice this phone going silent). Settings persist in
// localStorage. Off until the user turns a channel on; the rule defaults are
// on so that turning a channel on is the only step.
import { RULES, defaultSettings, loadSettings, Evaluator, formatEvent, ntfyOk } from './alerts-logic.js';
import { makeKeyB64 } from './live-logic.js';

const API = '/batray/api';
const STORE = 'batray_alerts';
const TICK_MS = 5000, HEARTBEAT_MS = 60000;
// ntfy delivery and the relay watchdog are built and tested but not offered
// yet (ntfy.sh refuses posts from the relay's shared address without a paid
// account). Chrome notifications only, until a delivery path is settled.
export const NTFY_ENABLED = false;

export function initAlerts({ log, T, getPacks, viewMode, onStatus }) {
  let settings;
  try { settings = loadSettings(JSON.parse(localStorage.getItem(STORE) || 'null')); } catch { settings = defaultSettings(); }
  const ev = new Evaluator(settings);
  let watchId = null;
  try { watchId = localStorage.getItem('batray_watch_id'); if (!watchId) { watchId = makeKeyB64(); localStorage.setItem('batray_watch_id', watchId); } } catch { watchId = makeKeyB64(); }
  const $ = (id) => document.getElementById(id);
  let swReg = null;
  let lastHeartbeat = 0, watchSilent = false;

  function save() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* */ } ev.setSettings(settings); render(); onStatus(status()); }
  function status() {
    const on = [];
    if (NTFY_ENABLED && settings.channels.ntfy && ntfyOk(settings.ntfy)) on.push('ntfy');
    if (settings.channels.chrome && Notification.permission === 'granted') on.push('chrome');
    return { channels: on, watchdog: NTFY_ENABLED && settings.watchdog.on && settings.channels.ntfy && ntfyOk(settings.ntfy), watchSilent };
  }

  // ---- delivery ----
  async function sendNtfy(title, body, priority, tag) {
    const n = settings.ntfy;
    const headers = { Title: title, Priority: String(priority), Tags: tag };
    if (n.token) headers.Authorization = `Bearer ${n.token}`;
    const r = await fetch(`${n.server.replace(/\/+$/, '')}/${n.topic}`, { method: 'POST', body, headers });
    if (!r.ok) throw new Error(`ntfy ${r.status}`);
  }
  async function sendChrome(title, body, tag) {
    if (Notification.permission !== 'granted') throw new Error('notifications not allowed');
    if (swReg) { await swReg.showNotification(title, { body, tag, renotify: true, icon: '/batray/icon-192.png', badge: '/batray/icon-192.png' }); return; }
    new Notification(title, { body, tag, icon: '/batray/icon-192.png' });
  }
  async function deliver(title, body, priority, tag) {
    const st = status();
    const results = [];
    if (st.channels.includes('ntfy')) results.push(sendNtfy(title, body, priority, tag).then(() => 'ntfy ok').catch((e) => `ntfy failed: ${e.message}`));
    if (st.channels.includes('chrome')) results.push(sendChrome(title, body, tag).then(() => 'chrome ok').catch((e) => `chrome failed: ${e.message}`));
    if (!results.length) { log(`alert (no channel on): ${title} - ${body}`); return; }
    for (const r of await Promise.all(results)) log(`alert ${r}: ${title} - ${body}`);
  }

  // ---- presence events (viewer joined/left, reader online/offline) ----
  function notify(kind, title, body) {
    if (!settings.events[kind]) return;
    deliver(title, body, 3, { viewers: 'eyes', reader: 'satellite', net: 'globe_with_meridians' }[kind] || 'bell');
  }

  // ---- evaluation ----
  function sampleOf(p) {
    const d = p.data;
    return {
      soc: d ? d.soc : null, current: d ? d.current : null, cellDelta: d ? d.cellDelta : null,
      ageS: p.lastFrameAt ? (Date.now() - p.lastFrameAt) / 1000 : null, connected: !!p.connected,
    };
  }
  function tick() {
    const A = T().alerts;
    for (const p of getPacks()) {
      if (p.demo) continue;                                   // never alert on the simulated pack
      if (!p.lastFrameAt && !p.connected) continue;           // nothing ever read: nothing to judge yet
      if (p.userDisconnect && !p.connected) { ev.forget(p.id); continue; }   // the user pressed Disconnect: silence is intended
      for (const e of ev.tick(p.id, p.label, sampleOf(p))) {
        const { title, body } = formatEvent(e, A);
        deliver(title, body, e.priority, e.tag);
      }
    }
    heartbeat();
  }
  // The watchdog is about this phone dying, not about Bluetooth: it stays armed
  // while a real BMS is in use (connected or auto-reconnecting; a Bluetooth
  // drop is reported by the "silent" rule from here), and is disarmed once the
  // user presses Disconnect on the last one.
  let armed = false;
  function inUse() { return getPacks().some((p) => !p.demo && !p.remote && p.device && !p.userDisconnect); }
  async function heartbeat(force = false) {
    const st = status();
    if (!st.watchdog || viewMode) return;
    if (!inUse()) { if (armed) { armed = false; stopWatch(); } if (!force) return; }
    if (!force && Date.now() - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = Date.now(); armed = true;
    try {
      const r = await fetch(`${API}/watch/${watchId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: settings.ntfy.server, topic: settings.ntfy.topic, token: settings.ntfy.token || '', name: settings.watchdog.name || 'BatRay', timeout_s: settings.watchdog.timeoutS }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || r.status);
      if (b.wasSilent) log('watchdog: relay had reported this gateway silent; it now knows we are back');
      watchSilent = false;
    } catch (e) { log(`watchdog heartbeat failed: ${e.message}`); }
  }
  async function stopWatch() { armed = false; lastHeartbeat = 0; try { await fetch(`${API}/watch/${watchId}`, { method: 'DELETE' }); log('watchdog: disarmed'); } catch { /* */ } }

  // ---- UI ----
  function render() {
    const A = T().alerts;
    const ch = settings.channels, n = settings.ntfy, w = settings.watchdog;
    const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    $('alertsBody').innerHTML = `
      <div class="agrp"><b>${A.channelsH}</b>
        ${NTFY_ENABLED ? `<label class="chk"><input type="checkbox" id="alNtfy" ${ch.ntfy ? 'checked' : ''}> ntfy</label>` : ''}
        <div class="arow" ${ch.ntfy && NTFY_ENABLED ? '' : 'hidden'} id="alNtfyRow">
          <input id="alServer" value="${n.server}" placeholder="https://ntfy.sh" size="18"> / <input id="alTopic" value="${n.topic}" placeholder="${A.topicPh}" size="16"> <input id="alToken" value="${n.token}" placeholder="${A.tokenPh}" size="14" type="password">
          <button class="linkbtn" id="alNtfyTest">${A.test}</button>
          <div class="note">${A.ntfyNote}</div>
        </div>
        <label class="chk"><input type="checkbox" id="alChrome" ${ch.chrome ? 'checked' : ''}> ${A.chrome} <span class="note">(${A.perm[perm] || perm})</span></label>
        <div class="arow" ${ch.chrome ? '' : 'hidden'} id="alChromeRow"><button class="linkbtn" id="alChromeTest">${A.test}</button><div class="note">${A.chromeNote}</div></div>
      </div>
      <div class="agrp"><b>${A.rulesH}</b> <span class="note">${A.rulesNote}</span>
        ${RULES.map((r) => { const c = settings.rules[r.id]; const secs = r.unit === 's';   // the "silent" rule: shown in minutes, no separate hold
          return `<label class="chk arule"><input type="checkbox" data-rule="${r.id}" ${c.on ? 'checked' : ''}> <span class="rl">${A.rules[r.id]}</span> <input type="number" step="any" data-val="${r.id}" value="${secs ? Math.round(c.value / 60) : c.value}" size="5"> ${secs ? A.min : r.unit}${secs ? '' : ` · ${A.holdFor} <input type="number" data-hold="${r.id}" value="${Math.round(c.holdS / 60)}" size="3"> ${A.min}`}</label>`; }).join('')}
      </div>
      <div class="agrp"><b>${A.eventsH}</b>
        ${viewMode ? `<label class="chk"><input type="checkbox" id="alEvReader" ${settings.events.reader ? 'checked' : ''}> ${A.evReader}</label>`
                   : `<label class="chk"><input type="checkbox" id="alEvViewers" ${settings.events.viewers ? 'checked' : ''}> ${A.evViewers}</label>`}
        <label class="chk"><input type="checkbox" id="alEvNet" ${settings.events.net ? 'checked' : ''}> ${A.evNet}</label>
      </div>
      <div class="agrp" ${viewMode || !NTFY_ENABLED ? 'hidden' : ''}><b>${A.watchH}</b>
        <label class="chk"><input type="checkbox" id="alWatch" ${w.on ? 'checked' : ''} ${ch.ntfy ? '' : 'disabled'}> ${A.watchLbl}</label>
        <div class="arow" ${w.on ? '' : 'hidden'} id="alWatchRow">${A.watchName} <input id="alWatchName" value="${w.name || ''}" placeholder="Sea hut" size="12"> · ${A.watchAfter} <input id="alWatchMin" type="number" value="${Math.round(w.timeoutS / 60)}" size="3"> ${A.min}
          <div class="note">${A.watchNote}</div>${/^https:\/\/ntfy\.sh$/.test(n.server.replace(/\/+$/, '')) && !n.token ? `<div class="note warn">${A.watchTokenWarn}</div>` : ''}</div>
      </div>`;
    const on = (id, evn, fn) => { const el = $(id); if (el) el.addEventListener(evn, fn); };
    on('alNtfy', 'change', (e) => { ch.ntfy = e.target.checked; if (!ch.ntfy && w.on) { w.on = false; stopWatch(); } save(); });
    on('alChrome', 'change', async (e) => { ch.chrome = e.target.checked; if (ch.chrome) await ensureChrome(); save(); });
    for (const id of ['alServer', 'alTopic', 'alToken']) on(id, 'change', () => { n.server = $('alServer').value.trim(); n.topic = $('alTopic').value.trim(); n.token = $('alToken').value.trim(); save(); if (w.on) heartbeat(true); });
    on('alNtfyTest', 'click', async () => { try { await sendNtfy(A.testTitle, A.testBody, 3, 'test_tube'); log('ntfy test sent'); } catch (e) { log(`ntfy test failed: ${e.message}`); alert(`ntfy: ${e.message}`); } });
    on('alChromeTest', 'click', async () => { try { await ensureChrome(); await sendChrome(A.testTitle, A.testBody, 'test'); } catch (e) { log(`chrome test failed: ${e.message}`); alert(e.message); } });
    $('alertsBody').querySelectorAll('[data-rule]').forEach((el) => el.addEventListener('change', () => { settings.rules[el.dataset.rule].on = el.checked; save(); }));
    $('alertsBody').querySelectorAll('[data-val]').forEach((el) => el.addEventListener('change', () => { const r = RULES.find((x) => x.id === el.dataset.val); const v = +el.value; if (Number.isFinite(v) && v >= 0) settings.rules[r.id].value = r.unit === 's' ? Math.max(60, Math.round(v * 60)) : v; save(); }));
    $('alertsBody').querySelectorAll('[data-hold]').forEach((el) => el.addEventListener('change', () => { const v = +el.value; if (Number.isFinite(v) && v >= 0) settings.rules[el.dataset.hold].holdS = Math.round(v * 60); save(); }));
    on('alEvViewers', 'change', (e) => { settings.events.viewers = e.target.checked; save(); });
    on('alEvNet', 'change', (e) => { settings.events.net = e.target.checked; save(); });
    on('alEvReader', 'change', (e) => { settings.events.reader = e.target.checked; save(); });
    on('alWatch', 'change', (e) => { w.on = e.target.checked; save(); if (w.on) heartbeat(true); else stopWatch(); });
    on('alWatchName', 'change', (e) => { w.name = e.target.value.trim().slice(0, 64); save(); heartbeat(true); });
    on('alWatchMin', 'change', (e) => { const v = Math.round(+e.target.value * 60); if (Number.isFinite(v)) w.timeoutS = Math.max(120, Math.min(86400, v)); save(); heartbeat(true); });
  }
  async function ensureChrome() {
    if (typeof Notification === 'undefined') throw new Error('this browser has no notifications');
    if (Notification.permission !== 'granted') await Notification.requestPermission();
    if (Notification.permission !== 'granted') throw new Error('notifications not allowed');
    if (!swReg && 'serviceWorker' in navigator) { try { swReg = await navigator.serviceWorker.register('/batray/sw.js'); await navigator.serviceWorker.ready; } catch (e) { log(`service worker: ${e.message}`); } }
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration('/batray/').then((r) => { if (r) swReg = r; }).catch(() => {});
  render();
  setInterval(tick, TICK_MS);
  onStatus(status());
  return { rerender: render, status, tick, notify };
}
