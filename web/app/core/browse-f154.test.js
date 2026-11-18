// F154: Browse's daily pick (Tweak of the Day), Collections, and Tweak Roulette's pool and spins, over a real catalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCatalog, runCatalog, dayKey, dayBefore, dailyPick, browseKind, COLLECTIONS, collection, collectionsFor,
  ROULETTE_TYPES, ROULETTE_PRICES, roulettePool, spinPick } from "./catalog.js";

const stanza = (f) => Object.entries(f).map(([k, v]) => `${k}: ${v}`).join("\n");
const packages = (...list) => list.map(stanza).join("\n\n") + "\n";
const deb = (id, section, extra = {}) => ({ Package: id, Name: id, Version: "1", Architecture: "iphoneos-arm64", Section: section, ...extra });
const ids = (rows) => rows.map((r) => r.id).sort();

const REPO = packages(
  deb("com.x.clock", "Widgets", { Name: "LockClock", Description: "A bigger clock on the lock screen" }),
  deb("com.x.notify", "Tweaks", { Name: "Banners", Description: "Notification banners your way" }),
  deb("com.x.dock", "Tweaks", { Name: "Docky", Description: "A five-icon dock for the Home Screen" }),
  deb("com.x.keys", "Keyboards", { Name: "KeySounds", Description: "Clicky keys" }),
  deb("com.x.swipe", "Tweaks", { Name: "SwipeType", Description: "Swipe on the keyboard to type" }),
  deb("com.x.theme", "Themes_(SpringBoard)", { Name: "Glass", Description: "A theme" }),
  deb("com.x.walls", "Wallpaper", { Name: "Walls", Description: "Wallpapers" }),
  deb("com.x.cat", "Toys", { Name: "Oneko", Description: "A cat chases your finger" }),
  deb("com.x.util", "Utilities", { Name: "Crashes", Description: "Readable crash logs" }),
  deb("com.x.paid", "Tweaks", { Name: "Premium", Description: "Costs money", Tag: "cydia::commercial" }),
  deb("com.x.lib", "Libraries", { Name: "libthing" }),
);
const ALT_KEY = "alt:https://apps.example/source.json";
const ALT_JSON = JSON.stringify({
  name: "Apps", identifier: "com.example.apps",
  apps: [
    { name: "Delta", bundleIdentifier: "com.example.delta", developerName: "R", subtitle: "Nintendo emulator", category: "games",
      localizedDescription: "plays games", versions: [{ version: "1.5", date: "2026-01-01", downloadURL: "https://apps.example/d.ipa", size: 1 }] },
    { name: "Chat", bundleIdentifier: "com.example.chat", developerName: "R", category: "social",
      localizedDescription: "talk", versions: [{ version: "2", date: "2026-06-01", downloadURL: "https://apps.example/c.ipa", size: 1 }] },
    { name: "Solitaire", bundleIdentifier: "com.example.cards", developerName: "R", category: "games",
      localizedDescription: "cards", versions: [{ version: "1", date: "2025-01-01", downloadURL: "https://apps.example/s.ipa", size: 1 }] },
  ],
});
function loaded() {
  const c = createCatalog();
  c.load("A", REPO, "https://a.example/");
  c.loadAlt(ALT_KEY, ALT_JSON, "16.5");
  return c;
}

test("dayKey and dayBefore: local calendar days, across months and years", () => {
  assert.equal(dayKey(new Date(2026, 10, 18, 0, 1).getTime()), "2026-11-18");
  assert.equal(dayKey(new Date(2026, 10, 18, 23, 59).getTime()), "2026-11-18");
  assert.equal(dayBefore("2026-11-18"), "2026-11-17");
  assert.equal(dayBefore("2026-03-01"), "2026-02-28");
  assert.equal(dayBefore("2024-03-01"), "2024-02-29");
  assert.equal(dayBefore("2027-01-01"), "2026-12-31");
});

test("dailyPick: the same package all day whatever order the rows come in; other days pick others", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `com.x.p${i}`, name: `P${i}` }));
  const day = "2026-11-18";
  const first = dailyPick(rows, day);
  assert.ok(rows.includes(first));
  for (let n = 0; n < 20; n++) {
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    assert.equal(dailyPick(shuffled, day).id, first.id, "order doesn't change the day's pick");
  }
  assert.equal(dailyPick([...rows, ...rows], day).id, first.id, "duplicates (featured and popular both) don't either");
  // Over a month the pick moves around: not one package every day.
  const month = new Set(Array.from({ length: 30 }, (_, d) => dailyPick(rows, dayKey(new Date(2026, 10, d + 1).getTime())).id));
  assert.ok(month.size > 10, `${month.size} different picks in 30 days`);
  assert.equal(dailyPick([], day), null);
  assert.equal(dailyPick(null, day), null);
});

test("browseKind: tweaks and themes when jailbroken, apps otherwise", () => {
  assert.equal(browseKind({ section: "Tweaks" }, true), true);
  assert.equal(browseKind({ section: "Themes" }, true), true);
  assert.equal(browseKind({ section: "Apps (Games)", kind: "ipa" }, true), false);
  assert.equal(browseKind({ section: "Apps (Games)", kind: "ipa" }, false), true);
  assert.equal(browseKind({ section: "Tweaks" }, false), false);
});

test("Collections: Lock Screen, Home Screen, Keyboard, Make It Yours for the jailbroken build; app ones otherwise", () => {
  assert.deepEqual(collectionsFor(true).map((c) => c.title), ["Lock Screen", "Home Screen", "Keyboard", "Make It Yours"]);
  assert.ok(collectionsFor(false).length >= 3 && collectionsFor(false).every((c) => !c.jailbreak));
  for (const c of COLLECTIONS) assert.match(c.icon, /^[A-Z]/, `${c.id}: a file in icons/sections`);
  assert.equal(collection("nope"), null);
  const c = loaded();
  assert.deepEqual(ids(c.collection("lock-screen")), ["com.x.clock", "com.x.notify"]);
  assert.deepEqual(ids(c.collection("home-screen")), ["com.x.dock"]);
  assert.deepEqual(ids(c.collection("keyboard")), ["com.x.keys", "com.x.swipe"]);
  assert.deepEqual(ids(c.collection("make-it-yours")), ["com.x.theme", "com.x.walls"]);
  assert.deepEqual(ids(c.collection("play")), ["com.example.cards", "com.example.delta"]);
  assert.deepEqual(c.collection("nope"), []);
  assert.deepEqual(ids(runCatalog(c, "collection", ["keyboard"])), ["com.x.keys", "com.x.swipe"], "through the worker's entry point");
  // hidden sections drop out, as from every list
  c.setHidden(["Keyboards"]);
  assert.deepEqual(ids(c.collection("keyboard")), ["com.x.swipe"]);
  // Not Jailbroken: the tweak collections are empty
  const n = loaded();
  n.setDevice({ ios: "16.5", jailbreak: "none" });
  assert.deepEqual(n.collection("lock-screen"), []);
  assert.deepEqual(ids(n.collection("connect")), ["com.example.chat"]);
});

test("roulettePool: the wheel's types with their free packages; paid ones never", () => {
  const c = loaded();
  const pool = c.roulette();
  assert.deepEqual(pool.map((t) => t.label), ROULETTE_TYPES.jailbreak.map((t) => t.label));
  const of = (label) => ids(pool.find((t) => t.label === label).rows);
  assert.ok(of("Tweak").includes("com.x.dock"));
  assert.ok(!pool.some((t) => t.rows.some((r) => r.id === "com.x.paid")), "every pick is free");
  assert.deepEqual(of("Theme"), ["com.x.theme", "com.x.walls"]);
  assert.deepEqual(of("Toy"), ["com.x.cat"]);
  assert.deepEqual(of("Utility"), ["com.x.util"]);
  // capped per type, evenly over the rows, the same each time
  const many = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, section: "Tweaks" }));
  const capped = roulettePool(many, { per: 50 });
  assert.equal(capped[0].rows.length, 50);
  assert.deepEqual(roulettePool(many, { per: 50 })[0].rows, capped[0].rows);
  // Not Jailbroken: app categories
  const n = loaded();
  n.setDevice({ ios: "16.5", jailbreak: "none" });
  const apps = runCatalog(n, "roulette", []);
  assert.deepEqual(apps.map((t) => t.label), ROULETTE_TYPES.apps.map((t) => t.label));
  assert.ok(apps.find((t) => t.label === "Emulator").rows.some((r) => r.id === "com.example.delta"));
  assert.ok(apps.every((t) => t.rows.every((r) => r.kind === "ipa")), "apps only");
});

test("spinPick: every spin lands on a package the catalog has, on a type that has packages", () => {
  for (const jailbroken of [true, false]) {
    const c = loaded();
    if (!jailbroken) c.setDevice({ ios: "16.5", jailbreak: "none" });
    const pool = c.roulette();
    for (let i = 0; i < 300; i++) {
      const pick = spinPick(pool);
      assert.ok(pick, "a pick");
      assert.ok(pool[pick.type].rows.includes(pick.row), "the row is of the type the wheel shows");
      const page = c.package(pick.row.id);
      assert.ok(page && !page.installedOnly, `${pick.row.id} exists in a source`);
      assert.equal(pick.row.paid, false);
    }
  }
  // the edges of rand, and nothing to land on
  const pool = [{ label: "A", rows: [] }, { label: "B", rows: [{ id: "b1" }, { id: "b2" }] }];
  assert.deepEqual(spinPick(pool, () => 0), { type: 1, row: { id: "b1" } });
  assert.deepEqual(spinPick(pool, () => 0.9999999), { type: 1, row: { id: "b2" } });
  assert.equal(spinPick([{ label: "A", rows: [] }]), null);
  assert.equal(spinPick(null), null);
  assert.ok(ROULETTE_PRICES.includes("Free"));
});
