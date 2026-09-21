// BatRay by ClearEvo.com - tests (batray_live.test.js)
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toB64url, fromB64url, makeKeyB64, validKey, shareLink, parseShare, importKey, encrypt, decrypt, envelope, validEnvelope, classifyPath, selectedLocalCandidate , isPrivateAddress, classifyDirect, selectedPair } from '../public/batray/live-logic.js';

test('base64url round trip and key shape', () => {
  const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual([...fromB64url(toB64url(b))], [...b]);
  const k = makeKeyB64();
  assert.equal(k.length, 22); assert.ok(validKey(k)); assert.ok(!validKey('short')); assert.ok(!validKey(k + '/'));
});

test('share link carries the key only in the fragment and parses back', () => {
  const room = 'AbCdEfGhIjKlMnOpQrStUv', key = makeKeyB64();
  const link = shareLink('https://www.clearevo.com', room, key);
  assert.equal(link, `https://www.clearevo.com/batray/?view=${room}#k=${key}`);
  assert.deepEqual(parseShare(link), { room, key });
  assert.equal(parseShare('https://www.clearevo.com/batray/?view=' + room), null, 'no key, no view');
  assert.equal(parseShare('https://www.clearevo.com/batray/'), null);
  assert.equal(new URL(link).search.includes(key), false, 'key must not be in the query string');
});

test('encrypt/decrypt round trip, wrong key fails, tamper fails', async () => {
  const k1 = await importKey(makeKeyB64()), k2 = await importKey(makeKeyB64());
  const msg = envelope('data', { id: 'p1', name: 'n11' }, { soc: 63, cells: [3.27, 3.28] });
  const bytes = await encrypt(k1, msg);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 12);
  const back = await decrypt(k1, bytes);
  assert.deepEqual(back, msg);
  await assert.rejects(decrypt(k2, bytes));
  const t = new Uint8Array(bytes); t[t.length - 1] ^= 1;
  await assert.rejects(decrypt(k1, t));
  const b2 = await encrypt(k1, msg);
  assert.notDeepEqual([...b2.slice(0, 12)], [...bytes.slice(0, 12)], 'fresh IV every time');
});

test('envelope validation', () => {
  const ok = envelope('info', { id: 'a', name: 'x' }, {});
  assert.ok(validEnvelope(ok));
  assert.ok(!validEnvelope({ k: 'exec', p: { id: 'a' }, t: 1 }));
  assert.ok(validEnvelope(envelope('hist-file', { id: '*', name: '*' }, { day: '2026-09-20', n: 0, of: 2, b64: 'AA==' })), 'history day files travel as hist-file chunks');
  assert.ok(!validEnvelope(envelope('hist', { id: '*', name: '*' }, {})), 'the 0.9.29 row chunks are gone');
  assert.equal(envelope('data', { id: 'p', name: 'BMS 1', label: 'JK-B2A24S' }, {}).p.name, 'JK-B2A24S', 'the envelope carries the pack label the reader shows, so viewer rows match');
  assert.ok(!validEnvelope({ k: 'data', p: { id: 'x'.repeat(65) }, t: 1 }));
  assert.ok(!validEnvelope(null));
});

test('path classification', () => {
  assert.equal(classifyPath(null).tier, 'unknown');
  assert.equal(classifyPath({ candidateType: 'prflx', protocol: 'udp' }).tier, 'udp');
  assert.equal(classifyPath({ candidateType: 'host', protocol: 'tcp' }).tier, 'tcp');
  assert.equal(classifyPath({ candidateType: 'relay', protocol: 'udp', relayProtocol: 'tcp' }).tier, 'relay-tcp');
  assert.equal(classifyPath({ candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls' }).tier, 'relay-tls');
  assert.equal(classifyPath({ candidateType: 'relay', protocol: 'udp', relayProtocol: 'udp' }).tier, 'relay-udp');
});

test('selected local candidate from a stats report', () => {
  const stats = new Map([
    ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' }],
    ['P', { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', currentRoundTripTime: 0.0421 }],
    ['L', { id: 'L', type: 'local-candidate', candidateType: 'relay', protocol: 'udp', relayProtocol: 'tls' }],
    ['R', { id: 'R', type: 'remote-candidate', candidateType: 'host', protocol: 'udp' }],
  ]);
  const l = selectedLocalCandidate(stats);
  assert.equal(l.candidateType, 'relay'); assert.equal(l.rttMs, 42);
  assert.equal(classifyPath(l).label, 'TURN relay over TLS 443');
  assert.equal(selectedLocalCandidate(new Map()), null);
});

// ---- a direct link is only "same network" when both ends sit on private addresses ----
test('isPrivateAddress: LAN, link-local, ULA and mDNS are private; public v4/v6 are not', () => {
  for (const a of ['192.168.1.20', '10.0.0.5', '172.16.4.1', '172.31.255.9', '169.254.10.1', '127.0.0.1', 'fe80::1', 'fd12:3456::1', '::1', 'a1b2c3d4-e5f6.local']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['172.32.0.1', '8.8.8.8', '2001:44c8:4000::1', '2405:9800:b660:1::2', '']) assert.equal(isPrivateAddress(a), false, a || '(empty)');
});

test('classifyDirect: same Wi-Fi vs IPv6 peer to peer across the internet (a viewer on 5G)', () => {
  assert.deepEqual(classifyDirect({ address: '192.168.1.20' }, { address: '192.168.1.30' }).sub, 'lan');
  assert.deepEqual(classifyDirect({ address: '192.168.1.20' }, { address: 'abc.local' }).sub, 'lan', 'mDNS remote only resolves on the LAN');
  assert.deepEqual(classifyDirect({ address: '2405:9800:b660:1::2' }, { address: '2001:44c8:4000::1' }).sub, 'inet', 'global IPv6 on both ends: direct, but across the internet');
  assert.deepEqual(classifyDirect({ address: '192.168.1.20' }, { address: '2001:44c8:4000::1' }).sub, 'inet');
  assert.equal(classifyDirect(null, null).tier, 'p2p', 'still a direct link when stats are missing');
  assert.equal(classifyDirect(null, null).sub, 'inet', 'unknown addresses are not claimed to be the same network');
});

test('selectedPair: local and remote candidates of the nominated pair', () => {
  const stats = new Map([
    ['t', { id: 't', type: 'transport', selectedCandidatePairId: 'p' }],
    ['p', { id: 'p', type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r', currentRoundTripTime: 0.012 }],
    ['l', { id: 'l', type: 'local-candidate', address: '192.168.1.20', candidateType: 'host' }],
    ['r', { id: 'r', type: 'remote-candidate', address: '192.168.1.30', candidateType: 'host' }],
  ]);
  const pr = selectedPair(stats);
  assert.equal(pr.local.address, '192.168.1.20'); assert.equal(pr.remote.address, '192.168.1.30'); assert.equal(pr.rttMs, 12);
  assert.equal(selectedPair(new Map()), null);
});
