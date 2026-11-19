// B71: the jailbreak build's row swipe (and hold menu) on every queueable row: AltStore app rows install the way the
// jailbreak build installs an IPA (no app queue there), and iFizBox's own row never offers Remove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowSwipeAction, rowMenuItems, jailbreakAppRowState } from "./browse.js";
import { PACKAGE } from "../brand.js";

const KEY = "alt:https://s/";
const job = { id: "com.x.app", name: "App", version: "2.0", installed: null, url: "https://s/app.ipa" };
const app = { id: "com.x.app", name: "App", version: "2.0", key: KEY, kind: "ipa" };

test("an app row in the jailbreak build swipes to Install, Upgrade or Remove", () => {
  assert.deepEqual(rowSwipeAction(app, { jbApps: true, job, installed: null, newest: "2.0" }),
    { kind: "add", label: "Install", job: { app: "install", ...job } });
  assert.deepEqual(rowSwipeAction(app, { jbApps: true, job, installed: "1.0", newest: "2.0" }),
    { kind: "add", label: "Upgrade", job: { app: "install", ...job } });
  assert.deepEqual(rowSwipeAction(app, { jbApps: true, job, installed: "2.0", newest: "2.0" }),
    { kind: "remove", label: "Remove", job: { app: "remove", id: "com.x.app", name: "App" } });
  // Installed but no IPA a source can download: still removable; not installed and nothing to download: nothing.
  assert.equal(rowSwipeAction(app, { jbApps: true, job: null, installed: "2.0", newest: "2.0", id: "com.x.app" }).label, "Remove");
  assert.equal(rowSwipeAction(app, { jbApps: true, job: null, installed: null, newest: "2.0" }), null);
  // Tweaks keep apt's states beside it.
  assert.equal(rowSwipeAction({ ...app, kind: undefined }, { queue: true, jbApps: true, newest: "2.0" }).label, "Install");
});

test("the hold menu lists the same app item", () => {
  assert.deepEqual(rowMenuItems(app, { jbApps: true, job, installed: "1.0", newest: "2.0" }).map((i) => i.label),
    ["Upgrade", "Share", "Source"]);
});

test("iFizBox's own row never swipes or holds to Remove: Upgrade, Reinstall, or nothing", () => {
  const self = { id: PACKAGE, name: "iFizBox", version: "1.0", key: "k" };
  assert.deepEqual(rowSwipeAction(self, { queue: true, installed: "1.0", newest: "1.0" }),
    { kind: "add", label: "Reinstall", job: { op: "install", id: PACKAGE, version: "1.0" } });
  assert.equal(rowSwipeAction(self, { queue: true, installed: "0.9", newest: "1.0" }).label, "Upgrade");
  assert.equal(rowSwipeAction(self, { queue: true, installed: "1.0", newest: null }), null);
  assert.equal(rowSwipeAction(self, { queue: true, installed: "1.1", newest: "1.0" }), null);
  assert.ok(!rowMenuItems(self, { queue: true, installed: "1.0", newest: "1.0" }).some((i) => i.label === "Remove"));
  // Queued already: Cancel still takes it out.
  assert.equal(rowSwipeAction(self, { queue: true, installed: "1.0", newest: "1.0", queued: true }).kind, "cancel");
});

const pkg = (versions) => ({ key: KEY, row: { id: "com.x.app", name: "App" },
  stanza: { ipa: { bundleIdentifier: "com.x.app", name: "App", sourceUrl: "https://s/", versions } } });

test("an app row's jailbreak state: the apps store's record, the source's newest, the IPA install job", () => {
  const p = pkg([{ version: "2.0", downloadURL: "https://s/app.ipa" }, { version: "1.0", downloadURL: "https://s/old.ipa" }]);
  const st = jailbreakAppRowState(app, { pkg: p, rec: { id: "com.x.app", version: "1.0" } });
  assert.equal(st.installed, "1.0");
  assert.equal(st.newest, "2.0");
  assert.equal(st.id, "com.x.app");
  assert.equal(st.job.url, "https://s/app.ipa");
  assert.equal(st.job.installed, "1.0");
  assert.equal(jailbreakAppRowState(app, { pkg: p, rec: null }).installed, null);
  // Changes' remembered upgrade row: its installed version, and its IPA when the catalog has no package for it.
  const row = { id: "com.y", name: "Y", kind: "ipa", version: "3.0", installed: "2.0", remembered: true, ipa: "https://s/y.ipa" };
  const r = jailbreakAppRowState(row, { pkg: null, rec: null });
  assert.equal(r.installed, "2.0");
  assert.equal(r.newest, "3.0");
  assert.equal(r.job.url, "https://s/y.ipa");
  assert.equal(r.job.id, "com.y");
  // A source-signed link (itms-services) is nothing the helper can install.
  const itms = pkg([{ version: "2.0", downloadURL: "itms-services://?action=download-manifest&url=https://s/m.plist" }]);
  assert.equal(jailbreakAppRowState(app, { pkg: itms, rec: null }).job, null);
});
