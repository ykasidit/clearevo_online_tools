// BatRay by ClearEvo.com - JK BMS monitor over Web Bluetooth: DOM, Web Bluetooth, packs, share/view wiring
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

import { JkBms, decodeCellInfo, errorLabels, hex, FRAME_CELL_INFO, linkGone, reconnectAllowed } from './jkbms.js';
import { startDemo } from './demo.js';
import { I18N, detectLang } from './i18n.js';
import { Publisher, Viewer } from './live.js';
import { parseShare, envelope } from './live-logic.js';
import { initAlerts } from './alerts.js';
import { timeToGo, splitHours, Ema, Trend } from './trend.js';
import { TvStream } from './tv.js';
import { suggestChannelName, parseSavedShare } from './live-logic.js';
import { drawTvFrame } from './tv-draw.js';

export const APP_VERSION = '0.9.17';

const $ = (id) => document.getElementById(id);
const els = {
  disconnect: $('disconnect'), demoBtn: $('demoBtn'), copy: $('copy'), stat: $('stat'), empty: $('empty'), readouts: $('readouts'),
  updated: $('updated'), layout: $('layout'), cells: $('cells'), secondary: $('secondary'), settings: $('settings'), settingsCard: $('settingsCard'),
  device: $('device'), log: $('log'), debug: $('debug'), packBar: $('packBar'), share: $('share'), liveChip: $('liveChip'), liveTxt: $('liveTxt'),
  liveStop: $('liveStop'), shareLink: $('shareLink'), viewChip: $('viewChip'), viewTxt: $('viewTxt'),
};

// Viewer mode: opened from a share link (?view=ROOM#k=KEY). No Bluetooth here;
// packs arrive over the live channel and are decrypted on this device.
const viewMode = parseShare(location.href);
let alerts = null;

$('titleText').textContent = `BatRay by ClearEvo.com v${APP_VERSION}`;
$('aboutVer').textContent = `v${APP_VERSION}`;
$('sbVer').textContent = `v${APP_VERSION}`;

// The log is meant to debug any device from the log alone - no ADB, no
// remote inspector: a header of facts about the browser and device, every
// state change, every error, and a heartbeat line each minute.
const MAX_LOG_LINES = 4000;
const logLines = [];
let T = I18N.en;
let statusThunk = () => T.ready, statusKind = '';
let logRaf = 0;
function renderLog() {
  if (!$('debug').open) return;                       // rendering 4000 lines is only worth it when someone looks
  els.log.textContent = logLines.join('\n');
  els.log.scrollTop = els.log.scrollHeight;
}
function log(msg) {
  const line = `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.shift();
  if (!logRaf) logRaf = requestAnimationFrame(() => { logRaf = 0; renderLog(); });
}
$('debug').addEventListener('toggle', renderLog);
const yn = (v) => (v ? 'yes' : 'no');
function safe(fn, dflt = 'n/a') { try { return fn(); } catch { return dflt; } }
/** Facts about this browser and device, first line first: the upload's header. */
function logHeaderLines() {
  const c = navigator.connection || {};
  const uad = navigator.userAgentData;
  const v = document.createElement('video');
  const storageOk = safe(() => { localStorage.setItem('batray_probe', '1'); localStorage.removeItem('batray_probe'); return true; }, false);
  const lsKeys = safe(() => Object.keys(localStorage).filter((k) => k.startsWith('batray')).join(','), 'n/a');
  return [
    `BatRay v${APP_VERSION} · ${new Date().toISOString()} · tz ${safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone)} · ${viewMode ? `viewer of room ${viewMode.room}` : 'reader'} · page ${location.origin}${location.pathname}${location.search}`,
    `ua: ${navigator.userAgent}`,
    `platform: ${navigator.platform} · uaData ${uad ? JSON.stringify({ brands: uad.brands, mobile: uad.mobile, platform: uad.platform }) : 'n/a'} · cores ${navigator.hardwareConcurrency || '?'} · mem ${navigator.deviceMemory || '?'} GB`,
    `screen: ${screen.width}x${screen.height} @${devicePixelRatio} · viewport ${innerWidth}x${innerHeight} · touch ${navigator.maxTouchPoints} · orientation ${safe(() => screen.orientation.type)} · visibility ${document.visibilityState}`,
    `net: online=${navigator.onLine} · type ${c.type || c.effectiveType || '?'} · downlink ${c.downlink ?? '?'} Mbps · rtt ${c.rtt ?? '?'} ms · saveData ${c.saveData ?? '?'}`,
    `lang: ui=${$('lang').value} · browser ${navigator.language} · ${(navigator.languages || []).join(',')}`,
    `features: secure=${yn(isSecureContext)} bluetooth=${yn(!!navigator.bluetooth)} adv=${yn(typeof BluetoothDevice !== 'undefined' && 'watchAdvertisements' in BluetoothDevice.prototype)} getDevices=${yn(navigator.bluetooth && navigator.bluetooth.getDevices)} availability=${yn(navigator.bluetooth && navigator.bluetooth.getAvailability)} wakeLock=${yn('wakeLock' in navigator)} notifications=${typeof Notification === 'undefined' ? 'none' : Notification.permission} sw=${navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlled' : 'none'} webCodecs=${yn(typeof VideoEncoder !== 'undefined')} hls=${v.canPlayType('application/vnd.apple.mpegurl') || 'no'} remotePlayback=${yn('remote' in v)} storage=${yn(storageOk)} clipboard=${yn(navigator.clipboard && navigator.clipboard.writeText)}`,
    `settings: autoReconnect=${$('autoRe').checked} cutoff=${cutoffPct}% tvRes=${$('tvRes').value} zoom=${document.body.style.zoom || '100%'} localStorage=[${lsKeys}]`,
  ];
}
// what the header cannot know synchronously: battery, codec support, adapter state
async function logEnvAsync() {
  // each probe on its own: one that never settles (getBattery in some builds) must not hold the others
  (async () => { try { if (navigator.getBattery) { const b = await navigator.getBattery(); log(`battery: ${Math.round(b.level * 100)}% charging=${b.charging}`); b.addEventListener('levelchange', () => log(`battery: ${Math.round(b.level * 100)}%`)); b.addEventListener('chargingchange', () => log(`battery: charging=${b.charging}`)); } } catch (e) { log(`battery: ${e.message}`); } })();
  if (typeof VideoEncoder !== 'undefined') {
    const out = [];
    for (const codec of ['avc1.42E01E', 'avc1.4D401F', 'vp09.00.10.08']) { try { const r = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 500000, framerate: 1, ...(codec.startsWith('avc') ? { avc: { format: 'avc' } } : {}) }); out.push(`${codec}=${yn(r.supported)}`); } catch (e) { out.push(`${codec}=err`); } }
    log(`codecs: ${out.join(' ')}`);
  }
  try { if (navigator.bluetooth && navigator.bluetooth.getAvailability) log(`bluetooth adapter available: ${await navigator.bluetooth.getAvailability()}`); } catch (e) { log(`bluetooth availability: ${e.message}`); }
}
// errors that would otherwise only show in a remote inspector
window.addEventListener('error', (e) => log(`ERROR ${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}:${e.colno}${e.error && e.error.stack ? '\n' + String(e.error.stack).split('\n').slice(0, 6).join('\n') : ''}`));
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; log(`UNHANDLED ${r && r.message ? r.message : String(r)}${r && r.stack ? '\n' + String(r.stack).split('\n').slice(0, 6).join('\n') : ''}`); });
for (const level of ['error', 'warn']) { const orig = console[level].bind(console); console[level] = (...a) => { try { log(`console.${level}: ${a.map((x) => (x instanceof Error ? x.message : typeof x === 'object' ? JSON.stringify(x).slice(0, 300) : String(x))).join(' ')}`); } catch { /* */ } orig(...a); }; }
document.addEventListener('visibilitychange', () => log(`tab ${document.visibilityState}`));
window.addEventListener('online', () => log('network: online')); window.addEventListener('offline', () => log('network: offline'));
window.addEventListener('pagehide', () => log('page hidden/unloading'));
let lastStatusKey = '';
let toastTimer = null, btWarned = false;
function toast(msg, ms = 8000) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
// status text is kept as a thunk so a language switch can re-evaluate it
function setStatus(thunk, kind = '') {
  statusThunk = typeof thunk === 'function' ? thunk : () => thunk;
  statusKind = kind;
  const txt = statusThunk();
  els.stat.textContent = txt;
  els.stat.className = kind;
  const key = `${txt.replace(/\d+/g, '#')}|${kind}`;
  if (key !== lastStatusKey) { lastStatusKey = key; log(`status: ${txt}${kind ? ` [${kind}]` : ''}`); }
}
function fmt(n, digits = 2, unit = '') {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toFixed(digits)}${unit}`;
}

// ---------------------------------------------------------------------------
// Packs: one JK BMS (or the demo, or a remote pack in viewer mode) each. All
// connected packs are read in parallel; the meters show the active one and the
// pack bar shows every pack's SOC and current at a glance.
// ---------------------------------------------------------------------------
class Pack {
  constructor(id, name, { remote = false } = {}) {
    this.id = id; this.name = name; this.remote = remote;
    this.bms = remote ? null : new JkBms();
    this.device = null; this.info = null; this.settings = null; this.data = null; this.lastFrameAt = null;
    this.demo = null; this.userDisconnect = false; this.reTimer = null; this.reconnecting = false; this.connectPending = false;
    this.offlineThunk = null; this.loadThunk = null; this.countThunk = null; this.reNow = false; this.dumped = false;
    this.stalled = false; this.stalledAge = 0; this.connectedAt = null;   // link reported connected but gone quiet
    this.remoteLive = false;
    this.trend = new Trend(); this.iEma = new Ema(60);   // session trend + smoothed current for the time-to-go
    if (this.bms) this.wire();
  }
  get connected() { return this.remote ? this.remoteLive : (!!this.demo || (this.bms && this.bms.connected)); }
  get label() { return this.demo ? 'DEMO' : (this.device && (this.device.name || this.device.id)) || this.name; }
  get isActive() { return active === this; }
  plog(msg) { log(packs.size > 1 || viewMode ? `[${this.label}] ${msg}` : msg); }

  wire() {
    const b = this.bms;
    b.addEventListener('log', (e) => this.plog(e.detail));
    b.addEventListener('connected', (e) => {
      this.device = e.detail; this.userDisconnect = false; this.connectPending = false; this.stalled = false; this.connectedAt = Date.now();
      this.plog(`gatt connected: ${this.label} id=${String(e.detail.id || '').slice(0, 10)}…`);
      showReconnectIdle(this);
      this.loadThunk = () => T.loading(this.label);
      if (this.isActive) { setStatus(() => T.connectedTo(this.label), 'good'); $('oneApp').hidden = false; $('btNote').hidden = false; }
      // Auto-reconnect no longer waits for an adapter-state probe (which this
      // Chrome lacks): the user is told once to keep Bluetooth on instead.
      if (!btWarned) { btWarned = true; toast(T.btKeepOn, 12000); }
      refreshCard(); renderPackBar(); syncWake();
    });
    b.addEventListener('disconnected', () => {
      this.plog('gatt disconnected');
      this.offlineThunk = () => T.offlineDrop(this.label);
      // a link that went quiet says so, instead of a bare "disconnected"
      if (this.isActive) { setStatus(() => (this.stalled ? T.stalled(this.label, this.stalledAge) : T.disconnectedFrom(this.label)), 'bad'); $('oneApp').hidden = true; $('btNote').hidden = true; }
      if ($('autoRe').checked && this.device && !this.userDisconnect) startReconnectCountdown(this, this.stalled ? 3 : 10);
      else showReconnectIdle(this);
      this.userDisconnect = false;
      refreshCard(); renderPackBar(); syncWake();
    });
    b.addEventListener('data', (e) => this.onData(e.detail));
    b.addEventListener('device', (e) => { this.onInfo(e.detail); this.plog(`device: ${e.detail.model} hw ${e.detail.hwVersion} fw ${e.detail.swVersion}`); });
    b.addEventListener('settings', (e) => this.onSettings(e.detail));
    b.addEventListener('frame', (e) => {
      const f = e.detail, type = f[4];
      this.plog(`frame type 0x${type.toString(16).padStart(2, '0')} (${f.length}B) ${hex(f.slice(0, 16))} …`);
      if (type === FRAME_CELL_INFO && !this.dumped) {
        // Full dump of the first good cell-info frame, so layout can be checked
        // by hand against a real unit if the auto-detect ever looks wrong.
        this.dumped = true;
        this.plog(`first cell-info frame, full hex:\n${hex(f)}`);
        const d = decodeCellInfo(f, b.info ? b.info.swMajor : null);
        this.plog(d.ok ? `decoded as ${d.variant} (${d.layoutSource}), cells=${d.cells.map((c) => c.v.toFixed(3)).join(',')}` : `decode failed: ${d.reason}`);
      }
    });
  }
  take(d) {
    this.data = d; this.lastFrameAt = Date.now();
    this.iEma.push(d.current, this.lastFrameAt);
    this.trend.push({ t: this.lastFrameAt, soc: d.soc, power: d.power });
  }
  onData(d) {
    const first = !this.lastFrameAt;
    if (first) this.plog(`first reading ${this.connectedAt ? Math.round((Date.now() - this.connectedAt) + '') + ' ms after connect' : ''}: soc=${d.soc} V=${d.packV} A=${d.current} cells=${d.cells.length} variant=${d.variant}`);
    this.take(d);
    if (this.isActive) scheduleRender(this);
    schedulePackBar();
    if (publisher) publisher.publish(envelope('data', this, d));
    if (this.stalled) {              // back after a gap: say so instead of staying amber
      this.stalled = false;
      if (this.isActive) setStatus(() => T.connectedTo(this.label), 'good');
    }
    if (first) syncWake();
  }
  onInfo(i) { this.info = i; if (this.isActive) renderDevice(i); if (publisher) publisher.publish(envelope('info', this, i)); }
  onSettings(s) { this.settings = s; if (this.isActive) renderSettings(s); if (publisher) publisher.publish(envelope('settings', this, s)); }
}

const packs = new Map();
let active = null;
let packSeq = 0;
let publisher = null, viewer = null, tv = null;

function addPack(pack) { packs.set(pack.id, pack); if (!active) setActive(pack); renderPackBar(); return pack; }
function removePack(pack) {
  packs.delete(pack.id);
  if (active === pack) setActive(packs.values().next().value || null);
  renderPackBar();
}

function setActive(pack) {
  active = pack;
  if (!pack) {
    els.readouts.hidden = true; els.empty.hidden = !!viewMode; els.device.hidden = true; els.settingsCard.hidden = true;
    document.body.classList.remove('offline', 'loading', 'demo');
    setStatus(() => (viewMode ? T.viewWaiting : T.ready));
    renderPackBar(); return;
  }
  els.empty.hidden = true; els.readouts.hidden = false;
  document.body.classList.toggle('demo', !!pack.demo);
  if (pack.info) renderDevice(pack.info); else els.device.hidden = true;
  if (pack.settings) renderSettings(pack.settings); else els.settingsCard.hidden = true;
  if (pack.data) render(pack.data, true); else clearReadouts();
  $('oneApp').hidden = !(pack.bms && pack.bms.connected); $('btNote').hidden = !(pack.bms && pack.bms.connected);
  if (pack.demo) setStatus(() => T.demoStatus, 'demo');
  else if (pack.remote) setStatus(() => (pack.remoteLive ? T.viewingPack(pack.label) : (readerGone() ? T.viewOfflineShort : T.viewReconnecting)), pack.remoteLive ? 'good' : 'bad');
  else if (pack.bms.connected) setStatus(() => T.connectedTo(pack.label), 'good');
  else setStatus(() => T.disconnectedFrom(pack.label), 'bad');
  refreshCard(); tickAge(); renderPackBar();
}

function clearReadouts() {
  els.layout.innerHTML = ''; els.secondary.innerHTML = ''; els.cells.innerHTML = ''; $('strip').innerHTML = ''; $('cellsStat').textContent = '';
  for (const id of ['fSoc', 'fPower', 'fAmps']) $(id).textContent = '-';
  $('fEta').textContent = ''; $('fSoh').textContent = T.battLbl(null, null);
  $('trendCard').hidden = true;
}

// The offline / loading / reconnect card reflects the ACTIVE pack only.
function refreshCard() {
  const p = active;
  if (!p) return;
  const body = document.body.classList;
  els.disconnect.disabled = !(p.bms && p.bms.connected);
  if (p.remote) { body.toggle('offline', !p.remoteLive); body.remove('loading'); $('reState').hidden = true; $('reIdle').hidden = true; $('offlineTxt').textContent = readerGone() ? T.viewOffline : T.viewReconnectingLong; return; }
  if (p.demo) { body.remove('offline', 'loading'); return; }
  if (p.bms.connected) {
    body.remove('offline');
    body.toggle('loading', !p.data);
    if (!p.data && p.loadThunk) $('loadTxt').textContent = p.loadThunk();
    return;
  }
  body.remove('loading');
  body.toggle('offline', !!(p.lastFrameAt || p.device || p.connectPending || p.reconnecting));
  $('offlineTxt').textContent = p.offlineThunk ? p.offlineThunk() : T.disconnectedFrom(p.label);
  if (p.reconnecting || p.connectPending) {
    $('reState').hidden = false; $('reIdle').hidden = true;
    $('reCount').textContent = p.countThunk ? p.countThunk() : '';
    $('reNow').hidden = !p.reNow;
  } else { $('reState').hidden = true; $('reIdle').hidden = false; }
}

function renderPackBar() {
  const bar = els.packBar;
  const show = packs.size > 0;
  bar.hidden = !show;
  if (!show) return;
  const chips = [...packs.values()].map((p) => {
    const d = p.data;
    const soc = d ? `${d.soc}%` : '';
    const I = d && d.current !== null ? (d.current > 0.05 ? `+${d.current.toFixed(1)} A` : d.current < -0.05 ? `−${Math.abs(d.current).toFixed(1)} A` : '0 A') : '';
    const st = p.connected ? (d ? '' : ` <span class="pst">${T.packWaiting}</span>`) : ` <span class="pst off">${p.reconnecting || p.connectPending ? T.packConnecting : T.packOffline}</span>`;
    return `<button class="pchip${p === active ? ' on' : ''}${p.connected ? '' : ' off'}" data-pack="${p.id}" title="${p.label}"><span class="pn">${p.demo ? 'DEMO' : p.label}</span>${soc ? ` <span class="ps">${soc}</span>` : ''}${I ? ` <span class="pi">${I}</span>` : ''}${st}</button>`;
  });
  const add = viewMode ? '' : `<button class="pchip add" id="addPack" title="${T.addPackTitle}">${T.addPack}</button>`;
  bar.innerHTML = chips.join('') + add;
  bar.querySelectorAll('.pchip[data-pack]').forEach((b) => b.addEventListener('click', () => { const p = packs.get(b.dataset.pack); if (p) setActive(p); }));
  const a = $('addPack'); if (a) a.addEventListener('click', () => startConnect(null));
}

// ---- language (EN / ไทย): static text via data-i18n, live text re-rendered ----
function applyLang(code) {
  T = I18N[code] || I18N.en;
  document.documentElement.lang = code;
  $('lang').value = code;
  document.querySelectorAll('[data-i18n]').forEach((el) => { const v = T[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { const v = T[el.dataset.i18nHtml]; if (typeof v === 'string') el.innerHTML = v; });
  $('fSysLbl').textContent = T.system;
  setStatus(statusThunk, statusKind);
  if (active) { if (active.info) renderDevice(active.info); if (active.settings) renderSettings(active.settings); if (active.data) render(active.data, true); }
  refreshCard(); renderPackBar(); renderLiveChip(); renderViewChip();
  if (alerts) alerts.rerender();
  if (!navigator.bluetooth) for (const id of ['connectBig', 'connectAgain']) $(id).textContent = T.noWebBtBtn;
  tickAge();
}

// ---- wake lock: any wanted session keeps the screen (and BLE) awake ----
let wakeLock = null, wakeWanted = false;
async function syncWake() {
  wakeWanted = [...packs.values()].some((p) => p.connected || p.reconnecting || !!p.reTimer) || !!publisher || !!(viewer && viewer.state.live) || !!(tv && tv.state.live);
  const el = $('wake');
  if (!('wakeLock' in navigator)) { el.hidden = true; return; }
  if (wakeWanted && !wakeLock && document.visibilityState === 'visible') {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; el.hidden = true; log('screen wake lock released'); });
      log('screen wake lock acquired');
    } catch (err) { log(`screen wake lock refused: ${err.message}`); }
  } else if (!wakeWanted && wakeLock) {
    try { await wakeLock.release(); } catch { /* already gone */ }
    wakeLock = null;
  }
  el.hidden = !wakeLock;
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeWanted) syncWake(); });

// ---- flow picture layout: landscape on wide screens, portrait on phones and
// in full screen when the viewport is taller than wide (owner ask 2026-09-17:
// the picture is the thing people look at - give it half the screen) ----
const FLOW = {
  landscape: { vb: '0 0 640 170', batt: 'translate(30,35)', sys: 'translate(448,35)', line: 'M196 85 H444', dash: 52,
    out: 'M262 71 L276 85 L262 99 M312 71 L326 85 L312 99 M362 71 L376 85 L362 99', in: 'M278 71 L264 85 L278 99 M328 71 L314 85 L328 99 M378 71 L364 85 L378 99',
    power: [320, 62], amps: [320, 122], eta: [320, 158], upd: [6, 14] },
  portrait: { vb: '0 0 340 485', batt: 'translate(89,22)', sys: 'translate(90,352)', line: 'M170 152 V204 M170 292 V346', dash: 52,   // gap behind the text block
    // two chevrons, above and below the text block, so no arrow crosses a number
    out: 'M156 172 L170 186 L184 172 M156 308 L170 322 L184 308', in: 'M156 186 L170 172 L184 186 M156 322 L170 308 L184 322',
    power: [170, 224], amps: [170, 252], eta: [170, 278], upd: [6, 14] },
};
let flowMode = '';
function layoutFlow() {
  const card = $('flowCard'), full = card.classList.contains('full') || document.fullscreenElement === card;
  const w = full ? window.innerWidth : card.clientWidth, h = full ? window.innerHeight : 0;
  const mode = full ? (h > w ? 'portrait' : 'landscape') : (w > 0 && w < 520 ? 'portrait' : 'landscape');
  if (mode === flowMode) return;
  flowMode = mode;
  const L = FLOW[mode], svg = $('flow');
  svg.setAttribute('viewBox', L.vb); svg.classList.toggle('portrait', mode === 'portrait');
  $('gBatt').setAttribute('transform', L.batt); $('gSys').setAttribute('transform', L.sys);
  $('fLine').setAttribute('d', L.line); $('fDash').setAttribute('d', L.line);
  $('fArrOut').firstElementChild.setAttribute('d', L.out); $('fArrIn').firstElementChild.setAttribute('d', L.in);
  for (const [id, xy] of [['fPower', L.power], ['fAmps', L.amps], ['fEta', L.eta], ['updated', L.upd]]) { $(id).setAttribute('x', xy[0]); $(id).setAttribute('y', xy[1]); }
}
layoutFlow();
window.addEventListener('resize', layoutFlow);
(function () {
  const card = $('flowCard'), btn = $('flowFull');
  const sync = () => { const on = document.fullscreenElement === card || card.classList.contains('full'); btn.textContent = on ? '✕' : '⛶'; btn.setAttribute('aria-label', on ? T.exitFull : T.fullScreen); btn.title = btn.getAttribute('aria-label'); layoutFlow(); if (active && active.data) renderFlow(active.data); };
  btn.addEventListener('click', async () => {
    if (document.fullscreenElement === card) { try { await document.exitFullscreen(); } catch {} card.classList.remove('full'); sync(); return; }
    if (card.classList.contains('full')) { card.classList.remove('full'); sync(); return; }
    if (card.requestFullscreen) { try { await card.requestFullscreen(); sync(); return; } catch { /* fall through to the overlay */ } }
    card.classList.add('full'); sync();
  });
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('full')) { card.classList.remove('full'); sync(); } });
})();

// ---- rendering (active pack) ----
function renderFlow(d) {
  layoutFlow();                                   // the card has a width only once readouts are shown
  const soc = d.soc === null || d.soc === undefined ? null : d.soc;
  const segs = $('fSeg').querySelectorAll('rect');
  const lit = soc === null ? 0 : Math.min(5, Math.floor(soc / 20));
  segs.forEach((r, i) => { r.className.baseVal = i < lit ? `on${soc <= 10 ? ' crit' : soc <= 25 ? ' low' : ''}` : ''; });
  $('fSoc').textContent = soc === null ? '-' : `${soc}%`;
  $('fSoh').textContent = T.battLbl(d.packV === null || d.packV === undefined ? null : fmt(d.packV, 2), d.soh === undefined || d.soh === null ? null : d.soh);
  const I = d.current;
  const charging = I !== null && I > 0.05, discharging = I !== null && I < -0.05;
  const s = active && active.settings;
  const maxA = charging ? (s && s.maxChargeA) || 100 : (s && s.maxDischargeA) || 100;
  const ratio = I === null ? 0 : Math.min(1, Math.abs(I) / maxA);
  const w = charging || discharging ? 3 + 15 * ratio : 3;
  const dash = $('fDash'), line = $('fLine');
  dash.setAttribute('stroke-width', w); line.setAttribute('stroke-width', w);
  dash.setAttribute('stroke-dasharray', `${10 + w} ${10 + w}`);
  dash.setAttribute('class', charging ? 'chg' : discharging ? 'dis' : '');
  $('fPower').setAttribute('class', charging ? 'chg' : discharging ? 'dis' : '');
  $('fPower').textContent = d.power === null ? '-' : `${charging ? T.flowCharge : discharging ? T.flowDischarge : T.flowIdle} ${fmt(Math.abs(d.power), 0)} W`;
  $('fAmps').textContent = I === null ? T.noCurrent : T.ofMax(fmt(Math.abs(I), 2), fmt(maxA, 0));
  $('fSysLbl').textContent = charging ? T.charger : discharging ? T.load : T.system;
  $('fArrIn').classList.toggle('show', charging);
  $('fArrOut').classList.toggle('show', discharging);
}

function renderCells(cells) {
  if (!cells.length) { els.cells.innerHTML = '<div id="cellsEmpty">-</div>'; return; }
  const volts = cells.map((c) => c.v);
  const min = Math.min(...volts), max = Math.max(...volts);
  const lo = min - 0.05, hi = max + 0.05;
  els.cells.innerHTML = cells.map((c) => {
    const pct = Math.round(((c.v - lo) / (hi - lo)) * 100);
    const cls = c.v === min ? ' min' : c.v === max ? ' max' : '';
    return `<div class="cell${cls}" title="${c.n}: ${c.v.toFixed(3)} V, ${c.mOhm} mΩ"><div class="mv">${Math.round(c.v * 1000)}</div><div class="bar" style="height:${pct}%"></div><div class="n">${c.n}</div></div>`;
  }).join('');
}

const kv = (rows) => rows.map(([k, v]) => `<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

// ---- time to go, status chips, cell line, session trend (benchmark 2026-09-17:
// Victron/Enphase/EcoFlow show a runtime, every BMS app shows MOS + alarm state
// on its first screen, every commercial monitor has a history curve) ----
let cutoffPct = 10;
try { const v = +localStorage.getItem('batray_cutoff_pct'); if (Number.isFinite(v) && localStorage.getItem('batray_cutoff_pct') !== null) cutoffPct = Math.max(0, Math.min(95, v)); } catch {}
$('cutoff').value = cutoffPct;
$('cutoff').addEventListener('change', () => {
  const v = +$('cutoff').value;
  if (Number.isFinite(v)) cutoffPct = Math.max(0, Math.min(95, Math.round(v)));
  $('cutoff').value = cutoffPct;
  try { localStorage.setItem('batray_cutoff_pct', cutoffPct); } catch {}
  if (active && active.data) render(active.data, true);
});

function fmtSpan(hours) {
  const x = splitHours(hours);
  if (!x) return '-';
  if (x.capped) return T.etaCapped;
  return x.d ? T.dh(x.d, x.h) : x.h ? T.hm(x.h, x.m) : T.mOnly(x.m);
}

function renderEta(p, d) {
  const I = p && p.iEma.v !== null ? p.iEma.v : d.current;
  const r = timeToGo({ remainAh: d.remainAh, nominalAh: d.nominalAh, currentA: I, cutoffPct });
  const el = $('fEta');
  el.textContent = r.kind === 'empty' ? T.etaEmpty(fmtSpan(r.hours), cutoffPct)
    : r.kind === 'full' ? T.etaFull(fmtSpan(r.hours))
    : r.kind === 'atCutoff' ? T.etaAtCutoff : '';
  el.setAttribute('fill', r.kind === 'atCutoff' ? '#ff8a80' : '#a7bccf');
  $('etaLine').hidden = r.kind === 'unknown';
}

function chipList(d) {
  const R = T.r;
  const t = (v) => (v === null || v === undefined ? '-' : fmt(v, 0, '°'));
  const bits = [];
  if (d.chgMos !== undefined) bits.push({ cls: d.chgMos ? 'ok' : 'bad', txt: T.chipChg(!!d.chgMos) });
  if (d.dsgMos !== undefined) bits.push({ cls: d.dsgMos ? 'ok' : 'bad', txt: T.chipDsg(!!d.dsgMos) });
  if (d.balancing !== undefined && d.balancing !== null) bits.push({ cls: d.balancing ? 'warn' : '', txt: T.chipBal(!!d.balancing) });
  if (d.tempMos !== undefined || d.temp1 !== undefined) bits.push({ cls: '', txt: T.chipTemp(t(d.tempMos), t(d.temp1), t(d.temp2)) });
  if (d.heating) bits.push({ cls: 'warn', txt: `${R.heating} ${R.on}` });
  const labels = d.errors ? errorLabels(d.errors) : [];
  bits.push(labels.length ? { cls: 'bad', txt: T.chipAlarm(labels.length, labels.join(', ')) } : { cls: 'ok', txt: T.chipAlarmNone });
  return bits;
}
function renderStrip(d) {
  $('strip').innerHTML = chipList(d).map((c) => `<span class="chip${c.cls ? ` ${c.cls}` : ''}">${c.txt}</span>`).join('');
}

function renderCellsStat(d) {
  const cells = d.cells || [];
  if (cells.length < 2) { $('cellsStat').textContent = ''; return; }
  let lo = cells[0], hi = cells[0];
  for (const c of cells) { if (c.v < lo.v) lo = c; if (c.v > hi.v) hi = c; }
  $('cellsStat').textContent = T.cellsStat(Math.round((hi.v - lo.v) * 1000), lo.v.toFixed(3), lo.n, hi.v.toFixed(3), hi.n);
}

function fmtWh(wh) { return wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${Math.round(wh)} Wh`; }

function renderTrend(p) {
  const card = $('trendCard');
  if (!p || p.trend.spanMs < 30000) { card.hidden = true; return; }
  card.hidden = false;
  const tr = p.trend;
  $('trendEnergy').textContent = T.trendEnergy(fmtSpan(tr.spanMs / 3600000), fmtWh(tr.chargedWh), fmtWh(tr.dischargedWh));
  const cv = $('trend');
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(200, cv.clientWidth), H = 130;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const L = 44, Rm = 34, Tm = 8, Bm = 18, pw = W - L - Rm, ph = H - Tm - Bm;
  const sm = tr.samples, t0 = sm[0].t, t1 = sm[sm.length - 1].t, span = Math.max(1, t1 - t0);
  let pmax = 100;
  for (const x of sm) if (x.power !== null) pmax = Math.max(pmax, Math.abs(x.power));
  pmax = Math.ceil(pmax / 100) * 100;
  const X = (t) => L + (t - t0) / span * pw, Yp = (w) => Tm + ph / 2 - (w / pmax) * ph / 2, Ys = (soc) => Tm + ph - (soc / 100) * ph;
  g.font = '10px DejaVu Sans Mono, monospace'; g.textBaseline = 'middle';
  g.strokeStyle = '#1c3550'; g.lineWidth = 1;
  for (const w of [pmax, pmax / 2, 0, -pmax / 2, -pmax]) { g.beginPath(); g.moveTo(L, Yp(w)); g.lineTo(L + pw, Yp(w)); g.stroke(); g.fillStyle = '#7fb0d8'; g.textAlign = 'right'; g.fillText(`${w} W`, L - 4, Yp(w)); }
  g.textAlign = 'left';
  for (const pct of [0, 50, 100]) { g.fillStyle = '#4aa9e0'; g.fillText(`${pct}%`, L + pw + 4, Ys(pct)); }
  const step = span > 4 * 3600000 ? 3600000 : span > 1.5 * 3600000 ? 1800000 : span > 20 * 60000 ? 600000 : 60000;
  g.fillStyle = '#7fb0d8'; g.textAlign = 'center';
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) { if (X(t) < L + 18 || X(t) > L + pw - 18) continue; const dt = new Date(t); g.fillText(`${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`, X(t), H - Bm / 2); }
  // power: filled area above/below the zero line
  const area = (sign, color) => {
    g.beginPath(); let open = false;
    for (const x of sm) {
      const w = x.power === null ? 0 : Math.max(0, sign * x.power) * sign;
      if (!open) { g.moveTo(X(x.t), Yp(0)); open = true; }
      g.lineTo(X(x.t), Yp(w));
    }
    g.lineTo(X(t1), Yp(0)); g.closePath(); g.fillStyle = color; g.fill();
  };
  area(1, 'rgba(95,211,154,.55)'); area(-1, 'rgba(255,183,77,.55)');
  // battery %
  g.beginPath(); let started = false;
  for (const x of sm) { if (x.soc === null) continue; if (!started) { g.moveTo(X(x.t), Ys(x.soc)); started = true; } else g.lineTo(X(x.t), Ys(x.soc)); }
  g.strokeStyle = '#4aa9e0'; g.lineWidth = 2; g.stroke();
  if (cutoffPct > 0) { g.setLineDash([4, 4]); g.strokeStyle = '#ff8a80'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Ys(cutoffPct)); g.lineTo(L + pw, Ys(cutoffPct)); g.stroke(); g.setLineDash([]); }
}
window.addEventListener('resize', () => { if (active && active.data) renderTrend(active); });

function render(d, relabelOnly = false) {
  if (!relabelOnly) {
    els.empty.hidden = true; els.readouts.hidden = false;
    document.body.classList.remove('offline', 'loading');
  }
  renderFlow(d);
  renderEta(active, d); renderStrip(d); renderCellsStat(d); renderTrend(active);
  const charging = d.current > 0.05, discharging = d.current < -0.05;
  const flowTxt = charging ? T.charging : discharging ? T.discharging : T.idle;
  const src = d.layoutSource === 'firmware' ? T.srcFw : d.layoutSource === 'float-cells' ? T.srcFloat : T.srcSum;
  els.layout.innerHTML = d.confident
    ? T.layoutOk(d.variant, src, d.variant === 'JK04' ? '' : T.layoutAgree(fmt(d.agreement, 3, ' V')))
    : T.layoutBad(d.variant, fmt(d.agreement, 3, ' V'));
  renderCells(d.cells);
  const R = T.r;
  const t = (v) => (v === null || v === undefined ? '-' : fmt(v, 1, ' °C'));
  const onoff = (b) => (b === undefined ? '-' : b ? R.on : R.off);
  const info = active && active.info;
  const pb14 = !!(info && info.swMajor >= 14);
  const rows = [
    // the headline numbers again, as plain rows: the flow box above is for
    // glancing, this grid is where the exact values live (no big duplicate cards)
    [T.packV, fmt(d.packV, 2, ' V')], [T.cellSumK, `${fmt(d.cellSum, 2, ' V')} · ${d.cells.length}${d.maskCells !== null && d.maskCells !== d.cells.length ? T.maskSays(d.maskCells) : ''}`],
    [T.soc, d.soc === null || d.soc === undefined ? '-' : `${d.soc} %`],
    [T.current, `${fmt(Math.abs(d.current), 2, ' A')} ${flowTxt}`], [T.power, `${fmt(Math.abs(d.power), 0, ' W')} ${flowTxt}`],
    [R.cellMin, fmt(d.cellMin, 3, ' V')], [R.cellMax, fmt(d.cellMax, 3, ' V')], [R.cellDelta, fmt(d.cellDelta, 3, ' V')],
    [R.balance, d.balanceA === null ? '-' : `${fmt(d.balanceA, 3, ' A')}${d.balancing ? d.balancing === 2 ? R.balDis : R.balChg : ''}`],
    [R.remaining, fmt(d.remainAh, 1, ' Ah')], [R.fullCap, fmt(d.nominalAh, 1, ' Ah')],
    [R.cycles, d.cycles === undefined ? '-' : `${d.cycles}`], [R.cycleCap, fmt(d.cycleAh, 0, ' Ah')],
    [R.soh, d.soh === undefined ? '-' : `${d.soh} %`], [R.runtime, fmtRuntime(d.runtimeS)],
    [R.mosTemp, t(d.tempMos)], [R.temp(1), t(d.temp1)], [R.temp(2), t(d.temp2)],
    ...(pb14 && d.temp3 !== null && d.temp3 !== undefined ? [[R.temp(3), t(d.temp3)]] : []),
    ...(pb14 && d.temp4 !== null && d.temp4 !== undefined ? [[R.temp(4), t(d.temp4)]] : []),
    ...(pb14 && d.temp5 !== null && d.temp5 !== undefined ? [[R.temp(5), t(d.temp5)]] : []),
    [R.chgMos, onoff(d.chgMos)], [R.dsgMos, onoff(d.dsgMos)],
    ...(d.heating ? [[R.heating, `${R.on}${d.heatingA ? ` ${fmt(d.heatingA, 2, ' A')}` : ''}`]] : []),
    ...(d.chargeStatus !== null && d.chargeStatus !== undefined && d.variant === 'JK02_32S' && (info ? info.swMajor >= 15 : false)
      ? [[R.chargeStage, `${T.stage[d.chargeStatus] || d.chargeStatus}${d.chargeStatusS ? ` (${d.chargeStatusS} s)` : ''}`]] : []),
    [R.errors, d.errors ? `0x${d.errors.toString(16)} ${errorLabels(d.errors).join(', ')}` : R.none],
  ];
  els.secondary.innerHTML = kv(rows);
}
function fmtRuntime(s) {
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? T.dh(d, h) : T.hm(h, Math.floor((s % 3600) / 60));
}
function renderDevice(i) { els.device.textContent = T.device(i, fmtRuntime(i.uptimeS)); els.device.hidden = false; }
function renderSettings(s) {
  const R = T.r; const onoff = (b) => (b ? R.on : R.off);
  els.settings.innerHTML = kv([
    [R.cellsCfg, `${s.cellCount}`], [R.capSet, fmt(s.capacityAh, 1, ' Ah')],
    [R.ovp, `${fmt(s.cellOvp, 3, ' V')} / ${fmt(s.cellOvpr, 3, ' V')}`], [R.uvp, `${fmt(s.cellUvp, 3, ' V')} / ${fmt(s.cellUvpr, 3, ' V')}`],
    [R.maxI, `${fmt(s.maxChargeA, 0, ' A')} / ${fmt(s.maxDischargeA, 0, ' A')}`], [R.balStart, `${fmt(s.balanceStartV, 3, ' V')} / ${fmt(s.balanceTriggerV, 3, ' V')}`],
    [R.maxBal, fmt(s.maxBalanceA, 2, ' A')], [R.chgOtp, `${fmt(s.chargeOtp, 0, ' °C')} / ${fmt(s.chargeUtp, 0, ' °C')}`],
    [R.dsgOtp, fmt(s.dischargeOtp, 0, ' °C')], [R.mosOtp, fmt(s.mosOtp, 0, ' °C')], [R.powerOff, fmt(s.powerOffV, 2, ' V')],
    [R.chgSw, onoff(s.chargeSwitch)], [R.dsgSw, onoff(s.dischargeSwitch)], [R.balSw, onoff(s.balanceSwitch)],
  ]);
  els.settingsCard.hidden = false;
}
// A burst of frames (a resumed tab flushing, or a fast unit) paints once.
let renderQueued = null, packBarQueued = false;
function scheduleRender(p) {
  renderQueued = p;
  if (scheduleRender.pending) return;
  scheduleRender.pending = true;
  requestAnimationFrame(() => {
    scheduleRender.pending = false;
    const q = renderQueued; renderQueued = null;
    if (q && q.isActive && q.data) render(q.data);
  });
}
function schedulePackBar() {
  if (packBarQueued) return;
  packBarQueued = true;
  requestAnimationFrame(() => { packBarQueued = false; renderPackBar(); });
}

// Link watchdog: a JK BMS answers every 3 s poll, so silence means the link is
// gone even while Chrome still reports the GATT connection up (seen after an
// hour with the phone locked: "connected", then an hour of queued readings
// replayed, then a disconnect two minutes later). Freshness decides instead.
function watchLinks(why) {
  for (const p of packs.values()) {
    if (p.demo || p.remote || !p.bms || !p.bms.connected) continue;
    if (!linkGone(p.lastFrameAt, p.connectedAt)) continue;
    const age = Math.round((Date.now() - (p.lastFrameAt || p.connectedAt)) / 1000);
    p.stalled = true; p.stalledAge = age;
    p.plog(`no data for ${age} s (${why}) - dropping the link and reconnecting`);
    p.connectedAt = null;
    if (p.isActive) setStatus(() => T.stalled(p.label, age), 'bad');
    p.bms.drop(`no data for ${age} s`);
  }
}
setInterval(() => watchLinks('watchdog'), 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  watchLinks('tab resumed');
  if (viewer) viewer.nudge();
  if (publisher) publisher.nudge();
});

function tickAge() {
  if (!active || !active.lastFrameAt) { els.updated.textContent = T.noData; return; }
  const age = Math.round((Date.now() - active.lastFrameAt) / 1000);
  els.updated.textContent = age < 2 ? T.justNow : T.agoS(age);
  els.updated.setAttribute('fill', age > 15 ? '#ffd24a' : '#6f8aa6');
}
setInterval(tickAge, 1000);

// ---- DEMO: a pack fed by synthetic frames, labelled everywhere ----
function stopDemo() {
  const p = [...packs.values()].find((x) => x.demo);
  if (!p) return;
  p.demo.stop(); p.demo = null;
  removePack(p);
  log('demo stopped');
  setStatus(() => T.demoStopped);
  syncWake();
}
function runDemo() {
  if ([...packs.values()].some((x) => x.demo)) return;
  const p = new Pack(`demo-${++packSeq}`, 'DEMO');
  p.plog('demo started: simulated 16-cell pack, frames are generated, not received');
  p.demo = startDemo((chunk) => p.bms._onNotify(chunk));
  addPack(p); setActive(p);
  syncWake();
}
$('stopDemo').addEventListener('click', stopDemo);
els.demoBtn.addEventListener('click', runDemo);
$('demoAgain').addEventListener('click', runDemo);

// ---- reconnect machinery, per pack; the card shows the active pack ----
function showReconnectIdle(p) {
  p.reconnecting = false; p.countThunk = null; p.reNow = false;
  if (p.reTimer) { clearInterval(p.reTimer); p.reTimer = null; }
  refreshCard(); syncWake();
}
function setCount(p, thunk, tap = false) { p.countThunk = thunk; p.reNow = tap; if (p.isActive) refreshCard(); }

function startReconnectCountdown(p, seconds = 10) {
  // One attempt at a time. A manual tap while a countdown was pending used to
  // race it: two connects in parallel superseded each other and the pack was
  // "connected" for seconds, then dropped (live, 2026-09-17).
  if (!reconnectAllowed({ connectPending: p.connectPending, connected: p.connected, countdownRunning: !!p.reTimer })) { p.plog('reconnect countdown not started: an attempt is already in progress'); return; }
  p.reconnecting = true; syncWake();
  p.plog(`reconnect: countdown ${seconds} s`);
  let left = seconds;
  setCount(p, () => T.reIn(p.label, left), true);          // "Reconnect now" is offered during the countdown
  if (p.reTimer) clearInterval(p.reTimer);
  p.reTimer = setInterval(async () => {
    left -= 1;
    if (left > 0) { setCount(p, () => T.reIn(p.label, left), true); return; }
    clearInterval(p.reTimer); p.reTimer = null;
    if (p.connectPending || p.connected) { p.plog('reconnect countdown ended: a connect is already in flight'); return; }
    try {
      p.device = await freshHandle(p.device);
      // No adapter-state probe any more: older Chrome had none, and the gate
      // it fed (a "tap to reconnect" wait) was removed 2026-09-17. The trade:
      // with Bluetooth OFF this Chrome may close the tab on reconnect, so the
      // app tells the user to keep Bluetooth on (toast + line under the readings).
      await connectTo(p, p.device);
    } catch (err) {
      p.plog(`reconnect failed: ${err.message}`);
      if (p.isActive) { setStatus(() => T.disconnectedFromWhy(p.label, err.message), 'bad'); toast(T.reFailed(err.message) + T.oneAppToast, 9000); }
      if (p.reconnecting && $('autoRe').checked) startReconnectCountdown(p); else showReconnectIdle(p);
    }
  }, 1000);
}

$('reNow').addEventListener('click', async () => {
  const p = active; if (!p || p.remote) return;
  if (p.connectPending) return;                                        // double tap
  p.plog('reconnect: user tapped Reconnect now');
  if (p.reTimer) { clearInterval(p.reTimer); p.reTimer = null; }       // the tap replaces any pending countdown
  p.reNow = false; refreshCard();
  try { p.reconnecting = true; syncWake(); await connectTo(p, p.device); } catch (err) {
    p.plog(`reconnect failed: ${err.message}`);
    setStatus(() => T.disconnectedFromWhy(p.label, err.message), 'bad');
    toast(T.reFailed(err.message) + T.oneAppToast, 9000);
    if ($('autoRe').checked) startReconnectCountdown(p); else showReconnectIdle(p);
  }
});
$('cancelRe').addEventListener('click', () => {
  const p = active; if (!p || p.remote) return;
  p.plog('reconnect: cancelled by user');
  showReconnectIdle(p); p.userDisconnect = true;
  try { if (p.device && p.device.gatt.connected) p.device.gatt.disconnect(); } catch { /* nothing to drop */ }
  setStatus(() => T.disconnectedFrom(p.label), 'bad');
});

async function freshHandle(device) {
  try {
    if (navigator.bluetooth.getDevices) {
      const list = await navigator.bluetooth.getDevices();
      const same = list.find((d) => d.id === device.id);
      if (same) return same;
    }
  } catch { /* not supported or denied - keep the old handle */ }
  return device;
}

// Android's BLE stack often refuses the first GATT connect outright
// ("Connection attempt failed", status 133) and accepts the next one a second
// later - seen live 2026-09-18: three taps, third one worked. So one tap makes
// up to CONNECT_TRIES attempts before the failure is shown.
const CONNECT_TRIES = 3, CONNECT_GAP_MS = 1500;
const retryableConnectError = (e) => !/cancel|not found|no such|permission/i.test(e.message);
async function connectTo(p, device) {
  const name = device.name || device.id;
  const CONNECT_S = 15;
  let left = CONNECT_S, attempt = 1;
  const show = () => { const txt = () => (attempt > 1 ? T.connectingRetry(name, left, attempt, CONNECT_TRIES) : T.connectingTo(name, left)); if (p.isActive) setStatus(txt); setCount(p, txt); };
  p.connectPending = true; show(); refreshCard();
  const ticker = setInterval(() => { left = Math.max(0, left - 1); show(); }, 1000);
  $('connectBig').disabled = true;
  try {
    for (;;) {
      const t0 = Date.now();
      try { await p.bms.connect(device, { timeoutMs: CONNECT_S * 1000 }); p.plog(`connect: ok on attempt ${attempt} in ${Date.now() - t0} ms`); return; } catch (err) {
        p.plog(`connect: attempt ${attempt} failed after ${Date.now() - t0} ms: ${err.message}`);
        if (attempt >= CONNECT_TRIES || !retryableConnectError(err) || p.userDisconnect) throw err;
        attempt++; left = CONNECT_S; show();
        await new Promise((r) => setTimeout(r, CONNECT_GAP_MS));
      }
    }
  } finally {
    p.connectPending = false; clearInterval(ticker); $('connectBig').disabled = false; refreshCard();
  }
}

if (navigator.bluetooth && navigator.bluetooth.addEventListener) {
  navigator.bluetooth.addEventListener('availabilitychanged', (e) => {
    log(`bluetooth adapter ${e.value ? 'available' : 'unavailable'}`);
    if (!e.value) setStatus(() => T.btOff, 'bad');
    else for (const p of packs.values()) if (p.reconnecting && !p.connectPending && !p.reTimer) startReconnectCountdown(p, 3);
  });
}

// Connect a BMS: into `p` (reconnect of a known pack) or a new pack (+ Add BMS).
async function startConnect(p) {
  try {
    const fresh = !p;
    if (fresh) p = new Pack(`bt-${++packSeq}`, `BMS ${packs.size + 1 - (packs.size && [...packs.values()].some((x) => x.demo) ? 1 : 0)}`);
    else { showReconnectIdle(p); p.userDisconnect = false; }   // an explicit Connect tap lifts an earlier Cancel
    try {
      if (p.device && p.device.gatt.connected) {
        const gone = new Promise((res) => p.device.addEventListener('gattserverdisconnected', res, { once: true }));
        p.device.gatt.disconnect();
        await Promise.race([gone, new Promise((res) => setTimeout(res, 2000))]);
      }
    } catch { /* nothing to drop */ }
    setStatus(() => T.choosing);
    const device = await p.bms.requestDevice();
    log(`chooser: picked "${device.name || '(no name)'}" id=${String(device.id || '').slice(0, 10)}…`);
    if ([...packs.values()].some((x) => x !== p && x.device && x.device.id === device.id)) { toast(T.alreadyAdded(device.name || device.id)); setActive(packs.get([...packs.values()].find((x) => x.device && x.device.id === device.id).id)); return; }
    p.device = device; p.id = fresh ? `bt-${device.id}` : p.id;
    if (fresh) { addPack(p); setActive(p); }
    await connectTo(p, device);
  } catch (err) {
    setStatus(err.message, 'bad');
    log(`connect failed: ${err.message}`);
    if (!/cancelled/i.test(err.message)) toast(T.couldNot(err.message) + T.oneAppToast);
    if (p && packs.has(p.id)) {
      // a device was picked but would not connect: keep trying on the countdown
      // (Reconnect now is offered there) instead of dropping back to the chooser
      if (p.device && !/cancelled/i.test(err.message) && $('autoRe').checked) { p.offlineThunk = () => T.offlineDrop(p.label); startReconnectCountdown(p, 5); }
      else showReconnectIdle(p);
      refreshCard();
    }
  }
}
$('connectBig').addEventListener('click', () => startConnect(null));
$('connectAgain').addEventListener('click', () => startConnect(active && !active.remote && !active.demo ? active : null));
els.disconnect.addEventListener('click', () => { const p = active; if (!p || !p.bms) return; p.userDisconnect = true; showReconnectIdle(p); p.bms.disconnect(); });

// ---- Share live (publisher) ----
// One line for both chips: viewers, path (and how many are on direct Wi-Fi),
// server connections against the free cap, or the retry countdown.
// The server count (connections in use / free cap) is shown in every state
// once the relay has reported it, so a full server is never a surprise.
function liveText(s, fmtChip) {
  const srv = s.server && s.server.limit ? ' · ' + T.serverConns(s.server.conns, s.server.limit) : '';
  if (!s.net) return T.netOffline;                 // this device has no internet: nothing else can be judged
  if (s.sig === false) return T.serverUnreachable + srv;    // internet ok, but the server does not answer (null = first connect in progress)
  if (s.reader === false) return T.readerOffline + srv;   // viewer only: server says the reader is not there
  if (s.retryIn !== null && s.retryIn !== undefined) return `${s.error ? T.liveError(s.error) + ' · ' : ''}${T.retryIn(s.retryIn)}${srv}`;
  if (!s.live) return (s.error ? T.liveError(s.error) : T.liveConnecting) + srv;
  const path = (T.path[s.path.tier] || s.path.label) + (s.path.sub && T.pathSub[s.path.sub] ? ` · ${T.pathSub[s.path.sub]}` : '');
  const extra = [];
  if (s.p2p) extra.push(T.p2pCount(s.p2p));
  return fmtChip(s.viewers, path) + (extra.length ? ' · ' + extra.join(' · ') : '') + srv;
}
function renderLiveChip() {
  if (!publisher) { els.liveChip.hidden = true; els.share.classList.remove('on'); $('liveNote').hidden = true; return; }
  const s = publisher.state;
  els.liveChip.hidden = false; els.share.classList.add('on'); $('liveNote').hidden = false;
  els.liveTxt.textContent = liveText(s, T.liveChip);
  els.shareLink.value = publisher.link || '';
}
async function copyShareLink() {
  const link = publisher.link;
  try { await navigator.clipboard.writeText(link); toast(T.linkCopied, 7000); }
  catch { els.shareLink.hidden = false; els.shareLink.select(); toast(T.linkCopyManual, 9000); }
}
// The share link as a QR code, so the other phone just points its camera at
// this screen. Big and open by default; the user can hide it. The QR holds the
// whole link, key included - anyone who scans it can watch, like the link.
function renderQr(text, c = $('qrCanvas')) {
  if (typeof qrcode !== 'function' || !c) return false;
  const qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make();
  const n = qr.getModuleCount(), scale = 6, quiet = 4, px = (n + quiet * 2) * scale;
  c.width = px; c.height = px;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px); ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
  return true;
}
function showQr(show) {
  const ok = show && publisher && renderQr(publisher.link);
  $('qrPanel').hidden = !ok; if (ok) $('qrPanel').open = true;
  $('qrShow').hidden = !publisher || ok;
  $('qrLink').textContent = publisher ? publisher.link : '';
}
if (new URLSearchParams(location.search).has('test')) window.__batrayTest = { renderQr };
// Share setup: a name the viewers see, and whether to keep the earlier link
// (room + key saved on this device, so a restart does not orphan bookmarks).
let channelName = '';
const savedShare = () => { try { return parseSavedShare(localStorage.getItem('batray_share_last')); } catch { return null; } };
function openSharePanel() {
  const saved = savedShare();
  let savedName = ''; try { savedName = localStorage.getItem('batray_share_name') || ''; } catch {}
  const dev = active && !active.remote && !active.demo ? active.label : '';
  $('shareName').value = suggestChannelName({ saved: savedName, deviceName: dev });
  const cb = $('shareReuse');
  cb.disabled = !saved; cb.checked = !!saved;
  $('shareReuseInfo').textContent = saved ? T.shareReuseFrom(fmtSpan((Date.now() - saved.at) / 3600000) === '-' ? '' : fmtSpan((Date.now() - saved.at) / 3600000) + ' ago') : T.shareReuseNone;
  $('sharePanel').hidden = false; $('sharePanel').open = true; $('sharePanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('shareName').focus();
}
function renderChannelName() {
  $('qrName').textContent = channelName;
}
async function startShare() {
  if (publisher) { copyShareLink(); return; }
  openSharePanel();
}
async function beginShare() {
  if (publisher) return;
  channelName = $('shareName').value.trim().slice(0, 40) || suggestChannelName({ saved: '', deviceName: '' });
  try { localStorage.setItem('batray_share_name', channelName); } catch {}
  const reuse = $('shareReuse').checked ? savedShare() : null;
  log(`share: name "${channelName}", ${reuse ? `reusing room ${reuse.room}` : 'new room'}`);
  $('sharePanel').hidden = true;
  els.share.disabled = true;
  let lastViewers = 0;
  publisher = new Publisher({ log, onState: (s) => {
    renderLiveChip(); syncWake(); watchReach(s);
    if (s.viewers !== lastViewers) {
      const joined = s.viewers > lastViewers; lastViewers = s.viewers;
      if (alerts) alerts.notify('viewers', joined ? T.evViewerJoined : T.evViewerLeft, T.evWatching(s.viewers));
    }
  } });
  renderLiveChip();
  try {
    await publisher.start(reuse);
    try { localStorage.setItem('batray_share_last', JSON.stringify(publisher.credentials)); } catch {}
    if (reuse && !publisher.reused) toast(T.shareNewLink, 9000);
    renderChannelName();
    showQr(true);
    copyShareLink();
    // late viewers need the pack list plus info/settings: resend every 10 s
    publisher.snapshotTimer = setInterval(sendSnapshots, 10000);
    sendSnapshots();
  } catch (err) {
    log(`share failed: ${err.message}`);
    toast(T.shareFailed(err.message), 9000);
    publisher.stop(); publisher = null; renderLiveChip();
  } finally { els.share.disabled = false; syncWake(); }
}
function sendSnapshots() {
  if (!publisher) return;
  publisher.publish(envelope('hello', { id: '*', name: '*' }, { channel: channelName, version: APP_VERSION }));
  const list = [...packs.values()].map((p) => ({ id: p.id, name: p.label, demo: !!p.demo, connected: p.connected }));
  publisher.publish(envelope('packs', { id: '*', name: '*' }, list));
  for (const p of packs.values()) {
    if (p.info) publisher.publish(envelope('info', p, p.info));
    if (p.settings) publisher.publish(envelope('settings', p, p.settings));
    if (p.data) publisher.publish(envelope('data', p, p.data));
  }
}
async function stopShare() {
  if (!publisher) return;
  clearInterval(publisher.snapshotTimer);
  await publisher.stop(); publisher = null;
  showQr(false);
  renderLiveChip(); syncWake();
  toast(T.shareStopped, 5000);
}
els.share.addEventListener('click', startShare);
$('shareGo').addEventListener('click', () => beginShare().catch(() => {}));
$('shareCancel').addEventListener('click', () => { $('sharePanel').hidden = true; });
$('shareName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); beginShare().catch(() => {}); } });
$('viewStop').addEventListener('click', () => { if (viewer) { viewer.stop(); setStatus(() => T.viewStopped, 'bad'); $('viewStop').hidden = true; els.viewTxt.textContent = T.viewStopped; } });
els.liveStop.addEventListener('click', stopShare);
$('shareCopy').addEventListener('click', copyShareLink);
$('qrCopy').addEventListener('click', copyShareLink);
$('qrHide').addEventListener('click', () => showQr(false));
$('qrShow').addEventListener('click', () => showQr(true));

// ---- Viewer mode ----
function renderViewChip() {
  if (!viewer) { els.viewChip.hidden = true; return; }
  const s = viewer.state;
  els.viewChip.hidden = false;
  els.viewTxt.textContent = liveText(s, T.viewChip);
  $('viewStop').hidden = !(s.retryIn !== null && s.retryIn !== undefined);
}
let readerLive = false, readerSeen = false, viewChannel = '';
// only the server's word counts as "reader offline"; our own socket being down is "reconnecting"
function readerGone() { return !!(viewer && viewer.state.sig && viewer.state.reader === false); }
// Internet / server reachability of THIS device, same on both sides. A state
// must hold 10 s before it is announced, so a socket reopen is not an outage.
let reach = 'ok', reachTimer = null;
function watchReach(s) {
  const now = !s.net ? 'net' : (s.sig === false ? 'server' : 'ok');
  if (now === reach) { clearTimeout(reachTimer); reachTimer = null; return; }
  if (reachTimer) return;
  reachTimer = setTimeout(() => {
    reachTimer = null;
    const st = viewer ? viewer.state : (publisher ? publisher.state : null); if (!st) return;
    const cur = !st.net ? 'net' : (st.sig === false ? 'server' : 'ok');
    if (cur === reach) return;
    const prev = reach; reach = cur;
    if (!alerts) return;
    if (cur === 'net') alerts.notify('net', T.evNetOff, T.evNetOffBody);
    else if (cur === 'server') alerts.notify('net', T.evServerOff, T.evServerOffBody);
    else alerts.notify('net', T.evNetOn, prev === 'net' ? T.evNetOnBody : T.evServerOnBody);
  }, 10000);
}
function startView() {
  document.body.classList.add('view');
  $('titleText').textContent = `BatRay by ClearEvo.com v${APP_VERSION} · ${T.viewTitle}`;
  for (const el of [els.disconnect, $('autoRe').parentElement, els.share, $('tsep')]) el.hidden = true;
  els.empty.hidden = true;
  setStatus(() => T.viewWaiting);
  viewer = new Viewer({
    room: viewMode.room, keyB64: viewMode.key, log,
    onState: (s) => {
      renderViewChip(); watchReach(s);
      for (const p of packs.values()) { p.remoteLive = s.live; }
      // reader online/offline is the server's word (its session registered or
      // not), judged only while our own socket is up - our internet dropping
      // is reported as that, never as the reader vanishing
      if (s.sig && s.reader !== null && s.reader !== readerLive) { readerLive = s.reader; if (readerSeen && alerts) alerts.notify('reader', readerLive ? T.evReaderOn : T.evReaderOff, readerLive ? T.evReaderOnBody : T.evReaderOffBody); if (readerLive) readerSeen = true; }
      if (active) { if (!s.live) setStatus(() => (s.reader === false ? T.viewOfflineShort : T.viewReconnecting), 'bad'); else setStatus(() => T.viewingPack(active.label), 'good'); }
      refreshCard(); renderPackBar(); syncWake();
    },
    onEnvelope: (env) => {
      if (env.k === 'hello') {
        const name = env.v && typeof env.v.channel === 'string' ? env.v.channel.slice(0, 40) : '';
        if (name !== viewChannel) { viewChannel = name; $('viewName').textContent = name; $('viewName').hidden = !name; document.title = name ? `${name} · BatRay live` : document.title; log(`live: channel "${name}"${env.v.version ? ` (reader v${env.v.version})` : ''}`); }
        return;
      }
      if (env.k === 'packs') {
        const ids = new Set(env.v.map((x) => x.id));
        for (const p of [...packs.values()]) if (!ids.has(p.id)) removePack(p);
        for (const x of env.v) { const p = packs.get(x.id) || addPack(new Pack(x.id, x.name, { remote: true })); p.name = x.name; if (x.demo && !p.demo) p.demo = { stop() {} }; p.remoteLive = viewer.state.live && x.connected; }
        renderPackBar(); return;
      }
      let p = packs.get(env.p.id);
      if (!p) { p = addPack(new Pack(env.p.id, env.p.name, { remote: true })); }
      p.remoteLive = true; readerSeen = true;
      if (env.k === 'info') { p.info = env.v; if (p.isActive) renderDevice(env.v); }
      else if (env.k === 'settings') { p.settings = env.v; if (p.isActive) renderSettings(env.v); }
      else if (env.k === 'data') { p.take(env.v); if (p.isActive) { render(env.v); refreshCard(); } renderPackBar(); }
    },
  });
  renderViewChip();
  viewer.start().catch((e) => { log('view failed: ' + e.message); setStatus(e.message, 'bad'); });
}

// ---- Show on TV: the picture as a small HLS video the TV pulls (tv.js) ----
// Not encrypted on this path (a TV cannot hold the link key): the panel and the
// status bar say so while it runs.
function tvModel() {
  const p = active, d = p && p.data;
  const clock = new Date().toTimeString().slice(0, 8);
  const base = { label: p ? p.label : '', clock, brand: 'BatRay by ClearEvo.com', footer: p && p.demo ? T.demoBadge : '' };
  if (!d) return { ...base, waiting: true, waitingTxt: T.tvWaiting, updatedTxt: T.noData };
  const age = p.lastFrameAt ? Math.round((Date.now() - p.lastFrameAt) / 1000) : null;
  const I = p.iEma.v !== null ? p.iEma.v : d.current;
  const charging = d.current > 0.05, discharging = d.current < -0.05;
  const r = timeToGo({ remainAh: d.remainAh, nominalAh: d.nominalAh, currentA: I, cutoffPct });
  const st = p.settings, maxA = charging ? (st && st.maxChargeA) || 100 : (st && st.maxDischargeA) || 100;
  return {
    ...base, soc: d.soc === undefined ? null : d.soc,
    battLine: T.battLbl(d.packV === null || d.packV === undefined ? null : fmt(d.packV, 2), d.soh === undefined || d.soh === null ? null : d.soh),
    dir: charging ? 'chg' : discharging ? 'dis' : 'idle',
    powerTxt: d.power === null ? '-' : `${charging ? T.flowCharge : discharging ? T.flowDischarge : T.flowIdle} ${fmt(Math.abs(d.power), 0)} W`,
    ampsTxt: d.current === null ? T.noCurrent : T.ofMax(fmt(Math.abs(d.current), 2), fmt(maxA, 0)),
    etaTxt: r.kind === 'empty' ? T.etaEmpty(fmtSpan(r.hours), cutoffPct) : r.kind === 'full' ? T.etaFull(fmtSpan(r.hours)) : r.kind === 'atCutoff' ? T.etaAtCutoff : '',
    etaBad: r.kind === 'atCutoff', sysLbl: charging ? T.charger : discharging ? T.load : T.system, chips: chipList(d),
    updatedTxt: age === null ? T.noData : age < 2 ? T.justNow : T.agoS(age), stale: age !== null && age > 15,
  };
}
function renderTv(s) {
  if (!tv || !s.live) return;
  $('tvLink').textContent = s.url;
  const v = $('tvVideo');
  // Chrome on Android plays HLS itself (and casts it); desktop Chrome does not,
  // so there the preview and the Cast button stay hidden and the link/QR is the way.
  const canHls = !!v.canPlayType('application/vnd.apple.mpegurl');
  $('tvPreviewRow').hidden = !canHls; $('tvCastRow').hidden = !canHls; $('tvNoPreview').hidden = canHls;
  if (canHls && s.segs >= 2 && !v.getAttribute('src')) { v.src = s.url; v.play().catch(() => {}); watchCast(v); }
  const pull = s.pullAgeS === null || s.pullAgeS === undefined ? T.tvNotPulled : T.tvPulled(s.pullAgeS);
  $('tvStat').textContent = (s.error ? T.tvErr(s.error) + ' · ' : '') + T.tvStat(s.segs, Math.round(s.bytes / 1024), pull) + (s.segs < 2 ? ' · ' + T.tvStarting : '');
}
function watchCast(v) {
  if (!v.remote || !v.remote.watchAvailability) { $('tvCastHint').textContent = T.tvCastUnsup; return; }
  v.remote.watchAvailability((avail) => { $('tvCast').disabled = !avail; $('tvCastHint').textContent = avail ? T.tvCastReady : T.tvCastNone; })
    .catch(() => { $('tvCast').disabled = false; $('tvCastHint').textContent = ''; });   // availability unknown: let the user try
}
async function startTv(opts = {}) {
  if (tv) return tv.state.url;
  const [w, h] = (opts.res || $('tvRes').value).split('x').map(Number);
  try { localStorage.setItem('batray_tv_res', $('tvRes').value); } catch {}
  $('tvStart').disabled = true;
  const t = new TvStream({ width: w, height: h, model: tvModel, log, onState: renderTv, ...opts });
  tv = t;
  try {
    const url = await t.start();
    $('tvStop').hidden = false; $('tvStart').hidden = true; $('tvRes').disabled = true; $('tvLive').hidden = false; $('tvNote').hidden = false; renderTv(t.state); syncWake();
    toast(T.tvStarting, 9000);
    return url;
  } catch (e) {
    log(`tv failed: ${e.message}`); toast(e.code === 'nocodec' ? T.tvNoCodec : T.tvFailed(e.message), 9000);
    tv = null; try { await t.stop(); } catch {}
    throw e;
  } finally { $('tvStart').disabled = false; }
}
async function stopTv() {
  if (!tv) return;
  const t = tv; tv = null;
  await t.stop();
  const v = $('tvVideo'); v.removeAttribute('src'); v.load();
  $('tvStop').hidden = true; $('tvStart').hidden = false; $('tvRes').disabled = false; $('tvLive').hidden = true; $('tvNote').hidden = true; $('tvQr').hidden = true;
  syncWake(); toast(T.tvStopped, 5000);
}
(function () {
  try { const r = localStorage.getItem('batray_tv_res'); if (r && [...$('tvRes').options].some((o) => o.value === r)) $('tvRes').value = r; } catch {}
  $('tv').addEventListener('click', () => { const p = $('tvPanel'); p.hidden = !p.hidden; if (!p.hidden) { p.open = true; p.scrollIntoView({ block: 'start', behavior: 'smooth' }); } });
  $('tvClose').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); $('tvPanel').hidden = true; });
  $('tvStart').addEventListener('click', () => startTv().catch(() => {}));
  $('tvStop').addEventListener('click', stopTv);
  $('tvCast').addEventListener('click', () => { const v = $('tvVideo'); if (v.remote) v.remote.prompt().catch((e) => toast(T.tvFailed(e.message), 8000)); });
  $('tvCopy').addEventListener('click', async () => { if (!tv) return; try { await navigator.clipboard.writeText(tv.state.url); toast(T.linkCopied, 6000); } catch { toast(T.linkCopyManual, 8000); } });
  $('tvQrBtn').addEventListener('click', () => { const c = $('tvQr'); if (!tv) return; if (c.hidden) { renderQr(tv.state.url, c); c.hidden = false; } else c.hidden = true; });
  window.addEventListener('pagehide', () => { if (tv) { const t = tv; tv = null; t.stop(); } });
})();
if (window.__batrayTest) Object.assign(window.__batrayTest, {
  openSharePanel, beginShare, startTv, stopTv, tvState: () => (tv ? tv.state : null), logLines: () => logLines.slice(), logHeaderLines,
  tvFrame: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; drawTvFrame(c.getContext('2d'), w, h, { tick: 3, ...tvModel() }); return c.toDataURL('image/png'); },
});

// ---- misc UI ----
async function copyLog(btn) {
  const lbl = btn.querySelector('.lbl');
  try {
    await navigator.clipboard.writeText(logLines.join('\n'));
    lbl.textContent = T.copied; toast(T.copiedLog(logLines.length), 6000);
    setTimeout(() => (lbl.textContent = T.copyLog), 1500);
  } catch { els.debug.open = true; log(T.clipBlocked); }
}
els.copy.addEventListener('click', () => copyLog(els.copy));
// Upload: the same log to clearevo.com, only after the warning is accepted.
// The relay stores it for 90 days for the owner to read; the id is the handle.
async function uploadLog(btn) {
  if (!window.confirm(T.uploadWarn)) { log('log upload: declined at the warning'); return; }
  const body = logHeaderLines().join('\n') + '\n---\n' + logLines.join('\n');
  const lbl = btn.querySelector('.lbl'); const was = lbl ? lbl.textContent : '';
  if (lbl) lbl.textContent = T.uploading;
  btn.disabled = true;
  try {
    const r = await fetch('/batray/api/log', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    log(`log uploaded: id ${j.id} (${body.length} chars)`);
    $('uploadId').textContent = T.uploadedId(j.id); $('uploadId').hidden = false;
    toast(T.uploadDone(j.id), 14000);
  } catch (e) {
    log(`log upload failed: ${e.message}`);
    toast(T.uploadFailed(e.message), 10000);
  } finally { if (lbl) lbl.textContent = was; btn.disabled = false; }
}
$('upload').addEventListener('click', () => uploadLog($('upload')));
$('upload2').addEventListener('click', () => uploadLog($('upload2')));
$('copy2').addEventListener('click', () => copyLog($('copy2')));
$('bAbout').addEventListener('click', () => { $('about').style.display = 'flex'; });
$('aboutClose').addEventListener('click', () => { $('about').style.display = 'none'; });
$('about').addEventListener('click', (e) => { if (e.target === $('about')) $('about').style.display = 'none'; });

(function () {
  const cb = $('autoRe');
  try { const v = localStorage.getItem('batray_auto_reconnect'); if (v !== null) cb.checked = v === '1'; } catch {}
  cb.addEventListener('change', () => { try { localStorage.setItem('batray_auto_reconnect', cb.checked ? '1' : '0'); } catch {} if (!cb.checked) for (const p of packs.values()) showReconnectIdle(p); });
})();
(function () {
  let z = +localStorage.getItem('ce_zoom') || 100;
  const apply = () => { document.body.style.zoom = z + '%'; try { localStorage.setItem('ce_zoom', z); } catch {} };
  $('fMinus').onclick = () => { z = Math.max(60, z - 10); apply(); };
  $('fPlus').onclick = () => { z = Math.min(200, z + 10); apply(); };
  apply();
})();

for (const line of logHeaderLines()) log(line);     // typeof-guarded inside: a missing BluetoothDevice global must not abort startup
logEnvAsync();
// one line a minute with everything that matters, so a log of a whole night reads as a timeline
setInterval(() => {
  const p = active;
  const age = p && p.lastFrameAt ? Math.round((Date.now() - p.lastFrameAt) / 1000) : null;
  const pub = publisher ? `pub(live=${publisher.state.live} viewers=${publisher.state.viewers} path=${publisher.state.path.tier} p2p=${publisher.state.p2p} sent=${publisher.state.sent} dropped=${publisher.state.dropped} sig=${publisher.state.sig})` : '';
  const vw = viewer ? `view(live=${viewer.state.live} reader=${viewer.state.reader} path=${viewer.state.path.tier} received=${viewer.state.received} sig=${viewer.state.sig})` : '';
  const tvs = tv ? `tv(segs=${tv.state.segs} kb=${Math.round(tv.state.bytes / 1024)} pull=${tv.state.pullAgeS}s err=${tv.state.error || '-'})` : '';
  const mem = performance.memory ? ` heap=${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '';
  log(`hb: vis=${document.visibilityState} online=${navigator.onLine} packs=${packs.size} active=${p ? p.label : '-'} connected=${p ? p.connected : '-'} frameAge=${age === null ? '-' : age + 's'} wake=${!!wakeLock} ${pub} ${vw} ${tvs}${mem}`.replace(/\s+/g, ' '));
}, 60000);
$('lang').innerHTML = Object.keys(I18N).map((k) => `<option value="${k}">${I18N[k].langName}</option>`).join('');
$('lang').addEventListener('change', () => { try { localStorage.setItem('batray_lang', $('lang').value); } catch {} log(`language: ${$('lang').value}`); applyLang($('lang').value); });

if (!navigator.bluetooth && !viewMode) {
  setStatus(() => T.noWebBt, 'bad');
  for (const id of ['connectBig', 'connectAgain']) $(id).disabled = true;
}
applyLang(detectLang());
// Alerts (thresholds -> Chrome notifications; ntfy and the relay watchdog stay off behind NTFY_ENABLED).
// Started after the language is set so the first render has strings.
alerts = initAlerts({
  log, T: () => T, getPacks: () => [...packs.values()], viewMode,
  onStatus: (st) => {
    const el = $('alertNote'); if (!el) return;
    el.hidden = !st.channels.length;
    $('alertTxt').textContent = T.alertNote(st.channels.join(' + ') + (st.watchdog ? ' + ' + T.alertWatch : ''));
  },
});
if (viewMode) startView();
else if (new URLSearchParams(location.search).has('demo')) runDemo();
