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
import { installDates } from "./installed.js";
import { createCatalog, installedBytes } from "../core/catalog.js";
import { createSettings } from "../core/settings.js";

// F127 replaced F104's Name/Recent/Size bar with Cydia's User | Expert | Recent (tests at the end of this file).

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

// ---- F125: the Wish List in Installed ----------------------------------------------------------------------------
import { WISH, wishListRow } from "./installed.js";
import { wishCount, createWishlist } from "../core/wishlist.js";

test("F125: #installed/wishlist is the Wish List page in every mode; its package pages are browse.js's", () => {
  for (const mode of ["site", "sideload", "jailbreak"]) {
    assert.equal(pageKind(r(WISH), mode), "wishlist");
    assert.equal(pageKind(r(WISH, "package:x"), mode), "browse");
  }
  assert.equal(pageKind(r(), "jailbreak"), "dpkg"); // the root is unchanged
  assert.equal(pageKind(r(), "site"), "apps");
});

test("F125: Installed's Wish List row opens the page and counts the wished packages not installed", () => {
  const row = wishListRow(r(), 3);
  assert.equal(row.label, "Wish List");
  assert.equal(row.href, "#/installed/wishlist");
  assert.equal(row.badge, "3");
  assert.equal(wishListRow(r(), 0).badge, undefined); // no badge for an empty list
  assert.equal(wishListRow(r(APPS), 1).href, "#/installed/wishlist"); // the page sits under the root whatever page draws it
  assert.equal(wishCount(["a", "b", "c"], ["b"]), 2);
  assert.equal(wishCount(["a", "a"], []), 1);
  assert.equal(wishCount([], ["x"]), 0);
});

test("F125: the page's Delete takes a package off the list, and the count follows", () => {
  const w = createWishlist({ storage: null });
  const seen = [];
  w.onChange((list) => seen.push(list.length));
  w.set("a", true); w.set("b", true);
  assert.equal(wishListRow(r(), wishCount(w.list(), [])).badge, "2");
  w.set("a", false); // what removeWish does
  assert.deepEqual(w.list(), ["b"]);
  assert.deepEqual(seen, [1, 2, 1], "each change tells Installed to redraw the row and the page");
  assert.equal(wishListRow(r(), wishCount(w.list(), [])).badge, "1");
});

// ---- F127: Installed like Cydia's: User | Expert | Recent, kinds, search -----------------------------------------
import { dpkgModes, APP_MODES, dpkgItems, appSections, canReadDates } from "./installed.js";

const STATUS_F127 = [
  "Package: activator\nName: Activator\nStatus: install ok installed\nVersion: 1.9\nSection: Tweaks\nDepends: mobilesubstrate, preferenceloader\nDescription: Gestures",
  "Package: mobilesubstrate\nName: Substrate\nStatus: install ok installed\nVersion: 0.9\nSection: System\nDescription: hooks",
  "Package: preferenceloader\nName: PreferenceLoader\nStatus: install ok installed\nVersion: 2.2\nSection: Tweaks\nDescription: settings",
  "Package: bash\nStatus: install ok installed\nVersion: 5.2\nEssential: yes\nSection: Terminal Support\nDescription: shell",
  "Package: base\nStatus: install ok installed\nVersion: 1\nPriority: required\nSection: System\nDescription: base",
  "Package: zebra-theme\nName: Zebra Theme\nStatus: install ok installed\nVersion: 1\nSection: Themes\nDescription: a theme",
  "Package: myapp\nName: My App\nStatus: install ok installed\nVersion: 1\nSection: Applications\nAuthor: Jane Doe <j@x>\nDescription: an app",
  "Package: gcc\nStatus: install ok installed\nVersion: 1\nTag: role::developer\nSection: Development\nDescription: compiler",
  "Package: cydia-lproj\nStatus: install ok installed\nVersion: 1\nTag: purpose::x, role::cydia\nSection: System\nDescription: hidden",
  "Package: odd\nStatus: install ok installed\nVersion: 1\nTag: role::leaper\nSection: Tweaks\nDescription: other role",
].join("\n\n") + "\n";

function f127Rows() {
  const c = createCatalog();
  c.setInstalled(STATUS_F127);
  return c.installed();
}

test("F127: User leaves out dependencies and Essential packages; Expert lists every package Cydia would", () => {
  const rows = f127Rows();
  assert.deepEqual(dpkgItems(rows, { mode: "user" }).map((r) => r.id), ["activator", "myapp", "zebra-theme"]);
  assert.deepEqual(dpkgItems(rows, { mode: "expert" }).map((r) => r.id),
    ["activator", "base", "bash", "gcc", "myapp", "preferenceloader", "mobilesubstrate", "zebra-theme"]);
});

test("F127: Recent lists installs and upgrades newest first, in day sections, without undated packages", () => {
  const rows = f127Rows();
  const day = (d, h) => Date.UTC(2026, 10, d, h) / 1000;
  const dates = { activator: day(16, 12), gcc: day(18, 9), myapp: day(18, 11), odd: day(16, 13), "cydia-lproj": day(18, 12) };
  const items = dpkgItems(rows, { mode: "recent", dates, locale: "en-US" });
  // role::cydia never shows; role::leaper only here; undated packages drop out
  assert.deepEqual(items.map((x) => x.header ?? x.id), ["November 18, 2026", "myapp", "gcc", "November 16, 2026", "odd", "activator"]);
  assert.deepEqual(dpkgItems(rows, { mode: "recent", dates: null }), []);
});

test("F127: the kinds (Search's segments) and the search narrow any mode", () => {
  const rows = f127Rows();
  assert.deepEqual(dpkgItems(rows, { mode: "expert", type: "Tweaks" }).map((r) => r.id), ["activator", "preferenceloader"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Themes" }).map((r) => r.id), ["zebra-theme"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Apps" }).map((r) => r.id), ["myapp"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "All", query: "gest" }).map((r) => r.id), ["activator"]); // description
  assert.deepEqual(dpkgItems(rows, { mode: "user", query: "JANE" }).map((r) => r.id), ["myapp"]); // author, any case
  assert.deepEqual(dpkgItems(rows, { mode: "expert", query: "pref zzz" }).map((r) => r.id), []); // every word
  assert.deepEqual(dpkgItems(rows, { mode: "expert", query: "  substrate " }).map((r) => r.id), ["mobilesubstrate"]);
  assert.deepEqual(dpkgItems(rows, { mode: "user", type: "Tweaks", query: "zzz" }), []);
});

test("F127: Recent is offered where install dates can be read (the jailbreak app)", () => {
  assert.deepEqual(dpkgModes(true), ["user", "expert", "recent"]);
  assert.deepEqual(dpkgModes(false), ["user", "expert"]); // the site's uploaded status file has no dates
  assert.equal(canReadDates({ call() {}, dpkgStatus() {} }), true);
  assert.equal(canReadDates({ call() {} }), false); // the sideload build
  assert.equal(canReadDates(undefined), false);
  assert.deepEqual(APP_MODES, ["user", "recent"]);
});

test("F127: the apps list: User A–Z, Recent newest first by day, both searchable", () => {
  const t = (d) => Date.UTC(2026, 10, d, 12);
  const recs = [{ id: "b", name: "Beta", date: t(17), sourceName: "AltStore" }, { id: "a", name: "alpha", date: t(16) },
    { id: "c", name: "Cydian", date: 0, self: true }, { id: "d", name: "Delta", date: t(17) }];
  const shape = (secs) => secs.map((s) => [s.header, s.rows.map((r) => r.id)]);
  assert.deepEqual(shape(appSections(recs, { mode: "user" })), [["A", ["a"]], ["B", ["b"]], ["C", ["c"]], ["D", ["d"]]]);
  assert.deepEqual(shape(appSections(recs, { mode: "recent", locale: "en-US" })),
    [["November 17, 2026", ["b", "d"]], ["November 16, 2026", ["a"]], ["Cydian", ["c"]]]);
  assert.deepEqual(shape(appSections(recs, { mode: "recent", query: "ta", locale: "en-US" })), [["November 17, 2026", ["b", "d"]]]);
  assert.deepEqual(appSections(recs, { query: "nothing" }), []);
});
