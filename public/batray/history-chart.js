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
/** @type {any} */
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

// y ranges per scale: battery % is always 0..100; current and power keep zero in view; the rest pad the data
const withZero = (u, min, max) => { const lo = Math.min(0, min || 0), hi = Math.max(0, max || 0), d = Math.max(1, (hi - lo) * 0.1); return [lo === 0 ? 0 : lo - d, hi === 0 ? 0 : hi + d]; };
const padded = (u, min, max) => { const d = Math.max(0.5, ((max || 0) - (min || 0)) * 0.1); return [(min || 0) - d, (max || 0) + d]; };
const RANGES = { pct: () => [0, 100], i: withZero, w: withZero };

/** Make the chart in el for the chosen lines (keys of PARAMS, in order). The first line owns the left axis, the
 *  second the right one, a third and fourth draw without an axis (their values show on the chips). getCutoff()
 *  returns the inverter cut-off % for the dashed line (drawn only with the battery % line). onCursor(idx) is
 *  told where the pointer is (null when it leaves). */
export function makeChart(el, width, params, PARAMS, { getCutoff, onCursor }) {
  const scales = { x: { time: true } }, axes = [{ ...AXIS, space: 70, values: timeLabels }], series = [{}];
  params.forEach((key, k) => {
    const p = PARAMS[key];
    if (!scales[p.scale]) scales[p.scale] = { range: RANGES[p.scale] || padded };
    if (k < 2) axes.push({ ...AXIS, scale: p.scale, side: k === 0 ? 3 : 1, size: 64, stroke: p.color, values: (u, vs) => vs.map((x) => `${Number.isInteger(x) ? x : x.toFixed(p.dec)}${p.unit === '%' ? '%' : ' ' + p.unit}`), grid: k === 0 ? AXIS.grid : { show: false } });
    series.push({ scale: p.scale, stroke: p.color, width: k === 0 ? 2 : 1.5, spanGaps: false });
  });
  const hasSoc = params.includes('soc');
  const opts = {
    width, height: 200, legend: { show: false }, cursor: { drag: { x: true, y: false }, points: { show: false } },
    scales, axes, series,
    hooks: {
      draw: [(u) => {
        const cut = getCutoff(); if (!hasSoc || !(cut > 0)) return;
        const ctx = u.ctx, y = u.valToPos(cut, 'pct', true);
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke(); ctx.restore();
      }],
      setCursor: [(u) => { if (onCursor) onCursor(u.cursor.idx === null || u.cursor.idx === undefined ? null : u.cursor.idx); }],
    },
    plugins: [pinchPlugin()],
  };
  return new uPlot(opts, [[], ...params.map(() => [])], el);
}

/** Put series (from seriesFromBuckets) on the chart for the chosen lines and show the window from..to (ms). */
export function drawChart(u, series, params, PARAMS, from, to, width) {
  if (width && u.width !== width) u.setSize({ width, height: u.height });
  u.setData([series.t, ...params.map((k) => series[PARAMS[k].col])], false);
  u.setScale('x', { min: from / 1000, max: to / 1000 });
}
