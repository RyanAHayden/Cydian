import { test } from "node:test";
import assert from "node:assert/strict";
import { pageKind, recordsApps, appSubtitle, appListRows, DPKG, APPS } from "./installed.js";

const r = (...path) => ({ tab: "installed", path });

test("installed tab: apps list without a jailbreak, dpkg in the jailbreak app (F30)", () => {
  assert.equal(recordsApps("site"), true);
  assert.equal(recordsApps("sideload"), true);
  assert.equal(recordsApps("jailbreak"), false);
  assert.equal(pageKind(r(), "site"), "apps");
  assert.equal(pageKind(r(), "sideload"), "apps");
  assert.equal(pageKind(r(), "jailbreak"), "dpkg");
  assert.equal(pageKind(r(DPKG), "site"), "dpkg"); // the upload stays on the site for jailbroken phones
  assert.equal(pageKind(r(DPKG), "sideload"), "browse");
  assert.equal(pageKind(r(DPKG, "package:x"), "site"), "browse");
  assert.equal(pageKind(r("package:x"), "jailbreak"), "browse");
});

test("installed tab: an app row says the upgrade, the source and the date", () => {
  const date = Date.UTC(2026, 10, 17, 12);
  assert.equal(appSubtitle({ sourceName: "AltStore", date, upgrade: "1.6" }, "en-US"), "Upgrade to 1.6 · AltStore · Nov 17, 2026");
  assert.equal(appSubtitle({ source: "https://a.example/apps.json", date: 0, upgrade: null }, "en-US"), "https://a.example/apps.json");
});

test("installed tab: My IPAs pages without a jailbreak (F77)", async () => {
  assert.equal(pageKind(r("myipas"), "sideload"), "myipas");
  assert.equal(pageKind(r("myipas", "ipa:A.ipa"), "site"), "myipas");
  assert.equal(pageKind(r("myipas"), "jailbreak"), "browse");
  const { myIpasRow } = await import("./installed.js");
  assert.equal(myIpasRow(r(), false).href, "#/installed/myipas");
  assert.equal(myIpasRow(r(), false).label, "Install IPAs"); // F79: the page is Install IPAs now
});

test("F87: the jailbreak app's Apps page: the phone's versions, I4's notes, no upgrade for an app that's gone", () => {
  assert.equal(pageKind(r(APPS), "jailbreak"), "apps");
  assert.equal(pageKind(r(APPS, "package:x"), "jailbreak"), "browse");
  assert.equal(pageKind(r(APPS), "sideload"), "browse"); // the list is the root there
  assert.equal(appSubtitle({ note: "Installed: 1.6 (Cydian remembered 1.5)", sourceName: "AltStore", date: 0, upgrade: "1.7" }),
    "Installed: 1.6 (Cydian remembered 1.5) · Upgrade to 1.7 · AltStore");
  const rows = appListRows([
    { id: "delta", name: "Delta", version: "1.6", actual: "1.6", remembered: "1.5", date: 2 },
    { id: "gone", name: "Gone", version: "2.0", actual: null, remembered: "2.0", date: 1 },
    { id: "plain", name: "Plain", version: "1.0", date: 3 }, // site/sideload record, no I4 fields
  ], () => ({ version: "9" }));
  assert.deepEqual(rows.map((x) => [x.id, x.upgrade]), [["plain", "9"], ["delta", "9"], ["gone", null]]);
});

// ---- F104: Installed sort, Hide by Author ----------------------------------------------------------------------
import { sortScopes, sortInstalled, sortDetail, installDates } from "./installed.js";
import { createCatalog, installedBytes } from "../core/catalog.js";
import { createSettings } from "../core/settings.js";

test("F104: the scope bar is Name, Recent, Size; no Recent without install dates", () => {
  assert.deepEqual(sortScopes(true), ["name", "recent", "size"]);
  assert.deepEqual(sortScopes(false), ["name", "size"]);
});

test("F104: Recent sorts newest install first, Size largest first; unknowns last, by name", () => {
  const rows = [{ id: "a", name: "A", size: 2048 }, { id: "b", name: "B", size: null }, { id: "c", name: "C", size: 10240 },
    { id: "d", name: "D", size: 2048 }];
  assert.equal(sortInstalled(rows, "name"), rows);
  assert.deepEqual(sortInstalled(rows, "size").map((r) => r.id), ["c", "a", "d", "b"]);
  assert.deepEqual(sortInstalled(rows, "recent", { b: 300, d: 100, a: 300 }).map((r) => r.id), ["a", "b", "d", "c"]);
  assert.deepEqual(sortInstalled(rows, "recent", null).map((r) => r.id), ["a", "b", "c", "d"]);
  assert.equal(sortDetail(rows[2], "size"), "10 kB");
  assert.equal(sortDetail(rows[1], "size"), null);
  assert.equal(sortDetail(rows[0], "recent", { a: Date.UTC(2026, 10, 17, 12) / 1000 }, "en-US"), "Nov 17, 2026");
  assert.equal(sortDetail(rows[0], "recent", {}), null);
});

test("F104: install dates come from the jailbreak app's apt.installDates, else none", async () => {
  const native = { dpkgStatus: () => "", call: async (m) => (m === "apt.installDates" ? { a: 5 } : null) };
  assert.deepEqual(await installDates(native), { a: 5 });
  assert.equal(await installDates({ ...native, call: async () => ({}) }), null); // nothing read
  assert.equal(await installDates({ ...native, call: async () => { throw new Error("unknown method"); } }), null); // older shell
  assert.equal(await installDates({ call: native.call }), null); // the sideload build: no dpkg
  assert.equal(await installDates(undefined), null);
});

test("F104: installed rows carry Installed-Size in bytes", () => {
  assert.equal(installedBytes({ "installed-size": "12" }), 12288);
  assert.equal(installedBytes({ "installed-size": "x" }), null);
  assert.equal(installedBytes({}), null);
  const c = createCatalog();
  c.setInstalled("Package: a\nStatus: install ok installed\nVersion: 1\nInstalled-Size: 3\nName: A\n\n" +
    "Package: b\nStatus: install ok installed\nVersion: 1\nName: B\n");
  assert.deepEqual(c.installed().map((r) => [r.id, r.size]), [["a", 3072], ["b", null]]);
});

test("F104: a hidden author's packages leave lists, sections and Search but stay on the author page", () => {
  const c = createCatalog();
  c.load("deb:x", [
    "Package: one\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: One\nAuthor: Jane Doe <j@x>\nDescription: tweak one\n",
    "Package: two\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: Two\nMaintainer: jane doe <j@x>\nDescription: tweak two\n",
    "Package: three\nVersion: 1\nArchitecture: iphoneos-arm64\nSection: Tweaks\nName: Three\nAuthor: Sam <s@x>\nDescription: tweak three\n",
  ].join("\n"), null, "iphoneos-arm64");
  assert.equal(c.list().length, 3);
  assert.equal(c.setHiddenAuthors(["Jane Doe", "", 5]), 1);
  assert.deepEqual(c.list().map((r) => r.id), ["three"]);
  assert.deepEqual(c.sections().sections, [{ name: "Tweaks", count: 1 }]);
  assert.equal(c.sections().total, 1);
  assert.deepEqual(c.search("tweak").map((r) => r.id), ["three"]);
  assert.deepEqual(c.author("Jane Doe").map((r) => r.id).sort(), ["one", "two"]);
  c.setHidden(["Tweaks"]);
  assert.deepEqual(c.author("Jane Doe"), []); // a hidden section still wins
  c.setHidden([]);
  c.setHiddenAuthors([]);
  assert.equal(c.list().length, 3);
});

test("F104: settings keep hidden authors, one per name whatever its case", () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const s = createSettings({ storage });
  const heard = [];
  s.onChange((k, v) => { if (k === "hiddenAuthors") heard.push(v); });
  s.hiddenAuthors.set("Jane Doe", true);
  s.hiddenAuthors.set("jane doe", true);
  assert.deepEqual(s.hiddenAuthors.list(), ["jane doe"]);
  assert.equal(s.hiddenAuthors.has("JANE DOE"), true);
  s.hiddenAuthors.set("Sam", true);
  s.hiddenAuthors.set("JANE doe", false);
  assert.deepEqual(s.hiddenAuthors.list(), ["Sam"]);
  assert.deepEqual(heard.at(-1), ["Sam"]);
});

test("F104: the fake shell's apt.installDates reads info/<pkg>[:arch].list mtimes, as Apt.swift does", async () => {
  const { createFakeNative, makeFixture } = await import("../../../native/fake/fake-native.mjs");
  const { mkdirSync, writeFileSync, utimesSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fx = makeFixture();
  try {
    const info = join(fx.prefix, "var/lib/dpkg/info");
    mkdirSync(info, { recursive: true });
    for (const [name, t] of [["a.list", 1000], ["b:iphoneos-arm64.list", 2000], ["a.md5sums", 9000]]) {
      writeFileSync(join(info, name), "");
      utimesSync(join(info, name), t, t);
    }
    const native = createFakeNative({ prefix: fx.prefix, remote: fx.remote });
    assert.deepEqual(await installDates(native), { a: 1000, b: 2000 });
  } finally { fx.cleanup(); }
});

test("F104: Hide Packages by <author> on the author page, Hidden in Manage", async () => {
  const { authorToggleRow } = await import("./browse.js");
  const { hiddenRow, hiddenGroups } = await import("./manage.js");
  assert.equal(authorToggleRow("Jane", false).label, "Hide Packages by Jane");
  assert.equal(authorToggleRow("Jane", true).label, "Show Packages by Jane");
  assert.deepEqual(hiddenRow(["Themes"], ["Jane"]), { label: "Hidden", detail: "2", href: "#/sources/manage/hidden" });
  assert.equal(hiddenRow([], []).detail, undefined);
  assert.deepEqual(hiddenGroups(["Themes"], ["Jane"]).map((g) => [g.header, g.items.map((i) => i.kind + ":" + i.name)]),
    [["Sections", ["section:Themes"]], ["Authors", ["author:Jane"]]]);
  assert.deepEqual(hiddenGroups([], []), []);
});
