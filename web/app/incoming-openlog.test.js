// B166: the shell's hand-off trail (app.takeOpenLog) lands in Settings > Console Logs, one entry per take.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { takeOpenLog, openLogTitle } from "./incoming.js";
import { createRunLog } from "./core/queue.js";
import { NAME } from "./brand.js";

const native = (lines) => ({ calls: [], async call(m, p) { this.calls.push(m); if (m !== "app.takeOpenLog") throw new Error("no"); return { lines }; } });

test("a hand-off that reached the page: one Completed entry named after the file, lines in order", async () => {
  const logs = createRunLog(null);
  const lines = [
    "10:03:01.000  · came forward",
    "10:03:01.010  SceneDelegate openURLContexts: file …/Downloads/Yingxia-1.8.26-ios.ipa (open in place: true, from com.apple.mobilesafari)",
    "10:03:01.011  Incoming: file …/Downloads/Yingxia-1.8.26-ios.ipa",
    "10:03:01.012  SharedInbox: took Yingxia-1.8.26-ios.ipa (sideload build, security scope started)",
    "10:03:09.500  SharedInbox: handing the page ifizbox://shared?route=sign-ipa&file&name",
    "10:03:09.600  Incoming: the page took ifizbox://shared?route=sign-ipa&file&name",
  ];
  const e = await takeOpenLog({ native: native(lines), logs });
  assert.equal(e.title, `Open in ${NAME}: Yingxia-1.8.26-ios.ipa`);
  assert.equal(e.ok, true);
  assert.equal(logs.get(e.id).text, lines.join("\n"));
  assert.equal(logs.list().length, 1);
});

test("an error line marks the entry Failed", async () => {
  const logs = createRunLog(null);
  const e = await takeOpenLog({ native: native(["10:00:00.000  SharedInbox: took A.ipa (sideload build, security scope started)",
    "10:00:00.100  SharedInbox: error: the file coordinator refused it: gone"]), logs });
  assert.equal(e.ok, false);
  assert.equal(e.code, 1);
});

test("nothing to take, or an older shell without app.takeOpenLog: no entry", async () => {
  const logs = createRunLog(null);
  assert.equal(await takeOpenLog({ native: native([]), logs }), null);
  assert.equal(await takeOpenLog({ native: { call: async () => { throw new Error("unknown method"); } }, logs }), null);
  assert.equal(logs.list().length, 0);
});

test("title: a link alone (no file) is plain Open in", () => {
  assert.equal(openLogTitle(["10:00:00.000  Incoming: ifizbox://add?url", "10:00:00.001  Incoming: the page took ifizbox://add?url"]), `Open in ${NAME}`);
  assert.equal(openLogTitle(["x  MyIPAs: took B.ipa"]), `Open in ${NAME}: B.ipa`);
});
