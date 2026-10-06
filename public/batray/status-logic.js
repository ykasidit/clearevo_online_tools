// BatRay by ClearEvo.com - the reader's status for its viewers and its own next start (pure, tested)
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
// Owner ask 2026-10-06, after the h46 reader went offline with the screen off and its tab gone, and nothing anywhere
// said when or how: "keep some last status in server and chrome storage ... show that last ts datetime from reader and
// how many minutes / days ago, how much soc ... phone soc, charging, mem state, sqlite storage state, chrome ver, each
// api available or not, for debugging".
//
// The reader sends a status envelope every STATUS_EVERY_MS, at once when something that matters changes, and as
// "last words" when the page is hidden, frozen or unloaded. It travels encrypted like a reading; the room keeps the
// newest one, so a viewer that opens the link while the reader is gone still learns what the reader last said. The
// relay adds only what it saw of the connection itself (when the reader's socket ended and its close code). The same
// snapshot goes into the reader's own last-run record, so its next start logs it.


export const STATUS_EVERY_MS = 60000;

const mb = (b) => (typeof b === 'number' && b > 0 ? Math.round(b / 1048576) : null);

/** The status as plain facts. Every input is optional: a missing API gives null, never a guess.
 *  @param {any} [o] */
export function statusSnapshot({
  why = 'tick', now, startedAt, ver = '', sid = '', visible = true, batt = null, mem = null, usage = null, quota = null,
  hist = null, log = null, browser = null, missing = [], wake = false, net = null, packs = [], prev = null, sharing = false, setup = null,
} = {}) {
  return {
    why, t: now, up: startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : null, ver, sid, vis: !!visible,
    bat: batt && typeof batt.level === 'number' ? { pct: Math.round(batt.level * 100), chg: !!batt.charging } : null,
    mem: mem ? { used: mb(mem.used), limit: mb(mem.limit), pct: mem.pct ?? null } : null,
    sto: { used: mb(usage), quota: mb(quota) },
    hist: hist ? { backend: hist.backend || '?', days: hist.days || 0, rows: hist.rows || 0, pend: hist.pend || 0, fails: hist.fails || 0 } : null,
    log: log ? { on: !!log.on, files: log.files || 0, kb: Math.round((log.bytes || 0) / 1024) } : null,
    br: browser ? `${browser.name} ${browser.version}` : '', os: browser ? browser.os || '' : '',
    miss: [...missing], wake: !!wake, sharing: !!sharing,
    net: net ? { on: net.online !== false, type: net.type || '' } : null,
    packs: packs.map((p) => ({ name: String(p.name || '').slice(0, 32), conn: !!p.connected, at: p.at || null, soc: p.soc ?? null, v: p.v ?? null, a: p.a ?? null })),
    prev: prev ? { clean: !!prev.clean, at: prev.at || null } : null,
    setup: setup ? { ready: setup.ready, total: setup.total, missing: [...setup.missing], todo: [...setup.todo], off: [...(setup.off || [])] } : null,   // the reader checklist (0.9.72)
  };
}

/** What changing is worth sending at once (the rest waits for the minute): visibility, charging, a 10 % battery
 *  step, a pack connecting or dropping, the history store falling back to memory, the network, the wake lock. */
export function statusChanged(a, b) {
  if (!a || !b) return true;
  const key = (s) => [s.vis, s.bat ? s.bat.chg : '-', s.bat ? Math.floor(s.bat.pct / 10) : '-', s.packs.map((p) => `${p.name}:${p.conn}`).join(','),
    s.hist ? s.hist.backend : '-', s.net ? s.net.on : '-', s.wake, s.sharing].join('|');
  return key(a) !== key(b);
}
/** Send now? Always for last words and the first one; on a change; else once a minute. */
export function statusDue({ lastSentAt, now, changed, why = 'tick' }) {
  if (why !== 'tick') return true;
  if (!lastSentAt) return true;
  return changed || now - lastSentAt >= STATUS_EVERY_MS;
}

/** How the reader went away, from what it said last and how the relay saw its socket end:
 *  'closed'     the page was closed, reloaded or navigated away (last words 'pagehide', or close code 1001)
 *  'frozen'     Chrome froze the page (last words 'freeze') and it never came back
 *  'hidden'     the page went to the background or the screen went off, then nothing more: Chrome or Android
 *               stopped it, or its network went with the screen
 *  'unanswered' the reader closed its own socket after its pings went unanswered, and never came back: its network
 *  'vanished'   the socket just dropped (1006) with the page in front: the app or phone was killed, or the network
 *  'unknown'    none of the above */
export function endReason({ code = null, lastWhy = null, lastVis = null } = {}) {
  if (lastWhy === 'pagehide' || code === 1001) return 'closed';
  if (lastWhy === 'freeze') return 'frozen';
  if (lastWhy === 'hidden' || lastVis === false) return 'hidden';
  if (code === 4001) return 'unanswered';
  if (code === 1006) return 'vanished';
  return 'unknown';
}

/** The viewer's picture of an absent reader: when it was last heard from (the relay's word when it has one, else the
 *  last status), how it ended, and what it last said. `status` = the last status envelope's value, `statusAt` = when it
 *  was sent (local clock estimate), `gone` = { at, code, reason } from the relay (local clock estimate). */
export function offlineModel({ status = null, statusAt = null, gone = null, now }) {
  if (!status && !gone) return null;
  const since = gone && gone.at ? gone.at : statusAt;
  const lastReading = status ? Math.max(0, ...status.packs.map((p) => p.at || 0)) || null : null;
  return {
    since, agoMs: since ? Math.max(0, now - since) : null,
    reason: endReason({ code: gone ? gone.code : null, lastWhy: status ? status.why : null, lastVis: status ? status.vis : null }),
    code: gone ? gone.code : null,
    packs: status ? status.packs : [], lastReading,
    bat: status ? status.bat : null, br: status ? status.br : '', hist: status ? status.hist : null, ver: status ? status.ver : '',
    statusAt, why: status ? status.why : null,
  };
}

/** One compact line for a log: everything in the snapshot, short. */
/** One log line of a status. A viewer reads statuses from a reader of any version, so a missing field reads '?'. */
export function statusLine(s) {
  if (!s) return '-';
  const packs = (Array.isArray(s.packs) ? s.packs : []).map((p) => `${p.name} ${p.conn ? 'on' : 'off'}${p.soc !== null ? ` ${p.soc}%` : ''}${p.v !== null ? ` ${p.v}V` : ''}${p.a !== null ? ` ${p.a}A` : ''}${p.at ? ` @${new Date(p.at).toISOString().slice(11, 19)}` : ''}`).join('; ') || 'no pack';
  return [
    `why=${s.why}`, `vis=${s.vis ? 'yes' : 'no'}`, `up=${s.up ?? '?'}s`,
    `phone=${s.bat ? `${s.bat.pct}%${s.bat.chg ? ' charging' : ' not charging'}` : '?'}`,
    `mem=${s.mem ? `${s.mem.used ?? '?'}/${s.mem.limit ?? '?'}MB` : '?'}`,
    `storage=${s.sto ? `${s.sto.used ?? '?'}/${s.sto.quota ?? '?'}` : '?/?'}MB`,
    `hist=${s.hist ? `${s.hist.backend}/${s.hist.days}d/${s.hist.rows}r/${s.hist.pend}pend${s.hist.fails ? `/${s.hist.fails}fail` : ''}` : '?'}`,
    `log=${s.log ? (s.log.on ? `${s.log.files}f/${s.log.kb}KB` : 'off') : '?'}`,
    `${s.br || '?'}${s.os ? ` ${s.os}` : ''}`, `missing=${Array.isArray(s.miss) && s.miss.length ? s.miss.join(',') : 'none'}`,
    `wake=${s.wake ? 'held' : 'no'}`, `share=${s.sharing ? 'on' : 'off'}`,
    `net=${s.net ? `${s.net.on ? 'online' : 'OFFLINE'}${s.net.type ? ' ' + s.net.type : ''}` : '?'}`,
    `setup=${s.setup ? `${s.setup.ready}/${s.setup.total}${(s.setup.missing || []).length ? ` missing:${s.setup.missing.join(',')}` : ''}${(s.setup.todo || []).length ? ` todo:${s.setup.todo.join(',')}` : ''}` : '?'}`,
    `v${s.ver}`, `sid=${s.sid}`, `packs: ${packs}`,
  ].join(' ');
}

// ---- the reader PHONE's own battery, as a viewer sees it (0.9.80, owner 2026-10-06: the seahut reader phone went off
// because its battery ran out - its charger was not connected). Chrome on Android gives a page the level and whether a
// charger is connected (navigator.getBattery); the reader sends both in its status, at once when charging changes.
export const PHONE_LOW_PCT = 20;
export function phonePowerState() { return { seen: false, chg: null, low: false }; }
/** A fresh reader status: 'low' (not charging and at or under PHONE_LOW_PCT, once per dip), 'unplugged' (was charging,
 *  now not), 'plugged' (was not, now is), else null. The first status a viewer sees raises no plug event (it says
 *  what the phone does now, not a change), only 'low'. */
export function phonePowerEvent(ps, bat) {
  if (!bat || typeof bat.pct !== 'number') return null;
  const first = !ps.seen, was = ps.chg, low = !bat.chg && bat.pct <= PHONE_LOW_PCT;
  ps.seen = true; ps.chg = !!bat.chg;
  let ev = null;
  if (low && !ps.low) ev = 'low';
  else if (!first && was === true && !bat.chg) ev = 'unplugged';
  else if (!first && was === false && bat.chg) ev = 'plugged';
  ps.low = low;
  return ev;
}
/** The warning line on a viewer: shown while the reader phone is not charging; null when it charges or nobody knows. */
export function phoneWarn(bat) { return bat && typeof bat.pct === 'number' && !bat.chg ? { pct: bat.pct, low: bat.pct <= PHONE_LOW_PCT } : null; }
