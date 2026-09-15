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
import { toB64url, fromB64url, makeKeyB64, validKey, shareLink, parseShare, importKey, encrypt, decrypt, envelope, validEnvelope, classifyPath, selectedLocalCandidate } from '../public/batray/live-logic.js';

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
