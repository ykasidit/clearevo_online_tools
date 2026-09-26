<img src="icon-512.png" width="72" align="left" alt="BatRay icon">

# BatRay by ClearEvo.com

JK (JiKong) BMS monitor over Web Bluetooth: pack voltage, state of charge, current, power, per-cell voltages, temperatures, capacity, cycles and the configured protection limits, live in Chrome. Frame layout chosen from the firmware version and cross-checked against the cell sum. Share live to any other browser (readings encrypted on the phone, key only in the link), several BMS in parallel, Chrome-notification alerts, EN/ไทย. The relay behind `/batray/api/` is a separate, private Cloudflare Worker; this app talks to it over a small JSON/WebSocket contract (see `live.js`).

Live: **https://www.clearevo.com/batray/**

Part of [ClearEvo online tools](../../README.md). Battery data stays on the device unless Share live is turned on.

## Code layout: functional core, imperative shell

Every flow with state follows one rule, decided 2026-09-20 after flaky state
had bitten reconnect, viewer presence and Cast in turn. The author's habit
from Linux kernel driver work, Go and Rust (a context struct is passed to every
function, the function stays pure) and from a QGIS plugin (one global map
passed to every function) is the house style here:

- **One plain state object per flow**, made by a factory: `connState()` per
  BMS pack, `shareState()`, `viewState()`, `reachState()`, `tvUiState()`,
  `castState()`, `wakeState()`. No hidden state anywhere else.
- **Pure decision functions take that object as a parameter** and return a
  decision (`{ action: 'countdown', seconds: 5 }`) or update its counters.
  They never touch the DOM, timers, sockets, GATT or a library. In JS terms
  this is a reducer / "functional core, imperative shell"; the same shape as
  a kernel `struct foo *ctx` handed to `foo_do_thing(ctx, ...)`.
- **`app.js` is the shell**: it owns the timers, the chooser, the sockets,
  the encoder, the DOM; it asks the decision function, acts on the answer,
  and logs it (`conn: attempt-failed -> retry attempt 2 [connecting]`,
  `cast: tap -> request`). Buttons render from the state object too: the
  Share and Show on TV toolbar buttons are sunk while running, pressing them
  (or Close on the card) stops the thing with a toast.
- **File names**: `<flow>-logic.js` is the functional core (no imports of
  browser APIs), `<flow>.js` is the I/O for that flow (`live.js` sockets,
  `tv.js` encoder, `jkbms.js` GATT, `alerts.js` notifications),
  `test/batray_<flow>.test.js` replays the exact sequence from a real log
  (the two phones' cast state events, the old Sony's wake-lock drops,
  Android's three GATT refusals) so the flaky sequence is reproduced in node
  before the fix ships and stays reproduced. `test/browser/*.mjs` drive the
  real page in headless Chrome as integration checks on top.

| flow | state object | functional core | I/O shell | replay test |
|---|---|---|---|---|
| BLE connect / retry / countdown | `p.cs` = `connState()` | `conn-logic.js` | `jkbms.js`, `app.js` | `batray_conn.test.js`, `browser/batray_freeze.mjs` |
| Share live (reader) | `shareS` | `share-logic.js`, `live-logic.js` | `live.js`, `app.js` | `batray_share.test.js`, `batray_presence.test.js`, `browser/batray_log.mjs` |
| Viewer + reachability | `viewS`, `reachS` | `share-logic.js`, `live-logic.js` | `live.js`, `app.js` | `batray_share.test.js`, `batray_presence.test.js` |
| Show on TV card and button | `tvS` | `tv-logic.js` | `tv.js`, `app.js` | `batray_tv.test.js`, `browser/batray_tv.mjs` |
| Cast to TV picker | `castS` | `cast-logic.js` | `app.js` (Google's sender) | `batray_cast.test.js`, `browser/batray_tv.mjs` |
| Screen wake lock + keep-awake video | `wakeS` | `wake-logic.js` | `app.js` | `batray_wake.test.js`, `browser/batray_freeze.mjs` |
| Alerts, time-to-go | rule tables | `alerts-logic.js`, `trend.js` | `alerts.js`, `app.js` | `batray_alerts.test.js`, `batray_trend.test.js` |
| Stored history: day files, rollover, retention by free space, the transfer plan, chart windows | `histS` | `history-logic.js` | `history.js` + `history-worker.js` (OPFS), `history-chart.js` (uPlot), `app.js` | `batray_history.test.js`, `browser/batray_history.mjs` (files survive a reload, gzip, torn tail, backup/restore, received file, delete sheet) |
| Storage box: usage percent, the three rows, settings file checks | facts in | `storage-logic.js` | `app.js` | `batray_storage.test.js`, `browser/batray_history.mjs` |
| Stored debug log: session files, rolling, retention, what Upload sends | `logS` | `log-logic.js` | the history worker, `app.js` | `batray_log.test.js`, `browser/batray_log.mjs` |
| Backup / restore (.tar of the daily gz) | bytes in, bytes out | `backup-logic.js` | `app.js` (download, file input), the worker | `batray_backup.test.js` (round trip through system tar) |
| Remembered BMS button | saved id + name, getDevices | `conn-logic.js` `knownDevice`, event `known` | `app.js` | `batray_conn.test.js`, `browser/batray_history.mjs` |
| The picture, chips, cell line, "updated", TV frame model | a decoded reading | `view-logic.js` | `app.js` paints, `tv-draw.js` draws | `batray_view.test.js` (the owner's real frame) |
| UI chrome: tabs, bottom sheets, Back, low power, sheet contents | `uiS` | `ui-logic.js` | `app.js` (history API, DOM) | `batray_ui.test.js`, `browser/batray_ui.mjs` (48 px audit, sheets, tabs) |
| BMS frames (reassembly, CRC, decoding by variant) | a byte buffer | `jkbms.js` pure half | `jkbms.js` GATT half | `batray_jkbms.test.js` (real frames from 6 units), `browser/batray_freeze.mjs` |
| Strings EN / TH | `I18N` | `i18n.js` | `app.js` | `batray_i18n.test.js` (parity of keys, types, arities) |

The look and the interaction rules are in [UI_GUIDELINES.md](UI_GUIDELINES.md).

No store library or framework: the app has no build step beyond content
hashing, and explicit `render…()` calls after each decision keep it obvious
when the screen repaints.

## Cast: one request at a time, and the TV's own word (0.9.43, owner's log 2026-09-26)

The owner's log: the first Cast tap loaded the library and waited for
discovery; a second tap 7 s later requested the picker; the availability
flip came 0.1 s after that, the first tap's wait ended and it requested too
- `invalid_parameter` ("Already requesting session"), the "stuck" toast,
while the first request's picker was still open and later worked. Now
`castAfterDiscovery` answers `pending` while a request is open, and
`castRequestEnded(cs, token)` clears only the request that set it (replay
test). The TV accepted the load, reported IDLE twice within a millisecond,
and the log was uploaded 6 s later - too early for the receiver's verdict.
`watchCastMedia(sess)` now logs every media status update the TV sends
(`cast: tv update +Ns: player=IDLE idle=ERROR ...`, a vanished media
session) and polls every 3 s for 2 min; the phone's own preview player logs
playing / waiting / stalled / time updates, the nearest witness to what a
TV will do with the stream. The receiver's failure itself is still
unexplained: the stream is video-only H.264 High (avc1.640028) 1080p at
1 fps, one key frame per 1 s fMP4 segment, `EXT-X-VERSION:7` + `EXT-X-MAP`,
target duration 2 s, CORS `*` on the relay. Suspects, in order: the
Default Media Receiver's HLS player and a video-only 1 fps fMP4 stream, the
H.264 High profile, the 30 s live window. The next log (upload a minute
after the TV shows the icon) says which. Collapsing the TV card pauses and
unloads the preview; expanding it loads the preview again at the live edge
(the old preview sat on a position the 30 s window had left behind).

## The cast icon (0.9.44, owner ask 2026-09-26)

Both Cast buttons are now the standard cast icon (Google's Material Design
"cast" glyph, Apache 2.0, inlined as SVG): one in the row under the preview
and one laid over the preview's top-right corner, both named "Cast to TV"
for screen readers, both the same action; the words moved into the hint
line ("Cast to TV - <state>").

Why the preview's own controls show no cast icon, unlike videos on other
sites: that icon is Chrome's, and Chrome draws it only for a source it has
judged castable. In Chromium, `HTMLMediaElement::LoadResource` calls
`RemotePlaybackCompatibilityChanged(src, false)` for every new source
("consider it incompatible until proved otherwise"), and only
`WebMediaPlayerImpl::UpdateRemotePlaybackCompatibility(true)` from the
media pipeline flips it, which happens for plain progressive files the
demuxer parses (an MP4 or WebM URL - what other sites' videos are). An HLS
playlist played by Android's own player never gets that call, so
`RemotePlayback::GetAvailabilityUrl` returns nothing, `watchAvailability`
stays false and the native icon never appears (the same reason the Remote
Playback API never lit up in 0.9.18). MSE and blob sources are excluded the
same way. The only way to get Chrome's own icon would be a progressive live
MP4 URL instead of HLS - a relay redesign, not done.

## Stored history (0.9.29, owner decisions 2026-09-21)

The reader appends one NDJSON row per reading (short keys, cell millivolts
included) to `batray-history/<YYYY-MM-DD>.ndjson` in the browser's private
origin file system (OPFS, written from a worker with sync access handles,
flushed every 10 s and on hide). At the day change the previous day is
gzipped in place with `CompressionStream` to `.ndjson.gz`. NDJSON because
it appends (Parquet cannot), gzip because it needs no library; a Parquet
conversion is a later, server-side step.

0.9.30 (owner asks 2026-09-21): no day limit - the oldest days are deleted
only while the browser reports less than 100 MB free (`HEADROOM_BYTES`), a
`QuotaExceededError` deletes the oldest day and retries once, and the card
shows days, used of the browser's maximum and the estimated days left.
Every append lands on a newline boundary (a torn tail from a crash is
closed at startup and before any append) and reads, compaction and
transfers cut at the last newline. Every day key is UTC; only the chart
adds the browser's offset. Each stored row carries `n` (its row number in
the day file) and `o` (the byte offset where its line starts), so the file
length and the logging rate are visible in the rows themselves and a
viewer can say exactly how far its copy goes. Viewers keep a byte-for-byte
copy of the reader's files: a live reading travels with the reader's
stored row (`r` in the `data` envelope) and is appended only when it
starts where the copy ends; a row that does not fit is held, and the
viewer sends `hist-req` (its day listing, with today's length and row
count) over the signalling socket - at link-up, every 10 min, and 5 s
after a hole. The relay forwards it and the reader answers with the
gzipped day files the viewer lacks (newest first, 40 MB per request) and,
for today, the gzipped tail from the viewer's offset (or the whole file
when the viewer has more than the reader) in `hist-file` base64 chunks
over the encrypted link, paced by the data channels' backlog and only
while live. The worker appends a tail only at the exact offset; the held
rows are then placed in order. Backup is
one `.tar` (ustar, verified against system tar) of the daily gz files, up
to 512 MB; restore adds missing days and never replaces a fuller one. The
picked BMS's id and name are remembered (localStorage + `devices.ndjson`;
Chrome exposes no Bluetooth address to a page) and a green "Connect to
NAME" button connects without the chooser while `getDevices()` still lists
it. The History card draws with vendored uPlot (MIT): 1 h / 6 h / 24 h /
7 d / all, two-finger pinch, mouse drag, the inverter cut-off as a dashed
line, charged / discharged Wh for the window. DEMO readings never touch
the files. "Delete stored history" is a sheet. Without OPFS (or a failed
worker) the same store runs in memory for the session and the card says so.

## Link keepalive: no poll (0.9.33, owner's beep report 2026-09-23)

A JK BMS streams cell-info frames (type 0x02) on its own, 2-3 per second, once
the connect has sent device-info (0x97) and cell-info (0x96) once. Until 0.9.32
the driver also re-sent 0x96 every 3 s as a "poll". The owner's full-frame logs
(2026-09-22, two packs; 2026-09-23, n11) show what that did: every poll was
answered with a settings frame (0x01) and a device-info frame (0x03), one pair
per 3.02 s, 228 pairs per session - the read the JK app does once at connect -
and the BMS beeps each time it serves it. So the JK app beeped once, BatRay
every 3 s. Now (`NUDGE_MS`, `nudgeDecision()` in jkbms.js, replayed in the
unit test): no periodic command; the stream itself proves the link; one 0x96
is sent only after 6 s without a frame, once, before the 12 s `STALE_MS` drop.
A beep now means the link is already sick.

0.9.34 (owner's log 2026-09-23 23:04, JK-PB1A16S15P fw 19.16 and JK_PB1A16S15P
fw 15.21): a 0x96 written right behind 0x97 is ignored - the BMS is busy
serving the 300 B device-info answer - so nothing streamed and the link fell
about 10 s after connect. The order is now the JK app's: 0x97, wait for the
device-info frame (`HANDSHAKE_WAIT_MS` 1.5 s at most), then 0x96 once
(`_handshake()`, not blocking `connect()`); `NUDGE_MS` is 3 s and the nudge
repeats every 3 s of silence (at most four before the 12 s drop); the first
five non-frame notifications of a link are logged in hex (`rx NB not a
frame`), because that log had something arriving 4 s after connect that no
line explained. Unit tests replay both logs and drive `connect()` over a fake
characteristic.

### Startup asks (0.9.42, owner's log 2026-09-25 01:19)

The m-00 pack (JK-PB1A16S15P, hw 19A, fw 19.16) stopped streaming on
0.9.33-0.9.41 while s-01 (fw 15.21) was fine. Its log: device info at
+133 ms, the handshake's 0x96 at +134 ms, then a 20 B command echo
(`aa 55 90 eb c8 01 01 ...`) and "AT\r\n" chatter, no settings frame, no
cell info; the silence nudge waited for the chatter to end (every byte had
bumped lastRxAt) and asked at +7 s and +10 s, which the pack ignored, then
it dropped the link 0.6 s after the +10 s ask (the same 10.6 s death as in
the 0.9.33 log). On 0.9.31 the same pack had streamed every time, started
by the 3 s poll's 0x96 at +3 s. So `startupAskDecision(firstCellAt,
askedAt, now)`: until the first cell-info frame, 0x96 is asked again every
NUDGE_MS after the previous ask, whatever else arrives (log `startup: no
cell info 3 s after the ask, N non-frame notifications so far ... asking
again (0x96, ask k)`, then `startup: cell info after k asks`); once cell
info flows the silence nudge takes over as before, so a streaming pack is
never polled and never beeps. The replay test runs today's log timing.
Non-frame notifications are counted (the first five still logged in full)
so the next log shows how long the chatter lasted. If m-00 still does not
stream, the next thing to try is delaying the handshake's first 0x96 to
+3 s after connect (0.9.31's timing exactly).

## Memory caps (0.9.34, the "Aw, Snap" of 2026-09-23)

The reader phone crashed on 0.9.31 after a day at 4 rows/s: today's file was
88 MB, 314k rows, and start-up parsed the whole of today and yesterday into
memory. Now `hist.readTail(day, MEM_TAIL_BYTES)` (24 MB, from the first whole
line; the worker returns `{text, total, cut}`) is the most that is read for
memory or a chart, the in-memory set is thinned evenly to `MEM_MAX_ROWS`
(60k, `thinRows()`, newest row always kept) and the log says when either
happened. The files keep every row. `readGz` no longer spreads a day into
constructor arguments (an 88 MB day threw).

## Live memory line (0.9.35)

Chrome hands a page a LIVE `performance.memory` only when it is cross-origin
isolated; otherwise the figure is quantised and refreshed every ~20 minutes
(the owner's phone showed 10 MB with 327k rows in memory, and a sandbox probe
saw the figure not move after allocating 200k objects). The site therefore
sends `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` for /batray/ (deploy.sh
`_headers`, a site_checks rule), `memoryModel(perf, {precise, measured})`
carries `precise = crossOriginIsolated`, the line refreshes every 5 s
(`MEM_UI_MS`), and once a minute (`MEM_MEASURE_MS`)
`performance.measureUserAgentSpecificMemory()` gives the whole tab with a
breakdown (page / history worker / DOM / other, `memoryParts()`), which the
line shows in brackets and the `mem:` log line carries as `measured=`. On a
page without the headers the line says so. `credentialless` keeps the GA tag
and Google's cast sender loading.

## SQLite history (0.9.40, owner decision 2026-09-24)

"No more NDJSON, no more gz. SQLite, one file per day including live." The
worker runs the official sqlite.org WebAssembly build (`sqlite3.js` +
`sqlite3.wasm`, public domain, vendored) over its `opfs-sahpool` VFS: one
database `<YYYY-MM-DD>.sqlite` per UTC day in the pool directory
`batray-history-db`, today's included, with a `readings` table (dense `id`
per day handed out by the reader, `t`, pack, soc, v, i, w, ah, temps, MOS
flags, balance, error, cells as a u16 blob) and a unique `(p, t)` index.
Live rows are queued in the page (the only readings in main memory) and
inserted every 10 s and on hide; the DEMO pack goes into an in-memory
database that is never listed, exported or on disk. The chart is built
from bucket queries per window (`buckets()`, at most 800 points) and the
energy from a window function, refreshed after each flush: the page keeps
no table of rows, so a day of 300k rows costs nothing at start (the 0.9.34
"Aw, Snap"). Old `.ndjson` / `.ndjson.gz` files from before 0.9.40 are
neither read nor migrated (owner: day 0 is a breaking change); start logs
how many there are and Clear stored history removes them.

Owner rules, all tested: **read, write, insert and read tests including
same-time tests** (`batray_history_sql.test.js` on the real wasm in node,
20 inserts + 20 queries + 5 infos fired together in the browser),
**no block forever** - every store call carries a deadline
(`OP_TIMEOUT_MS`: insert 8 s, query 15 s, export/import 60 s ...) and rejects with a `TimeoutError` at it, three timeouts in a row
terminate the worker and start a fresh one (pending calls fail at once),
**failures go to the debug log** (once per distinct op + message, a full
disk every 10 s is one line) and **read/write statistics go to the debug
log** (`history stats: insert=N(Nok/Ffail/Ttimeout) mean/max ms rows ·
query=...` every heartbeat minute, then reset). The worker's own lines
arrive as `history worker: ...`.

Two Chrome facts, probed in the sandbox 2026-09-24, shape the edges:
(1) `pool.pauseVfs()` at pagehide crashed the renderer when the page then
entered the back/forward cache, so pagehide is synchronous: the queued rows
spill to localStorage (`batray_hist_spill`, restored by the next start),
the worker is terminated, and the next call starts a new one. (2) A worker
killed while it is busy in JavaScript never releases its OPFS access
handles (not after 2 minutes), so the fresh worker retries the pool for
20 s and the store then goes memory-only for the session, logs "the
storage pool stayed locked ... reload the page to store again" and the
Storage box says not stored; a reload takes the pool back. A worker that is
merely not answering (a timer) releases the pool on terminate at once. The
viewer's copy is by row id: `hist-req` carries `{day, maxId, contig}` per
day, the reader answers with the rows after `contig` as gzipped JSON in
`hist-file` base64 chunks. Backup is a `.tar` of the `.sqlite` files
(DB Browser for SQLite or Python opens a day); restore attaches each file
and merges the rows the local day lacks.

## Corrupt day files and the no-SQL-delete rule (0.9.41, owner 2026-09-24)

One file per day is also the space rule: a day is freed by unlinking its
file, never by a SQL delete (free pages stay until a compaction rewrites the
whole file). `batray_no_sql_delete.test.js` greps every first-party source
for `DELETE FROM`, `VACUUM`, `DROP TABLE` and `TRUNCATE TABLE` and fails on
a hit.

A damaged file (a bad flash block, a torn write) makes SQLite raise
`SQLITE_CORRUPT` / `SQLITE_NOTADB` on the next read or write. No repair at
this stage: the worker closes the file, logs `<day> database is corrupt
(<op>): ...`, and raises a `CorruptError` carrying the day and the op; the
store logs the failure and rethrows it; the caller decides
(`corruptDecision(day, today)`): the live writer (`flushHistory`) deletes
today's file, starts a new one and writes the flush's rows into it
(numbered from 1 on the reader; a viewer keeps the reader's ids), toasts
"Today's history file was damaged..."; a history reader (the chart query,
the day listing, the span, a transfer, Browse) deletes that day's file and
toasts "The history file of <day> was damaged and has been deleted."
Tested on the real wasm in node (a deserialized image with every byte after
the header set to 0xFF raises on every read and on a write, a full disk or a
bad statement does not) and in the browser through the `corrupt` worker
hook (today while live, a past day on a read).

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License, version 2** (see [`LICENSE`](../../LICENSE) at the
repository root). Distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. Not a safety device: it cannot be relied on to prevent damage or danger.
