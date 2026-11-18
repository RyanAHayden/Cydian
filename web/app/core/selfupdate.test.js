// F61: iFizBox updates itself. The version compare, the release parse, the once-a-day gate, Later, Skip This Version,
// and which install each build takes (against fakes for the bridge, the signer and the alerts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion, compareVersions, isNewer, noteLines, parseRelease, debFor, installPath, loadState, saveState,
  dueForCheck, shouldOffer, setSkip, offerAlert, fetchRelease, checkForUpdates, runInstall, DAY, STORE_KEY, RELEASES_URL,
} from "./selfupdate.js";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

const GH = {
  tag_name: "v0.2.0",
  html_url: "https://github.com/RyanAHayden/iFizBox/releases/tag/v0.2.0",
  body: "## What's new\n\n- **Updates itself**: a popup when a release is out\n- Settings > About\n\n![shot](x.png)\n* Fixes [#3](https://x)\n1. Line four\n- Line five",
  assets: [
    { name: "Cydian.ipa", browser_download_url: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.2.0/Cydian.ipa" },
    { name: "Cydian.deb", browser_download_url: "https://github.com/RyanAHayden/iFizBox/releases/download/v0.2.0/Cydian.deb" },
    { name: "com.ryha.cydian_0.2.0_iphoneos-arm64e.deb", browser_download_url: "https://example.com/e.deb" },
    { name: "com.ryha.cydian_0.2.0_iphoneos-arm.deb", browser_download_url: "https://example.com/arm.deb" },
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
  assert.deepEqual(noteLines(GH.body), ["Updates itself: a popup when a release is out", "Settings > About", "Fixes #3", "Line four"]);
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
  assert.deepEqual(bare.debs, []);
  assert.deepEqual(bare.notes, []);
});

test("debFor: the device's arch, else Cydian.deb for rootless only", () => {
  assert.equal(debFor(release, "iphoneos-arm64e"), "https://example.com/e.deb");
  assert.equal(debFor(release, "iphoneos-arm"), "https://example.com/arm.deb");
  assert.equal(debFor(release, "iphoneos-arm64"), GH.assets[1].browser_download_url);
  assert.equal(debFor(release, null), GH.assets[1].browser_download_url);
  const onlyPlain = parseRelease({ tag_name: "v1.0.0", assets: [GH.assets[1]] });
  assert.equal(debFor(onlyPlain, "iphoneos-arm"), null); // the plain one is rootless: not for rootful
  const arm64 = parseRelease({ tag_name: "v1.0.0", assets: [{ name: "cydian_1.0.0_iphoneos-arm64.deb", browser_download_url: "https://example.com/64.deb" }, GH.assets[1]] });
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

test("dueForCheck: once a day", () => {
  const t = 1_800_000_000_000;
  assert.equal(dueForCheck({}, t), true);
  assert.equal(dueForCheck({ lastCheck: t - DAY + 1 }, t), false);
  assert.equal(dueForCheck({ lastCheck: t - DAY }, t), true);
  assert.equal(dueForCheck({ lastCheck: t - 1000 }, t), false);
  assert.equal(dueForCheck({ lastCheck: t + 5000 }, t), true); // the clock went back
  assert.equal(dueForCheck({ lastCheck: "junk" }, t), true);
});

test("shouldOffer: newer, not skipped, not put off in the last day", () => {
  const t = 1_800_000_000_000;
  assert.equal(shouldOffer(release, "0.1.0", {}, t), true);
  assert.equal(shouldOffer(release, "0.2.0", {}, t), false);
  assert.equal(shouldOffer(null, "0.1.0", {}, t), false);
  assert.equal(shouldOffer(release, "0.1.0", { skip: "0.2.0" }, t), false);
  assert.equal(shouldOffer(release, "0.1.0", { skip: "0.1.5" }, t), true); // a skip is for one version only
  assert.equal(shouldOffer(release, "0.1.0", { laterAt: t - 1000 }, t), false);
  assert.equal(shouldOffer(release, "0.1.0", { laterAt: t - DAY }, t), true);
});

test("setSkip and offerAlert", () => {
  const s = memStorage();
  setSkip(s, "0.2.0");
  assert.equal(loadState(s).skip, "0.2.0");
  setSkip(s, null);
  assert.equal(loadState(s).skip, undefined);
  const a = offerAlert(release);
  assert.equal(a.title, "iFizBox 0.2.0 Is Available");
  assert.deepEqual(a.buttons, ["Later", "Install"]);
  assert.equal(a.message.split("\n").length, 4);
  assert.match(offerAlert({ version: "1.0.0", notes: [] }).message, /new version/);
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

// A check with fakes: `answers` are the alert's button indexes, in order.
function harness({ mode = "sideload", current = "0.1.0", rel = release, answers = [], storage = memStorage(), t = 1_800_000_000_000, fail = null } = {}) {
  const alerts = [], installs = [];
  let fetches = 0;
  const deps = {
    mode, storage, now: () => t,
    current: async () => current,
    release: async () => { fetches++; if (fail) throw fail; return rel; },
    alert: async (spec) => { alerts.push(spec); return { index: answers.shift() ?? 0 }; },
    install: async (r) => { installs.push(r); },
  };
  return { deps, alerts, installs, storage, fetches: () => fetches };
}

test("checkForUpdates: the site does nothing", async () => {
  const h = harness({ mode: "site" });
  assert.equal(await checkForUpdates(h.deps), "site");
  assert.equal(h.fetches(), 0);
});

test("checkForUpdates: newer -> alert; Install installs", async () => {
  const h = harness({ answers: [1] });
  assert.equal(await checkForUpdates(h.deps), "install");
  assert.equal(h.alerts[0].title, "iFizBox 0.2.0 Is Available");
  assert.deepEqual(h.installs, [release]);
  const st = loadState(h.storage);
  assert.equal(st.lastCheck, 1_800_000_000_000);
  assert.equal(st.latest.version, "0.2.0");
  assert.equal(st.current, "0.1.0");
});

test("checkForUpdates: at most once a day", async () => {
  const t = 1_800_000_000_000;
  const h = harness({ t });
  await checkForUpdates(h.deps); // Later
  assert.equal(h.fetches(), 1);
  h.deps.now = () => t + DAY - 1;
  assert.equal(await checkForUpdates(h.deps), "not-due");
  assert.equal(h.fetches(), 1);
  h.deps.now = () => t + DAY;
  assert.equal(await checkForUpdates(h.deps), "later"); // asked again: Later again
  assert.equal(h.fetches(), 2);
  assert.equal(h.alerts.length, 2);
});

test("checkForUpdates: Later asks again on the next launch a day on", async () => {
  const t = 1_800_000_000_000;
  const storage = memStorage();
  const h = harness({ t, storage, answers: [0] });
  assert.equal(await checkForUpdates(h.deps), "later");
  assert.equal(loadState(storage).laterAt, t);
  assert.equal(loadState(storage).laterVersion, "0.2.0");
  // A failed check the same day, or a cleared gate: Later still holds within the day.
  saveState(storage, { lastCheck: null });
  const h2 = harness({ t: t + 60_000, storage });
  assert.equal(await checkForUpdates(h2.deps), "later");
  assert.equal(h2.alerts.length, 0);
  const h3 = harness({ t: t + 60_000 + DAY, storage, answers: [1] }); // h2 was the day's check
  assert.equal(await checkForUpdates(h3.deps), "install");
  assert.equal(loadState(storage).laterAt, undefined);
});

test("checkForUpdates: Skip This Version", async () => {
  const storage = memStorage();
  setSkip(storage, "0.2.0");
  const h = harness({ storage });
  assert.equal(await checkForUpdates(h.deps), "skipped");
  assert.equal(h.alerts.length, 0);
  // the next version is offered again
  const next = parseRelease({ ...GH, tag_name: "v0.3.0" });
  const h2 = harness({ storage, rel: next, t: 1_800_000_000_000 + DAY });
  assert.equal(await checkForUpdates(h2.deps), "later");
  assert.equal(h2.alerts[0].title, "iFizBox 0.3.0 Is Available");
  // Check for Updates offers even a skipped one
  saveState(storage, { skip: "0.2.0", laterAt: null });
  const h3 = harness({ storage, answers: [1] });
  assert.equal(await checkForUpdates(h3.deps, { manual: true }), "install");
});

test("checkForUpdates: up to date and errors", async () => {
  const h = harness({ current: "0.2.0" });
  assert.equal(await checkForUpdates(h.deps), "current");
  assert.equal(h.alerts.length, 0);
  const m = harness({ current: "0.2.0" });
  assert.equal(await checkForUpdates(m.deps, { manual: true }), "current");
  assert.equal(m.alerts[0].title, "iFizBox Is Up to Date");
  assert.equal(m.alerts[0].message, "iFizBox 0.2.0 is the newest version.");
  const n = harness({ rel: null });
  assert.equal(await checkForUpdates(n.deps), "current"); // no usable release (rate limit, odd tag)
  const e = harness({ fail: new Error("offline") });
  assert.equal(await checkForUpdates(e.deps), "error");
  assert.equal(e.alerts.length, 0);
  assert.equal(loadState(e.storage).lastCheck, undefined); // a failed check is retried next launch
  const em = harness({ fail: new Error("offline") });
  assert.equal(await checkForUpdates(em.deps, { manual: true }), "error");
  assert.equal(em.alerts[0].title, "Couldn't Check for Updates");
  // a manual check leaves the daily gate alone
  const g = harness({ current: "0.2.0" });
  await checkForUpdates(g.deps, { manual: true });
  assert.equal(loadState(g.storage).lastCheck, undefined);
});

// ---- the install paths

function installDeps(over = {}) {
  const alerts = [], went = [], signed = [], calls = [], huds = [];
  const deps = {
    status: async () => ({ identity: { name: "iPhone Distribution: Me" } }),
    installOnDevice: async (o) => { signed.push(o); return true; },
    alert: async (spec) => { alerts.push(spec); return { index: over.answer ?? 0 }; },
    go: (p) => went.push(p),
    arch: "iphoneos-arm64",
    hud: (text) => { const h = { texts: [text], hidden: false, set: (t) => h.texts.push(t), hide: () => { h.hidden = true; } }; huds.push(h); return h; },
    native: {
      call: async (m, p) => { calls.push([m, p]); if (m === "selfupdate.download") return { path: "/var/mobile/tmp/Cydian-update.deb", bytes: 9 }; return null; },
      helper: async (words) => { calls.push(["helper", words]); return { code: 0, stdout: "", stderr: "" }; },
    },
    ...over,
  };
  return { deps, alerts, went, signed, calls, huds };
}

test("runInstall sideload: signs Cydian.ipa on the phone", async () => {
  const d = installDeps();
  assert.equal(await runInstall(release, "sideload", d.deps), "installed");
  assert.deepEqual(d.signed, [{ url: release.ipa, name: "iFizBox" }]);
  assert.equal(d.calls.length, 0); // nothing through the helper
});

test("runInstall sideload: no certificate -> say so and open Settings > Signing", async () => {
  for (const status of [async () => ({ identity: null }), async () => { throw new Error("no signer"); }]) {
    const d = installDeps({ status });
    assert.equal(await runInstall(release, "sideload", d.deps), "no-certificate");
    assert.equal(d.alerts[0].title, "No Certificate");
    assert.deepEqual(d.went, [["signing"]]);
    assert.equal(d.signed.length, 0);
  }
});

test("runInstall sideload: a failed install and a release without an IPA", async () => {
  const d = installDeps({ installOnDevice: async () => false });
  assert.equal(await runInstall(release, "sideload", d.deps), "failed");
  const n = installDeps();
  assert.equal(await runInstall({ ...release, ipa: null }, "sideload", n.deps), "no-asset");
  assert.equal(n.alerts[0].title, "Can't Install");
});

test("runInstall jailbreak: download the arch's .deb, dpkg -i through the helper, offer to close", async () => {
  const d = installDeps({ answer: 1, arch: "iphoneos-arm64e" });
  assert.equal(await runInstall(release, "jailbreak", d.deps), "installed");
  assert.deepEqual(d.calls, [
    ["selfupdate.download", { url: "https://example.com/e.deb" }],
    ["helper", ["selfupdate", "/var/mobile/tmp/Cydian-update.deb"]],
    ["app.quit", {}],
  ]);
  assert.deepEqual(d.huds[0].texts, ["Downloading", "Installing"]);
  assert.equal(d.huds[0].hidden, true);
  assert.equal(d.alerts[0].title, "iFizBox Updated");
  assert.deepEqual(d.alerts[0].buttons, ["Later", "Close iFizBox"]);
  assert.equal(d.signed.length, 0); // never the signer
  const later = installDeps({ answer: 0 });
  await runInstall(release, "jailbreak", later.deps);
  assert.equal(later.calls.some(([m]) => m === "app.quit"), false);
});

test("runInstall jailbreak: failures", async () => {
  const dpkg = installDeps();
  dpkg.deps.native.helper = async () => ({ code: 1, stdout: "", stderr: "dpkg: error\ndpkg: bad archive\n" });
  assert.equal(await runInstall(release, "jailbreak", dpkg.deps), "failed");
  assert.match(dpkg.alerts[0].message, /dpkg failed \(1\): dpkg: bad archive/);
  const dl = installDeps();
  dl.deps.native.call = async () => { throw new Error("upstream: not a .deb"); };
  assert.equal(await runInstall(release, "jailbreak", dl.deps), "failed");
  assert.equal(dl.alerts[0].title, "Couldn't Update");
  assert.equal(dl.huds[0].hidden, true);
  const none = installDeps({ arch: "iphoneos-arm" });
  assert.equal(await runInstall(parseRelease({ tag_name: "v1.0.0", assets: [GH.assets[1]] }), "jailbreak", none.deps), "no-asset");
  assert.match(none.alerts[0].message, /iphoneos-arm/);
});

test("runInstall: the site has nothing to install", async () => {
  assert.equal(await runInstall(release, "site", installDeps().deps), "site");
});

test("always (every launch): offers even right after a check or a Later, silent when current, a skipped version stays skipped", async () => {
  const { checkForUpdates } = await import("./selfupdate.js");
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const alerts = [];
  const deps = (version) => ({ mode: "sideload", storage, now: () => 1000, current: async () => "0.3.0",
    release: async () => ({ version, assets: [] }), alert: async (a) => { alerts.push(a); return { index: 0 }; }, install: async () => {} });
  assert.equal(await checkForUpdates(deps("0.3.1"), { always: true }), "later"); // offered; Later pressed
  assert.equal(await checkForUpdates(deps("0.3.1"), { always: true }), "later"); // offered again at once
  assert.equal(alerts.length, 2);
  assert.equal(await checkForUpdates(deps("0.3.0"), { always: true }), "current");
  assert.equal(alerts.length, 2); // nothing new: no alert
});
