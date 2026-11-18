import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDES, guideRows } from "./guides.js";
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
  assert.equal(nav({ tab: "home", path: ["credits"] }).title, "Credits");
  // Every User Guides row opens a guide that exists, titled by it.
  for (const r of guideRows((x) => x.path.join("/"))) {
    const [, id] = r.href.split("/");
    assert.ok(GUIDES[id]?.sections.length, id);
    assert.equal(nav({ tab: "home", path: ["guides", id] }).title, GUIDES[id].title);
  }
  assert.equal(nav({ tab: "home", path: ["sources"] }).title, "More Sources");
  for (const s of CURATED_SOURCES) {
    assert.match(s.uri, /^https:\/\/.+\/$/);
    assert.equal(s.key, `deb:${s.uri}:./`);
  }
});

test("F37: Home's hint shows while Not Jailbroken and taps through to Settings > Device", () => {
  assert.equal(deviceHint("none"), null, "the website: no hint (Jailbroken? Get Cydian.deb instead)");
  assert.deepEqual(deviceHint("none", "jailbreak"), { text: DEVICE_HINT, href: "#/home/settings/device" });
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

test("Jailbroken? Get Cydian.deb: Cydian's APT repo in Sileo and Zebra", async () => {
  const { repoLinks, CYDIAN_APT_REPO, JAILBROKEN_SHEET } = await import("./home.js");
  assert.equal(CYDIAN_APT_REPO, "https://cydian.dev/repo/");
  assert.deepEqual(repoLinks("https://r/"), { sileo: "sileo://source/https://r/", zebra: "zbra://sources/add/https://r/",
    sileoPackage: "sileo://package/com.ryha.cydian", zebraPackage: "zbra://packages/com.ryha.cydian" });
  assert.deepEqual(JAILBROKEN_SHEET.buttons, ["Add to Sileo", "Add to Zebra", "Copy Repo URL", "Download .deb"]);
});

test("F123/F135: Home's list starts with Settings in its own group, with its icon; Credits ends it", async () => {
  const { homeLinks } = await import("./home.js");
  const groups = homeLinks();
  assert.deepEqual(groups[0], { rows: [{ label: "Settings", href: "#/home/settings", icon: { src: "icons/settings.svg" }, cls: "home-settings-row" }] });
  assert.equal(groups[1].rows[0].label, "Upgrading & Jailbreaking Help", "the help links come right after Settings");
  assert.equal(groups[2].header, "User Guides");
  assert.equal(groups.at(-1).rows[0].label, "Credits / Thank You");
  assert.equal(groups.at(-1).rows.length, 1);
});

test("F123: the Signing tile shows only while signing isn't set up, where something signs", async () => {
  const { showsSigningTile, signingSetUp } = await import("./home.js");
  assert.equal(showsSigningTile("site"), true);
  assert.equal(showsSigningTile("sideload", false), true);
  assert.equal(showsSigningTile("site", true), false);
  assert.equal(showsSigningTile("sideload", true), false);
  assert.equal(showsSigningTile("jailbreak", false), false);
  // the website: a certificate and profile saved (signingReady)
  assert.equal(await signingSetUp("site", { ready: async () => true }), true);
  assert.equal(await signingSetUp("site", { ready: async () => false }), false);
  assert.equal(await signingSetUp("site", { ready: async () => { throw new Error("idb"); } }), false);
  // the sideload app: every walkthrough step (the real signing.js missingStep: certificate, then an https server)
  const id = { identity: { name: "Me" } };
  assert.equal(await signingSetUp("sideload", { status: async () => id, server: () => "https://cydian.dev" }), true);
  assert.equal(await signingSetUp("sideload", { status: async () => ({ identity: null }), server: () => "https://cydian.dev" }), false);
  assert.equal(await signingSetUp("sideload", { status: async () => id, server: () => "" }), false);
  assert.equal(await signingSetUp("sideload", { status: async () => { throw new Error("no bridge"); }, server: () => "https://x" }), false);
  assert.equal(await signingSetUp("jailbreak"), false);
});

test("F123: every Settings link in the screens goes through settingsRoute (Home's stack)", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dirs = [import.meta.dirname, join(import.meta.dirname, "..")];
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((n) => n.endsWith(".js") && !n.endsWith(".test.js") && n !== "router.js")) {
      assert.doesNotMatch(readFileSync(join(d, f), "utf8"), /tab: "settings"/, f);
    }
  }
});
