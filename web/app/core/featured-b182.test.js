// B182: Chariz's banners in the sideload app opened "Package not found": a Tweak Source keeps only injectable tweaks,
// so most banner packages aren't in the catalog. Only banners the catalog has for the source are drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeatured, bannersInCatalog } from "./featured.js";
import { createCatalog } from "./catalog.js";

// repo.chariz.com on 2026-11-20, trimmed: its sileo-featured.json shape and the banner packages' newest stanzas.
const FEATURED = JSON.stringify({
  class: "FeaturedBannersView", itemSize: "{263, 148}", itemCornerRadius: 10, banners: [
    { title: "Mitsuha Forever", package: "com.ryannair05.mitsuhaforever", url: "https://cdn.chariz.cloud/sileo-banner/mitsuha-forever.jpg", displayText: false },
    { title: "SwitchShades", package: "com.anthopak.switchshades", url: "https://cdn.chariz.cloud/a/switchshades.jpg", displayText: false },
    { title: "LockShut", package: "com.greg0109.lockshut", url: "https://cdn.chariz.cloud/sileo-banner/lockshut.jpg", displayText: false },
    { title: "SwitchShades", package: "com.anthopak.switchshades", url: "https://cdn.chariz.cloud/a/switchshades.jpg", displayText: false },
    { title: "Drift", package: "com.antonym.drift", url: "https://cdn.chariz.cloud/a/drift.jpg", displayText: false },
  ],
});

const PACKAGES = `Package: com.ryannair05.mitsuhaforever
Version: 1.4.3
Architecture: iphoneos-arm
Section: Tweaks
Depends: mobilesubstrate, preferenceloader, com.ryannair05.libmitsuhaforever (>=1.4.0), ws.hbang.alderis, firmware (>=11.0)
Name: Mitsuha Forever
Tag: compatible_min::ios12.0
Filename: debs/com.ryannair05.mitsuhaforever_1.4.3_iphoneos-arm.deb

Package: com.anthopak.switchshades
Version: 1.2
Architecture: iphoneos-arm64
Section: Tweaks
Depends: mobilesubstrate, preferenceloader, ws.hbang.common (>= 1.14), firmware (>= 11.0)
Name: SwitchShades
Tag: cydia::commercial, compatible_min::ios11.0
Filename: debs/com.anthopak.switchshades_1.2_iphoneos-arm64.deb

Package: com.greg0109.lockshut
Name: LockShut
Architecture: iphoneos-arm
Version: 1.1.1
Section: Tweaks
Tag: cydia::commercial, compatible_min::ios13.0
Depends: firmware (>= 13.0), mobilesubstrate, preferenceloader
Filename: debs/com.greg0109.lockshut_1.1.1_iphoneos-arm.deb

Package: com.antonym.drift
Version: 1.1.0
Architecture: iphoneos-arm64
Section: Tweaks
Depends: mobilesubstrate, preferenceloader, firmware (>= 15.0)
Name: Drift
Tag: cydia::commercial, compatible_min::ios15.0
Filename: debs/com.antonym.drift_1.1.0_iphoneos-arm64.deb
`;

const KEY = "https://repo.chariz.com/";
const base = "https://repo.chariz.com/sileo-featured.json";

test("B182: sideload Tweak Source: only banners whose package the catalog loaded, each one opens", async () => {
  const c = createCatalog();
  c.setDevice({ ios: "17.0", jailbreak: "none" }); // the sideload app on a phone without a jailbreak
  c.load(KEY, PACKAGES, KEY, "iphoneos-arm64", { tweaks: true });
  const f = parseFeatured(FEATURED, base);
  assert.equal(f.banners.length, 5);
  // The bug: these banners point at packages the tweak filter dropped, so their page is "Package not found".
  assert.equal(c.package("com.ryannair05.mitsuhaforever", KEY), null);
  assert.equal(c.package("com.anthopak.switchshades", KEY), null);
  const kept = await bannersInCatalog(f.banners, (id) => c.package(id, KEY));
  assert.deepEqual(kept.map((b) => b.package), ["com.greg0109.lockshut", "com.antonym.drift"]);
  for (const b of kept) assert.ok(c.package(b.package, KEY), `${b.package} opens its page`);
});

test("B182: jailbreak (rootless) catalog: the iphoneos-arm-only banners drop out, arm64 ones stay", async () => {
  const c = createCatalog();
  c.load(KEY, PACKAGES, KEY, "iphoneos-arm64");
  const f = parseFeatured(FEATURED, base);
  const kept = await bannersInCatalog(f.banners, (id) => c.package(id, KEY));
  assert.deepEqual(kept.map((b) => b.package), ["com.anthopak.switchshades", "com.anthopak.switchshades", "com.antonym.drift"]);
});

test("bannersInCatalog: async lookups, order kept, each id asked once, a throwing lookup counts as missing", async () => {
  const asked = [];
  const banners = [{ package: "a" }, { package: "b" }, { package: "a" }, { package: "c" }];
  const kept = await bannersInCatalog(banners, async (id) => {
    asked.push(id);
    if (id === "c") throw new Error("worker down");
    return id === "a" ? { stanza: {} } : null;
  });
  assert.deepEqual(kept, [{ package: "a" }, { package: "a" }]);
  assert.deepEqual(asked.sort(), ["a", "b", "c"]);
  assert.deepEqual(await bannersInCatalog(null, () => true), []);
});
