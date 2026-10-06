<img src="icon-512.png" width="72" align="left" alt="BatRay icon">

# BatRay by ClearEvo.com

JK (JiKong) BMS monitor over Web Bluetooth: pack voltage, state of charge, current, power, per-cell voltages, temperatures, capacity, cycles and the configured protection limits, live in Chrome. Frame layout chosen from the firmware version and cross-checked against the cell sum. Share live to any other browser (readings encrypted on the phone, key only in the link), several BMS in parallel, Chrome-notification alerts, EN/ไทย. The relay behind `/batray/api/` is a separate, private Cloudflare Worker; this app talks to it over a small JSON/WebSocket contract (see `live.js`).

Live: **https://www.clearevo.com/batray/**

Part of [ClearEvo online tools](../../README.md). Battery data stays on the device unless Share live is turned on.

## House rules, and the tests that enforce them

Decided by the author over 2026-09-20 to 2026-10-01, after flaky state had
bitten reconnect, presence, Cast and the live link in turn. They were added
gradually, one per lesson, so BatRay follows all of them while the older
apps in this repo and the sibling tool repos were written before them and
reflect them only partly or not yet. The habit comes
from Linux kernel drivers, Go and Rust: a loop with the state in its lines,
not a machine with the state in a table. Every rule below has a test that
fails the build (`./build.sh` runs `./test.sh` first; `-Werror`, nothing is
a warning).

**1. A lifecycle is one loop.** Anything with a lifetime (a socket, a
stream, a Bluetooth link) is ONE `async run(signal)` function with a loop:
open, serve until it ends, count down, again. The state is the program
counter; there is one writer; `start()` refuses a second loop (`if
(this.task !== null) return`), `stop()` aborts it through an
`AbortController`. This replaced an event machine plus an ownership token
(0.9.52) that existed only because two writers shared one state - the
2026-09-30 race, where an SFU attempt woke after the direct link had taken
over and wrote "failed" over a flowing stream, cannot happen in a loop. The
kernel mapping: `run()` is a kthread, `select` + `sleep` is
`wait_event_timeout`, a `Flag` is a completion, the stop signal is
`kthread_should_stop()`; in Java terms the loop waits on a countdown latch
with a timeout.

**2. Every wait takes the stop signal and a timeout.** `sync.js` has the
only primitives: `Flag` (a level you can wait for; waiting for the current
value returns at once, so nothing is lost between a callback and the loop),
`Channel` (a queue), `sleep(ms, signal)`, and `select(signal, { arm: (s) =>
... })` - Go's select: the first arm wins, the losers are aborted. The
"await with a timeout and an ownership check" the author asked for is
`select` with a `sleep` arm.

**3. Platform callbacks set a flag or push a channel, nothing else.** A
socket's `onmessage`, a channel's `onopen`, a transport's state change
exist only at the boundary; they never write the loop's state.

**4. `await` everywhere above that.** No `.then` chains, no hand-rolled `new
Promise` where `sync.js` has the primitive, no callback that awaits (a
lifecycle in disguise). A call that is deliberately not awaited is written
`void f()`, Dart's `unawaited()`; a bare one is a build error.

**5. A paint after an await re-checks first.** JS is one thread but every
`await` is a yield; by the time it returns another flow may own the card.
So after an await, a `render…()` / sheet / status call needs an `if (...)
return` (`publisher !== pub`, `tv !== t`), an `if` block, or
`signal.throwIfAborted()` before it - or a reasoned disable directive on
that line. This is Dart's `use_build_context_synchronously`.

**6. Pure decisions, replayed from real logs**, for everything that is not a
lifecycle: view models, packet handlers, chart windows, the UI chrome (the
layout below). The decision takes the one state object and plain inputs
and never touches the DOM, timers, storage or the network.

The tests, all in `test/`, all in `./test.sh`:

| test | enforces |
|---|---|
| `batray_house_rules.test.js` | rules 1-4 by reading the source: each link class has one `run(signal)`, the `task !== null` guard, the abort, the catch that lets the stop signal through; every `sleep` / `select` / `.wait` / `.next` carries the signal; boundary callbacks never write `state.live/error/path/retryIn`; ratchets for `.then(`, async callbacks and `new Promise(` per shell file, each exception listed with a ceiling and a reason; every `*-logic.js` free of `document`, `window`, `navigator`, storage, `fetch`, sockets, workers and timers |
| `batray_lint.test.js` | ESLint, every rule an error, any message fails: the recommended set plus the runtime-safety rules; the type-aware rules through `tsconfig.json` (`no-floating-promises` = rule 4, `no-misused-promises`, `await-thenable`, `unbound-method`, `return-await`, sort without a comparator); our own `test/lint/ui_after_await.mjs` = rule 5; house rules (no `confirm` / `alert` / `prompt`, no `document.write`). A rule switched off has its reason in the `OFF` table; a disabled line says why (`-- <why>`) and a stale directive fails. `test/lint/fixtures/` proves each rule still bites |
| `batray_typecheck.test.js` | `tsc --checkJs` over the same tsconfig: a missing property, a wrong arity, an impossible comparison are hard failures; DOM-typing noise has a per-file ceiling that may only go down |
| `batray_presence.test.js`, `batray_link.test.js`, `batray_conn.test.js`, `batray_cast.test.js`, `batray_wake.test.js`, ... | rule 6: the loops and decisions replayed over fakes with the exact sequences from the uploaded logs (dates in the test names) |
| `batray_no_sql_delete.test.js` | no SQL `DELETE` / `VACUUM` in the sources: a day is freed by unlinking its file |
| `batray_i18n.test.js` | EN and TH have the same keys, types and arities |
| `test/browser/*.mjs` | the real page in headless Chrome over fake Bluetooth, a fake relay and real OPFS / SQLite / uPlot / WebCodecs: the I/O shells are covered here, not by unit tests |

Rounds still to come, one per release with a phone test between: the TV
upload chain and the BLE connect flow as loops, then the app shell's
handlers.

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

## 0.9.74 (2026-10-06): the reader's location in its status; no history kept without file storage

- **Location** (`location-logic.js` decides, app.js `locTick`): a checkbox `#locKeep` under "keep debug logs" in the
  History card, default on (localStorage `batray_location`, '0' = off), reader only. `locDecision` reads a fix at
  most every `LOC_EVERY_MS` (10 min) once Chrome allows it, and asks for permission only right after a tap (the box,
  or starting a share), never by itself. The fix (5 decimals, accuracy in metres, time) goes only into the encrypted
  `status` envelope, so viewers see it in the reader sheet; a log line never holds the coordinates (`locLogText`:
  "fix ±18 m"). Checklist row `location` (on and allowed; 14 items now).
- **No memory-only history**: when the SQLite store cannot run (Chrome below 108, another BatRay tab holding the
  pool, a pool that stayed locked) the page used to keep every row and the stored log in RAM with no cap - a day on a
  small phone could end in "Aw, Snap". Now nothing is queued (`recordRow` returns, pending rows dropped, the log
  keeps only its ring buffer), the History card is greyed (`.histoff`) and `#histOff` says why and what to do
  (`histOffWhy`: old Chrome -> update, another tab -> close it and reload, else reload). The DEMO keeps its own
  in-memory rows, capped at 3000.

Tests: location-logic and the 14-item checklist in `batray_resume.test.js`; browser `batray_location.mjs` (default
on and placed under the log box, a fix at start with emulated geolocation, the decrypted status carries it, no
coordinates in any log line, untick -> null and the checklist names it, a lock-out keeps no rows and greys the card
at 500 and 1440 px, a Chrome 96 user agent names the update).

## 0.9.73 (2026-10-06): "reader stopped - tap to reopen", a Web Push from the relay

- **Page** (`push-logic.js` decides, app.js `syncPush`): while sharing, with Chrome notifications allowed, the reader
  registers sw.js, subscribes (`userVisibleOnly`, the relay's VAPID public key from `GET /batray/api/push/key`),
  leaves the notification's words in the cache (`batray-push` / `/batray/push-config`: title with the channel name,
  body, `/batray/?from=push`) and gives the room its endpoint (`PUT /room/:id/push?token=PUB`). Each time the share's
  socket comes up, and from the minute heartbeat while not set up (a failure waits `PUSH_RETRY_MS` 5 min). A share
  stopped by the person deletes it (`DELETE`): no push for a deliberate stop. Checklist row `push` (13 items now).
- **sw.js**: `push` shows the cached words (tag `batray-reader-stopped`, requireInteraction); a tap on it focuses a
  reader page (not a `view=` one) or opens `/batray/?from=push`, which logs that and runs the normal resume countdown.
- **Relay** (`push.rs`, pure + tested; Room): the endpoint must be a push service (FCM, Mozilla, Apple, WNS - the
  room never posts anywhere else); on the publisher's socket end the room sets an alarm for `PUSH_AFTER_MS` (3 min);
  the alarm sends ONE push with no payload per outage (`push_due`, `pushedFor` = the end it was sent for), signed
  with VAPID (ES256 JWT over the push service's origin, `p256` crate), TTL 1 day, Urgency high; a 404 / 410 forgets
  the subscription. The key is the Worker secret `VAPID_PRIVATE` (the 32-byte scalar, base64url; a copy in the
  private site repo's `_private/`).

Tests: push-logic in `batray_resume.test.js`; browser `batray_push.mjs` (sign-up over a stubbed push service and
relay, the REAL service worker shows the notification from `ServiceWorker.deliverPushMessage`, a stop deletes the
endpoint, `?from=push` logged); relay unit tests and a live test that closes a reader socket, waits for the alarm and
checks FCM accepted the VAPID signature (it refuses only the made-up token). UNVERIFIED on a phone: the push arriving
on the owner's Android after a real outage.

## 0.9.72 (2026-10-06): a reopened reader resumes after a 30 s countdown; the reader setup checklist

- **Resume** (`resume-logic.js`): the intent - what the person last asked for - is kept in localStorage `batray_resume`
  (`intentEvent`: 'connected' on each GATT connect, 'disconnected' on the toolbar Disconnect, 'share-on' / 'share-off'
  on a share started / stopped by the person; a drop, a crash or a reload changes nothing). On start `resumePlan()`
  decides: a reader that was sharing or connected counts down `RESUME_S` = 30 s in the 'resume' sheet (Now / Cancel,
  a bar), one loop selecting the clock against the sheet's answer (`runResume`); then `doResume()` shares again on
  the last link (the share setup filled from the saved name and link) and reconnects each remembered BMS that
  `getDevices()` still lists (`connAct(p, 'known')`, no chooser). Without getDevices (the Chrome flag "Use the new
  permissions backend for Web Bluetooth" off - both phones today) the share resumes and a toast names the BMS that
  needs a tap. Notes: `#autoResume` (localStorage `batray_auto_resume`, default on). Browser tests skip it unless
  `?resumetest[=seconds]`.
- **Reader setup checklist** (`setup-logic.js`): 12 items - Chrome 108+, Web Bluetooth, the permissions flag
  (getDevices), the remembered BMS still allowed, notifications, persistent storage, SQLite history, wake lock,
  charging, resume on, and two Chrome settings the page cannot see (auto-update off, battery Unrestricted) that the
  person confirms with Done (`batray_setup_done`). Only Chrome and the page (owner: no developer options, no extra
  apps). Connect (`setupGate`, after the browser gate) shows it when something is missing or not confirmed, with
  Continue anyway (asked once per page load; skipped in the browser tests unless `?setupgate`); a ⚠ (`#setupWarn`,
  SVG `<g>` - it has no `.hidden` property, toggle the attribute) follows "updated" while a reader runs with
  something left, and opens the list with Close, the Chrome version and the flag row; `#setupOpen` in Notes opens it
  any time. `checklistLine()` goes into the log on every change and on Continue anyway; the status carries the
  summary, shown in the viewer's Reader phone sheet.

Tests: `batray_resume.test.js`, browser `batray_resume.mjs` (over the freeze test's fake BLE device: Now shares and
reconnects with no chooser, Cancel, the countdown running out, no getDevices, the checklist with Done and Continue
anyway, the sign at 500 / 1440 px). UNVERIFIED on a phone: reconnecting without a tap after the flag is turned on.

## 0.9.71 (2026-10-06): every outage explains itself - reader status, last words, the relay's close record, a boot trail

The h46 reader went offline with the screen off and its tab gone, and nothing anywhere said when or how; two new tabs
then stayed blank and left no trace. Now:

- **Reader status** (`status-logic.js`, pure): `statusSnapshot()` = the phone's battery and charging, page memory,
  storage, the history store (backend, days, rows, pending, failures), the debug log, Chrome name / version / OS, the
  APIs missing, wake lock, visibility, network, sharing, each pack's last reading, uptime and how the previous run
  ended. Sent as a `status` envelope in the retained slot `status` (encrypted like a reading) when the reader's socket
  comes up, at once on a change that matters (`statusChanged`: visibility, charging, a 10 % battery step, a pack
  connecting or dropping, history falling back to memory, network, wake lock), and once a minute (`statusDue`); as
  **last words** on `visibilitychange` hidden, `freeze`, `resume` and `pagehide` (best effort). It rides the 15 s
  memory tick, goes into the log when it changes (and every 10 min), and into the last-run record, so the next start
  logs `its last status (N s before this start): ...`.
- **Relay close record**: the room stores `pubEnd` {at, code, reason} when the publisher's socket ends (not for a
  socket replaced by the same publisher, 4000), and every status while the publisher is away carries `gone: {ago,
  code, reason}` - also the plain `GET /room/:id`. Connection facts only; no reading or phone fact is readable there.
- **Viewer**: `endReason()` reads the last words and the close code (closed / frozen / hidden / unanswered / vanished
  / unknown); `offlineModel()` + `offlineLines()` make the box shown while the reader is away: since when (date, time,
  how long ago), how it ended, the last reading, the phone's battery. Tap it, or **Reader phone** under More, for the
  'reader' sheet with every fact. Each status received and each change of the box is logged on the viewer, so a
  viewer's log tells the reader's story when the reader's own log cannot be uploaded.
- **Boot trail**: an inline script in index.html writes the stages of each page load to `batray_boot` before any
  module loads (the previous load moves to `batray_boot_prev`), records load errors, and after 12 s without the app
  module shows `#bootFail` (close every Chrome tab, open again). app.js adds `module` and `ready`; `bootReport()` logs
  a previous load that never finished starting, with its error.
- **Upload any stored log** from Browse (each log file has Upload next to Delete); a file without the header line gets
  one on top (`uploadBody`), since the relay takes only text starting with "BatRay v".

Tests: `batray_status.test.js` (snapshot, change, due, the h46 and n11 endings replayed, the box in EN/TH, the sheet,
the boot report, the last-run status, the upload header), browser `batray_status.mjs` (status over a fake socket,
last words, the record and the next start, a blocked app module -> the on-screen notice and the next start's report,
Browse upload, the viewer box and sheet at 500 / 1440 px), relay unit + live tests for `gone`.

## 0.9.70 (2026-10-05): the time lines under "updated" stay clear of the battery on phones

The owner's phone screenshot showed `reader 16:20:53.596` running into the battery's side: Android's monospace font
is wider than the one the layout was checked with, and the battery body starts at x 110 (not 120). On phones the
corner text now starts at x 2, and `fitCorner()` squeezes a stamp line longer than `FLOW.portrait.updMax` (103
units, ending 3 units before the stroke) with `textLength`. The browser test forces a 12 px font and checks the
line ends before the battery body. The how-to (EN/TH) now says to turn off Chrome's auto-update on the reader phone.

## 0.9.69 (2026-10-05): the browser gate is a warning; a quicker re-ask when the BMS ignores the first one

Owner, after the Sony ran fine on Chrome 96 following a factory reset: the gate warns instead of refusing. The
'compat' sheet now offers **Connect anyway** / **Open anyway** (primary), the store or download page, and Cancel;
the choice is logged (`compat: reader going on anyway` / `stopped (cancel)`) and asked once per role per page load
(`compatAccepted`). The one hard stop stays: a reader without Web Bluetooth (`canTryAnyway`), which has nothing to
connect with - Close and the link only. `startConnect` / `startView` await the gate.

The n11 reader log (07:36, JK_B1A24S15P fw 11.38, "values took time to show"): the handshake's 0x96 got only the
20 B command echo, and the re-ask came 3.8 s later; that one started the stream at once (0x01 at +0.18 s, first
0x02 at +0.75 s), first reading 4.8 s after connect. `startupAskDecision` now repeats an ask the BMS has not served
(no settings frame since the ask) after `STARTUP_QUICK_MS` = 1 s, up to `STARTUP_QUICK_ASKS` = 3, then every 3 s
as before; an ask that was served (settings came) waits the full 3 s, so no second settings read and no extra beep.
The check runs every 250 ms. Replays of both the n11 and the m-00 logs in `batray_jkbms.test.js`. Unverified on the
pack until the next log: look for `startup: no cell info 1.0 s after the ask (not served)`.

The last-run record carries the browser and its version; a start after an unclean end whose version differs says
`the browser changed since: chrome 96 -> chrome N - an update closes the browser and every tab in it`.

## 0.9.68 (2026-10-05): a browser gate on Connect and on opening a link; the reading's time under "updated"

The reader of the owner's 2026-10-05 log was a Sony on Chrome 96: no synchronous OPFS access handles there, so no
stored history or log, and the lock-out message blamed a worker. Now `compat-logic.js` (pure) decides per role:
the reader needs a Chromium browser with Web Bluetooth at 108+ (the vendored sqlite3 calls `sah.getSize()`
synchronously; 102-107 returned promises), the viewer Chromium 108+, Firefox 114+ (module workers) or Safari /
iOS 16.4+ (CompressionStream), and both need the APIs probed on the page (secure context, WebSocket, SubtleCrypto,
Worker, OPFS, compression streams). The Connect tap (`startConnect`, `startKnown`) and the live view's start
(`startView`) ask `compatGate(role)`; a refusal logs `compat: <role> <browser> <version> (<engine>) on <os>:
BLOCKED - <why>` and opens the 'compat' sheet: why, the steps for the detected platform (Android when the user
agent says nothing), the browser / OS / minimum / missing rows, and a button to the store or download page
(`updateHelp`). The Connect buttons stay enabled without Web Bluetooth so the tap can say what to use instead.
The verdict is logged at every start too.

Under "updated" in the picture's corner, `stampLines()` (view-logic.js) gives the reading's time as
`reader HH:MM:SS.mmm` and, on a viewer's pack, the arrival time as `local  HH:MM:SS.mmm` (9 px, one per line).
Tests: `batray_compat.test.js`, browser `batray_compat.mjs` (Chrome 96, Firefox reader, old and current Firefox
viewer, the store links, the stamps at 500 and 1440 px clear of the battery).

## 0.9.66 (2026-10-05): default lines battery % and current; a 7-day chart no longer re-queried every 10 s

The owner's 7-day window lagged. Two causes: every received history file re-queried and redrew the chart (a
transfer is 100+ files), and every 10-second flush forced a full re-query whatever the window - on 7 days that is
370k rows bucketed into 12-minute averages, redrawn to the same picture. Now a received file only asks for the
throttled draw, and the refresh interval is at least half a bucket (`trendRefreshMs`: 1 h stays 10 s, 24 h 54 s,
7 d about 6 min). The default lines are battery % and current; the others are a tap away.

## 0.9.65 (2026-10-05): history files from the reader were never stored on a viewer

The owner's viewer log of 2026-10-04 (viewer 0.9.64, reader 0.9.60): the reader answered every request, 108
files of 2000 rows in 40 s, and every chunk logged `storing undefined failed: ... atob`. The viewer's envelope
handler passed the whole envelope to `rxChunk` (the payload is `env.v`) and then passed `rxChunk`'s result object
to the store as if it were the file. Only the two direct tests of `rxChunk` and `storeReceived` existed; the
wiring between them had never run in a test. Now `rxHistFile(env)` is the one entry, the browser suite feeds a
file through it as three envelopes (and one out of order), and a house-rule test locks the wiring.

The same log: the SQLite pool stayed busy for 40 tries ("another worker still holds its files") and the session
ran memory-only. The page whose worker holds the pool now also holds a Web Lock (`batray-history`, released when
the page goes), so a page that cannot take the pool queries the locks and says which it is: another BatRay tab on
this device (log line + toast: close it, reload) or a worker that ended mid-write (reload later).

## 0.9.61: choose the History lines (owner ask 2026-10-02)

"Make the history selectable, up to four at a time; default battery %,
voltage, current, MOSFET temperature" - then, asked for a saner default
from the apps people know: power instead of current, which is what the
consumer apps chart and what the charged / discharged line is made of. The chart used to be fixed: signed
power area plus the battery % line.

- A row of chips under the range buttons, one per stored reading (battery
  %, voltage, current, power, MOSFET temp, temp 1, temp 2, remaining Ah),
  each in its line's colour with the newest value, or the value under the
  pointer while it is on the chart. A tap turns a line on or off; a fifth
  is refused with a toast, the last one cannot be removed. The choice is
  saved (`batray_hist_params`) and survives a reload.
- The first chosen line owns the left axis, the second the right one; a
  third and a fourth draw without an axis and are read off their chips.
  Battery % is always 0..100 with the inverter cut-off dashes; current and
  power keep zero in view; the rest pad their own range. The three
  temperatures share one scale.
- The bucket query now averages every reading column, so any line is one
  query away; the charged / discharged line above the chart is unchanged.
  The pure decisions (`parseParams`, `paramTap`, `paramChips`, the `PARAMS`
  table) sit in history-logic.js with unit tests; the browser test taps
  the chips, refuses the fifth, swaps a line and reloads.

## 0.9.60: one transport - a WebSocket through the relay room (owner decision 2026-10-01)

"Use ws tcp only, no more ICE and SFU / TURN / UDP." The two viewer logs of
that morning had shown what the WebRTC ladder was costing: on the owner's
phones the direct link never opened ("different network", every time), the
SFU came up in 0.3 s but only after our own 10 s head start, and the three
transports racing each other had produced the 2026-09-30 race in the first
place. Cloudflare's Pub/Sub (MQTT) was retired on 2025-08-20 and Workers
terminate no WebTransport, so the WebSocket the relay already carried for
signalling became the only path.

- **The room is the broker.** The publisher sends every envelope AES-GCM
  encrypted (the key lives only in the link's fragment) as `{type:'d', b:
  <base64>, slot?, to?}` on its socket; the room sends `{type:'d', b}` to
  every viewer, or to the one named by `to` (a history chunk goes to the
  viewer that asked). The relay cannot read a reading. A message is at most
  64 KB; the socket's `bufferedAmount` is the back-pressure (an envelope is
  dropped, not queued, above 256 KB; a history transfer waits).
- **Retained messages, MQTT's retain.** The room keeps the newest message
  per `slot` (`hello`, `packs`, `info0`, `settings0`, `data0`, ... - slot
  names are the publisher's, a pack id never reaches the relay) in its
  storage and sends them to a viewer the moment its socket opens, each
  with `ago`: its age in milliseconds by the relay's clock, so two phones'
  clocks never meet. The viewer paints a retained reading with that age
  (`Pack.take(..., at)` sets the "updated N ago" clock to now - ago) and
  marks the pack not live when it is older than FRESH_MS: an hour-old last
  picture says "1 h ago", never "just now" (the owner's condition). The
  retained set outlives the publisher: a viewer joining while the reader
  is away still gets the last picture and "reader offline".
- **Presence is the socket.** `status: {viewers, live}` where live = the
  publisher's socket is in the room; no more session registry. The viewer
  still judges the reader by freshness first (`readerPresent`), re-judged
  on every status and every 2 s tick.
- **Each side is one loop**, as the house rule asks: open the socket (10 s
  to open or give up), serve it (messages, a ping every 10 s, dead after
  30 s of silence, a resumed tab pings at once), count down 4 s, again.
  The socket callbacks only set two flags and push one channel. live.js is
  a third of its size; `link-logic.js` and the ICE path classifiers are
  gone; the relay lost the SFU proxy, the TURN minting, the path reports,
  the Counter object and the `SERVER_LIMIT` cap (a Durable Object
  migration deletes the class).
- **What the user sees:** the chip says `LIVE · 2 viewers` (no path), the
  relay note says "a limited number of connections" (there is no
  "server full" state to report), and the first picture is at socket-open
  time instead of ten seconds later.
- Tests: `batray_presence.test.js` replays the loops over a fake socket
  (reader by the room's word and by data, a retained message's age, dead
  socket, countdown, resume, stop, slots, addressed chunks, backlog drop,
  the heartbeat); `cargo test` covers retain / retained_for / handle;
  `relay.test.mjs` runs the fan-out, the retained set with ages, the
  addressed chunk and the forgeries against the live relay.

## 0.9.56: the SQLite worker never ran on the deployed site (found 2026-10-01)

The owner's first viewer log on 0.9.55 still said `history: worker error
[object Event]` and `hist=memory`, on a site whose worker script carried
the embedder-policy header. Reproduced from the sandbox against the live
site, then split with blob module workers inside the live page: a module
worker with no imports ran, one importing a plain module ran, one
importing the vendored SQLite module died with the same bare error event.
The deployed `sqlite3.<hash>.js` did not parse: `build.sh` had rewritten
every bare `sqlite3.wasm` in it (`wasm = sqlite3.wasm,`,
`sqlite3.wasm.module = ...` - the sqlite3 object's `wasm` property) into
`sqlite3.2ee8f3da.wasm`, because the text matched the wasm file's name.
Six places. The local tests run on the unhashed `public/` tree and never
saw it, so every phone had memory-only history from 0.9.40 to 0.9.55; the
0.9.50 embedder-policy fix was real but second.

Build rules now: a file name counts as a reference only right after a
quote, a slash or an opening paren (strings, attributes, `url()`), never
when followed by `.identifier`; after hashing, `node --check` runs on
every built js, and a scan fails the build if any built text file still
names a renamed file. `./test.sh` runs first. Verified live with the
headless runner: `history: SQLite 3.53.4 over opfs-sahpool`.

## 0.9.55: -Werror, and what the Dart analyzer catches (owner ask 2026-10-01, later)

"In C I use clang analyze and coccinelle with cc -Werror; in Dart any
warning that was not sanely exempt made build.sh fail. Cover what the
Dart analyzer catches: an async function not awaited - unawaited async
is mostly a coding problem, nothing happens at runtime and people wonder
why - and UI work when the view is not mounted." So:

- **-Werror.** Every rule is an error, any message fails the lint test
  (there is no warn level), and `build.sh` runs `test.sh` first: a build
  cannot hash a file the analyzers reject. Rules switched off have their
  reason in the `OFF` table of `test/batray_lint.test.js`; a line exempt
  from a rule says why on the line (`// eslint-disable-next-line <rule>
  -- <why>`), and a directive without a reason, or one that no longer
  disables anything, fails the test too.
- **Unawaited calls** (`unawaited_futures` / `discarded_futures`): a
  rule needs the types to know a call returns a promise, so the lint
  test now runs typescript-eslint's type-aware rules over the same
  `tsconfig.json` the checker uses: `no-floating-promises` (a bare call
  of an async function is a finding; `void f()` is the explicit
  fire-and-forget, Dart's `unawaited()`; `await` where the next step
  depends on it), `no-misused-promises` (a promise as a boolean - the
  `if (this.task)` guard was one, now `!== null` - or an async callback
  handed to a sync slot), `await-thenable`, `unbound-method` (a method
  read without its object: the feature line's `navigator.bluetooth.
  getDevices` is now a `typeof ... === 'function'`), `only-throw-error`,
  `return-await` inside try/catch, sort() without a comparator (numbers
  sort as strings). The test files go through the same rules with
  `tsconfig.tests.json`. First run: 57 bare async calls in the app (44
  in app.js: syncWake, flushHistory, flushLog, runAttempt, stopShare,
  stopTv, ... from event handlers and timers), two `p.stop()` in a test
  that the test never waited for.
- **UI work on a view that is no longer there** (`use_build_context_
  synchronously`): a page never unmounts, but the state a paint shows
  can be stale by the time an await returns - another flow may own the
  link, the sheet may be a different one. `test/lint/ui_after_await.mjs`
  is our own ESLint rule: in an async function, after an await, a call
  that paints (`render*`, `paint*`, `scheduleDraw`, `openSheet` /
  `updateSheet` / `closeSheet`, `setStatus`, `castHint`, `applyLang`,
  `showQr`, `unloadPreview`, a `$('x').y =` write) must come after a
  re-check: an `if (...) return` (`publisher !== pub`, `tv !== t`), an
  `if` whose block holds the paint, `signal.throwIfAborted()` or
  `own()`. The awaited call itself is the wait, not a paint; a `toast`
  reports the result and is not a state paint; a line that is right
  without a re-check (a single-flight function painting the one state
  object as it stands) says why on the line - sixteen in app.js. It
  found two real ones: `stopShare` and `stopTv` cleared the QR and the
  preview after `await stop()`, which would have wiped a share or stream
  started meanwhile; both now re-check (`if (!publisher)`, `if (!tv)`).
- **The rest of the Dart-analyzer class** in plain ESLint, all errors:
  `consistent-return` (a function returning a value on some paths),
  `no-promise-executor-return`, `no-constructor-return`, `no-shadow`
  (a local hiding an outer name - one hid the imported `sheetOpen`, one
  a test's `Viewer`), `no-use-before-define` (TDZ), `no-implicit-
  globals`, `no-invalid-this`, `default-case`, `no-unneeded-ternary`,
  `no-useless-return` / `-call` / `-concat`.
- **The rules must bite.** `test/lint/fixtures/` holds two files whose
  `// FLAG` lines are the only ones the rules may report; the test fails
  if a rule stops working or over-reports.
- Off, with the reason in the test: `require-atomic-updates` (documented
  false positives on every `s.x = f(await ...)`; the one-writer rule is
  the house-rules sweep), `require-await` (an async function without an
  await is the explicit way to be promise-returning by contract; Dart
  does not flag it either), `no-unmodified-loop-condition` (the transfer
  loops await inside; `publisher === pub` changes between awaits),
  `no-loop-func` (closures must read the live language table),
  `no-empty-function` (boundary callback defaults).

## 0.9.54: static analysis as tests - the coccinelle and rustc of JavaScript (owner ask 2026-10-01)

"Search for static code analysis like coccinelle in the kernel, cover the
most common JS runtime issues as rustc would at build time, as a unit
test." What exists, and what is now in `./test.sh`:

- **ESLint** (`test/batray_lint.test.js`) is the pattern side: it walks
  the syntax tree with rules, which is what coccinelle's semantic patches
  do for C. The recommended set catches names that do not exist,
  unreachable code, duplicate keys, bad regexes, a `catch` that swallows
  a real error, `await` and Promise misuse; the rules added on top are
  the ones that find bugs rather than style (`eqeqeq`, `no-var`, `prefer-
  const`, `no-useless-assignment`, `no-duplicate-imports`, `array-
  callback-return`, `no-constant-binary-expression`, `no-self-compare`,
  `no-unreachable-loop`, `no-async-promise-executor`, `radix`, `guard-
  for-in`, no `eval` of any shape, and the house rules: no `confirm` /
  `alert` / `prompt`, no `document.write`). Zero findings is the bar;
  the first run found four unused imports, a duplicate import, a dead
  state variable and two redundant assignments, all removed. Vendored
  files are skipped.
- **The TypeScript checker in JS mode** (`test/batray_typecheck.test.js`,
  `tsconfig.json` at the root so an editor shows the same) is the rustc
  side: it infers types from the JavaScript and reports a property that
  does not exist (naming the right spelling), a wrong argument count, a
  comparison that can never be true, an operator on the wrong types, an
  unknown property in a literal passed to a typed API. Those codes are
  hard failures. The rest - DOM elements the checker sees as a bare
  `Element`, an `Error` with extra fields, a default `{}` parameter - is
  a per-file ceiling with a reason, so a file may only get better; the
  way down is a JSDoc type where the checker lost track, never a cast
  over a real finding. `test/types/batray.d.ts` declares the browser
  APIs the checker's own library lacks (Web Bluetooth, the cast library,
  `navigator.connection`, `performance.memory`). The first run found
  `this.onBackend` set on the store without a field (now declared) and
  a `onConn` default with no parameter, and two `alert()` calls in the
  alerts card's test buttons (house rule: sheets and toasts) - now toasts.
- What neither can do, and the replay tests still must: logic. rustc
  would not have caught the 12:55 race either; the loop did.

Not chosen: `ast-grep` (closer to coccinelle's syntax, a second tool for
patterns ESLint already expresses), a full TypeScript conversion (the
checker already reads the JS; types go in as JSDoc where they pay).

## 0.9.53: lifecycles are loops (owner decision 2026-10-01: "reduce entropy")

The day after the ownership token shipped, the owner put the finger on
the real cause: "code that takes state and does stuff based on events is
more error-prone than the same thing as a single function with a loop,
waiting on a latch with a timeout. The state is in the lines of code."
Ken Thompson and Linus Torvalds style, Go and kernel C over the
object-oriented kind. The token, the decision table and the gate of
0.9.52 were all ways of coping with two writers of one state; a loop has
one writer, so all three went away.

**The house rule now.** A thing with a lifecycle (a link, a stream, a
Bluetooth connection) is ONE async function with a loop. The state is
the program counter. Every wait in it takes the stop signal and a
timeout. Platform callbacks (a socket message, a channel opening, a
transport state change) exist only at the boundary and do one thing: set
a `Flag` or push into a `Channel`. `await` everywhere above that line;
no `.then` chains; no hand-rolled Promise where the primitive exists.

- `sync.js` (the only new primitives): `Flag` (a level you can wait for;
  a wait for the current value returns at once, so nothing is lost
  between a callback and the loop - the kernel's completion), `Channel`
  (a queue with `next({ ms, signal })`), `sleep(ms, signal)`, `select
  (signal, { arm: (s) => promise })` (Go's select: the first arm wins,
  the losers are aborted through the signal they were given), `isAbort`.
- `Viewer.run(signal)`: wait for a reader; on a new session give its
  direct offer a head start; else `select` between the SFU attempt, the
  direct channel opening and the reader leaving; follow the link with
  `watchLink` (closed / gone / direct / a 5 s path re-read); count down
  with `retryWait` (tick / resume / direct / gone); again. `connectSfu
  (signal)` is one straight function that throws on failure and on the
  stop signal and closes what it opened. The 12:55 race cannot exist: the
  attempt is an arm of a select that the direct channel wins, and a
  losing arm is aborted, not consulted.
- `Publisher.run(signal)`: connect, publish until the transport drops,
  count down, again. Direct peers (`offerP2P`) stay event-driven at the
  boundary with the peer object as their token.
- The status handler only sets `reader` (the relay's word, or fresh
  readings keeping it), the direct channel's onopen only sets `direct`
  (after reading its path), `nudge()` pushes into `resumed`.
- `test/batray_house_rules.test.js` is the gate: each link class has one
  `run(signal)`, `start()` refuses a second loop, `stop()` aborts; every
  wait in live.js carries the signal; no boundary callback writes the
  loop's state; `.then(` chains, async callbacks and `new Promise(` are
  ratchets with a per-file ceiling and a written reason (the TV upload
  chain is round 2, the app shell round 3); logic modules stay pure.
  `test/batray_presence.test.js` replays the 12:55 sequence on the real
  loop over fakes (direct opens during the attempt -> abandoned; direct
  drops -> SFU at once; transport fails -> countdown; resume ends it),
  plus the publisher's connect / drop / countdown / stop.
- Deploy: BatRay's hashed modules get their headers from the site's
  worker.js (`assetHeaders`: immutable for a year, the embedder policy on
  worker scripts) instead of one `_headers` rule per module - Cloudflare
  allows 100 rules and the list had filled it.

Kernel and Go mapping, for the record: `run()` is the kthread, `select`
with `sleep` is `wait_event_timeout` / Go's `select` with `time.After`,
`Flag` is `struct completion` / a closed channel, the stop signal is
`kthread_should_stop()` checked inside every wait, `start()` refusing a
second loop is the single kthread per device.

Not converted yet, on purpose, one lifecycle per round with a real phone
test between: the TV upload chain and the signalling socket (round 2),
the Bluetooth connect flow and the app shell's handlers (round 3).

## 0.9.52: the ownership rule - the link machine in link-logic.js, and a gate for it (owner ask 2026-10-01)

"How do we prevent the parallel thing happening again?" The honest answer
first: JavaScript runs one thread, so nothing races in memory; flows
interleave at every `await`. The 12:55 bug was ownership across an await:
the SFU attempt awaited a network call, the direct channel opened and took
the link, and the attempt woke up and wrote to state it no longer owned. A
lock is the wrong tool - the direct link SHOULD preempt the attempt - so
the primitive is preempt + cooperative cancel, the kernel's
`kthread_should_stop()` and Go's `context.Done()`: every flow that will
write shared state after an await takes a token when it starts and asks
whether it still owns the link before each write; whoever supersedes it
bumps the token. The superseded flow exits without a word on the state.

**The rule, in one line: after an await, the first line re-checks
ownership, and the check is a pure decision.** Now in code:

- `link-logic.js`: `linkState()` (phase idle | sfu-connecting | sfu | p2p
  | retry, `attempt` token, `p2p`, `sfu`), `attemptStart / attemptOwns /
  attemptCancel`, and `linkEvent(ls, ev, inp)` for sfu-start (returns the
  token; a newer start supersedes), sfu-open, sfu-failed, transport-down,
  retry, retry-fired, resume, p2p-open (cancels any attempt in flight),
  p2p-closed, p2p-timeout, no-reader, stop. Both `Viewer.subscribe` and
  `Publisher.connectSfu` take the token, call `own()` after every await,
  and route their catch through the 'sfu-failed' decision; `scheduleRetry`
  and `nudge` act on 'retry' / 'resume' decisions. The direct-peer flows
  (`offerP2P`, `answerP2P`) use the object they made as the token and
  re-check it by identity after each await.
- The signalling socket: `socketState / socketOpen / socketOwns /
  socketClosed / socketNudge` - one generation per socket; an old socket's
  late close no longer reopens a second one (the `viewers=2` blips).
- The wake lock: `wakeRequestStart` marks a request in flight, so two
  overlapping `syncWake` calls cannot hold two locks with only the last
  ever released.
- `test/batray_ownership.test.js` is the gate: every async function in
  live.js that opens a transport checks ownership after its awaits (a
  token for the SFU attempt, identity for a direct peer) and its catch
  goes through the decision; every socket handler checks its generation;
  the wake request is announced before the await; the shells keep their
  `publisher !== pub` / `tv !== t` re-checks; and every `*-logic.js` is
  free of DOM, timers, storage and network. `test/batray_link.test.js`
  replays the 12:55 log on the machine, the publisher's retry-vs-resume
  double start, the socket nudge race and the double wake request.

Kernel patterns that map onto this code, for the record: the attempt
token is a sequence / generation counter (what seqlock readers compare);
`publisher !== pub` and `this.p2p !== p` are RCU-style publication - a
new object is installed, old readers finish on the old one and must not
write through it; `kthread_should_stop()` polled between steps is the
cooperative cancel; `cancel_work_sync` is "bump the token, then await
the task"; the `TvStream` upload chain and `histFlushing` are a
single-threaded workqueue; `wait_for_completion_timeout` is the
`waitOpen` / `waitConnected` deadline. Not used here on purpose: a mutex
(would serialize what must preempt) and refcounts (nothing is shared
between owners long enough to need them).

## 0.9.51: a resumed viewer said "failed" over a stream that flowed (owner's log 2026-09-30 12:55)

"Connect / disconnect loop and a live-failed dialog, although streaming
fine after about half a minute." The log, at the moment the tab came
back after 6.7 h hidden:

1. The SFU transport reported `disconnected` and a retry countdown
   started; the tab's resume cancelled the wait and began an SFU attempt.
2. The reader's direct offer arrived and its data channel opened 0.6 s
   later. Its onopen tore the in-flight SFU attempt down, correctly.
3. That attempt then failed with "signalingState is 'closed'" and, not
   knowing it had lost, wrote the error into the state, painted
   "reconnecting", and scheduled a retry - which later found the direct
   link up and did nothing, so `live=false` and the error text stayed
   for good while readings flowed (`view(live=false reader=true)` in
   the heartbeat).

Fix: `sfuFailureDecision({stopped, mine, p2pOpen, status, message,
relayOnly})` in live-logic.js - an attempt that is no longer the current
one, or that lost to the direct link, is dropped with one log line and
no change of state; a real failure retries as before (429 = server full,
"not connected" moves the next attempt to TURN). `scheduleRetry` is a
no-op while the direct link carries the stream. The Viewer-level replay
in batray_presence.test.js opens the direct link inside the attempt's
session POST and checks that the failure leaves `live=true`, no error,
no countdown.

The "loop" in the same log: on every resume the alerts fired "no data
from the BMS for over 5 min" and "recovered" a few seconds apart - the
five minutes were the tab's own frozen time. `Evaluator` now counts
silence only while this page has been awake (a tick gap over
`TICK_GAP_S` = 30 s restarts the watch) and, on a viewer, while its own
link is up (`sample.ownLinkDown` freezes the silent rule's state, so a
link drop is neither a repeat nor a false "recovered"). Replay in
batray_alerts.test.js. Pack chip taps are now logged (`ui: pack chip`),
because the status line following them looked like flapping in the log.

## 0.9.50: the history worker was refused on every phone; the TV preview never goes blank; a Wi-Fi gap no longer kills the stream (owner's three logs 2026-09-29/30)

Three findings from one night of logs, all fixed here.

1. **No phone had a SQLite store from 0.9.40 to 0.9.49.** Both viewer logs
   opened with `history: worker error [object Event]` and the reader's
   heartbeat said `hist=memory`. Since 0.9.35 the page is cross-origin
   isolated (COOP + COEP for the live memory figure), and Chrome then
   refuses a dedicated worker whose script response does not carry the
   same embedder policy; the site's `_headers` gave it to the page only.
   The browser tests never saw it because their static server sent no
   headers at all. Now deploy.sh adds `Cross-Origin-Embedder-Policy:
   credentialless` to every `*-worker.*.js` under /batray/, site_checks
   fails without it, and `test/browser/serve.py` serves the tests with the
   live site's headers, so the history suite proves the worker opens on
   an isolated page. Reproduced in the sandbox before the fix: the same
   page with the header on the document only -> memory; on the worker
   too -> `SQLite 3.53.4 over opfs-sahpool`.
2. **The phone's own TV preview went dark for hours.** At 14:22 the
   reader's Wi-Fi dropped; the relay's Tv object got no upload for 2 min
   and deleted the stream; the app then PUT every segment into a deleted
   stream until the owner stopped it (9,974 `404` lines, two a second).
   Relay (`alarm()`): expiry now drops the picture but keeps the token;
   a segment PUT without an init segment answers `409 need init`; only
   DELETE forgets a stream. App (`TvStream.revive`): a 404/409 on a
   segment sends `init.mp4` again on the same id (`state.episodes`, the
   link stays valid; segments queued meanwhile are skipped), upload
   errors are logged when they change plus one repeat-count line when
   they stop (`uploadFailed` / `uploadOk`). The preview: `previewState`
   / `previewEvent` / `previewSource` in tv-logic.js - the stream player
   `<video>` shows only while it really plays (a stall is tolerated for
   `PREVIEW_GRACE_MS` 3 s), otherwise `#tvLocal`, a canvas painted from
   the encoder's own frame (`onFrame`), shows: before the player starts,
   after an error, and on desktop, which cannot play HLS at all and had
   no preview before. A revival unloads and reloads the player.
3. **A network blink made the reader change rooms.** `Publisher.start`
   made a new room whenever the GET of the earlier room threw, so a
   viewer on the old link waited forever on a room the reader had left
   (the relay stores the room's token: the old room still answered 200
   the next morning). Now a fetch error keeps the earlier credentials;
   only a real 404 makes a new room.

Tests: batray_tv.test.js (preview decisions, `TvStream` revival over a
fake fetch: 404 -> init again, queued segments skipped, error dedupe),
batray_presence.test.js (fetch throws -> room kept), browser
batray_tv.mjs (the local canvas is lit and shown in place of the player,
a stub 409 -> second init.mp4 and segments go on, one log line),
relay.test.mjs (409 before init; a real 2 min expiry, init revives the
same id, DELETE forgets it).

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

## The Cast sheet follows the TV (0.9.49, owner ask 2026-09-28)

"Make sure the progress dialog updates its status at each state and waits
the full minute, clean cancel, not drop away for the user to read the
state under the mini view like before." Until 0.9.48 the sheet closed the
moment the TV accepted the load and the TV's player state went only to
the one-line hint under the icon. Now the accepted load is a phase, not
the end: `castFlowPhase(cs, 'waiting', now)` restarts the clock,
`castPhaseBudgetMs` gives each phase its budget (loading / looking 20 s,
waiting / buffering `CAST_TV_WAIT_MS` = 60 s, picking and the results
none), `castTvUpdate(cs, playerState, idleReason)` turns the receiver's
states into decisions (BUFFERING -> 'buffering' keeps the clock, PLAYING
-> 'playing', IDLE with idleReason ERROR -> 'error', anything else
nothing), and `castSettle(cs, result)` ends the flow (buttons free at
once) while the sheet keeps the result - "playing on <TV> (88 s)", the
"nothing playing for a minute" text, or the TV error - with a Close
button until the user closes it. Every player state, from the RemotePlayer
events and the 3 s media-session poll alike, goes through `castTvSeen()`
in app.js. Cancel while waiting closes the sheet and frees the buttons;
the TV keeps whatever it plays and the hint keeps following it. A late
answer from a cancelled picker still loads the stream but only writes
the hint (no sheet re-opens). Log lines `cast: settled -> <result>`,
`cast: the TV showed nothing playing within 60 s`, `cast: sheet closed by
the user while waiting`. Replays in batray_cast.test.js (the 00:55 log:
media 19 s after the load), the sheet leads in batray_ui.test.js, the
whole run over the stub library in browser/batray_tv.mjs (waiting ->
buffering -> playing -> Close, the silent TV, a clean cancel).

## Cast works: the growing MP4 plays on the TV (0.9.48, owner's log 2026-09-28 00:55)

Verified on the owner's Family Room TV: the receiver reported PLAYING with
its clock running from 0 to 88 s and the owner saw live BatRay frames.
Two things from that log: (1) the TV's media session appears only with
its first status update, 19 s after the load was accepted - the TV's
player buffered the growing MP4 that long before its first picture - so
0.9.47's "no media session right after the load" hint ("the TV did not
respond") was premature; `watchCastMedia` now polls for the session and
says "nothing playing" only after a minute without one. (2) The initial
burst is 8 segments instead of 3 (relay `STREAM_BURST`), so the player has
more frames to start on. The owner's history: HLS casting worked, flakily,
on 0.9.13-0.9.20 with 4 s segments and never since 0.9.21's 1 s segments -
the one change in what the TV received - so the receiver's HLS player most
likely needs longer segments; the MP4 path sidesteps that.

## Cast, fourth round: the TV plays a growing MP4, not HLS (0.9.47, owner's log 2026-09-28 00:03)

The 2026-09-28 log settled the split. The 6 s test pattern (a plain MP4
from clearevo.com) went BUFFERING -> PLAYING on the Family Room TV by the
receiver's own player state; the live HLS stream, loaded on the same
session seconds earlier, produced no player state at all for 2.5 min and
no media session - the Default Media Receiver's HLS player refused it
silently (its media-namespace messages never reached the sender's
listener; the SDK keeps that namespace). So the TV, the session and the
host are fine and the HLS path is the fault. The receiver's own `<video>`
element is the path that works, and it plays a fragmented MP4 that keeps
growing.

The relay's Tv object now serves `GET stream.mp4`: one response, no
Content-Length, `Accept-Ranges: none`, that starts with the init segment
and the last three kept segments (`burst`, STREAM_BURST = 3) and then
carries every new segment as the phone uploads it (`fanout` to the open
subscribers, in-memory channels; delete or the 2 min expiry closes them).
Cast loads it as `video/mp4`, streamType LIVE - the same load the test
pattern took. The HLS playlist stays for TV browsers and VLC. Unverified
until the owner's next log: the receiver's `<video>` on a live, never-
ending fMP4 at 1 fps (Chromium's media pipeline treats a response without
length as a streaming source; the sandbox has no receiver to try). If it
still shows nothing, the next candidates are MPEG-TS HLS or DASH.

## Cast, third round (0.9.46, owner's log 2026-09-27 23:25)

Three facts from the log. (1) The first tap waited the whole 20 s for the
availability flip that never came; the second tap requested at once and the
flip (NO_DEVICES -> NOT_CONNECTED) arrived 60 and 150 ms AFTER the request,
as on 2026-09-26: on this phone the request is what starts Chrome's
discovery. The 2026-09-20 phones flipped 1 s after init on their own. So
the loading tap now waits at most `CAST_FLIP_WAIT_MS` = 4 s for the flip
and then requests anyway; "tap again (discovery)" is gone. (2) The TV
accepted the load, then `getMediaSession()` was null and the RemotePlayer
reported IDLE with no media: the receiver dropped the media at once and
the TV showed only its idle icon. The sender's `loadMedia` promise can
resolve with an error code rather than reject, so the result is logged
(`cast: loadMedia(stream) resolved with ...`) and a code is treated as a
failure; and every message the receiver sends on the media namespace
(`urn:x-cast:com.google.cast.media`: MEDIA_STATUS, LOAD_FAILED with its
detailedErrorCode) is logged as `cast: tv message ...` - the receiver's
own reason, which no RemotePlayer event carried. The hint says "the TV
accepted the stream but then reported nothing playing" in that case.
(3) To tell the TV from the stream, the card offers "cast a 6 s test
pattern instead": `test-tv.mp4` (H.264 baseline 640x360, a testsrc2
pattern made with ffmpeg, 377 KB, served next to the app; Google's sample
buckets answered 403 from the sandbox) as buffered `video/mp4`. If the
pattern plays and the live stream does not, the HLS stream is the fault;
if neither plays, the session or the TV is.

## The Cast progress sheet (0.9.45, owner ask 2026-09-26)

"After the first tap there is no way to know that it is searching or
waiting, so the user presses again." The 2026-09-26 log also showed the
worse half: 0.2 s after the library loaded, its first `NOT_CONNECTED`
event rewrote the hint to "tap Cast to pick it" and re-enabled the button
while the discovery wait was still running - the page itself asked for
the second tap. Now the tap opens a progress sheet that follows the flow
in `castS` (`castFlowStart / castFlowPhase / castFlowEnd`, phases loading
-> looking -> picking -> sending, `castProgress` = percent of the 20 s
budget and seconds left, `sheetModel('casting')`), both Cast buttons are
greyed with a wait icon (`castButtons`), a tap meanwhile does nothing
(`castTapAllowed`), and a state event may only refresh the sheet
(`castStateUi`). Loading and looking time out at 20 s ("no TV list within
20 s - check that the phone is on the TV's Wi-Fi, then tap Cast again");
picking has no clock, Google's list is on the screen and closing it is
the cancel there. The sheet's Cancel ends the flow; during picking it can
only hide the sheet (the request already handed to the library cannot be
taken back: the "reload the page" hint), and if the list answers later
the stream is still sent. Replays in batray_cast.test.js, the sheet in
batray_ui.test.js, the whole flow over the stub library in
browser/batray_tv.mjs (looking, hang, cancel, release).

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
