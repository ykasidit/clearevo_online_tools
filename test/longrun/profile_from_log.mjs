// BatRay by ClearEvo.com - tests (profile_from_log.mjs)
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
// Turns an uploaded reader log into an event profile (events per hour, numbers only - no names, ids or frames, so
// the profile can live in this public repo while the log stays private). The long-run browser test replays the
// profile day after day.   node test/longrun/profile_from_log.mjs <reader-log.txt> > test/longrun/<name>.json
import { readFileSync } from 'node:fs';

const KINDS = {
  connectTry: /^connecting to /,
  refused: /connect: attempt \d+ failed after \d+ ms: Connection Error/,
  serverUp: /^gatt: server connected in /,
  serviceUp: /^gatt: service found in /,
  gattDown: /^gatt disconnected/,
  stall: /no data for \d+ s|^conn: .*stall/,
  socketClose: /^signal: socket closed /,
  socketOpen: /^signal: socket open /,
  hidden: /^tab hidden|vis=hidden -> /,
  visible: /^tab visible/,
  offline: /^network: offline|went offline/,
  online: /^network: online|back online/,
  wakeDrop: /wake lock dropped/,
  frameLog: /^frame #\d+ /,
};
const text = readFileSync(process.argv[2], 'utf8').split('\n');
const ver = (/^BatRay v(\S+)/.exec(text[0]) || [])[1] || '?';
const role = / · reader · /.test(text[0]) ? 'reader' : 'viewer';
const times = [], counts = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
for (const line of text) {
  const m = /^(\d\d):(\d\d):(\d\d)\.(\d{3}) {2}(.*)$/.exec(line);
  if (!m) continue;
  times.push(((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]);
  for (const [k, re] of Object.entries(KINDS)) if (re.test(m[5])) counts[k]++;
}
let span = 0;                                                                // the log's clock wraps at midnight
for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; span += d >= 0 ? d : d + 86400000; }
const hours = span / 3600000;
const perHour = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Math.round(n / hours * 100) / 100]));
process.stdout.write(JSON.stringify({ source: `BatRay v${ver} ${role} log, ${Math.round(hours * 10) / 10} h`, hours: Math.round(hours * 100) / 100, counts, perHour }, null, 2) + '\n');
