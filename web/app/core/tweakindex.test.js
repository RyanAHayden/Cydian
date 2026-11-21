// F344: the tweak index's shared shapes (core/tweakindex.js) on the fixture .debs: an app tweak, a SpringBoard
// tweak, a UIKit-wide one and a paid one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { indexSource, indexQuery, sourceFromQuery, indexTweaks, indexEntry, paidEntry, paidHint, entryInfo, liteTweaks,
  worksInLine } from "./tweakindex.js";
import { inspectTweakDeb, appNameOf } from "./tweaks.js";
import { parseControl } from "./apt.js";
import { DEBS, PACKAGES, makeDeb } from "./fixtures/tweaks/index-debs.test-helper.js";

test("indexSource: one canonical key per source; refuses what isn't a plain http(s) repo", () => {
  const a = indexSource({ uri: "https://repo.example/", dist: "./" });
  assert.equal(a.key, "https://repo.example/|./||iphoneos-arm64");
  assert.equal(indexSource({ uri: "https://repo.example", dist: "" }).key, a.key);
  const b = indexSource({ uri: "http://apt.thebigboss.org/repofiles/cydia/", dist: "stable", components: ["main"] }, "iphoneos-arm");
  assert.equal(b.key, "http://apt.thebigboss.org/repofiles/cydia/|stable|main|iphoneos-arm");
  for (const bad of [{ uri: "ftp://x/" }, { uri: "https://u:p@x/" }, { uri: "https://x/?a=1" }, { uri: "https://x/", dist: "../../etc" },
    { uri: "https://x/", dist: "stable" }, { uri: "https://x/", dist: "stable", components: ["a b"] }, {}]) {
    assert.equal(indexSource(bad), null, JSON.stringify(bad));
  }
  const q = indexQuery({ uri: "https://repo.example/", dist: "stable", components: ["main", "extra"] }, { bundle: "com.burbn.instagram" });
  assert.equal(sourceFromQuery(new URLSearchParams(q)).key, "https://repo.example/|stable|main,extra|iphoneos-arm64");
  assert.equal(new URLSearchParams(q).get("bundle"), "com.burbn.instagram");
});

test("indexTweaks: the newest version of each package the fields let through, paid ones included", () => {
  const list = indexTweaks(PACKAGES);
  assert.deepEqual(list.map((s) => `${s.package}@${s.version}`).sort(),
    ["com.x.anyfont@1.1", "com.x.instapro@3.0", "com.x.sbcolor@2.0", "com.x.ytplus@1.0"]);
});

test("entries: an app tweak names its app, SpringBoard is system-only, UIKit is any app; Works in lines", () => {
  const byPkg = Object.fromEntries(parseControl(PACKAGES).map((s) => [`${s.package}@${s.version}`, s]));
  const yt = indexEntry(byPkg["com.x.ytplus@1.0"], inspectTweakDeb(DEBS["debs/ytplus_1.0.deb"]));
  assert.equal(yt.ok, true);
  assert.deepEqual(yt.bundles, ["com.google.ios.youtube"]);
  assert.deepEqual(yt.dylibs, ["YTPlus"]);
  assert.deepEqual(yt.needs, ["mobilesubstrate", "preferenceloader"]);
  const sb = indexEntry(byPkg["com.x.sbcolor@2.0"], inspectTweakDeb(DEBS["debs/sbcolor_2.0.deb"]));
  assert.equal(sb.ok, false);
  assert.equal(sb.systemOnly, true);
  const any = indexEntry(byPkg["com.x.anyfont@1.1"], inspectTweakDeb(DEBS["debs/anyfont_1.1.deb"]));
  assert.equal(any.anyApp, true);
  const noDylib = indexEntry({ package: "p", version: "1" }, inspectTweakDeb(makeDeb([["./var/jb/Library/PreferenceBundles/P.bundle/Info.plist", "x"]])));
  assert.equal(noDylib.ok, false, "no dylib: nothing to go into an app");
  assert.deepEqual(liteTweaks([{ info: entryInfo(noDylib) }], "any.app", (r) => r.info), { made: [], any: [] });
  const paid = paidEntry(byPkg["com.x.instapro@3.0"]);
  assert.deepEqual(paid.bundles, ["com.burbn.instagram"]);
  assert.equal(paid.unverified, true);

  assert.equal(worksInLine(entryInfo(yt), {}, appNameOf), "Works in: YouTube");
  assert.equal(worksInLine(entryInfo(any), {}, appNameOf), "Works in: Any App");
  assert.equal(worksInLine(entryInfo(paid), {}, appNameOf), "Works in: Instagram (unverified)");
  assert.equal(worksInLine(entryInfo(sb), {}, appNameOf), null);

  // Add Tweaks for YouTube: its own tweak first, then the every-app one; SpringBoard and the Instagram guess left out
  const rows = [{ id: "sb", info: entryInfo(sb) }, { id: "any", info: entryInfo(any) }, { id: "yt", info: entryInfo(yt) },
    { id: "paid", info: entryInfo(paid) }, { id: "unchecked", info: null }];
  const forYt = liteTweaks(rows, "com.google.ios.youtube", (r) => r.info);
  assert.deepEqual(forYt.made.map((r) => r.id), ["yt"]);
  assert.deepEqual(forYt.any.map((r) => r.id), ["any"]);
  const forIg = liteTweaks(rows, "com.burbn.instagram", (r) => r.info);
  assert.deepEqual(forIg.made.map((r) => r.id), ["paid"]);
  assert.deepEqual(liteTweaks(rows, "", (r) => r.info), { made: [], any: [] });
});

test("paidHint: app names as words; YouTube Music isn't YouTube; the user's own app names count", () => {
  assert.deepEqual(paidHint({ name: "YTMusicUltimate", description: "Premium features for YouTube Music" }), ["com.google.ios.youtubemusic"]);
  assert.deepEqual(paidHint({ name: "Rocket", description: "The best tweak for Instagram" }), ["com.burbn.instagram"]);
  assert.deepEqual(paidHint({ name: "Snowboard", description: "Theme your home screen" }), []);
  assert.deepEqual(paidHint({ name: "Tubify", description: "a Spotifyish player" }), [], "words only");
  assert.deepEqual(paidHint({ name: "Apollo Plus", description: "for Apollo" }, { "com.christianselig.Apollo": "Apollo" }), ["com.christianselig.Apollo"]);
});
