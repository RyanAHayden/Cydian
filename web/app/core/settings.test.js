import { test } from "node:test";
import assert from "node:assert/strict";
import { createSettings, detectMode, themeFor, SETTINGS, FEATURES } from "./settings.js";
import { DEFAULT_ARCH } from "./apt.js";

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}
const everything = new Set(SETTINGS.map((d) => d.feature));
const keysOf = (s) => s.visible().map((d) => d.key);

test("defaults with nothing stored", () => {
  const s = createSettings({ storage: memStorage(), mode: "site" });
  assert.equal(s.get("appearance"), "auto");
  assert.equal(s.get("arch"), DEFAULT_ARCH);
  assert.equal(s.get("checkUpdates"), "launch");
  assert.equal(s.get("notifications"), "summary");
  assert.equal(s.get("badge"), true);
  assert.equal(s.get("autoInstall"), "off");
  assert.equal(s.get("respring"), "notify");
  assert.equal(s.get("keepVersions"), 1);
  assert.deepEqual(s.holds.list(), []);
});

test("refresh on launch is off on the site and on in the app", () => {
  assert.equal(createSettings({ storage: memStorage(), mode: "site" }).get("refreshOnLaunch"), false);
  assert.equal(createSettings({ storage: memStorage(), mode: "jailbreak" }).get("refreshOnLaunch"), true);
  assert.equal(createSettings({ storage: memStorage(), mode: "sideload" }).get("refreshOnLaunch"), true);
});

test("values persist in storage under cydian.<key> and a new store reads them back", () => {
  const storage = memStorage();
  const a = createSettings({ storage, mode: "jailbreak" });
  a.set("appearance", "dark");
  a.set("arch", "iphoneos-arm");
  a.set("refreshOnLaunch", false);
  a.set("keepVersions", 2);
  assert.equal(storage.map.get("cydian.appearance"), "dark");
  assert.equal(storage.map.get("cydian.arch"), "iphoneos-arm"); // where backend.js getArch() reads it
  const b = createSettings({ storage, mode: "jailbreak" });
  assert.equal(b.get("appearance"), "dark");
  assert.equal(b.get("arch"), "iphoneos-arm");
  assert.equal(b.get("refreshOnLaunch"), false);
  assert.equal(b.get("keepVersions"), 2); // a number again, not "2"
});

test("a stored value that is not an option reads as the default", () => {
  const s = createSettings({ storage: memStorage({ "cydian.appearance": "purple", "cydian.arch": "x86" }) });
  assert.equal(s.get("appearance"), "auto");
  assert.equal(s.get("arch"), DEFAULT_ARCH);
});

test("set refuses values outside the options and unknown keys", () => {
  const s = createSettings({ storage: memStorage() });
  assert.throws(() => s.set("appearance", "purple"));
  assert.throws(() => s.set("keepVersions", "2"));
  assert.throws(() => s.get("nope"));
});

test("listeners hear changes and can unsubscribe", () => {
  const s = createSettings({ storage: memStorage() });
  const heard = [];
  const off = s.onChange((k, v) => heard.push([k, v]));
  s.set("appearance", "light");
  off();
  s.set("appearance", "dark");
  assert.deepEqual(heard, [["appearance", "light"]]);
});

test("storage that throws (private mode) keeps values for the session", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  const s = createSettings({ storage: broken });
  s.set("appearance", "dark");
  assert.equal(s.get("appearance"), "dark");
});

test("holds: per package, sorted, stored on the device", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  s.holds.set("com.b", true);
  s.holds.set("com.a", true);
  s.holds.set("com.b", false);
  assert.deepEqual(s.holds.list(), ["com.a"]);
  assert.equal(s.holds.has("com.a"), true);
  assert.deepEqual(createSettings({ storage }).holds.list(), ["com.a"]);
  s.holds.replace(["z", "y", "y"]); // what apt-mark showhold reports, in jailbreak mode
  assert.deepEqual(s.holds.list(), ["y", "z"]);
  assert.deepEqual(createSettings({ storage: memStorage({ "cydian.holds": "{bad" }) }).holds.list(), []);
});

// A stand-in for the bridge's cydianNative.helper: records the words, answers like cydian-helper and apt-mark.
function fakeHelper({ held = [], fail = new Set() } = {}) {
  const calls = [];
  const dpkg = new Set(held);
  const helper = async (words) => {
    calls.push(words.join(" "));
    const [verb, ...pkgs] = words;
    if (fail.has(verb)) return { code: 100, stdout: "" };
    if (verb === "hold") pkgs.forEach((p) => dpkg.add(p));
    else if (verb === "unhold") pkgs.forEach((p) => dpkg.delete(p));
    else if (verb === "showhold") return { code: 0, stdout: [...dpkg].map((p) => p + "\n").join("") };
    else return { code: 64, stdout: "" };
    return { code: 0, stdout: "" };
  };
  return { helper, calls, dpkg };
}

test("holds in jailbreak mode: apt-mark hold/unhold through the helper", async () => {
  const f = fakeHelper();
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: f.helper });
  const pending = s.holds.set("com.b", true);
  assert.deepEqual(s.holds.list(), ["com.b"]); // the row changes at once
  assert.equal(await pending, true);
  assert.equal(await s.holds.set("com.a", true), true);
  assert.equal(await s.holds.set("com.b", false), true);
  assert.deepEqual(f.calls, ["hold com.b", "hold com.a", "unhold com.b"]);
  assert.deepEqual([...f.dpkg], ["com.a"]);
  assert.deepEqual(s.holds.list(), ["com.a"]);
});

test("holds in jailbreak mode: a refused hold puts dpkg's list back", async () => {
  const f = fakeHelper({ held: ["com.x"], fail: new Set(["hold"]) });
  const s = createSettings({ storage: memStorage(), mode: "jailbreak", helper: f.helper });
  assert.equal(await s.holds.set("com.a", true), false);
  assert.deepEqual(s.holds.list(), ["com.x"]);
  assert.deepEqual(f.calls, ["hold com.a", "showhold"]);

  const g = fakeHelper({ fail: new Set(["unhold", "showhold"]) });
  const t = createSettings({ storage: memStorage({ "cydian.holds": '["com.a"]' }), mode: "jailbreak", helper: g.helper });
  assert.equal(await t.holds.set("com.a", false), false);
  assert.deepEqual(t.holds.list(), ["com.a"]); // showhold failed too: the list as it was
});

test("holds.sync takes apt-mark showhold's list, and tells listeners only of a change", async () => {
  const f = fakeHelper({ held: ["z.pkg", "a.pkg"] });
  const s = createSettings({ storage: memStorage({ "cydian.holds": '["old.pkg"]' }), mode: "jailbreak", helper: f.helper });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  assert.deepEqual(await s.holds.sync(), ["a.pkg", "z.pkg"]);
  assert.deepEqual(await s.holds.sync(), ["a.pkg", "z.pkg"]);
  assert.deepEqual(heard, [["holds", ["a.pkg", "z.pkg"]]]);
  const broken = createSettings({ storage: memStorage({ "cydian.holds": '["k"]' }), mode: "jailbreak",
    helper: fakeHelper({ fail: new Set(["showhold"]) }).helper });
  await assert.rejects(broken.holds.sync());
  assert.deepEqual(broken.holds.list(), ["k"]);
});

test("holds: the helper is only used in jailbreak mode", async () => {
  for (const mode of ["site", "sideload"]) {
    const f = fakeHelper({ held: ["dpkg.one"] });
    const s = createSettings({ storage: memStorage(), mode, helper: f.helper });
    assert.equal(await s.holds.set("com.a", true), true);
    assert.deepEqual(await s.holds.sync(), ["com.a"]);
    assert.deepEqual(f.calls, []);
  }
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" }); // no bridge helper yet: a local list
  assert.equal(await s.holds.set("com.a", true), true);
  assert.deepEqual(await s.holds.sync(), ["com.a"]);
});

test("rows each mode shows once every feature exists", () => {
  const show = (mode) => keysOf(createSettings({ storage: memStorage(), mode, features: everything }));
  assert.deepEqual(show("site"),
    ["appearance", "allowZoom", "arch", "refreshOnLaunch", "checkUpdates", "holds", "notifications", "badge"]);
  assert.deepEqual(show("jailbreak"),
    ["appearance", "allowZoom", "arch", "refreshOnLaunch", "checkUpdates", "cellular", "holds", "notifications", "badge",
      "autoInstall", "autoInstallIdle", "respring", "keepVersions"]);
  assert.deepEqual(show("sideload"),
    ["appearance", "allowZoom", "refreshOnLaunch", "checkUpdates", "cellular", "holds", "notifications", "badge", "resignReminder"]);
});

test("rows wait for their feature: today only Appearance and the sources settings", () => {
  const s = createSettings({ storage: memStorage(), mode: "jailbreak" });
  assert.deepEqual(keysOf(s), ["appearance", "allowZoom", "arch", "refreshOnLaunch"]);
  assert.equal(s.isShown("autoInstall"), false);
  assert.ok(FEATURES.has("appearance"));
  assert.deepEqual(createSettings({ storage: memStorage(), mode: "site", features: new Set(["appearance"]) })
    .sections().map((x) => x.id), ["appearance"]);
});

test("sections come in order, Appearance first, empty ones dropped", () => {
  const s = createSettings({ storage: memStorage(), mode: "sideload", features: everything });
  assert.deepEqual(s.sections().map((x) => x.id), ["appearance", "sources", "updates", "notifications", "signing"]);
  assert.equal(s.sections()[0].settings[0].key, "appearance");
});

test("mode-dependent footers", () => {
  const f = (mode) => createSettings({ storage: memStorage(), mode, features: everything }).footerOf("checkUpdates");
  assert.match(f("sideload"), /apps/);
  assert.match(f("jailbreak"), /packages/);
});

test("detectMode: the bridge says, otherwise the site", () => {
  assert.equal(detectMode({}), "site");
  assert.equal(detectMode({ cydianNative: {} }), "jailbreak");
  assert.equal(detectMode({ cydianNative: { mode: "sideload" } }), "sideload");
  assert.equal(detectMode({ cydianNative: { mode: "jailbreak" } }), "jailbreak");
  assert.equal(detectMode({ cydianNative: { mode: "weird" } }), "jailbreak");
  assert.throws(() => createSettings({ mode: "weird" }));
});

test("themeFor: Automatic follows the system", () => {
  assert.equal(themeFor("auto", true), "dark");
  assert.equal(themeFor("auto", false), "light");
  assert.equal(themeFor("dark", false), "dark");
  assert.equal(themeFor("light", true), "light");
});

test("hidden sections: sorted, stored on the device, listeners told only on a change", () => {
  const storage = memStorage();
  const s = createSettings({ storage, mode: "site" });
  const heard = [];
  s.onChange((k, v) => heard.push([k, v]));
  s.hiddenSections.set("Themes", true);
  s.hiddenSections.set("Addons", true);
  s.hiddenSections.set("Themes", true); // already hidden: no news
  assert.deepEqual(s.hiddenSections.list(), ["Addons", "Themes"]);
  assert.equal(s.hiddenSections.has("Themes"), true);
  assert.deepEqual(heard, [["hiddenSections", ["Themes"]], ["hiddenSections", ["Addons", "Themes"]]]);
  assert.deepEqual(createSettings({ storage }).hiddenSections.list(), ["Addons", "Themes"]);
  s.hiddenSections.set("Themes", false);
  assert.deepEqual(s.hiddenSections.list(), ["Addons"]);
  s.hiddenSections.replace(["b", "a", "a", 3]);
  assert.deepEqual(s.hiddenSections.list(), ["a", "b"]);
  assert.deepEqual(createSettings({ storage: memStorage({ "cydian.hiddenSections": "{bad" }) }).hiddenSections.list(), []);
});
