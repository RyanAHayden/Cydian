// F329: your own app icon: Move and Scale's crop maths and the stored list (screens/appicon.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cropStart, clampCrop, panCrop, zoomCrop, cropRect, readList, labelFor, picksOf, missingPicks, dropMissing, ownIconsOffered, pickOwn, resignMessage, RESIGN_TITLE, OUT, ZOOM } from "./appicon.js";
import { createSettings, iconFor, isOwnIcon } from "../core/settings.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} != ${b}`);

test("a picture starts filling the square, centred, short side edge to edge", () => {
  const c = cropStart(4000, 3000, 300); // landscape
  near(c.s, 0.1);
  near(c.min, 0.1);
  near(c.max, 0.1 * ZOOM);
  near(c.ty, 0);
  near(c.tx, (300 - 400) / 2);
  const r = cropRect(c);
  near(r.size, 3000);
  near(r.sx, 500);
  near(r.sy, 0);
  const p = cropRect(cropStart(1000, 2000, 250)); // portrait: the middle square
  near(p.size, 1000);
  near(p.sx, 0);
  near(p.sy, 500);
});

test("the picture always covers the square: panning stops at its edges", () => {
  const c = cropStart(4000, 3000, 300);
  const right = panCrop(c, 1000, 1000);
  near(right.tx, 0);
  near(right.ty, 0);
  near(cropRect(right).sx, 0);
  const left = panCrop(c, -1000, 0);
  near(left.tx, 300 - 400);
  near(cropRect(left).sx + cropRect(left).size, 4000, "right edge at the picture's");
});

test("zoom keeps the point under the fingers, and stays between the smallest fill and ZOOM times it", () => {
  const c = cropStart(1000, 1000, 200); // s 0.2, no room to pan
  const z = zoomCrop(c, 2, 50, 50);
  near(z.s, 0.4);
  // the picture point under (50, 50) before (250, 250) is still there
  near((50 - z.tx) / z.s, 250);
  near((50 - z.ty) / z.s, 250);
  near(cropRect(z).size, 500);
  near(zoomCrop(c, 100, 100, 100).s, 0.2 * ZOOM, "capped");
  near(zoomCrop(c, 0.01, 100, 100).s, 0.2, "never smaller than filling");
  const out = zoomCrop(z, 0.5, 0, 0); // back out: clamped so the picture still covers
  near(out.tx, 0);
  near(out.ty, 0);
});

test("the source rect never passes the picture's edge (iOS 15 draws nothing then)", () => {
  for (const [w, h, side] of [[1200, 1200, 323.5], [1200, 1200, 0.1 + 0.2], [997, 1601, 333.3333], [4032, 3024, 287.7]]) {
    for (const c of [cropStart(w, h, side), panCrop(zoomCrop(cropStart(w, h, side), 3.3, side, side), -1e6, -1e6)]) {
      const r = cropRect(c);
      assert.ok(r.sx >= 0 && r.sy >= 0, `${w}x${h} starts inside`);
      assert.ok(r.sx + r.size <= w && r.sy + r.size <= h, `${w}x${h} ends inside: ${r.sx + r.size}, ${r.sy + r.size}`);
    }
  }
  const sq = cropRect(cropStart(1200, 1200, 323.5));
  near(sq.size, 1200);
  assert.ok(sq.size <= 1200);
});

test("clampCrop mends a crop pushed outside", () => {
  const c = clampCrop({ w: 100, h: 100, side: 100, min: 1, max: 4, s: 0.5, tx: 30, ty: -500 });
  near(c.s, 1);
  near(c.tx, 0);
  near(c.ty, 0);
  assert.equal(OUT, 1024);
});

test("the stored list keeps only the shell's well-formed entries, in order", () => {
  assert.deepEqual(readList(null), []);
  assert.deepEqual(readList({ icons: [{ name: "own1a" , label: "Sunset" }, { name: "../x", label: "bad" }, { name: "classic" },
    { name: "own2b", label: "" }, null] }), [{ name: "own1a", label: "Sunset" }, { name: "own2b", label: "Icon" }]);
  assert.equal(readList({ icons: [{ name: "own1", label: "x".repeat(40) }] })[0].label.length, 24);
});

test("a new picture is labelled by its file name, or Icon <n> when iOS gives it none", () => {
  assert.equal(labelFor("Sunset.HEIC"), "Sunset");
  assert.equal(labelFor("my_dog-photo.png"), "my dog photo");
  assert.equal(labelFor("image.jpeg"), "Icon 1");
  assert.equal(labelFor("image.jpeg", [{ name: "own1", label: "Icon 1" }]), "Icon 2");
  assert.equal(labelFor("IMG_0042.JPG", [{ name: "own1", label: "Icon 2" }]), "Icon 1");
  assert.equal(labelFor(""), "Icon 1");
});

test("own icon names: what the shell makes, and nothing that could leave its folder", () => {
  for (const ok of ["own1", "ownmhw3k2x1ab"]) assert.ok(isOwnIcon(ok), ok);
  for (const bad of ["own", "own-1", "own/../x", "OWN1", "classic", "own12345678901234567", null, 3]) assert.ok(!isOwnIcon(bad), String(bad));
});

test("Light and Dark take an own icon; iconFor gives it; deleting it puts the picks back", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const s = createSettings({ storage, mode: "jailbreak" });
  s.set("iconMatch", false);
  s.set("darkIcon", "ownabc");
  assert.equal(s.get("darkIcon"), "ownabc");
  assert.throws(() => s.set("darkIcon", "own/../../x"));
  assert.equal(iconFor("dark", (k) => s.get(k)), "ownabc");
  assert.equal(iconFor("light", (k) => s.get(k)), s.get("lightTheme"));
  assert.deepEqual(picksOf("ownabc", (k) => s.get(k)), ["darkIcon"]);
  s.set("lightIcon", "ownabc");
  assert.deepEqual(picksOf("ownabc", (k) => s.get(k)), ["lightIcon", "darkIcon"]);
  // a pick the shell no longer keeps goes back to the theme's icon; kept ones stay
  assert.deepEqual(missingPicks([{ name: "ownabc", label: "x" }], (k) => s.get(k)), []);
  s.set("darkIcon", "owngone");
  assert.deepEqual(missingPicks([{ name: "ownabc", label: "x" }], (k) => s.get(k)), ["darkIcon"]);
  dropMissing(s, [{ name: "ownabc", label: "x" }]);
  assert.equal(s.get("darkIcon"), "theme");
  assert.equal(s.get("lightIcon"), "ownabc");
});

test("Add is offered in both apps (Lite re-signs itself to apply one), and never without a bridge", () => {
  const native = { call: async () => ({}) };
  assert.equal(ownIconsOffered("jailbreak", native), true);
  assert.equal(ownIconsOffered("sideload", native), true);
  assert.equal(ownIconsOffered("site", native), false);
  assert.equal(ownIconsOffered("jailbreak", undefined), false);
});

// F329a: Lite applies a picture by re-signing itself first, after asking.
function fakes({ ready = null, tap = 1, ok = true, readyFails = false } = {}) {
  const calls = [], alerts = [], installs = [];
  const values = { lightIcon: "theme" };
  const store = { get: (k) => values[k], set: (k, v) => { values[k] = v; } };
  const native = { call: async (m, p) => { calls.push([m, p]); if (readyFails) throw new Error("no such call"); return ready; } };
  const alert = async (a) => { alerts.push(a); return { index: tap }; };
  const install = async (o) => { installs.push(o); return ok; };
  return { calls, alerts, installs, values, store, native, alert, install };
}

test("the jailbreak app, or Lite with the picture in its bundle already, picks it straight away", async () => {
  const jb = fakes();
  assert.equal(await pickOwn("lightIcon", "owna1", jb.store, { native: jb.native, mode: "jailbreak", alert: jb.alert, install: jb.install }), "set");
  assert.equal(jb.values.lightIcon, "owna1");
  assert.deepEqual(jb.calls, [], "no question to the shell");
  const lite = fakes({ ready: { ready: true, canResign: true } });
  assert.equal(await pickOwn("lightIcon", "owna1", lite.store, { native: lite.native, mode: "sideload", alert: lite.alert, install: lite.install }), "set");
  assert.deepEqual(lite.calls, [["app.icon.ready", { name: "owna1" }]]);
  assert.equal(lite.alerts.length + lite.installs.length, 0);
  assert.equal(await pickOwn("lightIcon", "owna1", lite.store, { native: lite.native, mode: "sideload" }), "same");
});

test("Lite asks before re-signing itself, and Install hands the picture to its own update", async () => {
  const f = fakes({ ready: { ready: false, canResign: true } });
  assert.equal(await pickOwn("lightIcon", "owna1", f.store, { native: f.native, mode: "sideload", alert: f.alert, install: f.install }), "installing");
  assert.equal(f.alerts[0].title, RESIGN_TITLE);
  assert.deepEqual(f.alerts[0].buttons, ["Cancel", "Install"]);
  assert.match(f.alerts[0].message, /about as long as an update/);
  assert.match(f.alerts[0].message, /open .* again/);
  assert.deepEqual(f.installs[0].params, { selfIcon: "owna1" });
  assert.equal(f.installs[0].host, true);
  assert.equal(f.values.lightIcon, "owna1", "kept for the reopened app to switch to");
});

test("Lite's Cancel changes nothing; a failed re-sign puts the pick back; an old build says so", async () => {
  const no = fakes({ ready: { ready: false, canResign: true }, tap: 0 });
  assert.equal(await pickOwn("lightIcon", "owna1", no.store, { native: no.native, mode: "sideload", alert: no.alert, install: no.install }), "cancelled");
  assert.equal(no.values.lightIcon, "theme");
  assert.equal(no.installs.length, 0);
  const bad = fakes({ ready: { ready: false, canResign: true }, ok: false });
  assert.equal(await pickOwn("lightIcon", "owna1", bad.store, { native: bad.native, mode: "sideload", alert: bad.alert, install: bad.install }), "failed");
  assert.equal(bad.values.lightIcon, "theme");
  const old = fakes({ ready: { ready: false, canResign: false } });
  assert.equal(await pickOwn("lightIcon", "owna1", old.store, { native: old.native, mode: "sideload", alert: old.alert, install: old.install }), "old");
  assert.equal(old.alerts[0].title, "Can't Use This Icon");
  assert.equal(old.values.lightIcon, "theme");
  const older = fakes({ readyFails: true });
  assert.equal(await pickOwn("lightIcon", "owna1", older.store, { native: older.native, mode: "sideload", alert: older.alert, install: older.install }), "set");
});

test("the re-sign message names the app and says it switches once opened again", () => {
  assert.match(resignMessage("Box"), /^Box puts your icon in by re-signing itself/);
  assert.match(resignMessage("Box"), /when you open Box again it switches to your icon\.$/);
});
