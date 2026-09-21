// BatRay by ClearEvo.com - History chart I/O: the uPlot wrapper (dark axes, signed power fill, cut-off line, pinch zoom)
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
// The history logic module picks the rows and the window; this only draws
// them with the vendored uPlot (MIT, loaded by the page as a plain script).
// One finger keeps scrolling the page (the browser's gesture); two fingers
// pinch the time axis; a mouse drags a window; a double click resets.

const pad = (n) => String(n).padStart(2, '0');
// 24 h clock like the rest of the page; a midnight tick and a multi-day window show the date
function timeLabels(u, ts) {
  const span = u.scales.x.max - u.scales.x.min;
  return ts.map((t) => { const d = new Date(t * 1000); const day = `${d.getDate()}/${d.getMonth() + 1}`; return span > 2 * 86400 || (d.getHours() === 0 && d.getMinutes() === 0) ? day : `${pad(d.getHours())}:${pad(d.getMinutes())}`; });
}
const AXIS = { stroke: '#7fb0d8', font: '10px DejaVu Sans Mono, monospace', grid: { stroke: '#1c3550', width: 1 }, ticks: { stroke: '#1c3550', width: 1 } };

function pinchPlugin() {
  function init(u) {
    const over = u.over; let rect = null, range0 = 0, xAt0 = 0, dist0 = 0;
    const mid = (e) => (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
    const dist = (e) => Math.abs(e.touches[0].clientX - e.touches[1].clientX);
    over.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      rect = over.getBoundingClientRect(); dist0 = dist(e); range0 = u.scales.x.max - u.scales.x.min; xAt0 = u.posToVal(mid(e), 'x');
      e.preventDefault();
    }, { passive: false });
    over.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !dist0 || !rect) return;
      e.preventDefault();
      const nr = range0 * dist0 / Math.max(1, dist(e)), mx = mid(e);
      const min = xAt0 - (mx / rect.width) * nr;
      u.setScale('x', { min, max: min + nr });
    }, { passive: false });
    over.addEventListener('touchend', () => { dist0 = 0; });
  }
  return { hooks: { init } };
}

/** Make the chart in el. getCutoff() returns the inverter cut-off % for the dashed line. */
export function makeChart(el, width, getCutoff) {
  const opts = {
    width, height: 200, legend: { show: false }, cursor: { drag: { x: true, y: false }, points: { show: false } },
    scales: {
      x: { time: true },
      w: { range: (u, min, max) => { const m = Math.ceil(Math.max(100, Math.abs(min || 0), Math.abs(max || 0)) / 100) * 100; return [-m, m]; } },
      pct: { range: [0, 100] },
      v: { range: (u, min, max) => [(min || 0) - 1, (max || 0) + 1] },
    },
    axes: [
      { ...AXIS, space: 70, values: timeLabels },
      { ...AXIS, scale: 'w', size: 54, values: (u, vs) => vs.map((x) => `${x} W`) },
      { ...AXIS, scale: 'pct', side: 1, size: 40, values: (u, vs) => vs.map((x) => `${x}%`), grid: { show: false } },
    ],
    series: [
      {},
      { scale: 'w', stroke: '#5fd39a', fill: 'rgba(95,211,154,.45)', width: 1, spanGaps: false, fillTo: () => 0 },
      { scale: 'w', stroke: '#ffb74d', fill: 'rgba(255,183,77,.45)', width: 1, spanGaps: false, fillTo: () => 0 },
      { scale: 'pct', stroke: '#4aa9e0', width: 2, spanGaps: false },
      { scale: 'v', show: false },
    ],
    hooks: {
      draw: [(u) => {
        const cut = getCutoff(); if (!(cut > 0)) return;
        const ctx = u.ctx, y = u.valToPos(cut, 'pct', true);
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke(); ctx.restore();
      }],
    },
    plugins: [pinchPlugin()],
  };
  return new uPlot(opts, [[], [], [], [], []], el);   // eslint-disable-line no-undef
}

/** Put series (from chartSeries) on the chart and show the window from..to (ms). */
export function drawChart(u, series, from, to, width) {
  if (width && u.width !== width) u.setSize({ width, height: u.height });
  u.setData([series.t, series.wc, series.wd, series.soc, series.v], false);
  u.setScale('x', { min: from / 1000, max: to / 1000 });
}
