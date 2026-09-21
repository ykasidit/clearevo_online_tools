// BatRay by ClearEvo.com - UI shell decisions: tabs, bottom sheets, Back, low power, sheet contents (pure, tested)
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
// Functional core of the UI chrome from UI_GUIDELINES.md (house rule
// 2026-09-20): `uiState()` is the one object; these functions decide what a
// tab tap, a tile tap, a sheet choice or the Back button does, and build the
// plain-language sheet contents from a reading. No DOM, no history API here.
import { fmt, fmtSpan, flowModel, etaModel, chipList, socClass } from './view-logic.js';

export const TABS = ['now', 'history', 'more'];
export function uiState(role) { return { role: role === 'viewer' ? 'viewer' : 'reader', tab: 'now', sheet: null, lowPower: false }; }

export function tabTap(ui, tab) {
  if (ui.role !== 'viewer' || !TABS.includes(tab) || ui.tab === tab) return { action: 'noop' };
  ui.tab = tab; return { action: 'switch', tab };
}
export function sheetOpen(ui, kind) { const replace = !!ui.sheet; ui.sheet = { kind }; return { action: 'open', kind, replace }; }
export function sheetClose(ui) { if (!ui.sheet) return { action: 'noop' }; const kind = ui.sheet.kind; ui.sheet = null; return { action: 'close', kind }; }
/** The Back button, as a messenger user expects: closes a sheet, else goes to Now, else leaves the page. */
export function backDecision(ui) {
  if (ui.sheet) { const kind = ui.sheet.kind; ui.sheet = null; return { action: 'close-sheet', kind }; }
  if (ui.role === 'viewer' && ui.tab !== 'now') { ui.tab = 'now'; return { action: 'switch', tab: 'now' }; }
  return { action: 'leave' };
}
export function lowPowerSet(ui, on) { ui.lowPower = !!on; return ui.lowPower; }
/** Decorative motion runs only when nothing asks for stillness. */
export function motionAllowed(ui, { reducedMotion = false, visible = true } = {}) { return !ui.lowPower && !reducedMotion && visible; }

/** Cell balance in plain words: ok up to 30 mV apart, watch up to 60, act above. */
export const CELL_OK_MV = 30, CELL_WATCH_MV = 60;
export function cellBalance(deltaMv) { return deltaMv <= CELL_OK_MV ? 'ok' : deltaMv <= CELL_WATCH_MV ? 'watch' : 'act'; }

/**
 * What a sheet shows. ctx: { d, settings, iEmaV, cutoffPct, label, lang, langs, res, mode }.
 * Returns { title, lead, tone, rows: [[k, v]], options: [{ id, label, on }], actions: [{ id, label, primary }] }.
 */
export function sheetModel(kind, ctx, T) {
  const m = { title: '', lead: '', tone: '', rows: [], options: [], actions: [] };
  const d = ctx.d;
  switch (kind) {
    case 'soc': {
      m.title = T.sheetSocTitle;
      if (!d) { m.lead = T.noData; break; }
      const e = etaModel({ remainAh: d.remainAh, nominalAh: d.nominalAh, currentA: ctx.iEmaV !== null && ctx.iEmaV !== undefined ? ctx.iEmaV : d.current, cutoffPct: ctx.cutoffPct }, T);
      m.lead = (d.soc === null || d.soc === undefined ? T.noData : T.sheetSocLead(d.soc)) + (e.text ? ' ' + e.text : '');
      const cls = socClass(d.soc); m.tone = cls.includes('crit') ? 'act' : cls.includes('low') ? 'watch' : cls ? 'ok' : '';
      m.rows.push([T.shPackV, fmt(d.packV, 2, ' V')], [T.shSoh, d.soh === undefined || d.soh === null ? '-' : `${d.soh} %`]);
      if (d.remainAh !== undefined && d.remainAh !== null) m.rows.push([T.shRemain, `${fmt(d.remainAh, 1)} / ${fmt(d.nominalAh, 0)} Ah`]);
      m.rows.push([T.shCutoff, `${ctx.cutoffPct} %`]);
      break;
    }
    case 'flow': {
      m.title = T.sheetFlowTitle;
      if (!d) { m.lead = T.noData; break; }
      const f = flowModel(d, ctx.settings, T), w = fmt(Math.abs(d.power || 0), 0);
      m.lead = f.dir === 'chg' ? T.sheetFlowChg(w) : f.dir === 'dis' ? T.sheetFlowDis(w) : T.sheetFlowIdle;
      m.tone = f.dir === 'idle' ? '' : 'ok';
      m.rows.push([T.shCurrent, d.current === null || d.current === undefined ? '-' : fmt(d.current, 2, ' A')], [T.shMax, `${fmt(f.maxA, 0)} A`], [T.shPower, d.power === null || d.power === undefined ? '-' : fmt(d.power, 0, ' W')]);
      break;
    }
    case 'chips': {
      m.title = T.sheetChipsTitle;
      if (!d) { m.lead = T.noData; break; }
      const chips = chipList(d, T);
      const bad = chips.filter((c) => c.cls === 'bad');
      const alarms = d.errors ? bad.filter((c) => /alarm/i.test(c.txt) || c === chips[chips.length - 1]).length : 0;
      m.lead = alarms ? T.sheetChipsBad(alarms) : bad.length ? T.sheetChipsBlocked : T.sheetChipsOk;
      m.tone = alarms ? 'act' : bad.length ? 'watch' : 'ok';
      m.rows = chips.map((c) => [c.txt, c.cls === 'bad' ? '!' : c.cls === 'warn' ? '~' : '']);
      break;
    }
    case 'cells': {
      m.title = T.sheetCellsTitle;
      const cells = d && d.cells ? d.cells : [];
      if (cells.length < 2) { m.lead = T.noData; break; }
      let lo = cells[0], hi = cells[0];
      for (const c of cells) { if (c.v < lo.v) lo = c; if (c.v > hi.v) hi = c; }
      const mv = Math.round((hi.v - lo.v) * 1000), b = cellBalance(mv);
      m.lead = b === 'ok' ? T.cellsOk(mv) : b === 'watch' ? T.cellsWatch(mv) : T.cellsAct(mv);
      m.tone = b;
      m.rows.push([T.shLow, `${lo.n}: ${lo.v.toFixed(3)} V`], [T.shHigh, `${hi.n}: ${hi.v.toFixed(3)} V`], [T.shDelta, `${mv} mV`], [T.shCount, String(cells.length)]);
      break;
    }
    case 'lang':
      m.title = T.sheetLang;
      m.options = (ctx.langs || []).map((l) => ({ id: l.code, label: l.name, on: l.code === ctx.lang }));
      break;
    case 'res':
      m.title = T.sheetRes;
      m.options = [{ id: '1280x720', label: '720p', on: ctx.res === '1280x720' }, { id: '1920x1080', label: '1080p', on: ctx.res === '1920x1080' }];
      break;
    case 'keepAwake':
      m.title = T.keepAwakePre.replace(/:\s*$/, ''); m.lead = T.keepAwakePost;
      m.options = [{ id: 'auto', label: T.keepAwakeAuto, on: ctx.mode === 'auto' }, { id: 'always', label: T.keepAwakeAlways, on: ctx.mode === 'always' }, { id: 'never', label: T.keepAwakeNever, on: ctx.mode === 'never' }];
      break;
    case 'live':
      m.title = T.sheetLiveTitle; m.lead = ctx.liveText || '';
      break;
    case 'upload':
      m.title = T.uploadLog; m.lead = T.uploadWarn;
      m.actions = [{ id: 'cancel', label: T.cancel, primary: false }, { id: 'ok', label: T.uploadGo, primary: true }];
      break;
    case 'clearHist':
      m.title = T.histClear; m.lead = T.histClearBody(ctx.histDays || 0, ctx.histSize || '0 KB'); m.tone = 'act';
      m.actions = [{ id: 'cancel', label: T.cancel, primary: false }, { id: 'ok', label: T.histClearGo, primary: true }];
      break;
    default:
      m.title = String(kind);
  }
  return m;
}
