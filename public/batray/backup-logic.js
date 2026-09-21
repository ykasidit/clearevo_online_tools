// BatRay by ClearEvo.com - backup pure logic: a .tar of the daily gzip files, restore plan (tested against system tar)
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
// Source: https://github.com/ykasidit/clearevo_online_tools//
// Backup and restore of the whole history as one .tar (ustar) holding the
// daily gzip files, uncompressed on the outside because the members already
// are: 7-Zip, Windows 11 and every Unix open it. Pure functions over bytes.

export const BACKUP_MAX_BYTES = 512 * 1048576;
export const BACKUP_DIR = 'batray-history/';
const enc = new TextEncoder(), dec = new TextDecoder();

function octal(n, len) { return n.toString(8).padStart(len - 1, '0') + '\0'; }
function header(name, size, mtimeS) {
  const h = new Uint8Array(512);
  const put = (off, str) => { const b = enc.encode(str); h.set(b.subarray(0, Math.min(b.length, 100)), off); };
  put(0, name); put(100, octal(0o644, 8)); put(108, octal(0, 8)); put(116, octal(0, 8));
  put(124, octal(size, 12)); put(136, octal(mtimeS, 12));
  h.fill(32, 148, 156);                                          // checksum field counts as spaces
  put(156, '0'); put(257, 'ustar\0'); put(263, '00'); put(265, 'batray'); put(297, 'batray');
  let sum = 0; for (const b of h) sum += b;
  put(148, sum.toString(8).padStart(6, '0') + '\0 ');
  return h;
}
/** entries: [{ name, bytes }] -> the .tar bytes. */
export function tarPack(entries, mtimeS = Math.floor(Date.now() / 1000)) {
  let total = 1024;
  for (const e of entries) total += 512 + Math.ceil(e.bytes.length / 512) * 512;
  const out = new Uint8Array(total); let o = 0;
  for (const e of entries) {
    out.set(header(e.name, e.bytes.length, mtimeS), o); o += 512;
    out.set(e.bytes, o); o += Math.ceil(e.bytes.length / 512) * 512;
  }
  return out;
}
/** The members of a .tar: [{ name, bytes }]; stops at the end blocks; throws on a bad header. */
export function tarParse(bytes) {
  const out = []; let o = 0;
  while (o + 512 <= bytes.length) {
    const h = bytes.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const name = dec.decode(h.subarray(0, 100)).replace(/\0.*$/s, '');
    const size = parseInt(dec.decode(h.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8);
    if (!name || !Number.isFinite(size)) throw new Error('not a tar file');
    const type = String.fromCharCode(h[156] || 48);
    o += 512;
    if (type === '0' || type === '\0') out.push({ name, bytes: bytes.subarray(o, o + size) });
    o += Math.ceil(size / 512) * 512;
  }
  return out;
}
/** Day files inside a backup: {day, bytes} for members named <day>.ndjson.gz (with or without the directory). */
export function backupDays(entries) {
  const out = [];
  for (const e of entries) {
    const m = /(?:^|\/)(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/.exec(e.name);
    if (m) out.push({ day: m[1], bytes: e.bytes });
  }
  return out;
}
/** Which backup days to write: the ones this device lacks, and the ones where the backup is larger (a fuller copy). */
export function restorePlan(existing, incoming) {
  const have = new Map(existing.map((d) => [d.day, d]));
  const write = [], skip = [];
  for (const d of incoming) { const h = have.get(d.day); if (!h || (d.bytes.length > h.bytes)) write.push(d); else skip.push(d.day); }
  return { write, skip };
}
export const backupName = (dayKey) => `batray-history-${dayKey}.tar`;
