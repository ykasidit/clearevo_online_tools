# BatRay UI guidelines - recognition over recall

Owner's decision, 2026-09-20. The reference app is WhatsApp: the most widely
used messenger, plain and instant. What a WhatsApp user does without thinking
is what a BatRay user should do without thinking. Target user: comfortable
with WhatsApp, YouTube and mobile games, not with browsers, forms or
technical text.

## Two roles, one app

The app already knows its role at startup (`?view=` in the URL or not):

- **Reader** - the old phone next to the battery, 24/7. Its job is to never
  fall over: big picture, big numbers, the honesty lines, the reconnect
  countdown, and nothing that costs battery or CPU. One screen, no tabs, no
  charts to browse, no decorative motion beyond the flow line (and none in
  low-power mode).
- **Viewer** - the main phone, or anyone with the link. The messenger-style
  app: bottom tabs, bottom sheets, gestures, history. It gets its data over
  Share live, and later from stored history.

Same code, same state objects, same view models (see README, "functional
core"). The role is a layout decision, not a fork.

## Philosophy - browser-only, nothing to install

- A plain web page in a normal browser tab. No install prompts, no "add to
  home screen" banners (BatRay ships no manifest on purpose). "Nothing to
  install" is a safety and trust promise; never break it.
- No accounts, no sign-in. Google Analytics counts visits only, disclosed on
  /tools-privacy/. No other third party at runtime, with one named exception:
  Cast loads Google's cast library on tap, and the page says so.
- Data stays with the user: the BMS link and the log are local; nothing
  leaves the device without an explicit, labelled action (Share live, Show on
  TV, Upload log), each with its honesty line.
- The service worker exists only for notifications; promise no offline mode.
- The Bluetooth chooser is the browser's own dialog and cannot be restyled;
  the how-to says so.
- Work with browser chrome present: never rely on full screen; `dvh` units
  and safe-area insets; no gestures the browser owns (no edge swipes, no
  pull-down at page top); one URL for the whole task, Back handled with
  `history.pushState` state objects. The URL fragment is the share key and is
  never touched.

## Hard rules

- Mobile-first; every touch target at least 48 px on touch and narrow screens
  (checked by `test/browser/batray_ui.mjs`). Known exception until the title
  bar is redesigned: the About / A- / A+ trio in the fixed title bar is 34 px
  on phones. The toolbar is one scrolling row of icons on phones, debug
  buttons (bug icons) last; the status line sits under it.
- Icon-first for controls. Visible text stays for exactly four things:
  numbers with units, the DEMO badge, the "not encrypted on the TV path" note,
  and "keep Bluetooth on". A hidden disclosure is no disclosure.
- Every tile is its own tap target; a tap opens a bottom sheet (slides up,
  drag down to dismiss, Back closes it) with one plain sentence and the
  technical values in small grey text below.
- Never: browser `alert()` / `confirm()`, `<select>`, dense tables on the
  main screens, tabs in tabs, hover-only interactions. Choices and warnings
  are sheets with big buttons; the Upload log warning keeps its full wording.
- Every state is encoded two ways (colour plus icon, shape or motion).
  Traffic light: green = ok, amber = watch, red = act now. Red may pulse only
  when the user has not asked for reduced motion.
- Substance over motion: nothing ever delays or covers the first reading.
  Reader: CSS animation only, paused while hidden, off in low-power mode.
- Thai and English from day one; the parity test keeps the tables in step.

## Widget vocabulary (use these, do not invent)

- State of charge: the upright battery, level and colour, the number inside.
- Current: the flow line's dashes move toward the battery (charging) or away
  (discharging); the line thickens with the share of the BMS limit in use.
- Cells: vertical equalizer bars, one per cell, lowest and highest marked;
  tap for the per-cell sheet.
- Temperature: thermometer icon with fill (planned).
- History: full-width chart, drag to pan, pinch to zoom, a scrubber below
  (planned, uPlot vendored; downsample to ~2000 points in a logic module).
- Events and alarms: a feed of cards, newest first, tap-to-refresh icon
  (planned).
- Stateful toolbar buttons have three looks: plain (off), pulsing with a
  dashed border (busy: starting or connecting, and a tap then cancels),
  sunk (on, and a tap then stops with a toast). Share live, Show on TV and
  the Bluetooth link (its Disconnect button) all follow this.
- On/off: toggle switches with instant state. Setpoints: sliders with a
  value bubble. Destructive actions: press-and-hold with a filling ring.
- Success: brief checkmark; error: red shake plus icon.
- Every gauge is a pure model function `(value, min, max, zones, icon, unit)`
  in view-logic plus a small renderer, so the same battery, thermometer,
  flow and feed serve pH, dissolved oxygen and pump toggles later.

## Layout

- Reader: one screen. Picture, chips, status line, the notes below. Verified
  at 500 x 900 and 1440 x 900 before every deploy (house rule).
- Viewer: bottom tab bar, three or four icons, like WhatsApp's tabs. Now
  (the picture, tappable), History (chart and scrubber), More (cells, exact
  values, BMS settings, notes, alerts, debug). Feed joins when events are
  stored. Settings and sharing controls live in sheets, never a hamburger.

## Text policy

- Chrome: icons, numbers with units, and the four honesty lines.
- Sheets: plain language first, short sentences, no jargon ("cells slightly
  unbalanced", then "42 mV" in grey below).
- Compose Thai from the fact sheet, never translate English word for word.

## Phases

1. Reader hardening: low-power toggle, 48 px targets, sheets replacing
   selects and confirm. No visual redesign.
2. Viewer Now screen and bottom tabs on the existing live data; tappable
   tiles with sheets.
3. History ring buffer on the reader, History tab on the viewer; the
   how-to's "no stored history" line changes to say exactly what is kept.
4. Feed tab on the stored alert events.
5. Export and Explore (Parquet, DuckDB, notebooks) as a separate on-demand
   page for the main phone or PC, never in the reader's bundle.

Each phase ships as its own version with its logic module, replay test and
both form factors screenshot-checked.
