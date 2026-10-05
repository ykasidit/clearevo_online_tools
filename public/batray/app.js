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

import { castState, onCastStateEvent, discoveryKnown, castTapDecision, castAfterDiscovery, castRequestStarted, castRequestEnded, castErrorDecision, castFlowStart, castFlowPhase, castFlowEnd, castSettle, castProgress, castButtons, castStateUi, castTapAllowed, castTvUpdate, CAST_FLOW_TIMEOUT_MS, CAST_TV_WAIT_MS } from './cast-logic.js';
import { wakeState, wakeMode, wakeShouldRequest, wakeAcquired, wakeReleased, wakeRefused, wakeRetryDelayMs, wakeVideoWanted, wakeRequestStart } from './wake-logic.js';
import { JkBms, decodeCellInfo, errorLabels, hex, FRAME_CELL_INFO, linkGone } from './jkbms.js';
import { stampLines, trendProgress, fmt, fmtWh, fmtSpan as fmtSpanT, fmtRuntime as fmtRuntimeT, socLevel, flowModel, etaModel, chipList as chipListT, cellsStat, ageLabel, buildTvModel } from './view-logic.js';
import { detectBrowser, compatCheck, updateHelp, compatLogLine } from './compat-logic.js';
import { connState, connEvent, connCard, connButton, packChipState, wakeWantedByConn, knownDevice, cancelledError, CONNECT_TRIES, CONNECT_S } from './conn-logic.js';
import { shareState, shareTapDecision, shareSetupModel, shareSetupCancelled, shareBegin, shareStarted, shareFailed, shareStopped, shareButton, viewersChange, liveText, reachState, reachEvent, reachSettle, viewState, viewerEvent, viewHello, viewerDataSeen } from './share-logic.js';
import { uiState, tabTap, sheetOpen, sheetClose, backDecision, lowPowerSet, sheetModel } from './ui-logic.js';
import { tvUiState, tvTapDecision, tvCloseDecision, tvStartDecision, tvStarted, tvStartFailed, tvStopped, tvButtons, tvPreviewWanted, tvPreviewToggle, previewState, previewEvent, previewSource } from './tv-logic.js';
import { startDemo } from './demo.js';
import { I18N, detectLang } from './i18n.js';
import { Publisher, Viewer } from './live.js';
import { parseShare, envelope, suggestChannelName, parseSavedShare } from './live-logic.js';
import { initAlerts } from './alerts.js';
import { Ema } from './trend.js';
import { Flag } from './sync.js';
import { corruptDecision, historyState, dayKey, dayStartMs, rowFromReading, rowDue, rolloverDecision, nextRowId, replicaDecision, retentionDecision, quotaDecision, historySummary, transferPlan, histReqDecision, chunkB64, rxChunk, chartRange, bucketStep, seriesFromBuckets, daysNeeded, parseParams, paramTap, paramChips, PARAMS, PARAM_KEYS, HISTORY_FLUSH_MS, HEADROOM_BYTES, XFER_BACKLOG, XFER_ROWS, RANGES, trendRefreshMs } from './history-logic.js';
import { tarPack, tarParse, backupDays, backupName, BACKUP_DIR, BACKUP_MAX_BYTES } from './backup-logic.js';
import { HistoryStore } from './history.js';
import { settingsSnapshot, settingsBytes, settingsFileName, settingsFile, settingsRestorePlan, storageModel, browseItems, memoryModel, memoryParts, MEM_LOG_MS, MEM_UI_MS, MEM_MEASURE_MS } from './storage-logic.js';
import { logState, logQueue, flushPlan, flushDone, logRetention, logSummary, uploadBody, debugButtons, lastRunRecord, lastRunReport, LOG_FLUSH_MS, LOG_UPLOAD_MAX, LOG_KEY, LASTRUN_KEY } from './log-logic.js';
import { makeChart, drawChart } from './history-chart.js';
import { TvStream } from './tv.js';
import { drawTvFrame } from './tv-draw.js';

export const APP_VERSION = '0.9.68';

/** @returns {any} */
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
// The stored debug log (owner ask 2026-09-23): every line also goes to a session file in the browser's private
// storage (10 MB per file, rolled with the same session id, the newest 10 files kept), unless the user unticks
// "keep debug logs" in the History card. Decisions in the log logic module over `logS`; the history worker writes.
let logKeepPref = true; try { logKeepPref = localStorage.getItem(LOG_KEY) !== '0'; } catch {}
const logS = logState(logKeepPref);
function log(msg) {
  const line = `${new Date().toISOString().slice(11, 23)}  ${msg}`;
  logLines.push(line);
  if (logLines.length > MAX_LOG_LINES) logLines.shift();
  logQueue(logS, line);
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
    `features: secure=${yn(isSecureContext)} bluetooth=${yn(!!navigator.bluetooth)} adv=${yn(typeof BluetoothDevice !== 'undefined' && 'watchAdvertisements' in BluetoothDevice.prototype)} getDevices=${yn(!!navigator.bluetooth && typeof navigator.bluetooth.getDevices === 'function')} availability=${yn(navigator.bluetooth && navigator.bluetooth.getAvailability)} wakeLock=${yn('wakeLock' in navigator)} notifications=${typeof Notification === 'undefined' ? 'none' : Notification.permission} sw=${navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlled' : 'none'} webCodecs=${yn(typeof VideoEncoder !== 'undefined')} hls=${v.canPlayType('application/vnd.apple.mpegurl') || 'no'} remotePlayback=${yn('remote' in v)} storage=${yn(storageOk)} clipboard=${yn(!!navigator.clipboard && typeof navigator.clipboard.writeText === 'function')}`,
    `settings: autoReconnect=${$('autoRe').checked} cutoff=${cutoffPct}% keepAwake=${wakeS.mode} lowPower=${uiS.lowPower} tvRes=${$('tvRes').dataset.value} zoom=${document.body.style.zoom || '100%'} localStorage=[${lsKeys}]`,
  ];
}
// what the header cannot know synchronously: battery, codec support, adapter state
async function logEnvAsync() {
  // each probe on its own: one that never settles (getBattery in some builds) must not hold the others
  void (async () => { try { if (navigator.getBattery) { const b = await navigator.getBattery(); log(`battery: ${Math.round(b.level * 100)}% charging=${b.charging}`); b.addEventListener('levelchange', () => log(`battery: ${Math.round(b.level * 100)}%`)); b.addEventListener('chargingchange', () => log(`battery: charging=${b.charging}`)); } } catch (e) { log(`battery: ${e.message}`); } })();
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
    this.remoteLive = false; this.lastRowAt = null;              // last stored row: readings closer than MIN_ROW_MS apart are shown, not stored
    this.iEma = new Ema(60);                                 // smoothed current for the time-to-go; readings go to the stored history
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
      this.device = e.detail; this.frames = 0;
      this.plog(`gatt connected: ${this.label} id=${String(e.detail.id || '').slice(0, 10)}…`);
      connAct(this, 'gatt-connected');
      this.loadThunk = () => T.loading(this.label);
      if (this.isActive) { setStatus(() => T.connectedTo(this.label), 'good'); $('oneApp').hidden = false; $('btNote').hidden = false; }
      // Auto-reconnect no longer waits for an adapter-state probe (which this
      // Chrome lacks): the user is told once to keep Bluetooth on instead.
      if (!btWarned) { btWarned = true; toast(T.btKeepOn, 12000); }
      refreshCard(); renderPackBar(); void syncWake();
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
    b.addEventListener('device', (e) => {
      this.onInfo(e.detail);
      const key = `${e.detail.model} hw ${e.detail.hwVersion} fw ${e.detail.swVersion}`;
      if (key !== this.infoKey) { this.infoKey = key; this.plog(`device: ${key}`); }   // the BMS repeats its info every 3 s: log it once
    });
    b.addEventListener('settings', (e) => this.onSettings(e.detail));
    b.addEventListener('frame', (e) => {
      const f = e.detail, type = f[4];
      // every frame filled the 4000-line log in 11 minutes (reader log 2026-09-22): the first ten after a connect in
      // full, then one line per 200 frames with the count
      this.frames = (this.frames || 0) + 1;
      if (this.frames <= 10) this.plog(`frame type 0x${type.toString(16).padStart(2, '0')} (${f.length}B) ${hex(f.slice(0, 16))} …`);
      else if (this.frames % 200 === 0) this.plog(`frame #${this.frames} type 0x${type.toString(16).padStart(2, '0')} (${f.length}B) - ${this.frames} frames since connect`);
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
  /** at: when the reading was taken as far as this device can know - a viewer passes the relay-measured time of a retained
   *  message, so an hour-old last picture says "1 h ago", never "just now" (owner, 2026-10-01) */
  take(d, rowT = null, remoteRow = null, at = Date.now()) {
    this.data = d; this.lastFrameAt = at;
    this.readerAt = rowT || at; this.localAt = Date.now();         // the reader's clock for the reading, this device's clock on arrival
    this.iEma.push(d.current, this.lastFrameAt);
    return recordRow(this, d, rowT || this.lastFrameAt, remoteRow);   // a viewer gets the reader's stored row itself (remoteRow), so its file is a byte copy
  }
  onData(d) {
    const first = !this.lastFrameAt;
    if (first) this.plog(`first reading ${this.cs.connectedAt ? Math.round((Date.now() - this.cs.connectedAt) + '') + ' ms after connect' : ''}: soc=${d.soc} V=${d.packV} A=${d.current} cells=${d.cells.length} variant=${d.variant}`);
    const row = this.take(d);
    if (this.isActive) scheduleRender(this);
    schedulePackBar();
    if (publisher) void publisher.publish(envelope('data', this, d, row ? { r: row } : null));
    if (connEvent(this.cs, 'data').action === 'back' && this.isActive) setStatus(() => T.connectedTo(this.label), 'good');   // back after a gap: say so instead of staying amber
    if (first) void syncWake();
  }
  onInfo(i) { this.info = i; if (this.isActive) renderDevice(i); if (publisher) void publisher.publish(envelope('info', this, i)); }
  onSettings(s) { this.settings = s; if (this.isActive) renderSettings(s); if (publisher) void publisher.publish(envelope('settings', this, s)); }
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
const wakeS = wakeState('wakeLock' in navigator, !!viewMode);   // a viewer never plays the keep-awake video (owner, 2026-09-22)

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
    renderPackBar(); renderConnButton(); return;
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
  $('trendCard').hidden = true; renderTrendWait(null);
}

// The one Bluetooth button in the toolbar changes in place: Connect / Connecting (tap cancels) / Disconnect (sunk).
function renderConnButton() {
  const p = active, ble = p && p.bms && !p.demo ? p : null;
  const db = ble ? connButton(ble.cs, !!ble.bms.connected) : { on: false, busy: false, disabled: !!(p && p.remote), label: 'connect' };
  const b = els.disconnect;
  b.disabled = db.disabled; b.classList.toggle('on', db.on); b.classList.toggle('busy', db.busy); b.setAttribute('aria-pressed', db.on);
  b.querySelector('.lbl').textContent = { connect: T.btConnect, connecting: T.btConnecting, disconnect: T.disconnect }[db.label];
  b.title = db.label === 'connect' ? T.btConnectTitle : db.label === 'connecting' ? T.connBusyTitle : (b.dataset.title || '');
}
// The offline / loading / reconnect card reflects the ACTIVE pack only.
function refreshCard() {
  const p = active;
  if (!p) return;
  const body = document.body.classList;
  renderConnButton();
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
    return `<button class="pchip${p === active ? ' on' : ''}${p.connected ? '' : ' off'}" data-pack="${esc(p.id)}" title="${esc(p.label)}"><span class="pn">${p.demo ? 'DEMO' : esc(p.label)}</span>${soc ? ` <span class="ps">${soc}</span>` : ''}${I ? ` <span class="pi">${I}</span>` : ''}${st}</button>`;
  });
  const add = viewMode ? '' : `<button class="pchip add" id="addPack" title="${T.addPackTitle}">${T.addPack}</button>`;
  bar.innerHTML = chips.join('') + add;
  bar.querySelectorAll('.pchip[data-pack]').forEach((b) => b.addEventListener('click', () => { const p = packs.get(b.dataset.pack); if (p) { log(`ui: pack chip ${p.label}`); setActive(p); } }));
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
  if ($('histParams')) buildParamChips();
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { const v = T[el.dataset.i18nAria]; if (typeof v === 'string') { el.setAttribute('aria-label', v); el.title = v; } });
  renderServerNote();
  $('fSysLbl').textContent = T.system;
  setStatus(statusThunk, statusKind);
  if (active) { if (active.info) renderDevice(active.info); if (active.settings) renderSettings(active.settings); if (active.data) render(active.data, true); }
  refreshCard(); renderPackBar(); renderLiveChip(); renderViewChip(); renderConnButton();
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
  log(`keep-awake video: ${wakeS.mode}`); void syncKeepAwake();
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
  // eslint-disable-next-line house/ui-after-await -- wakeS is the one wake state; this paints it as it stands after the play() attempt
  $('wakeVideo').hidden = !wakeS.videoOn;
}
function scheduleWakeRetry() {
  if (wakeRetryTimer) return;
  wakeRetryTimer = setTimeout(() => { wakeRetryTimer = null; if (wakeS.wanted && document.visibilityState === 'visible') void syncWake(); }, wakeRetryDelayMs(wakeS));
}
async function syncWake() {
  wakeS.wanted = [...packs.values()].some((p) => wakeWantedByConn(p.cs, p.connected)) || shareS.phase === 'on' || shareS.phase === 'starting' || !!(viewer && viewer.state.live) || tvS.phase === 'on';
  const el = $('wake');
  if (wakeShouldRequest(wakeS, document.visibilityState === 'visible')) {
    wakeRequestStart(wakeS);                                                // one request in flight: a second call meanwhile asks nothing (wake-logic ownership rule)
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
        void syncKeepAwake();
      });
      log('screen wake lock acquired');
    } catch (err) {
      const r = wakeRefused(wakeS, document.visibilityState === 'visible' && !/not visible/i.test(err.message));
      log(`screen wake lock refused${r === 'hidden' ? ' while the tab was not in front (not counted)' : ` (${wakeS.refusals})`}: ${err.name} ${err.message}`);
      scheduleWakeRetry();
    }
  } else if (!wakeS.wanted && wakeLock) {
    try { await wakeLock.release(); } catch { /* already gone */ }
    wakeLock = null; wakeS.held = false;
  }
  el.hidden = !wakeLock;
  await syncKeepAwake();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeS.wanted) void syncWake(); });

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
  const step = mode === 'portrait' ? 14 : 12;                       // the stamp lines sit under 'updated', one per line, smaller
  for (const [id, xy] of [['fPower', L.power], ['fAmps', L.amps], ['fEta', L.eta], ['updated', L.upd], ['updR', [L.upd[0], L.upd[1] + step]], ['updL', [L.upd[0], L.upd[1] + 2 * step]]]) { $(id).setAttribute('x', xy[0]); $(id).setAttribute('y', xy[1]); }
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
  if (active && active.data) renderFlow(active.data);           // the cut-off line on the battery and on the chart
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

// ---- stored history: SQLite, one database per UTC day, the live day included
// (owner decision 2026-09-24: no NDJSON, no gz). Readings are queued and
// inserted every HISTORY_FLUSH_MS in one transaction; nothing stays in memory
// but that queue and the last chart. The history logic module decides, the
// store (history.js) talks to the worker with a deadline on every call and
// counts them, this block queues, flushes, keeps the day's id counter, draws
// from bucket queries and logs what happened. ----
const histS = historyState();
const hist = new HistoryStore({ log });
hist.onBackend = (name) => { histS.backend = name; renderStorage(); if (name === 'memory') void explainLockOut(); };   // memory-only after a locked pool: the Storage box says so
const histMem = { pending: new Map(), plot: null, plotParams: '', cursorIdx: null, series: null, drawAt: 0, drawing: false, redraw: false, spanAt: 0, demoId: 0 };
const utf8 = new TextEncoder();
function pendingRows() { let n = 0; for (const l of histMem.pending.values()) n += l.length; return n; }
function queueRow(row, day = dayKey(row.t)) { const l = histMem.pending.get(day) || []; l.push(row); histMem.pending.set(day, l); }
/** Which databases hold a pack's rows: the DEMO pack lives in the worker's in-memory database, never on disk. */
const daysFor = (p, from, to) => (p.demo ? ['demo'] : daysNeeded(histS.days, from, to));
/** One reading -> one stored row. The reader numbers its rows (dense ids per day); a viewer stores the reader's
 *  row under the reader's id and asks for the ones it missed. DEMO readings and remote readings without a row
 *  (the 10 s snapshot resend) are never stored. */
function recordRow(p, d, t, remoteRow = null) {
  if (p.remote && !remoteRow) return null;
  if (p.demo) {                                                          // a demo trend from every frame, in the worker's memory database: never a file that looks like a real bank
    const row = rowFromReading(p.label, d, t); row.id = ++histMem.demoId; queueRow(row, 'demo'); return null;
  }
  const day = dayKey(t);
  if (!histS.day || day > histS.day) {                                   // a new UTC day: ids start again at 1 in its database
    const ro = rolloverDecision(histS, day);
    log(`history: ${ro.action} ${ro.day}`);
    if (ro.action === 'rollover') void flushHistory().then(maintainHistory);
  }
  if (p.remote) {
    const row = remoteRow;
    const rd = replicaDecision(histS, row, histS.day);
    if (rd.action === 'old' || rd.action === 'mem') { if (rd.action === 'mem') log(`history: a live row without an id (${rd.why}): not stored`); return null; }
    if (rd.action === 'gap') {
      if (!histS.gap) log(`history: live row ${row.id} arrived but this copy is complete only to ${rd.expected - 1}: stored, asking the reader for the rest`);
      histS.gap = 'gap';
      if (viewer && histReqDecision(histS, { live: viewer.state.live, now: Date.now(), gap: true }).action === 'request') void requestHistory();
    }
    if (!rd.dup) { queueRow(row); histS.todayRows = Math.max(histS.todayRows, row.id); }
    return row;
  }
  // a JK BMS pushes cell frames 2-3 times a second by itself: the meters show every frame, the store keeps one
  // row per pack every MIN_ROW_MS
  if (!rowDue(p.lastRowAt, t)) return null;
  p.lastRowAt = t;
  const row = rowFromReading(p.label, d, t); row.id = nextRowId(histS);
  queueRow(row);
  return row;
}
let histFlushing = false;
/** The queue into the day databases, one insert per day. A failed insert keeps its rows for the next flush
 *  (bounded); the store has already logged why. */
async function flushHistory() {
  if (histFlushing || !histMem.pending.size) return;
  histFlushing = true;
  const batch = histMem.pending; histMem.pending = new Map();
  try {
    if (hist.persistent === null) { const ok = await hist.persist(); histS.persistent = ok; log(`history: ${hist.backend}, persistent=${ok}`); }
    for (const [day, rows] of batch) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await hist.insert(day, rows);
          if (r.ignored && !viewer) log(`history: ${r.ignored} of ${rows.length} rows for ${day} were already stored`);
          break;
        } catch (e) {
          if (isCorrupt(e)) { await corruptDb(e, 'live write', rows); break; }
          if (e.name === 'QuotaExceededError' && attempt === 0) {           // full: the oldest past day goes, then one more try
            const q = quotaDecision(await hist.days().catch(() => histS.days), histS.day);
            log(`history: quota exceeded -> ${q.action} ${q.day || ''}`);
            if (q.action === 'delete') { await hist.remove(q.day).catch(() => {}); continue; }
          }
          const l = histMem.pending.get(day) || []; histMem.pending.set(day, rows.concat(l).slice(-5000)); break;
        }
      }
    }
  } finally { histFlushing = false; }
  if (active && !$('trendCard').hidden) scheduleDraw(false);   // the throttle decides (half a bucket at least): a 7-day window is not re-queried every 10 s
}
setInterval(flushHistory, HISTORY_FLUSH_MS);
// Leaving the page (a reload, a navigation, the back/forward cache): everything here is synchronous, because the
// page may be frozen before any await resumes. The rows still queued go to localStorage (a few KB) and are
// inserted at the next start; the worker is stopped at once so its OPFS access handles die with it and the next
// page (or another tab) can take the pool. A page back from the back/forward cache starts a fresh worker on its
// next call. Not SQLite's pauseVfs(): that crashed the renderer under the cache in the sandbox (2026-09-24).
const SPILL_KEY = 'batray_hist_spill';
function spillPending() {
  const rows = []; for (const [day, l] of histMem.pending) for (const r of l) if (day !== 'demo') rows.push(r);
  histMem.pending = new Map();
  if (!rows.length) return 0;
  try { const prev = JSON.parse(localStorage.getItem(SPILL_KEY) || '[]'); localStorage.setItem(SPILL_KEY, JSON.stringify(prev.concat(rows).slice(-2000))); } catch { /* no room: those rows are lost */ }
  return rows.length;
}
async function unspill() {
  let rows = []; try { rows = JSON.parse(localStorage.getItem(SPILL_KEY) || '[]'); localStorage.removeItem(SPILL_KEY); } catch { /* nothing spilled */ }
  if (!rows.length) return;
  const byDay = new Map(); for (const r of rows) { if (!r || typeof r.t !== 'number') continue; const d = dayKey(r.t); byDay.set(d, (byDay.get(d) || []).concat([r])); }
  let n = 0; for (const [d, rs] of byDay) { try { n += (await hist.insert(d, rs)).inserted; } catch { /* logged by the store */ } }
  log(`history: ${n} of ${rows.length} rows queued when the last page was left are now stored`);
}
window.addEventListener('pagehide', () => { const n = spillPending(); hist.release(); if (n) log(`history: ${n} queued rows kept for the next start`); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushHistory(); });
/** Delete beyond the free-space headroom, refresh the listing and the summary line. */
/** A corrupt day database (owner rule 2026-09-24, no repair at this stage): the worker closed it, named the day
 *  and raised; here the caller decides. `where` is 'live write' (the flush: today's file is deleted, a new one
 *  starts and the flush's rows go into it) or 'history read' (the file is deleted; today's counters start over). */
const isCorrupt = (e) => !!(e && e.name === 'CorruptError' && e.day);
async function corruptDb(e, where, rows) {
  const day = e.day, d = corruptDecision(day, histS.day);
  log(`history: ${where}: ${day} database is corrupt -> ${d.action}: ${d.live ? 'deleted, a new live file starts' : 'deleted'}`);
  toast(d.live ? T.histCorruptLive : T.histCorruptDay(day), 10000);
  try { await hist.remove(day); } catch (e2) { log(`history: could not delete ${day}: ${e2.message}`); }
  if (d.live) { histS.todayRows = 0; histS.nextId = 1; histS.contig = 0; histS.gap = null; }
  histMem.series = null;
  if (d.live && rows && rows.length) {
    try {
      if (!viewer) for (const r of rows) r.id = nextRowId(histS);                // the reader numbers its new file from 1; a viewer keeps the reader's ids
      const r = await hist.insert(day, rows); const info = await hist.info(day);
      histS.todayRows = info.rows; histS.nextId = info.maxId + 1; histS.contig = info.contig;
      log(`history: ${r.inserted} rows written into the new ${day}.sqlite`);
    } catch (e3) { log(`history: rows for the new ${day}.sqlite failed: ${e3.message}`); }
  }
  try { histS.days = await hist.days(); } catch { histS.days = histS.days.filter((x) => x.day !== day); }
  // eslint-disable-next-line house/ui-after-await -- paints histS as it stands; corruptDb is the only writer of today's counters while it runs
  renderStorage(); if (active) renderTrend(active);
}
async function maintainHistory() {
  try {
    const est = await hist.estimate(); histS.usage = est.usage; histS.quota = est.quota;
    const d = retentionDecision(await hist.days(), dayKey(Date.now()), { usage: est.usage, quota: est.quota });
    for (const f of d.delete) { await hist.remove(f.day); log(`history: deleted ${f.day} (${f.bytes} B): under ${Math.round(HEADROOM_BYTES / 1048576)} MB free`); }
    histS.days = await hist.days();
    if (d.delete.length) { const e2 = await hist.estimate(); histS.usage = e2.usage; histS.quota = e2.quota; }
  } catch (e) { if (isCorrupt(e)) await corruptDb(e, 'history read'); /* else the store logged it */ }
  // eslint-disable-next-line house/ui-after-await -- paints histS as it stands after maintenance (single writer)
  renderHistNote();
}
/** Start: today's counters come from its database, so ids continue exactly where the last session stopped. */
// The page whose worker holds the SQLite pool also holds a Web Lock for as long as it lives, so a page that cannot
// take the pool can tell the two cases apart: another BatRay tab on this device (close it, reload), or a worker
// killed mid-write whose files Chrome has not released yet (reload later). 2026-10-04 viewer log: 40 tries, memory.
const HIST_LOCK = 'batray-history';
async function holdHistoryLock() {
  if (!navigator.locks) return;
  try { await navigator.locks.request(HIST_LOCK, { mode: 'exclusive', ifAvailable: true }, (lock) => (lock ? new Flag().wait(true) : null)); } catch { /* lock API refused: nothing to hold */ }
}
async function explainLockOut() {
  let other = false;
  try { const q = navigator.locks ? await navigator.locks.query() : null; other = !!(q && q.held && q.held.some((l) => l.name === HIST_LOCK)); } catch { /* unknown */ }
  log(other ? 'history: another BatRay tab on this device holds the history store - close it, then reload this page' : 'history: no other BatRay tab holds the store - a worker ended mid-write keeps its files until Chrome releases them; reload later');
  if (other) toast(T.histOtherTab, 12000);
}
async function initHistory() {
  histS.backend = await hist.ready;
  if (histS.backend === 'opfs') void holdHistoryLock(); else if (histS.backend === 'memory') void explainLockOut();
  const now = Date.now(), today = dayKey(now);
  histS.day = today;
  try {
    const old = await hist.oldFiles();                                        // before 0.9.40: NDJSON, not read, not migrated (owner: day 0)
    if (old.files) log(`history: ${old.files} day file${old.files === 1 ? '' : 's'} from before 0.9.40 (${Math.round(old.bytes / 1048576)} MB, NDJSON) are not read any more; Clear stored history removes them`);
    await unspill();
    histS.days = await hist.days();
    const info = await hist.info(today);
    histS.todayRows = info.rows; histS.nextId = info.maxId + 1; histS.contig = info.contig;
    const sum = historySummary(histS.days, histS.todayRows, { usage: histS.usage, quota: histS.quota, today });
    log(`history: ${histS.backend}, ${sum.days} days, ${Math.round(sum.bytes / 1024)} KB, oldest ${sum.oldest || '-'}, today ${info.rows} rows (highest id ${info.maxId}, complete to ${info.contig})`);
  } catch (e) { if (isCorrupt(e)) await corruptDb(e, 'history read'); else log(`history: load failed: ${e.message}`); }
  await maintainHistory();
  if (active) renderTrend(active);
}
// ---- backup: one .tar of the day databases (7-Zip / Windows 11 / tar open the tar, DB Browser for SQLite, Python
// or DuckDB open each .sqlite); restore merges every day in the archive into this device's copy ----
async function backupHistory() {
  await flushHistory();
  const files = [];
  for (const d of await hist.days()) { const bytes = await hist.exportDay(d.day); if (bytes) files.push({ day: d.day, bytes }); }
  if (!files.length) { toast(T.histNothing, 5000); return null; }
  const tar = tarPack(files.map((f) => ({ name: `${BACKUP_DIR}${f.day}.sqlite`, bytes: f.bytes })));
  if (tar.length > BACKUP_MAX_BYTES) { toast(T.histTooBig(fmtSize(BACKUP_MAX_BYTES)), 9000); log(`history: backup too big (${tar.length} B)`); return null; }
  const name = backupName(dayKey(Date.now()));
  log(`history: backup ${name}: ${files.length} days, ${tar.length} B`);
  const url = URL.createObjectURL(new Blob([tar], { type: 'application/x-tar' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { name, bytes: tar.length, days: files.length };
}
async function restoreHistory(bytes, from = 'file') {
  let days;
  try { days = backupDays(tarParse(bytes)); } catch (e) { toast(T.histRestoreBad, 8000); log(`history: restore (${from}) failed: ${e.message}`); return null; }
  if (!days.length) { toast(T.histRestoreBad, 8000); log(`history: restore (${from}): no day databases in the archive`); return null; }
  await flushHistory();
  let written = 0, failed = 0;
  for (const d of days) {
    try { const r = await hist.importDay(d.day, d.bytes); written++; log(`history: restored ${d.day}: ${r.rows} rows ${r.merged ? 'merged into this device\'s copy' : 'as a new day'}`); }
    catch (e) { failed++; }
  }
  histS.days = await hist.days();
  const info = await hist.info(histS.day).catch(() => null);
  if (info) { histS.todayRows = info.rows; histS.nextId = Math.max(histS.nextId, info.maxId + 1); histS.contig = info.contig; }
  await maintainHistory();
  toast(T.histRestored(written, failed), 8000);
  histMem.series = null; if (active) renderTrend(active);
  return { written, skipped: 0, failed };
}
$('histBackup').addEventListener('click', () => backupHistory().catch((e) => { log(`history: backup failed: ${e.message}`); toast(T.histRestoreBad, 6000); }));
$('histRestore').addEventListener('click', () => $('histFile').click());
$('histFile').addEventListener('change', async () => {
  const f = $('histFile').files[0]; $('histFile').value = '';
  if (!f) return;
  if (f.size > BACKUP_MAX_BYTES) { toast(T.histTooBig(fmtSize(BACKUP_MAX_BYTES)), 9000); return; }
  restoreHistory(new Uint8Array(await f.arrayBuffer()), f.name).catch((e) => log(`history: restore failed: ${e.message}`));
});
async function clearHistory() {
  histMem.pending = new Map();
  try { const r = await hist.clear(); log(`history: cleared (${r.removed} day databases)`); } catch (e) { /* logged by the store */ }
  histS.days = []; histS.todayRows = 0; histS.nextId = 1; histS.contig = 0; histS.gap = null; histS.spanFirst = null; histS.spanLast = null; histMem.series = null;
  toast(T.histCleared, 5000);
  if (active) { renderTrend(active); if ($('trendCard').hidden) renderHistNote(); }
}
// ---- stored debug log I/O (the decisions are in the log logic module) ----
let logFlushing = false;
async function flushLog() {
  if (logFlushing || histS.backend === 'none') return;
  const plan = flushPlan(logS, Date.now()); if (plan.action !== 'write') return;
  logFlushing = true;
  const lines = logS.pending, text = (plan.roll ? logHeaderLines().join('\n') + '\n---\n' : '') + lines.join('\n') + '\n';
  try {
    const r = await hist.logAppend(plan.file, text);
    flushDone(logS, plan.file, r.bytes, text.length);
    // eslint-disable-next-line house/ui-after-await -- paints the file list just read; flushLog is single-flight (logFlushing)
    if (plan.roll) { logS.files = await hist.logList(); for (const f of logRetention(logS.files, logS.filesMax)) { await hist.logRemove(f.name); } logS.files = await hist.logList(); renderLogNote(); }
  } catch (e) { logS.pending = []; logS.pendBytes = 0; if (!logS.failedOnce) { logS.failedOnce = true; console.warn('debug log write failed', e); } }
  finally { logFlushing = false; }
}
setInterval(flushLog, LOG_FLUSH_MS);
window.addEventListener('pagehide', () => { void flushLog(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushLog(); });
async function initLogStore() {
  logS.backend = await hist.ready;
  try { logS.files = await hist.logList(); } catch { logS.files = []; }
  const sum = logSummary(logS.files);
  log(`debug log: ${logS.on ? 'kept on this device' : 'not kept (opted out)'}, ${sum.files} files, ${Math.round(sum.bytes / 1024)} KB, session ${logS.sid}`);
  // eslint-disable-next-line house/ui-after-await -- start-up paint of the list just read
  renderLogNote(); renderDebugButtons();
}
function setLogKeep(on) {
  logS.on = !!on; try { localStorage.setItem(LOG_KEY, on ? '1' : '0'); } catch {}
  // the same choice covers Chrome's crash report: the site strips the Reporting-Endpoints header when this cookie says 0
  try { document.cookie = `batray_debuglog=${on ? '1' : '0'}; Path=/batray/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* */ }
  if (!on) { logS.pending = []; logS.pendBytes = 0; }
  log(`debug log: ${on ? 'kept on this device from now on' : 'no longer kept on this device'}`);
  if (on) { logS.file = null; logS.fileBytes = 0; }          // a fresh file for the rest of this session
  renderLogNote(); renderDebugButtons();
}
function renderDebugButtons() {
  const b = debugButtons(logS.on);
  for (const id of ['copy', 'upload', 'copy2', 'upload2']) { const el = $(id); if (!el) continue; el.disabled = b.disabled; el.title = b.disabled ? T.debugOffTitle : (el.dataset.title || el.title); if (!el.dataset.title && !b.disabled) el.dataset.title = el.title; }
}
async function downloadLogs() {
  await flushLog();
  const files = await hist.logAllGz();
  if (!files.length) { toast(T.logNothing, 5000); return null; }
  const tar = tarPack(files.map((f) => ({ name: `batray-logs/${f.name}`, bytes: f.bytes })));
  const name = `batray-logs-${dayKey(Date.now())}.tar`;
  log(`debug log: download ${name}: ${files.length} files, ${tar.length} B`);
  const url = URL.createObjectURL(new Blob([tar], { type: 'application/x-tar' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { name, files: files.length, bytes: tar.length };
}
async function clearLogs() {
  logS.pending = []; logS.pendBytes = 0; logS.file = null; logS.fileBytes = 0; logS.sessionBytes = 0;
  try { const r = await hist.logClear(); logS.files = []; log(`debug log: deleted (${r.removed} files)`); } catch (e) { log(`debug log: delete failed: ${e.message}`); }
  // eslint-disable-next-line house/ui-after-await -- paints the emptied list
  toast(T.logCleared, 5000); renderLogNote();
}
// ---- memory line + the last-run record (owner ask 2026-09-23): every 15 s the tab's heap use goes to the card, to
// the log, and into localStorage with what the app was doing; pagehide marks it clean. A start that finds an
// unclean record says so at the top of the new log (Chrome gives no tombstone of its own).
function appState() {
  const p = active; const parts = [];
  parts.push(p ? `${p.demo ? 'demo' : p.remote ? 'viewer' : 'reader'} ${p.connected ? 'connected' : 'not connected'}` : 'no pack');
  if (shareS.phase !== 'off') parts.push(`sharing ${shareS.phase}`); if (viewer) parts.push(`viewing live=${viewer.state.live}`); if (tvS.phase !== 'off') parts.push(`tv ${tvS.phase}`);
  return parts.join(', ');
}
// Live only on a cross-origin isolated page (the site sends COOP/COEP for /batray/): there performance.memory is
// precise and measureUserAgentSpecificMemory() gives the whole tab, worker included. Elsewhere Chrome hands out a
// figure refreshed every ~20 min (the owner's phone said 10 MB with 327k rows), and the line says so.
let memMeasured = null;
const memPrecise = () => !!window.crossOriginIsolated;
function memModel() { return memoryModel(performance.memory, { precise: memPrecise(), measured: memMeasured }); }
function renderMemory(m) {
  const el = $('memUse'); if (!el) return;
  const parts = memoryParts(m, { ...T, fmtSize });
  el.textContent = m ? `${T.memUse(fmtSize(m.used), fmtSize(m.limit), m.pct, pendingRows())}${parts ? ` (${parts})` : ''}${m.precise ? '' : ` · ${T.memCoarse}`}${m.near ? ` · ${T.memNear}` : ''}` : T.memNone;
  el.classList.toggle('warn', !!(m && m.near));
}
async function memMeasure() {
  if (!memPrecise() || typeof performance.measureUserAgentSpecificMemory !== 'function') return;
  // eslint-disable-next-line house/ui-after-await -- paints the measurement just taken
  try { const r = await performance.measureUserAgentSpecificMemory(); memMeasured = { bytes: r.bytes, breakdown: r.breakdown, at: Date.now() }; renderMemory(memModel()); }
  catch (e) { log(`mem: measure failed: ${e.message}`); }
}
function writeLastRun(clean) {
  const m = memModel();
  try { localStorage.setItem(LASTRUN_KEY, JSON.stringify(lastRunRecord({ sid: logS.sid, now: Date.now(), mem: m, rows: pendingRows(), state: appState(), file: logS.file, clean }))); } catch { /* no storage */ }
  return m;
}
function memTick() {
  const m = writeLastRun(false);
  renderMemory(m);
  if (m) log(`mem: used=${Math.round(m.used / 1048576)}MB total=${Math.round(m.total / 1048576)}MB limit=${Math.round(m.limit / 1048576)}MB pct=${m.pct}${m.near ? ' NEAR THE LIMIT' : ''} rows=${pendingRows()} log=${logLines.length} precise=${m.precise ? 'yes' : 'no'}${m.parts ? ` measured=${Math.round(m.used / 1048576)}MB(${Object.entries(m.parts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${Math.round(v / 1048576)}`).join(', ')}MB)` : ''}`);
}
setInterval(memTick, MEM_LOG_MS);
setInterval(() => renderMemory(memModel()), MEM_UI_MS);
setInterval(memMeasure, MEM_MEASURE_MS);
setTimeout(memMeasure, 3000);
window.addEventListener('pagehide', () => { if (!(window.__batrayTest && window.__batrayTest.skipLastRun)) writeLastRun(true); });
/** Right after the header lines: what the previous run last reported, then this run's first record. */
function logLastRun() {
  let prev = null; try { prev = JSON.parse(localStorage.getItem(LASTRUN_KEY) || 'null'); } catch { /* no record */ }
  const nav = performance.getEntriesByType ? (performance.getEntriesByType('navigation')[0] || {}).type : '';
  const report = lastRunReport(prev, Date.now(), { wasDiscarded: !!document.wasDiscarded, navType: nav });
  if (report) for (const line of report) log(line);
  else log(`first start on this device (this start: ${nav || 'navigate'})`);
  writeLastRun(false);
  renderMemory(memModel());
  log(`mem: ${memPrecise() ? 'page is cross-origin isolated: figures are live' : 'page is NOT cross-origin isolated: Chrome refreshes performance.memory only every ~20 min'}`);
}
$('logKeep').addEventListener('change', () => setLogKeep($('logKeep').checked));
$('logDownload').addEventListener('click', () => downloadLogs().catch((e) => log(`debug log: download failed: ${e.message}`)));
$('logClear').addEventListener('click', async () => { const a = await openSheet('clearLogs'); if (a === 'ok') await clearLogs(); });
function fmtSize(b) { return b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }   // hoisted: used by the startup blocks above
function histSum() { return historySummary(histS.days, histS.todayRows, { usage: histS.usage, quota: histS.quota, today: histS.day }); }
function settingsEntries() { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.push([k, localStorage.getItem(k)]); } } catch { /* no storage */ } return out; }
/** The Storage box under the chart (owner ask 2026-09-23): used of the maximum with a percent, one row per eater. */
function renderStorage() {
  const hs = histSum(), snap = settingsSnapshot(settingsEntries()), ls = logSummary(logS.files);
  const m = storageModel({ usage: histS.usage, quota: histS.quota, backend: histS.backend, hist: { bytes: hs.bytes, days: hs.days, oldest: hs.oldest }, settings: { bytes: settingsBytes(snap), count: Object.keys(snap).length }, logs: { bytes: ls.bytes, files: ls.files, session: logS.sessionBytes + logS.pendBytes, sid: logS.sid } });
  $('stUse').textContent = m.max ? T.stUse(fmtSize(m.used), fmtSize(m.max), m.pct) : T.stUnknown;
  const [h, st, lg] = m.rows;
  $('stHistSize').textContent = !m.stored ? T.histNoStore : h.days ? `${fmtSize(h.bytes)} · ${T.stHistInfo(h.days, h.since)}` : T.stNone;
  $('stSetSize').textContent = st.count ? `${fmtSize(st.bytes)} · ${T.stSetInfo(st.count)}` : T.stNone;
  $('stLogSize').textContent = !m.stored ? T.logNoStore : lg.files ? `${fmtSize(lg.bytes)} · ${T.stLogInfo(lg.files, fmtSize(lg.session), lg.sid)}` : T.stNone;
  $('histBackup').hidden = !h.canBackup; $('histRestore').hidden = !h.canRestore; $('histClear').hidden = !h.canDelete;
  $('setBackup').hidden = !st.canBackup; $('setReset').hidden = !st.canDelete;
  $('logDownload').hidden = !lg.canBackup; $('logClear').hidden = !lg.canDelete;
  $('logKeep').checked = logS.on;
  $('histNote').textContent = T.histNote(Math.round(HEADROOM_BYTES / 1048576));
}
const renderHistNote = renderStorage, renderLogNote = renderStorage;
// settings: a small .json out, checked before it goes back in; reset through a sheet; both reload the page
function backupSettings() {
  const snap = settingsSnapshot(settingsEntries());
  if (!Object.keys(snap).length) { toast(T.setNothing, 5000); return null; }
  const name = settingsFileName(dayKey(Date.now()));
  const text = JSON.stringify(settingsFile(snap, APP_VERSION, new Date().toISOString()), null, 1);
  log(`settings: backup ${name}: ${Object.keys(snap).length} values`);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { name, count: Object.keys(snap).length };
}
async function restoreSettings(text, from = 'file') {
  let obj = null; try { obj = JSON.parse(text); } catch { /* below */ }
  const plan = settingsRestorePlan(obj);
  if (!plan.ok) { toast(T.setBad, 8000); log(`settings: restore (${from}) refused: ${plan.why}`); return null; }
  try { for (const [k, v] of Object.entries(plan.apply)) localStorage.setItem(k, v); } catch (e) { log(`settings: restore failed: ${e.message}`); return null; }
  const n = Object.keys(plan.apply).length;
  log(`settings: restored ${n} values (${plan.skipped} skipped) - reloading`);
  toast(T.setRestored(n), 4000);
  if (!window.__batrayTest) setTimeout(() => location.reload(), 1500);
  return { restored: n, skipped: plan.skipped };
}
async function resetSettings() {
  const snap = settingsSnapshot(settingsEntries());
  try { for (const k of Object.keys(snap)) localStorage.removeItem(k); } catch { /* */ }
  log(`settings: reset ${Object.keys(snap).length} values - reloading`);
  toast(T.setReset, 4000);
  if (!window.__batrayTest) setTimeout(() => location.reload(), 1500);
  return Object.keys(snap).length;
}
// Browse: one engine for the three kinds of storage - the list comes from the store, the sheet shows it, Delete removes one
const browseS = { type: null, items: [], sizeText: '' };
async function browseData(type) {
  if (type === 'hist') { histS.days = await hist.days().catch(async (e) => { if (isCorrupt(e)) await corruptDb(e, 'history read'); return histS.days; }); return browseItems('hist', { days: histS.days, today: histS.day }); }
  if (type === 'set') return browseItems('set', { snapshot: settingsSnapshot(settingsEntries()) });
  logS.files = await hist.logList().catch(() => logS.files); return browseItems('log', { files: logS.files, current: logS.file });
}
async function refreshBrowse() {
  const items = await browseData(browseS.type);
  browseS.items = items.map((i) => ({ ...i, sizeText: fmtSize(i.bytes) })); browseS.sizeText = fmtSize(items.reduce((a, i) => a + i.bytes, 0));
}
async function openBrowse(type) {
  browseS.type = type; await refreshBrowse();
  log(`browse: ${type} (${browseS.items.length} items)`);
  await openSheet('browse');
  // eslint-disable-next-line house/ui-after-await -- the sheet has closed; the Storage box shows what is stored now
  renderStorage();
}
async function browseDelete(id) {
  const t = browseS.type;
  if (t === 'hist') { await flushHistory(); await hist.remove(id); histMem.series = null; if (id === histS.day) { histS.todayRows = 0; histS.nextId = 1; histS.contig = 0; histS.gap = null; histMem.pending.delete(id); } }
  else if (t === 'set') { try { localStorage.removeItem(id); } catch { /* */ } }
  else { if (id === logS.file) { logS.pending = []; logS.pendBytes = 0; logS.file = null; logS.fileBytes = 0; } await hist.logRemove(id); }
  log(`browse: deleted ${t} ${id}`);
  // eslint-disable-next-line house/ui-after-await -- updateSheet() re-checks that the open sheet is still the browse sheet
  await refreshBrowse(); updateSheet('browse'); renderStorage();
  if (t === 'hist' && active) renderTrend(active);
}
$('histBrowse').addEventListener('click', () => openBrowse('hist'));
$('setBrowse').addEventListener('click', () => openBrowse('set'));
$('logBrowse').addEventListener('click', () => openBrowse('log'));
$('setBackup').addEventListener('click', () => backupSettings());
$('setRestore').addEventListener('click', () => $('setFile').click());
$('setFile').addEventListener('change', async () => { const f = $('setFile').files[0]; $('setFile').value = ''; if (!f) return; if (f.size > 1048576) { toast(T.setBad, 6000); return; } restoreSettings(await f.text(), f.name).catch((e) => log(`settings: restore failed: ${e.message}`)); });
$('setReset').addEventListener('click', async () => { const a = await openSheet('resetSettings'); log(`settings: reset -> ${a}`); if (a === 'ok') await resetSettings(); });
// past days for the 7 d / all ranges: read once, thinned to a row a minute, cached per day
/** How much of the active pack is stored in the last 24 h (for the "collecting" bar): asked of the store every
 *  5 s while the card waits, plus what is still queued. */
function refreshSpan(p) {
  const now = Date.now(); if (now - histMem.spanAt < 5000 || !p) return; histMem.spanAt = now;
  void hist.span(p.label, now - 86400e3, p.demo ? ['demo'] : undefined).then((r) => { histS.spanFirst = r.first; histS.spanLast = r.last; }).catch((e) => { if (isCorrupt(e)) void corruptDb(e, 'history read'); });
}
function spanForWait(p) {
  let first = histS.spanFirst, last = histS.spanLast;
  for (const rows of histMem.pending.values()) for (const r of rows) if (r.p === p.label) { if (first === null || r.t < first) first = r.t; if (last === null || r.t > last) last = r.t; }
  return first === null || last === null ? 0 : last - first;
}
// while the history has too little to draw, say so with a bar instead of a blank History tab (owner, 2026-09-20)
function renderTrendWait(p) {
  const pr = trendProgress(p ? spanForWait(p) : 0, !!(p && p.data));
  const w = $('trendWait'); w.hidden = pr.ready;
  if (pr.ready) return pr;
  refreshSpan(p);
  $('trendWaitTxt').textContent = pr.waiting ? T.trendWaitNone : T.trendWait(pr.haveS, pr.needS);
  $('trendWaitBar').style.width = `${pr.pct}%`;
  return pr;
}
let trendRaf = 0;
function renderTrend(p) {
  const card = $('trendCard');
  if (!renderTrendWait(p).ready) { card.hidden = true; return; }
  card.hidden = false;
  scheduleDraw(false);
}
function scheduleDraw(force) { if (!trendRaf) trendRaf = requestAnimationFrame(() => { trendRaf = 0; if (active) void drawHistory(active, force); }); }
/** The trend is one bucket query for the window (never rows in memory): after each flush while live, at once on
 *  a range change; a reading in between does not touch the store. */
async function drawHistory(p, force = false) {
  const now = Date.now();
  if (histMem.drawing) { histMem.redraw = histMem.redraw || force; return; }
  if (!force && histMem.series && now - histMem.drawAt < trendRefreshMs(histMem.series.stepMs)) return;
  histMem.drawing = true;
  try {
    const first = histS.days[0] ? dayStartMs(histS.days[0].day) : null;
    const { from, to } = chartRange(histS.range, now, first);
    const stepMs = bucketStep(from, to);
    const q = await hist.query({ p: p.label, from, to, stepMs, days: daysFor(p, from, to) });
    histMem.series = { s: seriesFromBuckets(q.parts), energy: q.energy, from, to, stepMs }; histMem.drawAt = Date.now();
    if (q.first !== null) { histS.spanFirst = q.first; histS.spanLast = q.last; }
    // eslint-disable-next-line house/ui-after-await -- drawHistory is single-flight (histMem.drawing); a range change meanwhile sets histMem.redraw and is drawn right after
    paintHistory();
  } catch (e) { if (isCorrupt(e)) await corruptDb(e, 'history read'); /* else the store logged it */ }
  finally { histMem.drawing = false; }
  if (histMem.redraw) { histMem.redraw = false; scheduleDraw(true); }
}
function paintHistory() {
  const s = histMem.series; if (!s || !active) return;
  $('trendEnergy').textContent = T.trendEnergy(fmtSpan((s.to - s.from) / 3600000), fmtWh(s.energy.charged), fmtWh(s.energy.discharged));
  const el = $('trend'), width = Math.max(200, el.clientWidth || el.parentElement.clientWidth);
  const key = histS.params.join(',');
  if (histMem.plot && histMem.plotParams !== key) { histMem.plot.destroy(); histMem.plot = null; }   // a different set of lines = a new chart (axes and scales are built from it)
  if (!histMem.plot) { histMem.plot = makeChart(el, width, histS.params, PARAMS, { getCutoff: () => cutoffPct, onCursor: (idx) => { histMem.cursorIdx = idx; renderParamChips(); } }); histMem.plotParams = key; }
  drawChart(histMem.plot, s.s, histS.params, PARAMS, s.from, s.to, width);
  renderHistNote(); renderParamChips();
  document.querySelectorAll('#histRanges button').forEach((b) => b.classList.toggle('on', b.dataset.range === histS.range));
}
/** The line chips under the range row: one per reading, the chosen ones lit in their line's colour, each showing the
 *  value under the pointer or the newest one. Built once from T (applyLang rebuilds), values refreshed on each draw. */
function buildParamChips() {
  const row = $('histParams'); row.textContent = '';
  for (const key of PARAM_KEYS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.param = key; b.style.setProperty('--line', PARAMS[key].color);
    const dot = document.createElement('span'); dot.className = 'dot'; const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = T.param[key]; const val = document.createElement('span'); val.className = 'val';
    b.append(dot, lbl, val); row.append(b);
  }
  renderParamChips();
}
function renderParamChips() {
  const chips = paramChips(histMem.series ? histMem.series.s : null, histS.params, histMem.cursorIdx);
  for (const c of chips) { const b = document.querySelector(`#histParams button[data-param="${c.key}"]`); if (!b) continue; b.classList.toggle('on', c.on); b.setAttribute('aria-pressed', String(c.on)); b.querySelector('.val').textContent = c.text; }
}
try { histS.params = parseParams(localStorage.getItem('batray_hist_params')); } catch { /* default */ }
$('histParams').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-param]'); if (!b) return;
  const d = paramTap(histS.params, b.dataset.param);
  log(`history: line ${b.dataset.param} -> ${d.action} [${d.params.join(',')}]`);
  if (d.action === 'full') { toast(T.histMax4, 4000); return; }
  if (d.action === 'last') { toast(T.histMin1, 4000); return; }
  histS.params = d.params; try { localStorage.setItem('batray_hist_params', JSON.stringify(d.params)); } catch {}
  if (histMem.series) paintHistory(); else renderParamChips();
});
try { const r = localStorage.getItem('batray_hist_range'); if (r && RANGES[r] !== undefined) histS.range = r; } catch {}
$('histRanges').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]'); if (!b) return;
  histS.range = b.dataset.range; try { localStorage.setItem('batray_hist_range', histS.range); } catch {}
  log(`history: range ${histS.range}`); if (active) scheduleDraw(true);
});
$('histClear').addEventListener('click', async () => { const a = await openSheet('clearHist'); log(`history: clear -> ${a}`); if (a === 'ok') await clearHistory(); });
window.addEventListener('resize', () => { if (active && active.data) paintHistory(); });

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

// Link watchdog: a JK BMS streams cell frames 2-3 times a second, so silence means the link is
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
  if ($('trendCard').hidden) renderTrendWait(active);       // the bar moves every second, not only per reading
  const a = ageLabel(active && active.lastFrameAt ? Math.round((Date.now() - active.lastFrameAt) / 1000) : null, T);
  els.updated.textContent = a.text;
  els.updated.setAttribute('fill', a.stale ? '#ffd24a' : '#6f8aa6');
  const lines = active ? stampLines({ readerAt: active.readerAt, localAt: active.localAt, viewer: !!active.remote }, T) : [];
  $('updR').textContent = lines[0] || ''; $('updL').textContent = lines[1] || '';
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
  void syncWake();
}
function runDemo() {
  if ([...packs.values()].some((x) => x.demo)) return;
  const p = new Pack(`demo-${++packSeq}`, 'DEMO');
  p.plog('demo started: simulated 16-cell pack, frames are generated, not received');
  p.demo = startDemo((chunk) => p.bms._onNotify(chunk));
  addPack(p); setActive(p);
  void syncWake();
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
    case 'choose': clearConnTimers(p); p.countThunk = null; void runChooser(p, !!inp.fresh); break;
    case 'connect': clearConnTimers(p); void runAttempt(p); break;
    case 'retry': clearConnTimers(p); showAttempt(p); p.gapTimer = setTimeout(() => { p.gapTimer = null; void runAttempt(p); }, d.gapMs); break;
    case 'countdown': clearConnTimers(p); p.countThunk = () => T.reIn(p.label, p.cs.count); p.reTimer = setInterval(() => connAct(p, 'countdown-tick'), 1000); break;
    case 'count': if (p.cs.phase === 'connecting') showAttempt(p); break;    // the countdown thunk reads cs.count itself
    case 'idle': case 'connected': clearConnTimers(p); p.countThunk = null; break;
    case 'disconnect-gatt': clearConnTimers(p); p.countThunk = null; try { if (p.device && p.device.gatt.connected) p.device.gatt.disconnect(); } catch { /* nothing to drop */ } break;
    case 'disconnect-bms': clearConnTimers(p); p.countThunk = null; p.bms.disconnect(); break;
    case 'drop-link': p.bms.drop(`no data for ${d.ageS} s`); break;
    default: break;
  }
  if (p.isActive) refreshCard();
  renderPackBar(); void syncWake();
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
  // eslint-disable-next-line house/ui-after-await -- the attempt that just started owns the button until it ends (conn-logic runs one at a time)
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
    // eslint-disable-next-line house/ui-after-await -- the attempt has ended, whatever happened meanwhile: the button is free again
    $('connectBig').disabled = false;
    if (p.attemptTicker) { clearInterval(p.attemptTicker); p.attemptTicker = null; }
  }
}
async function runChooser(p, fresh) {
  try {
    if (p.device && p.device.gatt.connected) {
      const gone = new Promise((res) => { p.device.addEventListener('gattserverdisconnected', res, { once: true }); });
      p.device.gatt.disconnect();
      await Promise.race([gone, new Promise((res) => { setTimeout(res, 2000); })]);
    }
  } catch { /* nothing to drop */ }
  // eslint-disable-next-line house/ui-after-await -- the chooser is opening now, whatever the old handle's disconnect did
  setStatus(() => T.choosing);
  try {
    const device = await p.bms.requestDevice();
    log(`chooser: picked "${device.name || '(no name)'}" id=${String(device.id || '').slice(0, 10)}…`);
    const dup = [...packs.values()].find((x) => x !== p && x.device && x.device.id === device.id);
    if (dup) { toast(T.alreadyAdded(device.name || device.id)); connAct(p, 'chooser-cancelled'); setActive(dup); return; }
    p.device = device;
    if (fresh) { p.id = `bt-${device.id}`; addPack(p); setActive(p); }
    rememberDevice(device);
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
// ---- the browser gate (owner ask 2026-10-05, after a reader on Chrome 96 ran with no stored history or log and died
// unseen): at a connect tap (reader) and before the live view opens (viewer), a browser that cannot do the job is
// told why and where to update for its platform. compat-logic.js decides; this probes the page and shows the sheet. ----
function compatFeatures() {
  return {
    secure: !!window.isSecureContext, bluetooth: !!(navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function'),
    websocket: typeof WebSocket === 'function', subtle: !!(window.crypto && crypto.subtle), worker: typeof Worker === 'function',
    opfs: !!(navigator.storage && typeof navigator.storage.getDirectory === 'function'),
    compression: typeof CompressionStream === 'function' && typeof DecompressionStream === 'function',
  };
}
const browserInfo = detectBrowser({ ua: navigator.userAgent, uaPlatform: navigator.userAgentData ? navigator.userAgentData.platform : '', brave: !!navigator.brave, touchPoints: navigator.maxTouchPoints || 0 });
let compatS = null;                                                  // the failed check the 'compat' sheet explains
function compatGate(role) {
  const check = compatCheck(role, browserInfo, compatFeatures());
  if (check.ok) return true;
  compatS = { role, browser: browserInfo, check, help: updateHelp(browserInfo, check) };
  log(compatLogLine(role, browserInfo, check));
  void openCompat();
  return false;
}
async function openCompat() {
  const a = await openSheet('compat');
  if (a === 'update' && compatS && compatS.help.url) { log(`compat: opening ${compatS.help.url}`); window.open(compatS.help.url, '_blank', 'noopener'); }
}
// Connect a BMS: into `p` (reconnect of a known pack) or a new pack (+ Add BMS).
function startConnect(p) {
  if (!compatGate('reader')) return;
  const fresh = !p;
  if (fresh) p = new Pack(`bt-${++packSeq}`, `BMS ${packs.size + 1 - (packs.size && [...packs.values()].some((x) => x.demo) ? 1 : 0)}`);
  connAct(p, 'tap-connect', { fresh });
}
$('connectBig').addEventListener('click', () => startConnect(null));
// The remembered BMS (owner ask 2026-09-21): Chrome gives a page no Bluetooth address, only a per-site id and the
// name, so that pair is kept (localStorage + devices.ndjson in the history store) and, while getDevices() still lists
// the id as permitted, a green "Connect to NAME" button connects without the chooser.
function savedDevice() { try { return JSON.parse(localStorage.getItem('batray_known_dev') || 'null'); } catch { return null; } }
function rememberDevice(device) {
  const rec = { id: device.id, name: device.name || '', at: Date.now() };
  try { localStorage.setItem('batray_known_dev', JSON.stringify(rec)); } catch {}
  hist.note('devices.ndjson', JSON.stringify(rec)).catch(() => {});
  log(`known device: remembered "${rec.name}"`);
}
async function permittedIds() {
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return null;
  try { return (await navigator.bluetooth.getDevices()).map((d) => d.id); } catch { return []; }
}
async function renderKnown() {
  const k = knownDevice(savedDevice(), await permittedIds());
  const b = $('connectKnown'); b.hidden = !k.show;
  if (k.show) { $('connectKnownTxt').textContent = T.connectKnown(k.name); b.dataset.id = k.id; }
  else if (k.why) log(`known device: button hidden (${k.why})`);
  return k;
}
async function startKnown() {
  if (!compatGate('reader')) return;
  const b = $('connectKnown'); if (!b.dataset.id || !navigator.bluetooth) return;
  let dev = null; try { dev = (await navigator.bluetooth.getDevices()).find((d) => d.id === b.dataset.id) || null; } catch { /* below */ }
  if (!dev) { log('known device: not in getDevices any more, opening the chooser'); b.hidden = true; startConnect(null); return; }
  const dup = [...packs.values()].find((x) => x.device && x.device.id === dev.id);
  if (dup) { setActive(dup); connAct(dup, 'known'); return; }
  const p = new Pack(`bt-${dev.id}`, dev.name || 'BMS');
  p.device = dev; addPack(p); setActive(p);
  log(`known device: connecting to "${dev.name || dev.id}" without the chooser`);
  connAct(p, 'known');
}
$('connectKnown').addEventListener('click', () => { startKnown().catch((e) => log(`known device: ${e.message}`)); });
if (!viewMode && navigator.bluetooth) renderKnown().catch(() => {});
$('connectAgain').addEventListener('click', () => startConnect(active && !active.remote && !active.demo ? active : null));
els.disconnect.dataset.title = els.disconnect.title;
els.disconnect.addEventListener('click', () => {
  const p = active && active.bms && !active.demo ? active : null;
  const db = p ? connButton(p.cs, !!p.bms.connected) : { label: 'connect' };
  if (db.label === 'disconnect') { connAct(p, 'disconnect'); return; }
  if (db.label === 'connecting') {                                  // the busy button is a cancel
    p.plog('connect: cancelled from the toolbar');
    connAct(p, 'cancel'); setStatus(() => T.disconnectedFrom(p.label), 'bad'); toast(T.cancelled, 4000); return;
  }
  startConnect(p);                                                  // idle: the same button connects (a known pack, or the chooser for a new one)
});
$('reNow').addEventListener('click', () => { const p = active; if (!p || p.remote) return; p.plog('reconnect: user tapped Reconnect now'); connAct(p, 'reconnect-now'); });
$('cancelRe').addEventListener('click', () => { const p = active; if (!p || p.remote) return; p.plog('reconnect: cancelled by user'); connAct(p, 'cancel'); setStatus(() => T.disconnectedFrom(p.label), 'bad'); });

// ---- Share live (publisher) ----
// One line for both chips: viewers, path (and how many are on direct Wi-Fi),
// server connections against the free cap, or the retry countdown.
// The server count (connections in use / free cap) is shown in every state
// once the relay has reported it, so a full server is never a surprise.
// The relay costs the author money (owner ask 2026-09-22, at ~80 visits a day): the limit and a sponsor link sit
// next to the live chip and in the share setup card. The limit comes from the relay's own status when known.
function renderServerNote() {
  const html = T.serverNote;
  for (const el of document.querySelectorAll('.serverNote')) if (el.innerHTML !== html) el.innerHTML = html;
  $('serverNote').hidden = !(publisher || viewer || shareS.phase !== 'off');   // from the first tap on Share, not only once the room answers
}
function renderLiveChip() {
  renderServerNote();
  const b = shareButton(shareS);
  els.share.classList.toggle('on', b.on); els.share.classList.toggle('busy', b.busy); els.share.setAttribute('aria-pressed', b.on); els.share.disabled = b.disabled;
  els.share.title = b.on ? T.shareOnTitle : b.busy ? T.shareBusyTitle : (els.share.dataset.title || '');
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
  if (d.action === 'stop') void stopShare('toolbar');
  else if (d.action === 'cancel') cancelShare();
  else if (d.action === 'setup') openSharePanel();
}
async function beginShare() {
  const b = shareBegin(shareS, { typedName: $('shareName').value, reuseChecked: $('shareReuse').checked, saved: savedShare(), suggest: suggestChannelName });
  if (b.action !== 'start') { log(`share: start -> ${b.action} (${b.why})`); return; }
  try { localStorage.setItem('batray_share_name', b.name); } catch {}
  log(`share: name "${b.name}", ${b.reuse ? `reusing room ${b.reuse.room}` : 'new room'}`);
  $('sharePanel').hidden = true;
  renderLiveChip(); void syncWake();
  publisher = new Publisher({ log, onState: (s) => {
    renderLiveChip(); void syncWake(); watchReach(s);
    const v = viewersChange(shareS, s.viewers);
    if (v && alerts) alerts.notify('viewers', v.joined ? T.evViewerJoined : T.evViewerLeft, T.evWatching(v.viewers));
  }, onRequest: (m) => histRequest(m) });
  const pub = publisher;
  try {
    await pub.start(b.reuse);
    if (publisher !== pub) return;                                    // cancelled from the toolbar meanwhile
    try { localStorage.setItem('batray_share_last', JSON.stringify(publisher.credentials)); } catch {}
    const st = shareStarted(shareS, { link: publisher.link, reused: publisher.reused });
    if (st.toastNewLink) toast(T.shareNewLink, 9000);
    renderChannelName();
    showQr(true);
    void copyShareLink();
    // the room retains the newest hello / pack list / info / settings / data per pack for late viewers; the pack list
    // (connected flags) is resent every 10 s, the rest goes out when it changes
    publisher.snapshotTimer = setInterval(sendSnapshots, 10000);
    sendSnapshots();
  } catch (err) {
    if (publisher !== pub) return;                                    // cancelled: its own toast already said so
    log(`share failed: ${err.message}`);
    toast(T.shareFailed(err.message), 9000);
    void publisher.stop(); publisher = null; shareFailed(shareS);
  } finally { renderLiveChip(); void syncWake(); }
}
// A viewer asked for history (its own day listing came with the request): send the gzipped day files it lacks,
// newest first, in base64 chunks over the encrypted link, paced by the channels' backlog, only while live.
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
const gzipBytes = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const gunzipBytes = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
/** A viewer asked for history (its day listing with ids came with the request): send the rows it lacks, newest day
 *  first, as gzipped JSON files of XFER_ROWS rows in base64 chunks over the encrypted link, paced by the channels'
 *  backlog, only while live. */
async function histRequest(m) {
  if (!publisher || histS.backend === 'memory') { log(`history: request from ${String(m.from || '').slice(0, 6)} ignored (${!publisher ? 'not sharing' : 'nothing stored'})`); return; }
  await flushHistory();
  histS.days = await hist.days();
  const plan = transferPlan(histS.days, Array.isArray(m.have) ? m.have : []).map((x) => ({ ...x, to: m.from }));   // to the viewer that asked
  log(`history: request from ${String(m.from || '').slice(0, 6)}: viewer has ${Array.isArray(m.have) ? m.have.length : 0} days -> ${plan.length ? plan.map((x) => `${x.day} after id ${x.after} (${x.rows} rows)`).join(', ') : 'nothing to send'}`);
  if (!plan.length) return;
  if (histS.xfer) { histS.xfer.queue = plan; log('history: a transfer is running, the new plan replaces its queue'); return; }
  histS.xfer = { queue: plan, sent: 0 };
  const pub = publisher;
  try {
    while (histS.xfer && histS.xfer.queue.length && publisher === pub && pub.state.live) {
      const item = histS.xfer.queue.shift();
      let after = item.after;
      for (;;) {
        const rows = await hist.rows(item.day, after, XFER_ROWS); if (!rows.length) break;
        const gz = await gzipBytes(utf8.encode(JSON.stringify(rows)));
        const chunks = chunkB64(b64(gz));
        log(`history: sending ${item.day} ids ${rows[0].id}..${rows[rows.length - 1].id} (${rows.length} rows, ${gz.length} B gz) in ${chunks.length} chunks`);
        for (let i = 0; i < chunks.length; i++) {
          let waited = 0;
          while (pub.backlog() > XFER_BACKLOG && waited < 30000 && publisher === pub) { await new Promise((res) => { setTimeout(res, 100); }); waited += 100; }
          if (publisher !== pub || !pub.state.live) { log('history: transfer stopped (link gone)'); return; }
          await pub.publish(envelope('hist-file', { id: '*', name: '*' }, { day: item.day, after, n: i, of: chunks.length, b64: chunks[i], rows: rows.length, bytes: gz.length }), item.to);
          histS.xfer.sent += chunks[i].length;
          await new Promise((res) => { setTimeout(res, 20); });
        }
        after = rows[rows.length - 1].id;
        if (rows.length < XFER_ROWS) break;
      }
    }
  } catch (e) { log(`history: transfer failed: ${e.message}`); if (isCorrupt(e)) await corruptDb(e, 'history read'); }
  finally { histS.xfer = null; }
}
function sendSnapshots() {
  if (!publisher) return;
  void publisher.publish(envelope('hello', { id: '*', name: '*' }, { channel: shareS.name, version: APP_VERSION }));
  const list = [...packs.values()].map((p) => ({ id: p.id, name: p.label, demo: !!p.demo, connected: p.connected }));
  void publisher.publish(envelope('packs', { id: '*', name: '*' }, list));
}
function cancelShare() {
  if (!publisher) return;
  const pub = publisher; publisher = null;
  log('share: cancelled while starting');
  try { pub.stop(); } catch { /* never started */ }
  renderLiveChip(); void syncWake(); toast(T.cancelled, 4000);
}
async function stopShare(why = 'chip') {
  if (!publisher) return;
  log(`share: stop (${why})`);
  clearInterval(publisher.snapshotTimer);
  const pub = publisher; publisher = null; shareStopped(shareS); histS.xfer = null;
  renderLiveChip(); void syncWake();
  await pub.stop();
  if (!publisher) { showQr(false); renderLiveChip(); }                   // unless a newer share owns the chip and the QR by now
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
  renderServerNote();
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
// the viewer's own copy: ask the reader for the day files this device lacks (share-logic never sees rows, only files)
// the viewer's own copy: ask the reader for the rows this device lacks, per day by id (share-logic never sees rows)
async function requestHistory() {
  if (!viewer || histS.backend === 'memory') return;
  await flushHistory();
  try { histS.days = await hist.days(); } catch { /* keep the old listing */ }
  const have = [];
  for (const d of histS.days) {
    if (d.day === histS.day) { have.push({ day: d.day, maxId: Math.max(d.maxId || 0, histS.todayRows), contig: histS.contig }); continue; }
    const info = await hist.info(d.day).catch(() => ({ maxId: d.maxId, contig: d.maxId }));
    have.push({ day: d.day, maxId: info.maxId, contig: info.contig });
  }
  if (viewer.request(have)) log(`history: asked the reader (this device has ${have.length} days; today complete to id ${histS.contig}, highest ${histS.todayRows}${histS.gap ? ', a hole' : ''})`);
}
// one hist-file chunk from the reader: the payload is env.v; rxChunk assembles the file and only a complete one is
// stored (0.9.65: the 2026-10-04 viewer log showed every chunk handed to the store as the assembly's result object)
function rxHistFile(env) {
  const c = env.v || {};
  if (c.n === 0) log(`history: receiving ${c.day} after id ${c.after} (${c.rows} rows, ${c.bytes} B) in ${c.of} chunks`);
  const r = rxChunk(histS, c);
  if (r.action === 'file') storeReceived(r.file).catch((e) => log(`history: storing ${r.file.day} failed: ${e.message}`));
  else if (r.action === 'drop') log(`history: ${c.day} ${r.why} - voided, the next request fetches it again`);
}
async function storeReceived(file) {
  const rows = JSON.parse(new TextDecoder().decode(await gunzipBytes(unb64(file.b64))));
  if (!Array.isArray(rows) || !rows.length || !rows.every((r) => r && typeof r.t === 'number' && typeof r.id === 'number' && r.p)) throw new Error('not a row file');
  histS.gapAsks = 0;                                                     // the reader answers: holes may be asked about again
  await flushHistory();
  const r = await hist.insert(file.day, rows);
  let note = '';
  if (file.day === histS.day) {
    const info = await hist.info(file.day);
    histS.contig = info.contig; histS.todayRows = Math.max(histS.todayRows, info.maxId); histS.nextId = info.maxId + 1;
    const hole = info.contig < info.maxId; note = `; today complete to ${info.contig} of ${info.maxId}${hole ? ' (still a hole)' : ''}`;
    histS.gap = hole ? 'gap' : null;
    if (hole && viewer && histReqDecision(histS, { live: viewer.state.live, now: Date.now(), gap: true }).action === 'request') void requestHistory();
  }
  log(`history: got ${file.day} ids ${rows[0].id}..${rows[rows.length - 1].id}: ${r.inserted} new, ${r.ignored} already here${note}`);
  histS.days = await hist.days();
  if (active) renderTrend(active); else renderHistNote();                // throttled: a transfer of 100 files is not 100 chart queries
}
function startView() {
  document.body.classList.add('view'); $('tabs').hidden = false; renderTabs();
  $('keepAwakeRow').hidden = true;                                   // a viewer never plays the keep-awake video
  $('titleText').textContent = `BatRay by ClearEvo.com v${APP_VERSION} · ${T.viewTitle}`;
  for (const el of [els.disconnect, $('autoRe').parentElement, els.share, $('tsep')]) el.hidden = true;
  els.empty.hidden = true;
  if (!compatGate('viewer')) { setStatus(() => T.compatViewBlocked, 'bad'); return; }
  setStatus(() => T.viewWaiting);
  viewer = new Viewer({
    room: viewMode.room, keyB64: viewMode.key, log,
    onState: (s) => {
      renderViewChip(); watchReach(s);
      for (const p of packs.values()) { p.remoteLive = s.live; }
      if (histReqDecision(histS, { live: s.live, now: Date.now() }).action === 'request') void requestHistory();
      const ve = viewerEvent(viewS, s);           // the reader's presence: share-logic.js decides what is worth an alert
      if (ve && alerts) alerts.notify('reader', ve.readerAlert === 'on' ? T.evReaderOn : T.evReaderOff, ve.readerAlert === 'on' ? T.evReaderOnBody : T.evReaderOffBody);
      if (active) { if (!s.live) setStatus(() => (s.reader === false ? T.viewOfflineShort : T.viewReconnecting), 'bad'); else setStatus(() => T.viewingPack(active.label), 'good'); }
      refreshCard(); renderPackBar(); void syncWake();
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
      if (env.k === 'hist-file') { rxHistFile(env); return; }
      let p = packs.get(env.p.id);
      if (!p) { p = addPack(new Pack(env.p.id, env.p.name, { remote: true })); }
      // a frozen tab gets the whole queue on resume (the 2026-09-22 log: 20 s of replay): a reading older than
      // FRESH_MS is kept for the history but never painted, and does not count as the reader being there
      const seen = viewerDataSeen(viewS, !!env.stale, Math.round((Date.now() - env.t) / 1000));
      if (seen.droppedStale) log(`live: ${seen.droppedStale} queued readings up to ${seen.maxAgeS} s old were stored but not shown`);
      if (!env.stale) p.remoteLive = true;
      if (env.retained && env.stale && env.k !== 'data') return;         // an old hello / pack list / info says nothing about now
      if (env.k === 'info') { p.info = env.v; if (p.isActive && !env.stale) renderDevice(env.v); }
      else if (env.k === 'settings') { p.settings = env.v; if (p.isActive && !env.stale) renderSettings(env.v); }
      else if (env.k === 'data') {
        const row = env.r && typeof env.r === 'object' && typeof env.r.t === 'number' ? env.r : null;
        if (env.retained) {                                                 // the room's last picture: painted with its true age, live only if fresh
          if (env.stale) { p.remoteLive = false; log(`live: last reading from the reader is ${env.ageS} s old (retained by the room)`); }
          p.take(env.v, env.t, row, Date.now() - env.ageS * 1000); if (p.isActive) { render(env.v); refreshCard(); } renderPackBar(); return;
        }
        if (env.stale) { recordRow(p, env.v, env.t, row); return; }
        p.take(env.v, env.t, row); if (p.isActive) { render(env.v); refreshCard(); } renderPackBar();
      }
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
const previewS = previewState(); let previewEpisode = 0;
const canPlayHls = () => !!$('tvVideo').canPlayType('application/vnd.apple.mpegurl');
/** Which picture the tvbox shows: the stream player only while it really plays, else the frame drawn here. */
function renderPreview() {
  const src = previewSource(previewS, canPlayHls(), Date.now());
  $('tvVideo').hidden = src !== 'video'; $('tvLocal').hidden = src !== 'local';
}
function unloadPreview(v) { try { v.pause(); } catch { /* not playing */ } v.removeAttribute('src'); v.load(); previewEvent(previewS, 'unload'); renderPreview(); }
function renderTv(s) {
  if (!tv || !s.live) return;
  $('tvLink').textContent = s.url;
  const v = $('tvVideo');
  // Chrome on Android plays HLS itself; desktop Chrome does not: there the box shows the locally drawn frame
  // only (0.9.50). Cast is offered everywhere the cast library runs.
  const canHls = canPlayHls();
  $('tvNoPreview').hidden = canHls;
  if (s.episodes !== previewEpisode) { previewEpisode = s.episodes; if (v.getAttribute('src')) { log('tv preview: stream revived - reloading the player'); unloadPreview(v); } }
  if (tvPreviewWanted(s, canHls, !!v.getAttribute('src'))) startPreview(v, s.url);
  renderPreview();
  const pull = s.pullAgeS === null || s.pullAgeS === undefined ? T.tvNotPulled : T.tvPulled(s.pullAgeS);
  $('tvStat').textContent = (s.error ? T.tvErr(s.error) + ' · ' : '') + T.tvStat(s.segs, Math.round(s.bytes / 1024), pull) + (s.segs < 3 ? ' · ' + T.tvStarting : '');
}
function startPreview(v, url) {
  v.src = url;
  let tries = 0;
  const kick = () => v.play().catch((e) => log(`tv preview: play refused: ${e.message}`));
  v.addEventListener('loadedmetadata', () => { log('tv preview: metadata loaded'); kick(); });
  let frames = 0;                                                            // the phone's own HLS player is the nearest witness to what a TV will do with the stream
  const seen = (ev) => { previewEvent(previewS, ev, Date.now()); renderPreview(); };
  v.addEventListener('playing', () => { log(`tv preview: playing (${v.videoWidth}x${v.videoHeight})`); seen('playing'); });
  v.addEventListener('waiting', () => { log('tv preview: waiting for data'); seen('waiting'); });
  v.addEventListener('stalled', () => { log('tv preview: stalled'); seen('stalled'); });
  v.addEventListener('ended', () => seen('ended'));
  v.addEventListener('emptied', () => seen('emptied'));
  v.addEventListener('timeupdate', () => { if (++frames === 1 || frames === 10 || frames % 60 === 0) log(`tv preview: t=${v.currentTime.toFixed(1)}s (update ${frames})`); });
  v.addEventListener('canplay', kick, { once: true });
  v.addEventListener('error', () => {
    const err = v.error ? `${v.error.code} ${v.error.message || ''}` : '?';
    log(`tv preview: player error ${err} (try ${tries + 1})`); seen('error');
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
// the Cast buttons are the standard cast icon (Material Design icon "cast", Apache 2.0); the words live in the hint
// line: "Cast to TV - <state>". Chrome's OWN cast button inside the <video> controls cannot appear for this stream:
// Chromium marks every source incompatible with remote playback until its demuxer proves it (see the README).
function castHint(txt) { $('tvCastHint').textContent = `${T.tvCast} - ${txt}`; }
let castFlowMs = CAST_FLOW_TIMEOUT_MS;                                       // test hook shortens it
/** Both Cast buttons follow castS: greyed with the wait icon while the tap flow runs or a picker request is open. */
function renderCastButtons() {
  const b = castButtons(castS);
  for (const id of ['tvCast', 'tvCastOverlay']) { const el = $(id); el.disabled = b.disabled; el.classList.toggle('busy', b.busy); }
}
let castTvMs = CAST_TV_WAIT_MS;                                              // test hook shortens it
const castBudget = (ph) => (ph === 'waiting' || ph === 'buffering' ? castTvMs : ph === 'loading' || ph === 'looking' ? castFlowMs : 0);
function castSheetCtx() { return { phase: castS.phase, dev: castS.dev, tvT: castS.tvT, ...castProgress(castS, Date.now(), castBudget(castS.phase)) }; }
/** The flow is over; the sheet keeps the result until the user closes it, the buttons come back now. */
function castSettleUi(result, hint) { castSettle(castS, result); castHint(hint); renderCastButtons(); updateSheet('casting'); log(`cast: settled -> ${result}`); }
/** Every player state the TV reports, from the RemotePlayer events and the media-session poll alike: while the
 *  sheet waits for the TV, BUFFERING is progress, PLAYING settles it, IDLE/ERROR settles it as a failure. */
function castTvSeen(playerState, idleReason, t) {
  castS.tvT = Math.round(t || 0);
  const d = castTvUpdate(castS, playerState, idleReason);
  if (d === 'playing') castSettleUi('playing', T.tvCastState(castS.dev, 'PLAYING'));
  else if (d === 'error') castSettleUi('error', T.tvCastTvError(castS.dev));
  else if (d === 'buffering') { if (castS.phase !== 'buffering') log('cast: TV player buffering'); castFlowPhase(castS, 'buffering'); updateSheet('casting'); }
  else if (castS.phase === 'playing') updateSheet('casting');                // the playing time in the open sheet
}
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
    if (castStateUi(castS) === 'sheet') { updateSheet('casting'); renderCastButtons(); return; }   // the flow owns the hint and the buttons meanwhile
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
    castTvSeen(castPlayer.playerState, idle, castPlayer.currentTime);
  };
  pc.addEventListener(E.PLAYER_STATE_CHANGED, () => report('player state'));
  pc.addEventListener(E.IS_MEDIA_LOADED_CHANGED, () => report('media loaded change'));
  pc.addEventListener(E.MEDIA_INFO_CHANGED, () => report('media info change'));
}
/** Every status the TV reports for the loaded media. The 2026-09-28 log: the TV's media session appears only
 *  with its FIRST status update, 19 s after the load was accepted (its player buffered the growing MP4 that long
 *  before PLAYING), so "no media session right after the load" is normal, not a failure - the poll waits for it,
 *  and only CAST_NO_MEDIA_MS without one says the TV reported nothing playing. */
function watchCastMedia(sess) {
  const t0 = Date.now(); let last = ''; let attached = false;
  const line = (why, alive, m) => {
    const t = (m.getEstimatedTime ? m.getEstimatedTime() : m.currentTime) || 0;
    const txt = `player=${m.playerState || '-'}${m.idleReason ? ' idle=' + m.idleReason : ''} t=${Math.round(t)}s${alive === false ? ' alive=false' : ''}`;
    if (m.playerState) castTvSeen(m.playerState, m.idleReason, t);
    if (why === 'poll' && txt === last) return; last = txt;
    log(`cast: tv ${why} +${Math.round((Date.now() - t0) / 1000)}s: ${txt}`);
  };
  const tick = () => {
    const m = sess.getMediaSession && sess.getMediaSession();
    if (m && !attached) {
      attached = true; log(`cast: tv media session ${Math.round((Date.now() - t0) / 1000)} s after the load`);
      try { m.addUpdateListener((alive) => line('update', alive, m)); } catch (e) { log(`cast: no update listener: ${e.message}`); }
      line('status', true, m);
    } else if (m) line('poll', true, m);
    else if (Date.now() - t0 >= castTvMs) { log(`cast: no media session ${Math.round(castTvMs / 1000)} s after the load`); if (castS.busy && (castS.phase === 'waiting' || castS.phase === 'buffering')) castSettleUi('nomedia', T.tvCastNoMedia); else castHint(T.tvCastNoMedia); clearInterval(poll); return; }
    if (Date.now() - t0 > 120000 || !sess.getMediaSession) clearInterval(poll);
  };
  const poll = setInterval(tick, 3000); tick();
}
const castDiscovery = (ms) => new Promise((ok) => { if (discoveryKnown(castS)) { ok(); return; } const t = setTimeout(ok, ms); castWaiters.push(() => { clearTimeout(t); ok(); }); });
// A 6 s H.264 test pattern (baseline profile, progressive MP4) served next to the app: if the TV plays this and not our
// live stream, the stream is the problem, not the TV, the session or the host. Google's sample buckets were not
// reachable from the build sandbox (403), so the file is ours.
const CAST_TEST_URL = new URL('./test-tv.mp4', import.meta.url).href;
/** Every message the TV sends on the media namespace (MEDIA_STATUS, LOAD_FAILED with detailedErrorCode, ...): the
 *  receiver's own words on why a load failed, which the RemotePlayer events never carried (2026-09-27 log). */
function listenCastMedia(sess) {
  if (sess.__batrayMediaListener) return;
  try {
    const raw = sess.getSessionObj ? sess.getSessionObj() : null;
    const add = raw && raw.addMessageListener ? raw.addMessageListener.bind(raw) : sess.addMessageListener ? sess.addMessageListener.bind(sess) : null;
    if (!add) { log('cast: no message listener on this session'); return; }
    add('urn:x-cast:com.google.cast.media', (ns, msg) => log(`cast: tv message ${String(msg).slice(0, 600)}`));
    sess.__batrayMediaListener = true;
  } catch (e) { log(`cast: media message listener refused: ${e.message}`); }
}
async function castToTv(opts = {}) {
  const testVideo = !!opts.test;
  if (!testVideo && (!tv || !tv.state.url)) return;
  if (!castTapAllowed(castS)) { log('cast: tap -> busy'); return; }
  const loadedBeforeTap = !!(window.cast && window.cast.framework);
  // one progress sheet from the tap to the TV's answer; Cancel ends the flow (a picker request already handed to
  // Google's library cannot be taken back: closing its list is the cancel there)
  castFlowStart(castS, Date.now(), 'loading'); renderCastButtons(); castHint(T.castLoading);
  let ended = null;                                                          // 'cancel' | 'timeout' once the sheet or the clock ended the flow
  const endFlow = (why, hint) => {
    if (!castS.busy) return;
    ended = ended || why; castFlowEnd(castS); renderCastButtons(); castHint(hint);
    if (uiS.sheet && uiS.sheet.kind === 'casting') closeSheet('done', why);
    for (const w of castWaiters) w(); castWaiters = [];
  };
  void openSheet('casting').then((r) => {
    if (castS.busy && (castS.phase === 'waiting' || castS.phase === 'buffering') && r !== 'done') {   // the user stops watching; the TV keeps playing
      log(`cast: sheet closed by the user while ${castS.phase}`); castFlowEnd(castS); renderCastButtons(); return;
    }
    if (castS.busy && r !== 'done') { log(`cast: cancelled by the user (${castS.phase})`); endFlow('cancel', castS.phase === 'picking' ? T.tvCastStuck : T.tvCastCancelled); return; }
    if (!castS.busy) castFlowEnd(castS);                                                             // a settled result read and closed
  });
  const waitingOnTv = () => castS.busy && (castS.phase === 'waiting' || castS.phase === 'buffering');
  const tick = setInterval(() => {
    const castSheet = !!(uiS.sheet && uiS.sheet.kind === 'casting');
    if (!castS.busy && !castSheet) { clearInterval(tick); castFlowEnd(castS); renderCastButtons(); return; }
    if (!castS.busy) { updateSheet('casting'); return; }                                             // a settled result on show
    const p = castProgress(castS, Date.now(), castBudget(castS.phase));
    if (p.timedOut && waitingOnTv()) { log(`cast: the TV showed nothing playing within ${Math.round(castTvMs / 1000)} s`); castSettleUi('nomedia', T.tvCastNoMedia); return; }
    if (p.timedOut) { log(`cast: no TV list within ${Math.round(castFlowMs / 1000)} s (${castS.phase})`); endFlow('timeout', T.tvCastTimeout); clearInterval(tick); return; }
    updateSheet('casting');
  }, 500);
  const phase = (ph, hint, now) => { if (castS.busy) { castFlowPhase(castS, ph, now); updateSheet('casting'); } castHint(hint); };   // a cancelled flow only writes the hint
  try {
    await loadCastSdk();
    if (ended) return;
    wireCastState();
    const ctx = cast.framework.CastContext.getInstance();
    const inp = () => ({ loadedBeforeTap, hasSession: !!ctx.getCurrentSession(), activationActive: navigator.userActivation ? navigator.userActivation.isActive : undefined, now: Date.now() });
    let d = castTapDecision(castS, inp());
    if (d.action === 'wait-discovery') { phase('looking', T.castLooking); await castDiscovery(d.ms); if (ended) return; d = castAfterDiscovery(castS, inp()); }
    log(`cast: tap -> ${d.action}${d.why ? ' (' + d.why + ')' : ''}${d.ageS !== undefined ? ' ' + d.ageS + ' s' : ''} (events=${castS.events} flipped=${castS.flipped} state=${castS.castState})`);
    if (d.action === 'pending') { endFlow('done', T.tvCastPending); return; }
    if (d.action === 'no-devices') { endFlow('done', T.tvCastNone); return; }
    if (d.action === 'tap-again') { endFlow('done', d.why === 'discovery' ? T.tvCastTimeout : T.tvCastTapAgain); return; }
    if (d.action === 'request') {
      phase('picking', T.tvCastPick); const mine = castRequestStarted(castS, Date.now()); renderCastButtons();
      // eslint-disable-next-line house/ui-after-await -- castS is the one cast state; the buttons follow it after the request ends, whatever happened meanwhile
    try { await ctx.requestSession(); } finally { castRequestEnded(castS, mine); renderCastButtons(); }
    }
    const sess = ctx.getCurrentSession();
    if (!sess) throw new Error('no cast session');
    if (castS.busy) phase('sending', T.castSending);
    listenCastMedia(sess);
    // The TV gets the stream as one growing MP4 (video/mp4, live), the same path its player took for the test
    // pattern; the HLS playlist stays for TV browsers and VLC (the receiver's HLS player refused it, 2026-09-27/28).
    const info = testVideo ? new chrome.cast.media.MediaInfo(CAST_TEST_URL, 'video/mp4') : new chrome.cast.media.MediaInfo(tv.state.mp4Url, 'video/mp4');
    info.streamType = testVideo ? chrome.cast.media.StreamType.BUFFERED : chrome.cast.media.StreamType.LIVE;
    info.metadata = new chrome.cast.media.GenericMediaMetadata(); info.metadata.title = testVideo ? 'BatRay TV test pattern (6 s)' : `BatRay · ${shareS.name || (active ? active.label : '')}`;
    const req = new chrome.cast.media.LoadRequest(info); req.autoplay = true;
    const rc = await sess.loadMedia(req);                                     // CAF resolves with an error code on some failures instead of rejecting
    const dev = sess.getCastDevice ? sess.getCastDevice().friendlyName : '';
    log(`cast: loadMedia(${testVideo ? 'test video' : 'stream mp4'}) resolved with ${rc === undefined || rc === null ? 'no error' : JSON.stringify(rc)} on "${dev}"${testVideo ? '' : ` (${tv.state.segs} segments on the relay)`} - watching its player state`);
    if (rc) throw new Error(`load refused: ${JSON.stringify(rc)}`);
    castS.dev = dev;
    phase('waiting', T.tvCastConnected(dev), Date.now());                    // the sheet stays: the TV's player state shows here until it plays (or a minute passes)
    if (!castS.busy) log('cast: the stream is sent although the user had cancelled - the hint follows the TV, the sheet stays away');
    watchCastMedia(sess);
  } catch (e) {
    const msg = e && (e.message || e.code || String(e));
    const kind = castErrorDecision(msg);
    if (kind === 'closed') { log('cast: picker closed without a choice'); endFlow('done', T.tvCastReady); castHint(T.tvCastReady); return; }
    log(`cast: ${msg}${e && e.description ? ' - ' + e.description : ''}`);
    if (kind === 'stuck') { endFlow('done', T.tvCastStuck); castHint(T.tvCastStuck); toast(T.tvCastStuck, 9000); return; }
    endFlow('done', T.tvCastFailed(msg)); castHint(T.tvCastFailed(msg));
    toast(T.tvCastFailed(msg), 9000);
  } finally { if (!waitingOnTv()) { clearInterval(tick); if (castS.busy) endFlow('done', T.tvCastReady); } renderCastButtons(); }
}
// every button and note of the TV card and the toolbar follow tvS (tv-logic.js)
setInterval(() => { if (tv && tv.state.live) renderPreview(); }, 1000);   // the stall grace expires without a player event
function renderTvButtons() {
  const b = tvButtons(tvS);
  $('tv').classList.toggle('on', b.on); $('tv').classList.toggle('busy', b.busy); $('tv').setAttribute('aria-pressed', b.on); $('tv').title = b.on ? T.tvOnTitle : b.busy ? T.tvBusyTitle : ($('tv').dataset.title || '');
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
  const local = $('tvLocal'), lctx = local.getContext('2d', { alpha: false });
  const t = new TvStream({ width: w, height: h, model: tvModel, log, onState: renderTv, onFrame: (c) => { if (!local.hidden) lctx.drawImage(c, 0, 0, local.width, local.height); }, ...opts });
  tv = t;
  try {
    const url = await t.start();
    if (tv !== t) return null;                                          // cancelled from the toolbar meanwhile
    tvStarted(tvS); renderTvButtons(); castHint(T.tvCastLoads); renderTv(t.state); void syncWake();
    toast(T.tvStarting, 9000);
    return url;
  } catch (e) {
    if (tv !== t) return null;                                          // cancelled: its own toast already said so
    log(`tv failed: ${e.message}`); toast(e.code === 'nocodec' ? T.tvNoCodec : T.tvFailed(e.message), 9000);
    tv = null; tvStartFailed(tvS); renderTvButtons(); try { await t.stop(); } catch {}
    throw e;
  }
}
function cancelTv() {
  if (!tv) return;
  const t = tv; tv = null; renderTvButtons();
  log('tv: cancelled while starting');
  t.stop().catch(() => {});
  void syncWake(); toast(T.cancelled, 4000);
}
async function stopTv(why = 'card') {
  if (!tv) return;
  const t = tv; tv = null; tvStopped(tvS); renderTvButtons();
  log(`tv: stop (${why})`);
  await t.stop();
  if (!tv) { unloadPreview($('tvVideo')); $('tvQr').hidden = true; }    // unless a newer stream owns the card by now
  void syncWake(); toast(T.tvStopped, 5000);
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
    if (d.action === 'stop') { void stopTv('toolbar'); return; }
    if (d.action === 'cancel') { cancelTv(); return; }
    renderTvButtons();
    if (d.action === 'open-panel') $('tvPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $('tvPanel').addEventListener('toggle', () => {
    const v = $('tvVideo'), open = $('tvPanel').open;
    const d = tvPreviewToggle(open, !!(tv && tv.state.live), !!v.getAttribute('src'));
    log(`tv: card ${open ? 'expanded' : 'collapsed'} -> ${d}`);
    if (d === 'unload') unloadPreview(v);
    else if (d === 'load') renderTv(tv.state);
  });
  $('tvClose').addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const d = tvCloseDecision(tvS);
    log(`tv: close -> ${d.action}`);
    if (d.action === 'stop') void stopTv('close'); else renderTvButtons();
  });
  $('tvStart').addEventListener('click', () => startTv().catch(() => {}));
  $('tvStop').addEventListener('click', () => stopTv('card'));
  $('tvCast').addEventListener('click', () => castToTv());
  $('tvCastOverlay').addEventListener('click', () => castToTv());          // the same icon on the preview itself
  $('tvCastTest').addEventListener('click', () => castToTv({ test: true }));
  $('tvCopy').addEventListener('click', async () => { if (!tv) return; try { await navigator.clipboard.writeText(tv.state.url); toast(T.linkCopied, 6000); } catch { toast(T.linkCopyManual, 8000); } });
  $('tvQrBtn').addEventListener('click', () => { const c = $('tvQr'); if (!tv) return; if (c.hidden) { renderQr(tv.state.url, c); c.hidden = false; } else c.hidden = true; });
  window.addEventListener('pagehide', () => { if (tv) { const t = tv; tv = null; tvStopped(tvS); t.stop(); } });
})();
if (window.__batrayTest) Object.assign(window.__batrayTest, {
  openSharePanel, beginShare, startTv, stopTv, castToTv, tvState: () => (tv ? tv.state : null), logLines: () => logLines.slice(), logHeaderLines,
  wakeState: () => ({ lock: wakeS.held, drops: wakeS.drops, refusals: wakeS.refusals, video: wakeS.videoOn, mode: wakeS.mode }), castState: () => ({ ...castS }),
  shareState: () => ({ ...shareS }), tvUiState: () => ({ ...tvS }), histState: () => ({ ...histS, pending: pendingRows(), plot: !!histMem.plot, series: histMem.series ? histMem.series.s.t.length : 0 }), logState: () => ({ ...logS, pending: logS.pending.length }), logSet: (k, v) => { logS[k] = v; }, logLine: (m) => log(m), flushLog, setLogKeep, logList: () => hist.logList(), logRead: (n) => hist.logRead(n), downloadLogs, clearLogs, backupSettings, restoreSettings, resetSettings, renderStorage, memTick, appState, openBrowse, browseDelete, browseState: () => ({ ...browseS }), histSeed: async (rows) => { const byDay = new Map(); for (const r of rows) { const d = dayKey(r.t); byDay.set(d, (byDay.get(d) || []).concat([r])); } let n = 0; for (const [d, rs] of byDay) { const info = await hist.info(d); let id = info.maxId; const r = await hist.insert(d, rs.map((x) => ({ ...x, id: x.id || ++id }))); n += r.inserted; if (d === histS.day) { histS.nextId = Math.max(histS.nextId, id + 1); histS.todayRows = Math.max(histS.todayRows, id); histS.contig = (await hist.info(d)).contig; } } histS.days = await hist.days(); histMem.series = null; return n; }, remoteTake: (name, d, t, row) => { const p = packs.get(`r-${name}`) || addPack(new Pack(`r-${name}`, name, { remote: true })); p.remoteLive = true; return p.take(d, t, row); }, flushHistory, backupHistory, restoreHistory, histRequest, requestHistory, storeReceived, renderKnown, tarParse, clearHistory, maintainHistory, histList: () => hist.days(), histInfo: (d) => hist.info(d), histRows: (d, after, limit) => hist.rows(d, after, limit), histQuery: (q) => hist.query(q), histSlow: (ms) => hist.slow(ms), castTimeouts: (ms, tvMs) => { if (ms) castFlowMs = ms; if (tvMs) castTvMs = tvMs; }, castFlow: () => ({ busy: castS.busy, phase: castS.phase, requestAt: castS.requestAt }), renderTv: () => { if (tv) renderTv(tv.state); }, histSpin: (ms) => hist.spin(ms), histCorrupt: (day) => hist.corrupt(day), histRestart: () => hist.b.restart(), histStats: () => hist.statsLine(), histInsert: (d, rows) => hist.insert(d, rows), histTimeouts: (t) => Object.assign(hist.timeouts, t), histStatsRaw: () => JSON.parse(JSON.stringify(hist.stats)), histExport: (d) => hist.exportDay(d), gzipBytes, connState: () => (active && active.cs ? { ...active.cs } : null),
  uiState: () => ({ ...uiS }), openSheet, closeSheet, setKeepAwake, rxHistFile, compatState: () => compatS, browserInfo: () => browserInfo, packData: () => (active ? active.data : null),
  tvFrame: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; drawTvFrame(c.getContext('2d'), w, h, { tick: 3, ...tvModel() }); return c.toDataURL('image/png'); },
});

// ---- UI chrome (UI_GUIDELINES.md): bottom sheet, viewer tabs, Back, low power.
// Decisions in ui-logic.js over uiS; this code paints and talks to the history API. ----
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let sheetResolve = null, suppressPop = 0;
function sheetCtx() {
  const p = active;
  return { compat: compatS, d: p ? p.data : null, settings: p ? p.settings : null, iEmaV: p && p.iEma ? p.iEma.v : null, cutoffPct, upload: uploadS, cast: castSheetCtx(), browse: browseS, logFiles: logSummary(logS.files).files, logSize: fmtSize(logSummary(logS.files).bytes), setCount: Object.keys(settingsSnapshot(settingsEntries())).length, label: p ? p.label : '', lang: langCode, liveText: viewer ? els.viewTxt.textContent : (publisher ? els.liveTxt.textContent : ''), langs: Object.keys(I18N).map((k) => ({ code: k, name: I18N[k].langName })), res: $('tvRes').dataset.value, mode: wakeS.mode, histDays: histSum().days, histSize: fmtSize(histSum().bytes) };
}
/** Opens a sheet; resolves with the chosen option / action id, or null when dismissed. */
function openSheet(kind) {
  if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(null); }   // a sheet over a sheet: the first one is dismissed
  const m = sheetModel(kind, sheetCtx(), T), d = sheetOpen(uiS, kind);
  $('sheetTitle').textContent = m.title;
  const lead = $('sheetLead'); lead.textContent = m.lead || ''; lead.className = 'lead' + (m.tone ? ' ' + m.tone : ''); lead.hidden = !m.lead;
  renderSheetProgress(m); renderSheetItems(m);
  $('sheetRows').innerHTML = m.rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('');
  $('sheetOpts').innerHTML = m.options.map((o) => `<button type="button" data-opt="${esc(o.id)}"${o.on ? ' class="on"' : ''}>${esc(o.label)}</button>`).join('');
  $('sheetActs').innerHTML = m.actions.map((x) => `<button type="button" data-act="${esc(x.id)}" class="${x.primary ? 'demobtn' : 'linkbtn'}"${x.primary ? ' style="padding:10px 18px"' : ''}>${esc(x.label)}</button>`).join('');
  $('sheet').hidden = false; $('sheetBox').style.transform = ''; $('sheetBox').scrollTop = 0;
  if (!d.replace) history.pushState({ sheet: kind }, '');
  log(`ui: sheet ${kind}`);
  return new Promise((ok) => { sheetResolve = ok; });
}
function renderSheetProgress(m) { const p = $('sheetProg'); p.hidden = m.progress === undefined; if (!p.hidden) $('sheetBar').style.width = `${m.progress}%`; }
function renderSheetItems(m) {
  const el = $('sheetItems'); const items = m.items || []; el.hidden = !items.length;
  el.innerHTML = items.map((i) => `<div class="item"><span class="nm">${esc(i.name)}</span><span class="sz">${esc(i.size)}</span>${i.del ? `<button type="button" class="stBtn danger" data-del="${esc(i.id)}">${esc(T.browseDel)}</button>` : ''}</div>`).join('');
}
/** Refresh the open sheet's text and bar from the state (a progress sheet), without touching history. */
function updateSheet(kind) {
  if (!uiS.sheet || uiS.sheet.kind !== kind) return;
  const m = sheetModel(kind, sheetCtx(), T);
  const lead = $('sheetLead'); lead.textContent = m.lead || ''; lead.hidden = !m.lead;
  renderSheetProgress(m); renderSheetItems(m);
  const acts = m.actions.map((x) => `<button type="button" data-act="${esc(x.id)}" class="${x.primary ? 'demobtn' : 'linkbtn'}"${x.primary ? ' style="padding:10px 18px"' : ''}>${esc(x.label)}</button>`).join('');
  if ($('sheetActs').innerHTML !== acts) $('sheetActs').innerHTML = acts;       // a phase may add or drop Cancel
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
  $('sheetItems').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) browseDelete(b.dataset.del).catch((err) => log(`browse: delete failed: ${err.message}`)); });
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
// The upload shows its progress in a sheet with a Cancel (owner ask 2026-09-23): XMLHttpRequest because fetch
// gives no upload progress and no abort of a request body in flight on every Chrome.
const uploadS = { loaded: 0, total: 0, xhr: null };
async function uploadLog(btn) {
  if ((await openSheet('upload')) !== 'ok') { log('log upload: declined at the warning'); return; }
  if (uploadS.xhr) { log('log upload: one is already running'); return; }
  await flushLog();
  let stored = '';
  if (logS.on && logS.file) { try { stored = await hist.logRead(logS.file); } catch { stored = ''; } }
  const ub = uploadBody({ header: logHeaderLines(), ring: logLines.join('\n'), stored, limit: LOG_UPLOAD_MAX });
  log(`log upload: sending the ${ub.source === 'ring' ? 'last lines in memory' : ub.source === 'file' ? 'stored session file' : 'tail of the stored session file'}`);
  const body = ub.body;
  const bytes = new TextEncoder().encode(body);
  const lbl = btn.querySelector('.lbl'); const was = lbl ? lbl.textContent : '';
  if (lbl) lbl.textContent = T.uploading;
  btn.disabled = true;
  uploadS.loaded = 0; uploadS.total = bytes.length;
  const xhr = new XMLHttpRequest(); uploadS.xhr = xhr;
  let finished = false;
  const done = new Promise((res) => {
    xhr.upload.onprogress = (e) => { uploadS.loaded = e.loaded; if (e.lengthComputable) uploadS.total = e.total; updateSheet('uploading'); };
    xhr.onload = () => { finished = true; let j = {}; try { j = JSON.parse(xhr.responseText || '{}'); } catch { /* not json */ } res(xhr.status >= 200 && xhr.status < 300 ? { ok: true, j } : { ok: false, error: j.error || `HTTP ${xhr.status}` }); };
    xhr.onerror = () => { finished = true; res({ ok: false, error: 'network error' }); };
    xhr.onabort = () => { finished = true; res({ ok: false, cancelled: true }); };
  });
  xhr.open('POST', '/batray/api/log'); xhr.setRequestHeader('Content-Type', 'text/plain; charset=utf-8'); xhr.send(bytes);
  log(`log upload: started, ${bytes.length} B`);
  // the sheet resolves on Cancel (or a tap outside / Back, which cancels too), or when the app closes it on completion
  // eslint-disable-next-line house/ui-after-await -- the sheet is this upload's own progress dialog; Cancel on it aborts this xhr
  void openSheet('uploading').then((r) => { if (!finished && r !== 'done') { log(`log upload: cancelled by the user (${uploadS.loaded} of ${uploadS.total} B sent)`); xhr.abort(); } });
  const r = await done;
  uploadS.xhr = null;
  if (uiS.sheet && uiS.sheet.kind === 'uploading') closeSheet('done', r.ok ? 'uploaded' : r.cancelled ? 'cancelled' : 'failed');
  if (r.ok) {
    log(`log uploaded: id ${r.j.id} (${bytes.length} B)`);
    $('uploadId').textContent = T.uploadedId(r.j.id); $('uploadId').hidden = false;
    toast(T.uploadDone(r.j.id), 14000);
  } else if (r.cancelled) toast(T.uploadCancelled, 6000);
  else { log(`log upload failed: ${r.error}`); toast(T.uploadFailed(r.error), 10000); }
  if (lbl) lbl.textContent = was; btn.disabled = false;
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
logLastRun();
void logEnvAsync();
// one line a minute with everything that matters, so a log of a whole night reads as a timeline
setInterval(() => {
  const p = active;
  const age = p && p.lastFrameAt ? Math.round((Date.now() - p.lastFrameAt) / 1000) : null;
  const pub = publisher ? `pub(live=${publisher.state.live} viewers=${publisher.state.viewers} sent=${publisher.state.sent} dropped=${publisher.state.dropped} sig=${publisher.state.sig})` : '';
  const vw = viewer ? `view(live=${viewer.state.live} reader=${viewer.state.reader} received=${viewer.state.received} stale=${viewer.state.stale} sig=${viewer.state.sig})` : '';
  const tvs = tv ? `tv(segs=${tv.state.segs} kb=${Math.round(tv.state.bytes / 1024)} pull=${tv.state.pullAgeS}s err=${tv.state.error || '-'})` : '';
  const mem = performance.memory ? ` heap=${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '';
  const rate = histS.hbDay === histS.day && histS.hbRows !== undefined ? `${histS.todayRows - histS.hbRows}/min` : '-'; histS.hbDay = histS.day; histS.hbRows = histS.todayRows;
  if (wakeS.wanted && document.visibilityState === 'visible' && (!wakeS.held || (wakeS.videoOn && keepVideo && keepVideo.paused))) void syncWake();   // watchdog
  if (viewer && histReqDecision(histS, { live: viewer.state.live, now: Date.now() }).action === 'request') void requestHistory();
  log(hist.statsLine()); hist.statsReset(Date.now());
  log(`hb: vis=${document.visibilityState} online=${navigator.onLine} packs=${packs.size} active=${p ? p.label : '-'} connected=${p ? p.connected : '-'} phase=${p && p.cs ? p.cs.phase : '-'} share=${shareS.phase} tv=${tvS.phase} frameAge=${age === null ? '-' : age + 's'} wake=${wakeS.held} keep=${wakeS.videoOn ? wakeS.mode : 'off'} drops=${wakeS.drops}/${wakeS.refusals} hist=${histS.backend}/${histS.days.length}d/${histS.todayRows}r/${rate}/${histS.contig}c/${pendingRows()}pend${histS.gap ? '/' + histS.gap : ''}/${Math.round(histS.usage / 1048576)}of${Math.round(histS.quota / 1048576)}MB${histS.xfer ? '/xfer' : ''} ${pub} ${vw} ${tvs}${mem}`.replace(/\s+/g, ' '));
}, 60000);
$('langBtn').addEventListener('click', async () => { const code = await openSheet('lang'); if (code && I18N[code]) { try { localStorage.setItem('batray_lang', code); } catch {} log(`language: ${code}`); applyLang(code); } });

// The Connect buttons stay enabled without Web Bluetooth: a tap opens the compat sheet saying why and what to use
// (owner, 2026-10-05) - a disabled button explained nothing.
if (!navigator.bluetooth && !viewMode) setStatus(() => T.noWebBt, 'bad');
applyLang(detectLang());
// Alerts (thresholds -> Chrome notifications; ntfy and the relay watchdog stay off behind NTFY_ENABLED).
// Started after the language is set so the first render has strings.
alerts = initAlerts({
  log, T: () => T, getPacks: () => [...packs.values()], viewMode, toast,
  onStatus: (st) => {
    const el = $('alertNote'); if (!el) return;
    el.hidden = !st.channels.length;
    $('alertTxt').textContent = T.alertNote(st.channels.join(' + ') + (st.watchdog ? ' + ' + T.alertWatch : ''));
  },
});
void initHistory().then(initLogStore);
log(compatLogLine(viewMode ? 'viewer' : 'reader', browserInfo, compatCheck(viewMode ? 'viewer' : 'reader', browserInfo, compatFeatures())));
if (viewMode) startView();
else if (new URLSearchParams(location.search).has('demo')) runDemo();
