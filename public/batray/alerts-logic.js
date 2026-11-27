// BatRay by ClearEvo.com - alert rules, evaluator and message formatting (pure, tested)
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

// Alert rules for BatRay: pure, testable. Each rule watches one pack; a rule
// fires after its condition has held for `holdS` seconds, re-fires every
// `repeatS` while it still holds, and sends one "recovered" when it clears.
// Nothing here talks to the network or the DOM.

export const RULES = [
  // id, default threshold, hold seconds, priority (ntfy 1-5), what it compares
  { id: 'socLow',      on: true, value: 40,   holdS: 300,  priority: 3, unit: '%',  kind: 'below', tag: 'battery' },
  { id: 'socCritical', on: true, value: 25,   holdS: 120,  priority: 5, unit: '%',  kind: 'below', tag: 'rotating_light' },
  { id: 'noCharge',    on: true, value: 1,    holdS: 1800, priority: 4, unit: 'A',  kind: 'noChargeDaylight', tag: 'sunny' },
  { id: 'cellDelta',   on: true, value: 0.10, holdS: 600,  priority: 3, unit: 'V',  kind: 'above', tag: 'warning' },
  { id: 'silent',      on: true, value: 300,  holdS: 0,    priority: 4, unit: 's',  kind: 'silent', tag: 'no_entry' },
  // every BMS app (JK, Daly, JBD) puts the fault line on its first screen; a
  // protection that trips deserves a notification too (benchmark 2026-09-17)
  { id: 'bmsAlarm',    on: true, value: 0,    holdS: 10,   priority: 5, unit: '',   kind: 'alarm', tag: 'rotating_light' },
];
export const REPEAT_S = 1800;
export const DAYLIGHT = { fromH: 9, toH: 15 }; // local hours during which "no charge" is suspicious
export const FULL_SOC = 95;                      // a pack this full has nothing to charge (2026-11-27 log: "not charging" at 100 %)
export const FRESH_S = 120;                      // a reading older than this is not judged (the silent rule judges its age)

export function defaultSettings() {
  return {
    channels: { ntfy: false, chrome: false },
    ntfy: { server: 'https://ntfy.sh', topic: '', token: '' },
    watchdog: { on: false, timeoutS: 600 },
    // presence events: a viewer joining/leaving (shown on the reader) and the
    // reader going online/offline (shown on a viewer), this device's internet/server
    events: { viewers: true, reader: true, net: true },
    rules: Object.fromEntries(RULES.map((r) => [r.id, { on: r.on, value: r.value, holdS: r.holdS }])),
  };
}

/** Merge stored settings over defaults, keeping unknown keys out. */
export function loadSettings(stored) {
  const d = defaultSettings();
  if (!stored || typeof stored !== 'object') return d;
  const s = d;
  if (stored.channels) { s.channels.ntfy = !!stored.channels.ntfy; s.channels.chrome = !!stored.channels.chrome; }
  if (stored.ntfy) { for (const k of ['server', 'topic', 'token']) if (typeof stored.ntfy[k] === 'string') s.ntfy[k] = stored.ntfy[k].trim(); }
  if (stored.watchdog) { s.watchdog.on = !!stored.watchdog.on; if (Number.isFinite(+stored.watchdog.timeoutS)) s.watchdog.timeoutS = Math.max(120, Math.min(86400, +stored.watchdog.timeoutS)); }
  if (stored.events) { for (const k of ['viewers', 'reader', 'net']) if (typeof stored.events[k] === 'boolean') s.events[k] = stored.events[k]; }
  if (stored.rules) for (const r of RULES) {
    const x = stored.rules[r.id]; if (!x) continue;
    s.rules[r.id].on = !!x.on;
    if (Number.isFinite(+x.value)) s.rules[r.id].value = +x.value;
    if (Number.isFinite(+x.holdS)) s.rules[r.id].holdS = Math.max(0, +x.holdS);
  }
  return s;
}

/** Is the condition of `rule` true for this pack sample? sample: { soc, current, cellDelta, ageS, connected, alarm, ownLinkDown }, at: Date */
export function conditionHolds(rule, cfg, sample, at) {
  switch (rule.kind) {
    case 'below': return sample.soc !== null && sample.soc !== undefined && sample.soc < cfg.value;
    case 'above': return sample.cellDelta !== null && sample.cellDelta !== undefined && sample.cellDelta > cfg.value;
    case 'noChargeDaylight': {
      const h = at.getHours() + at.getMinutes() / 60;
      if (h < DAYLIGHT.fromH || h >= DAYLIGHT.toH) return false;
      if (typeof sample.soc === 'number' && sample.soc >= FULL_SOC) return false;
      return sample.current !== null && sample.current !== undefined && sample.current < cfg.value;
    }
    // Age of the last frame only: a Bluetooth drop that reconnects within the
    // window must not alert, and a pack that never sent a frame has no age.
    case 'silent': return sample.ageS !== null && sample.ageS !== undefined && sample.ageS > cfg.value;
    case 'alarm': return !!sample.alarm;
    default: return false;
  }
}

/**
 * Evaluator: keeps per-pack, per-rule state and returns the notifications
 * due at this tick. Call `tick(packId, sample, now)` every few seconds.
 * Each event: { rule, packId, packName, event: 'fire'|'repeat'|'recover', priority, value, sample }
 */
// A gap between ticks longer than this means the page itself was frozen or asleep (Android freezes a hidden tab
// for hours): the silence was ours, not the BMS's. The viewer log of 2026-09-30 fired "no data for over 5 min" and
// "recovered" 4 s apart on every resume. Silence counts only while this page has been awake and its link up.
// 150 s, not less: Chrome wakes a timer in a tab hidden for 5 min only about once a minute (intensive throttling),
// and such a tab still receives readings; the freezes in the logs were 15 min and longer (Fable review 2026-11-27).
export const TICK_GAP_S = 150;
export class Evaluator {
  constructor(settings) { this.settings = settings; this.state = new Map(); this.lastAbleAt = null; this.awakeSince = null; this.lastTick = new Map(); }
  /** Seconds this page has been able to receive: ticking without a gap, and (a viewer) with its link up. */
  watchedS(now) { return this.awakeSince === null ? 0 : (now - this.awakeSince) / 1000; }
  setSettings(s) { this.settings = s; }
  key(packId, ruleId) { return `${packId}|${ruleId}`; }
  forget(packId) { for (const k of [...this.state.keys()]) if (k.startsWith(packId + '|')) this.state.delete(k); this.lastTick.delete(packId); }

  tick(packId, packName, sample, now = Date.now()) {
    const out = [];
    const at = new Date(now);
    const able = !sample.ownLinkDown;
    if (able) { if (this.lastAbleAt === null || now - this.lastAbleAt > TICK_GAP_S * 1000) this.awakeSince = now; this.lastAbleAt = now; }
    // frozen time is nobody's: after a gap every hold and repeat clock of this pack starts again from the wake
    // (2026-11-23..26 viewer logs: 4-8 alerts from the pre-freeze reading within 100 ms of every wake)
    const prev = this.lastTick.get(packId);
    this.lastTick.set(packId, now);
    const woke = prev !== undefined && now - prev > TICK_GAP_S * 1000;
    // a rule about the reading is judged only on a fresh one: a viewer's old reading, or a reader's last one before
    // a drop, holds its state (no fire, no repeat, no recover) - the silent rule speaks for the gap
    const fresh = able && typeof sample.ageS === 'number' && sample.ageS <= FRESH_S;
    for (const rule of RULES) {
      const cfg = this.settings.rules[rule.id];
      const k = this.key(packId, rule.id);
      const st = this.state.get(k) || { since: null, firedAt: null, lastAt: null };
      if (woke) { if (st.since !== null) st.since = now; if (st.lastAt !== null) st.lastAt = now; this.state.set(k, st); }
      if (rule.kind === 'silent' && !able) continue;                        // our own link is down: the BMS's silence cannot be judged, keep the state as is
      if (rule.kind !== 'silent' && !fresh) {                              // not judged: a hold not yet fired starts again with the next fresh reading
        if (st.firedAt === null && st.since !== null) { st.since = null; this.state.set(k, st); }
        continue;
      }
      const holds = !!cfg.on && conditionHolds(rule, cfg, sample, at) && (rule.kind !== 'silent' || this.watchedS(now) > cfg.value);
      if (holds) {
        if (st.since === null) st.since = now;
        const heldS = (now - st.since) / 1000;
        if (st.firedAt === null && heldS >= cfg.holdS) { st.firedAt = now; st.lastAt = now; out.push(this.ev(rule, cfg, packId, packName, 'fire', sample)); }
        else if (st.firedAt !== null && now - st.lastAt >= REPEAT_S * 1000) { st.lastAt = now; out.push(this.ev(rule, cfg, packId, packName, 'repeat', sample)); }
      } else {
        if (st.firedAt !== null) out.push(this.ev(rule, cfg, packId, packName, 'recover', sample));
        st.since = null; st.firedAt = null; st.lastAt = null;
      }
      this.state.set(k, st);
    }
    return out;
  }
  ev(rule, cfg, packId, packName, event, sample) {
    return { rule: rule.id, packId, packName, event, priority: event === 'recover' ? 2 : rule.priority, tag: event === 'recover' ? 'white_check_mark' : rule.tag, value: cfg.value, holdS: cfg.holdS, sample: { ...sample } };
  }
}

/** Human text for an event, in the given language table (T.alerts). */
export function formatEvent(ev, A) {
  const s = ev.sample;
  const soc = s.soc === null || s.soc === undefined ? '-' : `${s.soc}%`;
  const cur = s.current === null || s.current === undefined ? '-' : `${s.current.toFixed(1)} A`;
  const dv = s.cellDelta === null || s.cellDelta === undefined ? '-' : `${Math.round(s.cellDelta * 1000)} mV`;
  const f = A[ev.rule] || ((e) => `${e.rule}`);
  const title = ev.event === 'recover' ? A.recoveredTitle(ev.packName) : A.title(ev.packName);
  const alarm = s.alarm || '-';
  const body = ev.event === 'recover' ? A.recovered(f({ ...ev, soc, cur, dv, alarm })) : f({ ...ev, soc, cur, dv, alarm });
  return { title, body };
}

/** Validation for ntfy settings. */
export function ntfyOk(n) {
  return /^https?:\/\/[^/\s]+$/.test(n.server || '') && /^[A-Za-z0-9_-]{1,64}$/.test(n.topic || '');
}
