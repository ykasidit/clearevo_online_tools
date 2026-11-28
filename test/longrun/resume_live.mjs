// BatRay by ClearEvo.com - live check: how long a viewer takes to be live again after the tab comes back
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
// Opens a share link as a viewer (the deployed site and the real relay, a reader live on the other end), waits for
// "viewing ... live", then plays what Android does to a tab that is left and opened again: hidden, freeze (BatRay
// closes its socket, 4004), resume, visible - the resume before the close has been seen, the order that cost 4 s
// before 0.9.102. Measures the time from the return to "viewing ... live" and prints the app's own log lines.
// Headless Chrome cannot hide or truly freeze a visible page (Page.setWebLifecycleState is refused), so the
// visibility is overridden and the lifecycle events are dispatched to the page.
//
// Usage (the link holds the share key: never commit it; pass it in):
//   LIVE_URL='https://www.clearevo.com/batray/?view=...#k=...' node test/longrun/resume_live.mjs
//   LIVE_URL_FILE=/path/to/file-with-the-link node test/longrun/resume_live.mjs
// Env: ROUNDS (5), MAX_MS (1500: the median that fails the check), HTTPS_PROXY (used when set).
// Measured 2026-11-28: 0.9.101 5.0 s, 0.9.102 0.97 s, 0.9.103 0.49 s (socket open 0.42-0.51 s).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const raw = process.env.LIVE_URL || (process.env.LIVE_URL_FILE ? readFileSync(process.env.LIVE_URL_FILE, 'utf8').trim() : '');
if (!/^https:\/\/[^#]+\?view=[^#]+#k=/.test(raw)) {
	console.error('resume_live: set LIVE_URL (or LIVE_URL_FILE) to a BatRay share link (https://.../batray/?view=...#k=...)');
	process.exit(2);
}
const url = raw.replace('#', '&test#');                 // ?test exposes the log to the check
const rounds = Number(process.env.ROUNDS || 5);
const maxMs = Number(process.env.MAX_MS || 1500);
const LIVE_RE = /viewing .* live/;

const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
let failed = false;
try {
	const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true });
	await ctx.addInitScript(() => {
		let vis = 'visible';
		Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });
		Object.defineProperty(document, 'hidden', { get: () => vis === 'hidden', configurable: true });
		window.__setVis = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
	});
	const page = await ctx.newPage();
	await page.goto(url, { waitUntil: 'load', timeout: 60000 });
	const status = () => page.evaluate(() => document.getElementById('stat').textContent);
	const t00 = Date.now();
	while (!LIVE_RE.test(await status())) {
		if (Date.now() - t00 > 60000)
			throw new Error('the viewer never said "viewing ... live" - is the reader online?');
		await page.waitForTimeout(25);
	}
	console.log(await page.evaluate(() => document.title));
	const times = [];
	for (let k = 0; k < rounds; k++) {
		await page.waitForTimeout(6000);
		const before = await page.evaluate(() => window.__batrayTest.logLines().length);
		const t0 = await page.evaluate(() => {
			window.__setVis('hidden');
			document.dispatchEvent(new Event('freeze'));
			document.dispatchEvent(new Event('resume'));
			window.__setVis('visible');
			return Date.now();
		});
		const seen = [];
		for (;;) {
			const s = await status();
			if (!seen.length || seen[seen.length - 1] !== s)
				seen.push(s);
			if (seen.length > 1 && LIVE_RE.test(s))
				break;
			if (Date.now() - t0 > 20000)
				break;
			await page.waitForTimeout(20);
		}
		const ms = Date.now() - t0;
		times.push(ms);
		const lines = (await page.evaluate((n) => window.__batrayTest.logLines().slice(n), before))
			.filter((l) => /signal|live:/.test(l));
		console.log(`round ${k + 1}: live again ${ms} ms after the return | ${seen.join(' -> ')}`);
		for (const l of lines)
			console.log(`    ${l}`);
	}
	const median = [...times].sort((a, b) => a - b)[times.length >> 1];
	failed = median > maxMs;
	console.log(`median ${median} ms (limit ${maxMs} ms): ${failed ? 'TOO SLOW' : 'ok'}`);
} finally {
	await browser.close();
}
process.exit(failed ? 1 : 0);
