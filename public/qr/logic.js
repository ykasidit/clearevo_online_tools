// ClearEvo.com QR Code Generator - logic
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

// static QR payload builders. Pure, tested.

// escape per WiFi QR spec: \ ; , : " need backslash
export function wifiEscape(s) { return s.replace(/([\\;,:"])/g, '\\$1'); }

export function wifiPayload(ssid, pass, auth /* WPA|WEP|nopass */, hidden) {
  const p = auth === 'nopass' ? '' : `P:${wifiEscape(pass)};`;
  return `WIFI:T:${auth};S:${wifiEscape(ssid)};${p}${hidden ? 'H:true;' : ''};`;
}

export function vcardPayload(name, phone, email, org) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`];
  if (org) lines.push(`ORG:${org}`);
  if (phone) lines.push(`TEL:${phone}`);
  if (email) lines.push(`EMAIL:${email}`);
  lines.push('END:VCARD');
  return lines.join('\n');
}

export function buildPayload(type, f) {
  switch (type) {
    case 'url': return f.text.trim();
    case 'text': return f.text;
    case 'wifi': return wifiPayload(f.ssid, f.pass, f.auth, f.hidden);
    case 'vcard': return vcardPayload(f.name, f.phone, f.email, f.org);
    case 'tel': return `tel:${f.text.trim()}`;
    case 'mailto': return `mailto:${f.text.trim()}`;
    default: return f.text;
  }
}

// QR byte-mode capacity by EC level (version 40) - pre-check before the lib throws
export const CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 };
export function capacityCheck(payload, ec) {
  const n = new TextEncoder().encode(payload).length;
  return n > CAPACITY[ec]
    ? `data is ${n} bytes - max for a QR code at level ${ec} is ${CAPACITY[ec]} bytes; shorten it or lower the error-correction level`
    : null;
}
