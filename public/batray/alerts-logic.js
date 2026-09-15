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
];
export const REPEAT_S = 1800;
export const DAYLIGHT = { fromH: 9, toH: 15 }; // local hours during which "no charge" is suspicious

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

/** Is the condition of `rule` true for this pack sample? sample: { soc, current, cellDelta, ageS, connected }, at: Date */
export function conditionHolds(rule, cfg, sample, at) {
  switch (rule.kind) {
    case 'below': return sample.soc !== null && sample.soc !== undefined && sample.soc < cfg.value;
    case 'above': return sample.cellDelta !== null && sample.cellDelta !== undefined && sample.cellDelta > cfg.value;
    case 'noChargeDaylight': {
      const h = at.getHours() + at.getMinutes() / 60;
      if (h < DAYLIGHT.fromH || h >= DAYLIGHT.toH) return false;
      return sample.current !== null && sample.current !== undefined && sample.current < cfg.value;
    }
    // Age of the last frame only: a Bluetooth drop that reconnects within the
    // window must not alert, and a pack that never sent a frame has no age.
    case 'silent': return sample.ageS !== null && sample.ageS !== undefined && sample.ageS > cfg.value;
    default: return false;
  }
}

/**
 * Evaluator: keeps per-pack, per-rule state and returns the notifications
 * due at this tick. Call `tick(packId, sample, now)` every few seconds.
 * Each event: { rule, packId, packName, event: 'fire'|'repeat'|'recover', priority, value, sample }
 */
export class Evaluator {
  constructor(settings) { this.settings = settings; this.state = new Map(); }
  setSettings(s) { this.settings = s; }
  key(packId, ruleId) { return `${packId}|${ruleId}`; }
  forget(packId) { for (const k of [...this.state.keys()]) if (k.startsWith(packId + '|')) this.state.delete(k); }

  tick(packId, packName, sample, now = Date.now()) {
    const out = [];
    const at = new Date(now);
    for (const rule of RULES) {
      const cfg = this.settings.rules[rule.id];
      const k = this.key(packId, rule.id);
      const st = this.state.get(k) || { since: null, firedAt: null, lastAt: null };
      const holds = !!cfg.on && conditionHolds(rule, cfg, sample, at);
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
  const body = ev.event === 'recover' ? A.recovered(f({ ...ev, soc, cur, dv })) : f({ ...ev, soc, cur, dv });
  return { title, body };
}

/** Validation for ntfy settings. */
export function ntfyOk(n) {
  return /^https?:\/\/[^/\s]+$/.test(n.server || '') && /^[A-Za-z0-9_-]{1,64}$/.test(n.topic || '');
}
