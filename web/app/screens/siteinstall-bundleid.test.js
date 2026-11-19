// F262: the website's bulk Update / Re-sign (installed.js manageInstall) and the queue's site path (queue.js
// resignApp with a url) hand signAndInstall the app's bundle ID and version, so the early link can open iOS's prompt
// at the tap (signing-client.js expectedBundleId); My IPAs jobs and ones renamed by Sign Options go without one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { siteInstallArgs, resignApp } from "./queue.js";
import { manageInstall } from "./installed.js";

const siteSc = (calls) => ({ localSigning: () => false, isSelfIpa: () => false, signAndInstall: async (o) => { calls.push(o); return true; } });
const hud = () => ({ set() {}, hide() {}, done() {}, fail() {}, page: null });

test("a source's job: its id (the bundleIdentifier) and version go along", () => {
  assert.deepEqual(siteInstallArgs({ id: "com.a.delta", name: "Delta", version: "1.2", url: "https://s/d.ipa" }),
    { url: "https://s/d.ipa", name: "Delta", bundleId: "com.a.delta", version: "1.2" });
  assert.deepEqual(siteInstallArgs({ id: "x", bundleId: "com.real", url: "u", installed: "3" }),
    { url: "u", name: "", bundleId: "com.real", version: "3" });
});

test("no bundle ID for a My IPAs job or one with a Sign Options bundle ID", () => {
  assert.deepEqual(siteInstallArgs({ id: "library:A.ipa", url: "u", name: "A" }), { url: "u", name: "A" });
  assert.deepEqual(siteInstallArgs({ id: "com.edited", url: "u", name: "A", options: { edits: { bundleId: "com.edited" } } }), { url: "u", name: "A" });
  assert.deepEqual(siteInstallArgs({ id: "com.x", library: "X.ipa", url: "u", name: "X" }), { url: "u", name: "X" });
});

test("manageInstall on the website: an update carries the bundle ID and version", async () => {
  const calls = [];
  assert.equal(await manageInstall({ id: "up", name: "Up", mode: "upgrade", version: "2", url: "https://s/2.ipa" },
    { verb: "Updating", i: 1, n: 1, hud, sc: siteSc(calls) }), true);
  assert.deepEqual(calls, [{ url: "https://s/2.ipa", name: "Up", bundleId: "up", version: "2" }]);
});

test("resignApp with a url on the website: a marked app's re-sign carries them too", async () => {
  const calls = [];
  assert.equal(await resignApp({ id: "m", name: "Marked", mode: "resign", version: "2", installed: "2", url: "https://s/m2.ipa" },
    { sc: siteSc(calls) }), true);
  assert.deepEqual(calls, [{ url: "https://s/m2.ipa", name: "Marked", bundleId: "m", version: "2" }]);
});
