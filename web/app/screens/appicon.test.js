// F329: your own app icon: Move and Scale's crop maths and the stored list (screens/appicon.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cropStart, clampCrop, panCrop, zoomCrop, cropRect, readList, labelFor, picksOf, missingPicks, dropMissing, ownIconsOffered, OUT, ZOOM } from "./appicon.js";
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

test("Add is offered in the jailbreak app only (Lite can't apply one yet), and never without a bridge", () => {
  const native = { call: async () => ({}) };
  assert.equal(ownIconsOffered("jailbreak", native), true);
  assert.equal(ownIconsOffered("sideload", native), false);
  assert.equal(ownIconsOffered("site", native), false);
  assert.equal(ownIconsOffered("jailbreak", undefined), false);
});
