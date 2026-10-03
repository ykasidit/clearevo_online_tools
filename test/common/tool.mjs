// ClearEvo online tools - which tool a shared test is running for (tests)
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
// The static-analysis and house-rule tests are ONE file each under test/common/; every tool that opts in gets a
// symlink named <tool>_<check>.test.js pointing at it (`ln -s common/lint.test.js test/dicom_lint.test.js`). node
// --test runs each symlink as its own process with the symlink path in process.argv[1], so the shared file learns
// which tool it is from its own name and loads that tool's rules from test/rules/<tool>.mjs. One body, no copies:
// a rule learned on one tool is a rule for all of them the moment the symlink exists (owner, 2026-10-03).
import path from 'node:path';

export const TOOL = path.basename(process.argv[1] || '').split('_')[0];
if (!/^[a-z]+$/.test(TOOL)) throw new Error(`cannot tell the tool from the test file name ${process.argv[1]} - run it as test/<tool>_<check>.test.js (a symlink to the common file)`);
export const RULES = (await import(`../rules/${TOOL}.mjs`)).default;
export const DIR = RULES.dir;                                          // public/<tool>
