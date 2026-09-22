// BatRay by ClearEvo.com - Share live pure logic: keys, links, envelopes, encryption, path tiers (tested)
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

// Pure helpers for BatRay live share: share links, end-to-end encryption of
// frames, the wire envelope, and the "which path" label. No DOM, no WebRTC,
// so node --test covers it. Uses WebCrypto (globalThis.crypto).

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function toB64url(bytes) {
  let s = '', acc = 0, bits = 0;
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 6) { bits -= 6; s += B64[(acc >> bits) & 63]; } }
  if (bits > 0) s += B64[(acc << (6 - bits)) & 63];
  return s;
}
export function fromB64url(s) {
  const out = []; let acc = 0, bits = 0;
  for (const ch of s) { const v = B64.indexOf(ch); if (v < 0) throw new Error('bad base64url'); acc = (acc << 6) | v; bits += 6; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); } }
  return new Uint8Array(out);
}

/** 128-bit random key, base64url (22 chars). Lives only in the share link fragment. */
export function makeKeyB64() {
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b); return toB64url(b);
}
export const validKey = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
export const validRoom = validKey;

/** Viewer link. The key rides in the fragment, which browsers never send to any server. */
export function shareLink(origin, room, keyB64) {
  return `${origin}/batray/?view=${room}#k=${keyB64}`;
}
/** Parse a viewer link (or the current location) into { room, key } or null. */
export function parseShare(href) {
  try {
    const u = new URL(href);
    const room = u.searchParams.get('view');
    const key = new URLSearchParams(u.hash.replace(/^#/, '')).get('k');
    return validRoom(room) && validKey(key) ? { room, key } : null;
  } catch { return null; }
}

export async function importKey(keyB64) {
  return globalThis.crypto.subtle.importKey('raw', fromB64url(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
const te = new TextEncoder(), td = new TextDecoder();
/** AES-GCM: 12-byte IV || ciphertext, as one Uint8Array (sent as a binary message). */
export async function encrypt(key, obj) {
  const iv = new Uint8Array(12); globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12); return out;
}
export async function decrypt(key, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 13) throw new Error('short message');
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
  return JSON.parse(td.decode(pt));
}

/** Wire envelope: kind = data | info | settings | packs | hello; pack = { id, name }. */
export function envelope(kind, pack, v, extra = null) {
  return { k: kind, p: { id: pack.id, name: pack.label || pack.name }, v, t: Date.now(), ...(extra || {}) };   // extra: { r: the stored row } on a live reading
}
export function validEnvelope(m) {
  return !!m && typeof m === 'object' && ['data', 'info', 'settings', 'packs', 'hello', 'hist-file'].includes(m.k)
    && m.p && typeof m.p.id === 'string' && m.p.id.length <= 64 && typeof m.t === 'number';
}

/**
 * Label for the ICE path a PeerConnection ended up on, from its selected
 * candidate pair. With an SFU every path ends at Cloudflare; what differs is
 * whether UDP got through or a TURN relay had to carry it, and over what.
 */
export function classifyPath(local) {
  if (!local) return { tier: 'unknown', label: 'connecting' };
  if (local.candidateType === 'relay') {
    const p = (local.relayProtocol || local.protocol || '').toLowerCase();
    if (p === 'tls') return { tier: 'relay-tls', label: 'TURN relay over TLS 443' };
    if (p === 'tcp') return { tier: 'relay-tcp', label: 'TURN relay over TCP' };
    return { tier: 'relay-udp', label: 'TURN relay over UDP' };
  }
  if ((local.protocol || '').toLowerCase() === 'tcp') return { tier: 'tcp', label: 'direct TCP to Cloudflare' };
  return { tier: 'udp', label: 'direct UDP to Cloudflare' };
}

/** Private / link-local / mDNS addresses: reachable only on the same network.
 *  Anything else on a direct link means a public route - IPv6 peer to peer
 *  across the internet (seen on a phone on 5G reaching a home Wi-Fi reader). */
export function isPrivateAddress(a) {
  if (!a) return false;
  const s = String(a).toLowerCase();
  if (s.endsWith('.local')) return true;                              // mDNS name: only resolves on the LAN
  if (/^(10\.|127\.|169\.254\.|192\.168\.)/.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (s === '::1' || s.startsWith('fe80:') || /^f[cd][0-9a-f]{2}:/.test(s)) return true;   // loopback, link-local, ULA
  return false;
}

/** Classify a direct (no server) link from its selected candidate pair. */
export function classifyDirect(local, remote) {
  const lan = !!local && !!remote && isPrivateAddress(local.address || local.ip) && isPrivateAddress(remote.address || remote.ip);
  return lan ? { tier: 'p2p', sub: 'lan', label: 'direct, same network' } : { tier: 'p2p', sub: 'inet', label: 'direct, over the internet' };
}

/** Selected candidate pair {local, remote, rttMs} from a getStats() report. */
export function selectedPair(stats) {
  const byId = new Map(); let pairId = null;
  stats.forEach((s) => { byId.set(s.id, s); if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
  let pair = pairId ? byId.get(pairId) : null;
  if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s; });
  if (!pair) return null;
  return { local: byId.get(pair.localCandidateId) || null, remote: byId.get(pair.remoteCandidateId) || null, rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null };
}

/** Pick the selected local candidate out of a getStats() report (Map-like). */
export function selectedLocalCandidate(stats) {
  const byId = new Map(); let pairId = null;
  stats.forEach((s) => { byId.set(s.id, s); if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
  let pair = pairId ? byId.get(pairId) : null;
  if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) pair = s; });
  if (!pair) return null;
  const l = byId.get(pair.localCandidateId) || null;
  return l ? { ...l, rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null } : null;
}

// ---- reader presence (viewer side) ----
// The relay wipes the room's session the moment the reader's presence socket
// closes, even for a 4 s blink, and tells every viewer "no reader". Meanwhile
// the direct link (or the SFU stream) keeps delivering readings. Seen live on
// 2026-09-17: "reader offline" over a screen that was updating every 3 s.
// Rule, same as for the Bluetooth link: freshness decides. Data that arrived
// within FRESH_MS proves the reader is there whatever the server says.
export const FRESH_MS = 15000;          // a JK BMS is read every 3 s; five misses is a real gap

/** Has a reading arrived recently enough to prove the reader is alive? */
// The signalling socket needs a heartbeat of its own (reader log 2026-09-22: the relay had dropped the reader's
// socket, wiped its session and told viewers "no reader", while the reader's socket looked open for hours - a
// half-open TCP link after a Wi-Fi change gets no close event, and with no viewers nothing is ever sent on it).
export const SIG_PING_MS = 10000;        // send {type:'ping'} this often; the relay answers {type:'pong'} without waking (owner: 10 s)
export const SIG_DEAD_MS = 30000;        // no message of any kind for this long = the socket is dead at either end or at the relay: close and reopen (owner: 30 s)
/** What the signalling socket should do now. */
export function sigDecision({ lastMsgAt, lastPingAt, now }) {
  if (now - lastMsgAt >= SIG_DEAD_MS) return { action: 'reopen', silentS: Math.round((now - lastMsgAt) / 1000) };
  if (now - lastPingAt >= SIG_PING_MS) return { action: 'ping' };
  return { action: 'wait' };
}
/** An envelope older than FRESH_MS when it arrives came out of a queue (a frozen tab, a stalled link), not from now. */
export function staleEnvelope(env, now = Date.now(), freshMs = FRESH_MS) { return typeof env.t === 'number' && now - env.t > freshMs; }
export function dataFlowing(lastRxAt, now = Date.now(), freshMs = FRESH_MS) {
  return lastRxAt !== null && lastRxAt !== undefined && now - lastRxAt < freshMs;
}

/**
 * The reader presence to show: null = not known yet, true = present, false =
 * gone. serverLive is the relay's word (session registered); it is overridden
 * by fresh data, never the other way round.
 */
export function readerPresent({ serverLive, lastRxAt, now = Date.now(), freshMs = FRESH_MS }) {
  if (dataFlowing(lastRxAt, now, freshMs)) return true;
  if (serverLive === null || serverLive === undefined) return null;
  return !!serverLive;
}

// ---- channel name (shown above the QR and at the top of the viewer) ----
export const CAT_NAMES = ['Mochi', 'Whiskers', 'Biscuit', 'Tabby', 'Luna', 'Simba', 'Nala', 'Pumpkin', 'Oreo', 'Salem', 'Cleo', 'Milo', 'Tigger', 'Ginger', 'Smokey', 'Pepper', 'Muffin', 'Noodle', 'Peanut', 'Waffles', 'Purrito', 'Catnip', 'Snowball', 'Boots', 'Felix', 'Kitkat', 'Sushi', 'Mittens', 'Shadow', 'Pickles'];
export const MAX_CHANNEL_NAME = 40;

/** Prefill for the share name: the saved one, else the BMS's own name, else a cat. */
export function suggestChannelName({ saved, deviceName, rand = Math.random }) {
  const clean = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_CHANNEL_NAME) : '');
  if (clean(saved)) return clean(saved);
  const dn = clean(deviceName);
  if (dn && !/^(DEMO|BMS \d+)$/i.test(dn)) return dn;
  return CAT_NAMES[Math.min(CAT_NAMES.length - 1, Math.floor(rand() * CAT_NAMES.length))];
}

/** The saved share credentials, if the stored shape is sane. */
export function parseSavedShare(raw) {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.room === 'string' && typeof o.pub === 'string' && validKey(o.key) && Number.isFinite(o.at)) return o;
  } catch { /* */ }
  return null;
}
