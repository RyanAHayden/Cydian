// B185: a library for other tweaks (Comet: "A SwiftUI Prefs Framework", Section Tweaks on Chariz) is never offered
// as something to add to an app: tweakInfo answers from its fields without downloading the .deb, the package page's
// group and Add to App say so in plain words, and a refusal an older build cached (with the old jargon) is checked again.
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tweakInfo, cachedTweakInfo, addToApp, INFO_KEY } from "./tweaks.js";
import { LIBRARY_WHY, prepareTweaks } from "../core/tweaks.js";

const fx = (n) => new Uint8Array(readFileSync(new URL(`../core/fixtures/tweaks/${n}`, import.meta.url)));
const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const COMET = { package: "com.ginsu.comet", name: "Comet", version: "2.0.1", architecture: "iphoneos-arm64", section: "Tweaks",
  description: "A SwiftUI Prefs Framework", depends: "dev.theos.orion14, firmware (>= 14.0)", debUrl: "https://repo.chariz.com/debs/comet.deb" };

test("tweakInfo: Comet is a library, answered without downloading its .deb", async () => {
  const s = storage();
  let fetched = 0;
  const info = await tweakInfo(COMET, { fetchDeb: async () => { fetched++; return new Uint8Array(0); }, storage: s });
  assert.equal(fetched, 0);
  assert.equal(info.ok, false);
  assert.equal(info.library, true);
  assert.equal(info.why, LIBRARY_WHY);
  assert.equal(cachedTweakInfo(COMET, { storage: s }).library, true);
});

test("Add to App on Comet: no app picker, the plain reason", async () => {
  const shown = [];
  let picked = false;
  const r = await addToApp(COMET, { storage: storage(), hud: () => () => {}, apps: async () => [{ bundleId: "com.x", name: "X" }],
    alert: async (a) => { shown.push(a); return 0; }, pick: async () => { picked = true; return null; }, fetchDeb: async () => { throw new Error("no download"); } });
  assert.equal(r, null);
  assert.equal(picked, false);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].message, LIBRARY_WHY);
  assert.doesNotMatch(`${shown[0].title} ${shown[0].message}`, /\/|\.dylib|\.plist|inject/i);
});

test("a refusal cached by an older build is checked again; a kept good answer stays", async () => {
  const s = storage();
  s.setItem(INFO_KEY, JSON.stringify({
    "com.ginsu.comet@2.0.1": { ok: false, why: "Nothing to inject: no .dylib in Library/MobileSubstrate/DynamicLibraries.", bundles: [], anyApp: false },
    "com.t.yt@2": { ok: true, bundles: ["com.x.tube"], anyApp: false },
  }));
  assert.equal(cachedTweakInfo(COMET, { storage: s }), null);
  assert.deepEqual(cachedTweakInfo({ package: "com.t.yt", version: "2" }, { storage: s }).bundles, ["com.x.tube"]);
  assert.equal((await tweakInfo(COMET, { storage: s, fetchDeb: async () => new Uint8Array(0) })).why, LIBRARY_WHY);
});

test("a real app tweak still checks out and still injects", async () => {
  const st = { package: "com.me.fixture", name: "Fixture", version: "1.0", section: "Tweaks", description: "A tweak for the fixture app",
    depends: "mobilesubstrate", debUrl: "https://repo.x/fixture.deb" };
  const data = fx("tweak-xz.deb");
  const info = await tweakInfo(st, { storage: storage(), fetchDeb: async () => data });
  assert.equal(info.ok, true, info.why);
  assert.deepEqual(info.bundles, ["com.me.fixture"]);
  const prepared = prepareTweaks([{ name: "com.me.fixture_1.0.deb", data }]);
  assert.equal(prepared.inject.length, 1, "its .dylib is injected");
});
