// I4: real installed-app versions in jailbreak mode, against the fake bridge and the fake helper's app-versions over
// a fake app-container tree (<UUID>/<Name>.app/Info.plist, iTunesMetadata.plist), as the real helper reads
// /var/containers/Bundle/Application. The C helper's own reading is native/helper/test_appversions.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeBackend, parseAppVersions, withRealVersions } from "./backend-native.js";
import { createQueue } from "./core/queue.js";
import { createFakeNative, makeFixture } from "../../native/fake/fake-native.mjs";
import { fakeIndexedDB } from "../../native/fake/fake-indexeddb.mjs";

const plist = (values) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${
  Object.entries(values).map(([k, v]) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`).join("")}</dict>\n</plist>\n`;

function containers(t) {
  const dir = mkdtempSync(join(tmpdir(), "ifizbox-apps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = (uuid, name, info, meta) => {
    mkdirSync(join(dir, uuid, name), { recursive: true });
    writeFileSync(join(dir, uuid, name, "Info.plist"), plist(info));
    if (meta) writeFileSync(join(dir, uuid, "iTunesMetadata.plist"), plist(meta));
  };
  app("0A1B", "Delta.app", { CFBundleIdentifier: "com.rileytestut.Delta", CFBundleShortVersionString: "1.6", CFBundleVersion: "45" });
  app("2C3D", "UTM.app", { CFBundleIdentifier: "com.utmapp.UTM", CFBundleShortVersionString: "4.5.2", CFBundleVersion: "98" });
  app("4E5F", "Pages.app", { CFBundleIdentifier: "com.apple.Pages", CFBundleShortVersionString: "14.0", CFBundleVersion: "7032" },
    { bundleShortVersionString: "14.0" });
  return dir;
}

function setup(t, { mode = "jailbreak", helper, apps } = {}) {
  const fx = makeFixture();
  t.after(fx.cleanup);
  const env = apps ? { IFIZBOX_APPS_DIR: apps } : {};
  const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote, net: null, env, ...(helper ? { helper } : {}) });
  const backend = createNativeBackend({ native, sourceOptions: { indexedDB: fakeIndexedDB(), mode, queue: createQueue() } });
  return { native, backend };
}

const records = [
  { id: "com.ryha.ifizbox", name: "iFizBox", version: "0.2.8", self: true },
  { id: "com.rileytestut.Delta", name: "Delta", version: "1.5", key: "altstore:x" }, // updated outside iFizBox
  { id: "com.utmapp.UTM", name: "UTM", version: "4.5.2" }, // as remembered
  { id: "com.example.gone", name: "Gone", version: "2.0" }, // deleted from the Home Screen
];

test("appVersions: every app in the containers, through ifizbox-helper app-versions", async (t) => {
  const { backend, native } = setup(t, { apps: containers(t) });
  const list = await backend.appVersions();
  assert.deepEqual(native.calls.at(-1).params.words, ["app-versions"]);
  assert.deepEqual(list.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "com.apple.Pages", version: "14.0", build: "7032", store: "14.0" },
    { id: "com.rileytestut.Delta", version: "1.6", build: "45", store: null },
    { id: "com.utmapp.UTM", version: "4.5.2", build: "98", store: null },
  ]);
});

test("installedApps: the real version replaces the remembered one, with a note where they disagree", async (t) => {
  const { backend } = setup(t, { apps: containers(t) });
  const [self, delta, utm, gone] = await backend.installedApps(records);
  assert.deepEqual(self, records[0]); // iFizBox itself is dpkg's in jailbreak mode
  assert.equal(delta.version, "1.6");
  assert.equal(delta.remembered, "1.5");
  assert.equal(delta.disagrees, true);
  assert.equal(delta.note, "Installed: 1.6 (iFizBox remembered 1.5)");
  assert.equal(delta.key, "altstore:x"); // the rest of the record kept
  assert.deepEqual({ v: utm.version, d: utm.disagrees, n: utm.note }, { v: "4.5.2", d: false, n: null });
  assert.equal(gone.actual, null);
  assert.equal(gone.version, "2.0");
  assert.equal(gone.note, "Not installed (iFizBox remembered 2.0)");
});

test("no containers folder: nothing installed, every remembered app says so", async (t) => {
  const { backend } = setup(t, { apps: "/nonexistent/containers" });
  assert.deepEqual(await backend.appVersions(), []);
  const notes = (await backend.installedApps(records)).slice(1).map((r) => r.note);
  assert.deepEqual(notes, ["Not installed (iFizBox remembered 1.5)", "Not installed (iFizBox remembered 4.5.2)",
    "Not installed (iFizBox remembered 2.0)"]);
});

test("no helper keeps the remembered versions; the sideload build has no app-versions at all", async (t) => {
  const { backend } = setup(t, { helper: "/nonexistent/ifizbox-helper", apps: containers(t) });
  assert.equal(await backend.appVersions(), null);
  assert.deepEqual(await backend.installedApps(records), records);
  const side = setup(t, { mode: "sideload" }).backend;
  assert.equal(typeof side.appVersions, "undefined");
  assert.equal(typeof side.installedApps, "undefined");
});

test("parseAppVersions: fallbacks, odd lines, each id once", () => {
  assert.deepEqual(parseAppVersions("a.b\t\t12\t\nc.d\t\t\t3.1\ne.f\t\t\t\nbad id\t1\t\t\na.b\t9\t\t\r\n\ng.h\t2.0\t\t\r\n"), [
    { id: "a.b", version: "12", build: "12", store: null },
    { id: "c.d", version: "3.1", build: null, store: "3.1" },
    { id: "g.h", version: "2.0", build: null, store: null },
  ]);
  assert.deepEqual(parseAppVersions(null), []);
});

test("withRealVersions: a remembered build number or store version is not a disagreement", () => {
  const actual = [{ id: "x", version: "2.1", build: "210", store: "2.1.0" }];
  for (const v of ["2.1", "210", "2.1.0"]) assert.equal(withRealVersions([{ id: "x", version: v }], actual)[0].disagrees, false, v);
  assert.equal(withRealVersions([{ id: "x", version: "2.0" }], actual)[0].disagrees, true);
  assert.equal(withRealVersions([{ id: "x" }], actual)[0].disagrees, false); // nothing remembered: nothing to disagree with
  assert.deepEqual(withRealVersions(records, null), records);
});
