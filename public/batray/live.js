// BatRay by ClearEvo.com - Share live: one WebSocket per side through the relay room, encrypted end to end
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

// BatRay live share, 0.9.60 (owner decision 2026-10-01: "ws only, no more ICE
// and SFU / TURN / UDP").
//
// One transport: a WebSocket from each side to the relay's room object. The
// publisher sends every envelope AES-GCM encrypted with the key that lives
// only in the share link's URL fragment; the room fans the ciphertext out to
// the viewers and keeps the newest message of each slot (the hello, the pack
// list, each pack's info / settings / data) for a viewer that joins later,
// stamped with its age in the relay's clock. The relay cannot read a reading.
//
// Each side is ONE loop (house rule): open the socket, serve it until it dies
// (messages, a ping every SIG_PING_MS, dead after SIG_DEAD_MS of silence),
// count down, again. The socket callbacks only set a flag or push a channel.
import { makeKeyB64, shareLink, importKey, encrypt, decrypt, validEnvelope, staleEnvelope, sigDecision, readerPresent, FRESH_MS } from './live-logic.js';
import { Flag, Channel, sleep, select, isAbort } from './sync.js';

const API = '/batray/api';
const RETRY_S = 4;             // reopen countdown after the socket dies
const OPEN_MS = 10000;         // a socket that has not opened by then is given up
const SEND_MAX = 256 * 1024;   // bytes queued on the socket before an envelope is dropped instead of queued

const j = async (path, init = {}) => {
  const r = await fetch(`${API}/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { /** @type {any} */ const e = new Error(`${path}: ${r.status} ${body.error || JSON.stringify(body).slice(0, 160)}`); e.status = r.status; e.body = body; throw e; }
  return body;
};
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

/** One WebSocket as the loop sees it: the callbacks set two flags and push one channel, nothing else. */
class Sock {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.msgs = new Channel(); this.opened = new Flag(false); this.closed = new Flag(false); this.closeInfo = null;
    this.ws.onopen = () => this.opened.set(true);
    this.ws.onmessage = (e) => this.msgs.push(e.data);
    this.ws.onclose = (e) => { this.closeInfo = { code: e.code, reason: e.reason || '', clean: e.wasClean }; this.closed.set(true); };
    this.ws.onerror = () => {};                                 // the close that follows says it
  }
  get backlog() { return this.ws.readyState === 1 ? this.ws.bufferedAmount : 0; }
  send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  close(code = 1000, reason = 'bye') { try { this.ws.close(code, reason); } catch { /* already closing */ } }
}
/** Open a socket or throw: resolves once it is open, gives up on close or after OPEN_MS, aborts with the signal. */
async function openSock(url, signal) {
  const sock = new Sock(url);
  let r;
  try { r = await select(signal, { open: (s) => sock.opened.wait(true, { signal: s }), closed: (s) => sock.closed.wait(true, { signal: s }), timeout: (s) => sleep(OPEN_MS, s) }); }
  catch (e) { sock.close(4002, 'aborted'); throw e; }
  if (r.key === 'open') return sock;
  sock.close(4002, 'no open');
  throw new Error(r.key === 'timeout' ? `socket not open in ${Math.round(OPEN_MS / 1000)} s` : `socket closed before opening (code ${sock.closeInfo ? sock.closeInfo.code : '?'})`);
}
/** Serve an open socket until it dies: each message to onMsg, a ping when due, a reopen after SIG_DEAD_MS of
 *  silence (a half-open socket after a Wi-Fi change, 2026-09-22), onTick every 2 s. Returns why it ended. */
async function serve(sock, signal, { onMsg, onTick, log, now, resumed }) {
  let lastMsgAt = now(), lastPingAt = now();
  for (;;) {
    const r = await select(signal, { msg: (s) => sock.msgs.next({ signal: s }), closed: (s) => sock.closed.wait(true, { signal: s }), tick: (s) => sleep(2000, s), resume: (s) => resumed.next({ signal: s }) });
    if (r.key === 'closed') { const c = sock.closeInfo || {}; return `closed code=${c.code} reason="${c.reason}" clean=${c.clean}`; }
    if (r.key === 'msg') {
      lastMsgAt = now();
      let m; try { m = JSON.parse(r.value); } catch { log('signal: unparsable message'); continue; }
      if (m.type !== 'pong') await onMsg(m);
      continue;
    }
    const d = sigDecision({ lastMsgAt, lastPingAt, now: now() });
    if (d.action === 'reopen') { log(`signal: no answer for ${d.silentS} s - the socket is dead, reopening`); sock.close(4001, 'no pong'); return 'dead'; }
    if (d.action === 'ping' || r.key === 'resume') { lastPingAt = now(); sock.send({ type: 'ping' }); }   // a resumed tab asks at once
    if (onTick) onTick();
  }
}

/** Track the device's own internet state into state.net (navigator.onLine is
 *  a coarse signal - false is reliable, true only means "not known offline"). */
function watchNet(self) {
  self.state.net = navigator.onLine !== false;
  self.netHandler = () => { const v = navigator.onLine !== false; if (v !== self.state.net) { self.state.net = v; self.emit(); } };
  window.addEventListener('online', self.netHandler); window.addEventListener('offline', self.netHandler);
}
function unwatchNet(self) { if (self.netHandler) { window.removeEventListener('online', self.netHandler); window.removeEventListener('offline', self.netHandler); self.netHandler = null; } }
const wsUrl = (room, role, token) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${API}/room/${room}/ws?role=${role}${token ? `&token=${token}` : ''}`;

export class Publisher {
  /** opts: { log(msg), onState(state), onRequest(msg), retryS } - state: { viewers, live, retryIn, error, sent, dropped, sig, net };
   *  onRequest gets a viewer's `hist-req` ({ from, have }) */
  constructor(opts) {
    this.log = opts.log || (() => {}); this.onState = opts.onState || (() => {}); this.onRequest = opts.onRequest || (() => {});
    this.room = null; this.pubToken = null; this.keyB64 = null; this.key = null; this.link = null;
    this.sock = null; this.slots = new Map();   // pack id -> a short slot index: the relay retains per slot and never learns a pack id
    // live: our socket is up (the room fans out from it); sig: the same thing, kept for the chip; net: this device has internet
    this.state = { viewers: 0, live: false, retryIn: null, error: null, sent: 0, dropped: 0, sig: null, net: true };   // sig null = not tried yet
    this.stopped = false; this.reused = false; this.lastStatusKey = null;
    this.retryS = opts.retryS || RETRY_S;
    this.now = () => Date.now();
    this.resumed = new Channel();     // the tab came back: a countdown ends early, a serving socket is pinged now
    this.ac = null; this.task = null;
  }
  emit() { this.onState({ ...this.state }); }

  /** existing: { room, pub, key } from an earlier share - the same link keeps
   *  working for viewers who bookmarked it. Falls back to a new room only when
   *  the relay says it no longer knows the old one. */
  async start(existing = null) {
    if (this.task !== null) return this.link;
    let room = null, pub = null;
    this.reused = false;
    if (existing && existing.room && existing.pub && existing.key) {
      try {
        const r = await fetch(`${API}/room/${existing.room}`);
        if (r.ok) { room = existing.room; pub = existing.pub; this.keyB64 = existing.key; this.reused = true; }
        else this.log(`live: earlier room ${existing.room} is gone (${r.status}) - making a new one`);
      } catch (e) { room = existing.room; pub = existing.pub; this.keyB64 = existing.key; this.reused = true; this.log(`live: could not check the earlier room (${e.message}) - keeping it: the relay remembers rooms, only a 404 means gone`); }
    }
    if (!room) { ({ room, pub } = await j('room', { method: 'POST' })); this.keyB64 = makeKeyB64(); }
    this.room = room; this.pubToken = pub;
    this.key = await importKey(this.keyB64);
    this.link = shareLink(location.origin, room, this.keyB64);
    this.log(`live share room ${room} ${this.reused ? 'reused' : 'created'}`);
    watchNet(this);
    this.ac = new AbortController();
    this.task = this.run(this.ac.signal).catch((e) => { if (!isAbort(e)) this.log(`live: publisher loop died: ${e.message}`); });
    return this.link;
  }

  /** The one owner of the socket: open, serve until it dies, count down, again. */
  async run(signal) {
    for (;;) {
      this.state.retryIn = null; this.state.error = null; this.emit();
      const t0 = Date.now();
      let sock;
      try { sock = await openSock(wsUrl(this.room, 'pub', this.pubToken), signal); } catch (e) {
        if (isAbort(e)) throw e;
        this.state.sig = false; this.state.error = e.message; this.emit();
        this.log(`live: ${e.message}`);
        await this.retryWait(this.retryS, signal);
        continue;
      }
      this.sock = sock; this.state.sig = true; this.state.live = true; this.emit();
      this.log(`signal: socket open (pub) in ${Date.now() - t0} ms - publishing`);
      const why = await serve(sock, signal, { onMsg: (m) => this.onMsg(m), log: this.log, now: this.now, resumed: this.resumed });
      this.sock = null; sock.close();
      this.state.sig = false; this.state.live = false; this.emit();
      this.log(`signal: socket ${why} - reopening in ${this.retryS} s`);
      await this.retryWait(this.retryS, signal);
    }
  }
  /** The countdown on the chip; the tab resuming (nudge) ends it early. */
  async retryWait(seconds, signal) {
    for (let left = seconds; left > 0; left--) {
      this.state.retryIn = left; this.emit();
      const r = await select(signal, { tick: (s) => sleep(1000, s), resume: (s) => this.resumed.next({ signal: s }) });
      if (r.key === 'resume') { this.log('live: tab resumed, reconnecting now'); break; }
    }
    this.state.retryIn = null; this.emit();
  }
  onMsg(m) {
    if (m.type === 'status') {
      const key = `${m.viewers}|${m.live}`;
      if (key !== this.lastStatusKey) { this.lastStatusKey = key; this.log(`status: viewers=${m.viewers} live=${m.live}`); }
      this.state.viewers = m.viewers; this.emit();
    } else if (m.type === 'hist-req') this.onRequest(m);           // a viewer lists the day files it has; the app answers over publish(env, m.from)
  }

  get credentials() { return { room: this.room, pub: this.pubToken, key: this.keyB64, at: Date.now() }; }
  /** Bytes still queued on the socket: a big transfer waits while this is high instead of dropping. */
  backlog() { return this.sock ? this.sock.backlog : 0; }
  /** The retain slot of an envelope: the relay keeps the newest per slot for late viewers. History chunks have none. */
  slotOf(env) {
    if (env.k === 'hist-file') return null;
    if (!env.p || env.p.id === '*') return env.k;
    if (!this.slots.has(env.p.id)) this.slots.set(env.p.id, this.slots.size);
    return `${env.k}${this.slots.get(env.p.id)}`;
  }
  /** Encrypt and send; `to` addresses one viewer (its id from a hist-req), else every viewer gets it. */
  async publish(env, to = null) {
    if (!this.key) { this.state.dropped++; return; }        // start() has not imported the key yet (a BMS event can land first)
    const bytes = await encrypt(this.key, env);
    const sock = this.sock;
    if (!sock || sock.backlog > SEND_MAX) { this.state.dropped++; return; }
    const m = { type: 'd', b: b64(bytes) };
    const slot = this.slotOf(env); if (slot) m.slot = slot;
    if (to) m.to = to;
    sock.send(m); this.state.sent++;
  }
  /** The tab just came back: end a countdown now, ping a serving socket now. */
  nudge() { if (!this.stopped) this.resumed.push(1); }

  async stop() {
    this.stopped = true;
    if (this.ac) this.ac.abort();
    if (this.sock) { this.sock.close(); this.sock = null; }
    unwatchNet(this);
    this.state.live = false; this.state.sig = false; this.state.retryIn = null; this.emit();
    this.log('live share stopped');
  }
}

export class Viewer {
  /** opts: { room, keyB64, log(msg), onState(state), onEnvelope(env), retryS } - state: { viewers, live, reader, retryIn, error,
   *  received, stale, sig, net }. An envelope from the room's retained set carries retained=true and ageS (its age in
   *  the relay's clock): the app paints it as "N s ago", never as "just now". */
  constructor(opts) {
    this.room = opts.room; this.keyB64 = opts.keyB64;
    this.log = opts.log || (() => {}); this.onState = opts.onState || (() => {}); this.onEnvelope = opts.onEnvelope || (() => {});
    this.key = null; this.sock = null;
    // sig: our socket is up; reader: the reader is there (its socket is in the room, or its readings still arrive);
    // live: both; net: this device has internet
    // gone: how the reader's socket ended, while it is away ({ at (this clock), code, reason }, from the relay, 0.9.71)
    this.state = { viewers: 0, live: false, reader: null, retryIn: null, error: null, received: 0, stale: 0, sig: null, net: true, gone: null };   // null = not known yet
    this.lastRxAt = null; this.serverLive = null; this.lastStatusKey = null;
    this.now = () => Date.now();
    this.stopped = false;
    this.retryS = opts.retryS || RETRY_S;
    this.resumed = new Channel();
    this.ac = null; this.task = null;
  }
  emit() { this.onState({ ...this.state }); }

  async start() {
    if (this.task !== null) return;
    this.key = await importKey(this.keyB64);
    watchNet(this);
    this.ac = new AbortController();
    this.task = this.run(this.ac.signal).catch((e) => { if (!isAbort(e)) this.log(`live: viewer loop died: ${e.message}`); });
  }

  /** The one owner of the socket: open, serve until it dies, count down, again. The retained messages arrive first. */
  async run(signal) {
    for (;;) {
      this.state.retryIn = null; this.state.error = null; this.emit();
      const t0 = Date.now();
      let sock;
      try { sock = await openSock(wsUrl(this.room, 'view', null), signal); } catch (e) {
        if (isAbort(e)) throw e;
        this.state.sig = false; this.state.error = e.message; this.emit();
        this.log(`live: ${e.message}`);
        await this.retryWait(this.retryS, signal);
        continue;
      }
      this.sock = sock; this.state.sig = true; this.emit();
      this.log(`signal: socket open (view) in ${Date.now() - t0} ms`);
      const why = await serve(sock, signal, { onMsg: (m) => this.onMsg(m), onTick: () => this.judgeReader(), log: this.log, now: this.now, resumed: this.resumed });
      this.sock = null; sock.close();
      this.state.sig = false; this.state.live = false; this.emit();
      this.log(`signal: socket ${why} - reopening in ${this.retryS} s`);
      await this.retryWait(this.retryS, signal);
    }
  }
  /** The countdown on the chip; the tab resuming ends it early. */
  async retryWait(seconds, signal) {
    for (let left = seconds; left > 0; left--) {
      this.state.retryIn = left; this.emit();
      const r = await select(signal, { tick: (s) => sleep(1000, s), resume: (s) => this.resumed.next({ signal: s }) });
      if (r.key === 'resume') { this.log('live: tab resumed, reconnecting now'); break; }
    }
    this.state.retryIn = null; this.emit();
  }
  async onMsg(m) {
    if (m.type === 'status') { this.onStatus(m); return; }
    if (m.type === 'd' && typeof m.b === 'string') await this.onData(m);
  }
  onStatus(m) {
    const g = m.gone && typeof m.gone.ago === 'number' ? m.gone : null;
    const key = `${m.viewers}|${m.live}|${g ? g.code : '-'}`;
    if (key !== this.lastStatusKey) { this.lastStatusKey = key; this.log(`status: viewers=${m.viewers} live=${m.live} lastRx=${this.lastRxAt ? Math.round((this.now() - this.lastRxAt) / 1000) + 's' : '-'}${g ? ` reader socket ended ${Math.round(g.ago / 1000)} s ago code=${g.code}${g.reason ? ` "${g.reason}"` : ''}` : ''}`); }
    this.state.viewers = m.viewers; this.serverLive = !!m.live;
    this.state.gone = g ? { at: this.now() - g.ago, code: g.code, reason: String(g.reason || '') } : null;
    this.judgeReader(true);
  }
  /** Freshness first: readings still arriving prove the reader is there, whatever the room says (2026-09-17); once
   *  they stop, the room's word decides. Re-judged on every status and every 2 s tick. */
  judgeReader(force = false) {
    const reader = readerPresent({ serverLive: this.serverLive, lastRxAt: this.lastRxAt, now: this.now() });
    const live = reader === true && this.state.sig === true;
    if (!force && reader === this.state.reader && live === this.state.live) return;
    if (this.state.reader !== false && reader === false) this.log('live: the reader is not in the room and nothing has arrived for a while - reader offline');
    this.state.reader = reader; this.state.live = live; this.emit();
  }
  async onData(m) {
    try {
      const env = await decrypt(this.key, unb64(m.b));
      if (!validEnvelope(env)) return;
      this.state.received++;
      if (typeof m.ago === 'number') {                                       // from the room's retained set: its age is the relay's measure
        env.retained = true; env.ageS = Math.round(m.ago / 1000); env.stale = m.ago > FRESH_MS;
      } else env.stale = staleEnvelope(env, this.now());                     // a frozen tab gets the whole queue on resume: old ones are stored, not painted
      if (env.stale) this.state.stale++;
      else { this.lastRxAt = this.now(); this.judgeReader(); }              // fresh data beats the room's word
      this.onEnvelope(env);
    } catch { if (!this.state.error) this.log('live: a message could not be decrypted (wrong or missing key)'); this.state.error = 'cannot decrypt: wrong or missing key'; this.emit(); }
  }
  /** Ask the reader for the history this device lacks (0.9.30); `have` = this device's day listing. */
  request(have) { if (!this.sock) return false; this.sock.send({ type: 'hist-req', have }); return true; }
  /** The tab just came back: end a countdown now, ping a serving socket now. */
  nudge() { if (!this.stopped) this.resumed.push(1); }
  stop() {
    this.stopped = true;
    if (this.ac) this.ac.abort();
    if (this.sock) { this.sock.close(); this.sock = null; }
    unwatchNet(this);
    this.state.live = false; this.state.sig = false; this.state.retryIn = null; this.emit();
  }
}
