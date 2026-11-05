// BatRay by ClearEvo.com - the Bluetooth connection of one pack: ONE loop, one writer (0.9.83)
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
// The house rule (owner, 2026-10-01: "one function with a loop, waiting on a latch with a timeout - the state is in the
// lines of code"), applied to Bluetooth. Until 0.9.82 the connection was an event machine: the GATT callbacks, a
// 4 s watchdog timer, a countdown interval, an attempt ticker and a retry timeout each fed events into one state
// object, and two of them acted on the same link at once (the seahut reader, 2026-10-29: the watchdog dropped 1760
// links an attempt was still building). Now `run(signal)` is a kthread, and the phase is where it is:
//
//   idle       waits for a command: connect -> choosing, known / now -> connecting
//   choosing   closes a link that is up, opens the browser's picker; cancelled -> idle
//   connecting up to 3 attempts of 15 s, 1.5 s apart -> connected; all failed -> countdown (or idle)
//   connected  serves the link (handshake, asks, nudge, stall check) -> countdown when it falls or goes quiet,
//              idle on the person's Disconnect, choosing on Connect
//   countdown  10 s (3 s after a stall, 5 s after a refused pick) -> connecting; Cancel -> idle
//   stuck      a browser connect pending past 45 s (it ran with Bluetooth off): waits for it to settle -> countdown
//
// Every wait is select() over the stop signal, a timeout and the command channel;
// the GATT boundary (jkbms.js) only sets Flags (down / voided / infoSeen), a tap only pushes a command. What a
// command means and what follows the end of a link are pure tables in conn-logic.js; what to do on a connected link
// each tick is jkbms.js linkStep(). The app (h) paints and logs; it never writes the state.

import { Channel, select, sleep, isAbort, deadline } from './sync.js';
import { connState, cmdIn, retryDecision, afterEnd, CONNECT_S, CONNECT_GAP_MS, SERVE_TICK_MS, DOWN_WAIT_MS, RECONNECT_S } from './conn-logic.js';
import { buildCommand, CMD_CELL_INFO, STUCK_MS, HANDSHAKE_WAIT_MS, linkStep } from './jkbms.js';

/** The app's hooks paint and log; one that throws must not take the connection down with it (BLE review 2026-11-01:
 *  a paint exception in a hook had ended the loop for good). choose and fresh are awaited by the loop: their own
 *  errors stay theirs. */
function guardHooks(h) {
  const g = { ...h };
  for (const k of Object.keys(h)) {
    if (k === 'choose' || k === 'fresh' || typeof h[k] !== 'function') continue;
    g[k] = (...a) => { try { return h[k](...a); } catch (e) { try { h.log(`conn: the app's ${k} hook threw: ${e && e.message}`); } catch { /* the log itself */ } return undefined; } };
  }
  return g;
}
/** A promise that never rejects: { ok: true, v } or { ok: false, e } - an abandoned wait leaves no unhandled rejection. */
async function settle(p) { try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; } }

export class BleConn {
  /** bms: the JkBms port. h: the app's side - log(msg), autoRe(), device(), changed(), choose(signal) -> device | null,
   *  fresh(device) -> device, attempt(n), connected(device), failed(msg, origin), stalled(ageS), down(stalled, ageS),
   *  stuck(). o: the clock for tests - secMs (one countdown / attempt second), tickMs, gapMs, connectS, stuckMs,
   *  downWaitMs, writeMs, link (linkStep limits). */
  constructor(bms, h, o = {}) {
    this.bms = bms; this.h = guardHooks(h);
    this.o = { secMs: 1000, tickMs: SERVE_TICK_MS, gapMs: CONNECT_GAP_MS, connectS: CONNECT_S, stuckMs: STUCK_MS, downWaitMs: DOWN_WAIT_MS, writeMs: 2000, freshMs: 2000, link: {}, ...o };
    this.cs = connState();
    this.cmd = new Channel();
    this.ac = null; this.task = null;
  }
  /** The UI's only way in. The loop starts on the first command. */
  tell(cmd) { this.start(); this.cmd.push(cmd); }
  get running() { return this.task !== null; }
  start() {
    if (this.task !== null) return;
    this.ac = new AbortController();
    const ac = this.ac;
    this.task = this.run(ac.signal).catch((e) => {
      if (isAbort(e) || this.ac !== ac) return;
      // a loop that died is a bug, but the pack must not stay frozen on its last phase: say so, start clean on the next tap
      this.h.log(`conn: the connection loop ended on an error: ${e && e.message} - back to idle`);
      this.ac = null; this.task = null; this.cs.phase = 'idle'; this.cs.attempt = 0; this.cs.count = 0;
      this.bms.close(); this.h.changed();
      if (this.cmd.size) this.start();                                    // a tap is already waiting
    });
  }
  stop() { if (this.ac) this.ac.abort(); this.ac = null; this.task = null; }

  enter(phase, why = '') {
    const was = this.cs.phase; this.cs.phase = phase;
    if (was !== phase) this.h.log(`conn: ${was} -> ${phase}${why ? ` (${why})` : ''}`);
    this.h.changed();
  }
  next(signal) { return this.cmd.next({ signal }); }
  /** The command arm of a select: it only waits for a queued command; take() takes it once this arm has won, so a
   *  command never vanishes in a select another arm won (a Disconnect tap queued as the link fell). */
  cmdArm(s) { return this.cmd.ready({ signal: s }); }
  take() { return this.cmd.take(); }
  /** Seconds left to a deadline() (sync.js): a throttled hidden tab wakes late and the count must not fall behind; a
   *  clock set back must not stretch it either (long-run review 2026-11-05). */
  secsLeft(dl) { return Math.max(0, Math.ceil(dl.left() / this.o.secMs)); }
  /** The oldest browser connect still unsettled has run past STUCK_MS: it ran with Bluetooth off (0.9.81). */
  stuckNow() { const g = this.bms.pending; return !!g && g.age() >= this.o.stuckMs; }

  async run(signal) {
    let go = await this.idle(signal, '');
    for (;;) {
      let r = go === 'choose' && !(await this.choose(signal)) ? { end: 'stop' } : await this.connect(signal);
      if (r.end === 'up') r = await this.serve(signal);
      go = await this.after(r, signal);
    }
  }

  /** The end of a round -> the countdown, the stuck wait or idle; resolves with how the next round starts. */
  async after(r, signal) {
    for (;;) {
      if (r.end === 'choose') return 'choose';
      if (r.end === 'stuck') { r = await this.stuck(signal); continue; }
      if (r.end === 'stop') return this.idle(signal, 'stopped');
      const d = afterEnd(r.end, { autoRe: this.h.autoRe(), hasDevice: this.cs.hasDevice, origin: this.cs.origin, msg: r.msg });
      if (d.next === 'idle') return this.idle(signal, r.end);
      const c = await this.countdown(d.seconds, signal, r.end);
      if (c === 'stuck') { r = { end: 'stuck' }; continue; }
      if (c === 'stop') return this.idle(signal, 'stopped');
      return c;
    }
  }

  async idle(signal, why) {
    this.cs.attempt = 0; this.cs.count = 0;
    if (this.bms.connected) { this.h.log('conn: idle with a link still up (a connect that answered after its attempt gave up) - closing it'); this.bms.close(); }
    this.enter('idle', why);
    for (;;) {
      const c = await this.next(signal);
      const d = cmdIn('idle', c, this.cs);
      if (d === 'choose') return 'choose';
      if (d === 'go') { this.cs.origin = c === 'known' ? 'known' : 'manual'; this.cs.hasDevice = true; return 'go'; }
      this.h.log(`conn: ${c} ignored while idle`);
    }
  }

  /** The chooser drops a link that is up first, then the browser's picker (a tap's user activation carries through:
   *  the command woke this loop in the same task). Taps made while it was open are forgotten. */
  async choose(signal) {
    this.enter('choosing');
    if (this.bms.connected) { this.bms.close(); await this.downWait(signal); }
    const dev = await this.h.choose(signal);
    this.cmd.clear();
    if (!dev) return false;
    this.cs.hasDevice = true; this.cs.origin = 'chooser';
    return true;
  }

  /** One round: up to CONNECT_TRIES attempts, CONNECT_GAP_MS apart (Android refuses the first one, 2026-09-18). */
  async connect(signal) {
    this.cs.connectedAt = null; this.cs.count = 0;
    for (let n = 1; ; n++) {
      this.cs.attempt = n; this.cs.left = this.o.connectS;
      this.enter('connecting', n === 1 ? this.cs.origin || '' : `try ${n}`);
      const r = await this.attempt(n, signal);
      if (r.ok) return { end: 'up' };
      if (r.end) return r;
      if (!retryDecision(n, r.msg).retry) { this.h.failed(r.msg, this.cs.origin); return { end: 'failed', msg: r.msg }; }
      const w = await this.pause(this.o.gapMs, signal);
      if (w) return w;
    }
  }

  /** One attempt: open the link while the seconds count down; a stop ends it, a stuck browser connect ends it. The
   *  browser's pending connect is never cancelled (0.9.81): the attempt only stops waiting for it. */
  async attempt(n, signal) {
    const t0 = Date.now();
    let dev = this.h.device();
    if (this.cs.origin !== 'chooser') {                                  // getDevices may hand back a newer handle; it may also hang
      const f = await select(signal, { got: () => settle(this.h.fresh(dev)), late: (s) => sleep(this.o.freshMs, s) });
      if (f.key === 'got' && f.value.ok && f.value.v) dev = f.value.v;
      else this.h.log(`connect: ${f.key === 'late' ? `getDevices() did not answer in ${this.o.freshMs} ms` : 'getDevices() failed'} - the handle we have`);
    }
    signal.throwIfAborted();
    const dl = deadline(this.o.connectS * this.o.secMs);
    this.h.attempt(n);
    const ac = new AbortController();
    const quit = () => ac.abort();
    signal.addEventListener('abort', quit, { once: true });
    const opening = settle(this.bms.open(dev, ac.signal));
    const fail = (msg) => { ac.abort(); this.bms.close(); this.h.log(`connect: attempt ${n} failed after ${Date.now() - t0} ms: ${msg}`); return { msg }; };
    try {
      for (;;) {
        const r = await select(signal, { open: () => opening, tick: (s) => sleep(Math.min(this.o.secMs, Math.max(1, dl.left())), s), cmd: (s) => this.cmdArm(s) });
        if (r.key === 'open') {
          if (r.value.ok) { this.h.log(`connect: ok on attempt ${n} in ${Date.now() - t0} ms`); return { ok: true }; }
          return fail(r.value.e.message);
        }
        if (r.key === 'cmd') {
          const cmd = this.take(), c = cmdIn('connecting', cmd, this.cs);
          if (c === 'stop') { ac.abort(); this.bms.close(); this.h.log(`connect: attempt ${n} cancelled (${cmd})`); return { end: 'stop' }; }
          this.h.log(`conn: ${cmd} ignored (an attempt is in progress)`);
          continue;
        }
        this.cs.left = this.secsLeft(dl);
        if (this.stuckNow()) { ac.abort(); return { end: 'stuck' }; }
        if (this.cs.left === 0) return fail(`no answer in ${this.o.connectS} s`);
        this.h.changed();
      }
    } finally { signal.removeEventListener('abort', quit); }
  }

  /** The gap between two tries; a stop in it ends the round. */
  async pause(ms, signal) {
    const until = Date.now() + ms;
    for (;;) {
      const left = until - Date.now();
      if (left <= 0) return null;
      const r = await select(signal, { t: (s) => sleep(left, s), cmd: (s) => this.cmdArm(s) });
      if (r.key === 't') return null;
      const cmd = this.take();
      if (cmdIn('connecting', cmd, this.cs) === 'stop') { this.h.log(`connect: cancelled between tries (${cmd})`); return { end: 'stop' }; }
    }
  }

  /** A connected link, looked at every tickMs: the handshake, the startup asks, the silence nudge and the stall check
   *  (jkbms linkStep) - all on THIS link, which this loop alone owns. Ends with how the link ended. */
  async serve(signal) {
    const b = this.bms, cs = this.cs, t0 = Date.now();
    cs.connectedAt = t0; cs.attempt = 0; cs.count = 0; cs.hasDevice = true; cs.stalled = false;
    this.h.connected(b.device);                                          // the app takes the device first, so the repaint below shows it
    this.enter('connected');
    const l = { askedAt: null, asks: 0, cellLogged: false };
    const end = (e, ageS = 0) => { this.h.down(e === 'stalled', ageS); return { end: e, ageS }; };
    for (;;) {
      const arms = { down: (s) => b.down.wait(true, { signal: s }), voided: (s) => b.voided.wait(true, { signal: s }), cmd: (s) => this.cmdArm(s), tick: (s) => sleep(this.o.tickMs, s) };
      if (l.askedAt === null) arms.info = (s) => b.infoSeen.wait(true, { signal: s });
      const r = await select(signal, arms);
      if (r.key === 'down') { this.h.log('gatt disconnected'); return end('down'); }
      if (r.key === 'voided') { b.drop(`${b.voidGapS} s without data - queued readings dropped`); await this.downWait(signal); return end('gap'); }
      if (r.key === 'cmd') {
        const cmd = this.take(), c = cmdIn('connected', cmd, cs);
        if (c === 'stop') { this.h.log(`conn: ${cmd} - closing the link`); b.close(); await this.downWait(signal); return end('stop'); }
        if (c === 'choose') return end('choose');                         // choose() closes the link before the picker
        continue;
      }
      const now = Date.now();
      if (!cs.gotData && b.firstCellAt !== null) { cs.gotData = true; this.h.changed(); }
      if (l.asks && !l.cellLogged && b.firstCellAt !== null) { l.cellLogged = true; this.h.log(`startup: cell info after ${l.asks + 1} asks${b.rxOtherAll ? `, ${b.rxOtherAll} non-frame notifications` : ''}`); }
      const st = linkStep({ now, connectedAt: t0, askedAt: l.askedAt, asks: l.asks, info: !!b.info, firstCellAt: b.firstCellAt, settingsAt: b.settingsAt, lastRxAt: b.lastRxAt, lastDataAt: b.lastDataAt }, this.o.link);
      if (st.act === 'stall') {
        cs.stalled = true; cs.stalledAge = st.ageS;
        this.h.stalled(st.ageS);
        b.drop(`no data for ${st.ageS} s`);
        await this.downWait(signal);
        return end('stalled', st.ageS);
      }
      if (st.act === 'handshake') {
        const hsMs = this.o.link.handshakeMs || HANDSHAKE_WAIT_MS;
        this.h.log(b.info ? `handshake: device info in ${now - t0} ms, asking for cell info (0x96)` : `handshake: no device info in ${hsMs} ms, asking for cell info anyway (0x96)`);
        l.askedAt = now;
        await this.send('handshake', signal);
      } else if (st.act === 'ask') {
        const served = b.settingsAt !== null && b.settingsAt >= l.askedAt;
        const other = b.rxOtherAll ? `, ${b.rxOtherAll} non-frame notifications so far, last ${((now - b.rxOtherAt) / 1000).toFixed(1)} s ago` : '';
        this.h.log(`startup: no cell info ${((now - l.askedAt) / 1000).toFixed(1)} s after the ask (${served ? 'settings came' : 'not served'})${other}, asking again (0x96, ask ${l.asks + 2})`);
        l.askedAt = now; l.asks++;
        await this.send('startup ask', signal);
      } else if (st.act === 'nudge') {
        this.h.log(`nudge: no frame for ${st.quietS} s, asking the BMS again (0x96)`);
        l.askedAt = now;
        await this.send('nudge', signal);
      }
    }
  }

  /** The cell-info command, waited for at most writeMs (a write the stack never answers must not hold the loop). */
  async send(what, signal) {
    const r = await select(signal, { w: () => settle(this.bms.write(buildCommand(CMD_CELL_INFO))), t: (s) => sleep(this.o.writeMs, s) });
    if (r.key === 't') this.h.log(`${what}: the write is still pending after ${this.o.writeMs} ms`);
    else if (!r.value.ok) this.h.log(`${what} failed: ${r.value.e.message}`);
  }

  /** A closed link reports itself down within downWaitMs; if the browser never says so, it is down for us anyway. */
  async downWait(signal) {
    const r = await this.bms.down.wait(true, { ms: this.o.downWaitMs, signal });
    if (r !== 'set') { this.h.log(`gatt: no disconnect event in ${this.o.downWaitMs} ms - taking the link as down`); this.bms.down.set(true); }
  }

  async countdown(seconds, signal, why) {
    let dl = deadline(seconds * this.o.secMs);
    this.cs.count = seconds;
    this.enter('countdown', `${why}, ${seconds} s`);
    while (this.cs.count > 0) {
      const r = await select(signal, { tick: (s) => sleep(Math.min(this.o.secMs, Math.max(1, dl.left())), s), cmd: (s) => this.cmdArm(s) });
      if (r.key === 'tick') { this.cs.count = this.secsLeft(dl); if (this.stuckNow()) return 'stuck'; this.h.changed(); continue; }
      const cmd = this.take(), c = cmdIn('countdown', cmd, this.cs);
      if (c === 'go') { this.cs.origin = cmd === 'known' ? 'known' : 'manual'; this.h.log(`reconnect: now (${cmd})`); return 'go'; }
      if (c === 'choose' || c === 'stop') return c;
      if (c === 'short') { const sooner = deadline(RECONNECT_S.adapter * this.o.secMs); if (sooner.left() < dl.left()) dl = sooner; this.cs.count = this.secsLeft(dl); this.h.log(`reconnect: Bluetooth is back, in ${this.cs.count} s`); this.h.changed(); }
    }
    this.cs.origin = 'auto';
    return 'go';
  }

  /** A browser connect that cannot finish (it ran with Bluetooth off): no retries, no countdown - only closing the
   *  browser clears it, and the person is told so (0.9.81). If it settles after all (a slow stack), on we go. */
  async stuck(signal) {
    const g = this.bms.pending;
    this.cs.count = 0; this.cs.attempt = 0; this.cs.connectedAt = null;
    this.h.log(`gatt: connect still pending after ${Math.round(this.o.stuckMs / 1000)} s - it ran with Bluetooth off; only closing the browser clears it`);
    this.enter('stuck');
    this.h.stuck();
    if (!g) return { end: 'settled' };
    for (;;) {
      const r = await select(signal, { done: (s) => g.done.wait(true, { signal: s }), cmd: (s) => this.cmdArm(s) });
      if (r.key === 'done') { this.h.log('gatt: the pending connect settled after all'); return { end: 'settled' }; }
      const c = cmdIn('stuck', this.take(), this.cs);
      if (c === 'sheet') this.h.stuck();
      else if (c === 'stop') return { end: 'stop' };
    }
  }
}
