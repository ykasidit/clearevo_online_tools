// BatRay by ClearEvo.com - ESLint rule: no UI call after an await without a guard (Dart's use_build_context_synchronously)
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
// The owner's Dart analog (2026-10-01): "doing UI stuff when the view is not mounted is a static test fail". A page
// never unmounts, but the state a UI call paints can be stale by the time an await returns: another flow may own the
// link, the sheet may be a different one, the pack may be gone. So in an async function, once an await has happened,
// a call that paints (render*, toast, openSheet/updateSheet/closeSheet, setStatus, castHint, $()) must come after a
// GUARD since that await - an `if (...) return/throw/break/continue` (the ownership re-check: `publisher !== pub`,
// `tv !== t`, `uiS.sheet.kind !== ...`), `signal.throwIfAborted()`, or `own()`. A call that is the awaited expression
// itself (`await openSheet(...)`) is the wait, not a paint after it. Where a paint after an await is correct without a
// re-check (the function is single-flight by construction, or the paint reports the awaited result itself) the line
// carries `// eslint-disable-next-line house/ui-after-await -- <why>`; the lint test fails on a directive without a
// reason or one that is no longer needed.
// toast() is not in the list: a toast reports the awaited result ("restored", "copied"), it paints no state.
// $() counts only as a write target (`$('x').hidden = ...`, `$('x').click()`), not as a read in a condition.
// A paint that is the direct consequent of an `if` after the await counts as guarded: the condition is the re-check.
export const UI_CALLEE = /^(\$|render[A-Z]\w*|refreshCard|paint[A-Z]\w*|scheduleDraw|openSheet|updateSheet|closeSheet|castHint|setStatus|applyLang|showQr|unloadPreview)$/;

export const uiAfterAwait = {
  meta: { type: 'problem', docs: { description: 'a UI call after an await needs an ownership / state re-check first' }, schema: [{ type: 'object', properties: { extra: { type: 'array', items: { type: 'string' } } }, additionalProperties: false }] },
  create(ctx) {
    // a tool lists its own paint functions in test/rules/<tool>.mjs (uiExtra); the shared names cover BatRay's
    const extra = (ctx.options[0] && ctx.options[0].extra) || [];
    const isUi = (name) => UI_CALLEE.test(name) || extra.includes(name);
    const stack = [];
    const ifSeq = new WeakMap();                                          // IfStatement -> the await count when its test ran
    const enter = (node) => stack.push(node.async ? { dirty: false, seq: 0 } : null);
    const leave = () => stack.pop();
    const top = () => stack[stack.length - 1];
    const exits = /^(ReturnStatement|ThrowStatement|BreakStatement|ContinueStatement)$/;
    function isGuard(st) {
      if (st.type === 'IfStatement') {
        const c = st.consequent; const last = c.type === 'BlockStatement' ? c.body[c.body.length - 1] : c;
        return !!last && exits.test(last.type);
      }
      if (st.type === 'ExpressionStatement') return /throwIfAborted\(|\bown\(\)/.test(ctx.sourceCode.getText(st));
      return false;
    }
    return {
      FunctionDeclaration: enter, FunctionExpression: enter, ArrowFunctionExpression: enter,
      'FunctionDeclaration:exit': leave, 'FunctionExpression:exit': leave, 'ArrowFunctionExpression:exit': leave,
      'AwaitExpression:exit'() { const t = top(); if (t) { t.dirty = true; t.seq++; } },
      ':statement'(st) { const t = top(); if (t && isGuard(st)) t.dirty = false; },
      IfStatement(node) { const t = top(); if (t) ifSeq.set(node, t.seq); },
      CallExpression(node) {
        const t = top(); if (!t || !t.dirty) return;
        const c = node.callee; const name = c.type === 'Identifier' ? c.name : null;
        if (!name || !isUi(name)) return;
        if (node.parent.type === 'AwaitExpression') return;                 // the wait itself, not a paint after it
        if (name === '$') {
          const m = node.parent; if (m.type !== 'MemberExpression' || m.object !== node) return;
          const g = m.parent; const write = (g.type === 'AssignmentExpression' && g.left === m) || (g.type === 'CallExpression' && g.callee === m) || (g.type === 'MemberExpression' && g.object === m && g.parent.type === 'AssignmentExpression' && g.parent.left === g);
          if (!write) return;
        }
        // `if (cond) paint()` / `if (cond) { ...; paint(); }`: the condition ran after the await, so it is the re-check -
        // walk up through blocks to the nearest if; it guards only when no await happened since its test
        let st = node; while (st.parent && !/Statement$|Declaration$/.test(st.parent.type)) st = st.parent;
        let up = st.parent.parent;                                          // from the paint's statement upwards
        while (up && (up.type === 'BlockStatement' || up.type === 'TryStatement' || up.type === 'IfStatement')) {
          if (up.type === 'IfStatement') { if (ifSeq.get(up) === t.seq) return; break; }
          up = up.parent;
        }
        ctx.report({ node, message: `${name}() after an await without a guard: re-check ownership or state first (if (...) return), or say why not` });
        t.dirty = false;
      },
    };
  },
};
