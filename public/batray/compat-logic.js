// BatRay by ClearEvo.com - which browsers can run the reader and the viewer, and how to update one that cannot (pure, tested)
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
//
// Owner ask 2026-10-05, after the reader on a Sony with Chrome 96 ran without stored history or log and died unseen:
// "gate at connect button press, don't work on older than min required Chrome or Edge or derivatives for the APIs we
// need, a dialog why and where to update for the detected platform, Android if unknown - separately for reader and
// viewer". The shell gathers the plain inputs (user agent, feature flags); everything here is a decision on them.
//
// The minimums are the APIs the code calls, not a taste:
// - Chromium 108: the history store (SQLite over OPFS) calls the file access handle's methods synchronously
//   (`sah.getSize()` without await in the vendored sqlite3 module); Chromium 102-107 had them returning promises,
//   and before 102 there are no access handles at all. A worker-only API, so it cannot be probed from the page.
// - Firefox 114: module workers (the history worker is one); access handles came in 111, CompressionStream in 113.
// - Safari / every iPhone browser 16.4: CompressionStream (history transfer and backups) and the access handles.
// Web Bluetooth itself exists only in Chromium browsers (Chrome, Edge, Opera, Samsung Internet; not Brave by default,
// never Firefox or Safari, nothing on an iPhone), so a reader is a Chromium browser; a viewer may be any of the three.

export const MIN = { chromium: [108, 0], gecko: [114, 0], webkit: [16, 4] };

/** Feature flags each role cannot work without (the shell probes them on window). */
export const NEED = {
  reader: ['secure', 'bluetooth', 'websocket', 'subtle', 'worker', 'opfs', 'compression'],
  viewer: ['secure', 'websocket', 'subtle', 'worker', 'opfs', 'compression'],
};

/** The operating system from the user agent (and userAgentData.platform when there is one). Unknown -> Android,
 *  the platform most readers and viewers run on (owner, 2026-10-05). */
export function detectPlatform(ua = '', uaPlatform = '', touchPoints = 0) {
  const p = String(uaPlatform || '').toLowerCase();
  if (/Android/i.test(ua) || p === 'android') return { os: 'android', known: true };
  if (/iPhone|iPad|iPod/.test(ua) || p === 'ios' || (/Macintosh/.test(ua) && touchPoints > 1)) return { os: 'ios', known: true };
  if (/CrOS/.test(ua) || p === 'chrome os' || p === 'chromeos') return { os: 'chromeos', known: true };
  if (/Windows/.test(ua) || p === 'windows') return { os: 'windows', known: true };
  if (/Macintosh|Mac OS X/.test(ua) || p === 'macos') return { os: 'mac', known: true };
  if (/Linux|X11/.test(ua) || p === 'linux') return { os: 'linux', known: true };
  return { os: 'android', known: false };
}

const chromeMajor = (ua) => { const m = ua.match(/(?:Chrome|Chromium)\/(\d+)/); return m ? [Number(m[1]), 0] : null; };

/** Browser name, engine and version. `brave` = navigator.brave exists (Brave reports itself as Chrome). */
export function detectBrowser({ ua = '', uaPlatform = '', brave = false, touchPoints = 0 } = {}) {
  const pf = detectPlatform(ua, uaPlatform, touchPoints);
  const out = { name: 'unknown', engine: 'unknown', version: null, os: pf.os, osKnown: pf.known };
  let m;
  if (pf.os === 'ios') {                                              // every iPhone browser is Safari's engine at the iOS version
    out.engine = 'webkit';
    m = ua.match(/OS (\d+)[_.](\d+)/); out.version = m ? [Number(m[1]), Number(m[2])] : null;
    out.name = /CriOS\//.test(ua) ? 'chrome' : /FxiOS\//.test(ua) ? 'firefox' : /EdgiOS\//.test(ua) ? 'edge' : 'safari';
    return out;
  }
  if (/Edge\/\d+/.test(ua)) { out.name = 'edge'; return out; }       // the old EdgeHTML Edge: no engine we know, features decide
  if ((m = ua.match(/Edg(?:A)?\/(\d+)/))) { out.name = 'edge'; out.engine = 'chromium'; out.version = chromeMajor(ua) || [Number(m[1]), 0]; return out; }
  if (/SamsungBrowser\/\d+/.test(ua)) { out.name = 'samsung'; out.engine = 'chromium'; out.version = chromeMajor(ua); return out; }
  if (/OPR\/\d+/.test(ua)) { out.name = 'opera'; out.engine = 'chromium'; out.version = chromeMajor(ua); return out; }
  if ((m = ua.match(/Firefox\/(\d+)/))) { out.name = 'firefox'; out.engine = 'gecko'; out.version = [Number(m[1]), 0]; return out; }
  if (/(?:Chrome|Chromium)\/\d+/.test(ua)) { out.name = brave ? 'brave' : /Chromium\//.test(ua) ? 'chromium' : 'chrome'; out.engine = 'chromium'; out.version = chromeMajor(ua); return out; }
  if ((m = ua.match(/Version\/(\d+)\.(\d+).*Safari\//))) { out.name = 'safari'; out.engine = 'webkit'; out.version = [Number(m[1]), Number(m[2])]; }
  return out;
}

/** The operating system as people name it (not translated: product names). */
export const OS_LABEL = { android: 'Android', ios: 'iPhone / iPad', windows: 'Windows', mac: 'macOS', linux: 'Linux', chromeos: 'ChromeOS' };

const older = (v, min) => v[0] < min[0] || (v[0] === min[0] && (v[1] || 0) < min[1]);
/** "108" for Chromium and Firefox, "16.4" for Safari / iOS. */
export function fmtVersion(v) { return !v ? '?' : v[1] ? `${v[0]}.${v[1]}` : String(v[0]); }

/** Can this browser run the role? why: null (ok) | 'no-bluetooth' (no browser update helps: another browser or device)
 *  | 'too-old' (update this browser) | 'missing' (a needed API is absent though the version looks fine). */
export function compatCheck(role, b, f) {
  const missing = (NEED[role] || NEED.viewer).filter((k) => !f[k]);
  const min = MIN[b.engine] || null;
  const tooOld = min && b.version && older(b.version, min) ? { have: b.version, min } : null;
  const noBt = role === 'reader' && !f.bluetooth && !(b.engine === 'chromium' && tooOld);   // an old Chrome gets Bluetooth by updating
  const why = noBt ? 'no-bluetooth' : tooOld ? 'too-old' : missing.length ? 'missing' : null;
  return { ok: why === null, why, missing, tooOld, role };
}

const PLAY = (id) => `https://play.google.com/store/apps/details?id=${id}`;
const PLAY_ID = { chrome: 'com.android.chrome', edge: 'com.microsoft.emmx', firefox: 'org.mozilla.firefox', samsung: 'com.sec.android.app.sbrowser', opera: 'com.opera.browser', brave: 'com.brave.browser' };
const SITE = { chrome: 'https://www.google.com/chrome', chromium: 'https://www.google.com/chrome', edge: 'https://www.microsoft.com/edge', firefox: 'https://www.mozilla.org/firefox' };
const DESK_STEPS = { chrome: 'deskChrome', chromium: 'deskChromium', brave: 'deskBrave', opera: 'deskOpera', edge: 'deskEdge', firefox: 'deskFirefox', safari: 'deskSafari' };

/** Where to go from here, for the detected platform: a link (store page or download page) or null, the key of the
 *  steps in T.compatSteps, and the kind of link for the button label ('store' | 'site'). */
export function updateHelp(b, check) {
  const os = b.os || 'android';
  if (check.why === 'no-bluetooth') {
    if (os === 'ios') return { url: null, link: null, steps: 'iphoneReader' };
    if (os === 'android') return { url: PLAY(PLAY_ID.chrome), link: 'store', steps: 'useChromeAndroid' };
    return { url: SITE.chrome, link: 'site', steps: 'useChromeDesktop' };
  }
  if (os === 'android') return { url: PLAY(PLAY_ID[b.name] || PLAY_ID.chrome), link: 'store', steps: 'playStore' };
  if (os === 'ios') return { url: null, link: null, steps: 'iosUpdate' };
  if (os === 'chromeos') return { url: null, link: null, steps: 'chromeos' };
  const steps = DESK_STEPS[b.name] || 'deskChrome';
  const url = SITE[b.name] || (b.name === 'unknown' ? SITE.chrome : null);
  return { url, link: url ? 'site' : null, steps };
}

/** One log line: the role, what was detected and the verdict. */
export function compatLogLine(role, b, check) {
  const what = `${b.name} ${fmtVersion(b.version)} (${b.engine}) on ${b.os}${b.osKnown ? '' : ' (assumed)'}`;
  if (check.ok) return `compat: ${role} ${what}: ok`;
  const why = check.why === 'too-old' ? `version ${fmtVersion(check.tooOld.have)} < ${fmtVersion(check.tooOld.min)}` : check.why === 'no-bluetooth' ? 'no Web Bluetooth in this browser' : `missing ${check.missing.join(', ')}`;
  return `compat: ${role} ${what}: BLOCKED - ${why}${check.why !== 'missing' && check.missing.length ? ` (also missing ${check.missing.join(', ')})` : ''}`;
}
