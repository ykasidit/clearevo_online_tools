// BatRay by ClearEvo.com - stored debug log pure decisions: session files, rolling, retention, what Upload sends
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
// Owner ask 2026-09-23: the debug log lives in the browser's private storage,
// not only in a 4000-line ring buffer that a refresh empties and a busy hour
// fills. One file per session, rolled at LOG_FILE_MAX with a new timestamp
// and the same session id, the newest LOG_FILES_MAX files kept. Every
// decision is here; the history worker writes the files; the app shell wires it.

export const LOG_FILE_MAX = 10 * 1048576;
export const LOG_FILES_MAX = 10;
export const LOG_FLUSH_MS = 3000;
export const LOG_UPLOAD_MAX = 4 * 1048576;        // what the relay accepts (log.rs MAX_LOG_BYTES)
export const LOG_KEY = 'batray_debuglog';        // localStorage: '0' = the user opted out

export function logState(on = true, sid = null) {
  return { on: !!on, sid: sid || newSessionId(), file: null, fileBytes: 0, pending: [], pendBytes: 0, files: [], sessionBytes: 0, fileMax: LOG_FILE_MAX, filesMax: LOG_FILES_MAX, backend: 'none' };
}
export function newSessionId() { return Math.random().toString(36).slice(2, 8).padEnd(6, '0'); }
const utf8 = new TextEncoder();
/** log-2026-09-23T01-02-03Z-<sid>.txt: sorts by time, names the session, opens anywhere. */
export function logFileName(startMs, sid) { return `log-${new Date(startMs).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-')}-${sid}.txt`; }
export function parseLogName(name) {
  const m = /^log-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z-([a-z0-9]{6})\.txt$/.exec(name);
  return m ? { start: Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`), sid: m[5] } : null;
}
/** A line was logged: queue it for the file (the ring buffer is the caller's). */
export function logQueue(ls, line) {
  if (!ls.on) return false;
  ls.pending.push(line); ls.pendBytes += utf8.encode(line).length + 1;
  return true;
}
/** Where the queued lines go: the current file, or a new one when the current would pass fileMax (or none is open).
 *  A new file starts with the header facts block, so every file is a complete, uploadable log on its own. */
export function flushPlan(ls, now) {
  if (!ls.pending.length) return { action: 'noop' };
  const roll = !ls.file || ls.fileBytes + ls.pendBytes > ls.fileMax;
  return { action: 'write', file: roll ? logFileName(now, ls.sid) : ls.file, roll, bytes: ls.pendBytes, lines: ls.pending.length };
}
/** After the write landed. */
export function flushDone(ls, file, fileBytes, wrote) {
  ls.file = file; ls.fileBytes = fileBytes; ls.sessionBytes += wrote; ls.pending = []; ls.pendBytes = 0;
}
/** Files beyond the newest `max`, oldest first (names sort by time). */
export function logRetention(files, max = LOG_FILES_MAX) {
  const sorted = [...files].filter((f) => parseLogName(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
  return sorted.length > max ? sorted.slice(0, sorted.length - max) : [];
}
export function logSummary(files) { return { files: files.length, bytes: files.reduce((a, f) => a + (f.bytes || 0), 0) }; }
/** What Upload sends: the stored session file when it fits the relay's limit, its tail (after the header) when it does
 *  not, else the ring buffer. `header` = the facts block, `ring` = the buffer text. */
export function uploadBody({ header, ring, stored, limit = LOG_UPLOAD_MAX }) {
  const head = header.join('\n') + '\n---\n';
  if (stored && stored.length) {
    if (stored.length <= limit) return { body: stored, source: 'file' };
    const room = Math.max(0, limit - head.length - 120);
    const cut = stored.length - room;
    return { body: `${head}(stored log is ${stored.length} B: this is its tail from byte ${cut})\n${stored.slice(cut)}`, source: 'file-tail' };
  }
  return { body: head + ring, source: 'ring' };
}
/** Copy / Upload while the stored log is off: greyed with a title that says where to turn it on. */
export function debugButtons(on) { return { disabled: !on }; }

// ---- the last-run record (owner ask 2026-09-23): Chrome gives a page no tombstone after an "Aw, Snap", so the
// app writes one itself every MEM_LOG_MS into localStorage and marks it clean on pagehide. The next start reads it
// and puts what it says at the top of the new log; the previous session's stored log file is the rest of the story.
export const LASTRUN_KEY = 'batray_lastrun';
export function lastRunRecord({ sid, now, mem, rows, state, file, clean = false }) {
  return { sid, at: now, mem: mem ? { used: mem.used, limit: mem.limit } : null, rows: rows || 0, state: state || '', file: file || null, clean: !!clean };
}
/** Lines for the top of a new log about the previous run: null when there was none. */
export function lastRunReport(prev, now, { wasDiscarded = false, navType = '' } = {}) {
  if (!prev || typeof prev !== 'object' || typeof prev.at !== 'number') return null;
  const ago = Math.max(0, Math.round((now - prev.at) / 60000));
  const when = `${new Date(prev.at).toISOString()} (${ago} min before this start)`;
  const lines = [];
  if (prev.clean) lines.push(`previous session ${prev.sid || '?'} ended cleanly at ${when}${prev.file ? `; its log file: ${prev.file}` : ''}`);
  else {
    lines.push(`previous session ${prev.sid || '?'} ENDED WITHOUT A CLEAN EXIT (a crash, an "Aw, Snap", a killed tab, or a lost power): last seen ${when}`);
    lines.push(`  last known: state ${prev.state || '?'}; memory ${prev.mem ? `${Math.round(prev.mem.used / 1048576)} MB of ${Math.round(prev.mem.limit / 1048576)} MB` : 'unknown'}; ${prev.rows} rows in memory${prev.file ? `; its log file: ${prev.file} (Browse in the History card)` : ''}`);
  }
  lines.push(`  this start: ${navType || 'navigate'}${wasDiscarded ? '; Chrome had DISCARDED the tab (memory pressure) and this is its reload' : ''}`);
  return lines;
}
