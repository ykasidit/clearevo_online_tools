// BatRay by ClearEvo.com - one store per tab: which store a page uses, which it adopts, which may go (pure, tested)
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
// Owner decision 2026-10-06: "remove this history lock, store per tab id - most sites have no such limit; re-download
// the day files per tab is fine, the same for debug logs; Browse can list and delete for all; keep only the settings
// global". Until 0.9.76 every tab of the browser shared ONE SQLite pool (only one tab could store, the others went
// grey) and one set of state keys (the backyard viewer's frozen tab was reported as this tab's crash, 2026-10-05).
//
// Now a tab has an id, kept in sessionStorage (it survives a reload of that tab, and Chrome restores it with the tab),
// and everything that is not a setting is keyed by it: its SQLite pool directory, its debug-log directory and its
// state in localStorage (`batrayTab:<id>:<name>` - outside the `batray_*` settings, so never in a settings backup).
// A page holds the Web Lock `batray-tab-<id>` for as long as it lives: that is how another page tells a live tab from
// a closed one - not a limit on anything. A new tab (no id yet, or a copy of a tab that is still open) takes over the
// store of a CLOSED tab in the same role (a reader; a viewer of the same room), newest first: a reader that Chrome
// closed and someone opened again keeps its history, its share link and its resume plan. The store from before 0.9.77
// (one pool for every tab) is taken by the first reader page.

export const TAB_SS = 'batray_tab';                        // sessionStorage: this tab's id
export const TAB_PREFIX = 'batrayTab:';                    // localStorage: per-tab records and state
export const LEGACY = 'legacy';                            // the store from before 0.9.77
export const ORPHAN_VIEWER_MS = 30 * 86400000;             // a closed viewer tab's copy is freed after this unused
const ID_RX = /^[a-z0-9]{8}$/;

export const tabLock = (id) => `batray-tab-${id}`;
export const tabKey = (id, name) => `${TAB_PREFIX}${id}:${name}`;
export const metaKey = (id) => `${TAB_PREFIX}${id}`;
export const validTabId = (id) => id === LEGACY || (typeof id === 'string' && ID_RX.test(id));
export function newTabId(rand = Math.random) { let s = ''; while (s.length < 8) s += Math.floor(rand() * 36).toString(36); return s.slice(0, 8); }
/** Where a store lives in the origin's private files: the SQLite pool directory and the debug-log directory. */
export function storeDirs(id) { return id === LEGACY ? { db: 'batray-history-db', logs: 'logs' } : { db: `batray-db-${id}`, logs: `logs-${id}` }; }
/** The store id a directory name belongs to (the inverse of storeDirs), or null. */
export function storeOfDir(name) {
  if (name === 'batray-history-db') return LEGACY;
  const m = /^batray-db-([a-z0-9]{8})$/.exec(name); return m ? m[1] : null;
}
export function storeOfLogDir(name) {
  if (name === 'logs') return LEGACY;
  const m = /^logs-([a-z0-9]{8})$/.exec(name); return m ? m[1] : null;
}

/** A tab's record: role, the room a viewer watches, the channel name it last showed, when it was last alive. */
export function tabMeta({ id, role, room = null, channel = '', at }) { return { id, role, room: role === 'viewer' ? room : null, channel: String(channel || '').slice(0, 40), at }; }
export function parseMeta(id, raw) {
  if (!validTabId(id)) return null;
  try {
    const m = JSON.parse(raw);
    if (!m || (m.role !== 'reader' && m.role !== 'viewer') || typeof m.at !== 'number') return null;
    return tabMeta({ id, role: m.role, room: typeof m.room === 'string' ? m.room : null, channel: m.channel, at: m.at });
  } catch { return null; }
}
/** Every tab record in localStorage entries ([key, value] pairs). */
export function tabRecords(entries) {
  const out = [];
  for (const [k, v] of entries) {
    if (typeof k !== 'string' || !k.startsWith(TAB_PREFIX)) continue;
    const id = k.slice(TAB_PREFIX.length); if (id.includes(':')) continue;      // `batrayTab:<id>` only, not its state keys
    const m = parseMeta(id, v); if (m) out.push(m);
  }
  return out;
}

/** Which store this page uses. sessionId: the id this tab kept (or null); live: ids whose tab lock is held by
 *  another page; role 'reader' | 'viewer'; room: the viewed room; records: tabRecords(); legacy: the pre-0.9.77
 *  store exists. Returns { id, how: 'same' | 'adopt' | 'legacy' | 'new', from, why }. */
export function chooseTab({ sessionId = null, live = new Set(), role, room = null, records = [], legacy = false, rand = Math.random }) {
  if (sessionId && validTabId(sessionId) && !live.has(sessionId)) return { id: sessionId, how: 'same', from: null, why: 'this tab, as before' };
  const copy = !!(sessionId && live.has(sessionId));
  const cands = records.filter((r) => r.role === role && (role === 'reader' || r.room === room) && !live.has(r.id)).sort((a, b) => b.at - a.at);
  if (cands.length) {
    const c = cands[0];
    return { id: c.id, how: c.id === LEGACY ? 'legacy' : 'adopt', from: c, why: `takes over the store of a closed ${role} tab (last alive ${new Date(c.at).toISOString()})` };
  }
  if (role === 'reader' && legacy && !live.has(LEGACY) && !records.some((r) => r.id === LEGACY)) return { id: LEGACY, how: 'legacy', from: null, why: 'takes over the store from before 0.9.77' };
  return { id: newTabId(rand), how: 'new', from: null, why: copy ? 'a copy of a tab that is still open: a store of its own' : 'a new tab: a store of its own' };
}

/** Closed viewer tabs' stores to free: older than ORPHAN_VIEWER_MS, or all of them (oldest first) when space is low.
 *  A viewer's store is a copy the reader can send again; a reader's is the original and is never freed here. */
export function orphanDrops({ records, live, own, now, lowSpace = false }) {
  const v = records.filter((r) => r.role === 'viewer' && r.id !== own && !live.has(r.id)).sort((a, b) => a.at - b.at);
  return lowSpace ? v.map((r) => r.id) : v.filter((r) => now - r.at > ORPHAN_VIEWER_MS).map((r) => r.id);
}

/** Per-tab state names, and where each lived before 0.9.77 (global keys, moved into the tab that takes the legacy store). */
export const TAB_STATE = { lastrun: 'batray_lastrun', boot_prev: 'batray_boot', spill: 'batray_hist_spill', resume: 'batray_resume', share_last: 'batray_share_last', share_name: 'batray_share_name', known_dev: 'batray_known_dev' };
export const LEGACY_DROP = ['batray_boot_prev'];
export function legacyMoves(id) { return Object.entries(TAB_STATE).map(([name, from]) => [from, tabKey(id, name)]); }

/** Browse: one line per OTHER store (this tab's own day files are listed as before). */
export function storeRows({ stores, records, live, own }) {
  const byId = new Map(records.map((r) => [r.id, r]));
  return stores.filter((s) => s.id !== own).map((s) => {
    const r = byId.get(s.id) || null;
    return { id: s.id, role: r ? r.role : null, room: r ? r.room : null, channel: r ? r.channel : '', at: r ? r.at : null, bytes: (s.bytes || 0) + (s.logBytes || 0), inUse: live.has(s.id), legacy: s.id === LEGACY };
  }).sort((a, b) => (Number(a.inUse) - Number(b.inUse)) || ((b.at || 0) - (a.at || 0)));
}
