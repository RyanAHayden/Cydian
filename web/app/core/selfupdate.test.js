// F61, F183: iFizBox's own update check. The version compare, the release parse, and the silent check every launch
// and Reload runs (against fakes for the bridge and the alerts: it must never call one).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion, compareVersions, isNewer, noteLines, parseRelease, debFor, installPath, loadState, saveState,
  newerRelease, fetchRelease, checkForUpdates, STORE_KEY, RELEASES_URL,
} from "./selfupdate.js";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

const GH = {
  tag_name: "v0.2.0",
  html_url: "https://github.com/RyanAHayden/iFizBox/releases/tag/v0.2.0",
  body: "## What's new\n\n- **Updates itself**: a row in Changes when a release is out\n- Settings shows the version\n\n![shot](x.png)\n* Fixes [#3](https://x)\n1. Line four\n- Line five",
  assets: [
    { name: "iFizBox.ipa", browser_download_url: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.2.0/iFizBox.ipa" },
    { name: "iFizBox.deb", browser_download_url: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.2.0/iFizBox.deb" },
    { name: "com.ryha.ifizbox_0.2.0_iphoneos-arm64e.deb", browser_download_url: "https://example.com/e.deb" },
    { name: "com.ryha.ifizbox_0.2.0_iphoneos-arm.deb", browser_download_url: "https://example.com/arm.deb" },
  ],
};
const release = parseRelease(GH);

test("parseVersion and compareVersions", () => {
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("V0.10"), [0, 10, 0]);
  assert.deepEqual(parseVersion("2"), [2, 0, 0]);
  assert.deepEqual(parseVersion("1.2.3-beta1"), [1, 2, 3]);
  assert.equal(parseVersion("nightly"), null);
  assert.equal(parseVersion(""), null);
  assert.equal(parseVersion(null), null);
  assert.equal(compareVersions("v0.2.0", "0.1.0"), 1);
  assert.equal(compareVersions("0.1.0", "v0.1"), 0);
  assert.equal(compareVersions("0.9.9", "0.10.0"), -1); // numeric, not string
  assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("x", "0.0.1"), -1);
  assert.equal(isNewer("v0.2.0", "0.1.0"), true);
  assert.equal(isNewer("v0.1.0", "0.1.0"), false);
  assert.equal(isNewer("v0.0.9", "0.1.0"), false);
  assert.equal(isNewer("v0.1.0", ""), true); // an app that can't say its version takes any release
  assert.equal(isNewer("nightly", "0.1.0"), false);
});

test("noteLines: the first lines, Markdown taken off", () => {
  assert.deepEqual(noteLines(GH.body), ["Updates itself: a row in Changes when a release is out", "Settings shows the version", "Fixes #3", "Line four"]);
  assert.deepEqual(noteLines(GH.body, 2).length, 2);
  assert.deepEqual(noteLines(""), []);
  assert.deepEqual(noteLines(null), []);
  assert.deepEqual(noteLines("a\r\n---\r\nb"), ["a", "b"]);
});

test("parseRelease", () => {
  assert.equal(release.version, "0.2.0");
  assert.equal(release.tag, "v0.2.0");
  assert.equal(release.ipa, GH.assets[0].browser_download_url);
  assert.equal(release.debs.length, 3);
  assert.equal(release.url, GH.html_url);
  assert.equal(parseRelease({ message: "API rate limit exceeded" }), null);
  assert.equal(parseRelease({ tag_name: "nightly" }), null);
  assert.equal(parseRelease({ tag_name: "v1.0.0", draft: true }), null);
  assert.equal(parseRelease(null), null);
  const bare = parseRelease({ tag_name: "v1.0.0", assets: [{ name: "x" }, null] });
  assert.equal(bare.ipa, null);
  // F180: only the release's iFizBox.ipa, never an IPA under another (old) name.
  assert.equal(parseRelease({ tag_name: "v0.9.3", assets: [{ name: "Old.ipa", browser_download_url: "https://x/Old.ipa" }] }).ipa, null);
  assert.deepEqual(bare.debs, []);
  assert.deepEqual(bare.notes, []);
});

test("debFor: the device's arch, else iFizBox.deb for rootless only", () => {
  assert.equal(debFor(release, "iphoneos-arm64e"), "https://example.com/e.deb");
  assert.equal(debFor(release, "iphoneos-arm"), "https://example.com/arm.deb");
  assert.equal(debFor(release, "iphoneos-arm64"), GH.assets[1].browser_download_url);
  assert.equal(debFor(release, null), GH.assets[1].browser_download_url);
  const onlyPlain = parseRelease({ tag_name: "v1.0.0", assets: [GH.assets[1]] });
  assert.equal(debFor(onlyPlain, "iphoneos-arm"), null); // the plain one is rootless: not for rootful
  const arm64 = parseRelease({ tag_name: "v1.0.0", assets: [{ name: "ifizbox_1.0.0_iphoneos-arm64.deb", browser_download_url: "https://example.com/64.deb" }, GH.assets[1]] });
  assert.equal(debFor(arm64, "iphoneos-arm64"), "https://example.com/64.deb");
  assert.equal(debFor(arm64, "iphoneos-arm"), null); // "-arm64.deb" is not "-arm.deb"
});

test("installPath: which install each mode takes", () => {
  assert.equal(installPath("sideload"), "sideload");
  assert.equal(installPath("jailbreak"), "jailbreak");
  assert.equal(installPath("site"), null);
  assert.equal(installPath(undefined), null);
});

test("state: load, save, broken storage", () => {
  const s = memStorage();
  assert.deepEqual(loadState(s), {});
  saveState(s, { lastCheck: 5, skip: "0.2.0" });
  assert.deepEqual(loadState(s), { lastCheck: 5, skip: "0.2.0" });
  saveState(s, { skip: null });
  assert.deepEqual(loadState(s), { lastCheck: 5 });
  assert.deepEqual(loadState(memStorage({ [STORE_KEY]: "{not json" })), {});
  assert.deepEqual(loadState(memStorage({ [STORE_KEY]: "7" })), {});
  const throwing = { getItem() { throw new Error("no"); }, setItem() { throw new Error("full"); } };
  assert.deepEqual(loadState(throwing), {});
  assert.doesNotThrow(() => saveState(throwing, { a: 1 }));
  assert.deepEqual(loadState(undefined), {});
});

test("fetchRelease: through the shell's net.fetch, or fetch()", async () => {
  const body = Buffer.from(JSON.stringify(GH), "utf8").toString("base64");
  const calls = [];
  const native = { call: async (m, p) => { calls.push([m, p]); return { status: 200, headers: {}, body }; } };
  assert.equal((await fetchRelease({ native })).version, "0.2.0");
  assert.deepEqual(calls, [["net.fetch", { url: RELEASES_URL }]]);
  await assert.rejects(fetchRelease({ native: { call: async () => ({ status: 403, body: "" }) } }), /403/);
  const f = async (url) => ({ ok: true, status: 200, json: async () => GH, url });
  assert.equal((await fetchRelease({ fetch: f })).ipa, release.ipa);
  await assert.rejects(fetchRelease({ fetch: async () => ({ ok: false, status: 404 }) }), /404/);
});

// A check with fakes. `alert` fails the test: the check never pops anything up (F183).
function harness({ mode = "sideload", current = "0.1.0", rel = release, storage = memStorage(), t = 1_800_000_000_000, fail = null } = {}) {
  let fetches = 0;
  const deps = {
    mode, storage, now: () => t,
    current: async () => current,
    release: async () => { fetches++; if (fail) throw fail; return rel; },
    alert: async () => assert.fail("the update check showed an alert"),
  };
  return { deps, storage, fetches: () => fetches };
}

test("checkForUpdates: the site does nothing", async () => {
  const h = harness({ mode: "site" });
  assert.equal(await checkForUpdates(h.deps), "site");
  assert.equal(h.fetches(), 0);
});

test("checkForUpdates: newer -> kept for Changes, no alert", async () => {
  const h = harness();
  assert.equal(await checkForUpdates(h.deps), "newer");
  const st = loadState(h.storage);
  assert.equal(st.lastCheck, 1_800_000_000_000);
  assert.equal(st.latest.version, "0.2.0");
  assert.equal(st.current, "0.1.0");
  assert.equal(newerRelease(h.storage, "0.1.0").ipa, release.ipa);
  assert.equal(newerRelease(h.storage, "0.2.0"), null);
  assert.equal(newerRelease(h.storage, ""), null);
});

test("checkForUpdates: every call asks GitHub again (no once-a-day wait)", async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) assert.equal(await checkForUpdates(h.deps), "newer");
  assert.equal(h.fetches(), 3);
});

test("checkForUpdates: up to date and errors stay silent", async () => {
  const h = harness({ current: "0.2.0" });
  assert.equal(await checkForUpdates(h.deps), "current");
  const n = harness({ rel: null });
  assert.equal(await checkForUpdates(n.deps), "current"); // no usable release (rate limit, odd tag)
  assert.equal(loadState(n.storage).latest, undefined);
  const e = harness({ fail: new Error("offline") });
  assert.equal(await checkForUpdates(e.deps), "error");
  assert.equal(loadState(e.storage).lastCheck, undefined);
  // a newer release seen before stays until GitHub answers again
  const s = memStorage();
  await checkForUpdates(harness({ storage: s }).deps);
  await checkForUpdates(harness({ storage: s, fail: new Error("offline") }).deps);
  assert.equal(newerRelease(s, "0.1.0").version, "0.2.0");
});

test("F183: the old Later / Skip This Version / once-a-day / install paths are gone", async () => {
  const mod = await import("./selfupdate.js");
  for (const name of ["dueForCheck", "shouldOffer", "setSkip", "offerAlert", "runInstall", "DAY"]) assert.equal(mod[name], undefined, name);
});
