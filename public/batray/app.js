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

import { castState, onCastStateEvent, discoveryKnown, castTapDecision, castAfterDiscovery, castRequestStarted, castRequestEnded, castErrorDecision } from './cast-logic.js';
import { wakeState, wakeMode, wakeShouldRequest, wakeAcquired, wakeReleased, wakeRefused, wakeRetryDelayMs, wakeVideoWanted } from './wake-logic.js';
import { JkBms, decodeCellInfo, errorLabels, hex, FRAME_CELL_INFO, linkGone } from './jkbms.js';
import { fmt, fmtWh, fmtSpan as fmtSpanT, fmtRuntime as fmtRuntimeT, socLevel, flowModel, etaModel, chipList as chipListT, cellsStat, ageLabel, buildTvModel } from './view-logic.js';
import { connState, connEvent, connCard, packChipState, wakeWantedByConn, cancelledError, CONNECT_TRIES, CONNECT_S } from './conn-logic.js';
import { shareState, shareTapDecision, shareSetupModel, shareSetupCancelled, shareBegin, shareStarted, shareFailed, shareStopped, shareButton, viewersChange, liveText, reachState, reachEvent, reachSettle, viewState, viewerEvent, viewHello, viewerDataSeen } from './share-logic.js';
import { uiState, tabTap, sheetOpen, sheetClose, backDecision, lowPowerSet, sheetModel } from './ui-logic.js';
import { tvUiState, tvTapDecision, tvCloseDecision, tvStartDecision, tvStarted, tvStartFailed, tvStopped, tvButtons, tvPreviewWanted } from './tv-logic.js';
import { startDemo } from './demo.js';
import { I18N, detectLang } from './i18n.js';
import { Publisher, Viewer } from './live.js';
import { parseShare, envelope } from './live-logic.js';
import { initAlerts } from './alerts.js';
import { Ema, Trend } from './trend.js';
import { TvStream } from './tv.js';
import { suggestChannelName, parseSavedShare } from './live-logic.js';
import { drawTvFrame } from './tv-draw.js';

export const APP_VERSION = '0.9.25';

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
    `lang: ui=${langCode} · browser ${navigator.language} · ${(navigator.languages || []).join(',')}`,
    `features: secure=${yn(isSecureContext)} bluetooth=${yn(!!navigator.bluetooth)} adv=${yn(typeof BluetoothDevice !== 'undefined' && 'watchAdvertisements' in BluetoothDevice.prototype)} getDevices=${yn(navigator.bluetooth && navigator.bluetooth.getDevices)} availability=${yn(navigator.bluetooth && navigator.bluetooth.getAvailability)} wakeLock=${yn('wakeLock' in navigator)} notifications=${typeof Notification === 'undefined' ? 'none' : Notification.permission} sw=${navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlled' : 'none'} webCodecs=${yn(typeof VideoEncoder !== 'undefined')} hls=${v.canPlayType('application/vnd.apple.mpegurl') || 'no'} remotePlayback=${yn('remote' in v)} storage=${yn(storageOk)} clipboard=${yn(navigator.clipboard && navigator.clipboard.writeText)}`,
    `settings: autoReconnect=${$('autoRe').checked} cutoff=${cutoffPct}% keepAwake=${wakeS.mode} lowPower=${uiS.lowPower} tvRes=${$('tvRes').dataset.value} zoom=${document.body.style.zoom || '100%'} localStorage=[${lsKeys}]`,
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
// number / span / runtime formatting and every view model live in view-logic.js (pure, tested); T is bound here
const fmtSpan = (h) => fmtSpanT(h, T), fmtRuntime = (sec) => fmtRuntimeT(sec, T), chipList = (d) => chipListT(d, T);

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
    this.cs = connState();                                   // the connection flow state (conn-logic.js decides over it)
    this.demo = null; this.reTimer = null; this.gapTimer = null; this.attemptTicker = null;   // timers: the shell's, never in cs
    this.offlineThunk = null; this.loadThunk = null; this.countThunk = null; this.dumped = false;
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
      this.device = e.detail;
      this.plog(`gatt connected: ${this.label} id=${String(e.detail.id || '').slice(0, 10)}…`);
      connAct(this, 'gatt-connected');
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
      const stalled = this.cs.stalled, age = this.cs.stalledAge;
      if (this.isActive) { setStatus(() => (stalled ? T.stalled(this.label, age) : T.disconnectedFrom(this.label)), 'bad'); $('oneApp').hidden = true; $('btNote').hidden = true; }
      connAct(this, 'gatt-disconnected');
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
    if (first) this.plog(`first reading ${this.cs.connectedAt ? Math.round((Date.now() - this.cs.connectedAt) + '') + ' ms after connect' : ''}: soc=${d.soc} V=${d.packV} A=${d.current} cells=${d.cells.length} variant=${d.variant}`);
    this.take(d);
    if (this.isActive) scheduleRender(this);
    schedulePackBar();
    if (publisher) publisher.publish(envelope('data', this, d));
    if (connEvent(this.cs, 'data').action === 'back' && this.isActive) setStatus(() => T.connectedTo(this.label), 'good');   // back after a gap: say so instead of staying amber
    if (first) syncWake();
  }
  onInfo(i) { this.info = i; if (this.isActive) renderDevice(i); if (publisher) publisher.publish(envelope('info', this, i)); }
  onSettings(s) { this.settings = s; if (this.isActive) renderSettings(s); if (publisher) publisher.publish(envelope('settings', this, s)); }
}

const packs = new Map();
let active = null;
let packSeq = 0;
let publisher = null, viewer = null, tv = null;     // IO handles (sockets, encoder); their flow state is below
// ---- the state objects (house rule 2026-09-20): one plain object per flow,
// decisions in the *-logic.js modules (functional core), this file acts on
// them (imperative shell) and logs every decision. Per-pack BLE state is p.cs. ----
const shareS = shareState(), tvS = tvUiState(), castS = castState(), viewS = viewState(), reachS = reachState();
const uiS = uiState(viewMode ? 'viewer' : 'reader');
let langCode = 'en';
const wakeS = wakeState('wakeLock' in navigator);

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
  const c = connCard(p.cs, { gattConnected: !!p.bms.connected, hasData: !!p.data });
  body.toggle('offline', c.offline); body.toggle('loading', c.loading);
  if (c.loading && p.loadThunk) $('loadTxt').textContent = p.loadThunk();
  $('offlineTxt').textContent = p.offlineThunk ? p.offlineThunk() : T.disconnectedFrom(p.label);
  $('reState').hidden = !c.countdown; $('reIdle').hidden = !c.idle;
  if (c.countdown) { $('reCount').textContent = p.countThunk ? p.countThunk() : ''; $('reNow').hidden = !c.reNow; }
}

function renderPackBar() {
  const bar = els.packBar;
  const show = packs.size > 0 && !(viewMode && packs.size === 1);   // a lone remote pack is the picture itself
  bar.hidden = !show;
  if (!show) return;
  const chips = [...packs.values()].map((p) => {
    const d = p.data;
    const soc = d ? `${d.soc}%` : '';
    const I = d && d.current !== null ? (d.current > 0.05 ? `+${d.current.toFixed(1)} A` : d.current < -0.05 ? `−${Math.abs(d.current).toFixed(1)} A` : '0 A') : '';
    const cst = p.remote || p.demo ? (p.connected ? (d ? 'live' : 'waiting') : 'offline') : packChipState(p.cs, p.connected, !!d);
    const st = cst === 'live' ? '' : cst === 'waiting' ? ` <span class="pst">${T.packWaiting}</span>` : ` <span class="pst off">${cst === 'connecting' ? T.packConnecting : T.packOffline}</span>`;
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
  langCode = code; $('langLbl').textContent = code.toUpperCase();
  $('keepAwake').textContent = T[{ auto: 'keepAwakeAuto', always: 'keepAwakeAlways', never: 'keepAwakeNever' }[wakeS.mode]] || wakeS.mode;
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
// Two layers (an old Sony phone let the screen lock after a few hours with
// BatRay in front, 2026-09-19). Layer 1: the Screen Wake Lock API, asked for
// again whenever the phone lets go of it while the tab is still visible, with
// a 2 s .. 30 s back-off and a once-a-minute watchdog in the heartbeat.
// Layer 2: when the API is missing, refuses, or has been dropped twice, a
// tiny near-silent video keeps playing: Chromium's VideoWakeLock holds the
// screen for a playing video that is audible (has an audio track AND volume
// > 0) on a visible page, or visible and >= 20 % of the viewport - so this
// one must NOT be muted and keepawake.webm carries a silent opus track.
// The Notes card sets it to auto (default) / always / never.
// All decisions are in wake-logic.js over the one `wakeS` object; this code
// only acts on them (house rule 2026-09-20).
const KEEP_AWAKE_KEY = 'batray_keepawake';
let wakeLock = null, wakeRetryTimer = null, keepVideo = null;
try { wakeS.mode = wakeMode(localStorage.getItem(KEEP_AWAKE_KEY)); } catch {}
function setKeepAwake(mode) {
  wakeS.mode = wakeMode(mode);
  $('keepAwake').dataset.value = wakeS.mode; $('keepAwake').textContent = T[{ auto: 'keepAwakeAuto', always: 'keepAwakeAlways', never: 'keepAwakeNever' }[wakeS.mode]];
  try { localStorage.setItem(KEEP_AWAKE_KEY, wakeS.mode); } catch {}
  log(`keep-awake video: ${wakeS.mode}`); syncKeepAwake();
}
$('keepAwake').dataset.value = wakeS.mode;
$('keepAwake').addEventListener('click', async () => { const m = await openSheet('keepAwake'); if (m) setKeepAwake(m); });
async function syncKeepAwake() {
  const want = wakeVideoWanted(wakeS);
  if (want && !wakeS.videoOn) {
    if (!keepVideo) {
      keepVideo = $('keepVideo');
      keepVideo.src = 'keepawake.webm';                 // literal name: build.sh hashes it
      keepVideo.muted = false; keepVideo.volume = 0.01; // > 0: audible to Chrome, not to people
      keepVideo.addEventListener('pause', () => {       // paused by the browser (a call, audio focus): try again
        if (!wakeS.videoOn) return;
        wakeS.videoOn = false; $('wakeVideo').hidden = true; log('keep-awake video paused by the browser');
        setTimeout(syncKeepAwake, 5000);
      });
    }
    try {
      await keepVideo.play(); wakeS.videoOn = true;
      log(`keep-awake video playing (${wakeS.mode}, lock=${wakeS.held} drops=${wakeS.drops} refusals=${wakeS.refusals})`);
    } catch (err) { log(`keep-awake video refused: ${err.name} ${err.message}`); }
  } else if (!want && wakeS.videoOn) {
    wakeS.videoOn = false; keepVideo.pause(); log('keep-awake video stopped');
  }
  $('wakeVideo').hidden = !wakeS.videoOn;
}
function scheduleWakeRetry() {
  if (wakeRetryTimer) return;
  wakeRetryTimer = setTimeout(() => { wakeRetryTimer = null; if (wakeS.wanted && document.visibilityState === 'visible') syncWake(); }, wakeRetryDelayMs(wakeS));
}
async function syncWake() {
  wakeS.wanted = [...packs.values()].some((p) => wakeWantedByConn(p.cs, p.connected)) || shareS.phase === 'on' || shareS.phase === 'starting' || !!(viewer && viewer.state.live) || tvS.phase === 'on';
  const el = $('wake');
  if (wakeShouldRequest(wakeS, document.visibilityState === 'visible')) {
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock; wakeAcquired(wakeS);
      lock.addEventListener('release', () => {
        if (wakeLock !== lock) return;
        wakeLock = null; el.hidden = true;
        if (wakeReleased(wakeS, document.visibilityState === 'visible') === 'dropped') {
          log(`screen wake lock dropped by the system while in front (${wakeS.drops}) - asking again`);
          scheduleWakeRetry();
        } else log('screen wake lock released');
        syncKeepAwake();
      });
      log('screen wake lock acquired');
    } catch (err) {
      wakeRefused(wakeS);
      log(`screen wake lock refused (${wakeS.refusals}): ${err.name} ${err.message}`);
      scheduleWakeRetry();
    }
  } else if (!wakeS.wanted && wakeLock) {
    try { await wakeLock.release(); } catch { /* already gone */ }
    wakeLock = null; wakeS.held = false;
  }
  el.hidden = !wakeLock;
  await syncKeepAwake();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeS.wanted) syncWake(); });

// ---- flow picture layout: landscape on wide screens, portrait on phones and
// in full screen when the viewport is taller than wide (owner ask 2026-09-17:
// the picture is the thing people look at - give it half the screen) ----
const FLOW = {
  // battery group: nub 0..12, body 10..160 (120 wide), centre y 85 in group coordinates
  landscape: { vb: '0 0 640 200', batt: 'translate(36,10)', sys: 'translate(448,45)', line: 'M166 95 H444',
    out: 'M262 81 L276 95 L262 109 M312 81 L326 95 L312 109 M362 81 L376 95 L362 109', in: 'M278 81 L264 95 L278 109 M328 81 L314 95 L328 109 M378 81 L364 95 L378 109',
    power: [320, 72], amps: [320, 132], eta: [320, 168], upd: [170, 14] },   // 'updated' clear of the battery nub
  portrait: { vb: '0 0 340 508', batt: 'translate(110,14)', sys: 'translate(90,376)', line: 'M170 206 V236 M170 330 V370',   // gap behind the text block
    // two chevrons, above and below the text block, so no arrow crosses a number
    out: 'M156 214 L170 228 L184 214 M156 343 L170 357 L184 343', in: 'M156 228 L170 214 L184 228 M156 357 L170 343 L184 357',
    power: [170, 262], amps: [170, 290], eta: [170, 316], upd: [6, 14] },
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
  const lv = socLevel(d.soc, cutoffPct), fill = $('fFill');
  fill.setAttribute('y', lv.y); fill.setAttribute('height', lv.h); fill.className.baseVal = lv.cls;
  $('fCut').setAttribute('d', lv.cutPath); $('fCut').setAttribute('display', lv.cutShown ? '' : 'none');
  $('fSoc').textContent = lv.socTxt;
  const m = flowModel(d, active && active.settings, T);
  $('fSoh').textContent = m.battLine;
  const dash = $('fDash'), line = $('fLine');
  dash.setAttribute('stroke-width', m.width); line.setAttribute('stroke-width', m.width);
  dash.setAttribute('stroke-dasharray', m.dashArray);
  dash.setAttribute('class', m.cls); $('fPower').setAttribute('class', m.cls);
  $('fPower').textContent = m.powerTxt; $('fAmps').textContent = m.ampsTxt; $('fSysLbl').textContent = m.sysLbl;
  $('fArrIn').classList.toggle('show', m.dir === 'chg');
  $('fArrOut').classList.toggle('show', m.dir === 'dis');
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
  if (active && active.data) renderFlow(active.data);           // the cut-off line on the battery
  if (active && active.data) render(active.data, true);
});

function renderEta(p, d) {
  const e = etaModel({ remainAh: d.remainAh, nominalAh: d.nominalAh, currentA: p && p.iEma.v !== null ? p.iEma.v : d.current, cutoffPct }, T);
  const el = $('fEta');
  el.textContent = e.text; el.setAttribute('fill', e.bad ? '#ff8a80' : '#a7bccf');
  $('etaLine').hidden = e.hidden;
}
function renderStrip(d) {
  $('strip').innerHTML = chipList(d).map((c) => `<span class="chip${c.cls ? ` ${c.cls}` : ''}">${c.txt}</span>`).join('');
}

function renderCellsStat(d) { $('cellsStat').textContent = cellsStat(d, T); }

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
    if (!linkGone(p.lastFrameAt, p.cs.connectedAt)) continue;
    const age = Math.round((Date.now() - (p.lastFrameAt || p.cs.connectedAt)) / 1000);
    p.plog(`no data for ${age} s (${why}) - dropping the link and reconnecting`);
    if (p.isActive) setStatus(() => T.stalled(p.label, age), 'bad');
    connAct(p, 'link-stalled', { ageS: age });
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
  const a = ageLabel(active && active.lastFrameAt ? Math.round((Date.now() - active.lastFrameAt) / 1000) : null, T);
  els.updated.textContent = a.text;
  els.updated.setAttribute('fill', a.stale ? '#ffd24a' : '#6f8aa6');
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

// ---- BLE connection shell: every decision comes from conn-logic.js over
// p.cs (house rule 2026-09-20). This code owns the chooser, the GATT calls,
// the timers and the card, and logs each decision as `conn: <event> -> <action>`. ----
function clearConnTimers(p) {
  if (p.reTimer) { clearInterval(p.reTimer); p.reTimer = null; }
  if (p.gapTimer) { clearTimeout(p.gapTimer); p.gapTimer = null; }
  if (p.attemptTicker) { clearInterval(p.attemptTicker); p.attemptTicker = null; }
}
function connAct(p, ev, inp = {}) {
  const d = connEvent(p.cs, ev, { autoRe: $('autoRe').checked, now: Date.now(), ...inp });
  if (d.action !== 'count' && d.action !== 'noop') p.plog(`conn: ${ev} -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}${d.seconds ? ' ' + d.seconds + ' s' : ''}${d.attempt ? ' attempt ' + d.attempt : ''} [${p.cs.phase}]`);
  switch (d.action) {
    case 'choose': clearConnTimers(p); p.countThunk = null; runChooser(p, !!inp.fresh); break;
    case 'connect': clearConnTimers(p); runAttempt(p); break;
    case 'retry': clearConnTimers(p); showAttempt(p); p.gapTimer = setTimeout(() => { p.gapTimer = null; runAttempt(p); }, d.gapMs); break;
    case 'countdown': clearConnTimers(p); p.countThunk = () => T.reIn(p.label, p.cs.count); p.reTimer = setInterval(() => connAct(p, 'countdown-tick'), 1000); break;
    case 'count': if (p.cs.phase === 'connecting') showAttempt(p); break;    // the countdown thunk reads cs.count itself
    case 'idle': case 'connected': clearConnTimers(p); p.countThunk = null; break;
    case 'disconnect-gatt': clearConnTimers(p); p.countThunk = null; try { if (p.device && p.device.gatt.connected) p.device.gatt.disconnect(); } catch { /* nothing to drop */ } break;
    case 'disconnect-bms': clearConnTimers(p); p.countThunk = null; p.bms.disconnect(); break;
    case 'drop-link': p.bms.drop(`no data for ${d.ageS} s`); break;
    default: break;
  }
  if (p.isActive) refreshCard();
  renderPackBar(); syncWake();
  return d;
}
function showAttempt(p) {
  const name = p.device ? (p.device.name || p.device.id) : p.label;
  const txt = () => (p.cs.attempt > 1 ? T.connectingRetry(name, p.cs.left, p.cs.attempt, CONNECT_TRIES) : T.connectingTo(name, p.cs.left));
  if (p.isActive) setStatus(txt);
  p.countThunk = txt;
  if (p.isActive) refreshCard();
}
// Android's BLE stack often refuses the first GATT connect outright
// ("Connection attempt failed", status 133) and accepts the next one a second
// later - seen live 2026-09-18: three taps, third one worked. conn-logic.js
// turns that into up to CONNECT_TRIES attempts per tap; this runs one.
async function runAttempt(p) {
  if (p.cs.origin !== 'chooser') p.device = await freshHandle(p.device);
  showAttempt(p);
  if (!p.attemptTicker) p.attemptTicker = setInterval(() => connAct(p, 'connect-tick'), 1000);
  $('connectBig').disabled = true;
  const t0 = Date.now(), attempt = p.cs.attempt;
  try {
    await p.bms.connect(p.device, { timeoutMs: CONNECT_S * 1000 });
    p.plog(`connect: ok on attempt ${attempt} in ${Date.now() - t0} ms`);
  } catch (err) {
    p.plog(`connect: attempt ${attempt} failed after ${Date.now() - t0} ms: ${err.message}`);
    const d = connAct(p, 'attempt-failed', { msg: err.message });
    if (d.final) {
      if (p.isActive) setStatus(() => T.disconnectedFromWhy(p.label, err.message), 'bad');
      if (!cancelledError(err.message)) toast((p.cs.origin === 'chooser' ? T.couldNot(err.message) : T.reFailed(err.message)) + T.oneAppToast, 9000);
      p.offlineThunk = () => T.offlineDrop(p.label);
      if (p.isActive) refreshCard();
    }
  } finally {
    $('connectBig').disabled = false;
    if (p.attemptTicker) { clearInterval(p.attemptTicker); p.attemptTicker = null; }
  }
}
async function runChooser(p, fresh) {
  try {
    if (p.device && p.device.gatt.connected) {
      const gone = new Promise((res) => p.device.addEventListener('gattserverdisconnected', res, { once: true }));
      p.device.gatt.disconnect();
      await Promise.race([gone, new Promise((res) => setTimeout(res, 2000))]);
    }
  } catch { /* nothing to drop */ }
  setStatus(() => T.choosing);
  try {
    const device = await p.bms.requestDevice();
    log(`chooser: picked "${device.name || '(no name)'}" id=${String(device.id || '').slice(0, 10)}…`);
    const dup = [...packs.values()].find((x) => x !== p && x.device && x.device.id === device.id);
    if (dup) { toast(T.alreadyAdded(device.name || device.id)); connAct(p, 'chooser-cancelled'); setActive(dup); return; }
    p.device = device;
    if (fresh) { p.id = `bt-${device.id}`; addPack(p); setActive(p); }
    connAct(p, 'picked');
  } catch (err) {
    setStatus(err.message, 'bad');
    log(`connect failed: ${err.message}`);
    if (!/cancelled/i.test(err.message)) toast(T.couldNot(err.message) + T.oneAppToast);
    connAct(p, 'chooser-cancelled');
  }
}
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
if (navigator.bluetooth && navigator.bluetooth.addEventListener) {
  navigator.bluetooth.addEventListener('availabilitychanged', (e) => {
    log(`bluetooth adapter ${e.value ? 'available' : 'unavailable'}`);
    if (!e.value) setStatus(() => T.btOff, 'bad');
    else for (const p of packs.values()) if (!p.remote && !p.demo) connAct(p, 'adapter-available');
  });
}
// Connect a BMS: into `p` (reconnect of a known pack) or a new pack (+ Add BMS).
function startConnect(p) {
  const fresh = !p;
  if (fresh) p = new Pack(`bt-${++packSeq}`, `BMS ${packs.size + 1 - (packs.size && [...packs.values()].some((x) => x.demo) ? 1 : 0)}`);
  connAct(p, 'tap-connect', { fresh });
}
$('connectBig').addEventListener('click', () => startConnect(null));
$('connectAgain').addEventListener('click', () => startConnect(active && !active.remote && !active.demo ? active : null));
els.disconnect.addEventListener('click', () => { const p = active; if (!p || !p.bms) return; connAct(p, 'disconnect'); });
$('reNow').addEventListener('click', () => { const p = active; if (!p || p.remote) return; p.plog('reconnect: user tapped Reconnect now'); connAct(p, 'reconnect-now'); });
$('cancelRe').addEventListener('click', () => { const p = active; if (!p || p.remote) return; p.plog('reconnect: cancelled by user'); connAct(p, 'cancel'); setStatus(() => T.disconnectedFrom(p.label), 'bad'); });

// ---- Share live (publisher) ----
// One line for both chips: viewers, path (and how many are on direct Wi-Fi),
// server connections against the free cap, or the retry countdown.
// The server count (connections in use / free cap) is shown in every state
// once the relay has reported it, so a full server is never a surprise.
function renderLiveChip() {
  const b = shareButton(shareS);
  els.share.classList.toggle('on', b.on); els.share.setAttribute('aria-pressed', b.on); els.share.disabled = b.disabled;
  els.share.title = b.on ? T.shareOnTitle : (els.share.dataset.title || '');
  if (!publisher) { els.liveChip.hidden = true; $('liveNote').hidden = true; return; }
  const s = publisher.state;
  els.liveChip.hidden = false; $('liveNote').hidden = false;
  els.liveTxt.textContent = liveText(s, T, T.liveChip);
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
const savedShare = () => { try { return parseSavedShare(localStorage.getItem('batray_share_last')); } catch { return null; } };
function openSharePanel() {
  let savedName = ''; try { savedName = localStorage.getItem('batray_share_name') || ''; } catch {}
  const m = shareSetupModel({ savedName, deviceName: active && !active.remote && !active.demo ? active.label : '', saved: savedShare(), now: Date.now(), suggest: suggestChannelName });
  $('shareName').value = m.name;
  const cb = $('shareReuse'); cb.disabled = !m.reuseEnabled; cb.checked = m.reuseChecked;
  $('shareReuseInfo').textContent = m.reuseEnabled ? T.shareReuseFrom(fmtSpan(m.savedAgeH) === '-' ? '' : fmtSpan(m.savedAgeH) + ' ago') : T.shareReuseNone;
  $('sharePanel').hidden = false; $('sharePanel').open = true; $('sharePanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('shareName').focus();
}
function renderChannelName() { $('qrName').textContent = shareS.name; }
// the toolbar button: sunk while sharing, and pressing it then stops the share (toast)
function shareTap() {
  const d = shareTapDecision(shareS);
  log(`share: tap -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}`);
  if (d.action === 'stop') stopShare('toolbar');
  else if (d.action === 'setup') openSharePanel();
}
async function beginShare() {
  const b = shareBegin(shareS, { typedName: $('shareName').value, reuseChecked: $('shareReuse').checked, saved: savedShare(), suggest: suggestChannelName });
  if (b.action !== 'start') { log(`share: start -> ${b.action} (${b.why})`); return; }
  try { localStorage.setItem('batray_share_name', b.name); } catch {}
  log(`share: name "${b.name}", ${b.reuse ? `reusing room ${b.reuse.room}` : 'new room'}`);
  $('sharePanel').hidden = true;
  renderLiveChip(); syncWake();
  publisher = new Publisher({ log, onState: (s) => {
    renderLiveChip(); syncWake(); watchReach(s);
    const v = viewersChange(shareS, s.viewers);
    if (v && alerts) alerts.notify('viewers', v.joined ? T.evViewerJoined : T.evViewerLeft, T.evWatching(v.viewers));
  } });
  try {
    await publisher.start(b.reuse);
    try { localStorage.setItem('batray_share_last', JSON.stringify(publisher.credentials)); } catch {}
    const st = shareStarted(shareS, { link: publisher.link, reused: publisher.reused });
    if (st.toastNewLink) toast(T.shareNewLink, 9000);
    renderChannelName();
    showQr(true);
    copyShareLink();
    // late viewers need the pack list plus info/settings: resend every 10 s
    publisher.snapshotTimer = setInterval(sendSnapshots, 10000);
    sendSnapshots();
  } catch (err) {
    log(`share failed: ${err.message}`);
    toast(T.shareFailed(err.message), 9000);
    publisher.stop(); publisher = null; shareFailed(shareS);
  } finally { renderLiveChip(); syncWake(); }
}
function sendSnapshots() {
  if (!publisher) return;
  publisher.publish(envelope('hello', { id: '*', name: '*' }, { channel: shareS.name, version: APP_VERSION }));
  const list = [...packs.values()].map((p) => ({ id: p.id, name: p.label, demo: !!p.demo, connected: p.connected }));
  publisher.publish(envelope('packs', { id: '*', name: '*' }, list));
  for (const p of packs.values()) {
    if (p.info) publisher.publish(envelope('info', p, p.info));
    if (p.settings) publisher.publish(envelope('settings', p, p.settings));
    if (p.data) publisher.publish(envelope('data', p, p.data));
  }
}
async function stopShare(why = 'chip') {
  if (!publisher) return;
  log(`share: stop (${why})`);
  clearInterval(publisher.snapshotTimer);
  const pub = publisher; publisher = null; shareStopped(shareS);
  renderLiveChip(); syncWake();
  await pub.stop();
  showQr(false); renderLiveChip();
  toast(T.shareStopped, 5000);
}
els.share.addEventListener('click', shareTap);
$('shareGo').addEventListener('click', () => beginShare().catch(() => {}));
$('shareCancel').addEventListener('click', () => { $('sharePanel').hidden = true; shareSetupCancelled(shareS); });
$('shareName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); beginShare().catch(() => {}); } });
$('viewStop').addEventListener('click', () => { if (viewer) { viewer.stop(); setStatus(() => T.viewStopped, 'bad'); $('viewStop').hidden = true; els.viewTxt.textContent = T.viewStopped; } });
els.liveStop.addEventListener('click', () => stopShare('chip'));
$('shareCopy').addEventListener('click', copyShareLink);
$('qrCopy').addEventListener('click', copyShareLink);
$('qrHide').addEventListener('click', () => showQr(false));
$('qrShow').addEventListener('click', () => showQr(true));

// ---- Viewer mode ----
function renderViewChip() {
  if (!viewer) { els.viewChip.hidden = true; return; }
  const s = viewer.state;
  els.viewChip.hidden = false;
  els.viewTxt.textContent = liveText(s, T, T.viewChip);
  $('viewStop').hidden = !(s.retryIn !== null && s.retryIn !== undefined);
}
// only the server's word counts as "reader offline"; our own socket being down is "reconnecting"
function readerGone() { return !!(viewer && viewer.state.sig && viewer.state.reader === false); }
// Internet / server reachability of THIS device, same on both sides: share-logic.js
// holds a change for REACH_HOLD_MS before it is announced (a socket reopen is not an outage).
let reachTimer = null;
function watchReach(s) {
  const d = reachEvent(reachS, s, Date.now());
  if (!d) return;
  if (d.clear) { clearTimeout(reachTimer); reachTimer = null; return; }
  clearTimeout(reachTimer);
  reachTimer = setTimeout(() => {
    reachTimer = null;
    const st = viewer ? viewer.state : (publisher ? publisher.state : null);
    const a = reachSettle(reachS, st, Date.now());
    if (!a) return;
    log(`reach: ${a.prev} -> ${a.announce}`);
    if (!alerts) return;
    if (a.announce === 'net') alerts.notify('net', T.evNetOff, T.evNetOffBody);
    else if (a.announce === 'server') alerts.notify('net', T.evServerOff, T.evServerOffBody);
    else alerts.notify('net', T.evNetOn, a.prev === 'net' ? T.evNetOnBody : T.evServerOnBody);
  }, d.hold);
}
function startView() {
  document.body.classList.add('view'); $('tabs').hidden = false; renderTabs();
  $('titleText').textContent = `BatRay by ClearEvo.com v${APP_VERSION} · ${T.viewTitle}`;
  for (const el of [els.disconnect, $('autoRe').parentElement, els.share, $('tsep')]) el.hidden = true;
  els.empty.hidden = true;
  setStatus(() => T.viewWaiting);
  viewer = new Viewer({
    room: viewMode.room, keyB64: viewMode.key, log,
    onState: (s) => {
      renderViewChip(); watchReach(s);
      for (const p of packs.values()) { p.remoteLive = s.live; }
      const ve = viewerEvent(viewS, s);           // the reader's presence: share-logic.js decides what is worth an alert
      if (ve && alerts) alerts.notify('reader', ve.readerAlert === 'on' ? T.evReaderOn : T.evReaderOff, ve.readerAlert === 'on' ? T.evReaderOnBody : T.evReaderOffBody);
      if (active) { if (!s.live) setStatus(() => (s.reader === false ? T.viewOfflineShort : T.viewReconnecting), 'bad'); else setStatus(() => T.viewingPack(active.label), 'good'); }
      refreshCard(); renderPackBar(); syncWake();
    },
    onEnvelope: (env) => {
      if (env.k === 'hello') {
        const h = viewHello(viewS, env);
        if (h) { $('viewName').textContent = h.name; $('viewName').hidden = !h.name; document.title = h.name ? `${h.name} · BatRay live` : document.title; log(`live: channel "${h.name}"${h.version ? ` (reader v${h.version})` : ''}`); }
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
      p.remoteLive = true; viewerDataSeen(viewS);
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
  const p = active;
  return buildTvModel({ label: p ? p.label : '', demo: !!(p && p.demo), data: p ? p.data : null, settings: p ? p.settings : null, iEmaV: p && p.iEma ? p.iEma.v : null, lastFrameAt: p ? p.lastFrameAt : null, now: Date.now(), cutoffPct, T });
}
function renderTv(s) {
  if (!tv || !s.live) return;
  $('tvLink').textContent = s.url;
  const v = $('tvVideo');
  // Chrome on Android plays HLS itself; desktop Chrome does not, so the preview
  // shows only where it can. Cast is offered everywhere the cast library runs.
  const canHls = !!v.canPlayType('application/vnd.apple.mpegurl');
  $('tvPreviewRow').hidden = !canHls; $('tvNoPreview').hidden = canHls;
  if (tvPreviewWanted(s, canHls, !!v.getAttribute('src'))) startPreview(v, s.url);
  const pull = s.pullAgeS === null || s.pullAgeS === undefined ? T.tvNotPulled : T.tvPulled(s.pullAgeS);
  $('tvStat').textContent = (s.error ? T.tvErr(s.error) + ' · ' : '') + T.tvStat(s.segs, Math.round(s.bytes / 1024), pull) + (s.segs < 3 ? ' · ' + T.tvStarting : '');
}
function startPreview(v, url) {
  v.src = url;
  let tries = 0;
  const kick = () => v.play().catch((e) => log(`tv preview: play refused: ${e.message}`));
  v.addEventListener('loadedmetadata', () => { log('tv preview: metadata loaded'); kick(); });
  v.addEventListener('canplay', kick, { once: true });
  v.addEventListener('error', () => {
    const err = v.error ? `${v.error.code} ${v.error.message || ''}` : '?';
    log(`tv preview: player error ${err} (try ${tries + 1})`);
    if (tv && tries++ < 5) setTimeout(() => { if (tv && $('tvVideo') === v) { v.src = url; v.load(); kick(); } }, 4000);   // the live window has grown meanwhile
  });
  kick();
}
// ---- Cast to TV: Google's cast sender library with the built-in media
// receiver (no registration, no receiver app of ours). Loaded from Google
// only when the user taps Cast, and the panel says so. Chrome's own remote
// playback for a <video> never marks an HLS source castable (Chromium keeps a
// source "incompatible until proved otherwise" and nothing proves HLS), so
// this is the path every video site uses.
const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
let castLoad = null, castWired = false;
function loadCastSdk() {
  if (window.cast && window.cast.framework) return Promise.resolve();
  if (castLoad) return castLoad;
  castLoad = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cast library did not load')), 15000);
    window.__onGCastApiAvailable = (ok, reason) => { clearTimeout(timer); if (ok) resolve(); else reject(new Error(reason || 'cast not available in this browser')); };
    const sc = document.createElement('script'); sc.src = CAST_SDK; sc.async = true;
    sc.onerror = () => { clearTimeout(timer); reject(new Error('cast library blocked or offline')); };
    document.head.appendChild(sc);
    log('cast: loading the cast library');
  }).catch((e) => { castLoad = null; throw e; });
  return castLoad;
}
function castHint(txt, disabled = false) { $('tvCastHint').textContent = txt; $('tvCast').disabled = disabled; }
// Cast picker rules live in cast-logic.js over the one `castS` object (why: a
// picker opened before Chrome finished discovering TVs never settles, and a
// second request while one is pending fails with invalid_parameter until the
// page reloads - both phones, 2026-09-20). This code loads the library, asks
// the decision functions, acts, and logs the TV's own player state.
let castWaiters = [], castPlayer = null;
function wireCastState() {
  if (castWired) return; castWired = true;
  const ctx = cast.framework.CastContext.getInstance();
  ctx.setOptions({ receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
  ctx.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e) => {
    log(`cast: state ${e.castState}`);
    const S = cast.framework.CastState;
    if (onCastStateEvent(castS, e.castState)) { for (const w of castWaiters) w(); castWaiters = []; }
    if (e.castState === S.NO_DEVICES_AVAILABLE) castHint(T.tvCastNone);
    else if (e.castState === S.NOT_CONNECTED) castHint(T.tvCastReady);
    else if (e.castState === S.CONNECTING) castHint(T.tvCastConnecting);
    else if (e.castState === S.CONNECTED) { const sess = ctx.getCurrentSession(); castHint(T.tvCastConnected(sess ? sess.getCastDevice().friendlyName : '')); }
  });
  ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e) => log(`cast: session ${e.sessionState}${e.errorCode ? ' error=' + e.errorCode : ''}`));
  castPlayer = new cast.framework.RemotePlayer();
  const pc = new cast.framework.RemotePlayerController(castPlayer);
  const E = cast.framework.RemotePlayerEventType;
  const report = (why) => {
    const sess = ctx.getCurrentSession(), ms = sess && sess.getMediaSession(), dev = sess ? sess.getCastDevice().friendlyName : '';
    const st = castPlayer.playerState || '-', idle = ms && ms.idleReason ? ms.idleReason : '';
    log(`cast: ${why} player=${st}${idle ? ' idle=' + idle : ''} loaded=${castPlayer.isMediaLoaded} t=${Math.round(castPlayer.currentTime || 0)}s${castPlayer.mediaInfo ? ' url=' + String(castPlayer.mediaInfo.contentId).slice(-40) : ''}`);
    if (castPlayer.isConnected && sess) castHint(idle === 'ERROR' ? T.tvCastTvError(dev) : T.tvCastState(dev, st));
  };
  pc.addEventListener(E.PLAYER_STATE_CHANGED, () => report('player state'));
  pc.addEventListener(E.IS_MEDIA_LOADED_CHANGED, () => report('media loaded change'));
  pc.addEventListener(E.MEDIA_INFO_CHANGED, () => report('media info change'));
}
const castDiscovery = (ms) => new Promise((ok) => { if (discoveryKnown(castS)) return ok(); const t = setTimeout(ok, ms); castWaiters.push(() => { clearTimeout(t); ok(); }); });
async function castToTv() {
  if (!tv || !tv.state.url) return;
  const loadedBeforeTap = !!(window.cast && window.cast.framework);
  castHint(T.tvCastLoading, true);
  try {
    await loadCastSdk();
    wireCastState();
    const ctx = cast.framework.CastContext.getInstance();
    const inp = () => ({ loadedBeforeTap, hasSession: !!ctx.getCurrentSession(), activationActive: navigator.userActivation ? navigator.userActivation.isActive : undefined, now: Date.now() });
    let d = castTapDecision(castS, inp());
    if (d.action === 'wait-discovery') { castHint(T.tvCastLooking, true); await castDiscovery(d.ms); d = castAfterDiscovery(castS, inp()); }
    log(`cast: tap -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}${d.ageS !== undefined ? ' ' + d.ageS + ' s' : ''} (events=${castS.events} flipped=${castS.flipped} state=${castS.castState})`);
    if (d.action === 'pending') { castHint(T.tvCastPending); return; }
    if (d.action === 'no-devices') { castHint(T.tvCastNone); return; }
    if (d.action === 'tap-again') { castHint(T.tvCastTapAgain); return; }
    if (d.action === 'request') {
      castHint(T.tvCastPick, true); castRequestStarted(castS, Date.now());
      try { await ctx.requestSession(); } finally { castRequestEnded(castS); }
    }
    const sess = ctx.getCurrentSession();
    if (!sess) throw new Error('no cast session');
    const info = new chrome.cast.media.MediaInfo(tv.state.url, 'application/x-mpegURL');
    info.streamType = chrome.cast.media.StreamType.LIVE;
    info.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.FMP4;
    info.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.FMP4;
    info.metadata = new chrome.cast.media.GenericMediaMetadata(); info.metadata.title = `BatRay · ${shareS.name || (active ? active.label : '')}`;
    const req = new chrome.cast.media.LoadRequest(info); req.autoplay = true;
    await sess.loadMedia(req);
    const dev = sess.getCastDevice ? sess.getCastDevice().friendlyName : '';
    log(`cast: load accepted by "${dev}" (${tv.state.segs} segments on the relay) - watching its player state`);
    castHint(T.tvCastConnected(dev));
    toast(T.tvCastConnected(dev), 8000);
  } catch (e) {
    const msg = e && (e.message || e.code || String(e));
    const kind = castErrorDecision(msg);
    if (kind === 'closed') { log('cast: picker closed without a choice'); castHint(T.tvCastReady); return; }
    log(`cast: ${msg}${e && e.description ? ' - ' + e.description : ''}`);
    if (kind === 'stuck') { castHint(T.tvCastStuck); toast(T.tvCastStuck, 9000); return; }
    castHint(T.tvCastFailed(msg));
    toast(T.tvCastFailed(msg), 9000);
  }
}
// every button and note of the TV card and the toolbar follow tvS (tv-logic.js)
function renderTvButtons() {
  const b = tvButtons(tvS);
  $('tv').classList.toggle('on', b.on); $('tv').setAttribute('aria-pressed', b.on); $('tv').title = b.on ? T.tvOnTitle : ($('tv').dataset.title || '');
  $('tvStart').hidden = b.startHidden; $('tvStart').disabled = b.startDisabled; $('tvStop').hidden = b.stopHidden; $('tvRes').disabled = b.resDisabled;
  $('tvLive').hidden = b.liveHidden; $('tvNote').hidden = b.noteHidden;
  $('tvPanel').hidden = b.panelHidden; if (!b.panelHidden) $('tvPanel').open = true;
}
async function startTv(opts = {}) {
  if (tv) return tv.state.url;
  const d = tvStartDecision(tvS);
  log(`tv: start -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}`);
  if (d.action !== 'start') return null;
  renderTvButtons();
  const [w, h] = (opts.res || $('tvRes').dataset.value).split('x').map(Number);
  const t = new TvStream({ width: w, height: h, model: tvModel, log, onState: renderTv, ...opts });
  tv = t;
  try {
    const url = await t.start();
    tvStarted(tvS); renderTvButtons(); castHint(T.tvCastLoads); renderTv(t.state); syncWake();
    toast(T.tvStarting, 9000);
    return url;
  } catch (e) {
    log(`tv failed: ${e.message}`); toast(e.code === 'nocodec' ? T.tvNoCodec : T.tvFailed(e.message), 9000);
    tv = null; tvStartFailed(tvS); renderTvButtons(); try { await t.stop(); } catch {}
    throw e;
  }
}
async function stopTv(why = 'card') {
  if (!tv) return;
  const t = tv; tv = null; tvStopped(tvS); renderTvButtons();
  log(`tv: stop (${why})`);
  await t.stop();
  const v = $('tvVideo'); v.removeAttribute('src'); v.load(); $('tvQr').hidden = true;
  syncWake(); toast(T.tvStopped, 5000);
}
(function () {
  const RES_LABEL = { '1280x720': '720p', '1920x1080': '1080p' };
  const setRes = (r) => { if (!RES_LABEL[r]) return; $('tvRes').dataset.value = r; $('tvRes').textContent = RES_LABEL[r]; try { localStorage.setItem('batray_tv_res', r); } catch {} };
  try { setRes(localStorage.getItem('batray_tv_res')); } catch {}
  $('tvRes').addEventListener('click', async () => { const r = await openSheet('res'); if (r) { setRes(r); log(`tv: resolution ${r}`); } });
  $('tv').dataset.title = $('tv').title; els.share.dataset.title = els.share.title;
  // the toolbar button: opens the card; sunk while streaming, and pressing it then stops the stream (toast)
  $('tv').addEventListener('click', () => {
    const d = tvTapDecision(tvS);
    log(`tv: tap -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}`);
    if (d.action === 'stop') { stopTv('toolbar'); return; }
    renderTvButtons();
    if (d.action === 'open-panel') $('tvPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('tvClose').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const d = tvCloseDecision(tvS);
    log(`tv: close -> ${d.action}`);
    if (d.action === 'stop') stopTv('close'); else renderTvButtons();
  });
  $('tvStart').addEventListener('click', () => startTv().catch(() => {}));
  $('tvStop').addEventListener('click', () => stopTv('card'));
  $('tvCast').addEventListener('click', () => castToTv());
  $('tvCopy').addEventListener('click', async () => { if (!tv) return; try { await navigator.clipboard.writeText(tv.state.url); toast(T.linkCopied, 6000); } catch { toast(T.linkCopyManual, 8000); } });
  $('tvQrBtn').addEventListener('click', () => { const c = $('tvQr'); if (!tv) return; if (c.hidden) { renderQr(tv.state.url, c); c.hidden = false; } else c.hidden = true; });
  window.addEventListener('pagehide', () => { if (tv) { const t = tv; tv = null; tvStopped(tvS); t.stop(); } });
})();
if (window.__batrayTest) Object.assign(window.__batrayTest, {
  openSharePanel, beginShare, startTv, stopTv, castToTv, tvState: () => (tv ? tv.state : null), logLines: () => logLines.slice(), logHeaderLines,
  wakeState: () => ({ lock: wakeS.held, drops: wakeS.drops, refusals: wakeS.refusals, video: wakeS.videoOn, mode: wakeS.mode }), castState: () => ({ ...castS }),
  shareState: () => ({ ...shareS }), tvUiState: () => ({ ...tvS }), connState: () => (active && active.cs ? { ...active.cs } : null),
  uiState: () => ({ ...uiS }), openSheet, closeSheet, setKeepAwake,
  tvFrame: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; drawTvFrame(c.getContext('2d'), w, h, { tick: 3, ...tvModel() }); return c.toDataURL('image/png'); },
});

// ---- UI chrome (UI_GUIDELINES.md): bottom sheet, viewer tabs, Back, low power.
// Decisions in ui-logic.js over uiS; this code paints and talks to the history API. ----
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let sheetResolve = null, suppressPop = 0;
function sheetCtx() {
  const p = active;
  return { d: p ? p.data : null, settings: p ? p.settings : null, iEmaV: p && p.iEma ? p.iEma.v : null, cutoffPct, label: p ? p.label : '', lang: langCode, liveText: viewer ? els.viewTxt.textContent : (publisher ? els.liveTxt.textContent : ''), langs: Object.keys(I18N).map((k) => ({ code: k, name: I18N[k].langName })), res: $('tvRes').dataset.value, mode: wakeS.mode };
}
/** Opens a sheet; resolves with the chosen option / action id, or null when dismissed. */
function openSheet(kind) {
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }   // a sheet over a sheet: the first one is dismissed
  const m = sheetModel(kind, sheetCtx(), T), d = sheetOpen(uiS, kind);
  $('sheetTitle').textContent = m.title;
  const lead = $('sheetLead'); lead.textContent = m.lead || ''; lead.className = 'lead' + (m.tone ? ' ' + m.tone : ''); lead.hidden = !m.lead;
  $('sheetRows').innerHTML = m.rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
  $('sheetOpts').innerHTML = m.options.map((o) => `<button type="button" data-opt="${esc(o.id)}"${o.on ? ' class="on"' : ''}>${esc(o.label)}</button>`).join('');
  $('sheetActs').innerHTML = m.actions.map((x) => `<button type="button" data-act="${esc(x.id)}" class="${x.primary ? 'demobtn' : 'linkbtn'}"${x.primary ? ' style="padding:10px 18px"' : ''}>${esc(x.label)}</button>`).join('');
  $('sheet').hidden = false; $('sheetBox').style.transform = ''; $('sheetBox').scrollTop = 0;
  if (!d.replace) history.pushState({ sheet: kind }, '');
  log(`ui: sheet ${kind}`);
  return new Promise((ok) => { sheetResolve = ok; });
}
function closeSheet(result = null, why = 'dismiss') {
  const d = sheetClose(uiS);
  if (d.action !== 'close') return;
  $('sheet').hidden = true;
  const r = sheetResolve; sheetResolve = null; if (r) r(result);
  log(`ui: sheet ${d.kind} closed (${why}${result !== null ? ': ' + result : ''})`);
  if (history.state && history.state.sheet) { suppressPop++; history.back(); }   // drop the entry the open pushed
}
(function () {
  $('sheetBack').addEventListener('click', () => closeSheet(null, 'tap outside'));
  $('sheetOpts').addEventListener('click', (e) => { const b = e.target.closest('[data-opt]'); if (b) closeSheet(b.dataset.opt, 'pick'); });
  $('sheetActs').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) closeSheet(b.dataset.act, 'action'); });
  // drag down to dismiss, like a messenger's sheet
  const box = $('sheetBox'); let y0 = null, dy = 0;
  box.addEventListener('touchstart', (e) => { if (box.scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  box.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); box.style.transform = `translateY(${dy}px)`; }, { passive: true });
  box.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; if (dy > 80) closeSheet(null, 'drag'); else box.style.transform = ''; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(null, 'escape'); });
  window.addEventListener('popstate', () => {
    if (suppressPop > 0) { suppressPop--; return; }
    const d = backDecision(uiS);
    log(`ui: back -> ${d.action}`);
    if (d.action === 'close-sheet') { $('sheet').hidden = true; const r = sheetResolve; sheetResolve = null; if (r) r(null); }
    else if (d.action === 'switch') renderTabs();
  });
  // tappable tiles: the battery, the flow, the chips, the cells
  $('gBatt').addEventListener('click', () => openSheet('soc'));
  for (const id of ['gSys', 'fPower', 'fAmps', 'fEta']) $(id).addEventListener('click', () => openSheet('flow'));
  $('strip').addEventListener('click', () => openSheet('chips'));
  $('cellsStat').addEventListener('click', () => openSheet('cells'));
  $('cells').addEventListener('click', () => openSheet('cells'));
  els.liveTxt.addEventListener('click', () => openSheet('live')); els.viewTxt.addEventListener('click', () => openSheet('live'));
  // viewer tabs
  document.querySelectorAll('[data-tab-btn]').forEach((b) => b.addEventListener('click', () => {
    const d = tabTap(uiS, b.dataset.tabBtn);
    if (d.action !== 'switch') return;
    if (history.state && history.state.tab) history.replaceState({ tab: d.tab }, ''); else history.pushState({ tab: d.tab }, '');   // one history entry for 'not on Now', so Back returns to Now once
    log(`ui: tab ${d.tab}`); renderTabs();
    $('main').scrollTop = 0;
  }));
  // low power: no decorative motion (the reader phone runs all day)
  const lp = $('lowPower');
  try { lp.checked = localStorage.getItem('batray_lowpower') === '1'; } catch {}
  const applyLow = () => { document.body.classList.toggle('lowpower', lowPowerSet(uiS, lp.checked)); };
  lp.addEventListener('change', () => { applyLow(); try { localStorage.setItem('batray_lowpower', lp.checked ? '1' : '0'); } catch {} log(`ui: low power ${lp.checked ? 'on' : 'off'}`); });
  applyLow();
})();
function renderTabs() {
  document.body.dataset.tab = uiS.tab;
  document.querySelectorAll('[data-tab-btn]').forEach((b) => b.classList.toggle('on', b.dataset.tabBtn === uiS.tab));
}

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
  if ((await openSheet('upload')) !== 'ok') { log('log upload: declined at the warning'); return; }
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
  cb.addEventListener('change', () => { try { localStorage.setItem('batray_auto_reconnect', cb.checked ? '1' : '0'); } catch {} if (!cb.checked) for (const p of packs.values()) if (!p.remote && !p.demo) connAct(p, 'auto-off'); });
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
  if (wakeS.wanted && document.visibilityState === 'visible' && (!wakeS.held || (wakeS.videoOn && keepVideo && keepVideo.paused))) syncWake();   // watchdog
  log(`hb: vis=${document.visibilityState} online=${navigator.onLine} packs=${packs.size} active=${p ? p.label : '-'} connected=${p ? p.connected : '-'} phase=${p && p.cs ? p.cs.phase : '-'} share=${shareS.phase} tv=${tvS.phase} frameAge=${age === null ? '-' : age + 's'} wake=${wakeS.held} keep=${wakeS.videoOn ? wakeS.mode : 'off'} drops=${wakeS.drops}/${wakeS.refusals} ${pub} ${vw} ${tvs}${mem}`.replace(/\s+/g, ' '));
}, 60000);
$('langBtn').addEventListener('click', async () => { const code = await openSheet('lang'); if (code && I18N[code]) { try { localStorage.setItem('batray_lang', code); } catch {} log(`language: ${code}`); applyLang(code); } });

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
