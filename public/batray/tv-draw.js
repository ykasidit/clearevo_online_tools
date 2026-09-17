// BatRay by ClearEvo.com - Show on TV picture: draws the flow picture into a canvas frame for the video stream
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

// The TV frame is drawn from a plain model (strings and numbers the app
// prepares), never from the DOM, so the same picture comes out at any size.
// Layout mirrors the landscape flow picture: battery, flow line, load/charger,
// status chips, with fonts sized for a screen across the room.
// model: { label, soc, battLine, dir: 'chg'|'dis'|'idle', powerTxt, ampsTxt, etaTxt,
//          sysLbl, chips: [{ txt, cls }], updatedTxt, clock, brand, stale, waiting }

const C = { bg: '#0a1626', node: '#0d1f33', edge: '#5bb6e6', dim: '#7fb0d8', text: '#eaf4ff', muted: '#6f8aa6', line: '#26476a', chg: '#5fd39a', dis: '#ffb74d', crit: '#ff8a80', low: '#ffd24a', seg: '#12283f', segOn: '#2aa9e0', bolt: '#8fe3ff', ok: '#5fd39a', bad: '#ff8a80', warn: '#ffd24a' };
const MONO = "'DejaVu Sans Mono', Consolas, 'Roboto Mono', monospace";
const SANS = "'Segoe UI', Tahoma, 'DejaVu Sans', sans-serif";

function rrect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function halo(g, txt, x, y, px, weight, color, font = MONO, align = 'center') {
  g.font = `${weight} ${px}px ${font}`; g.textAlign = align; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = px * 0.22; g.strokeStyle = C.node; g.strokeText(txt, x, y);
  g.fillStyle = color; g.fillText(txt, x, y);
}
function text(g, txt, x, y, px, color, { weight = 400, font = MONO, align = 'center' } = {}) {
  g.font = `${weight} ${px}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(txt, x, y);
}

export function drawTvFrame(g, W, H, m) {
  const s = H / 1080;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  // header
  text(g, m.label || '', 0.04 * W, 0.07 * H, 56 * s, C.text, { weight: 700, font: SANS, align: 'left' });
  text(g, m.clock || '', 0.96 * W, 0.06 * H, 48 * s, C.dim, { align: 'right' });
  text(g, m.updatedTxt || '', 0.96 * W, 0.115 * H, 32 * s, m.stale ? C.low : C.muted, { align: 'right' });
  if (m.waiting) { text(g, m.waitingTxt || '…', W / 2, H / 2, 64 * s, C.dim, { font: SANS }); footer(g, W, H, s, m); return; }

  // battery node
  const bx = 0.05 * W, by = 0.26 * H, bw = 0.23 * W, bh = 0.36 * H, r = 26 * s;
  g.lineWidth = 8 * s; g.strokeStyle = C.edge; g.fillStyle = C.node; rrect(g, bx, by, bw, bh, r); g.fill(); g.stroke();
  g.fillStyle = C.edge; rrect(g, bx + bw, by + bh * 0.3, 0.018 * W, bh * 0.4, 8 * s); g.fill();
  const soc = m.soc === null || m.soc === undefined ? null : m.soc;
  const lit = soc === null ? 0 : Math.min(5, Math.floor(soc / 20));
  const segColor = soc !== null && soc <= 10 ? C.crit : soc !== null && soc <= 25 ? C.low : C.segOn;
  const pad = bw * 0.06, gap = bw * 0.025, sw = (bw - 2 * pad - 4 * gap) / 5;
  for (let i = 0; i < 5; i++) { g.fillStyle = i < lit ? segColor : C.seg; g.strokeStyle = C.line; g.lineWidth = 2 * s; rrect(g, bx + pad + i * (sw + gap), by + bh * 0.13, sw, bh * 0.74, 8 * s); g.fill(); g.stroke(); }
  halo(g, soc === null ? '-' : `${soc}%`, bx + bw / 2, by + bh / 2, 132 * s, 700, C.text);
  text(g, m.battLine || '', bx + bw / 2, by + bh + 0.06 * H, 44 * s, C.dim);

  // system node
  const sx = 0.72 * W, sw2 = 0.23 * W;
  g.lineWidth = 8 * s; g.strokeStyle = C.edge; g.fillStyle = C.node; rrect(g, sx, by, sw2, bh, r); g.fill(); g.stroke();
  const cx = sx + sw2 / 2, cy = by + bh / 2, bs = bh * 0.32;
  g.fillStyle = C.bolt; g.beginPath();
  g.moveTo(cx, cy - bs); g.lineTo(cx - bs * 0.7, cy + bs * 0.1); g.lineTo(cx - bs * 0.1, cy + bs * 0.1); g.lineTo(cx - bs * 0.3, cy + bs); g.lineTo(cx + bs * 0.7, cy - bs * 0.15); g.lineTo(cx + bs * 0.1, cy - bs * 0.15); g.closePath(); g.fill();
  text(g, m.sysLbl || '', cx, by + bh + 0.06 * H, 44 * s, C.dim);

  // flow line
  const x1 = bx + bw + 0.018 * W + 0.012 * W, x2 = sx - 0.012 * W, ly = by + bh / 2;
  const col = m.dir === 'chg' ? C.chg : m.dir === 'dis' ? C.dis : C.line;
  g.lineCap = 'round'; g.lineWidth = 8 * s; g.strokeStyle = C.line; g.beginPath(); g.moveTo(x1, ly); g.lineTo(x2, ly); g.stroke();
  if (m.dir !== 'idle') {
    g.strokeStyle = col; g.setLineDash([26 * s, 22 * s]); g.lineDashOffset = -((m.tick || 0) * 12 * s); g.beginPath(); g.moveTo(x1, ly); g.lineTo(x2, ly); g.stroke(); g.setLineDash([]);
    const n = 3, span = (x2 - x1), ch = 34 * s;
    g.lineWidth = 10 * s; g.lineJoin = 'round';
    for (let i = 1; i <= n; i++) {
      const x = x1 + span * (i / (n + 1));
      g.beginPath();
      if (m.dir === 'dis') { g.moveTo(x - ch * 0.5, ly - ch); g.lineTo(x + ch * 0.5, ly); g.lineTo(x - ch * 0.5, ly + ch); } else { g.moveTo(x + ch * 0.5, ly - ch); g.lineTo(x - ch * 0.5, ly); g.lineTo(x + ch * 0.5, ly + ch); }
      g.stroke();
    }
  }
  const mx = (x1 + x2) / 2;
  const fit = (txt, px) => { g.font = `700 ${px}px ${MONO}`; const w = g.measureText(txt).width; return w > (x2 - x1) * 0.98 ? px * (x2 - x1) * 0.98 / w : px; };
  halo(g, m.powerTxt || '-', mx, ly - 0.10 * H, fit(m.powerTxt || '-', 68 * s), 700, m.dir === 'idle' ? C.text : col);
  halo(g, m.ampsTxt || '', mx, ly + 0.085 * H, fit(m.ampsTxt || '', 42 * s), 400, C.dim);
  halo(g, m.etaTxt || '', mx, ly + 0.145 * H, fit(m.etaTxt || '', 40 * s), 400, m.etaBad ? C.crit : C.dim);

  // chips
  const chips = m.chips || [];
  const cpx = 38 * s, padX = 30 * s, padY = 16 * s, gapX = 22 * s, rowH = cpx + 2 * padY + 18 * s;
  g.font = `400 ${cpx}px ${MONO}`;
  const widths = chips.map((c) => g.measureText(c.txt).width + 2 * padX);
  const rows = [[]]; let acc = 0;
  chips.forEach((c, i) => { if (acc + widths[i] > W * 0.92 && rows[rows.length - 1].length) { rows.push([]); acc = 0; } rows[rows.length - 1].push(i); acc += widths[i] + gapX; });
  let y = 0.80 * H;
  for (const row of rows) {
    const total = row.reduce((a, i) => a + widths[i], 0) + gapX * (row.length - 1);
    let x = (W - total) / 2;
    for (const i of row) {
      const c = chips[i], colc = c.cls === 'ok' ? C.ok : c.cls === 'bad' ? C.bad : c.cls === 'warn' ? C.warn : C.dim;
      g.lineWidth = 3 * s; g.strokeStyle = colc; g.fillStyle = C.node; rrect(g, x, y - rowH / 2 + 9 * s, widths[i], cpx + 2 * padY, (cpx + 2 * padY) / 2); g.fill(); g.stroke();
      text(g, c.txt, x + widths[i] / 2, y + 9 * s, cpx, colc, { weight: c.cls === 'bad' ? 700 : 400 });
      x += widths[i] + gapX;
    }
    y += rowH;
  }
  footer(g, W, H, s, m);
}

function footer(g, W, H, s, m) {
  text(g, m.brand || 'BatRay by ClearEvo.com', 0.04 * W, H - 0.04 * H, 30 * s, C.muted, { font: SANS, align: 'left' });
  if (m.footer) text(g, m.footer, 0.96 * W, H - 0.04 * H, 30 * s, C.muted, { font: SANS, align: 'right' });
}
