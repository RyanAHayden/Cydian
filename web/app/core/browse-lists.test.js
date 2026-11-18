// F124: Browse's lists: New and Recently Updated (from the Changes records and the sources' dates), Free Apps /
// Tweaks / Themes, Featured, and which lists each device type gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, runCatalog, freshLists, freeKind, BROWSE_LISTS, browseListsFor, browseList, FRESH_DAYS, ALL } from "./catalog.js";
import { newRecords } from "./changes.js";

const stanza = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const packages = (...list) => list.map(stanza).join("\n\n") + "\n";
const ids = (rows) => rows.map((r) => r.id);
const deb = (id, section, extra = {}) => ({ Package: id, Name: id, Version: "1", Architecture: "iphoneos-arm64", Section: section, ...extra });
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 18, 12);

test("BROWSE_LISTS: Cydia-style lists in order; Not Jailbroken drops Free Tweaks and Free Themes", () => {
  assert.deepEqual(BROWSE_LISTS.map((l) => l.title), ["New", "Recently Updated", "Popular", "Featured", "Free Apps", "Free Tweaks", "Free Themes"]);
  assert.deepEqual(browseListsFor(false).map((l) => l.id), ["new", "updated", "popular", "featured", "free-apps"]);
  assert.equal(browseListsFor(true).length, 7);
  assert.equal(browseList("free-tweaks").free, "tweaks");
  assert.equal(browseList("nope"), null);
});

test("freshLists: the first refresh is the archive; later ones file new packages and updates, newest first", () => {
  const rows = [
    { id: "a", name: "A", version: "1" }, { id: "b", name: "B", version: "2" }, { id: "c", name: "C", version: "1" },
    { id: "d", name: "D", version: "1" }, { id: "e", name: "E", version: "3" }, { id: "old", name: "Old", version: "1" },
  ];
  const first = NOW - 40 * DAY;
  let recs = newRecords(new Set(), [["S", "a", "1"], ["S", "b", "1"], ["S", "old", "1"], ["S", "e", "2"]], first);
  // two days ago: c arrives, b is bumped; yesterday: d arrives; today: e is bumped
  const more = (list, t) => { const known = new Set(recs.map((r) => r.k)); recs = recs.concat(newRecords(known, list, t)); };
  more([["S", "c", "1"], ["S", "b", "2"]], NOW - 2 * DAY);
  more([["S", "d", "1"]], NOW - DAY);
  more([["S", "e", "3"]], NOW - 1000);
  const f = freshLists(recs, rows, { now: NOW });
  assert.deepEqual(ids(f.new), ["d", "c"], "new: newest first; the archive (a, old) is not new");
  assert.deepEqual(ids(f.updated), ["e", "b"]);
  assert.equal(f.new[0].change, "new");
  assert.equal(f.updated[0].seen, NOW - 1000);
  // the window: only the last FRESH_DAYS days
  assert.deepEqual(ids(freshLists(recs, rows, { now: NOW + (FRESH_DAYS - 1) * DAY }).new), ["d"]);
  assert.deepEqual(ids(freshLists(recs, rows, { now: NOW, limit: 1 }).updated), ["e"]);
  // a row whose candidate isn't recorded yet (the next refresh files it) is in neither list
  assert.deepEqual(ids(freshLists(recs, [{ id: "d", version: "9" }], { now: NOW }).new), []);
});

test("freshLists: sources' own dates count, even on the first load; a future date counts as now", () => {
  const recs = newRecords(new Set(), [
    ["alt:x", "app.new", "1.0", NOW - 3 * DAY],
    ["alt:x", "app.upd", "1.0", NOW - 300 * DAY], ["alt:x", "app.upd", "1.1", NOW - 5 * DAY],
    ["alt:x", "app.future", "1", NOW + 9 * DAY],
    ["alt:x", "app.ancient", "1", NOW - 400 * DAY],
    ["S", "deb.archive", "1"],
  ], NOW);
  const rows = ["app.ancient", "app.future", "app.new", "app.upd", "deb.archive"].map((id) => ({ id, version: id === "app.upd" ? "1.1" : id === "app.new" ? "1.0" : "1" }));
  const f = freshLists(recs, rows, { now: NOW });
  assert.deepEqual(ids(f.new), ["app.future", "app.new"]);
  assert.equal(f.new[0].seen, NOW);
  assert.deepEqual(ids(f.updated), ["app.upd"]);
  // rows keep their order on a tie
  const tie = newRecords(new Set(), [["alt:x", "z", "1", NOW - DAY], ["alt:x", "y", "1", NOW - DAY]], NOW);
  assert.deepEqual(ids(freshLists(tie, [{ id: "y", version: "1" }, { id: "z", version: "1" }], { now: NOW }).new), ["y", "z"]);
});

test("freeKind: apps, tweaks and themes", () => {
  assert.equal(freeKind({ kind: "ipa", section: "Apps (Games)" }), "apps");
  assert.equal(freeKind({ section: "Applications" }), "apps");
  assert.equal(freeKind({ section: "Tweaks" }), "tweaks");
  assert.equal(freeKind({ section: "Addons (SBSettings)" }), "tweaks");
  assert.equal(freeKind({ section: "Themes (SpringBoard)" }), "themes");
  assert.equal(freeKind({ section: "Libraries" }), null);
});

const REPO_A = packages(
  deb("com.x.tweak", "Tweaks", { Name: "Zeta Tweak" }),
  deb("com.x.paid", "Tweaks", { Name: "Paid Tweak", Tag: "cydia::commercial" }),
  deb("com.x.atweak", "Tweaks", { Name: "Alpha Tweak" }),
  deb("com.x.theme", "Themes_(SpringBoard)", { Name: "A Theme" }),
  deb("com.x.app", "Applications", { Name: "Deb App" }),
  deb("com.x.lib", "Libraries", { Name: "libthing" }),
);
const REPO_B = packages(deb("com.x.tweak", "Tweaks", { Name: "Zeta Tweak", Version: "2" }));
const ALT_KEY = "alt:https://apps.example/source.json";
const ALT_JSON = JSON.stringify({
  name: "Apps", identifier: "com.example.apps", featuredApps: ["com.example.chat"],
  apps: [
    { name: "Chat", bundleIdentifier: "com.example.chat", developerName: "R", category: "social",
      localizedDescription: "talk", versions: [{ version: "2", date: "2026-06-01", downloadURL: "https://apps.example/c.ipa", size: 1 }] },
    { name: "Board", bundleIdentifier: "com.example.board", developerName: "R", category: "games",
      localizedDescription: "play", versions: [{ version: "1", date: "2026-01-01", downloadURL: "https://apps.example/b.ipa", size: 1 }] },
  ],
});
function loaded() {
  const c = createCatalog();
  c.load("A", REPO_A, "https://a.example/");
  c.load("B", REPO_B, "https://b.example/");
  c.loadAlt(ALT_KEY, ALT_JSON, "16.5");
  return c;
}

test("catalog.free: free rows of the kind, by name; paid ones out; Tweaks and Themes empty while Not Jailbroken", () => {
  const c = loaded();
  assert.deepEqual(ids(c.free("tweaks")), ["com.x.atweak", "com.x.tweak"], "by name: Alpha before Zeta; Paid Tweak out");
  assert.equal(c.free("tweaks")[1].version, "2", "the newest version across sources");
  assert.deepEqual(ids(c.free("themes")), ["com.x.theme"]);
  assert.deepEqual(ids(c.free("apps")), ["com.example.board", "com.example.chat", "com.x.app"]);
  assert.deepEqual(ids(c.free("nonsense")), []);
  c.setHidden(["Tweaks"]);
  assert.deepEqual(ids(c.free("tweaks")), [], "Section Visibility hides them here too");
  assert.deepEqual(ids(runCatalog(c, "free", ["themes"])), ["com.x.theme"]);
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.deepEqual(ids(c.free("themes")), []);
  assert.deepEqual(ids(c.free("apps")), ["com.example.board", "com.example.chat"], "apps only: APT sources don't count");
});

test("catalog.featured: refs in order, each package once, the source's own version, unknown and hidden ones out", () => {
  const c = loaded();
  const rows = c.featured([
    { key: "A", id: "com.x.tweak" }, { key: "B", id: "com.x.tweak" }, { key: "A", id: "com.x.missing" },
    { key: "A", id: "com.x.theme" }, { key: ALT_KEY, id: "com.example.chat" }, { key: "gone", id: "com.x.app" }, null, { key: "A" },
  ]);
  assert.deepEqual(ids(rows), ["com.x.tweak", "com.x.theme", "com.example.chat", "com.x.app"]);
  assert.equal(rows[0].version, "1", "the banner's own source's version");
  assert.equal(rows[3].key, "A", "a source that isn't loaded: All Sources' row");
  assert.deepEqual(c.featured(), []);
  c.setHidden(["Themes (SpringBoard)"]);
  assert.deepEqual(ids(c.featured([{ key: "A", id: "com.x.theme" }])), []);
  c.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.deepEqual(ids(runCatalog(c, "featured", [[{ key: "A", id: "com.x.tweak" }, { key: ALT_KEY, id: "com.example.chat" }]])), ["com.example.chat"]);
  assert.equal(ALL, "*");
});

test("New over a real catalog: an AltStore app's dated version is new, a mirrored deb isn't new twice", () => {
  const c = loaded();
  const t0 = NOW - 10 * DAY;
  let recs = newRecords(new Set(), c.versions().filter(([k]) => k !== "B"), t0);
  c.load("C", packages(deb("com.y.fresh", "Tweaks", { Name: "Fresh" })), "https://c.example/");
  recs = recs.concat(newRecords(new Set(recs.map((r) => r.k)), c.versions(), NOW - DAY));
  const f = freshLists(recs, c.list(ALL, ALL), { now: NOW });
  // Chat's version is dated 2026-06-01: more than 30 days back, so out; Fresh came yesterday
  assert.deepEqual(ids(f.new), ["com.y.fresh"]);
  assert.deepEqual(ids(f.updated), ["com.x.tweak"], "B's version 2 showed up after the first refresh");
});
