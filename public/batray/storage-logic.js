// BatRay by ClearEvo.com - Storage box pure decisions: usage percent, the three rows, what a settings file may hold
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
// Source: https://github.com/ykasidit/clearevo_online_tools//
// The Storage box under the History chart (owner ask 2026-09-23): used of
// the browser's maximum with a percent on top, one row per storage eater
// (history data, settings, debug logs) with Back up / Restore / Delete.
// Settings are the app's localStorage keys; this module decides what a
// settings file may contain.

export const SETTINGS_KEY_RX = /^(batray_[a-z_]+|ce_zoom)$/;
export const SETTINGS_MAX_BYTES = 64 * 1024;
export const SETTINGS_MAX_KEYS = 200;
const utf8 = new TextEncoder();

/** The app's own keys out of a [key, value] listing of localStorage. */
export function settingsSnapshot(entries) {
  const out = {};
  for (const [k, v] of entries) if (SETTINGS_KEY_RX.test(k) && typeof v === 'string') out[k] = v;
  return out;
}
export function settingsBytes(snapshot) { let n = 0; for (const [k, v] of Object.entries(snapshot)) n += utf8.encode(k).length + utf8.encode(v).length; return n; }
export const settingsFileName = (day) => `batray-settings-${day}.json`;
/** The file to write: a small self-describing JSON. */
export function settingsFile(snapshot, version, nowIso) { return { app: 'BatRay', version, saved: nowIso, settings: snapshot }; }
/** A settings file someone picked: what may be applied. */
export function settingsRestorePlan(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'BatRay' || !obj.settings || typeof obj.settings !== 'object') return { ok: false, why: 'not a settings file' };
  const keys = Object.keys(obj.settings).filter((k) => SETTINGS_KEY_RX.test(k) && typeof obj.settings[k] === 'string');
  if (!keys.length) return { ok: false, why: 'no settings in it' };
  if (keys.length > SETTINGS_MAX_KEYS) return { ok: false, why: 'too many keys' };
  const apply = {}; for (const k of keys) apply[k] = obj.settings[k];
  if (settingsBytes(apply) > SETTINGS_MAX_BYTES) return { ok: false, why: 'too big' };
  return { ok: true, apply, skipped: Object.keys(obj.settings).length - keys.length };
}
/** The Browse sheet's list for one kind of storage: every file (or key) with its size, and whether it may go on its own.
 *  hist: [{day, raw, gz, bytes}] with `today`; set: a settings snapshot; log: [{name, bytes}] with the current file. */
export function browseItems(type, data) {
  if (type === 'hist') return [...(data.days || [])].sort((a, b) => (a.day < b.day ? 1 : -1)).map((d) => ({ id: d.day, name: d.day + (d.gz ? '.ndjson.gz' : '.ndjson') + (d.day === data.today ? ' (today, live)' : ''), bytes: d.bytes || 0, del: true }));
  if (type === 'set') return Object.entries(data.snapshot || {}).sort().map(([k, v]) => ({ id: k, name: k, bytes: utf8.encode(k).length + utf8.encode(v).length, del: true }));
  if (type === 'log') return [...(data.files || [])].sort((a, b) => (a.name < b.name ? 1 : -1)).map((f) => ({ id: f.name, name: f.name + (f.name === data.current ? ' (this session, live)' : ''), bytes: f.bytes || 0, del: true }));
  return [];
}
/** This tab's JavaScript heap against the limit Chrome gives it (owner ask 2026-09-23: see the limit coming before
 *  an "Aw, Snap"). `perf` = performance.memory (Chrome only); null where the browser has no such figure. */
export const MEM_LOG_MS = 15000;
export function memoryModel(perf) {
  if (!perf || !perf.jsHeapSizeLimit) return null;
  const used = perf.usedJSHeapSize || 0, total = perf.totalJSHeapSize || 0, limit = perf.jsHeapSizeLimit;
  return { used, total, limit, pct: usagePct(used, limit), near: used / limit >= 0.8 };
}
/** Percent of the browser's maximum, readable at both ends (0.02 %, 100 %). */
export function usagePct(usage, quota) {
  if (!quota) return null;
  const p = usage * 100 / quota;
  return p >= 10 ? Math.round(p) : p >= 1 ? Math.round(p * 10) / 10 : Math.round(p * 100) / 100;
}
/** The box: header numbers and the three rows, from plain facts. */
export function storageModel({ usage = 0, quota = 0, backend = 'opfs', hist = {}, settings = {}, logs = {} }) {
  return {
    used: usage, max: quota, pct: usagePct(usage, quota), stored: backend !== 'memory',
    rows: [
      { id: 'hist', bytes: hist.bytes || 0, days: hist.days || 0, since: hist.oldest || null, canBackup: backend !== 'memory' && (hist.days || 0) > 0, canRestore: backend !== 'memory', canDelete: backend !== 'memory' && (hist.days || 0) > 0 },
      { id: 'set', bytes: settings.bytes || 0, count: settings.count || 0, canBackup: (settings.count || 0) > 0, canRestore: true, canDelete: (settings.count || 0) > 0 },
      { id: 'log', bytes: logs.bytes || 0, files: logs.files || 0, session: logs.session || 0, sid: logs.sid || '', canBackup: backend !== 'memory' && (logs.files || 0) > 0, canRestore: false, canDelete: backend !== 'memory' && (logs.files || 0) > 0 },
    ],
  };
}
