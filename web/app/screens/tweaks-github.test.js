// F304: a GitHub release's tweak that is a bare .dylib (core/github.js X-GitHub-Asset: dylib): no .deb to read, so it
// goes into any app it is added to, and is kept under a .dylib name (prepareTweaks injects it as it is).
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { tweakInfo, addDebTo, savedTweaks, isDylibTweak } from "./tweaks.js";
import { memoryIpaStore } from "../core/myipas.js";

const storage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const st = { package: "com.github.dayanch96.ytlite", name: "YTLite", version: "5.1", debUrl: "https://github.com/x/YTLite.dylib", "x-github-asset": "dylib" };

test("a .dylib tweak: any app, kept as .dylib, its file never unpacked as a .deb", async () => {
  assert.equal(isDylibTweak(st), true);
  assert.equal(isDylibTweak({ ...st, "x-github-asset": "deb" }), false);
  let fetched = 0;
  const info = await tweakInfo(st, { fetchDeb: async () => { fetched++; return new Uint8Array([0xcf, 0xfa, 0xed, 0xfe]); }, storage: storage() });
  assert.equal(info.ok, true);
  assert.equal(info.anyApp, true);
  assert.equal(fetched, 0, "nothing to read before Add to App");
  const mem = memoryIpaStore();
  const store = async () => mem;
  await addDebTo("com.google.ios.youtube", st, new Uint8Array([1]), { store });
  await addDebTo("com.google.ios.youtube", { ...st, version: "5.2", "x-github-asset": "deb" }, new Uint8Array([2]), { store });
  assert.deepEqual((await savedTweaks("com.google.ios.youtube", { store })).map((x) => x.name), ["com.github.dayanch96.ytlite_5.2.deb"],
    "a newer release of the same tweak replaces it");
});
