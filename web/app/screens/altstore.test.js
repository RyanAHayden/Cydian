// B232: the app page's Installed section, Change Installed Version (screens/altstore.js installWhichVersion): an
// "Install Which Version?" sheet of the source's versions, newest first, the installed one marked and not installable
// from there; a pick installs that version (sideload: queued as Version History does; site: signed in the browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installWhichButtons, installWhichVersion, INSTALL_WHICH_TITLE, MARK_WHICH_TITLE } from "./altstore.js";

const APP = { bundleIdentifier: "com.x.a", name: "A", sourceUrl: "https://s/apps.json",
  versions: [{ version: "2.0", downloadURL: "https://s/a20.ipa" }, { version: "2.1", downloadURL: "https://s/a21.ipa" },
    { version: "" }, { version: "1.9", downloadURL: "https://s/a19.ipa" }] };
const PKG = { key: "alt:https://s/apps.json", row: { id: "com.x.a" }, stanza: { kind: "ipa", ipa: APP } };

test("titles: the install sheet asks what to install, Mark as Installed's picker what was installed", () => {
  assert.equal(INSTALL_WHICH_TITLE, "Install Which Version?");
  assert.equal(MARK_WHICH_TITLE, "Which Version Did You Install?");
});

test("installWhichButtons: newest first, the installed one marked with nothing to install, numberless ones left out", () => {
  const { buttons, versions } = installWhichButtons(APP, "2.0");
  assert.deepEqual(buttons, ["2.1", "2.0 (Installed)", "1.9"]);
  assert.deepEqual(versions.map((v) => v?.version ?? null), ["2.1", null, "1.9"]);
  // an installed version the source no longer lists: every one installable
  assert.deepEqual(installWhichButtons(APP, "1.0").buttons, ["2.1", "2.0", "1.9"]);
  assert.deepEqual(installWhichButtons({ versions: [] }, "1").buttons, []);
});

test("installWhichButtons: as Version History, no version without a download or that this iOS can't run", () => {
  const app = { versions: [{ version: "3.0", downloadURL: "https://s/a3.ipa", minOSVersion: "28.0" }, { version: "2.5" },
    { version: "2.1", downloadURL: "https://s/a21.ipa" }, { version: "2.0", downloadURL: "https://s/a20.ipa" }] };
  assert.deepEqual(installWhichButtons(app, "2.0", "27.0").buttons, ["2.1", "2.0 (Installed)"]);
  // the installed one stays listed (marked) even when it couldn't be installed from here
  assert.deepEqual(installWhichButtons(app, "2.5", "27.0").buttons, ["2.5 (Installed)", "2.1", "2.0"]);
});

test("installWhichVersion (sideload): nothing queued (no job, not ready): the install row runs instead", async () => {
  const r = rig((b) => b.indexOf("2.0"), "sideload");
  r.opts.queueVersion = async (v) => { r.queued.push(v.version); return false; };
  assert.equal((await installWhichVersion(APP, PKG, null, r.opts)).version, "2.0");
  assert.deepEqual(r.queued, ["2.0"]);
  assert.deepEqual(r.signed, ["2.0"]);
});

test("installWhichVersion: only the installed one to offer: no sheet", async () => {
  const r = rig(() => 0, "sideload");
  assert.equal(await installWhichVersion({ versions: [{ version: "1", downloadURL: "https://s/1.ipa" }] }, PKG, null, { ...r.opts, installed: "1" }), null);
  assert.equal(r.asked.length, 0);
});

function rig(pick, mode) {
  const asked = [], queued = [], signed = [];
  const opts = { installed: "2.1", mode, ios: null, ask: async (o) => { asked.push(o); return pick(o.buttons); },
    queueVersion: async (v) => { queued.push(v.version); return true; }, siteInstall: async (v) => { signed.push(v.version); } };
  return { asked, queued, signed, opts };
}

test("installWhichVersion (sideload): a downgrade pick queues that version, as Version History does", async () => {
  const r = rig((b) => b.indexOf("1.9"), "sideload");
  const v = await installWhichVersion(APP, PKG, null, r.opts);
  assert.equal(v.version, "1.9");
  assert.equal(r.asked[0].title, INSTALL_WHICH_TITLE);
  assert.deepEqual(r.asked[0].buttons, ["2.1 (Installed)", "2.0", "1.9"]);
  assert.deepEqual(r.queued, ["1.9"]);
  assert.deepEqual(r.signed, []);
});

test("installWhichVersion (site): a pick signs that version in the browser", async () => {
  const r = rig((b) => b.indexOf("2.0"), "site");
  assert.equal((await installWhichVersion(APP, PKG, null, r.opts)).version, "2.0");
  assert.deepEqual(r.signed, ["2.0"]);
  assert.deepEqual(r.queued, []);
});

test("installWhichVersion: the installed row and Cancel install nothing; the jailbreak app never installs from here", async () => {
  for (const [pick, mode] of [[(b) => b.indexOf("2.1 (Installed)"), "sideload"], [() => -1, "site"], [(b) => b.indexOf("2.0"), "jailbreak"]]) {
    const r = rig(pick, mode);
    assert.equal(await installWhichVersion(APP, PKG, null, r.opts), null);
    assert.deepEqual([...r.queued, ...r.signed], []);
  }
});
