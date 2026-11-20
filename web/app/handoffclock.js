// B174: when the last hand-off from another app reached the page (an .ipa from Files or Share > Open in iFizBox, a
// ifizbox:// link): incoming.js marks it as the shell announces one ("ifizbox:receiving", "ifizbox:url") and as it
// opens the link's page. app.js's Return Home After (back from the background after a while: Home's root) asks
// first, so a file that brought iFizBox forward ends on its own page, not under a jump to Home that the same
// return to the front set off.
//   markHandoff(now?)              a hand-off arrived (or its page just opened)
//   handoffRecent(now?, ms?)       -> true within HANDOFF_MS of the last mark
// SPDX-License-Identifier: GPL-3.0-or-later

export const HANDOFF_MS = 15_000;
let last = -Infinity;

export function markHandoff(now = Date.now()) { last = now; }

export function handoffRecent(now = Date.now(), ms = HANDOFF_MS) { return now - last >= 0 && now - last < ms; }
