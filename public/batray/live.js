// BatRay by ClearEvo.com - Share live: signalling, direct Wi-Fi and server transports, retry ladder
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

// BatRay live share.
//
// Ladder, per viewer: (1) presence/signalling socket to the relay, (2) a direct
// Wi-Fi peer link (host candidates only, no STUN/TURN, so it can only succeed
// on the same network), (3) the Cloudflare Realtime SFU over UDP, (4) the SFU
// reached through a TURN relay (TCP/TLS 443) when UDP is blocked. Every frame
// is AES-GCM encrypted on the publisher with a key that lives only in the
// share link's URL fragment, whichever path carries it. The relay Worker at
// /batray/api/ holds the SFU secret, routes signalling, and counts how many
// sockets are on an SFU/TURN path against the free cap.
import { makeKeyB64, shareLink, importKey, encrypt, decrypt, validEnvelope, classifyPath, selectedLocalCandidate, selectedPair, classifyDirect, readerPresent, FRESH_MS } from './live-logic.js';

const API = '/batray/api';
const P2P_WAIT_MS = 7000;      // viewer waits this long for a direct offer/connection before using the SFU
const RETRY_S = 10;            // reconnect countdown, both sides
const FULL_RETRY_S = 30;       // when the free server is full

const j = async (path, init = {}) => {
  const r = await fetch(`${API}/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${path}: ${r.status} ${body.error || JSON.stringify(body).slice(0, 160)}`); e.status = r.status; e.body = body; throw e; }
  return body;
};

let iceCache = null;
async function iceServers(relayOnly) {
  if (!iceCache || iceCache.until < Date.now()) {
    let servers = [{ urls: 'stun:stun.cloudflare.com:3478' }];
    try {
      const t = await j('turn', { method: 'POST' });
      const s = Array.isArray(t.iceServers) ? t.iceServers : t.iceServers ? [t.iceServers] : [];
      if (s.length) servers = s;
    } catch { /* STUN only */ }
    iceCache = { servers, until: Date.now() + 45 * 60 * 1000 };
  }
  return relayOnly ? { iceServers: iceCache.servers, iceTransportPolicy: 'relay', bundlePolicy: 'max-bundle' } : { iceServers: iceCache.servers, bundlePolicy: 'max-bundle' };
}

function waitConnected(pc, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`not connected in ${Math.round(ms / 1000)} s (${pc.connectionState})`)), ms);
    const chk = () => { if (pc.connectionState === 'connected') { clearTimeout(t); res(); } else if (['failed', 'closed'].includes(pc.connectionState)) { clearTimeout(t); rej(new Error('connection ' + pc.connectionState)); } };
    pc.addEventListener('connectionstatechange', chk); chk();
  });
}
function waitOpen(dc, ms) {
  return new Promise((res, rej) => {
    if (dc.readyState === 'open') return res();
    const t = setTimeout(() => rej(new Error(`channel not open in ${Math.round(ms / 1000)} s (${dc.readyState})`)), ms);
    dc.addEventListener('open', () => { clearTimeout(t); res(); }, { once: true });
    dc.addEventListener('close', () => { clearTimeout(t); rej(new Error('channel closed')); }, { once: true });
    dc.addEventListener('error', (e) => { clearTimeout(t); rej(new Error('channel error ' + (e.error && e.error.message))); }, { once: true });
  });
}
async function pathOf(pc) { try { return classifyPath(selectedLocalCandidate(await pc.getStats())); } catch { return classifyPath(null); } }
async function directPathOf(pc) { try { const pr = selectedPair(await pc.getStats()); return classifyDirect(pr && pr.local, pr && pr.remote); } catch { return { tier: 'p2p', sub: null, label: 'direct' }; } }

// Transport to the SFU: one silent audio track carries the offer/answer, the
// DataChannel rides the same bundle.
async function connectTransport(pc, sid, log) {
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const tx = pc.addTransceiver(dest.stream.getAudioTracks()[0], { direction: 'sendonly' });
  pc.createDataChannel('bootstrap');
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const r = await j(`sfu/session/${sid}/tracks`, { method: 'POST', body: JSON.stringify({ sessionDescription: { type: 'offer', sdp: offer.sdp }, tracks: [{ location: 'local', mid: tx.mid, trackName: 'silence' }] }) });
  if (!r.sessionDescription) throw new Error('SFU gave no answer: ' + JSON.stringify(r).slice(0, 200));
  await pc.setRemoteDescription(r.sessionDescription);
  await waitConnected(pc, 20000);
  log(`sfu transport up (session ${sid.slice(0, 8)}…)`);
  return ac;
}

/** Presence + signalling socket with automatic reopen. */
class Signal {
  constructor(room, role, token, log) {
    this.room = room; this.role = role; this.token = token; this.log = log;
    this.ws = null; this.closed = false; this.timer = null; this.handlers = new Set(); this.lastPath = null;
    this.connected = false; this.onConn = () => {};
    this.open();
  }
  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${API}/room/${this.room}/ws?role=${this.role}${this.token ? `&token=${this.token}` : ''}`);
    this.ws = ws;
    const t0 = Date.now();
    ws.onopen = () => { this.connected = true; this.log(`signal: socket open (${this.role}) in ${Date.now() - t0} ms`); this.onConn(true); if (this.lastPath) this.send({ type: 'path', path: this.lastPath }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { this.log('signal: unparsable message'); return; } for (const h of this.handlers) h(m); };
    ws.onclose = (e) => { this.connected = false; this.log(`signal: socket closed code=${e.code} reason="${e.reason || ''}" clean=${e.wasClean}${this.closed ? '' : ' - reopening in 4 s'}`); if (!this.closed) this.onConn(false); if (!this.closed) { this.timer = setTimeout(() => this.open(), 4000); } };
    ws.onerror = () => { this.log('signal: socket error (close follows)'); };
  }
  on(h) { this.handlers.add(h); }
  send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  reportPath(tier) { this.lastPath = tier; this.send({ type: 'path', path: tier }); }
  /** Reopen now instead of after the 4 s delay (tab resumed). */
  nudge() { if (this.closed || (this.ws && this.ws.readyState <= 1)) return; clearTimeout(this.timer); this.timer = null; this.open(); }
  close() { this.closed = true; clearTimeout(this.timer); try { this.ws.close(1000, 'bye'); } catch { /* */ } }
}

/** Track the device's own internet state into state.net (navigator.onLine is
 *  a coarse signal - false is reliable, true only means "not known offline"). */
function watchNet(self) {
  self.state.net = navigator.onLine !== false;
  self.netHandler = () => { const v = navigator.onLine !== false; if (v !== self.state.net) { self.state.net = v; self.emit(); } };
  window.addEventListener('online', self.netHandler); window.addEventListener('offline', self.netHandler);
}
function unwatchNet(self) { if (self.netHandler) { window.removeEventListener('online', self.netHandler); window.removeEventListener('offline', self.netHandler); self.netHandler = null; } }

/** Countdown helper: calls tick(left) each second, then fn(). */
function countdown(seconds, tick, fn) {
  let left = seconds; tick(left);
  const t = setInterval(() => { left -= 1; tick(left); if (left <= 0) { clearInterval(t); fn(); } }, 1000);
  return () => clearInterval(t);
}

export class Publisher {
  /** opts: { log(msg), onState(state), onRequest(msg) } - state: { viewers, live, path, p2p, server, retryIn, error };
   *  onRequest gets a viewer's `hist-req` ({ from, have }) */
  constructor(opts) {
    this.log = opts.log || (() => {}); this.onState = opts.onState || (() => {}); this.onRequest = opts.onRequest || (() => {});
    this.room = null; this.pubToken = null; this.keyB64 = null; this.key = null; this.link = null;
    this.pc = null; this.dc = null; this.sid = null; this.ac = null; this.sig = null;
    this.peers = new Map();          // viewerId -> { pc, dc }
    // sig: presence socket to the server up; net: this device has internet
    this.state = { viewers: 0, live: false, path: classifyPath(null), p2p: 0, server: { conns: 0, limit: 0 }, retryIn: null, error: null, sent: 0, dropped: 0, sig: null, net: true };   // sig null = not tried yet
    this.stopped = false; this.pathTimer = null; this.cancelRetry = null; this.relayOnly = false;
  }
  emit() { this.onState({ ...this.state }); }

  /** existing: { room, pub, key } from an earlier share - the same link keeps
   *  working for viewers who bookmarked it. Falls back to a new room when the
   *  relay no longer knows the old one. */
  async start(existing = null) {
    let room = null, pub = null;
    this.reused = false;
    if (existing && existing.room && existing.pub && existing.key) {
      try {
        const r = await fetch(`${API}/room/${existing.room}`);
        if (r.ok) { room = existing.room; pub = existing.pub; this.keyB64 = existing.key; this.reused = true; }
        else this.log(`live: earlier room ${existing.room} is gone (${r.status}) - making a new one`);
      } catch (e) { this.log(`live: could not check the earlier room: ${e.message} - making a new one`); }
    }
    if (!room) { ({ room, pub } = await j('room', { method: 'POST' })); this.keyB64 = makeKeyB64(); }
    this.room = room; this.pubToken = pub;
    this.key = await importKey(this.keyB64);
    this.link = shareLink(location.origin, room, this.keyB64);
    this.log(`live share room ${room} ${this.reused ? 'reused' : 'created'}`);
    this.sig = new Signal(room, 'pub', pub, this.log);
    this.sig.on((m) => this.onSignal(m));
    this.sig.onConn = (up) => this.onSigConn(up);
    watchNet(this);
    await this.connectSfu();
    return this.link;
  }

  get credentials() { return { room: this.room, pub: this.pubToken, key: this.keyB64, at: Date.now() }; }
  onSigConn(up) {
    this.state.sig = up; this.emit();
    // The relay forgets the session when this socket closes - even a 4 s blink
    // - and viewers are told "no reader" while the stream is fine. Register it
    // again on every reopen (2026-09-17).
    if (up && this.sid && this.state.live) this.registerSession('socket reopened');
  }
  async registerSession(why) {
    if (!this.sid || !this.room) return;
    try {
      await j(`room/${this.room}/session?token=${this.pubToken}`, { method: 'PUT', body: JSON.stringify({ session: this.sid }) });
      this.log(`live: session re-registered (${why})`);
    } catch (e) { this.log(`live: session re-register failed: ${e.message}`); }
  }

  onSignal(m) {
    if (m.type === 'status') {
      const key = `${m.viewers}|${m.live}|${(m.session || '').slice(0, 8)}|${m.server ? m.server.conns : '?'}`;
      if (key !== this.lastStatusKey) { this.lastStatusKey = key; this.log(`status: viewers=${m.viewers} live=${m.live} session=${(m.session || '-').slice(0, 8)} server=${m.server ? `${m.server.conns}/${m.server.limit}` : '?'}`); }
      this.state.viewers = m.viewers; this.state.server = m.server || this.state.server; this.emit();
      if (!m.live && this.sid && this.state.live && !this.registering) {   // the room lost our session while we are still publishing
        this.registering = true; this.registerSession('room reported no session').finally(() => { this.registering = false; });
      }
      return;
    }
    if (m.type === 'join') { this.offerP2P(m.from).catch((e) => this.log(`p2p offer to ${m.from.slice(0, 6)} failed: ${e.message}`)); return; }
    if (m.type === 'hist-req') { this.onRequest(m); return; }            // a viewer lists the day files it has; the app answers over publish()
    if (m.type === 'leave') { this.dropPeer(m.from); return; }
    const peer = this.peers.get(m.from);
    if (!peer) return;
    if (m.type === 'answer' && m.sdp) peer.pc.setRemoteDescription(m.sdp).catch((e) => this.log('p2p answer: ' + e.message));
    else if (m.type === 'ice' && m.cand) peer.pc.addIceCandidate(m.cand).catch(() => {});
    else if (m.type === 'bye') this.dropPeer(m.from);
  }

  // Direct Wi-Fi attempt: host candidates only. Succeeds only on the same LAN;
  // otherwise the viewer falls back to the SFU on its own.
  async offerP2P(viewerId) {
    this.dropPeer(viewerId);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel('jk', { ordered: true });
    const peer = { pc, dc, open: false };
    this.peers.set(viewerId, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.sig.send({ type: 'ice', to: viewerId, cand: e.candidate.toJSON() }); };
    pc.oniceconnectionstatechange = () => this.log(`p2p ice (viewer ${viewerId.slice(0, 6)}): ${pc.iceConnectionState}`);
    dc.onopen = async () => { peer.open = true; this.state.p2p = [...this.peers.values()].filter((p) => p.open).length; const d = await directPathOf(pc); this.log(`p2p: viewer ${viewerId.slice(0, 6)} connected - ${d.label}`); this.emit(); this.resendSnapshot && this.resendSnapshot(); };
    dc.onclose = () => { if (this.peers.get(viewerId) === peer) this.dropPeer(viewerId); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && this.peers.get(viewerId) === peer) this.dropPeer(viewerId); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.sig.send({ type: 'offer', to: viewerId, sdp: { type: 'offer', sdp: offer.sdp } });
    setTimeout(() => { if (this.peers.get(viewerId) === peer && !peer.open) { this.log(`p2p: no direct link to ${viewerId.slice(0, 6)} (not on this Wi-Fi), it will use the SFU`); this.dropPeer(viewerId); } }, P2P_WAIT_MS + 3000);
  }
  dropPeer(id) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id);
    try { peer.dc.close(); } catch { /* */ } try { peer.pc.close(); } catch { /* */ }
    this.state.p2p = [...this.peers.values()].filter((p) => p.open).length; this.emit();
  }

  async connectSfu() {
    this.teardownSfu();
    if (this.cancelRetry) { this.cancelRetry(); this.cancelRetry = null; }
    this.state.retryIn = null; this.state.error = null; this.emit();
    try {
      const pc = new RTCPeerConnection(await iceServers(this.relayOnly));
      this.pc = pc;
      const { sessionId } = await j('sfu/session', { method: 'POST' });
      this.sid = sessionId;
      this.ac = await connectTransport(pc, sessionId, this.log);
      const r = await j(`sfu/session/${sessionId}/dc`, { method: 'POST', body: JSON.stringify({ location: 'local', name: 'jk' }) });
      const id = r.dataChannels && r.dataChannels[0] && r.dataChannels[0].id;
      if (typeof id !== 'number') throw new Error('SFU gave no channel id: ' + JSON.stringify(r).slice(0, 200));
      this.dc = pc.createDataChannel('jk', { negotiated: true, id, ordered: true });
      await waitOpen(this.dc, 20000);
      await j(`room/${this.room}/session?token=${this.pubToken}`, { method: 'PUT', body: JSON.stringify({ session: sessionId }) });
      this.state.live = true; this.state.path = await pathOf(pc); this.sig.reportPath(this.state.path.tier); this.emit();
      this.log(`live: publishing on ${this.state.path.label}`);
      pc.addEventListener('iceconnectionstatechange', () => this.log(`ice (sfu): ${pc.iceConnectionState}`));
      clearInterval(this.pathTimer);
      this.pathTimer = setInterval(async () => { if (this.pc) { const p = await pathOf(this.pc); if (p.tier !== this.state.path.tier) { this.log(`live: path changed ${this.state.path.label} -> ${p.label}`); this.sig.reportPath(p.tier); } this.state.path = p; this.emit(); } }, 5000);
      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !this.stopped && this.pc === pc) {
          this.log(`live: transport ${pc.connectionState}`);
          this.scheduleRetry(RETRY_S);
        }
      });
    } catch (err) {
      if (this.stopped) return;
      const full = err.status === 429;
      // after a plain UDP failure, the next attempt goes TURN-only (TCP/TLS 443)
      if (!full && !this.relayOnly && /not connected|connection failed/.test(err.message)) { this.relayOnly = true; this.log('live: UDP path failed, next attempt via TURN relay'); }
      this.state.error = full ? `server full (${err.body.conns}/${err.body.limit})` : err.message;
      this.log('live: ' + this.state.error);
      this.scheduleRetry(full ? FULL_RETRY_S : RETRY_S);
    }
  }
  scheduleRetry(seconds) {
    if (this.stopped) return;
    this.state.live = false; this.sig.reportPath('none');
    if (this.cancelRetry) this.cancelRetry();
    this.cancelRetry = countdown(seconds, (left) => { this.state.retryIn = left; this.emit(); }, () => { this.cancelRetry = null; this.connectSfu(); });
  }
  /** The tab just came back: reopen the socket and retry the transport now. */
  nudge() {
    if (this.stopped) return;
    if (this.sig) this.sig.nudge();
    if (this.cancelRetry) { this.log('live: tab resumed, retrying now'); this.connectSfu(); }
  }

  /** Bytes still queued on the busiest open channel: a big transfer waits while this is high instead of dropping. */
  backlog() {
    let b = this.dc && this.dc.readyState === 'open' ? this.dc.bufferedAmount : 0;
    for (const p of this.peers.values()) if (p.open && p.dc.readyState === 'open') b = Math.max(b, p.dc.bufferedAmount);
    return b;
  }
  /** Encrypt once, send to the SFU and to every direct peer. */
  async publish(env) {
    if (!this.key) { this.state.dropped++; return; }        // start() has not imported the key yet (a BMS event can land first)
    const bytes = await encrypt(this.key, env);
    let sent = 0;
    if (this.dc && this.dc.readyState === 'open' && this.dc.bufferedAmount < 256 * 1024) { this.dc.send(bytes); sent++; }
    for (const p of this.peers.values()) if (p.open && p.dc.readyState === 'open' && p.dc.bufferedAmount < 256 * 1024) { p.dc.send(bytes); sent++; }
    if (sent) this.state.sent++; else this.state.dropped++;
  }

  teardownSfu() {
    clearInterval(this.pathTimer); this.pathTimer = null;
    try { this.dc && this.dc.close(); } catch { /* */ } try { this.pc && this.pc.close(); } catch { /* */ } try { this.ac && this.ac.close(); } catch { /* */ }
    this.dc = null; this.pc = null; this.ac = null;
  }
  async stop() {
    this.stopped = true;
    if (this.cancelRetry) { this.cancelRetry(); this.cancelRetry = null; }
    this.teardownSfu();
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    if (this.sig) this.sig.close();
    unwatchNet(this);
    if (this.room && this.pubToken) { try { await j(`room/${this.room}/session?token=${this.pubToken}`, { method: 'PUT', body: JSON.stringify({ session: '' }) }); } catch { /* */ } }
    this.state.live = false; this.state.retryIn = null; this.emit();
    this.log('live share stopped');
  }
}

export class Viewer {
  /** opts: { room, keyB64, log(msg), onState(state), onEnvelope(env) } */
  constructor(opts) {
    this.room = opts.room; this.keyB64 = opts.keyB64;
    this.log = opts.log || (() => {}); this.onState = opts.onState || (() => {}); this.onEnvelope = opts.onEnvelope || (() => {});
    this.key = null; this.sig = null; this.pubSession = null;
    this.p2p = null;                  // { pc, dc, open }
    this.sfu = null;                  // { pc, dc, ac, session }
    // sig: presence socket up; net: this device has internet; reader: the
    // server reports the reader present (its session is registered)
    this.state = { viewers: 0, live: false, path: classifyPath(null), server: { conns: 0, limit: 0 }, retryIn: null, error: null, received: 0, sig: null, net: true, reader: null };   // null = not known yet
    this.lastRxAt = null; this.now = () => Date.now(); this.lastStatus = null; this.recheck = null;
    this.stopped = false; this.pathTimer = null; this.cancelRetry = null; this.relayOnly = false; this.p2pDeadline = null; this.sfuTask = null;
  }
  emit() { this.onState({ ...this.state }); }
  get connected() { return !!((this.p2p && this.p2p.open) || (this.sfu && this.sfu.dc && this.sfu.dc.readyState === 'open')); }

  async start() {
    this.key = await importKey(this.keyB64);
    this.sig = new Signal(this.room, 'view', null, this.log);
    this.sig.on((m) => this.onSignal(m));
    this.sig.onConn = (up) => { this.state.sig = up; this.emit(); };
    watchNet(this);
  }

  /** Ask the reader for the history files this device lacks (0.9.30); `have` = this device's day listing. */
  request(have) { if (!this.sig) return false; this.sig.send({ type: 'hist-req', have }); return true; }
  onSignal(m) {
    if (m.type === 'status') { this.onStatus(m); return; }
    if (m.type === 'offer' && m.sdp) { this.answerP2P(m.sdp).catch((e) => this.log('p2p: ' + e.message)); return; }
    if (m.type === 'ice' && m.cand && this.p2p) { this.p2p.pc.addIceCandidate(m.cand).catch(() => {}); return; }
    if (m.type === 'bye') this.dropP2P();
  }

  onStatus(m) {
    const key = `${m.viewers}|${m.live}|${(m.session || '').slice(0, 8)}|${m.server ? m.server.conns : '?'}`;
    if (key !== this.lastStatusKey) { this.lastStatusKey = key; this.log(`status: viewers=${m.viewers} live=${m.live} session=${(m.session || '-').slice(0, 8)} server=${m.server ? `${m.server.conns}/${m.server.limit}` : '?'} lastRx=${this.lastRxAt ? Math.round((this.now() - this.lastRxAt) / 1000) + 's' : '-'}`); }
    this.state.viewers = m.viewers; this.state.server = m.server || this.state.server;
    this.lastStatus = m;
    const serverLive = !!(m.live && m.session);
    // Freshness first: readings still arriving prove the reader is there, whatever
    // the relay says (its session is wiped by a blink of the reader's socket).
    this.state.reader = readerPresent({ serverLive, lastRxAt: this.lastRxAt, now: this.now() });
    if (!serverLive) {
      if (this.state.reader) {
        if (!this.recheck) {
          this.log('live: server reports no reader session, but readings are still arriving - keeping the link');
          this.recheck = setTimeout(() => { this.recheck = null; if (this.lastStatus && !this.stopped) this.onStatus(this.lastStatus); }, FRESH_MS);
        }
        this.emit(); return;
      }
      if (this.pubSession) this.log('live: publisher went offline');
      this.pubSession = null; this.state.live = false; this.state.error = null;
      this.teardownSfu(); this.clearRetry(); this.emit(); return;
    }
    if (this.recheck) { clearTimeout(this.recheck); this.recheck = null; }
    this.emit();
    if (m.session !== this.pubSession) {
      this.pubSession = m.session;
      // give the direct Wi-Fi offer a head start; the SFU only if it did not come through
      if (!this.p2pDeadline) this.p2pDeadline = setTimeout(() => { this.p2pDeadline = null; if (!(this.p2p && this.p2p.open)) this.subscribe(); }, P2P_WAIT_MS);
    }
  }

  // ---- rung 2: direct Wi-Fi ----
  async answerP2P(offer) {
    this.dropP2P();
    const pc = new RTCPeerConnection({ iceServers: [] });
    const p = { pc, dc: null, open: false };
    this.p2p = p;
    pc.onicecandidate = (e) => { if (e.candidate) this.sig.send({ type: 'ice', cand: e.candidate.toJSON() }); };
    pc.oniceconnectionstatechange = () => this.log(`p2p ice: ${pc.iceConnectionState}`);
    pc.ondatachannel = (e) => {
      p.dc = e.channel; p.dc.binaryType = 'arraybuffer';
      p.dc.onmessage = (ev) => this.onBytes(ev.data);
      p.dc.onopen = async () => {
        p.open = true;
        this.state.live = true; this.state.error = null; this.state.path = await directPathOf(pc); this.sig.reportPath('p2p');
        this.log(`p2p: ${this.state.path.label} (no server)`);
        this.clearRetry(); this.teardownSfu(); this.emit();
      };
      p.dc.onclose = () => { if (this.p2p === p) { this.log('p2p: direct link closed'); this.dropP2P(); if (this.pubSession && !this.stopped) this.subscribe(); } };
    };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && this.p2p === p) { this.dropP2P(); if (this.pubSession && !this.stopped && !this.sfu) this.subscribe(); } };
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sig.send({ type: 'answer', sdp: { type: 'answer', sdp: answer.sdp } });
    setTimeout(() => { if (this.p2p === p && !p.open) { this.log('p2p: no direct link (different network), using the SFU'); this.dropP2P(); if (this.pubSession && !this.stopped && !this.sfu) this.subscribe(); } }, P2P_WAIT_MS + 3000);
  }
  dropP2P() {
    const p = this.p2p; if (!p) return; this.p2p = null;
    try { p.dc && p.dc.close(); } catch { /* */ } try { p.pc.close(); } catch { /* */ }
    if (this.state.path.tier === 'p2p') { this.state.live = false; this.state.path = classifyPath(null); this.emit(); }
  }

  // ---- rung 3 and 4: SFU over UDP, then via TURN ----
  async subscribe() {
    if (this.stopped || !this.pubSession || (this.p2p && this.p2p.open)) return;
    if (this.sfuTask) return;
    this.clearRetry();
    const pubSession = this.pubSession;
    this.sfuTask = (async () => {
      this.teardownSfu();
      try {
        const pc = new RTCPeerConnection(await iceServers(this.relayOnly));
        const s = { pc, dc: null, ac: null, session: null };
        this.sfu = s;
        const { sessionId } = await j('sfu/session', { method: 'POST' });
        s.session = sessionId;
        s.ac = await connectTransport(pc, sessionId, this.log);
        const r = await j(`sfu/session/${sessionId}/dc`, { method: 'POST', body: JSON.stringify({ location: 'remote', name: 'jk', sessionId: pubSession }) });
        const c = r.dataChannels && r.dataChannels[0];
        if (!c || typeof c.id !== 'number') throw new Error('SFU gave no channel id: ' + JSON.stringify(r).slice(0, 300));
        const dc = pc.createDataChannel('jk', { negotiated: true, id: c.id, ordered: true });
        dc.binaryType = 'arraybuffer';
        dc.onmessage = (e) => this.onBytes(e.data);
        s.dc = dc;
        await waitOpen(dc, 20000);
        if (this.p2p && this.p2p.open) { this.teardownSfu(); return; }   // Wi-Fi won the race after all
        this.state.live = true; this.state.error = null; this.state.path = await pathOf(pc); this.sig.reportPath(this.state.path.tier); this.emit();
        this.log(`live: subscribed on ${this.state.path.label}`);
        pc.addEventListener('iceconnectionstatechange', () => this.log(`ice (sfu): ${pc.iceConnectionState}`));
        clearInterval(this.pathTimer);
        this.pathTimer = setInterval(async () => { if (this.sfu === s) { const p = await pathOf(pc); if (p.tier !== this.state.path.tier) { this.log(`live: path changed ${this.state.path.label} -> ${p.label}`); this.sig.reportPath(p.tier); } this.state.path = p; this.emit(); } }, 5000);
        pc.addEventListener('connectionstatechange', () => {
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !this.stopped && this.sfu === s) {
            this.log(`live: transport ${pc.connectionState}`); this.scheduleRetry(RETRY_S);
          }
        });
      } catch (err) {
        if (this.stopped) return;
        const full = err.status === 429;
        if (!full && !this.relayOnly && /not connected|connection failed/.test(err.message)) { this.relayOnly = true; this.log('live: UDP path failed, next attempt via TURN relay'); }
        this.state.error = full ? `server full (${err.body.conns}/${err.body.limit})` : err.message;
        this.log('live: ' + this.state.error);
        this.scheduleRetry(full ? FULL_RETRY_S : RETRY_S);
      }
    })();
    try { await this.sfuTask; } finally { this.sfuTask = null; }
  }
  async onBytes(data) {
    try {
      const env = await decrypt(this.key, new Uint8Array(data));
      if (!validEnvelope(env)) return;
      this.state.received++; this.lastRxAt = this.now();
      if (this.state.reader === false) { this.state.reader = true; this.emit(); }   // data beats the server's word
      this.onEnvelope(env);
    } catch { if (!this.state.error) this.log('live: a message could not be decrypted (wrong or missing key)'); this.state.error = 'cannot decrypt: wrong or missing key'; this.emit(); }
  }
  scheduleRetry(seconds) {
    if (this.stopped) return;
    this.state.live = false; this.sig.reportPath('none'); this.teardownSfu();
    this.clearRetry();
    this.cancelRetry = countdown(seconds, (left) => { this.state.retryIn = left; this.emit(); }, () => { this.cancelRetry = null; this.state.retryIn = null; this.subscribe(); });
  }
  clearRetry() { if (this.cancelRetry) { this.cancelRetry(); this.cancelRetry = null; } this.state.retryIn = null; }
  /** The tab just came back: do not sit out a retry countdown or the socket reopen delay. */
  nudge() {
    if (this.stopped) return;
    if (this.sig) this.sig.nudge();
    if (this.cancelRetry) { this.log('live: tab resumed, retrying now'); this.clearRetry(); this.subscribe(); }
  }
  teardownSfu() {
    clearInterval(this.pathTimer); this.pathTimer = null;
    const s = this.sfu; if (!s) return; this.sfu = null;
    try { s.dc && s.dc.close(); } catch { /* */ } try { s.pc.close(); } catch { /* */ } try { s.ac && s.ac.close(); } catch { /* */ }
    if (this.state.path.tier !== 'p2p') { this.state.live = false; this.state.path = classifyPath(null); }
  }
  stop() {
    this.stopped = true; this.clearRetry(); clearTimeout(this.p2pDeadline); clearTimeout(this.recheck); this.recheck = null;
    this.dropP2P(); this.teardownSfu(); if (this.sig) this.sig.close(); unwatchNet(this);
    this.state.live = false; this.emit();
  }
}
