import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCatalog, sectionName, simpleSection, parseAuthor, isVisible, indexLetter, NO_SECTION, ALL,
} from "./catalog.js";
import { reply } from "./worker.js";
import { createParser } from "./parser.js";

const stanza = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const packages = (...list) => list.map(stanza).join("\n\n") + "\n";
const ids = (rows) => rows.map((r) => r.id);

const REPO_A = packages(
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.0", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha\n long text about springboard",
    Filename: "debs/alpha_1.0.deb", Icon: "icons/alpha.png" },
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.2", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha", Filename: "debs/alpha_1.2.deb" },
  { Package: "com.a.rootful", Name: "Rootful Only", Version: "1", Architecture: "iphoneos-arm", Section: "Tweaks" },
  { Package: "com.a.util", Name: "beta util", Version: "2", Architecture: "all", Section: "Utility",
    Maintainer: "Sam Packager <sam@example.com>", Description: "a utility" },
  { Package: "com.a.theme", Name: "Gamma Theme", Version: "1", Architecture: "iphoneos-arm64", Section: "Themes_(Lockscreen)",
    Author: "jane dev", Description: "lock screen look" },
  { Package: "com.a.nosection", Version: "1", Architecture: "iphoneos-arm64", Description: "no section here" },
  { Package: "com.a.old", Name: "Old", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "cydia::obsolete" },
  { Package: "com.a.hidden", Name: "Hidden", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Tag: "purpose::x, role::cydia" },
);
const REPO_B = packages(
  { Package: "com.a.tweak", Name: "Alpha Tweak", Version: "1.10", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Jane Dev <jane@example.com>", Description: "makes things alpha (B)\n long text about springboard" },
  { Package: "com.b.springy", Name: "Springy", Version: "3", Architecture: "iphoneos-arm64", Section: "Tweaks",
    Author: "Other <o@example.com>", Maintainer: "Jane Dev <jane@example.com>", Description: "bouncy icons" },
);

function loaded() {
  const c = createCatalog();
  assert.equal(c.load("A", REPO_A, "https://a.example/"), 4);
  assert.equal(c.load("B", REPO_B, "https://b.example/"), 2);
  return c;
}

test("section names follow Cydia: underscores, Sections.plist fixes, (No Section)", () => {
  assert.equal(sectionName("Utility"), "Utilities");
  assert.equal(sectionName("Themes_(Lockscreen)"), "Themes (LockScreen)");
  assert.equal(sectionName("Tweaks"), "Tweaks");
  assert.equal(sectionName("Some_New Section"), "Some New Section");
  assert.equal(sectionName(""), NO_SECTION);
  assert.equal(sectionName(undefined), NO_SECTION);
  assert.equal(simpleSection("Themes (SpringBoard)"), "Themes");
  assert.equal(simpleSection("[Beta]"), "Beta");
  assert.equal(simpleSection("(No Section)"), "No Section");
});

test("authors, visibility and index letters", () => {
  assert.deepEqual(parseAuthor("Jay Freeman (saurik) <saurik@saurik.com>"), { name: "Jay Freeman (saurik)", email: "saurik@saurik.com" });
  assert.deepEqual(parseAuthor("just a name"), { name: "just a name", email: "" });
  assert.deepEqual(parseAuthor("<only@mail>"), { name: "only@mail", email: "only@mail" });
  assert.equal(parseAuthor(""), null);
  assert.equal(isVisible({ tag: "purpose::extension, role::enduser" }), true);
  assert.equal(isVisible({ tag: "role::cydia" }), false);
  assert.equal(isVisible({ tag: "cydia::obsolete" }), false);
  assert.equal(isVisible({}), true);
  assert.equal(indexLetter("alpha"), "A");
  assert.equal(indexLetter("Écran"), "E");
  assert.equal(indexLetter("3D Touch"), "#");
});

test("load keeps this arch only, the newest version, and visible packages", () => {
  const c = loaded();
  const a = c.list("A");
  assert.deepEqual(ids(a), ["com.a.tweak", "com.a.util", "com.a.nosection", "com.a.theme"]);
  const tweak = a[0];
  assert.equal(tweak.version, "1.2");
  assert.equal(tweak.author, "Jane Dev");
  assert.equal(tweak.short, "makes things alpha");
  assert.equal(c.list("A").find((r) => r.id === "com.a.util").author, "Sam Packager", "maintainer when no author");
  assert.equal(Object.keys(tweak).some((k) => k.startsWith("_")), false, "search fields stay in the worker");
  // rootful arch sees the rootful package and the arch-all one
  const r = createCatalog();
  assert.equal(r.load("A", REPO_A, "https://a.example/", "iphoneos-arm"), 2);
});

test("sections group with counts, sorted by name; All Sources merges", () => {
  const c = loaded();
  assert.deepEqual(c.sections("A"), {
    total: 4,
    sections: [
      { name: NO_SECTION, count: 1 }, { name: "Themes (LockScreen)", count: 1 },
      { name: "Tweaks", count: 1 }, { name: "Utilities", count: 1 },
    ],
  });
  const all = c.sections(ALL);
  assert.equal(all.total, 5, "com.a.tweak counted once across sources");
  assert.deepEqual(all.sections.find((s) => s.name === "Tweaks"), { name: "Tweaks", count: 2 });
  assert.deepEqual(ids(c.list(ALL, "Tweaks")), ["com.a.tweak", "com.b.springy"]);
  assert.deepEqual(ids(c.list("A", NO_SECTION)), ["com.a.nosection"]);
  assert.equal(c.list("missing").length, 0);
});

test("All Sources picks the newest version (dpkg order: 1.10 > 1.2)", () => {
  const c = loaded();
  const p = c.package("com.a.tweak");
  assert.equal(p.stanza.version, "1.10");
  assert.equal(p.key, "B");
  assert.deepEqual(p.others, [{ key: "A", version: "1.2" }, { key: "B", version: "1.10" }]);
  const a = c.package("com.a.tweak", "A");
  assert.equal(a.stanza.version, "1.2");
  assert.equal(a.stanza.debUrl, "https://a.example/debs/alpha_1.2.deb");
  assert.equal(c.package("nope"), null);
  assert.deepEqual(c.has(["com.a.util", "libc", "com.b.springy"]), ["com.a.util", "com.b.springy"]);
});

test("search covers name, id, description and author, ranked", () => {
  const c = loaded();
  assert.deepEqual(ids(c.search("springy")), ["com.b.springy"]);
  assert.deepEqual(ids(c.search("com.a.ut")), ["com.a.util"], "id prefix");
  assert.deepEqual(ids(c.search("bouncy")), ["com.b.springy"], "short description");
  assert.deepEqual(ids(c.search("springboard")), ["com.a.tweak"], "long description");
  assert.deepEqual(ids(c.search("sam packager")), ["com.a.util"], "maintainer, all words");
  // exact name first, then name prefix, then the rest by name
  assert.deepEqual(ids(c.search("alpha tweak")), ["com.a.tweak"]);
  const jane = ids(c.search("jane"));
  assert.deepEqual(jane.sort(), ["com.a.theme", "com.a.tweak", "com.b.springy"].sort());
  const t = ids(c.search("g"));
  assert.equal(t[0], "com.a.theme", "name or id prefix outranks a match inside");
  assert.deepEqual(c.search("   "), []);
  assert.deepEqual(c.search("zzz-nothing"), []);
  assert.equal(c.search("a", { limit: 2 }).length, 2);
});

test("author lists every package by Author or Maintainer name, any case", () => {
  const c = loaded();
  assert.deepEqual(ids(c.author("Jane Dev")), ["com.a.tweak", "com.a.theme", "com.b.springy"]);
  assert.deepEqual(ids(c.author("other")), ["com.b.springy"]);
  assert.deepEqual(c.author(""), []);
});

test("reloading a source replaces it; removing drops it from All Sources", () => {
  const c = loaded();
  c.load("B", packages({ Package: "com.b.new", Name: "New", Version: "1", Architecture: "all" }), "https://b.example/");
  assert.equal(c.package("com.a.tweak").stanza.version, "1.2");
  assert.deepEqual(c.search("springy"), []);
  c.remove("A");
  assert.deepEqual(ids(c.list(ALL)), ["com.b.new"]);
  assert.deepEqual(c.keys(), ["B"]);
});

test("the worker runs catalog ops, with the Packages text as bytes", async () => {
  const bytes = new TextEncoder().encode(REPO_B).buffer;
  const r = reply({ id: 1, type: "catalog", op: "load", args: ["W", null, "https://b.example/", "iphoneos-arm64"], bytes });
  assert.deepEqual(r, { id: 1, ok: true, result: 2 });
  assert.equal(reply({ id: 2, type: "catalog", op: "search", args: ["bouncy"] }).result[0].id, "com.b.springy");
  assert.equal(reply({ id: 3, type: "catalog", op: "bogus" }).ok, false);
  // and through the parser's inline fallback (no Worker in node)
  const p = createParser({ Worker: null });
  assert.equal(await p.catalog("load", ["P", undefined, "https://a.example/"], REPO_A), 4);
  assert.equal((await p.catalog("sections", ["P"])).total, 4);
  await assert.rejects(p.catalog("nope"));
});

test("versions lists every source's candidate per id, for the Changes tab", () => {
  const c = createCatalog();
  c.load("a", REPO_A, "https://a.example/", "iphoneos-arm64");
  const v = c.versions();
  assert.deepEqual(v.find(([, id]) => id === "com.a.tweak"), ["a", "com.a.tweak", "1.2"]);
  assert.ok(!v.some(([, id]) => id === "com.a.rootful"));
  assert.deepEqual(reply({ id: 1, type: "catalog", op: "versions" }).ok, true);
});

test("Section Visibility: hidden sections leave sections, lists, search and author; package and has still see them", () => {
  const c = loaded();
  const before = c.sections(ALL);
  assert.equal(c.setHidden(["Tweaks", 42]), 1);
  const after = c.sections(ALL);
  assert.equal(after.sections.some((s) => s.name === "Tweaks"), false);
  assert.equal(after.total, before.total - 2); // com.a.tweak and com.b.springy
  const edit = c.sections(ALL, { hidden: true });
  assert.deepEqual(edit.sections.map((s) => s.name), before.sections.map((s) => s.name));
  assert.equal(edit.sections.find((s) => s.name === "Tweaks").hidden, true);
  assert.equal(edit.sections.find((s) => s.name === "Utilities").hidden, false);
  assert.equal(edit.total, after.total);
  assert.deepEqual(c.list(ALL, "Tweaks"), []);
  assert.equal(ids(c.list(ALL)).includes("com.a.tweak"), false);
  assert.equal(ids(c.list("B")).length, 0);
  assert.deepEqual(c.search("alpha"), []);
  assert.deepEqual(ids(c.author("Jane Dev")), ["com.a.theme"]); // her tweaks are hidden, her theme isn't
  assert.equal(ids(c.author("Sam Packager")).length, 1);
  assert.equal(c.package("com.a.tweak").row.id, "com.a.tweak");
  assert.deepEqual(c.has(["com.a.tweak"]), ["com.a.tweak"]);
  assert.equal(c.versions().some(([, id]) => id === "com.b.springy"), true, "Changes still files what it sees");
  // a reload keeps the hidden set; clearing it brings everything back
  c.load("B", REPO_B, "https://b.example/");
  assert.equal(ids(c.list("B")).length, 0);
  c.setHidden([]);
  assert.deepEqual(c.sections(ALL), before);
  assert.equal(c.search("alpha")[0].id, "com.a.tweak");
});

test("the worker takes setHidden as a catalog op", () => {
  reply({ id: 1, type: "catalog", op: "load", args: ["H", null, "https://b.example/"], text: REPO_B });
  assert.equal(reply({ id: 2, type: "catalog", op: "setHidden", args: [["Tweaks"]] }).result, 1);
  assert.deepEqual(reply({ id: 3, type: "catalog", op: "search", args: ["bouncy"] }).result, []);
  reply({ id: 4, type: "catalog", op: "setHidden", args: [[]] });
  reply({ id: 5, type: "catalog", op: "remove", args: ["H"] });
});

test("Works on my phone (F17): rows carry their code; the filter drops what can't work, keeps unknown", () => {
  const c = createCatalog();
  c.load("k", packages(
    { Package: "fits", Name: "Fits", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (>= 15.0)" },
    { Package: "old", Name: "Old Only", Version: "1", Architecture: "iphoneos-arm64", Section: "Tweaks", Depends: "firmware (<< 15.0)" },
    { Package: "says-nothing", Name: "Says Nothing", Version: "1", Architecture: "all", Section: "Themes" },
    { Package: "too-new", Name: "Too New", Version: "1", Architecture: "iphoneos-arm64", Section: "Lonely", Depends: "firmware (>= 18.0)" },
  ), null);
  // before a device is set: no codes, nothing filtered
  assert.deepEqual(c.list().map((r) => [r.id, r.compat]), [["fits", null], ["old", null], ["says-nothing", null], ["too-new", null]]);
  assert.equal(c.setDevice({ ios: "16.5", jailbreak: "rootless" }), 2);
  assert.deepEqual(ids(c.list()), ["fits", "says-nothing"]);
  assert.deepEqual(c.list().map((r) => r.compat), ["works", "unknown"]);
  assert.deepEqual(ids(c.search("o")), ["says-nothing"]); // "Old Only" and "Too New" match but can't work
  // a section with nothing that fits drops out, and counts follow the filter
  assert.deepEqual(c.sections(), { total: 2, sections: [{ name: "Themes", count: 1 }, { name: "Tweaks", count: 1 }] });
  // the package page still finds what the filter hides
  assert.equal(c.package("old").stanza.package, "old");
  // filter off: everything back, each with its code
  c.setDevice({ ios: "16.5", jailbreak: "rootless" }, { filter: false });
  assert.deepEqual(c.list().map((r) => [r.id, r.compat]), [["fits", "works"], ["old", "ios"], ["says-nothing", "unknown"], ["too-new", "ios"]]);
  // through the worker's entry point too, and rows loaded later are judged on load
  assert.equal(reply({ id: 1, type: "catalog", op: "setDevice", args: [{ ios: "14.2", jailbreak: "rootless" }] }).ok, true);
  c.setDevice({ ios: "14.2", jailbreak: "rootless" });
  c.load("k2", packages({ Package: "later", Version: "1", Architecture: "iphoneos-arm64", Depends: "firmware (>= 15.0)" }), null);
  assert.equal(c.package("later").row.compat, "ios");
  assert.deepEqual(ids(c.list()), ["old", "says-nothing"]);
  c.setDevice(null);
  assert.equal(c.list().length, 5);
});
