import { test } from "node:test";
import assert from "node:assert/strict";
import { stateTile, nav, CURATED_SOURCES, deviceHint, DEVICE_HINT, showsThemes } from "./home.js";

const src = (extra = {}) => ({ key: "deb:https://a/:./", uri: "https://a/", ...extra });

test("Home state tile: the text and target follow the sources and upgrades", () => {
  assert.deepEqual(stateTile(), { kind: "loading", label: "Loading Sources", href: "#/sources" });
  assert.deepEqual(stateTile({ sources: [] }), { kind: "add", label: "Add a Source", href: "#/home/sources" });
  assert.deepEqual(stateTile({ sources: [], upgrades: 4 }).kind, "add"); // nothing to upgrade from without sources
  assert.deepEqual(stateTile({ sources: [src()], upgrades: 3 }), { kind: "upgrades", label: "3 Upgrades Available", href: "#/changes" });
  assert.equal(stateTile({ sources: [src()], upgrades: 1 }).label, "1 Upgrade Available");
  // Upgrades come before broken sources; a broken source comes before the all-clear.
  assert.equal(stateTile({ sources: [src({ error: "x" })], upgrades: 2 }).kind, "upgrades");
  assert.deepEqual(stateTile({ sources: [src({ error: "x" }), src({ error: "y" })], upgrades: 0 }),
    { kind: "failed", label: "2 Sources Failed to Load", href: "#/sources" });
  assert.equal(stateTile({ sources: [src({ error: "x" })] }).label, "1 Source Failed to Load");
  assert.deepEqual(stateTile({ sources: [src()], upgrades: 0 }), { kind: "current", label: "Everything Up to Date", href: "#/changes" });
  // Unknown upgrade count (the site has no installed list): never claims up to date.
  assert.deepEqual(stateTile({ sources: [src()], upgrades: null }), { kind: "changes", label: "See What's New", href: "#/changes" });
});

test("Home pages: titles below the root, and curated sources are flat repos with Cydia keys", () => {
  assert.equal(nav({ tab: "home", path: [] }, {}).left.label, "About");
  assert.equal(nav({ tab: "home", path: ["help"] }).title, "Help");
  assert.equal(nav({ tab: "home", path: ["sources"] }).title, "More Sources");
  for (const s of CURATED_SOURCES) {
    assert.match(s.uri, /^https:\/\/.+\/$/);
    assert.equal(s.key, `deb:${s.uri}:./`);
  }
});

test("F37: Home's hint shows while Not Jailbroken and taps through to Settings > Device", () => {
  assert.deepEqual(deviceHint("none"), { text: DEVICE_HINT, href: "#/settings/device" });
  assert.equal(DEVICE_HINT, "Showing apps for iPhones without a jailbreak. Jailbroken? Settings > Device.");
  assert.equal(deviceHint("iphoneos-arm64"), null);
  assert.equal(deviceHint("iphoneos-arm"), null);
  assert.equal(deviceHint("none", "sideload"), null, "the sideload build has no choice to make");
});

test("F41: Home offers Themes only on a jailbroken type", () => {
  assert.equal(showsThemes("none"), false);
  assert.equal(showsThemes("iphoneos-arm64"), true);
  assert.equal(showsThemes("iphoneos-arm"), true);
});

test("F79: Home links to Install IPAs, except in the jailbreak app", async () => {
  const { ipasTile } = await import("./home.js");
  assert.deepEqual(ipasTile("site"), { label: "Install IPAs", href: "#/installed/myipas" });
  assert.deepEqual(ipasTile("sideload"), { label: "Install IPAs", href: "#/installed/myipas" });
  assert.equal(ipasTile("jailbreak"), null);
});
